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
import stat
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
QUALIFICATION_PROOF = Path('docs/handoffs/cursor-author-211/QUALIFICATION_PROOF.json')
RUNTIME_MODULES = {
    'native_cursor.py':'02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089',
    'native_guard.py':'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762'}
# Root-owned materializations of the Owner-pinned independent runtime evidence.
# These locations are NOT permission to run the historical qualification launchers.
RUNTIME_EVIDENCE = {
    'runtime_qa_v18_launcher':('cursor-qualification-20261022/runtime-qa-v18-launcher.py',
        '8f35a86f64119661cecdc7710e8df4acd63baddd83ed66a5a02e3eb39e9bf481'),
    'runtime_qa_v18_stream':('cursor-qualification-20261022/runtime-qa-v18-stream.jsonl',
        'a70fc6301962bb84efad730498f1856401cf319d6f160421c09ae8058f1117aa'),
    'runtime_qa_v20_stream':('cursor-qualification-20261022/runtime-qa-v20-stream.jsonl',
        'e3730ce3f9f8e4f0b8eec575d351d2dc2ae8fa263a83154ce7705d59bc511a70'),
    'runtime_qa_v20_qa':('cursor-qualification-20261022/runtime-qa-v20-qa.json',
        'af8d263e5c29f97626d85998067b2fc836aa7906c013b1f19c0176229e3e3d12'),
    'author_private_config_stream':('cursor-qualification-20261022/author-canary-private-config-stream.jsonl',
        '958a03c8201ed99b9af3836f6a859f1e834a52b6162cfddb1d6b150da463f85f'),
    'author_private_config':('cursor-qualification-20261022/author-canary-private-config.json',
        '517e8adac61d6ae901a34eaf814a55bdaf20921f158ab775a14b7e2a535f9379'),
    'author_canary':('cursor-qualification-20261022/author-canary.json',
        '7bbbb6bf7b6a8537b7d6d39d0e375a81d44456dae9e5a553bfe31137863d442b'),
    'boundaries_corrected':('cursor-qualification-20261022/boundaries-corrected.json',
        'fb8d46024fdbf4aca7a9e7a13172fef8dbfb89230124e0a66478482276414074'),
    'boundaries':('cursor-qualification-20261022/boundaries.json',
        '9e705f5acace5dcb12af20acccc6d7810532018cdf236cab8296cdaa421f0ab5'),
    'manifest':('cursor-qualification-20261022/manifest.json',
        '5aa6a2d70ef44363b6651e55d4aadc29f6c886e6f5cbe4720bce1d110c1fa46f'),
    'probe':('cursor-qualification-20261022/probe.json',
        '9374706705fe275a40b2448b713bd292f11d67bdf3f16990ed53f0a39a02b67c'),
    'author_receipt':('cursor-successor-225-result/cursor-author-receipt.json',
        'b48880aaf8281c139b973d39a36a8c0c2a4ca49c71e81fd74754b7606e04e850')}


def runtime_bytes(path, limit=64 << 20):
    """Read one immutable root-owned regular file through no-follow descriptors."""
    path = Path(path)
    r.need(path.is_absolute() and '..' not in path.parts, 'absolute runtime evidence path required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            os.close(fd); fd = child
            info = os.fstat(fd)
            r.need(info.st_uid == 0 and not info.st_mode & 0o022, 'untrusted runtime evidence metadata')
        info = os.fstat(fd)
        r.need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'invalid runtime evidence file')
        with os.fdopen(os.dup(fd), 'rb') as source:
            raw = source.read(limit + 1)
        r.need(len(raw) <= limit, 'runtime evidence too large')
        return raw
    except OSError:
        r.need(False, 'runtime evidence missing or unsafe')
    finally:
        os.close(fd)


def runtime_evidence(proof_path, task_hash, expected_sha=None):
    raw = runtime_bytes(proof_path, 65536)
    proof_sha = hashlib.sha256(raw).hexdigest()
    r.need(expected_sha is None or proof_sha == expected_sha, 'runtime proof sha256 changed')
    proof = r.loads(raw)  # Reject duplicate keys as well as a non-closed schema.
    expected = {'schema':'GB_CURSOR_RUNTIME_QUALIFICATION_PROOF_V1',
        'acceptance_basis':'runtime_qualification', 'canary_task_sha256':task_hash,
        'evidence':{key:{'path':str(STATE/name), 'sha256':sha}
                    for key,(name,sha) in RUNTIME_EVIDENCE.items()}}
    r.need(proof == expected, 'runtime qualification proof schema or pins changed')
    artifacts = {}
    for key, item in proof['evidence'].items():
        data = runtime_bytes(item['path'])
        r.need(hashlib.sha256(data).hexdigest() == item['sha256'], 'runtime evidence sha256 mismatch: '+key)
        if key == 'author_receipt': artifacts[key] = r.loads(data)
    return proof_sha, proof['evidence'], artifacts['author_receipt']


def runtime_identity(j, p, marker):
    r.need(p['mode']=='active' and p['controller_sha']==j['controller']
           and marker.get('phase')=='canary'
           and marker.get('canary_task_sha256')==j['canary_task_sha256']
           and marker.get('successor')==j['successor'], 'runtime canary acceptance identity')
    r.need(all(marker.get('modules',{}).get(k)==v for k,v in RUNTIME_MODULES.items()),
           'runtime marker module pins changed')
    for name, sha in marker['modules'].items():
        r.need(Path(name).name == name and hashlib.sha256(runtime_bytes(INSTALL/name)).hexdigest()==sha,
               'qualified adapter drift')
    r.need(all(i.sha(Path(k))==v['after'] for k,v in j['changes'].items() if k!=str(MARKER)),
           'installed code drift')


def runtime_author(task_hash):
    matches = []
    for slot in ('slot1','slot2'):
        ops = r.journal(slot)['operations']
        for key, op in acceptance_operations(ops,'author',task_hash,None).items():
            matches.append((slot, key, op, ops))
    r.need(len(matches)==1, 'one confirmed runtime canary author required')
    slot, key, op, ops = matches[0]
    route = op['result'].get('routing') or {}
    r.need(route.get('provider')=='cursor' and route.get('effective_model')=='Auto'
           and type(route.get('usage',{}).get('charged_calls')) is int
           and route['usage']['charged_calls']==1
           and route.get('native_receipt',{}).get('phase')=='imported',
           'runtime canary executor/confirmation mismatch')
    outcomes = [v for v in ops.values() if v['binding']['issue']==225
                and v['binding']['stage'] in ('qa','dev') and v.get('task_hash')==task_hash
                and v.get('finished_at')]
    r.need(outcomes and all(op['finished_at'] < v['finished_at'] for v in outcomes),
           'runtime author must precede QA/DEV outcome')
    return slot, key, op


def runtime_validation(j, p, intent):
    runtime_identity(j,p,intent['old_marker'])
    proof = intent['proof']
    proof_sha, evidence, receipt = runtime_evidence(Path(intent['proof_path']),
        j['canary_task_sha256'],proof['qualification_proof_sha256'])
    slot, key, op = runtime_author(j['canary_task_sha256'])
    r.need(proof == {'acceptance_basis':'runtime_qualification','slot':slot,'author_run':op['run'],
               'qualification_proof_sha256':proof_sha,'evidence':evidence}
           and intent['operations']=={key:digest(op)}
           and receipt==op['result']['routing']['native_receipt']
           and receipt.get('task_sha256')==j['canary_task_sha256'] and receipt.get('issue')==225,
           'runtime qualification operation evidence changed')


def accept_runtime(bundle, dry_run=False, proof_sha256=None):
    j = r.read(JOURNAL,0); p = r.read(r.POLICY,0); marker = r.read(MARKER,0)
    r.need(dry_run or re.fullmatch('[a-f0-9]{64}',proof_sha256 or ''),
           'apply requires --proof-sha256 from reviewed dry-run')
    if j['phase'] in ('qualifying-ready','active-ready'):
        intent = j['qualification_intent']
        r.need(intent['proof'].get('acceptance_basis')=='runtime_qualification'
               and intent['proof_path']==str(bundle/QUALIFICATION_PROOF)
               and (proof_sha256 is None or intent['proof']['qualification_proof_sha256']==proof_sha256),
               'runtime qualification intent identity changed')
        return complete_qualification(j,p,marker,dry_run=dry_run)
    r.need(j['phase']=='active-canary', 'runtime acceptance requires active-canary')
    runtime_identity(j,p,marker)
    r.need(encoded_hash(marker)==j['changes'][str(MARKER)]['after']
           and hashlib.sha256(runtime_bytes(MARKER,65536)).hexdigest()==encoded_hash(marker),
           'foreign qualification marker drift')
    path = bundle/QUALIFICATION_PROOF
    proof_sha, evidence, _ = runtime_evidence(path,j['canary_task_sha256'],proof_sha256)
    slot, key, op = runtime_author(j['canary_task_sha256'])
    proof = {'acceptance_basis':'runtime_qualification','slot':slot,'author_run':op['run'],
             'qualification_proof_sha256':proof_sha,'evidence':evidence}
    qualified_at = int(time.time())
    nextmarker = marker | {'phase':'ready','accepted_canary':proof,'qualified_at':qualified_at}
    intent = {'policy':p,'controller':j['controller'],'task_sha256':j['canary_task_sha256'],
        'successor':j['successor'],'proof':proof,'proof_path':str(path),'operations':{key:digest(op)},
        'old_marker':marker,'old_hash':encoded_hash(marker),'next_marker':nextmarker,
        'next_hash':encoded_hash(nextmarker),'qualified_at':qualified_at}
    runtime_validation(j,p,intent)
    j.update(phase='qualifying-ready',accepted_canary=proof,qualification_intent=intent)
    if not dry_run: r.atomic(JOURNAL,j)
    return complete_qualification(j,p,marker,dry_run=dry_run)


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


def complete_qualification(j,p,marker,dry_run=False):
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
    if intent['proof'].get('acceptance_basis')=='runtime_qualification':
        r.need(hashlib.sha256(runtime_bytes(MARKER,65536)).hexdigest()==actual,
               'foreign qualification marker bytes drift')
        r.need(j['changes'][str(MARKER)]['after']==
               (intent['next_hash'] if j['phase']=='active-ready' else intent['old_hash']),
               'runtime qualification journal marker drift')
        runtime_validation(j,p,intent)
    if dry_run:
        r.need(actual!=intent['old_hash'] or j['phase']=='qualifying-ready',
               'completed qualification marker changed')
        return {'dry_run':True,'phase':j['phase'],'would_change':{'marker_phase':'ready',
            'journal_phase':'active-ready','old_hash':intent['old_hash'],'new_hash':intent['next_hash']},
            'accepted_canary':intent['proof']}
    if actual==intent['old_hash']:
        r.need(j['phase']=='qualifying-ready', 'completed qualification marker changed')
        r.atomic(MARKER,intent['next_marker'],mode=0o644)
    if j['phase']!='active-ready':
        j['changes'][str(MARKER)]['after']=intent['next_hash']
        j['phase']='active-ready';r.atomic(JOURNAL,j)
    r.publish_monitor(p)
    return {'phase':'active-ready','accepted_canary':intent['proof']}


def rollback_runtime(C):
    """Metadata-only, write-ahead revert; retain every qualification and task receipt."""
    C.quiet()  # Existing disabled/quiescent window, including workers and recovery.
    j = r.read(JOURNAL,0); p = r.read(r.POLICY,0); marker = r.read(MARKER,0)
    r.need(hashlib.sha256(runtime_bytes(MARKER,65536)).hexdigest()==encoded_hash(marker),
           'foreign runtime rollback marker bytes drift')
    if j['phase']=='active-canary' and j.get('qualification_history'):
        previous = j['qualification_history'][-1]['intent']
        r.need(p==previous['policy'] | {'mode':'disabled'}
               and encoded_hash(marker)==previous['old_hash']
               and j['changes'][str(MARKER)]['after']==previous['old_hash'], 'runtime rollback replay drift')
        return {'phase':'active-canary','history_preserved':True}
    r.need(j['phase'] in ('qualifying-ready','active-ready','reverting-canary'),
           'runtime rollback requires qualification intent')
    intent = j['qualification_intent']
    r.need(intent['proof'].get('acceptance_basis')=='runtime_qualification'
           and p==intent['policy'] | {'mode':'disabled'}
           and intent['controller']==j['controller'] and intent['successor']==j['successor']
           and intent['task_sha256']==j['canary_task_sha256'], 'runtime rollback identity drift')
    r.need(encoded_hash(intent['old_marker'])==intent['old_hash']
           and encoded_hash(intent['next_marker'])==intent['next_hash']
           and intent['next_marker']==intent['old_marker'] | {'phase':'ready',
               'accepted_canary':intent['proof'],'qualified_at':intent['qualified_at']},
           'runtime rollback marker intent changed')
    runtime_identity(j,intent['policy'],intent['old_marker'])
    r.need(encoded_hash(marker) in (intent['old_hash'],intent['next_hash'])
           and j['changes'][str(MARKER)]['after'] in (intent['old_hash'],intent['next_hash']),
           'foreign runtime rollback marker drift')
    if j['phase']!='reverting-canary':
        j.update(phase='reverting-canary',runtime_rollback_at=int(time.time()))
        r.atomic(JOURNAL,j)
    if encoded_hash(marker)!=intent['old_hash']:
        r.atomic(MARKER,intent['old_marker'],mode=0o644)
    j.setdefault('qualification_history',[]).append({'intent':intent,'rolled_back_at':j['runtime_rollback_at']})
    j.pop('qualification_intent'); j.pop('accepted_canary',None)
    j['changes'][str(MARKER)]['after']=intent['old_hash']
    j['phase']='active-canary'; r.atomic(JOURNAL,j)
    return {'phase':'active-canary','history_preserved':True}



def acceptance_operations(operations,stage,task_hash,head):
    # Integration may require a second independent QA. Only the final exact-SHA
    # QA/DEV is acceptance evidence; preserve earlier verdicts and count every author.
    return {k:v for k,v in operations.items() if v['binding']['issue']==225
        and v['binding']['stage']==stage and v.get('task_hash')==task_hash
        and v.get('finished_at') and v.get('result',{}).get('status')=='confirmed'
        and (stage=='author' or (v['result'].get('checkpoint') or {}).get('head')==head)}


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
            found=acceptance_operations(ops['operations'],stage,j['canary_task_sha256'],active['head'])
            r.need(len(found)==1,'ambiguous or incomplete canary stage')
            key,value=next(iter(found.items()))
            stages[stage]=value
            operation_hashes[key]=digest(value)
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
        accepted_operation_hashes=operation_hashes
    r.need(len(matches)==1,'one actual completed Cursor canary required')
    proof=matches[0]
    qualified_at=int(time.time())
    nextmarker=marker | {'phase':'ready','accepted_canary':proof,'qualified_at':qualified_at}
    intent={'policy':p,'controller':j['controller'],'task_sha256':j['canary_task_sha256'],
        'successor':j['successor'],'proof':proof,'operations':accepted_operation_hashes,
        'old_marker':marker,'old_hash':encoded_hash(marker),'next_marker':nextmarker,
        'next_hash':encoded_hash(nextmarker),'qualified_at':qualified_at}
    j.update(phase='qualifying-ready',accepted_canary=proof,qualification_intent=intent)
    r.atomic(JOURNAL,j)  # Complete deterministic intent before marker effects.
    return complete_qualification(j,p,marker)


def execute(action, bundle, manifest, controller, stage_hash, dispatch_hash, run_id=None,
            dry_run=False, proof_sha256=None):
    r.need(os.geteuid() == 0, 'reviewed root integrator only')
    r.trusted_tree(bundle)
    r.need(not dry_run or action=='accept-runtime', '--dry-run requires accept-runtime')
    r.need(proof_sha256 is None or action=='accept-runtime', '--proof-sha256 requires accept-runtime')
    if action in ('accept','accept-runtime','rollback-runtime'):
        j=r.read(JOURNAL,0)
        r.need((manifest,controller,stage_hash,dispatch_hash)==
            (j['manifest'],j['controller'],j['stage_sha256'],j['dispatch_sha256']),
            'unreviewed acceptance helper bundle')
        if action=='accept-runtime':
            return accept_runtime(bundle,dry_run=dry_run,proof_sha256=proof_sha256)
        if action=='rollback-runtime':
            C,_=helpers(bundle)
            return rollback_runtime(C)
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
    ap.add_argument('action',choices=('dry','apply','activate','rollback','accept','accept-runtime','rollback-runtime'))
    ap.add_argument('--bundle',required=True,type=Path);ap.add_argument('--manifest',required=True)
    ap.add_argument('--controller',required=True);ap.add_argument('--stage-hash',required=True)
    ap.add_argument('--dispatch-hash',required=True);ap.add_argument('--run',type=int)
    ap.add_argument('--dry-run',action='store_true');ap.add_argument('--proof-sha256')
    a=ap.parse_args();lock=r.locked(STATE/'controller.lock')
    try: print(json.dumps(execute(a.action,a.bundle,a.manifest,a.controller,a.stage_hash,a.dispatch_hash,a.run,
                                dry_run=a.dry_run,proof_sha256=a.proof_sha256),sort_keys=True))
    finally: os.close(lock)


if __name__=='__main__': main()
