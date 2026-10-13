#!/usr/bin/env python3
"""Event/input-driven PM queue autopilot for GoBadminton on the Germany VPS.

This watcher never implements product code. When the primary queue is genuinely
empty or has disjoint preapproved source work, it launches one bounded PM
planning executor. Unchanged source/QA inputs never justify another full scan.
"""
from __future__ import annotations

import json
import hashlib
import math
import os
import signal
import stat
import subprocess
import sys
import time
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil
import runner
import backlog_sync
import queue_recovery
import publication_guard
import writer_bridge
import shlex

try:
    import msvcrt
except ImportError:
    msvcrt = None  # type: ignore

_CODE_ROOT = Path(__file__).resolve().parent
ROOT = (Path("/srv/gobadminton-clean/runner")
        if _CODE_ROOT.is_relative_to(Path("/opt/gobadminton-clean/runner-code"))
        else _CODE_ROOT)
CONFIG_PATH = ROOT / "config.json"
RUNNER_STATE_PATH = ROOT / "state.json"
BACKLOG_PATH = ROOT / "backlog.json"
AUTOPILOT_STATE_PATH = ROOT / "autopilot-state.json"
AUTOPILOT_LOG_PATH = ROOT / "autopilot.log"
AUTOPILOT_LOCK_PATH = ROOT / "autopilot.lock"
AUTOPILOT_RECEIPT_PATH = ROOT / "autopilot-receipt.json"
AUTOPILOT_WAKE_PATH = ROOT / "autopilot-wake.json"
OWNER_INBOX_DIR = ROOT / "owner-inbox"

CADENCE_SECONDS = 300
ACTIVE_POLL_SECONDS = 5
NO_ACTION_REPLAN_SECONDS = 300
PLANNER_TIMEOUT_SECONDS = 1800
BACKLOG_SYNC_INTERVAL_SECONDS = 60
OWNER_NO_ACTION_REPLAN_SECONDS = 300
WORKTREE = Path("/srv/gobadminton-clean/worktrees/pm-autopilot")
BRANCH = "pm/autopilot-local"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def owner_input_backoff(state: dict[str, Any], owner_key: str, *, now: float) -> bool:
    """Retry failed transport/planner attempts; unchanged successful decisions wait."""
    if state.get("last_owner_input_key") != owner_key:
        return False
    outcome = state.get("last_owner_attempt_outcome")
    if outcome is None:
        # Recover the deployed pre-fix failure without treating an arbitrary
        # no_safe_action summary as an execution error. Persist classification
        # before status changes to backoff so it survives subsequent restarts.
        if (state.get("status") == "owner_instruction_planner_error_retriable"
                or (state.get("status") == "owner_instruction_backoff"
                    and state.get("last_result") == "planner author identity unavailable")):
            outcome = state["last_owner_attempt_outcome"] = "planner_error"
    if outcome != "planner_error":
        return True
    attempted = state.get("last_owner_no_action_epoch")
    if (type(attempted) not in (int, float) or not math.isfinite(attempted)
            or attempted <= 0 or not math.isfinite(now)):
        return True
    return now - attempted < OWNER_NO_ACTION_REPLAN_SECONDS


def load_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return default


def write_json(path: Path, data: Any) -> None:
    # The Autopilot status and Owner metadata are also shared Publisher evidence.
    # A lease loser must not overwrite them; a nested planner launch borrows
    # the same validated thread-local lease.
    with writer_bridge.bridge_section():
        backlog_sync.atomic_write(path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode())


def durable_create_notice(path: Path, payload: dict[str, Any]) -> None:
    """Publish a complete fsynced notice with create-once semantics."""
    with writer_bridge.bridge_section():
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix=".notice-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as fp:
                fp.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode())
                fp.flush()
                os.fsync(fp.fileno())
            try:
                os.link(temp, path)
            except FileExistsError:
                pass
            parent = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
        finally:
            os.unlink(temp)


# Delivery/ack is not completion. Keep NEW + ACKNOWLEDGED actionable for the planner
# prompt so an instruction just flipped NEW->ACKNOWLEDGED is still visible.
ACTIONABLE_OWNER_STATUSES = frozenset({"NEW", "ACKNOWLEDGED"})


def pending_owner_instructions(
    statuses: frozenset[str] | set[str] | tuple[str, ...] = ACTIONABLE_OWNER_STATUSES,
) -> list[dict[str, Any]]:
    allowed = {str(x) for x in statuses}
    items: list[dict[str, Any]] = []
    cfg = load_json(CONFIG_PATH, {}) or {}
    if (cfg.get("project_repo") == "anpavel84-afk/gobadminton-clean"
            and cfg.get("owner_issue_intake_enabled") is True):
        # Exact GitHub Owner ID+Issue comment evidence, not a claimed
        # authorization from an arbitrary public issue/comment.
        from github_owner_issue_intake import poll_once, IntakeHold
        try:
            poll_once(ROOT, load_json(BACKLOG_PATH, {}) or {})
        except IntakeHold as exc:
            raise RuntimeError("authenticated Owner Issue intake held: " + str(exc)) from exc
    if not OWNER_INBOX_DIR.is_dir():
        return items
    for path in sorted(OWNER_INBOX_DIR.glob("*.json")):
        data = load_json(path, {}) or {}
        if not isinstance(data, dict):
            continue
        if str(data.get("status") or "NEW") not in allowed:
            continue
        if data.get("origin") == "SYSTEM_QA_RECOVERY_NOT_OWNER":
            continue  # recovery ledger, not inbox ACK, owns dispatch
        data["_path"] = str(path)
        items.append(data)
    return items


def update_owner_instruction_status(
    items: list[dict[str, Any]], status: str, note: str | None = None
) -> None:
    for item in items:
        raw_path = item.get("_path")
        if not raw_path:
            continue
        path = Path(str(raw_path))
        data = load_json(path, {}) or {}
        if not isinstance(data, dict):
            continue
        data["status"] = status
        data["updated_at"] = utc_now()
        if note is not None:
            data["planner_note"] = note
        write_json(path, data)


def enqueue_admission_reconcile_notice(sync_result: dict[str, Any]) -> list[str]:
    """One-shot PM diagnostic. Never represent machine inference as Owner approval."""
    drifts = sync_result.get("admission_drift") or []
    if not isinstance(drifts, list):
        return []
    ids: list[str] = []
    for item in drifts[:20]:
        if not isinstance(item, dict):
            continue
        doc = str(item.get("admission_path") or "")
        missing = list(item.get("disabled_queued_task_ids") or [])
        if not doc or not missing:
            continue
        token = str(item.get("diagnostic_id") or hashlib.sha256(
            (str(sync_result.get("canonical_commit") or "") + ":" + doc).encode()
        ).hexdigest()[:16])
        if not all(x in "0123456789abcdef" for x in token) or len(token) != 16:
            continue
        notice_id = "system-admission-drift-" + token
        path = OWNER_INBOX_DIR / (notice_id + ".json")
        payload = {
            "id": notice_id,
            "origin": "SYSTEM_ADMISSION_AUDIT_NOT_OWNER",
            "status": "NEW",
            "created_at": utc_now(),
            "text": (
                "SYSTEM DIAGNOSTIC, NOT NEW OWNER AUTHORIZATION: PM admission " + doc
                + " was merged into canonical main but queued tasks are still disabled: "
                + ", ".join(str(x) for x in missing[:12])
                + ". Check current Owner approval and immutable source/QA documents. "
                  "If genuinely source-admitted, reconcile main backlog source/admission/"
                  "locks/dependencies and then verify runtime parity via backlog_sync. "
                  "Do not enable from prose alone or bypass any release/privacy gate."
            ),
        }
        try:
            durable_create_notice(path, payload)
            recorded = load_json(path, {})
            if (not isinstance(recorded, dict) or recorded.get("id") != notice_id
                    or recorded.get("origin") != "SYSTEM_ADMISSION_AUDIT_NOT_OWNER"):
                continue  # partial/corrupt old evidence is never acknowledged
            write_json(OWNER_INBOX_DIR.parent / "backlog-sync-notices" / (token + ".json"),
                       {"notice_id": notice_id, "notice_path": str(path), "delivered_at": utc_now()})
            ids.append(notice_id)
        except OSError:
            continue  # retained sync diagnostic retries delivery next tick
    return ids


def consume_wake() -> dict[str, Any] | None:
    if not AUTOPILOT_WAKE_PATH.is_file():
        return None
    data = load_json(AUTOPILOT_WAKE_PATH, {}) or {}
    try:
        AUTOPILOT_WAKE_PATH.unlink()
    except OSError:
        pass
    return data if isinstance(data, dict) else None


def wait_for_wake(timeout: float) -> dict[str, Any] | None:
    """Interrupt the normal cadence when runner publishes a terminal event."""
    deadline = time.time() + max(0.0, timeout)
    while True:
        wake = consume_wake()
        if wake is not None:
            return wake
        remaining = deadline - time.time()
        if remaining <= 0:
            return None
        time.sleep(min(1.0, remaining))


def log(message: str) -> None:
    line = f"{utc_now()} {message}"
    print(line, flush=True)
    with AUTOPILOT_LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


class SingleInstanceLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.fh: Any = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.fh = open(self.path, "a+", encoding="utf-8")
        try:
            if msvcrt is not None:
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.fh.close()
            self.fh = None
            return False
        self.fh.seek(0)
        self.fh.truncate()
        self.fh.write(f"{os.getpid()}\n{utc_now()}\n")
        self.fh.flush()
        return True

    def release(self) -> None:
        if not self.fh:
            return
        try:
            if msvcrt is not None:
                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            self.fh.close()
        finally:
            self.fh = None


def completed_ids(state: dict[str, Any]) -> set[str]:
    return runner.completed_ids(state)


def pending_tasks(backlog: dict[str, Any], state: dict[str, Any]) -> list[dict[str, Any]]:
    return runner.pending_tasks(backlog, state)



def runtime_readiness_key(cfg: dict[str, Any]) -> str:
    """Bounded readiness change hint; never a policy authorization or secret."""
    policies = []
    for path in (
        "/etc/gobadminton-clean-control-plane/clean-publisher-policy.json",
        "/var/lib/gobadminton-clean-trusted-qa-evidence/policy.json",
    ):
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
                        or info.st_mode & 0o022 or info.st_size > 65536):
                    policies.append("invalid")
                    continue
                data = stream.read(65537)
                policies.append(hashlib.sha256(data).hexdigest()
                                if len(data) <= 65536 else "invalid")
        except FileNotFoundError:
            policies.append("absent")
        except OSError:
            policies.append("unreadable")
    projection = {
        "owner_issue_intake_enabled": cfg.get("owner_issue_intake_enabled") is True,
        "github_repo_write_authorized": cfg.get("github_repo_write_authorized") is True,
        "fixed_policy_digests": policies,
    }
    return hashlib.sha256(json.dumps(projection, sort_keys=True).encode()).hexdigest()


def planning_input_key(backlog, state, sync_result, owner_items=(), *, runtime_readiness=None):
    """Semantic source/evidence fingerprint, independent of monitor timestamps."""
    receipts = {}
    for task in backlog.get('tasks', []):
        if runner._v2_history_status(state, task['id']) in {'completed', 'qa_failed', 'qa_blocked'}:
            path = runner.receipt_path_for(task)
            receipts[task['id']] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    inputs = {'backlog': backlog, 'canonical_commit': sync_result.get('canonical_commit'),
              'history': [(h.get('id'), h.get('status'), h.get('verdict')) for h in state.get('history', [])],
              # Task claims are handled by Runner; no expensive PM replan on active-slot churn.
              'active': [],
              'gates': [state.get(k) for k in ('paused', 'blocked', 'global_gates', 'project_global_blocker')],
              'receipts': receipts,
              'owner': [{k: item.get(k) for k in ('id', 'origin', 'text', 'payload')} for item in owner_items]}
    if runtime_readiness is not None:
        inputs['runtime_readiness'] = runtime_readiness
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def budget_owner_waiting_qa(owner_items, backlog, state):
    """No LLM while the prior exact Owner-admitted producer awaits its own QA.

    This is a read-only budget wait hint, NEVER a positive permission or QA verdict.
    New independent Owner instructions are not swallowed by an older wait.
    """
    if not owner_items or not all(isinstance(item.get("budget_wait_for_qa"), list)
                                  for item in owner_items):
        return []
    sync = load_json(ROOT / "backlog-sync-state.json", {}) or {}
    if sync.get("status") != "IN_SYNC":
        return []
    tasks = runner._v2_task_map(backlog)
    wait = []
    for item in owner_items:
        if sync.get("canonical_commit") != item.get("budget_bound_main"):
            return []
        ids = item.get("budget_wait_for_qa") or []
        if not ids:
            return []
        for qid in ids:
            task = tasks.get(qid) if isinstance(qid, str) else None
            if not isinstance(task, dict) or not qid.startswith("qa-") or task.get("enabled") is not True:
                return []
            terminal = runner._v2_history_status(state, qid)
            if terminal in {"completed", "qa_failed", "qa_blocked", "blocked", "deferred"}:
                return []
            wait.append(qid)
    return sorted(set(wait))


def budget_record_new_qa_wait(owner_items, receipt):
    """Record a proposed QA wait, usable only after exact canonical sync proof."""
    if not isinstance(receipt, dict) or receipt.get("action") not in {
            "enqueued", "merged_and_enqueued"}:
        return
    sha = str(receipt.get("result_commit") or "")
    ids = receipt.get("task_ids") or []
    if len(sha) != 40 or not isinstance(ids, list) or not ids:
        return
    qa = [name for name in ids if isinstance(name, str) and name.startswith("qa-")]
    if not qa:
        return
    for item in owner_items:
        path_text = item.get("_path") if isinstance(item, dict) else None
        if not path_text:
            continue
        path = Path(str(path_text))
        current = load_json(path, {}) or {}
        if not isinstance(current, dict) or current.get("id") != item.get("id"):
            continue
        current["budget_wait_for_qa"] = qa
        current["budget_bound_main"] = sha
        current["budget_pending_reason"] = "Wait for exact new independent QA terminal evidence; no PM Codex polling"
        write_json(path, current)


def approved_source_opportunity(backlog, state, cfg):
    """Cheap bounded eligibility probe; disabled tasks alone grant no authority.

    Only exact preplanned source pairs with satisfied dependencies/gates or an
    own completed PASS awaiting merge justify a PM scan. Publication still needs
    immutable authority, all inherited QA/recovery gates and full batch checks.
    """
    tasks = runner._v2_task_map(backlog)
    for task in tasks.values():
        if (task.get('effect_ceiling') != 'source_only'
                or any(not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(task.get(k) or ''))
                       for k in ('source', 'admission'))):
            continue
        tid = task['id']
        terminal = runner._v2_history_status(state, tid)
        if tid.startswith('qa-') and terminal == 'completed' and not runner.active_claims(state):
            receipt = runner.read_receipt(runner.receipt_path_for(task)) or {}
            if (receipt.get('ok') is True and receipt.get('verdict') in {'PASS', 'PASS_WITH_NONBLOCKING_GAPS'}
                    and receipt.get('blocking_findings') == []
                    and receipt.get('merge_recommendation') == 'MERGE_RECOMMENDED'
                    and not runner._v2_dependency_accepted(backlog, state, tid)):
                return True
        if terminal in backlog_sync.TERMINAL_STATUSES or task.get('status', 'queued') != 'queued':
            continue
        # Enabled work belongs to Runner, never to a duplicate PM dispatch.
        if task.get('enabled') is True or tid.startswith('qa-'):
            if tid.startswith('qa-') and task.get('enabled') is False:
                producers = [d for d in runner._v2_dependencies(task, 'depends_on_completed') if not d.startswith('qa-')]
                if (len(producers) == 1 and runner._v2_history_status(state, producers[0]) == 'completed'
                        and runner.dependencies_ready(task, backlog, state)[0]
                        and runner.task_gate(task, cfg)[0]
                        and not any(runner.locks_conflict(runner.task_locks(task), c.get('locks') or ['global'])
                                    for c in runner.active_claims(state))):
                    return True
            continue
        qas = [q for q in tasks.values() if q['id'].startswith('qa-')
               and tid in runner._v2_dependencies(q, 'depends_on_completed')
               and q.get('effect_ceiling') == 'source_only'
               and q.get('status', 'queued') == 'queued'
               and runner._v2_history_status(state, q['id']) not in backlog_sync.TERMINAL_STATUSES
               and all(backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(q.get(k) or ''))
                       for k in ('source', 'admission'))]
        if len(qas) != 1:
            continue
        pair_locks = tuple(set(runner.task_locks(task)) | set(runner.task_locks(qas[0])))
        if any(runner.locks_conflict(pair_locks, c.get('locks') or ['global'])
               for c in runner.active_claims(state)):
            continue
        if runner.dependencies_ready(task, backlog, state)[0] and runner.task_gate(task, cfg)[0]:
            return True
    return False


def launch_planner_with_stale_retry(cfg, owner_items=None, *, active_admission_only=False):
    """One fresh replan on explicit pre-transport stale main; never replay a push.

    launch_planner/ensure_worktree fetches and requires a clean tree. Dirty or
    ambiguous interrupted publication stops through its existing guard.
    """
    result = launch_planner(cfg, owner_items=owner_items, active_admission_only=active_admission_only)
    ok, summary, receipt = result
    if (not ok and isinstance(receipt, dict) and receipt.get('error_code') == 'STALE_MAIN'
            and receipt.get('publication_attempted') is False):
        fresh = backlog_sync.sync_once(Path(str(cfg['workspace'])), ROOT)
        if fresh.get('status') in {'IN_SYNC', 'SYNCED'}:
            return launch_planner(cfg, owner_items=owner_items, active_admission_only=active_admission_only)
    return result


def pid_alive(pid: Any) -> bool:
    try:
        return bool(pid) and psutil.pid_exists(int(pid))
    except Exception:
        return False



def any_gobadminton_cursor_active() -> tuple[bool, str]:
    """Return only unmanaged GoBadminton writers.

    Runner v2-owned executors are represented by state.active and are not
    external writers. Cross-project prompt text is not a workspace binding.
    """
    cfg = load_json(CONFIG_PATH, {}) or {}
    state = load_json(RUNNER_STATE_PATH, {}) or {}
    try:
        migrated = runner._v2_migrate_state(state)
        active_pids = {
            int(c["agent_pid"]) for c in runner.active_claims(migrated)
            if c.get("agent_pid") and runner.pid_alive(int(c["agent_pid"]))
        }
        return runner.external_cursor_agent_busy(cfg, None, active_pids)
    except Exception as exc:
        return True, f"writer classification unavailable: {type(exc).__name__}: {exc}"

def cleanup_planner_process_group(pid: int | None) -> None:
    if not pid or sys.platform == "win32":
        return
    try:
        os.killpg(int(pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        return
    time.sleep(0.2)
    try:
        os.killpg(int(pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def run(cmd: list[str], cwd: Path | None = None, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


def ensure_worktree(cfg: dict[str, Any]) -> tuple[bool, str]:
    primary = Path(str(cfg["workspace"]))
    remote = run(["git", "remote", "get-url", "origin"], cwd=primary, timeout=15)
    if remote.returncode or remote.stdout.strip() != "git@github-gobadminton-clean:anpavel84-afk/gobadminton-clean.git":
        return False, "planner remote is not verified GoBadminton repository-specific SSH identity"
    author = run(["git", "var", "GIT_AUTHOR_IDENT"], cwd=primary, timeout=15)
    if author.returncode or not author.stdout.strip():
        return False, "planner author identity unavailable"
    fetch = run(["git", "fetch", "origin", "main"], cwd=primary, timeout=120)
    if fetch.returncode != 0:
        return False, f"git fetch failed: {fetch.stderr.strip()[:300]}"

    if not WORKTREE.exists():
        WORKTREE.parent.mkdir(parents=True, exist_ok=True)
        add = run(
            ["git", "worktree", "add", "-B", BRANCH, str(WORKTREE), "origin/main"],
            cwd=primary,
            timeout=120,
        )
        if add.returncode != 0:
            return False, f"worktree add failed: {add.stderr.strip()[:300]}"
    else:
        status = run(["git", "status", "--porcelain"], cwd=WORKTREE, timeout=30)
        if status.returncode != 0:
            return False, f"autopilot worktree status failed: {status.stderr.strip()[:300]}"
        if status.stdout.strip():
            return False, "autopilot worktree is dirty; manual inspection required"
        reset = run(["git", "reset", "--hard", "origin/main"], cwd=WORKTREE, timeout=60)
        if reset.returncode != 0:
            return False, f"autopilot reset failed: {reset.stderr.strip()[:300]}"
    return True, "worktree ready"



def build_prompt(
    cfg: dict[str, Any],
    owner_items: list[dict[str, Any]] | None = None,
    *,
    active_admission_only: bool = False,
) -> str:
    if cfg.get('autopilot_budget_mode') == 'compact':
        from compact_pm_brief import render
        return render(owner_items, active_admission_only)
    if cfg.get("project_repo") == "anpavel84-afk/gobadminton-clean":
        if owner_items is None:
            owner_items = pending_owner_instructions()
        requests = [{
            "id": v.get("id"), "origin": v.get("origin"),
            "text_sha256": v.get("text_sha256"),
            "task_ids": v.get("task_ids"),
            "text": str(v.get("text") or "")[:7000],
        } for v in owner_items if isinstance(v, dict)]
        return (
            "GoBadminton CLEAN PM. ONE already-authorized DEV source-only "
            "planning/publication action, not an implementation executor.\\n"
            "Read AGENTS.md, docs/assignments/20261013/, the exact current "
            "GitHub Issues #4/#12/#13/#14/#15, the real six-task canonical "
            "queue, immutable history and current main OID.\\n"
            "Authenticated Owner Inbox inputs (still subject to exact "
            "publication_guard, CAS and protected QA): "
            + json.dumps(requests, ensure_ascii=False, sort_keys=True) + "\\n"
            "Source-only DEV work, never PROD. Prefer existing prepared "
            "Friends S1 producer+own QA and Radar Map producer+own QA; "
            "do not duplicate draft PR19/PR20 code or import legacy 551 tasks. "
            "F2/F3 shared locks must serialize. Do not activate Avatar until "
            "its recorded predecessor and real write-path safety permit.\\n"
            "Select Codex model/effort by scoped task risk, no Cursor fallback, "
            "no sandbox bypass, no writes outside the PM worktree. Never edit "
            "Runner state, Owner Inbox, trust or application source.\\n"
            "For any source/QA admission: genuine Owner instruction ID and "
            "SHA256(trimmed UTF-8 instruction text), exact immutable Git source, "
            "the matching separate QA pair, unique task IDs, non-conflicting "
            "real file/lock scopes, the sole existing publication_guard "
            "pre-push and remote main compare-and-swap. No raw main push. "
            "No self-signed PASS or untrusted legacy evidence.\\n"
            "The planner prepares permitted PM documents in its worktree and "
            "returns its exact action/task_ids/owner_binding_path JSON proposal. "
            "Do NOT push Git or invoke publication_guard --publish yourself. "
            "The host commits the bounded PM diff and submits it to the separately "
            "credentialed Clean Publisher, which retains publication_guard/CAS. "
            "For already prepared first tasks, reuse Friends candidate "
            "f98b1ed42e3f3847ac305e487cf3a706d6a458f2 and Radar candidate "
            "ed1ad372751b25f1d4bddae1f13e1b3876ef5bec as task base_sha; "
            "their automatically claimed producers verify these sources rather "
            "than redevelop them. Each producer still needs its own newly executed "
            "protected QA job. Do not copy manual QA PASS into runtime.\\n"
            "Clean Publisher authority is the root-owned exact Owner-bound "
            "/etc/gobadminton-clean-control-plane/clean-publisher-policy.json, "
            "its immutable installed module pins and separate service/credential. "
            "You are deliberately NOT given its credential. Do not call that "
            "absence a blocker when the protected service is configured. Its "
            "exclusive publication lock and remote main SHA CAS fence transport. "
            "Do not manufacture historical V3/G1-G6 proofs or require activating "
            "the old Publisher. Optional writer_bridge policy, if present, must "
            "still validate; the adapter never weakens its checks.\\n"
            "If canonical single-writer credentials/policy, distinct nonauthor "
            "root QA, or protected Owner binding are absent, write "
            "no_safe_action with exact blocker and STOP. Do not claim a Git "
            "comment started a Runner task, nor claim DEV deployed.\\n"
            "Return exactly one JSON receipt. Host Codex --output-last-message "
            "writes /srv/gobadminton-clean/runner/autopilot-receipt.json; "
            "do not edit control-state directly. No secret output."
        )
    runtime = str(ROOT)
    if owner_items is None:
        owner_items = pending_owner_instructions()
    if owner_items:
        owner_section = "\n".join(
            f"- [{item.get('id')}] origin={item.get('origin') or 'OWNER_INBOX'} status={item.get('status') or 'NEW'} {str(item.get('text') or ((item.get('payload') or {}).get('text') if isinstance(item.get('payload'), dict) else '') or '').strip()}"
            for item in owner_items
        )
    else:
        owner_section = "- none"
    active_scope = (
        "Active application or QA executors exist. You MAY admit already Owner-authorized "
        "SOURCE-ONLY tasks with exact code/QA prompts and nonconflicting locks into GitHub main. "
        "You MUST NOT merge product code, deploy, modify live service/config/DB, run product "
        "tests against live data, change or pause any active claim, receipt or history, "
        "or reset/overwrite another writer. This is a PM DOCUMENTS + CANONICAL BACKLOG "
        "publication opportunity, not a universal safe execution/merge boundary. "
        "Existing Runner alone enforces locks/QA dependency and claims automatically."
        if active_admission_only else
        "No active Runner claim was observed when planning began. All normal PM code-merge, "
        "receipt, QA and release gates still apply; do not infer PROD permission."
    )
    return f"""You are PM · GoBadminton running one SAFE-BOUNDARY AUTOPILOT planning cycle on the Germany VPS.

Owner instruction inbox (highest PM priority, but NEVER overrides safety/QA/legal gates):
{owner_section}

If Owner instructions are present:
- treat them as durable Owner/PM direction;
- reconcile them with current Git/project authority and backlog;
- origin SYSTEM_QA_RECOVERY_NOT_OWNER is terminal QA evidence, never new Owner authority. Respect its recovery key, conceptual slice, max5 and source-only pair schema. Include recovery_key in planner receipt and durable binding; ACK is not dispatch/publication.
- origin SYSTEM_ADMISSION_AUDIT_NOT_OWNER is evidence of drift, never Owner authorization; reverify source-only admission before changing any task;
- apply them at this safe boundary when permitted;
- if an instruction conflicts with a safety/QA/legal gate, do not bypass the gate: return no_safe_action with the exact conflict;
- do not interrupt an already-running executor; if active, source-only admission ONLY.\n- Owner/PM active-executor planning scope: {active_scope}

You are NOT an implementation writer. Do not modify application code.

Mandatory authority:
- Read docs/operations/QUEUE_AUTOPILOT.md.
- For any frontend planning, also read docs/operations/CANONICAL_FRONTEND_REBASE_PLAN_V001.md, docs/manifest/CANONICAL_FRONTEND_REBASE_TASK_INDEX_V001.json, docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md and docs/operations/MODEL_ROUTING_AND_BUDGET_V004.md.
- Never reactivate a task marked HELD_SUPERSEDED_BY_CANONICAL_REBASE.
- While backlog.policy.canonical_frontend_rebase.status is PREPLANNED_HOLD, do not enable any FR-* task. Require the frozen source reference and PM hold-narrowing first.
- Read docs/operations/FINAL_CONSUMER_SOCIAL_DELIVERY_TRAIN_V001.md.
- Read docs/delivery/FINAL_CONSUMER_SOCIAL_WEB_DELIVERY_V001.md.
- Read current backend/Radar PM successor documents.
- Read AGENTS.md, CURSOR.md and applicable repository rules.
- Git history + durable handoffs are project truth.
- /srv/gobadminton is LIVE runtime material: read-only/out of scope.
- /srv/agent-agency is another project: out of scope.
- PROD/real-user/live OAuth/live Radar for real people remain forbidden without separate exact admission. Synthetic `DEMO_PUBLIC` deployment tasks in OWNER_DECISION_PUBLIC_SYNTHETIC_DEMO_MVP_V001 are already separately admitted.
- Never bypass Owner/safety/IR/O gates.
- Read docs/decisions/OWNER_DECISION_FRONTEND_HOLD_V001.md. It still blocks legacy/superseded frontend tasks, but it does NOT block an explicitly PM-admitted canonical FR-* task under CANONICAL_FRONTEND_REBASE_PLAN_V001 / PM_ADMISSION_FR*. When backlog.policy.canonical_frontend_rebase.status is ACTIVE_FRxx_ONLY, that exact FR pair is allowed; all other frontend tasks remain held.
- QA FAIL is a hard no-merge.
- Maximum five repairs per slice.
- Admit UP TO FOUR already preapproved disjoint SOURCE_ONLY producer + separate dependent QA pairs per cycle. Select by priority; no orphan producer or invented backlog. Existing Owner/release/QA/terminal gates still apply. QA-recovery ledger dispatch retains its stricter one-pair/max5 protocol.
- Check hierarchical locks and reviewed future file paths across the whole batch and active claims. Unknown scope/glob overlap fails closed. Optional admission_pairs=[{{producer_task_id,qa_task_id,write_paths}}] must be identical in receipt and durable binding; use exact relative files/directories or trailing /** only. Do not add unsupported fields to executable task definitions.

Runtime:
- repo: {cfg['workspace']}
- runner root: {runtime}
- runner state: {RUNNER_STATE_PATH}
- backlog: {BACKLOG_PATH}
- receipt: {AUTOPILOT_RECEIPT_PATH}

VPS transport policy:
- Git SSH is the primary durable transport.
- GitHub API/gh and PR creation are OPTIONAL, not required for execution.
- Never invent a PR/comment/check status.
- A pushed named branch + immutable SHA + durable handoff is sufficient candidate transport.
- QA must bind the exact SHA.
- After QA PASS/PASS_WITH_NONBLOCKING_GAPS with zero blocking gaps and explicit merge recommendation, PM may merge git-native:
  1. fetch origin;
  2. verify main and candidate exact SHAs;
  3. verify QA handoff/receipt binds candidate SHA;
  4. merge candidate into current main without rewriting history;
  5. run/verify required gates if not already exact-head proven;
  6. push --atomic --force-with-lease=refs/heads/main:<exact-baseline-sha> origin HEAD:refs/heads/main (the guard also requires fast-forward ancestry; never rewrite history).
- Write the exact planner receipt BEFORE main push; the inherited Git pre-push guard validates the entire recovery delta and independent merge evidence under the claim/publication lock. Preserve the inherited Git hooks configuration. Source merge runs under the existing single planner publication lock; reverify exact candidate/QA immediately before push. While workers are active, prepare intake only; defer source merge to safe publication boundary. Return accepted_qa_task_id and merged_candidate_sha for any merge.
- Merge != deploy.

Before action:
1. Re-read runner state/backlog.
2. If Runner paused or BLOCKED is Owner/global/ambiguous, write no_safe_action and stop.\n   If Runner has active executors, only prepare, publish and verify non-overlapping\n   *source-only PM admissions*; no code merge or deployment. Never wait for 0/2 to\n   record an already authorized independent new Owner task.
   An explicitly lane_local BLOCKED safe boundary permits Owner Inbox inspection
   and PM-only quarantine/independent-lane planning. Preserve receipt/history and
   attempts; never retry that task/SHA. Disable the blocked entry with its truthful
   terminal status in canonical backlog, push main and synchronize runtime backlog.
   Successful recovery receipt must include result_commit=<exact pushed main SHA>.
   Do not edit runner state: the runner verifies publication and releases pointers.
3. Fetch origin when Git transport is available.
4. Inspect ALL unresolved train lanes, branch refs, receipts and handoffs.
5. Do not let a newer unrelated PASS hide an older prerequisite FAIL.

Decision priority:
1. blocking QA FAIL -> narrow repair + one reverify, preserving attempt counter;
2. exact-head accepted candidate -> git-native merge if all gates satisfied;
3. implementation candidate without QA -> enqueue QA;
4. inspect canonical backlog for Owner-authorized enabled=false preplanned tasks in ascending order; if the next pair's task-manifest activation gate is satisfied, enable/publish that existing pair instead of inventing replacements;
5. dependency newly satisfied but no preplanned entry exists -> only rebind an exact already approved prepared source prompt + own QA; absent durable authority stop;
6. next dependency-safe already approved source train slice;
7. otherwise exact no_safe_action.

Preplanned disabled tasks:
- read docs/manifest/MVP_COMPLETION_TASK_INDEX_V001.json;
- enabled=false may be a dependency OR Owner-approval hold; read exact authority, never infer permission from the flag;
- activate only after predecessor QA PASS/PASS_WITH_NONBLOCKING_GAPS with zero blocking findings and required durable merge/acceptance;
- QA FAIL/BLOCKED outranks all later activation;
- synthetic demo deploy entries are already Owner-authorized;
- live OAuth and real-user launch entries remain disabled until their explicit O-gates close.

Executor routing:
- read docs/operations/MODEL_ROUTING_AND_BUDGET_V004.md before creating or activating tasks;
- TEMPORARY CURSOR SUSPENSION is active: do NOT enqueue or activate new executor=cursor tasks until Owner explicitly re-enables Cursor;
- routine/mechanical UI, skeleton, preview/deploy/smoke, readiness, docs and low-risk repetitive QA -> executor=codex, model=gpt-6-luna, effort=low|medium;
- nontrivial engineering avatar/media, messaging/GameChat, auth semantics, backend state/concurrency/idempotency, moderation/domain commands, merge integrity and complex repairs -> executor=codex, model=gpt-6.1-sol, effort=medium|high;
- Radar/privacy/security/admin identity-RBAC-WebAuthn/sensitive restriction-bypass/privacy evidence/launch-readiness -> executor=codex, model=gpt-6-astra, effort=high;
- PM/autopilot planning stays gpt-6.1-sol/high;
- Grok remains separate external review and is never a model selector;
- every queued Codex task MUST set explicit model, effort and sandbox;
- sandbox=workspace by default; sandbox=full only for exact Docker/system needs with explicit no-live-effect boundary;
- never automatically escalate model after QA failure; classify defect/risk first;
- completed/FAIL/BLOCKED/superseded history keeps its historical model label.

Allowed PM repository writes:
- docs/prompts/**
- docs/manifest/**
- docs/operations/**
- docs/delivery/**
- docs/handoffs/**
- _automation/gobadminton-runner/backlog.json
Forbidden:
- apps/**
- packages/**
- infra/**
- migrations/**
- frozen Design Spec
- live runtime

For each queued task:
- exact durable prompt;
- immutable base/predecessor bindings;
- 4–10 blocks;
- allowed/denied writes;
- required tests;
- stop boundary;
- executor/model/effort only when intentionally selected;
- update canonical backlog without deleting history.

Before pushing PM changes:
- fetch origin main;
- reconcile worktree with origin/main;
- nontrivial conflict => no_safe_action;
- commit PM-only changes;
- push branch/main only according to the exact planning action.
- Main publication is one atomic expected-SHA transaction under the single PM writer. STALE_MAIN before transport permits one fresh replan only, with error receipt error_code=STALE_MAIN, publication_attempted=false. A dirty/interrupted or already pushed result requires reconciliation, never blind retry.
- Use the guarded transport: {sys.executable} {Path(publication_guard.__file__).resolve()} --publish {WORKTREE} {ROOT} {ROOT / 'planner-publication-hooks/context.json'}. It validates ancestry, receipt/batch/evidence, serializes publication and pushes --atomic with the expected main SHA. Never use direct main push to bypass it.

After canonical backlog change:
- GitHub main is canonical; do NOT copy a local worktree file to runtime.\n- Publish merged source+queue atomically in main, then rely on backlog_sync to\n  fetch main, check immutable sources/active claims and atomically replace runtime.\n- Verify canonical/runtime blob parity from the returned sync evidence; an\n  unverified copied or dirty checkout MUST NOT be reported as applied.\n- do not launch the queued implementation yourself; Runner will do that.

Receipt required at {AUTOPILOT_RECEIPT_PATH}.
For any action claiming an Owner instruction is PLANNED, publish a JSON binding
under docs/manifest/ in result_commit, and return owner_binding_path in receipt.
Binding schema: project=GoBadminton, instructions=[{{id: exact inbox id,
text_sha256: SHA256 of trimmed UTF-8 instruction text, action: reported action,
task_ids: exact tasks fulfilling this request}}]. Preserve request text/origin.
An unrelated new task or a fabricated receipt never dispositions the request.
Use one of:
{{"ok":true,"project":"GoBadminton","action":"enqueued","task_ids":["<exact-enabled-task-id>"],"result_commit":"<merged-main-sha>","summary":"...","result_ref":"<commit/branch/prompt>"}}
{{"ok":true,"project":"GoBadminton","action":"merged_and_enqueued","task_ids":["<exact-enabled-task-id>"],"result_commit":"<merged-main-sha>","summary":"...","result_ref":"<merge + queue commit>"}}
{{"ok":true,"project":"GoBadminton","action":"merged","summary":"...","result_ref":"<merge SHA>"}}
{{"ok":true,"project":"GoBadminton","action":"no_safe_action","summary":"<exact reason>","result_ref":"<evidence>"}}
{{"ok":false,"project":"GoBadminton","action":"error","summary":"<exact error>","result_ref":"<evidence>"}}

Stop after one planning cycle.
"""

def planner_publication_environment(active_admission_only=False):
    """Hooks are child-process Git config only; never shared/worktree config."""
    directory = ROOT / 'planner-publication-hooks'
    directory.mkdir(parents=True, exist_ok=True)
    baseline = backlog_sync.run_git(WORKTREE, ['rev-parse', 'refs/remotes/origin/main'])
    context = directory / 'context.json'
    write_json(context, {'baseline': baseline, 'active_admission_only': active_admission_only})
    hook = directory / 'pre-push'
    command = [sys.executable, str(Path(publication_guard.__file__).resolve()),
               str(WORKTREE), str(ROOT), str(context)]
    backlog_sync.atomic_write(hook, ('#!/bin/sh\nexec ' + shlex.join(command) + '\n').encode(), mode=0o700)
    env = dict(os.environ)
    count = int(env.get('GIT_CONFIG_COUNT', '0'))
    env.update({'GIT_CONFIG_COUNT': str(count + 1),
                f'GIT_CONFIG_KEY_{count}': 'core.hooksPath',
                f'GIT_CONFIG_VALUE_{count}': str(directory)})
    return env


def launch_planner(
    cfg: dict[str, Any],
    owner_items: list[dict[str, Any]] | None = None,
    *,
    active_admission_only: bool = False,
) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        with writer_bridge.bridge_section():
            pass  # Validate epoch before setup; native pre-push revalidates delta.
    except writer_bridge.BridgeHold as exc:
        return False, str(exc), None
    prior = load_json(AUTOPILOT_STATE_PATH, {}) or {}
    if pid_alive(prior.get("planner_pid")):
        return False, "existing planner PID still alive; publication reconciliation required", None
    ok, reason = ensure_worktree(cfg)
    if not ok:
        return False, reason, None

    # A failed later lease revalidation must preserve an existing receipt.
    # Remove the prior receipt only inside the actual authoritative spawn lease.
    try:
        publication_env = planner_publication_environment(active_admission_only)
    except (OSError, ValueError, RuntimeError) as exc:
        return False, 'publication safety setup failed: ' + str(exc), None
    prompt = build_prompt(cfg, owner_items=owner_items, active_admission_only=active_admission_only)
    clean = cfg.get("project_repo") == "anpavel84-afk/gobadminton-clean"
    planner_executor = str(cfg.get("autopilot_planner_executor")
                           or ("codex" if clean else "cursor")).strip().lower()
    if clean and planner_executor != "codex":
        return False, "clean-root planner must use Codex workspace sandbox", None
    worktrees_root = str(Path(str(cfg["workspace"])).parent / "worktrees")
    if planner_executor == "codex":
        cli = str(cfg.get("codex_cli") or "")
        if not cli or not Path(cli).is_file():
            return False, "codex CLI missing", None
        model = str(
            cfg.get("autopilot_codex_model")
            or cfg.get("codex_default_model")
            or "gpt-6.1-sol"
        )
        effort = str(cfg.get("autopilot_codex_effort") or "high").strip().lower()
        cmd = [
            cli, "exec", "--color", "never",
            "-C", str(WORKTREE),
            "--approve-for-me",
            "--output-last-message", str(AUTOPILOT_RECEIPT_PATH),
            "--model", model,
        ]
        if clean:
            cmd += ["--disable", "apps", "--disable", "remote_plugin", "--disable", "hooks",
                    "--ignore-user-config", "-c", "apps._default.enabled=false"]
        if effort in {"low", "medium", "high", "xhigh", "extra_high"}:
            normalized = "xhigh" if effort == "extra_high" else effort
            cmd += ["-c", f'model_reasoning_effort="{normalized}"']
        cmd += [prompt]
    elif planner_executor == "cursor":
        agent = str(cfg.get("cursor_agent") or "")
        if not agent or not Path(agent).is_file():
            return False, "cursor-agent missing", None
        cmd = [agent, "--print", "--output-format", "json", "--model", "auto"]
        workspace_mode = str(cfg.get("cursor_workspace_mode") or "auto_review_no_native_sandbox")
        if workspace_mode == "native_sandbox":
            cmd += ["--force", "--trust", "--sandbox", "enabled"]
        else:
            cmd += ["--force", "--trust", "--sandbox", "disabled"]
        cmd += [
            "--workspace", str(WORKTREE),
            "--add-dir", str(ROOT),
            "--add-dir", worktrees_root,
            prompt,
        ]
    else:
        return False, f"unsupported autopilot planner executor: {planner_executor}", None
    creationflags = 0

    stdout = (ROOT / "autopilot-agent.stdout.log").open("a", encoding="utf-8")
    stderr = (ROOT / "autopilot-agent.stderr.log").open("a", encoding="utf-8")
    try:
        # Recheck the exact pinned epoch at the actual planner spawn boundary.
        # No model run, job claim or network operation occurs under this lease.
        with writer_bridge.bridge_section():
            try:
                if AUTOPILOT_RECEIPT_PATH.exists():
                    AUTOPILOT_RECEIPT_PATH.unlink()
            except OSError:
                pass
            proc = subprocess.Popen(
                cmd,
                cwd=str(WORKTREE),
                stdin=subprocess.DEVNULL,
                stdout=stdout,
                stderr=stderr,
                creationflags=creationflags,
                start_new_session=True,
                env={
                    **publication_env,
                    "PATH": ":".join([
                        str(cfg.get("node_bin") or
                            ("/home/agentagency-dev/.local/node-v24.21.0/bin"
                             if clean else "")),
                        str(cfg.get("local_bin") or
                            ("/home/agentagency-dev/.local/bin" if clean else "")),
                        os.environ.get("PATH", ""),
                    ]),
                },
            )

            ap_state = load_json(AUTOPILOT_STATE_PATH, {}) or {}
            ap_state.update({
                "planner_pid": proc.pid,
                "planner_started_at": utc_now(),
                "status": "planning",
            })
            write_json(AUTOPILOT_STATE_PATH, ap_state)
    except writer_bridge.BridgeHold as exc:
        # If the epoch was revoked during spawn, do not leave a detached PM
        # planner running or report planning after a denied authority.
        if 'proc' in locals():
            try:
                proc.terminate()
            except (OSError, AttributeError):
                pass
            # Also terminate any detached descendants from this *newly* denied
            # planner group; never affect already-running Runner workers.
            cleanup_planner_process_group(getattr(proc, "pid", None))
        stdout.close()
        stderr.close()
        return False, str(exc), None
    log(f"planner started pid={proc.pid} executor={planner_executor}")

    try:
        # Cost brake: one bounded compact cycle, not a 30-minute PM loop.
        limit = min(PLANNER_TIMEOUT_SECONDS, 600) if cfg.get('autopilot_budget_mode') == 'compact' else PLANNER_TIMEOUT_SECONDS
        rc = proc.wait(timeout=limit)
    except subprocess.TimeoutExpired:
        proc.terminate()
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
        return False, "planner timeout", None
    finally:
        cleanup_planner_process_group(proc.pid)
        stdout.close()
        stderr.close()

    receipt = load_json(AUTOPILOT_RECEIPT_PATH, None)
    if not isinstance(receipt, dict):
        return False, f"planner exit {rc}; receipt missing/invalid", None
    if receipt.get("project") != "GoBadminton":
        return False, "planner receipt project mismatch", receipt
    if receipt.get("ok") is not True:
        return False, str(receipt.get("summary") or "planner reported error"), receipt
    if rc != 0:
        return False, f"planner exit {rc} despite receipt", receipt
    if (clean and cfg.get("github_repo_write_authorized") is True
            and receipt.get("action") in {"enqueued", "merged", "merged_and_enqueued"}):
        try:
            from clean_publish_submit import prepare_pm_proposal
            receipt = prepare_pm_proposal(WORKTREE, receipt)
        except Exception as exc:
            return False, "separated PM Publisher rejected proposal: " + str(exc), receipt
    state = load_json(RUNNER_STATE_PATH, {}) or {}
    if runner.lane_local_block(state) and receipt.get("action") in {
        "enqueued", "merged_and_enqueued", "merged", "quarantined"}:
        runner.atomic_write_json(runner.BLOCK_RELEASE_PATH, {
            "blocked": state["blocked"], "result_commit": receipt.get("result_commit"),
        })
    return True, str(receipt.get("summary") or "planning cycle complete"), receipt


def _verify_planner_publication(
    cfg: dict[str, Any],
    receipt: dict[str, Any] | None,
    sync_result: dict[str, Any],
    backlog_before: dict[str, Any],
    backlog_after: dict[str, Any],
    owner_items: list[dict[str, Any]] | None = None,
    *, active_admission_only: bool = False,
) -> tuple[bool, str]:
    """A PM receipt is not proof of published/activated Owner work.

    Verify fresh Git SHA ancestry, canonical/runtime checksum agreement and
    actual, immutable, newly enabled tasks. For a source-only merge, commit
    ancestry and change since original baseline are still required.
    """
    if (not isinstance(receipt, dict) or receipt.get("ok") is not True
            or receipt.get("project") != "GoBadminton"):
        return False, "planner receipt missing"
    action = str(receipt.get("action") or "")
    if action not in {"enqueued", "merged_and_enqueued", "merged", "quarantined"}:
        return False, f"unsupported reported planner action: {action}"
    if sync_result.get("status") not in {"IN_SYNC", "SYNCED"}:
        return False, "GitHub/runtime reconcile reported BLOCKED"
    if active_admission_only and action != "enqueued":
        return False, "active executor planning permits source-only enqueued action"
    head = str(sync_result.get("canonical_commit") or "")
    code = str(receipt.get("result_commit") or "")
    if not (len(head) == 40 and len(code) == 40 and
            all(x in "0123456789abcdef" for x in head + code)):
        return False, "missing full immutable merged-main result_commit"
    repo = Path(str(cfg["workspace"]))
    proof = run(
        ["git", "merge-base", "--is-ancestor", code, head],
        cwd=repo, timeout=20,
    )
    if proof.returncode != 0:
        return False, "reported result_commit is not an ancestor of canonical main"
    baseline = str(backlog_before.get("_canonical_commit") or "")
    if (not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(
            f"https://github.com/anpavel84-afk/gobadminton-clean/blob/{baseline}/baseline")
            or baseline == code
            or run(["git", "merge-base", "--is-ancestor", baseline, code],
                   cwd=repo, timeout=20).returncode != 0):
        return False, "result_commit is stale/unrelated to planning baseline"
    if active_admission_only:
        changed = run(["git", "diff", "--name-only", baseline, code], cwd=repo, timeout=20)
        if changed.returncode or any(not (path.startswith("docs/") or path == backlog_sync.CANONICAL_PATH)
                                     for path in changed.stdout.splitlines()):
            return False, "active source-only publication changed non-PM code/resources"
    try:
        canonical = run(["git", "show", f"{head}:{backlog_sync.CANONICAL_PATH}"], cwd=repo)
        published = run(["git", "show", f"{code}:{backlog_sync.CANONICAL_PATH}"], cwd=repo)
        raw = BACKLOG_PATH.read_bytes()
        if (canonical.returncode or published.returncode
                or json.loads(canonical.stdout) != backlog_after
                or json.loads(raw) != backlog_after
                or backlog_sync.git_blob_sha(raw) != sync_result.get("canonical_blob")
                or sync_result.get("runtime_blob") != sync_result.get("canonical_blob")):
            return False, "canonical/runtime parity cannot be verified"
        published_tasks = {t["id"]: t for t in json.loads(published.stdout)["tasks"]}
        # Durable publication must bind each exact request, including its text,
        # to its action/task IDs. A receipt's own assertion is insufficient.
        binding_path = receipt.get("owner_binding_path")
        if (not isinstance(binding_path, str)
                or not binding_path.startswith("docs/manifest/")
                or not binding_path.endswith(".json")
                or ".." in binding_path.split("/")):
            return False, "missing durable Owner publication binding"
        binding_doc = run(["git", "show", f"{code}:{binding_path}"], cwd=repo)
        binding = json.loads(binding_doc.stdout) if binding_doc.returncode == 0 else {}
        if binding.get("project") != "GoBadminton" or not isinstance(binding.get("instructions"), list):
            return False, "invalid durable Owner publication binding"
        if not owner_items:
            return False, "exact Owner request unavailable"
        for item in owner_items:
            text = str(item.get("text") or ((item.get("payload") or {}).get("text")
                       if isinstance(item.get("payload"), dict) else "") or "").strip()
            digest = hashlib.sha256(text.encode()).hexdigest()
            matches = [b for b in binding["instructions"] if isinstance(b, dict)
                       and b.get("id") == item.get("id") and b.get("text_sha256") == digest
                       and b.get("action") == action]
            if len(matches) != 1:
                return False, f"publication does not bind exact Owner request {item.get('id')}"
            ids = matches[0].get("task_ids")
            if (action in {"enqueued", "merged_and_enqueued"}
                    and (not isinstance(ids, list) or not ids
                         or any(tid not in (receipt.get("task_ids") or []) for tid in ids))):
                return False, "Owner request task IDs disagree with publication receipt"
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return False, "malformed canonical publication or Owner binding"
    before = {
        str(t["id"]): t for t in (backlog_before.get("tasks") or [])
        if isinstance(t, dict) and t.get("id")
    }
    after = {
        str(t["id"]): t for t in (backlog_after.get("tasks") or [])
        if isinstance(t, dict) and t.get("id")
    }
    try:
        publication_root = BACKLOG_PATH.parent
        state = backlog_sync.read_runner_state(publication_root / "state.json")
        backlog_sync.validate_recovery_transition(publication_root, backlog_before, backlog_after, state,
            repo, baseline, code, receipt)
        if action in {'enqueued', 'merged_and_enqueued'}:
            publication_guard.validate_admission_batch(backlog_before, backlog_after, state, receipt, binding)
        if action in {'merged', 'merged_and_enqueued'}:
            if code != head:
                return False, 'source merge result_commit must equal exact observed main head'
            publication_guard.accepted_merge_proof(repo, publication_root, backlog_before, state,
                receipt, baseline, code)
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
        return False, 'publication safety rejected: ' + str(exc)
    if action in {"enqueued", "merged_and_enqueued"}:
        task_ids = receipt.get("task_ids") or []
        if not isinstance(task_ids, list) or not task_ids:
            return False, "enqueued action missing task_ids"
        for tid in task_ids:
            if not isinstance(tid, str) or tid not in after:
                return False, f"reported task {tid!r} missing in canonical runtime"
            after_task = after[tid]
            if published_tasks.get(tid) != after_task:
                return False, f"reported task {tid} not defined by actual result_commit"
            prior_task = before.get(tid) or {}
            if (after_task.get("status") != "queued" or
                    after_task.get("enabled") is not True):
                return False, f"reported task {tid} not enabled queued"
            changed = (not prior_task or prior_task.get("enabled") is not True or
                       any(prior_task.get(k) != after_task.get(k) for k in
                           ("source", "admission", "depends_on_completed",
                            "depends_on_accepted", "locks", "order")))
            if not changed:
                return False, f"reported task {tid} already queued before planning"
            for field in ("source", "admission"):
                if not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(
                    str(after_task.get(field) or "")
                ):
                    return False, f"reported task {tid} lacks exact {field}"
        return True, "verified newly admitted source/QA task(s)"
    if code == str((backlog_before.get("_canonical_commit") or "")):
        return False, "no newly published merge since planning began"
    return True, "verified immutable source merge result"


def verify_planner_publication(cfg, receipt, sync_result, backlog_before, backlog_after,
                               owner_items=None, *, active_admission_only=False):
    verified, reason = _verify_planner_publication(cfg, receipt, sync_result,
        backlog_before, backlog_after, owner_items, active_admission_only=active_admission_only)
    if isinstance(receipt, dict) and receipt.get('action') in {'merged', 'merged_and_enqueued'}:
        target = receipt.get('result_commit')
        if not verified:
            publication_guard.quarantine(BACKLOG_PATH.parent, target, reason)
            reason += '; source publication quarantined, manual remediation required if push preexisted'
        reservation = BACKLOG_PATH.parent / 'source-merge-reservation.json'
        with backlog_sync.claim_sync_section(BACKLOG_PATH.parent):
            if reservation.exists():
                data = json.loads(reservation.read_text())
                if data.get('result_commit') == target:
                    write_json(reservation, {**data, 'status': 'VERIFIED' if verified else 'QUARANTINED',
                                            'reason': reason})
    return verified, reason


def recovery_tick(cfg, backlog, state, ap_state):
    """Observe existing recovery; retry verification, never dispatch/publication."""
    try:
        # Corrupt shared state is a project-wide writer-integrity boundary,
        # not a lane-local QA failure. Do not resume Owner processing before
        # validating the same strict terminal history accepted by Runner.
        backlog_sync.validate_history(state.get("history"))
        ledger = queue_recovery.observe(ROOT, backlog, state, pid_alive)
        ap_state["qa_recovery_actions"] = {key: {k: entry.get(k) for k in
            ("status", "attempt", "reason", "task_ids", "claim_pid")}
            for key, entry in ledger["actions"].items()}
        selected, waits = runner.select_runnable_tasks(backlog, state, cfg)
        ap_state["queue_classification"] = runner.queue_eligibility(backlog, state, cfg)
        if state.get("global_gates") or state.get("project_global_blocker"):
            ap_state.update(status="STOPPED_SAFE", hold_reason="WAITING_OWNER_RELEASE: true project global safety gate")
            return True
        for entry in ledger["actions"].values():
            if entry.get("status") not in {"DISPATCH_RESERVED", "HOLD"}:
                continue
            previous = load_json(AUTOPILOT_RECEIPT_PATH, {}) or {}
            if entry.get("baseline") and previous.get("recovery_key") == entry["key"]:
                notice = load_json(ROOT / "owner-inbox" / (entry["notice_id"] + ".json"), {}) or {}
                if notice.get("id") != entry["notice_id"]:
                    raise queue_recovery.RecoveryHold("existing recovery notice unavailable")
                result = backlog_sync.sync_once(Path(str(cfg["workspace"])), ROOT)
                after = load_json(BACKLOG_PATH, {}) or {}
                verified, reason = verify_planner_publication(cfg, previous, result,
                    entry["baseline"], after, [notice], active_admission_only=True)
                if verified:
                    ids = queue_recovery.validate_pair(entry, entry["baseline"], after, previous, state)
                    queue_recovery.finish(ROOT, entry["key"], "ADMITTED", task_ids=ids,
                        publication_commit=previous["result_commit"], reason="restart publication reconciled; awaiting claim PID")
                    ap_state.update(status="qa_recovery_admitted", backlog_sync=result)
                    return False
                ap_state.update(status="STOPPED_SAFE", hold_reason=reason)
            else:
                ap_state.update(status="STOPPED_SAFE", hold_reason=entry.get("reason") or "existing recovery publication unverified")
            if selected:
                ap_state.update(status="runner_ready", local_holds=waits[:10])
                return False
            return True
        ap_state.update(status="runner_ready" if selected else "NO_ELIGIBLE_WORK",
                        hold_reason="existing admitted work" if selected else "no eligible current task",
                        local_holds=waits[:10])
        return False
    except Exception as exc:
        ap_state.update(status="STOPPED_SAFE", hold_reason=f"recovery evidence unavailable: {type(exc).__name__}: {exc}")
        return True


def main() -> int:
    cfg = load_json(CONFIG_PATH, {}) or {}
    if cfg.get("project") != "GoBadminton" or cfg.get("prod_authorized") is not False:
        log("REFUSE: invalid config/project/prod_authorized")
        return 2

    lock = SingleInstanceLock(AUTOPILOT_LOCK_PATH)
    if not lock.acquire():
        log("REFUSE: another autopilot holds lock")
        return 3

    log(f"autopilot start pid={os.getpid()} cadence={CADENCE_SECONDS}s")
    prior = load_json(AUTOPILOT_STATE_PATH, {}) or {}
    if not pid_alive(prior.get("planner_pid")):
        prior["planner_pid"] = None
        prior["planner_started_at"] = None
        write_json(AUTOPILOT_STATE_PATH, prior)
    try:
        while True:
            now = time.time()
            runner_state = load_json(RUNNER_STATE_PATH, {}) or {}
            backlog = load_json(BACKLOG_PATH, {}) or {}
            ap_state = load_json(AUTOPILOT_STATE_PATH, {}) or {}
            ap_state.update({
                "pid": os.getpid(),
                "alive": True,
                "cadence_seconds": CADENCE_SECONDS,
                "active_poll_seconds": ACTIVE_POLL_SECONDS,
                "last_check_at": utc_now(),
            })

            if not pid_alive(ap_state.get('planner_pid')):
                try:
                    reservation = publication_guard.reconcile_reservation(Path(str(cfg['workspace'])), ROOT)
                    if reservation:
                        ap_state['source_publication'] = reservation
                except (RuntimeError, OSError, ValueError, KeyError, TypeError) as exc:
                    ap_state.update(status='source_publication_waiting', hold_reason=str(exc))
                    write_json(AUTOPILOT_STATE_PATH, ap_state)
                    wait_for_wake(ACTIVE_POLL_SECONDS)
                    continue

            # Cheap bounded canonical/runtime reconciliation runs even while 2/2
            # executors are busy. Never checkout/reset the stale primary Git tree.
            last_sync = float(ap_state.get("last_backlog_sync_epoch") or 0)
            if now - last_sync >= BACKLOG_SYNC_INTERVAL_SECONDS:
                result = backlog_sync.sync_once(Path(str(cfg["workspace"])), ROOT)
                ap_state["backlog_sync"] = result
                ap_state["last_backlog_sync_epoch"] = now
                if result.get("status") == "BLOCKED":
                    log("canonical backlog sync BLOCKED: " + str(result.get("reason") or "")[:250])
                elif result.get("changed"):
                    log("canonical backlog synced: " + str(result.get("canonical_commit") or "")[:16])
                backlog = load_json(BACKLOG_PATH, {}) or {}
                if result.get("status") != "BLOCKED":
                    notices = enqueue_admission_reconcile_notice(result)
                    if notices:
                        ap_state["admission_reconcile_notices"] = notices

            # Shared timer owns a separate verified backlog sync. An ordinary
            # advisory lock collision must not deadlock PM while the timer has
            # already published a RECENT identical GitHub/runtime checksum.
            if cfg.get("autopilot_budget_mode") == "compact":
                current = ap_state.get("backlog_sync") or {}
                if (current.get("status") == "BLOCKED"
                        and current.get("reason") == "another backlog reconciler owns the lock"):
                    peer = load_json(ROOT / "backlog-sync-state.json", {}) or {}
                    try:
                        checked = datetime.fromisoformat(str(peer.get("checked_at"))).timestamp()
                        age = now - checked
                    except (TypeError, ValueError, OverflowError):
                        age = float("inf")
                    if (peer.get("status") == "IN_SYNC"
                            and 0 <= age <= 180
                            and peer.get("canonical_blob")
                            and peer.get("canonical_blob") == peer.get("runtime_blob")
                            and peer.get("admission_drift") == []
                            and len(str(peer.get("canonical_commit") or "")) == 40):
                        ap_state["backlog_sync"] = peer
                        ap_state["last_backlog_sync_epoch"] = now
                        log("budget mode: reused fresh independently verified canonical backlog sync")
            if (ap_state.get("backlog_sync") or {}).get("status") == "BLOCKED":
                ap_state["status"] = "canonical_backlog_blocked"
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            if runner_state.get("paused"):
                ap_state["status"] = "runner_paused"
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            lane_recovery = runner.lane_local_block(runner_state)
            owner_items = pending_owner_instructions()
            if runner_state.get("blocked") and not lane_recovery:
                ap_state["status"] = "runner_blocked"
                ap_state["last_result"] = runner_state.get("blocked")
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            if recovery_tick(cfg, backlog, runner_state, ap_state):
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            active = runner.active_claims(runner._v2_migrate_state(runner_state))
            current = runner_state.get("current") or (active[0] if active else {})
            if owner_items:
                if cfg.get("autopilot_budget_mode") == "compact":
                    waiting_qa = budget_owner_waiting_qa(owner_items, backlog, runner_state)
                    if waiting_qa:
                        ap_state["status"] = "budget_wait_for_exact_qa_no_llm"
                        ap_state["budget_pending_qa"] = waiting_qa
                        write_json(AUTOPILOT_STATE_PATH, ap_state)
                        wait_for_wake(ACTIVE_POLL_SECONDS)
                        continue
                before_owner_backlog = json.loads(json.dumps(backlog))
                before_owner_backlog["_canonical_commit"] = str(
                    (ap_state.get("backlog_sync") or {}).get("canonical_commit") or ""
                )
                owner_key = planning_input_key(
                    backlog, runner_state, ap_state.get('backlog_sync') or {}, owner_items,
                    runtime_readiness=runtime_readiness_key(cfg),
                )
                if owner_input_backoff(ap_state, owner_key, now=time.time()):
                    ap_state["status"] = "owner_instruction_backoff"
                    write_json(AUTOPILOT_STATE_PATH, ap_state)
                    wait_for_wake(ACTIVE_POLL_SECONDS)
                    continue
                busy, busy_reason = any_gobadminton_cursor_active()
                if busy:
                    ap_state["status"] = "owner_instruction_waiting_for_writer"
                    ap_state["last_result"] = busy_reason
                    write_json(AUTOPILOT_STATE_PATH, ap_state)
                    wait_for_wake(ACTIVE_POLL_SECONDS)
                    continue

                instruction_ids = [str(x.get("id")) for x in owner_items if x.get("id")]
                update_owner_instruction_status(
                    owner_items,
                    "ACKNOWLEDGED",
                    "PM planner accepted instruction at safe boundary.",
                )
                ap_state["status"] = "owner_instruction_planning"
                ap_state["last_plan_at"] = utc_now()
                ap_state["owner_instruction_ids"] = instruction_ids
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                log(f"owner instruction(s) -> planning: {instruction_ids}")

                try:
                    ok, summary, receipt = launch_planner_with_stale_retry(cfg, owner_items=owner_items, active_admission_only=bool(active))
                except Exception as exc:  # noqa: BLE001 — never leave eternal planning/healthy
                    ok, summary, receipt = False, f"{type(exc).__name__}: {exc}", None
                ap_state = load_json(AUTOPILOT_STATE_PATH, {}) or {}
                ap_state.update({
                    "pid": os.getpid(),
                    "alive": True,
                    "last_plan_finished_at": utc_now(),
                    "last_result": summary,
                    "planner_pid": None,
                    "owner_instruction_ids": instruction_ids,
                    "last_owner_input_key": owner_key,
                })
                action = receipt.get("action") if isinstance(receipt, dict) else None
                if cfg.get("autopilot_budget_mode") == "compact" and ok:
                    budget_record_new_qa_wait(owner_items, receipt)
                publication_ok = False
                if ok and action != "no_safe_action":
                    result = backlog_sync.sync_once(Path(str(cfg["workspace"])), ROOT)
                    ap_state["backlog_sync"] = result
                    after = load_json(BACKLOG_PATH, {}) or {}
                    publication_ok, reason = verify_planner_publication(
                        cfg, receipt, result, before_owner_backlog, after,
                        owner_items, active_admission_only=bool(active),
                    )
                    if not publication_ok:
                        summary += "; PM publication unverified: " + reason
                if ok and publication_ok:
                    # PLANNED = actual task in canonical main AND runtime, not
                    # a persuasive Codex completion message or a PR alone.
                    update_owner_instruction_status(owner_items, "PLANNED", summary)
                    ap_state["last_owner_no_action_epoch"] = 0
                    ap_state["last_owner_attempt_outcome"] = "published"
                    ap_state["status"] = f"owner_instruction_{action or 'planned'}"
                elif ok:
                    update_owner_instruction_status(owner_items, "ACKNOWLEDGED", summary)
                    ap_state["last_owner_no_action_epoch"] = time.time()
                    ap_state["last_owner_attempt_outcome"] = (
                        "no_safe_action" if action == "no_safe_action" else "publication_unverified"
                    )
                    ap_state["status"] = (
                        "owner_instruction_acknowledged_no_safe_action" if action == "no_safe_action"
                        else "owner_instruction_publication_unverified"
                    )
                else:
                    update_owner_instruction_status(owner_items, "ACKNOWLEDGED", summary)
                    ap_state["last_owner_no_action_epoch"] = time.time()
                    ap_state["last_owner_attempt_outcome"] = "planner_error"
                    ap_state["status"] = "owner_instruction_planner_error_retriable"
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                log(f"owner instruction planning result ok={ok} action={action!r}: {summary}")
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            input_key = planning_input_key(backlog, runner_state, ap_state.get('backlog_sync') or {})
            opportunity = approved_source_opportunity(backlog, runner_state, cfg)
            fresh_opportunity = opportunity and ap_state.get('last_planning_input_key') != input_key
            if active and not fresh_opportunity:
                ap_state["status"] = "runner_active"
                ap_state["current_task"] = active[0].get("id")
                ap_state["active_tasks"] = [str(x.get("id")) for x in active]
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            pending = pending_tasks(backlog, runner_state)
            if pending and not fresh_opportunity and not lane_recovery and not any(
                    row["status"] == "PLANNER_REQUIRED" for row in ap_state.get("queue_classification", [])):
                ap_state["status"] = "queue_waiting"
                ap_state["hold_reason"] = "waiting admissible locks/dependencies/Owner release"
                pending_rows = [row for row in ap_state.get("queue_classification", []) if row["id"] in {t["id"] for t in pending}]
                if pending_rows and all(row["status"] == "WAITING_OWNER_RELEASE" for row in pending_rows):
                    ap_state.update(status="STOPPED_SAFE", owner_item="exact Owner/release gates for admitted pending work")
                ap_state["pending"] = [str(x.get("id")) for x in pending[:10]]
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            busy, busy_reason = any_gobadminton_cursor_active()
            if busy:
                ap_state["status"] = "cursor_active"
                ap_state["last_result"] = busy_reason
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            if (not opportunity and not lane_recovery) or ap_state.get('last_planning_input_key') == input_key:
                ap_state['status'] = 'STOPPED_SAFE'
                ap_state['hold_reason'] = 'no new eligible approved source work/evidence'
                ap_state['owner_item'] = 'PM/Owner: exact new source admission or changed prerequisite evidence'
                write_json(AUTOPILOT_STATE_PATH, ap_state)
                wait_for_wake(ACTIVE_POLL_SECONDS)
                continue

            ap_state["status"] = "empty_planning"
            ap_state["last_plan_at"] = utc_now()
            write_json(AUTOPILOT_STATE_PATH, ap_state)
            log("queue empty -> planning next safe action")

            planning_before = json.loads(json.dumps(backlog))
            planning_before["_canonical_commit"] = (ap_state.get("backlog_sync") or {}).get("canonical_commit", "")
            intake = {"id": "system-safe-planning-" + planning_before["_canonical_commit"],
                      "origin": "SYSTEM_SAFE_PLANNING_NOT_OWNER", "status": "NEW",
                      "text": "Inspect eligible admitted source work or exact accepted source merge. Preserve every Owner gate; no safe work requires STOPPED_SAFE with exact Owner item. No new authority."}
            try:
                ok, summary, receipt = launch_planner_with_stale_retry(cfg, owner_items=[intake], active_admission_only=bool(active))
                if ok and isinstance(receipt, dict) and receipt.get("action") != "no_safe_action":
                    result = backlog_sync.sync_once(Path(str(cfg["workspace"])), ROOT)
                    after = load_json(BACKLOG_PATH, {}) or {}
                    verified, reason = verify_planner_publication(cfg, receipt, result, planning_before, after, [intake], active_admission_only=bool(active))
                    if receipt.get("action") in {"merged", "merged_and_enqueued"}:
                        qa_id = receipt.get("accepted_qa_task_id")
                        qa = runner._v2_task_map(after).get(qa_id, {})
                        qa_receipt = runner.read_receipt(runner.receipt_path_for(qa)) if qa else None
                        if (not qa_id or not runner._v2_dependency_accepted(after, load_json(RUNNER_STATE_PATH, {}) or {}, qa_id)
                                or not qa_receipt or receipt.get("merged_candidate_sha") != qa_receipt.get("candidate_sha")):
                            verified, reason = False, "source merge lacks exact independent accepted QA identity"
                    if not verified:
                        ok, summary = False, "publication unverified: " + reason
            except Exception as exc:  # noqa: BLE001 — truthful failure, not eternal planning
                ok, summary, receipt = False, f"{type(exc).__name__}: {exc}", None
            ap_state = load_json(AUTOPILOT_STATE_PATH, {}) or {}
            ap_state.update({
                "pid": os.getpid(),
                "alive": True,
                "last_plan_finished_at": utc_now(),
                "last_result": summary,
                "planner_pid": None,
                "last_planning_input_key": input_key,
            })
            action = receipt.get("action") if isinstance(receipt, dict) else None
            if ok and action == "no_safe_action":
                ap_state["last_no_action_epoch"] = time.time()
                ap_state["status"] = "STOPPED_SAFE"
                ap_state["hold_reason"] = summary
                ap_state["owner_item"] = "PM/Owner: no eligible admitted source work"
            elif ok:
                ap_state["last_no_action_epoch"] = 0
                ap_state["status"] = f"planned_{action or 'action'}"
            else:
                ap_state["status"] = "planner_error"
            write_json(AUTOPILOT_STATE_PATH, ap_state)
            log(f"planning result ok={ok} action={action!r}: {summary}")
            wait_for_wake(ACTIVE_POLL_SECONDS)
    finally:
        ap_state = load_json(AUTOPILOT_STATE_PATH, {}) or {}
        ap_state["alive"] = False
        ap_state["stopped_at"] = utc_now()
        write_json(AUTOPILOT_STATE_PATH, ap_state)
        lock.release()
        log("autopilot stop")


if __name__ == "__main__":
    raise SystemExit(main())
