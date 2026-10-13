"""Bounded Clean publication adapter. Installed service only; never an executor.

Three fixed bundle/request slots, no shell or receipt-selected command/path.
Root config pins installed modules, submitter identity, baseline and scopes.
Main retains publication_guard's Owner/QA/CAS checks; no V3 activation.
An ambiguous interrupted push is observed, never repeated automatically.
"""
from __future__ import annotations

import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path('/srv/gobadminton-clean/runner')
CODE_LINK = Path('/opt/gobadminton-clean/runner-code/current')
CONFIG = Path('/etc/gobadminton-clean-control-plane/clean-publisher-policy.json')
STORE = Path('/var/lib/gobadminton-clean-publisher')
REPO = STORE / 'repo'
SPOOL = ROOT / 'publisher-spool'
REMOTE = 'git@github.com:anpavel84-afk/gobadminton-clean.git'
SLOTS = {
    'friends-dev-s1-api-20261013-v001': 'feature/friends-s1-clean-source-20261013',
    'radar-dev-map-ui-20261013-v001': 'feature/radar-dev-real-map-20261013',
    'friends-dev-s1-api-20261013-v002': 'feature/friends-s1-clean-source-20261013',
    'radar-dev-map-ui-20261013-v002': 'feature/radar-dev-real-map-20261013',
    'main-pm': 'main',
}
OWNER_PRODUCERS = {
    'friends-dev-s1-api-20261013-v001': 'friends-dev-s1-api-20261013-v001',
    'radar-dev-map-ui-20261013-v001': 'radar-dev-map-ui-20261013-v001',
    'friends-dev-s1-api-20261013-v002': 'friends-dev-s1-api-20261013-v001',
    'radar-dev-map-ui-20261013-v002': 'radar-dev-map-ui-20261013-v001',
}
PREPARED_BASES = {
    'friends-dev-s1-api-20261013-v001': 'f98b1ed42e3f3847ac305e487cf3a706d6a458f2',
    'radar-dev-map-ui-20261013-v001': 'ed1ad372751b25f1d4bddae1f13e1b3876ef5bec',
}
WORKTREES = {slot: Path('/srv/gobadminton-clean/worktrees') /
             ('pm-autopilot' if slot == 'main-pm' else 'runner-' + slot) for slot in SLOTS}
MODULES = {'clean_publisher.py', 'github_owner_issue_intake.py', 'runner.py',
           'backlog_sync.py', 'writer_bridge.py', 'publication_guard.py',
           'test_job_contract.py', 'legacy_qa.py', 'queue_recovery.py', 'clean_runtime_access.py'}
SHA = re.compile(r'[0-9a-f]{40}')
DIGEST = re.compile(r'[0-9a-f]{64}')
_POLICY_BYTES = None
_RUNTIME_GID = None


class Hold(RuntimeError):
    pass


def owner_producer(slot):
    if slot not in OWNER_PRODUCERS:
        raise Hold('unknown bounded Owner producer identity')
    return OWNER_PRODUCERS[slot]


def validate_slots(config):
    if set(config['task_baseline']) != set(SLOTS) or set(config['task_scopes']) != set(SLOTS):
        raise Hold('all five fixed task bindings required')
    for slot, original in OWNER_PRODUCERS.items():
        if config['task_baseline'][slot] != PREPARED_BASES[original]:
            raise Hold('prepared Friends/Radar source base changed')
    for successor in ('friends-dev-s1-api-20261013-v002', 'radar-dev-map-ui-20261013-v002'):
        original = owner_producer(successor)
        if (config['task_baseline'][successor] != config['task_baseline'][original]
                or config['task_scopes'][successor] != config['task_scopes'][original]
                or SLOTS[successor] != SLOTS[original]):
            raise Hold('second attempt changed original bounded branch/base/scope')


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def strict(raw: bytes) -> dict:
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise Hold('duplicate JSON key')
            value[key] = item
        return value
    try:
        result = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as exc:
        raise Hold('invalid JSON') from exc
    if not isinstance(result, dict):
        raise Hold('JSON object required')
    return result


def secure_read(path: Path, owner: int, limit: int = 262144) -> bytes:
    """Walk every component without links; stable regular single-link snapshot."""
    if not path.is_absolute() or '..' in path.parts:
        raise Hold('absolute fixed path required')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    fd = -1
    try:
        for part in path.parts[1:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            info = os.fstat(nxt)
            if owner == 0 and (info.st_uid != 0 or info.st_mode & 0o022):
                os.close(nxt)
                raise Hold('root authority directory is writable/untrusted')
            os.close(parent)
            parent = nxt
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                or before.st_uid != owner or before.st_mode & 0o022
                or not 0 < before.st_size <= limit):
            raise Hold('file owner/type/mode/size refused')
        raw = bytearray()
        while len(raw) <= limit:
            piece = os.read(fd, min(65536, limit + 1 - len(raw)))
            if not piece:
                break
            raw.extend(piece)
        after = os.fstat(fd)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        final = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        if identity(before) != identity(after) or identity(before) != identity(final) or len(raw) != before.st_size:
            raise Hold('file changed during read')
        return bytes(raw)
    except OSError as exc:
        raise Hold('secure file unavailable') from exc
    finally:
        if fd >= 0:
            os.close(fd)
        os.close(parent)


def validate_request(slot: str, value: dict) -> None:
    if slot not in SLOTS or set(value) != {'schema', 'task_id', 'candidate_sha',
                                         'candidate_tree', 'expected_remote_sha', 'bundle_sha256'}:
        raise Hold('unknown slot or request field')
    if value['schema'] != 'GBCLEAN_PUBLISH_V1' or value['task_id'] != slot:
        raise Hold('request identity mismatch')
    for field in ('candidate_sha', 'candidate_tree'):
        if not isinstance(value[field], str) or not SHA.fullmatch(value[field]) or value[field] == '0' * 40:
            raise Hold('invalid candidate SHA/tree')
    old = value['expected_remote_sha']
    if not isinstance(old, str) or not SHA.fullmatch(old):
        raise Hold('invalid expected remote SHA')
    if not isinstance(value['bundle_sha256'], str) or not DIGEST.fullmatch(value['bundle_sha256']):
        raise Hold('invalid bundle digest')


def check_paths(paths: list[str], scopes: list[str]) -> None:
    if not scopes:
        raise Hold('empty trusted scope')
    for scope in scopes:
        if (not isinstance(scope, str) or not scope or scope.startswith('/')
                or '\\' in scope or any(p in {'', '.', '..'} for p in scope.rstrip('/').split('/'))):
            raise Hold('invalid trusted scope')
    if any(not any(p == s.rstrip('/') or p.startswith(s.rstrip('/') + '/')
                   for s in scopes) for p in paths):
        raise Hold('candidate changed paths outside exact task scope')


def trusted_modules(config: dict):
    pins = config.get('module_sha256')
    if not isinstance(pins, dict) or set(pins) != MODULES:
        raise Hold('all installed Clean module pins required')
    link_metadata = CODE_LINK.lstat()
    if link_metadata.st_uid != 0 or not CODE_LINK.is_symlink():
        raise Hold('root installed current source link required')
    code = CODE_LINK.resolve(strict=True)
    if not code.is_relative_to(CODE_LINK.parent) or code == CODE_LINK.parent:
        raise Hold('installed source escaped version directory')
    for directory in [code, *code.parents]:
        metadata = directory.lstat()
        if directory.is_symlink() or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            raise Hold('installed source ancestry is writable/untrusted')
    for name, pin in pins.items():
        if not DIGEST.fullmatch(str(pin)) or digest(secure_read(code / name, 0, 2097152)) != pin:
            raise Hold('installed source pin changed')
    # Never import from executor cwd/PYTHONPATH. Only prevalidated fixed source.
    sys.path[:] = [str(code)] + [p for p in sys.path if p and p != str(Path.cwd()) and p != str(code)]
    for name in ('writer_bridge', 'backlog_sync', 'runner', 'publication_guard', 'github_owner_issue_intake'):
        old = sys.modules.get(name)
        if old is not None and Path(old.__file__) != code / (name + '.py'):
            raise Hold('untrusted previously imported module')
    intake = importlib.import_module('github_owner_issue_intake')
    guard = importlib.import_module('publication_guard')
    original_root = guard.runner.ROOT
    if original_root not in {code, ROOT}:
        raise Hold('unexpected installed runner source root')
    # Root-installed executable source and service-owned state are distinct.
    # Rebase only its own declared local Path constants, never task-selected paths.
    for name, value in list(vars(guard.runner).items()):
        if isinstance(value, Path) and value.is_relative_to(original_root):
            setattr(guard.runner, name, ROOT / value.relative_to(original_root))
    if guard.runner.ROOT != ROOT or guard.runner.BACKLOG_PATH != ROOT / 'backlog.json':
        raise Hold('runner binding differs from fixed Clean runtime')
    # Imported validation helpers must never select the executor checkout from
    # mutable runtime config while holding the Publisher credential.
    guard.runner._v2_evidence_repo = lambda: REPO
    guard.backlog_sync.run_git = run_git
    return intake, guard


def git_environment(config: dict) -> dict[str, str]:
    if any(key in config for key in ('ssh_identity', 'ssh_known_hosts', 'credential_path', 'ssh_command')):
        raise Hold('credential path/command overrides refused; fixed Clean credentials required')
    if type(config.get('publisher_uid')) is not int or os.geteuid() != config['publisher_uid'] or os.geteuid() == 0:
        raise Hold('exclusive nonroot publisher identity required')
    import pwd
    if os.geteuid() != pwd.getpwnam('gobadminton-v3-publisher').pw_uid:
        raise Hold('existing exclusive writer principal required')
    keys = Path('/etc/gobadminton-clean-control-plane/credentials')
    identity, hosts = keys / 'github-publisher-identity', keys / 'github-known-hosts'
    secure_read(identity, 0, 16384)
    secure_read(hosts, 0, 65536)
    command = ['/usr/bin/ssh', '-F', '/dev/null', '-i', str(identity), '-o', 'IdentitiesOnly=yes',
               '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
               '-o', 'UserKnownHostsFile=' + str(hosts), '-o', 'PasswordAuthentication=no']
    values = [('core.hooksPath', '/dev/null'), ('credential.helper', ''),
              ('core.sshCommand', shlex.join(command)), ('protocol.ext.allow', 'never'),
              ('protocol.file.allow', 'never'), ('core.fsmonitor', 'false'),
              ('core.useReplaceRefs', 'false'), ('remote.origin.url', REMOTE),
              ('remote.origin.pushurl', REMOTE)]
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
           'GIT_ASKPASS': '/bin/false', 'GIT_NO_REPLACE_OBJECTS': '1',
           'GIT_CONFIG_COUNT': str(len(values))}
    for n, (key, value) in enumerate(values):
        env[f'GIT_CONFIG_KEY_{n}'] = key
        env[f'GIT_CONFIG_VALUE_{n}'] = value
    return env


def run_git(repo: Path, args: list[str], timeout: int = 120) -> str:
    if repo != REPO:
        raise Hold('publisher checkout path not fixed')
    result = subprocess.run(['/usr/bin/git', '-C', str(repo), *args], capture_output=True,
                            text=True, timeout=timeout, env=dict(os.environ))
    if result.returncode:
        raise Hold('Git operation refused: ' + args[0])
    return result.stdout.strip()


def remote_head(branch: str) -> str:
    rows = run_git(REPO, ['ls-remote', '--refs', REMOTE, 'refs/heads/' + branch]).splitlines()
    if not rows:
        return '0' * 40
    if len(rows) != 1 or rows[0].split()[-1] != 'refs/heads/' + branch:
        raise Hold('ambiguous remote branch')
    sha = rows[0].split()[0]
    if not SHA.fullmatch(sha):
        raise Hold('invalid remote head')
    return sha


def verify_source_worktree(slot: str, request: dict, submitter: int):
    """No credentialed process is launched inside executor-controlled Git config."""
    source = WORKTREES[slot]
    if source.is_symlink() or not source.is_dir():
        raise Hold('exact task worktree missing/linked')
    link = secure_read(source / '.git', submitter, 4096).decode().strip()
    expected = Path('/srv/gobadminton-clean/repo/.git/worktrees') / source.name
    if link != 'gitdir: ' + str(expected):
        raise Hold('task Git metadata outside fixed canonical worktree')
    canonical_git = Path('/srv/gobadminton-clean/repo/.git')
    for directory in (canonical_git, canonical_git / 'worktrees', expected,
                      canonical_git / 'objects'):
        metadata = directory.lstat()
        if directory.is_symlink() or not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != submitter:
            raise Hold('source canonical Git/object directory redirected')
    if secure_read(expected / 'commondir', submitter, 4096).decode().strip() != '../..':
        raise Hold('source Git common object store redirected')
    for location in (canonical_git / 'objects/info/alternates', expected / 'objects/info/alternates'):
        if location.exists() or location.is_symlink():
            raise Hold('source Git object alternates forbidden')
    values = [('core.hooksPath', '/dev/null'), ('core.fsmonitor', 'false'),
              ('credential.helper', ''), ('safe.directory', str(source)),
              ('core.sshCommand', '/bin/false'), ('protocol.ext.allow', 'never'),
              ('protocol.file.allow', 'never'), ('core.useReplaceRefs', 'false'),
              ('maintenance.auto', 'false'), ('gc.auto', '0')]
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
           'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_TERMINAL_PROMPT': '0',
           'GIT_CONFIG_COUNT': str(len(values)), 'GIT_NO_REPLACE_OBJECTS': '1',
           'GIT_ASKPASS': '/bin/false'}
    for number, (key, value) in enumerate(values):
        env[f'GIT_CONFIG_KEY_{number}'] = key
        env[f'GIT_CONFIG_VALUE_{number}'] = value
    def read(args):
        result = subprocess.run(['/usr/bin/git', '--no-optional-locks', '-C', str(source), *args],
                                env=env, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise Hold('source worktree verification failed')
        return result.stdout.strip()
    if (read(['rev-parse', 'HEAD']) != request['candidate_sha']
            or read(['rev-parse', 'HEAD^{tree}']) != request['candidate_tree']
            or read(['status', '--porcelain', '--untracked-files=no'])):
        raise Hold('source worktree SHA/tree/clean snapshot mismatch')


def assert_replay(previous: dict, request_digest: str, head: str, candidate: str) -> bool:
    if previous.get('request_sha256') != request_digest:
        raise Hold('slot request changed after attempt; explicit trusted reset required')
    if previous.get('status') in {'PUBLISHED', 'OBSERVED_EXISTING'} and head == candidate:
        return True
    raise Hold('interrupted/changed publication requires independent reconciliation; no retry')


def previous_action(previous: dict, request_digest: str, head: str, candidate: str) -> str:
    if previous.get('request_sha256') == request_digest:
        assert_replay(previous, request_digest, head, candidate)
        return 'REPLAY'
    if (previous.get('status') not in {'PUBLISHED', 'OBSERVED_EXISTING'}
            or previous.get('candidate_sha') != head):
        raise Hold('different request cannot replace interrupted/diverged publication')
    return 'ADVANCE'


def archive_record(raw: bytes):
    directory = STORE / 'history'
    metadata = directory.lstat()
    if (directory.is_symlink() or not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != os.geteuid() or metadata.st_gid != _RUNTIME_GID
            or stat.S_IMODE(metadata.st_mode) not in {0o750, 0o2750}):
        raise Hold('private-writer/read-only-group history directory required')
    target = directory / (digest(raw) + '.json')
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
    except FileExistsError:
        if secure_read(target, os.geteuid()) != raw:
            raise Hold('immutable historical receipt changed')
        return
    with os.fdopen(fd, 'wb') as stream:
        os.fchown(stream.fileno(), -1, _RUNTIME_GID)
        os.fchmod(stream.fileno(), 0o640)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_record(path: Path, value: dict):
    raw = (json.dumps(value, sort_keys=True) + '\n').encode()
    with tempfile.NamedTemporaryFile(dir=STORE, delete=False) as stream:
        temporary = Path(stream.name)
        os.fchown(stream.fileno(), -1, _RUNTIME_GID)
        os.fchmod(stream.fileno(), 0o640)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fd = os.open(STORE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def clear_blocked(slot: str, request_digest: str):
    path = STORE / (slot + '.blocked.json')
    if not path.exists():
        if path.is_symlink():
            raise Hold('blocked receipt symlink refused')
        return
    raw = secure_read(path, os.geteuid())
    if strict(raw).get('request_sha256') != request_digest:
        return
    archive_record(raw)
    if secure_read(path, os.geteuid()) != raw:
        raise Hold('blocked receipt changed before archive')
    path.unlink()
    fd = os.open(STORE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def publish_slot(slot: str, config: dict, intake, guard):
    submitter = config['submitter_uid']
    request_path = SPOOL / (slot + '.json')
    if not request_path.exists():
        if request_path.is_symlink():
            raise Hold('request symlink refused')
        return
    raw = secure_read(request_path, submitter)
    request = strict(raw)
    validate_request(slot, request)
    fingerprint = digest(raw)
    branch = SLOTS[slot]
    record_path = STORE / (slot + '.receipt.json')
    head = remote_head(branch)
    previous = previous_raw = None
    if record_path.exists():
        previous_raw = secure_read(record_path, os.geteuid())
        previous = strict(previous_raw)
        if previous_action(previous, fingerprint, head, request['candidate_sha']) == 'REPLAY':
            clear_blocked(slot, fingerprint)
            return
    if head != request['expected_remote_sha']:
        raise Hold('STALE_REMOTE; no transport attempted')
    bundle_path = SPOOL / (slot + '.bundle')
    bundle = secure_read(bundle_path, submitter, 128 * 1024 * 1024)
    if digest(bundle) != request['bundle_sha256']:
        raise Hold('bundle digest mismatch')
    with tempfile.NamedTemporaryFile(dir=STORE, suffix='.bundle') as snapshot:
        snapshot.write(bundle)
        snapshot.flush()
        # File transport remains disabled for remote Git; this fixed local bundle
        # import reads the securely captured bytes, with no remote helpers/hooks.
        run_git(REPO, ['bundle', 'verify', snapshot.name])
        run_git(REPO, ['-c', 'protocol.file.allow=always', 'fetch', '--no-tags', snapshot.name,
                       request['candidate_sha']])
    candidate = run_git(REPO, ['rev-parse', request['candidate_sha'] + '^{commit}'])
    tree = run_git(REPO, ['rev-parse', candidate + '^{tree}'])
    if candidate != request['candidate_sha'] or tree != request['candidate_tree']:
        raise Hold('actual candidate SHA/tree mismatch')
    verify_source_worktree(slot, request, submitter)
    base = config['task_baseline'][slot]
    if not SHA.fullmatch(str(base)):
        raise Hold('trusted task baseline missing')
    run_git(REPO, ['merge-base', '--is-ancestor', base, candidate])
    if previous is not None:
        run_git(REPO, ['merge-base', '--is-ancestor', previous['candidate_sha'], candidate])
    if head != '0' * 40:
        run_git(REPO, ['fetch', '--no-tags', REMOTE, head])
        run_git(REPO, ['merge-base', '--is-ancestor', head, candidate])
    paths = run_git(REPO, ['diff', '--name-only', base, candidate]).splitlines()
    check_paths(paths, config['task_scopes'][slot])
    canonical = strict(secure_read(ROOT / 'backlog.json', submitter))
    url = intake.COMMENT_URL + str(intake.OWNER_BOOTSTRAP_COMMENT)
    req = urllib.request.Request(url, headers={'User-Agent': 'GoBadminton-Clean-Publisher/1'})
    with urllib.request.urlopen(req, timeout=12) as response:
        if response.geturl() != url:
            raise Hold('Owner proof redirected')
        event = strict(response.read(262145))
    owner = intake.checked_comment(event, canonical, require_queued=False)
    if owner is None or owner['github_comment_id'] != 6148670164:
        raise Hold('exact Owner event absent')
    if slot != 'main-pm' and owner_producer(slot) not in owner['task_ids']:
        raise Hold('task outside exact Owner event')
    receipt = context = None
    if slot == 'main-pm':
        receipt_path = ROOT / 'autopilot-receipt.json'
        context_path = ROOT / 'planner-publication-hooks/context.json'
        receipt_raw = secure_read(receipt_path, submitter)
        context_raw = secure_read(context_path, submitter)
        receipt, context = strict(receipt_raw), strict(context_raw)
        if receipt.get('result_commit') != candidate or context.get('baseline') != head:
            raise Hold('planner receipt/context SHA mismatch')
        if receipt.get('action') in {'merged', 'merged_and_enqueued'}:
            qa_id = receipt.get('accepted_qa_task_id')
            if qa_id not in {'qa-' + tid for tid in SLOTS if tid != 'main-pm'}:
                raise Hold('unknown independent QA identity')
            qa_path = ROOT / 'receipts' / (qa_id + '.json')
            qa = strict(secure_read(qa_path, submitter))
            if (qa.get('task_id') != qa_id or qa.get('candidate_sha') != receipt.get('merged_candidate_sha')
                    or qa.get('verdict') != 'PASS' or qa.get('blocking_findings') != []
                    or qa.get('acceptance_state') != 'SOURCE_ACCEPTED'
                    or not DIGEST.fullmatch(str(qa.get('trusted_job', '')))):
                raise Hold('independent QA proof absent/mismatched')
            task = next((t for t in canonical['tasks'] if t['id'] == qa_id), {})
            if task.get('receipt', str(qa_path)) != str(qa_path) or 'receipt_path' in task:
                raise Hold('canonical QA receipt redirects protected proof')
            contract = importlib.import_module('test_job_contract')
            protected_root = guard.runner.SOURCE_REVIEW_QA_ROOT
            contract.verify_runner_receipt(qa, protected_root)
            protected_record = contract.protected_json(protected_root / (qa['trusted_job'] + '.json'))
            protected_policy = contract.protected_json(protected_root / 'policy.json')
            identity = {'schema_version': 1, 'qa_task_id': qa_id,
                        'producer_task_id': qa.get('producer_task_id'),
                        'candidate_sha': qa.get('candidate_sha'), 'candidate_tree': qa.get('candidate_tree'),
                        'branch': qa.get('branch'), 'suite_id': task.get('source_qa', {}).get('suite_id')}
            if (identity['producer_task_id'] != qa_id.removeprefix('qa-')
                    or identity['branch'] != SLOTS[identity['producer_task_id']]
                    or protected_record['job']['source_tree'] != identity['candidate_tree']
                    or protected_record['job']['suite_id'] != identity['suite_id']
                    or protected_policy.get('source_qa_authorizations', {}).get(qa['trusted_job'])
                        != contract.digest(identity)):
                raise Hold('protected QA job identity not authorized')
            producer_branch = SLOTS[identity['producer_task_id']]
            observed_source = remote_head(producer_branch)
            run_git(REPO, ['fetch', '--no-tags', REMOTE,
                          'refs/heads/' + producer_branch + ':refs/remotes/origin/' + producer_branch])
            if (run_git(REPO, ['rev-parse', 'refs/remotes/origin/' + producer_branch]) != observed_source
                    or remote_head(producer_branch) != observed_source):
                raise Hold('source branch changed during protected QA verification')
            run_git(REPO, ['merge-base', '--is-ancestor', identity['candidate_sha'], observed_source])
        if secure_read(receipt_path, submitter) != receipt_raw or secure_read(context_path, submitter) != context_raw:
            raise Hold('planner evidence changed')
    if secure_read(request_path, submitter) != raw or secure_read(bundle_path, submitter, 128 * 1024 * 1024) != bundle:
        raise Hold('spool changed before publication')
    trusted_modules(config)  # pin recheck at final boundary
    verify_source_worktree(slot, request, submitter)
    if _POLICY_BYTES is None or secure_read(CONFIG, 0) != _POLICY_BYTES:
        raise Hold('root service policy changed')
    record = {'schema': 'GBCLEAN_PUBLISH_RECEIPT_V1', 'task_id': slot,
              'candidate_sha': candidate, 'candidate_tree': tree,
              'request_sha256': fingerprint, 'expected_remote_sha': head,
              'branch': branch, 'status': 'ATTEMPTING', 'real_publication': False}
    if previous_raw is not None:
        if secure_read(record_path, os.geteuid()) != previous_raw:
            raise Hold('latest receipt changed before archive')
        archive_record(previous_raw)
        record['previous_receipt_sha256'] = digest(previous_raw)
    if head == candidate:
        if slot == 'main-pm':
            raise Hold('main already contains result; independent reconciliation required')
        write_record(record_path, {**record, 'status': 'OBSERVED_EXISTING', 'real_publication': False})
        clear_blocked(slot, fingerprint)
        return
    write_record(record_path, record)  # ambiguous restart never retries transport
    if slot == 'main-pm':
        guard.backlog_sync.run_git = run_git
        guard.publish_main(REPO, ROOT, context, receipt)
    else:
        with guard.writer_bridge.bridge_section():
            pass  # Local policy/lease validation only; never hold lease over I/O.
        if remote_head(branch) != head:
            raise Hold('STALE_REMOTE before transport')
        run_git(REPO, ['push', '--atomic', '--force-with-lease=refs/heads/' + branch + ':' + head,
                      REMOTE, candidate + ':refs/heads/' + branch])
    if remote_head(branch) != candidate:
        raise Hold('published SHA not independently observed; reconciliation required')
    write_record(record_path, {**record, 'status': 'PUBLISHED', 'real_publication': True})
    clear_blocked(slot, fingerprint)


def main():
    global _POLICY_BYTES, _RUNTIME_GID
    if len(sys.argv) != 1:
        raise Hold('no command-line overrides')
    if not sys.flags.isolated:
        raise Hold('service must invoke python3 -I; no user import paths')
    _POLICY_BYTES = secure_read(CONFIG, 0)
    config = strict(_POLICY_BYTES)
    if set(config) != {'schema', 'publisher_uid', 'submitter_uid', 'runtime_gid', 'owner_event', 'module_sha256', 'task_baseline', 'task_scopes'} or config['schema'] != 'GBCLEAN_PUBLISH_POLICY_V1':
        raise Hold('exact root service policy required')
    if type(config['submitter_uid']) is not int or config['submitter_uid'] in {0, config['publisher_uid']}:
        raise Hold('submitter/publisher separation required')
    validate_slots(config)
    if type(config.get('runtime_gid')) is not int or config['runtime_gid'] <= 0:
        raise Hold('positive typed runtime group required')
    _RUNTIME_GID = config['runtime_gid']
    metadata = STORE.lstat()
    if (STORE.is_symlink() or not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid()
            or metadata.st_gid != _RUNTIME_GID or stat.S_IMODE(metadata.st_mode) not in {0o750, 0o2750}):
        raise Hold('publisher store must be writer-private and control-group-readable')
    metadata = REPO.lstat()
    if REPO.is_symlink() or not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise Hold('publisher checkout must remain publisher-only0700')
    git_config = secure_read(REPO / '.git/config', os.geteuid())
    expected = b'[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n'
    if git_config != expected:
        raise Hold('publisher Git config must be pristine git init; no executor repository config')
    if (REPO / '.git/objects/info/alternates').exists() or (REPO / '.git').is_symlink():
        raise Hold('publisher object/config isolation required')
    env = git_environment(config)
    os.environ.clear()
    os.environ.update(env)
    intake, guard = trusted_modules(config)
    access = importlib.import_module('clean_runtime_access')
    access.validate_authority(config)
    if not access.directory_allowed(ROOT, config['submitter_uid']):
        raise Hold('fixed runtime owner/group/mode refused')
    lock = STORE / 'publication.lock'
    fd = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        metadata = os.fstat(fd)
        if (metadata.st_uid != os.geteuid() or not stat.S_ISREG(metadata.st_mode)
                or metadata.st_nlink != 1 or metadata.st_mode & 0o077):
            raise Hold('publisher lock identity refused')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for slot in SLOTS:
            try:
                publish_slot(slot, config, intake, guard)
            except Exception as error:
                # Separate latest HOLD evidence never destroys a successful or
                # ATTEMPTING receipt. Waiter binds it to its own request digest.
                try:
                    fingerprint = digest(secure_read(SPOOL / (slot + '.json'), config['submitter_uid']))
                except Exception:
                    fingerprint = None
                write_record(STORE / (slot + '.blocked.json'), {
                    'schema': 'GBCLEAN_PUBLISH_RECEIPT_V1', 'task_id': slot,
                    'status': 'BLOCKED', 'request_sha256': fingerprint,
                    'real_publication': False,
                    'reason': str(error) if isinstance(error, Hold) else type(error).__name__})
                raise
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never expose Git stderr, credentials, request bodies or environment.
        print('CLEAN_PUBLISHER_HOLD:' + (str(error) if isinstance(error, Hold) else type(error).__name__), file=sys.stderr)
        raise SystemExit(2)
