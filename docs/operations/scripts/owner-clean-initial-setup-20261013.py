#!/usr/bin/env python3
"""Owner-executed initial source installation; not an autonomous completion claim.

This file must be run by the Owner on original Germany, outside the previously
rejected Remote Desktop Commander installer operation. No executor/QA verdict,
canonical admission, Publisher identity or DEV release is synthesized here.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import tempfile

SHA = "70566c0d8aa779b7d35b30c75d346dd59901aa02"
TREE = "1d3a5f320718d377cd757ee3d6db7b12d0353b42"
ROOT = Path("/srv/gobadminton-clean/runner")
SERVICE = "gobadminton-clean-runner.service"
PREIMAGES = {
    "runner.py": "8eda335cfe12a6de91bf0b044ee2d20acf32ce6d1ea07865187317b49eefe6e8",
    "autopilot.py": "5c198535cb57cf3f2e35d95f98c31ef1fa909411f6511de9a4b6729d9b57914e",
}
SUPPORT = ("backlog_sync.py", "publication_guard.py", "writer_bridge.py",
           "test_job_contract.py", "queue_recovery.py", "compact_pm_brief.py",
           "compact_task_capsule.py", "legacy_qa.py")
FILES = (*PREIMAGES, "github_owner_issue_intake.py")
QA = ("test_clean_git_binding_20261013", "test_friends_dag_auto_advance_v001",
      "test_qa23001_protected_job_identity_v001", "test_qa_pr11_git_alias_v001",
      "test_qa_pr11_compact_capsule_v001", "test_qa_pr11_sandbox_control_r3_v001",
      "test_clean_issue_commissioning_v001")

def run(*args, cwd=None):
    return subprocess.run(args, cwd=cwd, check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT).stdout.strip()

def digest(path):
    assert path.is_file() and not path.is_symlink(), str(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()

def put(path, data, mode, uid=0, gid=0):
    assert not path.is_symlink(), str(path)
    fd, name = tempfile.mkstemp(prefix=".initial-setup-", dir=path.parent)
    try:
        os.fchmod(fd, mode)
        os.fchown(fd, uid, gid)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def main():
    assert os.geteuid() == 0 and socket.gethostname().split(".")[0] == "vmi3510488"
    assert shutil.which("sudo") is not None, "source QA requires sudo"
    assert ROOT.resolve() == ROOT and ROOT.stat().st_mode & 0o077 == 0
    account = pwd.getpwnam("agentagency-dev")
    cfg = json.loads((ROOT / "config.json").read_bytes())
    config_preimage = digest(ROOT / "config.json")
    backlog_preimage = digest(ROOT / "backlog.json")
    queue = json.loads((ROOT / "backlog.json").read_bytes())
    state = json.loads((ROOT / "state.json").read_bytes())
    assert cfg["project_repo"] == "anpavel84-afk/gobadminton-clean"
    assert cfg["prod_authorized"] is False and queue["prod_authorized"] is False
    assert cfg.get("github_repo_write_authorized") is False
    assert not state.get("active") and not state.get("current")
    assert all(t.get("enabled") is False for t in queue["tasks"])
    for name, expected in PREIMAGES.items():
        assert digest(ROOT / name) == expected, "PREIMAGE_CHANGED: " + name
    assert not (ROOT / "github_owner_issue_intake.py").exists()
    assert run("systemctl", "is-active", SERVICE) == "active"
    for name in ("gobadminton-clean-autopilot.service", "gobadminton-clean-publisher.service"):
        result = subprocess.run(["systemctl", "is-active", name], capture_output=True, text=True)
        assert result.returncode != 0, "unknown active writer/planner"

    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = Path("/var/backups") / ("gobadminton-clean-initial-" + stamp)
    backup.mkdir(mode=0o700)
    source = backup / "source"
    run("git", "clone", "--no-checkout", "https://github.com/anpavel84-afk/gobadminton-clean.git", str(source))
    run("git", "-C", str(source), "checkout", "--detach", SHA)
    assert run("git", "-C", str(source), "rev-parse", "HEAD") == SHA
    assert run("git", "-C", str(source), "rev-parse", "HEAD^{tree}") == TREE
    modules = source / "_automation/gobadminton-runner/vps"
    for name in SUPPORT:
        assert digest(ROOT / name) == digest(modules / name), "SUPPORT_CHANGED: " + name
    log = run("python3", "-m", "unittest", "-v", *QA, cwd=modules)
    (backup / "operator-source-tests.log").write_text(log + "\n")
    print(log)
    before = backup / "before"
    before.mkdir(mode=0o700)
    for name in (*PREIMAGES, "config.json"):
        shutil.copy2(ROOT / name, before / name)
    installed_expected = {name: digest(modules / name) for name in FILES}
    modified = False
    try:
        run("systemctl", "stop", SERVICE)
        stopped_state = json.loads((ROOT / "state.json").read_bytes())
        assert not stopped_state.get("active") and not stopped_state.get("current")
        assert digest(ROOT / "config.json") == config_preimage, "CONFIG_CHANGED"
        assert digest(ROOT / "backlog.json") == backlog_preimage, "QUEUE_CHANGED"
        for name, preimage_expected in PREIMAGES.items():
            assert digest(ROOT / name) == preimage_expected
        for name in FILES:
            modified = True
            put(ROOT / name, (modules / name).read_bytes(), 0o600, account.pw_uid, account.pw_gid)
        # Intake activates only through the subsequently commissioned Clean
        # Autopilot. No untrusted standalone launcher or second writer is armed.
        cfg["owner_issue_intake_enabled"] = True
        put(ROOT / "config.json", (json.dumps(cfg, indent=2) + "\n").encode(),
            0o600, account.pw_uid, account.pw_gid)
        assert digest(ROOT / "backlog.json") == backlog_preimage
        assert {name: digest(ROOT / name) for name in FILES} == installed_expected, "INSTALLED_BYTES_CHANGED"
        run("systemctl", "start", SERVICE)
        assert run("systemctl", "is-active", SERVICE) == "active"
        receipt = {"installed_source_sha": SHA, "installed_source_tree": TREE,
                   "files_sha256": {name: digest(ROOT / name) for name in FILES},
                   "backup": str(backup), "independent_runtime_qa": "NOT_RUN",
                   "autonomous_status": "COMMISSIONING_NOT_AUTONOMOUS",
                   "remaining": ["clean protected QA job", "single guarded Publisher",
                                 "Clean Autopilot service", "DEV release and rollback job"]}
        put(ROOT / "initial-source-install-receipt.json",
            (json.dumps(receipt, indent=2) + "\n").encode(), 0o600)
        print(json.dumps(receipt, indent=2))
    except BaseException:
        errors = []
        try:
            run("systemctl", "stop", SERVICE)
        except BaseException as exc:
            errors.append("rollback stop: " + repr(exc))
        if modified:
            for name in (*PREIMAGES, "config.json"):
                try:
                    put(ROOT / name, (before / name).read_bytes(), 0o600, account.pw_uid, account.pw_gid)
                except BaseException as exc:
                    errors.append("restore " + name + ": " + repr(exc))
            try:
                (ROOT / "github_owner_issue_intake.py").unlink(missing_ok=True)
            except BaseException as exc:
                errors.append("remove intake module: " + repr(exc))
        try:
            run("systemctl", "start", SERVICE)
        except BaseException as exc:
            errors.append("rollback restart: " + repr(exc))
        print("INITIAL_SETUP_FAILED", "ROLLBACK_ERRORS=" + json.dumps(errors), str(backup))
        raise

if __name__ == "__main__":
    main()
