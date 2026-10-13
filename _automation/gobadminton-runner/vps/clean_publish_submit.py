"""Host-side requests to the separately credentialed existing publication guard.

No SSH writer key, arbitrary branch, source path or privileged command lives
here. Codex returns a source proposal; the host derives actual Git objects and
waits for a independently observed Publisher receipt before completion.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import stat
import tempfile
import time

import backlog_sync
import clean_runtime_access as access

ROOT = Path('/srv/gobadminton-clean/runner')
STORE = Path('/var/lib/gobadminton-clean-publisher')
SOURCE_REPO = Path('/srv/gobadminton-clean/repo')
REMOTE = 'https://github.com/anpavel84-afk/gobadminton-clean.git'
BRANCHES = {
    'friends-dev-s1-api-20261013-v001': 'feature/friends-s1-clean-source-20261013',
    'radar-dev-map-ui-20261013-v001': 'feature/radar-dev-real-map-20261013',
    'main-pm': 'main',
}
WORKTREES = {slot: Path('/srv/gobadminton-clean/worktrees') /
             ('pm-autopilot' if slot == 'main-pm' else 'runner-' + slot) for slot in BRANCHES}


def git(worktree, *args):
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent', 'LANG': 'C.UTF-8',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_NO_REPLACE_OBJECTS': '1',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_AUTHOR_NAME': 'GoBadminton Clean PM',
           'GIT_AUTHOR_EMAIL': 'clean-pm@gobadminton.invalid',
           'GIT_COMMITTER_NAME': 'GoBadminton Clean PM',
           'GIT_COMMITTER_EMAIL': 'clean-pm@gobadminton.invalid'}
    result = subprocess.run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null',
                             '-c', 'core.fsmonitor=false', '-c', 'credential.helper=',
                             '-c', 'protocol.ext.allow=never', '-c', 'protocol.file.allow=never',
                             '-c', 'core.useReplaceRefs=false', '-c', 'gc.auto=0',
                             '-c', 'maintenance.auto=false',
                             '-C', str(worktree), *args],
                            env=env, capture_output=True, text=True, timeout=120)
    if result.returncode:
        raise RuntimeError('source-only Git operation failed: ' + args[0])
    return result.stdout.strip()


def workspace(slot, source):
    if slot not in WORKTREES or Path(source) != WORKTREES[slot] or Path(source).is_symlink():
        raise RuntimeError('submission must use fixed task worktree')
    if Path(source).resolve() != WORKTREES[slot]:
        raise RuntimeError('task worktree parent redirected')
    expected = SOURCE_REPO / '.git/worktrees' / WORKTREES[slot].name
    pointer = Path(source) / '.git'
    metadata = pointer.lstat()
    if (pointer.is_symlink() or not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.getuid() or metadata.st_mode & 0o022
            or metadata.st_size > 8192
            or pointer.read_text().strip() != 'gitdir: ' + str(expected)):
        raise RuntimeError('task Git pointer is not exact canonical metadata')
    for path in (SOURCE_REPO / '.git', SOURCE_REPO / '.git/objects', expected):
        info = path.lstat()
        if (path.is_symlink() or not stat.S_ISDIR(info.st_mode)
                or info.st_uid != os.getuid() or info.st_mode & 0o022):
            raise RuntimeError('task Git object directory is untrusted')
    common = expected / 'commondir'
    info = common.lstat()
    if (common.is_symlink() or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid() or info.st_mode & 0o022
            or info.st_size > 8192 or common.read_text().strip() != '../..'):
        raise RuntimeError('task common Git objects redirected')
    for path in (SOURCE_REPO / '.git/objects/info/alternates',
                 SOURCE_REPO / '.git/objects/info/http-alternates', SOURCE_REPO / '.git/refs/replace'):
        if path.exists() or path.is_symlink():
            raise RuntimeError('alternate or replacement object source refused')
    packed = SOURCE_REPO / '.git/packed-refs'
    if packed.exists() or packed.is_symlink():
        if packed.is_symlink() or not packed.is_file() or packed.stat().st_size > 8_000_000:
            raise RuntimeError('packed Git identity untrusted')
        if 'refs/replace/' in packed.read_text():
            raise RuntimeError('packed replacement objects refused')
    gitdir = Path(git(source, 'rev-parse', '--absolute-git-dir'))
    if gitdir != expected or gitdir.resolve() != expected:
        raise RuntimeError('task Git metadata redirected')
    if Path(git(source, 'rev-parse', '--show-toplevel')).resolve() != Path(source):
        raise RuntimeError('Git selected a different source working tree')
    return Path(source)


def protected_receipt(path):
    policy = access.policy()
    for parent in (STORE, STORE.parent):
        st = parent.lstat()
        if parent.is_symlink() or st.st_mode & 0o022:
            raise RuntimeError('Publisher receipt directory unprotected')
    if STORE.stat().st_uid != policy['publisher_uid']:
        raise RuntimeError('Publisher store owner mismatch')
    st = path.lstat()
    if (path.is_symlink() or not path.is_file() or st.st_uid != policy['publisher_uid']
            or st.st_mode & 0o022 or not 0 < st.st_size <= 65536):
        raise RuntimeError('Publisher receipt identity/permissions invalid')
    return json.loads(path.read_bytes())


def received(slot, request):
    fingerprint = hashlib.sha256(request).hexdigest()
    path = STORE / (slot + '.receipt.json')
    if path.exists():
        record = protected_receipt(path)
        if record.get('request_sha256') == fingerprint:
            if (record.get('schema') != 'GBCLEAN_PUBLISH_RECEIPT_V1'
                    or record.get('task_id') != slot or record.get('branch') != BRANCHES[slot]
                    or record.get('status') not in {'PUBLISHED', 'OBSERVED_EXISTING'}):
                raise RuntimeError('Publisher request interrupted; no blind retry')
            item = json.loads(request)
            if any(record.get(k) != item[k] for k in ('candidate_sha', 'candidate_tree', 'expected_remote_sha')):
                raise RuntimeError('Publisher actual object binding mismatch')
            return record
    blocked = STORE / (slot + '.blocked.json')
    if blocked.exists() and protected_receipt(blocked).get('request_sha256') == fingerprint:
        raise RuntimeError('Publisher refused current request; protected blocker retained')
    return None


def submit(slot, source, *, timeout=300):
    source = workspace(slot, source)
    policy = access.policy()
    if os.getuid() != policy['submitter_uid']:
        raise RuntimeError('submission host identity mismatch')
    if git(source, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('tracked source proposal must be committed before publication')
    sha, tree = git(source, 'rev-parse', 'HEAD'), git(source, 'rev-parse', 'HEAD^{tree}')
    import re
    if any(not re.fullmatch('[0-9a-f]{40}', value) for value in (sha, tree)):
        raise RuntimeError('actual Git source identity invalid')
    announced = git(source, 'ls-remote', '--refs', REMOTE, 'refs/heads/' + BRANCHES[slot]).split()
    if len(announced) != 2 or announced[1] != 'refs/heads/' + BRANCHES[slot]:
        raise RuntimeError('public candidate branch observation unavailable')
    spool = ROOT / 'publisher-spool'
    if spool.is_symlink() or not spool.is_dir():
        raise RuntimeError('publisher spool not commissioned')
    fd, temporary = tempfile.mkstemp(prefix='.bundle-', dir=spool)
    os.close(fd)
    Path(temporary).unlink()  # git bundle creates its own regular file.
    try:
        git(source, 'bundle', 'create', temporary, 'HEAD')
        bundle = Path(temporary).read_bytes()
        if not 0 < len(bundle) <= 128 * 1024 * 1024:
            raise RuntimeError('source bundle exceeds bounded request size')
        request = {'schema': 'GBCLEAN_PUBLISH_V1', 'task_id': slot,
                   'candidate_sha': sha, 'candidate_tree': tree,
                   'expected_remote_sha': announced[0],
                   'bundle_sha256': hashlib.sha256(bundle).hexdigest()}
        raw = (json.dumps(request, sort_keys=True) + '\n').encode()
        # Bundle precedes its discoverable request; Publisher rereads both and
        # rejects any mutation before Git transport. No model control-state write.
        backlog_sync.atomic_write(spool / (slot + '.bundle'), bundle)
        backlog_sync.atomic_write(spool / (slot + '.json'), raw)
    finally:
        Path(temporary).unlink(missing_ok=True)
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        record = received(slot, raw)
        if record is not None:
            return record
        time.sleep(2)
    raise RuntimeError('publisher observation timeout; request/history preserved')


def finish_producer(task, source, model_receipt, *, executor_pid, executor_exit_code):
    if task['id'] not in BRANCHES or task['id'] == 'main-pm':
        raise RuntimeError('unknown producer publication task')
    if (model_receipt.get('ok') is not True or model_receipt.get('project') != 'GoBadminton'
            or model_receipt.get('task_id') != task['id']):
        raise RuntimeError('source execution did not return a valid completion proposal')
    if type(executor_pid) is not int or executor_pid <= 0 or type(executor_exit_code) is not int or executor_exit_code != 0:
        raise RuntimeError('actual successful Codex process exit required before publication')
    source = workspace(task['id'], source)
    if git(source, 'status', '--porcelain', '--untracked-files=no'):
        raise RuntimeError('prepared source changed without a committed candidate')
    baseline = git(source, 'rev-parse', 'HEAD')
    # Reuse the prepared implementation, but publish a genuine new host-derived
    # execution record. This is not redevelopment or an independent QA assertion.
    folder = source / 'docs/handoffs/20261013'
    for parent in (source / 'docs', source / 'docs/handoffs', folder):
        if parent.is_symlink() or parent.exists() and not parent.is_dir():
            raise RuntimeError('execution handoff directory redirected')
        parent.mkdir(exist_ok=True)
    handoff = folder / ('clean-canary-' + task['id'] + '.md')
    if handoff.is_symlink():
        raise RuntimeError('execution handoff file redirected')
    from datetime import datetime, timezone
    text = ('# Automatic Clean source execution\n\n'
            + 'Task: ' + task['id'] + '\n'
            + 'Prepared source reused: ' + baseline + '\n'
            + 'Actual Codex process PID: ' + str(executor_pid) + '\n'
            + 'Actual exit code: 0\n'
            + 'Recorded UTC: ' + datetime.now(timezone.utc).isoformat() + '\n\n'
            + 'Independent QA: NOT_EXECUTED. DEV release: NOT_EXECUTED.\n'
            + 'The separate Publisher must publish this candidate before the existing independent QA task starts.\n')
    handoff.write_text(text, encoding='utf-8')
    git(source, 'add', '--', handoff.relative_to(source).as_posix())
    git(source, 'commit', '-m', 'Clean canary: actual source execution ' + task['id'])
    record = submit(task['id'], source)
    result = {**model_receipt, 'candidate_sha': record['candidate_sha'],
              'candidate_tree': record['candidate_tree'], 'branch': record['branch'],
              'publication_receipt_sha256': hashlib.sha256(
                  (STORE / (task['id'] + '.receipt.json')).read_bytes()).hexdigest(),
              'publication_state': record['status'], 'real_publication': record['real_publication'],
              'executor_pid': executor_pid, 'executor_exit_code': executor_exit_code}
    backlog_sync.atomic_write(ROOT / 'receipts' / (task['id'] + '.json'),
                              (json.dumps(result, sort_keys=True) + '\n').encode())
    return result


def prepare_pm_proposal(source, receipt):
    """Commit only existing permitted PM documents, then ask the sole writer.

    The model has no writer credential and may leave a reviewed local diff.
    publication_guard still independently checks the full resulting admission.
    """
    source = workspace('main-pm', source)
    if receipt.get('action') not in {'enqueued', 'merged', 'merged_and_enqueued'}:
        raise RuntimeError('not a bounded PM publication proposal')
    changed = set(git(source, 'diff', '--name-only', 'HEAD').splitlines())
    changed |= set(git(source, 'ls-files', '--others', '--exclude-standard').splitlines())
    prefixes = ('docs/prompts/', 'docs/manifest/', 'docs/operations/',
                'docs/delivery/', 'docs/handoffs/')
    for name in changed:
        if ('..' in Path(name).parts or name.startswith('/') or '\\' in name
                or not (name == '_automation/gobadminton-runner/backlog.json'
                        or name.startswith(prefixes))):
            raise RuntimeError('PM proposal contains a non-PM source path')
        path = source / name
        if path.exists() and (path.is_symlink() or not path.is_file()):
            raise RuntimeError('PM proposal redirects its source path')
    if changed:
        git(source, 'add', '--', *sorted(changed))
        git(source, 'commit', '-m', 'Clean PM: exact Owner-bound source queue proposal')
    result = dict(receipt)
    result['result_commit'] = git(source, 'rev-parse', 'HEAD')
    backlog_sync.atomic_write(ROOT / 'autopilot-receipt.json',
                              (json.dumps(result, sort_keys=True) + '\n').encode())
    record = submit('main-pm', source)
    if record.get('status') != 'PUBLISHED' or record.get('real_publication') is not True:
        raise RuntimeError('PM main proposal was not actually published')
    result['publisher_receipt_sha256'] = hashlib.sha256(
        (STORE / 'main-pm.receipt.json').read_bytes()).hexdigest()
    backlog_sync.atomic_write(ROOT / 'autopilot-receipt.json',
                              (json.dumps(result, sort_keys=True) + '\n').encode())
    return result


def producer_is_published(task_id, receipt):
    if task_id not in BRANCHES or task_id == 'main-pm':
        return False
    if (type(receipt.get('executor_exit_code')) is not int or receipt['executor_exit_code'] != 0
            or type(receipt.get('executor_pid')) is not int or receipt['executor_pid'] <= 0):
        return False
    try:
        record = protected_receipt(STORE / (task_id + '.receipt.json'))
        return (record.get('schema') == 'GBCLEAN_PUBLISH_RECEIPT_V1'
                and record.get('task_id') == task_id and record.get('branch') == BRANCHES[task_id]
                and record.get('status') in {'PUBLISHED', 'OBSERVED_EXISTING'}
                and all(record.get(k) == receipt.get(k) for k in ('candidate_sha', 'candidate_tree', 'branch'))
                and receipt.get('publication_state') == record['status'])
    except (OSError, ValueError, RuntimeError):
        return False
