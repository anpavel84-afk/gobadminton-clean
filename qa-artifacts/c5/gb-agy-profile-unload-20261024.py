#!/usr/bin/python3
"""Guarded host OPS script: unload ONLY AppArmor profile `gb-agy-runtime` and park its source file. Prepared for review; NOT applied by its author.

Owner decision (Issue #29): the special AppArmor profile for Antigravity is abandoned (it denied /dev/ptmx for the vendor run_command).
Scope (exactly this and nothing else):
  1. `apparmor_parser -R /etc/apparmor.d/gb-agy-runtime`   (removes that one profile from the kernel)
  2. the source file is moved OUT of /etc/apparmor.d into a root-only backup dir (so boot/`systemctl reload apparmor` never reloads it)
Nothing else changes: global AppArmor (sysctls such as kernel.apparmor_restrict_unprivileged_userns, every other profile, abstractions, caches),
policy.json, canary marker, budgets, slot journals/state, controller code and credentials are only READ. No model call, no network, no GitHub, no PROD.
A before/after manifest of the controller/slot files proves they are byte-identical, and the loaded-profile list must equal the original minus `gb-agy-runtime`.
Any failure after the unload restores the exact file bytes/mode/owner and reloads it (`apparmor_parser -r`), then verifies.
Root usage: /usr/bin/python3 -B /root/gb-agy-profile-unload-20261024.py <dry|apply|verify|rollback>
dry and verify write nothing. apply/rollback hold an flock on this script file (no lock file is created).
"""
import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import subprocess
import sys
sys.dont_write_bytecode = True

PROFILE = 'gb-agy-runtime'
PROFILE_SHA = '771033253ed459b9bcd3617bb5a2b623e4fdbc120bee83d62ea1d591d571c589'
APPARMOR_DIR = pathlib.Path('/etc/apparmor.d')
PROFILE_FILE = APPARMOR_DIR / PROFILE
LOADED = pathlib.Path('/sys/kernel/security/apparmor/profiles')
PARSER = '/usr/sbin/apparmor_parser'
BK = pathlib.Path('/root/gb-agy-profile-unload-backup-20261024')
BK_FILE = BK / PROFILE
JOURNAL = BK / 'journal.json'
RECEIPT = BK / 'receipt.json'
SCHEMA = 'GB_AGY_PROFILE_UNLOAD_V1'
EXPECT_UID = 0
EXPECT_GID = 0
SLOT_UID = 978
PROC = pathlib.Path('/proc')
CONTROLLER_CODE = pathlib.Path('/usr/local/lib/gb-actions-train')
# Asserted byte-identical before/after (read only). Slot1 files are informational: another slot may legitimately run.
ASSERTED = [
    pathlib.Path('/etc/gobadminton-actions-train/policy.json'),
    pathlib.Path('/etc/gobadminton-slots/antigravity-qa.json'),
    pathlib.Path('/etc/gobadminton-slots/budgets.json'),
    pathlib.Path('/var/lib/gobadminton-actions-train/slot2.json'),
    pathlib.Path('/var/lib/gobadminton-autonomy/slots/slot2/state.json'),
]
INFORMATIONAL = [
    pathlib.Path('/var/lib/gobadminton-actions-train/slot1.json'),
    pathlib.Path('/var/lib/gobadminton-autonomy/slots/slot1/state.json'),
]
# metadata only, contents never read
CREDENTIAL_META = [
    pathlib.Path('/srv/gb-slots/slot2/home/.codex/auth.json'),
    pathlib.Path('/srv/gb-slots/slot2/home/.codex/config.toml'),
]
MANUAL = '/usr/bin/python3 -B /root/gb-agy-profile-unload-20261024.py rollback'


class Refused(RuntimeError):
    pass


def need(condition, message):
    if not condition:
        raise Refused(message)


def bytes_sha(raw):
    return hashlib.sha256(raw).hexdigest()


def run(argv, timeout=30):
    done = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, check=False,
                          env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    return done.returncode, done.stdout.decode('utf-8', 'replace'), done.stderr.decode('utf-8', 'replace')


def read_regular(path):
    """Read a regular, non-symlink, single-link file without following links."""
    path = pathlib.Path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
    try:
        info = os.fstat(fd)
        need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, 'unsafe regular file: ' + str(path))
        with os.fdopen(os.dup(fd), 'rb') as stream:
            raw = stream.read()
        after = os.fstat(fd)
        need((info.st_ino, info.st_size, info.st_mtime_ns) == (after.st_ino, after.st_size, after.st_mtime_ns),
             'file changed while reading: ' + str(path))
        return raw, info
    finally:
        os.close(fd)


def file_entry(path, content=True):
    try:
        info = pathlib.Path(path).lstat()
    except FileNotFoundError:
        return None
    need(stat.S_ISREG(info.st_mode), 'not a regular file: ' + str(path))
    entry = {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid, 'size': info.st_size}
    if content:
        raw, _ = read_regular(path)
        entry['sha256'] = bytes_sha(raw)
    return entry


def tree_sha(root):
    root = pathlib.Path(root)
    rows = []
    if not root.is_dir():
        return None
    for current, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if d != '__pycache__')
        for name in sorted(files):
            path = pathlib.Path(current) / name
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode):
                rows.append([str(path.relative_to(root)), 'nonregular'])
                continue
            raw, _ = read_regular(path)
            rows.append([str(path.relative_to(root)), stat.S_IMODE(info.st_mode), info.st_uid, bytes_sha(raw)])
    return bytes_sha(json.dumps(rows, sort_keys=True).encode())


def manifest():
    return {
        'asserted': {str(p): file_entry(p) for p in ASSERTED},
        'controller_code_tree_sha256': tree_sha(CONTROLLER_CODE),
        'credential_metadata_only': {str(p): file_entry(p, content=False) for p in CREDENTIAL_META},
    }


def informational():
    return {str(p): file_entry(p) for p in INFORMATIONAL}


def loaded_profiles():
    raw = LOADED.read_text()
    profiles = {}
    for line in raw.splitlines():
        match = re.fullmatch(r'(.+) \((\w+)\)', line.strip())
        need(match is not None, 'unparseable loaded-profile line')
        profiles[match.group(1)] = match.group(2)
    return profiles


def profiles_sha(profiles):
    return bytes_sha(json.dumps(sorted(profiles.items())).encode())


def confined_or_slot_processes():
    found = []
    for entry in PROC.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            label = (entry / 'attr' / 'current').read_text(errors='replace').strip()
            status = (entry / 'status').read_text(errors='replace')
        except (OSError, ValueError):
            continue
        uid_line = next((line for line in status.splitlines() if line.startswith('Uid:')), 'Uid:')
        uids = uid_line.split()[1:]
        if label.startswith(PROFILE) or str(SLOT_UID) in uids:
            found.append({'pid': int(entry.name), 'label': label, 'uids': uids})
    return found


def apparmor_tree_clean():
    """No other file/dir in /etc/apparmor.d may mention this profile by name (nothing else would reload it)."""
    others = []
    for current, dirs, files in os.walk(APPARMOR_DIR):
        for name in dirs + files:
            path = pathlib.Path(current) / name
            if PROFILE in name and path != PROFILE_FILE:
                others.append(str(path))
    return others


def preflight(applying):
    need(os.geteuid() == EXPECT_UID, 'must run as root')
    need(not BK.exists(), 'backup dir already exists (previous apply/rollback evidence): ' + str(BK))
    need(PROFILE_FILE.exists(), 'profile file absent from ' + str(APPARMOR_DIR))
    raw, info = read_regular(PROFILE_FILE)
    need(bytes_sha(raw) == PROFILE_SHA, 'profile file sha drift')
    need((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (EXPECT_UID, EXPECT_GID, 0o644), 'profile file owner/mode drift')
    text = raw.decode()
    need(len(re.findall(r'(?m)^profile\s+\S+', text)) == 1 and re.search(r'(?m)^profile\s+' + PROFILE + r'\s', text),
         'profile file must declare exactly one profile named ' + PROFILE)
    rc, out, err = run([PARSER, '-N', str(PROFILE_FILE)])
    need(rc == 0 and out.split() == [PROFILE], 'apparmor_parser -N must list exactly ' + PROFILE)
    before = loaded_profiles()
    need(before.get(PROFILE) == 'enforce', 'profile not loaded in enforce mode')
    need(not [name for name in before if name.startswith(PROFILE + '//')], 'unexpected child profiles')
    need(not apparmor_tree_clean(), 'other apparmor.d entries mention the profile')
    procs = confined_or_slot_processes()
    need(not procs, 'quiescence refused: processes under the profile or uid %d: %s' % (SLOT_UID, procs[:5]))
    need(not BK.exists(), 'backup dir already exists (previous apply/rollback evidence): ' + str(BK))
    return {'profiles_before': before, 'manifest': manifest(), 'informational': informational(),
            'profile_bytes': raw, 'profile_meta': {'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid}}


def self_sha():
    return bytes_sha(pathlib.Path(__file__).read_bytes())


def plan_view(state, applying):
    others = {k: v for k, v in state['profiles_before'].items() if k != PROFILE}
    return {
        'status': 'DRY_RUN_PASS', 'script_sha256': self_sha(), 'schema': SCHEMA,
        'actions': ['apparmor_parser -R ' + str(PROFILE_FILE), 'move ' + str(PROFILE_FILE) + ' -> ' + str(BK_FILE) + ' (backup then unlink)'],
        'profile': PROFILE, 'profile_sha256': PROFILE_SHA, 'profile_mode_before': state['profiles_before'][PROFILE],
        'loaded_profiles_before': len(state['profiles_before']), 'loaded_profiles_after_expected': len(others),
        'other_profiles_sha256_unchanged_expected': profiles_sha(others),
        'asserted_manifest_sha256': bytes_sha(json.dumps(state['manifest'], sort_keys=True).encode()),
        'controller_code_tree_sha256': state['manifest']['controller_code_tree_sha256'],
        'policy_sha256': (state['manifest']['asserted'].get(str(ASSERTED[0])) or {}).get('sha256'),
        'marker_sha256': (state['manifest']['asserted'].get(str(ASSERTED[1])) or {}).get('sha256'),
        'budgets_sha256': (state['manifest']['asserted'].get(str(ASSERTED[2])) or {}).get('sha256'),
        'global_apparmor_untouched': True, 'userns_restriction_untouched': True, 'protected_writes': 0, 'model_calls': 0,
        'backup_dir_would_be': str(BK), 'quiescent': 'PASS',
        'writes_in_dry_run': 0,
    }


def dry():
    state = preflight(False)
    return plan_view(state, False)


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_exact(path, data, mode, uid, gid):
    path = pathlib.Path(path)
    tmp = path.with_name('.' + path.name + '.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        os.write(fd, data)
        os.fchmod(fd, mode)
        os.fchown(fd, uid, gid)
        os.fsync(fd)
    except BaseException:
        os.close(fd)
        os.unlink(tmp)
        raise
    os.close(fd)
    os.rename(tmp, path)
    fsync_dir(path.parent)


def journal(phase, **extra):
    record = {'schema': SCHEMA, 'phase': phase, 'script_sha256': self_sha(), 'profile': PROFILE, 'profile_sha256': PROFILE_SHA}
    record.update(extra)
    write_exact(JOURNAL, json.dumps(record, sort_keys=True).encode(), 0o600, EXPECT_UID, EXPECT_GID)


def restore(state_before, reason):
    """Put back exact bytes/mode/owner, reload, verify. Returns True on verified restore."""
    try:
        if not PROFILE_FILE.exists():
            raw, _ = read_regular(BK_FILE)
            need(bytes_sha(raw) == PROFILE_SHA, 'backup sha mismatch')
            meta = json.loads(JOURNAL.read_text())['profile_meta']
            write_exact(PROFILE_FILE, raw, meta['mode'], meta['uid'], meta['gid'])
        rc, out, err = run([PARSER, '-r', str(PROFILE_FILE)])
        need(rc == 0, 'apparmor_parser -r failed: ' + err[:200])
        now = loaded_profiles()
        need(now.get(PROFILE) == 'enforce', 'profile not reloaded in enforce mode')
        if state_before is not None:
            need(now == state_before['profiles_before'], 'loaded profile list differs from original after restore')
        raw, info = read_regular(PROFILE_FILE)
        need(bytes_sha(raw) == PROFILE_SHA and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (EXPECT_UID, EXPECT_GID, 0o644), 'restored file mismatch')
        write_exact(RECEIPT, json.dumps({'schema': SCHEMA, 'status': 'ROLLED_BACK', 'reason': reason, 'script_sha256': self_sha(),
                                         'profile_sha256': PROFILE_SHA}, sort_keys=True).encode(), 0o600, EXPECT_UID, EXPECT_GID)
        return True
    except BaseException as exc:  # noqa: BLE001 - report, never mask
        sys.stderr.write('RESTORE FAILED: %s: %s\nMANUAL: %s\n' % (type(exc).__name__, exc, MANUAL))
        try:
            journal('restore_failed', reason=reason)
        except BaseException:  # noqa: BLE001
            pass
        return False


def postconditions(state):
    after = loaded_profiles()
    need(PROFILE not in after, 'profile still loaded')
    expected = {k: v for k, v in state['profiles_before'].items() if k != PROFILE}
    need(after == expected, 'other loaded profiles changed')
    need(not PROFILE_FILE.exists(), 'profile file still present in /etc/apparmor.d')
    need(not apparmor_tree_clean(), 'apparmor.d mentions profile')
    need(manifest() == state['manifest'], 'controller/slot manifest changed')
    raw, _ = read_regular(BK_FILE)
    need(bytes_sha(raw) == PROFILE_SHA, 'backup sha mismatch')
    return after


def apply():
    state = preflight(True)
    os.mkdir(BK, 0o700)
    os.chmod(BK, 0o700)
    write_exact(BK_FILE, state['profile_bytes'], 0o600, EXPECT_UID, EXPECT_GID)
    journal('backed_up', profile_meta=state['profile_meta'], profiles_before_sha256=profiles_sha(state['profiles_before']))
    try:
        rc, out, err = run([PARSER, '-R', str(PROFILE_FILE)])
        need(rc == 0, 'apparmor_parser -R failed: ' + err[:200])
        journal('unloaded', profile_meta=state['profile_meta'])
        raw, _ = read_regular(BK_FILE)
        need(bytes_sha(raw) == PROFILE_SHA, 'backup sha mismatch before removal')
        os.unlink(PROFILE_FILE)
        fsync_dir(APPARMOR_DIR)
        journal('file_moved', profile_meta=state['profile_meta'])
        after = postconditions(state)
        receipt = {'schema': SCHEMA, 'status': 'APPLIED', 'script_sha256': self_sha(), 'profile_sha256': PROFILE_SHA,
                   'profiles_after': after, 'profiles_after_sha256': profiles_sha(after),
                   'asserted_manifest_sha256': bytes_sha(json.dumps(state['manifest'], sort_keys=True).encode()),
                   'informational_before': state['informational'], 'backup': str(BK_FILE), 'model_calls': 0,
                   'rollback': MANUAL}
        write_exact(RECEIPT, json.dumps(receipt, sort_keys=True).encode(), 0o600, EXPECT_UID, EXPECT_GID)
        journal('applied', profile_meta=state['profile_meta'])
        return {'status': 'APPLIED', 'receipt': str(RECEIPT), 'profiles_after': len(after), 'script_sha256': self_sha()}
    except BaseException as exc:  # noqa: BLE001
        ok = restore(state, '%s: %s' % (type(exc).__name__, exc))
        raise Refused('apply failed (%s); %s' % (exc, 'rolled back and verified' if ok else 'ROLLBACK FAILED - run: ' + MANUAL)) from None


def rollback():
    need(os.geteuid() == EXPECT_UID, 'must run as root')
    need(BK.is_dir() and JOURNAL.exists(), 'no apply evidence to roll back')
    ok = restore(None, 'manual rollback')
    need(ok, 'rollback failed')
    return {'status': 'ROLLED_BACK', 'profile_loaded': True}


def verify():
    loaded = loaded_profiles()
    result = {'script_sha256': self_sha(), 'profile_loaded': PROFILE in loaded, 'profile_file_present': PROFILE_FILE.exists(),
              'backup_present': BK_FILE.exists(), 'loaded_profiles': len(loaded)}
    if RECEIPT.exists():
        receipt = json.loads(RECEIPT.read_text())
        result['receipt_status'] = receipt.get('status')
        if receipt.get('status') == 'APPLIED':
            need(PROFILE not in loaded and not PROFILE_FILE.exists(), 'receipt APPLIED but profile present')
            need(profiles_sha(loaded) == receipt['profiles_after_sha256'], 'loaded profiles differ from receipt')
            raw, _ = read_regular(BK_FILE)
            need(bytes_sha(raw) == PROFILE_SHA, 'backup sha mismatch')
    result['status'] = 'VERIFY_PASS'
    return result


def main(argv):
    need(len(argv) == 2 and argv[1] in ('dry', 'apply', 'verify', 'rollback'), 'usage: dry|apply|verify|rollback')
    mode = argv[1]
    need(os.geteuid() == EXPECT_UID, 'must run as root')
    with open(__file__, 'rb') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refused('another instance holds the script lock') from None
        result = {'dry': dry, 'apply': apply, 'verify': verify, 'rollback': rollback}[mode]()
    print(json.dumps(result, sort_keys=True, indent=1))


if __name__ == '__main__':
    try:
        main(sys.argv)
    except (Refused, OSError, ValueError, subprocess.SubprocessError) as exc:
        print(json.dumps({'status': 'REFUSED', 'reason': '%s: %s' % (type(exc).__name__, exc)}, sort_keys=True))
        sys.exit(2)
