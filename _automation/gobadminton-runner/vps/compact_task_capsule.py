#!/usr/bin/env python3
"""Read-only, fail-closed compact task context prototype. NEVER dispatches."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
SHA = re.compile(r"^[0-9a-f]{40}$")
IMMUTABLE_BLOB = re.compile(r"/blob/([0-9a-f]{40})/")
TERMINAL = {"completed", "blocked", "qa_failed", "qa_blocked",
            "deferred", "owner_skipped", "superseded_before_launch"}
MAX_DEPENDENCIES = 8


def digest(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def published_sha(value: Any) -> str | None:
    matched = IMMUTABLE_BLOB.search(str(value or ""))
    return matched.group(1) if matched else None


def terminal_history(state: dict[str, Any], task_id: str) -> str | None:
    for row in reversed(state.get("history", [])):
        if isinstance(row, dict) and row.get("id") == task_id:
            return str(row.get("status", "unknown"))
    return None


def receipt_digest(receipts_dir: Path | None, task_id: str) -> str | None:
    if receipts_dir is None:
        return None
    if not ID.fullmatch(task_id):
        return None
    path = receipts_dir / (task_id + ".json")
    try:
        if not path.is_file() or path.is_symlink():
            return None
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def capsule(backlog: dict[str, Any], state: dict[str, Any], task_id: str,
            receipts_dir: Path | None = None) -> dict[str, Any]:
    if backlog.get("project") != "GoBadminton":
        raise ValueError("wrong project")
    if not ID.fullmatch(task_id):
        raise ValueError("invalid task id")
    task_map = {t["id"]: t for t in backlog.get("tasks", [])
                if isinstance(t, dict) and isinstance(t.get("id"), str)}
    if task_id not in task_map:
        raise ValueError("unknown task id")
    task = task_map[task_id]
    active = state.get("active") or {}
    if not isinstance(active, dict):
        raise ValueError("unverified runner active claims")
    completed = task.get("depends_on_completed") or []
    accepted = task.get("depends_on_accepted") or []
    if not isinstance(completed, list) or not isinstance(accepted, list):
        raise ValueError("invalid dependency schema")
    deps = [*completed, *accepted]
    if any(not isinstance(x, str) or not ID.fullmatch(x) for x in deps):
        raise ValueError("invalid dependency id")
    dep_items = []
    for dep in sorted(set(deps)):
        dep_task = task_map.get(dep)
        dep_items.append({
            "id": dep,
            "result": terminal_history(state, dep) or "unverified",
            "record": "known" if dep_task else "missing",
            "proof": receipt_digest(receipts_dir, dep),
        })
    raw_locks = task.get("locks") or ["global"]
    if not isinstance(raw_locks, list) or any(
            not isinstance(x, str) or not ID.fullmatch(x) for x in raw_locks):
        raise ValueError("invalid lock definitions")
    # Non-conflicting slots MUST NOT churn a task's advisory fingerprint.
    # This is only an economical summary; Runner owns the exact conflict graph.
    claims = sorted((k, tuple(sorted((v or {}).get("locks") or ["global"])))
                    for k, v in active.items() if isinstance(v, dict)
                    and (k == task_id or "global" in raw_locks
                         or "global" in ((v or {}).get("locks") or ["global"])
                         or bool(set(raw_locks) & set((v or {}).get("locks") or ["global"]))))
    history = terminal_history(state, task_id)
    global_block = bool(state.get("paused") or state.get("blocked")
                        or state.get("global_gates")
                        or state.get("project_global_blocker"))
    if task_id in active:
        disposition = "RUNNING"
    elif history in TERMINAL or task.get("status", "queued") in TERMINAL:
        disposition = "TERMINAL"
    elif not task.get("enabled"):
        disposition = "HELD_DISABLED"
    elif global_block:
        disposition = "HELD_GLOBAL"
    elif any(x["record"] == "missing" or x["result"] != "completed" for x in dep_items):
        disposition = "WAIT_DEPENDENCY"
    elif len(dep_items) > MAX_DEPENDENCIES:
        disposition = "HOLD_CONTEXT_OVERFLOW"
    elif not published_sha(task.get("source")) or not published_sha(task.get("admission")):
        disposition = "HOLD_UNVERIFIED_AUTHORITY"
    else:
        # This deliberately never says READY. Existing Runner validators remain
        # the ONLY authority for exact candidate, lock, Owner and QA checks.
        disposition = "REQUIRES_CANONICAL_RUNNER_GATE"
    evidence = {
        "task_spec_sha256": digest(task),
        "dependency_results": dep_items,
        "own_history": history,
        "own_receipt": receipt_digest(receipts_dir, task_id),
        "active_claims": claims,
        "global_blocked": global_block,
        "queue_production_authorized": backlog.get("prod_authorized"),
    }
    fingerprint = digest(evidence)
    return {
        "schema": "GoBadminton.TaskCapsule.v001",
        "task_id": task_id,
        "disposition": disposition,
        "dependencies": [{"id": x["id"], "status": x["result"]}
                         for x in dep_items[:MAX_DEPENDENCIES]],
        "dependencies_truncated": len(dep_items) > MAX_DEPENDENCIES,
        "locks": sorted(set(raw_locks)),
        "conflicting_claims_hint": [claim_id for claim_id, _ in claims[:MAX_DEPENDENCIES]],
        "source_sha": published_sha(task.get("source")),
        "admission_sha": published_sha(task.get("admission")),
        "base_sha": task.get("base_sha") if SHA.fullmatch(str(task.get("base_sha") or "")) else None,
        "effect_ceiling": task.get("effect_ceiling") if task.get("effect_ceiling") == "source_only" else "unverified",
        "forbidden": ["prod_deploy", "live_data_mutation", "qa_bypass", "terminal_retry"],
        "next": "CANONICAL_CHECK_ONLY" if disposition == "REQUIRES_CANONICAL_RUNNER_GATE" else "WAIT_OR_REPORT",
        "llm_default": "NONE",
        "evidence_fingerprint": fingerprint,
    }


def new_semantic_event(previous: dict[str, Any] | None, current: dict[str, Any]) -> bool:
    """Gate for advisory LLM. Return False for identical evidence snapshots."""
    return not (isinstance(previous, dict)
                and previous.get("evidence_fingerprint") == current.get("evidence_fingerprint"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a read-only GoBadminton Task Capsule")
    parser.add_argument("--backlog", type=Path, required=True)
    parser.add_argument("--runner-state", type=Path, required=True)
    parser.add_argument("--receipts-dir", type=Path)
    parser.add_argument("--task-id", required=True)
    parser.add_argument("--previous", type=Path)
    args = parser.parse_args()
    backlog = json.loads(args.backlog.read_text())
    state = json.loads(args.runner_state.read_text())
    now = capsule(backlog, state, args.task_id, args.receipts_dir)
    previous = json.loads(args.previous.read_text()) if args.previous else None
    now["semantic_change"] = new_semantic_event(previous, now)
    print(json.dumps(now, ensure_ascii=False, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
