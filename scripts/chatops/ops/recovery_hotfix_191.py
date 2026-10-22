#!/usr/bin/python3
"""Single-use, reviewed, root-only recovery191 patch; NOT an executor/daemon.

Two explicit apply calls: first disable all new stages and drain old callbacks,
then replace pinned recovery+receiver bytes at a quiescent boundary.
"""
import argparse
import copy
import fcntl
import os
import pathlib
import pwd
import re
import stat
import sys

INSTALL = pathlib.Path('/usr/local/lib/gb-actions-train')
sys.path.insert(0, str(INSTALL))
import installer
import receiver
import recovery

STATE, POLICY = receiver.STATE, receiver.POLICY
RECOVERY = INSTALL / 'recovery.py'
RECEIVER = INSTALL / 'receiver.py'
JOURNAL = STATE / 'hotfix-191.json'
BACKUP = STATE / 'hotfix-191-backup'
OLD = {
    str(RECOVERY): '2f6ae741ccffff673e667735cd0b9d8201c6ce03b2e1a9ccc8f1e817605b2739',
    str(RECEIVER): 'bff85b1f5574c7c29df1dd9235c31622e2358a6289f506ec7fb1edc5dfcf4261',
}
NEW = {
    str(RECOVERY): '579ea87375a1008481f29a736f818944adb40bd5d924719824bee410849050ea',
    str(RECEIVER): '05612203fb15fab569a55cac5f81defc22f9ac18f340850e62e8d9e7948cafd6',
}
OLD_CONTROLLER = 'ba02b9d9f9d56c7b07379da22d128c3dfa7341e1'

def state_hashes():
    """Capture authoritative source/receipts/budgets, never derived OPS telemetry."""
    dirs = (receiver.AUTONOMY / 'slots', STATE / 'history')
    files = [p for root in dirs if root.exists() for p in root.rglob('*') if p.is_file()]
    files += [STATE / name for name in ('slot1.json','slot2.json','recovery.json')]
    files.append(pathlib.Path('/etc/gobadminton-slots/budgets.json'))
    files += [p for slot in ('slot1','slot2')
              for p in ((receiver.AUTONOMY / 'outbox' / slot / 'ledger.json'),
                        (receiver.AUTONOMY / 'outbox' / slot / 'ledger.json.bak'))
              if p.exists()]
    files = sorted(set(files))
    receiver.need(all(p.is_file() and not p.is_symlink() for p in files),
                  'unsafe source/attempt ledger path')
    return {str(p): installer.sha(p) for p in files}

def quiet():
    receiver.units_quiet(receiver.UNITS)
    for slot in ('slot1', 'slot2'):
        j=receiver.journal(slot)
        snapshot, _ = receiver.checkpoint(slot)
        receiver.need(not j['pending'] and
             (not snapshot['active'] or snapshot['active']['phase']=='done'),
             'active/unknown stage; drain, do not kill')
        uid=pwd.getpwnam('agentagency-dev' if slot=='slot1' else 'gb-slot2').pw_uid
        receiver.no_models(uid,slot)
        receiver.free_lock(receiver.AUTONOMY / 'slots' / slot / 'worker.lock')
        receiver.free_lock(receiver.AUTONOMY / 'locks' / (slot+'.lease'))
    receiver.need(not (STATE / 'integration.json').exists(),'DEV integration pending')
    cache=receiver.recovery_journal()
    receiver.need(not any(v['status'].endswith('_pending') for v in cache['receipts'].values()),
                 'unknown recovery stage')

def callbacks_drained():
    """After mode=disabled, reject every old root receiver/helper still in flight."""
    found=[]
    for pid in pathlib.Path('/proc').iterdir():
        if not pid.name.isdigit() or int(pid.name)==os.getpid(): continue
        try:
            argv=(pid/'cmdline').read_bytes().replace(b'\0',b' ').decode(errors='ignore')
        except (OSError,PermissionError): continue
        if ('/usr/local/lib/gb-actions-train/receiver.py' in argv or
            '/usr/local/sbin/gb-deploy-helper.sh' in argv):
            found.append(pid.name)
    receiver.need(not found,'receiver/helper callbacks still in flight; wait until drained')

def validated_payload(bundle,manifest):
    receiver.trusted_tree(bundle)
    items=installer.payload(bundle,manifest)
    receiver.need(set(items)==set(map(pathlib.Path,receiver.read(STATE/'backup.json',0)['after'])),
                 'manifest targets changed')
    for target,source in items.items():
        receiver.trusted_tree(source)  # verifies EVERY root-owned descendant and ancestor
        receiver.need(source.is_file() and not source.is_symlink() and
                      source.stat().st_nlink==1,'mutable/linked payload')
    return items

def plan(bundle,manifest,controller,stage_sha):
    receiver.need(re.fullmatch('[a-f0-9]{40}',controller or '') and controller!=OLD_CONTROLLER,
                  'immutable reviewed controller required')
    receiver.need(re.fullmatch('[a-f0-9]{64}',stage_sha or ''),'invalid stage workflow SHA')
    payload=validated_payload(bundle,manifest)
    policy=receiver.read(POLICY,0)
    record=receiver.read(STATE/'backup.json',0)
    receiver.need(policy['mode']=='active' and policy['controller_sha']==OLD_CONTROLLER
                  and policy['recovery']['source_sha']==OLD_CONTROLLER,
                  'not current expected controller')
    receiver.need(all(installer.sha(pathlib.Path(p))==h for p,h in record['after'].items()),
                  'installed manifest baseline drift')
    changed={str(t) for t,src in payload.items() if installer.sha(t)!=installer.sha(src)}
    receiver.need(changed==set(NEW),'hotfix must change EXACT recovery and receiver only')
    receiver.need(all(installer.sha(pathlib.Path(p))==h for p,h in OLD.items()) and
                  all(installer.sha(payload[pathlib.Path(p)])==h for p,h in NEW.items()),
                  'hotfix before/after payload hash mismatch')
    stage=bundle/'.github/workflows/train-stage.yml'
    dispatch=bundle/'.github/workflows/train-dispatch.yml'
    for f in (stage,dispatch): receiver.trusted_tree(f)
    receiver.need(installer.sha(stage)==stage_sha and
                  stage.read_bytes().count(('ref: '+controller).encode())==2 and
                  dispatch.read_bytes().count(('ref: '+controller).encode())==1,
                  'immutable GitHub hosted checkout pins mismatch')
    proposed=copy.deepcopy(policy)
    proposed.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_sha)
    proposed['recovery']['source_sha']=controller
    recovery.policy(proposed)
    nextrecord=copy.deepcopy(record)
    nextrecord['after'].update(NEW)
    nextrecord['manifest']=manifest
    return policy,record,proposed,nextrecord,payload

def clear_interrupted_put(target):
    """Delete ONLY root-owned temporary file left by this reviewed installer after a crash."""
    temp = target.with_name('.' + target.name + '.install')
    try:
        info = temp.lstat()
    except FileNotFoundError:
        return
    receiver.trusted_tree(temp.parent)
    receiver.need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and
                  info.st_nlink == 1 and stat.S_IMODE(info.st_mode) in (0o600,0o644),
                  'unsafe interrupted installer temporary file')
    temp.unlink()


def transaction(action,bundle=None,manifest=None,controller=None,stage_sha=None,probe=0):
    for p in (INSTALL,STATE,POLICY):receiver.trusted_tree(p)
    fd=os.open(STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if action=='dry':
            quiet()
            _,_,_,_,_=plan(bundle,manifest,controller,stage_sha)
            return dict(status='DRY_PASS',changed=sorted(NEW),unchanged_tasks=len(state_hashes()))
        if action=='apply' and not JOURNAL.exists():
            quiet()
            before,record,proposed,_,_=plan(bundle,manifest,controller,stage_sha)
            receiver.need(not BACKUP.exists(),'prior patch backup; refuse repeated install')
            BACKUP.mkdir(mode=0o700)
            for p in OLD: installer.put(pathlib.Path(p),BACKUP/pathlib.Path(p).name,0o600)
            receiver.atomic(BACKUP/'policy.json',before)
            receiver.atomic(BACKUP/'record.json',record)
            j=dict(phase='draining',old_manifest=record['manifest'],manifest=manifest,
                   controller=controller,stage_sha=stage_sha,old=OLD,new=NEW)
            receiver.atomic(JOURNAL,j)
            receiver.atomic(POLICY,before|{'mode':'disabled'},mode=0o644)
            return dict(status='DISABLED_DRAIN',next='After old receivers finish, call apply again')
        journal=receiver.read(JOURNAL,0)
        policy=receiver.read(POLICY,0)
        receiver.need(journal['phase'] in ('draining','installing','installed-disabled','active'),
                      'invalid one-time hotfix phase')
        if action=='apply' and journal['phase']=='draining' and policy['mode']=='active':
            # Crash between write-ahead journal and first fail-closed policy write.
            receiver.need(policy['controller_sha']==OLD_CONTROLLER and
                          all(installer.sha(pathlib.Path(p))==h for p,h in OLD.items()) and
                          all(installer.sha(BACKUP/pathlib.Path(p).name)==h for p,h in OLD.items()),
                          'drain interrupted with unknown source/backup')
            receiver.atomic(POLICY,policy|{'mode':'disabled'},mode=0o644)
            return dict(status='DISABLED_DRAIN',next='Wait old callbacks, then apply')
        if action=='apply':
            receiver.need(journal['phase']=='draining' and policy['mode']=='disabled',
                          'source already installed or dispatch not disabled')
            callbacks_drained()
            quiet()
            receiver.need(all(installer.sha(pathlib.Path(p))==h for p,h in OLD.items()),
                          'partial code write; rollback first')
            receiver.need(policy['controller_sha']==OLD_CONTROLLER,
                          'unexpected current controller')
            receiver.need(controller==journal['controller'] and manifest==journal['manifest']
                          and stage_sha==journal['stage_sha'], 'reviewed handoff drift')
            items=validated_payload(bundle,manifest)
            receiver.need(all(installer.sha(items[pathlib.Path(p)])==h for p,h in NEW.items()),
                          'reviewed source changed while draining')
            # Snapshot AFTER the drain: a legitimate pre-disable callback may have finished.
            before_state=state_hashes()
            prev=receiver.read(BACKUP/'policy.json',0)
            oldrecord=receiver.read(BACKUP/'record.json',0)
            proposed=copy.deepcopy(prev)
            proposed.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_sha)
            proposed['recovery']['source_sha']=controller
            recovery.policy(proposed)
            receiver.need(all(installer.sha(pathlib.Path(p))==h
                              for p,h in oldrecord['after'].items()),'installed file drift after drain')
            newrecord=copy.deepcopy(oldrecord)
            newrecord['after'].update(NEW)
            newrecord['manifest']=manifest
            journal.update(preserved=before_state,phase='installing')
            receiver.atomic(JOURNAL,journal)  # interruption-safe rollback also accepts 'installing'
            for path in (RECOVERY,RECEIVER):installer.put(items[path],path,0o644)
            receiver.atomic(STATE/'backup.json',newrecord)
            receiver.atomic(POLICY,proposed,mode=0o644)
            receiver.need(all(installer.sha(pathlib.Path(p))==h for p,h in NEW.items())
                          and state_hashes()==before_state,'post-install source or ledger drift')
            journal['phase']='installed-disabled'
            receiver.atomic(JOURNAL,journal)
            return dict(status='INSTALLED_DISABLED',history_preserved=True)
        if action=='activate':
            receiver.need(journal['phase']=='installed-disabled' and policy['mode']=='disabled'
                          and type(probe) is int and probe>0,
                          'activation requires disabled mode and independent hosted shadow evidence')
            callbacks_drained();quiet()
            receiver.need(policy['controller_sha']==journal['controller']
                          and policy['stage_workflow_sha256']==journal['stage_sha']
                          and all(installer.sha(pathlib.Path(p))==h for p,h in NEW.items())
                          and state_hashes()==journal['preserved'],
                          'installed code/root state/policy drift')
            policy['mode']='active'
            receiver.atomic(POLICY,policy,mode=0o644)
            journal.update(phase='active',probe_run=probe)
            receiver.atomic(JOURNAL,journal)
            return dict(status='ACTIVE',controller=journal['controller'],probe_run=probe)
        if action=='rollback':
            if journal['phase']=='draining' and policy['mode']=='active':
                receiver.need(policy['controller_sha']==OLD_CONTROLLER,
                              'cannot recover untrusted pre-disable policy')
                receiver.atomic(POLICY,policy|{'mode':'disabled'},mode=0o644)
                policy = receiver.read(POLICY,0)
            receiver.need(journal['phase'] in ('draining','installing','installed-disabled')
                          and policy['mode']=='disabled',
                          'rollback forbidden after activation or before dispatch disabled')
            callbacks_drained();quiet()
            receiver.need(all(installer.sha(pathlib.Path(p)) in (OLD[p],NEW[p]) for p in OLD),
                          'runtime not equal to either known before/after')
            if journal['phase']!='draining':
                receiver.need(state_hashes()==journal.get('preserved'),
                              'authoritative task ledger changed; manual reconcile before rollback')
            for path in (RECOVERY,RECEIVER):
                receiver.need(installer.sha(BACKUP/path.name)==OLD[str(path)],
                              'root backup hash drift')
                if journal['phase']=='installing':
                    clear_interrupted_put(path)
                installer.put(BACKUP/path.name,path,0o644)
            receiver.atomic(STATE/'backup.json',receiver.read(BACKUP/'record.json',0))
            prior=receiver.read(BACKUP/'policy.json',0)
            receiver.atomic(POLICY,prior|{'mode':'disabled'},mode=0o644)
            journal['phase']='rolled-back-disabled'
            receiver.atomic(JOURNAL,journal)
            return dict(status='ROLLED_BACK_DISABLED',history_preserved=True)
        raise receiver.Refused('unknown root hotfix operation')
    finally:
        os.close(fd)

def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('action',choices=('dry','apply','activate','rollback'))
    a.add_argument('--bundle',type=pathlib.Path)
    a.add_argument('--manifest')
    a.add_argument('--controller')
    a.add_argument('--stage-sha')
    a.add_argument('--probe',type=int,default=0)
    opts=a.parse_args()
    receiver.need(os.geteuid()==0,'reviewed root-only transaction')
    print(__import__('json').dumps(transaction(opts.action,opts.bundle,opts.manifest,
                                opts.controller,opts.stage_sha,opts.probe),sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as e:
        print(str(e) if isinstance(e,receiver.Refused) else type(e).__name__)
        raise SystemExit(1)
