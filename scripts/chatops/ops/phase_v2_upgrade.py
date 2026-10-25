#!/usr/bin/python3
"""One-time, transactionally reversible V2 stage-routing source upgrade.

Root-only OPS command, never an executor. Source task attempts, recovery receipts,
budgets and other projects are not written. The root policy remains disabled
through installation, hosted shadow proof and separate explicit activation.
"""
import argparse
import base64
import hashlib
import copy
import fcntl
import json
import os
import pathlib
import pwd
import re
import stat
import sys
import time
import datetime as dt
import urllib.request
import urllib.error

INSTALL=pathlib.Path('/usr/local/lib/gb-actions-train')
sys.path.insert(0,str(INSTALL))
import installer
import receiver
import recovery

STATE=receiver.STATE
POLICY=receiver.POLICY
JOURNAL=STATE/'hotfix-phase-v2.json'
BACKUP=STATE/'hotfix-phase-v2-backup'
PRIOR_CONTROLLER='6b24848520ba01f66d764917a577aa1d2d189a45'
REVIEWED_STAGE_SHA='694740ef02a6d4908c4656d1e42d4eec0373d3f10955bb3cd55dded3e4ef7605'
REVIEWED_DISPATCH_SHA='064106884feb13f89323f6856d1714e517816fbbfe9ffa8144524ab364f908a1'
REPO_ID=1416250340

FILES={
 'client.py':(
   'f23895f31d7ad941feec0a37d27538bc9554af94140e3224d52e0c890c3580c7',
   '6567f8c0c3748e711ded4ef231812e397b4c8c7db9757a2128fdb34a61600ca3'),
 'core.py':(
   '15ff397878a50c1435b47b15740411b26c66de4bd12c0454fd6b2ff8c0f526bc',
   '25d257127deaff7f2e1afb35a27cb13b6ce265620c02694b3d19ce9aa8af7a4e'),
 'stage.py':(
   'bf5cbcc77742b31c8b22abac1f7ed2ef77cd95aee287eb5ba19933e8c07426bb',
   '85925ed97a7fb170a556f2769b0851bf4c49dabce77012ce258180ecaa41c007'),
 'live/slots.py':(
   '19d07c8d680d31ff65e13b3d8611b93fab1898461a918e69390a77bf8bb5ad02',
   'e586703954551d5af212c0f347bb83679cb8cdecffa4e48465f3889df318ad5a'),
 'live/autonomous_issues.py':(
   '9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7',
   '8d8baae3089f0a0cafeb047af8d9241dbc756be6a7b30bdc6306ee389361f2fe'),
}


def state_hashes():
    """Snapshot exact authoritative ledgers only, never monitor/derived planning."""
    dirs=(receiver.AUTONOMY/'slots',STATE/'history')
    files=[p for root in dirs if root.exists() for p in root.rglob('*') if p.is_file()]
    files += [STATE/name for name in ('slot1.json','slot2.json','recovery.json')]
    files += [pathlib.Path('/etc/gobadminton-slots/budgets.json')]
    files += [p for slot in ('slot1','slot2')
              for p in (receiver.AUTONOMY/'outbox'/slot/'ledger.json',
                        receiver.AUTONOMY/'outbox'/slot/'ledger.json.bak') if p.exists()]
    files=sorted(set(files))
    receiver.need(all(p.is_file() and not p.is_symlink() for p in files),
                  'untrusted historical task ledger')
    return {str(p):installer.sha(p) for p in files}


def quiet():
    receiver.units_quiet(receiver.UNITS)
    for slot in ('slot1','slot2'):
        j=receiver.journal(slot)
        snap,_=receiver.checkpoint(slot)
        receiver.need(not j['pending'] and
                      (not snap['active'] or snap['active']['phase']=='done'),
                      'active or unknown source stage; must wait for completion')
        uid=pwd.getpwnam('agentagency-dev' if slot=='slot1' else 'gb-slot2').pw_uid
        receiver.no_models(uid,slot)
        receiver.free_lock(receiver.AUTONOMY/'slots'/slot/'worker.lock')
        receiver.free_lock(receiver.AUTONOMY/'locks'/(slot+'.lease'))
    receiver.need(not (STATE/'integration.json').exists(),'integration in flight')
    rc=receiver.recovery_journal()
    receiver.need(not any(v['status'].endswith('_pending') for v in rc['receipts'].values()),
                  'unknown recovery operation in flight')
    found=[]
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdigit() or int(process.name)==os.getpid(): continue
        try: args=(process/'cmdline').read_bytes().replace(b'\0',b' ')
        except (OSError,PermissionError):continue
        if b'/usr/local/lib/gb-actions-train/receiver.py' in args or \
           b'/usr/local/sbin/gb-deploy-helper.sh' in args:
            found.append(process.name)
    receiver.need(not found,'old root callback/helper still running')


def plan(bundle,manifest_sha,controller,stage_sha):
    receiver.need(re.fullmatch('[a-f0-9]{40}',controller or '') and
                  controller != PRIOR_CONTROLLER,'immutable controller SHA required')
    receiver.need(stage_sha == REVIEWED_STAGE_SHA,
                  'stage workflow not the exact independently-reviewed bytes')
    receiver.trusted_tree(bundle)
    items=installer.payload(bundle,manifest_sha)
    for path in items.values():
        receiver.trusted_tree(path)
        receiver.need(path.is_file() and not path.is_symlink() and
                      path.stat().st_nlink==1, 'untrusted candidate')
    policy=receiver.read(POLICY,0)
    receiver.need(policy['mode']=='disabled' and
                  policy['controller_sha']==PRIOR_CONTROLLER and
                  policy['recovery']['source_sha']==PRIOR_CONTROLLER,
                  'expected already-installed but DISABLED prior controller only')
    previous=receiver.read(STATE/'hotfix-191.json',0)
    receiver.need(previous['phase']=='installed-disabled', 'prior hotfix must be installed-disabled')
    record=receiver.read(STATE/'backup.json',0)
    receiver.need(set(items)=={pathlib.Path(p) for p in record['after']},
                  'different installed manifest target set')
    receiver.need(all(installer.sha(pathlib.Path(p))==digest
                      for p,digest in record['after'].items()),
                  'installed manifest content drift')
    changed={str(path.relative_to(INSTALL)) for path,source in items.items()
             if path.is_relative_to(INSTALL) and installer.sha(path)!=installer.sha(source)}
    receiver.need(changed==set(FILES),'candidate changed more or fewer than five authorized files')
    for suffix,(old,new) in FILES.items():
        target=INSTALL/suffix
        receiver.need(installer.sha(target)==old and
                      installer.sha(items[target])==new,
                      'unexpected base or unreviewed new payload: '+suffix)
    stage=bundle/'.github/workflows/train-stage.yml'
    dispatch=bundle/'.github/workflows/train-dispatch.yml'
    for path in (stage,dispatch):receiver.trusted_tree(path)
    receiver.need(installer.sha(stage)==REVIEWED_STAGE_SHA and
                  installer.sha(dispatch)==REVIEWED_DISPATCH_SHA and
                  stage.read_bytes().count(('ref: '+controller).encode())==2 and
                  dispatch.read_bytes().count(('ref: '+controller).encode())==2,
                  'hosted workflows not exact reviewed, immutable controller pins')
    nextpolicy=copy.deepcopy(policy)
    nextpolicy.update(mode='disabled',controller_sha=controller,
                      stage_workflow_sha256=stage_sha)
    nextpolicy['recovery']['source_sha']=controller
    recovery.policy(nextpolicy)
    nextrecord=copy.deepcopy(record)
    nextrecord['manifest']=manifest_sha
    for suffix,(_,new) in FILES.items():
        nextrecord['after'][str(INSTALL/suffix)]=new
    return policy,record,nextpolicy,nextrecord,items


def clear_installer_temporary(path):
    """A crash may leave only the exact root-owned '.install' target tempfile."""
    temp=path.with_name('.'+path.name+'.install')
    try:info=temp.lstat()
    except FileNotFoundError:return
    receiver.trusted_tree(temp.parent)
    receiver.need(stat.S_ISREG(info.st_mode) and info.st_uid==0 and info.st_nlink==1
                  and stat.S_IMODE(info.st_mode) in (0o600,0o640,0o644),
                  'foreign/unsafe temporary installation file')
    temp.unlink()


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise receiver.Refused('untrusted GitHub public API redirect')


def public_github(path):
    """Read only public repository REST endpoints, with no credential forwarding."""
    receiver.need(isinstance(path, str) and not path.startswith('/')
                  and '..' not in path and '://' not in path,
                  'unsafe GitHub proof path')
    req=urllib.request.Request(
        'https://api.github.com/repos/anpavel84-afk/gobadminton-clean/'+path,
        headers={'Accept':'application/vnd.github+json',
                 'User-Agent':'GoBadminton-PhaseV2-Root-ReadOnly',
                 'X-GitHub-Api-Version':'2022-11-28'})
    opener=urllib.request.build_opener(_NoRedirect())
    with opener.open(req,timeout=10) as response:
        receiver.need(response.status==200,'GitHub proof HTTP not successful')
        raw=response.read(524289)
    receiver.need(len(raw)<=524288,'GitHub proof body too large')
    try:data=json.loads(raw)
    except ValueError:raise receiver.Refused('GitHub proof body not JSON') from None
    receiver.need(type(data) is dict,'GitHub proof response not object')
    return data


def verify_hosted_probe(run_id, journal):
    """Independently verify exact public hosted dispatcher+planning job.

    The human-supplied run ID cannot itself serve as evidence. GitHub must
    confirm a completed post-install run on DEV with both real jobs successful
    and its exact workflow bytes equal to the separately reviewed pin.
    """
    receiver.need(type(run_id) is int and 0<run_id<10**15,
                  'invalid shadow-run ID')
    installed_at=journal.get('installed_at')
    receiver.need(type(installed_at) is int and installed_at>0,
                  'missing installation time fence')
    result=public_github('actions/runs/'+str(run_id))
    receiver.need(
        result.get('id')==run_id and
        result.get('name')=='Train dispatcher' and
        result.get('path')=='.github/workflows/train-dispatch.yml' and
        result.get('event')=='workflow_dispatch' and
        result.get('head_branch')=='dev' and
        result.get('status')=='completed' and
        result.get('conclusion')=='success' and
        (result.get('repository') or {}).get('id')==REPO_ID and
        (result.get('head_repository') or {}).get('id')==REPO_ID and
        (result.get('actor') or {}).get('id') in (318610566,41898282) and
        re.fullmatch('[a-f0-9]{40}',result.get('head_sha') or '') and
        type(result.get('run_attempt')) is int and result['run_attempt']>=1,
        'GitHub run not the trusted completed DEV dispatcher')
    started=result.get('run_started_at') or result.get('created_at')
    receiver.need(isinstance(started,str),'missing exact GitHub run time')
    try:
        start_dt=dt.datetime.fromisoformat(started.replace('Z','+00:00'))
        time_ok=start_dt.tzinfo is not None and start_dt.timestamp()>=installed_at
    except (ValueError,OverflowError):time_ok=False
    receiver.need(time_ok,'shadow run not after installed disabled controller')
    jobs=public_github('actions/runs/'+str(run_id)+'/jobs?per_page=40')
    jobrows=jobs.get('jobs',[])
    receiver.need(type(jobrows) is list and 2<=len(jobrows)<=40 and
                  jobs.get('total_count')==len(jobrows),
                  'ambiguous or truncated shadow jobs')
    required=('reconcile','publish_phase_drafts')
    for name in required:
        selected=[j for j in jobrows if j.get('name')==name]
        receiver.need(len(selected)==1 and
                      selected[0].get('status')=='completed' and
                      selected[0].get('conclusion')=='success' and
                      selected[0].get('head_sha')==result['head_sha'],
                      'required hosted shadow job not successful: '+name)
    # The run's actual source revision must contain the reviewed dispatcher
    # workflow; a successful old/altered workflow does not prove this version.
    item=public_github('contents/.github/workflows/train-dispatch.yml?ref='+result['head_sha'])
    receiver.need(item.get('encoding')=='base64' and
                  type(item.get('content')) is str and
                  item.get('path')=='.github/workflows/train-dispatch.yml',
                  'hosted run workflow revision unavailable')
    try:raw=base64.b64decode(item['content'],validate=False)
    except (ValueError,TypeError):raise receiver.Refused('bad hosted workflow encoding') from None
    receiver.need(len(raw)<=131072 and
                  hashlib.sha256(raw).hexdigest()==REVIEWED_DISPATCH_SHA,
                  'hosted run used an unexpected workflow')
    return {'run_id':run_id,'head_sha':result['head_sha'],
            'run_started_at':started,'verified_jobs':list(required),
            'reviewed_dispatcher_sha256':REVIEWED_DISPATCH_SHA}


def transaction(action,bundle=None,manifest_sha=None,controller=None,stage_sha=None,probe=0):
    for p in (INSTALL,STATE,POLICY):receiver.trusted_tree(p)
    fd=os.open(STATE/'controller.lock',os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        quiet()
        if action in ('dry','apply'):
            receiver.need(not JOURNAL.exists() and not BACKUP.exists(),
                          'phase V2 upgrade already attempted: inspect journal, no replay')
            old,record,newpol,newrecord,items=plan(bundle,manifest_sha,controller,stage_sha)
            before=state_hashes()
            if action=='dry':
                return dict(status='DRY_PASS',old_controller=PRIOR_CONTROLLER,
                    proposed_controller=controller,changed=sorted(FILES),
                    preserved_ledgers=len(before),mode='disabled')
            # Journal FIRST: if backup creation is interrupted, an authorized
            # rollback can prove nothing was installed and retain full history.
            journal=dict(schema='GB_PHASE_V2_UPGRADE_V1',phase='preparing',
                controller=controller,stage_sha=stage_sha,manifest=manifest_sha,
                before_controller=PRIOR_CONTROLLER,
                state_hashes=before,files=copy.deepcopy(FILES))
            receiver.atomic(JOURNAL,journal)
            BACKUP.mkdir(mode=0o700)
            for suffix in FILES:
                source=INSTALL/suffix
                dst=BACKUP/suffix
                dst.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
                installer.put(source,dst,0o600)
            receiver.atomic(BACKUP/'policy.json',old)
            receiver.atomic(BACKUP/'record.json',record)
            journal['phase']='installing'
            receiver.atomic(JOURNAL,journal)
            for suffix in FILES:
                source=items[INSTALL/suffix]
                installer.put(source,INSTALL/suffix,0o644)
            receiver.atomic(STATE/'backup.json',newrecord)
            receiver.atomic(POLICY,newpol,mode=0o644) # still disabled
            receiver.need(state_hashes()==before and
                          all(installer.sha(INSTALL/suffix)==new for suffix,(_,new) in FILES.items()),
                          'post-install ledger or payload drift')
            journal['phase']='installed-disabled'
            journal['installed_at']=int(time.time())
            receiver.atomic(JOURNAL,journal)
            return dict(status='INSTALLED_DISABLED',changed=sorted(FILES),
                        controller=controller,preserved_ledgers=len(before))
        journal=receiver.read(JOURNAL,0)
        receiver.need(journal.get('schema')=='GB_PHASE_V2_UPGRADE_V1'
                      and journal.get('phase') in
                      ('preparing','installing','installed-disabled','activating','active'),
                      'unknown V2 upgrade journal')
        policy=receiver.read(POLICY,0)
        if action=='activate':
            receiver.need(journal['phase'] in ('installed-disabled','activating')
                          and type(probe) is int and probe>0,
                          'requires confirmed hosted readonly shadow run')
            receiver.need(policy['controller_sha']==journal['controller']
                          and policy['stage_workflow_sha256']==journal['stage_sha']
                          and policy['recovery']['source_sha']==journal['controller']
                          and all(installer.sha(INSTALL/name)==new
                                  for name,(_,new) in FILES.items()),
                          'installed source/policy controller drift')
            if journal['phase']=='installed-disabled':
                receiver.need(policy['mode']=='disabled' and
                              state_hashes()==journal['state_hashes'],
                              'cannot start activation with changed task state')
                proof=verify_hosted_probe(probe,journal)
                # Verified proof + write-ahead marker precedes ACTIVE policy
                # mutation; the next call can recover without fabricating a run.
                journal.update(phase='activating',shadow_run=probe,shadow_proof=proof)
                receiver.atomic(JOURNAL,journal)
            else:
                receiver.need(journal.get('shadow_run')==probe,
                              'activation proof changed during recovery')
                proof=verify_hosted_probe(probe,journal)
                receiver.need(journal.get('shadow_proof')==proof,
                              'hosted GitHub proof changed during activation recovery')
            if policy['mode']=='disabled':
                receiver.need(state_hashes()==journal['state_hashes'],
                              'task state changed before activation')
                policy['mode']='active'
                receiver.atomic(POLICY,policy,mode=0o644)
            else:
                # Power loss after ACTIVE policy but before last journal write:
                # never rewind or replay a possibly running product stage.
                receiver.need(policy['mode']=='active' and
                              journal['phase']=='activating',
                              'unexpected activation state')
            journal['phase']='active'
            receiver.atomic(JOURNAL,journal)
            return dict(status='ACTIVE',controller=journal['controller'],shadow_run=probe)
        if action=='rollback' and journal['phase']=='preparing':
            receiver.need(policy['mode']=='disabled' and
                          policy['controller_sha']==PRIOR_CONTROLLER and
                          state_hashes()==journal['state_hashes'] and
                          all(installer.sha(INSTALL/name)==old for name,(old,_) in FILES.items()),
                          'preparing-stage rollback requires exact original disabled controller')
            # Incomplete backup is preserved for forensics; zero installed files
            # or task state have been touched. A new deployment needs new review.
            journal['phase']='aborted-preparing-disabled'
            receiver.atomic(JOURNAL,journal)
            return dict(status='ABORTED_PREPARATION_DISABLED',
                        preserved_ledgers=len(journal['state_hashes']))
        if action=='rollback':
            receiver.need(journal['phase'] in ('installing','installed-disabled','activating')
                          and policy['mode']=='disabled' and
                          state_hashes()==journal['state_hashes'],
                          'cannot rollback live effects or unknown task state')
            oldrecord=receiver.read(BACKUP/'record.json',0)
            oldpolicy=receiver.read(BACKUP/'policy.json',0)
            for name,(old,new) in FILES.items():
                target=INSTALL/name
                source=BACKUP/name
                receiver.need(installer.sha(source)==old and
                              installer.sha(target) in (old,new),
                              'root backup or partial installation drift')
                clear_installer_temporary(target)
                installer.put(source,target,0o644)
            receiver.atomic(STATE/'backup.json',oldrecord)
            oldpolicy['mode']='disabled' # do not re-enable old ref unexpectedly
            receiver.atomic(POLICY,oldpolicy,mode=0o644)
            journal['phase']='rolled-back-disabled'
            receiver.atomic(JOURNAL,journal)
            return dict(status='ROLLED_BACK_DISABLED',preserved_ledgers=len(journal['state_hashes']))
        raise receiver.Refused('invalid upgrade action')
    finally:
        os.close(fd)


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('action',choices=('dry','apply','activate','rollback'))
    cli.add_argument('--bundle',type=pathlib.Path)
    cli.add_argument('--manifest')
    cli.add_argument('--controller')
    cli.add_argument('--stage-sha')
    cli.add_argument('--probe',type=int,default=0)
    args=cli.parse_args()
    receiver.need(os.geteuid()==0, 'only reviewed root OPS may install model routing')
    print(json.dumps(transaction(args.action,args.bundle,args.manifest,
                                 args.controller,args.stage_sha,args.probe),sort_keys=True))


if __name__=='__main__':
    try:main()
    except Exception as err:
        print(str(err) if isinstance(err,receiver.Refused) else type(err).__name__)
        raise SystemExit(1)
