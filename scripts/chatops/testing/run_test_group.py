"""Blocking offline test execution with content fingerprints and bounded summaries.

QA must invoke the trusted BASE runner and pass its BASE catalog explicitly.
Candidate test code still executes; this script is not a sandbox or admission.
"""
import argparse
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

from catalog import DEFAULT_CATALOG, load_catalog

VERSION = "GB_TEST_RUNNER_V1"
REASONS = {"input_changed", "env_fixed", "flake_probe", "qa_independent_base", "ci_missing"}
EXITS = {"PASS": 0, "FAIL": 1, "ENV_ERROR": 2, "NOT_TESTED": 2, "TIMEOUT": 4}
BASE_ENV = {"PATH", "HOME", "TMPDIR", "LANG"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def sha(data):
    return hashlib.sha256(data).hexdigest()


def worktree_digest(repo, runs_dir):
    repo, runs_dir = Path(repo).resolve(), Path(runs_dir).resolve()
    paths = subprocess.run(
        ["git", "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        cwd=repo, check=True, capture_output=True, timeout=30,
    ).stdout.split(b"\0")
    digest = hashlib.sha256()
    for raw_path in sorted(set(paths) - {b""}):
        relative = os.fsdecode(raw_path)
        path = repo / relative
        if path == runs_dir or runs_dir in path.parents:
            continue
        # Never follow a symlink to read its target, including a parent directory.
        if any(parent.is_symlink() for parent in path.parents if parent != repo and repo in parent.parents):
            raise ValueError("SYMLINK_PARENT")
        try:
            info = path.lstat()
        except FileNotFoundError:
            mode, content = "000000", "MISSING"
        else:
            if stat.S_ISLNK(info.st_mode):
                mode, content = "120000", sha(os.fsencode(os.readlink(path)))
            elif stat.S_ISREG(info.st_mode):
                mode = "100755" if info.st_mode & 0o111 else "100644"
                file_hash = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        file_hash.update(chunk)
                content = file_hash.hexdigest()
            else:
                raise ValueError("UNSUPPORTED_WORKTREE_TYPE")
        digest.update(canonical([relative, mode, content]) + b"\n")
    return digest.hexdigest()


def fingerprint(repo, runs_dir, group_id, tests, catalog_bytes, env_flags):
    value = dict(worktree_digest=worktree_digest(repo, runs_dir), group_id=group_id,
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


def scrubbed_env(flags):
    return {name: os.environ[name] for name in BASE_ENV | set(flags) if name in os.environ}


def targeted_argv(group, tests, repo):
    argv = list(group["argv"])
    if group["id"] != "targeted_py":
        if tests:
            raise ValueError("TESTS_ONLY_FOR_TARGETED_PY")
        return argv
    if not tests:
        raise ValueError("TESTS_REQUIRED")
    directory = repo / "scripts/chatops/tests"
    for name in tests:
        if not re.fullmatch(r"test_[A-Za-z0-9_]+", name):
            raise ValueError("BAD_TEST_NAME")
        path = directory / (name + ".py")
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(repo):
            raise ValueError("TEST_NOT_FOUND")
    return argv + tests


def read_result(path):
    return json.loads(path.read_text()) if path.exists() else None


def write_result(path, result):
    temporary = path.with_suffix(".json.new")
    temporary.write_bytes(canonical(result) + b"\n")
    temporary.replace(path)


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def parse_log(path, offset=0):
    counts = dict(tests=None, failures=0, errors=0)
    failing, infra, verdict = set(), False, None
    with path.open("r", encoding="utf-8", errors="replace") as stream:
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


def execute(job, result_path):
    result = read_result(result_path)
    started = time.monotonic()
    status, rc, detail = "ENV_ERROR", None, ""
    log = Path(result["log_path"])
    with log.open("ab") as output:
        output.write(("\n=== " + now() + " reason=" + job["reason"] + " ===\n").encode())
        output.flush()
        offset = output.tell()
        if job["kind"] == "ci_only":
            status, detail = "NOT_TESTED", "CI_ONLY"
        elif any(not os.environ.get(name) for name in job["env_flags"]):
            status, detail = "NOT_TESTED", "MISSING_ENV_FLAG"
        else:
            try:
                process = subprocess.Popen(job["argv"], cwd=job["cwd"],
                    env=scrubbed_env(job["env_flags"]), stdout=output, stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL, start_new_session=True)
                try:
                    rc = process.wait(timeout=job["timeout_s"])
                    status = "PASS" if rc == 0 else "FAIL"
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    rc = process.wait()
                    status, detail = "TIMEOUT", "TIME_LIMIT"
            except OSError as exc:
                detail = type(exc).__name__
                output.write((detail + ": " + str(exc) + "\n").encode())
        if detail:
            output.write((detail + "\n").encode())
    counts, failing, infra, verdict = parse_log(log, offset)
    if status in {"PASS", "FAIL"}:
        if infra and status == "FAIL":
            status, detail = "ENV_ERROR", "IMPORT_OR_INFRA_FAILURE"
        elif verdict == "FAILED":
            status = "FAIL"
        elif counts["tests"] == 0:
            status, detail = "NOT_TESTED", "ZERO_TESTS"
        try:
            if worktree_digest(job["repo"], result_path.parent) != result["inputs"]["worktree_digest"]:
                status, detail = "ENV_ERROR", "WORKTREE_CHANGED_DURING_RUN"
        except (OSError, ValueError, subprocess.SubprocessError):
            status, detail = "ENV_ERROR", "WORKTREE_DIGEST_UNAVAILABLE"
    result.update(status=status, rc=rc, detail=detail, duration_s=round(time.monotonic() - started, 3),
                  counts=counts, unittest_verdict=verdict, failing_test_ids=failing, pending=False)
    result["history"].append(dict(reason=job["reason"], time=now(), status=status))
    result.pop("_job", None)
    write_result(result_path, result)
    return result


def summary(result, refused=None):
    # All user/candidate-derived strings are escaped onto one physical line.
    clean = lambda s: str(s).replace("\n", "\\n").replace("\r", "\\r")
    print("group: " + clean(result["group"]))
    print("fingerprint: " + result["fingerprint"][:16])
    print("status: " + result["status"] + (" (cached; refused)" if refused else ""))
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
    runs = Path(args.runs_dir).resolve() if args.runs_dir else repo / ".gb-test-runs"
    # Excluding the whole repository or source tree would make the fingerprint meaningless.
    if repo == runs or repo.is_relative_to(runs):
        raise ValueError("BAD_RUNS_DIR")
    if runs.is_relative_to(repo) and runs != repo / ".gb-test-runs":
        if runs.parts[len(repo.parts)] in {"scripts", "apps", "packages", "docs", ".git", ".github", ".cursor"}:
            raise ValueError("BAD_RUNS_DIR")
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
    argv = targeted_argv(group, tests, repo)
    cwd = (repo / group["cwd"]).resolve()
    if not cwd.is_relative_to(repo):
        raise ValueError("BAD_CWD")
    if tests:
        cwd = repo / "scripts/chatops/tests"
    fp, inputs = fingerprint(repo, runs, args.group, tests, catalog_bytes, group["env_flags"])
    runs.mkdir(parents=True, exist_ok=True)
    result_path = runs / (fp + ".json")
    with (runs / (fp + ".lock")).open("a+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        previous = read_result(result_path)
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
                   env_flags=group["env_flags"], kind=group["kind"], reason=reason)
        result = dict(group=args.group, fingerprint=fp, inputs=inputs, status="NOT_TESTED",
                      pending=True, log_path=str(runs / (fp + ".log")),
                      history=previous["history"] if previous else [], _job=job)
        write_result(result_path, result)
        if args.detach:
            # flock is inherited via the same open file description. Parent CLOSES, never unlocks.
            try:
                subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve()), "_worker",
                                  str(result_path), str(lock.fileno())],
                                 pass_fds=(lock.fileno(),), start_new_session=True,
                                 env=scrubbed_env(group["env_flags"]), stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except OSError:
                result.update(pending=False, status="ENV_ERROR", detail="WORKER_START_FAILED")
                result.pop("_job", None)
                write_result(result_path, result)
                summary(result)
                return 2
            print("fingerprint: " + fp)
            print("status: DETACHED; collect blocks until completion")
            return 0
        result = execute(job, result_path)
        summary(result)
        return EXITS[result["status"]]


def collect(args):
    if not re.fullmatch(r"[0-9a-f]{64}", args.fingerprint):
        raise ValueError("BAD_FINGERPRINT")
    _, runs = locations(args)
    lock_path = runs / (args.fingerprint + ".lock")
    if not lock_path.exists():
        raise ValueError("UNKNOWN_FINGERPRINT")
    with lock_path.open("r+b") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = read_result(runs / (args.fingerprint + ".json"))
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
    try:
        args = parser.parse_args(argv)
        if args.command == "_worker":
            with os.fdopen(args.lock_fd, "a+b"):
                path = Path(args.result_path)
                result = execute(read_result(path)["_job"], path)
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
