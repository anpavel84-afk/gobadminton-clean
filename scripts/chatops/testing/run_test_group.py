"""Blocking offline test execution with content fingerprints and bounded summaries.

QA must invoke the trusted BASE runner and pass its BASE catalog explicitly.
Candidate test code still executes; this script is not a sandbox or admission.
"""
import argparse
from contextlib import contextmanager, nullcontext
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import time
import tempfile
import uuid

from catalog import DEFAULT_CATALOG, load_catalog, unique_object
from run_receipt import SCHEMA as RECEIPT_SCHEMA, valid_receipt
from safe_io import absolute, check_regular, directory, regular

VERSION = "GB_TEST_RUNNER_V1_REPAIR3"
REASONS = {"input_changed", "env_fixed", "flake_probe", "qa_independent_base", "ci_missing"}
EXITS = {"PASS": 0, "FAIL": 1, "ENV_ERROR": 2, "NOT_TESTED": 2, "TIMEOUT": 4}
BASE_ENV = {"PATH", "HOME", "TMPDIR", "LANG"}
ARTIFACT = re.compile(r"[0-9a-f]{64}\.(?:log|lock|json)")


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git_paths(repo, *, tracked=False):
    return set(subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached",
         *([] if tracked else ["--others", "--exclude-standard"])],
        cwd=repo, check=True, capture_output=True, timeout=30,
    ).stdout.split(b"\0")) - {b""}


class BoundaryUnavailable(Exception):
    pass


class Interrupted(Exception):
    pass


def git_dir(repo):
    return Path(subprocess.run(["git", "rev-parse", "--absolute-git-dir"], cwd=repo,
        check=True, capture_output=True, text=True, timeout=30).stdout.strip())


def check_runs_location(repo, runs):
    # Git metadata is outside the worktree inputs, even for a normal .git directory.
    if runs.is_relative_to(repo) and runs != git_dir(repo) / "gb-test-runs":
        raise ValueError("RUNS_DIR_IN_WORKTREE")
    if repo.is_relative_to(runs):
        raise ValueError("BAD_RUNS_DIR")


@contextmanager
def runs_lock(runs):
    # Close, never LOCK_UN: a detached worker inherits this open file description.
    with directory(runs.parent, create=True, code="UNSAFE_RUNS_DIR") as parent:
        with regular(runs.name + ".lock", os.O_RDWR | os.O_CREAT, dir_fd=parent,
                     code="UNSAFE_ARTIFACT", private=True) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield lock


def validate_runs(repo, runs, fd):
    check_runs_location(repo, runs)
    if fd is None:
        return
    info = os.fstat(fd)
    if info.st_uid != os.getuid():
        raise BoundaryUnavailable()
    if info.st_mode & 0o022:
        raise ValueError("UNSAFE_RUNS_DIR")
    for name in os.listdir(fd):
        try:
            info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            continue
        if stat.S_ISDIR(info.st_mode):
            raise ValueError("RUNS_DIR_CONTAINS_SOURCE")
        check_regular(info, "UNSAFE_ARTIFACT", private=True)
        if not ARTIFACT.fullmatch(name):
            raise ValueError("RUNS_DIR_CONTAINS_SOURCE")
        if name.endswith(".json"):
            read_result(Path(name), fd)


@contextmanager
def runs_directory(repo, runs, *, create=False, locked=False):
    check_runs_location(repo, runs)
    with nullcontext() if locked else runs_lock(runs):
        # Recover a crashed runner's 0000 directory only under the external lock.
        with directory(runs.parent, create=create, code="UNSAFE_RUNS_DIR") as parent:
            try:
                info = os.stat(runs.name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError:
                if not create:
                    raise ValueError("RUNS_DIR_UNAVAILABLE") from None
                os.mkdir(runs.name, 0o700, dir_fd=parent)
                info = os.stat(runs.name, dir_fd=parent, follow_symlinks=False)
            if not stat.S_ISDIR(info.st_mode):
                raise ValueError("UNSAFE_RUNS_DIR")
            if info.st_uid != os.getuid():
                raise BoundaryUnavailable()
            if info.st_mode & 0o022:
                raise ValueError("UNSAFE_RUNS_DIR")
            try:
                os.chmod(runs.name, 0o700, dir_fd=parent, follow_symlinks=False)
            except OSError as exc:
                raise BoundaryUnavailable() from exc
        with directory(runs, code="UNSAFE_RUNS_DIR") as fd:
            validate_runs(repo, runs, fd)
            yield fd


@contextmanager
def cache_boundary(runs, fd):
    if os.geteuid() == 0 or os.fstat(fd).st_uid != os.getuid():
        raise BoundaryUnavailable()
    try:
        try:
            os.fchmod(fd, 0o000)
            # Check actual denial, including filesystems that ignore mode bits.
            try:
                probe = os.open(runs, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            except PermissionError:
                pass
            else:
                os.close(probe)
                raise BoundaryUnavailable()
        except OSError as exc:
            raise BoundaryUnavailable() from exc
        yield
    finally:
        try:
            os.fchmod(fd, 0o700)
            if stat.S_IMODE(os.fstat(fd).st_mode) != 0o700:
                raise BoundaryUnavailable()
        except OSError as exc:
            raise BoundaryUnavailable() from exc


def source_entry(path):
    with directory(path.parent, code="SYMLINK_PARENT") as parent:
        try:
            info = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        except FileNotFoundError:
            return "000000", "MISSING"
        if stat.S_ISLNK(info.st_mode):
            return "120000", sha(os.fsencode(os.readlink(path.name, dir_fd=parent)))
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("UNSUPPORTED_WORKTREE_TYPE")
        # fstat provides the mode of the same no-follow descriptor that is read.
        with regular(path.name, dir_fd=parent, code="UNSAFE_WORKTREE_FILE") as fd:
            info = os.fstat(fd)
            file_hash = hashlib.sha256()
            with os.fdopen(os.dup(fd), "rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    file_hash.update(chunk)
        return ("100755" if info.st_mode & 0o111 else "100644"), file_hash.hexdigest()


def worktree_digest(repo, runs_dir, *, runs_fd=None):
    repo, runs_dir = Path(repo).resolve(), absolute(runs_dir)
    check_runs_location(repo, runs_dir)
    paths = git_paths(repo)
    if runs_fd not in (None, -1):
        validate_runs(repo, runs_dir, runs_fd)
    elif runs_fd is None and os.path.lexists(runs_dir):
        with runs_directory(repo, runs_dir):
            pass
    digest = hashlib.sha256()
    for raw_path in sorted(paths):
        relative = os.fsdecode(raw_path)
        path = repo / relative
        try:
            mode, content = source_entry(path)
        except FileNotFoundError:
            # Missing parent of a deleted tracked path.
            mode, content = "000000", "MISSING"
        digest.update(canonical([relative, mode, content]) + b"\n")
    return digest.hexdigest()


def fingerprint(repo, runs_dir, group_id, tests, catalog_bytes, env_flags, *, runs_fd=None):
    value = dict(worktree_digest=worktree_digest(repo, runs_dir, runs_fd=runs_fd), group_id=group_id,
                 tests=tests, catalog_sha256=sha(catalog_bytes), runner_version=VERSION,
                 env_flags={name: bool(os.environ.get(name)) for name in sorted(env_flags)})
    return sha(canonical(value)), value


def evidence_status(results, required_groups):
    if isinstance(results, list):
        # Multiple receipts never hide a FAIL or an inconclusive/missing required result.
        selected = [r.get("status") for r in results if r.get("group") in required_groups]
        found = {r.get("group") for r in results}
    else:
        selected = [results[g].get("status") if isinstance(results[g], dict) else results[g]
                    for g in required_groups if g in results]
        found = set(results)
    if "FAIL" in selected:
        return "FAIL"
    if not set(required_groups) <= found or any(s != "PASS" for s in selected):
        return "NOT_TESTED"
    return "PASS"


def compare_base_head(base_result, head_result):
    base, head = base_result.get("status"), head_result.get("status")
    base_ids = set(base_result.get("failing_test_ids", []))
    head_ids = set(head_result.get("failing_test_ids", []))
    if head == "FAIL":
        if base == "FAIL" and head_ids and base_ids == head_ids:
            return "PRE_EXISTING_FAIL"
        return "FAIL"
    if head == "PASS":
        if base == "FAIL":
            return "PASS_WITH_BASE_FAIL_FIXED"
        return "PASS" if base == "PASS" else "NOT_TESTED"
    return "NOT_TESTED"


def scrubbed_env(flags, runs=None):
    def names_runs(value):
        if runs is None:
            return False
        # Scrub path lists and aliases too, even if explicitly catalog-allowed.
        return str(runs) in value or any(
            absolute(part).resolve().is_relative_to(runs.resolve())
            for part in value.split(os.pathsep) if part)
    return {name: os.environ[name] for name in BASE_ENV | set(flags)
            if name in os.environ and not names_runs(os.environ[name])}


def refuse_runs_inputs(runs, cwd, argv):
    if cwd.resolve().is_relative_to(runs):
        raise ValueError("RUNS_DIR_READ_BY_COMMAND")
    for arg in argv:
        # Include conventional --input=PATH arguments as well as plain paths.
        for part in (arg, arg.split("=", 1)[-1]):
            if (cwd / part).resolve().is_relative_to(runs):
                raise ValueError("RUNS_DIR_READ_BY_COMMAND")


def targeted_argv(group, tests, repo, runs):
    argv = list(group["argv"])
    if group["id"] != "targeted_py":
        if tests:
            raise ValueError("TESTS_ONLY_FOR_TARGETED_PY")
        return argv
    if not tests:
        raise ValueError("TESTS_REQUIRED")
    directory = repo / "scripts/chatops/tests"
    for name in tests:
        refuse_runs_inputs(runs, repo, [name])
        refuse_runs_inputs(runs, directory, [name, name + ".py"])
        if not re.fullmatch(r"test_[A-Za-z0-9_]+", name):
            raise ValueError("BAD_TEST_NAME")
        path = directory / (name + ".py")
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(repo):
            raise ValueError("TEST_NOT_FOUND")
    return argv + tests


def read_result(path, runs_fd):
    try:
        with regular(path.name, dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True) as fd:
            with os.fdopen(os.dup(fd), "rb") as stream:
                try:
                    value = json.load(stream, object_pairs_hook=unique_object)
                    valid = valid_receipt(value, path.stem, VERSION, REASONS)
                except (ValueError, UnicodeError, TypeError):
                    valid = False
                if not valid:
                    raise ValueError("RUNS_DIR_CONTAINS_SOURCE")
                return value
    except FileNotFoundError:
        return None


def write_result(path, result, runs_fd):
    fcntl.flock(runs_fd, fcntl.LOCK_EX)
    try:
        _write_result(path, result, runs_fd)
    finally:
        fcntl.flock(runs_fd, fcntl.LOCK_UN)


def _write_result(path, result, runs_fd):
    temporary = path.name + "." + uuid.uuid4().hex + ".new"
    try:
        with regular(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                     dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True) as fd:
            with os.fdopen(os.dup(fd), "wb") as stream:
                stream.write(canonical(result) + b"\n")
                stream.flush()
                os.fsync(stream.fileno())
    except FileExistsError as exc:
        raise ValueError("UNSAFE_ARTIFACT") from exc
    try:
        try:
            check_regular(os.stat(path.name, dir_fd=runs_fd, follow_symlinks=False),
                          "UNSAFE_ARTIFACT", private=True)
        except FileNotFoundError:
            pass
        os.replace(temporary, path.name, src_dir_fd=runs_fd, dst_dir_fd=runs_fd)
    finally:
        try:
            os.unlink(temporary, dir_fd=runs_fd)
        except FileNotFoundError:
            pass


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def parse_log(path, offset=0, *, runs_fd):
    with regular(path.name, dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True) as fd, \
            os.fdopen(os.dup(fd), "r", encoding="utf-8", errors="replace") as stream:
        return parse_stream(stream, offset)


def parse_stream(stream, offset=0):
    counts = dict(tests=None, failures=0, errors=0)
    failing, infra, verdict = set(), False, None
    stream.seek(offset)
    for line in stream:
        match = re.match(r"Ran (\d+) tests?\b", line)
        if match:
            counts["tests"] = int(match[1])
        match = re.match(r"(?:FAIL|ERROR): (.+)", line)
        if match:
            failing.add(match[1].strip())
        if line.strip() == "OK" or line.startswith("OK ("):
            verdict = "OK"
        if line.startswith("FAILED"):
            verdict = "FAILED"
            for key in ("failures", "errors"):
                match = re.search(key + r"=(\d+)", line)
                if match:
                    counts[key] = int(match[1])
        if re.search(r"ModuleNotFoundError:|ImportError:|PermissionError:|\[Errno (?:2|13)\]|Failed to import test module", line):
            infra = True
    return counts, sorted(failing), infra, verdict


def execute(job, result_path, runs_fd, *, result=None, cache=True):
    result = result if result is not None else read_result(result_path, runs_fd)
    started = time.monotonic()
    status, rc, detail = "ENV_ERROR", None, ""
    boundary_lost = False
    log = result_path.with_suffix(".log")
    log_context = (regular(log.name, os.O_RDWR | os.O_APPEND | os.O_CREAT,
        dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True) if cache else
        tempfile.TemporaryFile(mode="w+b"))
    with log_context as opened:
        log_fd = opened if isinstance(opened, int) else opened.fileno()
        with os.fdopen(os.dup(log_fd), "a+b") as output:
            output.write(("\n=== " + now() + " reason=" + job["reason"] + " ===\n").encode())
            output.flush()
            offset = output.tell()
            if job["kind"] == "ci_only":
                status, detail = "NOT_TESTED", "CI_ONLY"
            elif any(not os.environ.get(name) for name in job["env_flags"]):
                status, detail = "NOT_TESTED", "MISSING_ENV_FLAG"
            else:
                process = None
                def interrupt(signum, frame):
                    raise Interrupted()
                handlers = {sig: signal.signal(sig, interrupt)
                            for sig in (signal.SIGINT, signal.SIGTERM)}
                try:
                    # Open log first; restore mode before parsing or writing anything else.
                    with cache_boundary(result_path.parent, runs_fd) if cache else nullcontext():
                        try:
                            process = subprocess.Popen(job["argv"], cwd=job["cwd"],
                                env=scrubbed_env(job["env_flags"], result_path.parent),
                                stdout=output, stderr=subprocess.STDOUT,
                                stdin=subprocess.DEVNULL, start_new_session=True, close_fds=True)
                            try:
                                rc = process.wait(timeout=job["timeout_s"])
                                status = "PASS" if rc == 0 else "FAIL"
                            except subprocess.TimeoutExpired:
                                status, detail = "TIMEOUT", "TIME_LIMIT"
                        finally:
                            if process is not None and process.poll() is None:
                                os.killpg(process.pid, signal.SIGKILL)
                                process.wait()
                                rc = process.returncode
                except Interrupted:
                    status, detail = "ENV_ERROR", "INTERRUPTED"
                except BoundaryUnavailable:
                    cache = False
                    boundary_lost = True
                    status, detail = "ENV_ERROR", "CACHE_BOUNDARY_UNAVAILABLE"
                    # Do not leave a reusable receipt if restoration failed mid-run.
                    try:
                        os.unlink(result_path.name, dir_fd=runs_fd)
                    except OSError:
                        pass
                    if process is None:
                        # Boundary vanished after preflight: execute once without cache.
                        return execute(job, result_path, None, result=result, cache=False)
                except OSError as exc:
                    detail = type(exc).__name__
                    output.write((detail + ": " + str(exc) + "\n").encode())
                finally:
                    for sig, handler in handlers.items():
                        signal.signal(sig, handler)
            if detail and not boundary_lost:
                output.write((detail + "\n").encode())
            output.flush()
            with os.fdopen(os.dup(log_fd), "r", encoding="utf-8", errors="replace") as stream:
                counts, failing, infra, verdict = parse_stream(stream, offset)
    if status in {"PASS", "FAIL"}:
        if infra and status == "FAIL":
            status, detail = "ENV_ERROR", "IMPORT_OR_INFRA_FAILURE"
        elif verdict == "FAILED":
            status = "FAIL"
        elif counts["tests"] == 0:
            status, detail = "NOT_TESTED", "ZERO_TESTS"
        try:
            if worktree_digest(job["repo"], result_path.parent, runs_fd=runs_fd if cache else -1) != result["inputs"]["worktree_digest"]:
                status, detail = "ENV_ERROR", "WORKTREE_CHANGED_DURING_RUN"
        except (OSError, ValueError, BoundaryUnavailable, subprocess.SubprocessError):
            status, detail = "ENV_ERROR", "WORKTREE_DIGEST_UNAVAILABLE"
    result.update(status=status, rc=rc, detail=detail, duration_s=round(time.monotonic() - started, 3),
                  counts=counts, unittest_verdict=verdict, failing_test_ids=failing, pending=False)
    result["history"].append(dict(reason=job["reason"], time=now(), status=status))
    result.pop("_job", None)
    if cache:
        write_result(result_path, result, runs_fd)
    else:
        result["cache"] = "CACHE_BOUNDARY_UNAVAILABLE"
        result["log_path"] = "not saved (cache boundary unavailable)"
    return result


def summary(result, refused=None):
    # All user/candidate-derived strings are escaped onto one physical line.
    clean = lambda s: str(s).replace("\n", "\\n").replace("\r", "\\r")
    print("group: " + clean(result["group"]))
    print("fingerprint: " + result["fingerprint"][:16])
    print("status: " + ("SAME_FINGERPRINT previous=" + result["status"] +
          " (not re-verified; not evidence)" if refused else result["status"]))
    if result.get("cache"):
        print("cache: " + result["cache"] + " (no receipt)")
    print("rc: " + str(result.get("rc")))
    print("duration_s: " + str(result.get("duration_s", 0)))
    print("counts: " + json.dumps(result.get("counts", {}), sort_keys=True))
    print("unittest: " + str(result.get("unittest_verdict")))
    failing = result.get("failing_test_ids", [])
    for name in failing[:10]:
        print("failing: " + clean(name))
    if len(failing) > 10:
        print("... and " + str(len(failing) - 10) + " more")
    print("log: " + clean(result["log_path"]))
    if refused or result.get("detail"):
        print("reason: " + clean(refused or result["detail"]))
    print("rerun: changed inputs => new fingerprint; same fingerprint requires --repeat-reason "
          "env_fixed|flake_probe|qa_independent_base|ci_missing")


def locations(args):
    repo = Path(args.repo).resolve()
    runs = absolute(args.runs_dir) if args.runs_dir else git_dir(repo) / "gb-test-runs"
    check_runs_location(repo, runs)
    return repo, runs


def run(args):
    if args.repeat_reason is not None and args.repeat_reason not in REASONS:
        raise ValueError("UNKNOWN_REPEAT_REASON")
    repo, runs = locations(args)
    groups, catalog_bytes = load_catalog(args.catalog)
    if args.group not in groups:
        raise ValueError("UNKNOWN_GROUP")
    group = groups[args.group]
    tests = sorted(set(args.tests or []))
    cwd = (repo / group["cwd"]).resolve()
    refuse_runs_inputs(runs, cwd, group["argv"])
    argv = targeted_argv(group, tests, repo, runs)
    if not cwd.is_relative_to(repo):
        raise ValueError("BAD_CWD")
    if tests:
        cwd = repo / "scripts/chatops/tests"
    refuse_runs_inputs(runs, cwd, argv)
    with runs_lock(runs) as boundary_lock:
        try:
            with runs_directory(repo, runs, create=True, locked=True) as runs_fd:
                with cache_boundary(runs, runs_fd):
                    pass  # Prove denial AND restoration before reading any cached outcome.
                fp, inputs = fingerprint(repo, runs, args.group, tests, catalog_bytes,
                                         group["env_flags"], runs_fd=runs_fd)
                return run_locked(args, repo, runs, runs_fd, group, argv, cwd, fp, inputs, boundary_lock)
        except BoundaryUnavailable:
            # No boundary => no cache, no duplicate refusal, no persistent artifact writes.
            fp, inputs = fingerprint(repo, runs, args.group, tests, catalog_bytes,
                                     group["env_flags"], runs_fd=-1)
            job = dict(argv=argv, cwd=str(cwd), repo=str(repo), timeout_s=group["timeout_s"],
                       env_flags=sorted(group["env_flags"]), kind=group["kind"],
                       reason=args.repeat_reason or "initial")
            result = dict(group=args.group, fingerprint=fp, inputs=inputs, history=[], log_path="")
            result = execute(job, runs / (fp + ".json"), None, result=result, cache=False)
            summary(result)
            return EXITS[result["status"]]


def run_locked(args, repo, runs, runs_fd, group, argv, cwd, fp, inputs, boundary_lock):
    result_path = runs / (fp + ".json")
    with regular(fp + ".lock", os.O_RDWR | os.O_CREAT, dir_fd=runs_fd,
                 code="UNSAFE_ARTIFACT", private=True) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_runs(repo, runs, runs_fd)
        previous = read_result(result_path, runs_fd)
        if previous and args.repeat_reason == "input_changed":
            summary(previous, "INPUT_UNCHANGED")
            return 3
        if previous and previous["status"] in {"PASS", "FAIL"}:
            if not args.repeat_reason:
                summary(previous, "SAME_FINGERPRINT")
                return 3
        if previous and previous.get("pending"):
            # Holding the lock proves no worker owns it now; retain the unknown receipt.
            summary(previous, "INCOMPLETE_RUN_REQUIRES_RECONCILIATION")
            return 3
        reason = args.repeat_reason or ("inconclusive_retry" if previous else "initial")
        job = dict(argv=argv, cwd=str(cwd), repo=str(repo), timeout_s=group["timeout_s"],
                   env_flags=sorted(group["env_flags"]), kind=group["kind"], reason=reason)
        result = dict(schema=RECEIPT_SCHEMA, group=args.group, fingerprint=fp, inputs=inputs, status="NOT_TESTED",
                      pending=True, log_path=str(runs / (fp + ".log")),
                      history=previous["history"] if previous else [], _job=job)
        # Reject an unsafe log before recording any pending execution.
        with regular(fp + ".log", os.O_WRONLY | os.O_APPEND | os.O_CREAT,
                     dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True):
            pass
        write_result(result_path, result, runs_fd)
        if args.detach:
            # flock is inherited via the same open file description. Parent CLOSES, never unlocks.
            try:
                subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "_worker",
                                  str(result_path), str(lock), str(runs_fd), str(boundary_lock)],
                                 pass_fds=(lock, runs_fd, boundary_lock), start_new_session=True,
                                 env=scrubbed_env(group["env_flags"]), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                result.update(pending=False, status="ENV_ERROR", detail="WORKER_START_FAILED")
                result.pop("_job", None)
                write_result(result_path, result, runs_fd)
                summary(result)
                return 2
            print("fingerprint: " + fp)
            print("status: DETACHED; collect blocks until completion")
            return 0
        result = execute(job, result_path, runs_fd)
        summary(result)
        return EXITS[result["status"]]


def collect(args):
    if not re.fullmatch(r"[0-9a-f]{64}", args.fingerprint):
        raise ValueError("BAD_FINGERPRINT")
    repo, runs = locations(args)
    with runs_directory(repo, runs) as runs_fd:
        return collect_locked(args, repo, runs, runs_fd)


def collect_locked(args, repo, runs, runs_fd):
    try:
        with regular(args.fingerprint + ".lock", os.O_RDWR,
                     dir_fd=runs_fd, code="UNSAFE_ARTIFACT", private=True) as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            validate_runs(repo, runs, runs_fd)
            result = read_result(runs / (args.fingerprint + ".json"), runs_fd)
    except FileNotFoundError as exc:
        raise ValueError("UNKNOWN_FINGERPRINT") from exc
    if not result:
        raise ValueError("MISSING_RESULT")
    if result.get("pending"):
        result = {**result, "status": "ENV_ERROR", "detail": "INCOMPLETE_RUN_REQUIRES_RECONCILIATION"}
    summary(result)
    return EXITS[result["status"]]


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("run")
    create.add_argument("--group", required=True)
    create.add_argument("--tests", nargs="+")
    create.add_argument("--repeat-reason")
    create.add_argument("--detach", action="store_true")
    create.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    gather = commands.add_parser("collect")
    gather.add_argument("--fingerprint", required=True)
    for command in (create, gather):
        command.add_argument("--repo", default=str(Path(__file__).resolve().parents[3]))
        command.add_argument("--runs-dir")
    worker = commands.add_parser("_worker", help=argparse.SUPPRESS)
    worker.add_argument("result_path")
    worker.add_argument("lock_fd", type=int)
    worker.add_argument("runs_fd", type=int)
    worker.add_argument("boundary_lock_fd", type=int)
    try:
        args = parser.parse_args(argv)
        if args.command == "_worker":
            with os.fdopen(args.boundary_lock_fd, "a+b"), os.fdopen(args.lock_fd, "a+b"):
                check_regular(os.fstat(args.lock_fd), "UNSAFE_ARTIFACT", private=True)
                if not stat.S_ISDIR(os.fstat(args.runs_fd).st_mode):
                    raise ValueError("UNSAFE_RUNS_DIR")
                path = Path(args.result_path)
                if not re.fullmatch(r"[0-9a-f]{64}\.json", path.name):
                    raise ValueError("BAD_FINGERPRINT")
                receipt = read_result(path, args.runs_fd)
                validate_runs(Path(receipt["_job"]["repo"]), path.parent, args.runs_fd)
                refuse_runs_inputs(path.parent, Path(receipt["_job"]["cwd"]), receipt["_job"]["argv"])
                result = execute(receipt["_job"], path, args.runs_fd)
                os.close(args.runs_fd)
            return EXITS[result["status"]]
        return run(args) if args.command == "run" else collect(args)
    except SystemExit as exc:
        return 0 if exc.code == 0 else 3
    except (ValueError, TypeError, KeyError) as exc:
        print("REFUSED: " + str(exc).replace("\n", "\\n")[:200])
        return 3
    except (OSError, subprocess.SubprocessError) as exc:
        print("ENV_ERROR: " + type(exc).__name__)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
