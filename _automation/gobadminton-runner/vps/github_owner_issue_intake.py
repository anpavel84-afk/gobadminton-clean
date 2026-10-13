"""Trusted read-only GitHub Issue #4 -> existing Owner Inbox adapter.

This is a *transport*, not a Git writer, QA certificate, signed root policy,
service launcher or permission to claim. Disabled unless existing clean Runner
config explicitly enables owner_issue_intake_enabled. GitHub public REST HTTPS
authenticates the Owner comment ID/account; the existing guarded PM publisher
still owns all canonical admission and main CAS.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import tempfile
import time
import urllib.error
import urllib.request
import clean_runtime_access

OWNER_ID = 318610566
OWNER_LOGIN = "anpavel84-afk"
REPOSITORY = "anpavel84-afk/gobadminton-clean"
ISSUE = 4
ISSUE_URL = f"https://api.github.com/repos/{REPOSITORY}/issues/{ISSUE}"
COMMENTS_URL = ISSUE_URL + "/comments?per_page=100&page="
COMMENT_URL = f"https://api.github.com/repos/{REPOSITORY}/issues/comments/"
OWNER_BOOTSTRAP_COMMENT = 6148670164
OWNER_BOOTSTRAP_CREATED = "2026-10-13T15:08:14Z"
# SHA256 of the original GitHub API body UTF-8 bytes, without normalization.
OWNER_BOOTSTRAP_BODY_SHA256 = "2d3cf0e888a45546512164372818d19355d1eff519b34648b35e7221d1626751"
INTERVAL_SECONDS = 300
MAX_BACKOFF_SECONDS = 3600
DEFAULT_OPENER = urllib.request.urlopen
BUDGET_FILE = 'github-issue-intake-poll-budget.json'
MAX_COMMENT_BYTES = 16_384
MAX_PAGES = 3
MARKER = "GOBADMINTON_PM_TASK_V1"
TASK_ID = re.compile(r"[a-z][a-z0-9-]{4,95}")
BOOTSTRAP_IDS = (
    "friends-dev-s1-api-20261013-v001",
    "qa-friends-dev-s1-api-20261013-v001",
    "radar-dev-map-ui-20261013-v001",
    "qa-radar-dev-map-ui-20261013-v001",
)


class IntakeHold(RuntimeError):
    """Source/Owner identity or runtime state cannot be trusted."""


class IntakeHTTPHold(IntakeHold):
    def __init__(self, status, reset):
        super().__init__('GitHub public API HTTP ' + str(status))
        self.http_status = status
        self.rate_limit_reset = reset


class PollResult(list):
    """Transport telemetry only. Does not authenticate an Owner or grant work."""
    def __init__(self, values=(), *, poll_status='polled', next_poll_epoch=None):
        super().__init__(values)
        self.poll_status = poll_status
        self.next_poll_epoch = next_poll_epoch


def checked_time(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise IntakeHold('invalid polling clock/budget timestamp')
    return value


def retry_hold(reason, next_poll):
    error = IntakeHold(reason + ' OWNER_INTAKE_RETRY_UNTIL=' + str(math.ceil(next_poll)))
    error.retry_after_epoch = math.ceil(next_poll)
    error.poll_status = 'held'
    return error


def read_budget(root, when):
    path = root / BUDGET_FILE
    if not clean_runtime_access.directory_allowed(root, os.getuid()):
        raise IntakeHold('poll budget control root is not service-private')
    if not path.exists() and not path.is_symlink():
        return None
    fd = -1
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_uid != os.getuid()
                or stat.S_IMODE(before.st_mode) != 0o600 or not 0 < before.st_size <= 16384):
            raise IntakeHold('poll budget is not a bounded service-private regular file')
        raw = os.read(fd, 16385)
        after = os.fstat(fd)
        current = path.lstat()
        identity = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        if identity(before) != identity(after) or identity(before) != identity(current) or len(raw) != before.st_size:
            raise IntakeHold('poll budget changed during read')
        value = strict_json(raw.decode('utf-8'))
        fields = {'schema', 'last_poll_epoch', 'next_poll_epoch', 'last_status', 'last_error', 'http_status'}
        if (not isinstance(value, dict) or set(value) != fields or value.get('schema') != 'GBCLEAN_OWNER_POLL_BUDGET_V1'
                or value.get('last_status') not in {'POLLING', 'OK', 'HELD'}
                or not isinstance(value.get('last_error'), str) or len(value['last_error']) > 160
                or value.get('http_status') is not None and (type(value['http_status']) is not int or not 100 <= value['http_status'] <= 599)):
            raise IntakeHold('poll budget schema/telemetry refused')
        last = checked_time(value['last_poll_epoch'])
        upcoming = checked_time(value['next_poll_epoch'])
        if not last + INTERVAL_SECONDS <= upcoming <= last + MAX_BACKOFF_SECONDS or last > when:
            raise IntakeHold('poll budget timestamp range/clock reversal refused')
        return value
    except (OSError, ValueError, UnicodeError) as exc:
        raise IntakeHold('poll budget unreadable/malformed') from exc
    finally:
        if fd >= 0:
            os.close(fd)


def write_budget(root, value):
    # Separate private state, not an Owner inbox event or approval certificate.
    if not clean_runtime_access.directory_allowed(root, os.getuid()):
        raise IntakeHold('poll budget control root is not service-private')
    path = root / BUDGET_FILE
    if path.is_symlink():
        raise IntakeHold('poll budget symlink refused')
    fd, temporary = tempfile.mkstemp(prefix='.owner-poll-budget-', dir=root)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write((json.dumps(value, sort_keys=True, allow_nan=False) + '\n').encode())
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent)
        finally:
            os.close(parent)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def next_retry(when, error):
    target = when + INTERVAL_SECONDS
    if getattr(error, 'http_status', None) == 403:
        reset = getattr(error, 'rate_limit_reset', None)
        if isinstance(reset, str) and re.fullmatch('[0-9]{1,16}', reset):
            target = max(target, min(int(reset) + 1, when + MAX_BACKOFF_SECONDS))
    return target


def strict_json(source: str):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            if name in result:
                raise IntakeHold("duplicate JSON key in trusted Owner request")
            result[name] = value
        return result
    return json.loads(source, object_pairs_hook=unique)


def checked_comment(comment: dict, canonical: dict, *, require_queued: bool = True) -> dict | None:
    """Return a bounded inbox instruction, or None for non-dispatch comments."""
    if not isinstance(comment, dict):
        raise IntakeHold("untrusted GitHub comment type")
    user = comment.get("user")
    if (not isinstance(user, dict) or user.get("id") != OWNER_ID
            or user.get("login") != OWNER_LOGIN or user.get("type") != "User"):
        return None   # Public issue is readable/commentable by anyone.
    cid = comment.get("id")
    if (type(cid) is not int or cid < 1
            or comment.get("issue_url") != ISSUE_URL
            or comment.get("url") != COMMENT_URL + str(cid)):
        raise IntakeHold("Owner comment identity / parent issue mismatch")
    body = comment.get("body")
    if not isinstance(body, str) or len(body.encode("utf-8")) > MAX_COMMENT_BYTES:
        raise IntakeHold("Owner comment body invalid or too large")
    body_sha256 = hashlib.sha256(body.encode("utf-8")).hexdigest()
    if cid == OWNER_BOOTSTRAP_COMMENT:
        if (comment.get("created_at") != OWNER_BOOTSTRAP_CREATED
                or comment.get("updated_at") != OWNER_BOOTSTRAP_CREATED
                or body_sha256 != OWNER_BOOTSTRAP_BODY_SHA256):
            raise IntakeHold("historical exact Owner commissioning intent modified")
        task_ids = list(BOOTSTRAP_IDS)
    elif body.startswith(MARKER + "\n"):
        try:
            item = strict_json(body[len(MARKER) + 1:])
        except (ValueError, TypeError) as exc:
            raise IntakeHold("malformed Owner task JSON") from exc
        if (not isinstance(item, dict)
                or set(item) != {"schema", "issue", "task_ids", "effect_ceiling"}
                or item.get("schema") != MARKER
                or item.get("issue") != ISSUE
                or item.get("effect_ceiling") != "source_only"):
            raise IntakeHold("Owner request exceeds bounded DEV source scope")
        task_ids = item.get("task_ids")
        if (not isinstance(task_ids, list) or not 1 <= len(task_ids) <= 6
                or any(not isinstance(t, str) or not TASK_ID.fullmatch(t)
                       for t in task_ids)
                or len(task_ids) != len(set(task_ids))):
            raise IntakeHold("unbounded Owner task identifiers")
    else:
        return None
    if len(task_ids) != len(set(task_ids)):
        raise IntakeHold("duplicate task")
    tasks = {t.get("id"): t for t in canonical.get("tasks", [])
             if isinstance(t, dict)}
    import backlog_sync  # identical source trust predicate used at main sync.
    for task_id in task_ids:
        task = tasks.get(task_id)
        if (not task or task.get("effect_ceiling") != "source_only"
                or require_queued and task.get("status", "queued") != "queued"
                or any(not backlog_sync.FULL_GITHUB_SOURCE.fullmatch(
                    str(task.get(key) or "")) for key in ("source", "admission"))):
            raise IntakeHold("task not prepared as exact immutable DEV source")
    return {
        "id": f"github-issue{ISSUE}-comment-{cid}",
        "origin": "VERIFIED_GITHUB_OWNER_ISSUE",
        "status": "NEW",
        "project": "GoBadminton",
        "text": body,
        "text_sha256": body_sha256,
        "task_ids": task_ids,
        "source_url": f"https://github.com/{REPOSITORY}/issues/{ISSUE}#issuecomment-{cid}",
        "github_comment_id": cid,
        "github_owner_id": OWNER_ID,
        "created_at": comment.get("created_at"),
        "scope": "SOURCE_ONLY_DEV_NO_PROD",
    }


def fetch_public_comment_pages(opener=DEFAULT_OPENER):
    """Only the fixed GitHub API endpoint. Never follow untrusted URLs."""
    all_comments = []
    for page in range(1, MAX_PAGES + 1):
        url = COMMENTS_URL + str(page)
        request = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "GoBadminton-Clean-Owner-Intake/1",
        })
        try:
            response = opener(request, timeout=12)
            with response as stream:
                if stream.geturl() != url:
                    raise IntakeHold("GitHub API redirected unexpectedly")
                payload = stream.read(512 * 1024 + 1)
        except urllib.error.HTTPError as exc:
            raise IntakeHTTPHold(exc.code, exc.headers.get('X-RateLimit-Reset') if exc.headers is not None else None) from exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise IntakeHold("GitHub public API unavailable") from exc
        if len(payload) > 512 * 1024:
            raise IntakeHold("GitHub public issue page oversized")
        try:
            page_comments = strict_json(payload.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise IntakeHold("invalid GitHub public API JSON") from exc
        if not isinstance(page_comments, list):
            raise IntakeHold("unexpected GitHub public issue response")
        all_comments.extend(page_comments)
        if len(page_comments) < 100:
            return all_comments
    raise IntakeHold("Owner issue exceeds bounded page intake; no silent skip")


def write_unique(inbox: Path, record: dict) -> bool:
    """Never rewrite/overwrite an existing source event or planner disposition."""
    if not inbox.exists():
        if inbox.is_symlink():
            raise IntakeHold("Owner inbox is an unexpected symlink")
        parent = inbox.parent
        try:
            proof = parent.lstat()
        except OSError as exc:
            raise IntakeHold("Runner control directory absent") from exc
        try:
            allowed = clean_runtime_access.directory_allowed(parent, os.getuid())
        except (clean_runtime_access.AccessHold, OSError):
            allowed = False
        if not allowed:
            raise IntakeHold("Runner control directory not private/service-owned")
        try:
            inbox.mkdir(mode=0o700)
        except FileExistsError:
            pass
    if inbox.is_symlink() or not inbox.is_dir():
        raise IntakeHold("Owner inbox directory symlinked or invalid")
    info = inbox.stat()
    if (info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077):
        raise IntakeHold("Owner inbox must be service-owned and private")
    target = inbox / (record["id"] + ".json")
    encoded = (json.dumps(record, sort_keys=True, ensure_ascii=False) + "\n").encode()
    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL |
                     os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except FileExistsError:
        if target.is_symlink():
            raise IntakeHold("Owner inbox event replaced by symlink")
        try:
            old = strict_json(target.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise IntakeHold("existing Owner event corrupt") from exc
        if (old.get("id") != record["id"] or
                old.get("text_sha256") != record["text_sha256"] or
                old.get("github_comment_id") != record["github_comment_id"] or
                old.get("task_ids") != record["task_ids"]):
            raise IntakeHold("Owner GitHub event edited/replayed after receipt")
        return False
    with os.fdopen(fd, "wb") as out:
        out.write(encoded)
        out.flush()
        os.fsync(out.fileno())
    parent = os.open(inbox, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(parent)
    finally:
        os.close(parent)
    return True


def poll_once(root: Path, canonical: dict, *, opener=DEFAULT_OPENER,
              now: float | None = None) -> list[str]:
    """Read and journal Owner proof only. No claim, model, Git write or deploy."""
    if (not isinstance(canonical, dict)
            or canonical.get("project") != "GoBadminton"
            or canonical.get("prod_authorized") is not False):
        raise IntakeHold("canonical clean queue not trustworthy")
    inbox = Path(root) / "owner-inbox"
    marker = Path(root) / "github-issue-intake-last-poll"
    when = checked_time(time.time() if now is None else now)
    live_budget = opener is DEFAULT_OPENER
    budget = read_budget(Path(root), when) if live_budget else None
    if marker.exists() or marker.is_symlink():
        proof = marker.lstat()
        if (not stat.S_ISREG(proof.st_mode) or proof.st_uid != os.getuid()
                or proof.st_nlink != 1 or proof.st_size != 0
                or stat.S_IMODE(proof.st_mode) & 0o077):
            raise IntakeHold("issue intake poll marker is not service-private")
        if proof.st_mtime > when:
            raise IntakeHold('issue intake poll marker clock reversal/future timestamp')
    if budget is not None and when < budget['next_poll_epoch']:
        if budget['last_status'] == 'OK':
            return PollResult(poll_status='no_new_poll', next_poll_epoch=budget['next_poll_epoch'])
        raise retry_hold('Owner intake HELD; fresh GitHub poll deferred', budget['next_poll_epoch'])
    if marker.exists():
        if when - proof.st_mtime < INTERVAL_SECONDS:
            if live_budget and budget is None:
                # Old success marker has no authenticated durable budget/status.
                # Do not treat its mtime as cached Owner verification.
                raise retry_hold('Owner intake legacy marker awaiting fresh poll', proof.st_mtime + INTERVAL_SECONDS)
            return PollResult(poll_status='no_new_poll', next_poll_epoch=proof.st_mtime + INTERVAL_SECONDS)
    if live_budget:
        budget = {'schema': 'GBCLEAN_OWNER_POLL_BUDGET_V1', 'last_poll_epoch': when,
                  'next_poll_epoch': when + INTERVAL_SECONDS, 'last_status': 'POLLING',
                  'last_error': '', 'http_status': None}
        write_budget(Path(root), budget)  # Reserve before network; crash/restart cannot flood.
    # Historical events retain identity/body/scope verification after tasks
    # advance. An existing receipt must still pass write_unique replay checks;
    # only a NEW event requires every task to remain queued.
    try:
        verified = []
        for comment in fetch_public_comment_pages(opener):
            cid = comment.get("id") if isinstance(comment, dict) else None
            existing = (inbox / f"github-issue{ISSUE}-comment-{cid}.json"
                        if type(cid) is int and cid > 0 else None)
            record = checked_comment(comment, canonical, require_queued=not (
                existing is not None and (existing.exists() or existing.is_symlink())))
            if record is not None:
                verified.append(record)
        created = []
        for item in verified:
            if write_unique(inbox, item):
                created.append(item["id"])
    except IntakeHold as error:
        if not live_budget:
            raise
        budget.update(last_status='HELD', next_poll_epoch=next_retry(when, error),
                      last_error='HTTP_FAILURE' if isinstance(error, IntakeHTTPHold) else 'SOURCE_VERIFICATION_HELD',
                      http_status=getattr(error, 'http_status', None))
        write_budget(Path(root), budget)
        raise retry_hold(str(error), budget['next_poll_epoch']) from error
    # Throttle only after every comment has passed verification and journaling.
    marker.touch(mode=0o600, exist_ok=True)
    os.utime(marker, (when, when))
    if live_budget:
        budget.update(last_status='OK', last_error='', http_status=None)
        write_budget(Path(root), budget)
    return PollResult(created, next_poll_epoch=when + INTERVAL_SECONDS)
