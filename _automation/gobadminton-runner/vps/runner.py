#!/usr/bin/env python3
"""GoBadminton VPS multi-executor queue runner.

Single-instance, strict-order, one-writer execution queue.
The queue contains references to exact GitHub/local assignment documents, never shell.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil
import backlog_sync
import writer_bridge

try:
    import msvcrt
except ImportError:
    msvcrt = None  # type: ignore

ROOT = Path(__file__).resolve().parent
BACKLOG_PATH = ROOT / "backlog.json"
STATE_PATH = ROOT / "state.json"
CONFIG_PATH = ROOT / "config.json"
LOG_PATH = ROOT / "runner.log"
LOCK_PATH = ROOT / "runner.lock"
RECEIPTS_DIR = ROOT / "receipts"
CACHE_DIR = ROOT / "cache"
PROGRESS_PATH = ROOT / "progress.json"
AUTOPILOT_WAKE_PATH = ROOT / "autopilot-wake.json"
BLOCK_RELEASE_PATH = ROOT / "blocked-release.json"

GITHUB_BLOB_RE = re.compile(
    r"^https://github\.com/([^/]+)/([^/]+)/blob/([0-9a-f]{7,40})/(.+)$"
)

ALLOWED_TASK_KEYS = {
    "order", "id", "status", "source", "scope", "notes", "enabled",
    "receipt", "requires_pr_merged", "requires_dns_no_aaaa", "blocks",
    "executor", "model", "effort", "sandbox",
    # PM presentation / admission metadata (ignored by claim logic; required for
    # overnight train Russian labels and durable admission permalinks).
    "admission", "title_ru", "summary_ru", "lane", "verdict",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def log(msg: str) -> None:
    line = f"{utc_now()} {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def load_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8-sig"))


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Runner v2 may have several worker threads updating a shared compatibility
    # projection or wake signal at once. A deterministic ".tmp" name lets one
    # writer rename another writer's temporary file, so each writer gets a
    # unique temp name while the final os.replace remains atomic.
    tmp = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{time.time_ns()}.tmp"
    )
    payload = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    tmp.write_text(payload, encoding="utf-8")
    try:
        os.replace(tmp, path)
    except PermissionError:
        path.write_text(payload, encoding="utf-8")
        try:
            tmp.unlink()
        except OSError:
            pass


def wake_autopilot(event: str, task_id: str, detail: str = "") -> None:
    """Wake the PM autopilot immediately after runner state changes."""
    try:
        atomic_write_json(
            AUTOPILOT_WAKE_PATH,
            {
                "project": "GoBadminton",
                "event": event,
                "task_id": task_id,
                "detail": detail,
                "at": utc_now(),
            },
        )
        log(f"autopilot wake event={event} task={task_id}")
    except Exception as exc:
        # A wake failure must never corrupt or fail the completed task itself.
        log(f"autopilot wake failed event={event} task={task_id}: {exc}")


def load_config() -> dict[str, Any]:
    cfg = load_json(CONFIG_PATH, {})
    if not isinstance(cfg, dict):
        raise RuntimeError("config.json must be an object")
    if cfg.get("project") != "GoBadminton":
        raise RuntimeError("config project must be GoBadminton")
    return cfg


def load_backlog() -> dict[str, Any]:
    q = load_json(BACKLOG_PATH)
    if not isinstance(q, dict) or not isinstance(q.get("tasks"), list):
        raise RuntimeError("backlog.json invalid: expected object with tasks[]")
    if q.get("prod_authorized") is not False:
        raise RuntimeError("backlog must keep prod_authorized=false")
    for t in q["tasks"]:
        if not isinstance(t, dict):
            raise RuntimeError("backlog task must be object")
        unknown = set(t) - ALLOWED_TASK_KEYS
        if unknown:
            raise RuntimeError(f"unsupported task keys for {t.get('id')}: {sorted(unknown)}")
        if any(k in t for k in ("command", "shell", "cmd")):
            raise RuntimeError("backlog must not contain shell/command fields")
        if not t.get("id") or not t.get("source"):
            raise RuntimeError("each task needs id + source")
        dns_gate = t.get("requires_dns_no_aaaa")
        if dns_gate is not None:
            if not isinstance(dns_gate, dict):
                raise RuntimeError(f"task {t.get('id')} DNS gate must be object")
            if not isinstance(dns_gate.get("names"), list) or not dns_gate.get("names"):
                raise RuntimeError(f"task {t.get('id')} DNS gate needs names[]")
            if not isinstance(dns_gate.get("servers"), list) or not dns_gate.get("servers"):
                raise RuntimeError(f"task {t.get('id')} DNS gate needs servers[]")
        blocks = t.get("blocks")
        if blocks is not None:
            if not isinstance(blocks, list) or not blocks:
                raise RuntimeError(f"task {t.get('id')} blocks must be non-empty list")
            seen = set()
            for block in blocks:
                if not isinstance(block, dict) or not block.get("id") or not block.get("title"):
                    raise RuntimeError(f"task {t.get('id')} block needs id + title")
                if block["id"] in seen:
                    raise RuntimeError(f"duplicate block id {block['id']}")
                seen.add(block["id"])
    return q


def load_state() -> dict[str, Any]:
    st = load_json(
        STATE_PATH,
        {
            "version": 1,
            "paused": False,
            "runner_pid": None,
            "current": None,
            "history": [],
            "attempts": {},
            "blocked": None,
            "gate_wait": None,
            "updated_at": None,
        },
    )
    if not isinstance(st, dict):
        raise RuntimeError("state.json invalid")
    return st


def save_state(st: dict[str, Any]) -> None:
    st["updated_at"] = utc_now()
    atomic_write_json(STATE_PATH, st)


def pid_alive(pid: int | None) -> bool:
    if not pid:
        return False
    return psutil.pid_exists(int(pid))


class SingleInstanceLock:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._fh: Any = None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "a+", encoding="utf-8")
        try:
            if msvcrt is not None:
                self._fh.seek(0)
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self._fh.close()
            self._fh = None
            return False
        self._fh.seek(0)
        self._fh.truncate()
        self._fh.write(f"{os.getpid()}\n{utc_now()}\n")
        self._fh.flush()
        return True

    def release(self) -> None:
        if not self._fh:
            return
        try:
            if msvcrt is not None:
                self._fh.seek(0)
                msvcrt.locking(self._fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        try:
            self._fh.close()
        finally:
            self._fh = None


def latest_mtime(path: Path) -> float | None:
    if not path.exists():
        return None
    if path.is_file():
        return path.stat().st_mtime
    newest = None
    for p in path.rglob("*"):
        if not p.is_file():
            continue
        try:
            m = p.stat().st_mtime
        except OSError:
            continue
        newest = m if newest is None or m > newest else newest
    return newest


def recent_transcript(transcripts: Path, idle: float) -> tuple[bool, str]:
    if not transcripts.is_dir():
        return False, "no transcript root"
    now = time.time()
    best: tuple[str, float] | None = None
    for child in transcripts.iterdir():
        if not child.is_dir():
            continue
        main = child / f"{child.name}.jsonl"
        m = latest_mtime(main if main.is_file() else child)
        if m is None:
            continue
        age = now - m
        if age < idle and (best is None or age < best[1]):
            best = (child.name, age)
    if best:
        return True, f"project transcript {best[0]} active ({int(best[1])}s ago)"
    return False, "transcripts idle"


def _norm_workspace(value: str) -> str:
    return os.path.normcase(os.path.abspath(value)).replace("\\", "/").rstrip("/").lower()


def _workspace_args(cmdline: list[str]) -> list[str]:
    out: list[str] = []
    for i, raw in enumerate(cmdline):
        arg = str(raw)
        low = arg.lower()
        if low in {"--workspace", "--cd", "-c"} and i + 1 < len(cmdline):
            out.append(str(cmdline[i + 1]))
        elif low.startswith(("--workspace=", "--cd=")):
            out.append(arg.split("=", 1)[1])

        # Wrapper shells can carry the whole cursor command as one string.
        for match in re.finditer(r"--workspace(?:=|\s+)[\"']?([^\s\"']+)", arg, flags=re.I):
            out.append(match.group(1))
    return out



def managed_pm_planner(proc: Any, cfg: dict[str, Any]) -> bool:
    """Exempt only the dedicated planner with managed service ancestry.

    A worktree name or an autopilot-state PID alone is not proof. Unreadable
    ancestry/cgroup fails closed; no PID cache survives process reuse.
    """
    dev = Path(str(cfg.get("dev_root") or Path(str(cfg["workspace"])).parent)).resolve()
    planning = dev / "worktrees/pm-autopilot"
    try:
        if Path(proc.cwd()).resolve() != planning:
            return False
        args = proc.cmdline()
        targets = []
        for index, arg in enumerate(args):
            if arg in {"-C", "--cd", "--workspace"} and index + 1 < len(args):
                targets.append(args[index + 1])
            elif arg.startswith(("--cd=", "--workspace=")):
                targets.append(arg.split("=", 1)[1])
        if not targets or any(Path(target).resolve() != planning for target in targets):
            return False
        for parent in proc.parents():
            args = parent.cmdline()
            if str(dev / "runner/autopilot.py") not in args:
                continue
            cgroup = Path(f"/proc/{parent.pid}/cgroup").read_text()
            if any(line.split(":", 2)[-1].rstrip("/") ==
                   "/system.slice/gobadminton-autopilot.service" for line in cgroup.splitlines()):
                return True
    except (psutil.Error, OSError, ValueError):
        pass
    return False


def external_cursor_agent_busy(cfg: dict[str, Any], state_agent_pid: int | None) -> tuple[bool, str]:
    """Detect any external Cursor/Codex writer scoped to GoBadminton dev root."""
    workspace = Path(str(cfg["workspace"])).resolve()
    dev_root = Path(str(cfg.get("dev_root") or workspace.parent)).resolve()
    runner_pid = os.getpid()
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            pid = int(proc.info["pid"])
            if pid == runner_pid or (state_agent_pid and pid == int(state_agent_pid)):
                continue
            cmdline = [str(x) for x in (proc.info.get("cmdline") or [])]
            text = " ".join(cmdline).replace("\\", "/").lower()
            # Cursor can leave a worker-server/language-server process after the CLI exits.
            # These helpers are not independent writers and must not stall the queue.
            if " worker-server" in text or "typescript-language-server" in text:
                continue
            is_cursor = "cursor-agent" in text or "/agent --print" in text
            is_codex = "codex exec" in text or "@openai/codex" in text
            if not (is_cursor or is_codex):
                continue
            try:
                cwd = Path(proc.cwd()).resolve()
            except (psutil.AccessDenied, psutil.NoSuchProcess, FileNotFoundError):
                cwd = None
            scoped = bool(cwd and (cwd == dev_root or dev_root in cwd.parents))
            if not scoped:
                # Only explicit workspace/cwd flags can claim this project.
                # Never scan arbitrary prompt text: another project's assignment
                # may mention /srv/gobadminton-dev merely as an out-of-scope path.
                targets: list[str] = []
                for index, raw in enumerate(cmdline):
                    if raw in {"-C", "--cd", "--workspace"} and index + 1 < len(cmdline):
                        targets.append(cmdline[index + 1])
                    elif raw.startswith(("--cd=", "--workspace=")):
                        targets.append(raw.split("=", 1)[1])
                for target in targets:
                    try:
                        resolved = Path(target).resolve()
                    except (OSError, ValueError):
                        continue
                    if resolved == dev_root or dev_root in resolved.parents:
                        scoped = True
                        break
            if isolated_readonly_qa(proc, cfg):
                continue
            if scoped and managed_pm_planner(proc, cfg):
                continue
            if scoped:
                kind = "Cursor" if is_cursor else "Codex"
                return True, f"external {kind} pid {pid} scoped to {dev_root}"
        except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
            continue
    return False, "no external GoBadminton Cursor/Codex writer"


def writer_busy(cfg: dict[str, Any], st: dict[str, Any]) -> tuple[bool, str]:
    cur = st.get("current") or {}
    agent_pid = cur.get("agent_pid")
    if agent_pid and pid_alive(int(agent_pid)):
        return True, f"queue executor pid {agent_pid} still alive"

    busy, why = external_cursor_agent_busy(cfg, int(agent_pid) if agent_pid else None)
    if busy:
        return True, why

    transcripts_raw = str(cfg.get("project_transcripts") or "").strip()
    if transcripts_raw:
        idle = float(cfg.get("idle_seconds") or 45)
        active, reason = recent_transcript(Path(transcripts_raw), idle)
        if active:
            return True, reason
    return False, "writers idle"

def find_gh() -> str:
    gh = shutil.which("gh")
    if gh:
        return gh
    candidates = [
        Path(os.environ.get("ProgramFiles", "")) / "GitHub CLI" / "gh.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "GitHub CLI" / "gh.exe",
    ]
    for c in candidates:
        if c.is_file():
            return str(c)
    raise RuntimeError("GitHub CLI gh not found")



def task_gate(task: dict[str, Any], cfg: dict[str, Any]) -> tuple[bool, str]:
    unknown = [k for k in task if k.startswith('requires_')
               and k not in {'requires_pr_merged', 'requires_dns_no_aaaa'}]
    if unknown:
        return False, 'unimplemented authority gate: ' + ','.join(sorted(unknown))
    has_gate = False
    req = task.get("requires_pr_merged")
    if req is not None:
        has_gate = True
        return False, "PR-number API gate unavailable in VPS git-native mode; rebind task to immutable predecessor SHA"

    dns_gate = task.get("requires_dns_no_aaaa")
    if dns_gate is not None:
        has_gate = True
        if not shutil.which("dig"):
            return False, "DNS gate requires dig"
        names = dns_gate.get("names") if isinstance(dns_gate, dict) else None
        servers = dns_gate.get("servers") if isinstance(dns_gate, dict) else None
        if not isinstance(names, list) or not names or not isinstance(servers, list) or not servers:
            return False, "DNS gate invalid: names[] and servers[] required"
        safe_host = re.compile(r"^[A-Za-z0-9.-]+$")
        for name in names:
            for server in servers:
                name_s, server_s = str(name).strip(), str(server).strip()
                if not safe_host.fullmatch(name_s) or not safe_host.fullmatch(server_s):
                    return False, "DNS gate invalid hostname/server"
                cp = subprocess.run(
                    ["dig", "+short", "AAAA", name_s, f"@{server_s}"],
                    capture_output=True, text=True, timeout=20,
                )
                if cp.returncode != 0:
                    return False, f"DNS gate check unavailable: {name_s} @ {server_s}"
                addrs = [x.strip() for x in cp.stdout.splitlines() if x.strip()]
                if addrs:
                    return False, f"waiting AAAA removal: {name_s} @ {server_s} -> {', '.join(addrs[:4])}"
    return True, "gate satisfied" if has_gate else "no gate"


def resolve_source(source: str, workspace: Path) -> str:
    src = source.strip()
    p = Path(src)
    if p.is_file():
        return str(p.resolve())
    if not p.is_absolute():
        local = (workspace / p).resolve()
        if local.is_file():
            return str(local)

    m = GITHUB_BLOB_RE.match(src)
    if not m:
        raise RuntimeError(f"source must be exact GitHub blob permalink or local file: {src}")

    owner, repo, rev, rel = m.groups()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    out = CACHE_DIR / f"{rev[:12]}_{Path(rel).name}"
    if out.is_file():
        return str(out.resolve())

    spec = f"{rev}:{rel}"
    cp = subprocess.run(
        ["git", "-C", str(workspace), "show", spec],
        capture_output=True, timeout=60,
    )
    if cp.returncode != 0:
        fetch = subprocess.run(
            ["git", "-C", str(workspace), "fetch", "origin", rev],
            capture_output=True, text=True, timeout=120,
        )
        if fetch.returncode != 0:
            raise RuntimeError(f"git source fetch failed for {rev}: {fetch.stderr.strip()[:300]}")
        cp = subprocess.run(
            ["git", "-C", str(workspace), "show", spec],
            capture_output=True, timeout=60,
        )
    if cp.returncode != 0:
        raise RuntimeError(f"git source read failed: {spec}")
    out.write_bytes(cp.stdout)
    return str(out.resolve())

def initialize_progress(task: dict[str, Any]) -> None:
    blocks = task.get("blocks") or []
    payload = {
        "version": 1,
        "task_id": task["id"],
        "task_title": task.get("scope") or task["id"],
        "status": "running",
        "current_block": blocks[0]["id"] if blocks else None,
        "updated_at": utc_now(),
        "blocks": [
            {
                "id": b["id"],
                "title": b["title"],
                "status": "running" if i == 0 else "pending",
                "note": b.get("note"),
            }
            for i, b in enumerate(blocks)
        ],
    }
    atomic_write_json(PROGRESS_PATH, payload)


def block_prompt(task: dict[str, Any]) -> str:
    blocks = task.get("blocks") or []
    if not blocks:
        return ""
    rows = "\n".join(
        f"- {i+1}/{len(blocks)} {b['id']} · {b['title']}"
        for i, b in enumerate(blocks)
    )
    return f"""
PM block plan (execute in this order):
{rows}

Progress checkpoint file:
{PROGRESS_PATH}

Before starting a block, atomically update progress.json:
- set that block status to "running";
- set current_block to its id;
- set task status to "running";
- update updated_at.

After a block is actually complete, set it to "done" before moving to the next.
If a block is genuinely blocked, set that block and task status to "blocked",
record a concise blocker in block.note, write the normal task receipt, and stop.
Do not mark a block done merely because work was attempted.
"""


def receipt_path_for(task: dict[str, Any]) -> Path:
    custom = task.get("receipt")
    if custom:
        p = Path(str(custom))
        return p if p.is_absolute() else ROOT / p
    return RECEIPTS_DIR / f"{task['id']}.json"


def read_receipt(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    return data if isinstance(data, dict) else None


def validate_receipt(path: Path, task_id: str) -> tuple[bool, str]:
    data = read_receipt(path)
    if data is None:
        return False, "receipt missing or invalid json"
    if data.get("task_id") != task_id:
        return False, f"receipt task_id mismatch: {data.get('task_id')!r}"
    if data.get("project") != "GoBadminton":
        return False, "receipt project must be GoBadminton"
    if data.get("ok") is True:
        return True, str(data.get("summary") or "ok")
    return False, str(data.get("reason") or data.get("summary") or "receipt ok!=true")



def build_launch_prompt(task: dict[str, Any], source_path: str, receipt_path: Path) -> str:
    executor = str(task.get("executor") or "cursor").lower()
    model = str(task.get("model") or ("auto" if executor == "cursor" else "default"))
    effort = str(task.get("effort") or "default")
    return f"""You are the sole active executor for one queued GoBadminton task.

Execution binding:
- host: GoBadminton Germany VPS
- executor: {executor}
- requested model: {model}
- requested effort: {effort}
- runtime is NON-PROD development only

Read and execute the assignment exactly:
Source path already fetched locally: {source_path}
Canonical source: {task['source']}
Task id: {task['id']}
Scope note: {task.get('scope') or task.get('notes') or '(none)'}
{block_prompt(task)}
Mandatory project context:
- Read AGENTS.md and CURSOR.md.
- Load applicable .cursor/rules and repository governance.
- GitHub/Git history is durable project truth.
- Work only inside /srv/gobadminton-clean/repo, /srv/gobadminton-clean/worktrees and the runner receipt/progress paths.
- /srv/gobadminton is LIVE RUNTIME MATERIAL and is strictly read-only/out of scope.
- /srv/agent-agency is another project and is strictly out of scope.
- Do not infer authority beyond the exact assignment.
- Do not start the next queued task yourself.
- No PROD/real-user release authority follows from this queue.
- Repair ordinary task-local QA/build failures, but do not widen scope.
- GitHub API/gh may be unavailable on this host. Do not block solely because a PR cannot be created/commented.
  A pushed branch + immutable candidate SHA + durable handoff is an acceptable VPS transport result.
  Never claim a PR exists unless it actually exists.

Completion receipt is mandatory.
On success write JSON exactly to:
{receipt_path}
with at least:
{{"ok": true, "task_id": "{task['id']}", "project": "GoBadminton", "summary": "<one line>", "result_ref": "<Git branch/commit/handoff or real PR>"}}

If genuinely blocked on Owner input or an unsafe/non-repairable condition:
{{"ok": false, "task_id": "{task['id']}", "project": "GoBadminton", "reason": "<exact blocker>", "owner_blocker": true}}

For an ordinary repairable infrastructure failure, write ok:false with reason/evidence and owner_blocker:false.
For an explicitly task/lane-local terminal blocker, also set blocker_scope="lane_local".
Use blocker_scope="project_global" for global safety gates; missing/ambiguous scope stays a hard stop.
For an independent QA semantic verdict, include "verdict":"PASS|PASS_WITH_NONBLOCKING_GAPS|FAIL|BLOCKED". QA FAIL/BLOCKED is terminal for that immutable candidate and must NOT be retried on the same SHA. Missing/new immutable candidate is a task-local QA BLOCKED result, not an Owner blocker.
Exit only after the receipt file exists.
"""


def launch_agent(cfg: dict[str, Any], task: dict[str, Any], prompt: str) -> subprocess.Popen:
    executor = str(task.get("executor") or cfg.get("default_executor") or "cursor").lower()
    model = str(task.get("model") or "").strip()
    effort = str(task.get("effort") or "").strip().lower()
    if executor == "codex" and not model:
        model = str(cfg.get("codex_default_model") or "gpt-6-sol").strip()
    sandbox = str(task.get("sandbox") or "workspace").strip().lower()
    workspace = str(cfg["workspace"])
    worktrees = str(cfg.get("worktrees_root") or (Path(workspace).parent / "worktrees"))

    env = dict(os.environ)
    node_bin = str(cfg.get("node_bin") or "").strip()
    local_bin = str(cfg.get("local_bin") or "").strip()
    prefixes = [x for x in [node_bin, local_bin] if x]
    if prefixes:
        env["PATH"] = os.pathsep.join(prefixes + [env.get("PATH", "")])

    if executor == "cursor":
        cli = str(cfg.get("cursor_agent") or "") or (shutil.which("agent") or shutil.which("cursor-agent") or "")
        if not cli or not Path(cli).is_file():
            raise RuntimeError("Cursor agent CLI not found")
        cmd = [cli, "--print", "--output-format", "json"]
        if model:
            cmd += ["--model", model]
        else:
            cmd += ["--model", "auto"]
        if sandbox == "full":
            # Explicitly admitted full mode: no Cursor sandbox/classifier boundary.
            cmd += ["--force", "--trust", "--sandbox", "disabled"]
        else:
            workspace_mode = str(cfg.get("cursor_workspace_mode") or "auto_review_no_native_sandbox")
            if workspace_mode == "native_sandbox":
                cmd += ["--force", "--trust", "--sandbox", "enabled"]
            else:
                # Ubuntu/AppArmor on the Germany VPS blocks Cursor's native user-namespace sandbox.
                # Auto-review keeps unattended classifier review without globally weakening AppArmor.
                cmd += ["--force", "--trust", "--sandbox", "disabled"]
        cmd += ["--workspace", workspace, "--add-dir", str(ROOT), "--add-dir", worktrees, prompt]

    elif executor == "codex":
        cli = str(cfg.get("codex_cli") or "") or (shutil.which("codex") or "")
        if not cli or not Path(cli).is_file():
            raise RuntimeError("Codex CLI not found")
        cmd = [cli, "exec", "--color", "never", "-C", workspace]
        if sandbox == "full":
            cmd += ["--dangerously-bypass-approvals-and-sandbox"]
        else:
            # Codex 0.155+ --approve-for-me already selects the workspace-write sandbox.
            # Passing both --sandbox and --approve-for-me is rejected by the CLI.
            cmd += ["--approve-for-me", "--add-dir", str(ROOT), "--add-dir", worktrees]
        if model:
            cmd += ["--model", model]
        if effort in {"low", "medium", "high", "xhigh", "extra_high"}:
            normalized = "xhigh" if effort == "extra_high" else effort
            cmd += ["-c", f'model_reasoning_effort="{normalized}"']
        cmd += [prompt]
    else:
        raise RuntimeError(f"unsupported executor: {executor}")

    log(f"launch executor={executor} model={model or 'default'} sandbox={sandbox} workspace={workspace!r}")
    log_name = f"{executor}.stdout.log"
    err_name = f"{executor}.stderr.log"
    return subprocess.Popen(
        cmd,
        cwd=workspace,
        env=env,
        stdin=subprocess.DEVNULL,
        stdout=(ROOT / log_name).open("a", encoding="utf-8"),
        stderr=(ROOT / err_name).open("a", encoding="utf-8"),
        start_new_session=True,
    )

def cleanup_executor_process_group(pid: int | None) -> None:
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


def completed_ids(st: dict[str, Any]) -> set[str]:
    terminal_statuses = {"completed", "qa_failed", "qa_blocked", "blocked",
                         "deferred", "owner_skipped", "superseded_before_launch"}
    return {
        str(h["id"])
        for h in st.get("history") or []
        if isinstance(h, dict)
        and h.get("status") in terminal_statuses
        and h.get("id")
    }


def pending_tasks(q: dict[str, Any], st: dict[str, Any]) -> list[dict[str, Any]]:
    done = completed_ids(st)
    tasks = [
        t for t in q["tasks"]
        if t.get("status", "queued") == "queued"
        and t.get("enabled") is not False
        and str(t["id"]) not in done
    ]
    return sorted(tasks, key=lambda x: float(x.get("order", 10**9)))


def claim_task(task: dict[str, Any]) -> dict[str, Any]:
    st = load_state()
    if st.get("paused"):
        raise RuntimeError("paused")
    if st.get("blocked"):
        raise RuntimeError("blocked")
    cur = st.get("current") or {}
    if cur.get("status") == "running" and cur.get("id"):
        if cur.get("agent_pid") and pid_alive(int(cur["agent_pid"])):
            raise RuntimeError(f"already running {cur['id']}")
    if str(task["id"]) in completed_ids(st):
        raise RuntimeError("already completed")

    claim = {
        "id": task["id"],
        "source": task["source"],
        "status": "running",
        "claimed_at": utc_now(),
        "agent_pid": None,
        "receipt": str(receipt_path_for(task)),
    }
    st["current"] = claim
    st["gate_wait"] = None
    st["runner_pid"] = os.getpid()
    save_state(st)
    return claim


def attempt_count(task_id: str) -> int:
    st = load_state()
    return int((st.get("attempts") or {}).get(task_id, 0) or 0)


def bump_attempt(task_id: str) -> int:
    st = load_state()
    attempts = dict(st.get("attempts") or {})
    n = int(attempts.get(task_id, 0) or 0) + 1
    attempts[task_id] = n
    st["attempts"] = attempts
    cur = dict(st.get("current") or {})
    if cur.get("id") == task_id:
        cur["attempt"] = n
        st["current"] = cur
    save_state(st)
    return n


def mark_completed(task_id: str, summary: str) -> None:
    progress = load_json(PROGRESS_PATH, {})
    if isinstance(progress, dict) and progress.get("task_id") == task_id:
        for block in progress.get("blocks") or []:
            if isinstance(block, dict) and block.get("status") == "running":
                block["status"] = "done"
        progress["status"] = "done"
        progress["current_block"] = None
        progress["updated_at"] = utc_now()
        atomic_write_json(PROGRESS_PATH, progress)

    st = load_state()
    hist = list(st.get("history") or [])
    hist.append({"id": task_id, "status": "completed", "summary": summary, "at": utc_now()})
    st["history"] = hist
    attempts = dict(st.get("attempts") or {})
    attempts.pop(task_id, None)
    st["attempts"] = attempts
    st["current"] = None
    st["blocked"] = None
    st["gate_wait"] = None
    save_state(st)
    log(f"COMPLETED {task_id}: {summary}")


def mark_qa_terminal(task_id: str, verdict: str, reason: str) -> None:
    normalized = "qa_failed" if verdict.upper() == "FAIL" else "qa_blocked"
    progress = load_json(PROGRESS_PATH, {})
    if isinstance(progress, dict) and progress.get("task_id") == task_id:
        for block in progress.get("blocks") or []:
            if isinstance(block, dict) and block.get("status") == "running":
                block["status"] = "blocked"
                block["note"] = reason
        progress["status"] = normalized
        progress["current_block"] = None
        progress["updated_at"] = utc_now()
        atomic_write_json(PROGRESS_PATH, progress)

    st = load_state()
    hist = list(st.get("history") or [])
    hist.append({
        "id": task_id,
        "status": normalized,
        "verdict": verdict.upper(),
        "reason": reason,
        "at": utc_now(),
    })
    st["history"] = hist
    st["current"] = None
    st["blocked"] = None
    st["gate_wait"] = None
    save_state(st)
    log(f"QA TERMINAL {task_id} verdict={verdict.upper()}: {reason}")


def lane_local_block(st: dict[str, Any]) -> bool:
    """Only explicit task-local terminal evidence permits PM recovery planning."""
    blocked = st.get("blocked") or {}
    cur = st.get("current") or {}
    if not blocked or cur.get("status") != "blocked" or cur.get("id") != blocked.get("id"):
        return False
    if cur.get("agent_pid") and pid_alive(cur["agent_pid"]):
        return False
    if st.get("global_gates") or st.get("project_global_blocker") or blocked.get("owner_blocker") is True:
        return False
    gate = st.get("gate_wait") or {}
    if gate.get("scope") == "project_global" or gate.get("owner_blocker") is True:
        return False
    receipt = read_receipt(Path(str(cur.get("receipt") or RECEIPTS_DIR / f"{blocked['id']}.json"))) or {}
    return (receipt.get("project") == "GoBadminton"
            and receipt.get("task_id") == blocked.get("id")
            and receipt.get("ok") is False
            and receipt.get("owner_blocker") is False
            and receipt.get("blocker_scope") == "lane_local"
            and blocked.get("blocker_scope", "lane_local") == "lane_local")


def release_lane_block(cfg: dict[str, Any], st: dict[str, Any]) -> bool:
    """Runner-owned preserve-and-release after exact canonical PM publication.

    PM requests a transition; only this writer mutates runner state. A stale
    request, missing remote commit or mismatched runtime backlog changes nothing.
    """
    request = load_json(BLOCK_RELEASE_PATH, {}) or {}
    if st.get("paused") or not lane_local_block(st) or request.get("blocked") != st.get("blocked"):
        return False
    cur = st.get("current") or {}
    if cur.get("agent_pid") and pid_alive(cur["agent_pid"]):
        return False
    sha = str(request.get("result_commit") or "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        return False
    workspace = str(cfg["workspace"])
    try:
        remote = subprocess.run(["git", "ls-remote", "origin", "refs/heads/main"],
                                cwd=workspace, capture_output=True, text=True, timeout=30)
        if remote.returncode or not remote.stdout.split() or remote.stdout.split()[0] != sha:
            return False
        published = subprocess.run(["git", "show", f"{sha}:_automation/gobadminton-runner/backlog.json"],
                                   cwd=workspace, capture_output=True, text=True, timeout=10)
        if published.returncode:
            return False
        canonical = json.loads(published.stdout)
        if canonical != load_backlog():
            return False
    except (OSError, subprocess.SubprocessError, ValueError):
        return False
    tid = str(st["blocked"]["id"])
    entries = [t for t in canonical.get("tasks", []) if t.get("id") == tid]
    # Quarantine is mandatory even when a new successor/independent lane exists.
    if len(entries) != 1 or entries[0].get("enabled") is not False or entries[0].get("status") not in {
        "blocked", "qa_blocked", "qa_failed", "superseded_before_launch"}:
        return False
    st["history"] = list(st.get("history") or []) + [{
        "id": tid, "status": "block_released", "at": utc_now(),
        "result_commit": sha, "original_block": dict(st["blocked"]),
        "original_current": dict(cur),
    }]
    st["blocked"] = None
    st["current"] = None
    save_state(st)
    return True


def mark_blocked(task_id: str, reason: str) -> None:
    st = load_state()
    st["blocked"] = {"id": task_id, "reason": reason, "at": utc_now()}
    cur = dict(st.get("current") or {})
    cur["status"] = "blocked"
    cur["reason"] = reason
    cur["finished_at"] = utc_now()
    st["current"] = cur
    hist = list(st.get("history") or [])
    hist.append({"id": task_id, "status": "blocked", "reason": reason, "at": utc_now()})
    st["history"] = hist
    save_state(st)
    log(f"BLOCKED {task_id}: {reason}")



CURSOR_INFRA_FAILOVER_PATTERNS = (
    "usage limit", "usage limits", "quota", "rate limit", "too many requests",
    "429", "credits", "credit balance", "subscription", "plan limit",
    "limit reached", "unauthorized", "authentication failed",
    "not authenticated", "not logged in", "login required", "token expired",
    "invalid token", "service unavailable", "temporarily unavailable",
    "connection lost", "network error", "econnreset", "etimedout", "enotfound",
    "bad gateway", "gateway timeout", "sandbox failed to start",
    "sandbox mode is enabled but not available", "cursor agent cli not found",
)


def executor_stderr_mark(executor: str) -> int:
    path = ROOT / f"{executor}.stderr.log"
    try:
        return path.stat().st_size
    except OSError:
        return 0


def executor_stderr_since(executor: str, offset: int, limit: int = 65536) -> str:
    path = ROOT / f"{executor}.stderr.log"
    try:
        with path.open("rb") as fh:
            fh.seek(max(0, offset))
            data = fh.read()
        if len(data) > limit:
            data = data[-limit:]
        return data.decode("utf-8", errors="replace")
    except OSError:
        return ""


def cursor_infra_failover_reason(
    *,
    returncode: int | None,
    receipt_ok: bool,
    receipt_reason: str,
    stderr_delta: str,
    launch_error: str = "",
) -> str | None:
    if receipt_ok:
        return None
    if launch_error:
        return f"Cursor launch unavailable: {launch_error}"
    if returncode not in (None, 0):
        return f"Cursor exited {returncode} without a valid task receipt"
    text = "\n".join((receipt_reason, stderr_delta)).lower()
    for pattern in CURSOR_INFRA_FAILOVER_PATTERNS:
        if pattern in text:
            return f"Cursor unavailable ({pattern}) without a valid task receipt"
    return None


def codex_failover_task(cfg: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    fallback = dict(task)
    fallback["executor"] = "codex"
    fallback["model"] = str(
        cfg.get("cursor_failover_codex_model")
        or cfg.get("codex_default_model")
        or "gpt-6-sol"
    )
    fallback["effort"] = str(
        cfg.get("cursor_failover_codex_effort")
        or task.get("effort")
        or "high"
    )
    return fallback


def cursor_failover_enabled(cfg: dict[str, Any], task: dict[str, Any]) -> bool:
    return (
        bool(cfg.get("cursor_failover_enabled", False))
        and str(task.get("executor") or cfg.get("default_executor") or "cursor").lower() == "cursor"
    )


def run_claimed(cfg: dict[str, Any], task: dict[str, Any], claim: dict[str, Any]) -> None:
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    rpath = receipt_path_for(task)
    workspace = Path(str(cfg["workspace"]))
    source_path = resolve_source(str(task["source"]), workspace)
    tid = str(task["id"])
    max_attempts = max(1, min(5, int(cfg.get("max_repair_attempts") or 5)))
    poll = float(cfg.get("poll_seconds") or 15)
    original_executor = str(task.get("executor") or cfg.get("default_executor") or "cursor").lower()
    use_codex_failover = False

    initialize_progress(task)

    while True:
        existing = attempt_count(tid)
        if existing >= max_attempts:
            mark_blocked(tid, f"repair limit reached ({existing}/{max_attempts})")
            return

        if rpath.exists():
            rpath.unlink()

        attempt = bump_attempt(tid)
        active_task = codex_failover_task(cfg, task) if use_codex_failover else task
        active_executor = str(active_task.get("executor") or cfg.get("default_executor") or "cursor").lower()
        prompt = build_launch_prompt(active_task, source_path, rpath)
        if attempt > 1:
            prompt += f"\nThis is bounded repair retry {attempt}/{max_attempts}. Inspect prior evidence and fix the same task only.\n"
        if use_codex_failover:
            prompt += (
                "\nINFRASTRUCTURE FAILOVER: Cursor was unavailable for this task. "
                "Continue the SAME task and SAME repair attempt through Codex. "
                "Do not widen scope and do not reinterpret prior semantic evidence.\n"
            )

        stderr_mark = executor_stderr_mark(active_executor)
        try:
            proc = launch_agent(cfg, active_task, prompt)
        except Exception as exc:
            if active_executor == "cursor" and cursor_failover_enabled(cfg, task):
                fail_reason = cursor_infra_failover_reason(
                    returncode=None,
                    receipt_ok=False,
                    receipt_reason="",
                    stderr_delta=executor_stderr_since("cursor", stderr_mark),
                    launch_error=str(exc),
                )
                if fail_reason:
                    use_codex_failover = True
                    active_task = codex_failover_task(cfg, task)
                    active_executor = "codex"
                    prompt = build_launch_prompt(active_task, source_path, rpath)
                    if attempt > 1:
                        prompt += f"\nThis is bounded repair retry {attempt}/{max_attempts}. Inspect prior evidence and fix the same task only.\n"
                    prompt += (
                        f"\nINFRASTRUCTURE FAILOVER from Cursor: {fail_reason}. "
                        "Continue the SAME task and SAME repair attempt through Codex. "
                        "Do not widen scope.\n"
                    )
                    log(f"executor failover task={tid} cursor->codex attempt={attempt}: {fail_reason}")
                    try:
                        proc = launch_agent(cfg, active_task, prompt)
                    except Exception as fallback_exc:
                        reason = f"Codex failover launch failed: {fallback_exc}"
                        if attempt >= max_attempts:
                            mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                            return
                        log(f"infra retry ready {tid} attempt={attempt}/{max_attempts}: {reason}")
                        time.sleep(poll)
                        continue
                else:
                    reason = f"Cursor launch failed without failover classification: {exc}"
                    if attempt >= max_attempts:
                        mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                        return
                    log(f"infra retry ready {tid} attempt={attempt}/{max_attempts}: {reason}")
                    time.sleep(poll)
                    continue
            else:
                reason = f"{active_executor} launch failed: {exc}"
                if attempt >= max_attempts:
                    mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                    return
                log(f"infra retry ready {tid} attempt={attempt}/{max_attempts}: {reason}")
                time.sleep(poll)
                continue

        st = load_state()
        current = {
            **claim,
            "agent_pid": proc.pid,
            "started_at": utc_now(),
            "attempt": attempt,
            "max_attempts": max_attempts,
            "receipt": str(rpath),
            "executor": active_executor,
        }
        if use_codex_failover and original_executor == "cursor":
            current["failover_from"] = "cursor"
        st["current"] = current
        save_state(st)
        log(f"agent started pid={proc.pid} task={tid} attempt={attempt}/{max_attempts} executor={active_executor}")
        proc.wait()
        cleanup_executor_process_group(proc.pid)
        log(f"agent exited code={proc.returncode} task={tid} executor={active_executor}")

        ok, reason = validate_receipt(rpath, tid)
        data = read_receipt(rpath) or {}

        if active_executor == "cursor" and cursor_failover_enabled(cfg, task) and not ok:
            stderr_delta = executor_stderr_since("cursor", stderr_mark)
            fail_reason = cursor_infra_failover_reason(
                returncode=proc.returncode,
                receipt_ok=ok,
                receipt_reason=reason,
                stderr_delta=stderr_delta,
            )
            if fail_reason:
                use_codex_failover = True
                if rpath.exists():
                    rpath.unlink()
                fallback_task = codex_failover_task(cfg, task)
                fallback_prompt = build_launch_prompt(fallback_task, source_path, rpath)
                if attempt > 1:
                    fallback_prompt += f"\nThis is bounded repair retry {attempt}/{max_attempts}. Inspect prior evidence and fix the same task only.\n"
                fallback_prompt += (
                    f"\nINFRASTRUCTURE FAILOVER from Cursor: {fail_reason}. "
                    "Continue the SAME task and SAME repair attempt through Codex. "
                    "Do not widen scope and do not reinterpret prior semantic evidence.\n"
                )
                log(f"executor failover task={tid} cursor->codex attempt={attempt}: {fail_reason}")
                try:
                    proc = launch_agent(cfg, fallback_task, fallback_prompt)
                except Exception as exc:
                    reason = f"Codex failover launch failed: {exc}"
                    if attempt >= max_attempts:
                        mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                        return
                    log(f"infra retry ready {tid} attempt={attempt}/{max_attempts}: {reason}")
                    time.sleep(poll)
                    continue
                st = load_state()
                st["current"] = {
                    **claim,
                    "agent_pid": proc.pid,
                    "started_at": utc_now(),
                    "attempt": attempt,
                    "max_attempts": max_attempts,
                    "receipt": str(rpath),
                    "executor": "codex",
                    "failover_from": "cursor",
                    "failover_reason": fail_reason,
                }
                save_state(st)
                log(f"agent started pid={proc.pid} task={tid} attempt={attempt}/{max_attempts} executor=codex failover_from=cursor")
                proc.wait()
                cleanup_executor_process_group(proc.pid)
                log(f"agent exited code={proc.returncode} task={tid} executor=codex failover_from=cursor")
                ok, reason = validate_receipt(rpath, tid)
                data = read_receipt(rpath) or {}

        if tid.startswith("qa-"):
            verdict = str(data.get("verdict") or "").upper()
            lower_reason = reason.lower()
            missing_candidate = (
                "no new immutable" in lower_reason
                or "new immutable producer candidate" in lower_reason
                or "missing immutable candidate" in lower_reason
            )
            if verdict in {"FAIL", "BLOCKED"} or missing_candidate:
                mark_qa_terminal(tid, verdict or "BLOCKED", reason)
                return

        if ok:
            mark_completed(tid, reason)
            return

        if data.get("owner_blocker") is True:
            mark_blocked(tid, f"Owner/safety blocker: {reason}")
            return

        if attempt >= max_attempts:
            mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
            return

        log(f"repairable failure {tid} attempt={attempt}: {reason}")
        time.sleep(poll)

def recover_state_on_start() -> None:
    st = load_state()
    cur = st.get("current") or {}
    if cur.get("status") != "running":
        st["runner_pid"] = os.getpid()
        save_state(st)
        return

    pid = cur.get("agent_pid")
    if pid and pid_alive(int(pid)):
        # Another instance should not happen because of the lock, but preserve truth.
        st["runner_pid"] = os.getpid()
        save_state(st)
        return

    tid = str(cur.get("id") or "")
    if not tid:
        st["current"] = None
        save_state(st)
        return

    rpath = Path(str(cur.get("receipt") or (RECEIPTS_DIR / f"{tid}.json")))
    ok, reason = validate_receipt(rpath, tid)
    if ok:
        mark_completed(tid, reason)
        return

    # Stale launch with no valid receipt: allow bounded retry.
    st["current"] = None
    save_state(st)
    log(f"recovered stale task {tid}; retry eligible")


def daemon_loop() -> int:
    cfg = load_config()
    if cfg.get("prod_authorized") is not False:
        log("REFUSE: config must keep prod_authorized=false")
        return 2

    lock = SingleInstanceLock(LOCK_PATH)
    if not lock.acquire():
        log("REFUSE: another runner holds single-instance lock")
        return 3

    log(f"runner start pid={os.getpid()}")
    try:
        recover_state_on_start()
        while True:
            st = load_state()
            st["runner_pid"] = os.getpid()
            save_state(st)

            poll = float(cfg.get("poll_seconds") or 15)

            if st.get("paused"):
                time.sleep(poll)
                continue

            if st.get("blocked") and release_lane_block(cfg, st):
                continue
            if st.get("blocked"):
                time.sleep(poll * 2)
                continue

            cur = st.get("current") or {}
            if cur.get("status") == "running" and cur.get("agent_pid") and pid_alive(int(cur["agent_pid"])):
                time.sleep(poll)
                continue

            busy, why = writer_busy(cfg, st)
            if busy:
                old = st.get("gate_wait") or {}
                if old.get("type") != "writer" or old.get("reason") != why:
                    st["gate_wait"] = {"type": "writer", "reason": why, "at": utc_now()}
                    save_state(st)
                    log(f"writer busy: {why}")
                time.sleep(poll)
                continue

            q = load_backlog()
            tasks = pending_tasks(q, st)
            if not tasks:
                if st.get("gate_wait") is not None:
                    st["gate_wait"] = None
                    save_state(st)
                time.sleep(poll * 2)
                continue

            task = tasks[0]
            gate_ok, gate_reason = task_gate(task, cfg)
            if not gate_ok:
                gate = {"type": "task_gate", "id": task["id"], "reason": gate_reason}
                old = st.get("gate_wait") or {}
                if old.get("type") != gate["type"] or old.get("id") != gate["id"] or old.get("reason") != gate["reason"]:
                    gate["at"] = utc_now()
                    st["gate_wait"] = gate
                    save_state(st)
                    log(f"gate wait {task['id']}: {gate_reason}")
                time.sleep(poll * 2)
                continue

            try:
                claim = claim_task(task)
                log(f"claimed {task['id']}")
                run_claimed(cfg, task, claim)
            except Exception as e:
                tid = str(task.get("id") or "unknown")
                n = bump_attempt(tid)
                max_attempts = max(1, min(5, int(cfg.get("max_repair_attempts") or 5)))
                if n >= max_attempts:
                    mark_blocked(tid, f"infrastructure retry limit reached ({n}/{max_attempts}): {e}")
                else:
                    st = load_state()
                    st["current"] = None
                    st["blocked"] = None
                    save_state(st)
                    log(f"infra retry ready {tid} attempt={n}/{max_attempts}: {e}")
                    time.sleep(poll)
    finally:
        lock.release()
        log("runner stop")


def status() -> int:
    cfg = load_config()
    st = load_state()
    q = load_backlog()
    busy, why = writer_busy(cfg, st)
    tasks = pending_tasks(q, st)
    gate = None
    if tasks:
        ok, reason = task_gate(tasks[0], cfg)
        gate = {"task": tasks[0]["id"], "ready": ok, "reason": reason}
    out = {
        "runner_pid": st.get("runner_pid"),
        "runner_alive": pid_alive(st.get("runner_pid")),
        "paused": st.get("paused"),
        "blocked": st.get("blocked"),
        "current": st.get("current"),
        "writer_busy": busy,
        "writer_reason": why,
        "gate_wait": st.get("gate_wait"),
        "next_gate": gate,
        "pending": [t["id"] for t in tasks],
        "completed": sorted(completed_ids(st)),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def pause() -> int:
    st = load_state()
    st["paused"] = True
    save_state(st)
    print("paused")
    return 0


def resume() -> int:
    st = load_state()
    st["paused"] = False
    save_state(st)
    print("resumed")
    return 0


def retry_blocked() -> int:
    st = load_state()
    blocked = st.get("blocked")
    if not blocked:
        print("nothing blocked")
        return 1
    print("REFUSE: terminal BLOCKED is immutable; publish PM quarantine and a new candidate")
    return 2



def print_queue() -> int:
    q = load_backlog()
    print(json.dumps(q["tasks"], indent=2, ensure_ascii=False))
    return 0



# ---------------------------------------------------------------------------
# Runner v2: conflict-domain parallel execution
# ---------------------------------------------------------------------------
# The v1 implementation above is kept as migration/reference code.  These
# definitions deliberately override its state/scheduling/execution entry
# points before main() is bound.  This keeps old helper contracts available
# while making concurrency opt-in and backwards safe.
import copy as _copy
import threading as _threading

RUNNER_V2_STATE_VERSION = 2
RUNNER_V2_DEFAULT_MAX_PARALLEL = 2
RUNNER_V2_MAX_PARALLEL_LIMIT = 4
RUNNER_V2_GLOBAL_LOCK = "global"
RUNNER_V2_PROGRESS_DIR = ROOT / "progress"
RUNNER_V2_TASK_LOG_DIR = ROOT / "task-logs"
_V2_STATE_LOCK = _threading.RLock()
_V2_WORKERS: dict[str, _threading.Thread] = {}


def _v2_slug(value: str) -> str:
    out = re.sub(r"[^A-Za-z0-9._-]+", "-", str(value)).strip("-._")
    return (out or "task")[:120]


def task_locks(task: dict[str, Any]) -> tuple[str, ...]:
    raw = task.get("locks")
    if raw is None:
        return (RUNNER_V2_GLOBAL_LOCK,)
    if not isinstance(raw, list) or not raw:
        raise RuntimeError(f"task {task.get('id')} locks must be a non-empty string list")
    locks: list[str] = []
    for item in raw:
        lock = str(item).strip().lower()
        if not lock or not re.fullmatch(r"[a-z0-9][a-z0-9._:-]{0,63}", lock):
            raise RuntimeError(f"task {task.get('id')} invalid lock {item!r}")
        if lock not in locks:
            locks.append(lock)
    return tuple(locks)


def locks_conflict(a: tuple[str, ...] | list[str], b: tuple[str, ...] | list[str]) -> bool:
    """Hierarchical resource locks, with legacy coarse locks preserved.

    "web" conflicts with "web:games" and all other "web:*" subdomains;
    "web:games" and "web:radar" can coexist when their actual changed-file
    scopes have been independently reviewed. Matching nested scopes conflict.
    No task is automatically reclassified; existing broad locks stay broad.
    The same function is used by task selection and atomic claim admission.
    """
    aa, bb = set(a), set(b)
    if RUNNER_V2_GLOBAL_LOCK in aa or RUNNER_V2_GLOBAL_LOCK in bb:
        return True
    for left in aa:
        for right in bb:
            if left == right or left.startswith(right + ":") or right.startswith(left + ":"):
                return True
    return False


def max_parallel(cfg: dict[str, Any]) -> int:
    try:
        value = int(cfg.get("max_parallel", RUNNER_V2_DEFAULT_MAX_PARALLEL))
    except (TypeError, ValueError):
        value = RUNNER_V2_DEFAULT_MAX_PARALLEL
    return max(1, min(RUNNER_V2_MAX_PARALLEL_LIMIT, value))


def _v2_active(st: dict[str, Any]) -> dict[str, dict[str, Any]]:
    active = st.get("active")
    return active if isinstance(active, dict) else {}


def _v2_sync_current_alias(st: dict[str, Any]) -> None:
    active = _v2_active(st)
    if active:
        ordered = sorted(
            active.values(),
            key=lambda c: (str(c.get("claimed_at") or ""), str(c.get("id") or "")),
        )
        st["current"] = _copy.deepcopy(ordered[0])
        return
    blocked = st.get("blocked") or {}
    cur = st.get("current") or {}
    if blocked:
        if cur.get("id") == blocked.get("id") and cur.get("status") == "blocked":
            return
        st["current"] = {
            "id": blocked.get("id"),
            "status": "blocked",
            "reason": blocked.get("reason"),
            "finished_at": blocked.get("at"),
        }
    else:
        st["current"] = None


def _v2_migrate_state(st: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(st, dict):
        st = {}
    st.setdefault("version", RUNNER_V2_STATE_VERSION)
    active = st.get("active")
    if not isinstance(active, dict):
        active = {}
    cur = st.get("current") or {}
    # One-time, lossless v1 running-claim migration.
    if not active and isinstance(cur, dict) and cur.get("status") == "running" and cur.get("id"):
        active[str(cur["id"])] = _copy.deepcopy(cur)
    st["active"] = active
    if not isinstance(st.get("blocked_tasks"), dict):
        st["blocked_tasks"] = {}
    if not isinstance(st.get("history"), list):
        st["history"] = []
    if not isinstance(st.get("attempts"), dict):
        st["attempts"] = {}
    st["version"] = RUNNER_V2_STATE_VERSION
    _v2_sync_current_alias(st)
    return st


def load_state() -> dict[str, Any]:
    with _V2_STATE_LOCK:
        raw = load_json(
            STATE_PATH,
            {
                "version": RUNNER_V2_STATE_VERSION,
                "paused": False,
                "runner_pid": None,
                "current": None,
                "active": {},
                "history": [],
                "attempts": {},
                "blocked": None,
                "blocked_tasks": {},
                "gate_wait": None,
                "updated_at": None,
            },
        )
        return _copy.deepcopy(_v2_migrate_state(raw if isinstance(raw, dict) else {}))


def save_state(st: dict[str, Any]) -> None:
    with writer_bridge.bridge_section():
        with _V2_STATE_LOCK:
            data = _v2_migrate_state(_copy.deepcopy(st))
            data["updated_at"] = utc_now()
            atomic_write_json(STATE_PATH, data)


def _v2_mutate_state(fn) -> dict[str, Any]:
    with writer_bridge.bridge_section():
        with _V2_STATE_LOCK:
            raw = load_json(STATE_PATH, {}) or {}
            st = _v2_migrate_state(raw if isinstance(raw, dict) else {})
            fn(st)
            _v2_sync_current_alias(st)
            st["version"] = RUNNER_V2_STATE_VERSION
            st["updated_at"] = utc_now()
            atomic_write_json(STATE_PATH, st)
            return _copy.deepcopy(st)


def active_claims(st: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    state = _v2_migrate_state(_copy.deepcopy(st)) if isinstance(st, dict) else load_state()
    return sorted(
        (_copy.deepcopy(v) for v in _v2_active(state).values() if isinstance(v, dict)),
        key=lambda c: (str(c.get("claimed_at") or ""), str(c.get("id") or "")),
    )


def load_backlog() -> dict[str, Any]:
    q = load_json(BACKLOG_PATH)
    return validate_backlog(q)


def validate_backlog(q: Any) -> dict[str, Any]:
    """Pure Runner schema check, also used before canonical replacement."""
    if not isinstance(q, dict) or not isinstance(q.get("tasks"), list):
        raise RuntimeError("backlog.json invalid: expected object with tasks[]")
    if q.get("prod_authorized") is not False:
        raise RuntimeError("backlog must keep prod_authorized=false")
    allowed = set(ALLOWED_TASK_KEYS) | {
        "locks", "depends_on_completed", "depends_on_accepted", "base_sha", "candidate_sha", "effect_ceiling", "recovery_from", "recovery_policy", "source_review", "source_qa", "release_handoff"
    }
    for t in q["tasks"]:
        if not isinstance(t, dict):
            raise RuntimeError("backlog task must be object")
        if "enabled" in t and not isinstance(t["enabled"], bool):
            raise RuntimeError(f"task {t.get('id')} enabled must be boolean")
        if "status" in t and not isinstance(t["status"], str):
            raise RuntimeError(f"task {t.get('id')} status must be string")
        try:
            float(t.get("order", 10**9))
        except (TypeError, ValueError) as exc:
            raise RuntimeError(f"task {t.get('id')} order invalid") from exc
        unknown = set(t) - allowed
        if unknown:
            raise RuntimeError(f"unsupported task keys for {t.get('id')}: {sorted(unknown)}")
        if any(k in t for k in ("command", "shell", "cmd")):
            raise RuntimeError("backlog must not contain shell/command fields")
        if not t.get("id") or not t.get("source"):
            raise RuntimeError("each task needs id + source")
        task_locks(t)
        if "effect_ceiling" in t and t["effect_ceiling"] != "source_only":
            raise RuntimeError(f"task {t.get('id')} unsupported recovery effect ceiling")
        if "recovery_from" in t:
            lineage = t["recovery_from"]
            if (not isinstance(lineage, dict) or set(lineage) != {"key", "slice_id", "attempt"}
                    or not re.fullmatch(r"[0-9a-f]{64}", str(lineage.get("key", "")))
                    or not isinstance(lineage.get("slice_id"), str) or not lineage["slice_id"]
                    or type(lineage.get("attempt")) is not int or not 1 <= lineage["attempt"] <= 5
                    or t.get("effect_ceiling") != "source_only"):
                raise RuntimeError(f"task {t.get('id')} invalid bounded recovery lineage")
        if "recovery_policy" in t:
            policy = t["recovery_policy"]
            if (not isinstance(policy, dict) or set(policy) - {"slice_id", "blocked_source_repair", "prior_attempts"}
                    or not isinstance(policy.get("slice_id"), str) or not policy["slice_id"]
                    or ("blocked_source_repair" in policy and type(policy["blocked_source_repair"]) is not bool)
                    or ("prior_attempts" in policy and (type(policy["prior_attempts"]) is not int or not 0 <= policy["prior_attempts"] <= 5))):
                raise RuntimeError(f"task {t.get('id')} invalid source repair policy")
        for key in ("depends_on_completed", "depends_on_accepted"):
            value = t.get(key)
            if value is not None and (
                not isinstance(value, list)
                or not all(isinstance(x, str) and x.strip() for x in value)
            ):
                raise RuntimeError(f"task {t.get('id')} {key} must be string[]")
        if "source_qa" in t:
            source_qa = t["source_qa"]
            deps = t.get("depends_on_completed")
            if (not isinstance(source_qa, dict)
                    or set(source_qa) != {"producer_task_id", "suite_id"}
                    or not str(t.get("id") or "").startswith("qa-")
                    or not isinstance(source_qa.get("producer_task_id"), str)
                    or not source_qa["producer_task_id"]
                    or deps != [source_qa["producer_task_id"]]
                    or t.get("depends_on_accepted") not in (None, [])
                    or not isinstance(source_qa.get("suite_id"), str)
                    or not re.fullmatch(r"[A-Za-z0-9_.:-]+", source_qa["suite_id"])
                    or t.get("effect_ceiling") != "source_only"
                    or t.get("sandbox") != "read-only"):
                raise RuntimeError(f"task {t.get('id')} invalid immutable own-source QA")
        if "release_handoff" in t:
            deps = t.get("depends_on_accepted")
            if (t.get("release_handoff") !=
                    {"kind": "ci_candidate", "target": "authorized_release_job"}
                    or t.get("effect_ceiling") != "source_only"
                    or t.get("sandbox") != "read-only"
                    or t.get("depends_on_completed") not in (None, [])
                    or not isinstance(deps, list) or len(deps) != 1
                    or not isinstance(deps[0], str) or not deps[0].startswith("qa-")
                    or "global" not in task_locks(t)
                    or "source_review" in t or "source_qa" in t):
                raise RuntimeError(f"task {t.get('id')} invalid source-only CI handoff")
        if "source_review" in t:
            review=t["source_review"]
            if (not isinstance(review,dict)
                    or set(review)!={"candidate_sha","candidate_tree","branch","suite_id"}
                    or not all(isinstance(review.get(k),str) and review[k] for k in review)
                    or not all(re.fullmatch(r"[0-9a-f]{40}",review[k])
                               for k in ("candidate_sha","candidate_tree"))
                    or not re.fullmatch(r"[A-Za-z0-9_./-]+",review["branch"])
                    or review["branch"].startswith((".","/"))
                    or not re.fullmatch(r"[A-Za-z0-9_.:-]+",review["suite_id"])
                    or t.get("effect_ceiling")!="source_only"
                    or t.get("depends_on_completed") or t.get("depends_on_accepted")):
                raise RuntimeError(f"task {t.get('id')} invalid independent source review binding")
        base = t.get("base_sha")
        if base is not None and not re.fullmatch(r"[0-9a-f]{40}", str(base)):
            raise RuntimeError(f"task {t.get('id')} base_sha must be 40-char sha")
        dns_gate = t.get("requires_dns_no_aaaa")
        if dns_gate is not None:
            if not isinstance(dns_gate, dict):
                raise RuntimeError(f"task {t.get('id')} DNS gate must be object")
            if not isinstance(dns_gate.get("names"), list) or not dns_gate.get("names"):
                raise RuntimeError(f"task {t.get('id')} DNS gate needs names[]")
            if not isinstance(dns_gate.get("servers"), list) or not dns_gate.get("servers"):
                raise RuntimeError(f"task {t.get('id')} DNS gate needs servers[]")
        blocks = t.get("blocks")
        if blocks is not None:
            if not isinstance(blocks, list) or not blocks:
                raise RuntimeError(f"task {t.get('id')} blocks must be non-empty list")
            seen: set[str] = set()
            for item in blocks:
                if not isinstance(item, dict) or not item.get("id") or not item.get("title"):
                    raise RuntimeError(f"task {t.get('id')} block needs id + title")
                if item["id"] in seen:
                    raise RuntimeError(f"duplicate block id {item['id']}")
                seen.add(str(item["id"]))
    return q


def _v2_history_status(st: dict[str, Any], task_id: str) -> str | None:
    for h in reversed(st.get("history") or []):
        if isinstance(h, dict) and str(h.get("id") or "") == task_id:
            return str(h.get("status") or "")
    return None


def _v2_task_map(q: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(t["id"]): t for t in q.get("tasks", []) if isinstance(t, dict) and t.get("id")}


def _v2_candidate_sha(value: Any) -> str | None:
    text = str(value or "")
    return text if re.fullmatch(r"[0-9a-f]{40}", text) else None


def _v2_source_sha(task: dict[str, Any]) -> str | None:
    matched = backlog_sync.FULL_GITHUB_SOURCE.fullmatch(str(task.get("source") or ""))
    if matched:
        return matched.group(1)
    return None


def _v2_evidence_repo() -> Path | None:
    # Resolve only the installed/task-local configured repository; no guessed
    # sibling worktree and no moving local checkout is provenance authority.
    cfg = load_json(BACKLOG_PATH.parent / "config.json", {})
    if (not isinstance(cfg, dict) or cfg.get("project") != "GoBadminton"
            or cfg.get("prod_authorized") is not False or not cfg.get("workspace")):
        return None
    return Path(str(cfg["workspace"]))


def _v2_git_evidence(args: list[str]) -> str | None:
    repo = _v2_evidence_repo()
    if repo is None:
        return None
    try:
        return backlog_sync.run_git(repo, args, timeout=12)
    except (backlog_sync.SyncBlocked, OSError, subprocess.TimeoutExpired):
        return None


# Selection diagnostics may use local ancestry before a refresh. Claims always
# obtain and consume their OWN fresh observation; this map never grants a claim.
_V2_PUBLICATION_OBSERVATIONS: dict[tuple[str, str], dict[str, Any]] = {}


def _v2_publication_key(producer_id: str) -> tuple[str, str] | None:
    repo = _v2_evidence_repo()
    return (str(repo.resolve()), producer_id) if repo is not None else None


def refresh_qa_candidate_refs(q: dict[str, Any], st: dict[str, Any], cfg: dict[str, Any],
                              *, qa_tasks: list[dict[str, Any]] | None = None) -> dict[str, dict[str, Any]]:
    """Fresh announced origin branch evidence, OUTSIDE the short claim lock.

    A cached ancestor is never reason to skip the network. Missing, unknown,
    rewound or concurrently moved publication leaves explicit failed evidence.
    A normal fast-forward containing the candidate (e.g. handoff commits) is
    allowed. The returned observation is scoped to this one claim preflight.
    """
    lookup = _v2_task_map(q)
    observations: dict[str, dict[str, Any]] = {}
    repo = _v2_evidence_repo()
    if repo is None or repo.resolve() != Path(str(cfg.get("workspace", ""))).resolve():
        return observations
    for qa in qa_tasks if qa_tasks is not None else pending_tasks(q, st):
        if not str(qa["id"]).startswith("qa-"):
            continue
        for dep in _v2_dependencies(qa, "depends_on_completed"):
            if dep.startswith("qa-") or dep in observations:
                continue
            producer = lookup.get(dep)
            receipt = read_receipt(receipt_path_for(producer)) if producer else None
            proof = {"receipt": receipt, "head": None, "reason": "producer receipt/history unavailable"}
            key = (str(repo.resolve()), dep)
            _V2_PUBLICATION_OBSERVATIONS[key] = proof
            observations[dep] = proof
            if (_v2_history_status(st, dep) != "completed" or not isinstance(receipt, dict)
                    or receipt.get("project") != "GoBadminton" or receipt.get("task_id") != dep
                    or receipt.get("ok") is not True):
                continue
            candidate = _v2_candidate_sha(receipt.get("candidate_sha"))
            branch = receipt.get("branch")
            if not candidate or not isinstance(branch, str) or not branch or branch.startswith("-"):
                continue
            try:
                backlog_sync.run_git(repo, ["check-ref-format", "refs/heads/" + branch], timeout=5)
                ref = "refs/remotes/origin/" + branch
                old_head = _v2_git_evidence(["rev-parse", "--verify", ref])
                announced = backlog_sync.run_git(repo, ["ls-remote", "--refs", "origin",
                                                        "refs/heads/" + branch], timeout=30)
                lines = announced.splitlines()
                fields = lines[0].split() if len(lines) == 1 else []
                if len(fields) != 2 or fields[1] != "refs/heads/" + branch:
                    raise backlog_sync.SyncBlocked("producer branch absent/ambiguous on origin")
                head = _v2_candidate_sha(fields[0])
                if not head:
                    raise backlog_sync.SyncBlocked("invalid announced producer head")
                # Fetch the announced object without updating a tracking ref.
                # refs/remotes accepts some forced updates even without '+'. A
                # failed non-FF check must retain the prior publication anchor.
                backlog_sync.run_git(repo, ["fetch", "--no-tags", "--refmap=", "origin", head], timeout=35)
                backlog_sync.run_git(repo, ["cat-file", "-e", head + "^{commit}"], timeout=5)
                confirm = backlog_sync.run_git(repo, ["ls-remote", "--refs", "origin",
                                                      "refs/heads/" + branch], timeout=30)
                if confirm != announced:
                    raise backlog_sync.SyncBlocked("producer branch moved during verification")
                if old_head:
                    backlog_sync.run_git(repo, ["merge-base", "--is-ancestor", old_head, head], timeout=5)
                backlog_sync.run_git(repo, ["merge-base", "--is-ancestor", candidate, head], timeout=5)
                backlog_sync.run_git(repo, ["update-ref", ref, head, old_head or "0" * 40], timeout=5)
                proof.update(head=head, reason="fresh producer publication verified")
            except (backlog_sync.SyncBlocked, OSError, subprocess.TimeoutExpired) as exc:
                proof["reason"] = str(exc)[:350]
    return observations


def _v2_verified_producer_candidate(qa: dict[str, Any], producer: dict[str, Any],
                                    *, publication_head: str | None = None, allow_terminal_failure: bool = False) -> str | None:
    receipt = read_receipt(receipt_path_for(producer))
    if (not isinstance(receipt, dict) or receipt.get("ok") is not True
            or receipt.get("project") != "GoBadminton"
            or receipt.get("task_id") != producer["id"]):
        return None
    candidate = _v2_candidate_sha(receipt.get("candidate_sha"))
    tree = _v2_candidate_sha(receipt.get("candidate_tree"))
    branch = receipt.get("branch")
    if (not candidate or not tree or not isinstance(branch, str)
            or not branch or branch.startswith("-")
            or _v2_git_evidence(["check-ref-format", "refs/heads/" + branch]) is None):
        return None
    lineage = producer.get("recovery_from")
    if lineage is not None:
        try:
            ledger = json.loads((BACKLOG_PATH.parent / "qa-recovery-ledger.json").read_text())
            entry = ledger["actions"][lineage["key"]]
            if (producer.get("effect_ceiling") != "source_only" or type(lineage["attempt"]) is not int
                    or not 1 <= lineage["attempt"] <= 5
                    or entry.get("attempt") != lineage["attempt"]
                    or entry["evidence"]["slice_id"] != lineage["slice_id"]
                    or any(e["evidence"]["candidate_sha"] == candidate for e in ledger["actions"].values()
                           if e["evidence"]["slice_id"] == lineage["slice_id"]
                           and not (allow_terminal_failure and e["evidence"]["failed_task_id"] == qa["id"]))):
                return None
        except (OSError, ValueError, KeyError, TypeError):
            return None
    # base_sha is a checkout/planning baseline, never the expected new code SHA.
    expected = qa.get("candidate_sha")
    if expected is not None and expected != candidate:
        return None
    if _v2_git_evidence(["rev-parse", candidate + "^{tree}"]) != tree:
        return None
    key = _v2_publication_key(str(producer["id"]))
    observation = _V2_PUBLICATION_OBSERVATIONS.get(key)
    if publication_head is None and observation is not None and (observation["receipt"] != receipt or not observation["head"]):
        return None
    publication = publication_head or (observation["head"] if observation else "refs/remotes/origin/" + branch)
    if _v2_git_evidence(["merge-base", "--is-ancestor", candidate, publication]) is None:
        return None
    baseline = producer.get("base_sha") or _v2_source_sha(producer)
    if (not _v2_candidate_sha(baseline) or
            _v2_git_evidence(["merge-base", "--is-ancestor", baseline, candidate]) is None):
        return None
    return candidate


def _v2_producer_receipt_matches(qa_task: dict[str, Any], q: dict[str, Any],
                                 candidate: str) -> bool:
    if qa_task.get("candidate_sha") is not None and qa_task["candidate_sha"] != candidate:
        return False
    predecessors = [dep for dep in _v2_dependencies(qa_task, "depends_on_completed")
                    if not dep.startswith("qa-")]
    lookup = _v2_task_map(q)
    if not predecessors:
        return False
    for producer_id in predecessors:
        producer = lookup.get(producer_id)
        if not producer:
            return False
        receipt = read_receipt(receipt_path_for(producer))
        if receipt is None:
            # Accepted-source legacy compatibility ONLY. Both the producer and
            # immutable QA prompt must be published at the exact candidate on
            # accepted main. This exception never permits a new QA claim.
            if (receipt_path_for(producer).exists() or _v2_source_sha(qa_task) != candidate or
                    _v2_source_sha(producer) != candidate):
                return False
        elif _v2_verified_producer_candidate(qa_task, producer) != candidate:
            return False
    return True


def _v2_dependency_accepted(q: dict[str, Any], st: dict[str, Any], dep_id: str,
                            *, consumer: dict[str, Any] | None = None) -> bool:
    try:
        backlog_sync.validate_history(st.get('history'))
    except backlog_sync.InvalidRunnerState:
        return False
    if (_v2_task_map(q).get(dep_id, {}).get('status') in {'qa_failed', 'qa_blocked'} or
            any(h['id'] == dep_id and h['status'] in {'qa_failed', 'qa_blocked'} for h in st['history'])):
        return False
    # Exact historical dependency attestations cannot authorize a source merge,
    # replacement/rebinding or a new independent QA claim.
    import legacy_qa
    if dep_id in legacy_qa.LEGACY_TASK_IDS:
        # A rewritten historic receipt cannot escape its byte-bound ledger by
        # adding the new-format fields. Repairs require a new task ID and SHA.
        return legacy_qa.accepted(sys.modules[__name__], q, st, dep_id, consumer)
    task = _v2_task_map(q).get(dep_id, {})
    if "source_review" in task:
        return _v2_source_review_accepted(q, st, dep_id, consumer=consumer)
    if "source_qa" in task:
        return _v2_source_qa_accepted(q, st, dep_id, consumer=consumer)
    return _v2_strict_dependency_accepted(q, st, dep_id)


SOURCE_REVIEW_QA_ROOT=Path("/var/lib/gobadminton-clean-trusted-qa-evidence")


def _v2_source_review_accepted(q: dict[str, Any], st: dict[str, Any], dep_id: str,
                               *, consumer: dict[str, Any] | None = None) -> bool:
    """Independently attested SOURCE_ACCEPTED, never a merge/release right."""
    dep=_v2_task_map(q).get(dep_id)
    if (not isinstance(dep,dict) or "source_review" not in dep
            or (consumer is not None and consumer.get("effect_ceiling")!="source_only")
            or _v2_history_status(st,dep_id)!="completed"
            or dep.get("status") in {"qa_failed","qa_blocked","blocked"}):
        return False
    pin=dep["source_review"]
    if (not isinstance(pin,dict) or set(pin)!={"candidate_sha","candidate_tree","branch","suite_id"}):
        return False
    proof=read_receipt(receipt_path_for(dep))
    if (not isinstance(proof,dict) or proof.get("project")!="GoBadminton"
            or proof.get("task_id")!=dep_id or proof.get("ok") is not True
            or proof.get("acceptance_state")!="SOURCE_ACCEPTED"
            or proof.get("verdict")!="PASS" or proof.get("blocking_findings")!=[]
            or proof.get("candidate_sha")!=pin["candidate_sha"]
            or proof.get("candidate_tree")!=pin["candidate_tree"]
            or proof.get("blocking_gap_count") not in (None,0)
            or not isinstance(proof.get("trusted_job"),str)):
        return False
    try:
        import test_job_contract
        test_job_contract.verify_runner_receipt(proof,SOURCE_REVIEW_QA_ROOT)
        record=test_job_contract.protected_json(
            SOURCE_REVIEW_QA_ROOT/(proof["trusted_job"]+".json"))
        if (record["job"]["source_tree"]!=pin["candidate_tree"]
                or record["job"]["suite_id"]!=pin["suite_id"]):
            return False
        repo=_v2_evidence_repo()
        if repo is None:
            return False
        backlog_sync.validate_immutable_sources(repo,[dep])
        sha=pin["candidate_sha"]
        if (_v2_git_evidence(["rev-parse",sha+"^{tree}"])!=pin["candidate_tree"]
                or _v2_git_evidence(["merge-base","--is-ancestor",sha,
                                     "refs/remotes/origin/"+pin["branch"]]) is None):
            return False
    except (OSError,ValueError,TypeError,KeyError,AttributeError,
            backlog_sync.SyncBlocked,subprocess.TimeoutExpired):
        return False
    return True


def _v2_source_qa_accepted(q: dict[str, Any], st: dict[str, Any], dep_id: str,
                            *, consumer: dict[str, Any] | None = None) -> bool:
    """Root-protected independent SOURCE_ACCEPTED for a generated unmerged PR.

    Source producer 'completed' alone cannot authorize downstream tasks.
    No source merge or production release is implied by this predicate.
    """
    lookup = _v2_task_map(q)
    qa = lookup.get(dep_id)
    if (not isinstance(qa, dict) or not dep_id.startswith("qa-")
            or (consumer is not None and consumer.get("effect_ceiling") != "source_only")
            or _v2_history_status(st, dep_id) != "completed"
            or qa.get("status") in {"qa_failed", "qa_blocked", "blocked"}):
        return False
    pin = qa.get("source_qa")
    if (not isinstance(pin, dict) or set(pin) != {"producer_task_id", "suite_id"}
            or _v2_dependencies(qa, "depends_on_completed") != [pin["producer_task_id"]]
            or _v2_dependencies(qa, "depends_on_accepted")):
        return False
    producer = lookup.get(pin["producer_task_id"])
    if (not producer or _v2_history_status(st, producer["id"]) != "completed"
            or producer.get("status") in {"qa_failed", "qa_blocked", "blocked"}):
        return False
    own = read_receipt(receipt_path_for(producer))
    proof = read_receipt(receipt_path_for(qa))
    if (not isinstance(own, dict) or not isinstance(proof, dict)
            or proof.get("project") != "GoBadminton"
            or proof.get("task_id") != dep_id or proof.get("ok") is not True
            or proof.get("acceptance_state") != "SOURCE_ACCEPTED"
            or proof.get("verdict") != "PASS"
            or proof.get("blocking_findings") != []
            or proof.get("blocking_gap_count") not in (None, 0)
            or proof.get("producer_task_id") != producer["id"]
            or proof.get("candidate_sha") != own.get("candidate_sha")
            or proof.get("candidate_tree") != own.get("candidate_tree")
            or proof.get("branch") != own.get("branch")
            or not isinstance(proof.get("trusted_job"), str)):
        return False
    try:
        import test_job_contract
        test_job_contract.verify_runner_receipt(proof, SOURCE_REVIEW_QA_ROOT)
        record = test_job_contract.protected_json(
            SOURCE_REVIEW_QA_ROOT / (proof["trusted_job"] + ".json"))
        if (record["job"]["source_tree"] != proof["candidate_tree"]
                or record["job"]["suite_id"] != pin["suite_id"]):
            return False
        # QA-230-01: the original protected job authenticates source/tree/suite,
        # but is NOT reusable authority for another QA, producer or branch.
        # Bind that already-verified cryptographic job digest to an EXACT identity
        # digest in the existing root-owned protected policy. This changes no
        # test_job_contract schema, reviewer approval mechanism or F1 path.
        identity = {
            "schema_version": 1,
            "qa_task_id": dep_id,
            "producer_task_id": producer["id"],
            "candidate_sha": proof["candidate_sha"],
            "candidate_tree": proof["candidate_tree"],
            "branch": proof["branch"],
            "suite_id": pin["suite_id"],
        }
        protected_policy = test_job_contract.protected_json(
            SOURCE_REVIEW_QA_ROOT / "policy.json")
        source_qa_authorizations = protected_policy.get(
            "source_qa_authorizations")
        if (type(source_qa_authorizations) is not dict
                or source_qa_authorizations.get(proof["trusted_job"])
                    != test_job_contract.digest(identity)):
            return False
        repo = _v2_evidence_repo()
        if repo is None:
            return False
        backlog_sync.validate_immutable_sources(repo, [producer, qa])
        candidate = _v2_verified_producer_candidate(qa, producer)
        if candidate != proof["candidate_sha"]:
            return False
    except (OSError, ValueError, TypeError, KeyError, AttributeError,
            backlog_sync.SyncBlocked, subprocess.TimeoutExpired):
        return False
    return True


def _v2_release_handoff_valid(q: dict[str, Any], st: dict[str, Any],
                              task: dict[str, Any], data: dict[str, Any]) -> bool:
    """Verify an exact nonpublic candidate receipt; never invoke a deployer."""
    if task.get("release_handoff") != {"kind": "ci_candidate",
                                       "target": "authorized_release_job"}:
        return False
    qa_ids = _v2_dependencies(task, "depends_on_accepted")
    if len(qa_ids) != 1 or not _v2_source_qa_accepted(q, st, qa_ids[0], consumer=task):
        return False
    qa_proof = read_receipt(receipt_path_for(_v2_task_map(q)[qa_ids[0]]))
    handoff = data.get("handoff")
    if (not isinstance(handoff, dict)
            or set(handoff) != {"state", "accepted_qa_task_id", "candidate_sha",
                               "candidate_tree"}
            or handoff.get("state") != "SOURCE_ONLY_CI_HANDOFF_READY"
            or handoff.get("accepted_qa_task_id") != qa_ids[0]
            or handoff.get("candidate_sha") != qa_proof.get("candidate_sha")
            or handoff.get("candidate_tree") != qa_proof.get("candidate_tree")
            or any(field in data for field in
                   ("deployed", "deployment_status", "release_job_id", "released"))):
        return False
    return True


def _v2_strict_dependency_accepted(q: dict[str, Any], st: dict[str, Any], dep_id: str) -> bool:
    if _v2_history_status(st, dep_id) != "completed":
        return False
    dep = _v2_task_map(q).get(dep_id)
    if not dep:
        return False
    data = read_receipt(receipt_path_for(dep))
    if (not isinstance(data, dict) or data.get("ok") is not True or
            data.get("project") != "GoBadminton" or data.get("task_id") != dep_id
            or data.get("verdict") not in {"PASS", "PASS_WITH_NONBLOCKING_GAPS"}
            or data.get("blocking_findings") != []
            or data.get("blocking_gap_count") not in (None, 0)
            or data.get("merge_recommendation") != "MERGE_RECOMMENDED"):
        return False
    candidate = _v2_candidate_sha(data.get("candidate_sha"))
    if (not candidate or _v2_git_evidence(["merge-base", "--is-ancestor", candidate,
                                          "refs/remotes/origin/main"]) is None):
        return False
    tree = _v2_git_evidence(["rev-parse", candidate + "^{tree}"])
    if tree is None or ("candidate_tree" in data and data["candidate_tree"] != tree):
        return False
    if not _v2_producer_receipt_matches(dep, q, candidate):
        return False
    try:
        repo = _v2_evidence_repo()
        if repo is None:
            return False
        producers = [_v2_task_map(q)[tid] for tid in _v2_dependencies(dep, "depends_on_completed")
                     if not tid.startswith("qa-")]
        backlog_sync.validate_immutable_sources(repo, [dep, *producers])
    except (backlog_sync.SyncBlocked, OSError, subprocess.TimeoutExpired, KeyError):
        return False
    return True


def _v2_legacy_note_dependencies(task: dict[str, Any], key: str) -> list[str]:
    """Recover dependency hints used by the v1 backlog before structured fields existed."""
    notes = str(task.get("notes") or "")
    match = re.search(
        rf"(?:^|[.\s;]){re.escape(key)}\s*=\s*(\[[^\]]*\]|[A-Za-z0-9._:-]+(?:\s*,\s*[A-Za-z0-9._:-]+)*)",
        notes,
    )
    if not match:
        return []
    raw = match.group(1).strip()
    if raw.startswith("["):
        # Historical PM notes use Python/JSON-like string arrays. Extract only
        # conservative task-id tokens; empty [] means no dependency.
        return [
            value for quote_a, value, quote_b in
            re.findall(r"(['\"])([A-Za-z0-9._:-]+)(['\"])", raw)
            if quote_a == quote_b
        ]
    return [
        part.strip().rstrip(".;")
        for part in raw.split(",")
        if part.strip().rstrip(".;")
    ]


def _v2_dependencies(task: dict[str, Any], key: str) -> list[str]:
    explicit = task.get(key)
    values: list[str] = []
    if isinstance(explicit, list):
        values.extend(str(x).strip() for x in explicit if str(x).strip())
    for dep in _v2_legacy_note_dependencies(task, key):
        if dep not in values:
            values.append(dep)
    return values


def dependencies_ready(task: dict[str, Any], q: dict[str, Any], st: dict[str, Any]) -> tuple[bool, str]:
    try:
        backlog_sync.validate_history(st.get("history"))
    except backlog_sync.InvalidRunnerState as exc:
        return False, str(exc)
    is_qa = str(task.get("id") or "").startswith("qa-")
    lookup = _v2_task_map(q)
    completed_deps = _v2_dependencies(task, "depends_on_completed")
    if is_qa and not any(not dep.startswith("qa-") for dep in completed_deps):
        return False, "waiting exact producer dependency for independent QA"
    for dep in completed_deps:
        if _v2_history_status(st, str(dep)) != "completed":
            return False, f"waiting completed dependency {dep}"
        if is_qa and not str(dep).startswith("qa-"):
            producer = lookup.get(str(dep))
            if not producer:
                return False, f"missing producer dependency {dep}"
            if _v2_verified_producer_candidate(task, producer) is None:
                return False, f"waiting exact producer candidate receipt/branch/tree {dep}"
    for dep in _v2_dependencies(task, "depends_on_accepted"):
        if not _v2_dependency_accepted(q, st, str(dep), consumer=task):
            return False, f"waiting accepted dependency {dep}"
    closure = backlog_sync.dependency_closure(task, _v2_task_map(q))
    failed = [dep for dep in closure if _v2_history_status(st, dep) in {'qa_failed', 'qa_blocked'}
              or _v2_task_map(q).get(dep, {}).get('status') in {'qa_failed', 'qa_blocked'}]
    if failed:
        return False, 'waiting terminal QA dependency ' + ','.join(sorted(failed))
    return True, "dependencies ready"


def pending_tasks(q: dict[str, Any], st: dict[str, Any]) -> list[dict[str, Any]]:
    done = completed_ids(st)
    active = set(_v2_active(st))
    tasks = [
        t for t in q["tasks"]
        if t.get("status", "queued") == "queued"
        and t.get("enabled") is True
        and str(t["id"]) not in done
        and str(t["id"]) not in active
        and str(t["id"]) != str((st.get("blocked") or {}).get("id") or "")
    ]
    return sorted(tasks, key=lambda x: float(x.get("order", 10**9)))


def select_runnable_tasks(
    q: dict[str, Any], st: dict[str, Any], cfg: dict[str, Any],
    *, external_writer_busy: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if (external_writer_busy or st.get("paused") or (st.get("blocked") and not lane_local_block(st))
            or st.get("global_gates") or st.get("project_global_blocker")):
        return [], []
    active = active_claims(st)
    capacity = max(0, max_parallel(cfg) - len(active))
    held_locks: list[tuple[str, ...]] = [tuple(c.get("locks") or [RUNNER_V2_GLOBAL_LOCK]) for c in active]
    selected: list[dict[str, Any]] = []
    waits: list[dict[str, str]] = []
    if capacity <= 0:
        return selected, waits
    for task in pending_tasks(q, st):
        if len(selected) >= capacity:
            break
        ready, reason = dependencies_ready(task, q, st)
        if not ready:
            waits.append({"id": str(task["id"]), "reason": reason})
            continue
        gate_ok, gate_reason = task_gate(task, cfg)
        if not gate_ok:
            waits.append({"id": str(task["id"]), "reason": gate_reason})
            continue
        locks = task_locks(task)
        if any(locks_conflict(locks, existing) for existing in held_locks):
            waits.append({"id": str(task["id"]), "reason": f"lock conflict: {','.join(locks)}"})
            continue
        selected.append(task)
        held_locks.append(locks)
    return selected, waits


def queue_eligibility(q: dict[str, Any], st: dict[str, Any], cfg: dict[str, Any]) -> list[dict[str, str]]:
    """Scheduling diagnostics cover all tasks even at full executor capacity."""
    rows = []
    held = [tuple(c.get("locks") or [RUNNER_V2_GLOBAL_LOCK]) for c in active_claims(st)]
    capacity = max_parallel(cfg) - len(held)
    for task in sorted(q.get("tasks", []), key=lambda t: float(t.get("order", 10**9))):
        tid = str(task["id"])
        history = _v2_history_status(st, tid)
        reason = ""
        if tid in _v2_active(st):
            label = "ACTIVE"
        elif history in {"qa_failed", "qa_blocked"} or task.get("status") in {"qa_failed", "qa_blocked"}:
            label, reason = "TERMINAL_QA", "immutable QA FAIL/BLOCKED; successor admission required"
        elif history in {"completed", "blocked", "deferred", "owner_skipped", "superseded_before_launch"} or task.get("status", "queued") != "queued":
            label = "TERMINAL"
        elif task.get("enabled") is not True:
            label, reason = "WAITING_OWNER_RELEASE", "task disabled; exact source/release admission required"
        elif st.get("paused") or (st.get("blocked") and not lane_local_block(st)) or st.get("global_gates") or st.get("project_global_blocker"):
            label, reason = "WAITING_OWNER_RELEASE", "Runner paused or globally blocked"
        else:
            ready, reason = dependencies_ready(task, q, st)
            if not ready:
                label = "WAITING_DEPENDENCY"
            else:
                ready, reason = task_gate(task, cfg)
                if not ready:
                    label = "WAITING_OWNER_RELEASE"
                elif any(locks_conflict(task_locks(task), locks) for locks in held):
                    label, reason = "WAITING_LOCK", "conflict with active lock domain"
                elif capacity <= 0:
                    label, reason = "WAITING_CAPACITY", "executor capacity full; dependencies/gates/locks clear"
                else:
                    label, reason = "READY", "dependencies/gates/locks clear"
        rows.append({"id": tid, "status": label, "reason": reason})
    return rows


def progress_path_for(task_id: str) -> Path:
    return RUNNER_V2_PROGRESS_DIR / f"{_v2_slug(task_id)}.json"


def _v2_refresh_compat_progress(st: dict[str, Any] | None = None) -> None:
    state = st if isinstance(st, dict) else load_state()
    current = state.get("current") or {}
    tid = str(current.get("id") or "")
    if not tid:
        return
    data = load_json(progress_path_for(tid), None)
    if isinstance(data, dict):
        atomic_write_json(PROGRESS_PATH, data)


def initialize_progress(task: dict[str, Any]) -> None:
    blocks = task.get("blocks") or []
    payload = {
        "version": RUNNER_V2_STATE_VERSION,
        "task_id": task["id"],
        "task_title": task.get("scope") or task["id"],
        "status": "running",
        "current_block": blocks[0]["id"] if blocks else None,
        "updated_at": utc_now(),
        "blocks": [
            {
                "id": b["id"],
                "title": b["title"],
                "status": "running" if i == 0 else "pending",
                "note": b.get("note"),
            }
            for i, b in enumerate(blocks)
        ],
    }
    RUNNER_V2_PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_json(progress_path_for(str(task["id"])), payload)
    _v2_refresh_compat_progress()


def block_prompt(task: dict[str, Any]) -> str:
    blocks = task.get("blocks") or []
    if not blocks:
        return ""
    path = progress_path_for(str(task["id"]))
    rows = "\n".join(
        f"- {i+1}/{len(blocks)} {b['id']} · {b['title']}" for i, b in enumerate(blocks)
    )
    return f"""
PM block plan (execute in this order):
{rows}

Task-scoped progress checkpoint file:
{path}

Before starting a block, atomically update that task-scoped progress file:
- set that block status to "running";
- set current_block to its id;
- set task status to "running";
- update updated_at.

After a block is complete, set it to "done" before moving to the next.
If genuinely blocked, set that block and task status to "blocked", add a concise
block.note, write the normal task receipt, and stop. Never write another task's
progress file.
"""


def build_launch_prompt(task: dict[str, Any], source_path: str, receipt_path: Path) -> str:
    executor = str(task.get("executor") or "cursor").lower()
    model = str(task.get("model") or ("auto" if executor == "cursor" else "default"))
    effort = str(task.get("effort") or "default")
    workspace = str(task.get("_workspace") or "")
    effect_binding = ''
    if task.get('effect_ceiling') == 'source_only':
        effect_binding = ('Execution effect ceiling: SOURCE_ONLY. Publish source branch/evidence only; '
            'no main merge, install, live runtime mutation, deployment or Owner/release-gate change. '
            'If the fetched assignment requests broader effects, stop with a lane-local receipt. '
            'Recovery lineage: ' + json.dumps(task.get('recovery_from') or {}) + '\n')
    candidate_binding = ""
    if str(task.get("id") or "").startswith("qa-"):
        q = load_backlog()
        bindings = []
        for dep in _v2_dependencies(task, "depends_on_completed"):
            if dep.startswith("qa-"):
                continue
            producer = _v2_task_map(q).get(dep)
            candidate = _v2_verified_producer_candidate(task, producer) if producer else None
            if candidate is None:
                raise RuntimeError(f"QA exact producer evidence unavailable: {dep}")
            evidence = read_receipt(receipt_path_for(producer))
            bindings.append({"producer": dep, "candidate_sha": candidate,
                             "candidate_tree": evidence["candidate_tree"], "branch": evidence["branch"]})
        if not bindings:
            raise RuntimeError("QA has no own verified producer candidate")
        candidate_binding = "Verified producer candidate binding (base_sha is the planning baseline):\n" + json.dumps(bindings) + "\n"
    return f"""You are one isolated executor in the GoBadminton Runner v2 queue.

Execution binding:
- host: GoBadminton Germany VPS
- executor: {executor}
- requested model: {model}
- requested effort: {effort}
- task workspace: {workspace or '(runner-provided worktree)'}
- conflict locks: {', '.join(task_locks(task))}
- runtime is NON-PROD development only

The runner has already provided an isolated task worktree. Work in the current
workspace; do not create a second task worktree or write another task's workspace.

Read and execute the assignment exactly:
Source path already fetched locally: {source_path}
Canonical source: {task['source']}
Task id: {task['id']}
{effect_binding}{candidate_binding}Scope note: {task.get('scope') or task.get('notes') or '(none)'}
{block_prompt(task)}
Mandatory project context:
- Read AGENTS.md and CURSOR.md.
- Load applicable .cursor/rules and repository governance.
- GitHub/Git history is durable project truth.
- /srv/gobadminton is LIVE RUNTIME MATERIAL and is strictly read-only/out of scope.
- /srv/agent-agency is another project and is strictly out of scope.
- Do not infer authority beyond the exact assignment.
- Do not start the next queued task yourself.
- No PROD/real-user release authority follows from this queue.
- Repair ordinary task-local QA/build failures, but do not widen scope.
- GitHub API/gh may be unavailable. A pushed branch + immutable candidate SHA +
  durable handoff is acceptable transport. Never claim a PR exists unless it does.

Completion receipt is mandatory at:
{receipt_path}
Success minimum:
{{"ok": true, "task_id": "{task['id']}", "project": "GoBadminton", "summary": "<one line>", "result_ref": "<Git branch/commit/handoff or real PR>"}}

Owner/safety hard blocker:
{{"ok": false, "task_id": "{task['id']}", "project": "GoBadminton", "reason": "<exact blocker>", "owner_blocker": true, "blocker_scope": "project_global"}}

A task/lane-local terminal blocker must use owner_blocker=false and blocker_scope="lane_local".
For independent QA include verdict PASS|PASS_WITH_NONBLOCKING_GAPS|FAIL|BLOCKED.
QA FAIL/BLOCKED is terminal for that immutable candidate and must not be retried.
Exit only after the receipt file exists.
"""


def _v2_task_worktree(cfg: dict[str, Any], task: dict[str, Any]) -> Path:
    root = Path(str(cfg.get("worktrees_root") or (Path(str(cfg["workspace"])).parent / "worktrees")))
    return root / f"runner-{_v2_slug(str(task['id']))}"


def prepare_task_worktree(cfg: dict[str, Any], task: dict[str, Any]) -> Path:
    primary = Path(str(cfg["workspace"]))
    path = _v2_task_worktree(cfg, task)
    if (path / ".git").exists() or (path / ".git").is_file():
        return path
    if path.exists() and any(path.iterdir()):
        raise RuntimeError(f"task worktree path exists but is not a git worktree: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    base = str(task.get("base_sha") or "origin/main")
    verify = subprocess.run(
        ["git", "-C", str(primary), "rev-parse", "--verify", f"{base}^{{commit}}"],
        capture_output=True, text=True, timeout=30,
    )
    if verify.returncode != 0:
        ref = str(task.get("base_sha") or "main")
        fetch = subprocess.run(
            ["git", "-C", str(primary), "fetch", "origin", ref],
            capture_output=True, text=True, timeout=120,
        )
        if fetch.returncode != 0:
            raise RuntimeError(f"cannot fetch task base {base}: {fetch.stderr.strip()[:300]}")
    add = subprocess.run(
        ["git", "-C", str(primary), "worktree", "add", "--detach", str(path), base],
        capture_output=True, text=True, timeout=180,
    )
    if add.returncode != 0:
        raise RuntimeError(f"cannot create task worktree {path}: {add.stderr.strip()[:500]}")
    return path


def _v2_log_path(task_id: str, executor: str, stream: str) -> Path:
    path = RUNNER_V2_TASK_LOG_DIR / _v2_slug(task_id)
    path.mkdir(parents=True, exist_ok=True)
    return path / f"{executor}.{stream}.log"


def _v2_stderr_mark(task_id: str, executor: str) -> int:
    path = _v2_log_path(task_id, executor, "stderr")
    try:
        return path.stat().st_size
    except OSError:
        return 0


def _v2_stderr_since(task_id: str, executor: str, offset: int, limit: int = 65536) -> str:
    path = _v2_log_path(task_id, executor, "stderr")
    try:
        with path.open("rb") as fh:
            fh.seek(max(0, offset))
            data = fh.read()
        return data[-limit:].decode("utf-8", errors="replace")
    except OSError:
        return ""


def launch_agent(cfg: dict[str, Any], task: dict[str, Any], prompt: str) -> subprocess.Popen:
    executor = str(task.get("executor") or cfg.get("default_executor") or "cursor").lower()
    model = str(task.get("model") or "").strip()
    effort = str(task.get("effort") or "").strip().lower()
    if executor == "codex" and not model:
        model = str(cfg.get("codex_default_model") or "gpt-6-sol").strip()
    sandbox = str(task.get("sandbox") or "workspace").strip().lower()
    workspace = str(task.get("_workspace") or cfg["workspace"])
    worktrees = str(cfg.get("worktrees_root") or (Path(str(cfg["workspace"])).parent / "worktrees"))
    env = dict(os.environ)
    prefixes = [str(cfg.get("node_bin") or "").strip(), str(cfg.get("local_bin") or "").strip()]
    prefixes = [x for x in prefixes if x]
    if prefixes:
        env["PATH"] = os.pathsep.join(prefixes + [env.get("PATH", "")])

    if executor == "cursor":
        cli = str(cfg.get("cursor_agent") or "") or (shutil.which("agent") or shutil.which("cursor-agent") or "")
        if not cli or not Path(cli).is_file():
            raise RuntimeError("Cursor agent CLI not found")
        cmd = [cli, "--print", "--output-format", "json", "--model", model or "auto"]
        if sandbox == "full":
            cmd += ["--force", "--trust", "--sandbox", "disabled"]
        else:
            mode = str(cfg.get("cursor_workspace_mode") or "auto_review_no_native_sandbox")
            cmd += ["--force", "--trust", "--sandbox", "enabled" if mode == "native_sandbox" else "disabled"]
        cmd += ["--workspace", workspace, "--add-dir", str(ROOT), "--add-dir", worktrees, prompt]
    elif executor == "codex":
        cli = str(cfg.get("codex_cli") or "") or (shutil.which("codex") or "")
        if not cli or not Path(cli).is_file():
            raise RuntimeError("Codex CLI not found")
        cmd = [cli, "exec", "--color", "never", "-C", workspace]
        if sandbox == "full":
            cmd += ["--dangerously-bypass-approvals-and-sandbox"]
        else:
            cmd += ["--approve-for-me", "--add-dir", str(ROOT), "--add-dir", worktrees]
        if model:
            cmd += ["--model", model]
        if effort in {"low", "medium", "high", "xhigh", "extra_high"}:
            cmd += ["-c", f'model_reasoning_effort="{"xhigh" if effort == "extra_high" else effort}"']
        cmd += [prompt]
    else:
        raise RuntimeError(f"unsupported executor: {executor}")

    tid = str(task["id"])
    log(f"launch executor={executor} model={model or 'default'} sandbox={sandbox} workspace={workspace!r} task={tid}")
    return subprocess.Popen(
        cmd, cwd=workspace, env=env, stdin=subprocess.DEVNULL,
        stdout=_v2_log_path(tid, executor, "stdout").open("a", encoding="utf-8"),
        stderr=_v2_log_path(tid, executor, "stderr").open("a", encoding="utf-8"),
        start_new_session=True,
    )


def managed_pm_planner(proc: Any, cfg: dict[str, Any]) -> bool:
    """Recognize only managed PM planner processes and their helper descendants."""
    dev = Path(str(cfg.get("dev_root") or Path(str(cfg["workspace"])).parent)).resolve()
    planning = dev / "worktrees/pm-autopilot"
    try:
        if Path(proc.cwd()).resolve() != planning:
            return False
        lineage = [proc, *proc.parents()]
        bound = False
        for member in lineage:
            args = [str(x) for x in member.cmdline()]
            text = " ".join(args).replace("\\", "/").lower()
            if not ("codex exec" in text or "cursor-agent" in text or "/agent --print" in text):
                continue
            targets: list[str] = []
            for index, arg in enumerate(args):
                if arg in {"-C", "--cd", "--workspace"} and index + 1 < len(args):
                    targets.append(args[index + 1])
                elif arg.startswith(("--cd=", "--workspace=")):
                    targets.append(arg.split("=", 1)[1])
            if targets and all(Path(target).resolve() == planning for target in targets):
                bound = True
                break
        if not bound:
            return False
        for parent in proc.parents():
            args = [str(x) for x in parent.cmdline()]
            if str(dev / "runner/autopilot.py") not in args:
                continue
            cgroup = Path(f"/proc/{parent.pid}/cgroup").read_text()
            if any(
                line.split(":", 2)[-1].rstrip("/") == "/system.slice/gobadminton-autopilot.service"
                for line in cgroup.splitlines()
            ):
                return True
    except (psutil.Error, OSError, ValueError):
        return False
    return False


def _v2_runner_owned_process(proc: Any, active_pids: set[int]) -> bool:
    try:
        if int(proc.info["pid"]) in active_pids:
            return True
        for parent in proc.parents():
            raw_pid = getattr(parent, "pid", None)
            if raw_pid is None and hasattr(parent, "info"):
                raw_pid = parent.info.get("pid")
            if raw_pid is not None and int(raw_pid) in active_pids:
                return True
        return False
    except (psutil.Error, OSError, ValueError, KeyError, AttributeError):
        return False


def isolated_readonly_qa(proc: Any, cfg: dict[str, Any]) -> bool:
    """Only operator-proven isolated QA identities escape the writer hold."""
    try:
        cwd = Path(proc.cwd()).resolve()
        uid = proc.uids().real
        args = [str(x) for x in proc.cmdline()]
        targets = _workspace_args(args)
        readonly = any(args[i:i+2] == ["--sandbox", "read-only"] for i in range(len(args)-1)) or "--sandbox=read-only" in args
        if not readonly or not targets or any(Path(x).resolve() != cwd for x in targets):
            return False
        workspace = Path(str(cfg["workspace"])).resolve()
        for entry in cfg.get("isolated_readonly_qa", []):
            if (entry.get("uid") == uid and Path(entry["workspace"]).resolve() == cwd
                    and entry.get("separate_git") is True and entry.get("db_access") is False
                    and cwd != workspace and cwd not in workspace.parents and workspace not in cwd.parents):
                return True
    except (psutil.Error, OSError, ValueError, KeyError, TypeError, AttributeError):
        pass
    return False


def _trusted_git_remote_hostname(host: str) -> str:
    """Resolve only explicitly provisioned Git SSH aliases, else HOLD.

    An arbitrary SSH Host alias can point at the same GitHub repository as
    an HTTPS remote. Never call an unknown alias an independent writer.
    This is a limited host normalization for conflict detection, not Git auth.
    """
    normalized = str(host).lower().strip()
    if normalized in {
        "github.com", "github-gobadminton-clean",
        "github-gobadminton", "github-gobadminton-readonly",
    }:
        return "github.com"
    if normalized in {"gitlab.com", "bitbucket.org"}:
        return normalized
    raise ValueError("unverified Git remote host or SSH alias")


def verified_disjoint_codex(proc: Any, cfg: dict[str, Any]) -> bool:
    """Exclude only an introspectable Codex CLI in a distinct real Git domain."""
    try:
        args = [str(x) for x in proc.cmdline()]
        if args != [str(x) for x in (proc.info.get("cmdline") or [])]:
            return False
        if not args or Path(args[0]).name != "codex" or "exec" not in args:
            return False
        if type(proc.uids().real) is not int or proc.uids().real < 0:
            return False
        cwd = Path(proc.cwd()).resolve(strict=True)
        workspace = Path(str(cfg["workspace"])).resolve(strict=True)
        dev = Path(str(cfg.get("dev_root") or workspace.parent)).resolve(strict=True)
        targets = _workspace_args(args)
        if not targets or any(Path(x).resolve(strict=True) != cwd for x in targets):
            return False
        if any(cwd == root or cwd in root.parents or root in cwd.parents
               for root in (workspace, dev)):
            return False
        # Other CLI paths/DB targets cannot establish an unrelated domain.
        if any(str(root) in arg for root in (workspace, dev) for arg in args):
            return False
        if any(token in " ".join(args).lower() for token in
               ("postgres", "database", "db_access", "database_url", "--add-dir", "--dangerously", "--yolo")):
            return False
        def git_domain(path):
            result = subprocess.run(["git", "-C", str(path), "rev-parse", "--git-common-dir"],
                                    capture_output=True, text=True, timeout=5,
                                    env={k: v for k, v in os.environ.items() if not k.startswith("GIT_")})
            if result.returncode or not result.stdout.strip():
                raise ValueError("unverified Git domain")
            return (path / result.stdout.strip()).resolve(strict=True)
        # Git checkout directories can differ while their *write target*
        # is the same remote. Both fetch and push identities count: treating
        # same origin as unrelated would enable competing remote writers.
        def git_remotes(path):
            """Enumerate EVERY configured fetch/push remote URL, not just origin.

            Git supports several push URLs on a single remote. Ignoring the
            second one would classify two independently initialized local
            repositories as disjoint even while publishing to the same branch.
            No network access or secret logging occurs.
            """
            env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
            listed = subprocess.run(
                ["git", "-C", str(path), "remote"], capture_output=True,
                text=True, timeout=5, env=env)
            if listed.returncode:
                raise ValueError("unverifiable configured Git remotes")
            identities = set()
            from urllib.parse import urlsplit
            for remote in listed.stdout.splitlines():
                if not remote or any(x.isspace() for x in remote):
                    raise ValueError("ambiguous remote name")
                for options in (["remote", "get-url", "--all", remote],
                                ["remote", "get-url", "--push", "--all", remote]):
                    result = subprocess.run(
                        ["git", "-C", str(path), *options],
                        capture_output=True, text=True, timeout=5, env=env)
                    if result.returncode or not result.stdout.strip():
                        raise ValueError("unverifiable configured remote URLs")
                    for value in result.stdout.splitlines():
                        value = value.strip()
                        if not value:
                            raise ValueError("empty configured remote URL")
                        if "://" in value:
                            parsed = urlsplit(value)
                            # A valid hostname is not evidence that a transport
                            # is understood. Unknown helper/protocol is an
                            # opaque potential writer and must remain HOLD.
                            if parsed.scheme.lower() not in {"https", "ssh", "file"}:
                                raise ValueError("unapproved Git remote scheme")
                            if parsed.password or parsed.query or parsed.fragment:
                                raise ValueError("opaque remote URL credential/query")
                            if parsed.scheme == "file":
                                if not parsed.path:
                                    raise ValueError("empty local Git remote path")
                                identity = "file/" + str(Path(parsed.path).resolve())
                            else:
                                if not parsed.hostname or not parsed.path:
                                    raise ValueError("ambiguous Git remote URL")
                                identity = _trusted_git_remote_hostname(parsed.hostname) + "/" + parsed.path.lstrip("/")
                        elif "@" in value and ":" in value.split("@", 1)[-1]:
                            host_path = value.split("@", 1)[-1]
                            host, remote_path = host_path.split(":", 1)
                            identity = _trusted_git_remote_hostname(host) + "/" + remote_path.lstrip("/")
                        elif value.startswith(("/", "./", "../")):
                            identity = "file/" + str((path / value).resolve())
                        else:
                            raise ValueError("unclassified Git remote URL")
                        identities.add(identity.rstrip("/").removesuffix(".git").lower())
            return identities
        if git_domain(cwd) == git_domain(workspace):
            return False
        if git_remotes(cwd) & git_remotes(workspace):
            return False
        return True
    except (psutil.Error, OSError, ValueError, KeyError, TypeError, AttributeError,
            subprocess.SubprocessError):
        return False


def external_cursor_agent_busy(
    cfg: dict[str, Any],
    state_agent_pid: int | None = None,
    active_pids: set[int] | None = None,
) -> tuple[bool, str]:
    workspace = Path(str(cfg["workspace"])).resolve()
    dev_root = Path(str(cfg.get("dev_root") or workspace.parent)).resolve()
    owned = set(active_pids or set())
    if state_agent_pid:
        owned.add(int(state_agent_pid))
    runner_pid = os.getpid()
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            pid = int(proc.info["pid"])
            if pid == runner_pid or _v2_runner_owned_process(proc, owned):
                continue
            cmdline = [str(x) for x in (proc.info.get("cmdline") or [])]
            text = " ".join(cmdline).replace("\\", "/").lower()
            name = str(proc.info.get("name") or "").lower()
            if " worker-server" in text or "typescript-language-server" in text:
                continue
            # QA Q88-B1: when process cmdline is inaccessible, a known Codex/
            # Cursor host must NOT silently disappear from the external-writer
            # inventory. Scope by cwd if readable; otherwise fail closed.
            is_cursor = ("cursor-agent" in text or "/agent --print" in text
                         or "cursor-agent" in name)
            is_codex = ("codex exec" in text or "@openai/codex" in text
                        or "codex-code-mode-host" in text
                        or "codex-code-mode-host" in name or name == "codex")
            if not (is_cursor or is_codex):
                continue
            try:
                cwd = Path(proc.cwd()).resolve()
            except (psutil.AccessDenied, psutil.NoSuchProcess, FileNotFoundError):
                cwd = None
            scoped = bool(cwd and (cwd == dev_root or dev_root in cwd.parents))
            scoped_elsewhere = bool(cwd and not scoped)
            if not scoped:
                targets: list[str] = []
                for index, raw in enumerate(cmdline):
                    if raw in {"-C", "--cd", "--workspace"} and index + 1 < len(cmdline):
                        targets.append(cmdline[index + 1])
                    elif raw.startswith(("--cd=", "--workspace=")):
                        targets.append(raw.split("=", 1)[1])
                for target in targets:
                    try:
                        resolved = Path(target).resolve()
                    except (OSError, ValueError):
                        continue
                    if resolved == dev_root or dev_root in resolved.parents:
                        scoped = True
                        break
                    scoped_elsewhere = True
            if isolated_readonly_qa(proc, cfg):
                continue
            if is_codex and verified_disjoint_codex(proc, cfg):
                continue
            if scoped and managed_pm_planner(proc, cfg):
                continue
            if not scoped and not scoped_elsewhere:
                return True, (
                    f"ambiguous external {'Cursor' if is_cursor else 'Codex'} "
                    f"pid {pid}: agent process cannot be scoped; fail closed"
                )
            if scoped or scoped_elsewhere:
                return True, f"unproven external {'Cursor' if is_cursor else 'Codex'} pid {pid} scoped to {dev_root}"
        except psutil.NoSuchProcess:
            continue
        except (psutil.AccessDenied, ValueError):
            return True, "external agent inventory identity unavailable; HOLD"
    return False, "no external GoBadminton Cursor/Codex writer"


def writer_busy(
    cfg: dict[str, Any], st: dict[str, Any], *, include_owned_active: bool = True
) -> tuple[bool, str]:
    active = active_claims(st)
    active_pids = {
        int(c["agent_pid"]) for c in active
        if c.get("agent_pid") and pid_alive(int(c["agent_pid"]))
    }
    # Backward compatibility for callers/tests holding a v1-shaped in-memory
    # state that has not passed through load_state migration yet.
    legacy_cur = st.get("current") if isinstance(st, dict) else None
    if include_owned_active and isinstance(legacy_cur, dict):
        legacy_pid = legacy_cur.get("agent_pid")
        if legacy_pid and pid_alive(int(legacy_pid)):
            active_pids.add(int(legacy_pid))
    if include_owned_active and active_pids:
        return True, f"{len(active_pids)} queue executor(s) active"
    return external_cursor_agent_busy(cfg, None, active_pids)


def _v2_update_active(task_id: str, updates: dict[str, Any]) -> None:
    def mutate(st):
        active = _v2_active(st)
        if task_id not in active:
            return
        claim = dict(active[task_id])
        claim.update(updates)
        active[task_id] = claim
        st["active"] = active
    state = _v2_mutate_state(mutate)
    _v2_refresh_compat_progress(state)


def claim_task(task: dict[str, Any]) -> dict[str, Any]:
    # History is validated before any network or state mutation. No normalization
    # by load_state may turn corrupt terminal evidence into permission to claim.
    try:
        preflight_state = backlog_sync.read_runner_state(STATE_PATH)
    except backlog_sync.InvalidRunnerState as exc:
        # Invalid state is a hard HOLD regardless of diagnostics. A losing
        # claimant must not overwrite the shared sync diagnostic while the
        # Publisher or another claimant owns the authoritative writer lease.
        try:
            with writer_bridge.bridge_section():
                backlog_sync.atomic_write(BACKLOG_PATH.parent / "backlog-sync-diagnostic.json",
                    (json.dumps({"status": "BLOCKED", "reason": str(exc), "changed": False,
                                 "checked_at": utc_now()}) + "\n").encode())
        except writer_bridge.BridgeHold:
            pass  # Preserve old evidence and re-raise the invalid-state HOLD.
        raise
    cfg = load_json(BACKLOG_PATH.parent / "config.json", {}) or {}
    gate_ok, gate_reason = task_gate(task, cfg)
    if not gate_ok:
        raise RuntimeError(gate_reason)
    publication_proofs = {}
    if str(task["id"]).startswith("qa-"):
        cfg = load_json(BACKLOG_PATH.parent / "config.json", {})
        publication_proofs = refresh_qa_candidate_refs(load_backlog(), preflight_state, cfg, qa_tasks=[task])
    tid = str(task["id"])
    result: dict[str, Any] = {}
    def mutate(st):
        nonlocal result
        if st.get("paused"):
            raise RuntimeError("paused")
        if (st.get("blocked") and not lane_local_block(st)) or st.get("global_gates") or st.get("project_global_blocker"):
            raise RuntimeError("project-global blocked")
        if tid in completed_ids(st):
            raise RuntimeError("already terminal")
        busy, reason = writer_busy(cfg, st, include_owned_active=False)
        if busy:
            raise RuntimeError(reason)
        active = _v2_active(st)
        if tid in active:
            raise RuntimeError(f"already active {tid}")
        # This callback executes inside the shared claim/sync critical section.
        # Selection is advisory: concurrent/direct claims must recheck capacity.
        current_cfg = load_json(BACKLOG_PATH.parent / "config.json", {})
        if not isinstance(current_cfg, dict):
            raise RuntimeError("invalid claim capacity configuration")
        if len(active) >= max_parallel(current_cfg):
            raise RuntimeError("execution capacity exhausted; reselect next tick")
        locks = task_locks(task)
        for other in active.values():
            if locks_conflict(locks, tuple(other.get("locks") or [RUNNER_V2_GLOBAL_LOCK])):
                raise RuntimeError(f"lock conflict with {other.get('id')}")
        claim = {
            "id": tid,
            "source": task["source"],
            "status": "running",
            "claimed_at": utc_now(),
            "agent_pid": None,
            "receipt": str(receipt_path_for(task)),
            "locks": list(locks),
        }
        active[tid] = claim
        st["active"] = active
        st["gate_wait"] = None
        st["runner_pid"] = os.getpid()
        result = _copy.deepcopy(claim)
    with backlog_sync.claim_sync_section(BACKLOG_PATH.parent):
        # Byte parity alone is not claim authority. Installation must first
        # establish the reconciler's verified trust anchor; a BLOCKED/corrupt
        # reconciliation stops new claims while existing workers keep running.
        root = BACKLOG_PATH.parent
        reservation_path = root / 'source-merge-reservation.json'
        if reservation_path.exists():
            reservation = json.loads(reservation_path.read_text())
            if not isinstance(reservation, dict) or reservation.get('status') == 'RESERVED':
                raise RuntimeError('serialized source publication pending verification')
        meta = backlog_sync.read_metadata(root / "backlog-sync-state.json")
        trusted = backlog_sync.read_metadata(root / "backlog-sync-trust.json")
        if (meta["status"] not in {"SYNCED", "IN_SYNC"}
                or meta["canonical_commit"] != trusted["canonical_commit"]
                or meta["canonical_blob"] != trusted["canonical_blob"]
                or backlog_sync.git_blob_sha(BACKLOG_PATH.read_bytes()) != meta["canonical_blob"]):
            raise RuntimeError("canonical backlog trust/parity is not safe to claim")
        # Selection can precede a sync; never execute a stale selected definition.
        current = _v2_task_map(load_backlog()).get(tid)
        if current != task:
            raise RuntimeError("selected task definition changed; reselect next tick")
        if current.get("enabled") is not True or current.get("status", "queued") != "queued":
            raise RuntimeError("task is not enabled queued")
        repo = _v2_evidence_repo()
        if repo is None:
            raise RuntimeError("source verification repository unavailable")
        backlog_sync.validate_immutable_sources(repo, [current])
        if current.get("recovery_from"):
            import queue_recovery
            try:
                ledger = json.loads((root / "qa-recovery-ledger.json").read_text())
                entry = ledger["actions"][current["recovery_from"]["key"]]
                if (entry["status"] not in {"ADMITTED", "RUNNING"} or tid not in entry["task_ids"]
                        or current["recovery_from"]["attempt"] != entry["attempt"]
                        or current["recovery_from"]["slice_id"] != entry["evidence"]["slice_id"]):
                    raise RuntimeError("source recovery publication/admission not verified")
                published = json.loads(backlog_sync.run_git(repo, ['show',
                    entry['publication_commit'] + ':' + backlog_sync.CANONICAL_PATH]))
                queue_recovery.validate_pair(entry, entry['baseline'], published,
                    {'task_ids': entry['task_ids']}, {'history': []})
                if _v2_task_map(published).get(tid) != current:
                    raise RuntimeError('source recovery claim definition differs from verified publication')
            except (OSError, ValueError, KeyError, TypeError, queue_recovery.RecoveryHold) as exc:
                raise RuntimeError("source recovery admission ledger unavailable") from exc
        backlog_sync.read_active(STATE_PATH)
        if tid.startswith("qa-"):
            lookup = _v2_task_map(load_backlog())
            for dep in _v2_dependencies(current, "depends_on_completed"):
                if dep.startswith("qa-"):
                    continue
                proof = publication_proofs.get(dep)
                producer = lookup.get(dep)
                if (not proof or not proof["head"] or not producer
                        or read_receipt(receipt_path_for(producer)) != proof["receipt"]
                        or _v2_verified_producer_candidate(current, producer,
                            publication_head=proof["head"]) is None):
                    reason = proof["reason"] if proof else "fresh producer publication unavailable"
                    raise RuntimeError(f"waiting fresh producer publication {dep}: {reason}")
        with _V2_STATE_LOCK:
            ready, reason = dependencies_ready(current, load_backlog(), load_state())
            if not ready:
                raise RuntimeError(reason)
            _v2_mutate_state(mutate)
    return result


def attempt_count(task_id: str) -> int:
    st = load_state()
    return int((st.get("attempts") or {}).get(task_id, 0) or 0)


def bump_attempt(task_id: str) -> int:
    result = 0
    def mutate(st):
        nonlocal result
        attempts = dict(st.get("attempts") or {})
        result = int(attempts.get(task_id, 0) or 0) + 1
        attempts[task_id] = result
        st["attempts"] = attempts
        active = _v2_active(st)
        if task_id in active:
            claim = dict(active[task_id])
            claim["attempt"] = result
            active[task_id] = claim
            st["active"] = active
    _v2_mutate_state(mutate)
    return result


def _v2_finish_progress(task_id: str, status: str, note: str | None = None) -> None:
    path = progress_path_for(task_id)
    progress = load_json(path, {}) or {}
    if isinstance(progress, dict) and progress.get("task_id") == task_id:
        for item in progress.get("blocks") or []:
            if isinstance(item, dict) and item.get("status") == "running":
                item["status"] = "blocked" if status in {"blocked", "qa_failed", "qa_blocked"} else "done"
                if note and item["status"] == "blocked":
                    item["note"] = note
        progress["status"] = status
        progress["current_block"] = None
        progress["updated_at"] = utc_now()
        atomic_write_json(path, progress)


def _v2_remove_active(st: dict[str, Any], task_id: str) -> None:
    active = _v2_active(st)
    active.pop(task_id, None)
    st["active"] = active


def mark_completed(task_id: str, summary: str) -> None:
    _v2_finish_progress(task_id, "done")
    def mutate(st):
        st["history"] = list(st.get("history") or []) + [
            {"id": task_id, "status": "completed", "summary": summary, "at": utc_now()}
        ]
        attempts = dict(st.get("attempts") or {})
        attempts.pop(task_id, None)
        st["attempts"] = attempts
        _v2_remove_active(st, task_id)
        blocked_tasks = dict(st.get("blocked_tasks") or {})
        blocked_tasks.pop(task_id, None)
        st["blocked_tasks"] = blocked_tasks
        st["gate_wait"] = None
    state = _v2_mutate_state(mutate)
    _v2_refresh_compat_progress(state)
    wake_autopilot("task_completed", task_id, summary)
    log(f"COMPLETED {task_id}: {summary}")


def mark_qa_terminal(task_id: str, verdict: str, reason: str) -> None:
    normalized = "qa_failed" if verdict.upper() == "FAIL" else "qa_blocked"
    _v2_finish_progress(task_id, normalized, reason)
    def mutate(st):
        st["history"] = list(st.get("history") or []) + [{
            "id": task_id, "status": normalized, "verdict": verdict.upper(),
            "reason": reason, "at": utc_now(),
        }]
        _v2_remove_active(st, task_id)
        blocked_tasks = dict(st.get("blocked_tasks") or {})
        blocked_tasks[task_id] = {
            "id": task_id, "status": normalized, "reason": reason,
            "blocker_scope": "lane_local", "at": utc_now(),
        }
        st["blocked_tasks"] = blocked_tasks
        st["gate_wait"] = None
    state = _v2_mutate_state(mutate)
    _v2_refresh_compat_progress(state)
    wake_autopilot("qa_terminal", task_id, reason)
    log(f"QA TERMINAL {task_id} verdict={verdict.upper()}: {reason}")


def mark_blocked(
    task_id: str, reason: str, *, blocker_scope: str = "lane_local",
    owner_blocker: bool = False,
) -> None:
    _v2_finish_progress(task_id, "blocked", reason)
    def mutate(st):
        record = {
            "id": task_id, "status": "blocked", "reason": reason,
            "blocker_scope": blocker_scope, "owner_blocker": owner_blocker, "at": utc_now(),
        }
        st["history"] = list(st.get("history") or []) + [record]
        _v2_remove_active(st, task_id)
        blocked_tasks = dict(st.get("blocked_tasks") or {})
        blocked_tasks[task_id] = record
        st["blocked_tasks"] = blocked_tasks
        if owner_blocker or blocker_scope == "project_global":
            st["blocked"] = {
                "id": task_id, "reason": reason, "at": record["at"],
                "blocker_scope": "project_global", "owner_blocker": owner_blocker,
            }
        st["gate_wait"] = None
    state = _v2_mutate_state(mutate)
    _v2_refresh_compat_progress(state)
    wake_autopilot("task_blocked", task_id, reason)
    log(f"BLOCKED {task_id}: {reason}")


def _v2_release_active_for_retry(task_id: str, reason: str) -> None:
    def mutate(st):
        _v2_remove_active(st, task_id)
        st["gate_wait"] = None
    _v2_mutate_state(mutate)
    log(f"retry eligible {task_id}: {reason}")


def _v2_run_process(
    cfg: dict[str, Any], task: dict[str, Any], prompt: str, attempt: int,
    claim: dict[str, Any], *, failover_from: str | None = None,
) -> tuple[subprocess.Popen, str]:
    executor = str(task.get("executor") or cfg.get("default_executor") or "cursor").lower()
    proc = launch_agent(cfg, task, prompt)
    updates = {
        "agent_pid": proc.pid, "started_at": utc_now(), "attempt": attempt,
        "max_attempts": max(1, min(5, int(cfg.get("max_repair_attempts") or 5))),
        "receipt": str(receipt_path_for(task)), "executor": executor,
        "worktree": str(task.get("_workspace") or ""),
    }
    if failover_from:
        updates["failover_from"] = failover_from
    _v2_update_active(str(task["id"]), updates)
    log(f"agent started pid={proc.pid} task={task['id']} attempt={attempt} executor={executor}")
    return proc, executor


def run_claimed(cfg: dict[str, Any], task: dict[str, Any], claim: dict[str, Any]) -> None:
    tid = str(task["id"])
    max_attempts = max(1, min(5, int(cfg.get("max_repair_attempts") or 5)))
    poll = float(cfg.get("poll_seconds") or 15)
    RECEIPTS_DIR.mkdir(parents=True, exist_ok=True)
    rpath = receipt_path_for(task)
    try:
        worktree = prepare_task_worktree(cfg, task)
        source_path = resolve_source(str(task["source"]), Path(str(cfg["workspace"])))
    except Exception as exc:
        n = bump_attempt(tid)
        reason = f"task preparation failed: {exc}"
        if n >= max_attempts:
            mark_blocked(tid, f"repair limit reached ({n}/{max_attempts}): {reason}")
        else:
            _v2_release_active_for_retry(tid, reason)
        return

    runtime_task = dict(task)
    runtime_task["_workspace"] = str(worktree)
    _v2_update_active(tid, {"worktree": str(worktree)})
    initialize_progress(runtime_task)
    original_executor = str(task.get("executor") or cfg.get("default_executor") or "cursor").lower()
    use_codex_failover = False

    while True:
        existing = attempt_count(tid)
        if existing >= max_attempts:
            mark_blocked(tid, f"repair limit reached ({existing}/{max_attempts})")
            return
        if rpath.exists():
            rpath.unlink()
        attempt = bump_attempt(tid)
        active_task = codex_failover_task(cfg, runtime_task) if use_codex_failover else runtime_task
        active_task["_workspace"] = str(worktree)
        active_executor = str(active_task.get("executor") or cfg.get("default_executor") or "cursor").lower()
        prompt = build_launch_prompt(active_task, source_path, rpath)
        if attempt > 1:
            prompt += f"\nThis is bounded repair retry {attempt}/{max_attempts}. Inspect prior evidence and fix the same task only.\n"
        if use_codex_failover:
            prompt += "\nINFRASTRUCTURE FAILOVER: continue the same task/attempt through Codex; do not widen scope.\n"

        stderr_mark = _v2_stderr_mark(tid, active_executor)
        try:
            proc, active_executor = _v2_run_process(
                cfg, active_task, prompt, attempt, claim,
                failover_from="cursor" if use_codex_failover and original_executor == "cursor" else None,
            )
        except Exception as exc:
            if active_executor == "cursor" and cursor_failover_enabled(cfg, task):
                fail_reason = cursor_infra_failover_reason(
                    returncode=None, receipt_ok=False, receipt_reason="",
                    stderr_delta=_v2_stderr_since(tid, "cursor", stderr_mark),
                    launch_error=str(exc),
                )
                if fail_reason:
                    use_codex_failover = True
                    fallback = codex_failover_task(cfg, runtime_task)
                    fallback["_workspace"] = str(worktree)
                    fallback_prompt = build_launch_prompt(fallback, source_path, rpath)
                    fallback_prompt += f"\nINFRASTRUCTURE FAILOVER from Cursor: {fail_reason}. Continue same task/attempt.\n"
                    try:
                        proc, active_executor = _v2_run_process(
                            cfg, fallback, fallback_prompt, attempt, claim, failover_from="cursor"
                        )
                    except Exception as fexc:
                        reason = f"Codex failover launch failed: {fexc}"
                        if attempt >= max_attempts:
                            mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                            return
                        log(f"repairable failure {tid} attempt={attempt}: {reason}")
                        time.sleep(poll)
                        continue
                else:
                    reason = f"Cursor launch failed: {exc}"
                    if attempt >= max_attempts:
                        mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                        return
                    time.sleep(poll)
                    continue
            else:
                reason = f"{active_executor} launch failed: {exc}"
                if attempt >= max_attempts:
                    mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                    return
                time.sleep(poll)
                continue

        proc.wait()
        cleanup_executor_process_group(proc.pid)
        log(f"agent exited code={proc.returncode} task={tid} executor={active_executor}")
        ok, reason = validate_receipt(rpath, tid)
        data = read_receipt(rpath) or {}

        if active_executor == "cursor" and cursor_failover_enabled(cfg, task) and not ok:
            fail_reason = cursor_infra_failover_reason(
                returncode=proc.returncode, receipt_ok=False, receipt_reason=reason,
                stderr_delta=_v2_stderr_since(tid, "cursor", stderr_mark),
            )
            if fail_reason:
                use_codex_failover = True
                if rpath.exists():
                    rpath.unlink()
                fallback = codex_failover_task(cfg, runtime_task)
                fallback["_workspace"] = str(worktree)
                fallback_prompt = build_launch_prompt(fallback, source_path, rpath)
                fallback_prompt += f"\nINFRASTRUCTURE FAILOVER from Cursor: {fail_reason}. Continue same task/attempt.\n"
                try:
                    proc, _ = _v2_run_process(
                        cfg, fallback, fallback_prompt, attempt, claim, failover_from="cursor"
                    )
                    proc.wait()
                    cleanup_executor_process_group(proc.pid)
                except Exception as exc:
                    reason = f"Codex failover launch failed: {exc}"
                    if attempt >= max_attempts:
                        mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
                        return
                    time.sleep(poll)
                    continue
                ok, reason = validate_receipt(rpath, tid)
                data = read_receipt(rpath) or {}

        if tid.startswith("qa-") or "source_review" in task:
            verdict = str(data.get("verdict") or "").upper()
            lower_reason = reason.lower()
            missing_candidate = any(
                phrase in lower_reason for phrase in (
                    "no new immutable", "new immutable producer candidate", "missing immutable candidate"
                )
            )
            if verdict in {"FAIL", "BLOCKED"} or missing_candidate:
                mark_qa_terminal(tid, verdict or "BLOCKED", reason)
                return
        if ok:
            if any(key in task for key in ("source_review", "source_qa", "release_handoff")):
                # Executor-produced receipts are untrusted until a distinct
                # root-authorized independent QA job proves the exact result.
                trial = dict(load_state())
                trial["history"] = [*(trial.get("history") or []),
                                    {"id": tid, "status": "completed"}]
                queue = load_backlog()
                approved = (_v2_source_review_accepted(queue, trial, tid)
                            if "source_review" in task else
                            _v2_source_qa_accepted(queue, trial, tid)
                            if "source_qa" in task else
                            _v2_release_handoff_valid(queue, trial, task, data))
                if not approved:
                    mark_blocked(tid, "missing trusted source QA or exact CI handoff",
                                 blocker_scope="lane_local")
                    return
                if "release_handoff" in task:
                    mark_completed(tid, "source-only CI handoff prepared; no release-job executed")
                    return
            mark_completed(tid, reason)
            return
        if data.get("owner_blocker") is True:
            mark_blocked(tid, f"Owner/safety blocker: {reason}", blocker_scope="project_global", owner_blocker=True)
            return
        if data.get("blocker_scope") == "project_global":
            mark_blocked(tid, reason, blocker_scope="project_global")
            return
        if data.get("blocker_scope") == "lane_local":
            mark_blocked(tid, reason, blocker_scope="lane_local")
            return
        if attempt >= max_attempts:
            mark_blocked(tid, f"repair limit reached ({attempt}/{max_attempts}): {reason}")
            return
        log(f"repairable failure {tid} attempt={attempt}: {reason}")
        time.sleep(poll)


def _v2_worker_entry(cfg: dict[str, Any], task: dict[str, Any], claim: dict[str, Any]) -> None:
    tid = str(task["id"])
    try:
        run_claimed(cfg, task, claim)
    except Exception as exc:
        reason = f"runner worker exception: {type(exc).__name__}: {exc}"
        n = attempt_count(tid)
        if n >= max(1, min(5, int(cfg.get("max_repair_attempts") or 5))):
            mark_blocked(tid, reason)
        else:
            _v2_release_active_for_retry(tid, reason)
        log(reason)
    finally:
        _V2_WORKERS.pop(tid, None)


def _v2_start_worker(cfg: dict[str, Any], task: dict[str, Any], claim: dict[str, Any]) -> None:
    tid = str(task["id"])
    thread = _threading.Thread(
        target=_v2_worker_entry, args=(cfg, _copy.deepcopy(task), _copy.deepcopy(claim)),
        name=f"gb-runner-{_v2_slug(tid)}", daemon=True,
    )
    _V2_WORKERS[tid] = thread
    thread.start()


def _v2_finalize_or_requeue_recovered(cfg: dict[str, Any], claim: dict[str, Any]) -> None:
    tid = str(claim.get("id") or "")
    if not tid:
        return
    pid = claim.get("agent_pid")
    if pid and pid_alive(int(pid)):
        return
    rpath = Path(str(claim.get("receipt") or RECEIPTS_DIR / f"{tid}.json"))
    ok, reason = validate_receipt(rpath, tid)
    data = read_receipt(rpath) or {}
    if tid.startswith("qa-") and str(data.get("verdict") or "").upper() in {"FAIL", "BLOCKED"}:
        mark_qa_terminal(tid, str(data.get("verdict") or "BLOCKED"), reason)
        return
    if ok:
        task = _v2_task_map(load_backlog()).get(tid)
        if task is None:
            mark_blocked(tid, "recovered task is absent from canonical backlog")
            return
        if any(key in task for key in ("source_review", "source_qa", "release_handoff")):
            trial = dict(load_state())
            trial["history"] = [*(trial.get("history") or []),
                                {"id": tid, "status": "completed"}]
            queue = load_backlog()
            approved = (_v2_source_review_accepted(queue, trial, tid)
                        if "source_review" in task else
                        _v2_source_qa_accepted(queue, trial, tid)
                        if "source_qa" in task else
                        _v2_release_handoff_valid(queue, trial, task, data))
            if not approved:
                mark_blocked(tid, "recovered claim lacks protected QA/CI handoff evidence")
                return
        mark_completed(tid, reason if "release_handoff" not in task
                       else "source-only CI handoff prepared; not deployed")
        return
    if data.get("owner_blocker") is True or data.get("blocker_scope") == "project_global":
        mark_blocked(tid, reason, blocker_scope="project_global", owner_blocker=bool(data.get("owner_blocker")))
        return
    if data.get("blocker_scope") == "lane_local":
        mark_blocked(tid, reason)
        return
    max_attempts = max(1, min(5, int(cfg.get("max_repair_attempts") or 5)))
    if attempt_count(tid) >= max_attempts:
        mark_blocked(tid, f"repair limit reached ({attempt_count(tid)}/{max_attempts}): {reason}")
    else:
        _v2_release_active_for_retry(tid, f"recovered dead executor: {reason}")


def recover_state_on_start(cfg: dict[str, Any] | None = None) -> None:
    config = cfg or load_config()
    st = load_state()
    # Persist the v1->v2 migration before any claims.
    def mutate(state):
        state["runner_pid"] = os.getpid()
    _v2_mutate_state(mutate)
    for claim in active_claims(st):
        _v2_finalize_or_requeue_recovered(config, claim)


def load_task_progresses(st: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    state = st if isinstance(st, dict) else load_state()
    result: dict[str, dict[str, Any]] = {}
    for claim in active_claims(state):
        tid = str(claim.get("id") or "")
        data = load_json(progress_path_for(tid), None)
        if isinstance(data, dict) and str(data.get("task_id") or "") == tid:
            result[tid] = data
    return result


def daemon_loop() -> int:
    cfg = load_config()
    if cfg.get("prod_authorized") is not False:
        log("REFUSE: config must keep prod_authorized=false")
        return 2
    lock = SingleInstanceLock(LOCK_PATH)
    if not lock.acquire():
        log("REFUSE: another runner holds single-instance lock")
        return 3
    log(f"runner v2 start pid={os.getpid()} max_parallel={max_parallel(cfg)}")
    try:
        recover_state_on_start(cfg)
        while True:
            # Retire in-memory worker handles that have finished; state finalization is
            # performed by the worker itself.
            for tid, thread in list(_V2_WORKERS.items()):
                if not thread.is_alive():
                    _V2_WORKERS.pop(tid, None)

            st = load_state()
            _v2_mutate_state(lambda state: state.__setitem__("runner_pid", os.getpid()))

            # Claims surviving a runner restart have no local worker thread. Reconcile
            # them only after their executor PID is gone.
            for claim in active_claims(st):
                tid = str(claim.get("id") or "")
                if tid not in _V2_WORKERS and not (
                    claim.get("agent_pid") and pid_alive(int(claim["agent_pid"]))
                ):
                    _v2_finalize_or_requeue_recovered(cfg, claim)

            poll = float(cfg.get("poll_seconds") or 15)
            st = load_state()
            if st.get("paused"):
                time.sleep(poll)
                continue
            if st.get("blocked") and release_lane_block(cfg, st):
                continue
            if st.get("blocked") and not lane_local_block(st):
                time.sleep(poll)
                continue

            external_busy, external_reason = writer_busy(cfg, st, include_owned_active=False)
            q = load_backlog()
            refresh_qa_candidate_refs(q, st, cfg)
            selected, waits = select_runnable_tasks(
                q, st, cfg, external_writer_busy=external_busy
            )
            if external_busy:
                old = st.get("gate_wait") or {}
                if old.get("type") != "writer" or old.get("reason") != external_reason:
                    _v2_mutate_state(lambda state: state.__setitem__(
                        "gate_wait", {"type": "writer", "reason": external_reason, "at": utc_now()}
                    ))
                    log(f"writer busy: {external_reason}")
            elif selected:
                _v2_mutate_state(lambda state: state.__setitem__("gate_wait", None))
                for task in selected:
                    try:
                        claim = claim_task(task)
                    except Exception as exc:
                        log(f"claim skipped {task.get('id')}: {exc}")
                        continue
                    log(f"claimed {task['id']} locks={','.join(task_locks(task))}")
                    _v2_start_worker(cfg, task, claim)
            else:
                summary = {"type": "NO_ELIGIBLE_WORK", "reason": "no dependency/gate/lock READY task", "at": utc_now()}
                if waits:
                    summary = {
                        "type": "NO_ELIGIBLE_WORK",
                        "reason": "; ".join(f"{x['id']}: {x['reason']}" for x in waits[:5]),
                        "at": utc_now(),
                    }
                _v2_mutate_state(lambda state: state.__setitem__("gate_wait", summary))
            time.sleep(max(0.5, min(poll, 5.0)))
    finally:
        # Never kill active executor groups on runner service restart; state/PIDs allow
        # the new runner to reattach/reconcile safely.
        lock.release()
        log("runner v2 stop")


def status() -> int:
    cfg = load_config()
    st = load_state()
    q = load_backlog()
    busy, why = writer_busy(cfg, st)
    pending = pending_tasks(q, st)
    selected, waits = select_runnable_tasks(q, st, cfg, external_writer_busy=busy)
    out = {
        "runner_pid": st.get("runner_pid"),
        "runner_alive": pid_alive(st.get("runner_pid")),
        "state_version": st.get("version"),
        "max_parallel": max_parallel(cfg),
        "paused": st.get("paused"),
        "blocked": st.get("blocked"),
        "blocked_tasks": st.get("blocked_tasks") or {},
        "current": st.get("current"),
        "active": active_claims(st),
        "writer_busy": busy,
        "writer_reason": why,
        "gate_wait": st.get("gate_wait"),
        "runnable_now": [t["id"] for t in selected],
        "eligibility": queue_eligibility(q, st, cfg),
        "waits": waits,
        "pending": [t["id"] for t in pending],
        "completed": sorted(completed_ids(st)),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))
    return 0


def pause() -> int:
    _v2_mutate_state(lambda st: st.__setitem__("paused", True))
    print("paused")
    return 0


def resume() -> int:
    _v2_mutate_state(lambda st: st.__setitem__("paused", False))
    print("resumed")
    return 0

def main() -> int:
    ap = argparse.ArgumentParser(description="GoBadminton VPS multi-executor queue runner")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run")
    sub.add_parser("status")
    sub.add_parser("pause")
    sub.add_parser("resume")
    sub.add_parser("retry-blocked")
    sub.add_parser("print-queue")
    args = ap.parse_args()

    if args.cmd == "run":
        return daemon_loop() or 0
    if args.cmd == "status":
        return status()
    if args.cmd == "pause":
        return pause()
    if args.cmd == "resume":
        return resume()
    if args.cmd == "retry-blocked":
        return retry_blocked()
    return print_queue()


if __name__ == "__main__":
    raise SystemExit(main())
