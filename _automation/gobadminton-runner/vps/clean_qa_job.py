#!/usr/bin/env python3
"""Fixed, separately privileged Clean source-QA adapter. No task-supplied commands.

Install root-owned outside runner checkout. Invoke with one canonical QA task ID.
Missing administrator policy, sandbox or reviewer credentials is BLOCKED, never PASS.
This adapter attests SOURCE only; a DEV release still needs actual runtime smoke.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import signal
import subprocess
import stat
import sys
import tarfile
import tempfile
import time
import uuid

def code_module(name, code=None):
    """Isolated Python imports only sibling immutable administrator code."""
    import types
    base = (code or Path(__file__).resolve().parent).resolve()
    strict = sys.flags.isolated or __name__ == '__main__' or base.is_relative_to(Path('/opt/gobadminton-clean/runner-code'))
    path = base / (name + '.py')
    if name not in {'test_job_contract', 'clean_runtime_access'}:
        raise ValueError('unregistered trusted code module')
    if strict:
        if (base.parent != Path('/opt/gobadminton-clean/runner-code')
                or not re.fullmatch('[0-9a-f]{40}', base.name)):
            raise ValueError('immutable accepted SHA code directory required')
        for item in [path, *path.parents]:
            info = item.lstat()
            if item.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
                raise ValueError('untrusted immutable code chain')
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise ValueError('regular single-link code required')
    module = types.ModuleType(name); module.__file__ = str(path)
    # Explicit source compilation avoids sys.path, PYTHONPATH and cached bytecode.
    exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
    return module


contract = code_module('test_job_contract')
access = code_module('clean_runtime_access')

RUNNER = Path('/srv/gobadminton-clean/runner')
PUBLISHER_STORE = Path('/var/lib/gobadminton-clean-publisher')
PUBLISHER_POLICY = Path('/etc/gobadminton-clean-control-plane/clean-publisher-policy.json')
REPO = PUBLISHER_STORE / 'repo'
EVIDENCE = Path('/var/lib/gobadminton-clean-trusted-qa-evidence')
INSTALL = Path('/opt/gobadminton-clean-qa')
DEPENDENCIES = INSTALL / 'dependencies'
NODE = INSTALL / 'node/bin/node'
PNPM = INSTALL / 'pnpm/pnpm.cjs'
CODEX = INSTALL / 'bin/codex'
AUTH = Path('/var/lib/gobadminton-clean-qa-reviewer')
IMAGE = 'postgis/postgis:18-3.6'
SUITES = {
    'qa-friends-dev-s1-api-20261013-v001': ('friends-dev-s1-api-20261013-v001', 'friends-s1-germany-dev-privacy-v001', 'api'),
    'qa-radar-dev-map-ui-20261013-v001': ('radar-dev-map-ui-20261013-v001', 'radar-map-germany-dev-privacy-v001', 'web'),
}
BRANCHES = {'api': 'feature/friends-s1-clean-source-20261013', 'web': 'feature/radar-dev-real-map-20261013'}
MODELS = {'api': 'gpt-6.1-sol', 'web': 'gpt-6-astra'}
TRUSTED_ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8',
               'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
               'GIT_CONFIG_SYSTEM': '/dev/null', 'GIT_NO_REPLACE_OBJECTS': '1'}


def git_command(repo):
    # No inherited global configuration, hooks, helpers or substituted objects.
    return ['/usr/bin/git', '-c', 'safe.directory=' + str(repo), '-c', 'core.hooksPath=/dev/null',
            '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', '-c', 'core.useReplaceRefs=false',
            '-C', str(repo)]


def verify_git_metadata(repo):
    metadata = repo / '.git'
    if metadata.is_symlink() or not metadata.is_dir():
        raise ValueError('dedicated Publisher Git metadata directory required')
    if any(path.is_symlink() for path in metadata.rglob('*')):
        raise ValueError('Git metadata symlink refused')
    for name in ('objects/info/alternates', 'objects/info/http-alternates', 'refs/replace'):
        if os.path.lexists(metadata / name):
            raise ValueError('Git alternate/replaced object metadata refused')
    packed = metadata / 'packed-refs'
    if packed.is_symlink() or (packed.exists() and b'refs/replace/' in packed.read_bytes()):
        raise ValueError('packed Git replacement refs refused')


def protected(path: Path, directory=False):
    """Every protected ancestor must be root-owned and not replaceable."""
    for item in [path, *path.parents]:
        st = item.lstat()
        if item.is_symlink() or st.st_uid != 0 or st.st_mode & 0o022:
            raise ValueError('unprotected path: ' + str(item))
    if directory and not path.is_dir():
        raise ValueError('directory required')


def regular_json(path: Path):
    # Queue is a runner-owned input, never authority. Do not follow redirect links.
    if (any(p.is_symlink() for p in [path, *path.parents])
            or not path.is_file() or path.stat().st_size > 8_000_000):
        raise ValueError('unsafe canonical input')
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('duplicate canonical input field')
            value[key] = item
        return value
    return json.loads(path.read_bytes(), object_pairs_hook=unique)


def bind(qa_id, queue, producer_receipt):
    if qa_id not in SUITES:
        raise ValueError('unregistered QA task')
    producer_id, suite_id, app = SUITES[qa_id]
    tasks = {t['id']: t for t in queue['tasks']}
    if len(tasks) != len(queue['tasks']):
        raise ValueError('duplicate canonical task identity')
    qa, producer = tasks[qa_id], tasks[producer_id]
    if (qa.get('source_qa') != {'producer_task_id': producer_id, 'suite_id': suite_id}
            or qa.get('enabled') is not True or producer.get('enabled') is not True
            or qa.get('depends_on_completed') != [producer_id]
            or qa.get('depends_on_accepted', []) != []
            or qa.get('effect_ceiling') != 'source_only'
            or qa.get('receipt') not in (None, str(RUNNER / 'receipts' / (qa_id + '.json')))
            or producer_receipt.get('project') != 'GoBadminton'
            or producer_receipt.get('task_id') != producer_id
            or producer_receipt.get('ok') is not True):
        raise ValueError('canonical producer/QA binding refused')
    sha, tree, branch = (producer_receipt[k] for k in ('candidate_sha', 'candidate_tree', 'branch'))
    contract.sha(sha, 40); contract.sha(tree, 40)
    if branch != BRANCHES[app]:
        raise ValueError('unsafe source branch')
    return {'schema_version': 1, 'qa_task_id': qa_id, 'producer_task_id': producer_id,
            'candidate_sha': sha, 'candidate_tree': tree, 'branch': branch, 'suite_id': suite_id}, app


def active_attempt(qa_id, state, *, waiter_pid=None):
    claim = state.get('active', {}).get(qa_id)
    if (not isinstance(claim, dict) or type(claim.get('attempt')) is not int or claim['attempt'] <= 0
            or type(claim.get('agent_pid')) is not int or claim['agent_pid'] <= 1
            or waiter_pid is not None and claim['agent_pid'] != waiter_pid):
        raise ValueError('actual active QA wait claim required')
    return {'attempt': claim['attempt'], 'waiter_pid': claim['agent_pid'], 'started_at': claim.get('started_at')}


def validate_publication(identity, record):
    if (record.get('schema') != 'GBCLEAN_PUBLISH_RECEIPT_V1' or record.get('status') != 'PUBLISHED'
            or record.get('real_publication') is not True
            or record.get('task_id') != identity['producer_task_id']
            or any(record.get(key) != identity[key] for key in ('candidate_sha', 'candidate_tree', 'branch'))):
        raise ValueError('protected real publication differs from candidate')
    return record


def publication_binding(identity):
    """Use protected independent Publisher observation, never submitter claims."""
    authority = access.policy()
    path = PUBLISHER_STORE / (identity['producer_task_id'] + '.receipt.json')
    for parent in [PUBLISHER_STORE, *PUBLISHER_STORE.parents]:
        info = parent.lstat()
        if parent.is_symlink() or info.st_uid not in {0, authority['publisher_uid']} or info.st_mode & 0o022:
            raise ValueError('unprotected Publisher proof store')
    info = path.lstat()
    if (path.is_symlink() or info.st_uid != authority['publisher_uid'] or info.st_mode & 0o022
            or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1):
        raise ValueError('Publisher principal proof required')
    record = regular_json(path)
    return validate_publication(identity, record)


def verify_waiter(qa_id, claim):
    authority = access.policy()
    pid = claim['waiter_pid']
    uid_line = next(line for line in Path('/proc/' + str(pid) + '/status').read_text().splitlines() if line.startswith('Uid:'))
    if {int(uid) for uid in uid_line.split()[1:]} != {authority['submitter_uid']}:
        raise ValueError('QA waiter principal is not canonical Runner owner')
    command = Path('/proc/' + str(pid) + '/cmdline').read_bytes().rstrip(b'\0').split(b'\0')
    words = [word.decode() for word in command]
    if (len(words) != 5 or words[0] != '/usr/bin/python3' or words[1] != '-I'
            or Path(words[2]).resolve() != Path(__file__).resolve()
            or words[3:] != ['--wait', qa_id]):
        raise ValueError('QA claim PID is not immutable isolated waiter')


def run(command, *, env=None, timeout=1800, cwd=None, on_start=None):
    """Bounded process group: timed-out descendants cannot escape cleanup."""
    p = subprocess.Popen(command, cwd=cwd, env={**(env or TRUSTED_ENV), **{k: v for k, v in TRUSTED_ENV.items() if k.startswith('GIT_')}},
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        if on_start:
            on_start(p.pid)
        data, _ = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(p.pid, signal.SIGKILL)
        data, _ = p.communicate()
        return 124, data + b'\nFIXED_JOB_TIMEOUT\n'
    except BaseException:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(p.pid, signal.SIGKILL)
        p.wait()
        raise
    try:
        os.killpg(p.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    return p.returncode, data


def checked(command, **kwargs):
    code, log = run(command, **kwargs)
    if code:
        raise RuntimeError('fixed operation failed: ' + str(command[0]) + ': ' + log[-2000:].decode(errors='replace'))
    return log


def file_sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def tree_sha(root):
    """Hash bytes and internal links, reject links escaping the fixed snapshot."""
    h = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root).as_posix().encode()
        if path.is_symlink():
            if not path.resolve().is_relative_to(root.resolve()):
                raise ValueError('dependency/source symlink escapes snapshot')
            data = os.readlink(path).encode()
            kind = b'L'
        elif path.is_file():
            data, kind = bytes.fromhex(file_sha(path)), b'F'
        elif path.is_dir():
            continue
        else:
            raise ValueError('special snapshot file')
        h.update(kind + len(rel).to_bytes(8, 'big') + rel + len(data).to_bytes(8, 'big') + data)
    return h.hexdigest()


def extract_archive(data, target):
    # Repository archive never gets to create a link/device or escape its directory.
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.is_absolute() or '..' in path.parts or '\\' in member.name or not (member.isdir() or member.isfile()):
                raise ValueError('unsafe source archive member')
            archive.extract(member, target, filter='data')


def sandbox(source, app, account, db_pid=None):
    import pwd
    user = pwd.getpwnam(account)
    if user.pw_uid == 0:
        raise ValueError('QA account must not be root')
    args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
            '/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-all']
    if db_pid is not None:
        if not isinstance(db_pid, int) or db_pid <= 1:
            raise ValueError('invalid disposable DB namespace')
        args = ['/usr/bin/nsenter', '--target', str(db_pid), '--net', '--'] + args + ['--share-net']
    for path in ('/usr', '/bin', '/lib', '/lib64'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    args += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home',
             '--dir', '/home/qa', '--ro-bind', str(INSTALL), '/qa-tools',
             '--ro-bind', str(source), '/source', '--ro-bind', str(DEPENDENCIES / app / 'node_modules'), '/source/node_modules']
    for part in ('apps/' + app, 'packages/contracts'):
        args += ['--ro-bind', str(DEPENDENCIES / app / part / 'node_modules'), '/source/' + part + '/node_modules']
    # Vite's config compiler/cache may write only disposable cache mounts.
    # Administrator creates these empty mountpoints in the dependency snapshot.
    for prefix in ('/source/node_modules', '/source/apps/' + app + '/node_modules'):
        for cache in ('.vite', '.vite-temp'):
            args += ['--tmpfs', prefix + '/' + cache]
    args += ['--chdir', '/source/apps/' + app, '--clearenv',
             '--setenv', 'PATH', '/qa-tools/node/bin:/usr/bin:/bin', '--setenv', 'HOME', '/home/qa',
             '--setenv', 'NODE_ENV', 'test', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'CI', '1']
    if db_pid is not None:
        args += ['--setenv', 'DATABASE_URL', 'postgresql://qa:disposable-only@127.0.0.1:5432/gobadminton_friends_s1_disposable',
                 '--setenv', 'RUN_DB_INTEGRATION', '1']
    return args + ['--']


def suite_commands(app):
    vitest = ['/qa-tools/node/bin/node', '/source/node_modules/vitest/vitest.mjs', 'run']
    tsc = ['/qa-tools/node/bin/node', '/source/node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit', '--incremental', 'false']
    if app == 'web':
        return [vitest + ['--reporter=json'],
                vitest + ['test/radar-privacy-regression.test.ts', 'test/radar-map-assets.test.ts', '--reporter=json'],
                tsc, ['/qa-tools/node/bin/node', '/source/node_modules/eslint/bin/eslint.js', '.']]
    if app != 'api':
        raise ValueError('unregistered app')
    return [vitest + ['--config', 'vitest.typescript.config.ts', 'test/unit/friendships.test.ts', 'test/integration/friends-s1.disposable.test.ts', '--reporter=json'], tsc]


def reviewer_command(app, prompt):
    if app not in MODELS:
        raise ValueError('unregistered reviewer suite')
    return ['/qa-tools/bin/codex', 'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
            '--disable', 'apps', '--disable', 'remote_plugin', '--disable', 'hooks', '--ignore-user-config',
            '-c', 'apps._default.enabled=false', '--model', MODELS[app],
            '-c', 'model_reasoning_effort="high"', '-C', '/source',
            '--output-last-message', '/output/result.json', prompt]


def count_json(log):
    # Read actual Vitest reporter stdout, never model claimed count.
    text = log.decode(errors='replace')
    decoder = json.JSONDecoder()
    for match in re.finditer(r'\{', text):
        try:
            data, _ = decoder.raw_decode(text[match.start():])
        except ValueError:
            continue
        if isinstance(data, dict) and 'numTotalTests' in data:
            count = data.get('numTotalTests')
            if (data.get('success') is True and type(count) is int and count > 0
                    and data.get('numFailedTests') == 0 and data.get('numPendingTests') == 0
                    and data.get('numPassedTests') == count):
                return count
            raise ValueError('failed, skipped or empty actual Vitest report')
    raise ValueError('missing actual Vitest JSON report')


@contextlib.contextmanager
def disposable_database():
    name = 'gobadminton-clean-qa-' + uuid.uuid4().hex
    # Cached image only, no host ports, mounts, volumes or non-disposable DB URLs.
    image_id = checked(['/usr/bin/docker', 'image', 'inspect', '--format', '{{.Id}}', IMAGE]).decode().strip()
    contract.sha(image_id.removeprefix('sha256:'))
    created = False
    try:
        created = True  # docker may create the named container before start fails.
        checked(['/usr/bin/docker', 'run', '--pull=never', '--detach', '--name', name, '--network', 'none',
                 '--memory', '768m', '--cpus', '1', '--pids-limit', '128', '--tmpfs', '/var/lib/postgresql:rw,size=512m',
                 '--env', 'POSTGRES_USER=qa', '--env', 'POSTGRES_PASSWORD=disposable-only',
                 '--env', 'POSTGRES_DB=gobadminton_friends_s1_disposable', IMAGE])
        for _ in range(30):
            code, _ = run(['/usr/bin/docker', 'exec', name, 'pg_isready', '-U', 'qa', '-d', 'gobadminton_friends_s1_disposable'], timeout=10)
            if not code:
                break
            time.sleep(1)
        else:
            raise RuntimeError('disposable PostGIS readiness blocked')
        info = json.loads(checked(['/usr/bin/docker', 'inspect', name]))[0]
        if (any(m.get('Type') != 'tmpfs' or m.get('Destination') != '/var/lib/postgresql' for m in info['Mounts'])
                or info['HostConfig']['NetworkMode'] != 'none'):
            raise ValueError('disposable database isolation violated')
        yield int(info['State']['Pid']), image_id
    finally:
        if created:
            checked(['/usr/bin/docker', 'rm', '--force', '--volumes', name], timeout=30)


def reviewer_result(raw, receipt, job_id):
    value = json.loads(raw)
    if (set(value) != {'job_id', 'receipt_sha', 'verdict', 'blocking_findings'}
            or value['job_id'] != job_id or value['receipt_sha'] != contract.digest(receipt)
            or value['verdict'] != 'PASS' or value['blocking_findings'] != []):
        raise ValueError('actual independent reviewer did not approve exact receipt')
    return value


def failure(job, log, outcome, exit_code):
    receipt = {'job_sha': contract.digest(job), 'exit_code': exit_code, 'test_count': 0,
               'log_sha': hashlib.sha256(log).hexdigest(), 'outcome': outcome}
    payload = {'job': job, 'receipt': receipt}
    log_path = EVIDENCE / (receipt['log_sha'] + '.log')
    if not log_path.exists():
        contract.immutable_write(log_path, log)
    path = EVIDENCE / (contract.digest(payload) + '.failure.json')
    if path.exists():
        protected(path)
        if path.read_bytes() != contract.canonical(payload):
            raise ValueError('failure evidence conflict')
    else:
        contract.immutable_write(path, contract.canonical(payload))


def review_sandbox(source, root, output_dir, user):
    # Read-only Codex itself is additionally OS-isolated: no writer homes/SSH,
    # root policy, live project DB credentials, Docker socket or source writes.
    args = ['/usr/bin/setpriv', '--reuid=' + str(user.pw_uid), '--regid=' + str(user.pw_gid), '--clear-groups',
            '/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-all', '--share-net']
    for path in ('/usr', '/bin', '/lib', '/lib64'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    for path in ('/etc/resolv.conf', '/etc/hosts', '/etc/ssl/certs'):
        if Path(path).exists():
            args += ['--ro-bind', path, path]
    args += ['--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--tmpfs', '/home', '--dir', '/home/qa',
             '--ro-bind', str(INSTALL), '/qa-tools', '--ro-bind', str(source), '/source',
             '--dir', '/evidence', '--ro-bind', str(root / 'review-input.json'), '/evidence/review-input.json',
             '--ro-bind', str(root / 'tests.log'), '/evidence/tests.log',
             '--ro-bind', str(AUTH / 'auth.json'), '/home/qa/auth.json',
             '--bind', str(output_dir), '/output', '--clearenv', '--setenv', 'HOME', '/home/qa',
             '--setenv', 'CODEX_HOME', '/home/qa', '--setenv', 'PATH', '/qa-tools/node/bin:/usr/bin:/bin',
             '--setenv', 'LANG', 'C.UTF-8', '--chdir', '/source', '--']
    return args


def atomic_policy(policy):
    path = EVIDENCE / 'policy.json'
    protected(path)
    temporary = EVIDENCE / ('.policy-' + uuid.uuid4().hex)
    contract.immutable_write(temporary, contract.canonical(policy))
    os.chmod(temporary, 0o644)
    os.replace(temporary, path)
    fd = os.open(EVIDENCE, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def status(qa_id, phase, pid=None, *, attempt=None, identity=None, model=None):
    if qa_id not in SUITES:
        raise ValueError('unregistered status task')
    path = EVIDENCE / (qa_id + '.status.json')
    if path.exists():
        protected(path)
    temporary = EVIDENCE / ('.status-' + uuid.uuid4().hex)
    value = {'task_id': qa_id, 'phase': phase, 'pid': pid, 'updated_at': time.time()}
    if attempt is not None:
        value['claim'] = attempt
    if identity is not None:
        value['candidate_sha'] = identity['candidate_sha']
    if model is not None:
        value['model'] = model
    contract.immutable_write(temporary, contract.canonical(value)); temporary.chmod(0o644)
    os.replace(temporary, path)


def reviewer_started(qa_id, supervisor_pid, *, attempt=None, identity=None, model=None):
    """Report actual host Codex PID, not bwrap's supervisor as model execution."""
    expected = CODEX.stat()
    for _ in range(50):
        pending, visited = [supervisor_pid], set()
        while pending:
            pid = pending.pop()
            if pid in visited:
                continue
            visited.add(pid)
            try:
                info = Path('/proc/' + str(pid) + '/exe').stat()
                if (info.st_dev, info.st_ino) == (expected.st_dev, expected.st_ino):
                    status(qa_id, 'independent_codex_review', pid, attempt=attempt, identity=identity, model=model)
                    return
                children = Path('/proc/' + str(pid) + '/task/' + str(pid) + '/children').read_text()
                pending.extend(int(value) for value in children.split())
            except OSError:
                continue
        time.sleep(0.1)
    status(qa_id, 'reviewer_starting', supervisor_pid, attempt=attempt, identity=identity, model=model)


def current_failure(current, claim, identity):
    return (current.get('phase') in ('BLOCKED', 'FAIL') and current.get('claim') == claim
            and current.get('candidate_sha') == identity['candidate_sha'])


def write_runner_receipt(path, payload):
    mode, gid = access.file_access(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        if gid is not None:
            os.fchown(fd, -1, gid)
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            stream.write(payload); stream.flush(); os.fsync(fd)
    finally:
        os.close(fd)


def wait_for_job(qa_id, timeout=7200):
    """Unprivileged host waiter; never requests effects or supplies candidate data."""
    if qa_id not in SUITES:
        raise ValueError('unregistered QA task')
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            claim = active_attempt(qa_id, regular_json(RUNNER / 'state.json'), waiter_pid=os.getpid())
        except ValueError:
            time.sleep(2)
            continue  # Runner records child PID immediately after process creation.
        producer_id = SUITES[qa_id][0]
        identity, _ = bind(qa_id, regular_json(RUNNER / 'backlog.json'),
                           regular_json(RUNNER / 'receipts' / (producer_id + '.json')))
        path = EVIDENCE / (qa_id + '.result.json')
        if path.exists():
            proof = contract.protected_json(path)
            contract.verify_runner_receipt(proof, EVIDENCE)
            if any(proof.get(k) != identity[k] for k in ('candidate_sha', 'candidate_tree', 'branch', 'producer_task_id')):
                raise ValueError('root QA result belongs to another candidate/task')
            if proof.get('task_id') != qa_id:
                raise ValueError('root QA task replay')
            record = contract.protected_json(EVIDENCE / (proof['trusted_job'] + '.json'))
            policy = contract.protected_json(EVIDENCE / 'policy.json')
            if (record['job']['suite_id'] != identity['suite_id']
                    or record['job']['source_tree'] != identity['candidate_tree']
                    or policy.get('source_qa_authorizations', {}).get(proof['trusted_job']) != contract.digest(identity)):
                raise ValueError('exact QA task authorization missing')
            receipt_path = RUNNER / 'receipts' / (qa_id + '.json')
            if receipt_path.exists():
                if regular_json(receipt_path) != proof:
                    raise ValueError('existing Runner receipt conflict')
            else:
                write_runner_receipt(receipt_path, contract.canonical(proof))
            return proof
        stat_path = EVIDENCE / (qa_id + '.status.json')
        if stat_path.exists():
            current = contract.protected_json(stat_path)
            if current_failure(current, claim, identity):
                raise ValueError('actual trusted job ' + current['phase'])
        time.sleep(2)
    raise TimeoutError('trusted QA job timeout')


def execute(qa_id):
    import pwd
    if os.geteuid() != 0:
        raise ValueError('dedicated administrator-owned QA job required')
    protected(Path(__file__).resolve()); protected(Path(contract.__file__).resolve())
    protected(INSTALL, True); protected(EVIDENCE, True)
    protected(AUTH, True); protected(DEPENDENCIES, True)
    policy = contract.protected_json(EVIDENCE / 'policy.json')
    if policy.get('owner_event') != access.OWNER_EVENT:
        raise ValueError('administrator Owner-bound reviewer policy missing')
    reviewer = policy.get('clean_reviewer_id')
    if reviewer != 'clean-qa-reviewer-v001' or reviewer not in policy['reviewers']:
        raise ValueError('dedicated reviewer authorization missing')
    queue = regular_json(RUNNER / 'backlog.json')
    producer_id = SUITES[qa_id][0] if qa_id in SUITES else ''
    own = regular_json(RUNNER / 'receipts' / (producer_id + '.json'))
    identity, app = bind(qa_id, queue, own)
    state = regular_json(RUNNER / 'state.json')
    attempt = active_attempt(qa_id, state)
    verify_waiter(qa_id, attempt)
    publication_binding(identity)
    latest = next((item for item in reversed(state.get('history', [])) if item.get('id') == producer_id), {})
    if latest.get('status') != 'completed':
        raise ValueError('canonical producer not completed')
    if (EVIDENCE / (qa_id + '.result.json')).exists():
        proof = contract.protected_json(EVIDENCE / (qa_id + '.result.json'))
        contract.verify_runner_receipt(proof, EVIDENCE)
        if (proof.get('task_id') != qa_id or any(proof.get(k) != identity[k] for k in
                ('candidate_sha', 'candidate_tree', 'branch', 'producer_task_id'))):
            raise ValueError('protected successful result cannot replay another identity')
        record = contract.protected_json(EVIDENCE / (proof['trusted_job'] + '.json'))
        if (record['job']['suite_id'] != identity['suite_id']
                or record['job']['source_tree'] != identity['candidate_tree']
                or policy.get('source_qa_authorizations', {}).get(proof['trusted_job']) != contract.digest(identity)):
            raise ValueError('exact recovered task authorization missing')
        return proof  # Transport recovery; never creates new model approval.
    status(qa_id, 'preparing', os.getpid(), attempt=attempt, identity=identity, model=MODELS[app])
    author = 'clean-producer:' + producer_id
    # Producer source is fetched by the existing publisher/runner, never QA remote URL input.
    verify_git_metadata(REPO)
    git = git_command(REPO)
    if checked(git + ['rev-parse', identity['candidate_sha'] + '^{tree}']).decode().strip() != identity['candidate_tree']:
        raise ValueError('actual Git source tree mismatch')
    # Publisher's protected PUBLISHED record is the exact remote observation.
    # A bounded local bundle import need not create refs/remotes/origin/*.
    for item in [NODE, PNPM, CODEX, AUTH / 'auth.json', *DEPENDENCIES.rglob('*')]:
        if not item.is_symlink():
            protected(item)
    dependencies = tree_sha(DEPENDENCIES / app)
    lock_digest = file_sha(DEPENDENCIES / app / 'pnpm-lock.yaml')
    with tempfile.TemporaryDirectory(prefix='job-', dir=EVIDENCE) as temporary:
        root = Path(temporary); root.chmod(0o755)
        source = root / 'source'; source.mkdir(mode=0o755)
        extract_archive(checked(git + ['archive', identity['candidate_sha']]), source)
        for part in ('', 'apps/' + app, 'packages/contracts'):
            (source / part / 'node_modules').mkdir(exist_ok=True)
        if file_sha(source / 'pnpm-lock.yaml') != lock_digest:
            raise ValueError('pinned dependencies do not match candidate lockfile')
        source_digest = tree_sha(source)
        tests_digest = tree_sha(source / 'apps' / app / 'test')
        logs = bytearray()
        count = 0
        with disposable_database() if app == 'api' else contextlib.nullcontext((None, 'none')) as (db_pid, image):
            environment = {'adapter_sha': file_sha(Path(__file__)), 'app': app, 'image': image,
                           'sandbox': 'bwrap-unshare-all', 'source_only': True,
                           'codex_sha': file_sha(CODEX), 'bwrap_sha': file_sha(Path('/usr/bin/bwrap')),
                           'verifier_sha': file_sha(Path(contract.__file__))}
            job = {'source_sha': identity['candidate_sha'], 'source_tree': identity['candidate_tree'],
                   'tests_sha': tests_digest, 'dependencies_sha': dependencies, 'node_sha': file_sha(NODE),
                   'pnpm_sha': file_sha(PNPM), 'lockfile_sha': lock_digest, 'environment_sha': contract.digest(environment),
                   'suite_id': identity['suite_id'], 'author_id': author}
            contract.validate_job(job, policy['suite_ids'])
            for command in suite_commands(app):
                code, output = run(sandbox(source, app, 'gobadminton-clean-qa-test', db_pid) + command,
                                   on_start=lambda pid: status(qa_id, 'tests', pid, attempt=attempt, identity=identity, model=MODELS[app]))
                logs.extend(contract.canonical({'command': command, 'exit_code': code}) + b'\n' + output + b'\n')
                if code:
                    env_blocked = code == 124 or output.lstrip().startswith((b'bwrap:', b'setpriv:', b'nsenter:'))
                    outcome = 'ENV_BLOCKED' if env_blocked else 'PRODUCT_FAIL'
                    failure(job, bytes(logs), outcome, code)
                    raise RuntimeError(outcome + ' actual fixed suite exit=' + str(code))
                if 'vitest.mjs' in command[1]:
                    try:
                        count += count_json(output)
                    except ValueError:
                        failure(job, bytes(logs), 'ENV_BLOCKED', 1)
                        raise
        if tree_sha(source) != source_digest or tree_sha(DEPENDENCIES / app) != dependencies:
            raise ValueError('tested source/dependencies changed')
        receipt = {'job_sha': contract.digest(job), 'exit_code': 0, 'test_count': count,
                   'log_sha': hashlib.sha256(logs).hexdigest(), 'outcome': 'PASS'}
        job_id = uuid.uuid4().hex
        review_input = root / 'review-input.json'
        review_input.write_bytes(contract.canonical({'job_id': job_id, 'identity': identity, 'job': job, 'receipt': receipt}))
        review_input.chmod(0o444)
        (root / 'tests.log').write_bytes(logs); (root / 'tests.log').chmod(0o444)
        output_path = root / 'reviewer-output.json'
        # Dedicated reviewer auth only. CLI host writes its final output; model sandbox is read-only.
        user = pwd.getpwnam('gobadminton-clean-qa-reviewer')
        if user.pw_uid == 0 or user.pw_uid == pwd.getpwnam('gobadminton-clean-qa-test').pw_uid:
            raise ValueError('reviewer/test identities not independent')
        output_dir = root / 'review-output'; output_dir.mkdir(); os.chown(output_dir, user.pw_uid, user.pw_gid)
        output_path = output_dir / 'result.json'
        prompt = ('Independently review GoBadminton exact immutable candidate, tests and privacy boundaries. '
                  'Read /evidence/review-input.json and /evidence/tests.log; inspect /source. '
                  'No writes, credentials, publish, DB or service operations. Source QA only, never claim DEV browser smoke. '
                  'Return only JSON with job_id, receipt_sha, verdict PASS/FAIL/BLOCKED, blocking_findings. '
                  'Use the exact provided job_id and receipt digest. PASS only if independent review finds no source blockers. '
                  'Receipt digest=' + contract.digest(receipt))
        review_cmd = review_sandbox(source, root, output_dir, user) + reviewer_command(app, prompt)
        code, review_log = run(review_cmd, timeout=1800, on_start=lambda pid: reviewer_started(
            qa_id, pid, attempt=attempt, identity=identity, model=MODELS[app]))
        if code or output_path.is_symlink() or not output_path.is_file() or output_path.stat().st_size > 65536:
            failure(job, bytes(logs) + b'\nREVIEW\n' + review_log, 'ENV_BLOCKED', code or 1)
            raise ValueError('independent reviewer process failed')
        try:
            reviewer_result(output_path.read_bytes(), receipt, job_id)
        except ValueError:
            try:
                actual = json.loads(output_path.read_bytes())
            except ValueError:
                actual = {}
            negative = (actual.get('job_id') == job_id and actual.get('receipt_sha') == contract.digest(receipt)
                        and actual.get('verdict') == 'FAIL')
            failure(job, bytes(logs) + b'\nREVIEW\n' + review_log + output_path.read_bytes(),
                    'SECURITY_FAIL' if negative else 'ENV_BLOCKED', 1)
            raise
        verdict = {'receipt_sha': contract.digest(receipt), 'reviewer_id': reviewer,
                   'verdict': 'PASS', 'authorization_id': 'clean-qa-job-' + job_id}
        rebound, _ = bind(qa_id, regular_json(RUNNER / 'backlog.json'),
                          regular_json(RUNNER / 'receipts' / (producer_id + '.json')))
        if rebound != identity or tree_sha(source) != source_digest:
            raise ValueError('candidate/queue changed while QA was executing')
        if active_attempt(qa_id, regular_json(RUNNER / 'state.json')) != attempt:
            raise ValueError('QA claim changed during independent execution')
        verify_waiter(qa_id, attempt)
        publication_binding(identity)
        policy['verdict_authorizations'][verdict['authorization_id']] = contract.digest(verdict)
        previous = []
        for path in EVIDENCE.glob('*.failure.json'):
            old = contract.protected_json(path)
            previous.append([old['job'], old['receipt']])
        record = {'job': job, 'receipt': receipt, 'verdict': verdict, 'previous': previous}
        ref = contract.digest(record)
        if ref in policy.get('source_qa_authorizations', {}):
            raise ValueError('QA job replay')
        policy.setdefault('source_qa_authorizations', {})[ref] = contract.digest(identity)
        contract.verify(job, receipt, verdict, policy, previous)
        for name, payload in ((receipt['log_sha'] + '.log', bytes(logs)), (ref + '.json', contract.canonical(record)),
                              (ref + '.review.log', review_log), (ref + '.review.json', output_path.read_bytes())):
            path = EVIDENCE / name
            if path.exists() and name.endswith('.log'):
                protected(path)
                if path.read_bytes() != payload:
                    raise ValueError('immutable log content conflict')
            else:
                contract.immutable_write(path, payload)
        atomic_policy(policy)
        proof = {'project': 'GoBadminton', 'task_id': qa_id, 'ok': True, 'verdict': 'PASS',
                 'acceptance_state': 'SOURCE_ACCEPTED', 'blocking_findings': [], 'blocking_gap_count': 0,
                 'producer_task_id': producer_id, 'candidate_sha': identity['candidate_sha'],
                 'candidate_tree': identity['candidate_tree'], 'branch': identity['branch'], 'trusted_job': ref}
        contract.verify_runner_receipt(proof, EVIDENCE)
        contract.immutable_write(EVIDENCE / (qa_id + '-' + ref + '.receipt.json'), contract.canonical(proof))
        contract.immutable_write(EVIDENCE / (qa_id + '.result.json'), contract.canonical(proof))
        status(qa_id, 'SOURCE_ACCEPTED', attempt=attempt, identity=identity, model=MODELS[app])
        return proof


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wait', action='store_true', help='unprivileged wait for existing root job result')
    parser.add_argument('qa_task_id', choices=sorted(SUITES))
    args = parser.parse_args()
    try:
        if args.wait:
            print(json.dumps(wait_for_job(args.qa_task_id), sort_keys=True))
            return
        import fcntl
        protected(EVIDENCE, True)
        with (EVIDENCE / '.qa-job.lock').open('a') as lock:
            protected(EVIDENCE / '.qa-job.lock')
            fcntl.flock(lock, fcntl.LOCK_EX)
            print(json.dumps(execute(args.qa_task_id), sort_keys=True))
    except Exception as error:
        if not args.wait and hasattr(os, 'geteuid') and os.geteuid() == 0:
            try:
                protected(EVIDENCE, True)
                producer_id = SUITES[args.qa_task_id][0]
                identity, app = bind(args.qa_task_id, regular_json(RUNNER / 'backlog.json'),
                                     regular_json(RUNNER / 'receipts' / (producer_id + '.json')))
                attempt = active_attempt(args.qa_task_id, regular_json(RUNNER / 'state.json'))
                status(args.qa_task_id, 'BLOCKED', attempt=attempt, identity=identity, model=MODELS[app])
            except Exception:
                pass
        print(json.dumps({'ok': False, 'verdict': 'BLOCKED', 'error': str(error)}, sort_keys=True))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
