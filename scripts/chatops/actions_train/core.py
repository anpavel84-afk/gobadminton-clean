"""Closed wire contract, authenticated API and finite Actions planning. No model execution."""
import datetime as dt
import email.utils
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
OWNER = 318610566
SINCE = '2026-10-15T02:27:00+00:00'
PINS = {'autonomous_issues.py': '7f266bca6c6fa2f9b023b9c76c238bb1c12d27f4ddb4d0b59937954915e6c7f9',
        'slots.py': '3c7b4ab36dd3cd8b41c3309a4d58c54ffc99027b1d7c1e5ad2235b5cd1f72a76',
        'check_foundation.py': 'c2975b19bd46d00acbdbc08227545b8f9c9501d7b8e8783e9b397751c612bd13'}
RECOVERY_STAGES = ('diagnose', 'task_review')
CONTROL_STAGES = ('park', 'resume', 'reconcile')
CONTROL_CAPABILITY = 'scheduling-exact-outcome-v1'
STAGES = ('failure_diagnosis', 'claim', 'author', 'publish', 'qa', 'ci', 'integrate', 'promote', 'dev', 'qa_qualification') + RECOVERY_STAGES
PROFILES = ('auto', 'codex', 'cursor', 'agy')
SHA = re.compile('[0-9a-f]{40}')

class Refused(Exception):
    pass

class Retry(Refused):
    def __init__(self, reason, after=30):
        super().__init__(reason)
        self.after = max(1, int(after))

class SubmissionFailed(Refused):
    """A definitive per-request HTTP validation refusal, not an authority failure."""

class SubmissionUnknown(Retry):
    """The HTTP submission may have succeeded; never retry within this pass."""

def need(ok, reason):
    if not ok:
        raise Refused(reason)

def unique(pairs):
    result = {}
    for k, v in pairs:
        need(k not in result, 'duplicate JSON key')
        result[k] = v
    return result

def loads(raw):
    return json.loads(raw, object_pairs_hook=unique)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def live():
    modules = []
    for filename in ('slots.py', 'autonomous_issues.py'):
        path = HERE / 'live' / filename
        need(hashlib.sha256(path.read_bytes()).hexdigest() == PINS[filename], 'LIVE library drift')
        spec = importlib.util.spec_from_file_location('train_' + filename[:-3], path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        modules.append(module)
    need(hashlib.sha256((HERE / 'live/check_foundation.py').read_bytes()).hexdigest()
         == PINS['check_foundation.py'], 'foundation drift')
    # Preserve the pinned parser, adding the bounded AGY-author admission at
    # its public entry point for legacy V2 tasks as well as cost-policy tasks.
    issues, slots = modules[1], modules[0]
    validate_issue = issues.validate_issue
    def admitted_issue(*args, **kwargs):
        task = validate_issue(*args, **kwargs)
        if (any(r.split(':')[0] == 'agy' for r in task.get('author_routes', []))
                and not executable_independent_qa(task, slots.MODEL_ADAPTER)):
            raise issues.Hold('AGY author requires an executable independent non-agy QA route')
        return task
    issues.validate_issue = admitted_issue
    return issues, slots

def safe_credential(value):
    # Transport/header safety only. GitHub authenticates the opaque token; clients
    # must not interpret JWT contents or assume a fixed token alphabet/length.
    return (isinstance(value, str) and 10 <= len(value) <= 4096 and value.isascii()
            and all(33 <= ord(char) <= 126 for char in value))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Fixed GitHub/public DEV endpoints must never forward credentials via redirects.
        raise Refused('API redirect refused')


class API:
    """Token kept only in trusted process memory. Never included in exceptions/URLs/env/models."""
    def __init__(self, token, opener=None):
        need(safe_credential(token), 'invalid API credential')
        self._token = token
        self.opener = opener if opener is not None else urllib.request.build_opener(_NoRedirect()).open

    def __call__(self, path, data=None, method=None):
        public = path == 'https://dev.gobadminton.ru/v1/meta'
        need(public or (not path.startswith('/') and '://' not in path and '..' not in path), 'API path refused')
        url = path if public else f'https://api.github.com/repos/{REPO}' + ('/' + path if path else '')
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'gb-actions-train',
                   'X-GitHub-Api-Version': '2022-11-28'}
        if not public:
            headers['Authorization'] = 'Bearer ' + self._token
        req = urllib.request.Request(url, headers=headers, method=method,
                                     data=None if data is None else json.dumps(data).encode())
        # Retry only GET. Non-idempotent dispatch/comment failures are reconciled from durable state.
        for attempt in range(3):
            try:
                with self.opener(req, timeout=30) as response:
                    raw = response.read(2097153)
                need(len(raw) <= 2097152, 'API response too large')
                return loads(raw) if raw else None
            except urllib.error.HTTPError as error:
                if error.code in (403, 429):
                    h = error.headers
                    try:
                        retry = h.get('Retry-After')
                        delay = (float(retry) if retry and retry.isdigit() else
                                 email.utils.parsedate_to_datetime(retry).timestamp() - time.time() if retry else 0)
                        if h.get('X-RateLimit-Remaining') == '0':
                            delay = max(delay, float(h.get('X-RateLimit-Reset', 0)) - time.time())
                    except (TypeError, ValueError):
                        delay = 60
                    raise Retry('GitHub rate/permission response ' + str(error.code), max(1, delay)) from None
                if error.code < 500:
                    specific = (data is not None and path == 'actions/workflows/train-stage.yml/dispatches'
                                and error.code in (400, 409, 422))
                    kind = SubmissionFailed if specific else Refused
                    raise kind('GitHub response ' + str(error.code)) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            if data is not None or method not in (None, 'GET') or attempt == 2:
                kind = (SubmissionUnknown if data is not None
                        and path == 'actions/workflows/train-stage.yml/dispatches' else Retry)
                raise kind('API unavailable; reconcile before retry') from None
            time.sleep(2 ** attempt)

    def pages(self, path, key=None):
        items = []
        for page in range(1, 101):
            value = self(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            rows = value[key] if key else value
            need(isinstance(rows, list), 'invalid API page')
            items.extend(rows)
            if len(rows) < 100:
                return items
        raise Refused('pagination exhausted')

    def identity(self):
        repo = self('')
        need(repo['id'] == REPO_ID and repo['full_name'] == REPO and repo['default_branch'] == 'main',
             'repository identity mismatch')

    def job_log(self, job_id):
        """One fixed GET; signed blob redirect gets NO GitHub credential. No write/retry."""
        need(type(job_id) is int and job_id > 0, 'invalid log job')
        class Capture(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args): return None
        opener = urllib.request.build_opener(Capture()).open
        req = urllib.request.Request(f'https://api.github.com/repos/{REPO}/actions/jobs/{job_id}/logs',
                headers={'Authorization': 'Bearer ' + self._token, 'User-Agent': 'gb-actions-train'})
        try:
            response = opener(req, timeout=30)
        except urllib.error.HTTPError as error:
            need(error.code == 302, 'exact job log unavailable')
            target = urllib.parse.urlsplit(error.headers.get('Location', ''))
            need(target.scheme == 'https' and target.hostname is not None
                 and target.hostname.endswith('.blob.core.windows.net') and target.port in (None, 443)
                 and not target.username and not target.password and not target.fragment,
                 'untrusted log redirect')
            response = urllib.request.build_opener(_NoRedirect()).open(
                urllib.request.Request(target.geturl(), headers={'User-Agent': 'gb-actions-train'}), timeout=30)
        with response:
            raw = response.read(1048577)
        need(len(raw) <= 1048576, 'exact job log exceeds evidence bound')
        return raw.decode('utf-8', errors='replace')

def request(value):
    need(isinstance(value, dict) and value.get('action') == 'train', 'invalid train envelope')
    if value.get('stage') == 'status':
        need(set(value) in ({'action', 'stage'}, {'action', 'stage', 'slot', 'operation'}), 'unknown status fields')
        if 'operation' in value:
            need(value['slot'] in ('slot1', 'slot2') and isinstance(value['operation'], str)
                 and re.fullmatch('[a-f0-9]{64}', value['operation']), 'invalid outcome query')
        return value
    if value.get('stage') == 'planning':
        from queue_diagnostics import valid_report
        need(set(value) == {'action','stage','controller_sha','run','run_attempt','report'}, 'unknown planning fields')
        need(isinstance(value['controller_sha'],str) and SHA.fullmatch(value['controller_sha']), 'invalid planning controller')
        need(type(value['run']) is int and 0 < value['run'] < 10**18 and
             type(value['run_attempt']) is int and 0 < value['run_attempt'] < 10000, 'invalid planning run')
        need(valid_report(value['report']), 'invalid planning report')
        return value
    if value.get('stage') in CONTROL_STAGES:
        from scheduling_control import validate_request
        return validate_request(value)
    need(set(value) == {'action', 'stage', 'slot', 'issue', 'phase', 'head', 'attempt',
                        'generation', 'run', 'run_attempt', 'profile', 'gh_token'}, 'unknown stage fields')
    need(value['stage'] in STAGES and value['slot'] in ('slot1', 'slot2'), 'unknown stage/slot')
    for k, lo, hi in (('issue', 1, 10**9), ('attempt', 0, 3), ('generation', 0, 10**9),
                      ('run', 1, 10**18), ('run_attempt', 1, 10000)):
        need(type(value[k]) is int and lo <= value[k] <= hi, 'invalid ' + k)
    need(value['phase'] in ('idle', 'claimed', 'developing', 'candidate', 'pr_wait', 'qa', 'ci',
                             'integrating', 'promoting', 'dev_wait', 'done', 'blocked'), 'invalid phase')
    need(value['head'] is None or isinstance(value['head'], str) and SHA.fullmatch(value['head']), 'invalid head')
    need(value['profile'] in PROFILES, 'unknown profile')
    need(safe_credential(value['gh_token']), 'invalid API credential')
    if value['stage'] == 'qa_qualification':
        need(value['slot'] == 'slot2' and value['issue'] == 29 and value['phase'] == 'idle'
             and value['attempt'] == 0 and value['profile'] == 'agy' and value['head'] is not None,
             'invalid bounded QA qualification request')
    return value

def binding(req):
    return {k: v for k, v in req.items() if k not in ('gh_token', 'run', 'run_attempt')}

_CODEX_MODELS = ('gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna')


def _codex_model_effort_admitted(model, effort):
    return (model in _CODEX_MODELS and effort in ('medium', 'high')
            and (model != 'gpt-6-luna' or effort == 'medium'))


def executable_independent_qa(task, model_adapter=None, *, policy=None):
    """Static QA resolver admission, ignoring only runtime quota/availability.

    Run the actual ordered QA walk with permissive availability and quota.
    Cursor QA is unqualified; AGY cannot review any listed AGY author.
    Passing a validated policy avoids recursion from validate_policy.
    """
    from types import SimpleNamespace
    from cost_policy import _selection, validate_policy
    slots = SimpleNamespace(
        MODEL_ADAPTER=({_model: 'codex' for _model in _CODEX_MODELS}
                       if model_adapter is None else model_adapter), UNKNOWN=object())
    budget = SimpleNamespace(remaining=lambda *args: 1, used=lambda *args: 0)
    view = task
    try:
        if 'routing_policy' in task:
            p = policy if policy is not None else validate_policy(task)
            preferred, rationale = _selection(p, task, 'qa')
            view = dict(task, qa_routes=[preferred, *rationale['approved_fallback_routes']])
        choice = _route_immutable(slots, view, 'qa', 'auto', budget, 'slot2', admission=True)
        return choice['provider'] == 'codex'
    except (Refused, ValueError):
        return False


def _route_immutable(slots, task, role, profile, budget, slot, task_hash=None, *, admission=False):
    """Choose a model by immutable stage preferences, not by relative token usage.

    V1 scalar-model Issues retain their previous route. For new V2 stage routes,
    the order is explicitly Owner-admitted: Cursor Auto implementation first,
    Codex as pre-call fallback, and Antigravity as a QA candidate. Until native
    sandboxed adapters are actually qualified, only Codex may execute.
    """
    need(role in ('author', 'qa'), 'invalid route role')
    need(not admission or role == 'qa', 'static admission is QA-only')
    stage_key = 'author_routes' if role == 'author' else 'qa_routes'
    if stage_key in task:
        need(task.get('work_kind') in ('architecture', 'implementation', 'ux', 'contract', 'test')
             and task.get('risk') in ('routine', 'complex', 'critical'),
             'invalid stage routing metadata')
        refusal = {}
        for entry in task[stage_key]:
            pieces = entry.split(':')
            need(len(pieces) in (2, 3), 'invalid immutable model route')
            provider, model = pieces[:2]
            effort = pieces[2] if len(pieces) == 3 else None
            need(provider in ('codex', 'cursor', 'agy'), 'invalid provider')
            if profile != 'auto' and provider != profile:
                refusal[entry] = 'provider profile mismatch'
                continue
            # Preserve the existing Codex permission/landlock guarantees.
            # Other providers can be enabled ONLY alongside a reviewed native
            # sandbox adapter; merely flipping an Adapter flag cannot mint it.
            if provider == 'cursor':
                need(model == 'auto' and effort is None and role == 'author', 'unqualified Cursor role/model')
                from native_cursor import available
                ok, why = available(slot, task_hash or digest(task))
                if ok:
                    left = budget.remaining('cursor', role, slot)
                    ok = left is not slots.UNKNOWN and left > 0
                    why = 'Cursor author budget UNKNOWN/exhausted' if not ok else why
                if not ok:
                    refusal[entry] = why; continue
                return dict(profile=profile, provider='cursor', requested_model='auto', effective_model='Auto',
                            underlying_model=None, effort=None, role=role, work_kind=task['work_kind'],risk=task['risk'],
                            fallback_reason=('previous preferred providers unavailable' if refusal else None),
                            unavailable=refusal, remaining_calls=left, used_calls=budget.used('cursor', role, slot))
            if provider == 'agy' and role == 'author':
                from native_antigravity_author import available, MODELS as AUTHOR_MODELS
                if model not in AUTHOR_MODELS or effort is not None:
                    refusal[entry] = 'Antigravity author role/model/effort unsupported'
                    continue
                if not executable_independent_qa(task, slots.MODEL_ADAPTER):
                    refusal[entry] = 'AGY author requires an executable independent non-agy QA route'
                    continue
                ok, why = available(slot, task_hash or digest(task), model=model)
                if not ok:
                    refusal[entry] = why; continue
                try:
                    left = budget.remaining('agy', 'author', slot)
                    used = budget.used('agy', 'author', slot)
                    ok = left is not slots.UNKNOWN and type(left) in (int, float) and left > 0
                except Exception:
                    ok = False
                if not ok:
                    refusal[entry] = 'Antigravity author budget UNKNOWN/exhausted'; continue
                return dict(profile=profile, provider='agy', requested_model=model, effective_model=model,
                            underlying_model=None, effort=None, role=role, work_kind=task['work_kind'], risk=task['risk'],
                            fallback_reason=('previous preferred providers unavailable' if refusal else None),
                            unavailable=refusal, remaining_calls=left, used_calls=used)
            if (provider == 'agy' and role == 'qa'
                    and any(r.split(':')[0] == 'agy' for r in task.get('author_routes', []))):
                refusal[entry] = 'independent QA must be a different provider'
                continue
            if provider == 'agy':
                from native_antigravity import MODELS as AGY_MODELS
                if role != 'qa' or model not in AGY_MODELS or effort is not None:
                    refusal[entry] = 'Antigravity role/model/effort not supported by native QA adapter'
                    continue
                from native_antigravity import available
                ok, why = ((True, 'static admission') if admission else
                           available(slot, task_hash or digest(task), model=model))
                # Exact model admission and executor qualification remain mandatory.
                # A route string alone cannot charge a budget or start a provider.
                if not ok:
                    refusal[entry] = why; continue
                left = budget.remaining('agy', role, slot)
                if left is slots.UNKNOWN or left <= 0:
                    refusal[entry] = 'Antigravity QA budget UNKNOWN/exhausted'; continue
                return dict(profile=profile, provider='agy', requested_model=model, effective_model=model,
                            underlying_model=None, effort=None, role=role, work_kind=task['work_kind'], risk=task['risk'],
                            fallback_reason=('previous preferred providers unavailable' if refusal else None),
                            unavailable=refusal, remaining_calls=left, used_calls=budget.used('agy', role, slot))
            if provider != 'codex':
                refusal[entry] = 'native sandbox adapter not installed'
                continue
            if model not in slots.MODEL_ADAPTER or slots.MODEL_ADAPTER[model] != provider:
                refusal[entry] = 'exact Codex model not supported by installed bridge'
                continue
            need(model in _CODEX_MODELS and effort in ('medium', 'high'),
                 'model/effort out of closed route registry')
            need(_codex_model_effort_admitted(model, effort), 'Luna effort not admitted')
            ok, why = ((True, 'static admission') if admission else
                       slots.adapter_status(provider, role, budget, slot))
            if not ok:
                refusal[entry] = why
                continue
            return dict(profile=profile, provider=provider, requested_model=model,
                        effective_model=model, effort=effort, role=role,
                        work_kind=task['work_kind'], risk=task['risk'],
                        fallback_reason=('previous preferred providers unavailable'
                                         if refusal else None),
                        unavailable=refusal,
                        remaining_calls=budget.remaining(provider, role, slot),
                        used_calls=budget.used(provider, role, slot))
        need(False, 'no safe role-specific provider: ' + json.dumps(refusal, sort_keys=True))

    # Existing immutable V1 Issue approvals are interpreted as before.
    requested = task.get('model')
    names = ['codex', 'cursor', 'agy'] if profile == 'auto' else [profile]
    options, refusals = [], {}
    for name in names:
        ok, why = slots.adapter_status(name, role, budget, slot)
        if ok and (name != 'codex' or requested not in
                   (None, 'gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna')):
            ok, why = False, 'no proven exact model adapter'
        if role == 'qa' and name != 'codex':
            ok, why = False, 'independent QA is approved only for Codex'
        if ok:
            left = budget.remaining(name, role, slot)
            used = budget.used(name, role, slot)
            options.append((used / (used + left), name))
        else:
            refusals[name] = why
    need(options, 'profile unavailable: ' + json.dumps(refusals, sort_keys=True))
    name = min(options)[1]
    model = (requested or 'gpt-6.1-sol') if role == 'author' else 'gpt-6.1-sol'
    effort = task.get('effort', 'high') if role == 'author' else 'high'
    return dict(profile=profile, provider=name, requested_model=requested,
                effective_model=model, effort=effort, role=role,
                fallback_reason=('only proven available provider with positive measured budget'
                                 if profile == 'auto' else None),
                unavailable=refusals, remaining_calls=budget.remaining(name, role, slot),
                used_calls=budget.used(name, role, slot))

def route(slots, task, role, profile, budget, slot):
    from cost_policy import selection, annotate_legacy
    if "routing_policy" in task:
        try:
            approved, rationale = selection(task, role)
        except ValueError as error:
            raise Refused(str(error)) from None
        # Internal routing view only; the immutable task/checkpoint is never changed.
        fallback = rationale.pop('approved_fallback_routes', [])
        view = dict(task, **{role + "_routes": [approved, *fallback]})
        choice = _route_immutable(slots, view, role, profile, budget, slot, task_hash=digest(task))
        choice.update(rationale)
        choice["requested_route"] = approved
    else:
        choice = _route_immutable(slots, task, role, profile, budget, slot)
        choice.update(annotate_legacy(task, choice))
        choice["requested_route"] = choice["provider"] + ":" + str(choice["requested_model"] or "default") + ":" + str(task.get("effort", "high"))
    if choice.get("remaining_calls") == float("inf"):
        choice["remaining_calls"] = None
        choice["budget_policy"] = "unlimited_daily_metered"
    else:
        choice["budget_policy"] = "finite_daily"
    choice["requested_effort"] = choice["effort"]
    choice["effective_effort"] = choice["effort"]
    return choice

def task_review_route(slots, task, budget, slot):
    """Task-definition review has a Codex JSON contract, using admitted QA routes."""
    choice = route(slots, task, 'qa', 'codex', budget, slot)
    need(choice['provider'] == 'codex', 'task_review requires an admitted compatible Codex route')
    return dict(choice, stage_role='task_review', permission_role='qa')

def diagnosis_route(slots, task, budget, slot):
    """#218 uses qualified Codex QA permissions/ledger, never ordinary QA selection."""
    from failure_diagnosis import policy
    policy(task)
    need(slots.MODEL_ADAPTER.get('gpt-6-astra') == 'codex', 'Astra exact model unavailable')
    ok, why = slots.adapter_status('codex', 'qa', budget, slot)
    need(ok, 'Astra failure diagnosis unavailable: ' + str(why))
    left = budget.remaining('codex', 'qa', slot)
    return dict(profile='codex', provider='codex', role='failure_diagnosis', permission_role='qa',
                requested_route='codex:gpt-6-astra:high', requested_model='gpt-6-astra',
                effective_model='gpt-6-astra', effort='high', requested_effort='high',
                effective_effort='high', fallback_reason=None, unavailable={},
                selection_reason='mandatory_source_FAIL_218', used_calls=budget.used('codex','qa',slot),
                remaining_calls=None if left == float('inf') else left,
                budget_policy='unlimited_daily_metered' if left == float('inf') else 'finite_daily')

def next_stage(active):
    if not active or active['phase'] == 'done':
        return None
    p = active['phase']
    if p == 'claimed': return 'author'
    if p == 'candidate': return 'publish'
    from failure_diagnosis import next_stage as repair_stage
    if p == 'pr_wait': return repair_stage(active) if active.get('deterministic_failure') else 'qa'
    if p == 'qa': return 'ci' if (active.get('qa') or {}).get('verdict') == 'PASS' else repair_stage(active)
    if p == 'ci': return repair_stage(active) if active.get('ci_failure') else 'integrate' if active.get('ci') else 'ci'
    if p == 'promoting': return 'promote'
    if p == 'dev_wait': return 'dev'
    return None

def plan(a, s, snapshot, candidates, profile='auto'):
    """One finite pass. Issues are durable intent; no dispatch queue is treated as a task store."""
    occupied, completed, blocked = [], set(), set()
    for card in snapshot['slots'].values():
        completed.update(card['done'])
        blocked.update(card['parked'])
        active = card.get('active')
        if card.get('reservation'):
            occupied.append(card['reservation'])
        if active and active['phase'] != 'done':
            occupied.append(s.task_record(active['issue'], active['task']))
    out = []
    # Prefer the longest-idle slot, not slot1 on every empty-queue wake.
    def last_confirmed(item):
        card = item[1]
        return ((card.get('confirmed') or card.get('last') or {}).get('confirmed_at') or 0, item[0])
    for name, card in sorted(snapshot['slots'].items(), key=last_confirmed):
        if not card['owned']:
            continue
        pending = card.get('pending')
        if pending:
            if pending['status'] == 'unknown' and pending.get('recoverable', True) and pending['binding']['stage'] in ('publish', 'integrate', 'promote', 'dev', 'qa'):
                out.append({k: v for k, v in pending['binding'].items() if k != 'action'})
            continue
        active = card.get('active')
        qualification = card.get('qa_qualification')
        if snapshot.get('mode') == 'active' and name == 'slot2' and active is None and qualification:
            need(set(qualification) == {'slot','issue','stage','phase','head','attempt','generation','profile'}
                 and qualification['slot'] == name and qualification['issue'] == 29
                 and qualification['stage'] == 'qa_qualification' and qualification['phase'] == 'idle'
                 and qualification['attempt'] == 0 and qualification['profile'] == 'agy'
                 and qualification['generation'] == card['generation']
                 and isinstance(qualification['head'], str) and SHA.fullmatch(qualification['head']),
                 'invalid root QA qualification proposal')
            out.append(dict(qualification))
            continue  # Only this free slot; no product claim/author checkpoint is manufactured.
        if active and active['phase'] != 'done':
            stage = next_stage(active)
            if stage:
                out.append(dict(slot=name, issue=active['issue'], stage=stage, phase=active['phase'],
                                head=active['head'], attempt=active['attempt'], generation=card['generation'],
                                profile=card.get('profile') or profile))
            continue
        from queue_diagnostics import provider_ready
        if not provider_ready(card, profile):
            continue
        for issue, task in candidates:
            record = s.task_record(issue, task)
            if issue in completed | blocked or any(s.conflicts(record, r) for r in occupied):
                continue
            if not set(task.get('depends_on', [])) <= completed:
                continue
            out.append(dict(slot=name, issue=issue, stage='claim', phase='idle', head=None,
                            attempt=0, generation=card['generation'], profile=profile))
            occupied.append(record)
            break
    return out
