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
