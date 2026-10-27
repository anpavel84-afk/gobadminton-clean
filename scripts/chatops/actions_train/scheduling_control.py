"""Scheduling adapters for the existing receiver journal and finite nonroot stage.

No registry, queue, model, publication or legacy Bridge.resume call. Root consumes
only config/state metadata; Store/Bridge verification runs after the UID drop.
"""
import base64
import copy
import datetime as dt
import hashlib
import os
from pathlib import Path
import re
import stat
import time
from core import (CONTROL_STAGES, OWNER, REPO, SHA, SINCE, binding, digest,
                  loads, need, next_stage)
from test_plan_gate import OK, check

MARKER = 'GOBADMINTON_SCHEDULING_CONTROL_V1'
HEX = re.compile('[0-9a-f]{64}')


def admission_body(req):
    """Creation precedes ID allocation. Only the self reference is delivery data."""
    projected = copy.deepcopy(binding(req))
    projected['control'].pop('comment', None)
    return dict(schema=MARKER, request=projected)


def validate_request(req):
    from core import request
    need(set(req) == {'action', 'stage', 'slot', 'issue', 'phase', 'head', 'attempt',
                     'generation', 'run', 'run_attempt', 'profile', 'gh_token', 'control'},
         'unknown scheduling fields')
    need(req['stage'] in CONTROL_STAGES, 'unknown scheduling stage')
    request({k: ('qa' if k == 'stage' else v) for k, v in req.items() if k != 'control'})
    c = req['control']
    need(type(c) is dict and set(c) == {'comment', 'snapshot', 'archive', 'operation', 'proof', 'base', 'pr'},
         'unknown scheduling control fields')
    need(type(c['comment']) is int and c['comment'] > 0, 'invalid control comment')
    for name in ('snapshot', 'archive', 'operation', 'proof'):
        need((name != 'snapshot' and c[name] is None) or
             isinstance(c[name], str) and HEX.fullmatch(c[name]), 'invalid control ' + name)
    need(isinstance(c['base'], str) and SHA.fullmatch(c['base']), 'invalid control base')
    need(c['pr'] is None or type(c['pr']) is int and c['pr'] > 0, 'invalid control PR')
    need((req['stage'] == 'park' and c['archive'] is c['operation'] is c['proof'] is None) or
         (req['stage'] == 'resume' and c['archive'] is not None and c['operation'] is c['proof'] is None) or
         (req['stage'] == 'reconcile' and c['operation'] is not None and c['proof'] is not None
          and c['archive'] is None), 'invalid scheduling operation references')
    return req


def admission(req, api):
    """Existing authenticated API and numeric Owner, immutable exact comment admission."""
    api.identity()
    c = api(f'issues/comments/{req["control"]["comment"]}')
    need(type(c.get('id')) is int and c['id'] == req['control']['comment']
         and type(c.get('user', {}).get('id')) is int and c['user']['id'] == OWNER
         and c.get('issue_url') == f'https://api.github.com/repos/{REPO}/issues/{req["issue"]}'
         and c.get('created_at') == c.get('updated_at'), 'control admission identity/edited comment')
    created = dt.datetime.fromisoformat(c['created_at'].replace('Z', '+00:00'))
    need(dt.datetime.fromisoformat(SINCE) <= created <= dt.datetime.now(dt.timezone.utc),
         'control admission outside enrollment')
    body = c.get('body')
    need(isinstance(body, str) and len(body.encode()) <= 8192, 'control admission size')
    marker, sep, raw = body.partition('\n')
    need(marker == MARKER and sep and loads(raw) == admission_body(req),
         'control admission/request mismatch')
    return digest(c)


def exact_active(active, req):
    need(type(active) is dict and all(active.get(k) == req[k] for k in ('issue','phase','head','attempt'))
         and active.get('base') == req['control']['base'] and active.get('pr') == req['control']['pr']
         and digest(active) == req['control']['snapshot'], 'control snapshot mismatch')


def plan_gate(active, req):
    # Even archive/reconcile is not an exemption from the accepted TEST PLAN.
    checked = check(active, dict(req, _task_hash=digest(active['task'])), structural_only=True)
    need(checked['status'] in OK, checked['status'])
    return checked


def installed_inventory(R, policy):
    """The root install record is authority; the packaging manifest is not installed.

    Closed destination set from installer.payload. Never follow receipt-selected
    paths. Unknown upgrade formats/unfinished edges HOLD for trusted OPS review.
    """
    modules = set(('admission_pm antigravity_qa_recovery client content_identity '
        'context_cursor_delivery context_exchange context_native_delivery context_policy '
        'core cost_policy failure_diagnosis installer monitor native_antigravity '
        'native_antigravity_author native_cursor native_guard owner_package_admission '
        'qa_equivalence qa_recovery queue_diagnostics receiver recovery recovery_admission '
        'recovery_publish recovery_upgrade scheduling_control smart_routing stage test_plan_gate').split())
    names = {n+'.py' for n in modules} | {'live/autonomous_issues.py', 'live/slots.py',
        'live/check_foundation.py', 'monitor-mapping.json', 'monitor_extension.js',
        'accepted-engineering-rules.md'}
    external = {Path('/usr/local/sbin/gb-deploy-helper.sh'): 0o755,
        Path('/usr/local/lib/gb-ops-monitor/opsmon/writer.py'): 0o644,
        Path('/usr/local/lib/gb-ops-monitor/web/app.js'): 0o644}
    allowed = {str(R.HERE/n): 0o644 for n in names} | {str(p): m for p,m in external.items()}
    info = R.read(R.STATE/'backup.json', 0, snapshot=True)
    need(info['mode'] == 0o600 and info['gid'] == 0, 'installed inventory metadata drift')
    record = info['value']
    need(type(record) is dict and set(record) ==
         {'schema','manifest','before','after','units','activated','targets'}
         and record['schema'] == 'GB_ACTIONS_TRAIN_BACKUP_V1'
         and type(record['activated']) is bool
         and isinstance(record['manifest'], str) and HEX.fullmatch(record['manifest'])
         and type(record['after']) is dict and type(record['before']) is dict
         and type(record['units']) is dict and type(record['targets']) is list,
         'invalid installed inventory')
    pins = record['after']
    # The supplied real baseline has 32 destinations. Later reviewed libraries
    # may extend it without turning the source packaging manifest into inventory.
    optional = {'admission_pm.py','context_cursor_delivery.py','context_native_delivery.py',
                'native_antigravity_author.py','scheduling_control.py','smart_routing.py','test_plan_gate.py'}
    required = set(allowed) - {str(R.HERE/n) for n in optional}
    need(required <= set(pins) <= set(allowed)
         and set(record['before']) == set(record['targets'])
         and len(record['targets']) == len(set(record['targets']))
         and set(record['targets']) <= set(pins), 'installed inventory membership')
    need(all(v is None or isinstance(v,str) and HEX.fullmatch(v) for v in record['before'].values()),
         'invalid inventory preimages')
    for path in R.HERE.rglob('*'):
        metadata = path.lstat()
        need(not stat.S_ISLNK(metadata.st_mode), 'indirect installed inventory path')
        if not stat.S_ISDIR(metadata.st_mode):
            need(str(path) in pins, 'unrecorded installed dependency')
    result = dict(inventory=info, files={})
    for path, pin in pins.items():
        need(isinstance(pin,str) and HEX.fullmatch(pin), 'invalid inventory digest')
        current = R.read(Path(path), 0, snapshot=True, json_data=False)
        need(current['sha256'] == pin and current['mode'] == allowed[path] and current['gid'] == 0,
             'installed inventory byte/mode drift')
        result['files'][path] = current
    receipts = list(R.STATE.glob('*.json'))
    need(len(receipts) <= 512, 'installed transaction scan bound HOLD')
    for path in receipts:
        if path.name == 'stage5-cursor-context.json': continue
        receipt = R.read(path,0)
        if not isinstance(receipt,dict) or not isinstance(receipt.get('changes'),dict): continue
        relevant = set(allowed) | {str(R.POLICY)} | names
        need(not (set(receipt['changes']) & relevant),
             'unsupported installed transaction closure HOLD: '+path.name)
    # Existing Stage5 receipt: retain actual OLD bytes, exact inventory edge,
    # reviewed NEW metadata and the entire frozen relevant dependency closure.
    journal = R.STATE/'stage5-cursor-context.json'
    if os.path.lexists(journal):
        receipt = R.read(journal, 0, snapshot=True); j = receipt['value']
        need(set(j) == {'schema','identity','identity_sha256','phase','installed_at','changes',
             'inventory_before','inventory_after','policy','preserved','shadow'}
             and j['schema'] == 'GB_STAGE5_CURSOR_LIB_ONLY_V2'
             and j['phase'] in ('installed-lib-only','proof-recorded')
             and j['identity_sha256'] == digest(j['identity'])
             and set(j['changes']) == {'stage.py','context_cursor_delivery.py'},
             'partial upgrade ACTIVE_OR_UNKNOWN/unsupported receipt')
        ident = j['identity']
        need(set(ident) == {'baseline','controller','stage_sha256','dispatch_sha256','manifest',
             'bundle_commit','bundle_branch','script_sha256'}
             and all(isinstance(ident[n],str) and SHA.fullmatch(ident[n])
                     for n in ('baseline','controller','bundle_commit'))
             and all(isinstance(ident[n],str) and HEX.fullmatch(ident[n])
                     for n in ('stage_sha256','dispatch_sha256','manifest','script_sha256'))
             and policy['controller_sha'] in (ident['baseline'],ident['controller']),
             'partial upgrade release identity drift')
        def meta(value):
            return {k:value[k] for k in ('sha256','mode','uid','gid')}
        need(meta(info) == j['inventory_after'] and
             meta(R.read(R.POLICY,0,snapshot=True)) == j['policy'], 'partial upgrade inventory/policy drift')
        backup = R.STATE/'stage5-cursor-context-backup'
        old = R.read(backup/'inventory',0,snapshot=True)
        need(meta(old) == dict(j['inventory_before'],mode=0o600), 'partial inventory OLD drift')
        before = old['value']; after = copy.deepcopy(before)
        for name,row in j['changes'].items():
            need(set(row) == {'before','after'}, 'partial upgrade change schema')
            path = str(R.HERE/name); prior = row['before']; new = row['after']
            need(before['after'].get(path) == (prior and prior['sha256'])
                 and meta(result['files'][path]) == new
                 and new == dict(prior or dict(mode=0o644,uid=0,gid=0),sha256=new['sha256']),
                 'partial upgrade OLD/NEW mismatch')
            if prior:
                retained = R.read(backup/name,0,snapshot=True,json_data=False)
                need(meta(retained) == dict(prior,mode=0o600), 'partial upgrade OLD bytes changed')
            after['after'][path] = new['sha256']
        need(record == after, 'partial upgrade frozen dependencies drift')
        result['transition'] = receipt
    return result


def root_metadata(R, slot, policy, *, qualification=False):
    """Fixed config/state metadata only. No caller paths or candidate Git/code as root.

    Exact JSON/metadata provide transaction CAS. Across PARK/RESUME only the
    known Budget usage format may advance; no grant/charge/receipt is rewritten.
    """
    paths = {R.POLICY, R.BUDGET}
    paths.update(p for p in R.STATE.glob('*.json')
                 if any(word in p.name for word in ('ledger', 'reservation', 'grant')))
    if qualification:
        # The pending qualification cannot permit unrelated writes in this slot.
        paths.update((R.AUTONOMY/'slots'/slot).glob('*.json'))
        from native_antigravity import MARKER as QUALIFICATION_MARKER
        paths.add(QUALIFICATION_MARKER)
    out = {}
    import pwd
    slot_owner = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2').pw_uid
    for ledger_slot in ('slot1','slot2'):
        owner = pwd.getpwnam('agentagency-dev' if ledger_slot == 'slot1' else 'gb-slot2').pw_uid
        for name in ('ledger.json', 'ledger.json.bak'):
            ledger = R.AUTONOMY/'outbox'/ledger_slot/name
            out[str(ledger)] = R.read(ledger, owner, snapshot=True) if os.path.lexists(ledger) else None
    for path in sorted(paths):
        owner = (slot_owner if path.is_relative_to(R.AUTONOMY/'slots'/slot) else 0)
        out[str(path)] = R.read(path, owner, snapshot=True)
    out['installed'] = dict(controller=policy['controller_sha'], inventory=installed_inventory(R, policy))
    if qualification:
        out['qualification_evidence'] = state_evidence(R, slot)
    return out


def daily_usage(value):
    """Closed Budget ledger shape. Preserve every historical day/cell."""
    need(type(value) is dict, 'invalid shared usage')
    for day, providers in value.items():
        need(isinstance(day,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',day)
             and type(providers) is dict and set(providers) <= {'codex','cursor','agy'}, 'invalid shared usage')
        for roles in providers.values():
            need(type(roles) is dict and set(roles) <= {'author','qa'} and
                 all(type(n) is int and n >= 0 for n in roles.values()), 'invalid shared usage')
    return value


def usage_extends(old, new):
    daily_usage(old); daily_usage(new)
    return all(day in new and provider in new[day] and role in new[day][provider]
               and new[day][provider][role] >= count
               for day,providers in old.items() for provider,roles in providers.items()
               for role,count in roles.items())


def preserved_since_park(R, frozen, current):
    """Cross-task comparison only; every individual control still uses exact CAS.

    Grants/reservations/install/policy remain immutable. Only Budget's known
    append/monotonic daily usage and rotating preimage backups may advance.
    Unknown accounting schemas HOLD, never a recursive numeric relaxation.
    """
    old = copy.deepcopy(frozen); new = copy.deepcopy(current)
    for slot in ('slot1','slot2'):
        path = str(R.AUTONOMY/'outbox'/slot/'ledger.json')
        backup = path+'.bak'
        for name in (path,backup):
            before = old.pop(name,None); after = new.pop(name,None)
            if before == after: continue
            need(after is not None, 'shared usage removed')
            if before:
                need(all(before[k] == after[k] for k in ('uid','gid','mode')),
                     'shared usage metadata drift')
            need(usage_extends(before['value'] if before else {},after['value']), 'shared usage decreased')
        live = current.get(path); prior = current.get(backup)
        if prior:
            need(live and usage_extends(prior['value'],live['value']), 'usage backup ahead of ledger')
        if frozen.get(path) and live and frozen[path]['value'] != live['value']:
            need(prior and usage_extends(frozen[path]['value'],prior['value']), 'missing usage preimage')
    need(old == new, 'parked source/grants drift')


def compatible_dev(b, snapshot, current):
    if current == snapshot['base']: return
    need(snapshot['phase'] in ('candidate','pr_wait','qa','ci'), 'changed DEV continuation phase HOLD')
    need(b.git('merge-base',snapshot['base'],current,cwd=b.work) == snapshot['base'],
         'incompatible current DEV base ancestry HOLD')
    from content_identity import equivalence
    proof = equivalence(b.work,snapshot['base'],current)
    need(proof['reusable'] and not proof['tests'], 'current DEV dependency compatibility HOLD')
    # No merge/rebase or checkpoint rewrite. Ordinary Bridge.integrate creates
    # the new candidate/history, then existing qa_equivalence/CI gates decide reuse.


def parked_lineage(R, slot, key, frozen, current, operation):
    """Unrelated journal progress is allowed; this task's original facts are exact."""
    prior = R.read(R.STATE/'history'/slot/(key+'-before.json'),0,33554432)
    issue = frozen['snapshot']['issue']; task_key = str(issue)
    need(type(frozen.get('task_receipts')) is dict, 'legacy archive lacks task receipt seal HOLD')
    need(digest(prior) == frozen['journal_before'], 'parked journal backup changed')
    need(current['generation'] >= prior['generation'] + 1 and
         current.get('stage_counts',{}).get(task_key,0) == prior.get('stage_counts',{}).get(task_key,0)+1
         and current.get('profiles',{}).get(task_key) == prior.get('profiles',{}).get(task_key),
         'paused task counters/profile changed')
    for op_key, old in prior['operations'].items():
        if old.get('binding',{}).get('issue') == issue:
            need(operation(op_key) == old, 'paused task operation receipt changed')
    need(task_receipts(R,slot,current,issue) ==
         dict(frozen['task_receipts'], **{key:digest(operation(key))}),
         'paused task hot/cold receipts changed')
    allowed = {op_key for op_key,old in prior['operations'].items()
               if old.get('binding',{}).get('issue') == issue} | {key}
    need(all(op_key in allowed for op_key,op in current['operations'].items()
             if op.get('binding',{}).get('issue') == issue), 'paused task advanced while parked')


def task_receipts(R, slot, j, issue):
    result = {key:digest(op) for key,op in j['operations'].items()
              if op.get('binding',{}).get('issue') == issue}
    folder = R.STATE/'history'/slot
    paths = list(folder.glob('*.json'))
    need(len(paths) <= 4096, 'history scan bound HOLD')
    for path in paths:
        key = path.stem
        if not HEX.fullmatch(key): continue  # journal backups are not operations
        op = R.read(path,0,33554432)
        if op.get('binding',{}).get('issue') == issue:
            need(key not in result or result[key] == digest(op), 'hot/cold receipt divergence')
            result[key] = digest(op)
    return result


def evidence_paths(directory):
    for path in sorted(directory.rglob('*')):
        relative = path.relative_to(directory)
        if relative.parts[0].startswith('scheduling-') or str(relative) in (
                'worker.lock', 'state.json', 'parked.json', 'deferred.json', 'actions-deferred.json'):
            continue
        info = path.lstat()
        need(not stat.S_ISLNK(info.st_mode), 'indirect task evidence')
        if stat.S_ISDIR(info.st_mode): continue
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 4194304,
             'unsafe task evidence')
        yield relative, path


def state_evidence(R, slot):
    """Seal state/evidence metadata in the ROOT intent before a worker can release occupancy."""
    import pwd
    owner = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2').pw_uid
    folder = R.AUTONOMY/'slots'/slot
    result = {}; total = 0
    for relative, path in evidence_paths(folder):
        info = R.read(path, owner, 4194304, snapshot=True, json_data=False)
        total += info['size']; need(total <= 16777216, 'task evidence archive bound')
        result[str(relative)] = info['sha256']
    return result


def evidence_matches(current, frozen, issue, *, additions=False):
    related = re.compile(r'(^|[-_])' + str(issue) + r'([-_.]|$)')
    return (all(current.get(p) == sha for p,sha in frozen.items()) and
            not any(p not in frozen and (not additions or related.search(p)) for p in current))


def no_live(R, process):
    """Unlike alive(), missing identity and PID reuse are NOT evidence of termination."""
    need(type(process) is dict and set(process) == {'pid','start','boot'}
         and type(process['pid']) is int and process['pid'] > 0
         and isinstance(process['start'], str) and process['start'].isdigit()
         and isinstance(process['boot'], str) and process['boot'], 'unknown process identity')
    need(Path('/proc/sys/kernel/random/boot_id').read_text().strip() == process['boot'],
         'process boot identity changed')
    try:
        Path(f'/proc/{process["pid"]}').stat()
    except FileNotFoundError:
        return
    current = R.identity(process['pid'])
    need(current == process, 'PID reuse/unknown process identity')
    need(not R.alive(process), 'live executor')


def qualification_absence(op, state, req):
    """Only the receiver's separate pre-UID-drop pipe closes external effects.

    No provider/CLI/tool trace, assertion of exit=0, or arbitrary proof document
    qualifies. Legacy operations lack this root-observed certificate and HOLD.
    """
    proof = op.get('root_preflight_absence')
    need(type(proof) is dict and digest(proof) == req['control']['proof'],
         'missing closed external-effect absence proof')
    need(op.get('qa_qualification') and op['binding']['stage'] == 'qa_qualification'
         and proof == dict(schema='GB_ROOT_PRECALL_ABSENCE_V1', worker_entered=False,
                           child=op.get('worker_process'), wait_status=0,
                           operation=digest(op['binding']))
         and type(op.get('started_at')) is int and type(op.get('finished_at')) is int
         and 0 < op['started_at'] <= op['finished_at'] <= time.time()
         and op.get('after') == op.get('before') == digest(state)
         and op.get('checkpoint_before') == state
         and op.get('result', {}).get('status') == 'unknown'
         and op['result'].get('safe_release') is False,
         'unverifiable UNKNOWN command/effect/checkpoint')
    q = op['qa_qualification']
    grant = q.get('qualification_grant', {})
    need(grant.get('role') in ('independent_qa', 'technical_pm_product_analyst')
         and q.get('head') == req['head'] and q.get('base') == req['control']['base']
         and q.get('issue', req['issue']) == req['issue']
         and q.get('task_sha256') == op.get('task_hash'), 'read-only qualification admission mismatch')


def prepare(R, req, policy, api):
    """Called by receiver.handle under its existing controller.lock."""
    key = digest(binding(req)); slot = req['slot']; j = R.journal(slot)
    auth = admission(req, api)
    def operation(op_key):
        found = j['operations'].get(op_key)
        archive = R.STATE/'history'/slot/(op_key+'.json')
        return found if found is not None else R.read(archive, 0) if archive.exists() else None
    old = operation(key)
    if old:
        need(old.get('scheduling', {}).get('admission') == auth, 'control admission changed')
        if j['pending'] != key:
            return dict(status=old['result']['status'], key=key, result=old['result'])
        # No inference/effect replay: only finish the same persisted Store transaction.
        no_live(R, old.get('process'))
        need(old.get('finished_at'), 'control executor outcome unknown')
        R.guard(slot, policy)
        need(root_metadata(R, slot, policy) == old['scheduling']['preserved'], 'control source/grants drift')
        return None
    need(req['generation'] == j['generation'], 'stale control generation')
    R.guard(slot, policy)
    state, _ = R.checkpoint(slot)
    control = req['control']; action = req['stage']
    snapshot = state['active']
    frozen = None
    if action == 'resume':
        parked_op = operation(control['archive'])
        # Existing cold history keeps archived control receipts addressable by exact key.
        need(parked_op and parked_op.get('binding', {}).get('stage') == 'park'
             and parked_op.get('result', {}).get('status') == 'confirmed', 'unknown parked archive')
        frozen = parked_op['scheduling']
        snapshot = frozen['snapshot']
        need(not state['active'] or state['active']['phase'] == 'done', 'resume slot occupied')
        need(control['archive'] not in j.get('scheduling_resumes', {}), 'archive already resumed/reserved')
        parked_lineage(R,slot,control['archive'],frozen,j,operation)
        need(set(frozen['checkpoint_before']['done']) <= set(state['done']), 'completed history decreased')
        preserved_since_park(R, frozen['preserved'], root_metadata(R, slot, policy))
        need(evidence_matches(state_evidence(R,slot), frozen['evidence_digests'], req['issue'], additions=True),
             'parked candidate/QA/CI evidence changed')
    elif action == 'reconcile':
        need(j['pending'] == control['operation'], 'wrong UNKNOWN operation')
        op = j['operations'][j['pending']]
        need(all(op['binding'].get(k) == req[k] for k in ('slot','issue','head','attempt','phase')),
             'UNKNOWN identity mismatch')
        no_live(R, op.get('process')); no_live(R, op.get('worker_process'))
        qualification_absence(op, state, req)
        need(op.get('scheduling_preserved') == root_metadata(R, slot, policy, qualification=True),
             'UNKNOWN source/evidence/receipts/grants drift')
        snapshot = dict(issue=req['issue'], phase=req['phase'], head=req['head'],
                        base=control['base'], attempt=req['attempt'], pr=control['pr'],
                        task=op['qa_qualification'].get('task'))
        need(type(snapshot['task']) is dict and digest(snapshot['task']) == op['task_hash'],
             'unsupported qualification TEST PLAN admission')
    else:
        need(snapshot and snapshot.get('phase') != 'done', 'nothing active to park')
    need(action == 'reconcile' or not j['pending'], 'slot operation pending; reconcile first')
    exact_active(snapshot, req)
    checked = plan_gate(snapshot, req)
    if action != 'reconcile':
        need(req['issue'] not in state['done'], 'accepted task cannot resume/park')
    current_dev = None
    if action == 'resume':
        current_dev = api('git/ref/heads/dev')['object']['sha']
        need(isinstance(current_dev,str) and SHA.fullmatch(current_dev), 'invalid current DEV')
    a, s = R.live()
    other = 'slot2' if slot == 'slot1' else 'slot1'
    other_state, _ = R.checkpoint(other); other_j = R.journal(other)
    record = s.task_record(req['issue'], snapshot['task'])
    if action == 'resume':
        completed = set(state['done'] + other_state['done'])
        need(set(snapshot['task'].get('depends_on', [])) <= completed, 'resume dependencies HOLD')
        need(req['issue'] not in completed, 'task already accepted in another slot')
        active = other_state.get('active')
        need(not active or active['phase'] == 'done' or
             not s.conflicts(record, s.task_record(active['issue'], active['task'])), 'resume conflicting slot HOLD')
        pending = other_j['operations'].get(other_j.get('pending'), {})
        need(not pending.get('record') or not s.conflicts(record, pending['record']), 'resume pending conflict HOLD')
    # Every earlier writer for this task must have a known terminal result.
    if action == 'park':
        for op in j['operations'].values():
            if op.get('binding', {}).get('issue') == req['issue']:
                need(op.get('finished_at') and op.get('result', {}).get('status') != 'unknown',
                     'prior task effect UNKNOWN HOLD')
                no_live(R, op.get('process'))
    need(not (R.STATE/'integration.json').exists(), 'integration reservation HOLD')
    preserved = root_metadata(R, slot, policy)
    backup = R.STATE/'history'/slot/(key+'-before.json')
    backup.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if backup.exists(): need(R.read(backup, 0) == j, 'scheduling backup CAS drift')
    else: R.atomic(backup, j)
    intent = dict(admission=auth, snapshot=copy.deepcopy(snapshot), preserved=preserved, current_dev=current_dev,
                  task_receipts=task_receipts(R,slot,j,req['issue']),
                  archive=control['archive'], frozen=frozen, test_plan=checked,
                  archive_sha256=parked_op['result']['archive_sha256'] if action == 'resume' else None,
                  evidence_digests=state_evidence(R,slot),
                  checkpoint_before=copy.deepcopy(state), journal_before=digest(j),
                  prior_operation=copy.deepcopy(j['operations'][j['pending']]) if action == 'reconcile' else None)
    op = dict(binding=binding(req), record=record, task_hash=digest(snapshot['task']),
              before=digest(state), checkpoint_before=copy.deepcopy(state),
              started_at=int(time.time()), process=None, scheduling=intent,
              run=req['run'], run_attempt=req['run_attempt'])
    j['operations'][key] = op
    if action == 'resume':
        j.setdefault('scheduling_resumes', {})[control['archive']] = key
    if action != 'reconcile':
        counts = j.setdefault('stage_counts', {})
        need(counts.get(str(req['issue']), 0) < 128, 'stage generation bound exhausted')
        counts[str(req['issue'])] = counts.get(str(req['issue']), 0) + 1
    j['pending'] = key             # intent + full backup BEFORE archive or state effects
    R.atomic(R.STATE/(slot+'.json'), j)
    return None


def evidence(directory, issue):
    """Private archive of task receipts, including raw QA/CI evidence, not just hashes."""
    result = {}; total = 0
    from receiver import read
    # Nonroot reads use the same no-follow metadata primitive as the controller.
    for relative, path in evidence_paths(directory):
        raw = read(path, os.getuid(), 4194304, json_data=False)
        total += len(raw)
        need(total <= 16777216, 'task evidence archive bound')
        result[str(relative)] = base64.b64encode(raw).decode()
    return result


def perform(req, context):
    """One nonroot Store transaction. Never author, charge, push, or legacy resume."""
    a, s, rt, api, store, b = context
    need(os.getuid() != 0, 'scheduling verification must be nonroot')
    from core import digest as hash_value
    key = hash_value(binding({k:v for k,v in req.items() if not k.startswith('_')}))
    intent = req['_control']; snapshot = intent['snapshot']
    exact_active(snapshot, req)
    plan_gate(snapshot, req)
    action = req['stage']
    transaction = store.directory / ('scheduling-'+key+'.json')
    from receiver import read
    saved = read(transaction, os.getuid(), 33554432) if transaction.exists() else None
    expected_after = copy.deepcopy(intent['checkpoint_before'])
    if action == 'park': expected_after['active'] = None
    elif action == 'resume': expected_after['active'] = copy.deepcopy(snapshot)
    if saved:
        need(saved['intent'] == intent, 'control transaction/proof changed')
        need(saved['before'] == intent['checkpoint_before'] and saved['after'] == expected_after,
             'control transaction pre/postimage changed')
        need(store.data in (saved['before'], saved['after']), 'control checkpoint CAS drift')
    else:
        need(store.data == intent['checkpoint_before'], 'control preimage changed')
    if action == 'reconcile':
        old = intent['prior_operation']
        q = old['qa_qualification']
        from native_antigravity import qualification, qualification_descriptor
        need(qualification_descriptor(qualification(req['slot'], q['task_sha256'])) ==
             {k:v for k,v in q.items() if k != 'task'}, 'qualification admission changed')
        b.work = Path(q['work'])
        need(b.git('rev-parse','HEAD',cwd=b.work) == q['head']
             and not b.git('status','--porcelain=v1','--untracked-files=all',cwd=b.work)
             and b.git('merge-base',q['base'],q['head'],cwd=b.work) == q['base'],
             'qualification pinned source/worktree changed')
    else:
        b.work = b.c.worktrees_root / f'issue-{snapshot["issue"]}'
        b.unchanged_issue(snapshot)
        b.stopped_writer(snapshot['head'] or snapshot['base'], issue=snapshot['issue'])
        if snapshot.get('pr'): b.candidate_identity(snapshot, detached_store=True)
        if snapshot.get('qa'):
            if snapshot['qa'].get('verdict') == 'PASS':
                b.saved_qa(snapshot)
            else:
                qa_path = store.directory / f'qa-{snapshot["issue"]}-a{snapshot["attempt"]}{a.integ(snapshot)}.json'
                from receiver import read
                result = read(qa_path, os.getuid(), 65536)
                need(result == snapshot['qa'], 'saved QA FAIL receipt changed')
                a.qa_result(result, snapshot['head'])
        if action == 'resume':
            dev = b.remote_dev()
            need(dev == intent['current_dev'], 'current DEV changed during control HOLD')
            compatible_dev(b,snapshot,dev)
            need(next_stage(snapshot) is not None, 'unsupported continuation phase HOLD')
            # Use today's actual limits and qualified route, with no reservation
            # or charge. Every later ordinary stage revalidates again before effects.
            from core import route, diagnosis_route
            upcoming = next_stage(snapshot)
            if upcoming in ('author','qa','failure_diagnosis'):
                if upcoming == 'failure_diagnosis': diagnosis_route(s,snapshot['task'],rt.budget,req['slot'])
                else: route(s,snapshot['task'],upcoming,
                            req['profile'] if upcoming == 'author' else
                            'auto' if 'qa_routes' in snapshot['task'] else 'codex',rt.budget,req['slot'])
    if snapshot.get('head'):
        full_plan = check(snapshot, dict(req, stage='publish', _task_hash=digest(snapshot['task'])), b.work)
        need(full_plan['status'] in OK, full_plan['status'])
    current_evidence = evidence(store.directory, snapshot['issue'])
    current_digests = {p:hashlib.sha256(base64.b64decode(raw)).hexdigest()
                       for p,raw in current_evidence.items()}
    need(evidence_matches(current_digests, intent['evidence_digests'], snapshot['issue']),
         'control source/evidence changed since admission')
    if action == 'resume':
        park_key = req['control']['archive']
        archive_raw = read(store.directory/('scheduling-'+park_key+'.json'), os.getuid(), 33554432,json_data=False)
        need(hashlib.sha256(archive_raw).hexdigest() == intent['archive_sha256'], 'parked archive seal changed')
        archive = loads(archive_raw)
        original = archive['evidence']
        related = re.compile(r'(^|[-_])' + str(snapshot['issue']) + r'([-_.]|$)')
        need(archive['intent'] == intent['frozen'] and
             all(current_evidence.get(p) == raw for p,raw in original.items()) and
             not any(p not in original and related.search(p) for p in current_evidence),
             'parked candidate/QA/CI evidence changed')
    if saved:
        need(saved['evidence'] == current_evidence, 'control evidence changed')
    else:
        saved = dict(intent=intent, before=copy.deepcopy(store.data), after=expected_after,
                     evidence=current_evidence)
        a.atomic(transaction, saved)  # archive/backup durable BEFORE state or occupancy release
    if store.data == saved['before']:
        rt.lease(snapshot)  # existing shared conflict/auth/rate gates, no new scheduler
        if action == 'park':
            entry = dict(kind='scheduling', issue=snapshot['issue'], head=snapshot['head'],
                         attempt=snapshot['attempt'], park_comment=req['control']['comment'],
                         allow_successors=[], reason='Owner scheduling PARK', snapshot=copy.deepcopy(snapshot),
                         scheduling_key=key)
            store.park(entry)
        elif action == 'resume':
            store.restore_scheduling(snapshot, req['control']['archive'])
        # reconcile changes only the ROOT scheduling journal; Store remains byte intact.
    need(store.data == saved['after'], 'control postimage mismatch')
    return dict(status='confirmed', scheduling_only=True, archive=key if action == 'park' else req['control']['archive'],
                archive_sha256=hashlib.sha256(read(transaction,os.getuid(),33554432,json_data=False)).hexdigest(),
                next_stage=next_stage(snapshot) if action == 'resume' else None,
                test_plan=intent['test_plan'])
