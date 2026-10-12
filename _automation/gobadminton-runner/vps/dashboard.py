#!/usr/bin/env python3
"""Local read-only dashboard for the GoBadminton Cursor queue."""
from __future__ import annotations

import json
from datetime import datetime
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import runner

ROOT = Path(__file__).resolve().parent
HTML = ROOT / "dashboard.html"
HOST = "127.0.0.1"
PORT = 17650
PR_REFRESH_SECONDS = 30
PARALLEL_PROGRESS_DIR = ROOT / "parallel-progress"
AUTOPILOT_STATE_PATH = ROOT / "autopilot-state.json"
WATCHDOG_STATE_PATH = ROOT / "watchdog-state.json"
MONITOR_PUSH_STATE_PATH = ROOT / "monitor-push-state.json"
OWNER_INBOX_DIR = ROOT / "owner-inbox"

_cache_at = 0.0
_cache: dict[str, Any] | None = None
_pr_cache_lock = threading.Lock()
_pr_cache: dict[str, Any] | None = None
_pr_cache_at: str | None = None


def run(cmd: list[str], cwd: str | None = None, timeout: int = 12) -> tuple[int, str, str]:
    try:
        cp = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        return cp.returncode, cp.stdout.strip(), cp.stderr.strip()
    except Exception as exc:
        return 99, "", str(exc)


def git_status(workspace: str) -> dict[str, Any]:
    rc, branch, err = run(["git", "branch", "--show-current"], workspace)
    if rc != 0:
        return {"ok": False, "error": err or "git unavailable"}
    _, head, _ = run(["git", "rev-parse", "HEAD"], workspace)
    _, status, _ = run(["git", "status", "--short"], workspace)
    _, last, _ = run(["git", "log", "-1", "--pretty=%s"], workspace)
    return {
        "ok": True,
        "branch": branch,
        "head": head,
        "dirty": bool(status),
        "dirty_lines": status.splitlines()[:20],
        "last_commit": last,
    }


def pr_info(cfg: dict[str, Any], number: int) -> dict[str, Any]:
    try:
        gh = runner.find_gh()
    except Exception as exc:
        return {"number": number, "ok": False, "error": str(exc)}

    repo = str(cfg["project_repo"])
    rc, out, err = run(
        [
            gh,
            "api",
            f"repos/{repo}/pulls/{number}",
            "--jq",
            "{number:.number,title:.title,draft:.draft,state:.state,merged:(.merged_at!=null),merged_at:.merged_at,head_sha:.head.sha,html_url:.html_url}",
        ],
        timeout=20,
    )
    if rc != 0:
        return {"number": number, "ok": False, "error": err or out}

    try:
        data = json.loads(out)
    except Exception:
        return {"number": number, "ok": False, "error": "invalid gh response"}

    data["ok"] = True
    sha = data.get("head_sha")
    if sha:
        rc, checks_raw, _ = run(
            [
                gh,
                "api",
                f"repos/{repo}/commits/{sha}/check-runs",
                "--jq",
                "[.check_runs[] | {name:.name,status:.status,conclusion:.conclusion,html_url:.html_url}]",
            ],
            timeout=20,
        )
        if rc == 0 and checks_raw:
            try:
                checks = json.loads(checks_raw)
            except Exception:
                checks = []
            data["checks"] = checks
            if checks:
                conclusions = [
                    c.get("conclusion")
                    for c in checks
                    if c.get("status") == "completed"
                ]
                if any(
                    x not in (None, "success", "neutral", "skipped")
                    for x in conclusions
                ):
                    data["checks_summary"] = "failed"
                elif all(c.get("status") == "completed" for c in checks):
                    data["checks_summary"] = "success"
                else:
                    data["checks_summary"] = "running"
    return data


def pending_gate_pr_number() -> int | None:
    try:
        st = runner.load_state()
        q = runner.load_backlog()
        pending = runner.pending_tasks(q, st)
        if not pending:
            return None
        req = pending[0].get("requires_pr_merged")
        if req is None:
            return None
        return int(req[0] if isinstance(req, list) else req)
    except Exception:
        return None


def refresh_pr_cache_once() -> None:
    global _pr_cache, _pr_cache_at
    number = pending_gate_pr_number()
    if number is None:
        data = None
    else:
        try:
            data = pr_info(runner.load_config(), number)
        except Exception as exc:
            data = {"number": number, "ok": False, "error": str(exc)}
    with _pr_cache_lock:
        _pr_cache = data
        _pr_cache_at = runner.utc_now()


def pr_refresh_loop() -> None:
    while True:
        refresh_pr_cache_once()
        time.sleep(PR_REFRESH_SECONDS)


def cached_pr() -> tuple[dict[str, Any] | None, str | None]:
    with _pr_cache_lock:
        data = dict(_pr_cache) if isinstance(_pr_cache, dict) else _pr_cache
        stamp = _pr_cache_at
    return data, stamp


def load_parallel_lanes() -> list[dict[str, Any]]:
    lanes: list[dict[str, Any]] = []
    if not PARALLEL_PROGRESS_DIR.is_dir():
        return lanes
    for path in sorted(PARALLEL_PROGRESS_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        workspace = data.get("workspace")
        lane = {
            "file": path.name,
            "progress": data,
            "git": git_status(str(workspace)) if workspace else None,
        }
        lanes.append(lane)
    return lanes


def load_owner_instruction_summary() -> dict[str, Any]:
    counts: dict[str, int] = {}
    latest: list[dict[str, Any]] = []
    if not OWNER_INBOX_DIR.is_dir():
        return {"counts": counts, "latest": latest}
    paths = sorted(
        OWNER_INBOX_DIR.glob("*.json"),
        key=lambda x: x.stat().st_mtime,
        reverse=True,
    )
    for path in paths[:20]:
        try:
            data = json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        status = str(data.get("status") or "NEW")
        counts[status] = counts.get(status, 0) + 1
        # Public /api/status (and monitor-push) must never project private
        # Owner/planner text. Keep only safe inbox metadata for continuity.
        latest.append({
            "id": data.get("id"),
            "status": status,
            "created_at": data.get("created_at"),
            "updated_at": data.get("updated_at"),
        })
    return {"counts": counts, "latest": latest}


def tail_log(lines: int = 12) -> list[str]:
    if not runner.LOG_PATH.exists():
        return []
    try:
        content = runner.LOG_PATH.read_text(
            encoding="utf-8", errors="replace"
        ).splitlines()
        return content[-lines:]
    except Exception:
        return []


def honest_watchdog(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Never publish HEALTHY when monitor-push transport is broken/stale."""
    data = dict(raw) if isinstance(raw, dict) else {}
    push = runner.load_json(MONITOR_PUSH_STATE_PATH, {}) or {}
    reasons: list[str] = []
    if push.get("ok") is not True:
        reasons.append(f"monitor-push not ok: {push.get('detail') or 'unknown'}")
    else:
        at = push.get("at")
        try:
            age = time.time() - datetime.fromisoformat(
                str(at).replace("Z", "+00:00")
            ).timestamp()
            if age > 90:
                reasons.append(f"monitor-push stale ({int(age)}s)")
        except Exception:
            reasons.append("monitor-push timestamp unreadable")

    if reasons and data.get("health") == "HEALTHY":
        data["health"] = "ATTENTION"
        data["reason"] = "; ".join(reasons)
        data["forged_healthy_suppressed"] = True
    elif reasons:
        data["transport_issues"] = reasons
    data["monitor_push"] = {
        "ok": push.get("ok"),
        "at": push.get("at"),
        "detail": push.get("detail"),
    }
    return data


def active_progress(st: dict[str, Any], progress: Any) -> dict[str, Any] | None:
    current = st.get("current") or {}
    if (isinstance(progress, dict) and current.get("id") == progress.get("task_id")
            and current.get("status") in {"running", "blocked"}):
        return progress
    return None


def collect() -> dict[str, Any]:
    global _cache_at, _cache
    now = time.time()
    if _cache is not None and now - _cache_at < 3:
        return _cache

    cfg = runner.load_config()
    st = runner.load_state()
    q = runner.load_backlog()
    pending = runner.pending_tasks(q, st)

    # Dashboard is read-only. Runner v2 can own multiple isolated executors.
    active = runner.active_claims(st)
    gate_wait = st.get("gate_wait") or {}
    if active:
        busy = True
        why = f"{len(active)} queue task(s) active"
    elif gate_wait.get("type") == "writer":
        busy = True
        why = str(gate_wait.get("reason") or "runner reports writer activity")
    else:
        busy = False
        why = "runner reports execution slots free"

    gate_pr, pr_refreshed_at = cached_pr()

    next_gate = None
    if pending:
        task0 = pending[0]
        task_id = task0["id"]

        if (
            gate_wait.get("type") == "task_gate"
            and gate_wait.get("id") == task_id
        ):
            next_gate = {
                "task": task_id,
                "ready": False,
                "reason": str(gate_wait.get("reason") or "waiting for task gate"),
            }
        else:
            req = task0.get("requires_pr_merged")
            if req is not None:
                num = int(req[0] if isinstance(req, list) else req)
                if gate_pr is None or int(gate_pr.get("number", num)) != num:
                    next_gate = {
                        "task": task_id,
                        "ready": False,
                        "reason": f"checking PR #{num}",
                    }
                elif gate_pr.get("ok") is not True:
                    next_gate = {
                        "task": task_id,
                        "ready": False,
                        "reason": f"PR #{num} status temporarily unavailable",
                    }
                elif gate_pr.get("merged") is True:
                    next_gate = {
                        "task": task_id,
                        "ready": True,
                        "reason": f"PR #{num} merged",
                    }
                else:
                    next_gate = {
                        "task": task_id,
                        "ready": False,
                        "reason": f"waiting for PR #{num} merge",
                    }
            elif task0.get("requires_dns_no_aaaa") is not None:
                next_gate = {
                    "task": task_id,
                    "ready": False,
                    "reason": "checking authoritative AAAA removal",
                }
            else:
                next_gate = {
                    "task": task_id,
                    "ready": True,
                    "reason": "no task gate",
                }

    progresses = runner.load_task_progresses(st)
    current = st.get("current") or {}
    progress = progresses.get(str(current.get("id") or ""))
    if progress is None:
        legacy_progress = runner.load_json(runner.PROGRESS_PATH, None)
        if isinstance(legacy_progress, dict):
            progress = legacy_progress

    data = {
        "generated_at": runner.utc_now(),
        "dashboard_url": f"http://{HOST}:{PORT}",
        "runner": {
            "pid": st.get("runner_pid"),
            "alive": runner.pid_alive(st.get("runner_pid")),
            "paused": st.get("paused"),
            "blocked": st.get("blocked"),
            "blocked_tasks": st.get("blocked_tasks") or {},
            "current": st.get("current"),
            "active": active,
            "state_version": st.get("version"),
            "max_parallel": runner.max_parallel(cfg),
            "gate_wait": st.get("gate_wait"),
        },
        "writer": {"busy": busy, "reason": why},
        "queue": {
            "pending": [t["id"] for t in pending],
            "completed": sorted(runner.completed_ids(st)),
            "next_gate": next_gate,
            "tasks": q.get("tasks", []),
            "policy": q.get("policy", {}),
        },
        "git": git_status(str(cfg["workspace"])),
        "gate_pr": gate_pr,
        "gate_pr_refreshed_at": pr_refreshed_at,
        "progress": active_progress(st, progress),
        "progresses": progresses,
        "recent_activity": [{"id": h.get("id"), "status": h.get("status"), "at": h.get("at")}
                            for h in (st.get("history") or [])[-10:] if isinstance(h, dict)],
        "parallel_lanes": load_parallel_lanes(),
        "autopilot": runner.load_json(AUTOPILOT_STATE_PATH, {}),
        "watchdog": honest_watchdog(runner.load_json(WATCHDOG_STATE_PATH, {})),
        "owner_instructions": load_owner_instruction_summary(),
        "activity": tail_log(),
    }
    _cache_at = now
    _cache = data
    return data


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, content_type: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/api/status":
            try:
                body = json.dumps(collect(), ensure_ascii=False).encode("utf-8")
                self._send(200, "application/json; charset=utf-8", body)
            except Exception as exc:  # noqa: BLE001 — must never empty-close the socket
                err = {
                    "ok": False,
                    "error": "status_collect_failed",
                    "detail": f"{type(exc).__name__}: {exc}",
                }
                body = json.dumps(err, ensure_ascii=False).encode("utf-8")
                self._send(500, "application/json; charset=utf-8", body)
            return
        if self.path == "/health":
            self._send(200, "text/plain; charset=utf-8", b"ok\n")
            return
        if self.path in ("/", "/index.html"):
            if not HTML.exists():
                self._send(
                    500,
                    "text/plain; charset=utf-8",
                    b"dashboard.html missing\n",
                )
                return
            self._send(200, "text/html; charset=utf-8", HTML.read_bytes())
            return
        self._send(404, "text/plain; charset=utf-8", b"not found\n")

    def log_message(self, _format: str, *_args: Any) -> None:
        return


def main() -> int:
    threading.Thread(
        target=pr_refresh_loop,
        name="gobadminton-pr-refresh",
        daemon=True,
    ).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"GoBadminton queue dashboard: http://{HOST}:{PORT}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
