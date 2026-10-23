"""Targeted offline shell transaction regressions. Privileged effects are scratch simulations."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import contextlib
import io
import types
from unittest.mock import patch
import unittest

ROOT = Path(__file__).parent
INSTALLER = (ROOT / 'parallel-slots.sh').read_text()
COMMON = INSTALLER.split('[ "$DRY" = 1 ] || [ "$(id -u)" = 0 ]', 1)[0]
ACT_HELPERS = '# Read metadata only.' + INSTALLER.split('# Read metadata only.', 1)[1].split(
    'if [ "$MODE" = preflight ]', 1)[0]
IDLE = 'idle_of() {' + INSTALLER.split('idle_of() {', 1)[1].split('# Read metadata only.', 1)[0]
ROLLBACK = '\nrollback() {' + INSTALLER.split('\nrollback() {', 1)[1].split("trap 'rollback;", 1)[0]
ACTIVATION = 'if [ "$MODE" = preflight ]' + INSTALLER.split('if [ "$MODE" = preflight ]', 1)[1].split(
    '# ================================================================== REMOVE', 1)[0]
REMOVE = INSTALLER.split('# ================================================================== REMOVE\n', 1)[1].split(
    '# ================================================================== INSTALL', 1)[0]
REPO_MAP = {
    'repository-build.sh': 'scripts/chatops/parallel-slots/build.sh',
    'repository-installer.tpl': 'scripts/chatops/parallel-slots/installer.tpl',
    'repository-SOURCE_SHA256SUMS': 'scripts/chatops/parallel-slots/SOURCE_SHA256SUMS',
    'embedded-autonomous_issues.py': 'scripts/chatops/autonomous_issues.py',
    'embedded-slots.py': 'scripts/chatops/slots.py',
    'embedded-check_foundation.py': 'scripts/check_foundation.py',
    'embedded-test_autonomous_issues.py': 'scripts/chatops/tests/test_autonomous_issues.py',
    'embedded-test_slots.py': 'scripts/chatops/tests/test_slots.py',
    'live-autonomous_issues.py': 'scripts/chatops/parallel-slots/live-autonomous_issues.py',
}
LEGACY_FIXTURE = r'''
touch "$TEST_ROOT/legacy.service" "$TEST_ROOT/dropin.conf"
TEST_START=${TEST_START:-"/usr/bin/python3 -B /srv/gobadminton-clean/worktrees/autonomy-existing-issues-20261015/scripts/chatops/autonomous_issues.py --repo /srv/gobadminton-clean/worktrees/autonomy-existing-issues-20261015 --state-dir /home/agentagency-dev/.gb-autonomy-state --worktrees-root /srv/gobadminton-clean/worktrees --known-hosts /home/agentagency-dev/.ssh/known_hosts --approved-since 2026-10-15T12:00:00Z --poll 240"}
luctl() {
    printf '%s\n' "legacy $*" >> "$TEST_ROOT/events"
    [[ $# = 5 && $1 = show && $2 = "$LUNIT" && $3 = -p && $5 = --value ]] || return 91
    case "$4" in
        LoadState) printf 'loaded\n' ;;
        Id) printf '%s\n' "${TEST_ID:-$LUNIT}" ;;
        Names) printf '%s\n' "${TEST_NAMES:-$LUNIT}" ;;
        NeedDaemonReload) printf '%s\n' "${RELOAD:-no}" ;;
        FragmentPath) printf '%s\n' "${FRAGMENT:-$TEST_ROOT/legacy.service}" ;;
        DropInPaths) printf '%s\n' "${DROPINS:-$TEST_ROOT/dropin.conf}" ;;
        ExecStart) printf '{ path=/usr/bin/python3 ; argv[]=%s ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }\n' "$TEST_START" ;;
        *) return 92 ;;  # Includes all environment/credential properties and unfiltered show.
    esac
}
'''


class Installer(unittest.TestCase):
    def test_rollback_archive_refuses_hardlink_symlink_and_fifo(self):
        for scenario in ('safe', 'hardlink', 'symlink', 'fifo'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                state = root/'state'; state.mkdir()
                public = state/'state.json'
                public.write_bytes(b'{"active":null,"done":[]}')
                if scenario != 'safe':
                    public.unlink()
                    other = root/'private-fixture'; other.write_bytes(b'PRIVATE-FIXTURE')
                    if scenario == 'hardlink': os.link(other, public)
                    if scenario == 'symlink': public.symlink_to(other)
                    if scenario == 'fifo': os.mkfifo(public)
                archive = root/'snapshot.tar'
                result = subprocess.run(['bash', '-c', 'STATE=$1 ARCHIVE=$2; set --\n' + COMMON + '\nfiltered_tar state "$STATE" "$ARCHIVE"\n', '_', str(state), str(archive)], capture_output=True, timeout=10)
                self.assertEqual(result.returncode == 0, scenario == 'safe', result.stderr.decode())
                if archive.exists(): self.assertNotIn(b'PRIVATE-FIXTURE', archive.read_bytes())

    def test_excluded_before_glob_is_never_archived(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); state = root/'state'; state.mkdir()
            (state/'state.json').write_bytes(b'{"active":null,"done":[]}')
            os.mkfifo(root/'private-unreadable-fixture')
            (state/'before-unvalidated.json').symlink_to(root/'private-unreadable-fixture')
            archive = root/'snapshot.tar'
            result = subprocess.run(['bash','-c','STATE=$1 ARCHIVE=$2; set --\n'+COMMON+'\nfiltered_tar state "$STATE" "$ARCHIVE"\n','_',str(state),str(archive)],capture_output=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            import tarfile
            with tarfile.open(archive) as tar:
                self.assertEqual([m.name for m in tar],['./state.json'])

    def test_install_rollback_resumes_advanced_or_unreadable_slot_history(self):
        keep = '\nkeep_slot1() {' + INSTALLER.split('\nkeep_slot1() {',1)[1].split('\nrollback() {',1)[0]
        for scenario in ('advanced','unreadable'):
            body = keep + r'''
DONE_STARTED=1 LEGACY_STOPPED=1 LEGACY_ENABLED=enabled LEGACY_MIGRATION_STARTED=1
UNITS_CHANGED=1 ETC_CHANGED=1 GROUP_CREATED=0
printf '{"schema":"GB_SLOT_SUPERVISOR_V1","slots":["slot1","slot2"],"max_parallel":1}\n' > "$ETC/supervisor.json"
printf '{"active":null,"done":[30,41]}\n' > "$VAR/slots/slot1/state.json"
record_completed() { [ "$TEST_SCENARIO" != unreadable ]; }
legacy_resume_safe() { return 1; }
restore_units() { say unexpected-restore; return 91; }
trap rollback EXIT
exit 23
'''
            result, events, files = self.shell(body, TEST_SCENARIO=scenario)
            self.assertEqual(result.returncode,23,result.stderr)
            self.assertIn('systemctl enable --now gobadminton-slot@slot1.service gobadminton-supervisor.service',events)
            self.assertNotIn('unexpected-restore',events)
            self.assertNotIn('legacy start',events)
            self.assertEqual(json.loads(files['var/slots/slot1/state.json'])['done'],[30,41])
            self.assertEqual(json.loads(files['legacy/state.json'])['done'],[30])

    def test_public_reader_rejects_links_and_special_files_before_reading(self):
        code = INSTALLER.split("<<'PYBASE'\n",1)[1].split('\ntry:\n    print(hashlib',1)[0]
        namespace = {}; exec(compile(code,'<public-reader-fixture>','exec'),namespace)
        read = namespace['safe_bytes']
        for scenario in ('safe','symlink','hardlink','fifo','parent_symlink','oversize'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp); public = root/'public.py'; public.write_bytes(b'public fixture')
                if scenario == 'hardlink': os.link(public,root/'other')
                if scenario in ('symlink','fifo'):
                    public.unlink()
                    if scenario == 'symlink': public.symlink_to(root/'private')
                    else: os.mkfifo(public)
                if scenario == 'parent_symlink':
                    (root/'real').mkdir(); (root/'real/file').write_bytes(b'private fixture')
                    (root/'redirect').symlink_to(root/'real',target_is_directory=True)
                    public = root/'redirect/file'
                if scenario == 'safe': self.assertEqual(read(public),b'public fixture')
                else:
                    with patch.object(os,'fdopen',side_effect=AssertionError('must not read rejected file bytes')):
                        with self.assertRaises((OSError,ValueError)):
                            read(public,1 if scenario=='oversize' else 1024)

    def test_group_cleanup_preserves_mapping_without_global_scan_or_deletion(self):
        result, events, _ = self.shell(r'''
find() { say forbidden-global-scan; return 91; }
groupdel() { say forbidden-group-delete; return 92; }
remove_created_group "$LIB/.gb-slots-group-created"
''')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('forbidden-global-scan',events)
        self.assertNotIn('forbidden-group-delete',events)
        self.assertIn('GID и архивы сохранены',events)

    def test_service_control_refuses_aliases_foreign_fragments_and_stale_units(self):
        helpers = '# Mutations are limited' + INSTALLER.split('# Mutations are limited',1)[1].split('# Only these public properties',1)[0]
        fixture = r'''
mkdir -p "$UNITDIR/gobadminton-slot@slot1.service.d" "$UNITDIR/gobadminton-slot@slot2.service.d" "$TEST_ROOT/bin"
touch "$UNITDIR/gobadminton-slot@.service" "$UNITDIR/gobadminton-supervisor.service" "$UNITDIR/gobadminton-slot@slot1.service.d/10-legacy-account.conf" "$UNITDIR/gobadminton-slot@slot2.service.d/20-runtime.conf"
if [ "$TEST_CASE" = symlink ]; then
    rm "$UNITDIR/gobadminton-supervisor.service"
    touch "$UNITDIR/unrelated.service"
    ln -s "$UNITDIR/unrelated.service" "$UNITDIR/gobadminton-supervisor.service"
fi
cat > "$TEST_ROOT/bin/systemctl" <<'FAKE'
#!/bin/bash
if [ "$1" != show ]; then printf 'MUTATION %s\n' "$*" >> "$TEST_ROOT/events"; exit 0; fi
u=$2; p=$4
case "$p" in
  LoadState) if [ "$TEST_CASE" = missing ]; then echo not-found; else echo loaded; fi ;;
  Id) if [ "$TEST_CASE:$u" = id:gobadminton-supervisor.service ]; then echo unrelated.service; else echo "$u"; fi ;;
  Names) if [ "$TEST_CASE:$u" = names:gobadminton-supervisor.service ]; then echo "$u unrelated.service"; else echo "$u"; fi ;;
  NeedDaemonReload) if [ "$TEST_CASE" = reload ]; then echo yes; else echo no; fi ;;
  ActiveState) echo inactive ;;
  FragmentPath)
    if [ "$TEST_CASE" = missing ]; then exit 0; fi
    if [ "$TEST_CASE:$u" = fragment:gobadminton-supervisor.service ]; then echo /unrelated.service
    elif [ "$u" = gobadminton-supervisor.service ]; then echo "$TEST_ROOT/units/gobadminton-supervisor.service"
    else echo "$TEST_ROOT/units/gobadminton-slot@.service"; fi ;;
  DropInPaths)
    if [ "$TEST_CASE" = missing ]; then exit 0; fi
    if [ "$TEST_CASE" = dropin ]; then echo /unrelated.conf
    elif [ "$u" = gobadminton-slot@slot1.service ]; then echo "$TEST_ROOT/units/gobadminton-slot@slot1.service.d/10-legacy-account.conf"
    elif [ "$u" = gobadminton-slot@slot2.service ]; then echo "$TEST_ROOT/units/gobadminton-slot@slot2.service.d/20-runtime.conf"; fi ;;
  *) exit 91 ;;
esac
FAKE
chmod 700 "$TEST_ROOT/bin/systemctl"
PATH="$TEST_ROOT/bin:$PATH"; export PATH
check_units() { return 0; } # File-byte validation has a separate adversarial regression.
systemctl stop gobadminton-supervisor.service
'''
        for scenario in ('safe','id','names','fragment','dropin','reload','missing','symlink'):
            with self.subTest(scenario=scenario):
                result, events, _ = self.shell(helpers+fixture,TEST_CASE=scenario)
                self.assertEqual(result.returncode==0,scenario=='safe',result.stderr)
                self.assertEqual('MUTATION stop' in events,scenario=='safe',events)

    def test_unit_file_validation_rejects_symlinks_hardlinks_and_foreign_owners_before_read(self):
        import sys
        code = COMMON.split('checked_unit() {',1)[1].split("python3 -I -c '\n",1)[1].split("' \"$@\"",1)[0]
        for scenario in ('safe','symlink','hardlink','fifo','foreign'):
            with self.subTest(scenario=scenario), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); path=root/'unit.service'; path.write_bytes(b'expected public unit'); path.chmod(0o644)
                if scenario=='hardlink': os.link(path,root/'other')
                if scenario in ('symlink','fifo'):
                    path.unlink()
                    if scenario=='symlink': path.symlink_to(root/'private-fixture')
                    else: os.mkfifo(path)
                real_lstat,real_fstat=os.lstat,os.fstat
                def metadata(info):
                    attrs={key:getattr(info,key) for key in ('st_mode','st_nlink','st_dev','st_ino','st_size','st_atime_ns','st_mtime_ns','st_ctime_ns')}
                    return types.SimpleNamespace(**attrs,st_uid=1002 if scenario=='foreign' else 0,st_gid=0)
                with patch.object(sys,'argv',['-',str(path)]),patch.object(sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(b'expected public unit'))),patch.object(os,'lstat',side_effect=lambda p:metadata(real_lstat(p))),patch.object(os,'fstat',side_effect=lambda fd:metadata(real_fstat(fd))):
                    if scenario=='safe': exec(compile(code,'<unit-public-metadata-fixture>','exec'),{})
                    else:
                        with patch.object(os,'fdopen',side_effect=AssertionError('rejected unit bytes must not be read')),self.assertRaises(SystemExit) as error:
                            exec(compile(code,'<unit-public-metadata-fixture>','exec'),{})
                        self.assertEqual(error.exception.code,1)

    def test_legacy_scope_rejects_other_repositories_and_state_paths(self):
        for old, new in (
            ('/srv/gobadminton-clean/worktrees/autonomy-existing-issues-20261015', '/srv/PROD/repo'),
            ('/home/agentagency-dev/.gb-autonomy-state', '/srv/PROD/state'),
            ('/srv/gobadminton-clean/worktrees', '/srv/PLAN/worktrees'),
        ):
            body = LEGACY_FIXTURE.replace(old, new) + '\nlegacy_snapshot\n'
            result, _, _ = self.shell(body)
            self.assertNotEqual(result.returncode, 0)

    def test_library_manifest_moves_only_exact_public_files_and_restores_partial_failure(self):
        self.library_manifest_fixture('safe')
        self.library_manifest_fixture('partial')

    def test_library_manifest_fails_closed_on_ambiguous_files(self):
        for scenario in ('missing', 'drift', 'symlink', 'hardlink', 'fifo', 'mode', 'backup_symlink'):
            with self.subTest(scenario=scenario):
                self.library_manifest_fixture(scenario)

    def library_manifest_fixture(self, scenario):
        import sys
        code = COMMON.split("<<'PYLIB'\n", 1)[1].split('\nPYLIB', 1)[0]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            lib, backup = root/'lib', root/'backup'
            lib.mkdir()
            names = ('autonomous_issues.py', 'slots.py', 'check_foundation.py')
            values = {name: (ROOT/('embedded-' + name)).read_bytes() for name in names}
            for name, data in values.items():
                (lib/name).write_bytes(data)
                (lib/name).chmod(0o644)
            # FIFOs cannot be copied/read successfully. No secret bytes in these fixtures.
            (lib/'.ssh').mkdir()
            os.mkfifo(lib/'.ssh/key')
            os.mkfifo(lib/'auth.json')
            untouched = {str(p): p.lstat() for p in (lib/'.ssh', lib/'.ssh/key', lib/'auth.json')}
            first = lib/names[0]
            if scenario == 'missing': first.unlink()
            if scenario == 'drift': first.write_text('unexpected source')
            if scenario in ('symlink', 'fifo'):
                first.unlink()
                if scenario == 'symlink': first.symlink_to(lib/'auth.json')
                else: os.mkfifo(first)
            if scenario == 'hardlink': os.link(first, lib/'other')
            if scenario == 'mode': first.chmod(0o666)
            if scenario == 'backup_symlink': backup.symlink_to(lib, target_is_directory=True)
            real_fstat, real_stat, real_unlink = os.fstat, os.stat, os.unlink
            def root_info(info):
                fields = list(info)
                fields[4] = 0
                if stat.S_ISDIR(fields[0]): fields[0] &= ~0o022
                return os.stat_result(fields)
            def run(action):
                args = ['-', action, str(lib), str(backup), *[hashlib.sha256(values[n]).hexdigest() for n in names]]
                with patch.object(sys, 'argv', args), \
                        patch.object(os, 'fstat', side_effect=lambda fd: root_info(real_fstat(fd))), \
                        patch.object(os, 'stat', side_effect=lambda *a, **kw: root_info(real_stat(*a, **kw))):
                    exec(compile(code, '<library-manifest-fixture>', 'exec'), {})
            if scenario == 'safe':
                run('check')
                run('move')
                for name, data in values.items():
                    self.assertFalse((lib/name).exists())
                    self.assertEqual((backup/name).read_bytes(), data)
                run('restore')
            elif scenario == 'partial':
                run('check')
                def fail_second_unlink(path, *args, **kwargs):
                    if path == names[1]: raise OSError('injected partial library transfer')
                    return real_unlink(path, *args, **kwargs)
                with patch.object(os, 'unlink', side_effect=fail_second_unlink), self.assertRaises(SystemExit):
                    run('move')
                self.assertFalse((lib/names[0]).exists())
                self.assertTrue((lib/names[1]).exists())
                run('restore')
            else:
                with self.assertRaises(SystemExit) as result:
                    run('move' if scenario == 'backup_symlink' else 'check')
                self.assertEqual(result.exception.code, 1)
                self.assertTrue((lib/names[1]).exists())
                self.assertFalse((backup/names[1]).exists() if scenario != 'backup_symlink' else False)
            if scenario in ('safe', 'partial'):
                for name, data in values.items(): self.assertEqual((lib/name).read_bytes(), data)
            self.assertEqual({p: os.lstat(p) for p in untouched}, untouched)

    def test_remove_and_rollback_leave_homes_repositories_and_ledgers_in_place(self):
        for scenario in ('success', 'failed_restore', 'failed_library', 'advanced_state'):
            fixture = r'''
MODE=remove
luctl() {
    printf '%s\n' "legacy $*" >> "$TEST_ROOT/events"
    case "$1" in
        is-enabled) printf 'disabled\n' ;;
        is-active) [ ! -f "$TEST_ROOT/legacy-started" ] || printf 'active\n' ;;
        enable) [ "${2:-}" != --now ] || touch "$TEST_ROOT/legacy-started" ;;
        stop) command rm -f "$TEST_ROOT/legacy-started" ;;
    esac
    return 0
}
mkdir -p "$SRV/slot2/home/.ssh" "$SRV/slot2/home/.codex" "$SRV/slot2/repo" "$VAR/outbox/slot2"
mkfifo "$SRV/slot2/home/.ssh/key" "$SRV/slot2/home/.codex/auth.json"
printf 'retained ledger fixture\n' > "$VAR/outbox/slot2/ledger.json"
printf 'retained repository fixture\n' > "$SRV/slot2/repo/file"
printf 'tombstone\n' > "$L_STATE/RETIRED_TO_SLOT.json"
before=$(stat -c '%d:%i:%s:%y:%z' "$SRV" "$SRV/slot2/home" "$SRV/slot2/home/.ssh/key" "$SRV/slot2/home/.codex/auth.json" "$VAR" "$VAR/outbox/slot2/ledger.json")
printf '%s\n' "$before" > "$TEST_ROOT/before"
tree_guard() {
    local tool=$1 arg; shift
    for arg in "$@"; do
        case "$arg" in "$SRV"|"$SRV/"*|"$VAR"|"$VAR/"*) say "TREE ACCESS TRAPPED: $tool $arg"; exit 93 ;; esac
    done
    command "$tool" "$@"
}
mv() { tree_guard mv "$@"; }
cp() { tree_guard cp "$@"; }
rm() { tree_guard rm "$@"; }
tar() { tree_guard tar "$@"; }
backup_units() { :; }
restore_units() { say restored-units; }
config_files() { return 0; }
legacy_unchanged() { return 0; }
library_files() { say "manifest $1"; [ "$TEST_SCENARIO:$1" != failed_library:move ]; }
restore_config() { [ "$TEST_SCENARIO" != failed_restore ]; }
remove_created_group() { :; }
record_completed() { say completed-recorded; }
legacy_resume_safe() { [ "$TEST_SCENARIO" != advanced_state ]; }
'''
            # The rollback exits explicitly; capture metadata after its subshell exits.
            wrapped = '(\nset -e\n' + fixture + REMOVE + '\n)\nrc=$?\nstat -c "%d:%i:%s:%y:%z" "$SRV" "$SRV/slot2/home" "$SRV/slot2/home/.ssh/key" "$SRV/slot2/home/.codex/auth.json" "$VAR" "$VAR/outbox/slot2/ledger.json" > "$TEST_ROOT/after"\nexit "$rc"\n'
            result, events, files = self.shell('set +e\n' + wrapped, TEST_SCENARIO=scenario)
            self.assertEqual(result.returncode, 0 if scenario == 'success' else 1, (scenario, result.stderr, events))
            self.assertNotIn('TREE ACCESS TRAPPED', events)
            self.assertEqual(files['before'], files['after'])
            self.assertEqual(files['var/outbox/slot2/ledger.json'], b'retained ledger fixture\n')
            self.assertEqual(files['srv/slot2/repo/file'], b'retained repository fixture\n')
            if scenario == 'advanced_state':
                self.assertNotIn('restored-units', events)
                self.assertIn('--remove запрещён', events)
            elif scenario != 'success':
                self.assertIn('manifest restore', events)
                self.assertIn('restored-units', events)

    def test_repository_build_roundtrip_and_stale_sources_fail_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp) / 'repo'
            for local, relative in REPO_MAP.items():
                dest = repo / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes((ROOT / local).read_bytes())
            output = Path(tmp) / 'installer.sh'
            cmd = ['bash', str(repo / REPO_MAP['repository-build.sh']), str(repo), str(output)]
            for _ in range(2):
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output.read_bytes(), (ROOT / 'parallel-slots.sh').read_bytes())
            for name in ('embedded-autonomous_issues.py', 'embedded-check_foundation.py',
                         'live-autonomous_issues.py', 'repository-installer.tpl'):
                path = repo / REPO_MAP[name]
                original = path.read_bytes()
                path.write_bytes(original + b'\n# stale fixture\n')
                output.unlink(missing_ok=True)
                result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('source SHA mismatch', result.stderr)
                self.assertFalse(output.exists())
                path.write_bytes(original)

    def test_legacy_discovery_requests_only_public_properties(self):
        result, events, _ = self.shell(LEGACY_FIXTURE + '''
chmod 000 "$TEST_ROOT/legacy.service" "$TEST_ROOT/dropin.conf"
LEGACY_META=$(legacy_snapshot)
chmod 600 "$TEST_ROOT/legacy.service" "$TEST_ROOT/dropin.conf"
printf '%s\\n' "$LEGACY_META" | legacy_args
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        requested = [line.split(' -p ')[1].split()[0] for line in events.splitlines()]
        self.assertEqual(requested, ['LoadState', 'NeedDaemonReload', 'Id', 'Names', 'FragmentPath', 'DropInPaths', 'ExecStart'])
        self.assertIn('--known-hosts=/home/agentagency-dev/.ssh/known_hosts', result.stdout)
        self.assertNotIn('luctl cat', INSTALLER)
        self.assertNotIn('redact_unit', INSTALLER)

    def test_legacy_fragment_dropin_effective_args_and_reload_drift_block(self):
        for change in ('printf changed >> "$TEST_ROOT/dropin.conf"',
                       'printf changed >> "$TEST_ROOT/legacy.service"',
                       'TEST_START="$TEST_START --wait-timeout 123"', 'RELOAD=yes', 'TEST_ID=unrelated.service', 'TEST_NAMES=unrelated.service',
                       'touch "$TEST_ROOT/new.conf"; DROPINS="$TEST_ROOT/new.conf"',
                       'touch "$TEST_ROOT/new.service"; FRAGMENT="$TEST_ROOT/new.service"'):
            result, _, _ = self.shell(LEGACY_FIXTURE + '\nLEGACY_META=$(legacy_snapshot)\n' + change + '\nlegacy_unchanged\n')
            self.assertNotEqual(result.returncode, 0, change)
        result, _, _ = self.shell(LEGACY_FIXTURE + '\nLEGACY_META=$(legacy_snapshot)\nlegacy_unchanged\n')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_legacy_execstart_rejects_unknown_duplicate_unsafe_and_invalid_timing(self):
        for argument in ('--secret fixture', '--repo /other', '--poll 0',
                         '--wait-timeout invalid', '--codex ${HOME}/bin/codex'):
            result, _, _ = self.shell(LEGACY_FIXTURE + '\nTEST_START="$TEST_START $TEST_ARG"\nlegacy_snapshot\n', TEST_ARG=argument)
            self.assertNotEqual(result.returncode, 0, argument)
            self.assertEqual(result.stdout, '')

    def test_config_transactions_trap_trust_writes_even_on_failed_restore(self):
        remove = '  remove_rollback() {' + INSTALLER.split('  remove_rollback() {', 1)[1].split("  trap 'remove_rollback;", 1)[0]
        move_loop = '  for d in "$ETC"; do' + REMOVE.split(
            '  for d in "$ETC"; do', 1)[1].split('  REMOVE_CONFIG_RESTORED=1', 1)[0]
        fixture = r'''
mkdir -p "$ETC.bak.20261020-150000"
printf 'legacy trust fixture\n' > "$TEST_ROOT/known_hosts"
printf 'untouched config trust fixture\n' > "$ETC/known_hosts"
printf 'untouched old backup trust fixture\n' > "$ETC.bak.20261020-150000/known_hosts"
printf 'untouched proof fixture\n' > "$ETC/slot2-proof.json"
printf 'old-budget\n' > "$ETC.bak.20261020-150000/budgets.json"
printf 'old-supervisor\n' > "$ETC.bak.20261020-150000/supervisor.json"
printf 'current-budget\n' > "$ETC/budgets.json"
printf 'current-supervisor\n' > "$ETC/supervisor.json"
L_KH=$TEST_ROOT/known_hosts
before=$(stat -c '%d:%i:%s:%y:%z' "$L_KH" "$ETC/known_hosts" "$ETC.bak.20261020-150000/known_hosts")
# Simulate only root ownership of the scratch config chain; regular-file checks remain.
config_files() {
    python3 -I -c 'import os,stat,sys
for name in ("budgets.json", "supervisor.json"):
    path=os.path.join(sys.argv[1],name)
    if os.path.lexists(path) and not stat.S_ISREG(os.lstat(path).st_mode): sys.exit(1)' "${2:-$ETC}"
}
trust_guard() {
    local tool=$1 arg; shift
    for arg in "$@"; do
        if [[ $arg = *known_hosts* ]] || { [ -d "$arg" ] && [ -e "$arg/known_hosts" ]; }; then
            say "TRUST WRITE TRAPPED: $tool $arg"; exit 93
        fi
    done
    command "$tool" "$@"
}
mv() { trust_guard mv "$@"; }
cp() { trust_guard cp "$@"; }
rm() { trust_guard rm "$@"; }
tar() {
    if [[ " $* " = *' -xpf - '* ]]; then
        python3 -I -c 'import io,subprocess,sys,tarfile
data=sys.stdin.buffer.read()
with tarfile.open(fileobj=io.BytesIO(data)) as archive:
    assert all(m.name in ("./budgets.json", "./supervisor.json") for m in archive), "TRUST WRITE TRAPPED: archive"
sys.exit(subprocess.run(["/usr/bin/tar", *sys.argv[1:]], input=data).returncode)' "$@" || return
        [ "${FAIL_RESTORE:-0}" != 1 ] || return 19
    else command tar "$@"; fi
}
restore_units() { return 0; }
'''
        for scenario in ('backup', 'restore', 'failed-restore', 'install-rollback', 'remove', 'remove-rollback'):
            body = fixture
            if scenario == 'backup': body += '\nbackup_config\n'
            elif scenario in ('restore', 'failed-restore'):
                body += '\nFAIL_RESTORE=' + ('1' if scenario == 'failed-restore' else '0') + '\nrestore_config\n'
            elif scenario == 'install-rollback':
                body += '\nETC_CHANGED=1\ntrap rollback EXIT\nexit 17\n'
            else:
                body += '''
REMOVE_DIRS_MOVED=() REMOVE_STOPPED=0 REMOVE_LEGACY_START=0 REMOVE_CONFIG_RESTORED=0 REMOVE_LIBRARY_STARTED=0
''' + (remove if scenario == 'remove-rollback' else '')
                if scenario == 'remove-rollback': body += '\ntrap remove_rollback EXIT\n'
                body += move_loop + '\nREMOVE_CONFIG_RESTORED=1\nrestore_config\n'
                if scenario == 'remove-rollback': body += 'exit 19\n'
            if scenario in ('backup', 'restore', 'remove'):
                body += '\nafter=$(stat -c \'%d:%i:%s:%y:%z\' "$L_KH" "$ETC/known_hosts" "$ETC.bak.20261020-150000/known_hosts")\n[ "$before" = "$after" ]\n'
            result, events, files = self.shell(body)
            self.assertEqual(result.returncode, 19 if scenario in ('failed-restore', 'remove-rollback') else
                             17 if scenario == 'install-rollback' else 0, (scenario, result.stderr, events))
            self.assertNotIn('TRUST WRITE TRAPPED', events)
            self.assertEqual(files['known_hosts'], b'legacy trust fixture\n')
            self.assertEqual(files['etc/known_hosts'], b'untouched config trust fixture\n')
            self.assertEqual(files['etc.bak.20261020-150000/known_hosts'], b'untouched old backup trust fixture\n')
            self.assertEqual(files['etc/slot2-proof.json'], b'untouched proof fixture\n')
            self.assertEqual(sum(name.endswith('known_hosts') for name in files), 3)

    def test_config_guard_still_rejects_symlinks_and_nonregular_settings(self):
        import sys
        code = COMMON.split("<<'PYCONFIG'\n", 1)[1].split('\nPYCONFIG', 1)[0]
        real_fstat = os.fstat
        def root_owned(fd):
            info = list(real_fstat(fd))
            info[0] &= ~0o022
            info[4] = 0
            return os.stat_result(info)
        for scenario in ('safe', 'directory_symlink', 'budget_symlink', 'supervisor_fifo'):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                config = root / 'config'
                config.mkdir()
                (config/'budgets.json').write_text('{}')
                (config/'supervisor.json').write_text('{}')
                if scenario == 'directory_symlink':
                    (root/'link').symlink_to(config, target_is_directory=True)
                    config = root/'link'
                if scenario == 'budget_symlink':
                    (config/'budgets.json').unlink()
                    (config/'budgets.json').symlink_to(config/'supervisor.json')
                if scenario == 'supervisor_fifo':
                    (config/'supervisor.json').unlink()
                    os.mkfifo(config/'supervisor.json')
                with patch.object(sys, 'argv', ['-', str(config), 'check', '']), patch.object(os, 'fstat', side_effect=root_owned):
                    if scenario == 'safe': exec(compile(code, '<config-fixture>', 'exec'), {})
                    else:
                        with self.assertRaises(SystemExit) as result:
                            exec(compile(code, '<config-fixture>', 'exec'), {})
                        self.assertEqual(result.exception.code, 1)

    def test_empty_existing_group_still_blocks_without_reuse_or_deletion(self):
        guard = 'if getent group "$GRP"' + INSTALLER.split('if getent group "$GRP"', 1)[1].split('\nfor t in git', 1)[0]
        result, events, _ = self.shell('''
getent() { printf 'gb-slots:x:970:\\n'; }
groupdel() { say forbidden-groupdel; exit 94; }
groupadd() { say forbidden-groupadd; exit 94; }
''' + guard)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('/root/gb-parallel-slots.20261019-231505', events)
        self.assertIn('пустой список members не разрешает reuse/groupdel', events)
        self.assertNotIn('forbidden-group', events)

    def test_every_payload_is_exact_and_live_baseline_is_reconciled(self):
        files = {'EXEC': 'autonomous_issues.py', 'SLOTS': 'slots.py', 'FOUNDATION': 'check_foundation.py',
                 'T1': 'test_autonomous_issues.py', 'T2': 'test_slots.py'}
        chunks = INSTALLER.split('__PAYLOAD_autonomous_issues.py__\n', 1)[1]
        for symbol, name in files.items():
            encoded = INSTALLER.split('__PAYLOAD_' + name + '__\n', 1)[1].split('__PAYLOAD_', 1)[0]
            data = base64.b64decode(''.join(encoded.splitlines()), validate=True)
            self.assertEqual(data, (ROOT / ('embedded-' + name)).read_bytes())
            self.assertIn('SHA_' + symbol + '=' + hashlib.sha256(data).hexdigest() + '\n', INSTALLER)
        live_sha = hashlib.sha256((ROOT / 'live-autonomous_issues.py').read_bytes()).hexdigest()
        self.assertIn('SHA_BASE_EXEC=' + live_sha + '\n', INSTALLER)
        import ast
        live = ast.parse((ROOT / 'live-autonomous_issues.py').read_text())
        payload = ast.parse((ROOT / 'embedded-autonomous_issues.py').read_text())
        def method(tree, name):
            bridge = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Bridge')
            return ast.dump(next(n for n in bridge.body if isinstance(n, ast.FunctionDef) and n.name == name))
        for name in ('park', 'resume', 'failed_ci', 'unchanged_issue', 'saved_qa'):
            if name == 'saved_qa':
                # Only integration-specific evidence filename changed; exact QA checks survive.
                self.assertIn('and qa_result(result, active[\'head\'])', (ROOT/'embedded-autonomous_issues.py').read_text())
            else:
                self.assertEqual(method(live, name), method(payload, name), name)

    def shell(self, body, **values):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('legacy', 'var/slots/slot1', 'var/slots/slot2', 'var/assign', 'backup', 'etc', 'temp'):
                (root/name).mkdir(parents=True)
            for name in ('legacy', 'var/slots/slot1'):
                (root/name/'state.json').write_text('{"active": null, "done": [30]}')
                (root/name/'worker.lock').touch()
            setup = r'''
DRY=0 MODE=activate
LU=agentagency-dev SUP=gb-supervisor S2=gb-slot2
LIB=$TEST_ROOT/lib VAR=$TEST_ROOT/var SRV=$TEST_ROOT/srv ETC=$TEST_ROOT/etc
BK=$TEST_ROOT/backup TMP=$TEST_ROOT/temp L_STATE=$TEST_ROOT/legacy
UNITDIR=$TEST_ROOT/units LOG=$TEST_ROOT/events STAMP=20261021-150000
say() { printf '%s\n' "$*" >> "$TEST_ROOT/events"; }
logl() { say "$*"; }
bad() { say "$*"; exit 1; }
systemctl() {
    printf '%s\n' "systemctl $*" >> "$TEST_ROOT/events"
    case "$1" in
        is-enabled) printf 'disabled\n' ;;
        is-active) printf 'inactive\n' ;;
    esac
}
luctl() { printf '%s\n' "legacy $*" >> "$TEST_ROOT/events"; }
sleep() { :; }
install() {
    if [[ $1 == -d ]]; then mkdir -p "$BK"
    else cp "$ETC/supervisor.json" "$BK/supervisor.json"; fi
}
'''
            script = COMMON + IDLE + ACT_HELPERS + ROLLBACK + setup + body
            result = subprocess.run(['bash', '-c', script], env=os.environ | {'TEST_ROOT': tmp, **values},
                                    cwd=root, text=True, capture_output=True, timeout=15)
            return result, (root/'events').read_text() if (root/'events').exists() else '', {
                str(p.relative_to(root)): p.read_bytes() for p in root.rglob('*') if p.is_file()}

    def test_active_issue147_and_blocked_tasks_prevent_activation_before_service_mutation(self):
        for phase in ('developing', 'blocked'):
            body = '''
printf '{"active":{"phase":"%s","issue":147},"done":[30]}\n' "$TEST_PHASE" > "$L_STATE/state.json"
cp "$L_STATE/state.json" "$VAR/slots/slot1/state.json"
slot2_readiness() { return 0; }
''' + ACTIVATION
            result, events, files = self.shell(body, TEST_PHASE=phase)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('activation запрещён', events)
            self.assertNotIn('systemctl stop', events)
            self.assertEqual(files['legacy/state.json'], files['var/slots/slot1/state.json'])

    def test_preflight_is_read_only_and_not_activation(self):
        result, events, files = self.shell('''
MODE=preflight
slot2_readiness() { return 0; }
''' + ACTIVATION)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('два реальных task runs ещё не подтверждены', events)
        self.assertNotIn('systemctl', events)
        self.assertNotIn('etc/supervisor.json', files)
        self.assertNotIn('legacy/RETIRED_TO_SLOT.json', files)

    def test_signals_run_transaction_rollback_with_nonzero_status(self):
        signals = INSTALLER.split('# Signals must become nonzero EXIT status so transaction rollback cannot be skipped.\n', 1)[1].split('#', 1)[0].split('\n', 3)[:3]
        handlers = '\n'.join(signals) + '\n'
        for signal, code in (('HUP', 129), ('INT', 130), ('TERM', 143)):
            for phase in ('install', 'activation', 'remove'):
                with self.subTest(signal=signal, phase=phase):
                    if phase == 'install':
                        body = """
DONE_STARTED=0 LEGACY_STOPPED=1 LEGACY_ENABLED=enabled LEGACY_MIGRATION_STARTED=1
UNITS_CHANGED=0 ETC_CHANGED=0 GROUP_CREATED=0
printf 'tombstone\\n' > "$L_STATE/RETIRED_TO_SLOT.json"
restore_units() { return 0; }
trap rollback EXIT
""" + handlers + 'kill -s ' + signal + ' "$$"\n'
                        result, events, files = self.shell(body)
                        self.assertIn('legacy start', events)
                        self.assertNotIn('legacy/RETIRED_TO_SLOT.json', files)
                    elif phase == 'activation':
                        body = """
printf '{"slots":["slot1","slot2"],"max_parallel":1}\\n' > "$ETC/supervisor.json"
slot2_readiness() { return 0; }
systemctl() {
 printf '%s\\n' "systemctl $*" >> "$TEST_ROOT/events"
 case "$1" in
  is-enabled) printf 'disabled\\n' ;;
  is-active) printf 'inactive\\n' ;;
  stop) kill -s "$TEST_SIGNAL" "$$" ;;
 esac
}
""" + handlers + ACTIVATION
                        result, events, files = self.shell(body, TEST_SIGNAL=signal)
                        self.assertIn('activation rolled back', events)
                        self.assertEqual(json.loads(files['etc/supervisor.json'])['max_parallel'], 1)
                    else:
                        remove = '  remove_rollback() {' + INSTALLER.split('  remove_rollback() {', 1)[1].split("  trap 'remove_rollback;", 1)[0]
                        body = """
REMOVE_STOPPED=1 REMOVE_LEGACY_START=0 REMOVE_CONFIG_RESTORED=0 REMOVE_LIBRARY_STARTED=0
REMOVE_DIRS_MOVED=()
REMOVE_UNITS=(gobadminton-supervisor.service gobadminton-slot@slot1.service gobadminton-slot@slot2.service)
REMOVE_ACTIVE=(active active inactive)
REMOVE_ENABLED=(enabled enabled disabled)
REMOVE_LEGACY_ENABLED=disabled
restore_units() { say restored-units; }
""" + remove + '\ntrap remove_rollback EXIT\n' + handlers + 'kill -s ' + signal + ' "$$"\n'
                        result, events, files = self.shell(body)
                        self.assertIn('systemctl start gobadminton-slot@slot1.service', events)
                        self.assertNotIn('legacy start', events)
                    self.assertEqual(result.returncode, code, result.stderr)
                    self.assertEqual(files['legacy/state.json'], b'{"active": null, "done": [30]}')

    def test_failed_migration_install_resumes_untouched_legacy_and_keeps_backup(self):
        result, events, files = self.shell('''
DONE_STARTED=0 LEGACY_STOPPED=1 LEGACY_ENABLED=enabled LEGACY_MIGRATION_STARTED=1
UNITS_CHANGED=0 ETC_CHANGED=0 GROUP_CREATED=0
printf 'tombstone\n' > "$L_STATE/RETIRED_TO_SLOT.json"
printf 'partial state\n' > "$VAR/slots/slot1/partial"
restore_units() { return 0; }
trap rollback EXIT
exit 17
''')
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertNotIn('legacy/RETIRED_TO_SLOT.json', files)
        self.assertEqual(files['legacy/state.json'], b'{"active": null, "done": [30]}')
        self.assertIn('legacy start', events)
        self.assertTrue(any(p.startswith('backup/') and p.endswith('/partial') for p in files))

    def test_failed_activation_restores_capacity_and_keeps_slot2_checkpoint(self):
        body = '''
printf '{"schema":"GB_SLOT_SUPERVISOR_V1","slots":["slot1","slot2"],"max_parallel":1}\n' > "$ETC/supervisor.json"
slot2_readiness() { return 0; }
systemctl() {
    printf '%s\n' "systemctl $*" >> "$TEST_ROOT/events"
    case "$1" in
        is-enabled) printf 'disabled\n' ;;
        is-active) printf 'inactive\n' ;;
        enable)
            if [[ $* == *--now*gobadminton-slot@slot2.service* ]]; then
                printf '{"active":null,"done":[41]}\n' > "$VAR/slots/slot2/state.json"
                touch "$VAR/slots/slot2/worker.lock"
                return 1
            fi ;;
    esac
}
''' + ACTIVATION
        result, events, files = self.shell(body)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(files['etc/supervisor.json'])['max_parallel'], 1)
        self.assertEqual(files['var/slots/slot2/state.json'], b'{"active":null,"done":[41]}\n')
        self.assertIn('activation rolled back', events)

    def test_failed_activation_with_claim_retains_two_slots_and_all_history(self):
        body = '''
printf '{"slots":["slot1","slot2"],"max_parallel":1}\n' > "$ETC/supervisor.json"
slot2_readiness() { return 0; }
systemctl() {
    printf '%s\n' "systemctl $*" >> "$TEST_ROOT/events"
    case "$1" in
        is-enabled) printf 'disabled\n' ;;
        is-active) printf 'inactive\n' ;;
        enable)
            if [[ $* == *--now*gobadminton-slot@slot2.service* ]]; then
                printf '{"active":{"phase":"blocked","issue":41,"attempt":2,"history":[1]},"done":[30]}\n' > "$VAR/slots/slot2/state.json"
                return 1
            fi ;;
    esac
}
''' + ACTIVATION
        result, events, files = self.shell(body)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads(files['etc/supervisor.json'])['max_parallel'], 2)
        self.assertIn('"history":[1]', files['var/slots/slot2/state.json'].decode())
        self.assertIn('rollback HELD', events)
        self.assertNotIn('disable --now gobadminton-slot@slot2.service', events)



    def test_existing_users_require_exact_identity_and_scope(self):
        import pwd, grp, sys
        code = ACT_HELPERS.split("<<'PYACCOUNTS'\n", 1)[1].split('\nPYACCOUNTS', 1)[0]
        for scenario in ('expected', 'home', 'uid', 'extra_group'):
            with self.subTest(scenario=scenario):
                users = [types.SimpleNamespace(pw_name='gb-slot2', pw_uid=978, pw_gid=968,
                    pw_dir='/srv/gb-slots/slot2/home', pw_shell='/usr/sbin/nologin'),
                    types.SimpleNamespace(pw_name='gb-supervisor', pw_uid=979, pw_gid=969,
                    pw_dir='/nonexistent', pw_shell='/usr/sbin/nologin')]
                groups = [types.SimpleNamespace(gr_name=u.pw_name, gr_gid=u.pw_gid, gr_mem=[]) for u in users]
                if scenario == 'home': users[0].pw_dir = '/foreign'
                if scenario == 'uid': users[0].pw_uid = 1001
                if scenario == 'extra_group':
                    groups.append(types.SimpleNamespace(gr_name='foreign', gr_gid=2000, gr_mem=['gb-slot2']))
                with patch.object(sys, 'argv', ['-', '/srv/gb-slots']), \
                        patch.object(pwd, 'getpwall', return_value=users), \
                        patch.object(pwd, 'getpwnam', side_effect=lambda n: next(u for u in users if u.pw_name == n)), \
                        patch.object(grp, 'getgrall', return_value=groups), \
                        patch.object(grp, 'getgrnam', side_effect=lambda n: next(g for g in groups if g.gr_name == n)), \
                        patch.object(grp, 'getgrgid', side_effect=lambda n: next(g for g in groups if g.gr_gid == n)), \
                        contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    if scenario == 'expected': exec(compile(code, '<account-fixture>', 'exec'), {})
                    else:
                        with self.assertRaises(SystemExit) as result:
                            exec(compile(code, '<account-fixture>', 'exec'), {})
                        self.assertEqual(result.exception.code, 1)

    def test_idle_guard_rejects_malformed_or_symlink_checkpoint(self):
        for state in ('{}', '{"active":{"phase":"unknown","issue":147},"done":[]}'):
            result, events, files = self.shell(f"""printf '%s\\n' '{state}' > "$L_STATE/state.json"
idle_of "$L_STATE"
""")
            self.assertNotEqual(result.returncode, 0)
        result, _, _ = self.shell('rm "$L_STATE/state.json"\nln -s "$VAR/slots/slot1/state.json" "$L_STATE/state.json"\nidle_of "$L_STATE"')
        self.assertNotEqual(result.returncode, 0)

    def test_active_issue147_prevents_install_before_legacy_stop_and_dry_fails(self):
        section = '# 2. read-only guards;' + INSTALLER.split('# 2. read-only guards;', 1)[1].split('logl "install start', 1)[0]
        for dry in ('0', '1'):
            body = '''
DRY=$TEST_DRY
printf '{"active":{"phase":"candidate","issue":147},"done":[30]}\n' > "$L_STATE/state.json"
''' + section + '\nluctl stop should-never-run\n'
            result, events, _ = self.shell(body, TEST_DRY=dry)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn('legacy stop', events)
            self.assertIn('Установка только между задачами', events if dry == '0' else result.stdout)



    def test_failed_remove_restores_slots_without_starting_stale_legacy(self):
        remove = '  remove_rollback() {' + INSTALLER.split('  remove_rollback() {', 1)[1].split("  trap 'remove_rollback;", 1)[0]
        body = '''
REMOVE_STOPPED=1 REMOVE_LEGACY_START=0 REMOVE_CONFIG_RESTORED=0 REMOVE_LIBRARY_STARTED=0
REMOVE_DIRS_MOVED=()
REMOVE_UNITS=(gobadminton-supervisor.service gobadminton-slot@slot1.service gobadminton-slot@slot2.service)
REMOVE_ACTIVE=(active active inactive)
REMOVE_ENABLED=(enabled enabled disabled)
REMOVE_LEGACY_ENABLED=disabled
restore_units() { say restored-units; }
''' + remove + '\ntrap remove_rollback EXIT\nexit 19\n'
        result, events, files = self.shell(body)
        self.assertEqual(result.returncode, 19, result.stderr)
        self.assertIn('restored-units', events)
        self.assertIn('systemctl start gobadminton-slot@slot1.service', events)
        self.assertNotIn('legacy start', events)
        self.assertEqual(files['var/slots/slot1/state.json'], files['legacy/state.json'])


if __name__ == '__main__':
    unittest.main()
