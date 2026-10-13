#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import base64, json, os, signal, subprocess, time, urllib.request, urllib.error

ROOT=Path("/srv/gobadminton-dev/runner")
STATE=ROOT/"state.json"
PROGRESS=ROOT/"progress.json"
BACKLOG=ROOT/"backlog.json"
WATCHDOG=ROOT/"watchdog-state.json"
MONITOR_PUSH_STATE=ROOT/"monitor-push-state.json"
LOCAL_STATUS="http://127.0.0.1:17650/api/status"
LOG=ROOT/"control-agent.log"
CRED=ROOT/"monitor-push-credentials.txt"
OWNER_INBOX=ROOT/"owner-inbox"
WAKE=ROOT/"autopilot-wake.json"
REMOTE="https://gobadminton.ru/runner-control-agent"
RUNNER_PY=ROOT/"runner.py"
PYTHON=ROOT/".venv/bin/python"
POLL_SECONDS=5
STALE_PROGRESS_SECONDS=30*60
DEAD_EXECUTOR_GRACE_SECONDS=60
IDLE_QUEUE_GRACE_SECONDS=90
AGENT_NAME="germany-control-agent-v1"

dead_executor_seen_at=None
idle_queue_seen_at=None

def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

def epoch_from_iso(value):
    if not value: return None
    try:
        return datetime.fromisoformat(str(value).replace("Z","+00:00")).timestamp()
    except Exception:
        return None

def load(path,default=None):
    try:return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:return default

def atomic(path,data,mode=0o644,uid=None,gid=None):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    os.chmod(tmp,mode)
    if uid is not None and gid is not None: os.chown(tmp,uid,gid)
    os.replace(tmp,path)

def log(msg):
    line=f"{now()} {msg}"
    try:
        with LOG.open("a",encoding="utf-8") as f:f.write(line+"\n")
    except Exception:pass
    print(line,flush=True)

def auth_header():
    raw=CRED.read_text(encoding="utf-8").strip().encode()
    return "Basic "+base64.b64encode(raw).decode()

def request(path,method="GET",data=None,timeout=12):
    body=None
    headers={"Authorization":auth_header(),"User-Agent":"GoBadmintonControlAgent/1.0"}
    if data is not None:
        body=json.dumps(data,ensure_ascii=False).encode()
        headers["Content-Type"]="application/json"
    req=urllib.request.Request(REMOTE+path,data=body,method=method,headers=headers)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw=r.read()
        return json.loads(raw) if raw else {}

def sh(args,timeout=30,check=False):
    cp=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
    if check and cp.returncode!=0:
        raise RuntimeError((cp.stderr or cp.stdout or "command failed").strip()[:1000])
    return cp

def service_active(name):
    return sh(["systemctl","is-active","--quiet",name]).returncode==0

def restart_service(name):
    allowed, reason = service_restart_allowed(name)
    if not allowed:
        raise RuntimeError(reason)
    sh(["systemctl","restart",name],timeout=45,check=True)

def run_runner(cmd):
    cp=sh(["runuser","-u","agentagency-dev","--",str(PYTHON),str(RUNNER_PY),cmd],timeout=30)
    if cp.returncode!=0:
        raise RuntimeError((cp.stderr or cp.stdout or f"runner {cmd} failed").strip()[:1000])
    return (cp.stdout or "").strip()

def wake_autopilot(reason,extra=None):
    st=STATE.stat()
    payload={"type":"owner_control","reason":reason,"at":now()}
    if extra:payload.update(extra)
    atomic(WAKE,payload,0o644,st.st_uid,st.st_gid)
    return "autopilot wake published"

def pid_alive(pid):
    try:
        os.kill(int(pid),0)
        return True
    except Exception:
        return False

def restart_current_executor(task_id=None):
    st=load(STATE,{}) or {}
    active=st.get("active") if isinstance(st.get("active"),dict) else {}
    claims=[x for x in active.values() if isinstance(x,dict) and x.get("status")=="running"]
    if not claims:
        cur=st.get("current") or {}
        claims=[cur] if cur.get("status")=="running" else []
    if task_id:
        claims=[x for x in claims if str(x.get("id"))==str(task_id)]
    elif len(claims)>1:
        raise RuntimeError("multiple active tasks; task_id is required")
    if len(claims)!=1:
        raise RuntimeError("no matching running task")
    cur=claims[0]
    pid=cur.get("agent_pid")
    if not pid or not pid_alive(pid):
        raise RuntimeError("selected executor is not alive")
    try:
        pgid=os.getpgid(int(pid))
        os.killpg(pgid,signal.SIGTERM)
        time.sleep(1)
        if pid_alive(pid):
            os.killpg(pgid,signal.SIGKILL)
    except ProcessLookupError:
        pass
    return f"executor process group stopped for {cur.get('id')}; runner owns per-task recovery"

def store_instruction(command):
    text=str(((command.get("payload") or {}).get("text")) or "").strip()
    if not text:raise RuntimeError("empty owner instruction")
    if len(text)>2000:raise RuntimeError("owner instruction too long")
    st=STATE.stat()
    OWNER_INBOX.mkdir(parents=True,exist_ok=True)
    try:
        st=STATE.stat()
        os.chown(OWNER_INBOX, st.st_uid, st.st_gid)
        os.chmod(OWNER_INBOX, 0o755)
    except OSError:
        pass
    item={
        "id":command["id"],
        "status":"NEW",
        "created_at":command.get("created_at") or now(),
        "received_at":now(),
        "source":"owner-control-plane",
        "text":text,
        "planner_note":None,
        "updated_at":now(),
    }
    path=OWNER_INBOX/f"{command['id']}.json"
    atomic(path,item,0o644,st.st_uid,st.st_gid)
    wake_autopilot("owner_instruction",{"instruction_id":command["id"]})
    return f"owner instruction stored: {path.name}"

def execute(command):
    kind=str(command.get("type") or "")
    if kind=="WAKE_AUTOPILOT":return wake_autopilot("manual_wake")
    if kind=="RETRY_BLOCKED":return run_runner("retry-blocked")
    if kind=="RESTART_RUNNER":
        if not bounded_restart("gobadminton-runner.service"):
            raise RuntimeError("runner restart refused by Owner-OFF or bounded policy")
        return "runner restarted"
    if kind=="RESTART_AUTOPILOT":
        if not bounded_restart("gobadminton-autopilot.service"):
            raise RuntimeError("autopilot restart refused by Owner-OFF or bounded policy")
        return "autopilot restarted"
    if kind=="PAUSE_QUEUE":return run_runner("pause")
    if kind=="RESUME_QUEUE":return run_runner("resume")
    if kind=="RESTART_CURRENT_EXECUTOR":return restart_current_executor((command.get("payload") or {}).get("task_id"))
    if kind=="OWNER_INSTRUCTION":return store_instruction(command)
    raise RuntimeError("unsupported command")

def process_commands():
    try:
        data=request("/api/commands")
    except Exception as e:
        log(f"poll error: {type(e).__name__}: {e}")
        return
    for cmd in data.get("commands") or []:
        cid=cmd.get("id")
        if not cid:continue
        try:
            request(f"/api/commands/{cid}/claim","POST",{"agent":AGENT_NAME})
        except urllib.error.HTTPError as e:
            if e.code in (409,404):continue
            log(f"claim {cid} HTTP {e.code}");continue
        except Exception as e:
            log(f"claim {cid} error {e}");continue
        ok=True; result=""
        try:
            result=execute(cmd)
            log(f"executed {cid} {cmd.get('type')}: {result}")
        except Exception as e:
            ok=False; result=f"{type(e).__name__}: {e}"
            log(f"command {cid} failed: {result}")
        try:
            request(f"/api/commands/{cid}/complete","POST",{"ok":ok,"result":result})
        except Exception as e:
            log(f"complete {cid} error: {e}")

def queue_truth(backlog, state, cfg=None):
    import runner
    cfg = cfg if cfg is not None else (load(ROOT/"config.json", {}) or {})
    rows = runner.queue_eligibility(backlog, state, cfg)
    busy, why = runner.writer_busy(cfg, state, include_owned_active=False)
    ready = sum(row["status"] == "READY" for row in rows) if not busy else 0
    active = len(runner.active_claims(state))
    holds = [row for row in rows if row["status"].startswith("WAITING_")]
    if busy: holds.append({"status": "LOCAL_HOLD", "reason": why})
    return {"status": "ACTIVE" if active else "READY" if ready else "LOCAL_HOLD" if holds else "NO_ELIGIBLE_WORK",
            "READY": ready, "ACTIVE": active, "LOCAL_HOLD": len(holds),
            "NO_ELIGIBLE_WORK": not ready and not active, "holds": holds[:10]}


def enabled_pending_count(backlog,state):
    try: return queue_truth(backlog, state)["READY"]
    except Exception: return 0  # unavailable environment is HOLD, never restart evidence


def service_restart_allowed(name):
    cp = sh(["systemctl", "show", name, "--property=UnitFileState,RefuseManualStart,DropInPaths"])
    if cp.returncode: return False, "service policy unavailable; HOLD"
    props = dict(line.split("=", 1) for line in cp.stdout.splitlines() if "=" in line)
    if props.get("UnitFileState") not in {"enabled", "enabled-runtime"}:
        return False, "intentional OFF or unproven enabled state"
    if props.get("RefuseManualStart") == "yes": return False, "RefuseManualStart=yes"
    if any("owner" in x.lower() and ("hold" in x.lower() or "off" in x.lower()) for x in props.get("DropInPaths", "").split()):
        return False, "explicit Owner hold drop-in"
    return True, "enabled"


QUEUE_TRUTH_SECONDS=600

def queue_truth_tick(epoch=None):
    epoch = time.time() if epoch is None else epoch
    previous = load(WATCHDOG,{}) or {}
    if epoch - previous.get("queue_truth_epoch", 0) < QUEUE_TRUTH_SECONDS:
        return previous
    try: truth = queue_truth(load(BACKLOG,{}) or {}, load(STATE,{}) or {})
    except Exception as exc: truth = {"status": "LOCAL_HOLD", "READY": 0, "ACTIVE": 0,
                                    "NO_ELIGIBLE_WORK": True, "reason": str(exc)[:300]}
    previous.update(queue_truth=truth, queue_truth_epoch=epoch)
    atomic(WATCHDOG,previous)
    return previous


RESTART_BUDGET=3
RESTART_COOLDOWN_SECONDS=600


def bounded_restart(service):
    """Journal a shared watchdog/manual budget before invoking systemctl.

    atomic() does not fsync the file or parent directory: process-restart
    persistence is tested, but power-loss durability is NOT guaranteed.
    """
    allowed,_=service_restart_allowed(service)
    if not allowed:
        return False
    state=load(WATCHDOG,{}) or {}
    if not isinstance(state,dict):
        return False
    retries=state.get("retry_state",{})
    if not isinstance(retries,dict):
        return False
    entry=retries.get(service,{})
    if not isinstance(entry,dict):
        return False
    attempts=entry.get("attempts",0)
    last=entry.get("at",0)
    if (type(attempts) is not int or attempts<0 or attempts>=RESTART_BUDGET
            or type(last) not in (int,float) or last<0):
        return False
    epoch=time.time()
    if epoch-last<RESTART_COOLDOWN_SECONDS:
        return False
    updated=dict(state)
    updated["retry_state"]={**retries,service:{"attempts":attempts+1,"at":epoch}}
    atomic(WATCHDOG,updated,0o644)
    restart_service(service)
    return True


def watchdog():
    global dead_executor_seen_at,idle_queue_seen_at
    incidents=[]
    recovered=[]
    prior=load(WATCHDOG,{}) or {}
    initial_state=load(STATE,{}) or {}
    initial_ready=enabled_pending_count(load(BACKLOG,{}) or {},initial_state)
    for service in ("gobadminton-runner.service","gobadminton-autopilot.service","gobadminton-dashboard.service","gobadminton-monitor-push.service"):
        if service=="gobadminton-runner.service" and not initial_ready and not initial_state.get("active") and (initial_state.get("current") or {}).get("status")!="running":
            continue
        if not service_active(service):
            try:
                if bounded_restart(service): recovered.append(service+" restarted")
            except Exception as e:
                incidents.append(service+" DOWN: "+str(e))

    st=load(STATE,{}) or {}
    progress=load(PROGRESS,{}) or {}
    backlog=load(BACKLOG,{}) or {}
    cur=st.get("current") or {}
    blocked=st.get("blocked")
    paused=bool(st.get("paused"))
    now_epoch=time.time()

    health="HEALTHY"
    reason="Runner, autopilot and queue state look healthy."

    if blocked:
        text=str(blocked.get("reason") or "")
        owner_terms=("Owner","interactive","consent","credential","provider cabinet")
        if any(x.lower() in text.lower() for x in owner_terms):
            health="OWNER_ACTION_REQUIRED"
        else:
            health="ATTENTION"
        reason=text or "Runner is blocked."

    if cur.get("status")=="running":
        pid=cur.get("agent_pid")
        if pid and not pid_alive(pid):
            if dead_executor_seen_at is None:dead_executor_seen_at=now_epoch
            age=now_epoch-dead_executor_seen_at
            health="ATTENTION";reason=f"Current executor PID {pid} is dead for {int(age)}s."
            if age>=DEAD_EXECUTOR_GRACE_SECONDS:
                try:
                    if bounded_restart("gobadminton-runner.service"): recovered.append("runner restarted after dead executor state")
                    dead_executor_seen_at=None
                except Exception as e:
                    incidents.append("dead executor recovery failed: "+str(e))
        else:
            dead_executor_seen_at=None

        upd=epoch_from_iso(progress.get("updated_at"))
        if upd and now_epoch-upd>=STALE_PROGRESS_SECONDS and health=="HEALTHY":
            health="ATTENTION"
            reason=f"No progress checkpoint update for {int((now_epoch-upd)/60)} min; executor is still alive. Automatic kill is disabled."
    else:
        dead_executor_seen_at=None
        pending=enabled_pending_count(backlog,st)
        if pending and not blocked and not paused:
            if idle_queue_seen_at is None:idle_queue_seen_at=now_epoch
            age=now_epoch-idle_queue_seen_at
            if age>=IDLE_QUEUE_GRACE_SECONDS:
                health="ATTENTION";reason=f"{pending} admitted task(s) pending but no current task for {int(age)}s."
                try:
                    if bounded_restart("gobadminton-runner.service"): recovered.append("runner restarted after idle admitted queue")
                    idle_queue_seen_at=None
                except Exception as e:
                    incidents.append("idle queue recovery failed: "+str(e))
        else:
            idle_queue_seen_at=None


    # Transport honesty: never claim HEALTHY when status publish path is broken/stale.
    push=load(MONITOR_PUSH_STATE,{}) or {}
    if push.get("ok") is not True:
        if health=="HEALTHY":
            health="ATTENTION"
            reason=f"monitor-push not ok: {push.get('detail') or 'unknown'}"
    else:
        push_at=epoch_from_iso(push.get("at"))
        if push_at is None:
            if health=="HEALTHY":
                health="ATTENTION"; reason="monitor-push timestamp missing"
        elif now_epoch-push_at>90 and health=="HEALTHY":
            health="ATTENTION"; reason=f"monitor-push stale ({int(now_epoch-push_at)}s)"
    try:
        with urllib.request.urlopen(LOCAL_STATUS,timeout=5) as r:
            raw=r.read()
            if r.status!=200 or not raw:
                raise RuntimeError(f"HTTP {r.status} empty={not raw}")
            payload=json.loads(raw)
            if isinstance(payload,dict) and payload.get("ok") is False and payload.get("error"):
                raise RuntimeError(str(payload.get("detail") or payload.get("error")))
    except Exception as e:
        if health=="HEALTHY":
            health="ATTENTION"; reason=f"local /api/status failed: {type(e).__name__}: {e}"

    if incidents:
        health="ATTENTION"
        reason="; ".join(incidents)
    elif recovered:
        reason="; ".join(recovered)

    data={
        "health":health,
        "reason":reason,
        "at":now(),
        "current_task":cur.get("id") if cur.get("status")=="running" and cur.get("agent_pid") and pid_alive(cur["agent_pid"]) else None,
        "retry_state":(load(WATCHDOG,{}) or {}).get("retry_state",{}),
        "queue_truth":prior.get("queue_truth"),
        "queue_truth_epoch":prior.get("queue_truth_epoch",0),
        "blocked":blocked,
        "paused":paused,
        "recovered":recovered,
        "incidents":incidents,
        "stale_progress_seconds":STALE_PROGRESS_SECONDS,
    }
    atomic(WATCHDOG,data,0o644)
    return data

def main():
    log("control agent start")
    while True:
        try:
            queue_truth_tick()
            watchdog()
        except Exception as e:
            log(f"watchdog error: {type(e).__name__}: {e}")
        process_commands()
        time.sleep(POLL_SECONDS)

if __name__=="__main__":
    main()
