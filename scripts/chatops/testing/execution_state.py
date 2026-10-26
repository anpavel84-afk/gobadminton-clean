"""Small external journal and Linux process identities for the offline runner."""
import ctypes
import json
import os
from pathlib import Path
import signal
import sys
import uuid

from safe_io import check_regular, directory, regular

MISSING = object()
MAX_RECORD_BYTES = 4096


class BoundaryUnavailable(Exception):
    pass


class RecordCorrupt(Exception):
    pass


def validate_record(value, *, marker=False):
    fields = {"dev", "ino", "uid"} if marker else {"pgid", "start", "boot", "pending"}
    valid = type(value) is dict and value.keys() == fields
    if valid and marker:
        valid = all(type(value[key]) is int and value[key] >= 0 for key in fields)
    elif valid:
        valid = (all(type(value[key]) is int and value[key] > 0 for key in ("pgid", "start"))
                 and type(value["boot"]) is str and bool(value["boot"])
                 and type(value["pending"]) is bool)
    if not valid:
        raise RecordCorrupt()


def unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise RecordCorrupt()
        value[key] = item
    return value


def read_record(path, *, marker=False):
    try:
        with directory(path.parent) as parent:
            try:
                fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=parent)
            except FileNotFoundError:
                return MISSING  # Only absence of this exact no-follow name is absence.
            try:
                check_regular(os.fstat(fd), "UNSAFE_FILE", private=True)
                if os.fstat(fd).st_size > MAX_RECORD_BYTES:
                    raise RecordCorrupt()
                with os.fdopen(os.dup(fd), "rb") as stream:
                    data = stream.read(MAX_RECORD_BYTES + 1)
                if len(data) > MAX_RECORD_BYTES:
                    raise RecordCorrupt()
                value = json.loads(data, object_pairs_hook=unique_object)
                validate_record(value, marker=marker)
                return value
            finally:
                os.close(fd)
    except (OSError, ValueError, UnicodeError, RecursionError) as exc:
        raise RecordCorrupt() from exc


def write_record(path, value, *, marker=False):
    validate_record(value, marker=marker)
    with directory(path.parent) as parent:
        # An existing corrupt destination must survive even a replacement attempt.
        read_record(path, marker=marker)
        name = path.name + "." + uuid.uuid4().hex + ".new"
        try:
            with regular(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                         dir_fd=parent, private=True) as fd:
                with os.fdopen(os.dup(fd), "w") as stream:
                    json.dump(value, stream, sort_keys=True)
                    stream.flush()
                    os.fsync(stream.fileno())
            # Refuse symlinks and unrelated non-regular destinations too.
            read_record(path, marker=marker)
            os.replace(name, path.name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
        finally:
            try:
                os.unlink(name, dir_fd=parent)
            except FileNotFoundError:
                pass


def clear_record(path):
    with directory(path.parent) as parent:
        if read_record(path) is MISSING:
            return
        os.unlink(path.name, dir_fd=parent)
        os.fsync(parent)


def boot_id():
    try:
        value = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        if not value:
            raise ValueError("empty boot id")
        return value
    except (OSError, ValueError) as exc:
        raise BoundaryUnavailable() from exc


def proc_stat(pid):
    # comm may contain spaces and parentheses; fields after its LAST ')' are fixed.
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return dict(status=fields[0], pgid=int(fields[2]), start=int(fields[19]))


def identity(pid):
    try:
        return dict(pgid=pid, start=proc_stat(pid)["start"], boot=boot_id())
    except (OSError, ValueError, IndexError) as exc:
        raise BoundaryUnavailable() from exc


def group_alive(record):
    try:
        pgid, start = record["pgid"], record["start"]
        if type(pgid) is not int or pgid <= 0 or type(start) is not int or start <= 0:
            raise ValueError("bad process identity")
        if boot_id() != record["boot"]:
            return False
        try:
            if proc_stat(pgid)["start"] != start:
                return False  # PID reuse, not the recorded execution.
        except FileNotFoundError:
            pass  # Leader may be reaped while descendants still occupy its group.
        for entry in Path("/proc").iterdir():
            if entry.name.isdecimal():
                try:
                    member = proc_stat(int(entry.name))
                except FileNotFoundError:
                    continue
                if (member["pgid"] == pgid and member["start"] >= start
                        and member["status"] not in {"Z", "X"}):
                    return True
        return False
    except (OSError, ValueError, IndexError, KeyError, TypeError) as exc:
        raise BoundaryUnavailable() from exc


def parent_death_signal(parent_pid):
    """Best effort only: journal/group checks provide correctness without prctl."""
    try:
        ctypes.CDLL(None, use_errno=True).prctl(1, signal.SIGKILL, 0, 0, 0)
    except Exception:
        pass
    if os.getppid() != parent_pid:
        os.kill(os.getpid(), signal.SIGKILL)


if __name__ == "__main__":
    # No candidate command runs until its identity is durable. EOF after a runner
    # crash exits without executing, covering the Popen-to-journal crash window.
    gate = int(sys.argv[1])
    allowed = os.read(gate, 1) == b"1"
    os.close(gate)
    if allowed:
        os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
    raise SystemExit(2)
