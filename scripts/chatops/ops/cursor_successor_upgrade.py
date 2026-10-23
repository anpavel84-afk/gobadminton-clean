#!/usr/bin/python3
"""Reviewed #211 native author upgrade using existing quiescence/shadow/rollback."""
import argparse
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
import receiver as r
import installer as i
from core import digest
STATE = r.STATE
JOURNAL = STATE/'cursor-successor-211.json'
BACKUP = STATE/'cursor-successor-211-backup'
INSTALL = Path('/usr/local/lib/gb-actions-train')
MARKER = Path('/etc/gobadminton-slots/cursor-author.json')
BUDGET = Path('/etc/gobadminton-slots/budgets.json')
OLD = '752f6c5a85bc7c14ba964c163baacd511b6d7d5a'
ALLOWED = {'stage.py'}
HELPERS = {'context_stability_upgrade.py':'26f9032e6a47e478f45666be9a73004d6b415e85358908e02e9b495316dc408f',
           'cost_policy_upgrade.py':'781c89f8fac0b234a5aefc81dd10c6df10b91adc080d703bd7fb2d458a7e7094'}


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
    out[str(BUDGET)] = i.sha(BUDGET)
    out[str(STATE/'cursor-author-211.json')] = i.sha(STATE/'cursor-author-211.json')
    for name in ('context-stability-216.json',):
        p = STATE/name; out[str(p)] = i.sha(p)
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


def complete_qualification(j,p,marker):
    """Replay only the exact, durably validated qualification intent."""
    intent=j.get('qualification_intent')
    r.need(j['phase'] in ('qualifying-ready','active-ready') and isinstance(intent,dict)
           and intent['policy']==p and intent['controller']==j['controller']
           and intent['task_sha256']==j['canary_task_sha256']
           and intent['successor']==j['successor'], 'qualification intent drift')
    r.need(encoded_hash(intent['old_marker'])==intent['old_hash']
           and encoded_hash(intent['next_marker'])==intent['next_hash']
           and intent['next_marker']==intent['old_marker'] | {'phase':'ready',
               'accepted_canary':intent['proof'],'qualified_at':intent['qualified_at']},
           'qualification marker intent changed')
    for name,sha in intent['old_marker']['modules'].items():
        r.need(i.sha(INSTALL/name)==sha,'qualified adapter drift')
    ops=r.journal(intent['proof']['slot'])['operations']
    r.need(all(k in ops and digest(ops[k])==v for k,v in intent['operations'].items()),
           'qualification operation evidence changed')
    actual=encoded_hash(marker)
    r.need(actual in (intent['old_hash'],intent['next_hash']), 'foreign qualification marker drift')
    if actual==intent['old_hash']:
        r.need(j['phase']=='qualifying-ready', 'completed qualification marker changed')
        r.atomic(MARKER,intent['next_marker'],mode=0o644)
    if j['phase']!='active-ready':
        j['changes'][str(MARKER)]['after']=intent['next_hash']
        j['phase']='active-ready';r.atomic(JOURNAL,j)
    r.publish_monitor(p)
    return {'phase':'active-ready','accepted_canary':intent['proof']}


def accept_canary():
    # Promotion is metadata-only and occurs after existing exact QA/CI/DEV gates.
    j = r.read(JOURNAL,0); p = r.read(r.POLICY,0); marker = r.read(MARKER,0)
    if j['phase'] in ('qualifying-ready','active-ready'):
        return complete_qualification(j,p,marker)
    r.need(j['phase']=='active-canary' and p['mode']=='active' and p['controller_sha']==j['controller']
           and marker['phase']=='canary' and marker['canary_task_sha256']==j['canary_task_sha256']
           and marker.get('successor')==j['successor'],
           'canary acceptance identity')
    matches=[]
    for slot in ('slot1','slot2'):
        state,_=r.checkpoint(slot); active=state.get('active'); ops=r.journal(slot)
        if not active or active.get('issue')!=225 or active.get('phase')!='done': continue
        r.need(digest(active['task'])==j['canary_task_sha256'] and active['attempt']==1
               and active['qa']['verdict']=='PASS' and active['qa']['reviewed_sha']==active['head']
               and active['ci']['sha']==active['head'] and active['run']['sha']==active['head']
               and active['live']['gitSha']==active['head']
               and active['server']['accepted']['status']=='ACCEPTED'
               and active['server']['accepted']['source_sha']==active['head'], 'incomplete canary lifecycle')
        stages={}; operation_hashes={}
        for stage in ('author','qa','dev'):
            found=[v for v in ops['operations'].values() if v['binding']['issue']==225
                   and v['binding']['stage']==stage and v.get('task_hash')==j['canary_task_sha256']
                   and v.get('finished_at') and v.get('result',{}).get('status')=='confirmed']
            r.need(len(found)==1,'ambiguous or incomplete canary stage')
            stages[stage]=found[0]
            keys=[k for k,v in ops['operations'].items() if v is found[0]]
            r.need(len(keys)==1,'ambiguous operation identity')
            operation_hashes[keys[0]]=digest(found[0])
        author=stages['author']['result']['routing']; qa=stages['qa']['result']['routing']
        r.need(author['provider']=='cursor' and author['effective_model']=='Auto'
               and author['usage']['charged_calls']==1
               and author['native_receipt']['phase']=='imported'
               and qa['provider']=='codex' and qa['usage']['charged_calls']==1
               and stages['dev']['after']==digest(state),'canary executor/confirmation mismatch')
        for name,sha in marker['modules'].items():
            r.need(i.sha(INSTALL/name)==sha,'qualified adapter drift')
        matches.append({'slot':slot,'head':active['head'],'release_id':active['release_id'],
                        'ci':active['ci']['id'],'dev_run':active['run']['id'],
                        'author_run':stages['author']['run'],'qa_run':stages['qa']['run']})
        acceptance_operations=operation_hashes
    r.need(len(matches)==1,'one actual completed Cursor canary required')
    proof=matches[0]
    qualified_at=int(time.time())
    nextmarker=marker | {'phase':'ready','accepted_canary':proof,'qualified_at':qualified_at}
    intent={'policy':p,'controller':j['controller'],'task_sha256':j['canary_task_sha256'],
        'successor':j['successor'],'proof':proof,'operations':acceptance_operations,
        'old_marker':marker,'old_hash':encoded_hash(marker),'next_marker':nextmarker,
        'next_hash':encoded_hash(nextmarker),'qualified_at':qualified_at}
    j.update(phase='qualifying-ready',accepted_canary=proof,qualification_intent=intent)
    r.atomic(JOURNAL,j)  # Complete deterministic intent before marker effects.
    return complete_qualification(j,p,marker)


def execute(action, bundle, manifest, controller, stage_hash, dispatch_hash, run_id=None):
    r.need(os.geteuid() == 0, 'reviewed root integrator only')
    r.trusted_tree(bundle)
    if action == 'accept':
        j=r.read(JOURNAL,0)
        r.need((manifest,controller,stage_hash,dispatch_hash)==
            (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256']),
            'unreviewed acceptance helper bundle')
        return accept_canary()
    C, u = helpers(bundle)
    p = r.read(r.POLICY,0)
    if action=='activate':
        j=r.read(JOURNAL,0)
        r.need((manifest,controller,stage_hash,dispatch_hash)==
            (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256']),
            'activation release identity changed')
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
                    i.put(source, target, 0o644)
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

    task_path = bundle/'scripts/chatops/ops/cursor-author-successor-task.json'
    r.trusted_tree(task_path)
    task = json.loads(task_path.read_text())
    r.need(digest(task)=='4570522ac1c4a3685ba253a921561d1bb866c863878b3e084c6063a13efe3005', 'unreviewed successor task')
    oldmarker=r.read(MARKER,0)
    r.need(oldmarker.get('phase')=='canary'
           and oldmarker.get('canary_task_sha256')=='d9722d7f8cb76fd58a774748a96de255d0dc53d98c710e676030d89ebfe4124a'
           and not oldmarker.get('successor'), 'original canary binding drift')
    archive=r.read(Path('/var/lib/gobadminton-autonomy/slots/slot2/actions-deferred.json'),978)
    matches=[e for e in archive['entries'] if e.get('issue')==211]
    r.need(len(matches)==1 and digest(matches[0])=='97b0713cf85f8a97f1c84e620692c6090d1017c338b9857ca17dbccc7f756a88',
           'original deferral changed')
    diagnosis=STATE/'manual-astra-211/r2-result.json'
    r.need(i.sha(diagnosis)=='cf277ca0e02f12e989eee02c68d5e6e145f49f541e85c267dcd8a65b3b15548a',
           'completed manual diagnosis changed')
    successor=dict(issue=225,parent=211,slot='slot2',task_sha256=digest(task),
        archive_sha256=digest(matches[0]),head=matches[0]['snapshot']['head'],
        base=matches[0]['snapshot']['base'],diagnosis_sha256=i.sha(diagnosis))
    marker=oldmarker | {'canary_task_sha256':digest(task),'successor':successor,
        'original_canary_task_sha256':oldmarker['canary_task_sha256']}
    virtual = {MARKER:marker}
    # Same atomic JSON encoding as receiver.atomic.
    def encoded(value): return json.dumps(value, sort_keys=True).encode()
    changes = {str(k):{'before':i.sha(k),'after':i.sha(v)} for k,v in changed.items()}
    for target,value in virtual.items():
        changes[str(target)]={'before':i.sha(target),'after':hashlib.sha256(encoded(value)).hexdigest()}
    snapshot = preserved(C,u)
    if action == 'dry':
        return {'dry':True,'changes':changes,'canary_task_sha256':digest(task),'preserved_files':len(snapshot)}
    r.need(not JOURNAL.exists() and not BACKUP.exists(), 'prior installation exists; inspect/rollback')
    j = {'schema':'GB_CURSOR_UPGRADE_211_V1','phase':'backing-up','installed_at':int(time.time()),
         'controller':controller,'stage_sha256':stage_hash,'dispatch_sha256':dispatch_hash,'changes':changes,'preserved':snapshot,
         'policy_before':p,'record_before':record,'canary_task_sha256':digest(task),
         'manifest':manifest,'successor':successor}
    r.atomic(JOURNAL,j)  # Write-ahead before any backup or target write.
    BACKUP.mkdir(mode=0o700); C.sync_directory(BACKUP.parent)
    for n,(name,v) in enumerate(sorted(changes.items())):
        if v['before'] is not None: i.put(Path(name),BACKUP/str(n),0o600)
    C.sync_directory(BACKUP)
    j['phase']='applying'; r.atomic(JOURNAL,j)
    for target,source in changed.items(): i.put(source,target,0o644)
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
    return {'phase':j['phase'],'canary_task_sha256':digest(task),'history_preserved':True}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('action',choices=('dry','apply','activate','rollback','accept'))
    ap.add_argument('--bundle',required=True,type=Path);ap.add_argument('--manifest',required=True)
    ap.add_argument('--controller',required=True);ap.add_argument('--stage-hash',required=True)
    ap.add_argument('--dispatch-hash',required=True);ap.add_argument('--run',type=int)
    a=ap.parse_args();lock=r.locked(STATE/'controller.lock')
    try: print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run),sort_keys=True))
    finally: os.close(lock)


if __name__=='__main__': main()
