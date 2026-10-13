"""Source-only cooperating v2 bridge, OFF unless trusted policy is injected.

No runtime loader or activation authority is provided. Process-local policy is
for disposable tests and a future separately reviewed installation adapter.
This cooperative gate does not constrain raw Git with bypassed hooks.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
import fcntl
import os
from pathlib import Path
import stat
from typing import Iterator

PROTOCOL = "CLAIMS_AND_PUBLISHERS_SHARE_FLOCK_V1"


class BridgeHold(RuntimeError):
    """Redacted fail-closed refusal; callers must never reinterpret as admission."""


@dataclass(frozen=True)
class LeasePin:
    """Trusted caller-owned identity, never loaded from untrusted task input."""

    path: Path
    device: int
    inode: int
    uid: int
    gid: int
    mode: int


def _check(pin: LeasePin, metadata: os.stat_result) -> None:
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
            or (metadata.st_dev, metadata.st_ino, metadata.st_uid,
                metadata.st_gid, stat.S_IMODE(metadata.st_mode)) !=
            (pin.device, pin.inode, pin.uid, pin.gid, pin.mode)
            or pin.mode not in (0o600, 0o660)):
        raise BridgeHold("HOLD: shared lease identity/type/ownership/mode changed")


@contextmanager
def writer_section(*, enabled: bool = False,
                   pin: LeasePin | None = None) -> Iterator[None]:
    """Nonblocking, nonrecursive OS lease; never use around remote I/O/workers.

    Each caller opens a distinct descriptor, including calls in the same process.
    Nested use refuses immediately instead of deadlocking. Check each directory
    via openat/O_NOFOLLOW, then check the pinned file before and after flock and
    before release. Trusted provisioning must prevent directory replacement by
    untrusted writers. No filesystem effects when disabled.
    """
    if not enabled:
        yield
        return
    if pin is None or not pin.path.is_absolute() or ".." in pin.path.parts:
        raise BridgeHold("HOLD: trusted absolute preprovisioned lease pin required")
    directory_fd = -1
    lease_fd = -1
    try:
        directory_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        for component in pin.path.parts[1:-1]:
            next_fd = os.open(component, os.O_RDONLY | os.O_DIRECTORY |
                              os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        name = pin.path.name
        lease_fd = os.open(name, os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC |
                           os.O_NONBLOCK, dir_fd=directory_fd)
        _check(pin, os.fstat(lease_fd))
        fcntl.flock(lease_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _check(pin, os.stat(name, dir_fd=directory_fd, follow_symlinks=False))
        _check(pin, pin.path.lstat())
        yield
        _check(pin, os.fstat(lease_fd))
        _check(pin, pin.path.lstat())
    except OSError as error:
        raise BridgeHold("HOLD: shared lease unavailable or busy") from error
    finally:
        if lease_fd >= 0:
            os.close(lease_fd)
        if directory_fd >= 0:
            os.close(directory_fd)


# Explicit trusted configuration; never infer authority from environment/task JSON.
# Cross-process activation/fencing remains a deployment design blocker.
import hashlib
import json
import threading


@dataclass(frozen=True)
class BridgePolicy:
    pin: LeasePin
    epoch: int
    handoff_path: Path
    handoff_sha256: str
    owner_ref: str
    plan_sha: str
    publisher_id: str
    independent_proofs: tuple[str, ...]
    installed_modules: tuple[tuple[Path, str], ...]


_POLICY: BridgePolicy | None = None
_LOCAL = threading.local()

# Root owns this file, not the Runner v2 agent. Absent file means OFF.
# This explicit path is a source contract; Stage B2 does not install it.
ROOT_POLICY_PATH = Path("/etc/gobadminton-control-plane-v3/v2-writer-bridge-policy.json")
_POLICY_MAX_BYTES = 32_768


def _secure_regular_bytes(path: Path, *, owner: int | None = None,
                          max_bytes: int = _POLICY_MAX_BYTES) -> bytes:
    """No path traversal, symlink, device, FIFO, hardlink or TOCTOU re-read."""
    if not path.is_absolute() or ".." in path.parts:
        raise BridgeHold("HOLD: absolute trusted path required")
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK
    parent = -1
    fd = -1
    try:
        parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        for segment in path.parts[1:-1]:
            nxt = os.open(
                segment, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW |
                os.O_CLOEXEC, dir_fd=parent,
            )
            os.close(parent)
            parent = nxt
        fd = os.open(path.name, flags, dir_fd=parent)
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or
                before.st_size > max_bytes or before.st_size < 1):
            raise BridgeHold("HOLD: unsafe or oversized policy/evidence file")
        if owner is not None and (
            before.st_uid != owner or stat.S_IMODE(before.st_mode) & 0o022
        ):
            raise BridgeHold("HOLD: root policy owner or permissions invalid")
        data = os.read(fd, max_bytes + 1)
        after = os.fstat(fd)
        if (len(data) > max_bytes or
                os.stat(path.name, dir_fd=parent, follow_symlinks=False).st_ino != before.st_ino or
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns,
                 before.st_ctime_ns) !=
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                 after.st_ctime_ns) or
                len(data) != before.st_size):
            raise BridgeHold("HOLD: policy/evidence mutated during secure read")
        return data
    except OSError as exc:
        raise BridgeHold("HOLD: trusted policy/evidence inaccessible") from exc
    finally:
        if fd >= 0:
            os.close(fd)
        if parent >= 0:
            os.close(parent)


def _securely_missing_policy(path: Path) -> bool:
    """Distinguish a truly unprovisioned policy from a blocked/symlinked one.

    A missing parent directory still means legacy OFF. Traversal follows no
    symlinks and any permission/type failure is a HOLD rather than fallback.
    The production /etc ancestors must remain root-provisioned separately.
    """
    if not path.is_absolute() or ".." in path.parts:
        raise BridgeHold("HOLD: trusted policy location invalid")
    fd = -1
    try:
        fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        for component in path.parts[1:-1]:
            try:
                next_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW |
                    os.O_CLOEXEC, dir_fd=fd,
                )
            except FileNotFoundError:
                return True
            os.close(fd)
            fd = next_fd
        try:
            os.stat(path.name, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return True
        return False
    except OSError as exc:
        raise BridgeHold("HOLD: policy path cannot be securely inspected") from exc
    finally:
        if fd >= 0:
            os.close(fd)


def _runtime_policy() -> BridgePolicy | None:
    """Read a root-owned exact policy in every cooperating process.

    No request, environment, task, user profile or in-memory activation hook
    enables the deployed bridge. A missing file is OFF; malformed existing
    policy is HOLD, never a silent return to the unguarded v2 behavior.

    The policy file only binds artifacts; later live cutover still requires
    verified GitHub write-credential segregation and native Publisher QA.
    """
    try:
        raw = _secure_regular_bytes(ROOT_POLICY_PATH, owner=0)
    except BridgeHold as exc:
        # The *entire missing directory chain* is legitimate legacy OFF.
        # Malformed, symlinked, unreadable or replaced existing files are HOLD.
        if _securely_missing_policy(ROOT_POLICY_PATH):
            return None
        raise exc
    try:
        value = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("expected object")
        if value.get("mode") == "DISABLED":
            if value != {"schema_version": 1, "mode": "DISABLED"}:
                raise ValueError("malformed disabled marker")
            return None
        required = {
            "schema_version", "mode", "protocol", "bridge_protocol",
            "epoch", "handoff_path", "handoff_sha256",
            "lease_pin", "owner_ref", "plan_sha", "publisher_id",
            "independent_proofs", "installed_modules",
        }
        if set(value) != required or value["schema_version"] != 1 or (
            value["mode"] != "ACTIVE_SOURCE_ONLY" or
            value["protocol"] != "GBCP_B1_V001" or
            value["bridge_protocol"] != PROTOCOL or
            type(value["epoch"]) is not int or value["epoch"] < 1
        ):
            raise ValueError("unknown schema, mode or epoch")
        pin_data = value["lease_pin"]
        pin_fields = {"path", "device", "inode", "uid", "gid", "mode"}
        if not isinstance(pin_data, dict) or set(pin_data) != pin_fields:
            raise ValueError("invalid kernel lease pin")
        if any(type(pin_data[x]) is not int or pin_data[x] < 0
               for x in pin_fields if x != "path") or not isinstance(pin_data["path"], str):
            raise ValueError("invalid inode numeric identity")
        modules = value["installed_modules"]
        if not isinstance(modules, list) or len(modules) != 3:
            raise ValueError("missing installed modules")
        module_tuples = []
        for item in modules:
            if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
                raise ValueError("invalid installed module binding")
            if not isinstance(item["path"], str) or not isinstance(item["sha256"], str):
                raise ValueError("invalid installed module type")
            module_tuples.append((Path(item["path"]), item["sha256"]))
        proofs = value["independent_proofs"]
        if not isinstance(proofs, list) or len(proofs) != 3 or not all(
                isinstance(x, str) and x for x in proofs):
            raise ValueError("missing exact QA authority refs")
        strings = ("handoff_path", "handoff_sha256", "owner_ref", "plan_sha", "publisher_id")
        if any(not isinstance(value[k], str) or not value[k] for k in strings):
            raise ValueError("invalid immutable authority strings")
        if len(value["handoff_sha256"]) != 64 or len(value["plan_sha"]) != 40:
            raise ValueError("invalid digest or plan SHA")
        if any(len(item[1]) != 64 for item in module_tuples):
            raise ValueError("invalid module digest")
        policy = BridgePolicy(
            pin=LeasePin(Path(pin_data["path"]), pin_data["device"],
                         pin_data["inode"], pin_data["uid"], pin_data["gid"],
                         pin_data["mode"]),
            epoch=value["epoch"], handoff_path=Path(value["handoff_path"]),
            handoff_sha256=value["handoff_sha256"],
            owner_ref=value["owner_ref"], plan_sha=value["plan_sha"],
            publisher_id=value["publisher_id"],
            independent_proofs=tuple(proofs),
            installed_modules=tuple(module_tuples),
        )
        validate_policy(policy)
        return policy
    except (KeyError, ValueError, TypeError, AttributeError) as exc:
        raise BridgeHold("HOLD: invalid root-owned bridge policy") from exc


def _effective_policy() -> BridgePolicy | None:
    return _POLICY if _POLICY is not None else _runtime_policy()


def validate_policy(policy: BridgePolicy) -> None:
    """Validate exact pinned evidence; pins require external independent approval.

    Reading matching evidence is not verification of Owner/QA authority. This
    adapter may only receive already independently verified immutable pins.
    """
    try:
        raw = _secure_regular_bytes(policy.handoff_path)
        if hashlib.sha256(raw).hexdigest() != policy.handoff_sha256:
            raise BridgeHold("HOLD: handoff bytes changed")
        evidence = json.loads(raw)
        modules = {path.name: digest for path, digest in policy.installed_modules}
        if (type(policy.epoch) is not int or policy.epoch < 1
                or not policy.owner_ref or not policy.plan_sha or not policy.publisher_id
                or len(policy.independent_proofs) != 3
                or any(not proof for proof in policy.independent_proofs)
                or set(modules) != {"runner.py", "autopilot.py", "backlog_sync.py"}
                or len(policy.installed_modules) != 3
                or not isinstance(evidence, dict)
                or evidence.get("protocol") != "GBCP_B1_V001"
                or evidence.get("bridge_protocol") != PROTOCOL
                or evidence.get("project") != "GoBadminton"
                or type(evidence.get("epoch")) is not int
                or evidence.get("epoch") != policy.epoch
                or evidence.get("disabled_v2_classes") != ["ADMIT_PAIR"]
                or evidence.get("owner_ref") != policy.owner_ref
                or evidence.get("plan_sha") != policy.plan_sha
                or evidence.get("publisher_id") != policy.publisher_id
                or evidence.get("shared_lease_path") != str(policy.pin.path)
                or evidence.get("installed_modules") != modules):
            raise BridgeHold("HOLD: epoch/class/authority/module binding invalid")
        for path, digest in policy.installed_modules:
            if hashlib.sha256(_secure_regular_bytes(path, max_bytes=2_097_152)).hexdigest() != digest:
                raise BridgeHold("HOLD: installed module digest changed")
        # The three exact immutable proof pins are supplied by trusted caller,
        # not minted from fields in the handoff (B1 schema has no such fields).
    except (OSError, ValueError, TypeError) as error:
        raise BridgeHold("HOLD: bridge evidence unavailable or malformed") from error


@contextmanager
def bridge_section() -> Iterator[None]:
    """Short local mutation boundary; nested cooperating adapters borrow lease.

    The primitive itself remains strictly nonrecursive. Only this thread's
    already-held identical policy may be borrowed; no cross-thread borrowing.
    """
    policy = _effective_policy()
    if policy is None:
        yield
        return
    if getattr(_LOCAL, "policy", None) == policy:
        validate_policy(policy)
        yield
        return
    with writer_section(enabled=True, pin=policy.pin):
        validate_policy(policy)
        _LOCAL.policy = policy
        try:
            yield
            if _effective_policy() != policy:
                raise BridgeHold("HOLD: policy changed during mutation")
        finally:
            del _LOCAL.policy


def deny_admit_pair(*, has_admission: bool, verified_repair: bool = False) -> None:
    """Call under short lease after deriving delta from actual Git blobs.

    A repair exemption requires the existing recovery ledger validation first.
    Never trust receipt action/class alone to classify a publication.
    """
    with bridge_section():
        if _effective_policy() is not None and has_admission and not verified_repair:
            raise BridgeHold("HOLD: ADMIT_PAIR delegated at validated epoch")
