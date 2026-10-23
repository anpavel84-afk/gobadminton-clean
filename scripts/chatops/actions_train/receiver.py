#!/usr/bin/python3
"""Installed root-only DEV entry. A fork supervises exactly ONE bounded stage, never a queue."""
import fcntl
import json
import os
from pathlib import Path
import pwd
import signal
import stat
import subprocess
import sys
import time
from core import HERE, Refused, binding, digest, live, loads, need, request
import qa_recovery

POLICY = Path('/etc/gobadminton-actions-train/policy.json')
STATE = Path('/var/lib/gobadminton-actions-train')
AUTONOMY = Path('/var/lib/gobadminton-autonomy')
BUDGET = Path('/etc/gobadminton-slots/budgets.json')
GROUP = 65042
UNITS = ('gobadminton-supervisor.service', 'gobadminton-slot@slot1.service', 'gobadminton-slot@slot2.service')


def read(path, owner=None, limit=2097152):
    """No symlink components, bounded regular file; do not trust slot-owned metadata as code."""
    path = Path(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            os.close(fd)
            fd = child
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o022 and info.st_nlink == 1,
             'unsafe metadata')
        need(owner is None or info.st_uid == owner, 'metadata owner mismatch')
        raw = os.read(fd, limit + 1)
        need(len(raw) <= limit, 'metadata too large')
        return loads(raw)
    finally:
        os.close(fd)


def trusted_tree(path):
    for p in (Path(path), *Path(path).parents):
        i = p.lstat()
        need(not stat.S_ISLNK(i.st_mode) and i.st_uid == 0 and not i.st_mode & 0o022, 'untrusted installed path')


def atomic(path, value, mode=0o600):
    # All root metadata is under a verified 0700 directory. fsync data AND rename directory.
    tmp = path.with_name('.' + path.name + '.' + str(os.getpid()))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(fd, 'w') as out:
            os.fchmod(out.fileno(), mode)
            json.dump(value, out, sort_keys=True)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
        d = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        tmp.unlink(missing_ok=True)


def locked(path):
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(fd, fcntl.LOCK_EX)
    return fd


def identity(pid):
    try:
        # stat comm can contain spaces/parentheses; fields after final ')' start at field 3.
        start = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[19]
        return dict(pid=pid, start=start, boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip())
    except (OSError, IndexError):
        return None


def alive(process):
    if process is None or identity(process['pid']) != process: return False
    try: return Path(f'/proc/{process["pid"]}/stat').read_text().rsplit(')', 1)[1].split()[0] not in ('Z', 'X')
    except OSError: return False


def units_quiet(units):
    for unit in units:
        proc = subprocess.run(['/usr/bin/systemctl', 'show', unit,
                               '--property=ActiveState,MainPID,UnitFileState'],
                              capture_output=True, text=True, timeout=10, check=True)
        props = dict(l.split('=', 1) for l in proc.stdout.splitlines() if '=' in l)
        need(props.get('ActiveState') == 'inactive' and props.get('MainPID') == '0'
             and props.get('UnitFileState') in ('disabled', 'masked'), 'old dispatcher/worker not disabled and quiescent')


def no_models(uid, slot):
    # Only the exact slot cgroup is relevant; never inspect unrelated users' commands.
    need(slot in ('slot1', 'slot2'), 'invalid slot scope')
    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
    need(uid == user.pw_uid, 'slot UID mismatch')
    unit = f'gobadminton-slot@{slot}.service'
    result = subprocess.run(['/usr/bin/systemctl', 'show', unit,
                             '--property=ActiveState,MainPID,ControlGroup'],
                            check=True, capture_output=True, text=True, timeout=10)
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    need(values.get('ActiveState') == 'inactive' and values.get('MainPID') == '0',
         'legacy slot process still active')
    group = values.get('ControlGroup', '')
    if group:
        need(group.startswith('/') and '..' not in group.split('/'), 'invalid slot cgroup')
        directory = Path('/sys/fs/cgroup') / group.lstrip('/')
        need(directory == directory.resolve(), 'indirect slot cgroup')
        for child in directory.rglob('cgroup.procs'):
            need(not child.read_text().split(), 'slot still has a model child')


def free_lock(path):
    try: fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except FileNotFoundError: return
    try:
        try: fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise Refused('legacy worker.lock/lease still held') from None
    finally: os.close(fd)


def guard(slot, policy):
    need(policy['mode'] == 'active' and slot in policy['owned'], 'root migration ownership absent')
    from context_policy import preflight as context_preflight
    context_preflight()
    units_quiet(('gobadminton-supervisor.service', f'gobadminton-slot@{slot}.service'))
    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
    no_models(user.pw_uid, slot)
    free_lock(AUTONOMY / 'slots' / slot / 'worker.lock')
    free_lock(AUTONOMY / 'locks' / f'{slot}.lease')
    return user


def checkpoint(slot):
    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
    folder = AUTONOMY / 'slots' / slot
    try: data = read(folder / 'state.json', user.pw_uid)
    except FileNotFoundError: data = {'active': None, 'done': []}
    need(set(data) == {'active', 'done'} and isinstance(data['done'], list), 'invalid checkpoint')
    try: parked = read(folder / 'parked.json', user.pw_uid)['parked']
    except FileNotFoundError: parked = []
    try: deferred = read(folder / 'deferred.json', user.pw_uid)['deferred']
    except FileNotFoundError: deferred = []
    return data, [e['issue'] for e in parked + deferred]


def journal(slot):
    path = STATE / (slot + '.json')
    if path.exists(): return read(path, 0)
    return dict(generation=0, operations={}, pending=None, deferred=[], last=None, stage_counts={})


def recovery_journal():
    from recovery import empty, SCHEMA
    path = STATE / 'recovery.json'
    value = read(path, 0) if path.exists() else empty()
    need(value.get('schema') == SCHEMA, 'invalid recovery receipt cache')
    return value



def budget_preflight_retry(j, state):
    if not qa_recovery.preflight_candidate(j, state, alive): return False
    try: return qa_recovery.preflight_unlimited(j, read(BUDGET, 0, 16384))
    except (OSError, Refused, ValueError, TypeError): return False


def qualification_plan(policy, card, budget):
    """Read-only root canary proposal; reservation/launch remains in handle()."""
    if policy.get('mode') != 'active' or not card.get('owned') or card.get('active') is not None \
            or card.get('pending') or (STATE/'antigravity-qa-qualification.json').exists():
        return None
    from native_antigravity import MARKER, trusted, qualification_descriptor, ReviewError
    try:
        marker = loads(trusted(MARKER))
        if marker.get('phase') != 'canary' or marker.get('schema') != 'GB_ANTIGRAVITY_QA_29_V1' \
                or marker.get('slot') != 'slot2' or marker.get('executor_uid') != 978:
            return None
        q = qualification_descriptor(marker)
        if budget.remaining('agy','qa','slot2') != 1: return None
        return dict(slot='slot2',issue=29,stage='qa_qualification',phase='idle',head=q['head'],
                    attempt=0,generation=card['generation'],profile='agy')
    except (OSError, ValueError, ReviewError, KeyError, TypeError):
        return None  # Missing/malformed qualification never authorizes a call.


def snapshot(policy):
    result = dict(schema='GB_ACTIONS_TRAIN_V1', mode=policy['mode'], slots={})
    try: planning = read(STATE / 'planning.json', 0, 65536)
    except FileNotFoundError: planning = None
    a, s = live()
    budget = s.Budget(Path('/etc/gobadminton-slots/budgets.json'), AUTONOMY/'outbox', AUTONOMY/'locks/registry.lock')
    for slot in ('slot1', 'slot2'):
        state, parked = checkpoint(slot)
        j = journal(slot)
        pending = j['pending']
        if pending:
            op = j['operations'][pending]
            pending = dict(key=pending, status='running' if alive(op.get('process')) else 'unknown',
                           stage=op['binding']['stage'], process=op.get('process'), binding=op['binding'],
                           workflow_run=op['run'], workflow_attempt=op['run_attempt'],
                           recoverable=(op['binding']['stage'] in ('publish', 'integrate', 'promote', 'dev')
                           and op.get('recovery_attempts', 0) < 3) or (op['binding']['stage'] == 'qa'
                           and op.get('recovery_attempts', 0) < 1
                           and __import__('qa_recovery').safe_pending(j,state,alive))
                           or budget_preflight_retry(j,state))
        process = None
        try:
            user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
            observed = read(AUTONOMY / 'outbox' / slot / 'actions-process.json', user.pw_uid, 16384)
            current_op = j['operations'].get(j['pending']) if j['pending'] else None
            if observed.get('schema') == 'GB_ACTIONS_PROCESS_V1' and current_op and (
                    observed.get('workflow_run') == current_op['run'] and
                    observed.get('workflow_attempt') == current_op['run_attempt']):
                process = observed
                p = observed.get('process')
                if p and (not alive(p) or Path(f'/proc/{p["pid"]}').stat().st_uid != user.pw_uid):
                    process = observed | {'process': None}
        except (OSError, ValueError, Refused, KeyError, TypeError):
            pass
        result['slots'][slot] = dict(**state, cli=process, parked=parked + [e['issue'] for e in j['deferred']],
                                    generation=j['generation'], pending=pending,
                                    owned=slot in policy['owned'], last=j['last'], confirmed=j.get('confirmed'),
                                    profile=j.get('profiles', {}).get(str((state.get('active') or {}).get('issue'))),
                                    reservation=j['operations'][j['pending']].get('record') if j['pending'] else None)
        try:
            result['slots'][slot]['availability'] = {
                provider: {role: s.adapter_status(provider, role, budget, slot)[0] for role in ('author','qa')}
                for provider in ('codex','cursor','agy')}
        except (OSError, ValueError, s.Hold):
            result['slots'][slot]['availability'] = {}  # UNKNOWN budget never authorizes a model
        if planning and planning['report']['slots'][slot]['generation'] == j['generation']:
            result['slots'][slot]['planning'] = dict(planning['report']['slots'][slot],
                counts=planning['report']['counts'], decisions=planning['report']['decisions'],
                observed_at=planning['observed_at'], workflow_run=planning['run'])
    proposed = qualification_plan(policy, result['slots']['slot2'], budget)
    if proposed: result['slots']['slot2']['qa_qualification'] = proposed
    if policy.get('recovery', {}).get('enabled'):
        result['recovery'] = recovery_journal()
        # A lost process never resets a model reservation. Expose the honest limitation.
        for r in result['recovery']['receipts'].values():
            if r['status'].endswith('_pending'):
                c = result['slots'][r['frozen']['slot']]
                if not c['pending'] or c['pending']['status'] != 'running':
                    r.update(status='review-needed', reason='ambiguous read-only model outcome; reservation spent; no automatic replay')
    return result


def publish_monitor(policy):
    from monitor import project
    snap = snapshot(policy)
    folder = Path('/var/lib/gobadminton-deploy-evidence')
    trusted_tree(folder)
    path = folder / 'actions-train.json'
    atomic(path, dict(schema='GB_ACTIONS_MONITOR_SOURCE_V1', observed_at=int(time.time()),
                      mode=policy['mode'], slots={k: project(v) for k, v in snap['slots'].items()}), mode=0o644)


def archive_completed(slot, j):
    # Bound the hot index without deleting any operation/result history. Old duplicate events
    # consult the immutable per-operation receipt instead of running/recharging again.
    while len(j['operations']) > 96:
        old_key = next((k for k, op in j['operations'].items() if k != j['pending']
                        and op.get('result', {}).get('status') in ('confirmed', 'deferred')), None)
        if old_key is None: break
        folder = STATE / 'history' / slot
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        path = folder / (old_key + '.json')
        if path.exists(): need(read(path, 0) == j['operations'][old_key], 'history receipt drift')
        else: atomic(path, j['operations'][old_key])
        del j['operations'][old_key]


def kill_descendants(pid):
    found = []
    def walk(parent):
        try: children = Path(f'/proc/{parent}/task/{parent}/children').read_text().split()
        except OSError: return
        for child in children:
            number = int(child)
            info = identity(number)
            if info:
                found.append(info)
                walk(number)
    walk(pid)
    for info in reversed(found):
        if alive(info):
            try: os.kill(info['pid'], signal.SIGKILL)
            except ProcessLookupError: pass


def supervisor(req, policy, key, root_lock):
    """Detached bounded process survives SSH cancellation. No next-stage choice exists here."""
    os.setsid()
    os.close(root_lock)
    null = os.open('/dev/null', os.O_RDWR)
    for fd in (0, 1, 2): os.dup2(null, fd)
    if null > 2: os.close(null)
    slot = req['slot']
    lock = locked(STATE / 'controller.lock')
    j = journal(slot)
    j['operations'][key]['process'] = identity(os.getpid())
    atomic(STATE / (slot + '.json'), j)
    os.close(lock)
    r, w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(r)
        try:
            # Recheck immediately before dropping privilege. Root never imports candidate code.
            user = guard(slot, policy)
            native_auth = None
            if req['stage'] == 'author':
                state, _ = checkpoint(slot)
                active = state.get('active')
                if active:
                    a, s = live()
                    budget = s.Budget(Path('/etc/gobadminton-slots/budgets.json'),
                                      AUTONOMY/'outbox', AUTONOMY/'locks/registry.lock')
                    from core import route
                    selected = route(s,active['task'],'author',req['profile'],budget,slot)
                    if selected['provider'] == 'cursor':
                        from native_cursor import existing_auth_for_stage
                        native_auth = existing_auth_for_stage(slot,digest(active['task']))
            os.setgroups([GROUP])
            os.setgid(user.pw_gid)
            os.setuid(user.pw_uid)
            # A same-UID candidate must not read its trusted parent's API token via /proc/ptrace.
            import ctypes
            need(ctypes.CDLL(None, use_errno=True).prctl(4, 0, 0, 0, 0) == 0, 'cannot protect trusted adapter memory')
            os.umask(0o077)
            os.environ.clear()
            os.environ.update(PATH='/usr/bin:/bin', LANG='C.UTF-8', HOME=user.pw_dir, USER=user.pw_name)
            req['_task_hash'] = j['operations'][key].get('task_hash')
            if j['operations'][key].get('qa_qualification'):
                req['_qa_qualification'] = j['operations'][key]['qa_qualification']
            if j['operations'][key].get('recovery_admission'):
                req['_recovery_admission'] = j['operations'][key]['recovery_admission']
            if j['operations'][key].get('recovery_data'):
                req['_recovery_data'] = j['operations'][key]['recovery_data']
            from stage import entry
            value = entry(dict(req), policy, native_auth=native_auth)
            raw = json.dumps(value).encode()
            # Keep detailed gates private in checkpoints, pipe result only carries bounded facts.
            os.write(w, raw[:2097152])
        except BaseException:
            os.write(w, b'{"status":"unknown","reason":"stage process failed; reconcile checkpoint"}')
        finally:
            os.close(w)
            os._exit(0)
    os.close(w)
    # select drains the pipe while waiting; no communicate deadlock on detailed job evidence.
    import select
    chunks, deadline, timed_out = [], time.monotonic() + 2200, False
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            kill_descendants(pid)
            os.kill(pid, signal.SIGKILL)
            break
        ready, _, _ = select.select([r], [], [], min(30, remaining))
        if ready:
            chunk = os.read(r, 65536)
            if not chunk: break
            chunks.append(chunk)
            if sum(map(len, chunks)) > 2097152:
                kill_descendants(pid)
                os.kill(pid, signal.SIGKILL)
                timed_out = True
                break
    os.close(r)
    os.waitpid(pid, 0)
    # V6 run kills CLI children on ordinary timeout. If killed externally, leave UNKNOWN and
    # no_models/worker.lock prevent takeover until PMA proves no surviving writer.
    try: value = loads(b''.join(chunks)) if not timed_out else {'status': 'unknown', 'reason': 'stage deadline'}
    except (ValueError, Refused): value = dict(status='unknown', reason='invalid bounded stage result')
    lock = locked(STATE / 'controller.lock')
    try:
        j = journal(slot)
        op = j['operations'][key]
        state, _ = checkpoint(slot)
        changed = digest(state) != op['before']
        recovery_record = None
        if op.get('recovery_key'):
            from recovery import finish
            cache = recovery_journal()
            current_policy = read(POLICY, 0, 16384)
            recovery_record = finish(cache, op['recovery_key'], req['stage'], value, current_policy)
            if recovery_record['status'] == 'publish_ready':
                cache['receipts'][op['recovery_key']]['publication_run'] = {'run': req['run'], 'attempt': req['run_attempt']}
                recovery_record = dict(cache['receipts'][op['recovery_key']])
            atomic(STATE / 'recovery.json', cache)
            changed = True  # receipt transition, NEVER a product/source completion
            value = dict(status='confirmed', recovery=recovery_record)
        if op.get('qa_qualification'):
            reservation = read(STATE / 'antigravity-qa-qualification.json', 0)
            need(reservation.get('operation') == key and reservation.get('task_hash') == op['task_hash'],
                 'QA qualification reservation drift')
            reservation.update(result=value, finished_at=int(time.time()))
            atomic(STATE / 'antigravity-qa-qualification.json', reservation)
        active = state['active']
        value['checkpoint'] = None if not active else {k: active.get(k) for k in (
            'issue', 'phase', 'head', 'attempt', 'pr', 'release_id')}
        if active:
            value['checkpoint']['qa'] = {k: (active.get('qa') or {}).get(k) for k in ('verdict', 'reviewed_sha')}
            value['checkpoint']['ci'] = {k: (active.get('ci') or {}).get(k) for k in ('id', 'sha')}
            value['checkpoint']['ci_failure'] = active.get('ci_failure')
        op.update(result=value, after=digest(state), finished_at=int(time.time()))
        # Only a waiting READ without a changed checkpoint is safe to retry automatically.
        if value['status'] == 'waiting' and not changed:
            op['retry_at'] = int(time.time()) + value.get('retry_after', 60)
        elif value['status'] == 'confirmed':
            j['generation'] += 1
        # Deferred known safe clean failures may free source slots, see client.py.
        j['last'] = dict(stage=req['stage'], issue=req['issue'], status=value['status'],
                         reason=value.get('reason'), confirmed_at=int(time.time()) if value['status'] == 'confirmed' else None,
                         workflow_run=req['run'], workflow_attempt=req['run_attempt'], changed=changed,
                         routing=value.get('routing'), checkpoint=value['checkpoint'])
        if op.get('qa_qualification'):
            j['last']['qualification'] = dict(passed=value.get('qualification_passed', False),
                reviewed_sha=(value.get('qa') or {}).get('reviewed_sha'),
                receipt_file=value.get('receipt_file'),
                charged_calls=(value.get('native_receipt') or {}).get('charged_calls'),
                effective_model=(value.get('native_receipt') or {}).get('effective_model'))
        if value['status'] == 'confirmed': j['confirmed'] = dict(j['last'])
        if recovery_record: j['last']['recovery'] = recovery_record
        if value['status'] != 'unknown': j['pending'] = None
        if value.get('safe_release'):
            j['deferred'].append(dict(issue=req['issue'], reason=value.get('reason'), operation=key))
            j['generation'] += 1
            if policy.get('recovery', {}).get('enabled'):
                # Only the exact pre-effect terminal snapshot can enter diagnosis. Never trust
                # an edited/unrelated slot archive as a new product authorization.
                from recovery import enroll
                cache = recovery_journal()
                try:
                    user = pwd.getpwnam('agentagency-dev' if slot == 'slot1' else 'gb-slot2')
                    entries = read(AUTONOMY / 'slots' / slot / 'actions-deferred.json', user.pw_uid)['entries']
                    entry = entries[-1]
                    need(entry['snapshot'] == op.get('checkpoint_before', {}).get('active')
                         and entry['issue'] == req['issue'], 'deferral differs from frozen pre-effect checkpoint')
                    done = checkpoint('slot1')[0]['done'] + checkpoint('slot2')[0]['done']
                    enroll(cache, entry, slot, read(POLICY, 0, 16384), future=True, done=done)
                except (Refused, KeyError, ValueError, TypeError, OSError):
                    cache['blocked'][key] = dict(issue=req['issue'], slot=slot, status='needs-owner',
                         reason='safe deferral not eligible for exact recovery enrollment; preserve archive for review')
                atomic(STATE / 'recovery.json', cache)
        integration = STATE / 'integration.json'
        active = state['active']
        if integration.exists() and read(integration, 0)['slot'] == slot and (value['status'] == 'confirmed' or value.get('safe_release')) and (
                not active or active['phase'] not in ('promoting', 'dev_wait')):
            integration.unlink()
        archive_completed(slot, j)
        atomic(STATE / (slot + '.json'), j)
        publish_monitor(policy)
    finally: os.close(lock)
    os._exit(0)


def hosted_identity(req, policy):
    import base64, hashlib
    from core import API, SHA
    api = API(req['gh_token'])
    api.identity()
    workflow = api(f'actions/runs/{req["run"]}')
    head = workflow.get('head_sha', '')
    need(workflow.get('path') == '.github/workflows/train-stage.yml'
         and workflow.get('head_branch') == 'dev' and isinstance(head, str) and SHA.fullmatch(head)
         and workflow.get('event') == 'workflow_dispatch' and workflow.get('run_attempt') == req['run_attempt']
         and workflow.get('status') == 'in_progress'
         and workflow.get('repository', {}).get('id') == 1416250340
         and workflow.get('head_repository', {}).get('id') == 1416250340
         and workflow.get('actor', {}).get('id') in (318610566, 41898282), 'unapproved hosted stage identity')
    # Product promotion changes dev HEAD, not trusted control code. Compare the exact
    # reviewed workflow bytes, whose checkout remains pinned to the reviewed controller.
    path = '.github/workflows/train-stage.yml'
    file = api('contents/' + path + '?ref=' + head)
    need(file.get('type') == 'file' and file.get('path') == path and file.get('encoding') == 'base64'
         and type(file.get('size')) is int and 0 < file['size'] <= 32768, 'invalid trusted workflow content')
    raw = base64.b64decode(file['content'])
    need(len(raw) == file['size'] and hashlib.sha256(raw).hexdigest() == policy['stage_workflow_sha256']
         and SHA.fullmatch(policy['controller_sha'])
         and ('ref: ' + policy['controller_sha']).encode() in raw, 'trusted workflow/checkout changed')


def recovery_request(req, policy):
    """Same root lock, same single-flight slot operation; never claims/resets a product issue."""
    from recovery import reserve
    slot = req['slot']; key = digest(binding(req)); j = journal(slot)
    archive = STATE / 'history' / slot / (key + '.json')
    if key not in j['operations'] and archive.exists():
        old = read(archive, 0)
        return dict(status=old['result']['status'], key=key, result=old['result'])
    if key in j['operations']:
        op = j['operations'][key]
        if j['pending'] == key:
            return dict(status='running' if alive(op.get('process')) else 'unknown', key=key,
                        reason='read-only recovery reservation cannot be replayed')
        return dict(status=op['result']['status'], key=key, last=j['last'], result=op['result'])
    need(not j['pending'] and req['generation'] == j['generation'], 'stale/pending recovery generation')
    state, _ = checkpoint(slot)
    need(not state['active'] or state['active']['phase'] == 'done', 'normal source slot occupied')
    guard(slot, policy)
    cache = recovery_journal()
    receipt_key, recovery_data = reserve(cache, req, policy)
    done = checkpoint('slot1')[0]['done'] + checkpoint('slot2')[0]['done']
    need(req['issue'] not in done, 'accepted task must never be resurrected')
    _, s = live()
    frozen = recovery_data['frozen']
    record = s.task_record(frozen['issue'], frozen['snapshot']['task'])
    other = 'slot2' if slot=='slot1' else 'slot1'
    other_state, _ = checkpoint(other); other_active=other_state.get('active')
    other_j=journal(other); other_op=other_j.get('operations',{}).get(other_j.get('pending'),{})
    if other_active and other_active['phase']!='done':
        need(not s.conflicts(record,s.task_record(other_active['issue'],other_active['task'])),
             'recovery waiting for conflicting product paths; reservation not spent')
    if other_op.get('record'):
        need(not s.conflicts(record,other_op['record']), 'recovery waiting for pending source claim')
    # A depleted subscription-call budget is a wait reason, not a spent diagnostic run.
    from core import route
    budget=s.Budget(Path('/etc/gobadminton-slots/budgets.json'),AUTONOMY/'outbox',AUTONOMY/'locks/registry.lock')
    route(s,frozen['snapshot']['task'],'qa','codex',budget,slot)
    op = dict(record=record,
         task_hash=frozen['task_hash'], binding=binding(req), run=req['run'], run_attempt=req['run_attempt'],
         before=digest(state), started_at=int(time.time()), process=None,
         recovery_key=receipt_key, recovery_data=recovery_data)
    # Write-ahead model reservation first. A crash between journals consumes the reservation
    # and exposes review-needed; it NEVER repeats diagnosis or review after restart.
    atomic(STATE / 'recovery.json', cache)
    j['operations'][key] = op; j['pending'] = key
    atomic(STATE / (slot + '.json'), j)
    pid = os.fork()
    if pid == 0: supervisor(req, policy, key, ROOT_LOCK)
    j['operations'][key]['process'] = identity(pid)
    atomic(STATE / (slot + '.json'), j)
    return dict(status='running', key=key, process=identity(pid))


def qualification_request(req, policy):
    """One QA-only canary, using existing slot journal/worker lock. Never creates active."""
    from native_antigravity import qualification, qualification_descriptor
    key = digest(binding(req)); slot = req['slot']; j = journal(slot)
    archive = STATE / 'history' / slot / (key + '.json')
    if key not in j['operations'] and archive.exists():
        old = read(archive, 0)
        return dict(status=old['result']['status'], key=key, result=old['result'])
    if key in j['operations']:
        op = j['operations'][key]
        if j['pending'] == key:
            return dict(status='running' if alive(op.get('process')) else 'unknown', key=key,
                        reason='QA qualification never replays after unknown outcome')
        return dict(status=op.get('result', {}).get('status', 'unknown'), key=key,
                    result=op.get('result'), last=j['last'])
    need(not j['pending'] and req['generation'] == j['generation'], 'stale/pending QA qualification generation')
    state, _ = checkpoint(slot)
    need(state['active'] is None, 'QA qualification requires idle source slot')
    guard(slot, policy)
    # Root marker is the exact Owner-authorized QA-only admission, not a product task.
    from native_antigravity import MARKER, trusted
    m = loads(trusted(MARKER)); q = qualification_descriptor(m)
    qualification(slot, q['task_sha256'])
    need(m['phase'] == 'canary' and req['head'] == q['head'], 'qualification source/phase mismatch')
    path = STATE / 'antigravity-qa-qualification.json'
    need(not path.exists(), 'QA qualification already reserved; reconcile without another call')
    _, s = live()
    budget = s.Budget(BUDGET, AUTONOMY/'outbox', AUTONOMY/'locks/registry.lock')
    left = budget.remaining('agy', 'qa', slot)
    need(type(left) is int and left == 1, 'QA qualification requires exactly one finite remaining call')
    reservation = dict(schema='GB_ANTIGRAVITY_QA_29_RESERVATION_V1', operation=key,
        task_hash=q['task_sha256'], descriptor=q, started_at=int(time.time()), result=None)
    # Reservation first: a crash between writes consumes the canary, never replays it.
    atomic(path, reservation)
    j['operations'][key] = dict(task_hash=q['task_sha256'], qa_qualification=q, binding=binding(req),
        run=req['run'], run_attempt=req['run_attempt'], before=digest(state), checkpoint_before=state,
        started_at=int(time.time()), process=None)
    j['pending'] = key
    atomic(STATE / (slot+'.json'), j)
    pid = os.fork()
    if pid == 0: supervisor(req, policy, key, ROOT_LOCK)
    j['operations'][key]['process'] = identity(pid)
    atomic(STATE / (slot+'.json'), j)
    return dict(status='running', key=key, process=identity(pid))


def handle(req, policy):
    request(req)
    if req['stage'] == 'status': return snapshot(policy)
    if req['stage'] == 'planning':
        # Informational report through the existing forced-command DEV SSH identity.
        # No API credential, code/path/shell input, journal mutation or execution authority.
        need(policy['mode'] == 'active' and req['controller_sha'] == policy['controller_sha'], 'planning controller mismatch')
        stale = [slot for slot, c in req['report']['slots'].items() if c['generation'] != journal(slot)['generation']]
        if stale: return dict(status='obsolete', slots=stale)
        path = STATE / 'planning.json'
        old = read(path, 0, 65536) if path.exists() else None
        if old and (req['run'], req['run_attempt']) < (old['run'], old['run_attempt']):
            return dict(status='obsolete')
        atomic(path, dict(report=req['report'], observed_at=int(time.time()), run=req['run'], run_attempt=req['run_attempt']))
        publish_monitor(policy)
        return dict(status='recorded')
    slot = req['slot']
    hosted_identity(req, policy)
    if req['stage'] == 'qa_qualification':
        return qualification_request(req, policy)
    if req['stage'] in ('diagnose', 'task_review'):
        return recovery_request(req, policy)
    key = digest(binding(req))
    j = journal(slot)
    archive = STATE / 'history' / slot / (key + '.json')
    if key not in j['operations'] and archive.exists():
        old = read(archive, 0)
        return dict(status=old['result']['status'], key=key, result=old['result'])
    if key in j['operations']:
        op = j['operations'][key]
        if j['pending'] == key:
            if alive(op.get('process')):
                return dict(status='running', key=key)
            budget_retry = req['stage'] == 'qa' and budget_preflight_retry(j, checkpoint(slot)[0])
            if req['stage'] not in ('publish', 'integrate', 'promote', 'dev', 'qa') or (op.get('recovery_attempts', 0) >= (1 if req['stage']=='qa' else 3) and not budget_retry):
                return dict(status='unknown', key=key)
            if req['stage']=='qa':
                from qa_recovery import safe_pending
                need(safe_pending(j,checkpoint(slot)[0],alive),'unknown QA state changed; no model replay')
            guard(slot, policy)
            # Only read/reconcile remote identity. Never replay an uncertain side effect.
            req['_recover'] = True
            op.setdefault('recovery_history', []).append({k: op.get(k) for k in
                ('run','run_attempt','process','started_at','finished_at','before','after','result')})
            op['recovery_attempts'] = op.get('recovery_attempts', 0) + 1
            op.update(run=req['run'], run_attempt=req['run_attempt'], started_at=int(time.time()))
            if budget_retry:
                req['_budget_preflight_retry'] = True  # internal only; wire schema rejects this key
                op['budget_preflight_used'] = dict(reason='proven pre-call budget refusal', at=int(time.time()))
                atomic(STATE / (slot + '.json'), j)  # one-use certificate/counter durable BEFORE fork
            pid = os.fork()
            if pid == 0: supervisor(req, policy, key, ROOT_LOCK)
            j['operations'][key]['process'] = identity(pid)
            atomic(STATE / (slot + '.json'), j)
            return dict(status='running', key=key, process=identity(pid))
        result = op.get('result', {'status': 'unknown'})
        if result['status'] != 'waiting' or time.time() < op['retry_at'] or op.get('read_attempts', 0) >= 96:
            return dict(status=result['status'], key=key, result=result, last=j['last'])
        # A READ-only retry consumes no model attempt/budget; same semantic operation.
    need(not j['pending'], 'slot operation already pending')
    need(req['generation'] == j['generation'], 'stale generation')
    user = guard(slot, policy)
    profiles = j.setdefault('profiles', {})
    chosen = profiles.get(str(req['issue']))
    need(chosen is None or chosen == req['profile'], 'claimed routing profile changed')
    state, _ = checkpoint(slot)
    active = state['active']
    if req['stage'] == 'claim':
        need(not active or active['phase'] == 'done', 'slot not idle')
        need(req['phase'] == 'idle' and req['head'] is None and req['attempt'] == 0, 'invalid claim expectation')
    else:
        need(active and all(active.get(k) == req[k] for k in ('issue', 'phase', 'head', 'attempt')), 'stale checkpoint')
    # Persisted occupancy protects overlapping tasks BETWEEN stages, when leases are released.
    a, s = live()
    other = 'slot2' if slot == 'slot1' else 'slot1'
    other_state, _ = checkpoint(other)
    other_active = other_state['active']
    other_journal = journal(other)
    other_reservation = (other_journal['operations'][other_journal['pending']].get('record')
                         if other_journal['pending'] else None)
    recovery_admission = None
    if req['stage'] == 'claim':
        from core import API, SINCE
        import datetime as dt
        api = API(req['gh_token'])
        api.identity()
        issue = api(f'issues/{req["issue"]}')
        candidates = s.admitted(a, [issue], api.pages(f'issues/{req["issue"]}/comments'), dt.datetime.fromisoformat(SINCE))
        if (issue.get('body') or '').startswith('GOBADMINTON_RECOVERY_185_V1\n'):
            need(not candidates, 'ambiguous Owner/delegated recovery admission')
            from recovery_admission import root_admission
            cache = recovery_journal()
            recovery_admission = root_admission(a, api, cache, issue, policy)
            candidates = [(issue['number'], recovery_admission['task'])]
            atomic(STATE / 'recovery.json', cache)
        need(len(candidates) == 1, 'no exact unique Owner or reviewed delegated task')
        record = s.task_record(*candidates[0])
        task_hash = digest(candidates[0][1])
        completed = set(state['done']) | set(other_state['done'])
        denied = set(checkpoint(slot)[1] + checkpoint(other)[1])
        denied.update(e['issue'] for e in j['deferred'] + other_journal['deferred'])
        need(req['issue'] not in completed | denied, 'task already done/parked/deferred')
        need(set(candidates[0][1].get('depends_on', [])) <= completed, 'dependencies waiting')
    else:
        record = s.task_record(active['issue'], active['task'])
        task_hash = digest(active['task'])
        if active.get('recovery_receipt'):
            from core import API
            from recovery_admission import root_admission
            api = API(req['gh_token']); api.identity()
            cache = recovery_journal()
            recovery_admission = root_admission(a, api, cache, api(f'issues/{active["issue"]}'), policy)
            need(recovery_admission['key'] == active['recovery_receipt'], 'wrong active recovery receipt')
    if other_active and other_active['phase'] != 'done':
        need(not s.conflicts(record, s.task_record(other_active['issue'], other_active['task'])), 'overlapping source slots')
    if other_reservation:
        need(not s.conflicts(record, other_reservation), 'overlapping pending claim')
    counts = j.setdefault('stage_counts', {})
    if key not in j['operations']:
        need(counts.get(str(req['issue']), 0) < 128, 'stage generation bound exhausted')
        counts[str(req['issue'])] = counts.get(str(req['issue']), 0) + 1
    integration = STATE / 'integration.json'
    if req['stage'] in ('integrate', 'promote', 'dev'):
        if integration.exists():
            if read(integration, 0) != dict(slot=slot, issue=req['issue']):
                j['last'] = dict(stage=req['stage'], issue=req['issue'], status='waiting',
                                 reason='DEV acceptance queue waiting', confirmed_at=None, changed=False,
                                 workflow_run=req['run'], workflow_attempt=req['run_attempt'])
                atomic(STATE / (slot + '.json'), j)
                return dict(status='waiting', last=j['last'])
        else:
            atomic(integration, dict(slot=slot, issue=req['issue']))
    op = dict(record=record, task_hash=task_hash, binding=binding(req), run=req['run'], run_attempt=req['run_attempt'], before=digest(state),
              checkpoint_before=state,
              started_at=int(time.time()), process=None, read_attempts=j['operations'].get(key, {}).get('read_attempts', 0) + 1)
    if recovery_admission: op['recovery_admission'] = recovery_admission
    profiles[str(req['issue'])] = req['profile']
    j['operations'][key] = op
    j['pending'] = key
    atomic(STATE / (slot + '.json'), j)  # pending BEFORE any process or effect
    pid = os.fork()
    if pid == 0:
        supervisor(req, policy, key, ROOT_LOCK)
    j['operations'][key]['process'] = identity(pid)
    atomic(STATE / (slot + '.json'), j)
    return dict(status='running', key=key, process=identity(pid))


def main():
    global ROOT_LOCK
    need(os.geteuid() == 0 and len(sys.argv) == 1, 'installed root receiver only')
    import resource
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    trusted_tree(HERE)
    trusted_tree(POLICY)
    trusted_tree(STATE)
    for path in HERE.rglob('*'):
        if path.is_file(): trusted_tree(path)
    raw = sys.stdin.buffer.read(8193)
    need(len(raw) <= 8192, 'request too large')
    req = loads(raw)
    ROOT_LOCK = locked(STATE / 'controller.lock')
    try:
        # Revalidate under the controller lock. A request waiting during an
        # authorized runtime upgrade must never use a cached ACTIVE policy.
        policy = read(POLICY, 0, 16384)
        need(policy['schema'] == 'GB_ACTIONS_TRAIN_POLICY_V1' and policy['mode'] in ('disabled', 'shadow', 'active'), 'invalid root policy')
        need(set(policy['owned']) <= {'slot1', 'slot2'}, 'invalid ownership')
        result = handle(req, policy)
        publish_monitor(policy)
    finally: os.close(ROOT_LOCK)
    print(json.dumps(result, sort_keys=True))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        # No repr/traceback/request/token; fixed safe diagnostic only.
        print(json.dumps(dict(status='refused', reason=str(error) if isinstance(error, Refused) else type(error).__name__)))
        sys.exit(1)
