#!/usr/bin/env python3
"""Lean Mode B provider adapters: Cursor author, Codex QA, Antigravity QA/author.

Stdlib-only. Reuses installed native transport utilities when present; does not
enable C5 policy, open historical #29 grants, or claim READY from this module.
Live launchers live in live.py; this module keeps parse/quota/intent/READY
predicates and invoke wrappers. Intents are saved before any side-effecting
call. UNKNOWN timeouts are not blindly replayed.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path


def readable_present(path):
    """Path.exists that treats EACCES as absent — never probe host-protected dirs
    into unit-test failures."""
    try:
        return Path(path).exists()
    except OSError:
        return False

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


def _ensure_native_sys_path(native_dir):
    """Expose protected native dir for transitive imports under python -I.

    Place after this Mode B tools/train directory when present so `live` /
    `run` / `providers` are not shadowed by native `live/`. Never prepend
    user-writable project/hook dirs ahead of the Mode B binding.
    """
    native_dir = str(Path(native_dir).resolve())
    if native_dir in sys.path:
        return native_dir
    train_dir = str(Path(__file__).resolve().parent)
    if train_dir in sys.path:
        sys.path.insert(sys.path.index(train_dir) + 1, native_dir)
    else:
        sys.path.append(native_dir)
    return native_dir


def _import_native(name):
    """Load installed native module; never invent readiness from repo copy alone."""
    import importlib.util
    path = NATIVE_TRAIN / f'{name}.py'
    if not path.is_file():
        alt = Path(__file__).resolve().parents[2] / 'scripts' / 'chatops' / 'actions_train' / f'{name}.py'
        path = alt if alt.is_file() else path
    if not path.is_file():
        raise ProviderError('native_missing', name)
    _ensure_native_sys_path(path.parent)
    spec = importlib.util.spec_from_file_location(f'lean_native_{name}', path)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except ImportError as err:
        # Loader transitive import failure — known NO_CALL, before CLI/auth.
        raise ProviderError(
            'preflight_no_call',
            f'{type(err).__name__}:{err}',
            charge='none',
        ) from err
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
    # Readiness must bind accepted model/CLI/version/adapter/executor/credential.
    required = ('role', 'model', 'cli', 'cli_sha256', 'adapter', 'executor_uid',
                'credential_identity', 'verified_terminal_verdict')
    if any(not value.get(k) for k in required):
        return None
    if value.get('verified_terminal_verdict') not in ('PASS', 'FAIL'):
        return None
    return value


def role_ready(role):
    """Separate verified predicates. Author pass must not claim READY.

    agy_qa binds the real native product_role_ready()/root proof (PR #376).
    agy_author binds protected NativeAuthor marker + product_role_ready proof
    (modules/UID/model) — NEVER cosmetic file existence or CANARY-only phase.
    Never fabricate a lean READY marker; lean file remains optional secondary.
    """
    if role == 'agy_qa':
        try:
            native = _import_native('native_antigravity')
            if hasattr(native, 'product_role_ready') and native.product_role_ready():
                return True, {
                    'source': 'native_product_role_ready',
                    'role': 'agy_qa',
                    'schema': 'GB_PRODUCT_QA_ROLE_READY_V1',
                }
        except ProviderError:
            pass
        except Exception:
            pass
        marker = read_ready_marker(AGY_QA_READY)
        if marker is None:
            return False, 'agy_qa READY marker absent or not verified'
        if marker.get('role') != 'agy_qa':
            return False, 'role mismatch in READY marker'
        return True, marker
    if role == 'agy_author':
        try:
            native = _import_native('native_antigravity_author')
            if hasattr(native, 'product_role_ready') and native.product_role_ready():
                return True, {
                    'source': 'native_product_role_ready',
                    'role': 'agy_author',
                    'schema': 'GB_PRODUCT_AUTHOR_ROLE_READY_V1',
                }
        except ProviderError:
            pass
        except Exception:
            pass
        marker = read_ready_marker(AGY_AUTHOR_READY)
        if marker is None:
            return False, 'agy_author READY marker absent or not verified'
        if marker.get('role') != 'agy_author':
            return False, 'role mismatch in READY marker'
        # CANARY-only / unbound proof must never look READY.
        if marker.get('phase') != 'ready' or not marker.get('verified_terminal_verdict'):
            return False, 'agy_author READY proof incomplete'
        return True, marker
    mapping = {
        'cursor_author': CURSOR_AUTHOR_READY,
        'codex_qa': CODEX_QA_READY,
    }
    path = mapping.get(role)
    if path is None:
        return False, 'unknown role'
    marker = read_ready_marker(path)
    if marker is None:
        return False, f'{role} READY marker absent or not verified'
    if marker.get('role') != role:
        return False, 'role mismatch in READY marker'
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
    return charged, unknown, rec


def agy_quota_available(issue, limit=None, day_utc=None):
    """Mode B private AGY audit ledger — authorization is shared Budget (OD-020).

    OD-020: no artificial numeric per-Issue/day cap. UNKNOWN never authorizes a
    replay. Optional explicit ``limit`` retained only for historical tests that
    still pass a concrete positive int; default is no private numeric ceiling.
    Shared native Budget (/etc/gobadminton-slots/budgets.json) charges once.
    """
    charged, unknown, rec = charged_agy_calls(issue, day_utc)
    if unknown:
        return False, 'agy_quota_unknown_pending_reconcile', rec
    if limit is not None:
        if type(limit) is not int or limit <= 0:
            raise ProviderError('invalid_agy_quota_limit', str(limit))
        if charged >= limit:
            return False, 'agy_quota_exhausted', rec
    return True, 'ok', dict(rec, charged_calls=charged, od020_no_artificial_cap=limit is None)


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


def _normalize_native_parse(result):
    """native_antigravity.parse_stream returns (result, evidence), not a dict."""
    if isinstance(result, tuple) and len(result) == 2:
        verdict, evidence = result
        return verdict, evidence
    if isinstance(result, dict) and 'verdict' in result:
        return result, {}
    raise ProviderError('native_parse_shape', type(result).__name__)


def parse_agy_stream(raw, reviewed_sha, *, model=AGY_MODEL):
    """Strict native AGY stream validation. NEVER regex-fallback after native-invalid."""
    if not (isinstance(reviewed_sha, str) and SHA40.fullmatch(reviewed_sha)):
        raise ProviderError('invalid_reviewed_sha')
    native = _import_native('native_antigravity')
    if not hasattr(native, 'parse_stream'):
        raise ProviderError('native_parse_stream_missing')
    wire = raw if isinstance(raw, bytes) else raw.encode()
    try:
        parsed = native.parse_stream(wire, reviewed_sha, model=model)
    except ProviderError:
        raise
    except Exception as err:
        # Native invalid stream: retain raw for local replay; do not regex-fallback.
        raise ProviderError('agy_native_invalid_stream', type(err).__name__ + ':' + str(err)[:200],
                            charge='none') from err
    verdict, evidence = _normalize_native_parse(parsed)
    if not isinstance(verdict, dict):
        verdict = getattr(verdict, '__dict__', None) or {}
    structured = verdict if 'verdict' in verdict else (
        verdict.get('structured_output') or verdict.get('result') or verdict)
    if not isinstance(structured, dict) or structured.get('verdict') not in ('PASS', 'FAIL'):
        raise ProviderError('agy_native_invalid_verdict')
    if structured.get('reviewed_sha') != reviewed_sha:
        raise ProviderError('stale_sha_verdict', str(structured.get('reviewed_sha')))
    return {
        'verdict': structured['verdict'],
        'findings': list(structured.get('findings') or []),
        'reviewed_sha': reviewed_sha,
        'source': 'native_parse_stream',
        'charge': 'none',
        'evidence': evidence if isinstance(evidence, dict) else {},
    }


def parse_codex_final(raw, reviewed_sha):
    """Codex final exact JSON parsed separately with exact reviewed SHA. No regex hunt."""
    if not (isinstance(reviewed_sha, str) and SHA40.fullmatch(reviewed_sha)):
        raise ProviderError('invalid_reviewed_sha')
    text = raw.decode() if isinstance(raw, bytes) else raw
    text = text.strip()
    try:
        obj = loads(text)
    except (ValueError, ProviderError) as err:
        # Try last non-empty line if final.txt wraps a single JSON object line.
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            raise ProviderError('codex_final_empty') from err
        try:
            obj = loads(lines[-1])
        except (ValueError, ProviderError) as err2:
            raise ProviderError('codex_final_not_exact_json') from err2
    if not isinstance(obj, dict):
        raise ProviderError('codex_final_not_object')
    if obj.get('reviewed_sha') != reviewed_sha:
        raise ProviderError('stale_sha_verdict', str(obj.get('reviewed_sha')))
    if obj.get('verdict') not in ('PASS', 'FAIL'):
        raise ProviderError('invalid_verdict')
    return {
        'verdict': obj['verdict'],
        'findings': list(obj.get('findings') or []),
        'reviewed_sha': reviewed_sha,
        'source': 'codex_final_json',
        'charge': 'none',
    }


def parse_qa_verdict(raw, reviewed_sha, *, model=AGY_MODEL, provider=None):
    """Reparse saved output; never a paid call. Bind exact candidate SHA.

    AGY native streams use parse_agy_stream (no regex fallback after invalid).
    Codex finals use parse_codex_final. Compact unit-test JSON only when the
    payload is clearly not an AGY stream and provider is not agy.
    """
    if not (isinstance(reviewed_sha, str) and SHA40.fullmatch(reviewed_sha)):
        raise ProviderError('invalid_reviewed_sha')
    wire = raw if isinstance(raw, bytes) else raw.encode()
    looks_agy = b'"event":"init"' in wire or b'"event": "init"' in wire
    if provider in ('agy', 'agy_qa', 'antigravity') or looks_agy:
        return parse_agy_stream(raw, reviewed_sha, model=model)
    if provider in ('codex', 'codex_sol_medium', 'codex_qa') or (
            not looks_agy and b'"verdict"' in wire and b'"event"' not in wire):
        # Prefer exact Codex JSON when not an AGY stream.
        try:
            return parse_codex_final(raw, reviewed_sha)
        except ProviderError:
            if provider in ('codex', 'codex_sol_medium', 'codex_qa'):
                raise
    # Compact standalone JSON for unit tests / lean receipts only (never after AGY native fail).
    text = wire.decode()
    try:
        obj = loads(text.strip())
    except (ValueError, ProviderError):
        raise ProviderError('parse_failed')
    if not isinstance(obj, dict) or obj.get('verdict') not in ('PASS', 'FAIL'):
        raise ProviderError('parse_failed')
    if obj.get('reviewed_sha') != reviewed_sha:
        raise ProviderError('stale_sha_verdict', str(obj.get('reviewed_sha')))
    return {'verdict': obj['verdict'], 'findings': list(obj.get('findings') or []),
            'reviewed_sha': reviewed_sha, 'source': 'lean_exact_json', 'charge': 'none'}


def select_qa_provider(task, *, issue):
    """Nonblocking routing: default Codex Medium; AGY only when READY+quota.

    Explicit not-ready fallback happens BEFORE any charge. Never invent READY.
    Bare unsupported [AGY_CLI, --model] product QA is refused in live.agy_qa_live
    (native product_run_qa required); budget history is unchanged here.
    AGY author never self-QAs — default QA remains Codex Sol Medium.
    """
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


def select_author_provider(task, *, issue=None):
    """Author routing via task.authorroute / author_route.

    Cursor Auto is the default. Explicit ['agy_author','cursor_auto'] selects
    actually qualified AGY author, or pre-launch Cursor fallback when not READY.
    Codex Author is NOT QUALIFIED — never route to it or fake READY.
    """
    routes = (
        task.get('authorroute') or task.get('author_route')
        or task.get('author_routes') or ['cursor_auto']
    )
    if isinstance(routes, str):
        routes = [routes]
    normalized = []
    for r in routes:
        key = str(r).split(':')[0].strip().lower().replace('-', '_')
        if key in ('agy', 'agy_author', 'antigravity_author'):
            normalized.append('agy_author')
        elif key in ('cursor', 'cursor_auto', 'cursor_author'):
            normalized.append('cursor_auto')
        elif key in ('codex', 'codex_author'):
            # Explicitly not qualified — skip, never fake READY.
            continue
        else:
            normalized.append(key)
    if not normalized:
        return 'cursor_auto', 'default_cursor', None
    if normalized[0] == 'agy_author':
        ok, reason = role_ready('agy_author')
        if ok:
            if issue is not None:
                avail, why, rec = agy_quota_available(int(issue))
                if not avail:
                    if 'cursor_auto' in normalized:
                        return 'cursor_auto', 'agy_author_unavailable_fallback', why
                    return 'cursor_auto', 'agy_author_unavailable_fallback', why
                return 'agy_author', 'agy_author_selected', rec
            return 'agy_author', 'agy_author_selected', reason
        if 'cursor_auto' in normalized:
            return 'cursor_auto', 'agy_author_not_ready_fallback', reason
        return 'cursor_auto', 'agy_author_not_ready_fallback', reason
    return 'cursor_auto', 'default_cursor', None


def build_agy_landlock_roots(source_ro, private_home, private_scratch, runtime_dirs=None,
                             auth_path=None):
    """Landlock-only confinement. No writable global /tmp — private HOME/scratch only.

    auth_path: inject test auth parent in unit tests; never probe host-protected
    /srv paths when an explicit test path is supplied. Runtime uses readable_present
    so EACCES on AGY_AUTH.parent does not crash unit tests or CI.
    """
    readonly = []
    for p in (
        '/usr/bin', '/usr/lib', '/usr/lib64', '/lib', '/lib64', '/usr/share',
        '/etc/ld.so.cache', '/etc/ssl', '/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf',
        '/opt/gb-slots/runtime/antigravity', '/opt/gb-slots/runtime/node',
        str(source_ro),
    ):
        if readable_present(p):
            readonly.append(Path(p))
    for extra in runtime_dirs or ():
        p = Path(extra)
        if readable_present(p):
            readonly.append(p)
    # Readonly credentials parent: injectable for tests; host uses AGY_AUTH.
    auth = Path(auth_path) if auth_path is not None else AGY_AUTH
    if readable_present(auth.parent):
        readonly.append(auth.parent)
    writable = [Path(private_home), Path(private_scratch)]
    for p in ('/dev/null', '/dev/urandom', '/dev/random'):
        if readable_present(p):
            writable.append(Path(p))
    # Explicit: global /tmp is NOT writable.
    executables = [Path(p) for p in (
        '/usr/bin', '/usr/lib', '/usr/lib64', '/lib', '/lib64',
        '/opt/gb-slots/runtime/antigravity', AGY_CLI,
    ) if readable_present(p)]
    return readonly, writable, executables


def agy_child_preexec(readonly, writable, executables, *, uid=AGY_UID, gid=AGY_GID):
    """UID978/GID968 child: setuid/groups, nnp, zero caps, Landlock — not seccomp.

    native_guard.restrict adds seccomp that blocks fork/run_command; AGY needs
    the existing _landlock primitive only.
    """
    def _child():
        os.setgroups([65042])
        os.setgid(gid)
        os.setuid(uid)
        try:
            import ctypes
            libc = ctypes.CDLL(None, use_errno=True)
            libc.prctl(38, 1, 0, 0, 0)  # no_new_privs
            # Best-effort zero capabilities (ambient + bounding).
            for cap in range(0, 64):
                try:
                    libc.prctl(24, cap, 0, 0, 0)  # PR_CAPBSET_DROP
                except Exception:
                    break
        except Exception:
            pass
        guard = _import_native('native_guard')
        # Use _landlock only — never restrict() (seccomp blocks fork).
        guard._landlock(readonly, writable, executables)
    return _child


def prepare_cursor_author_intent(task, worktree, evidence_dir):
    """Write intent before any paid call; Mode A launch pattern factored.

    evidence_dir must be the unique author-attempt-N folder. Never overwrite an
    existing intent/raw receipt (would erase history or hide a second paid call).
    """
    path = Path(evidence_dir) / 'author-intent.json'
    if path.exists():
        raise ProviderError('author_intent_exists_no_overwrite', str(path))
    for raw_name in ('stream.jsonl', 'stderr', 'prompt.txt'):
        if (Path(evidence_dir) / raw_name).exists():
            raise ProviderError('author_raw_exists_no_overwrite', raw_name)
    intent = {
        'schema': 'GB_LEAN_PROVIDER_INTENT_V1',
        'provider': 'cursor_auto',
        'role': 'author',
        'issue': int(task['issue']),
        'revision': task.get('revision') or task.get('task_revision'),
        'worktree': str(worktree),
        'runtime_base_sha': task.get('runtime_base_sha') or task.get('base'),
        'allowed_paths': list(task.get('allowed_paths') or []),
        'phase': 'prepared',
        'started_at': int(time.time()),
        'evidence_dir': str(evidence_dir),
    }
    atomic_write(path, intent, 0o600)
    return intent, path


def prepare_qa_intent(task, candidate_sha, provider, evidence_dir):
    if not (isinstance(candidate_sha, str) and SHA40.fullmatch(candidate_sha)):
        raise ProviderError('invalid_candidate_sha')
    path = Path(evidence_dir) / f'qa-intent-{provider}.json'
    if path.exists():
        raise ProviderError('qa_intent_exists_no_overwrite', str(path))
    intent = {
        'schema': 'GB_LEAN_PROVIDER_INTENT_V1',
        'provider': provider,
        'role': 'qa',
        'issue': int(task['issue']),
        'revision': task.get('revision') or task.get('task_revision'),
        'candidate_sha': candidate_sha,
        'runtime_base_sha': task.get('runtime_base_sha') or task.get('base'),
        'worktree': task.get('worktree'),
        'phase': 'prepared',
        'started_at': int(time.time()),
        'evidence_dir': str(evidence_dir),
    }
    atomic_write(path, intent, 0o600)
    return intent, path


def prepare_operation_intent(kind, payload, evidence_dir):
    """Save raw/operation intent before any GitHub or model side effect."""
    intent = {
        'schema': 'GB_LEAN_OPERATION_INTENT_V1',
        'kind': kind,
        'payload': payload,
        'phase': 'prepared',
        'started_at': int(time.time()),
    }
    path = Path(evidence_dir) / f'op-intent-{kind}-{int(time.time())}.json'
    atomic_write(path, intent, 0o600)
    return intent, path


def mark_intent_phase(path, phase, **extra):
    rec = loads(Path(path).read_bytes())
    rec['phase'] = phase
    rec.update(extra)
    if phase in ('UNKNOWN', 'timeout'):
        rec['no_blind_replay'] = True
    atomic_write(path, rec, 0o600)
    return rec


def fingerprint_findings(findings):
    norm = sorted(str(f).strip() for f in (findings or []) if str(f).strip())
    return hashlib.sha256(json.dumps(norm, separators=(',', ':')).encode()).hexdigest()


def progress_halt(previous_fingerprints, findings):
    """Two same-fingerprint non-progress repeats halt current strategy (OD-016)."""
    fp = fingerprint_findings(findings)
    hits = [x for x in previous_fingerprints if x == fp]
    return len(hits) >= 2, fp


def _live_cursor_author():
    import live as lean_live
    return lean_live.cursor_author_live


def _live_agy_author():
    import live as lean_live
    return lean_live.agy_author_live


def _live_codex_qa():
    import live as lean_live
    return lean_live.codex_qa_live


def _live_publish(kind):
    import live as lean_live
    if kind == 'merge_dev':
        return lean_live.merge_pr_live
    return lean_live.publish_push_pr


def invoke_cursor_author(*, task, worktree, evidence_dir, launcher=None, parent_lease=True):
    """Bounded author call (compatibility name). Routes by select_author_provider.

    Live default selects cursor_author_live or agy_author_live. Never mislabels an
    actual AGY call as Cursor. parent_lease=True means the controller already holds
    the one writer lease — do not nest a second acquisition. Tests inject fakes.
    """
    provider, route_reason, _meta = select_author_provider(
        task, issue=task.get('issue'))
    intent, intent_path = prepare_cursor_author_intent(task, worktree, evidence_dir)
    mark_intent_phase(
        intent_path, 'prepared', requested_provider=provider,
        effective_provider=provider, route_reason=route_reason,
        fallback_provider=('cursor_auto' if provider == 'agy_author' else None))
    if launcher is None:
        try:
            if provider == 'agy_author':
                launcher = _live_agy_author()
            else:
                launcher = _live_cursor_author()
        except Exception as err:
            mark_intent_phase(intent_path, 'HOLD_launcher_absent', error=type(err).__name__)
            raise ProviderError('author_launcher_absent', type(err).__name__) from err
    mark_intent_phase(intent_path, 'launching', parent_lease=bool(parent_lease),
                      provider=provider, effective_provider=provider)
    try:
        result = launcher(task=task, worktree=worktree, evidence_dir=evidence_dir,
                          intent_path=str(intent_path), parent_lease=True)
    except TimeoutError as err:
        mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
        raise ProviderError('author_timeout_unknown', str(err), charge='unknown') from err
    except ProviderError as err:
        # Preserve loader preflight_no_call / no_model_launched intent; do not
        # overwrite with HOLD or invent a paid retry.
        if err.code != 'preflight_no_call':
            mark_intent_phase(intent_path, 'HOLD_no_automatic_replay',
                              error_type=type(err).__name__, error=err.code)
        raise
    except Exception as err:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error_type=type(err).__name__)
        raise
    sha = result.get('candidate_sha')
    if not (isinstance(sha, str) and SHA40.fullmatch(sha)):
        raise ProviderError('author_missing_candidate_sha')
    # Preserve actual provider from launcher result (fallback may switch to Cursor).
    effective = result.get('provider') or provider
    mark_intent_phase(intent_path, 'completed', candidate_sha=sha,
                      provider=effective, effective_provider=effective,
                      requested_provider=provider, route_reason=route_reason)
    return result


def invoke_codex_qa(*, task, candidate_sha, evidence_dir, launcher=None):
    """Independent Codex Sol Medium QA. Live default = live.codex_qa_live."""
    intent, intent_path = prepare_qa_intent(task, candidate_sha, 'codex_sol_medium', evidence_dir)
    if launcher is None:
        try:
            launcher = _live_codex_qa()
        except Exception as err:
            mark_intent_phase(intent_path, 'HOLD_launcher_absent', error=type(err).__name__)
            raise ProviderError('codex_launcher_absent', type(err).__name__) from err
    mark_intent_phase(intent_path, 'launching')
    try:
        raw_or_result = launcher(task=task, candidate_sha=candidate_sha,
                                 evidence_dir=evidence_dir, intent_path=str(intent_path))
    except TimeoutError as err:
        mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
        raise ProviderError('qa_timeout_unknown', str(err), charge='unknown') from err
    except Exception as err:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error_type=type(err).__name__)
        raise
    if isinstance(raw_or_result, dict) and raw_or_result.get('verdict') in ('PASS', 'FAIL'):
        if raw_or_result.get('reviewed_sha') != candidate_sha:
            raise ProviderError('stale_sha_verdict', str(raw_or_result.get('reviewed_sha')))
        mark_intent_phase(intent_path, 'completed', verdict=raw_or_result['verdict'])
        return dict(raw_or_result, charge=raw_or_result.get('charge', 'charged'))
    raw = raw_or_result if isinstance(raw_or_result, (bytes, str)) else raw_or_result.get('raw', '')
    parsed = parse_codex_final(raw, candidate_sha)
    parsed['charge'] = 'charged'
    mark_intent_phase(intent_path, 'completed', verdict=parsed['verdict'])
    return parsed


def invoke_agy_qa(*, task, candidate_sha, evidence_dir, launcher=None):
    """AGY live QA transport — actual code path, not quota/parser-only."""
    intent, intent_path = prepare_qa_intent(task, candidate_sha, 'agy_qa', evidence_dir)
    if launcher is None:
        try:
            import live as lean_live
            launcher = lean_live.agy_qa_live
        except Exception as err:
            mark_intent_phase(intent_path, 'HOLD_launcher_absent', error=type(err).__name__)
            raise ProviderError('agy_launcher_absent', type(err).__name__) from err
    mark_intent_phase(intent_path, 'launching')
    try:
        result = launcher(task=task, candidate_sha=candidate_sha,
                          evidence_dir=evidence_dir, intent_path=str(intent_path))
    except TimeoutError as err:
        mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
        raise ProviderError('qa_timeout_unknown', str(err), charge='unknown') from err
    mark_intent_phase(intent_path, 'completed',
                      verdict=(result or {}).get('verdict'))
    return result


def invoke_trusted_publish(*, kind, payload, evidence_dir, publisher=None):
    """Trusted UID1002 gh publication — never GITHUB_TOKEN push.

    Live default binds publish_push_pr / merge_pr_live — not 'PMA supplies publisher'.
    """
    intent, intent_path = prepare_operation_intent(kind, payload, evidence_dir)
    if publisher is None:
        try:
            publisher = _live_publish(kind)
        except Exception as err:
            mark_intent_phase(intent_path, 'HOLD_publisher_absent', error=type(err).__name__)
            raise ProviderError('publisher_absent', type(err).__name__) from err
    mark_intent_phase(intent_path, 'launching')
    try:
        result = publisher(kind=kind, payload=payload, intent_path=str(intent_path))
    except TimeoutError as err:
        mark_intent_phase(intent_path, 'UNKNOWN', error='timeout')
        raise ProviderError('publish_timeout_unknown', str(err), charge='unknown') from err
    except Exception as err:
        mark_intent_phase(intent_path, 'HOLD_no_automatic_replay', error_type=type(err).__name__)
        raise
    mark_intent_phase(intent_path, 'completed', result_keys=sorted(result))
    return result


# This Cursor author source pass is itself 1 model launch (no nested AGY/Codex
# inference in-process). READY/qualification remain unproven until independent
# acceptance after real operation — never manually READY / old #29 grant replay.
AUTHOR_PASS_CLAIMS = {
    'agy_qa_ready': False,
    'agy_author_ready': False,
    'mode_b_active': False,
    'cursor_author_launches': 1,
    'nested_agy_codex_model_calls': 0,
    'model_calls': 1,
    'note': (
        'OD018 Mode B AGY author source path: OD014A install + live binding + '
        'selection present; NativeAuthor CANARY/READY absent until parent real '
        'product386 qual + CodexQA/CI/DEV acceptance; no fake Runtime READY; '
        'no paid AGY author calls by this Cursor pass'
    ),
}
