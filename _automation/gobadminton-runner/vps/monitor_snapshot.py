#!/usr/bin/env python3
"""GoBadminton CLEAN Runner DEV monitor: bounded read-only public snapshot.

Never expose raw task receipts, prompts, messages, personal data, environment,
filesystem paths, credentials or old 551-job backlog. No remote calls, service
commands, Publisher activation or mutation of Runner state.
"""
from __future__ import annotations
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

ROOT=Path("/srv/gobadminton-clean")
RUNNER=ROOT/"runner"
REPO=ROOT/"repo"
PUBLIC=Path("/var/lib/gobadminton-clean-monitor")
OUT=PUBLIC/"status.json"
PYTHON="/srv/gobadminton-dev/runner/.venv/bin/python"
MODEL="clean-runner-monitor-v001"
IDENTITY=re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$")
ALLOWED_STATUS={"queued","running","completed","done","blocked","qa_failed","qa_blocked","deferred","superseded_before_launch","paused"}

def limited(value, limit=180):
    if not isinstance(value,str): return ""
    v="".join(c for c in value if c.isprintable() and c not in "<>\\")
    return v.strip()[:limit]

def task_id(v):
    s=limited(v,100)
    return s if IDENTITY.fullmatch(s) else ""

def get_json(path, limit=2_000_000):
    if not path.is_file() or path.is_symlink():raise RuntimeError("unsafe source file")
    if path.stat().st_size>limit:raise RuntimeError("source too large")
    with path.open("rb") as f:
        return json.load(f)

def command(*args, timeout=10):
    p=subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=timeout, check=True)
    if len(p.stdout)>1_500_000: raise RuntimeError("excessive status output")
    return p.stdout.strip()

def clean_task(task):
    if not isinstance(task,dict): return None
    tid=task_id(task.get("id"))
    if not tid:return None
    status=limited(task.get("status"),32).lower()
    if status not in ALLOWED_STATUS: status="queued"
    order=task.get("order",9999)
    if not isinstance(order,(int,float)) or abs(order)>1_000_000:order=9999
    result={
      "id":tid,"order":order,
      "status":status,"enabled":task.get("enabled") is True,
      "title_ru":limited(task.get("title_ru"),110),
      "summary_ru":limited(task.get("summary_ru"),200),
      "scope":limited(task.get("scope"),100),
      "lane":limited(task.get("lane"),40),
      "executor":limited(task.get("executor"),30),
      "model":limited(task.get("model"),45),
      "effort":limited(task.get("effort"),25),
      "blocks":[],
    }
    for block in (task.get("blocks") if isinstance(task.get("blocks"),list) else [])[:15]:
        if isinstance(block,dict):
            result["blocks"].append({"id":task_id(block.get("id")),
                      "title":limited(block.get("title"),110)})
    return result

def clean_claim(claim):
    if not isinstance(claim,dict):return None
    tid=task_id(claim.get("id"))
    if not tid:return None
    locks=claim.get("locks")
    return {
      "id":tid,
      "status":limited(claim.get("status"),30) or "running",
      "attempt":int(claim.get("attempt") or 1) if str(claim.get("attempt") or "1").isdigit() else 1,
      "max_attempts":5,
      "locks":[limited(x,40) for x in locks[:8] if isinstance(x,str)] if isinstance(locks,list) else [],
    }

def verified_pid(value, expected):
    if type(value) is not int or value <= 0: return None
    try:
        args=Path(f"/proc/{value}/cmdline").read_bytes().split(b"\x00")
        if expected == "exec":
            executable=Path(f"/proc/{value}/exe").resolve().name
            return value if b"exec" in args and executable in {"codex","node"} else None
        name=Path(expected).name
        matched=expected.encode() in args or any(
            arg.startswith(b"/opt/gobadminton-clean/runner-code/")
            and Path(arg.decode(errors="replace")).name==name for arg in args)
        return value if matched else None
    except OSError:
        return None

def main():
    me=os.getuid()
    assert me!=0, "monitor snapshot must not run as root"
    assert ROOT.is_dir() and RUNNER.is_dir() and REPO.is_dir()
    assert PUBLIC.is_dir() and PUBLIC.stat().st_uid==me
    assert stat.S_IMODE(PUBLIC.stat().st_mode)==0o750
    assert not OUT.is_symlink()
    backlog=get_json(RUNNER/"backlog.json")
    cfg=get_json(RUNNER/"config.json")
    assert backlog.get("project")=="GoBadminton" and backlog.get("prod_authorized") is False
    assert cfg.get("project_repo")=="anpavel84-afk/gobadminton-clean" and cfg.get("prod_authorized") is False
    assert cfg.get("workspace")==str(REPO)
    status=json.loads(command(PYTHON,str(RUNNER/"runner.py"),"status",timeout=10))
    service_active=command("systemctl","is-active","gobadminton-clean-runner.service",timeout=5)=="active"
    alive=status.get("runner_alive") is True and service_active
    if status.get("paused") not in (True,False):
        raise RuntimeError("unknown pause state")
    head=command("git","-C",str(REPO),"rev-parse","refs/heads/main",timeout=6)
    if not re.fullmatch("[0-9a-f]{40}",head):raise RuntimeError("bad clean source HEAD")
    tasks=[v for v in (clean_task(t) for t in backlog.get("tasks",[])[:125]) if v]
    ids={x["id"] for x in tasks}
    acts=[v for v in (clean_claim(c) for c in status.get("active",[])[:4]) if v and v["id"] in ids]
    completed=[task_id(t) for t in status.get("completed",[])[:200] if task_id(t)]
    pending=[task_id(t) for t in status.get("pending",[])[:125] if task_id(t)]
    runnable=[task_id(t) for t in status.get("runnable_now",[])[:10] if task_id(t)]
    now=datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    max_parallel=min(4,max(1,int(cfg.get("max_parallel") or 2)))
    writer_busy=status.get("writer_busy") is True
    ap=get_json(RUNNER/"autopilot-state.json") if (RUNNER/"autopilot-state.json").is_file() else {}
    ap_pid=verified_pid(ap.get("pid"),str(RUNNER/"autopilot.py"))
    planner_pid=verified_pid(ap.get("planner_pid"),"exec")
    owner_counts={}
    for path in sorted((RUNNER/"owner-inbox").glob("*.json"))[:100]:
        try:
            item=get_json(path,32768)
            state=limited(item.get("status"),32)
            if state in {"NEW","ACKNOWLEDGED","PLANNED","BLOCKED"}:
                owner_counts[state]=owner_counts.get(state,0)+1
        except (ValueError,OSError,RuntimeError):
            pass
    main_pid=subprocess.run(["systemctl","show","gobadminton-clean-runner.service","--property=MainPID","--value"],capture_output=True,text=True,timeout=5)
    service_pid=int(main_pid.stdout.strip()) if main_pid.returncode==0 and main_pid.stdout.strip().isdigit() else None
    runner_pid=verified_pid(service_pid,str(RUNNER/"runner.py"))
    frame={
      "schema":MODEL,
      "environment":"clean-dev",
      "generated_at":now,
      "dashboard_url":"https://dev.gobadminton.ru/runner-monitor/",
      "runner":{
         "pid":runner_pid,
         "alive":alive,
         "paused":status["paused"],
         "blocked":bool(status.get("blocked")),
         "current":acts[0] if acts else None,
         "active":acts,
         "gate_wait":{"type":limited((status.get("gate_wait") or {}).get("type"),45) if isinstance(status.get("gate_wait"),dict) else "",
                      "reason":limited((status.get("gate_wait") or {}).get("reason"),150) if isinstance(status.get("gate_wait"),dict) else ""},
         "max_parallel":max_parallel,
      },
      "writer":{"enabled":False,"busy":writer_busy,"reason":"Protected Writer / QA commissioning pending" if not writer_busy else "Writer lock busy"},
      "queue":{
         "pending":pending,"completed":completed,"tasks":tasks,
         "next_gate":{"ready":bool(runnable),"task":runnable[0] if runnable else None,
                      "reason":"Очередь пуста" if not pending else "Проверка допуска Runner"},
         "policy":{"clean_git_only":True}
      },
      "git":{"ok":True,"branch":"main","head":head,"dirty":False,"last_commit":"Clean Git"},
      "source_release":{"short_sha":head[:12],"runner_pr":11,"in_main":False},
      "qa_state":{"independent_pass":False,"protected_root_issued":False},
      "release_state":{"dev_ready":False},
      "progress":None,"progresses":{},"parallel_lanes":[],
      "autopilot":{"enabled":ap_pid is not None,"alive":ap_pid is not None,"pid":ap_pid,"planner_pid":planner_pid,"status":limited(ap.get("status"),60) if ap_pid else "NOT_RUNNING"},
      "owner_instructions":{"enabled":cfg.get("owner_issue_intake_enabled") is True and ap_pid is not None,"counts":owner_counts},
      "watchdog":{"health":"RUNNER_ACTIVE" if alive and not status["paused"] else "RUNNER_PAUSED" if alive else "RUNNER_DOWN",
                  "reason":"Изолированный DEV Runner; PROD не используется"},
      "activity":[
          "Новый Clean Runner работает на Германии." if alive else "Нет подтверждения живого Clean Runner.",
          f"Очередь DEV: {len(tasks)} задач, активно: {len(acts)}, исполнимо: {len(runnable)}.",
          "Старые 551 задач не импортированы.",
          "Защищённая QA и публикация DEV запускаются отдельно после допуска.",
      ],
      "_monitor":{"transport":"local_file_snapshot","source":"Germany clean runner", "read_only":True,"refresh_seconds":15},
    }
    raw=(json.dumps(frame,ensure_ascii=False,separators=(",",":"))+"\n").encode()
    if len(raw)>140_000:raise RuntimeError("snapshot too large")
    fd,tmp=tempfile.mkstemp(prefix=".status-",dir=str(PUBLIC))
    try:
        os.fchmod(fd,0o640)
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(tmp,OUT)
        directory=os.open(PUBLIC,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    print("CLEAN_DEV_MONITOR_SNAPSHOT_PASS queued="+str(len(tasks))+" active="+str(len(acts))+
          " alive="+str(alive)+" paused="+str(status["paused"]))
if __name__=="__main__":
    main()
