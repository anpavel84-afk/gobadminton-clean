#!/usr/bin/python3
"""Reviewed #29 native QA upgrade using existing quiescence/shadow/rollback."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as r
import installer as i
from core import digest
STATE = r.STATE
JOURNAL = STATE/'antigravity-qa-29.json'
BACKUP = STATE/'antigravity-qa-29-backup'
INSTALL = Path('/usr/local/lib/gb-actions-train')
MARKER = Path('/etc/gobadminton-slots/antigravity-qa.json')
BUDGET = Path('/etc/gobadminton-slots/budgets.json')
OLD = 'f377bb1e393de93d6faf211886ae1b8c36c4a45b'
ALLOWED = {'core.py','stage.py','receiver.py','cost_policy.py','native_antigravity.py'}
HELPERS = {'context_stability_upgrade.py':'26f9032e6a47e478f45666be9a73004d6b415e85358908e02e9b495316dc408f',
           'cost_policy_upgrade.py':'781c89f8fac0b234a5aefc81dd10c6df10b91adc080d703bd7fb2d458a7e7094'}

BIN_SOURCE=Path('/home/agentagency-dev/.local/bin/agy')
BIN_TARGET=Path('/opt/gb-slots/runtime/antigravity/agy')
AGY_SHA='8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c'
AUTH_SOURCE=Path('/home/agentagency-dev/.gemini/antigravity-cli/antigravity-oauth-token')
AUTH_TARGET=Path('/srv/gb-slots/slot2/home/.gemini/antigravity-cli/antigravity-oauth-token')


def provisioning():
    for source in (BIN_SOURCE,AUTH_SOURCE):
        info=source.lstat()
        r.need(stat.S_ISREG(info.st_mode) and info.st_uid==1002 and info.st_nlink==1
               and not info.st_mode&0o022,'untrusted existing native source')
    r.need(i.sha(BIN_SOURCE)==AGY_SHA,'native CLI pin drift')
    r.need(stat.S_IMODE(AUTH_SOURCE.stat().st_mode)==0o600,'native auth must remain private')
    value=json.loads(AUTH_SOURCE.read_bytes())
    r.need(set(value)=={'auth_method','id_token','token'},'unrecognized native auth format')
    r.need(not AUTH_TARGET.exists() and not AUTH_TARGET.is_symlink(),
           'existing dedicated auth; do not overwrite or reset')
    r.need(not BIN_TARGET.exists() and not BIN_TARGET.is_symlink(),
           'existing native CLI installation; inspect instead of overwrite')
    return {BIN_TARGET:BIN_SOURCE,AUTH_TARGET:AUTH_SOURCE}


def put_managed(source,target):
    if target==AUTH_TARGET:
        # Only the two known private native directories, never a broad HOME ACL.
        home=Path('/srv/gb-slots/slot2/home')
        for parent in (home,home/'.gemini',AUTH_TARGET.parent):
            if not parent.exists():parent.mkdir(mode=0o700);os.chown(parent,978,968)
            info=parent.lstat()
            r.need(stat.S_ISDIR(info.st_mode) and info.st_uid==978
                   and stat.S_IMODE(info.st_mode)==0o700,'untrusted dedicated native auth directory')
        temp=target.with_name('.'+target.name+'.ag29-install')
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'wb') as f:
            f.write(source.read_bytes());f.flush();os.fsync(f.fileno());os.fchown(f.fileno(),978,968)
        os.replace(temp,target)
        directory=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    else:i.put(source,target,0o755 if target==BIN_TARGET else 0o644)


def helpers(bundle):
    result = []
    for name, sha in HELPERS.items():
        p = bundle/'scripts/chatops/ops'/name
        r.trusted_tree(p); r.need(i.sha(p) == sha, 'reviewed OPS helper drift')
        spec = importlib.util.spec_from_file_location('_cursor211_'+name[:-3], p)
        m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); result.append(m)
    return result


def preserved(C, u):
    out = C.preserved(u)
    out.pop(str(BUDGET),None)  # Exact prospective one-call change is separately journaled.
    for name in ('cursor-author-211.json','cursor-successor-211.json','context-stability-216.json'):
        out[str(STATE/name)] = i.sha(STATE/name)
    out['/etc/gobadminton-slots/cursor-author.json'] = i.sha(Path('/etc/gobadminton-slots/cursor-author.json'))
    return out


def encoded_hash(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()


def activate_release(C,u,j,p,run_id):
    """Resume only recorded effects; never rewind progress after policy activation."""
    r.need(j['phase'] in ('installed-disabled','activating','active-canary'), 'invalid activation phase')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items()), 'installed code drift')
    if j['phase']=='installed-disabled':
        r.need(p['mode']=='disabled' and p['controller_sha']==j['controller'], 'not installed-disabled candidate')
        C.quiet()
        r.need(preserved(C,u)==j['preserved'], 'authoritative state changed before activation')
        proof=u.probe(run_id,j)
        j.update(phase='activating',activation_intent={'disabled_policy':copy.deepcopy(p),
            'active_policy':p | {'mode':'active'},'shadow':proof})
        r.atomic(JOURNAL,j)  # Intent precedes enabling dispatch.
    intent=j.get('activation_intent')
    r.need(isinstance(intent,dict) and intent['active_policy']==intent['disabled_policy'] | {'mode':'active'}
           and intent['disabled_policy']['mode']=='disabled'
           and intent['disabled_policy']['controller_sha']==j['controller'], 'invalid activation intent')
    if p==intent['disabled_policy']:
        r.need(j['phase']=='activating', 'completed activation policy changed')
        C.quiet()
        r.need(preserved(C,u)==j['preserved'], 'authoritative state changed before activation')
        r.atomic(r.POLICY,intent['active_policy'],mode=0o644)
    else:
        r.need(p==intent['active_policy'], 'foreign activation policy drift')
    if j['phase']!='active-canary':
        j.update(phase='active-canary',shadow=intent['shadow']);r.atomic(JOURNAL,j)
    r.publish_monitor(intent['active_policy'])
    return {'phase':'active-canary','shadow':intent['shadow'],'history_preserved':True}


def accept_canary(j,p):
    r.need(p['mode']=='active' and p['controller_sha']==j['controller'],'wrong active release')
    ops=r.journal('slot2')
    intent=j.get('qualification_intent')
    if intent is None:
        r.need(j['phase']=='active-canary' and not ops['pending'],'canary not terminal')
        state,_=r.checkpoint('slot2')
        r.need(state.get('active') is None,'slot2 must remain free for metadata qualification')
        r.free_lock(r.AUTONOMY/'slots/slot2/worker.lock')
        r.free_lock(r.AUTONOMY/'locks/slot2.lease')
        marker=r.read(MARKER,0);budget=r.read(BUDGET,0)
        r.need(marker['phase']=='canary' and encoded_hash(marker)==j['changes'][str(MARKER)]['after']
               and encoded_hash(budget)==j['changes'][str(BUDGET)]['after'],'qualification config drift')
        q=marker['qualification'];matches=[]
        for key,op in ops['operations'].items():
            b=op.get('binding',{});result=op.get('result',{})
            if b.get('stage')!='qa_qualification' or b.get('issue')!=29:continue
            receipt=result.get('native_receipt',{});qa=result.get('qa',{})
            r.need(b.get('slot')=='slot2' and b.get('head')==q['head'] and b.get('profile')=='agy'
                   and op.get('finished_at') and result.get('status')=='confirmed'
                   and result.get('qualification_passed') is True
                   and result.get('checkpoint_changed') is False and op.get('before')==op.get('after')
                   and qa.get('verdict')=='PASS' and qa.get('reviewed_sha')==q['head']
                   and receipt.get('source_sha')==q['head'] and receipt.get('base_sha')==q['base']
                   and receipt.get('qualification_task_sha256')==j['canary_task_sha256']
                   and receipt.get('qualification_passed') is True and receipt.get('charged_calls')==1
                   and receipt.get('effective_model')=='claude-sonnet-5-5-medium',
                   'actual exact successful Antigravity qualification required')
            matches.append((key,op))
        r.need(len(matches)==1,'exactly one actual canary operation required')
        key,op=matches[0]
        nextmarker=marker|{'phase':'ready','accepted_canary':{'operation':key,'run':op['run'],
                          'source_sha':q['head'],'task_sha256':j['canary_task_sha256']}}
        nextbudget=copy.deepcopy(budget)
        nextbudget['providers']['agy']['qa']='unlimited'
        nextbudget['slots']['slot2']['agy']['qa']='unlimited'
        intent={'operation':key,'operation_sha256':digest(op),'marker_before':marker,'marker_after':nextmarker,
                'budget_before':budget,'budget_after':nextbudget}
        j.update(phase='qualifying-ready',qualification_intent=intent);r.atomic(JOURNAL,j)
    r.need(j['phase'] in ('qualifying-ready','active-ready')
           and digest(ops['operations'].get(intent['operation']))==intent['operation_sha256'],
           'qualification evidence changed')
    for target,key in ((MARKER,'marker'),(BUDGET,'budget')):
        actual=r.read(target,0);old=intent[key+'_before'];new=intent[key+'_after']
        r.need(actual in (old,new),'foreign qualification metadata drift')
        if actual==old:
            r.need(j['phase']=='qualifying-ready','completed qualification metadata rewound')
            r.atomic(target,new,mode=0o644)
    if j['phase']!='active-ready':
        for target,key in ((MARKER,'marker'),(BUDGET,'budget')):
            j['changes'][str(target)]['after']=encoded_hash(intent[key+'_after'])
        j['phase']='active-ready';r.atomic(JOURNAL,j)
    r.publish_monitor(p)
    return {'phase':'active-ready','accepted_canary':intent['marker_after']['accepted_canary'],
            'history_preserved':True}


def reviewed_configuration(proof,budget,module_hashes):
    marker=proof['marker']
    r.need(marker.get('schema')=='GB_ANTIGRAVITY_QA_29_V1' and marker.get('phase')=='canary'
           and marker.get('executor_uid')==978 and marker.get('slot')=='slot2'
           and re.fullmatch('[a-f0-9]{64}',marker.get('canary_task_sha256','')),
           'invalid bounded canary marker')
    q=marker.get('qualification',{})
    r.need(set(q)=={'issue','base','head','work','task_sha256'} and q['issue']==29
           and all(re.fullmatch('[a-f0-9]{40}',q[k] or '') for k in ('base','head'))
           and q['work']=='/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary',
           'unreviewed qualification source or workspace')
    task={'schema':'GB_ANTIGRAVITY_QA_29_TASK_V1','issue':29,'role':'qa_qualification','slot':'slot2',
          'base':q['base'],'head':q['head'],'model':'claude-sonnet-5-5-medium','max_calls':1}
    r.need(q['task_sha256']==marker['canary_task_sha256']==digest(task),'qualification task drift')
    modules=marker.get('modules',{})
    r.need(set(modules)=={'native_antigravity.py','native_guard.py'}
           and all(module_hashes.get(name)==sha for name,sha in modules.items()),
           'qualification module pin mismatch')
    r.need(not any('agy' in x for x in [budget['providers'],*budget['slots'].values()]),
           'existing AGY budget; no reset authorized')
    nextbudget=copy.deepcopy(budget)
    nextbudget['providers']['agy']={'qa':1}
    nextbudget['slots']['slot2']['agy']={'qa':1}
    return marker,nextbudget


def execute(action, bundle, manifest, controller, stage_hash, dispatch_hash, run_id=None, proof_sha=None):
    r.need(os.geteuid() == 0, 'reviewed root integrator only')
    r.trusted_tree(bundle)
    if action=='accept':
        j=r.read(JOURNAL,0);p=r.read(r.POLICY,0)
        r.need((manifest,controller,stage_hash,dispatch_hash,proof_sha)==
               (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256'],j['proof_sha256']),
               'acceptance release identity changed')
        return accept_canary(j,p)
    C, u = helpers(bundle)
    p = r.read(r.POLICY,0)
    if action=='activate':
        j=r.read(JOURNAL,0)
        r.need((manifest,controller,stage_hash,dispatch_hash)==
            (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256']),
            'activation release identity changed')
        r.need(proof_sha==j['proof_sha256'],'activation qualification proof changed')
        return activate_release(C,u,j,p,run_id)
    C.quiet()  # Preactivation changes and rollback still require disabled/quiescent policy.
    if action=='rollback':
        j=r.read(JOURNAL,0)
        r.need(p['mode']=='disabled' and preserved(C,u)==j['preserved'],
               'authoritative state changed; never rewind it')
        r.need(p['controller_sha'] in (j['controller'],j['policy_before']['controller_sha']),
               'foreign controller change')
        r.need(j['phase'] in ('backing-up','applying','installed-disabled'), 'rollback after activation refused')
        for n,(name,v) in enumerate(sorted(j['changes'].items())):
            target = Path(name)
            r.need(i.sha(target) in (v['before'], v['after']), 'foreign target drift')
            if i.sha(target) != v['before']:
                if v['before'] is None:
                    target.unlink(missing_ok=True); C.sync_directory(target.parent)
                else:
                    source = BACKUP/str(n)
                    r.need(i.sha(source) == v['before'], 'backup incomplete or drifted')
                    put_managed(source,target)
        r.atomic(STATE/'backup.json', j['record_before'])
        r.atomic(r.POLICY, j['policy_before'] | {'mode':'disabled'}, mode=0o644)
        j['phase']='rolled-back-disabled'; r.atomic(JOURNAL,j)
        return {'phase':j['phase'], 'history_preserved':True}

    r.need(action in ('dry','apply'), 'unknown upgrade action')
    r.need(p['controller_sha'] == OLD and p['mode'] == 'disabled', 'wrong baseline/safe window')
    record = r.read(STATE/'backup.json', 0)
    r.need(all(i.sha(Path(k)) == v for k,v in record['after'].items()), 'baseline code drift')
    items = i.payload(bundle, manifest)
    changed = {k:v for k,v in items.items() if i.sha(k) != i.sha(v)}
    r.need(set(changed) == {INSTALL/n for n in ALLOWED}, 'unexpected runtime target changes')
    for source in items.values(): r.trusted_tree(source)
    r.need(re.fullmatch('[a-f0-9]{40}', controller or ''), 'immutable controller required')
    for name, sha in (('train-stage.yml',stage_hash),('train-dispatch.yml',dispatch_hash)):
        wf = bundle/'.github/workflows'/name
        r.need(i.sha(wf)==sha and wf.read_bytes().count(('ref: '+controller).encode())==2,
               'unreviewed workflow or checkout pin')

    proof_path=bundle/'scripts/chatops/ops/antigravity-qa-install-proof.json'
    r.trusted_tree(proof_path)
    r.need(re.fullmatch('[a-f0-9]{64}',proof_sha or '') and i.sha(proof_path)==proof_sha,
           'unreviewed qualification proof digest')
    proof=json.loads(proof_path.read_text())
    r.need(proof.get('schema')=='GB_AGY_INSTALL_PROOF_29_V1' and proof.get('reviewed') is True,
           'missing reviewed exact qualification proof')
    r.need(not MARKER.exists(),'existing AGY qualification; preserve and inspect')
    marker,nextbudget=reviewed_configuration(proof,r.read(BUDGET,0),
        {name:i.sha(bundle/'scripts/chatops/actions_train'/name) for name in ('native_antigravity.py','native_guard.py')})
    virtual={MARKER:marker,BUDGET:nextbudget}
    def encoded(value):return json.dumps(value,sort_keys=True).encode()
    changed.update(provisioning())
    changes = {str(k):{'before':i.sha(k),'after':i.sha(v)} for k,v in changed.items()}
    for target,value in virtual.items():
        changes[str(target)]={'before':i.sha(target),'after':hashlib.sha256(encoded(value)).hexdigest()}
    snapshot = preserved(C,u)
    if action == 'dry':
        return {'dry':True,'changes':changes,'canary_task_sha256':marker['canary_task_sha256'],'preserved_files':len(snapshot)}
    r.need(not JOURNAL.exists() and not BACKUP.exists(), 'prior installation exists; inspect/rollback')
    j = {'schema':'GB_ANTIGRAVITY_UPGRADE_29_V1','phase':'backing-up','installed_at':int(time.time()),
         'controller':controller,'stage_sha256':stage_hash,'dispatch_sha256':dispatch_hash,'changes':changes,'preserved':snapshot,
         'policy_before':p,'record_before':record,'canary_task_sha256':marker['canary_task_sha256'],
         'manifest':manifest,'proof_sha256':proof_sha}
    r.atomic(JOURNAL,j)  # Write-ahead before any backup or target write.
    BACKUP.mkdir(mode=0o700); C.sync_directory(BACKUP.parent)
    for n,(name,v) in enumerate(sorted(changes.items())):
        if v['before'] is not None: i.put(Path(name),BACKUP/str(n),0o600)
    C.sync_directory(BACKUP)
    j['phase']='applying'; r.atomic(JOURNAL,j)
    for target,source in changed.items(): put_managed(source,target)
    for target,value in virtual.items(): r.atomic(target,value,mode=0o644)
    r.need(all(i.sha(Path(k))==v['after'] for k,v in changes.items()), 'installed verification failed')
    r.need(preserved(C,u)==snapshot,'authoritative history changed')
    nextrecord=copy.deepcopy(record); nextrecord['manifest']=manifest
    for target,source in items.items(): nextrecord['after'][str(target)]=i.sha(source)
    r.atomic(STATE/'backup.json',nextrecord)
    nextpolicy=copy.deepcopy(p)
    nextpolicy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_hash)
    nextpolicy['recovery']['source_sha']=controller
    r.atomic(r.POLICY,nextpolicy,mode=0o644)
    j['phase']='installed-disabled';r.atomic(JOURNAL,j)  # Fresh process publishes; no cached imported pins.
    return {'phase':j['phase'],'canary_task_sha256':marker['canary_task_sha256'],'history_preserved':True}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('action',choices=('dry','apply','activate','rollback','accept'))
    ap.add_argument('--bundle',required=True,type=Path);ap.add_argument('--manifest',required=True)
    ap.add_argument('--controller',required=True);ap.add_argument('--stage-hash',required=True)
    ap.add_argument('--dispatch-hash',required=True);ap.add_argument('--run',type=int)
    ap.add_argument('--proof-sha256',required=True)
    a=ap.parse_args();lock=r.locked(STATE/'controller.lock')
    try: print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run,a.proof_sha256),sort_keys=True))
    finally: os.close(lock)


if __name__=='__main__': main()
