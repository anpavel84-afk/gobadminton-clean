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
