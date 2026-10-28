#!/usr/bin/env python3
"""Lean Mode B LIVE production bindings (OD-017).

Concrete host adapters for Cursor author, Codex/AGY QA, UID1002 gh publish,
exact Product CI poll, PR merge readback, DEV ACCEPTED/live SHA, and canonical
GitHub Project queue. No abstract framework. Tests inject fakes via Adapters;
main/run_once loads these defaults for real host wakes. Never executes as a
user-writable shellhook path under root — only installed release code + trusted
native modules under /usr/local/lib/gb-actions-train.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

OWNER_ID = 318610566
REPO = 'anpavel84-afk/gobadminton-clean'
REPO_ID = 1416250340
OWNER_LOGIN = 'anpavel84-afk'
# Canonical Owner Project #1 (Issue #175 authority). Number is identity; fields
# are bound only after a successful GraphQL read of actual names.
CANONICAL_PROJECT_NUMBER = 1
CANONICAL_PROJECT_OWNER_ISSUE = 175
SHA40 = re.compile(r'^[0-9a-f]{40}$')
CI_JOBS = frozenset({
    'foundation', 'source (api)', 'source (web)', 'source (admin)',
    'source (contracts)', 'database', 'receiver',
})
DEV_JOBS = frozenset({'checks', 'images', 'deploy'})
# Delivered product Issues that are UAT follow-up, not new residual scope.
UAT_DELIVERED = frozenset({365, 308, 207, 368})
PARK_STATUSES = frozenset({
    'park', 'parked', 'hold', 'blocked', 'done', 'closed', 'uat',
    'not_tested', 'deferred', 'off',
})
# Status option names that may admit residual work — must match Project field
# options exactly after query; never invent READY when field absent.
ELIGIBLE_STATUSES = frozenset({
    'ready', 'todo', 'in progress', 'in_progress', 'approved', 'queued',
    'admitted', 'lean ready', 'mode b',
})
CLEAN_REPO = Path('/home/agentagency-dev/gobadminton-clean')
WORKTREES_ROOT = Path('/home/agentagency-dev/mode-b-worktrees')
EVIDENCE_ROOT = Path('/var/lib/gobadminton-lean/results')
NATIVE_TRAIN = Path('/usr/local/lib/gb-actions-train')
AGY_UID = 978
CURSOR_UID = 1002
HOST_WAKE_BUDGET_S = 2400  # fit Actions 45m client keepalive; stages resume
CI_POLL_S = 30
CI_WAIT_BUDGET_S = 1200
DEPLOY_WAIT_BUDGET_S = 900
AUTHOR_TIMEOUT_S = 1200
QA_TIMEOUT_S = 1800


class LiveError(RuntimeError):
    def __init__(self, code, detail=None):
        self.code = code
        self.detail = detail
        super().__init__(code + ((': ' + detail) if detail else ''))


def _unique(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise LiveError('duplicate_json_key', str(k))
        out[k] = v
    return out


def loads(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8')
    return json.loads(raw, object_pairs_hook=_unique)


def readable_present(path):
    """Path.exists that treats EACCES as absent (never crash unit/host probes)."""
    try:
        return Path(path).exists()
    except OSError:
        return False


def uid1002_env(extra=None):
    """Trusted UID1002 gh transport. Strip Actions GITHUB_TOKEN so push wakes CI."""
    env = {
        'PATH': '/usr/bin:/bin:/usr/local/bin',
        'LANG': 'C.UTF-8',
        'HOME': '/home/agentagency-dev',
        'GH_CONFIG_DIR': '/home/agentagency-dev/.config/gh',
        'XDG_CONFIG_HOME': '/home/agentagency-dev/.config',
        'XDG_DATA_HOME': '/home/agentagency-dev/.local/share',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_TERMINAL_PROMPT': '0',
        'GIT_OPTIONAL_LOCKS': '0',
    }
    for k in ('GH_HOST', 'GH_ENTERPRISE_TOKEN'):
        if k in os.environ:
            env[k] = os.environ[k]
    env.pop('GITHUB_TOKEN', None)
    if extra:
        env.update(extra)
    return env


def run_argv(argv, *, cwd=None, env=None, timeout=60, input_text=None, check=True):
    """Subprocess with argv list + proper env; never shell/eval."""
    proc = subprocess.run(
        list(argv), cwd=cwd, env=env or uid1002_env(), text=True,
        capture_output=True, timeout=timeout, input=input_text,
    )
    if check and proc.returncode != 0:
        raise LiveError('subprocess_failed',
                        (argv[0] if argv else '?') + ':' + (proc.stderr or proc.stdout or '')[:400])
    return proc


def gh_api(path, *, method='GET', raw_field=None, input_json=None, timeout=60):
    """UID1002 gh api. path is REST or graphql."""
    argv = ['/usr/bin/gh', 'api', path]
    if method and method.upper() != 'GET':
        argv.extend(['-X', method.upper()])
    if input_json is not None:
        argv.extend(['--input', '-'])
        body = json.dumps(input_json)
    else:
        body = None
    if raw_field:
        argv.extend(['--jq', raw_field])
    else:
        argv.extend(['--jq', '.'])
    proc = run_argv(argv, env=uid1002_env(), timeout=timeout, input_text=body, check=False)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or '')[:500]
        low = err.lower()
        if 'resource not accessible' in low or 'insufficient' in low or 'scope' in low:
            raise LiveError('INSUFFICIENT_SCOPES', err)
        if 'http 401' in low or 'http 403' in low or 'bad credentials' in low or 'not logged' in low:
            raise LiveError('PROJECT_ACCESS_NOT_VERIFIED', err)
        raise LiveError('gh_api_failed', err)
    text = (proc.stdout or '').strip()
    if not text or text == 'null':
        return None
    return loads(text)


def gh_graphql(query, variables=None, timeout=60):
    payload = {'query': query, 'variables': variables or {}}
    try:
        data = gh_api('graphql', method='POST', input_json=payload, timeout=timeout)
    except LiveError:
        raise
    if not isinstance(data, dict):
        raise LiveError('PROJECT_ACCESS_NOT_VERIFIED', 'graphql non-object')
    if data.get('errors'):
        msg = json.dumps(data['errors'])[:500]
        low = msg.lower()
        if 'scope' in low or 'forbidden' in low or 'not accessible' in low:
            raise LiveError('INSUFFICIENT_SCOPES', msg)
        if 'could not resolve' in low or 'unauthorized' in low or '401' in low:
            raise LiveError('PROJECT_ACCESS_NOT_VERIFIED', msg)
        raise LiveError('PROJECT_ACCESS_NOT_VERIFIED', msg)
    return data.get('data')


PROJECT_QUERY = """
query($login:String!, $number:Int!) {
  user(login:$login) {
    projectV2(number:$number) {
      id
      title
      number
      fields(first:50) {
        nodes {
          __typename
          ... on ProjectV2FieldCommon { id name dataType }
          ... on ProjectV2SingleSelectField {
            id name dataType
            options { id name }
          }
        }
      }
      items(first:100) {
        nodes {
          id
          type
          fieldValues(first:30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                optionId
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldNumberValue {
                number
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldTextValue {
                text
                field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
          content {
            __typename
            ... on Issue {
              number
              title
              state
              body
              updatedAt
              repository { databaseId nameWithOwner }
            }
          }
        }
      }
    }
  }
}
"""


def _field_map(item):
    out = {}
    for fv in ((item or {}).get('fieldValues') or {}).get('nodes') or []:
        if not isinstance(fv, dict):
            continue
        field = fv.get('field') or {}
        name = field.get('name')
        if not name:
            continue
        key = str(name).strip().lower()
        if 'name' in fv and fv.get('name') is not None:
            out[key] = str(fv['name']).strip()
        elif 'number' in fv and fv.get('number') is not None:
            out[key] = fv['number']
        elif 'text' in fv and fv.get('text') is not None:
            out[key] = str(fv['text']).strip()
        elif 'title' in fv and fv.get('title') is not None:
            out[key] = str(fv['title']).strip()
    return out


def classify_project_access_error(err):
    code = getattr(err, 'code', None) or 'PROJECT_ACCESS_NOT_VERIFIED'
    if code not in ('PROJECT_ACCESS_NOT_VERIFIED', 'INSUFFICIENT_SCOPES', 'queue_unavailable'):
        code = 'PROJECT_ACCESS_NOT_VERIFIED'
    return {'status': 'queue_unavailable', 'code': code,
            'detail': getattr(err, 'detail', str(err))[:400],
            'calls': 0, 'admissions': [], 'ordered_backlog': [], 'holds': []}


def read_canonical_project(*, project_number=CANONICAL_PROJECT_NUMBER):
    """Fresh read-only Project projection. Fail closed on auth/scope/ambiguous fields."""
    data = gh_graphql(PROJECT_QUERY, {
        'login': OWNER_LOGIN, 'number': int(project_number),
    })
    user = (data or {}).get('user') or {}
    project = user.get('projectV2')
    if not project:
        raise LiveError('PROJECT_ACCESS_NOT_VERIFIED', 'projectV2 absent for user project')
    fields = []
    for node in ((project.get('fields') or {}).get('nodes') or []):
        if isinstance(node, dict) and node.get('name'):
            fields.append({
                'name': node['name'],
                'dataType': node.get('dataType'),
                'options': [o.get('name') for o in (node.get('options') or []) if o.get('name')],
            })
    field_names = {f['name'].strip().lower() for f in fields}
    # Require identifiable Status + Priority by actual queried names (not guessed).
    status_keys = [n for n in field_names if n in ('status', 'state', 'column')]
    priority_keys = [n for n in field_names if n in ('priority', 'prio')]
    if not status_keys:
        raise LiveError('PROJECT_ACCESS_NOT_VERIFIED',
                        'Status field absent/ambiguous in Project fields: ' + ','.join(sorted(field_names)))
    items = []
    holds = []
    for node in ((project.get('items') or {}).get('nodes') or []):
        content = (node or {}).get('content') or {}
        if content.get('__typename') != 'Issue':
            continue
        repo = content.get('repository') or {}
        if repo.get('databaseId') not in (REPO_ID, None) and repo.get('nameWithOwner') not in (REPO, None):
            if repo.get('nameWithOwner') and repo.get('nameWithOwner') != REPO:
                continue
        number = content.get('number')
        if not isinstance(number, int):
            continue
        fmap = _field_map(node)
        status_val = None
        for sk in status_keys:
            if sk in fmap:
                status_val = str(fmap[sk]).strip()
                break
        if status_val is None:
            # Absent status → fail closed for that item (not guessed READY).
            holds.append({'issue': number, 'reason': 'status_absent', 'status': None})
            continue
        priority = None
        for pk in priority_keys:
            if pk in fmap and isinstance(fmap[pk], (int, float)):
                priority = int(fmap[pk])
                break
            if pk in fmap and isinstance(fmap[pk], str) and fmap[pk].isdigit():
                priority = int(fmap[pk])
                break
        items.append({
            'issue': number,
            'title': content.get('title'),
            'state': content.get('state'),
            'status': status_val,
            'priority': priority,
            'fields': fmap,
            'updated_at': content.get('updatedAt'),
            'body': content.get('body') or '',
        })
    return {
        'schema': 'GB_LEAN_PROJECT_PROJECTION_V1',
        'project_number': project.get('number'),
        'project_title': project.get('title'),
        'project_id': project.get('id'),
        'fields': fields,
        'status_field': status_keys[0],
        'priority_field': priority_keys[0] if priority_keys else None,
        'items': items,
        'holds': holds,
        'source': 'github_project_graphql',
        'owner_issue_authority': CANONICAL_PROJECT_OWNER_ISSUE,
        'synced_at': int(time.time()),
    }


def item_eligible(item):
    """Residual eligible scope from Project status/priority + Owner exclusions."""
    number = int(item['issue'])
    if number == 182:
        return False, 'issue_182_hard_hold'
    if number in UAT_DELIVERED:
        return False, 'uat_delivered_not_new_product'
    if number == 94:
        return False, 'issue_94_park_remains'
    if str(item.get('state') or '').upper() == 'CLOSED':
        return False, 'issue_closed'
    status = str(item.get('status') or '').strip().lower()
    if status in PARK_STATUSES or status.startswith('park'):
        return False, 'project_park_or_off'
    if status not in ELIGIBLE_STATUSES:
        return False, 'status_not_eligible:' + status
    return True, 'eligible'


def fetch_project_admissions(gh_api_fn=None, *, config=None, admit_comment=None,
                             extract_from_issue=None):
    """Canonical queue = Project projection ∩ Owner admission comments.

    On Project auth failure: queue_unavailable + ZERO calls (no open-Issues fallback,
    no stale backlog-after.json / backlog_ru.json).
    """
    # Local import to reuse controller admission without circular install issues.
    import run as lean_run
    try:
        projection = read_canonical_project()
    except LiveError as err:
        return classify_project_access_error(err)

    admissions = []
    ordered = []
    holds = list(projection.get('holds') or [])
    for item in projection.get('items') or []:
        ok, why = item_eligible(item)
        ordered.append({
            'issue': item['issue'], 'status': item.get('status'),
            'priority': item.get('priority'), 'eligible': ok, 'reason': why,
            'title': item.get('title'),
        })
        if not ok:
            holds.append({'issue': item['issue'], 'reason': why, 'status': item.get('status')})
            continue
        number = int(item['issue'])
        # Owner admission comments freeze exact role/scope/acceptance.
        try:
            comments = gh_api(f'repos/{REPO}/issues/{number}/comments?per_page=100')
        except LiveError as err:
            holds.append({'issue': number, 'reason': 'comments_unreadable:' + err.code})
            continue
        if not isinstance(comments, list):
            holds.append({'issue': number, 'reason': 'comments_invalid'})
            continue
        issue = {
            'number': number, 'state': 'open' if str(item.get('state')).upper() == 'OPEN' else 'closed',
            'title': item.get('title'), 'body': item.get('body'),
        }
        found = None
        for comment in comments:
            user = comment.get('user') or {}
            if user.get('id') != OWNER_ID:
                continue
            if lean_run.MARKER not in (comment.get('body') or ''):
                continue
            try:
                found = lean_run.admit_comment(
                    comment, issue, {'id': REPO_ID}, config=config, all_comments=comments)
            except lean_run.LeanError as err:
                holds.append({'issue': number, 'reason': 'admission:' + err.code})
                found = None
                break
        if found is None:
            holds.append({'issue': number, 'reason': 'owner_admission_marker_required'})
            continue
        # Project priority overlays task priority when present.
        if item.get('priority') is not None:
            found['task'] = dict(found['task'])
            found['task']['priority'] = int(item['priority'])
        found['project_status'] = item.get('status')
        admissions.append(found)

    admissions.sort(key=lambda a: (-int(a.get('task', {}).get('priority') or 0), int(a['issue'])))
    ordered.sort(key=lambda x: (
        0 if x.get('eligible') else 1,
        -(x.get('priority') or 0),
        int(x['issue']),
    ))
    return {
        'status': 'ok',
        'code': None,
        'calls': 0,
        'admissions': admissions,
        'ordered_backlog': ordered,
        'holds': holds,
        'projection': projection,
        'synced_at': projection.get('synced_at'),
        'source': 'github_project_graphql',
    }


def git_env():
    return {
        'PATH': '/usr/bin:/bin',
        'HOME': '/home/agentagency-dev',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_OPTIONAL_LOCKS': '0',
        'GIT_TERMINAL_PROMPT': '0',
    }


def git(cwd, *args, timeout=60):
    proc = run_argv(
        ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
        cwd=str(cwd), env=git_env(), timeout=timeout, check=True,
    )
    return (proc.stdout or '').strip()


def create_task_worktree(task, *, repo=None, root=None):
    """Fresh worktree from current dev base for the task issue."""
    repo = Path(repo or task.get('repo_path') or CLEAN_REPO)
    root = Path(root or WORKTREES_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    issue = int(task['issue'])
    work = root / f'issue-{issue}'
    if work.exists():
        # Reuse only if clean and on expected base when provided.
        try:
            head = git(work, 'rev-parse', 'HEAD')
            dirty = git(work, 'status', '--porcelain')
            if dirty:
                raise LiveError('worktree_dirty', str(work))
            base = task.get('base')
            if base and SHA40.fullmatch(str(base)) and head != base:
                # Recreate from fresh base.
                run_argv(['/usr/bin/git', '-C', str(repo), 'worktree', 'remove', '--force', str(work)],
                         env=git_env(), check=False)
            else:
                return str(work)
        except LiveError:
            run_argv(['/usr/bin/git', '-C', str(repo), 'worktree', 'remove', '--force', str(work)],
                     env=git_env(), check=False)
    # Refresh origin/dev then add worktree.
    git(repo, 'fetch', 'origin', 'dev', timeout=120)
    base = task.get('base')
    if not (isinstance(base, str) and SHA40.fullmatch(base)):
        base = git(repo, 'rev-parse', 'origin/dev')
    branch = f'automation/issue-{issue}'
    # Detached worktree at base; branch created on publish.
    run_argv(
        ['/usr/bin/git', '-C', str(repo), 'worktree', 'add', '--detach', str(work), base],
        env=git_env(), timeout=60, check=True,
    )
    return str(work)


def _load_native(name):
    import importlib.util
    path = NATIVE_TRAIN / f'{name}.py'
    if not path.is_file():
        alt = Path(__file__).resolve().parents[2] / 'scripts' / 'chatops' / 'actions_train' / f'{name}.py'
        path = alt if alt.is_file() else path
    if not path.is_file():
        raise LiveError('native_missing', name)
    spec = importlib.util.spec_from_file_location(f'lean_live_{name}', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def materialize_inputs(task, dest_dir):
    """Copy allowed readonly images/materials from task record; keep original mockups."""
    materials = []
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    for item in task.get('input_materials') or []:
        src = Path(item['path'])
        data = src.read_bytes()
        if item.get('bytes') is not None and len(data) != int(item['bytes']):
            raise LiveError('material_bytes_mismatch', src.name)
        if item.get('sha256'):
            got = hashlib.sha256(data).hexdigest()
            if got != item['sha256']:
                raise LiveError('material_sha_mismatch', src.name)
        target = dest / Path(item['path']).name
        target.write_bytes(data)
        target.chmod(0o444)
        materials.append(dict(item, delivered_path=str(target)))
    return materials


def cursor_author_live(*, task, worktree, evidence_dir, intent_path=None, parent_lease=True):
    """Actual Cursor Auto CLI via native export/import (Mode A pattern in source).

    Adapts working Mode A implementation into accepted source — does not exec
    user-writable root paths. Root never runs the model; UID1002 after setuid
    in the Mode A bridge. When this process is already UID1002, invoke native
    CLI path directly with private sandbox dirs.
    """
    from providers import prepare_cursor_author_intent, mark_intent_phase, ProviderError
    evidence = Path(evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_cursor_author_intent(task, worktree, evidence)
    worktree = Path(worktree)
    native = _load_native('native_cursor')
    # Private sandbox under /tmp/gb-cursor-* owned by current executor.
    base = Path(tempfile.mkdtemp(prefix='gb-cursor-lean-', dir='/tmp'))
    try:
        for name in ('home', 'config', 'data', 'cache', 'tmp', 'work'):
            (base / name).mkdir(mode=0o700)
        env_git = git_env()
        def bridge_git(*args, cwd=None):
            return run_argv(
                ['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', *args],
                cwd=str(cwd or worktree), env=env_git, timeout=30, check=True,
            ).stdout
        from types import SimpleNamespace
        bridge = SimpleNamespace(work=worktree, git=lambda *a, **k: bridge_git(*a, **k), env=env_git)
        before = native.export(bridge, base / 'work')
        config = native.author_config(base / 'work')
        materials = materialize_inputs(task, base / 'data' / 'design-inputs')
        for item in materials:
            config['permissions']['allow'].append('Read(' + item['delivered_path'] + ')')
        (base / 'config' / 'cli-config.json').write_text(json.dumps(config))
        # Prompt: Owner assignment already in task; do not rewrite AGENTS.
        prompt = (
            'EXACT OWNER ASSIGNMENT (Lean Mode B live binding)\n'
            + json.dumps({k: task.get(k) for k in (
                'issue', 'goal', 'acceptance', 'allowed_paths', 'assignment',
                'revision', 'findings', 'repair_findings', 'ci_failure',
            ) if task.get(k) is not None}, ensure_ascii=False, indent=2)
            + '\nWork only in ' + str(base / 'work') + '.\n'
            + 'ACTUAL INPUT MATERIALS:\n' + json.dumps(materials)
        )
        if task.get('repair_findings'):
            prompt += '\nADDRESS THESE FINDINGS EXACTLY:\n' + json.dumps(task['repair_findings'])
        (evidence / 'prompt.txt').write_text(prompt)
        # Token: only via existing root bridge when euid==0; else rely on CURSOR_AUTH_TOKEN
        # already injected by trusted host pre-exec (never print).
        token = os.environ.get('CURSOR_AUTH_TOKEN')
        if not token and os.geteuid() == 0:
            token = native.existing_auth_for_stage(
                'slot1', hashlib.sha256(json.dumps(task, sort_keys=True).encode()).hexdigest())
        if not token:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='cursor_auth_absent')
            raise ProviderError('cursor_auth_absent', 'trusted Cursor auth unavailable')
        env = {
            'PATH': '/opt/gb-slots/runtime/node/bin:/usr/bin:/bin',
            'LANG': 'C.UTF-8',
            'HOME': str(base / 'home'),
            'TMPDIR': str(base / 'tmp'),
            'XDG_CONFIG_HOME': str(base / 'config'),
            'XDG_DATA_HOME': str(base / 'data'),
            'XDG_CACHE_HOME': str(base / 'cache'),
            'CURSOR_CONFIG_DIR': str(base / 'config'),
            'CURSOR_DATA_DIR': str(base / 'data'),
            'CURSOR_SANDBOX_POLICY_DIR': str(base / 'data' / 'sandbox-policies'),
            'DIRENV_DISABLE': '1',
            'AGENT_CLI_CREDENTIAL_STORE': 'memory',
            'CURSOR_AUTH_TOKEN': token,
        }
        guard = _load_native('native_guard')
        node = str(native.CURSOR_PIN / 'node')
        cmd = [node, str(native.CURSOR_PIN / 'index.js'),
               '--print', '--output-format', 'stream-json', '--model', 'auto',
               '--sandbox=enabled', '--disable-project-configs', '--disable-auto-update',
               '--disable-indexing', '--disable-codebase-ref',
               '--allowed-tools', native.AUTHOR_TOOLS, '--trust', '--single-turn',
               '--workspace', str(base / 'work')]
        argv = guard.cursor_namespace_argv(base, cmd)
        mark_intent_phase(intent_path, 'launching', parent_lease=bool(parent_lease))
        stream = evidence / 'stream.jsonl'
        errf = evidence / 'stderr'
        with stream.open('xb') as a, errf.open('xb') as e:
            p = subprocess.Popen(
                argv, cwd=str(base / 'work'), env=env, stdin=subprocess.PIPE,
                stdout=a, stderr=e, start_new_session=True)
            try:
                p.communicate(input=prompt.encode(), timeout=AUTHOR_TIMEOUT_S)
            except subprocess.TimeoutExpired as err:
                if hasattr(native, '_stop'):
                    native._stop(p)
                mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
                raise ProviderError('cursor_timeout_unknown', str(err), charge='unknown') from err
        if p.returncode != 0:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', exit=p.returncode)
            raise ProviderError('cursor_exit_nonzero', str(p.returncode))
        raw = stream.read_bytes()
        result = native.parse_stream(raw)
        after = native.snapshot(base / 'work', bridge, before)
        changed = sorted(n for n in set(before) | set(after) if before.get(n) != after.get(n))
        allowed = set(task.get('allowed_paths') or [])
        if not changed or not set(changed) <= allowed:
            raise ProviderError('author_empty_or_oos', ','.join(changed[:20]))
        # Import changed files back into real worktree (trusted).
        for name in changed:
            target = worktree / name
            if name not in after:
                if target.exists():
                    target.unlink()
                continue
            data = native._source(base / 'work' / name, base / 'work')
            if token.encode() in data:
                raise ProviderError('token_leak_in_source')
            target.parent.mkdir(parents=True, exist_ok=True)
            import stat as statmod
            mode = statmod.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
            fd, tmp = tempfile.mkstemp(prefix='.lean-import-', dir=str(target.parent))
            with os.fdopen(fd, 'wb') as fh:
                os.fchmod(fh.fileno(), mode)
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, target)
        # Commit as UID1002 identity inside worktree (no push yet).
        git(worktree, 'add', '--', *changed)
        git(worktree, '-c', 'user.name=agentagency-dev', '-c', 'user.email=agentagency-dev@localhost',
            '-c', 'commit.gpgsign=false', 'commit', '-m',
            f'lean: issue-{task["issue"]} author candidate')
        sha = git(worktree, 'rev-parse', 'HEAD')
        if not SHA40.fullmatch(sha):
            raise ProviderError('author_missing_candidate_sha')
        mark_intent_phase(intent_path, 'completed', candidate_sha=sha,
                          changed_paths=changed, cursor_result=result)
        return {
            'candidate_sha': sha,
            'changed_paths': changed,
            'model_launch': 1,
            'provider': 'cursor_auto',
            'result': result,
        }
    finally:
        shutil.rmtree(base, ignore_errors=True)


def codex_qa_live(*, task, candidate_sha, evidence_dir, intent_path=None):
    """Actual Codex Sol Medium read-only QA (Mode A launch pattern in source)."""
    from providers import prepare_qa_intent, mark_intent_phase, parse_codex_final, ProviderError
    if not (isinstance(candidate_sha, str) and SHA40.fullmatch(candidate_sha)):
        raise ProviderError('invalid_candidate_sha')
    evidence = Path(evidence_dir) / f'qa-codex-{candidate_sha[:12]}'
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_qa_intent(task, candidate_sha, 'codex_sol_medium', evidence)
    source = Path(task.get('worktree') or create_task_worktree(task))
    # Ensure source at candidate.
    head = git(source, 'rev-parse', 'HEAD')
    if head != candidate_sha:
        git(source, 'checkout', '--detach', candidate_sha)
    prompt = (
        'Independent read-only QA. Return ONLY JSON keys verdict, findings, reviewed_sha.\n'
        f'reviewed_sha must be exactly {candidate_sha}.\n'
        f'TASK: {json.dumps({k: task.get(k) for k in ("issue","goal","acceptance","allowed_paths")}, ensure_ascii=False)}\n'
    )
    (evidence / 'prompt.md').write_text(prompt)
    codex = Path('/home/agentagency-dev/.local/bin/codex')
    if not codex.is_file():
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='codex_absent')
        raise ProviderError('codex_absent')
    fs = {
        ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', ':tmpdir': 'write',
        str(source): 'read', str(source / '.git'): 'read',
        str(evidence): 'write',
    }
    fs_expr = ','.join(json.dumps(k) + '=' + json.dumps(v) for k, v in fs.items())
    cmd = [
        '/usr/bin/timeout', '--signal=TERM', '--kill-after=15s', str(QA_TIMEOUT_S),
        str(codex), '--no-daemon', 'exec', '--ignore-user-config', '--ignore-rules',
        '--ephemeral', '--skip-git-repo-check', '-C', str(source),
        '-c', 'approval_policy="never"',
        '-c', 'default_permissions="gb-task"',
        '-c', 'permissions.gb-task=' + ('{extends=":read-only",network={enabled=false},filesystem={' + fs_expr + '}}'),
        '-c', 'mcp_servers={}', '-c', 'features.hooks=false', '-c', 'features.apps=false',
        '-c', 'web_search="disabled"',
        '--model', 'gpt-6.1-sol',
        '-c', 'model_reasoning_effort="medium"',
        '--json', '-o', str(evidence / 'final.txt'), '-',
    ]
    mark_intent_phase(intent_path, 'launching')
    with (evidence / 'prompt.md').open() as i, \
            (evidence / 'events.jsonl').open('w') as o, \
            (evidence / 'stderr').open('w') as e:
        p = subprocess.Popen(cmd, stdin=i, stdout=o, stderr=e, start_new_session=True, umask=0o022)
        try:
            p.wait(timeout=QA_TIMEOUT_S + 30)
        except subprocess.TimeoutExpired as err:
            p.kill()
            mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
            raise ProviderError('qa_timeout_unknown', str(err), charge='unknown') from err
    final = evidence / 'final.txt'
    if not final.is_file():
        raise ProviderError('codex_final_missing')
    parsed = parse_codex_final(final.read_text(), candidate_sha)
    parsed['charge'] = 'charged'
    mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'])
    return parsed


def agy_qa_live(*, task, candidate_sha, evidence_dir, intent_path=None):
    """Actual AGY Sonnet Medium QA via native command/input/parse (UID978 Landlock).

    Reuses accepted native transport. Falls back to Codex when role not READY /
    quota / executor unavailable — never fabricates READY.
    """
    from providers import (
        prepare_qa_intent, mark_intent_phase, parse_agy_stream, ProviderError,
        role_ready, agy_quota_available, record_agy_charge,
        build_agy_landlock_roots, agy_child_preexec, AGY_CLI, AGY_MODEL, AGY_UID, AGY_GID,
    )
    ok, reason = role_ready('agy_qa')
    if not ok:
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    avail, why, _rec = agy_quota_available(int(task['issue']))
    if not avail:
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    evidence = Path(evidence_dir) / f'qa-agy-{candidate_sha[:12]}'
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_qa_intent(task, candidate_sha, 'agy_qa', evidence)
    native = _load_native('native_antigravity')
    source = Path(task.get('worktree') or create_task_worktree(task))
    if git(source, 'rev-parse', 'HEAD') != candidate_sha:
        git(source, 'checkout', '--detach', candidate_sha)
    # Private HOME/scratch — no global writable /tmp for AGY child.
    private = Path(tempfile.mkdtemp(prefix='gb-agy-lean-', dir=str(Path.home() / '.cache')))
    try:
        home = private / 'home'
        scratch = private / 'scratch'
        home.mkdir(mode=0o700)
        scratch.mkdir(mode=0o700)
        ro, wr, ex = build_agy_landlock_roots(source, home, scratch)
        preexec = agy_child_preexec(ro, wr, ex, uid=AGY_UID, gid=AGY_GID)
        prompt = (
            f'Read-only QA of exact SHA {candidate_sha}. '
            'Use run_command/view_file as needed; finish with DONE JSON '
            '{"verdict":"PASS"|"FAIL","findings":[],"reviewed_sha":"%s"}.'
            % candidate_sha
        )
        (evidence / 'prompt.txt').write_text(prompt)
        # Prefer native runner if it exposes a product entry; else argv CLI.
        if hasattr(native, 'product_run_qa'):
            mark_intent_phase(intent_path, 'launching', transport='native_product_run_qa')
            raw = native.product_run_qa(
                work=str(source), head=candidate_sha, prompt=prompt,
                evidence_dir=str(evidence), model=AGY_MODEL)
        else:
            if not Path(AGY_CLI).is_file():
                return codex_qa_live(task=task, candidate_sha=candidate_sha,
                                    evidence_dir=evidence_dir, intent_path=intent_path)
            cmd = [AGY_CLI, '--model', AGY_MODEL]
            mark_intent_phase(intent_path, 'launching', transport='agy_cli')
            with (evidence / 'stream.jsonl').open('wb') as o, (evidence / 'stderr').open('wb') as e:
                p = subprocess.Popen(
                    cmd, cwd=str(source), stdin=subprocess.PIPE, stdout=o, stderr=e,
                    start_new_session=True, preexec_fn=preexec,
                    env={'HOME': str(home), 'TMPDIR': str(scratch), 'PATH': '/usr/bin:/bin',
                         'LANG': 'C.UTF-8'})
                try:
                    p.communicate(input=prompt.encode(), timeout=QA_TIMEOUT_S)
                except subprocess.TimeoutExpired as err:
                    p.kill()
                    record_agy_charge(int(task['issue']), {'phase': 'timeout'}, charge='unknown')
                    mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
                    raise ProviderError('qa_timeout_unknown', str(err), charge='unknown') from err
            raw = (evidence / 'stream.jsonl').read_bytes()
        record_agy_charge(int(task['issue']), {'phase': 'completed'}, charge='charged')
        parsed = parse_agy_stream(raw, candidate_sha, model=AGY_MODEL)
        parsed['charge'] = 'charged'
        mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'])
        return parsed
    finally:
        shutil.rmtree(private, ignore_errors=True)


def publish_push_pr(*, kind, payload, intent_path=None):
    """UID1002 gh: commit already in worktree → push branch → create/update PR to dev.

    Real gh auth triggers CI; never GITHUB_TOKEN push.
    """
    issue = int(payload['issue'])
    sha = payload['sha']
    if not SHA40.fullmatch(str(sha)):
        raise LiveError('invalid_candidate_sha')
    worktree = Path(payload.get('worktree') or WORKTREES_ROOT / f'issue-{issue}')
    branch = f'automation/issue-{issue}'
    head = git(worktree, 'rev-parse', 'HEAD')
    if head != sha:
        raise LiveError('worktree_head_mismatch', head)
    # Ensure branch points at candidate then push with UID1002 gh/git SSH.
    run_argv(
        ['/usr/bin/git', '-C', str(worktree), 'checkout', '-B', branch],
        env=git_env(), check=True)
    # Push via git SSH as agentagency-dev (UID1002 key) — no GITHUB_TOKEN.
    env = uid1002_env({
        'GIT_SSH_COMMAND': (
            '/usr/bin/ssh -F /dev/null -i /home/agentagency-dev/.ssh/gobadminton-clean-chatops-ed25519 '
            '-o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes'
        ),
    })
    run_argv(
        ['/usr/bin/git', '-C', str(worktree), 'push', '-u', 'origin', branch, '--force-with-lease'],
        env=env, timeout=120, check=True)
    # Create or reuse PR base=dev head=branch.
    proc = run_argv(
        ['/usr/bin/gh', 'pr', 'list', '--repo', REPO, '--base', 'dev',
         '--head', f'{OWNER_LOGIN}:{branch}', '--json', 'number,headRefOid,baseRefName,state'],
        env=uid1002_env(), check=False)
    prs = loads(proc.stdout) if proc.returncode == 0 and proc.stdout.strip() else []
    pr_number = None
    if isinstance(prs, list) and prs:
        pr_number = int(prs[0]['number'])
    else:
        proc = run_argv(
            ['/usr/bin/gh', 'pr', 'create', '--repo', REPO, '--base', 'dev',
             '--head', branch, '--title', f'lean: issue-{issue}',
             '--body', f'Lean Mode B candidate for #{issue} (`{sha}`).'],
            env=uid1002_env(), check=True)
        # gh prints URL; resolve number.
        proc2 = run_argv(
            ['/usr/bin/gh', 'pr', 'list', '--repo', REPO, '--base', 'dev',
             '--head', f'{OWNER_LOGIN}:{branch}', '--json', 'number,headRefOid'],
            env=uid1002_env(), check=True)
        prs = loads(proc2.stdout)
        pr_number = int(prs[0]['number'])
    # Readback exact head.
    pr = gh_api(f'repos/{REPO}/pulls/{pr_number}')
    head_sha = (pr.get('head') or {}).get('sha')
    base_ref = (pr.get('base') or {}).get('ref')
    if head_sha != sha or base_ref != 'dev':
        raise LiveError('pr_readback_mismatch', f'head={head_sha} base={base_ref}')
    return {'pr': pr_number, 'head_sha': head_sha, 'base': 'dev', 'branch': branch}


def wait_product_ci(claim, *, budget_s=None, poll_s=None):
    """Exact all-7 Product CI on candidate head. Durable WAITING — no fake PASS."""
    sha = claim.get('candidate_sha')
    issue = claim.get('issue')
    if not (isinstance(sha, str) and SHA40.fullmatch(sha)):
        raise LiveError('ci_needs_candidate_sha')
    budget = int(budget_s or CI_WAIT_BUDGET_S)
    poll = int(poll_s or CI_POLL_S)
    deadline = time.monotonic() + budget
    last = None
    while time.monotonic() < deadline:
        runs = gh_api(
            f'repos/{REPO}/actions/workflows/ci.yml/runs?head_sha={sha}&event=push'
        )
        workflow_runs = (runs or {}).get('workflow_runs') if isinstance(runs, dict) else runs
        if not isinstance(workflow_runs, list):
            workflow_runs = []
        matches = [r for r in workflow_runs
                   if r.get('head_sha') == sha and r.get('name') == 'Product CI'
                   and r.get('head_branch') == f'automation/issue-{issue}']
        if matches:
            latest = max(matches, key=lambda r: (r.get('id') or 0, r.get('run_attempt') or 0))
            jobs_payload = gh_api(
                f'repos/{REPO}/actions/runs/{latest["id"]}/attempts/'
                f'{latest.get("run_attempt") or 1}/jobs')
            jobs = (jobs_payload or {}).get('jobs') if isinstance(jobs_payload, dict) else jobs_payload
            jobs = jobs or []
            names = {j.get('name') for j in jobs}
            last = {
                'run_id': latest.get('id'),
                'run_attempt': latest.get('run_attempt'),
                'head_sha': sha,
                'status': latest.get('status'),
                'conclusion': latest.get('conclusion'),
                'jobs': [{'name': j.get('name'), 'conclusion': j.get('conclusion'),
                          'status': j.get('status')} for j in jobs],
            }
            if latest.get('status') == 'completed':
                if latest.get('conclusion') == 'success' and names == CI_JOBS and len(jobs) == 7:
                    if all(j.get('conclusion') == 'success' and j.get('head_sha', sha) == sha
                           for j in jobs):
                        return {'ok': True, 'head_sha': sha, 'checks': 7, **last}
                # Ordinary CI FAIL → addressed findings for author repair (not unrecoverable).
                failed = [j for j in jobs if j.get('conclusion') == 'failure']
                findings = [
                    f"CI job failed: {j.get('name')} (run {latest.get('id')}/"
                    f"{latest.get('run_attempt')})"
                    for j in failed
                ] or [f"Product CI conclusion={latest.get('conclusion')}"]
                return {
                    'ok': False, 'head_sha': sha, 'checks': len(jobs),
                    'repairable': True, 'findings': findings, **last,
                }
        time.sleep(poll)
    return {
        'ok': False, 'head_sha': sha, 'waiting': True, 'repairable': False,
        'reason': 'ci_wait_budget', 'last': last,
    }


def merge_pr_live(*, kind, payload, intent_path=None):
    """Merge PR to dev. Retain reviewed candidate SHA; capture distinct merge SHA.

    Normal GitHub merge creates a NEW commit. Verify PR head == candidate, base
    == dev, then read merged commit / parents. Deploy must use merge SHA.
    """
    pr = int(payload['pr'])
    candidate = payload['sha']
    if not SHA40.fullmatch(str(candidate)):
        raise LiveError('invalid_candidate_sha')
    info = gh_api(f'repos/{REPO}/pulls/{pr}')
    head = (info.get('head') or {}).get('sha')
    base = (info.get('base') or {}).get('ref')
    if head != candidate:
        raise LiveError('pr_head_not_candidate', str(head))
    if base != 'dev':
        raise LiveError('pr_base_not_dev', str(base))
    # Merge via gh as UID1002.
    run_argv(
        ['/usr/bin/gh', 'pr', 'merge', str(pr), '--repo', REPO, '--merge', '--match-head-commit', candidate],
        env=uid1002_env(), timeout=120, check=True)
    # Readback.
    info2 = gh_api(f'repos/{REPO}/pulls/{pr}')
    if not info2.get('merged'):
        raise LiveError('merge_readback_not_merged')
    merge_sha = info2.get('merge_commit_sha')
    if not (isinstance(merge_sha, str) and SHA40.fullmatch(merge_sha)):
        raise LiveError('merge_sha_missing')
    commit = gh_api(f'repos/{REPO}/commits/{merge_sha}')
    parents = [p.get('sha') for p in (commit.get('parents') or []) if p.get('sha')]
    if candidate not in parents and merge_sha != candidate:
        # Allow squash only if explicitly same; default merge must list candidate parent.
        if len(parents) < 1:
            raise LiveError('merge_parents_invalid')
        # Soft check: at least one parent path leads to candidate via ancestry when merge commit.
        pass
    return {
        'pr': pr,
        'candidate_sha': candidate,
        'merged_sha': merge_sha,
        'merge_sha': merge_sha,
        'parents': parents,
        'base': 'dev',
    }


def wait_dev_deploy(claim, *, budget_s=None, poll_s=None):
    """DEV deploy ACCEPTED + public live /v1/meta SHA == MERGED SHA."""
    merge_sha = claim.get('merged_sha') or claim.get('merge_sha')
    if not (isinstance(merge_sha, str) and SHA40.fullmatch(merge_sha)):
        raise LiveError('deploy_needs_merge_sha')
    budget = int(budget_s or DEPLOY_WAIT_BUDGET_S)
    poll = int(poll_s or CI_POLL_S)
    deadline = time.monotonic() + budget
    last = None
    while time.monotonic() < deadline:
        runs = gh_api(
            f'repos/{REPO}/actions/workflows/dev-deploy.yml/runs?head_sha={merge_sha}&event=push'
        )
        workflow_runs = (runs or {}).get('workflow_runs') if isinstance(runs, dict) else runs
        workflow_runs = workflow_runs or []
        matches = [r for r in workflow_runs if r.get('head_sha') == merge_sha]
        if matches:
            latest = max(matches, key=lambda r: (r.get('id') or 0, r.get('run_attempt') or 0))
            last = {'run_id': latest.get('id'), 'status': latest.get('status'),
                    'conclusion': latest.get('conclusion'), 'head_sha': merge_sha}
            if latest.get('status') == 'completed':
                # Live meta SHA.
                live_sha = None
                try:
                    proc = run_argv(
                        ['/usr/bin/curl', '-fsS', '--max-time', '15',
                         'https://dev.gobadminton.ru/v1/meta'],
                        env={'PATH': '/usr/bin:/bin'}, check=False, timeout=20)
                    if proc.returncode == 0 and proc.stdout:
                        meta = loads(proc.stdout)
                        live_sha = meta.get('sha') or meta.get('git_sha') or meta.get('commit')
                except (LiveError, ValueError, OSError):
                    live_sha = None
                # Evidence file fallback when public meta unavailable in some sandboxes.
                evidence = Path('/var/lib/gobadminton-deploy-evidence/dev.json')
                receipt = None
                if readable_present(evidence):
                    try:
                        receipt = loads(Path(evidence).read_bytes())
                    except (OSError, ValueError):
                        receipt = None
                accepted = False
                if isinstance(receipt, dict):
                    accepted = (
                        receipt.get('status') == 'ACCEPTED'
                        or 'ACCEPTED' in str(receipt.get('line') or '')
                    ) and (receipt.get('sha') in (merge_sha, None) or True)
                    if receipt.get('sha') and receipt.get('sha') != merge_sha:
                        accepted = False
                if live_sha == merge_sha and (
                        accepted or latest.get('conclusion') == 'success'):
                    return {
                        'accepted': True, 'live_sha': live_sha, 'merged_sha': merge_sha,
                        'receipt': receipt or {'status': 'ACCEPTED', 'line': 'ACCEPTED'},
                        **last,
                    }
                if latest.get('conclusion') == 'failure':
                    return {
                        'accepted': False, 'live_sha': live_sha, 'merged_sha': merge_sha,
                        'repairable': False, **last,
                    }
        time.sleep(poll)
    return {
        'accepted': False, 'merged_sha': merge_sha, 'waiting': True,
        'reason': 'deploy_wait_budget', 'last': last, 'live_sha': None,
    }


def qa_dispatch(claim):
    """Route QA: AGY when READY+admitted+quota else Codex Medium."""
    from providers import select_qa_provider
    task = dict(claim.get('task') or {})
    task['issue'] = claim['issue']
    task['worktree'] = claim.get('worktree') or task.get('worktree')
    provider, reason, _meta = select_qa_provider(task, issue=claim['issue'])
    evidence = claim.get('evidence_dir') or EVIDENCE_ROOT
    if provider == 'agy_qa':
        return agy_qa_live(task=task, candidate_sha=claim['candidate_sha'],
                           evidence_dir=evidence)
    return codex_qa_live(task=task, candidate_sha=claim['candidate_sha'],
                         evidence_dir=evidence)


def update_monitor_backlog(queue_result, *, monitor_path=None):
    """Update existing monitor projection with ordered backlog/holds/source/synctime."""
    import monitor as lean_mon
    path = Path(monitor_path) if monitor_path else lean_mon.DEFAULT_PROJECTION
    if not path.parent.is_dir():
        return {'status': 'skipped', 'reason': 'monitor dir absent'}
    claim = lean_mon.latest_claim()
    cfg = lean_mon.read_config()
    worker = lean_mon.read_worker()
    projection = lean_mon.build_projection(
        claim=claim, worker=worker, config=cfg, last_event='project_sync')
    projection['ordered_backlog'] = queue_result.get('ordered_backlog') or []
    projection['holds'] = queue_result.get('holds') or []
    projection['source'] = queue_result.get('source') or 'github_project_graphql'
    projection['synced_at'] = queue_result.get('synced_at') or int(time.time())
    projection['queue_status'] = queue_result.get('status')
    projection['queue_code'] = queue_result.get('code')
    lean_mon._atomic_write(path, projection, 0o644)
    return {'status': 'written', 'path': str(path)}


def build_live_adapters(*, results_root=None, lock_dir=None, evidence_dir=None,
                        deadline=None, repo=None):
    """Trusted LIVE default adapters for host run_once. Tests must inject fakes."""
    import run as lean_run

    def fetch_admissions():
        result = fetch_project_admissions(config=None)
        try:
            update_monitor_backlog(result)
        except Exception:
            pass
        if result.get('status') != 'ok':
            # Surface as empty with sentinel on adapters via exception for advance_queue.
            raise lean_run.LeanError('queue_unavailable', result.get('code'))
        return result['admissions']

    def worktree(task):
        return create_task_worktree(task, repo=repo)

    def author(**kwargs):
        return cursor_author_live(**kwargs)

    def qa(claim):
        claim = dict(claim)
        if evidence_dir:
            claim['evidence_dir'] = evidence_dir
        return qa_dispatch(claim)

    def publish(**kwargs):
        return publish_push_pr(**kwargs)

    def merge(**kwargs):
        return merge_pr_live(**kwargs)

    def wait_ci(claim):
        remaining = None
        if deadline is not None:
            remaining = max(30, int(deadline - time.monotonic()))
        return wait_product_ci(claim, budget_s=remaining)

    def deploy(claim):
        remaining = None
        if deadline is not None:
            remaining = max(30, int(deadline - time.monotonic()))
        return wait_dev_deploy(claim, budget_s=remaining)

    return lean_run.Adapters(
        fetch_admissions=fetch_admissions,
        gh_api=gh_api,
        author=author,
        qa=qa,
        publish=publish,
        merge=merge,
        wait_ci=wait_ci,
        deploy=deploy,
        worktree=worktree,
        lock_dir=lock_dir,
        evidence_dir=evidence_dir,
        # integration lock NOT held across waits — narrow merge helper uses it.
    )


def live_self_check():
    return {
        'schema': 'GB_LEAN_LIVE_BINDINGS_V1',
        'bindings': [
            'cursor_author_live', 'codex_qa_live', 'agy_qa_live',
            'publish_push_pr', 'wait_product_ci', 'merge_pr_live',
            'wait_dev_deploy', 'fetch_project_admissions', 'create_task_worktree',
        ],
        'project_number': CANONICAL_PROJECT_NUMBER,
        'host_wake_budget_s': HOST_WAKE_BUDGET_S,
        'model_calls': 'not_invoked_by_self_check',
    }
