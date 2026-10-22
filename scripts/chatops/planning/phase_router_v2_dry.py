#!/usr/bin/python3
"""PRELAUNCH ONLY. Pure role/model and replan simulator; no runtime authority/effects.

Real admission still requires independently verified GitHub Owner/delegation evidence
and the installed receiver's exact task schema. This library cannot assert either.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence
import re

RISK = frozenset({"routine", "complex", "critical", "exploratory"})
ROLE = frozenset({"intake", "architecture", "ux", "implementation", "independent_qa",
                  "diagnosis", "ci", "dev", "owner_uat", "ops"})
NO_MODEL = frozenset({"ci", "dev", "owner_uat", "ops"})
SHA = re.compile(r"[0-9a-f]{40}\Z")

# Static model IDs. Catalog presence != proved inference, role permission, quota or
# Owner model authorization. Route order is by capability/phase, NOT tokens remaining.
ROUTES: dict[tuple[str, str], tuple[str, ...]] = {
    ("intake", "routine"): ("codex:gpt-6.1-sol:medium", "codex:gpt-6-luna:medium"),
    ("intake", "complex"): ("codex:gpt-6.1-sol:medium", "codex:gpt-6-astra:medium"),
    ("intake", "critical"): ("codex:gpt-6-astra:medium", "codex:gpt-6.1-sol:high"),
    ("intake", "exploratory"): ("codex:gpt-6.1-sol:high", "codex:gpt-6-astra:medium"),
    ("architecture", "routine"): ("codex:gpt-6.1-sol:high", "codex:gpt-6-astra:low"),
    ("architecture", "complex"): ("codex:gpt-6-astra:medium", "codex:gpt-6.1-sol:high"),
    ("architecture", "critical"): ("codex:gpt-6-astra:high", "codex:gpt-6.1-sol:high"),
    ("architecture", "exploratory"): ("codex:gpt-6-astra:medium", "codex:gpt-6-astra:high"),
    ("ux", "routine"): ("agy:claude-sonnet-5-5-medium", "codex:gpt-6.1-sol:medium"),
    ("ux", "complex"): ("agy:claude-sonnet-5-5-high", "codex:gpt-6.1-sol:high"),
    ("ux", "critical"): ("agy:claude-opus-5-5-high", "codex:gpt-6-astra:medium"),
    ("ux", "exploratory"): ("agy:claude-sonnet-5-5-high", "codex:gpt-6.1-sol:high"),
    ("implementation", "routine"): ("cursor:auto", "codex:gpt-6.1-sol:medium", "codex:gpt-6.1-sol:high"),
    ("implementation", "complex"): ("cursor:auto", "codex:gpt-6.1-sol:high", "codex:gpt-6-astra:medium"),
    ("implementation", "critical"): ("cursor:auto", "codex:gpt-6.1-sol:high", "codex:gpt-6-astra:medium"),
    ("implementation", "exploratory"): ("cursor:auto", "codex:gpt-6.1-sol:high"),
    ("independent_qa", "routine"): ("agy:claude-sonnet-5-5-medium", "codex:gpt-6.1-sol:medium"),
    ("independent_qa", "complex"): ("agy:claude-sonnet-5-5-high", "agy:claude-opus-5-5-high", "codex:gpt-6.1-sol:high"),
    ("independent_qa", "critical"): ("agy:claude-opus-5-5-high", "codex:gpt-6-astra:high"),
    ("independent_qa", "exploratory"): ("agy:claude-opus-5-5-high", "codex:gpt-6-astra:medium"),
    ("diagnosis", "routine"): ("codex:gpt-6.1-sol:medium", "codex:gpt-6.1-sol:high"),
    ("diagnosis", "complex"): ("codex:gpt-6.1-sol:high", "codex:gpt-6-astra:medium"),
    ("diagnosis", "critical"): ("codex:gpt-6-astra:high", "codex:gpt-6.1-sol:high"),
    ("diagnosis", "exploratory"): ("codex:gpt-6.1-sol:high", "codex:gpt-6-astra:medium"),
}
assert set(ROUTES) == {(r, risk) for r in ROLE-NO_MODEL for risk in RISK}


@dataclass(frozen=True)
class Capability:
    model: str
    proven: bool
    allowed_for_stage: bool
    positive_quota_evidence: bool
    read_only_qa: bool = False


@dataclass(frozen=True)
class Stage:
    role: str
    risk: str
    approved_models: tuple[str, ...]
    exact_scope_authorized: bool
    # Must be separately validated by the root admission path, never accepted
    # merely because the model or our simulator sets it True.
    architecture_frozen: bool = False
    architecture_proof_sha: str | None = None
    candidate_sha: str | None = None
    author_identity: str | None = None
    author_session: str | None = None
    author_worktree: str | None = None


def _sha(value: str | None) -> bool:
    return bool(isinstance(value, str) and SHA.fullmatch(value))


def propose(stage: Stage, available: Mapping[str, Capability], *,
            qa_identity: str | None = None, qa_session: str | None = None,
            qa_worktree: str | None = None, qa_candidate_sha: str | None = None,
            exclude: Sequence[str] = ()) -> dict:
    """Read-only candidate recommendation, *never* a signed admission."""
    if stage.role not in ROLE or stage.risk not in RISK:
        return {"status": "BLOCKED", "reason": "unknown role/risk"}
    if not stage.exact_scope_authorized:
        return {"status": "BLOCKED", "reason": "missing immutable Owner/delegated task admission"}
    if stage.role == "owner_uat":
        return {"status": "AWAIT_OWNER_ACCEPTANCE", "model": None,
                "reason": "human product decision; no assistant can attest it"}
    if stage.role in NO_MODEL:
        return {"status": "DETERMINISTIC_PENDING_GATES", "model": None,
                "reason": "real Actions/root receipt gate still required, not a model PASS"}
    if stage.role == "implementation":
        if stage.risk == "exploratory":
            return {"status": "BLOCKED", "reason": "exploratory code needs completed diagnosis and risk reclassification"}
        if stage.risk in ("complex", "critical") and not (
            stage.architecture_frozen and _sha(stage.architecture_proof_sha)
        ):
            return {"status": "BLOCKED", "reason": "verified frozen architecture artifact required"}
    if stage.role == "independent_qa":
        # All identities must come from separately verified stage/commit metadata.
        values = (stage.author_identity, stage.author_session, stage.author_worktree,
                  qa_identity, qa_session, qa_worktree)
        if not all(isinstance(v, str) and bool(v.strip()) for v in values):
            return {"status": "BLOCKED", "reason": "missing independent QA process/session/worktree evidence"}
        if (stage.author_identity == qa_identity or stage.author_session == qa_session or
                stage.author_worktree == qa_worktree):
            return {"status": "BLOCKED", "reason": "QA process/session/worktree must differ from author"}
        if not _sha(stage.candidate_sha) or qa_candidate_sha != stage.candidate_sha:
            return {"status": "BLOCKED", "reason": "QA must target exact candidate SHA"}
    permitted = set(stage.approved_models)
    for candidate in ROUTES[(stage.role, stage.risk)]:
        if candidate not in permitted or candidate in exclude:
            continue
        c = available.get(candidate)
        if c is None or c.model != candidate or not all(
            (c.proven, c.allowed_for_stage, c.positive_quota_evidence)
        ):
            continue
        if stage.role == "independent_qa" and not c.read_only_qa:
            continue
        return {"status": "PROPOSED_NOT_AUTHORIZED", "model": candidate,
                "reason": f"role/risk fit: {stage.role}/{stage.risk}; separate permissions still required"}
    return {"status": "WAIT_PROVIDER_OR_PERMISSION",
            "reason": "no preapproved, qualified model with evidence of available allowance"}


def after_failure(*, kind: str, stage: Stage, consumed_attempts: int,
                  max_attempts: int, effect_state: str,
                  same_attempt_reservation_valid: bool = False,
                  current_model: str) -> dict:
    """Finite replanning proposal, no charge, retry, permission or model call."""
    if (type(consumed_attempts) is not int or type(max_attempts) is not int or
            not 0 <= consumed_attempts <= max_attempts <= 3 or max_attempts < 1):
        return {"status": "BLOCKED", "reason": "invalid integer immutable attempt ledger"}
    if effect_state not in ("NO_EFFECT", "KNOWN_EFFECT", "UNKNOWN_EFFECT"):
        return {"status": "BLOCKED", "reason": "unknown effect state"}
    if effect_state == "UNKNOWN_EFFECT" or kind in (
        "unknown_effect", "unknown_commit", "uncertain_timeout"
    ):
        return {"status": "RECONCILE_ONLY", "reason": "unknown writer effect; no second author"}
    # CI infrastructure failure is not a source QA/model failure, even if source
    # attempts are exhausted. This does NOT restore source attempts.
    if kind == "ci_environment_failure":
        return {"status": "OPS_EVIDENCE", "reason": "infrastructure stage, no source attempt reset"}
    if consumed_attempts == max_attempts:
        return {"status": "DEFERRED", "reason": "source attempt ceiling reached; no fourth try"}
    if kind in ("provider_quota_before_effect", "provider_unavailable_before_effect"):
        if effect_state != "NO_EFFECT":
            return {"status": "CONFIRMED_EFFECT_RECONCILE_STAGE",
                    "reason": "known write cannot be treated as a pre-effect provider failure"}
        if not same_attempt_reservation_valid:
            return {"status": "WAIT_PERMISSION", "reason": "same-author-attempt fallback not proven"}
        return {"status": "TRY_APPROVED_FALLBACK", "exclude": (current_model,),
                "reason": "provider unavailable before effects, bounded approved same attempt"}
    if kind == "qa_source_failure":
        return {"status": "BOUNDED_REPAIR", "reason": "target exact QA source defect; same limits"}
    if kind == "qa_architecture_failure":
        return {"status": "READ_ONLY_ARCHITECTURE_REVIEW",
                "reason": "risk reclassification only, no scope enlargement"}
    return {"status": "BLOCKED", "reason": "unrecognized failure; inspect exact evidence"}


def validate_draft_graph(items: Sequence[dict]) -> dict:
    """Inert structure check only; cannot prove original Owner scope or locks."""
    keys = [i.get("key") for i in items]
    if not all(isinstance(k, str) and k for k in keys) or len(keys) != len(set(keys)):
        raise ValueError("invalid/duplicate draft keys")
    names = set(keys)
    edges: dict[str, set[str]] = {}
    external = set()
    for item in items:
        if item.get("can_start_execution") is not False:
            raise ValueError("draft cannot mint authority")
        parent = item.get("parent_issue")
        if parent is not None and (type(parent) is not int or parent <= 0):
            raise ValueError("invalid parent reference")
        deps = item.get("depends_on", [])
        if not isinstance(deps, list):
            raise ValueError("invalid dependency list")
        clean = set()
        for dep in deps:
            if type(dep) is int and dep > 0:
                external.add(dep)
            elif isinstance(dep, str) and dep in names:
                clean.add(dep)
            else:
                raise ValueError("unknown or malformed dependency")
        if len(set(map(str, deps))) != len(deps):
            raise ValueError("duplicate dependency")
        edges[item["key"]] = clean
    working, visited = set(), set()
    def visit(name):
        if name in working:
            raise ValueError("cyclic draft dependency")
        if name in visited:
            return
        working.add(name)
        for dep in edges[name]:
            visit(dep)
        working.remove(name)
        visited.add(name)
    for name in keys:
        visit(name)
    return {"status": "STRUCTURE_ONLY_NOT_ADMITTED",
            "children": len(keys), "unverified_external_dependencies": sorted(external),
            "unverified_gates": ["Owner_scope", "path_and_lock_conflict", "ready_state",
                                 "duplicate_business_slice", "provider_evidence"]}
