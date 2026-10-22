#!/usr/bin/python3
"""PRELAUNCH proposal simulator; pure functions, NO runtime task authority/effects.

Never import from receiver/stage, never write GitHub, never launch models. Existing
GOBADMINTON_AUTONOMY_V1 remains the sole real issue admission.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

RISK = frozenset({"routine", "complex", "critical", "exploratory"})
ROLE = frozenset({"intake", "architecture", "ux", "implementation", "independent_qa",
                  "diagnosis", "ci", "dev", "owner_uat", "ops"})
NO_MODEL = frozenset({"ci", "dev", "owner_uat", "ops"})

# Exact, qualified candidate *IDs* only. This is not proof a provider subscription
# or effect-specific sandbox is usable. Any live activation needs separate admission.
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
assert set(ROUTES) == {(r, k) for r in ROLE-NO_MODEL for k in RISK}


@dataclass(frozen=True)
class Capability:
    model: str
    proven: bool
    allowed_for_stage: bool
    positive_quota_evidence: bool
    read_only_qa: bool = False
    # Neither quota evidence nor model catalog proves product permission.


@dataclass(frozen=True)
class Stage:
    role: str
    risk: str
    approved_models: tuple[str, ...]
    exact_scope_authorized: bool
    architecture_frozen: bool = True
    author_identity: str | None = None


def propose(stage: Stage, available: Mapping[str, Capability], *,
            qa_identity: str | None = None, exclude: Sequence[str] = ()) -> dict:
    """Return one read-only selection proposal, NEVER an execution authorization."""
    if stage.role not in ROLE or stage.risk not in RISK:
        return {"status": "BLOCKED", "reason": "unknown role/risk"}
    if not stage.exact_scope_authorized:
        return {"status": "BLOCKED", "reason": "missing immutable Owner/delegated task admission"}
    if stage.role in NO_MODEL:
        return {"status": "DETERMINISTIC", "model": None, "reason": "no AI on CI/OPS/DEV/Owner"}
    if stage.role == "implementation" and stage.risk == "critical" and not stage.architecture_frozen:
        return {"status": "BLOCKED", "reason": "critical architecture not frozen"}
    if stage.role == "independent_qa" and qa_identity and qa_identity == stage.author_identity:
        return {"status": "BLOCKED", "reason": "author cannot attest its own QA"}
    approved = set(stage.approved_models)
    for candidate in ROUTES[(stage.role, stage.risk)]:
        if candidate in exclude or candidate not in approved:
            continue
        capability = available.get(candidate)
        if capability is None or not all((capability.proven, capability.allowed_for_stage,
                                          capability.positive_quota_evidence)):
            continue
        if stage.role == "independent_qa" and not capability.read_only_qa:
            continue
        return {"status": "PROPOSED", "model": candidate,
                "reason": f"matched role={stage.role}, risk={stage.risk}; approved and qualified"}
    return {"status": "WAIT_PROVIDER_OR_PERMISSION",
            "reason": "no pre-approved proven model with confirmed available allowance"}


def after_failure(*, kind: str, stage: Stage, attempts: int, max_attempts: int,
                  wrote_or_unknown: bool, current_model: str) -> dict:
    """Bounded replan decision. No model call, counter reset or source write."""
    if not (0 <= attempts <= max_attempts <= 3):
        return {"status": "BLOCKED", "reason": "invalid immutable attempt ledger"}
    if wrote_or_unknown or kind in ("unknown_effect", "unknown_commit", "uncertain_timeout"):
        return {"status": "RECONCILE_ONLY", "reason": "effect outcome unknown; no alternate author"}
    if attempts == max_attempts:
        return {"status": "DEFERRED", "reason": "all authorized attempts spent; review successor"}
    if kind in ("provider_quota_before_effect", "provider_unavailable_before_effect"):
        return {"status": "TRY_APPROVED_FALLBACK", "exclude": (current_model,),
                "reason": "confirmed pre-effect provider failure; no attempt reset"}
    if kind == "qa_source_failure":
        return {"status": "BOUNDED_REPAIR", "reason": "exact QA finding; same task and attempt ceiling"}
    if kind == "qa_architecture_failure":
        return {"status": "READ_ONLY_ARCHITECTURE_REVIEW",
                "reason": "risk/replan requested; no new permission or author"}
    if kind == "ci_environment_failure":
        return {"status": "OPS_EVIDENCE", "reason": "do not charge model for environment failure"}
    return {"status": "BLOCKED", "reason": "unknown failure class; human evidence review required"}


def validate_draft_graph(items: Sequence[dict]) -> dict:
    """Only checks parent-child linkage among inert *draft* examples."""
    keys = [i.get("key") for i in items]
    if not all(isinstance(k, str) and k for k in keys) or len(keys) != len(set(keys)):
        raise ValueError("invalid or duplicate draft stage key")
    index = set(keys)
    edges: dict[str, set[str]] = {}
    for item in items:
        if item.get("can_start_execution") is not False:
            raise ValueError("draft plan cannot mint execution authority")
        deps = item.get("depends_on", [])
        if any(isinstance(v, str) and v not in index for v in deps):
            raise ValueError("unknown draft dependency")
        edges[item["key"]] = {v for v in deps if isinstance(v, str)}
    todo, visited = set(), set()
    def visit(key):
        if key in todo:
            raise ValueError("cyclic child dependency")
        if key in visited:
            return
        todo.add(key)
        for dep in edges[key]:
            visit(dep)
        todo.remove(key)
        visited.add(key)
    for key in keys:
        visit(key)
    return {"status": "DRAFT_GRAPH_OK_NOT_ADMITTED", "children": len(items)}
