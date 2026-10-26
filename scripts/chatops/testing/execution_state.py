"""Small external journal and Linux process identities for the offline runner."""
import ctypes
import json
import os
from pathlib import Path
import signal
import sys
import uuid

from safe_io import directory, regular


class BoundaryUnavailable(Exception):
    pass


def read_record(path):
    with directory(path.parent) as parent:
        try:
            with regular(path.name, dir_fd=parent, private=True) as fd:
                with os.fdopen(os.dup(fd), "r") as stream:
                    return json.load(stream)
        except FileNotFoundError:
            return None


def write_record(path, value):
    with directory(path.parent) as parent:
        name = path.name + "." + uuid.uuid4().hex + ".new"
        try:
            with regular(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                         dir_fd=parent, private=True) as fd:
                with os.fdopen(os.dup(fd), "w") as stream:
                    json.dump(value, stream, sort_keys=True)
                    stream.flush()
                    os.fsync(stream.fileno())
            # Refuse symlinks and unrelated non-regular destinations too.
            read_record(path)
            os.replace(name, path.name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
        finally:
            try:
                os.unlink(name, dir_fd=parent)
            except FileNotFoundError:
                pass


def clear_record(path):
    with directory(path.parent) as parent:
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
