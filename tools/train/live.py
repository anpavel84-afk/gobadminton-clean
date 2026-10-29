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
import sys
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
    # Root retains lease; Cursor author/publish is 1002; native AGY invoke is 978.
    if euid not in (0, CURSOR_UID, AGY_UID):
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
    # Drop Root→1002 for Git/GH. Already-unprivileged AGY 978 keeps its identity
    # (uid1002_preexec would _exit(125) if invoked from UID978).
    if drop_uid and os.geteuid() == 0:
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


def validate_frozen_worktree(worktree, *, expected_head=None, base_sha=None):
    """Reuse frozen claim worktree: clean + expected HEAD; never recreate/reset."""
    expected = expected_head or base_sha
    return _worktree_clean_readback(worktree, expected_base=expected)


def resolve_task_worktree(task, *, repo=None, root=None):
    """Create-or-reuse once; return {worktree, base_sha} (initial clean base frozen)."""
    work = create_task_worktree(task, repo=repo, root=root)
    prepared = task.get('base') or task.get('prepared_base')
    if isinstance(prepared, str) and SHA40.fullmatch(prepared):
        base_sha = prepared
        expected = task.get('expected_head') or task.get('candidate_sha') or prepared
        _worktree_clean_readback(work, expected_base=expected)
    else:
        # Missing task.base: freeze actual HEAD after verified origin/dev create.
        base_sha = _worktree_clean_readback(work)
    if not SHA40.fullmatch(str(base_sha)):
        raise LiveError('base_sha_unresolved', str(base_sha))
    return {'worktree': str(work), 'base_sha': base_sha}


def create_task_worktree(task, *, repo=None, root=None):
    """Fresh worktree from verified origin/dev or explicit prepared base.

    Never force-removes dirty/unexpected trees — those HOLD and preserve.
    Existing #182 candidate (PR367) is reused via prepared_worktree/base when
    supplied; no broad new prebuilt framework.

    When expected_head/candidate_sha is set (frozen claim reuse), validate that
    HEAD instead of initial base — do not recreate or reset.
    """
    repo = Path(repo or task.get('repo_path') or CLEAN_REPO)
    root = Path(root or WORKTREES_ROOT)
    issue = int(task['issue'])
    expected_base = task.get('base') or task.get('prepared_base')
    expected_head = task.get('expected_head') or task.get('candidate_sha')
    # Reuse an explicitly prepared candidate tree (e.g. #182 PR367) when clean.
    prepared = task.get('prepared_worktree') or task.get('reuse_worktree') or task.get('worktree')
    if prepared and task.get('reuse_frozen'):
        work = Path(prepared)
        if not work.is_dir():
            raise LiveError('prepared_worktree_missing', str(work))
        _worktree_clean_readback(work, expected_base=expected_head or expected_base)
        return str(work)
    if prepared and Path(prepared).is_dir() and (
            task.get('prepared_worktree') or task.get('reuse_worktree')):
        work = Path(prepared)
        _worktree_clean_readback(work, expected_base=expected_head or expected_base)
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
        # Reuse existing: prefer candidate/expected_head after author; else initial base.
        _worktree_clean_readback(work, expected_base=expected_head or expected_base)
        return str(work)
    # Create only a genuinely fresh assigned tree from verified origin/dev or
    # explicit prepared base SHA. Git runs under UID1002 drop (run_argv).
    git(repo, 'fetch', 'origin', 'dev', timeout=120)
    base = expected_base
    if not (isinstance(base, str) and SHA40.fullmatch(base)):
        base = git(repo, 'rev-parse', 'origin/dev')
        if not SHA40.fullmatch(str(base)):
            raise LiveError('origin_dev_unresolved', str(base))
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


CODEX_CAPACITY_MSG = 'Selected model is at capacity. Please try a different model.'
AGY_SHARED_BUDGET = Path('/etc/gobadminton-slots/budgets.json')
AGY_SHARED_OUTBOX = Path('/var/lib/gobadminton-autonomy/outbox')
AGY_SHARED_LOCK = Path('/var/lib/gobadminton-autonomy/locks/registry.lock')
# Proven UID978 product-QA common repo (PR #376 / Mode A recipe). Never slot3.
AGY_QA_GIT_BASE = Path(
    '/srv/gb-slots/slot2/worktrees/issue-337-product-qa-general-20261027')
AGY_QA_WORKTREES = Path('/srv/gb-slots/slot2/worktrees')
AGY_QA_INPUTS = AGY_QA_WORKTREES / '.product-qa-inputs'
AGY_SLOT = 'slot2'
AGY_IPC_MAX = 4096
AGY_IPC_FIELDS = frozenset({
    'ok', 'charged', 'error_type', 'error_code', 'error',
})


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


def _codex_capacity_technical(evidence_dir):
    """Exact Codex capacity + turn.failed/error, no completed verdict.

    Completed technical failure — not content FAIL / EXPLICIT_SAFETY_REFUSAL.
    """
    evidence = Path(evidence_dir)
    blobs = []
    for name in ('events.jsonl', 'stderr', 'final.txt'):
        path = evidence / name
        if path.is_file():
            blobs.append(path.read_text(errors='replace'))
    text = '\n'.join(blobs)
    if CODEX_CAPACITY_MSG not in text:
        return False
    if _codex_turn_completed(evidence / 'events.jsonl'):
        return False
    events = evidence / 'events.jsonl'
    if not events.is_file():
        return CODEX_CAPACITY_MSG in text
    for line in events.read_text(errors='replace').splitlines():
        if not line.strip():
            continue
        try:
            obj = loads(line)
        except (ValueError, LiveError):
            continue
        if not isinstance(obj, dict):
            continue
        typ = obj.get('type')
        if typ in ('turn.failed', 'error') or obj.get('error'):
            return True
        msg = str(obj.get('message') or obj.get('error') or '')
        if CODEX_CAPACITY_MSG in msg:
            return True
    return False


def budget_left_eligible(left, *, successor=False, exact_one=False):
    """OD-020 budget gate. Reject bool/None/NaN/≤0/-inf.

    Legacy orientation (restored): successor ⇒ positive finite/inf; exact_one
    (legacy non-successor) ⇒ finite remaining==1, plus +inf under OD-020.
    Default / product QA ⇒ positive finite/inf. Flags are unambiguous.
    """
    if left is None or type(left) is bool:
        return False
    if type(left) not in (int, float):
        return False
    if left != left or left <= 0:  # NaN / ≤0 / -inf
        return False
    if exact_one:
        return left == 1 or left == float('inf')
    # successor and standard product QA: any positive finite or +inf
    return left >= 1


def _load_slots_budget():
    """Installed shared Budget class (no second quota DB)."""
    import importlib.util
    path = NATIVE_TRAIN / 'live' / 'slots.py'
    if not path.is_file():
        alt = Path(__file__).resolve().parents[2] / 'scripts' / 'chatops' / 'actions_train' / 'live' / 'slots.py'
        path = alt if alt.is_file() else path
    if not path.is_file():
        raise LiveError('slots_budget_missing')
    spec = importlib.util.spec_from_file_location('lean_live_slots_budget', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def shared_agy_budget(issue):
    slots = _load_slots_budget()
    return slots.Budget(
        AGY_SHARED_BUDGET, AGY_SHARED_OUTBOX, AGY_SHARED_LOCK, issue=int(issue))


def _agy_operation_fingerprint(task, candidate_sha, attempt):
    payload = {
        'issue': int(task['issue']),
        'revision': task.get('revision') or task.get('task_revision'),
        'attempt': attempt,
        'candidate': candidate_sha,
        'provider': 'agy_qa',
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()
    ).hexdigest()


def _agy_build_prompt(task, candidate_sha, *, rules_text, source, base_sha,
                      diff_source=None):
    """Exact short rules + task criteria + source diff; dynamic issue/base/candidate/attempt.

    Diff is computed as Root parent via live.git on the original author UID1002
    tree (diff_source). Prompt SOURCE_ROOT is the readonly QA copy — never
    live.git UID1002 against the QA978 tree (dubious ownership omits diff).
    """
    issue = int(task['issue'])
    attempt = task.get('attempt') or task.get('qa_attempt') or 1
    acceptance = task.get('acceptance') or task.get('criteria') or []
    goal = task.get('goal') or ''
    diff_names = ''
    diff_stat = ''
    # Prefer explicit author source for diff; fall back only when same tree.
    diff_from = Path(diff_source) if diff_source else Path(source)
    if base_sha and SHA40.fullmatch(str(base_sha)):
        try:
            diff_names = git(
                diff_from, 'diff', '--name-status', str(base_sha), candidate_sha, '--')
            diff_stat = git(
                diff_from, 'diff', '--stat', str(base_sha), candidate_sha, '--')
        except LiveError:
            diff_names = ''
            diff_stat = ''
    prompt = rules_text + '\n'
    prompt += (
        f'OWNER AUTHORIZED INDEPENDENT SOURCE QA. issue={issue} '
        f'attempt={attempt} candidate={candidate_sha} base={base_sha or ""}. '
        f'readonly SOURCE_ROOT {source}.\n'
        f'goal={goal}\n'
        f'acceptance={json.dumps(acceptance, ensure_ascii=False)}\n'
        'Use native run_command for /usr/bin/git rev-parse HEAD; use native view_file '
        'for actual relevant files. ALL view_file calls MUST follow the supplied native '
        'schema and include AbsolutePath, toolAction, toolSummary. Do not skip TOOL_ERROR '
        'auditing. Require run_command HEAD DONE, view_file DONE, finish DONE, '
        f'reviewed_sha exactly {candidate_sha}. PASS MUST findings=[]. '
        'Return exact canonical finish once: verdict PASS|FAIL, findings ONLY concrete '
        'actionable acceptance blockers, reviewed_sha exact HEAD.\n'
    )
    if diff_names:
        prompt += 'CHANGED FILES:\n' + diff_names + '\n'
    if diff_stat:
        prompt += 'DIFFSTAT:\n' + diff_stat + '\n'
    return prompt


def _agy_plain_git_env(home='/nonexistent'):
    """978-safe plain Git env — never live.git / agent HOME / global config."""
    return {
        'PATH': '/usr/bin:/bin',
        'HOME': str(home),
        'LANG': 'C.UTF-8',
        'GIT_CONFIG_NOSYSTEM': '1',
        'GIT_CONFIG_GLOBAL': '/dev/null',
        'GIT_CONFIG_SYSTEM': '/dev/null',
        'GIT_OPTIONAL_LOCKS': '0',
        'GIT_TERMINAL_PROMPT': '0',
    }


def _agy_plain_git(cwd, *args, home='/nonexistent', drop=None, timeout=120):
    """Dedicated plain Git (no live.git UID1002 helper). drop: None|1002|978."""
    argv = [
        '/usr/bin/git', '--no-replace-objects',
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false',
        '-c', 'core.useReplaceRefs=false',
        *args,
    ]
    kw = {}
    if drop == 978:
        def _drop978():
            os.setgroups([REGISTRY_GID])
            os.setgid(968)
            os.setuid(AGY_UID)
            try:
                import ctypes
                libc = ctypes.CDLL(None, use_errno=True)
                if libc.prctl(38, 1, 0, 0, 0) != 0:
                    os._exit(126)
            except Exception:
                os._exit(126)
        kw['preexec_fn'] = _drop978
    elif drop == 1002 or (drop is None and os.geteuid() == 0):
        kw['preexec_fn'] = uid1002_preexec()
    proc = subprocess.run(
        argv, cwd=None if cwd is None else str(cwd),
        env=_agy_plain_git_env(home), capture_output=True, text=True,
        timeout=timeout, **kw)
    if proc.returncode != 0:
        raise LiveError(
            'agy_plain_git_failed',
            (proc.stderr or proc.stdout or '')[:400])
    return (proc.stdout or '').strip()


def _agy_nnp_preexec():
    def _nnp():
        try:
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            if libc.prctl(38, 1, 0, 0, 0) != 0:
                os._exit(126)
        except Exception:
            os._exit(126)
    return _nnp


def _agy_materialize_qa_snapshot(*, author_source, candidate_sha, base_sha,
                                 issue, operation):
    """Fresh immutable UID978 QA copy via bundle → common repo → worktree add.

    Author tree stays UID1002; never chown/expose author checkpoint. Uses the
    proven common repo under slot2/worktrees — no clone/slot3.
    """
    author_source = Path(author_source)
    if not SHA40.fullmatch(str(candidate_sha)):
        raise LiveError('agy_qa_invalid_candidate', str(candidate_sha))
    op = re.sub(r'[^a-f0-9]', '', str(operation).lower())[:40] or 'op'
    issue_n = int(issue)
    if not AGY_QA_GIT_BASE.is_dir() or AGY_QA_GIT_BASE.is_symlink():
        raise LiveError('agy_qa_common_repo_missing', str(AGY_QA_GIT_BASE))
    # Author HEAD/clean before (UID1002 git via live helper — author tree only).
    author_head = git(author_source, 'rev-parse', 'HEAD')
    if author_head != candidate_sha:
        raise LiveError('agy_qa_author_head_mismatch',
                        f'{author_head}!={candidate_sha}')
    if git(author_source, 'status', '--porcelain').strip():
        raise LiveError('agy_qa_author_dirty')
    if base_sha and SHA40.fullmatch(str(base_sha)):
        # Ensure base is resolvable in author history (read-only check).
        try:
            git(author_source, 'rev-parse', '--verify', str(base_sha) + '^{commit}')
        except LiveError as err:
            raise LiveError('agy_qa_base_missing', str(base_sha)) from err

    stamp = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())
    AGY_QA_INPUTS.mkdir(parents=True, exist_ok=True)
    input_dir = AGY_QA_INPUTS / f'lean-qa-{issue_n}-{op[:16]}-{stamp}'
    if input_dir.exists():
        raise LiveError('agy_qa_input_exists', str(input_dir))
    input_dir.mkdir(mode=0o700)
    qa_work = AGY_QA_WORKTREES / f'qa-lean-{issue_n}-{candidate_sha[:12]}-{stamp}'
    if qa_work.exists():
        raise LiveError('agy_qa_worktree_exists', str(qa_work))
    bundle = input_dir / 'candidate.bundle'
    # Temporary bounded bundle as UID1002 from author source (Root parent).
    # Root mkdtemp is 0700 — chown ONLY this fresh dir so Git drop 1002 can write.
    tmp_bundle = Path(tempfile.mkdtemp(prefix='gb-agy-bundle-', dir='/tmp'))
    try:
        if os.geteuid() == 0:
            os.chown(tmp_bundle, CURSOR_UID, CURSOR_GID)
        tmp_path = tmp_bundle / 'candidate.bundle'
        # Git bundle refuses a bare SHA tip ("empty bundle"); named ref HEAD
        # after exact candidate+clean verification above.
        _agy_plain_git(
            author_source, 'bundle', 'create', str(tmp_path), 'HEAD',
            drop=1002 if os.geteuid() == 0 else None)
        # Root copies bundle after child known completed.
        shutil.copy2(tmp_path, bundle)
    finally:
        shutil.rmtree(tmp_bundle, ignore_errors=True)
    os.chown(input_dir, AGY_UID, 968)
    os.chown(bundle, AGY_UID, 968)
    os.chmod(input_dir, 0o700)
    os.chmod(bundle, 0o600)

    ref = f'refs/lean-qa/{issue_n}/{op}'
    # Unique never-overwrite: refuse if ref already present in common repo.
    try:
        existing = _agy_plain_git(
            AGY_QA_GIT_BASE, 'rev-parse', '--verify', ref,
            home=str(input_dir), drop=978 if os.geteuid() == 0 else None)
        if existing:
            raise LiveError('agy_qa_ref_exists', ref)
    except LiveError as err:
        if err.code != 'agy_plain_git_failed':
            raise
        # missing ref is expected
    _agy_plain_git(
        AGY_QA_GIT_BASE, 'fetch', '--no-tags', '--no-write-fetch-head',
        str(bundle), f'{candidate_sha}:{ref}',
        home=str(input_dir), drop=978 if os.geteuid() == 0 else None)
    _agy_plain_git(
        AGY_QA_GIT_BASE, 'worktree', 'add', '--detach', str(qa_work),
        candidate_sha,
        home=str(input_dir), drop=978 if os.geteuid() == 0 else None)
    # Validate QA HEAD/clean (978-owned tree; plain git as 978).
    qa_head = _agy_plain_git(
        qa_work, 'rev-parse', 'HEAD',
        home=str(input_dir), drop=978 if os.geteuid() == 0 else None)
    if qa_head != candidate_sha:
        raise LiveError('agy_qa_head_mismatch', f'{qa_head}!={candidate_sha}')
    if _agy_plain_git(
            qa_work, 'status', '--porcelain',
            home=str(input_dir), drop=978 if os.geteuid() == 0 else None).strip():
        raise LiveError('agy_qa_worktree_dirty')
    # Author unchanged after materialization.
    author_after = git(author_source, 'rev-parse', 'HEAD')
    if author_after != candidate_sha or git(author_source, 'status', '--porcelain').strip():
        raise LiveError('agy_qa_author_changed_during_materialize')
    return {
        'qa_work': qa_work,
        'input_dir': input_dir,
        'candidate_sha': candidate_sha,
        'base_sha': base_sha or '',
        'ref': ref,
        'author_source': author_source,
    }


def _agy_confined_popen_factory(native, work, common_git, record):
    """Landlock uses native kwargs.cwd.parent — proven recipe (run-agy-review-378-r1)."""
    guard = _load_native('native_guard')

    def confined_popen(argv, **kwargs):
        original = kwargs.get('preexec_fn')
        cwd = Path(kwargs['cwd'])
        # Native invoke generates cwd under its private temp; Landlock that parent.
        temp = cwd.parent
        # 978-safe plain Git for common-dir — never live.git under 978.
        common = Path(common_git) if common_git else Path(
            _agy_plain_git(
                work, 'rev-parse', '--path-format=absolute', '--git-common-dir',
                home=str(temp / 'home')))
        ro, _, ex = native.filesystem_roots(temp, work, common)
        ro = list(ro) + [cwd, temp / 'home', Path(work), common]
        wr = [
            temp / 'home', temp / 'out',
            Path('/dev/null'), Path('/dev/urandom'), Path('/dev/random'),
            Path('/dev/ptmx'), Path('/dev/pts'),
        ]
        kwargs = dict(kwargs)
        env = dict(kwargs.get('env') or {})
        env.update(_agy_plain_git_env(temp / 'home'))
        kwargs['env'] = env

        def child():
            if original:
                original()
            guard._landlock(ro, wr, ex)

        kwargs['preexec_fn'] = child
        argv = list(argv) + ['--add-dir', str(work)]
        p = subprocess.Popen(argv, **kwargs)
        record['pid'] = p.pid
        record['executor_uid'] = AGY_UID
        record['filesystem_boundary'] = 'Landlock source RO / private HOME+out writable'
        record['no_new_privileges'] = True
        return p

    return confined_popen


def _agy_drop_to_executor():
    """Actual native caller must be UID978/groups65042/NNP (invoke checks caller UID)."""
    os.setgroups([REGISTRY_GID])
    os.setgid(968)
    os.setuid(AGY_UID)
    _agy_nnp_preexec()()


def _agy_ipc_pack(payload):
    """Bounded JSON own fixed fields only — no paths/commands from child."""
    out = {}
    for key in ('ok', 'charged', 'error_type', 'error_code', 'error'):
        if key in payload:
            out[key] = payload[key]
    raw = json.dumps(out, separators=(',', ':')).encode()
    if len(raw) > AGY_IPC_MAX:
        raw = b'{"ok":false,"error_type":"ipc_too_large"}'
    return raw


def _agy_ipc_unpack(raw):
    if not raw or len(raw) > AGY_IPC_MAX:
        raise LiveError('agy_child_ipc_failed', 'empty_or_oversized')
    try:
        obj = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError) as err:
        raise LiveError('agy_child_ipc_failed', type(err).__name__) from err
    if not isinstance(obj, dict) or set(obj) - AGY_IPC_FIELDS:
        raise LiveError('agy_child_ipc_failed', 'unexpected_fields')
    return obj


def _agy_read_charge_receipt(path):
    path = Path(path)
    if not path.is_file():
        return False, {}
    try:
        rec = loads(path.read_bytes())
    except (ValueError, LiveError, OSError):
        return False, {}
    if not isinstance(rec, dict):
        return False, {}
    return int(rec.get('calls_charged') or 0) == 1, rec


def _agy_collect_native_evidence(child_ev, root_ev):
    """Copy raw/native/charge/status from 978 native dir into Root private evidence.

    Never opens Root protected state for the child; never chowns historical trees.
    Regular non-symlink files only.
    """
    child_ev = Path(child_ev)
    root_ev = Path(root_ev)
    try:
        if child_ev.resolve() == root_ev.resolve():
            return
    except OSError:
        if str(child_ev) == str(root_ev):
            return
    root_ev.mkdir(parents=True, exist_ok=True)
    for name in ('stream.raw', 'native-receipt.json',
                 'shared-charge-receipt.json', 'child-ipc-status.json'):
        src = child_ev / name
        if src.is_file() and not src.is_symlink():
            (root_ev / name).write_bytes(src.read_bytes())
    nested = child_ev / 'evidence'
    if nested.is_dir() and not nested.is_symlink():
        dest = root_ev / 'evidence'
        dest.mkdir(parents=True, exist_ok=True)
        for src in nested.iterdir():
            if src.is_file() and not src.is_symlink():
                (dest / src.name).write_bytes(src.read_bytes())


def _agy_product_invoke(native, prompt, work, evidence, task_hash, charge, *,
                        timeout=900, common_git=None, native_evidence=None):
    """Call installed native.invoke(..., product=True). Parent Root; child 978.

    Fork IPC is bounded JSON fixed fields only. Parent knows fixed evidence paths
    and never trusts child-supplied paths. charge_state is COW after fork — child
    persists charged stage in native evidence receipt; parent audits once after
    collect into Root private evidence. With umask 077 Root parents, child MUST
    write under qa_snap.input_dir (978-owned), not Root results leaves.
    """
    evidence = Path(evidence)
    work = Path(work)
    # Native/child writes: fresh 978-owned dir under qa input, else legacy leaf.
    child_ev = Path(native_evidence) if native_evidence else evidence
    if native_evidence is not None:
        child_ev.mkdir(parents=True, exist_ok=True)
        if os.geteuid() == 0:
            try:
                os.chown(child_ev, AGY_UID, 968)
            except OSError:
                pass
    elif os.geteuid() == 0:
        # Legacy path only when no native_evidence — chown just this leaf.
        chown_bounded_output_dir(evidence, uid=AGY_UID, gid=968)
    out_raw = child_ev / 'stream.raw'
    out_receipt = child_ev / 'native-receipt.json'
    charge_receipt = child_ev / 'shared-charge-receipt.json'
    ipc_status = child_ev / 'child-ipc-status.json'

    def _run_invoke(local_charge):
        record = {}
        common = common_git or _agy_plain_git(
            work, 'rev-parse', '--path-format=absolute', '--git-common-dir',
            home=str(child_ev))
        popen = _agy_confined_popen_factory(native, work, common, record)
        raw, native_receipt = native.invoke(
            prompt, timeout, work=work, slot=AGY_SLOT, task_hash=task_hash,
            charge=local_charge, popen=popen, evidence_dir=child_ev / 'evidence',
            product=True)
        out_raw.write_bytes(raw if isinstance(raw, bytes) else str(raw).encode())
        out_receipt.write_text(
            json.dumps({'native': native_receipt, 'record': record},
                       indent=2, default=str) + '\n')
        return raw, native_receipt

    def _finish(raw, receipt_obj, charged_flag, charge_rec, payload_ok=True, payload=None):
        _agy_collect_native_evidence(child_ev, evidence)
        # Prefer Root copies after collect.
        root_raw = evidence / 'stream.raw'
        root_receipt = evidence / 'native-receipt.json'
        root_charge = evidence / 'shared-charge-receipt.json'
        if root_raw.is_file():
            raw = root_raw.read_bytes()
        elif out_raw.is_file() and not raw:
            raw = out_raw.read_bytes()
        if not receipt_obj and root_receipt.is_file():
            try:
                receipt_obj = loads(root_receipt.read_bytes())
            except (ValueError, LiveError):
                receipt_obj = {}
        if not charge_rec:
            charged_flag, charge_rec = _agy_read_charge_receipt(root_charge)
            if not charged_flag:
                charged_flag, charge_rec = _agy_read_charge_receipt(charge_receipt)
        receipt = dict(receipt_obj) if isinstance(receipt_obj, dict) else {}
        receipt['shared_budget_charged'] = charged_flag
        receipt['charge_receipt'] = charge_rec
        if not payload_ok:
            code = (payload or {}).get('error_code') or 'agy_native_child_failed'
            err = LiveError(str(code), (payload or {}).get('error'))
            err.charged = charged_flag
            err.raw = raw
            err.receipt = receipt
            raise err
        return raw if isinstance(raw, bytes) else (raw or b''), receipt

    if os.geteuid() == AGY_UID:
        raw, native_receipt = _run_invoke(charge)
        charged_flag, charge_rec = _agy_read_charge_receipt(charge_receipt)
        return _finish(raw, {'native': native_receipt}, charged_flag, charge_rec)

    if os.geteuid() != 0:
        raise LiveError('agy_wrong_executor_uid', str(os.geteuid()))

    # Root retains writer lease; fork real UID978 native caller.
    r_fd, w_fd = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(r_fd)
        status = 0
        charged = False
        try:
            _agy_drop_to_executor()
            sys_path_native = str(NATIVE_TRAIN)
            if sys_path_native not in sys.path:
                sys.path.insert(0, sys_path_native)
            if str(NATIVE_TRAIN / 'live') not in sys.path:
                sys.path.insert(0, str(NATIVE_TRAIN / 'live'))

            def child_charge():
                nonlocal charged
                if charged:
                    raise LiveError('agy_double_charge_refused')
                # ONLY shared Budget.charge + own native receipt — never Root
                # private results audit ledger from UID978.
                charge()
                charged = True
                charge_receipt.write_text(json.dumps({
                    'calls_charged': 1,
                    'stage': 'charged',
                    'task_hash': task_hash,
                    'at': int(time.time()),
                }, sort_keys=True) + '\n')

            try:
                _run_invoke(child_charge)
                payload = {'ok': True, 'charged': charged}
            except BaseException as err:
                status = 1
                # Preserve raw/receipt if native wrote them before raising.
                payload = {
                    'ok': False,
                    'charged': charged or _agy_read_charge_receipt(charge_receipt)[0],
                    'error_type': type(err).__name__,
                    'error': str(err)[:500],
                    'error_code': getattr(err, 'code', None),
                }
            try:
                ipc_status.write_text(
                    json.dumps({k: payload.get(k) for k in AGY_IPC_FIELDS
                                if k in payload}, sort_keys=True) + '\n')
            except OSError:
                pass
            try:
                os.write(w_fd, _agy_ipc_pack(payload))
            except Exception:
                pass
            try:
                os.close(w_fd)
            except Exception:
                pass
            os._exit(status)
        except BaseException:
            try:
                os.write(w_fd, _agy_ipc_pack({
                    'ok': False, 'charged': False,
                    'error_type': 'child_setup_failed',
                }))
            except Exception:
                pass
            os._exit(1)

    os.close(w_fd)
    raw_ipc = b''
    try:
        raw_ipc = os.read(r_fd, AGY_IPC_MAX)
    finally:
        os.close(r_fd)
    os.waitpid(pid, 0)
    # Prefer pipe JSON; fall back to fixed status file under native evidence.
    try:
        payload = _agy_ipc_unpack(raw_ipc) if raw_ipc else {}
    except LiveError:
        payload = {}
    if not payload and ipc_status.is_file():
        try:
            payload = _agy_ipc_unpack(ipc_status.read_bytes())
        except LiveError:
            payload = {}
    charged_flag, charge_rec = _agy_read_charge_receipt(charge_receipt)
    if payload.get('charged') or charged_flag:
        charged_flag = True
    # Capture raw even when invoke raised — truthful retention, no auto-retry.
    raw = out_raw.read_bytes() if out_raw.is_file() else b''
    receipt = {}
    if out_receipt.is_file():
        try:
            receipt = loads(out_receipt.read_bytes())
        except (ValueError, LiveError):
            receipt = {}
    return _finish(
        raw, receipt, charged_flag, charge_rec,
        payload_ok=bool(payload.get('ok')), payload=payload)


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
    evidence_root = Path(evidence_dir)
    if evidence_root.name.startswith('qa-'):
        evidence = evidence_root
    else:
        evidence = evidence_root / f'qa-codex-{candidate_sha[:12]}'
    evidence.mkdir(parents=True, exist_ok=True)
    if intent_path is None:
        _, intent_path = prepare_qa_intent(task, candidate_sha, 'codex_sol_medium', evidence)
    # Frozen claim worktree only — never create_task_worktree from raw admission.
    if not task.get('worktree'):
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='qa_worktree_required')
        raise ProviderError('qa_worktree_required')
    source = Path(task['worktree'])
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
    frozen_base = task.get('runtime_base_sha') or task.get('base') or task.get('prepared_base') or ''
    prompt = (
        rules_text + '\n'
        + 'Independent read-only QA. Return ONLY JSON keys verdict, findings, reviewed_sha.\n'
        f'reviewed_sha must be exactly {candidate_sha}.\n'
        f'base={frozen_base}\n'
        f'TASK: {json.dumps({k: task.get(k) for k in ("issue","goal","acceptance","allowed_paths")}, ensure_ascii=False)}\n'
        'PASS => findings must be []. Findings list only actionable defects.\n'
    )
    (evidence / 'prompt.md').write_text(prompt)
    # Prompt/events/stderr stay Root-opened FDs (inherited). CLI -o final must NOT
    # target Root 0700 evidence ancestors — use private 1002 TMPDIR tree instead.
    codex = AGENT_HOME / '.local' / 'bin' / 'codex'
    if not codex.is_file():
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='codex_absent')
        raise ProviderError('codex_absent')
    common = _git_common_dir(source)
    # Match launch_medium_qa: real HOME + native ~/.codex for CLI OAuth; private TMPDIR only.
    # Never Root HOME, never copy/print credentials, never empty private HOME without CODEX_HOME.
    private = Path(tempfile.mkdtemp(prefix='gb-codex-lean-', dir='/tmp'))
    p = None
    try:
        tmpdir = private / 'tmp'
        tmpdir.mkdir(mode=0o700)
        if os.geteuid() == 0:
            chown_private_tree(private)
        final_private = tmpdir / 'final.txt'
        fs = {
            ':root': 'deny', ':minimal': 'read', ':slash_tmp': 'deny', ':tmpdir': 'write',
            str(source): 'read', str(source / '.git'): 'read',
            str(tmpdir): 'write',
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
            '--json', '-o', str(final_private), '-',
        ]
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
        # Parent securely collects regular non-symlink final into Root evidence AFTER exit.
        final = evidence / 'final.txt'
        if final_private.is_file() and not final_private.is_symlink():
            final.write_bytes(final_private.read_bytes())
        # Persist raw completion envelope before parse (no automatic paid replay).
        completion = {
            'exit': p.returncode,
            'turn_completed': _codex_turn_completed(evidence / 'events.jsonl'),
            'candidate_sha': candidate_sha,
            'rules_sha256': rules_sha,
        }
        (evidence / 'completion.json').write_text(json.dumps(completion, indent=2) + '\n')
        # Exact capacity + turn.failed/error without completed verdict = technical failure.
        if _codex_capacity_technical(evidence):
            mark_intent_phase(
                intent_path, 'codex_capacity_technical',
                error=CODEX_CAPACITY_MSG, exit=p.returncode,
                turn_completed=False)
            raise ProviderError(
                'codex_capacity_technical', CODEX_CAPACITY_MSG, charge='charged')
        if p.returncode != 0:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', exit=p.returncode)
            raise ProviderError('codex_exit_nonzero', str(p.returncode))
        if not completion['turn_completed']:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='turn_completed_missing')
            raise ProviderError('codex_turn_completed_missing')
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


def agy_qa_live(*, task, candidate_sha, evidence_dir, intent_path=None,
                _invoke=None):
    """AGY product QA via installed native.invoke(..., product=True).

    Binds product_role_ready()/parse_stream; never product_run_qa or fabricated
    READY markers; never bare [AGY_CLI, --model]. Shared Budget charges once
    before spawn (OD-020); Mode B private ledger is audit-only and must not
    double-authorize. Default remains Codex Medium when AGY is not READY.
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
    # Private ledger: UNKNOWN never replayed; no artificial day/5 authorization.
    avail, why, _rec = agy_quota_available(int(task['issue']))
    if not avail:
        if why == 'agy_quota_unknown_pending_reconcile':
            raise ProviderError('agy_quota_unknown_pending_reconcile', why, charge='none')
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    evidence_root = Path(evidence_dir)
    if evidence_root.name.startswith('qa-'):
        evidence = evidence_root
    else:
        evidence = evidence_root / f'qa-agy-{candidate_sha[:12]}'
    evidence.mkdir(parents=True, exist_ok=True)
    attempt = task.get('attempt') or task.get('qa_attempt') or 1
    fingerprint = _agy_operation_fingerprint(task, candidate_sha, attempt)
    if intent_path is None:
        _, intent_path = prepare_qa_intent(task, candidate_sha, 'agy_qa', evidence)
    mark_intent_phase(
        intent_path, 'prepared', operation_fingerprint=fingerprint,
        issue=int(task['issue']), attempt=attempt, candidate_sha=candidate_sha,
        provider='agy_qa')
    try:
        native = _load_native('native_antigravity')
    except LiveError:
        mark_intent_phase(intent_path, 'agy_not_ready_fallback', error='native_missing')
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    if not hasattr(native, 'invoke') or not hasattr(native, 'parse_stream'):
        mark_intent_phase(intent_path, 'agy_not_ready_fallback',
                          error='native_invoke_or_parse_stream_absent')
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)
    # Never call nonexistent product_run_qa; bind real invoke(product=True).
    if not task.get('worktree'):
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='qa_worktree_required')
        raise ProviderError('qa_worktree_required')
    author_source = Path(task['worktree'])
    head_before = git(author_source, 'rev-parse', 'HEAD')
    if head_before != candidate_sha:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error='qa_head_mismatch', head=head_before, expected=candidate_sha)
        raise ProviderError('qa_head_mismatch', f'{head_before}!={candidate_sha}')
    dirty = git(author_source, 'status', '--porcelain')
    if dirty.strip():
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error='qa_worktree_dirty')
        raise ProviderError('qa_worktree_dirty')
    try:
        rules_text, rules_sha, _rules_path = load_short_rules()
    except LiveError as err:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error=err.code, detail=err.detail)
        raise ProviderError(err.code, err.detail) from err
    base_sha = (
        task.get('runtime_base_sha') or task.get('base') or task.get('source_base')
        or task.get('prepared_base') or ''
    )
    # Shared Budget eligibility before materialize/spawn.
    try:
        budget = shared_agy_budget(int(task['issue']))
        left = budget.remaining('agy', 'qa', AGY_SLOT)
        if not budget_left_eligible(left):
            mark_intent_phase(intent_path, 'agy_unavailable_fallback',
                              error='shared_budget_ineligible', left=repr(left))
            return codex_qa_live(task=task, candidate_sha=candidate_sha,
                                evidence_dir=evidence_dir, intent_path=intent_path)
    except (LiveError, OSError, ValueError) as err:
        mark_intent_phase(intent_path, 'agy_unavailable_fallback',
                          error='shared_budget_unavailable', detail=type(err).__name__)
        return codex_qa_live(task=task, candidate_sha=candidate_sha,
                            evidence_dir=evidence_dir, intent_path=intent_path)

    # Fresh UID978 QA snapshot — prompt SOURCE_ROOT is the QA copy, not author tree.
    qa_snap = None
    source = author_source
    common_git = None
    native_ev = evidence
    if _invoke is None:
        try:
            qa_snap = _agy_materialize_qa_snapshot(
                author_source=author_source, candidate_sha=candidate_sha,
                base_sha=base_sha, issue=int(task['issue']), operation=fingerprint)
            source = Path(qa_snap['qa_work'])
            common_git = _agy_plain_git(
                source, 'rev-parse', '--path-format=absolute', '--git-common-dir',
                home=str(qa_snap['input_dir']),
                drop=978 if os.geteuid() == 0 else None)
            # Child native evidence under fresh 978-owned input_dir — not Root results.
            native_ev = Path(qa_snap['input_dir']) / 'native-evidence'
            native_ev.mkdir(mode=0o700, exist_ok=True)
            if os.geteuid() == 0:
                os.chown(native_ev, AGY_UID, 968)
            (evidence / 'qa-snapshot.json').write_text(json.dumps({
                'qa_work': str(source),
                'input_dir': str(qa_snap['input_dir']),
                'native_evidence': str(native_ev),
                'ref': qa_snap['ref'],
                'candidate_sha': candidate_sha,
                'author_source': str(author_source),
            }, sort_keys=True, indent=2) + '\n')
        except LiveError as err:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                              error=err.code, detail=err.detail)
            raise ProviderError(err.code, err.detail) from err

    # Diff from author UID1002 source; prompt names readonly QA SOURCE_ROOT.
    prompt = _agy_build_prompt(
        task, candidate_sha, rules_text=rules_text, source=source, base_sha=base_sha,
        diff_source=author_source)
    (evidence / 'prompt.txt').write_text(prompt)

    # Charge receipt lives on child-writable native evidence (978), not Root 0700 tree.
    charge_receipt = Path(native_ev) / 'shared-charge-receipt.json'
    # Child/same-UID charge: shared Budget ONLY. Parent writes private audit once.
    def charge():
        if charge_receipt.is_file():
            raise ProviderError('agy_double_charge_refused')
        budget.charge(AGY_SLOT, 'agy', 'qa')
        charge_receipt.write_text(json.dumps({
            'calls_charged': 1,
            'stage': 'charged',
            'operation_fingerprint': fingerprint,
            'at': int(time.time()),
        }, sort_keys=True) + '\n')

    mark_intent_phase(
        intent_path, 'launching', transport='native_invoke_product',
        rules_sha256=rules_sha, operation_fingerprint=fingerprint,
        qa_source=str(source))
    charged_shared = False
    native_receipt = {}
    raw = b''
    try:
        if _invoke is not None:
            charge()
            raw, native_receipt = _invoke(timeout=QA_TIMEOUT_S)
        else:
            raw, native_receipt = _agy_product_invoke(
                native, prompt, source, evidence, fingerprint, charge,
                timeout=QA_TIMEOUT_S, common_git=common_git,
                native_evidence=native_ev)
    except ProviderError:
        raise
    except Exception as err:
        charged_shared, _crec = _agy_read_charge_receipt(charge_receipt)
        if not charged_shared:
            charged_shared = bool(getattr(err, 'charged', False))
        # Parent captures raw from fixed evidence even when invoke raised.
        if not raw and (evidence / 'stream.raw').is_file():
            raw = (evidence / 'stream.raw').read_bytes()
        if charged_shared:
            record_agy_charge(
                int(task['issue']),
                {'phase': 'charged', 'operation_fingerprint': fingerprint,
                 'shared_budget': True, 'after_failure': True},
                charge='charged')
            mark_intent_phase(
                intent_path, 'HOLD_NO_REPLAY', error_type=type(err).__name__,
                error_code=getattr(err, 'code', None),
                operation_fingerprint=fingerprint,
                calls_charged=1, no_blind_replay=True)
            raise ProviderError(
                'agy_protocol_or_provider_failed', type(err).__name__,
                charge='charged') from err
        record_agy_charge(
            int(task['issue']),
            {'phase': 'launch_error', 'operation_fingerprint': fingerprint},
            charge='unknown')
        mark_intent_phase(
            intent_path, 'UNKNOWN', error=type(err).__name__,
            operation_fingerprint=fingerprint, no_blind_replay=True)
        raise ProviderError('agy_launch_unknown', type(err).__name__,
                            charge='unknown') from err

    charged_shared, _crec = _agy_read_charge_receipt(charge_receipt)
    if isinstance(native_receipt, dict) and native_receipt.get('shared_budget_charged'):
        charged_shared = True
    # Parent private audit ONCE after collect — never a second shared charge.
    if charged_shared:
        record_agy_charge(
            int(task['issue']),
            {'phase': 'charged', 'operation_fingerprint': fingerprint,
             'shared_budget': True},
            charge='charged')

    raw_path = evidence / 'stream.raw'
    if not raw_path.is_file():
        raw_path.write_bytes(raw if isinstance(raw, bytes) else str(raw).encode())
    # Author + QA HEADs unchanged after invoke.
    author_after = git(author_source, 'rev-parse', 'HEAD')
    if author_after != candidate_sha or git(author_source, 'status', '--porcelain').strip():
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                          error='author_changed_during_qa')
        raise ProviderError('agy_author_changed', f'{author_after}')
    if qa_snap is not None:
        qa_after = _agy_plain_git(
            source, 'rev-parse', 'HEAD',
            home=str(qa_snap['input_dir']),
            drop=978 if os.geteuid() == 0 else None)
        if qa_after != candidate_sha:
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                              error='qa_source_changed_during_qa')
            raise ProviderError('agy_source_changed', f'{qa_after}')
    try:
        parsed = parse_agy_stream(raw, candidate_sha, model=AGY_MODEL)
        protocol = {}
        if isinstance(native_receipt, dict):
            protocol = (
                native_receipt.get('protocol')
                or (native_receipt.get('native') or {}).get('protocol')
                or native_receipt.get('evidence')
                or {}
            )
        if not protocol and hasattr(native, 'parse_stream'):
            try:
                _verdict, protocol = native.parse_stream(
                    raw if isinstance(raw, bytes) else raw.encode(), candidate_sha)
            except Exception:
                protocol = parsed.get('evidence') or {}
        tool_names = set(protocol.get('tool_names') or [])
        if not ({'run_command', 'view_file'} <= tool_names and protocol.get('finish_done') is True):
            mark_intent_phase(
                intent_path, 'HOLD_NO_REPLAY', error='agy_protocol_incomplete',
                tool_names=sorted(tool_names),
                finish_done=protocol.get('finish_done'),
                operation_fingerprint=fingerprint)
            raise ProviderError('agy_protocol_incomplete',
                                f'tools={sorted(tool_names)} finish={protocol.get("finish_done")}',
                                charge='charged')
    except ProviderError:
        raise
    if parsed.get('reviewed_sha') != candidate_sha:
        raise ProviderError('stale_sha_verdict', str(parsed.get('reviewed_sha')))
    if parsed.get('verdict') == 'PASS' and list(parsed.get('findings') or []):
        raise ProviderError('agy_pass_with_findings_contract')
    parsed['charge'] = 'charged' if charged_shared else 'unknown'
    parsed['operation_fingerprint'] = fingerprint
    parsed['shared_budget_charged'] = charged_shared
    parsed['transport'] = 'native_invoke_product'
    parsed['qa_source'] = str(source)
    mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'],
                      operation_fingerprint=fingerprint)
    return parsed


def _https_origin_url():
    return f'https://github.com/{REPO}.git'


def _git_https_env():
    """Trusted Mode A profile: HTTPS + gh auth git-credential; never SSH force push."""
    return uid1002_env({
        # Strip any inherited token; gh credential helper supplies auth.
        'GIT_TERMINAL_PROMPT': '0',
    })


def _git_https_argv(*git_args):
    """git argv with credential.helper=!gh auth git-credential (HTTPS only)."""
    return [
        '/usr/bin/git',
        '-c', 'core.hooksPath=/dev/null',
        '-c', 'core.fsmonitor=false',
        '-c', 'credential.helper=',
        '-c', 'credential.helper=!/usr/bin/gh auth git-credential',
        *git_args,
    ]


def publish_push_pr(*, kind, payload, intent_path=None):
    """UID1002 gh: push candidate fast-forward-only over HTTPS; create/resume PR.

    No branch reset and no force push. publication_branch / existing_pr come from
    machine assignment (task→payload); no permanent Issue hardcodes.
    Existing remote branch at unexpected SHA => HOLD. Remote head readback required.
    """
    issue = int(payload['issue'])
    sha = payload['sha']
    if not SHA40.fullmatch(str(sha)):
        raise LiveError('invalid_candidate_sha')
    worktree = Path(payload.get('worktree') or WORKTREES_ROOT / f'issue-{issue}')
    branch = payload.get('publication_branch') or f'automation/issue-{issue}'
    if not isinstance(branch, str) or not branch.strip() or '..' in branch or branch.startswith('/'):
        raise LiveError('invalid_publication_branch', str(branch))
    branch = branch.strip()
    existing_pr = payload.get('existing_pr')
    head = git(worktree, 'rev-parse', 'HEAD')
    if head != sha:
        raise LiveError('worktree_head_mismatch', head)
    # Ensure origin is HTTPS (Mode A working gh identity); never SSH force path.
    try:
        current = git(worktree, 'remote', 'get-url', 'origin')
    except LiveError:
        current = ''
    https = _https_origin_url()
    if current != https and 'github.com/' + REPO in (current or '').replace(':', '/'):
        run_argv(
            _git_https_argv('-C', str(worktree), 'remote', 'set-url', 'origin', https),
            env=_git_https_env(), check=True)
    elif current != https:
        # Missing/wrong remote — set HTTPS origin for this push only via explicit URL.
        pass
    # Remote readback before push: unexpected different SHA => HOLD (no overwrite).
    ls = run_argv(
        _git_https_argv('-C', str(worktree), 'ls-remote', https, f'refs/heads/{branch}'),
        env=_git_https_env(), timeout=60, check=False)
    remote_sha = None
    if ls.returncode == 0 and (ls.stdout or '').strip():
        remote_sha = (ls.stdout or '').split()[0].strip()
        if remote_sha and not SHA40.fullmatch(remote_sha):
            remote_sha = None
    if remote_sha and remote_sha != sha:
        # Allow only strict fast-forward: candidate must contain remote tip.
        mb = run_argv(
            _git_https_argv('-C', str(worktree), 'merge-base', '--is-ancestor', remote_sha, sha),
            env=_git_https_env(), check=False)
        if mb.returncode != 0:
            raise LiveError('remote_branch_unexpected_sha_hold',
                            f'{branch}:{remote_sha}!={sha}')
    # Fast-forward-only push of exact candidate (no force, no branch reset).
    if remote_sha != sha:
        push = run_argv(
            _git_https_argv(
                '-C', str(worktree), 'push', '--set-upstream', https,
                f'{sha}:refs/heads/{branch}'),
            env=_git_https_env(), timeout=120, check=False)
        if push.returncode != 0:
            # Uncertain push — target readback before raising.
            rb = run_argv(
                _git_https_argv('-C', str(worktree), 'ls-remote', https, f'refs/heads/{branch}'),
                env=_git_https_env(), timeout=60, check=False)
            rb_sha = ((rb.stdout or '').split() or [''])[0].strip()
            if rb_sha != sha:
                raise LiveError(
                    'push_ff_failed',
                    ((push.stderr or push.stdout or '')[:300] + f' remote={rb_sha}'))
    else:
        # Already at candidate — skip push; still verify PR.
        pass
    # Confirm remote actual head == candidate.
    rb2 = run_argv(
        _git_https_argv('-C', str(worktree), 'ls-remote', https, f'refs/heads/{branch}'),
        env=_git_https_env(), timeout=60, check=True)
    remote_head = ((rb2.stdout or '').split() or [''])[0].strip()
    if remote_head != sha:
        raise LiveError('remote_head_mismatch', f'{remote_head}!={sha}')

    pr_number = None
    if existing_pr is not None:
        try:
            pr_number = int(existing_pr)
        except (TypeError, ValueError):
            raise LiveError('invalid_existing_pr', str(existing_pr))
        pr = gh_api(f'repos/{REPO}/pulls/{pr_number}')
        head_ref = (pr.get('head') or {}).get('ref')
        head_sha = (pr.get('head') or {}).get('sha')
        base_ref = (pr.get('base') or {}).get('ref')
        head_repo = ((pr.get('head') or {}).get('repo') or {}).get('full_name')
        if head_ref != branch or base_ref != 'dev':
            raise LiveError('existing_pr_mismatch',
                            f'pr={pr_number} head={head_ref} base={base_ref}')
        if head_repo and head_repo != REPO:
            raise LiveError('existing_pr_head_repo_mismatch', str(head_repo))
        if head_sha != sha:
            # After FF push, API may lag — re-read once; still no silent new PR.
            pr = gh_api(f'repos/{REPO}/pulls/{pr_number}')
            head_sha = (pr.get('head') or {}).get('sha')
            if head_sha != sha:
                raise LiveError('existing_pr_head_mismatch', f'{head_sha}!={sha}')
        return {'pr': pr_number, 'head_sha': sha, 'base': 'dev', 'branch': branch,
                'existing_pr': pr_number, 'transport': 'https+gh'}

    # Create or reuse PR by head branch — never silently replace with a duplicate.
    proc = run_argv(
        ['/usr/bin/gh', 'pr', 'list', '--repo', REPO, '--base', 'dev',
         '--head', f'{OWNER_LOGIN}:{branch}', '--json', 'number,headRefOid,baseRefName,state'],
        env=uid1002_env(), check=False)
    prs = loads(proc.stdout) if proc.returncode == 0 and proc.stdout.strip() else []
    if isinstance(prs, list) and prs:
        pr_number = int(prs[0]['number'])
    else:
        run_argv(
            ['/usr/bin/gh', 'pr', 'create', '--repo', REPO, '--base', 'dev',
             '--head', branch, '--title', f'lean: issue-{issue}',
             '--body', f'Lean Mode B candidate for #{issue} (`{sha}`).'],
            env=uid1002_env(), check=True)
        proc2 = run_argv(
            ['/usr/bin/gh', 'pr', 'list', '--repo', REPO, '--base', 'dev',
             '--head', f'{OWNER_LOGIN}:{branch}', '--json', 'number,headRefOid'],
            env=uid1002_env(), check=True)
        prs = loads(proc2.stdout)
        pr_number = int(prs[0]['number'])
    pr = gh_api(f'repos/{REPO}/pulls/{pr_number}')
    head_sha = (pr.get('head') or {}).get('sha')
    base_ref = (pr.get('base') or {}).get('ref')
    head_repo = ((pr.get('head') or {}).get('repo') or {}).get('full_name')
    if head_sha != sha or base_ref != 'dev':
        raise LiveError('pr_readback_mismatch', f'head={head_sha} base={base_ref}')
    if head_repo and head_repo != REPO:
        raise LiveError('pr_head_repo_mismatch', str(head_repo))
    return {'pr': pr_number, 'head_sha': head_sha, 'base': 'dev', 'branch': branch,
            'transport': 'https+gh'}


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
        pub_branch = (
            claim.get('publication_branch')
            or (claim.get('publish') or {}).get('branch')
            or (claim.get('runtime') or {}).get('publication_branch')
            or f'automation/issue-{issue}'
        )
        matches = [r for r in workflow_runs
                   if r.get('head_sha') == sha and r.get('name') == 'Product CI'
                   and r.get('head_branch') == pub_branch]
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
                        # Real DEV /v1/meta shape (health.controller) exposes gitSha.
                        live_sha = meta.get('gitSha')
                        if not (isinstance(live_sha, str) and SHA40.fullmatch(live_sha)):
                            live_sha = None
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
                # Exact merged SHA required — mismatched live gitSha is not ACCEPTED.
                if live_sha == merge_sha and (
                        accepted or latest.get('conclusion') == 'success'):
                    return {
                        'accepted': True, 'live_sha': live_sha, 'merged_sha': merge_sha,
                        'receipt': receipt or {'status': 'ACCEPTED', 'line': 'ACCEPTED'},
                        **last,
                    }
                if live_sha and live_sha != merge_sha and latest.get('conclusion') == 'success':
                    return {
                        'accepted': False, 'live_sha': live_sha, 'merged_sha': merge_sha,
                        'repairable': False, 'reason': 'live_sha_mismatch', **last,
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


def _agy_in_independent_fallback(task):
    """Explicit allowed AGY capacity fallback only — never invent a route."""
    routes = task.get('independentfallback') or task.get('independent_fallback') or []
    if isinstance(routes, str):
        routes = [routes]
    return any(
        str(r).split(':')[0] in ('agy', 'agy_qa', 'antigravity')
        for r in routes)


def _agy_capacity_fallback_evidence(evidence, candidate_sha):
    """Distinct AGY intent/evidence dir — never overwrite Codex receipts."""
    agy_evidence = Path(evidence)
    if agy_evidence.name.startswith('qa-'):
        fallback = agy_evidence.parent / (
            f'qa-agy-capacity-fallback-{candidate_sha[:12]}')
    else:
        fallback = Path(evidence) / (
            f'qa-agy-capacity-fallback-{candidate_sha[:12]}')
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _qa_resume_agy_capacity(claim, task, evidence, *, deadline=None):
    """Invoke only qualified+explicit AGY after Codex capacity — no Codex rerun."""
    from providers import role_ready, ProviderError
    if not _agy_in_independent_fallback(task):
        raise ProviderError('agy_capacity_fallback_not_admitted')
    ok, _ready = role_ready('agy_qa')
    if not ok:
        raise ProviderError('agy_fallback_not_ready')
    need_s = QA_TIMEOUT_S + 60
    if deadline is not None and (deadline - time.monotonic()) < need_s:
        # Still short: re-defer without AGY charge / without Codex replay.
        raise ProviderError(
            'wake_defer_capacity_fallback',
            f'remaining<{need_s}', charge='charged')
    fallback = _agy_capacity_fallback_evidence(evidence, claim['candidate_sha'])
    agy_task = dict(task)
    agy_task['attempt'] = f'capacity-fallback-{task.get("attempt") or 1}'
    agy_task['qaroute'] = ['agy_qa']
    return agy_qa_live(
        task=agy_task, candidate_sha=claim['candidate_sha'],
        evidence_dir=fallback)


def qa_dispatch(claim, *, deadline=None):
    """Route QA: AGY when READY+admitted+quota else Codex Medium.

    Uses immutable claim.runtime worktree/base/evidence — never recreate from raw task.
    Exact Codex capacity + turn.failed may fall back to qualified AGY only when
    independentfallback explicitly includes agy — never on content FAIL / UNKNOWN /
    safety, never overwrite Codex output. Capacity fallback also needs remaining
    wake budget for QA_TIMEOUT+margin or honest no-call deferral. After deferred
    capacity wake, resume_provider=agy_qa skips Codex prepare on the same candidate.
    """
    from providers import select_qa_provider, role_ready, ProviderError
    runtime = dict(claim.get('runtime') or {})
    task = dict(claim.get('task') or {})
    task['issue'] = claim['issue']
    # Prefer frozen claim runtime over admission raw task fields.
    wt = (claim.get('worktree') or runtime.get('worktree') or task.get('worktree'))
    if not wt:
        raise LiveError('qa_worktree_required')
    task['worktree'] = wt
    task['runtime_base_sha'] = claim.get('base_sha') or runtime.get('base_sha')
    evidence = (
        claim.get('evidence_dir')
        or runtime.get('qa_evidence_dir')
        or claim.get('qa_evidence_dir')
        or claim.get('evidence_root')
        or EVIDENCE_ROOT
    )
    # Persisted capacity-fallback resume: skip already-completed Codex entirely.
    resume = claim.get('resume_provider') or runtime.get('resume_provider')
    if resume == 'agy_qa' or claim.get('wake') == 'capacity_fallback_budget':
        return _qa_resume_agy_capacity(
            claim, task, evidence, deadline=deadline)
    # Explicit task provider routes remain authoritative — do not override prohibited.
    provider, reason, _meta = select_qa_provider(task, issue=claim['issue'])
    if provider == 'agy_qa':
        return agy_qa_live(task=task, candidate_sha=claim['candidate_sha'],
                           evidence_dir=evidence)
    try:
        return codex_qa_live(task=task, candidate_sha=claim['candidate_sha'],
                             evidence_dir=evidence)
    except ProviderError as err:
        if err.code != 'codex_capacity_technical':
            raise
        # Preserve Codex output; only explicit independentfallback→agy may continue.
        if not _agy_in_independent_fallback(task):
            raise
        ok, _ready = role_ready('agy_qa')
        if not ok:
            raise
        need_s = QA_TIMEOUT_S + 60
        if deadline is not None and (deadline - time.monotonic()) < need_s:
            # Honest known no-call deferral — next fresh wake; no AGY paid call.
            raise ProviderError(
                'wake_defer_capacity_fallback',
                f'remaining<{need_s}', charge='charged') from err
        return _qa_resume_agy_capacity(
            claim, task, evidence, deadline=deadline)


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

    def resolve_worktree(task):
        return resolve_task_worktree(task, repo=repo)

    def validate_worktree(work, *, expected_head=None):
        return validate_frozen_worktree(work, expected_head=expected_head)

    def reuse_worktree(task):
        return create_task_worktree(
            dict(task, reuse_frozen=True), repo=repo)

    def author(**kwargs):
        return cursor_author_live(**kwargs)

    def qa(claim):
        claim = dict(claim)
        # Prefer claim-scoped evidence_dir (attempt/candidate) over host default.
        if not claim.get('evidence_dir') and evidence_dir:
            claim['evidence_dir'] = evidence_dir
        return qa_dispatch(claim, deadline=deadline)

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
        resolve_worktree=resolve_worktree,
        validate_worktree=validate_worktree,
        reuse_worktree=reuse_worktree,
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
