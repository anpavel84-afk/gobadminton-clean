"""Descriptor-relative, no-follow IO for offline tooling (Linux, stdlib only)."""
from contextlib import contextmanager
import errno
import os
from pathlib import Path
import stat


def absolute(path):
    # abspath normalizes without resolving links.
    return Path(os.path.abspath(path))


@contextmanager
def directory(path, *, create=False, code="UNSAFE_DIRECTORY"):
    path = absolute(path)
    fd = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parts[1:]:
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=fd)
                except FileExistsError:
                    pass
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            except OSError as exc:
                if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
                    raise ValueError(code) from exc
                raise
            os.close(fd)
            fd = child
        yield fd
    finally:
        os.close(fd)


def check_regular(info, code, *, private=False):
    if not stat.S_ISREG(info.st_mode) or (private and (
            info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o022)):
        raise ValueError(code)


@contextmanager
def regular(name, flags=os.O_RDONLY, *, dir_fd=None, code="UNSAFE_FILE", private=False):
    # NONBLOCK prevents a swapped FIFO from blocking before fstat can reject it.
    try:
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=dir_fd)
    except OSError as exc:
        if exc.errno in {errno.ELOOP, errno.EISDIR, errno.ENXIO}:
            raise ValueError(code) from exc
        raise
    try:
        check_regular(os.fstat(fd), code, private=private)
        yield fd
    finally:
        os.close(fd)


def read_bytes(path, *, code="UNSAFE_FILE"):
    path = absolute(path)
    with directory(path.parent, code=code) as parent:
        with regular(path.name, dir_fd=parent, code=code) as fd:
            with os.fdopen(os.dup(fd), "rb") as stream:
                return stream.read()
