#!/usr/bin/env python3
"""Lean Mode B provider adapters: Cursor author, Codex QA, Antigravity QA/author.

Stdlib-only. Reuses installed native transport utilities when present; does not
enable C5 policy, open historical #29 grants, or claim READY from this module.
Real paid model calls happen only after reviewed install + PMA commissioning.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from pathlib import Path

OWNER_ID = 318610566
REPO_ID = 1416250340
REPO = 'anpavel84-afk/gobadminton-clean'
AGY_MODEL = 'claude-sonnet-5-5-medium'
AGY_UID = 978
AGY_GID = 968
AGY_CLI = '/opt/gb-slots/runtime/antigravity/agy'
AGY_CLI_SHA256 = '8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c'
AGY_AUTH = Path('/srv/gb-slots/slot2/home/.gemini/antigravity-cli/antigravity-oauth-token')
AGY_MARKER = Path('/etc/gobadminton-slots/antigravity-qa.json')
LEAN_READY_ROOT = Path('/etc/gobadminton-lean')
AGY_QA_READY = LEAN_READY_ROOT / 'agy-qa-ready.json'
AGY_AUTHOR_READY = LEAN_READY_ROOT / 'agy-author-ready.json'
CURSOR_AUTHOR_READY = LEAN_READY_ROOT / 'cursor-author-ready.json'
CODEX_QA_READY = LEAN_READY_ROOT / 'codex-qa-ready.json'
RESULTS_ROOT = Path('/var/lib/gobadminton-lean/results')
QUOTA_LOCK = Path('/var/lib/gobadminton-lean/locks/agy-quota.lock')
NATIVE_TRAIN = Path('/usr/local/lib/gb-actions-train')
SHA40 = re.compile(r'^[0-9a-f]{40}$')
SCHEMA_QA = {'type': 'object', 'additionalProperties': False,
             'required': ['verdict', 'findings', 'reviewed_sha'],
             'properties': {'verdict': {'enum': ['PASS', 'FAIL']},
                            'findings': {'type': 'array', 'maxItems': 100,
                                        'items': {'type': 'string', 'maxLength': 4000}},
                            'reviewed_sha': {'type': 'string', 'pattern': '^[0-9a-f]{40}$'}}}


class ProviderError(RuntimeError):
    def __init__(self, code, detail=None, charge='none'):
        self.code = code
        self.detail = detail
        self.charge = charge  # none | unknown | charged
        super().__init__(code + ((': ' + detail) if detail else ''))


def _unique(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ProviderError('duplicate_json_key', str(k))
        out[k] = v
    return out


def loads(raw):
    if isinstance(raw, bytes):
        raw = raw.decode('utf-8')
    return json.loads(raw, object_pairs_hook=_unique)


def atomic_write(path, data, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data if isinstance(data, bytes) else (data if isinstance(data, str) else json.dumps(data, sort_keys=True, indent=2) + '\n')
    if isinstance(raw, str):
        raw = raw.encode()
    fd, tmp = tempfile.mkstemp(prefix='.lean-prov-', dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as fh:
            fh.write(raw)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def _import_native(name):
    """Load installed native module; never invent readiness from repo copy alone."""
    import importlib.util
    path = NATIVE_TRAIN / f'{name}.py'
    if not path.is_file():
        # Source-tree fallback for unit tests / pre-install review only.
        alt = Path(__file__).resolve().parents[2] / 'scripts' / 'chatops' / 'actions_train' / f'{name}.py'
        path = alt if alt.is_file() else path
    if not path.is_file():
        raise ProviderError('native_missing', name)
    spec = importlib.util.spec_from_file_location(f'lean_native_{name}', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def default_routes():
    """Initial production route: Cursor Auto author + Codex Sol Medium QA."""
    return {
        'author': 'cursor_auto',
        'qa': 'codex_sol_medium',
        'agy_qa_admitted': False,
        'agy_author_admitted': False,
        'fallback_qa': 'codex_sol_medium',
    }


def read_ready_marker(path):
    path = Path(path)
    if not path.is_file():
        return None
    try:
        value = loads(path.read_bytes())
    except (OSError, ValueError, ProviderError):
        return None
    if not isinstance(value, dict) or value.get('schema') != 'GB_LEAN_ROLE_READY_V1':
        return None
    if value.get('phase') != 'ready':
        return None
    return value


def role_ready(role):
    """Separate verified predicates. Author pass must not claim READY."""
    mapping = {
        'cursor_author': CURSOR_AUTHOR_READY,
        'codex_qa': CODEX_QA_READY,
        'agy_qa': AGY_QA_READY,
        'agy_author': AGY_AUTHOR_READY,
    }
    path = mapping.get(role)
    if path is None:
        return False, 'unknown role'
    marker = read_ready_marker(path)
    if marker is None:
        return False, f'{role} READY marker absent or not verified'
    return True, marker


def agy_executor_preflight():
    """Headless product_executor_ready when native is installed; never calls model."""
    native = _import_native('native_antigravity')
    if not hasattr(native, 'product_executor_ready'):
        raise ProviderError('agy_preflight_missing')
    return native.product_executor_ready()


def agy_quota_path(issue, day_utc):
    return RESULTS_ROOT / 'agy-quota' / f'issue-{int(issue)}-{day_utc}.json'


def read_agy_quota(issue, day_utc=None, *, lock_path=QUOTA_LOCK):
    day = day_utc or time.strftime('%Y-%m-%d', time.gmtime())
    path = agy_quota_path(issue, day)
    record = {'schema': 'GB_LEAN_AGY_QUOTA_V1', 'issue': int(issue), 'day_utc': day,
              'charged_calls': 0, 'unknown_calls': 0, 'receipts': []}
    if path.is_file():
        try:
            record = loads(path.read_bytes())
        except (OSError, ValueError, ProviderError):
            record['unknown_calls'] = max(1, int(record.get('unknown_calls') or 0))
    return record


def charged_agy_calls(issue, day_utc=None):
    rec = read_agy_quota(issue, day_utc)
    charged = int(rec.get('charged_calls') or 0)
    unknown = int(rec.get('unknown_calls') or 0)
    # Unknown charge counts as unknown, not zero — blocks further AGY until reconciled.
    return charged, unknown, rec


def agy_quota_available(issue, limit=5, day_utc=None):
    charged, unknown, rec = charged_agy_calls(issue, day_utc)
    if unknown:
        return False, 'agy_quota_unknown_pending_reconcile', rec
    if charged >= limit:
        return False, 'agy_quota_exhausted', rec
    return True, 'ok', rec


def record_agy_charge(issue, receipt, *, charge='charged', day_utc=None, results_root=None):
    """Persist charge under existing lock semantics; parser replay must not call this."""
    day = day_utc or time.strftime('%Y-%m-%d', time.gmtime())
    root = Path(results_root) if results_root else RESULTS_ROOT
    path = root / 'agy-quota' / f'issue-{int(issue)}-{day}.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    lock = root / 'locks' / 'agy-quota.lock'
    lock.parent.mkdir(parents=True, exist_ok=True)
    import fcntl
    fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o660)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        rec = read_agy_quota(issue, day)
        if results_root:
            alt = path
            if alt.is_file():
                rec = loads(alt.read_bytes())
        receipts = list(rec.get('receipts') or [])
        receipts.append({'charge': charge, 'receipt': receipt, 'recorded_at': int(time.time())})
        if charge == 'charged':
            rec['charged_calls'] = int(rec.get('charged_calls') or 0) + 1
        elif charge == 'unknown':
            rec['unknown_calls'] = int(rec.get('unknown_calls') or 0) + 1
        elif charge != 'none':
            raise ProviderError('invalid_charge', charge)
        rec['receipts'] = receipts
        atomic_write(path, rec, 0o644)
        return rec
    finally:
        os.close(fd)


def parse_qa_verdict(raw, reviewed_sha, *, model=AGY_MODEL):
    """Reparse saved output; never a paid call. Bind exact candidate SHA."""
    if not (isinstance(reviewed_sha, str) and SHA40.fullmatch(reviewed_sha)):
        raise ProviderError('invalid_reviewed_sha')
    native = None
    try:
        native = _import_native('native_antigravity')
    except ProviderError:
        native = None
    wire = raw if isinstance(raw, bytes) else raw.encode()
    # Prefer native parse_stream only for real AGY stream-json; preserve raw for reparse.
    looks_agy = b'"event":"init"' in wire or b'"event": "init"' in wire
    if looks_agy and native is not None and hasattr(native, 'parse_stream'):
        try:
            result = native.parse_stream(wire, reviewed_sha, model=model)
            verdict = result if isinstance(result, dict) else getattr(result, '__dict__', {})
            if 'verdict' in verdict and 'reviewed_sha' in verdict:
                if verdict['reviewed_sha'] != reviewed_sha:
                    raise ProviderError('stale_sha_verdict', verdict['reviewed_sha'])
                return {'verdict': verdict['verdict'], 'findings': list(verdict.get('findings') or []),
                        'reviewed_sha': reviewed_sha, 'source': 'native_parse_stream', 'charge': 'none'}
            structured = verdict.get('structured_output') or verdict.get('result') or verdict
            if isinstance(structured, dict) and 'verdict' in structured:
                if structured.get('reviewed_sha') != reviewed_sha:
                    raise ProviderError('stale_sha_verdict', str(structured.get('reviewed_sha')))
                return {'verdict': structured['verdict'], 'findings': list(structured.get('findings') or []),
                        'reviewed_sha': reviewed_sha, 'source': 'native_parse_stream', 'charge': 'none'}
        except ProviderError:
            raise
        except Exception as err:
            # Parser failure after saved output: fall through to lean reparse, never new call.
            if type(err).__name__ == 'ReviewError' and 'stale' in str(err).lower():
                raise ProviderError('stale_sha_verdict', str(err)) from err
            # continue to standalone
    # Minimal standalone parser for unit tests / compact verdict JSON / native miss.
    text = raw.decode() if isinstance(raw, bytes) else raw
    # Prefer last JSON object containing verdict.
    matches = list(re.finditer(r'\{[^{}]*"verdict"[^{}]*\}', text, re.DOTALL))
    if not matches:
        # try whole-file JSON lines
        for line in text.splitlines():
            line = line.strip()
            if not line.startswith('{'):
                continue
            try:
                obj = loads(line)
            except (ValueError, ProviderError):
                continue
            if isinstance(obj, dict) and obj.get('verdict') in ('PASS', 'FAIL'):
                matches = [re.search(re.escape(line), text)] if line in text else matches
                if obj.get('reviewed_sha') != reviewed_sha:
                    raise ProviderError('stale_sha_verdict', str(obj.get('reviewed_sha')))
                return {'verdict': obj['verdict'], 'findings': list(obj.get('findings') or []),
                        'reviewed_sha': reviewed_sha, 'source': 'lean_jsonl', 'charge': 'none'}
        raise ProviderError('parse_failed')
    obj = loads(matches[-1].group(0))
    if obj.get('reviewed_sha') != reviewed_sha:
        raise ProviderError('stale_sha_verdict', str(obj.get('reviewed_sha')))
    if obj.get('verdict') not in ('PASS', 'FAIL'):
        raise ProviderError('invalid_verdict')
    return {'verdict': obj['verdict'], 'findings': list(obj.get('findings') or []),
            'reviewed_sha': reviewed_sha, 'source': 'lean_regex', 'charge': 'none'}


def select_qa_provider(task, *, issue):
    """Nonblocking routing: AGY only when READY + admitted + quota; else Codex."""
    routes = task.get('qaroute') or task.get('qa_route') or ['codex_sol_medium']
    if isinstance(routes, str):
        routes = [routes]
    explicit_agy = any(str(r).split(':')[0] in ('agy', 'antigravity', 'agy_qa') for r in routes)
    if explicit_agy:
        ok, reason = role_ready('agy_qa')
        if not ok:
            return 'codex_sol_medium', 'agy_not_ready_fallback', reason
        avail, why, rec = agy_quota_available(issue)
        if not avail:
            return 'codex_sol_medium', 'agy_unavailable_fallback', why
        return 'agy_qa', 'agy_selected', rec
    return 'codex_sol_medium', 'default_codex', None


def build_agy_landlock_roots(source_ro, private_home, runtime_dirs=None):
    """Landlock-only confinement roots (no seccomp — run_command needs fork)."""
    readonly = [Path(p) for p in (
        '/usr/bin', '/usr/lib', '/usr/lib64', '/lib', '/lib64', '/usr/share',
        '/etc/ld.so.cache', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf',
        '/opt/gb-slots/runtime/antigravity', '/opt/gb-slots/runtime/node',
        str(source_ro), str(private_home),
    ) if Path(p).exists()]
    for extra in runtime_dirs or ():
        p = Path(extra)
        if p.exists():
            readonly.append(p)
    writable = [Path(private_home)]
    for p in ('/dev/null', '/dev/urandom', '/dev/random', '/tmp'):
        if Path(p).exists():
            writable.append(Path(p))
    executables = [Path(p) for p in (
        '/usr/bin', '/usr/lib', '/usr/lib64', '/lib', '/lib64',
        '/opt/gb-slots/runtime/antigravity', AGY_CLI,
    ) if Path(p).exists()]
    return readonly, writable, executables


def agy_child_preexec(readonly, writable, executables, *, uid=AGY_UID, gid=AGY_GID):
    """UID978 child: setuid/groups, nnp, zero caps, Landlock — not seccomp."""
    def _child():
        os.setgroups([65042])
        os.setgid(gid)
        os.setuid(uid)
        # Drop ambient/capabilities best-effort without requiring priv reclaim.
        try:
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            libc.prctl(38, 1, 0, 0, 0)  # no_new_privs
        except Exception:
            pass
        guard = _import_native('native_guard')
        guard._landlock(readonly, writable, executables)
    return _child


def prepare_cursor_author_intent(task, worktree, evidence_dir):
    """Write intent before any paid call; Mode A launch pattern factored."""
    intent = {
        'schema': 'GB_LEAN_PROVIDER_INTENT_V1',
        'provider': 'cursor_auto',
        'role': 'author',
        'issue': int(task['issue']),
        'revision': task.get('revision') or task.get('task_revision'),
        'worktree': str(worktree),
        'allowed_paths': list(task.get('allowed_paths') or []),
        'phase': 'prepared',
        'started_at': int(time.time()),
    }
    path = Path(evidence_dir) / 'author-intent.json'
    atomic_write(path, intent, 0o600)
    return intent, path


def prepare_qa_intent(task, candidate_sha, provider, evidence_dir):
    if not (isinstance(candidate_sha, str) and SHA40.fullmatch(candidate_sha)):
        raise ProviderError('invalid_candidate_sha')
    intent = {
        'schema': 'GB_LEAN_PROVIDER_INTENT_V1',
        'provider': provider,
        'role': 'qa',
        'issue': int(task['issue']),
        'revision': task.get('revision') or task.get('task_revision'),
        'candidate_sha': candidate_sha,
        'phase': 'prepared',
        'started_at': int(time.time()),
    }
    path = Path(evidence_dir) / f'qa-intent-{provider}.json'
    atomic_write(path, intent, 0o600)
    return intent, path


def fingerprint_findings(findings):
    norm = sorted(str(f).strip() for f in (findings or []) if str(f).strip())
    return hashlib.sha256(json.dumps(norm, separators=(',', ':')).encode()).hexdigest()


def progress_halt(previous_fingerprints, findings):
    """Two same-fingerprint non-progress repeats halt current strategy (OD-016)."""
    fp = fingerprint_findings(findings)
    hits = [x for x in previous_fingerprints if x == fp]
    return len(hits) >= 2, fp


# Explicit: this author pass does not claim AGY/Cursor/Codex READY and does not
# invoke paid model CLIs. PMA owns real provider proof after install.
AUTHOR_PASS_CLAIMS = {
    'agy_qa_ready': False,
    'agy_author_ready': False,
    'mode_b_active': False,
    'model_calls': 0,
    'note': 'source-only OD017; READY/qualification deferred to PMA commissioning',
}
