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
    if addressed(q):return Path(state)/('antigravity-29-addressed-'+q['task_sha256']+'.json')
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
    if addressed(q) and q['qualification_grant']['role']=='technical_pm_product_analyst':return False
    if grant(q):
        (validate_addressed_grant if addressed(q) else validate_grant)(q['qualification_grant'])
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
    if addressed(q):
        receipt=op.get('result',{}).get('native_receipt',{})
        need(receipt.get('review_kind')=='native_source_qa'
             and receipt.get('addressed_role')=='independent_qa'
             and receipt.get('addressed_input_sha256')==q['qualification_grant']['input_sha256']
             and 'run_command' in receipt.get('tool_names',[]), 'fresh exact QA contract receipt required')
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
    if addressed(q):return addressed_ready(r,q)
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
    if addressed(q):return reserve_addressed(r,q,key)
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
    if addressed(q):return charge_addressed(q,req,budget,state_dir,slots)
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

# Owner comment6362661117: addressed correction only, separate from old 2/2+1/1.
ADDRESSED_SCHEMA='GB_AGY_29_ADDRESSED_CALL_V1'
ADDRESSED_LINEAGE='owner-6362661117-agy29-218'
ADDRESSED_LEDGER='antigravity-29-addressed-ledger.json'
ADDRESSED_RECONCILIATION='antigravity-29-addressed-reconcile.json'
THIRD_OPERATION='fac7bdfc68acc80136ab0d333a385bea51a9311f4058cb17695a43f86a8fa6a0'
THIRD_DIGEST='0961f5ac0ef72436b033b62665e95bb02809e009462f16dccf90543c65923a2e'
THIRD_PROCESS=dict(pid=894070,start='40142230',boot='447e18ce-024d-4230-b88f-bd8ca81e2a9e')
THIRD_TASK='c18f960ed911d650828f105e8c7bb6df95391c9c8f0621b7b692dd64ca83ffdb'
INSTALLED_BASELINE='b51e7c1c18103247606d35a414c82b04f5dd53ee'
# Historic grants are immutable. Owner #29 authorization 6370661776 grants only
# TWO new calls under rules 1.3; do not reinterpret the previous 2/4 charges.
FRESH_OWNER_COMMENT=6370661776
# The historical addressed ledger remains ceiling=4, used_calls=3, immutable.
# The Owner's new package is a separate, finite one-analysis/one-QA journal.
SUPPLEMENT_OWNER_COMMENT=6372450456
SUPPLEMENT_SCHEMA='GB_AGY_29_STAGE3_SUPPLEMENT_V1'
SUPPLEMENT_LEDGER='antigravity-29-stage3-supplement.json'
SUPPLEMENT_ORIGINAL_ANALYSIS_OP='aa17df106db0de1aa816bae35111b16d0f0bb6f3788c35eade2f22f9bab244ee'
# Dynamically enrolled Owner-authenticated packages: strict #29 canary scope only.
OWNER_PACKAGE_SCHEMA='GB_AGY_29_OWNER_PACKAGE_V1'
OWNER_PACKAGE_LEDGER_PREFIX='antigravity-29-owner-package-'
OWNER_PACKAGE_OLD_ADDRESS_SHA='6b49d7a03bdb96182eae23ab18b4b8afa645aa35baf84ae90b6ff9b567e9c8a2'
OWNER_PACKAGE_OLD_SUPPLEMENT_SHA='f58de4a128825612515ac18ebc94944d70e4b360beadd14afc11addde93412de'
OWNER_PACKAGE_ORIGINAL_UNKNOWN='3abe09744249e9f71045208474441f1f6bf5fa471c27bdf7ddfd490656eb2fe6'
OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST='85c5e471ae3b2f8ddb4cf30f163520de1731dce3b75c4b428d69301779f1cc86'


def owner_package(g):
    return type(g) is dict and type(g.get('owner_comment')) is int and g['owner_comment'] > 0 and (
        g['owner_comment'] not in (6362661117,FRESH_OWNER_COMMENT,SUPPLEMENT_OWNER_COMMENT))


def owner_package_path(r,g):
    need(owner_package(g),'not dynamic Owner package')
    return r.STATE/(OWNER_PACKAGE_LEDGER_PREFIX+str(g['owner_comment'])+'.json')


def owner_package_ledger(value):
    from context_policy import RULES_SHA256
    need(type(value) is dict and set(value)==
         {'schema','owner_comment','owner_id','issue','controller_sha','rules_sha256',
          'source_base','source_head','body_sha256','ceiling','used_calls','grants',
          'previous_addressed_sha256','previous_supplement_sha256'},
         'invalid Owner package ledger structure')
    need(value['schema']==OWNER_PACKAGE_SCHEMA and value['owner_id']==318610566
         and value['issue']==29 and type(value['owner_comment']) is int
         and value['owner_comment']>0
         and value['rules_sha256']==RULES_SHA256
         and value['previous_addressed_sha256']==OWNER_PACKAGE_OLD_ADDRESS_SHA
         and value['previous_supplement_sha256']==OWNER_PACKAGE_OLD_SUPPLEMENT_SHA
         and type(value['body_sha256']) is str and len(value['body_sha256'])==64,
         'Owner package authorization/history drift')
    rows=value['grants']
    need(type(rows) is dict and len(rows)==2 and value['ceiling']==2
         and type(value['used_calls']) is int,'only closed two-call packages supported')
    roles=[];consumed=0
    for key,row in rows.items():
        need(type(row) is dict and set(row)=={'grant','operation'},'package grant row format')
        g=row['grant']
        validate_addressed_grant(g,enrollment=True)
        need(owner_package(g) and g['owner_comment']==value['owner_comment']
             and g['controller_revision']==value['controller_sha']
             and (g['base'],g['head'])==(value['source_base'],value['source_head'])
             and digest(g)==key,'package grant/source/controller mismatch')
        roles.append(g['role'])
        need(row['operation'] is None or type(row['operation']) is str and
             len(row['operation'])==64 and all(c in '0123456789abcdef' for c in row['operation']),
             'operation identifier malformed')
        consumed+=row['operation'] is not None
    need(set(roles)=={'technical_pm_product_analyst','independent_qa'} and
         len(roles)==2 and consumed==value['used_calls'],
         'package roles/spend mismatch')
    return value


def owner_package_read(r,g):
    import hashlib
    path=owner_package_path(r,g)
    value=owner_package_ledger(r.read(path,0))
    need(value['owner_comment']==g['owner_comment']
         and value['controller_sha']==g['controller_revision']
         and hashlib.sha256((r.STATE/ADDRESSED_LEDGER).read_bytes()).hexdigest()==OWNER_PACKAGE_OLD_ADDRESS_SHA
         and hashlib.sha256((r.STATE/SUPPLEMENT_LEDGER).read_bytes()).hexdigest()==OWNER_PACKAGE_OLD_SUPPLEMENT_SHA,
         'old ledgers or package registration changed')
    return value

LEGACY_RULES_SHA256='0755f8b5eb2cce575e58137a0f0462448109d8af0173e36d67f6551342b35ba6'
LEGACY_CONTROLLER='3ce9a1339a73e1c9b3fb2ca5b269483faf2fc4f8'
LEGACY_GRANT_DIGESTS=frozenset((
    'b71a53f0760e20cedf7eb240a93f0e9a15730a14731cbdbfc695acb07f210840',
    'feda0b12e4dc8efec8807dba1df8935c8e9622dd6785ebfaf4d96a1cc850e928'))
FRESH_SOURCE_BASE='b0e4d233bc150f42ada86c4c0f56897c57e0d0fe'
FRESH_SOURCE_HEAD='12f35ac4430348ae811cf712d9bb24d2a19b62e6'
FRESH_QA_INPUT_REVISION='6a53099160f0ae7312f6d282b061c5230e7d2536'
FRESH_QA_INPUT_PATH='scripts/chatops/tests/fixtures/agy-236-independent-qa-12f35ac.json'
FRESH_QA_INPUT_SHA256='c1672961885bea637d1ff21ffd05accc73837fe669e853f4b911d9f7ad7dcee9'
ANALYSIS_INPUT='scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json'
ANALYSIS_INPUT_SHA256='40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55'


def addressed(q):
    g=q.get('qualification_grant')
    return type(g) is dict and g.get('schema')==ADDRESSED_SCHEMA


def validate_addressed_grant(g, *, enrollment=False):
    import re
    from context_policy import RULES_SHA256
    fields={'schema','lineage','owner_comment','role','controller_revision','cli_sha256',
            'rules_sha256','base','head','input_revision','input_path','input_sha256','timeout','max_output_bytes',
            'permission_mode','input_transport','ceiling'}
    need(type(g) is dict and set(g)==fields and g['schema']==ADDRESSED_SCHEMA
         and g['lineage']==ADDRESSED_LINEAGE and type(g['owner_comment']) is int,
         'invalid addressed Issue29 grant')
    historical=(g['owner_comment']==6362661117 and digest(g) in LEGACY_GRANT_DIGESTS)
    original_owner=(g['owner_comment']==6362661117)
    fresh=(g['owner_comment']==FRESH_OWNER_COMMENT)
    supplemental=(g['owner_comment']==SUPPLEMENT_OWNER_COMMENT)
    dynamic=owner_package(g)
    need(original_owner or fresh or supplemental or dynamic,
         'Owner grant not in approved authorization classes')
    if historical:
        need(g['controller_revision']==LEGACY_CONTROLLER
             and g['rules_sha256']==LEGACY_RULES_SHA256,
             'immutable historical grant identity altered')
    elif fresh or supplemental:
        need(g['rules_sha256']==RULES_SHA256 and
             (g['base'],g['head'])==(FRESH_SOURCE_BASE,FRESH_SOURCE_HEAD),
             'new qualification source/rules identity drift')
    elif dynamic:
        need(g['rules_sha256']==RULES_SHA256,'new package must bind installed rules')
        if not enrollment:
            # Unprivileged UID978 cannot read root-only ledgers. Validate against
            # the exact root-owned 0644 admission marker; root checks its ledger.
            import json
            from native_antigravity import MARKER,trusted
            try:
                marker=json.loads(trusted(MARKER))
            except (OSError,ValueError,TypeError,KeyError):
                need(False,'unadmitted package grant; trusted marker unavailable')
            need(marker.get('phase')=='canary'
                 and marker.get('adapter_revision')==g['controller_revision']
                 and marker.get('qualification',{}).get('qualification_grant')==g,
                 'unadmitted package grant or replaced canary')
    else:
        # Preserve existing closed original-owner grant test contract.
        need(g['rules_sha256']==RULES_SHA256,
             'nonhistorical grant must bind current accepted rules')
    need(g['role'] in ('technical_pm_product_analyst','independent_qa')
         and all(type(g[k]) is str and re.fullmatch('[a-f0-9]{40}',g[k])
                 for k in ('controller_revision','base','head','input_revision'))
         and g['controller_revision']!=INSTALLED_BASELINE and g['base']!=g['head']
         and type(g['input_sha256']) is str and re.fullmatch('[a-f0-9]{64}',g['input_sha256'])
         and g['cli_sha256']=='8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c'
         and g['permission_mode']=='always-proceed' and g['input_transport']=='stream-json'
         and type(g['timeout']) is int and g['timeout']==1800
         and type(g['max_output_bytes']) is int and g['max_output_bytes']==4<<20
         and type(g['ceiling']) is int and g['ceiling']==1,'addressed grant pins/bounds drift')
    if g['role']=='technical_pm_product_analyst':
        need(g['input_revision']==g['head'] and g['input_path']==ANALYSIS_INPUT and g['input_sha256']==ANALYSIS_INPUT_SHA256,
             'exact INERT Issue230 material required')
    else:
        need(type(g['input_path']) is str and re.fullmatch(
            r'scripts/chatops/tests/fixtures/agy-[a-z0-9-]+\.json',g['input_path']),
            'exact QA source/test-receipt contract required')
        if fresh or supplemental or dynamic:
            need((g['input_revision'],g['input_path'],g['input_sha256'])==
                 (FRESH_QA_INPUT_REVISION,FRESH_QA_INPUT_PATH,FRESH_QA_INPUT_SHA256),
                 'reviewed independent QA fixture changed')
    return g


def addressed_task(base,head,g):
    validate_addressed_grant(g)
    need((base,head)==(g['base'],g['head']),'addressed candidate mismatch')
    return dict(schema='GB_ANTIGRAVITY_29_ADDRESSED_TASK_V1',issue=29,role=g['role'],
        slot='slot2',base=base,head=head,model='claude-sonnet-5-5-medium',max_calls=1,
        adapter_revision=g['controller_revision'],qualification_grant=g)


def addressed_input(work,g,*,installer=False):
    """Immutable input bytes only; QA additionally binds real reviewed test receipts."""
    import hashlib
    from native_antigravity import git,dec,loads
    if installer:
        from functools import partial
        git=partial(git,_addressed_installer=True)
    if installer and owner_package(g):
        need(os.geteuid()==0,'new Owner package enrollment needs trusted root')
        validate_addressed_grant(g,enrollment=True)
    else:
        validate_addressed_grant(g)
    need(dec(git(work,'rev-parse','HEAD')).strip()==g['head'],'addressed input source drift')
    raw=git(work,'show',g['input_revision']+':'+g['input_path'])
    need(hashlib.sha256(raw).hexdigest()==g['input_sha256'],'addressed exact input hash mismatch')
    value=loads(raw)
    if g['role']=='independent_qa':
        need(type(value) is dict and set(value)=={'schema','source_sha','requirements','checks'}
             and value['schema']=='GB_AGY_29_QA_TEST_CONTRACT_V1'
             and value['source_sha']==g['head'] and type(value['requirements']) is str
             and 0<len(value['requirements'])<=16000
             and type(value['checks']) is list and 1<=len(value['checks'])<=16,
             'missing exact QA source/test contract')
        import re
        for c in value['checks']:
            need(type(c) is dict and set(c)=={'command','exit_code','output_sha256','source_sha'}
                 and c['source_sha']==g['head'] and type(c['command']) is str
                 and 0<len(c['command'])<=2000 and type(c['exit_code']) is int and c['exit_code']==0
                 and type(c['output_sha256']) is str and re.fullmatch('[a-f0-9]{64}',c['output_sha256']),
                 'invalid reviewed exact test receipt')
    return dec(raw)


def addressed_history(r,j):
    grant_history(r,j)  # Original 2/2 and UNKNOWNs are still immutable.
    op=j.get('operations',{}).get(THIRD_OPERATION)
    need(digest(op)==THIRD_DIGEST and op.get('task_hash')==THIRD_TASK
         and op.get('run')==39931790318 and op.get('process')==THIRD_PROCESS
         and op.get('before')==op.get('after')==CHECKPOINT
         and op.get('result',{}).get('status')=='unknown'
         and op.get('result',{}).get('safe_release') is False,'third UNKNOWN evidence changed')
    old=r.read(r.STATE/GRANT_LEDGER,0)
    need(old.get('schema')==GRANT_SCHEMA and old.get('used_calls')==old.get('ceiling')==1
         and old.get('reserved_operation')==THIRD_OPERATION and old.get('task_sha256')==THIRD_TASK,
         'historical one-shot must remain spent')
    reservation=r.read(r.STATE/('antigravity-qa-one-shot-'+THIRD_TASK+'.json'),0)
    need(reservation.get('operation')==THIRD_OPERATION and reservation.get('task_hash')==THIRD_TASK
         and reservation.get('result',{}).get('status')=='unknown'
         and reservation.get('result',{}).get('safe_release') is False,
         'historical UNKNOWN reservation changed')


def addressed_ledger(value):
    need(type(value) is dict and set(value)=={'schema','lineage','ceiling','grants','used_calls'}
         and value['schema']==ADDRESSED_SCHEMA and value['lineage']==ADDRESSED_LINEAGE
         and type(value['ceiling']) is int and value['ceiling']==4
         and type(value['grants']) is dict and 1<=len(value['grants'])<=4,
         'closed max4 addressed ledger required')
    count=0
    roles=[]
    for key,row in value['grants'].items():
        need(type(row) is dict and set(row)=={'grant','operation'},'invalid per-call ledger')
        validate_addressed_grant(row['grant'])
        if row['grant']['owner_comment']==FRESH_OWNER_COMMENT:
            roles.append(row['grant']['role'])
        need(key==digest(row['grant']),'forged per-call grant')
        op=row['operation']
        need(op is None or type(op) is str and len(op)==64 and all(x in '0123456789abcdef' for x in op),
             'invalid consumed operation')
        count+=op is not None
    need(type(value['used_calls']) is int and value['used_calls']==count<=4,'addressed usage drift')
    need(len(roles)==len(set(roles)) and set(roles)<=
         {'technical_pm_product_analyst','independent_qa'},
         'Owner Stage3 allows one fresh call per distinct role')
    return value


def supplemental_ledger(value):
    """Closed two-call continuation; NEVER mutate/recount the historical 3/4."""
    need(type(value) is dict and set(value)==
         {'schema','owner_comment','ceiling','used_calls','grants','legacy_used_calls'},
         'unrecognized supplemental ledger')
    need(value['schema']==SUPPLEMENT_SCHEMA and
         type(value['owner_comment']) is int and
         value['owner_comment']==SUPPLEMENT_OWNER_COMMENT and
         type(value['ceiling']) is int and value['ceiling']==2 and
         type(value['legacy_used_calls']) is int and value['legacy_used_calls']==3,
         'supplement authority or historical baseline drift')
    grants=value['grants']
    need(type(grants) is dict and 1<=len(grants)<=2,'exact two-role ledger only')
    spent=0;roles=[]
    for key,row in grants.items():
        need(type(row) is dict and set(row)=={'grant','operation'},'invalid supplement grant row')
        g=validate_addressed_grant(row['grant'])
        need(g['owner_comment']==SUPPLEMENT_OWNER_COMMENT and key==digest(g),
             'non supplemental or counterfeit grant')
        roles.append(g['role'])
        op=row['operation']
        need(op is None or type(op) is str and len(op)==64 and
             all(c in '0123456789abcdef' for c in op),'invalid supplement operation')
        spent+=op is not None
    need(len(roles)==len(set(roles)) and set(roles)<=
         {'technical_pm_product_analyst','independent_qa'},'duplicate supplemental role')
    need(type(value['used_calls']) is int and value['used_calls']==spent<=2,
         'supplement usage cannot reset or exceed 2')
    return value


def supplemental_baseline(r):
    legacy=addressed_ledger(r.read(r.STATE/ADDRESSED_LEDGER,0))
    need(legacy['ceiling']==4 and legacy['used_calls']==3 and len(legacy['grants'])==3,
         'historic 3/4 ledger must remain spent')
    row=next((v for v in legacy['grants'].values()
              if v['operation']==SUPPLEMENT_ORIGINAL_ANALYSIS_OP),None)
    need(row is not None and row['grant']['owner_comment']==FRESH_OWNER_COMMENT
         and row['grant']['role']=='technical_pm_product_analyst',
         'original INCOMPLETE analysis grant altered')
    op=r.read(r.STATE/'slot2.json',0)['operations'].get(SUPPLEMENT_ORIGINAL_ANALYSIS_OP,{})
    res=op.get('result',{})
    need(res.get('status')=='confirmed' and res.get('analysis_complete') is False
         and res.get('analysis',{}).get('completion')=='INCOMPLETE',
         'must retain prior confirmed INCOMPLETE analysis')
    return legacy


def addressed_ready(r,q):
    g=validate_addressed_grant(q['qualification_grant'])
    if g['owner_comment'] in (FRESH_OWNER_COMMENT,SUPPLEMENT_OWNER_COMMENT) or owner_package(g):
        # qualification_api() exposes read/STATE/atomic, not POLICY. Pin the
        # existing receiver path rather than weakening the controller match.
        from receiver import POLICY as installed_policy
        policy=r.read(getattr(r,'POLICY',installed_policy),0)
        need(g['controller_revision']==policy['controller_sha'],'fresh grant requires installed controller SHA')
        # Analysis must finish and be retained before the separately admitted QA call.
        if g['role']=='independent_qa' and g['owner_comment']==FRESH_OWNER_COMMENT:
            ledger=r.read(r.STATE/ADDRESSED_LEDGER,0)
            analyses=[row.get('operation') for row in ledger.get('grants',{}).values()
                 if row.get('grant',{}).get('owner_comment')==FRESH_OWNER_COMMENT
                 and row.get('grant',{}).get('role')=='technical_pm_product_analyst']
            need(len(analyses)==1 and analyses[0],'fresh analysis reservation missing')
            op=r.journal('slot2')['operations'].get(analyses[0],{})
            need(op.get('result',{}).get('status')=='confirmed'
                 and op.get('result',{}).get('analysis_complete') is True
                 and op.get('result',{}).get('analysis',{}).get('completion')=='COMPLETE',
                 'fresh analysis not COMPLETE before independent QA')
    need(digest(addressed_task(q['base'],q['head'],g))==q['task_sha256'],'forged addressed task')
    addressed_history(r,r.read(r.STATE/'slot2.json',0))
    reconciliation=r.read(r.STATE/ADDRESSED_RECONCILIATION,0)
    need(reconciliation.get('phase')=='complete'
         and reconciliation.get('third_operation_sha256')==THIRD_DIGEST,
         'exact fac7 scheduling reconciliation required')
    if owner_package(g):
        from core import digest as _digest
        j=r.read(r.STATE/'slot2.json',0)
        need(_digest(j['operations'].get(OWNER_PACKAGE_ORIGINAL_UNKNOWN))==
             OWNER_PACKAGE_ORIGINAL_UNKNOWN_DIGEST,
             'predecessor UNKNOWN mutated')
        value=owner_package_read(r,g)
        if g['role']=='independent_qa':
            analyses=[row['operation'] for row in value['grants'].values()
                      if row['grant']['role']=='technical_pm_product_analyst']
            need(len(analyses)==1 and analyses[0],'package analysis not yet consumed')
            op=j['operations'].get(analyses[0],{})
            result=op.get('result',{})
            native=result.get('native_receipt') or {}
            need(result.get('status')=='confirmed'
                 and result.get('analysis_complete') is True
                 and result.get('analysis',{}).get('completion')=='COMPLETE'
                 and {'view_file','run_command'}<=set(native.get('tool_names') or [])
                 and len(result.get('analysis',{}).get('source_reads') or [])==2,
                 'native COMPLETE with tool evidence required before separate QA')
        row=value['grants'].get(_digest(g))
        need(row and row['grant']==g and row['operation'] is None and value['used_calls']<2,
             'Owner package grant missing/spent')
        return value
    if g['owner_comment']==SUPPLEMENT_OWNER_COMMENT:
        supplemental_baseline(r)  # Read-only original 3/4 verification.
        value=supplemental_ledger(r.read(r.STATE/SUPPLEMENT_LEDGER,0))
        if g['role']=='independent_qa':
            analyses=[row['operation'] for row in value['grants'].values()
                     if row['grant']['role']=='technical_pm_product_analyst']
            need(len(analyses)==1 and analyses[0],
                 'supplemental analysis must be charged first')
            op=r.read(r.STATE/'slot2.json',0)['operations'].get(analyses[0],{})
            result=op.get('result',{})
            native=result.get('native_receipt') or {}
            need(result.get('status')=='confirmed'
                 and result.get('analysis_complete') is True
                 and result.get('analysis',{}).get('completion')=='COMPLETE'
                 and {'view_file','run_command'} <= set(native.get('tool_names') or [])
                 and len(result.get('analysis',{}).get('source_reads') or [])==2,
                 'real supplemental analysis COMPLETE with tools is required before QA')
        row=value['grants'].get(digest(g))
        need(row and row['grant']==g and row['operation'] is None and value['used_calls']<2,
             'supplement exact grant absent or spent')
        return value
    value=addressed_ledger(r.read(r.STATE/ADDRESSED_LEDGER,0))
    row=value['grants'].get(digest(g))
    need(row and row['grant']==g and row['operation'] is None and value['used_calls']<4,
         'addressed exact grant absent/spent')
    return value


def reserve_addressed(r,q,key):
    value=copy.deepcopy(addressed_ready(r,q))
    grant=q['qualification_grant']
    value['grants'][digest(grant)]['operation']=key
    value['used_calls']+=1
    if owner_package(grant):
        owner_package_ledger(value)
        r.atomic(owner_package_path(r,grant),value)
    elif grant['owner_comment']==SUPPLEMENT_OWNER_COMMENT:
        supplemental_ledger(value)
        r.atomic(r.STATE/SUPPLEMENT_LEDGER,value)
    else:
        addressed_ledger(value)
        r.atomic(r.STATE/ADDRESSED_LEDGER,value)  # Old UNKNOWN remains spent.


def addressed_reconciliation_state(r,proof_sha256,slot_before_sha256):
    """Authenticate the whole scheduling transition, never just generation/pending."""
    import hashlib,json,re
    from core import loads
    need(all(type(v) is str and re.fullmatch('[a-f0-9]{64}',v)
             for v in (proof_sha256,slot_before_sha256)), 'exact reconciliation proof/history pins required')
    path=r.STATE/ADDRESSED_RECONCILIATION
    if not path.exists():return None,{slot_before_sha256}
    receipt=r.read(path,0)
    fields={'schema','phase','third_operation_sha256','checkpoint','generation_before','generation_after',
            'proof_sha256','slot_before_raw','slot_before_sha256','slot_after_sha256'}
    need(type(receipt) is dict and set(receipt)==fields
         and receipt['schema']=='GB_AGY_29_ADDRESSED_RECONCILIATION_V2'
         and receipt['third_operation_sha256']==THIRD_DIGEST and receipt['checkpoint']==CHECKPOINT
         and type(receipt['generation_before']) is int and receipt['generation_before']==87
         and type(receipt['generation_after']) is int and receipt['generation_after']==88
         and receipt['phase'] in ('intent','complete') and receipt['proof_sha256']==proof_sha256
         and receipt['slot_before_sha256']==slot_before_sha256
         and type(receipt['slot_before_raw']) is str, 'foreign addressed reconciliation')
    raw=receipt['slot_before_raw'].encode()
    need(hashlib.sha256(raw).hexdigest()==slot_before_sha256,'reconciliation before history drift')
    before=loads(raw)
    need(type(before) is dict and before.get('pending')==THIRD_OPERATION
         and type(before.get('generation')) is int and before['generation']==87, 'invalid reconciliation before state')
    after=copy.deepcopy(before);after.update(pending=None,generation=88)
    after_sha=hashlib.sha256(json.dumps(after,sort_keys=True).encode()).hexdigest()
    need(receipt['slot_after_sha256']==after_sha,'reconciliation after history drift')
    return receipt,({after_sha} if receipt['phase']=='complete' else {slot_before_sha256,after_sha})


def reconcile_addressed(r,*,proof_sha256,slot_before_sha256):
    """Separate scheduling effect; caller holds existing controller lock, policy disabled.

    Never writes original op/result/reservation/old ledgers or calls safe_release.
    """
    need(os.geteuid()==0 and r.read(r.POLICY,0)['mode']=='disabled','disabled root reconciliation only')
    j=r.journal('slot2');addressed_history(r,j)
    path=r.STATE/ADDRESSED_RECONCILIATION
    import hashlib,json
    receipt,allowed=addressed_reconciliation_state(r,proof_sha256,slot_before_sha256)
    r.read(r.STATE/'slot2.json',0)
    raw=(r.STATE/'slot2.json').read_bytes()
    need(hashlib.sha256(raw).hexdigest() in allowed,'reconciliation slot history drift')
    if receipt and receipt['phase']=='complete':return receipt
    state,_=r.checkpoint('slot2')
    need(state.get('active') is None and digest(state)==CHECKPOINT,'fac7 checkpoint changed')
    actual=r.identity(THIRD_PROCESS['pid'])
    need(actual is None or actual==THIRD_PROCESS,'fac7 PID reused/identity unknown')
    need(not r.alive(THIRD_PROCESS),'fac7 process alive')
    if actual is None:
        need(not Path('/proc',str(THIRD_PROCESS['pid'])).exists(),'fac7 process identity unknown')
    executor_quiet()
    r.units_quiet(('gobadminton-supervisor.service','gobadminton-slot@slot2.service'))
    r.free_lock(r.AUTONOMY/'slots/slot2/worker.lock');r.free_lock(r.AUTONOMY/'locks/slot2.lease')
    before=j.get('pending')==THIRD_OPERATION and type(j.get('generation')) is int and j['generation']==87
    after=j.get('pending') is None and type(j.get('generation')) is int and j['generation']==88
    need(before or receipt is not None and after,'fac7 pending/generation mismatch')
    if receipt is None:
        updated=copy.deepcopy(j);updated.update(pending=None,generation=88)
        receipt=dict(schema='GB_AGY_29_ADDRESSED_RECONCILIATION_V2',phase='intent',third_operation_sha256=THIRD_DIGEST,
                     checkpoint=CHECKPOINT,generation_before=87,generation_after=88,proof_sha256=proof_sha256,
                     slot_before_raw=raw.decode(),slot_before_sha256=slot_before_sha256,
                     slot_after_sha256=hashlib.sha256(json.dumps(updated,sort_keys=True).encode()).hexdigest())
        r.atomic(path,receipt)
    if before:
        updated=copy.deepcopy(j);updated.update(pending=None,generation=88)
        r.atomic(r.STATE/'slot2.json',updated)
    receipt=dict(receipt,phase='complete');r.atomic(path,receipt)
    return receipt


def charge_addressed(q,req,budget,state_dir,slots):
    """Existing finite Budget ledger; no change to global caps or historical counters."""
    import json,hashlib
    from core import binding
    from native_antigravity import qualification_task
    g=validate_addressed_grant(q['qualification_grant'])
    operation=digest(binding({k:v for k,v in req.items() if not k.startswith('_')}))
    need(req.get('stage')=='qa_qualification' and req.get('slot')=='slot2' and req.get('issue')==29
         and req.get('head')==q['head'] and req.get('_qa_qualification')==q
         and req.get('_task_hash')==q['task_sha256'] and req.get('_qa_grant_operation')==operation
         and digest(qualification_task(q['base'],q['head'],adapter_revision=q['adapter_revision'],
              qualification_grant=g))==q['task_sha256'],'addressed charge outside exact reservation')
    need(req.get('_qa_addressed_grant')==g,'missing trusted addressed grant binding')
    need(hashlib.sha256(Path(budget.limits_path).read_bytes()).hexdigest()==BUDGET_RAW,'global caps changed')
    path=Path(state_dir)/('antigravity-29-addressed-charge-'+digest(g)+'.json')
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w') as out:
        json.dump(dict(schema=ADDRESSED_SCHEMA,grant=g,operation=operation,phase='charge-intent'),out,sort_keys=True)
        out.flush();os.fsync(out.fileno())
    directory=os.open(path.parent,os.O_DIRECTORY);os.fsync(directory);os.close(directory)
    class ExactBudget(slots.Budget):
        def remaining(self,provider,role,slot=None):
            need((provider,role,slot)==('agy','qa','slot2'),'addressed budget scope mismatch')
            need(hashlib.sha256(Path(self.limits_path).read_bytes()).hexdigest()==BUDGET_RAW,'global caps changed before charge')
            limits=self.limits()
            need(limits.get('providers',{}).get('agy')=={'qa':2}
                 and limits.get('slots',{}).get('slot2',{}).get('agy')=={'qa':2},'original finite caps required')
            self.used(provider,role,slot)
            return 1
    exact=ExactBudget(budget.limits_path,budget.outbox_root,budget.registry_lock,today=budget.today)
    return exact.charge('slot2','agy','qa')
