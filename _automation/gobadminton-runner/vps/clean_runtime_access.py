"""Root-pinned cooperating access to existing Clean runtime, no credentials.

Ordinary private temporary/test roots retain 0700/0600. Shared access exists
only for the fixed runtime and a dedicated group containing exactly its two
authorized control-plane principals. Codex executor mounts remain separate.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import stat

ROOT = Path('/srv/gobadminton-clean/runner')
POLICY = Path('/etc/gobadminton-clean-control-plane/clean-publisher-policy.json')
GROUP = 'gobadminton-clean-control'
OWNER_EVENT = {'comment_id': 6148670164, 'owner_id': 318610566,
               'created_at': '2026-10-13T15:08:14Z',
               'body_sha256': '2d3cf0e888a45546512164372818d19355d1eff519b34648b35e7221d1626751'}
READ_FILES = {'backlog.json', 'state.json', 'config.json', 'progress.json',
              'autopilot-receipt.json', 'autopilot-state.json', 'backlog-sync-state.json',
              'backlog-sync-trust.json', 'backlog-sync-diagnostic.json',
              'source-publication-quarantine.json', 'planner-publication-hooks/context.json'}
WRITE_FILES = {'source-merge-reservation.json', 'planner-publication.lock',
               'backlog-claim.lock', 'backlog-sync.lock'}
PRODUCERS = {'friends-dev-s1-api-20261013-v001', 'radar-dev-map-ui-20261013-v001'}
RECEIPTS = PRODUCERS | {'qa-' + task for task in PRODUCERS}


class AccessHold(RuntimeError):
    pass


def policy():
    """Root authority only; task data/environment cannot enable shared access."""
    for directory in [POLICY.parent, *POLICY.parent.parents]:
        info = directory.lstat()
        if directory.is_symlink() or info.st_uid != 0 or info.st_mode & 0o022:
            raise AccessHold('untrusted root policy directory')
    fd = os.open(POLICY, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                or before.st_mode & 0o022 or not 0 < before.st_size <= 32768):
            raise AccessHold('root publisher policy owner/type/mode/size')
        raw = os.read(fd, 32769)
        after = os.fstat(fd)
        final = POLICY.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if identity(before) != identity(after) or identity(before) != identity(final) or len(raw) != before.st_size:
            raise AccessHold('root publisher policy changed')
    finally:
        os.close(fd)
    def unique(items):
        value = {}
        for key, item in items:
            if key in value:
                raise AccessHold('duplicate root policy field')
            value[key] = item
        return value
    try:
        value = json.loads(raw, object_pairs_hook=unique)
    except (ValueError, UnicodeError) as exc:
        raise AccessHold('invalid root publisher policy') from exc
    validate_authority(value)
    return value


def validate_authority(value, *, group_record=None, accounts=None):
    if (not isinstance(value, dict) or value.get('schema') != 'GBCLEAN_PUBLISH_POLICY_V1'
            or value.get('owner_event') != OWNER_EVENT):
        raise AccessHold('policy is not exact Owner-event-bound Clean authority')
    for key in ('publisher_uid', 'submitter_uid', 'runtime_gid'):
        if type(value.get(key)) is not int or value[key] <= 0:
            raise AccessHold('positive exact principal/group identities required')
    expected = {value['publisher_uid'], value['submitter_uid']}
    if len(expected) != 2:
        raise AccessHold('publisher/submitter separation required')
    if group_record is None or accounts is None:
        import grp
        import pwd
        group_record = grp.getgrgid(value['runtime_gid'])
        accounts = pwd.getpwall()
    if group_record.gr_gid != value['runtime_gid'] or group_record.gr_name != GROUP:
        raise AccessHold('dedicated Clean control group required')
    by_name = {account.pw_name: account for account in accounts}
    if any(name not in by_name for name in group_record.gr_mem):
        raise AccessHold('unknown control group member')
    actual = {by_name[name].pw_uid for name in group_record.gr_mem}
    actual |= {account.pw_uid for account in accounts if account.pw_gid == value['runtime_gid']}
    if actual != expected:
        raise AccessHold('control group must contain exactly publisher and submitter')
    return value


def directory_allowed(path: Path, owner_uid: int) -> bool:
    """Private remains valid anywhere; shared is fixed-root-only and pinned."""
    info = path.lstat()
    if path.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != owner_uid:
        return False
    mode = stat.S_IMODE(info.st_mode)
    if mode == 0o700:
        return True
    if path != ROOT or mode != 0o2770:
        return False
    authority = policy()
    return owner_uid == authority['submitter_uid'] and info.st_gid == authority['runtime_gid']


def file_access(path: Path, requested_mode: int = 0o600):
    """Return (mode,gid) for explicitly shared files; otherwise preserve mode.

Called BEFORE creating atomic temp files. Caller fchown(-1,gid) then fchmod
and replaces atomically. Never make prompts, auth, logs, inbox or code public.
No policy is needed for ordinary tests or the original private runtime mode.
"""
    if not path.is_relative_to(ROOT) or '..' in path.parts:
        return requested_mode, None
    info = ROOT.lstat()
    if stat.S_IMODE(info.st_mode) == 0o700:
        return requested_mode, None
    if ROOT.is_symlink() or stat.S_IMODE(info.st_mode) != 0o2770:
        raise AccessHold('runtime shared directory mode refused')
    authority = policy()
    if (info.st_uid != authority['submitter_uid'] or info.st_gid != authority['runtime_gid']
            or os.geteuid() not in {authority['submitter_uid'], authority['publisher_uid']}):
        raise AccessHold('runtime writer is not one of protected control principals')
    relative = path.relative_to(ROOT).as_posix()
    parts = Path(relative).parts
    shared_read = (relative in READ_FILES or len(parts) == 2 and parts[0] == 'receipts'
                   and parts[1] in {task + '.json' for task in RECEIPTS}
                   or len(parts) == 2 and parts[0] == 'publisher-spool'
                   and parts[1] in {slot + suffix for slot in PRODUCERS | {'main-pm'} for suffix in ('.json', '.bundle')})
    if relative not in WRITE_FILES and not shared_read:
        return requested_mode, None
    for directory in path.parents:
        if directory == ROOT:
            break
        metadata = directory.lstat()
        if (directory.is_symlink() or not stat.S_ISDIR(metadata.st_mode)
                or metadata.st_uid != authority['submitter_uid']
                or metadata.st_gid != authority['runtime_gid'] or metadata.st_mode & 0o007):
            raise AccessHold('shared runtime child directory untrusted')
    if path.is_symlink():
        raise AccessHold('shared control file symlink refused')
    if relative in WRITE_FILES:
        return 0o660, authority['runtime_gid']
    if shared_read:
        return 0o640, authority['runtime_gid']
    return requested_mode, None
