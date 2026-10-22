"""Whole-client Linux boundary for bounded native provider qualification.

Not a launcher, scheduler or admission. Trusted caller supplies exact roots; this
only restricts its child. No host settings, userns/AppArmor or parent changes.
"""
import ctypes
import errno
import os
from pathlib import Path
import platform
import stat


class GuardError(RuntimeError):
    pass


def need(ok, why):
    if not ok:
        raise GuardError(why)


def _landlock(readonly, writable, executables):
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.syscall(444, 0, 0, 1) >= 3, 'Landlock ABI >=3 required')
    rights = (1 << 15) - 1
    ruleset = ctypes.c_uint64(rights)
    fd = libc.syscall(444, ctypes.byref(ruleset), ctypes.sizeof(ruleset), 0)
    need(fd >= 0, 'Landlock ruleset failed')
    class Beneath(ctypes.Structure):
        _pack_ = 1
        _fields_ = [('access', ctypes.c_uint64), ('parent', ctypes.c_int32)]
    # Read roots do not imply executable permission. Writable roots cannot make
    # symlinks, sockets/devices/FIFOs, perform cross-directory links, or execute.
    read = (1 << 2) | (1 << 3)
    write = rights & ~sum(1 << bit for bit in (0, 6, 9, 10, 11, 12, 13))
    try:
        for paths, access in ((readonly, read), (writable, write), (executables, (1 << 0) | (1 << 2))):
            for path in paths:
                target = Path(path).resolve(strict=True)
                need(target != Path('/'), 'root filesystem cannot be exposed')
                handle = os.open(target, os.O_PATH | os.O_CLOEXEC)
                try:
                    mode = os.fstat(handle).st_mode
                    mask = access if stat.S_ISDIR(mode) else access & ((1 << 0) | (1 << 1) | (1 << 2) | (1 << 14))
                    need(mask and (stat.S_ISDIR(mode) or stat.S_ISREG(mode) or str(target) in ('/dev/null', '/dev/urandom', '/dev/random')), 'unsupported sandbox root')
                    rule = Beneath(mask, handle)
                    need(libc.syscall(445, fd, 1, ctypes.byref(rule), 0) == 0, 'Landlock rule failed')
                finally:
                    os.close(handle)
        need(libc.prctl(38, 1, 0, 0, 0) == 0, 'no_new_privs failed')
        need(libc.syscall(446, fd, 0) == 0, 'Landlock enforcement failed')
    finally:
        os.close(fd)


def _seccomp():
    """x86_64: permit threads, refuse subprocesses and sibling inspection.

    clone3 returns ENOSYS so libc can use its inspectable clone fallback. No
    generic /proc read grant is required and inherited descriptors stay closed.
    """
    need(platform.machine() == 'x86_64', 'unqualified seccomp architecture')
    class Filter(ctypes.Structure):
        _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte),
                    ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint32)]
    class Program(ctypes.Structure):
        _fields_ = [('length', ctypes.c_ushort), ('filters', ctypes.POINTER(Filter))]
    LD, JEQ, JSET, RET = 0x20, 0x15, 0x45, 0x06
    ALLOW, KILL, ERROR = 0x7fff0000, 0x80000000, 0x00050000
    rules = [(LD, 0, 0, 4), (JEQ, 1, 0, 0xc000003e), (RET, 0, 0, KILL),
             (LD, 0, 0, 0), (JSET, 0, 1, 0x40000000), (RET, 0, 0, KILL),
             (JEQ, 0, 4, 56), (LD, 0, 0, 16), (JSET, 0, 1, 0x10000),
             (RET, 0, 0, ALLOW), (RET, 0, 0, ERROR | errno.EPERM)]
    denied = {57: errno.EPERM, 58: errno.EPERM, 435: errno.ENOSYS,
              101: errno.EPERM, 165: errno.EPERM, 166: errno.EPERM,
              250: errno.EPERM, 272: errno.EPERM, 298: errno.EPERM,
              303: errno.EPERM, 304: errno.EPERM, 308: errno.EPERM,
              310: errno.EPERM, 311: errno.EPERM, 312: errno.EPERM,
              321: errno.EPERM, 322: errno.EPERM, 425: errno.EPERM,
              426: errno.EPERM, 427: errno.EPERM, 438: errno.EPERM}
    for number, error in denied.items():
        rules.extend([(JEQ, 0, 1, number), (RET, 0, 0, ERROR | error)])
    rules.append((RET, 0, 0, ALLOW))
    array = (Filter * len(rules))(*(Filter(*r) for r in rules))
    program = Program(len(rules), array)
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.prctl(38, 1, 0, 0, 0) == 0, 'no_new_privs failed')
    need(libc.prctl(22, 2, ctypes.byref(program)) == 0, 'seccomp enforcement failed')


def restrict(readonly, writable, executables):
    """Use only as trusted Popen preexec_fn, with close_fds and a fresh session."""
    _landlock(readonly, writable, executables)
    _seccomp()


CURSOR_PIN = Path('/opt/gobadminton-cursor-cli/2026.10.01-e373342')
BWRAP_SHA256 = 'e318903862396f96de3df57264e0158682b952fd3fb53ac23d876413e7b30f71'


def cursor_namespace_argv(base, command):
    """Whole-client empty-root boundary compatible with native mount sandbox.

    Qualification only: no provider registration or admission. No host HOME,
    controller/state, Git/SSH/deploy credentials, Docker socket or other project
    mounts. All descendants inherit the private mount/PID namespaces. Native
    Cursor sandbox and executable-specific AppArmor remain enabled. Provider
    transport uses the existing network; tool network qualification is separate.
    """
    import hashlib
    base = Path(base)
    need(os.geteuid() == 1002, 'Cursor qualification requires UID1002')
    need(base.is_absolute() and base.parent == Path('/tmp')
         and base.name.startswith('gb-cursor-211-'), 'unqualified Cursor private root')
    for path in (base, *(base / name for name in ('home', 'config', 'data', 'cache', 'tmp', 'work'))):
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.geteuid()
             and info.st_mode & 0o077 == 0, 'Cursor root must be private and not a symlink')
    for path in (CURSOR_PIN, *CURSOR_PIN.parents):
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0
             and not info.st_mode & 0o022, 'untrusted Cursor installation')
    bwrap = CURSOR_PIN/'gb-bwrap'
    info = bwrap.lstat()
    need(stat.S_ISREG(info.st_mode) and info.st_uid == 0
         and info.st_nlink == 1 and not info.st_mode & 0o7022 and hashlib.sha256(bwrap.read_bytes()).hexdigest() == BWRAP_SHA256,
         'unreviewed namespace helper')
    try:
        caps = os.getxattr(bwrap, 'security.capability', follow_symlinks=False)
    except OSError as e:
        need(e.errno in (61, 95), 'cannot verify namespace helper capabilities'); caps = b''
    need(not caps, 'namespace helper capabilities refused')
    need(isinstance(command, list) and command and command[0] in
         (str(CURSOR_PIN/'node'), str(CURSOR_PIN/'cursorsandbox')), 'unqualified native executable')
    argv = [str(bwrap), '--unshare-all', '--share-net', '--die-with-parent',
            '--new-session', '--cap-drop', 'ALL', '--tmpfs', '/tmp',
            '--proc', '/proc', '--dev', '/dev', '--dir', '/usr', '--dir', '/usr/bin',
            '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
            '--symlink', 'usr/lib64', '/lib64']
    # Libraries and exact runtime files only; never bind /, /etc, /home, /srv,
    # /run, /var or the actual provider credential store.
    for name in ('/usr/lib', '/usr/lib64', '/usr/bin/true', '/etc/ld.so.cache',
                 '/etc/ssl/openssl.cnf', '/etc/ssl/certs', '/etc/resolv.conf',
                 '/etc/hosts', '/etc/nsswitch.conf', '/etc/gai.conf'):
        if Path(name).exists():
            argv += ['--ro-bind', name, name]
    argv += ['--ro-bind', str(CURSOR_PIN), str(CURSOR_PIN),
             '--ro-bind', str(base/'config'), str(base/'config')]
    for name in ('home', 'data', 'cache', 'tmp', 'work'):
        argv += ['--bind', str(base/name), str(base/name)]
    return argv + ['--chdir', str(base/'work'), '--', *command]


def no_new_privileges():
    libc = ctypes.CDLL(None, use_errno=True)
    need(libc.prctl(38, 1, 0, 0, 0) == 0, 'no_new_privs failed')
