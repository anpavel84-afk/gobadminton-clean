#!/usr/bin/env python3
"""GoBadminton canonical GitHub-main -> Runner backlog reconciler.

Source-only: no history/receipts/state/task mutation. At install this module is
called by the EXISTING autopilot, not a second Runner or a network/host tunnel.
A mismatched, unsafe or ambiguous source fails closed with exact evidence.
"""
from __future__ import annotations

import argparse
import writer_bridge
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

CANONICAL_PATH = "_automation/gobadminton-runner/backlog.json"
_GITHUB_SAFE_SEGMENT = r"(?!\.{1,2}(?:/|$))[A-Za-z0-9_.-]+"
FULL_GITHUB_SOURCE = re.compile(
    rf"^https://github\.com/anpavel84-afk/gobadminton-clean/blob/([0-9a-f]{{40}})/({_GITHUB_SAFE_SEGMENT}(?:/{_GITHUB_SAFE_SEGMENT})*)$"
)
TERMINAL_STATUSES = frozenset(
    {"completed", "blocked", "qa_failed", "qa_blocked", "owner_skipped", "superseded_before_launch", "deferred"}
)
REQUIRED_NEW_TASK_FIELDS = ("source", "admission", "locks", "blocks", "executor", "model", "effort", "sandbox")
SYNTHETIC_ADMISSION_REFERENCE = re.compile(
    r"(?:system-safe-planning-[0-9a-f]{40}|system-admission-drift-[0-9a-f]{16})"
)


class SyncBlocked(RuntimeError):
    """Unsafe reconciliation: report evidence, never overwrite runtime."""


class InvalidRunnerState(SyncBlocked):
    """Preserve all state/trust/status bytes; publish only a diagnostic."""


def validate_history(history: Any) -> None:
    """Accept terminal id/status legacy records, never infer missing evidence.

    Old records may omit timestamps, project and verdict. If present these
    fields must agree. block_released is the one legacy nonterminal audit event;
    it needs its original blocked identity and immutable publication evidence.
    """
    if not isinstance(history, list):
        raise InvalidRunnerState("Runner history must be an array")
    for index, entry in enumerate(history):
        label = f"Runner history[{index}]"
        if not isinstance(entry, dict):
            raise InvalidRunnerState(f"{label}: record must be object")
        tid = entry.get("id")
        if not isinstance(tid, str) or not tid.strip() or tid != tid.strip():
            raise InvalidRunnerState(f"{label}: missing/invalid task id")
        status = entry.get("status")
        if not isinstance(status, str) or status not in TERMINAL_STATUSES | {"block_released"}:
            raise InvalidRunnerState(f"{label} ({tid}): missing/invalid terminal status")
        for field, expected in (("project", "GoBadminton"), ("task_id", tid)):
            if field in entry and entry[field] != expected:
                raise InvalidRunnerState(f"{label} ({tid}): {field} identity mismatch")
        if "at" in entry and (not isinstance(entry["at"], str) or not entry["at"].strip()):
            raise InvalidRunnerState(f"{label} ({tid}): invalid at")
        if "verdict" in entry:
            allowed = {"qa_failed": {"FAIL"}, "qa_blocked": {"BLOCKED"},
                       "completed": {"PASS", "PASS_WITH_NONBLOCKING_GAPS"}}
            if not isinstance(entry["verdict"], str) or entry["verdict"] not in allowed.get(status, set()):
                raise InvalidRunnerState(f"{label} ({tid}): verdict/status mismatch")
        if status == "block_released":
            if not isinstance(entry.get("result_commit"), str) or not re.fullmatch(r"[0-9a-f]{40}", entry["result_commit"]):
                raise InvalidRunnerState(f"{label} ({tid}): invalid block release publication")
            for field in ("original_block", "original_current"):
                original = entry.get(field)
                if not isinstance(original, dict) or original.get("id") != tid:
                    raise InvalidRunnerState(f"{label} ({tid}): invalid {field} identity")
            if entry["original_current"].get("status") != "blocked":
                raise InvalidRunnerState(f"{label} ({tid}): original claim was not blocked")


@contextmanager
def claim_sync_section(root: Path):
    """Shared short, nonblocking process/thread-safe claim/replacement protocol.

    Each caller opens its own descriptor, so flock also serializes Runner
    threads. No network operation or executor runs while this lock is held.
    Contention skips this claim/sync tick; it never waits on a task lifetime.
    """
    with writer_bridge.bridge_section():
        with (Path(root) / "backlog-claim.lock").open("a+") as fp:
            try:
                fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise SyncBlocked("claim/backlog replacement critical section busy; retry next tick") from exc
            try:
                yield
            finally:
                fcntl.flock(fp.fileno(), fcntl.LOCK_UN)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def git_blob_sha(raw: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def parse_backlog(raw: bytes, label: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SyncBlocked(f"{label}: malformed JSON: {type(exc).__name__}") from exc
    if not isinstance(data, dict) or not isinstance(data.get("tasks"), list):
        raise SyncBlocked(f"{label}: tasks[] missing")
    if data.get("prod_authorized") is not False:
        raise SyncBlocked(f"{label}: prod_authorized must be false")
    tasks: dict[str, dict[str, Any]] = {}
    for item in data["tasks"]:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"]:
            raise SyncBlocked(f"{label}: malformed task/id")
        tid = item["id"]
        if tid in tasks:
            raise SyncBlocked(f"{label}: duplicate task id {tid}")
        tasks[tid] = item
    return data, tasks


def verify_source_review_immutability(
    old: dict[str, dict[str, Any]], new: dict[str, dict[str, Any]]
) -> None:
    """An admitted task ID can never change its independently reviewed object.

    Insertion, deletion and changes to any source_review pin require a NEW task
    identity and the existing Owner-bound canonical admission. An already
    admitted ID cannot be rebound even if source/admission URLs stay unchanged.
    """
    for tid, before in old.items():
        after = new.get(tid)
        if after is None:
            continue
        # QA-229-01 remains unchanged in effect: existing task identities cannot
        # rebound their reviewed object. The same rule protects the NEW internal
        # QA suite authority and source-only CI handoff intent.
        for field in ("source_review", "source_qa", "release_handoff"):
            if (field in before) != (field in after) or before.get(field) != after.get(field):
                raise SyncBlocked(
                    f"{tid}: immutable {field} binding changed; "
                    "new task ID and Owner-bound admission required"
                )


def verify_candidate(
    canonical_raw: bytes,
    runtime_raw: bytes,
    active_claims: dict[str, Any],
) -> list[dict[str, Any]]:
    """Pure checks. Never infer that a disabled old task is runnable."""
    canonical, new = parse_backlog(canonical_raw, "canonical")
    runtime, old = parse_backlog(runtime_raw, "runtime")

    missing = set(old) - set(new)
    if missing:
        raise SyncBlocked(f"canonical missing {len(missing)} runtime task IDs: {', '.join(sorted(missing)[:5])}")
    if len(new) < len(old):
        raise SyncBlocked("canonical task count decreased")

    verify_source_review_immutability(old, new)

    if not isinstance(active_claims, dict):
        raise SyncBlocked("active claims unavailable")
    for tid in active_claims:
        if tid not in old or tid not in new:
            raise SyncBlocked(f"active claim {tid} missing from a backlog")
        before, after = old[tid], new[tid]
        # All fields participate, including future gates and legacy notes.
        # Missing and explicit null also differ: execution definitions are exact.
        changed = [key for key in sorted(set(before) | set(after))
                   if (key in before) != (key in after) or before.get(key) != after.get(key)]
        if changed:
            raise SyncBlocked(f"active claim {tid} task definition changed: {', '.join(changed)}")

    for tid, before in old.items():
        after = new[tid]
        if before.get("status") in TERMINAL_STATUSES and after.get("status") not in TERMINAL_STATUSES:
            raise SyncBlocked(f"terminal task {tid} downgraded to {after.get('status')!r}")

    newly_admitted = []
    for tid, item in new.items():
        prev = old.get(tid)
        changed_binding = bool(prev and (
            prev.get("source") != item.get("source")
            or prev.get("admission") != item.get("admission")
        ))
        newly_enabled = item.get("enabled") is True and (not prev or prev.get("enabled") is not True)
        if not newly_enabled and not (changed_binding and item.get("enabled") is True):
            continue

        for field in REQUIRED_NEW_TASK_FIELDS:
            if field not in item or not item[field]:
                raise SyncBlocked(f"newly admitted {tid} missing {field}")
        for field in ("source", "admission"):
            value = str(item.get(field) or "")
            if not FULL_GITHUB_SOURCE.fullmatch(value):
                raise SyncBlocked(f"newly admitted {tid}: {field} is not full immutable GitHub SHA")
        deps = []
        for key in ("depends_on_completed", "depends_on_accepted"):
            value = item.get(key, [])
            if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
                raise SyncBlocked(f"newly admitted {tid} invalid {key}")
            deps.extend(value)
        if tid in deps:
            raise SyncBlocked(f"newly admitted {tid} self-dependency")
        for dep in deps:
            if dep not in new:
                raise SyncBlocked(f"newly admitted {tid} depends on unknown {dep}")
        locks = item.get("locks")
        if not isinstance(locks, list) or not all(isinstance(x, str) and x.strip() for x in locks):
            raise SyncBlocked(f"newly admitted {tid} invalid locks")
        newly_admitted.append(item)
    return newly_admitted


def run_git(repo: Path, args: list[str], timeout: int = 35) -> str:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True, text=True, timeout=timeout, check=False,
    )
    if proc.returncode:
        raise SyncBlocked(f"git {args[0]} failed ({proc.returncode}): {proc.stderr.strip()[:180]}")
    return proc.stdout.strip()


def validate_immutable_sources(repo: Path, items: list[dict[str, Any]]) -> None:
    """Every runnable binding, including byte-equal snapshots, must exist."""
    for t in items:
        for field in ("source", "admission"):
            m = FULL_GITHUB_SOURCE.fullmatch(str(t.get(field) or ""))
            if not m:
                raise SyncBlocked(f"nonimmutable {field} for {t['id']}")
            ref, path = m.groups()
            # Reject missing exact commits/files; never substitute the current checkout.
            run_git(repo, ["cat-file", "-e", f"{ref}^{{commit}}"], timeout=12)
            if run_git(repo, ["cat-file", "-t", f"{ref}:{path}"], timeout=12) != "blob":
                raise SyncBlocked(f"{field} for {t['id']} is not a file")


def is_synthetic_admission_reference(tid: str, tasks: dict[str, dict[str, Any]]) -> bool:
    """Exact Autopilot provenance formats, never a known canonical task.

    Safe planning uses a full canonical commit SHA; admission notices use a
    16-hex diagnostic digest. Unknown system-* tokens remain actionable.
    """
    return tid not in tasks and SYNTHETIC_ADMISSION_REFERENCE.fullmatch(tid) is not None


def is_diagnostic_admission_reference(tid: str, tasks: dict[str, dict[str, Any]]) -> bool:
    """Resource aliases are diagnostics only; a canonical task always wins."""
    locks = {lock for task in tasks.values() for lock in task.get('locks', [])
             if isinstance(lock, str)}
    return tid not in tasks and (tid in locks or is_synthetic_admission_reference(tid, tasks))


def declared_admission_task_ids(doc: str, tasks: dict[str, dict[str, Any]]) -> set[str]:
    """Read task declarations, not every inline code fragment in a manifest.

    Support task fields, leading task lists/pairs, Admit sentences and task
    columns in Markdown tables. Bare ID rows are the legacy list format.
    Canonical task references remain visible even when they resemble a lock.
    This is diagnostic parsing, never an authorization source.
    """
    token = r'`([a-z0-9]+(?:-[a-z0-9]+)+)`'
    ids = {tid for tid in re.findall(token, doc) if tid in tasks}
    columns = []
    for line in doc.splitlines():
        if line.lstrip().startswith('|'):
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            headers = [i for i, cell in enumerate(cells)
                       if re.fullmatch(r'(?:task(?:[ _-]ids?)?|producer(?:[ _-]task)?|qa(?:[ _-]task)?)',
                                       cell.strip('* ').lower())]
            if headers:
                columns = headers
            else:
                for i in columns:
                    if i < len(cells):
                        ids.update(re.findall(token, cells[i]))
            continue
        columns = []
        content = re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+)?', '', line).strip()
        # A leading task ID/pair ends at descriptive prose. This avoids lock
        # names appearing later on the same admitted task row.
        leading = re.match(r'`[a-z0-9]+(?:-[a-z0-9]+)+`(?:\s*(?:→|->|,|and|plus)?\s*`[a-z0-9]+(?:-[a-z0-9]+)+`)*', content)
        if leading:
            ids.update(re.findall(token, leading.group()))
        labelled = re.match(r'(?:\*\*)?(?:(?:only |new |admitted )?(?:executor )?task(?:[ _-]ids?)?|producer(?:[ _-]task(?:[ _-]id)?)?|qa(?:[ _-]task(?:[ _-]id)?)?)(?:\*\*)?\s*[:=]\s*(.*)', content, re.I)
        admit = re.match(r'Admit\s+(?:only\s+|exactly\s+)?(.*)', content, re.I)
        declaration = labelled or admit
        if declaration:
            value = re.split(r'\b(?:(?:resource |domain |exclusive |both exclusive )?locks?|exclusive)\b',
                             declaration.group(1), maxsplit=1, flags=re.I)[0]
            ids.update(re.findall(token, value))
    return ids


def historical_resource_reference(repo: Path, head: str, path: str, tid: str, tasks) -> bool:
    """Clear a persisted lock phantom only with closed canonical provenance.

    Unknown tasks and explicit declarations survive, including task/lock name
    collisions. Missing/deleted evidence fails closed. Sync has already proved
    ancestry, source hashes, active definitions and history before calling this.
    """
    if tid in tasks or not is_diagnostic_admission_reference(tid, tasks):
        return False
    if not re.fullmatch(r'docs/manifest/PM_ADMISSION_[A-Za-z0-9_-]+\.md', path):
        return False
    try:
        doc = run_git(repo, ['show', head + ':' + path])
    except SyncBlocked:
        return False
    return tid not in declared_admission_task_ids(doc, tasks) and '`' + tid + '`' in doc


def detect_unmaterialized_admissions(
    repo: Path,
    previous_head: str | None,
    new_head: str,
    tasks: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Alert on newly merged PM admissions still absent/disabled in main.

    Diagnostic ONLY, not permission to enable a task merely from prose.
    The PM planner must validate exact prompts and commit a main queue fix.
    """
    if not previous_head or previous_head == new_head:
        return []
    changed = run_git(
        repo, ["diff", "--name-only", str(previous_head), new_head,
               "--", "docs/manifest/PM_ADMISSION_*.md"], timeout=30,
    ).splitlines()
    findings = []
    for path in changed[:40]:
        if not (path.startswith("docs/manifest/PM_ADMISSION_") and path.endswith(".md")):
            continue
        try:
            doc = run_git(repo, ["show", f"{new_head}:{path}"], timeout=15)
        except SyncBlocked:
            continue  # deleted/moved docs are not new admissions
        heading = doc[:1300].upper()
        if "ADMITTED" not in heading or "NOT_ADMITTED" in heading or "WORKING DRAFT" in heading:
            continue
        mentions = [tid for tid in declared_admission_task_ids(doc, tasks)
                    if not is_synthetic_admission_reference(tid, tasks)
                    and (tid not in tasks or (tasks[tid].get("status", "queued") == "queued"
                                             and tasks[tid].get("enabled") is not True))]
        if mentions:
            findings.append({
                "admission_path": path,
                "disabled_queued_task_ids": sorted(set(mentions))[:12],
                "diagnostic_id": hashlib.sha256((new_head + ":" + path).encode()).hexdigest()[:16],
                "detected_commit": new_head,
                "reason": "merged PM admission references disabled tasks; exact PM reconciliation required",
            })
    return findings


def dependency_closure(task, tasks):
    """Effective explicit + legacy ancestry; includes intermediaries and cycles."""
    import runner
    seen = set()
    def visit(current):
        for key in ('depends_on_completed', 'depends_on_accepted'):
            for dep in runner._v2_dependencies(current, key):
                if dep not in seen:
                    seen.add(dep)
                    if dep in tasks:
                        visit(tasks[dep])
    visit(task)
    return seen


def verify_dependency_rebindings(repo, root, old_tasks, new_tasks, state, main_head):
    """Terminal QA edges cannot be dropped until a replacement is independently
    accepted on actual merged source. Runs before queue replacement, outside lock.
    """
    import runner
    proof_bytes = []
    for tid, previous in old_tasks.items():
        current = new_tasks[tid]
        removed = dependency_closure(previous, old_tasks) - dependency_closure(current, new_tasks)
        failed = [dep for dep in removed if runner._v2_history_status(state, dep) in {"qa_failed", "qa_blocked"}
                  or old_tasks.get(dep, {}).get("status") in {"qa_failed", "qa_blocked"}]
        if not failed:
            continue
        def remaining_definition(task):
            result = {k: v for k, v in task.items() if k not in {
                'depends_on_completed', 'depends_on_accepted', 'notes'}}
            notes = str(task.get('notes') or '')
            for key in ('depends_on_completed', 'depends_on_accepted'):
                notes = re.sub(r'(?:^|(?<=[.\s;]))' + key +
                    r'\s*=\s*(\[[^\]]*\]|[A-Za-z0-9._:-]+(?:\s*,\s*[A-Za-z0-9._:-]+)*)', '', notes)
            result['notes'] = notes.strip(' .;\n')
            return result
        if remaining_definition(previous) != remaining_definition(current):
            raise SyncBlocked(f'{tid}: accepted-source rebind may not change other execution/release gates')
        added = {dep for node in [current] + [new_tasks[d] for d in dependency_closure(current, new_tasks)
                                             if d in new_tasks]
                 for dep in runner._v2_dependencies(node, 'depends_on_accepted')}
        added -= dependency_closure(previous, old_tasks)
        if not added:
            raise SyncBlocked(f"{tid}: terminal QA dependency removed without accepted successor")
        for dep in added:
            qa = new_tasks.get(dep)
            if not qa or runner._v2_history_status(state, dep) != "completed":
                raise SyncBlocked(f"{tid}: replacement QA {dep} not independently completed")
            try:
                # Receipt overrides remain authoritative execution paths.
                receipt_path = Path(qa.get("receipt") or qa.get("receipt_path") or root / "receipts" / (dep + ".json"))
                qa_raw = receipt_path.read_bytes()
                data = json.loads(qa_raw)
                if (data.get("project") != "GoBadminton" or data.get("task_id") != dep
                        or data.get("ok") is not True or data.get("verdict") not in {"PASS", "PASS_WITH_NONBLOCKING_GAPS"}
                        or data.get("blocking_findings") != [] or data.get("blocking_gap_count") not in (None, 0)
                        or data.get("merge_recommendation") != "MERGE_RECOMMENDED"
                        or not re.fullmatch(r"[0-9a-f]{40}", str(data.get("candidate_sha") or ""))):
                    raise SyncBlocked(f"{tid}: replacement independent QA receipt invalid")
                candidate = data["candidate_sha"]
                for failed_id in failed:
                    original_qa = old_tasks[failed_id]
                    fp = Path(original_qa.get('receipt') or original_qa.get('receipt_path') or
                              root / 'receipts' / (failed_id + '.json'))
                    failed_raw = fp.read_bytes()
                    if json.loads(failed_raw).get('candidate_sha') == candidate:
                        raise SyncBlocked(f'{tid}: rejected candidate cannot be an accepted successor')
                    proof_bytes.append((fp, failed_raw, failed_id))
                run_git(repo, ["merge-base", "--is-ancestor", candidate, main_head])
                tree = run_git(repo, ["rev-parse", candidate + "^{tree}"])
                if data.get("candidate_tree") != tree:
                    raise SyncBlocked(f"{tid}: replacement QA tree mismatch")
                producers = [d for d in runner._v2_dependencies(qa, "depends_on_completed") if not d.startswith("qa-")]
                if len(producers) != 1 or producers[0] not in new_tasks:
                    raise SyncBlocked(f"{tid}: replacement QA own producer unavailable")
                producer = new_tasks[producers[0]]
                pp = Path(producer.get("receipt") or producer.get("receipt_path") or root / "receipts" / (producer['id'] + ".json"))
                producer_raw = pp.read_bytes()
                own = json.loads(producer_raw)
                if (own.get("project") != "GoBadminton" or own.get("task_id") != producer["id"]
                        or own.get("ok") is not True or own.get("candidate_sha") != candidate or own.get("candidate_tree") != tree):
                    raise SyncBlocked(f"{tid}: replacement QA producer identity mismatch")
                branch = own.get("branch")
                if not isinstance(branch, str):
                    raise SyncBlocked(f"{tid}: replacement producer publication unavailable")
                run_git(repo, ["check-ref-format", "refs/heads/" + branch])
                announced = run_git(repo, ["ls-remote", "--refs", "origin", "refs/heads/" + branch]).split()
                if len(announced) != 2 or announced[1] != "refs/heads/" + branch:
                    raise SyncBlocked(f"{tid}: replacement producer not published")
                run_git(repo, ["merge-base", "--is-ancestor", candidate, announced[0]])
                lineage = producer.get('recovery_from') or producer.get('recovery_policy') or {}
                old_slices = set()
                for failed_id in failed:
                    failed_qa = old_tasks[failed_id]
                    for old_id in runner._v2_dependencies(failed_qa, 'depends_on_completed'):
                        original = old_tasks.get(old_id, {})
                        original_lineage = original.get('recovery_from') or original.get('recovery_policy') or {}
                        old_slices.add(original_lineage.get('slice_id') or old_id)
                if not old_slices or old_slices != {lineage.get('slice_id')}:
                    raise SyncBlocked(f'{tid}: accepted replacement does not repair failed conceptual slice')
                validate_immutable_sources(repo, [qa, producer])
                proof_bytes.extend([(receipt_path, qa_raw, dep), (pp, producer_raw, producers[0])])
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise SyncBlocked(f"{tid}: replacement QA evidence unreadable") from exc
    return proof_bytes


def validate_recovery_transition(root, before, after, state, repo=None, baseline=None, head=None, receipt=None):
    """Whole transition, rather than planner's selected list; safe before push/swap."""
    import queue_recovery
    old = {t['id']: t for t in before['tasks']}
    new = {t['id']: t for t in after['tasks']}
    changed = [t for tid, t in new.items() if tid not in old or old[tid] != t]
    keys = {(t.get('recovery_from') or {}).get('key') for t in changed
            if t['id'] not in old and t.get('recovery_from')}
    # A reserved recovery also protects against a planner omitting all lineage.
    path = Path(root) / 'qa-recovery-ledger.json'
    try:
        ledger = json.loads(path.read_text()) if path.exists() else {'actions': {}, 'slices': {}}
        if (not isinstance(ledger, dict) or not isinstance(ledger.get('actions'), dict)
                or not isinstance(ledger.get('slices'), dict)
                or any(type(n) is not int or not 0 <= n <= 5 for n in ledger['slices'].values())):
            raise SyncBlocked('bounded recovery ledger schema invalid; preserve bytes')
        for key, entry in ledger['actions'].items():
            if (not isinstance(entry, dict) or entry.get('key') != key
                    or entry.get('status') not in {'NOTICE', 'DISPATCH_RESERVED', 'HOLD', 'ADMITTED', 'RUNNING', 'CLOSED'}
                    or not isinstance(entry.get('evidence'), dict)):
                raise SyncBlocked('bounded recovery action invalid; preserve bytes')
    except (ValueError, TypeError, KeyError) as exc:
        raise SyncBlocked('bounded recovery ledger unreadable; preserve bytes') from exc
    reserved = [e for e in ledger['actions'].values() if e['status'] == 'DISPATCH_RESERVED']
    keys.update(e['key'] for e in reserved)
    for key in keys:
        entry = ledger['actions'][key]
        pair_before = entry.get('baseline') if not changed and entry.get('baseline') else before
        pair_old = {t['id'] for t in pair_before['tasks']}
        ids = [t['id'] for t in after['tasks'] if t['id'] not in pair_old
               and (t.get('recovery_from') or {}).get('key') == key]
        if receipt is not None and (receipt.get('recovery_key') != key or
                set(receipt.get('task_ids') or []) != set(ids)):
            raise SyncBlocked('reported recovery identity/pair differs from entire actual delta')
        try:
            queue_recovery.validate_pair(entry, pair_before, after, {'task_ids': ids}, state)
        except queue_recovery.RecoveryHold as exc:
            raise SyncBlocked('bounded recovery admission invalid: ' + str(exc)) from exc
    if keys and repo is not None and baseline and head:
        paths = run_git(repo, ['diff', '--name-only', baseline, head]).splitlines()
        if any(not (p.startswith('docs/') or p == CANONICAL_PATH) for p in paths):
            raise SyncBlocked('source-only recovery publication changed executable/runtime resources')
    return bool(keys)


def read_runner_state(state_path: Path) -> dict[str, Any]:
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise InvalidRunnerState(f"Runner state not readable: {type(exc).__name__}") from exc
    if not isinstance(state, dict):
        raise InvalidRunnerState("Runner state malformed")
    if not isinstance(state.get("history"), list) or not isinstance(state.get("paused"), bool):
        raise InvalidRunnerState("Runner state missing valid history[]/paused fields")
    validate_history(state["history"])
    # Explicit v1 compatibility; missing v2 active is never an empty map.
    if "active" not in state and state.get("version") == 1:
        current = state.get("current")
        if current is None:
            state["active"] = {}
            return state
        if not isinstance(current, dict) or not current.get("id"):
            raise InvalidRunnerState("Runner legacy current claim malformed")
        state["active"] = {str(current["id"]): current} if current.get("status") == "running" else {}
        return state
    active = state.get("active")
    if not isinstance(active, dict):
        raise InvalidRunnerState("Runner active claims malformed")
    for tid, claim in active.items():
        if not isinstance(claim, dict) or claim.get("id") != tid:
            raise InvalidRunnerState(f"Runner active claim {tid!r} malformed/identity mismatch")
    return state


def read_active(state_path: Path) -> dict[str, Any]:
    return read_runner_state(state_path)["active"]


def read_metadata(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise SyncBlocked(f"{path.name}: unreadable/corrupt metadata ({type(exc).__name__})") from exc
    if not isinstance(data, dict):
        raise SyncBlocked(f"{path.name}: metadata root must be object")
    for field in ("canonical_commit", "canonical_blob"):
        if not isinstance(data.get(field), str) or not re.fullmatch(r"[0-9a-f]{40}", data[field]):
            raise SyncBlocked(f"{path.name}: missing/invalid trusted {field}")
    if path.name == "backlog-sync-state.json":
        if data.get("status") not in {"IN_SYNC", "SYNCED", "BLOCKED"}:
            raise SyncBlocked(f"{path.name}: invalid status")
        if not isinstance(data.get("runtime_blob"), str) or not re.fullmatch(r"[0-9a-f]{40}", data["runtime_blob"]):
            raise SyncBlocked(f"{path.name}: invalid runtime_blob")
    if "admission_drift" in data and (not isinstance(data["admission_drift"], list)
            or any(not isinstance(x, dict) for x in data["admission_drift"])):
        raise SyncBlocked(f"{path.name}: malformed admission_drift")
    for finding in data.get("admission_drift", []):
        if (not isinstance(finding.get("admission_path"), str)
                or not isinstance(finding.get("disabled_queued_task_ids"), list)
                or any(not isinstance(x, str) for x in finding["disabled_queued_task_ids"])):
            raise SyncBlocked(f"{path.name}: malformed admission diagnostic fields")
    return data


def bootstrap_head(repo: Path, head: str, runtime_blob: str) -> str:
    """First install only: prove runtime bytes existed on this main lineage.

    No trust is inferred from local HEAD or an arbitrary equal task-ID set.
    Existing malformed/missing metadata after trust establishment never bootstraps.
    """
    revisions = run_git(repo, ["log", "-n", "1000", "--format=%H", head, "--", CANONICAL_PATH]).splitlines()
    for revision in revisions:
        if run_git(repo, ["rev-parse", f"{revision}:{CANONICAL_PATH}"]) == runtime_blob:
            return revision
    raise SyncBlocked("initial trust unavailable: runtime blob absent from bounded canonical main ancestry")


def atomic_write(path: Path, content: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as fp:
            fp.write(content)
            fp.flush()
            os.fsync(fp.fileno())
        os.replace(temp, path)
        # Best-effort durability on filesystem that supports directory fsync.
        try:
            parent = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
        except OSError:
            pass
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def save_status(root: Path, info: dict[str, Any]) -> None:
    # Every write to the shared authoritative sync state owns the bridge lease,
    # even when called outside sync_once (error/recovery/direct CLI paths).
    with writer_bridge.bridge_section():
        payload = dict(info)
        payload["checked_at"] = now_iso()
        atomic_write(
            root / "backlog-sync-state.json",
            (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
            mode=0o644,
        )


def notice_delivered(root: Path, token: str) -> bool:
    if not re.fullmatch(r"[0-9a-f]{16}", token):
        return False
    notice_id = "system-admission-drift-" + token
    try:
        ack = json.loads((root / "backlog-sync-notices" / (token + ".json")).read_text())
        notice = json.loads((root / "owner-inbox" / (notice_id + ".json")).read_text())
        return (isinstance(ack, dict) and ack.get("notice_id") == notice_id
                and isinstance(notice, dict) and notice.get("id") == notice_id
                and notice.get("origin") == "SYSTEM_ADMISSION_AUDIT_NOT_OWNER")
    except (OSError, ValueError):
        return False


def sync_once(
    repo: Path,
    runtime_root: Path,
    *,
    fetch: bool = True,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Safe repair of an omitted runtime-backlog publication, including active tasks.

    Fetch only Git metadata; never checkout/reset source and never touch state,
    progress, attempts or receipts. Checksums bind exact Git blobs, not filenames.
    """
    repo = Path(repo)
    root = Path(runtime_root)
    runtime_path = root / "backlog.json"
    state_path = root / "state.json"
    sync_lock = root / "backlog-sync.lock"
    sync_lock.parent.mkdir(parents=True, exist_ok=True)
    lock_file = sync_lock.open("a+")
    locked = False
    metadata_valid = False
    prior: dict[str, Any] = {}
    trusted: dict[str, Any] = {}
    try:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
        except BlockingIOError as exc:
            raise SyncBlocked("another backlog reconciler owns the lock") from exc

        meta_path = root / "backlog-sync-state.json"
        trust_path = root / "backlog-sync-trust.json"
        if trust_path.exists():
            trusted = read_metadata(trust_path)
            if not meta_path.exists():
                raise SyncBlocked("sync metadata missing after trust established; operator recovery required")
        if meta_path.exists():
            prior = read_metadata(meta_path)
            if trusted and (prior["canonical_commit"] != trusted["canonical_commit"]
                            or prior["canonical_blob"] != trusted["canonical_blob"]):
                raise SyncBlocked("sync metadata disagrees with trusted head; operator recovery required")
            if not trusted:
                trusted = {key: prior[key] for key in ("canonical_commit", "canonical_blob")}
        metadata_valid = True
        if fetch:
            run_git(repo, ["fetch", "--no-tags", "--quiet", "origin", "main"], timeout=120)
        head = run_git(repo, ["rev-parse", "refs/remotes/origin/main"])
        if not re.fullmatch(r"[a-f0-9]{40}", head):
            raise SyncBlocked("GitHub main returned invalid SHA")
        if fetch:
            remote_line = run_git(repo, ["ls-remote", "origin", "refs/heads/main"], timeout=30)
            if not remote_line.startswith(head + "\t"):
                raise SyncBlocked("origin/main changed during fetch; retry next tick")

        if trusted.get("canonical_commit") and trusted["canonical_commit"] != head:
            run_git(repo, ["merge-base", "--is-ancestor", trusted["canonical_commit"], head])
        if trusted and run_git(repo, ["rev-parse", f"{trusted['canonical_commit']}:{CANONICAL_PATH}"]) != trusted["canonical_blob"]:
            raise SyncBlocked("trusted canonical blob differs from recorded Git head")
        blob = run_git(repo, ["rev-parse", f"{head}:{CANONICAL_PATH}"])
        canonical_raw = subprocess.run(
            ["git", "-C", str(repo), "show", f"{head}:{CANONICAL_PATH}"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, check=False,
        )
        if canonical_raw.returncode:
            raise SyncBlocked("cannot read exact canonical Git blob")
        payload = canonical_raw.stdout
        if git_blob_sha(payload) != blob:
            raise SyncBlocked("canonical content SHA differs from Git object")
        runtime_raw = runtime_path.read_bytes()
        old_blob = git_blob_sha(runtime_raw)
        if not trusted:
            anchor = bootstrap_head(repo, head, old_blob)
            trusted = {"canonical_commit": anchor, "canonical_blob": old_blob}
        runner_state = read_runner_state(state_path)
        active = runner_state["active"]
        admitted = verify_candidate(payload, runtime_raw, active)
        history = runner_state["history"]
        for task in admitted:
            latest = next((entry for entry in reversed(history)
                           if isinstance(entry, dict) and entry.get("id") == task["id"]), {})
            if latest.get("status") in {"qa_failed", "qa_blocked", "blocked"}:
                raise SyncBlocked(f"terminal history {task['id']} cannot be newly enabled/rebound")
        canonical_tasks = parse_backlog(payload, "canonical")[1]
        rebind_proofs = verify_dependency_rebindings(repo, root, parse_backlog(runtime_raw, "runtime")[1],
                                     canonical_tasks, runner_state, head)
        # Check both NEW and already enabled task bindings even when GitHub
        # and runtime blobs happen to match. A dangling old immutable source
        # is a real source-integrity blocker, not IN_SYNC/READY.
        validate_immutable_sources(
            repo,
            [task for task in canonical_tasks.values()
             if task.get("enabled") is True and task.get("status", "queued") == "queued"],
        )
        # The Runner's explicit and legacy-note dependency grammar is the
        # same execution grammar used at claim. Validate all enabled bindings,
        # but waiting producers do not need a candidate receipt prematurely.
        import runner
        try:
            runner.validate_backlog(parse_backlog(payload, "canonical")[0])
        except RuntimeError as exc:
            raise SyncBlocked(f"canonical Runner schema: {exc}") from exc
        validate_recovery_transition(root, parse_backlog(runtime_raw, 'runtime')[0],
            parse_backlog(payload, 'canonical')[0], runner_state, repo,
            trusted['canonical_commit'], head)
        for task in canonical_tasks.values():
            if task.get("enabled") is not True or task.get("status", "queued") != "queued":
                continue
            for key in ("depends_on_completed", "depends_on_accepted"):
                value = task.get(key)
                if value is not None and (not isinstance(value, list)
                        or any(not isinstance(x, str) or not x for x in value)):
                    raise SyncBlocked(f"{task['id']}: invalid {key}")
                for dep in runner._v2_dependencies(task, key):
                    if dep == task["id"] or dep not in canonical_tasks:
                        raise SyncBlocked(f"{task['id']}: missing/self dependency {dep}")
            expected = task.get("candidate_sha")
            if expected is not None:
                if not isinstance(expected, str) or not re.fullmatch(r"[0-9a-f]{40}", expected):
                    raise SyncBlocked(f"{task['id']}: invalid exact candidate_sha")
                run_git(repo, ["cat-file", "-e", expected + "^{commit}"])
        drift = detect_unmaterialized_admissions(
            repo, str(prior.get("canonical_commit") or "") or None,
            head, canonical_tasks,
        )
        # An independent one-minute timer can observe a new admission before
        # the main Autopilot gets its turn. Keep the diagnostic until the
        # flagged disabled tasks are actually admitted/superseded; never lose
        # it just because the next tick sees the same GitHub commit.
        previous_drift = prior.get("admission_drift") if isinstance(prior,dict) else []
        for finding in previous_drift or []:
            if not isinstance(finding,dict):
                continue
            path = str(finding.get("admission_path") or "")
            if not path:
                continue
            task_ids = [tid for tid in finding["disabled_queued_task_ids"]
                        if not is_synthetic_admission_reference(tid, canonical_tasks)
                        and not historical_resource_reference(repo, head, path, tid, canonical_tasks)]
            if not task_ids:
                continue  # old phantom drift clears even without a delivered notice
            # A changed manifest may discover a new missing task on the same
            # path. It cannot erase unresolved real IDs from the old notice.
            current_ids = [tid for item in drift if item.get('admission_path') == path
                           for tid in item['disabled_queued_task_ids']]
            task_ids = list(dict.fromkeys(task_ids + current_ids))
            still_disabled = [
                tid for tid in task_ids
                if tid not in canonical_tasks or (
                canonical_tasks[tid].get("status", "queued") == "queued"
                and canonical_tasks[tid].get("enabled") is not True
                )
            ]
            token = str(finding.get("diagnostic_id") or hashlib.sha256(
                (str(prior.get("canonical_commit")) + ":" + path).encode()).hexdigest()[:16])
            delivered = notice_delivered(root, token)
            if still_disabled or not delivered:
                drift = [item for item in drift if item.get('admission_path') != path]
                drift.append({**finding, "diagnostic_id": token,
                              "disabled_queued_task_ids": still_disabled or task_ids})
        status = {
            "status": "IN_SYNC" if old_blob == blob else "WOULD_SYNC" if dry_run else "SYNCED",
            "admission_drift": drift,
            "canonical_commit": head,
            "source_repo": str(repo.resolve()),
            "canonical_blob": blob,
            "runtime_blob": blob if old_blob == blob or not dry_run else old_blob,
            "active_count": len(active),
            "newly_admitted": [str(t["id"]) for t in admitted],
            "task_count": len(parse_backlog(payload, "canonical")[1]),
            "changed": old_blob != blob,
        }
        with writer_bridge.bridge_section():
            if old_blob != blob and not dry_run:
                with claim_sync_section(root):
                    if runtime_path.read_bytes() != runtime_raw:
                        raise SyncBlocked("runtime backlog changed concurrently; retry")
                    verify_candidate(payload, runtime_raw, read_active(state_path))
                    backup_dir = root / "backlog-backups"
                    backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
                    backup = backup_dir / f"before-main-{head[:12]}-{old_blob}.json"
                    if not backup.exists():
                        atomic_write(backup, runtime_raw)
                    # Detect an old/noncooperating writer too. Cooperating claims
                    # cannot arrive here until replacement releases the shared lock.
                    verify_candidate(payload, runtime_raw, read_active(state_path))
                    latest_state = read_runner_state(state_path)
                    if latest_state['history'] != runner_state['history']:
                        raise SyncBlocked('terminal/accepted dependency history changed during sync')
                    validate_recovery_transition(root, parse_backlog(runtime_raw, 'runtime')[0],
                        parse_backlog(payload, 'canonical')[0], latest_state)
                    for proof_path, proof_raw, proof_id in rebind_proofs:
                        if (proof_path.read_bytes() != proof_raw or
                                runner._v2_history_status(latest_state, proof_id) != runner._v2_history_status(runner_state, proof_id)):
                            raise SyncBlocked("accepted-source rebind evidence changed during sync")
                    mode = stat.S_IMODE(runtime_path.stat().st_mode)
                    atomic_write(runtime_path, payload, mode=mode)
                    if git_blob_sha(runtime_path.read_bytes()) != blob:
                        raise SyncBlocked("post-sync runtime checksum mismatch")
                    status["backup"] = backup.name
            if not dry_run:
                # Trust and transient status are separate. If interrupted between
                # these writes, mismatch blocks recovery rather than weakening ancestry.
                atomic_write(trust_path, (json.dumps({
                    "canonical_commit": head, "canonical_blob": blob,
                }) + "\n").encode())
                save_status(root, status)
            return status
    except (SyncBlocked, writer_bridge.BridgeHold, OSError, subprocess.TimeoutExpired) as exc:
        # Retain last known good canonical head even after a failed fetch,
        # unsafe candidate or temporary repo outage. A later non-fast-forward
        # source cannot bypass ancestry checks just by causing one error tick.
        try:
            failed_runtime_blob = git_blob_sha(runtime_path.read_bytes())
        except OSError:
            failed_runtime_blob = None
        info = {
            "status": "BLOCKED", "reason": str(exc)[:350], "changed": False,
            "canonical_commit": trusted.get("canonical_commit"),
            "canonical_blob": trusted.get("canonical_blob"),
            "admission_drift": prior.get("admission_drift", []),
            "runtime_blob": failed_runtime_blob,
        }
        if not dry_run and locked:
            # A loser NEVER writes shared metadata. Corrupt evidence is retained
            # byte-for-byte; errors go to a separate concrete diagnostic record.
            try:
                # A losing process must not write even the diagnostic/status
                # while the v3 Publisher or a Runner claim holds this inode.
                with writer_bridge.bridge_section():
                    atomic_write(root / "backlog-sync-diagnostic.json",
                                 (json.dumps({**info, "checked_at": now_iso()}) + "\n").encode())
                    if (not isinstance(exc, InvalidRunnerState) and metadata_valid and trusted
                            and failed_runtime_blob and (root / "backlog-sync-state.json").exists()):
                        save_status(root, info)
            except (OSError, writer_bridge.BridgeHold) as diagnostic_error:
                info["diagnostic_write_error"] = str(diagnostic_error)[:180]
        return info
    finally:
        lock_file.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path("/srv/gobadminton-clean/repo"))
    parser.add_argument("--runtime-root", type=Path, default=Path("/srv/gobadminton-clean/runner"))
    parser.add_argument("--no-fetch", action="store_true", help="synthetic/offline testing only")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    status = sync_once(args.repo, args.runtime_root, fetch=not args.no_fetch, dry_run=args.dry_run)
    print(json.dumps(status, ensure_ascii=False))
    return 0 if status.get("status") != "BLOCKED" else 2


if __name__ == "__main__":
    raise SystemExit(main())
