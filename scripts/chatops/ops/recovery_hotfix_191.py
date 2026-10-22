#!/usr/bin/python3
"""One-time root-only, hash-checked and reversible recovery.py hotfix. NOT a daemon.

Run a reviewed root-owned checkout; never execute agent-owned worktree code as root.
No task admission, retry, budget change, model call, or modified source task.
"""
import argparse
import copy
import fcntl
import os
import pathlib
import pwd
import re
import sys

INSTALL = pathlib.Path('/usr/local/lib/gb-actions-train')
sys.path.insert(0, str(INSTALL))
import installer
import receiver
import recovery

STATE = receiver.STATE
POLICY = receiver.POLICY
TARGET = INSTALL / 'recovery.py'
JOURNAL = STATE / 'hotfix-191.json'
BACKUP = STATE / 'hotfix-191-backup'
OLD_SHA = '2f6ae741ccffff673e667735cd0b9d8201c6ce03b2e1a9ccc8f1e817605b2739'
NEW_SHA = '579ea87375a1008481f29a736f818944adb40bd5d924719824bee410849050ea'
OLD_CONTROLLER = 'ba02b9d9f9d56c7b07379da22d128c3dfa7341e1'

def state_hashes():
    from recovery_upgrade import preserved
    # Operational journals and budgets can change only across real stage transitions.
    # The monitor's derived telemetry is not authoritative task state.
    names = (STATE / 'slot1.json', STATE / 'slot2.json', STATE / 'recovery.json',
             pathlib.Path('/etc/gobadminton-slots/budgets.json'))
    return {str(p): installer.sha(p) for p in names}

def quiet():
    receiver.units_quiet(receiver.UNITS)
    for slot in ('slot1', 'slot2'):
        j = receiver.journal(slot)
        state, _ = receiver.checkpoint(slot)
        receiver.need(not j['pending'] and
              (not state['active'] or state['active']['phase'] == 'done'),
              'stage running or unknown; no takeover')
        uid = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2').pw_uid
        receiver.no_models(uid, slot)
        receiver.free_lock(receiver.AUTONOMY / 'slots' / slot / 'worker.lock')
        receiver.free_lock(receiver.AUTONOMY / 'locks' / (slot + '.lease'))
    receiver.need(not (STATE / 'integration.json').exists(), 'DEV integration pending')
    cache = receiver.recovery_journal()
    receiver.need(not any(v['status'].endswith('_pending') for v in cache['receipts'].values()),
                  'unknown recovery stage; reconcile before install')

def planned(bundle, manifest_sha, controller, stage_sha):
    receiver.need(re.fullmatch('[0-9a-f]{40}', controller or '') and
                  controller != OLD_CONTROLLER, 'immutable new controller required')
    receiver.need(re.fullmatch('[0-9a-f]{64}', stage_sha or ''), 'exact workflow SHA required')
    receiver.trusted_tree(bundle)
    contents = installer.payload(bundle, manifest_sha)
    record = receiver.read(STATE / 'backup.json', 0)
    policy = receiver.read(POLICY, 0)
    receiver.need(policy['mode'] == 'active' and policy['controller_sha'] == OLD_CONTROLLER
                  and policy['recovery']['source_sha'] == OLD_CONTROLLER,
                  'not exact installed active baseline')
    receiver.need(installer.sha(TARGET) == OLD_SHA, 'old installed recovery.py drift')
    receiver.need(set(record['after']) == {str(k) for k in contents}, 'manifest targets changed')
    changed = [str(p) for p, source in contents.items() if installer.sha(p) != installer.sha(source)]
    receiver.need(changed == [str(TARGET)] and installer.sha(contents[TARGET]) == NEW_SHA,
                  'hotfix must replace exactly known recovery.py')
    receiver.need(all(installer.sha(pathlib.Path(p)) == digest
                      for p,digest in record['after'].items()), 'installed baseline drift')
    stage = bundle / '.github/workflows/train-stage.yml'
    dispatch = bundle / '.github/workflows/train-dispatch.yml'
    receiver.need(installer.sha(stage) == stage_sha and stage.read_bytes().count(('ref: '+controller).encode()) == 2
                  and dispatch.read_bytes().count(('ref: '+controller).encode()) == 1,
                  'hosted workflow checkout pins must match reviewed controller')
    next_policy = copy.deepcopy(policy)
    next_policy.update(mode='disabled', controller_sha=controller, stage_workflow_sha256=stage_sha)
    next_policy['recovery']['source_sha'] = controller
    recovery.policy(next_policy)
    next_record = copy.deepcopy(record)
    next_record['after'][str(TARGET)] = NEW_SHA
    next_record['manifest'] = manifest_sha
    return policy,record,next_policy,next_record,contents[TARGET]

def transaction(action,bundle=None,manifest=None,controller=None,stage_sha=None,probe=0):
    receiver.trusted_tree(INSTALL)
    receiver.trusted_tree(STATE)
    receiver.trusted_tree(POLICY)
    fd = os.open(STATE / 'controller.lock', os.O_RDWR | os.O_NOFOLLOW)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        quiet()
        if action in ('dry','apply'):
            policy,record,proposed,next_record,source = planned(bundle,manifest,controller,stage_sha)
            hashes = state_hashes()
            result = dict(before_sha=OLD_SHA,after_sha=NEW_SHA,controller=controller,
                          stage_sha=stage_sha,old_manifest=record['manifest'],
                          new_manifest=manifest,preserved=hashes)
            if action == 'dry':
                return dict(status='DRY_PASS',**result)
            receiver.need(not JOURNAL.exists() and not BACKUP.exists(),
                          'prior hotfix journal exists; do not repeat')
            BACKUP.mkdir(mode=0o700)
            installer.put(TARGET, BACKUP / 'recovery.py', 0o600)
            receiver.atomic(BACKUP / 'policy.json', policy)
            receiver.atomic(BACKUP / 'record.json', record)
            result.update(phase='preparing',mode_before=policy['mode'])
            receiver.atomic(JOURNAL,result)
            receiver.atomic(POLICY, proposed, mode=0o644) # fail closed first
            installer.put(source,TARGET,0o644)
            receiver.atomic(STATE/'backup.json',next_record)
            receiver.need(installer.sha(TARGET) == NEW_SHA and state_hashes() == hashes,
                          'post-apply source/task ledger changed')
            result['phase'] = 'installed-disabled'
            receiver.atomic(JOURNAL,result)
            return dict(status='INSTALLED_DISABLED',history_preserved=True)
        journal = receiver.read(JOURNAL,0)
        receiver.need(journal['phase'] in ('installed-disabled','active'),
                      'hotfix journal not installable')
        policy = receiver.read(POLICY,0)
        receiver.need(installer.sha(TARGET) == NEW_SHA and
                      policy['controller_sha'] == journal['controller'] and
                      policy['stage_workflow_sha256'] == journal['stage_sha'],
                      'installed code/pin drift')
        if action == 'activate':
            receiver.need(policy['mode']=='disabled' and journal['phase']=='installed-disabled'
                          and type(probe) is int and probe > 0,
                          'activation requires disabled mode and verified hosted probe')
            # Operator independently verifies exact GitHub hosted run and stage SHA.
            receiver.need(state_hashes() == journal['preserved'],
                          'source/budget state changed during dry/shadow')
            policy['mode'] = 'active'
            receiver.atomic(POLICY,policy,mode=0o644)
            journal.update(phase='active',probe_run=probe)
            receiver.atomic(JOURNAL,journal)
            return dict(status='ACTIVE',controller=journal['controller'],probe_run=probe)
        if action == 'rollback':
            receiver.need(policy['mode']=='disabled' and
                          journal['phase']=='installed-disabled' and
                          state_hashes() == journal['preserved'],
                          'safe rollback requires no changed tasks and disabled mode')
            oldpolicy=receiver.read(BACKUP/'policy.json',0)
            oldrecord=receiver.read(BACKUP/'record.json',0)
            receiver.need(installer.sha(BACKUP/'recovery.py')==OLD_SHA,
                          'rollback backup drift')
            installer.put(BACKUP/'recovery.py',TARGET,0o644)
            receiver.atomic(STATE/'backup.json',oldrecord)
            oldpolicy['mode']='disabled' # do not activate an incompatible hosted pin
            receiver.atomic(POLICY,oldpolicy,mode=0o644)
            journal['phase']='rolled-back-disabled'
            receiver.atomic(JOURNAL,journal)
            return dict(status='ROLLED_BACK_DISABLED',history_preserved=True)
        raise receiver.Refused('unknown hotfix operation')
    finally:
        os.close(fd)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['dry','apply','activate','rollback'])
    parser.add_argument('--bundle',type=pathlib.Path)
    parser.add_argument('--manifest')
    parser.add_argument('--controller')
    parser.add_argument('--stage-sha')
    parser.add_argument('--probe',type=int,default=0)
    args=parser.parse_args()
    receiver.need(os.geteuid()==0, 'reviewed root-only hotfix')
    print(__import__('json').dumps(transaction(args.action,args.bundle,args.manifest,
                             args.controller,args.stage_sha,args.probe),sort_keys=True))

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(str(error) if isinstance(error,receiver.Refused) else type(error).__name__)
        raise SystemExit(1)
