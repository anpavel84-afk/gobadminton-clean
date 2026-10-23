"""Closed Owner6362661117 Issue29/#218 upgrade; functions for the trusted bridge only.

No provider entrypoint, scheduler, credential provisioning, budget edits or general
OPS admission. Reconcile fac7 separately FIRST. All installation starts disabled.
"""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time

import receiver as r
import installer as i
from core import digest,loads
Q=None  # Fresh reviewed maintenance process loads only hash-verified source below.

STATE=r.STATE
INSTALL=Path('/usr/local/lib/gb-actions-train')
MARKER=Path('/etc/gobadminton-slots/antigravity-qa.json')
JOURNAL=STATE/'antigravity-addressed-upgrade.json'
BACKUP=STATE/'antigravity-addressed-backup'
LEDGER=STATE/'antigravity-29-addressed-ledger.json'
ALLOWED={INSTALL/n for n in ('native_antigravity.py','antigravity_qa_recovery.py','core.py',
    'receiver.py','stage.py','failure_diagnosis.py','cost_policy.py','recovery.py',
    'recovery_admission.py','context_policy.py','live/autonomous_issues.py','monitor.py',
    'monitor_extension.js')}
ALLOWED.add(Path('/usr/local/lib/gb-ops-monitor/web/app.js'))
KEYS={'schema','owner_comment','baseline_controller','baseline_record_sha256',
      'controller','release_revision','manifest_sha256','stage_workflow_sha256',
      'dispatch_workflow_sha256','team_helper_sha256','changes','history','grant'}


def encoded(v):return json.dumps(v,sort_keys=True).encode()


def load_reviewed(bundle,proof):
    """Bootstrap from b51 without assuming the corrected adapter is installed.

    Imports affect only this fresh maintenance process, never the live receiver.
    External proof hash must already have been verified by execute().
    """
    import sys
    global Q
    r.need(type(proof) is dict and set(proof)==KEYS
        and proof.get('schema')=='GB_AGY_29_ADDRESSED_UPGRADE_V1'
        and type(proof.get('owner_comment')) is int and proof['owner_comment']==6362661117
        and proof.get('baseline_controller')=='b51e7c1c18103247606d35a414c82b04f5dd53ee'
        and type(proof.get('manifest_sha256')) is str
        and re.fullmatch('[a-f0-9]{64}',proof['manifest_sha256']), 'closed addressed proof required')
    items=i.payload(bundle,proof['manifest_sha256'])
    for name in ('antigravity_qa_recovery','native_antigravity'):
        source=items[INSTALL/(name+'.py')];r.trusted_tree(source)
        spec=importlib.util.spec_from_file_location(name,source)
        module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module)
        if name=='antigravity_qa_recovery':Q=module


def validate(proof):
    r.need(type(proof) is dict and set(proof)==KEYS
        and proof['schema']=='GB_AGY_29_ADDRESSED_UPGRADE_V1'
        and type(proof['owner_comment']) is int and proof['owner_comment']==6362661117
        and proof['baseline_controller']==Q.INSTALLED_BASELINE,'closed addressed proof required')
    for key in ('controller','release_revision'):
        r.need(type(proof[key]) is str and re.fullmatch('[a-f0-9]{40}',proof[key]),'exact reviewed revision required')
    r.need(proof['controller']!=proof['release_revision'] and proof['controller']!=Q.INSTALLED_BASELINE,
        'separate reviewed C and release R required')
    for key in ('baseline_record_sha256','manifest_sha256','stage_workflow_sha256',
                'dispatch_workflow_sha256','team_helper_sha256'):
        r.need(type(proof[key]) is str and re.fullmatch('[a-f0-9]{64}',proof[key]),'reviewed hash required')
    Q.validate_addressed_grant(proof['grant'])
    r.need(proof['grant']['controller_revision']==proof['controller'],'grant controller mismatch')
    changes=proof['changes']
    r.need(type(changes) is dict and changes,'exact reviewed targets required')
    for name,row in changes.items():
        r.need(type(name) is str and Path(name) in ALLOWED|{MARKER,LEDGER,STATE/'slot2.json'} and type(row) is dict
            and set(row)=={'before','after'}
            and (row['before'] is None or type(row['before']) is str and re.fullmatch('[a-f0-9]{64}',row['before']))
            and type(row['after']) is str and re.fullmatch('[a-f0-9]{64}',row['after']), 'forged target delta')
    history=proof['history']
    required={'slot2.json',Q.LINEAGE,Q.GRANT_LEDGER,'antigravity-qa-one-shot-'+Q.THIRD_TASK+'.json'}
    r.need(type(history) is dict and required<=set(history),'exact preserved history pins required')
    for name,sha in history.items():
        r.need(type(name) is str and '/' not in name and name.endswith('.json')
            and type(sha) is str and re.fullmatch('[a-f0-9]{64}',sha),'invalid history pin')
    return proof


def team(bundle,proof):
    source=bundle/'scripts/chatops/ops/team_runtime_upgrade.py'
    r.trusted_tree(source);r.need(i.sha(source)==proof['team_helper_sha256'],'reviewed team helper drift')
    spec=importlib.util.spec_from_file_location('_addressed_reviewed_team',source)
    t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
    return t


def descriptor(g):
    from native_antigravity import QUALIFICATION_WORK,qualification_task
    task=qualification_task(g['base'],g['head'],adapter_revision=g['controller_revision'],qualification_grant=g)
    return dict(issue=29,base=g['base'],head=g['head'],work=str(QUALIFICATION_WORK),
        adapter_revision=g['controller_revision'],qualification_grant=g,task_sha256=digest(task))


def history(proof):
    for name,sha in proof['history'].items():
        r.read(STATE/name,0);r.need(i.sha(STATE/name)==sha,'reviewed history drift')
    Q.addressed_history(r,r.journal('slot2'))
    r.need(i.sha(r.BUDGET)==Q.BUDGET_RAW,'global caps must remain untouched')


def preserved(C,u):
    result=C.preserved(u)
    for p in STATE.rglob('*'):
        if p.is_file() and p not in (JOURNAL,STATE/'backup.json',STATE/'planning.json',LEDGER) \
                and BACKUP not in p.parents and not p.name.startswith('antigravity-addressed-admit-'):
            r.need(not p.is_symlink(),'history link rejected');result[str(p)]=i.sha(p)
    for p in (MARKER,LEDGER):result.pop(str(p),None)
    return result


def configuration(proof,items):
    g=proof['grant'];q=descriptor(g)
    r.need(g['role']=='technical_pm_product_analyst','first addressed call must analyze exact INERT230 input')
    old=r.read(MARKER,0)
    r.need(old.get('phase')=='canary' and old.get('adapter_revision')==Q.INSTALLED_BASELINE
        and old.get('canary_task_sha256')==Q.THIRD_TASK,'exact b51 marker required')
    for name,sha in old.get('modules',{}).items():
        r.need(name in ('native_antigravity.py','native_guard.py') and i.sha(INSTALL/name)==sha,'baseline native pin drift')
    r.need(set(old.get('modules',{}))=={'native_antigravity.py','native_guard.py'},'baseline native pins missing')
    marker=copy.deepcopy(old)
    marker.update(phase='canary',adapter_revision=proof['controller'],qualification=q,
        canary_task_sha256=q['task_sha256'],modules={name:i.sha(items[INSTALL/name])
            for name in ('native_antigravity.py','native_guard.py')})
    ledger=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,ceiling=4,used_calls=0,
                grants={digest(g):dict(grant=g,operation=None)})
    r.need(not LEDGER.exists(),'addressed lineage already exists; never reset')
    return {MARKER:marker,LEDGER:Q.addressed_ledger(ledger)}


def plan(bundle,proof,T,C,u):
    C.quiet();p=r.read(r.POLICY,0);record=r.read(STATE/'backup.json',0)
    r.need(p['mode']=='disabled' and p['controller_sha']==Q.INSTALLED_BASELINE
        and i.sha(STATE/'backup.json')==proof['baseline_record_sha256'],'exact disabled b51 baseline required')
    history(proof)
    r.need(all(i.sha(Path(k))==sha for k,sha in record['after'].items()),'installed baseline drift')
    receipt=r.read(STATE/Q.ADDRESSED_RECONCILIATION,0)
    r.need(receipt.get('phase')=='complete' and receipt.get('third_operation_sha256')==Q.THIRD_DIGEST
        and r.journal('slot2')['pending'] is None,'separate fac7 reconciliation required first')
    items=i.payload(bundle,proof['manifest_sha256'])
    for source in items.values():r.trusted_tree(source)
    T.verify_release(bundle,proof)
    task=loads((bundle/Q.ANALYSIS_INPUT).read_bytes());T.protocol_probe(bundle,task)
    changed={target:source for target,source in items.items() if i.sha(target)!=i.sha(source)}
    r.need(changed and set(changed)<=ALLOWED,'addressed payload outside reviewed targets')
    Q.addressed_input(Path(descriptor(proof['grant'])['work']),proof['grant'])
    virtual=configuration(proof,items)
    changes={str(t):dict(before=i.sha(t),after=i.sha(s)) for t,s in changed.items()}
    for target,value in virtual.items():changes[str(target)]=dict(before=i.sha(target),after=hashlib.sha256(encoded(value)).hexdigest())
    r.need(changes==proof['changes'],'exact reviewed deltas differ')
    return p,record,items,changed,virtual,changes,preserved(C,u)


def admit(proof,j,C,u):
    """One exact per-call grant and fresh scheduling generation, max4 total.

    The generation advance permits a different role on the same head without
    aliasing the previous wire operation. Original operation/results stay intact.
    """
    C.quiet();p=r.read(r.POLICY,0)
    r.need(p['mode']=='disabled' and p['controller_sha']==j['controller']==proof['controller'],
        'disable exact installed controller before addressed admission')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items() if Path(k) not in (MARKER,LEDGER)),
        'installed source drift')
    r.need(not r.journal('slot2')['pending'],'unknown outcomes require their own exact reconciliation; no replay')
    g=proof['grant'];key=digest(g);q=descriptor(g)
    Q.addressed_input(Path(q['work']),g)
    path=STATE/('antigravity-addressed-admit-'+key+'.json')
    if path.exists():
        intent=r.read(path,0)
        r.need(intent['grant']==g and intent['proof_sha256']==digest(proof)
            and intent['phase'] in ('intent','complete'),'foreign per-call admission intent')
        if intent['phase']=='complete':return dict(phase='already-admitted',grant_sha256=key)
    else:
        history(proof)
        current=Q.addressed_ledger(r.read(LEDGER,0));oldmarker=r.read(MARKER,0)
        r.need(key not in current['grants'] and len(current['grants'])<4,'grant duplicate or max4 exhausted')
        new=copy.deepcopy(current);new['grants'][key]=dict(grant=g,operation=None)
        newmarker=dict(oldmarker,phase='canary',qualification=q,canary_task_sha256=q['task_sha256'])
        slot=r.journal('slot2');r.need(type(slot['generation']) is int,'invalid scheduling generation')
        nextslot=copy.deepcopy(slot);nextslot['generation']+=1
        virtual={MARKER:newmarker,LEDGER:Q.addressed_ledger(new),STATE/'slot2.json':nextslot}
        changes={str(t):dict(before=i.sha(t),after=hashlib.sha256(encoded(v)).hexdigest()) for t,v in virtual.items()}
        r.need(proof['changes']==changes,'exact per-call metadata/scheduling review required')
        before=preserved(C,u);after=dict(before)
        after[str(STATE/'slot2.json')]=changes[str(STATE/'slot2.json')]['after']
        intent=dict(phase='intent',grant=g,changes=changes,virtual={str(t):v for t,v in virtual.items()},
                    preserved_before=before,preserved=after,proof_sha256=digest(proof))
        r.atomic(path,intent)
    now=preserved(C,u)
    r.need({k:v for k,v in now.items() if k!=str(STATE/'slot2.json')}==
        {k:v for k,v in intent['preserved'].items() if k!=str(STATE/'slot2.json')},'history changed during admission')
    for name,row in intent['changes'].items():
        r.need(i.sha(Path(name)) in (row['before'],row['after']),'admission target drift')
    for name,value in intent['virtual'].items():
        target=Path(name)
        if i.sha(target)!=intent['changes'][name]['after']:
            r.atomic(target,value,mode=0o644 if target==MARKER else 0o600)
    r.need(preserved(C,u)==intent['preserved'],'admission history mismatch')
    r.atomic(path,dict(intent,phase='complete'))
    return dict(phase='admitted-disabled',grant_sha256=key,ceiling=4)


def activate(proof,proof_hash,j,p,C,u,run_id):
    pins={k:v['after'] for k,v in j['changes'].items() if Path(k) not in (MARKER,LEDGER)}
    intent=j.get('activation_intent')
    same=bool(intent and intent['proof_sha256']==proof_hash)
    if same and j['phase'] in ('activating','active-canary'):
        r.need(all(i.sha(Path(k))==v for k,v in intent['pins'].items()),'activation target drift')
        if j['phase']=='active-canary':
            r.need(p==intent['active'],'completed activation policy drift')
            return dict(phase='active-canary',shadow=intent['shadow'],qa_ready=False)
    else:
        C.quiet()
        r.need(p['mode']=='disabled' and p['controller_sha']==proof['controller']
            and j['phase'] in ('installed-disabled','active-canary'),'disabled addressed boundary required')
        if j['proof_sha256']==proof_hash:
            snapshot=j['preserved'];pins.update({k:v['after'] for k,v in j['changes'].items() if Path(k) in (MARKER,LEDGER)})
        else:
            entry=r.read(STATE/('antigravity-addressed-admit-'+digest(proof['grant'])+'.json'),0)
            r.need(entry['phase']=='complete' and entry['proof_sha256']==digest(proof),'exact admitted grant proof required')
            snapshot=entry['preserved'];pins.update({k:v['after'] for k,v in entry['changes'].items()})
        r.need(all(i.sha(Path(k))==v for k,v in pins.items()) and preserved(C,u)==snapshot,'disabled release/history drift')
        shadow=u.probe(run_id,dict(j,dispatch_sha256=proof['dispatch_workflow_sha256']))
        intent=dict(proof_sha256=proof_hash,disabled=p,active=p|{'mode':'active'},pins=pins,
                    preserved=snapshot,shadow=shadow)
        j.update(phase='activating',activation_intent=intent);r.atomic(JOURNAL,j)
    r.need(p in (intent['disabled'],intent['active']),'activation policy drift')
    if p==intent['disabled']:
        C.quiet();r.need(preserved(C,u)==intent['preserved'],'history changed before activation')
        r.atomic(r.POLICY,intent['active'],mode=0o644)
    j['phase']='active-canary';r.atomic(JOURNAL,j)
    return dict(phase=j['phase'],shadow=intent['shadow'],qa_ready=False)


def accept(proof,j,p,C,u):
    """Only a fresh independent QA receipt can mark ready; never edits any cap."""
    C.quiet()
    r.need(p['mode']=='disabled' and p['controller_sha']==j['controller'],'disable before QA acceptance')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items() if Path(k) not in (MARKER,LEDGER)),
        'installed source drift before QA acceptance')
    marker=r.read(MARKER,0);q=descriptor(proof['grant'])
    r.need(marker['qualification']==q and Q.addressed(q)
        and proof['grant']['role']=='independent_qa','analysis cannot qualify QA or release')
    journal=r.journal('slot2');r.need(not journal['pending'],'unreconciled QA outcome')
    matches=[(key,op) for key,op in journal['operations'].items() if Q.acceptance_match(op,q)]
    r.need(len(matches)==1,'fresh exact independent QA success required')
    key,op=matches[0]
    conversation=op['result']['native_receipt'].get('conversation_sha256')
    r.need(type(conversation) is str and re.fullmatch('[a-f0-9]{64}',conversation)
        and all(otherkey==key or other.get('result',{}).get('native_receipt',{}).get('conversation_sha256')!=conversation
            for otherkey,other in journal['operations'].items()), 'QA must use a fresh independent native session')
    nextmarker=dict(marker,phase='ready',accepted_canary=dict(operation=key,run=op['run'],
        source_sha=q['head'],task_sha256=q['task_sha256']))
    path=STATE/('antigravity-addressed-admit-accept-'+digest(proof['grant'])+'.json')
    intent=dict(phase='intent',operation=key,operation_sha256=digest(op),marker_before=marker,marker_after=nextmarker)
    if path.exists():
        old=r.read(path,0)
        r.need(old['operation']==key and old['operation_sha256']==digest(op)
            and marker in (old['marker_before'],old['marker_after']),'acceptance history drift')
        if old['phase']=='complete':return dict(phase='qa-ready-disabled',global_caps_unchanged=True)
        intent=old
    else:r.atomic(path,intent)
    r.atomic(MARKER,intent['marker_after'],mode=0o644)
    r.atomic(path,dict(intent,phase='complete'))
    return dict(phase='qa-ready-disabled',global_caps_unchanged=True,product_activation=False)


def execute(action,bundle,proof_path,proof_sha256,*,run_id=None):
    r.need(os.geteuid()==0,'reviewed trusted root bridge required')
    bundle=Path(bundle);proof_path=Path(proof_path)
    r.trusted_tree(bundle);r.trusted_tree(proof_path)
    r.need(type(proof_sha256) is str and re.fullmatch('[a-f0-9]{64}',proof_sha256)
        and i.sha(proof_path)==proof_sha256,'independently reviewed proof hash required')
    proof=loads(proof_path.read_bytes());load_reviewed(bundle,proof);validate(proof)
    T=team(bundle,proof);C,u=T.helpers(bundle)
    lock=r.locked(STATE/'controller.lock')
    try:
        if action=='reconcile':
            p=r.read(r.POLICY,0)
            r.need(p['mode']=='disabled' and p['controller_sha']==Q.INSTALLED_BASELINE,'exact b51 scheduling boundary required')
            history(proof)
            return Q.reconcile_addressed(r)  # Not installation; no op/result rewrite.
        if action in ('dry','apply'):
            p,record,items,changed,virtual,changes,snapshot=plan(bundle,proof,T,C,u)
            if action=='dry':return dict(dry=True,changes=changes,provider_calls=0)
            r.need(not JOURNAL.exists() and not BACKUP.exists(),'prior upgrade; inspect, never replay')
            nextpolicy=copy.deepcopy(p);nextpolicy.update(mode='disabled',controller_sha=proof['controller'],
                stage_workflow_sha256=proof['stage_workflow_sha256'])
            nextpolicy['recovery']['source_sha']=proof['controller']
            j=dict(phase='backing-up',installed_at=int(time.time()),proof_sha256=proof_sha256,controller=proof['controller'],
                changes=changes,preserved=snapshot,policy_before=p,policy_after=nextpolicy,record_before=record)
            r.atomic(JOURNAL,j)
            BACKUP.mkdir(mode=0o700);C.sync_directory(BACKUP.parent)
            for n,(name,row) in enumerate(sorted(changes.items())):
                if row['before'] is not None:i.put(Path(name),BACKUP/str(n),0o600)
            C.sync_directory(BACKUP);j['phase']='applying';r.atomic(JOURNAL,j)
            r.need(all(i.sha(Path(k))==v['before'] for k,v in changes.items()),'targets changed during backup')
            for target,source in changed.items():i.put(source,target,0o644)
            for target,value in virtual.items():r.atomic(target,value,mode=0o600 if target==LEDGER else 0o644)
            r.need(all(i.sha(Path(k))==v['after'] for k,v in changes.items()),'installed hash mismatch')
            r.need(preserved(C,u)==snapshot,'history changed during install')
            newrecord=copy.deepcopy(record);newrecord['manifest']=proof['manifest_sha256']
            for target,source in items.items():newrecord['after'][str(target)]=i.sha(source)
            r.atomic(STATE/'backup.json',newrecord);r.atomic(r.POLICY,nextpolicy,mode=0o644)
            j['phase']='installed-disabled';r.atomic(JOURNAL,j)
            return dict(phase=j['phase'],provider_calls=0)
        j=r.read(JOURNAL,0);p=r.read(r.POLICY,0)
        r.need(j['controller']==proof['controller'],'addressed controller changed')
        if action=='admit':return admit(proof,j,C,u)
        if action=='rollback':
            r.need(j['proof_sha256']==proof_sha256,'original installation proof required')
            C.quiet()
            r.need(j['phase'] in ('backing-up','applying','installed-disabled') and p['mode']=='disabled'
                and p['controller_sha'] in (Q.INSTALLED_BASELINE,j['controller'])
                and preserved(C,u)==j['preserved'],'rollback boundary changed; never rewind live state')
            for n,(name,row) in enumerate(sorted(j['changes'].items())):
                target=Path(name);actual=i.sha(target)
                r.need(actual in (row['before'],row['after']),'foreign target drift')
                if actual==row['before']:continue
                if row['before'] is None:target.unlink(missing_ok=True);C.sync_directory(target.parent)
                else:
                    source=BACKUP/str(n);r.need(i.sha(source)==row['before'],'backup drift')
                    i.put(source,target,0o600 if target==LEDGER else 0o644)
            r.atomic(STATE/'backup.json',j['record_before'])
            r.atomic(r.POLICY,j['policy_before']|{'mode':'disabled'},mode=0o644)
            j['phase']='rolled-back-disabled';r.atomic(JOURNAL,j)
            return dict(phase=j['phase'])
        if action=='activate':
            return activate(proof,proof_sha256,j,p,C,u,run_id)
        if action=='accept':
            return accept(proof,j,p,C,u)
        r.need(False,'unsupported addressed effect')
    finally:os.close(lock)
