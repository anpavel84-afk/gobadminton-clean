"""Offline installer recovery tests; all unit/file operations use scratch fixtures."""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest


INSTALLER = Path(__file__).with_name('park-drift.sh').read_text()
FUNCTIONS = INSTALLER.split('service_property() {', 1)[1].split('trap cleanup EXIT', 1)[0]
FUNCTIONS = 'service_property() {' + FUNCTIONS
ORIGINAL = b'original executor\n'
PATCHED = b'patched executor\n'
FILE_FUNCTIONS = 'no_symlinks() {' + INSTALLER.split('no_symlinks() {', 1)[1].split(
    'service_property() {', 1)[0]
TRANSACTION = 'root_private "$BACKUPS"\n' + INSTALLER.split('root_private "$BACKUPS"\n', 1)[1]

# Run the real helper on scratch files, simulating only privileged identities and
# chown/DAC. agentagency-dev (1000) is NOT a member of the control group (2000).
# Metadata follows inodes across real replace operations; mtime distinguishes
# deleted inodes subsequently reused by shell-created root files.
FILE_FIXTURE = r'''
import errno, grp, json, os, stat, sys, types
from pathlib import Path

root = Path(os.environ['TEST_ROOT'])
metadata_path = root / 'owners.json'
owners = json.loads(metadata_path.read_text())
uid = 1000 if os.environ.get('TEST_WRITER') == 'account' else 0
groups = {0: 'root', 1000: 'agentagency-dev', 2000: 'gobadminton-clean-control'}
gid = {name: number for number, name in groups.items()}[
    os.environ.get('TEST_WRITER_GROUP', 'root')]
real_open, real_stat, real_fstat = os.open, os.stat, os.fstat
created = {}

def key(info):
    return f'{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}'

def metadata(info):
    values = {name: getattr(info, name) for name in dir(info) if name.startswith('st_')}
    values['st_uid'], values['st_gid'] = owners.get(
        key(info), created.get((info.st_dev, info.st_ino), [0, 0]))
    return types.SimpleNamespace(**values)

def opened(path, flags, *args, **kwargs):
    fd = real_open(path, flags, *args, **kwargs)
    info = real_fstat(fd)
    if flags & os.O_CREAT:
        created[info.st_dev, info.st_ino] = [uid, gid]
    # Only the live directory has simulated group access; scratch ancestors are
    # owned by the actual test runner. Enforce its read/search permission here.
    if uid and key(info) == key(real_stat(root / 'worktree')) and gid != 2000:
        os.close(fd)
        raise PermissionError(errno.EACCES, 'fixture directory group')
    return fd

def chown(fd, owner, group):
    info = metadata(real_fstat(fd))
    if uid and (info.st_uid != uid or owner != uid or group not in {gid, 1000}):
        raise PermissionError(errno.EPERM, 'fixture non-member group')
    owners[key(real_fstat(fd))] = [owner, group]
    metadata_path.write_text(json.dumps(owners))

os.open = opened
os.stat = lambda *args, **kwargs: metadata(real_stat(*args, **kwargs))
os.fstat = lambda fd: metadata(real_fstat(fd))
os.fchown = chown
os.geteuid = lambda: uid
grp.getgrgid = lambda number: types.SimpleNamespace(gr_name=groups[number])

arguments = sys.argv[1:]
if arguments[0] == '--stat':
    info = os.stat(arguments[1])
    print(f'{info.st_uid}:{info.st_gid}:{stat.S_IMODE(info.st_mode):o}')
else:
    code = arguments[1] if arguments[0] == '-c' else sys.stdin.read()
    sys.argv = [arguments[0], *arguments[2 if arguments[0] == '-c' else 1:]]
    exec(compile(code, '<file_helper_fixture>', 'exec'))
'''

FILE_HARNESS = r'''
umask 077
ACCOUNT=agentagency-dev
account_uid=1000
live_uid=1000 live_gid=2000 live_mode=600
LIVE=$TEST_ROOT/worktree/autonomous_issues.py
PAYLOAD=$TEST_ROOT/candidate
rollback='' backup=''
ORIGINAL_SHA=$TEST_ORIGINAL_SHA PATCHED_SHA=$TEST_PATCHED_SHA
live_sha=$(sha "$LIVE")
isolated_python() { "$TEST_PYTHON" "$TEST_ROOT/fixture.py" "$@"; }
stat() { isolated_python --stat "${@: -1}"; }
id() { [[ $1 == -g && $# == 1 ]] && printf '0\n'; }
runuser() {
    [[ $1 == -u && $2 == "$ACCOUNT" ]] || return 1
    shift 2
    local writer_group=agentagency-dev
    if [[ ${1:-} == -g ]]; then writer_group=$2; shift 2; fi
    [[ $1 == -- && $2 == env && $3 == -i ]] || return 1
    # Execute no service command: only the real isolated file helper is accepted.
    shift 3
    [[ $1 == PATH=* && $2 == LANG=* && $3 == /usr/bin/python3 && $4 == -I && $5 == -c ]] || return 1
    shift 4
    TEST_WRITER=account TEST_WRITER_GROUP=$writer_group \
        "$TEST_PYTHON" "$TEST_ROOT/fixture.py" "$@"
}
sha() { file_ops sha "$1"; }
atomic_file() {
    if [[ $1 == "$rollback/live" ]]; then
        recovering=1
        printf 'restore\n' >> "$TEST_ROOT/events"
    fi
    real_atomic_file "$@"
}
trap cleanup EXIT
'''

HARNESS = r'''
set -euo pipefail
UNIT=test.service
LIVE=$TEST_ROOT/live
BACKUPS=$TEST_ROOT/backup
rollback=$BACKUPS/rollback
private=$TEST_ROOT/private
mode=$TEST_MODE
force=$TEST_FORCE
transaction=0
committed=0
live_uid=1000 live_gid=1000 live_mode=600
live_sha=$(sha256sum "$rollback/live")
live_sha=${live_sha%% *}
candidate_sha=$(sha256sum "$TEST_ROOT/candidate")
candidate_sha=${candidate_sha%% *}
mock_invocation=1 mock_pid=100 mock_restarts=0 children=$TEST_CHILDREN
recovering=0 started=0
sha() { sha256sum "$1" | cut -d ' ' -f 1; }
fail() { printf '%s\n' "$2" >&2; exit "$1"; }
atomic_file() {
    if [[ $1 == "$rollback/live" ]]; then
        recovering=1
        printf 'restore\n' >> "$TEST_ROOT/events"
    fi
    cp -- "$1" "$2"
}
pgrep() {
    printf 'pgrep\n' >> "$TEST_ROOT/events"
    [[ $children == 1 ]]
}
sleep() { SECONDS=$((SECONDS + 5)); }
userctl() {
    local operation=$1
    if [[ $operation == show ]]; then
        case $3 in
            --property=KillMode)
                if [[ $TEST_FAILURE == killmode ]]; then printf 'process\n'
                else printf 'control-group\n'; fi ;;
            --property=MainPID) printf '%s\n' "$mock_pid" ;;
            --property=InvocationID) printf '%s\n' "$mock_invocation" ;;
            --property=NRestarts) printf '%s\n' "$mock_restarts" ;;
            --property=ActiveState)
                # Fail verification while the candidate and its children still run.
                if [[ $TEST_SCENARIO == failed && $started == 1 && $recovering == 0 ]] ||
                   [[ $recovering == 1 && $TEST_FAILURE == verify ]]; then return 1; fi
                if [[ $mock_pid == 0 ]]; then printf 'inactive\n'; else printf 'active\n'; fi ;;
            *) return 1 ;;
        esac
        return 0
    fi
    printf '%s\n' "$operation" >> "$TEST_ROOT/events"
    if [[ $recovering == 1 && $operation == "$TEST_FAILURE" ]]; then return 1; fi
    case $operation in
        daemon-reload) ;;
        stop) mock_pid=0; children=0 ;;
        start|restart)
            mock_pid=101
            if [[ $recovering != 1 || $TEST_FAILURE != invocation ]]; then
                mock_invocation=$((mock_invocation + 1))
            fi
            children=0 started=1
            if [[ $TEST_SCENARIO == failed && $recovering == 0 ]]; then children=1; fi
            sha "$LIVE" > "$TEST_ROOT/running_sha"
            if [[ $recovering == 1 && $TEST_FAILURE == checksum ]]; then
                printf 'unexpected drift\n' > "$LIVE"
            fi ;;
        *) return 1 ;;
    esac
    return 0
}
'''

FAILED_OPERATION = r'''
trap cleanup EXIT
transaction=1
previous_invocation=$(service_property InvocationID)
atomic_file "$TEST_ROOT/candidate" "$LIVE"
restart_unit || fail 5 'User unit restart refused/failed; restoring files'
verify_service "$candidate_sha" "$previous_invocation" ||
    fail 5 'Candidate user unit not verified; restoring files'
committed=1
'''


class Installer(unittest.TestCase):
    def test_rebased_payload_and_checksums(self):
        root = Path(__file__).parent
        payload = (root / 'autonomous_issues.py').read_bytes()
        original_sha = '6d741f6f0a0bd4b0369a62b7228fec5ebe4c33ad585e3a284371f21354195660'
        # Exported patch bundles may omit the original live-source fixture.
        live = root / 'live_autonomous_issues.py'
        if live.exists():
            self.assertEqual(hashlib.sha256(live.read_bytes()).hexdigest(), original_sha)
        self.assertIn('readonly ORIGINAL_SHA=' + original_sha + '\n', INSTALLER)
        self.assertIn('readonly PATCHED_SHA=' + hashlib.sha256(payload).hexdigest() + '\n', INSTALLER)
        encoded = INSTALLER.split("<<'AUTONOMOUS_ISSUES_PY_BASE64'\n", 1)[1].split(
            '\nAUTONOMOUS_ISSUES_PY_BASE64\n', 1)[0]
        self.assertEqual(base64.b64decode(''.join(encoded.splitlines()), validate=True), payload)

    def run_installer(self, *, mode='install', scenario='failed', force=0,
                      children=0, failure=''):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            backup = root / 'backup'
            rollback = backup / 'rollback'
            rollback.mkdir(parents=True)
            (root / 'private').mkdir()
            before, candidate = ((ORIGINAL, PATCHED) if mode == 'install'
                                 else (PATCHED, ORIGINAL))
            (root / 'live').write_bytes(before)
            (root / 'candidate').write_bytes(candidate)
            (rollback / 'live').write_bytes(before)
            (backup / 'current').write_text('original-backup\n')
            (backup / 'autonomous_issues.py').write_bytes(ORIGINAL)
            (root / 'events').touch()
            env = os.environ | dict(TEST_ROOT=tmp, TEST_MODE=mode, TEST_SCENARIO=scenario,
                                    TEST_FORCE=str(force), TEST_CHILDREN=str(children),
                                    TEST_FAILURE=failure)
            action = FAILED_OPERATION if scenario == 'failed' else 'restart_unit\n'
            result = subprocess.run(['bash', '-c', HARNESS + FUNCTIONS + action],
                                    env=env, cwd=tmp, capture_output=True, text=True, timeout=15)
            running = root / 'running_sha'
            return dict(result=result, live=(root / 'live').read_bytes(),
                        running=running.read_text().strip() if running.exists() else None,
                        events=(root / 'events').read_text().splitlines(),
                        pointer=(backup / 'current').exists(), rollback=rollback.exists(),
                        private=(root / 'private').exists(),
                        original_backup=(backup / 'autonomous_issues.py').read_bytes())

    def test_failed_install_stops_spawned_children_and_runs_original(self):
        for force in (0, 1):
            with self.subTest(force=force):
                run = self.run_installer(force=force)
                self.assertEqual(run['result'].returncode, 5, run['result'].stderr)
                self.assertEqual(run['events'], [
                    'daemon-reload', 'pgrep', 'restart', 'restore',
                    'daemon-reload', 'stop', 'start'])
                self.assertEqual(run['live'], ORIGINAL)
                self.assertEqual(run['running'], hashlib.sha256(ORIGINAL).hexdigest())
                self.assertFalse(run['pointer'])
                self.assertFalse(run['rollback'])
                self.assertFalse(run['private'])
                self.assertEqual(run['original_backup'], ORIGINAL)
                self.assertIn('Restoring files after failed operation', run['result'].stderr)
                self.assertNotIn('Rollback incomplete', run['result'].stderr)

    def test_failed_install_recovery_failure_exits_6_and_retains_backups(self):
        for failure in ('daemon-reload', 'stop', 'start', 'verify', 'checksum', 'invocation'):
            with self.subTest(failure=failure):
                run = self.run_installer(failure=failure)
                self.assertEqual(run['result'].returncode, 6, run['result'].stderr)
                self.assertTrue(run['pointer'])
                self.assertTrue(run['rollback'])
                self.assertFalse(run['private'])
                self.assertEqual(run['original_backup'], ORIGINAL)
                self.assertIn('Rollback incomplete; owner reconciliation required; backup retained',
                              run['result'].stderr)
                recovery = run['events'][run['events'].index('restore') + 1:]
                self.assertNotIn('pgrep', recovery)
                if failure == 'stop':
                    self.assertNotIn('start', recovery)
                if failure == 'daemon-reload':
                    self.assertNotIn('stop', recovery)

    def test_normal_restart_preserves_idle_and_force_rules(self):
        for mode in ('install', '--remove'):
            for children, force in ((0, 0), (1, 0), (1, 1)):
                with self.subTest(mode=mode, children=children, force=force):
                    run = self.run_installer(mode=mode, scenario='normal',
                                             children=children, force=force)
                    refused = children and not force
                    self.assertEqual(run['result'].returncode, 1 if refused else 0,
                                     run['result'].stderr)
                    self.assertEqual(run['events'], ['daemon-reload', 'pgrep'] +
                                     ([] if refused else ['restart']))
                    if refused:
                        self.assertIn('Unit has child processes; refusing restart',
                                      run['result'].stderr)

    def test_failed_remove_stops_spawned_children_and_runs_patched(self):
        for force in (0, 1):
            with self.subTest(force=force):
                run = self.run_installer(mode='--remove', force=force)
                self.assertEqual(run['result'].returncode, 5,
                                 run['result'].stderr)
                self.assertEqual(run['live'], PATCHED)
                self.assertEqual(run['events'], [
                    'daemon-reload', 'pgrep', 'restart', 'restore',
                    'daemon-reload', 'stop', 'start'])
                self.assertTrue(run['pointer'])
                self.assertFalse(run['rollback'])
                self.assertEqual(run['running'], hashlib.sha256(PATCHED).hexdigest())

    def test_killmode_guard_still_blocks_normal_and_rollback_restarts(self):
        for mode in ('install', '--remove'):
            for scenario in ('normal', 'failed'):
                with self.subTest(mode=mode, scenario=scenario):
                    run = self.run_installer(mode=mode, scenario=scenario, force=1,
                                             failure='killmode')
                    self.assertEqual(run['result'].returncode, 6 if scenario == 'failed' else 1,
                                     run['result'].stderr)
                    for action in ('restart', 'stop', 'start'):
                        self.assertNotIn(action, run['events'])


class FileOperations(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for directory, mode in (('backup', 0o700), ('backup/rollback', 0o700),
                                ('private', 0o700), ('worktree', 0o750)):
            (self.root / directory).mkdir(mode=mode)
        self.live = self.root / 'worktree/autonomous_issues.py'
        for path, data in ((self.live, ORIGINAL), (self.root / 'candidate', PATCHED),
                           (self.root / 'backup/rollback/live', ORIGINAL)):
            path.write_bytes(data)
            path.chmod(0o600)
        # An empty root-only BACKUPS left by a failed run must be reusable.
        (self.root / 'fixture.py').write_text(FILE_FIXTURE)
        (self.root / 'events').touch()
        owners = {self.inode(self.live): [1000, 2000],
                  self.inode(self.root / 'worktree'): [0, 2000]}
        (self.root / 'owners.json').write_text(json.dumps(owners))

    @staticmethod
    def inode(path):
        info = path.stat()
        return f'{info.st_dev}:{info.st_ino}:{info.st_mtime_ns}'

    def environment(self, **values):
        return os.environ | dict(TEST_ROOT=str(self.root), TEST_MODE='install',
                                 TEST_FORCE='0', TEST_CHILDREN='0', TEST_FAILURE='',
                                 TEST_SCENARIO='normal', TEST_PYTHON=sys.executable,
                                 TEST_ORIGINAL_SHA=hashlib.sha256(ORIGINAL).hexdigest(),
                                 TEST_PATCHED_SHA=hashlib.sha256(PATCHED).hexdigest()) | values

    def run_transaction(self, mode='install', **values):
        (self.root / 'private').mkdir(mode=0o700, exist_ok=True)
        # Keep the actual bash transaction, file helpers and recovery functions;
        # replace only host commands/identities and observe rollback entry.
        functions = FILE_FUNCTIONS.replace('atomic_file() {', 'real_atomic_file() {')
        # Bash EUID is readonly; the simulated installer/root helper identity is 0.
        functions = functions.replace('"$EUID"', '"0"')
        transaction = TRANSACTION.replace('"$EUID"', '"0"')
        return subprocess.run(['bash', '-c', HARNESS + functions + FUNCTIONS +
                               FILE_HARNESS + transaction],
                              env=self.environment(TEST_MODE=mode, **values),
                              cwd=self.root, capture_output=True, text=True, timeout=20)

    def helper(self, *arguments, data=b'', **values):
        helper = INSTALLER.split("file_helper() {\n    cat <<'PY'\n", 1)[1].split('\nPY\n}', 1)[0]
        return subprocess.run([sys.executable, str(self.root / 'fixture.py'), '-c',
                               helper, *map(str, arguments)], input=data,
                              env=self.environment(**values), cwd=self.root,
                              capture_output=True, timeout=10)

    def assert_metadata(self, path, owner, group, mode):
        owners = json.loads((self.root / 'owners.json').read_text())
        self.assertEqual(owners.get(self.inode(path), [0, 0]), [owner, group])
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)

    def assert_backups_private(self):
        for path in (self.root / 'backup', *(self.root / 'backup').rglob('*')):
            self.assertFalse(path.is_symlink())
            self.assert_metadata(path, 0, 0, 0o700 if path.is_dir() else 0o600)

    def test_install_repeat_and_remove_preserve_control_group_and_mode(self):
        for mode, expected in (('install', PATCHED), ('install', PATCHED),
                               ('--remove', ORIGINAL), ('--remove', ORIGINAL)):
            with self.subTest(mode=mode, expected=expected):
                result = self.run_transaction(mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.live.read_bytes(), expected)
                self.assert_metadata(self.live, 1000, 2000, 0o600)
                self.assert_backups_private()
                self.assertEqual((self.root / 'backup/current').exists(), expected == PATCHED)
        originals = list((self.root / 'backup').glob('*/autonomous_issues.py'))
        self.assertEqual(len(originals), 1)
        self.assertEqual(originals[0].read_bytes(), ORIGINAL)

    def test_install_and_remove_rollback_use_real_file_helper(self):
        for mode, expected in (('install', ORIGINAL), ('--remove', PATCHED)):
            with self.subTest(mode=mode):
                if mode == '--remove':
                    result = self.run_transaction()
                    self.assertEqual(result.returncode, 0, result.stderr)
                result = self.run_transaction(mode, TEST_SCENARIO='failed')
                self.assertEqual(result.returncode, 5, result.stderr)
                self.assertIn('Restoring files after failed operation', result.stderr)
                self.assertNotIn('Rollback incomplete', result.stderr)
                self.assertEqual(self.live.read_bytes(), expected)
                self.assert_metadata(self.live, 1000, 2000, 0o600)
                self.assertEqual((self.root / 'backup/current').exists(), mode == '--remove')
                self.assertFalse(list((self.root / 'backup').glob('*/.rollback.*')))
                self.assert_backups_private()

    def test_rollback_failure_retains_root_only_backup(self):
        result = self.run_transaction(TEST_SCENARIO='failed', TEST_FAILURE='start')
        self.assertEqual(result.returncode, 6, result.stderr)
        self.assertIn('Rollback incomplete; owner reconciliation required; backup retained',
                      result.stderr)
        self.assertEqual(self.live.read_bytes(), ORIGINAL)
        self.assert_metadata(self.live, 1000, 2000, 0o600)
        self.assertTrue((self.root / 'backup/current').exists())
        self.assertTrue(list((self.root / 'backup').glob('*/.rollback.*')))
        self.assert_backups_private()

    def test_non_member_fchown_fails_but_selected_primary_group_succeeds(self):
        destination = self.root / 'direct'
        destination.write_bytes(ORIGINAL)
        digest = hashlib.sha256(PATCHED).hexdigest()
        args = ('replace', destination, 1000, 2000, '600', digest)
        result = self.helper(*args, data=PATCHED, TEST_WRITER='account',
                             TEST_WRITER_GROUP='agentagency-dev')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn(b'Unsafe file operation', result.stderr)
        self.assertEqual(destination.read_bytes(), ORIGINAL)
        self.assertFalse(list(self.root.glob('.direct.park-drift.*')))
        result = self.helper(*args, data=PATCHED, TEST_WRITER='account',
                             TEST_WRITER_GROUP='gobadminton-clean-control')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_metadata(destination, 1000, 2000, 0o600)

    def test_metadata_checksum_and_writer_guards_still_reject_mismatches(self):
        digest = hashlib.sha256(ORIGINAL).hexdigest()
        result = self.helper('verify', self.live, digest, 1000, 2000, '600')
        self.assertEqual(result.returncode, 0, result.stderr)
        for checks in ((digest, 2000, 2000, '600'), (digest, 1000, 1000, '600'),
                       (digest, 1000, 2000, '640'), ('0' * 64, 1000, 2000, '600')):
            with self.subTest(checks=checks):
                self.assertEqual(self.helper('verify', self.live, *checks).returncode, 1)
        result = self.helper('replace', self.live, 1000, 2000, '600', digest, data=ORIGINAL)
        self.assertEqual(result.returncode, 1, result.stderr)  # root is not the writer
        result = self.helper('replace', self.live, 1000, 2000, '600', '0' * 64,
                             data=PATCHED, TEST_WRITER='account',
                             TEST_WRITER_GROUP='gobadminton-clean-control')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(self.live.read_bytes(), ORIGINAL)

    def test_existing_backup_directory_rejects_unsafe_metadata(self):
        backup = self.root / 'backup'
        for owner, group, mode in ((0, 0, 0o750), (1000, 0, 0o700), (0, 2000, 0o700)):
            with self.subTest(owner=owner, group=group, mode=mode):
                owners = json.loads((self.root / 'owners.json').read_text())
                owners[self.inode(backup)] = [owner, group]
                (self.root / 'owners.json').write_text(json.dumps(owners))
                backup.chmod(mode)
                result = self.run_transaction()
                self.assertEqual(result.returncode, 3, result.stderr)
                self.assertIn('Unsafe backup directory', result.stderr)
                self.assertEqual(self.live.read_bytes(), ORIGINAL)

    def test_symlink_backup_and_helper_ancestors_are_rejected(self):
        backup = self.root / 'backup'
        backup.rename(self.root / 'saved-backup')
        backup.symlink_to(self.root / 'saved-backup', target_is_directory=True)
        result = self.run_transaction()
        self.assertEqual(result.returncode, 3, result.stderr)
        self.assertIn('Symlink in backup path', result.stderr)
        link = self.root / 'linked-worktree'
        link.symlink_to(self.root / 'worktree', target_is_directory=True)
        self.assertEqual(self.helper('info', link / self.live.name).returncode, 1)
        link = self.root / 'linked-file'
        link.symlink_to(self.live)
        self.assertEqual(self.helper('sha', link).returncode, 1)
        self.assertEqual(self.live.read_bytes(), ORIGINAL)


if __name__ == '__main__':
    unittest.main()
