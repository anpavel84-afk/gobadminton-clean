#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from datetime import datetime, timezone
import base64, json, time, urllib.request

ROOT=Path(__file__).resolve().parent
LOCAL="http://127.0.0.1:17650/api/status"
REMOTE="https://gobadminton.ru/runner-monitor-ingest"
CRED_FILE=ROOT/"monitor-push-credentials.txt"
STATE_FILE=ROOT/"monitor-push-state.json"
LOG_FILE=ROOT/"monitor-push.log"
CADENCE=15

def now():
    return datetime.now(timezone.utc).isoformat()

def write_state(ok, detail):
    data={"ok":ok,"at":now(),"detail":detail}
    STATE_FILE.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")

def log(msg):
    with LOG_FILE.open("a",encoding="utf-8") as f:
        f.write(f"{now()} {msg}\n")

def auth_header():
    raw=CRED_FILE.read_text(encoding="utf-8").strip().encode("utf-8")
    return "Basic "+base64.b64encode(raw).decode("ascii")

while True:
    try:
        with urllib.request.urlopen(LOCAL,timeout=5) as r:
            payload=r.read()
        json.loads(payload)
        req=urllib.request.Request(
            REMOTE,
            data=payload,
            method="POST",
            headers={
                "Authorization":auth_header(),
                "Content-Type":"application/json",
                "User-Agent":"GoBadmintonMonitorPush/1.0",
            },
        )
        with urllib.request.urlopen(req,timeout=10) as r:
            code=r.status
        if code not in (200,204):
            raise RuntimeError(f"remote HTTP {code}")
        write_state(True,f"pushed {len(payload)} bytes, HTTP {code}")
    except Exception as exc:
        detail=f"{type(exc).__name__}: {exc}"
        write_state(False,detail)
        log(detail)
    time.sleep(CADENCE)
