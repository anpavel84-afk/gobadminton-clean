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
from contextlib import contextmanager
from types import SimpleNamespace
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

LEGACY_JOURNAL=JOURNAL
LEGACY_BACKUP=BACKUP
RECOVERY=False
ENTRYPOINT_PATCH=False
ONE_SHOT=False
RECOVERY_MODULE=None
RECOVERY_OLD='f68a4472f4f7478f007dc328f04569cf96b36f81'
RECOVERY_ALLOWED={'native_antigravity.py','antigravity_qa_recovery.py','stage.py','receiver.py'}

PATCH_BASE='c70608bd5ed03c409e0bfd53e51974c68dd19deb'
PATCH_TASK='a76af5c1f3d79e9ca06ad5d0a66e238db1133004c821ff26c4737258dcd78b31'
PATCH_NATIVE='dbe3c8c89799365997bac19f17e2e492a1486eccc606c825607569fd09ff920d'
PATCH_PARENT=STATE/'antigravity-qa-29-recovery-upgrade.json'
PATCH_PARENT_BACKUP=STATE/'antigravity-qa-29-recovery-backup'
PATCH_PARENT_SHA='bf267895d9b74c48e4caff58e8aaa73d31567133b93e4a32395bd95168b1f9d0'
PATCH_MARKER_SHA='6186e98b8f60dc3c6592a934dc3a89ca3c7632c5fa2532bcd7e8eada814824c6'
PATCH_BUDGET_SHA='8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d'


def one_shot_mode():
    global ONE_SHOT,RECOVERY,JOURNAL,BACKUP,OLD,ALLOWED
    ONE_SHOT=True;RECOVERY=True
    JOURNAL=STATE/'antigravity-29-one-shot-upgrade.json'
    BACKUP=STATE/'antigravity-29-one-shot-backup'
    OLD='6efeca2391bff566e1aec980847b0322bc7f206f';ALLOWED=RECOVERY_ALLOWED


def one_shot_configuration(proof,budget,module_hashes):
    recovery=recovery_module()
    r.need(set(proof)=={'schema','reviewed','marker','baseline_marker_sha256',
                       'baseline_inventory_sha256','parent_journal_sha256'},'closed one-shot proof required')
    r.need(proof['baseline_inventory_sha256']=='0ef1ec368d9402b279f46636927c069afb017a0892675b3f3cf7047ed747e281'
           and i.sha(STATE/'backup.json')==proof['baseline_inventory_sha256'],'one-shot baseline inventory drift')
    parent=STATE/'antigravity-qa-29-entrypoint-patch.json'
    r.need(proof['parent_journal_sha256']=='b445479d6de88d6a66806ae897327e613c095f6342548c35a718e114b603c5ac'
           and i.sha(parent)==proof['parent_journal_sha256'],'immutable entrypoint parent drift')
    r.need(proof['baseline_marker_sha256']==PATCH_MARKER_SHA and i.sha(MARKER)==PATCH_MARKER_SHA
           and i.sha(BUDGET)==recovery.BUDGET_RAW,'old marker/budget bytes changed')
    recovery.grant_history(r,r.journal('slot2'))
    marker=proof['marker'];q=marker.get('qualification',{})
    required={'issue','base','head','work','task_sha256','adapter_revision','qualification_grant'}
    r.need(set(q)==required and q['issue']==29 and q['work']=='/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary'
           and all(re.fullmatch('[a-f0-9]{40}',q[k] or '') for k in ('base','head','adapter_revision')),
           'exact one-shot fixture descriptor required')
    g=recovery.validate_grant(q['qualification_grant'])
    r.need(g['controller_revision']==q['adapter_revision']==marker.get('adapter_revision')
           and g['fixture_sha256']==digest({k:q[k] for k in ('base','head','work')}),'one-shot revision/fixture drift')
    task=dict(schema='GB_ANTIGRAVITY_QA_29_TASK_V3',issue=29,role='qa_qualification',slot='slot2',
              base=q['base'],head=q['head'],model='claude-sonnet-5-5-medium',max_calls=1,
              adapter_revision=q['adapter_revision'],qualification_grant=g)
    r.need(marker.get('schema')=='GB_ANTIGRAVITY_QA_29_V1' and marker.get('phase')=='canary'
           and marker.get('slot')=='slot2' and marker.get('executor_uid')==978
           and q['task_sha256']==marker.get('canary_task_sha256')==digest(task)
           and marker.get('modules')=={k:module_hashes[k] for k in ('native_antigravity.py','native_guard.py')},
           'exact one-shot marker pins required')
    r.need(not (STATE/recovery.GRANT_LEDGER).exists() and not (STATE/recovery.GRANT_RECONCILIATION).exists(),
           'one-shot already admitted; no renewal')
    return marker,copy.deepcopy(budget)  # No quota change before actual accepted qualification.


def entrypoint_patch_mode():
    global ENTRYPOINT_PATCH,RECOVERY,JOURNAL,BACKUP,OLD,ALLOWED
    ENTRYPOINT_PATCH=True;RECOVERY=True
    JOURNAL=STATE/'antigravity-qa-29-entrypoint-patch.json'
    BACKUP=STATE/'antigravity-qa-29-entrypoint-backup'
    OLD=PATCH_BASE;ALLOWED={'receiver.py'}


def patch_parent(expected):
    r.need(expected==PATCH_PARENT_SHA and i.sha(PATCH_PARENT)==expected,'parent recovery journal pin drift')
    parent=r.read(PATCH_PARENT,0)
    r.need(parent.get('controller')==PATCH_BASE and parent.get('phase')=='active-canary'
           and parent.get('canary_task_sha256')==PATCH_TASK,'wrong recovery parent release')
    return parent


def patch_configuration(proof,record):
    parent=patch_parent(proof.get('parent_journal_sha256'))
    r.need(all(i.sha(Path(k))==v['after'] for k,v in parent['changes'].items()),'parent installed effects drift')
    marker=r.read(MARKER,0);budget=r.read(BUDGET,0)
    r.need(i.sha(MARKER)==PATCH_MARKER_SHA and i.sha(BUDGET)==PATCH_BUDGET_SHA,'unchanged canary configuration pins required')
    from native_antigravity import qualification_descriptor
    q=qualification_descriptor(marker)
    r.need(marker.get('phase')=='canary' and q['task_sha256']==PATCH_TASK
           and q.get('adapter_revision')==marker.get('adapter_revision')==PATCH_BASE
           and i.sha(INSTALL/'native_antigravity.py')==PATCH_NATIVE,'same exact native canary required')
    r.need(budget.get('providers',{}).get('agy')=={'qa':2}
           and budget.get('slots',{}).get('slot2',{}).get('agy')=={'qa':2},'unchanged finite caps2 required')
    journal=r.journal('slot2');state,_=r.checkpoint('slot2')
    r.need(journal.get('pending') is None and journal.get('generation')==86
           and state.get('active') is None and digest(state)==recovery_module().CHECKPOINT,
           'entrypoint patch requires exact idle generation86')
    recovery_module().lineage_ready(r,q);recovery_module().executor_quiet();recovery_ledger()
    chain=dict(parent_journal=str(PATCH_PARENT),parent_journal_sha256=proof['parent_journal_sha256'],
               parent_controller=PATCH_BASE,inventory_before_sha256=digest(record),
               marker_sha256=encoded_hash(marker),budget_sha256=encoded_hash(budget),
               native_sha256=PATCH_NATIVE,canary_task_sha256=PATCH_TASK)
    return marker,chain


def verify_patch_chain(j,p):
    chain=j.get('patch_chain',{})
    r.need(j.get('schema')=='GB_AGY_ENTRYPOINT_PATCH_29_V1'
           and set(j.get('changes',{}))=={str(INSTALL/'receiver.py')}
           and digest(j.get('record_before'))==chain.get('inventory_before_sha256'),'invalid patch transaction scope')
    r.need(chain.get('parent_journal')==str(PATCH_PARENT) and chain.get('parent_controller')==PATCH_BASE
           and chain.get('canary_task_sha256')==j.get('canary_task_sha256')==PATCH_TASK
           and chain.get('native_sha256')==PATCH_NATIVE and chain.get('controller_after')==j['controller']
           and chain.get('receiver_after_sha256')==j.get('changes',{}).get(str(INSTALL/'receiver.py'),{}).get('after'),
           'invalid entrypoint patch lineage')
    parent=patch_parent(chain.get('parent_journal_sha256'))
    key=str(INSTALL/'receiver.py')
    before=j['changes'][key].get('before')
    parent_change=parent.get('changes',{}).get(key)
    record_before=j.get('record_before')
    prior=record_before.get('after') if isinstance(record_before,dict) else None
    r.need(isinstance(before,str) and re.fullmatch('[a-f0-9]{64}',before)
           and isinstance(parent_change,dict) and isinstance(prior,dict)
           and before==parent_change.get('after')==prior.get(key),
           'receiver before hash must match pinned parent and original inventory')
    r.need(p.get('controller_sha')==j['controller'],'patch controller drift')
    record=r.read(STATE/'backup.json',0)
    r.need(digest(record)==j.get('inventory_after_sha256') and record.get('manifest')==j['manifest']
           and all(i.sha(Path(k))==v for k,v in record['after'].items()),'current patch inventory drift')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items())
           and i.sha(INSTALL/'native_antigravity.py')==PATCH_NATIVE,'current patch payload drift')



def recovery_module():
    if RECOVERY_MODULE is not None:return RECOVERY_MODULE
    import antigravity_qa_recovery
    return antigravity_qa_recovery


def recovery_mode():
    global RECOVERY,JOURNAL,BACKUP,OLD,ALLOWED
    RECOVERY=True
    JOURNAL=STATE/'antigravity-qa-29-recovery-upgrade.json'
    BACKUP=STATE/'antigravity-qa-29-recovery-backup'
    OLD=RECOVERY_OLD;ALLOWED=RECOVERY_ALLOWED


def recovery_ledger():
    """Cumulative original usage, independent of the daily Budget window."""
    counts={}
    for slot in ('slot1','slot2'):
        path=r.AUTONOMY/'outbox'/slot/'ledger.json'
        ledger=r.read(path) if path.exists() else {}
        values=[day.get('agy',{}).get('qa',0) for day in ledger.values()]
        r.need(all(type(x) is int and x>=0 for x in values),'invalid cumulative AGY ledger')
        counts[slot]=sum(values)
    r.need(counts=={'slot1':0,'slot2':1},'exact original AGY used1 must be retained')
    return counts


@contextmanager
def recovery_quiescence(C):
    """Exact read-only proof view; never alter C.quiet or any on-disk journal."""
    if not RECOVERY or ENTRYPOINT_PATCH:
        yield C;return
    recovery=recovery_module()
    original=C.r
    def quiet():
        j=r.journal('slot2')
        if ONE_SHOT:recovery.grant_history(r,j)
        else:recovery.original_proof(r,j)
        process=recovery.SECOND_PROCESS if ONE_SHOT else recovery.PARENT_PROCESS
        operation=recovery.SECOND_OPERATION if ONE_SHOT else recovery.PARENT_OPERATION
        generation=86 if ONE_SHOT else recovery.GENERATION
        state,_=r.checkpoint('slot2')
        r.need(state.get('active') is None and digest(state)==recovery.CHECKPOINT,'original checkpoint changed')
        r.need(not r.alive(process),'original process alive')
        actual=r.identity(process['pid'])
        r.need(actual is not None or not Path('/proc',str(process['pid'])).exists(),
               'original process identity unknown')
        recovery.executor_quiet();r.no_models(978,'slot2')
        r.free_lock(r.AUTONOMY/'slots/slot2/worker.lock');r.free_lock(r.AUTONOMY/'locks/slot2.lease')
        r.need(j.get('pending')==operation and j.get('generation')==generation,
               'exact parent pending/generation required')
        def view(slot):
            value=original.journal(slot)
            if slot=='slot2':value=copy.deepcopy(value);value['pending']=None
            return value
        C.r=SimpleNamespace(**(vars(original)|{'journal':view}))
        try:original_quiet()
        finally:C.r=original
    original_quiet=C.quiet
    # A proxy calls the existing helper with a scoped view and restores it even on failure.
    yield SimpleNamespace(**(vars(C)|{'quiet':quiet}))


SOURCE_UID=1002
BIN_SOURCE=Path('/home/agentagency-dev/.local/bin/agy')
BIN_TARGET=Path('/opt/gb-slots/runtime/antigravity/agy')
AGY_SHA='8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c'
AUTH_SOURCE=Path('/home/agentagency-dev/.gemini/antigravity-cli/antigravity-oauth-token')
AUTH_TARGET=Path('/srv/gb-slots/slot2/home/.gemini/antigravity-cli/antigravity-oauth-token')


def provisioning():
    for source in (BIN_SOURCE,AUTH_SOURCE):
        info=source.lstat()
        r.need(stat.S_ISREG(info.st_mode) and info.st_uid==SOURCE_UID and info.st_nlink==1
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
    if RECOVERY:
        for root in (LEGACY_JOURNAL,LEGACY_BACKUP,STATE/'antigravity-qa-qualification.json'):
            r.need(root.exists(),'missing original AGY history')
            paths=[root] if root.is_file() else sorted(x for x in root.rglob('*') if x.is_file())
            for path in paths:out[str(path)]=i.sha(path)
    if ONE_SHOT:
        for path in STATE.rglob('*'):
            if path.is_file() and path not in (JOURNAL,STATE/'backup.json',STATE/'planning.json') and BACKUP not in path.parents:
                out[str(path)]=i.sha(path)
        out[str(BUDGET)]=i.sha(BUDGET)
    if ENTRYPOINT_PATCH:
        r.need(PATCH_PARENT_BACKUP.is_dir(),'missing original recovery backup')
        for path in sorted(x for x in PATCH_PARENT_BACKUP.rglob('*') if x.is_file()):out[str(path)]=i.sha(path)
        for path in (PATCH_PARENT,STATE/'antigravity-29-qualification-reconcile.json',STATE/'antigravity-qa-lineage-29.json',MARKER,BUDGET):
            out[str(path)]=i.sha(path)
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
    if ENTRYPOINT_PATCH:verify_patch_chain(j,p)
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
        marker_pin=j['patch_chain']['marker_sha256'] if ENTRYPOINT_PATCH else j['changes'][str(MARKER)]['after']
        budget_pin=PATCH_BUDGET_SHA if ONE_SHOT else j['patch_chain']['budget_sha256'] if ENTRYPOINT_PATCH else j['changes'][str(BUDGET)]['after']
        r.need(marker['phase']=='canary' and encoded_hash(marker)==marker_pin
               and encoded_hash(budget)==budget_pin,'qualification config drift')
        q=marker['qualification'];matches=[]
        for key,op in ops['operations'].items():
            if RECOVERY:
                if recovery_module().acceptance_match(op,q):matches.append((key,op))
                continue
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
        # Standard normal QA authorization only AFTER exact fresh qualification.
        # This never resets counters or authorizes another qualification grant.
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
            if ONE_SHOT and target==BUDGET:j['normal_qa_budget_sha256']=encoded_hash(intent[key+'_after'])
            elif not ENTRYPOINT_PATCH:j['changes'][str(target)]['after']=encoded_hash(intent[key+'_after'])
        j['phase']='active-ready';r.atomic(JOURNAL,j)
    r.publish_monitor(p)
    return {'phase':'active-ready','accepted_canary':intent['marker_after']['accepted_canary'],
            'history_preserved':True}


def reviewed_configuration(proof,budget,module_hashes):
    if ONE_SHOT:return one_shot_configuration(proof,budget,module_hashes)
    marker=proof['marker']
    r.need(marker.get('schema')=='GB_ANTIGRAVITY_QA_29_V1' and marker.get('phase')=='canary'
           and marker.get('executor_uid')==978 and marker.get('slot')=='slot2'
           and re.fullmatch('[a-f0-9]{64}',marker.get('canary_task_sha256','')),
           'invalid bounded canary marker')
    if RECOVERY:
        q=marker.get('qualification',{});recovery=recovery_module()
        extra={'parent_task_sha256','parent_operation','adapter_revision'}
        r.need(set(q)=={'issue','base','head','work','task_sha256'}|extra and q.get('issue')==29
               and q.get('work')=='/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary'
               and all(re.fullmatch('[a-f0-9]{40}',q.get(k,'') or '') for k in ('base','head','adapter_revision'))
               and marker.get('adapter_revision')==q['adapter_revision'] and recovery.successor(q),
               'exact original parent and reviewed successor required')
        task=dict(schema='GB_ANTIGRAVITY_QA_29_TASK_V2',issue=29,role='qa_qualification',slot='slot2',
                  base=q['base'],head=q['head'],model='claude-sonnet-5-5-medium',max_calls=1,
                  **{k:q[k] for k in extra})
        r.need(q['task_sha256']==marker['canary_task_sha256']==digest(task),'successor task drift')
        r.need(marker.get('modules')=={k:module_hashes[k] for k in ('native_antigravity.py','native_guard.py')},
               'qualification module pin mismatch')
        r.need(budget.get('providers',{}).get('agy')=={'qa':1}
               and budget.get('slots',{}).get('slot2',{}).get('agy')=={'qa':1}
               and 'agy' not in budget.get('slots',{}).get('slot1',{}),'exact finite original caps required')
        nextbudget=copy.deepcopy(budget)
        nextbudget['providers']['agy']['qa']=2;nextbudget['slots']['slot2']['agy']['qa']=2
        return marker,nextbudget
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


def execute(action,bundle,manifest,controller,stage_hash,dispatch_hash,run_id=None,proof_sha=None):
    # Fresh invocation selects a closed mode; shared existing implementation remains unchanged.
    r.need(os.geteuid()==0,'reviewed root integrator only')
    r.trusted_tree(bundle)
    if RECOVERY:
        global RECOVERY_MODULE
        payload=i.payload(bundle,manifest)
        source=payload.get(INSTALL/'antigravity_qa_recovery.py')
        r.need(source is not None,'reviewed recovery helper missing')
        r.trusted_tree(source)
        spec=importlib.util.spec_from_file_location('_reviewed_agy29_recovery',source)
        RECOVERY_MODULE=importlib.util.module_from_spec(spec);spec.loader.exec_module(RECOVERY_MODULE)
    C,u=helpers(bundle)
    with recovery_quiescence(C) as checked:
        return execute_checked(action,bundle,manifest,controller,stage_hash,dispatch_hash,run_id,proof_sha,checked,u)


def execute_checked(action, bundle, manifest, controller, stage_hash, dispatch_hash, run_id, proof_sha,C,u):
    r.need(os.geteuid() == 0, 'reviewed root integrator only')
    r.trusted_tree(bundle)
    if action=='accept':
        j=r.read(JOURNAL,0);p=r.read(r.POLICY,0)
        r.need((manifest,controller,stage_hash,dispatch_hash,proof_sha)==
               (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256'],j['proof_sha256']),
               'acceptance release identity changed')
        return accept_canary(j,p)
    p = r.read(r.POLICY,0)
    if action=='reconcile':
        r.need(RECOVERY and not ENTRYPOINT_PATCH,'reconciliation is exact recovery mode only')
        j=r.read(JOURNAL,0)
        r.need((manifest,controller,stage_hash,dispatch_hash,proof_sha)==
               (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256'],j['proof_sha256'])
               and j['phase']=='active-canary' and p['mode']=='active' and p['controller_sha']==controller,
               'reviewed active recovery release required')
        r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items()),'installed recovery drift')
        from native_antigravity import qualification_descriptor
        return (recovery_module().reconcile_grant if ONE_SHOT else recovery_module().reconcile_parent)(r,qualification_descriptor(r.read(MARKER,0)))
    if action=='activate':
        j=r.read(JOURNAL,0)
        if ENTRYPOINT_PATCH:verify_patch_chain(j,p)
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
    r.need(proof.get('schema')==('GB_AGY_ONE_SHOT_PROOF_29_V1' if ONE_SHOT else 'GB_AGY_ENTRYPOINT_PATCH_PROOF_29_V1' if ENTRYPOINT_PATCH else 'GB_AGY_RECOVERY_PROOF_29_V1' if RECOVERY else 'GB_AGY_INSTALL_PROOF_29_V1') and proof.get('reviewed') is True,
           'missing reviewed exact qualification proof')
    chain=None
    if ENTRYPOINT_PATCH:
        marker,chain=patch_configuration(proof,record)
        virtual={}
    else:
        if RECOVERY and not ONE_SHOT:
            oldmarker=r.read(MARKER,0)
            r.need(oldmarker.get('phase')=='canary' and oldmarker.get('canary_task_sha256')==recovery_module().PARENT_TASK,
                   'exact original marker required')
            r.need(proof.get('baseline_marker_sha256')==i.sha(MARKER),'original marker drift')
            recovery_ledger()
        elif not RECOVERY:r.need(not MARKER.exists(),'existing AGY qualification; preserve and inspect')
        marker,nextbudget=reviewed_configuration(proof,r.read(BUDGET,0),
            {name:i.sha(bundle/'scripts/chatops/actions_train'/name) for name in ('native_antigravity.py','native_guard.py')})
        if ONE_SHOT:r.need(marker['qualification']['qualification_grant']['controller_revision']==controller,'one-shot controller proof drift')
        virtual={MARKER:marker} if ONE_SHOT else {MARKER:marker,BUDGET:nextbudget}
    def encoded(value):return json.dumps(value,sort_keys=True).encode()
    if not RECOVERY:changed.update(provisioning())
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
    if ONE_SHOT:j.update(schema='GB_AGY_ONE_SHOT_UPGRADE_29_V1',one_shot_grant=marker['qualification']['qualification_grant'])
    if ENTRYPOINT_PATCH:
        chain.update(controller_after=controller,receiver_after_sha256=changes[str(INSTALL/'receiver.py')]['after'])
        j.update(schema='GB_AGY_ENTRYPOINT_PATCH_29_V1',patch_chain=chain)
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
    if ENTRYPOINT_PATCH:
        j['inventory_after_sha256']=digest(nextrecord);r.atomic(JOURNAL,j)
    r.atomic(STATE/'backup.json',nextrecord)
    nextpolicy=copy.deepcopy(p)
    nextpolicy.update(mode='disabled',controller_sha=controller,stage_workflow_sha256=stage_hash)
    nextpolicy['recovery']['source_sha']=controller
    r.atomic(r.POLICY,nextpolicy,mode=0o644)
    j['phase']='installed-disabled';r.atomic(JOURNAL,j)  # Fresh process publishes; no cached imported pins.
    return {'phase':j['phase'],'canary_task_sha256':marker['canary_task_sha256'],'history_preserved':True}


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('action',choices=('dry','apply','activate','rollback','accept','reconcile'))
    mode=ap.add_mutually_exclusive_group()
    mode.add_argument('--qualification-recovery',action='store_true')
    mode.add_argument('--entrypoint-patch',action='store_true')
    mode.add_argument('--one-shot-qualification',action='store_true')
    ap.add_argument('--bundle',required=True,type=Path);ap.add_argument('--manifest',required=True)
    ap.add_argument('--controller',required=True);ap.add_argument('--stage-hash',required=True)
    ap.add_argument('--dispatch-hash',required=True);ap.add_argument('--run',type=int)
    ap.add_argument('--proof-sha256',required=True)
    a=ap.parse_args()
    if a.qualification_recovery:recovery_mode()
    if a.entrypoint_patch:entrypoint_patch_mode()
    if a.one_shot_qualification:one_shot_mode()
    lock=None if a.action=='reconcile' else r.locked(STATE/'controller.lock')
    try: print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run,a.proof_sha256),sort_keys=True))
    finally:
        if lock is not None:os.close(lock)


if __name__=='__main__': main()
