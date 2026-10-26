"""Closed runner receipt validation; structural provenance, not authentication."""
import datetime
import hashlib
import json
import math
from pathlib import Path
import re

SCHEMA = "GB_TEST_RUN_V1"
STATUSES = {"PASS", "FAIL", "ENV_ERROR", "NOT_TESTED", "TIMEOUT"}
REQUIRED = {"schema", "group", "fingerprint", "inputs", "status", "pending", "log_path", "history"}
OPTIONAL = {"_job", "rc", "detail", "duration_s", "counts", "unittest_verdict", "failing_test_ids"}


def matches(pattern, value):
    return isinstance(value, str) and re.fullmatch(pattern, value) is not None


def timestamp(value):
    try:
        return isinstance(value, str) and datetime.datetime.fromisoformat(value).tzinfo is not None
    except ValueError:
        return False


def valid_receipt(value, stem, version, reasons):
    if (not isinstance(value, dict) or not REQUIRED <= set(value)
            or set(value) - REQUIRED - OPTIONAL or value["schema"] != SCHEMA
            or value["fingerprint"] != stem or not matches(r"[0-9a-f]{64}", stem)
            or not matches(r"[a-z][a-z0-9_]*", value["group"])
            or not isinstance(value["status"], str) or value["status"] not in STATUSES
            or type(value["pending"]) is not bool or not isinstance(value["log_path"], str)
            or Path(value["log_path"]).name != stem + ".log"):
        return False
    inputs = value["inputs"]
    if (not isinstance(inputs, dict) or set(inputs) != {
            "worktree_digest", "group_id", "tests", "catalog_sha256", "runner_version", "env_flags"}
            or not matches(r"[0-9a-f]{64}", inputs["worktree_digest"])
            or not matches(r"[0-9a-f]{64}", inputs["catalog_sha256"])
            or inputs["group_id"] != value["group"] or inputs["runner_version"] != version
            or not isinstance(inputs["tests"], list)
            or any(not matches(r"test_[A-Za-z0-9_]+", t) for t in inputs["tests"])
            or inputs["tests"] != sorted(set(inputs["tests"]))
            or not isinstance(inputs["env_flags"], dict)
            or any(not matches(r"[A-Za-z_][A-Za-z0-9_]*", k) or type(v) is not bool
                   for k, v in inputs["env_flags"].items())):
        return False
    encoded = json.dumps(inputs, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    if hashlib.sha256(encoded).hexdigest() != stem:
        return False
    history = value["history"]
    if not isinstance(history, list):
        return False
    for item in history:
        if (not isinstance(item, dict) or set(item) != {"reason", "time", "status"}
                or not isinstance(item["reason"], str)
                or item["reason"] not in reasons | {"initial", "inconclusive_retry"}
                or not timestamp(item["time"]) or not isinstance(item["status"], str)
                or item["status"] not in STATUSES):
            return False
    if value["pending"]:
        job = value.get("_job")
        if (value["status"] != "NOT_TESTED" or not isinstance(job, dict)
                or set(job) != {"argv", "cwd", "repo", "timeout_s", "env_flags", "kind", "reason"}
                or not isinstance(job["argv"], list) or not job["argv"]
                or any(not isinstance(a, str) or not a or "\x00" in a for a in job["argv"])
                or any(not isinstance(job[k], str) or not Path(job[k]).is_absolute() for k in ("repo", "cwd"))
                or type(job["timeout_s"]) is not int or job["timeout_s"] <= 0
                or job["env_flags"] != sorted(inputs["env_flags"])
                or job["kind"] not in ("local", "ci_only")
                or not isinstance(job["reason"], str)
                or job["reason"] not in reasons | {"initial", "inconclusive_retry"}):
            return False
    elif "_job" in value or not history or history[-1]["status"] != value["status"]:
        return False
    if "rc" in value and value["rc"] is not None and type(value["rc"]) is not int:
        return False
    if "duration_s" in value and (type(value["duration_s"]) not in (int, float)
            or not math.isfinite(value["duration_s"]) or value["duration_s"] < 0):
        return False
    if "counts" in value:
        counts = value["counts"]
        if (not isinstance(counts, dict) or set(counts) != {"tests", "failures", "errors"}
                or any(not (v is None and k == "tests") and (type(v) is not int or v < 0)
                       for k, v in counts.items())):
            return False
    return (value.get("unittest_verdict") in (None, "OK", "FAILED")
            and isinstance(value.get("detail", ""), str)
            and isinstance(value.get("failing_test_ids", []), list)
            and all(isinstance(v, str) for v in value.get("failing_test_ids", [])))
