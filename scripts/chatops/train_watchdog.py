#!/usr/bin/env python3
"""GoBadminton read-only train observer. No models, repair, deploy or worker writes."""
import argparse
import datetime as dt
import email.message
import email.utils
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import smtplib
import ssl
import stat
import subprocess
import time
import uuid

UNIT = "gobadminton-autonomy.service"
ROOT = Path("/home/agentagency-dev")
WORKER = ROOT / ".gb-autonomy-state"
CONFIG = ROOT / ".config/gobadminton/train-watchdog.json"
DATA = ROOT / ".local/state/gobadminton-train-watchdog"
PHASES = {"claimed", "developing", "candidate", "pr_wait", "qa", "ci", "promoting", "dev_wait", "done", "blocked"}
HELPERS = {
    str(ROOT / ".cache/gb-autonomy-p0/issue64-photo-stepup-operator-20261017.py"),
    str(ROOT / ".cache/gb-autonomy-p0/issue64-photo-replay-operator-20261017.py"),
}


def read_json(path, private=False, owners=None):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        s = os.fstat(stream.fileno())
        if not stat.S_ISREG(s.st_mode) or s.st_uid not in (owners if owners is not None else {os.getuid()}) or s.st_size > 2_000_000:
            raise ValueError("unsafe_file")
        if private and stat.S_IMODE(s.st_mode) & 0o077:
            raise ValueError("private_file_permissions")
        return json.load(stream)


def atomic(path, value):
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def holder_pid(path, lines):
    s = path.stat()
    identity = (os.major(s.st_dev), os.minor(s.st_dev), s.st_ino)
    for line in lines:
        fields = line.split()
        if len(fields) < 8 or fields[1:4] != ["FLOCK", "ADVISORY", "WRITE"]:
            continue
        try:
            major, minor, inode = fields[5].split(":")
            if (int(major, 16), int(minor, 16), int(inode)) == identity:
                return int(fields[4])
        except ValueError:
            continue
    return 0


def collect():
    result = subprocess.run(["systemctl", "--user", "show", UNIT,
                             "-p", "MainPID", "-p", "ActiveState", "-p", "SubState",
                             "-p", "ActiveEnterTimestampMonotonic"],
                            capture_output=True, text=True, timeout=10, check=True)
    service = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
    if not {"MainPID", "ActiveState"}.issubset(service):
        raise ValueError("service_status_unavailable")
    snapshot = read_json(WORKER / "state.json")
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("done"), list):
        raise ValueError("invalid_checkpoint")
    active = snapshot.get("active")
    if active is not None and (not isinstance(active, dict) or active.get("phase") not in PHASES):
        raise ValueError("invalid_phase")
    pid = holder_pid(WORKER / "worker.lock", Path("/proc/locks").read_text().splitlines())
    helper = False
    alive = False
    if pid:
        try:
            proc = Path(f"/proc/{pid}")
            argv = (proc / "cmdline").read_bytes().decode().split("\0")
            owned = proc.stat().st_uid == os.getuid()
            alive = owned and bool(argv[0])
            # Exact enrolled finite helpers only, not arbitrary same-UID processes.
            helper = alive and Path(argv[0]).name.startswith("python") and any(x in HELPERS for x in argv[1:])
        except (OSError, UnicodeError):
            pass
    uptime = float(Path("/proc/uptime").read_text().split()[0])
    entered = float(service.get("ActiveEnterTimestampMonotonic", "0")) / 1_000_000
    return snapshot, service, pid if alive else 0, helper, max(0, uptime - entered)


def classify(snapshot, service, holder, helper, age):
    if helper:
        return {"kind": "maintenance"}  # Suppress, but do not reset an existing incident.
    a = snapshot.get("active") or {}
    issue = a.get("issue")
    phase = a.get("phase")
    sha = a.get("head") or a.get("base") or ""
    if type(issue) is not int or issue <= 0:
        issue = None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        sha = ""
    unfinished = bool({64, 66, 68} - set(snapshot["done"])) or (bool(a) and phase != "done")
    common = {"issue": issue, "phase": phase, "sha": sha}
    if phase == "blocked":
        # Raw reason/findings can contain untrusted text; never email them or secrets.
        reason = a.get("reason", "")
        kind = "qa_exhausted" if "QA FAIL; attempts exhausted" == reason else "train_blocked"
        return dict(common, kind=kind, reason_hash=hashlib.sha256(str(reason).encode()).hexdigest())
    if not unfinished:
        return None
    if service.get("ActiveState") in {"activating", "active"} and age < 120 and not holder:
        return None
    if service.get("ActiveState") != "active" or not int(service.get("MainPID", "0")):
        return dict(common, kind="worker_stopped")
    if holder != int(service["MainPID"]):
        return dict(common, kind="worker_lock_missing")
    # A live worker can be waiting on quota/CI. Checkpoint age alone is not a stall.
    return None


def reconcile(ledger, incident, now, sender):
    if incident is not None and incident.get("kind") == "maintenance":
        return "maintenance"
    if incident is None:
        ledger.clear()
        ledger.update(version=1, status="healthy")
        return "healthy"
    fingerprint = hashlib.sha256(json.dumps(incident, sort_keys=True).encode()).hexdigest()[:24]
    if ledger.get("fingerprint") != fingerprint:
        ledger.clear()
        ledger.update(version=1, status="pending", fingerprint=fingerprint,
                      episode=uuid.uuid4().hex, first_seen=now, checks=0, failures=0)
    ledger["checks"] += 1
    if ledger.get("status") == "sent":
        return "already_notified"
    if ledger["checks"] < 2 or now - ledger["first_seen"] < 60:
        return "confirming"
    if now < ledger.get("retry_at", 0):
        return "delivery_backoff"
    try:
        message_id = sender(incident, ledger["episode"])
    except Exception as error:
        ledger["failures"] += 1
        ledger.update(status="pending", retry_at=now + min(3600, 300 * 2 ** min(ledger["failures"], 4)),
                      delivery_error=type(error).__name__)
        return "delivery_failed"
    ledger.update(status="sent", sent_at=now, message_id=message_id)
    ledger.pop("delivery_error", None)
    return "notified"


def smtp_config(path=CONFIG):
    c = read_json(path, private=True)
    if not c.get("enabled"):
        raise ValueError("smtp_not_configured")
    for key in ("host", "from", "to"):
        if not isinstance(c.get(key), str) or not c[key] or any(x in c[key] for x in "\r\n"):
            raise ValueError("invalid_smtp_config")
    if c.get("tls") not in {"ssl", "starttls"} or type(c.get("port")) is not int or not 1 <= c["port"] <= 65535:
        raise ValueError("smtp_tls_required")
    if bool(c.get("username")) != bool(c.get("password")):
        raise ValueError("smtp_credentials_incomplete")
    return c


def send_mail(incident, episode, config=None):
    c = config or smtp_config()
    msg = email.message.EmailMessage()
    msg["From"], msg["To"] = c["from"], c["to"]
    msg["Subject"] = "GoBadminton: " + ("проверка VPS watchdog" if incident["kind"] == "test" else "трейн остановлен")
    message_id = f"<gb-train-{episode}@watchdog.gobadminton.invalid>"
    msg["Message-ID"] = message_id
    msg["Date"] = email.utils.formatdate(localtime=True)
    reasons = {"test": "Тест отправки из обычного сервиса на VPS, без GPT.",
               "qa_exhausted": "Независимая QA не прошла; лимит авторских попыток исчерпан.",
               "train_blocked": "Исполнитель зафиксировал блокировку. Очередь не продвигается.",
               "worker_stopped": "Исполнитель не запущен, имеются незавершённые задачи.",
               "worker_lock_missing": "Не подтверждён ожидаемый владелец блокировки исполнителя.",
               "slot_idle": "Свободный слот более 15 минут ожидает ранее подтверждённого назначения Actions. Проверьте свежесть планирования и очередь GitHub.",
               "monitor_unavailable": "Watchdog не смог достоверно прочитать состояние трейна. Остановка самого трейна не установлена."}
    issue = incident.get("issue")
    link = f"https://github.com/anpavel84-afk/gobadminton-clean/issues/{issue}" if issue else "https://github.com/anpavel84-afk/gobadminton-clean/issues"
    msg.set_content("\n".join(["Время UTC: " + dt.datetime.now(dt.timezone.utc).isoformat(),
        reasons[incident["kind"]], "Задача: " + str(issue or "не определена"),
        "Этап: " + str(incident.get("phase") or "не определён"),
        "Слот: " + str(incident.get("slot") or "не определён"),
        "Причина: " + str(incident.get("reason") or incident.get("kind")),
        "SHA: " + (incident.get("sha") or "не определён"), link,
        "Watchdog только наблюдает: код, права, QA и запуск исполнителя он не меняет.",
        "Нужно проверить указанную задачу и причину остановки; новый GO сам по себе ошибку не исправляет."]))
    ctx = ssl.create_default_context()
    client = smtplib.SMTP_SSL(c["host"], c["port"], timeout=20, context=ctx) if c["tls"] == "ssl" else smtplib.SMTP(c["host"], c["port"], timeout=20)
    with client:
        if c["tls"] == "starttls":
            client.ehlo()
            client.starttls(context=ctx)
            client.ehlo()
        if c.get("username"):
            client.login(c["username"], c["password"])
        refused = client.send_message(msg)
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    return message_id



def idle_ready(snapshot, previous, now):
    """Observe only a confirmed per-slot dispatch intent; never infer admission from a count."""
    state = {"schema": "GB_IDLE_READY_V1", "observed_at": now, "slots": {}}
    events = []
    if snapshot.get("mode") != "active":
        return state, events
    source_age = now - snapshot.get("observed_at", 0)
    for slot, card in snapshot.get("slots", {}).items():
        if slot not in ("slot1", "slot2"):
            continue
        planning = card.get("planning") or {}
        # dispatch_pending was emitted from an actual core.plan descriptor for THIS slot.
        # Counts.ready alone cannot prove route/budget/path eligibility.
        idle = card.get("status") == "waiting" and card.get("stage") in (None, "Accepted")
        if not idle or planning.get("reason") != "dispatch_pending":
            continue
        generation = planning.get("generation")
        if type(generation) is not int:
            continue
        # Global decisions do not map an Issue to this slot. Track a slot episode only.
        key = {"generation": generation}
        old = previous.get("slots", {}).get(slot, {})
        started = old.get("since", now) if old.get("key") == key else now
        duration = max(0, now - started)
        # Stale source/plan is not proof of CURRENT readiness. Preserve the episode
        # but label evidence staleness separately instead of pretending it is ready.
        plan_age = now - planning.get("observed_at", 0)
        stale = not 0 <= source_age <= 90 or not 0 <= plan_age <= 180
        reason = "planning_evidence_stale" if stale else "awaiting_actions_dispatch"
        row = {"key": key, "since": started, "seconds": duration, "reason": reason,
               "workflow_run": planning.get("workflow_run"), "last_eligibility_at": planning.get("observed_at")}
        state["slots"][slot] = row
        if duration > 180:
            events.append({"code": "SLOT_IDLE_EVIDENCE_STALE" if stale else "SLOT_IDLE_WITH_READY_TASK",
                           "slot": slot, **row})
    return state, events


ACTIONS = Path("/var/lib/gobadminton-deploy-evidence/actions-train.json")


def collect_idle(previous, now):
    snapshot = read_json(ACTIONS, owners={0})
    if snapshot.get("schema") != "GB_ACTIONS_MONITOR_SOURCE_V1":
        raise ValueError("invalid_actions_monitor")
    state, events = idle_ready(snapshot, previous, now)
    prolonged = next((e for e in events if e["seconds"] >= 900), None)
    incident = None
    if prolonged:
        # Stable fingerprint: elapsed time/run refresh must not produce email spam.
        incident = {"kind": "slot_idle", "slot": prolonged["slot"],
                    "issue": None, "phase": "dispatch",
                    "sha": "", "reason": prolonged["reason"]}
    return state, events, incident


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--status", action="store_true", help="Read-only status; no email or ledger writes")
    p.add_argument("--test-email", action="store_true", help="Send one explicit SMTP commissioning test")
    args = p.parse_args()
    if os.getuid() != 1002:
        raise SystemExit("Must run as agentagency-dev UID1002")
    if args.test_email:
        send_mail({"kind": "test"}, uuid.uuid4().hex)
        print("SMTP_TEST_ACCEPTED_BY_SERVER")
        return
    try:
        previous_idle = read_json(DATA / "idle-ready.json", private=True) if (DATA / "idle-ready.json").exists() else {}
        idle_state, idle_events, incident = collect_idle(previous_idle, time.time())
    except Exception:
        incident = {"kind": "monitor_unavailable", "issue": None, "phase": None, "sha": ""}
    if args.status:
        try:
            smtp_config()
            transport = "configured"
        except Exception:
            transport = "not_configured"
        print(json.dumps({"incident": incident, "smtp": transport, "idle": locals().get("idle_state"), "events": locals().get("idle_events", [])}))
        return
    DATA.mkdir(mode=0o700, parents=True, exist_ok=True)
    if DATA.is_symlink() or DATA.stat().st_uid != os.getuid() or stat.S_IMODE(DATA.stat().st_mode) & 0o077:
        raise ValueError("unsafe_state_directory")
    fd = os.open(DATA / "watchdog.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if "idle_state" in locals():
            atomic(DATA / "idle-ready.json", idle_state)
            for event in idle_events:
                print(json.dumps(event, sort_keys=True))
        path = DATA / "delivery.json"
        ledger = read_json(path, private=True) if path.exists() else {}
        result = reconcile(ledger, incident, time.time(), send_mail)
        atomic(path, ledger)
        print(json.dumps({"watchdog": result, "kind": incident["kind"] if incident else None}))
    finally:
        os.close(fd)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # SMTP exceptions may contain auth responses; never log their message/config.
        print(json.dumps({"watchdog": "error", "error_class": type(error).__name__}))
        raise SystemExit(1)
