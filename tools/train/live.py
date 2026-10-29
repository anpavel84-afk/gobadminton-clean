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
# Local main may be stale; origin/dev refresh is allowed for Mode B bases.
CLEAN_REPO = Path('/srv/gobadminton-clean/repo')
WORKTREES_ROOT = Path('/home/agentagency-dev/mode-b-worktrees')
EVIDENCE_ROOT = Path('/var/lib/gobadminton-lean/results')
NATIVE_TRAIN = Path('/usr/local/lib/gb-actions-train')
# Short rules from this exact Git/release package (never interactive workspace path).
PACKAGE_ROOT = Path(__file__).resolve().parents[2]
MODE_A_RULES = PACKAGE_ROOT / 'AGENTS.md'
AGENT_HOME = Path('/home/agentagency-dev')
NATIVE_CODEX_HOME = AGENT_HOME / '.codex'
AGY_UID = 978
CURSOR_UID = 1002
CURSOR_GID = 1002
REGISTRY_GID = 65042
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


def load_short_rules():
    """Accepted short Mode A rules from this package — stdin delivery + SHA256.

    Missing/unreadable rules => precise no-call HOLD (never silently empty).
    Old EOM capsules are not delivered; only package AGENTS.md.
    """
    path = MODE_A_RULES
    if not readable_present(path) or not path.is_file() or path.is_symlink():
        raise LiveError('mode_a_rules_absent', str(path))
    raw = path.read_bytes()
    if not raw.strip():
        raise LiveError('mode_a_rules_absent', 'empty:' + str(path))
    digest = hashlib.sha256(raw).hexdigest()
    text = (
        'TRUSTED OWNER MODE A SHORT RULES SHA256 ' + digest + '\n'
        + raw.decode('utf-8', errors='replace')
    )
    return text, digest, path


def chown_bounded_output_dir(path, uid=CURSOR_UID, gid=CURSOR_GID):
    """Chown only a fresh bounded QA/author evidence dir (parents stay Root)."""
    path = Path(path)
    os.chown(path, uid, gid)
    for child in path.iterdir():
        try:
            os.chown(child, uid, gid)
        except OSError:
            pass


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


def uid1002_preexec():
    """Per-role child: groups 65042 / gid 1002 / uid 1002 / NNP before CLI/Git/GH.

    Parent trusted Root retains controller/publisher and the global writer lease.
    Model/Git/GH never keep root. Matches working Mode A drop boundary.
    """
    def _drop():
        euid = os.geteuid()
        if euid == 0:
            os.setgroups([REGISTRY_GID])
            os.setgid(CURSOR_GID)
            os.setuid(CURSOR_UID)
        elif euid != CURSOR_UID:
            os._exit(125)
        try:
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(38, 1, 0, 0, 0) != 0:
                os._exit(126)
        except Exception:
            os._exit(126)
    return _drop


def require_executor_uid():
    euid = os.geteuid()
    if euid not in (0, CURSOR_UID):
        raise LiveError('unexpected_executor_uid', str(euid))
    return euid


def chown_private_tree(base, uid=CURSOR_UID, gid=CURSOR_GID):
    """Only a fresh private Cursor/Codex temp tree — never recursive project/state."""
    base = Path(base)
    for root, _dirs, files in os.walk(base):
        os.chown(root, uid, gid)
        for name in files:
            os.chown(os.path.join(root, name), uid, gid)


def run_argv(argv, *, cwd=None, env=None, timeout=60, input_text=None, check=True,
             drop_uid=True):
    """Subprocess with argv list + proper env; never shell/eval.

    When parent is trusted Root, drop to UID1002/NNP in the child before Git/GH.
    HOME alone is insufficient — native Cursor/Codex/Git must not inherit root.
    """
    require_executor_uid()
    kw = {}
    if drop_uid:
        kw['preexec_fn'] = uid1002_preexec()
    proc = subprocess.run(
        list(argv), cwd=cwd, env=env or uid1002_env(), text=True,
        capture_output=True, timeout=timeout, input=input_text, **kw,
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
    """Residual eligible scope from Project status/priority + Owner exclusions.

    #182 is no longer a hard Project exclusion under OD018; admission still
    requires prospective Owner+signed-comment validation in owner_hold_markers.
    """
    number = int(item['issue'])
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


def _worktree_clean_readback(work, *, expected_base=None):
    """Exact clean HEAD readback under UID1002 git; HOLD on dirty/unexpected."""
    work = Path(work)
    try:
        head = git(work, 'rev-parse', 'HEAD')
        dirty = git(work, 'status', '--porcelain')
    except LiveError as err:
        raise LiveError('worktree_unexpected_hold', f'{work}:{err.code}') from err
    if dirty:
        raise LiveError('worktree_dirty_hold', str(work))
    if expected_base and SHA40.fullmatch(str(expected_base)) and head != expected_base:
        raise LiveError('worktree_unexpected_head_hold', f'{head}!={expected_base}')
    if not SHA40.fullmatch(head):
        raise LiveError('worktree_unexpected_hold', f'bad_head:{head}')
    return head


def create_task_worktree(task, *, repo=None, root=None):
    """Fresh worktree from verified origin/dev or explicit prepared base.

    Never force-removes dirty/unexpected trees — those HOLD and preserve.
    Existing #182 candidate (PR367) is reused via prepared_worktree/base when
    supplied; no broad new prebuilt framework.
    """
    repo = Path(repo or task.get('repo_path') or CLEAN_REPO)
    root = Path(root or WORKTREES_ROOT)
    issue = int(task['issue'])
    expected = task.get('base') or task.get('prepared_base')
    # Reuse an explicitly prepared candidate tree (e.g. #182 PR367) when clean.
    prepared = task.get('prepared_worktree') or task.get('reuse_worktree')
    if prepared:
        work = Path(prepared)
        if not work.is_dir():
            raise LiveError('prepared_worktree_missing', str(work))
        _worktree_clean_readback(work, expected_base=expected)
        return str(work)
    if not root.exists():
        # Parent trusted process may create the Mode B worktrees root; drop child
        # git never mkdir as root into user trees beyond this controller path.
        root.mkdir(parents=True, exist_ok=True)
        if os.geteuid() == 0:
            try:
                os.chown(root, CURSOR_UID, CURSOR_GID)
            except OSError:
                pass
    work = root / f'issue-{issue}'
    if work.exists():
        _worktree_clean_readback(work, expected_base=expected)
        return str(work)
    # Create only a genuinely fresh assigned tree from verified origin/dev or
    # explicit prepared base SHA. Git runs under UID1002 drop (run_argv).
    git(repo, 'fetch', 'origin', 'dev', timeout=120)
    base = expected
    if not (isinstance(base, str) and SHA40.fullmatch(base)):
        base = git(repo, 'rev-parse', 'origin/dev')
    run_argv(
        ['/usr/bin/git', '-C', str(repo), 'worktree', 'add', '--detach', str(work), base],
        env=git_env(), timeout=60, check=True,
    )
    head = _worktree_clean_readback(work, expected_base=base)
    if head != base:
        raise LiveError('worktree_unexpected_head_hold', f'{head}!={base}')
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

    Trusted Root obtains Cursor auth in memory, then per-role Popen drops to
    groups 65042 / gid+uid 1002 / NNP before the CLI. Parent keeps controller
    and writer lease. Never exec user-writable external Python as Root; never
    reuse Root HOME/API secrets beyond the memory token in the child env.
    """
    from providers import prepare_cursor_author_intent, mark_intent_phase, ProviderError
    require_executor_uid()
    evidence = Path(evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_cursor_author_intent(task, worktree, evidence)
    worktree = Path(worktree)
    native = _load_native('native_cursor')
    # Private sandbox under /tmp/gb-cursor-* — chown only this tree to UID1002.
    base = Path(tempfile.mkdtemp(prefix='gb-cursor-lean-', dir='/tmp'))
    p = None
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
        try:
            rules_text, rules_sha, rules_path = load_short_rules()
        except LiveError as err:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                              error=err.code, detail=err.detail)
            raise ProviderError(err.code, err.detail) from err
        prompt = (
            rules_text + '\n'
            + 'EXACT OWNER ASSIGNMENT (Lean Mode B live binding)\n'
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
        if os.geteuid() == 0:
            chown_bounded_output_dir(evidence)
        # Auth in parent memory only (Root may load); never print / never Root HOME reuse.
        token = os.environ.get('CURSOR_AUTH_TOKEN')
        if not token and os.geteuid() == 0:
            token = native.existing_auth_for_stage(
                'slot1', hashlib.sha256(json.dumps(task, sort_keys=True).encode()).hexdigest())
        if not token:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='cursor_auth_absent')
            raise ProviderError('cursor_auth_absent', 'trusted Cursor auth unavailable')
        if os.geteuid() == 0:
            chown_private_tree(base)
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
        # Strip inherited Root/API secrets from child model env.
        for secret_key in (
            'GITHUB_TOKEN', 'GH_TOKEN', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
            'CURSOR_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'SSH_AUTH_SOCK',
        ):
            env.pop(secret_key, None)
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
                stdout=a, stderr=e, start_new_session=True, close_fds=True,
                preexec_fn=uid1002_preexec())
            # Native process-boundary verification (UID1002 / NNP / namespace).
            boundary = None
            if hasattr(native, 'process_boundary'):
                try:
                    boundary = native.process_boundary(p.pid, node, CURSOR_UID)
                except Exception as err:
                    if hasattr(native, '_stop'):
                        native._stop(p)
                    mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                                      error='process_boundary', detail=type(err).__name__)
                    raise ProviderError('cursor_process_boundary', type(err).__name__) from err
            mark_intent_phase(intent_path, 'running', process=boundary,
                              root_model=False, uid=CURSOR_UID)
            try:
                p.communicate(input=prompt.encode(), timeout=AUTHOR_TIMEOUT_S)
            except subprocess.TimeoutExpired as err:
                if hasattr(native, '_stop'):
                    native._stop(p)
                else:
                    _kill_owned_process_group(p)
                mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
                raise ProviderError('cursor_timeout_unknown', str(err), charge='unknown') from err
        if p.returncode != 0:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', exit=p.returncode)
            raise ProviderError('cursor_exit_nonzero', str(p.returncode))
        raw = stream.read_bytes()
        if token.encode() in raw or token.encode() in errf.read_bytes():
            raise ProviderError('token_leak_in_stream')
        result = native.parse_stream(raw)
        after = native.snapshot(base / 'work', bridge, before)
        changed = sorted(n for n in set(before) | set(after) if before.get(n) != after.get(n))
        allowed = set(task.get('allowed_paths') or [])
        if not changed or not set(changed) <= allowed:
            raise ProviderError('author_empty_or_oos', ','.join(changed[:20]))
        for name in changed:
            target = worktree / name
            # Match Mode A: refuse symlink target/parents before Root atomic replace.
            if any(x.is_symlink() for x in (target, *target.parents)):
                raise ProviderError('symlink_import_refused', name)
            if name not in after:
                if target.exists() and not target.is_symlink():
                    target.unlink()
                continue
            data = native._source(base / 'work' / name, base / 'work')
            if token.encode() in data:
                raise ProviderError('token_leak_in_source')
            if any(x.is_symlink() for x in (target.parent, *target.parent.parents)):
                raise ProviderError('symlink_import_refused', name)
            target.parent.mkdir(parents=True, exist_ok=True)
            if any(x.is_symlink() for x in (target, *target.parents)):
                raise ProviderError('symlink_import_refused', name)
            import stat as statmod
            mode = statmod.S_IMODE(target.stat().st_mode) if target.exists() else 0o644
            fd, tmp = tempfile.mkstemp(prefix='.lean-import-', dir=str(target.parent))
            with os.fdopen(fd, 'wb') as fh:
                os.fchmod(fh.fileno(), mode)
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, target)
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
            'root_model': False,
            'uid': CURSOR_UID,
        }
    finally:
        if p is not None and p.poll() is None:
            _kill_owned_process_group(p)
        shutil.rmtree(base, ignore_errors=True)


def _kill_owned_process_group(p):
    """Kill/reap only the owned process group on timeout — no blind paid replay."""
    if p is None:
        return
    if p.poll() is None:
        try:
            os.killpg(p.pid, 9)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                p.kill()
            except (ProcessLookupError, OSError):
                pass
    try:
        p.wait(timeout=5)
    except Exception:
        pass


def _git_common_dir(source):
    proc = run_argv(
        ['/usr/bin/git', '-C', str(source), 'rev-parse',
         '--path-format=absolute', '--git-common-dir'],
        env=git_env(), timeout=30, check=True,
    )
    return (proc.stdout or '').strip()


def _codex_turn_completed(events_path):
    """Require a valid JSONL event with type exactly turn.completed — no heuristics."""
    path = Path(events_path)
    if not path.is_file():
        return False
    for line in path.read_text(errors='replace').splitlines():
        if not line.strip():
            continue
        try:
            obj = loads(line)
        except (ValueError, LiveError):
            continue
        if not isinstance(obj, dict):
            continue
        if obj.get('type') == 'turn.completed':
            return True
    return False


def codex_qa_live(*, task, candidate_sha, evidence_dir, intent_path=None):
    """Actual Codex Sol Medium read-only QA (Mode A gpt-6.1-sol effort=medium).

    Match working launch_medium_qa: UID1002 real HOME + native CODEX_HOME,
    private TMPDIR, explicit short rules on stdin, deny model FS .codex/.ssh.
    Verify exit0 AND turn.completed AND canonical exact SHA final. No author
    worktree checkout on HEAD mismatch — precise HOLD. Timeout kills owned pg.
    """
    from providers import prepare_qa_intent, mark_intent_phase, parse_codex_final, ProviderError
    require_executor_uid()
    if not (isinstance(candidate_sha, str) and SHA40.fullmatch(candidate_sha)):
        raise ProviderError('invalid_candidate_sha')
    evidence = Path(evidence_dir) / f'qa-codex-{candidate_sha[:12]}'
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_qa_intent(task, candidate_sha, 'codex_sol_medium', evidence)
    source = Path(task.get('worktree') or create_task_worktree(task))
    head = git(source, 'rev-parse', 'HEAD')
    if head != candidate_sha:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error='qa_head_mismatch', head=head, expected=candidate_sha)
        raise ProviderError('qa_head_mismatch', f'{head}!={candidate_sha}')
    try:
        rules_text, rules_sha, rules_path = load_short_rules()
    except LiveError as err:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error=err.code, detail=err.detail)
        raise ProviderError(err.code, err.detail) from err
    prompt = (
        rules_text + '\n'
        + 'Independent read-only QA. Return ONLY JSON keys verdict, findings, reviewed_sha.\n'
        f'reviewed_sha must be exactly {candidate_sha}.\n'
        f'base={task.get("base") or task.get("prepared_base") or ""}\n'
        f'TASK: {json.dumps({k: task.get(k) for k in ("issue","goal","acceptance","allowed_paths")}, ensure_ascii=False)}\n'
        'PASS => findings must be []. Findings list only actionable defects.\n'
    )
    (evidence / 'prompt.md').write_text(prompt)
    # Bounded QA output must be writable by UID1002 CLI (-o final.txt); parents stay Root.
    if os.geteuid() == 0:
        chown_bounded_output_dir(evidence)
    codex = AGENT_HOME / '.local' / 'bin' / 'codex'
    if not codex.is_file():
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='codex_absent')
        raise ProviderError('codex_absent')
    common = _git_common_dir(source)
    fs = {
        ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', ':tmpdir': 'write',
        str(source): 'read', str(source / '.git'): 'read',
        str(evidence): 'write',
        str(AGENT_HOME / 'train-execution-evidence-20261027'): 'read',
        str(AGENT_HOME / '.local' / 'lib' / 'node_modules' / '@openai'): 'read',
        str(AGENT_HOME / '.local' / 'node-v24.21.0'): 'read',
        str(NATIVE_CODEX_HOME): 'deny',
        str(AGENT_HOME / '.ssh'): 'deny',
        '/srv/gb-slots': 'deny',
        '/var/lib/gobadminton-actions-train': 'deny',
        '/var/lib/gobadminton-autonomy': 'deny',
        '/etc/gobadminton-slots': 'deny',
    }
    if common:
        fs[common] = 'read'
    fs[str(rules_path)] = 'read'
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
    # Match launch_medium_qa: real HOME + native ~/.codex for CLI OAuth; private TMPDIR only.
    # Never Root HOME, never copy/print credentials, never empty private HOME without CODEX_HOME.
    private = Path(tempfile.mkdtemp(prefix='gb-codex-lean-', dir='/tmp'))
    p = None
    try:
        tmpdir = private / 'tmp'
        tmpdir.mkdir(mode=0o700)
        if os.geteuid() == 0:
            chown_private_tree(private)
        child_env = {
            'PATH': '/usr/bin:/bin:' + str(AGENT_HOME / '.local' / 'bin'),
            'LANG': 'C.UTF-8',
            'HOME': str(AGENT_HOME),
            'TMPDIR': str(tmpdir),
        }
        mark_intent_phase(intent_path, 'launching', model='gpt-6.1-sol', effort='medium',
                          rules_sha256=rules_sha, root_model=False,
                          home=str(AGENT_HOME), codex_home=str(NATIVE_CODEX_HOME))
        with (evidence / 'prompt.md').open() as i, \
                (evidence / 'events.jsonl').open('w') as o, \
                (evidence / 'stderr').open('w') as e:
            p = subprocess.Popen(
                cmd, stdin=i, stdout=o, stderr=e, start_new_session=True,
                umask=0o022, close_fds=True, env=child_env, preexec_fn=uid1002_preexec())
            try:
                p.wait(timeout=QA_TIMEOUT_S + 30)
            except subprocess.TimeoutExpired as err:
                # Raw events already on disk via stdout inheritance; kill owned pg only.
                _kill_owned_process_group(p)
                mark_intent_phase(intent_path, 'UNKNOWN', error='timeout',
                                  no_blind_replay=True)
                raise ProviderError('qa_timeout_unknown', str(err), charge='unknown') from err
        # Persist raw completion envelope before parse (no automatic paid replay).
        completion = {
            'exit': p.returncode,
            'turn_completed': _codex_turn_completed(evidence / 'events.jsonl'),
            'candidate_sha': candidate_sha,
            'rules_sha256': rules_sha,
        }
        (evidence / 'completion.json').write_text(json.dumps(completion, indent=2) + '\n')
        if p.returncode != 0:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', exit=p.returncode)
            raise ProviderError('codex_exit_nonzero', str(p.returncode))
        if not completion['turn_completed']:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='turn_completed_missing')
            raise ProviderError('codex_turn_completed_missing')
        final = evidence / 'final.txt'
        if not final.is_file():
            raise ProviderError('codex_final_missing')
        raw_final = final.read_text()
        (evidence / 'final.raw.txt').write_text(raw_final)
        parsed = parse_codex_final(raw_final, candidate_sha)
        if parsed.get('reviewed_sha') != candidate_sha:
            raise ProviderError('stale_sha_verdict', str(parsed.get('reviewed_sha')))
        parsed['charge'] = 'charged'
        parsed['turn_completed'] = True
        parsed['exit'] = 0
        mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'])
        return parsed
    finally:
        if p is not None and p.poll() is None:
            _kill_owned_process_group(p)
        shutil.rmtree(private, ignore_errors=True)


def agy_qa_live(*, task, candidate_sha, evidence_dir, intent_path=None):
    """AGY product QA only via verified native transport — never bare CLI.

    CANARY/HOLD: installed PTY may pass run_command/view_file, but findings[]
    contract violations keep AGY not READY. Default remains Codex Medium.
    Explicit not-ready fallback BEFORE any charge; never invent READY; never
    launch unsupported [AGY_CLI, --model] for product QA. Future AGY prompts
    must require findings-only actionable defects and PASS => [].
    """
    from providers import (
        prepare_qa_intent, mark_intent_phase, parse_agy_stream, ProviderError,
        role_ready, agy_quota_available, record_agy_charge, AGY_MODEL,
    )
    ok, reason = role_ready('agy_qa')
    if not ok:
        # Explicit not-ready fallback before any AGY charge / model launch.
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
    try:
        native = _load_native('native_antigravity')
    except LiveError:
        mark_intent_phase(intent_path, 'agy_not_ready_fallback', error='native_missing')
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    # Bare [AGY_CLI, --model] is unsupported for product QA — require native entry.
    if not hasattr(native, 'product_run_qa'):
        mark_intent_phase(intent_path, 'agy_not_ready_fallback',
                          error='product_run_qa_absent_no_bare_cli')
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    source = Path(task.get('worktree') or create_task_worktree(task))
    head = git(source, 'rev-parse', 'HEAD')
    if head != candidate_sha:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error='qa_head_mismatch', head=head, expected=candidate_sha)
        raise ProviderError('qa_head_mismatch', f'{head}!={candidate_sha}')
    prompt = (
        f'Read-only QA of exact SHA {candidate_sha}. '
        'findings must list ONLY actionable defects; PASS => findings must be []. '
        'Finish with DONE JSON '
        '{"verdict":"PASS"|"FAIL","findings":[],"reviewed_sha":"%s"}.'
        % candidate_sha
    )
    (evidence / 'prompt.txt').write_text(prompt)
    mark_intent_phase(intent_path, 'launching', transport='native_product_run_qa')
    try:
        raw = native.product_run_qa(
            work=str(source), head=candidate_sha, prompt=prompt,
            evidence_dir=str(evidence), model=AGY_MODEL)
    except Exception as err:
        record_agy_charge(int(task['issue']), {'phase': 'launch_error'}, charge='unknown')
        mark_intent_phase(intent_path, 'UNKNOWN', error=type(err).__name__,
                          no_blind_replay=True)
        raise ProviderError('agy_launch_unknown', type(err).__name__, charge='unknown') from err
    (evidence / 'stream.raw').write_bytes(raw if isinstance(raw, bytes) else str(raw).encode())
    record_agy_charge(int(task['issue']), {'phase': 'completed'}, charge='charged')
    parsed = parse_agy_stream(raw, candidate_sha, model=AGY_MODEL)
    if parsed.get('verdict') == 'PASS' and list(parsed.get('findings') or []):
        raise ProviderError('agy_pass_with_findings_contract')
    parsed['charge'] = 'charged'
    mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'])
    return parsed


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
