"""Exact Issue29 qualification successor only; no product/general UNKNOWN recovery."""
import copy
import os
from pathlib import Path
from core import digest, need, Refused

PARENT_OPERATION='f15cdee06ed9368ada442071a113c29cf1fa1a0428f98e421a224603fcbe3e38'
PARENT_TASK='de7417b4b82b0922c591814ec30f5bd6880cdc635e2bc6894e84ee534a7bf142'
PARENT_RUN=39898216289
PARENT_PROCESS=dict(pid=3200388,start='38205054',boot='447e18ce-024d-4230-b88f-bd8ca81e2a9e')
PARENT_DIGEST='e0a4f68e526eb320cfb81e2e4bccd90fd7e5a869cb1ff92d5abd8697465011fb'
PARENT_RESERVATION_DIGEST='75bf5894ff5bf6e09fa097a9542aa7d28c3a0763dc00de053c6b5c4474e6015b'
CHECKPOINT='6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb'
GENERATION=85
RECONCILIATION='antigravity-29-qualification-reconcile.json'
LINEAGE='antigravity-qa-lineage-29.json'
FIXED='antigravity-qa-qualification.json'


def successor(q):
    return q.get('parent_task_sha256') == PARENT_TASK and q.get('parent_operation') == PARENT_OPERATION


def reservation_path(state,q):
    if grant(q):return Path(state)/('antigravity-qa-one-shot-'+q['task_sha256']+'.json')
    if successor(q):return Path(state)/('antigravity-qa-qualification-'+q['task_sha256']+'.json')
    return Path(state)/FIXED


def lineage_ready(r,q):
    need(successor(q),'not exact Issue29 successor')
    value=r.read(r.STATE/LINEAGE,0)
    need(value.get('schema')=='GB_AGY_29_LINEAGE_V1' and value.get('ceiling')==2
         and value.get('used_calls')==1 and value.get('parent_task')==PARENT_TASK
         and value.get('allowed_successor')==q['task_sha256'],'qualification lineage spent or not approved')
    reconciliation=r.read(r.STATE/RECONCILIATION,0)
    need(reconciliation.get('phase')=='complete' and reconciliation.get('successor_task')==q['task_sha256']
         and reconciliation.get('parent_operation_sha256')==PARENT_DIGEST,'exact qualification reconciliation required')
    return value


def reserve_lineage(r,q,key):
    value=lineage_ready(r,q)
    value=dict(value,used_calls=2,reserved_operation=key)
    r.atomic(r.STATE/LINEAGE,value)  # Before per-task reservation/fork. Never refunded after crash.
    return value


def original_proof(r,j):
    op=j.get('operations',{}).get(PARENT_OPERATION)
    need(digest(op)==PARENT_DIGEST and op.get('task_hash')==PARENT_TASK
         and op.get('run')==PARENT_RUN and op.get('run_attempt')==1
         and op.get('process')==PARENT_PROCESS and op.get('before')==op.get('after')==CHECKPOINT
         and op.get('result',{}).get('status')=='unknown','original qualification evidence changed')
    need(digest(r.read(r.STATE/FIXED,0))==PARENT_RESERVATION_DIGEST,'original reservation changed')


def executor_quiet(proc=Path('/proc')):
    """Exact executor UID process metadata only; no argv/environment/credential reads."""
    for entry in proc.iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.stat().st_uid != 978:continue
            state=(entry/'stat').read_text().rsplit(')',1)[1].split()[0]
        except FileNotFoundError:continue
        except (OSError,IndexError):raise Refused('executor process identity unknown') from None
        need(state in ('Z','X'),'qualification executor still has a live process')


def reconcile_parent(r,q):
    """Root operator calls under the existing controller lock; one exact pending only.

    Durable intent precedes lineage and journal writes. Re-entry finishes only the
    same transaction; old op/result and fixed reservation are never written.
    """
    need(os.geteuid()==0 and successor(q),'root exact Issue29 reconciliation only')
    from native_antigravity import qualification_descriptor
    marker=r.read(Path('/etc/gobadminton-slots/antigravity-qa.json'),0)
    need(qualification_descriptor(marker)==q and marker.get('phase')=='canary','reviewed successor marker required')
    lock=r.locked(r.STATE/'controller.lock')
    try:
        j=r.journal('slot2');original_proof(r,j)
        path=r.STATE/RECONCILIATION
        receipt=r.read(path,0) if path.exists() else None
        if receipt:
            need(receipt.get('successor_task')==q['task_sha256']
                 and receipt.get('parent_operation_sha256')==PARENT_DIGEST,'foreign qualification reconciliation')
            if receipt.get('phase')=='complete':return receipt  # No later pending/generation/lineage writes.
            need(receipt.get('phase')=='intent','invalid reconciliation phase')
        state,_=r.checkpoint('slot2')
        need(state.get('active') is None and digest(state)==CHECKPOINT,'qualification checkpoint changed')
        actual=r.identity(PARENT_PROCESS['pid'])
        if actual==PARENT_PROCESS:
            need(not r.alive(PARENT_PROCESS),'original qualification process still alive')
        elif actual is None:
            need(not Path('/proc',str(PARENT_PROCESS['pid'])).exists(),'original process identity unknown')
        executor_quiet()
        r.no_models(978,'slot2')
        r.units_quiet(('gobadminton-supervisor.service','gobadminton-slot@slot2.service'))
        r.free_lock(r.AUTONOMY/'slots/slot2/worker.lock');r.free_lock(r.AUTONOMY/'locks/slot2.lease')
        before=j.get('pending')==PARENT_OPERATION and j.get('generation')==GENERATION
        after=j.get('pending') is None and j.get('generation')==GENERATION+1
        need(before or receipt is not None and after,'stale generation or different pending operation')
        if receipt is None:
            receipt=dict(schema='GB_AGY_29_RECONCILIATION_V1',phase='intent',successor_task=q['task_sha256'],
                parent_operation=PARENT_OPERATION,parent_operation_sha256=PARENT_DIGEST,
                parent_task=PARENT_TASK,parent_run=PARENT_RUN,parent_process=PARENT_PROCESS,
                checkpoint=CHECKPOINT,generation_before=GENERATION,generation_after=GENERATION+1)
            r.atomic(path,receipt)
        lineage=dict(schema='GB_AGY_29_LINEAGE_V1',ceiling=2,used_calls=1,parent_task=PARENT_TASK,
                     allowed_successor=q['task_sha256'],accounting='cli_attempt_reservations_not_provider_internal_calls')
        lineage_path=r.STATE/LINEAGE
        if lineage_path.exists():need(r.read(lineage_path,0)==lineage,'qualification lineage already spent or changed')
        else:r.atomic(lineage_path,lineage)
        if before:
            updated=copy.deepcopy(j);updated['pending']=None;updated['generation']=GENERATION+1
            r.atomic(r.STATE/'slot2.json',updated)
        receipt=dict(receipt,phase='complete');r.atomic(path,receipt)
        return receipt
    finally:os.close(lock)


def acceptance_match(op,q):
    """Historical UNKNOWNs with the same Issue are history, not the new candidate."""
    if op.get('task_hash')!=q['task_sha256']:return False
    if grant(q):
        validate_grant(q['qualification_grant'])
        need(op.get('before')==op.get('after')==CHECKPOINT,'one-shot acceptance checkpoint drift')
        import re
        receipt=op.get('result',{}).get('native_receipt',{})
        need(receipt.get('qualification_grant')==q['qualification_grant']
             and receipt.get('input_transport')=='stream-json' and receipt.get('input_delivery')=='written'
             and receipt.get('requested_permission_mode')==receipt.get('effective_permission_mode')=='always-proceed'
             and type(receipt.get('semantic_input_bytes')) is int and receipt['semantic_input_bytes']>0
             and type(receipt.get('stdin_bytes')) is int and receipt['stdin_bytes']>receipt['semantic_input_bytes']
             and all(re.fullmatch('[a-f0-9]{64}',receipt.get(k,'') or '') for k in ('semantic_input_sha256','stdin_sha256')),
             'one-shot transport/mode receipt missing')
    b=op.get('binding',{});result=op.get('result',{});receipt=result.get('native_receipt',{});qa=result.get('qa',{})
    need(b.get('stage')=='qa_qualification' and b.get('issue')==29 and b.get('slot')=='slot2'
         and b.get('head')==q['head'] and result.get('status')=='confirmed'
         and result.get('qualification_passed') is True and result.get('checkpoint_changed') is False
         and op.get('before')==op.get('after') and op.get('finished_at')
         and qa.get('verdict')=='PASS' and qa.get('reviewed_sha')==q['head']
         and receipt.get('qualification_task_sha256')==q['task_sha256']
         and receipt.get('source_sha')==q['head'] and receipt.get('base_sha')==q['base']
         and receipt.get('qualification_lineage')=={k:q[k] for k in ('parent_task_sha256','parent_operation','adapter_revision') if k in q}
         and receipt.get('qualification_passed') is True and receipt.get('charged_calls')==1
         and receipt.get('effective_model')=='claude-sonnet-5-5-medium',
         'exact successor successful qualification required')
    return True

# Separate, nonrenewable allowance. The exhausted V1 lineage is provenance only.
GRANT_SCHEMA='GB_AGY_29_ONE_SHOT_V1'
GRANT_LEDGER='antigravity-29-one-shot-ledger.json'
GRANT_RECONCILIATION='antigravity-29-one-shot-reconcile.json'
SECOND_OPERATION='a5f13a7589a0ccbb6dd603d6a38aa9b2545064edbf2d2d269df50656b3522ae4'
SECOND_DIGEST='b47bf0653cdf6c1084b468f66cf4ae87148ed0ace9e3ab68222ed72c5b04ba88'
SECOND_PROCESS=dict(pid=3663398,start='38693339',boot='447e18ce-024d-4230-b88f-bd8ca81e2a9e')
SECOND_TASK='a76af5c1f3d79e9ca06ad5d0a66e238db1133004c821ff26c4737258dcd78b31'
LINEAGE_RAW='77091ceb6926a81f9cbbfb4f6baa0a6fba2a6bb1da7ba389c0a1ec67e042a563'
SECOND_RESERVATION_RAW='e1b2053953b844f575824031b3daa073c2deafc2b6bd17321262ed93f7add4e6'
BUDGET_RAW='8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d'


def grant(q):
    return 'qualification_grant' in q


def validate_grant(value):
    import re
    from context_policy import RULES_SHA256
    fields={'schema','controller_revision','cli_sha256','rules_sha256','fixture_sha256',
            'permission_mode','input_transport','timeout','ceiling','prior_operations','lineage_sha256'}
    need(type(value) is dict and set(value)==fields and value['schema']==GRANT_SCHEMA,'invalid closed qualification grant')
    need(re.fullmatch('[a-f0-9]{40}',value['controller_revision'] or '')
         and all(re.fullmatch('[a-f0-9]{64}',value[k] or '') for k in ('cli_sha256','fixture_sha256'))
         and value['cli_sha256']=='8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c'
         and value['rules_sha256']==RULES_SHA256 and value['permission_mode']=='always-proceed'
         and value['input_transport']=='stream-json' and type(value['timeout']) is int and value['timeout']==1800
         and type(value['ceiling']) is int and value['ceiling']==1
         and value['prior_operations']==[PARENT_OPERATION,SECOND_OPERATION]
         and value['lineage_sha256']==LINEAGE_RAW,'qualification grant binding drift')
    return value


def raw_pin(r,path,sha):
    import hashlib
    r.read(path,0)  # Existing trusted no-follow metadata/read gate.
    need(hashlib.sha256(Path(path).read_bytes()).hexdigest()==sha,'immutable qualification history drift')


def grant_history(r,j):
    original_proof(r,j)
    op=j.get('operations',{}).get(SECOND_OPERATION)
    need(digest(op)==SECOND_DIGEST and op.get('run')==39905564313
         and op.get('task_hash')==SECOND_TASK and op.get('process')==SECOND_PROCESS
         and op.get('before')==op.get('after')==CHECKPOINT
         and op.get('result',{}).get('status')=='unknown','second UNKNOWN history changed')
    raw_pin(r,r.STATE/LINEAGE,LINEAGE_RAW)
    value=r.read(r.STATE/LINEAGE,0)
    need(value.get('schema')=='GB_AGY_29_LINEAGE_V1' and value.get('used_calls')==value.get('ceiling')==2,
         'exhausted original lineage required')
    raw_pin(r,r.STATE/('antigravity-qa-qualification-'+SECOND_TASK+'.json'),SECOND_RESERVATION_RAW)


def grant_ready(r,q):
    validate_grant(q['qualification_grant'])
    grant_history(r,r.read(r.STATE/'slot2.json',0))
    value=r.read(r.STATE/GRANT_LEDGER,0)
    need(value.get('schema')==GRANT_SCHEMA and value.get('task_sha256')==q['task_sha256']
         and value.get('grant')==q['qualification_grant'] and value.get('used_calls')==0
         and value.get('ceiling')==1,'separate one-shot allowance spent or unapproved')
    receipt=r.read(r.STATE/GRANT_RECONCILIATION,0)
    need(receipt.get('phase')=='complete' and receipt.get('task_sha256')==q['task_sha256']
         and receipt.get('second_operation_sha256')==SECOND_DIGEST,'separate exact reconciliation required')
    return value


def reserve_grant(r,q,key):
    value=grant_ready(r,q)
    r.atomic(r.STATE/GRANT_LEDGER,dict(value,used_calls=1,reserved_operation=key))


def reconcile_grant(r,q):
    """Existing controller lock; durable release of only exact second UNKNOWN occupancy."""
    need(os.geteuid()==0 and grant(q),'root exact one-shot reconciliation only')
    validate_grant(q['qualification_grant'])
    from native_antigravity import qualification_descriptor
    marker=r.read(Path('/etc/gobadminton-slots/antigravity-qa.json'),0)
    need(marker.get('phase')=='canary' and qualification_descriptor(marker)==q,'installed exact one-shot marker required')
    lock=r.locked(r.STATE/'controller.lock')
    try:
        j=r.journal('slot2');grant_history(r,j)
        path=r.STATE/GRANT_RECONCILIATION
        receipt=r.read(path,0) if path.exists() else None
        if receipt:
            need(receipt.get('task_sha256')==q['task_sha256'] and receipt.get('second_operation_sha256')==SECOND_DIGEST,
                 'foreign one-shot reconciliation')
            if receipt.get('phase')=='complete':return receipt
            need(receipt.get('phase')=='intent','invalid one-shot reconciliation phase')
        state,_=r.checkpoint('slot2')
        need(state.get('active') is None and digest(state)==CHECKPOINT,'one-shot checkpoint drift')
        actual=r.identity(SECOND_PROCESS['pid'])
        if actual==SECOND_PROCESS:need(not r.alive(SECOND_PROCESS),'second UNKNOWN process alive')
        elif actual is None:need(not Path('/proc',str(SECOND_PROCESS['pid'])).exists(),'second process identity unknown')
        executor_quiet();r.no_models(978,'slot2')
        r.units_quiet(('gobadminton-supervisor.service','gobadminton-slot@slot2.service'))
        r.free_lock(r.AUTONOMY/'slots/slot2/worker.lock');r.free_lock(r.AUTONOMY/'locks/slot2.lease')
        before=j.get('pending')==SECOND_OPERATION and j.get('generation')==86
        after=j.get('pending') is None and j.get('generation')==87
        need(before or receipt is not None and after,'different pending/generation; no generic recovery')
        if receipt is None:
            receipt=dict(schema=GRANT_SCHEMA,phase='intent',task_sha256=q['task_sha256'],
                         second_operation_sha256=SECOND_DIGEST,checkpoint=CHECKPOINT,generation_before=86,generation_after=87)
            r.atomic(path,receipt)
        value=dict(schema=GRANT_SCHEMA,task_sha256=q['task_sha256'],grant=q['qualification_grant'],ceiling=1,used_calls=0)
        ledger=r.STATE/GRANT_LEDGER
        if ledger.exists():need(r.read(ledger,0)==value,'one-shot ledger already spent or foreign')
        else:r.atomic(ledger,value)
        if before:
            updated=copy.deepcopy(j);updated.update(pending=None,generation=87)
            r.atomic(r.STATE/'slot2.json',updated)
        receipt=dict(receipt,phase='complete');r.atomic(path,receipt)
        return receipt
    finally:os.close(lock)


def charge_grant(q,req,budget,state_dir,slots):
    """Exact trusted qualification only; use existing Budget.charge's lock/ledger.

    Exclusive executor intent is consumed even if ledger charge fails or crashes.
    This override is local to this single charge, never installed on Runtime.budget.
    """
    import json
    from core import binding
    validate_grant(q['qualification_grant'])
    operation=digest(binding({k:v for k,v in req.items() if not k.startswith('_')}))
    need(req.get('stage')=='qa_qualification' and req.get('slot')=='slot2' and req.get('issue')==29
         and req.get('head')==q['head'] and req.get('_qa_qualification')==q
         and req.get('_task_hash')==q['task_sha256'] and req.get('_qa_grant_operation')==operation,
         'one-shot charge outside exact root reservation')
    from native_antigravity import qualification_task
    need(q.get('adapter_revision')==q['qualification_grant']['controller_revision']
         and digest(qualification_task(q['base'],q['head'],adapter_revision=q['adapter_revision'],
                                     qualification_grant=q['qualification_grant']))==q['task_sha256'],
         'one-shot exact model/revision/task mismatch')
    import hashlib
    need(hashlib.sha256(Path(budget.limits_path).read_bytes()).hexdigest()==BUDGET_RAW,'original budget file changed')
    path=Path(state_dir)/'antigravity-29-one-shot-charge.json'
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as out:
        json.dump(dict(schema=GRANT_SCHEMA,task_sha256=q['task_sha256'],operation=operation,
                       grant=q['qualification_grant'],phase='charge-intent'),out,sort_keys=True)
        out.flush();os.fsync(out.fileno())
    directory=os.open(path.parent,os.O_DIRECTORY);os.fsync(directory);os.close(directory)
    class ExactBudget(slots.Budget):
        def remaining(self,provider,role,slot=None):
            need((provider,role,slot)==('agy','qa','slot2'),'one-shot budget scope mismatch')
            need(hashlib.sha256(Path(self.limits_path).read_bytes()).hexdigest()==BUDGET_RAW,'one-shot budget changed before charge')
            limits=self.limits()
            need(limits.get('providers',{}).get('agy')=={'qa':2}
                 and limits.get('slots',{}).get('slot2',{}).get('agy')=={'qa':2},'one-shot requires unchanged finite original caps')
            self.used(provider,role,slot)  # Reject malformed existing accounting.
            return 1
    exact=ExactBudget(budget.limits_path,budget.outbox_root,budget.registry_lock,today=budget.today)
    return exact.charge('slot2','agy','qa')
