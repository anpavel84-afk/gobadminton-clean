"""B1 SOURCE_ONLY author assignment and capacity handoff policy; no runtime IO.

All admission, qualification and normalized failure evidence comes from a trusted
caller. These records are contracts, not authentication of external input.
"""
from __future__ import annotations

from dataclasses import dataclass

POLICY_VERSION = 'GB_AUTHOR_ROUTING_V3_B1'
CURSOR = 'cursor_auto'
AGY = 'antigravity_sonnet'
CODEX = 'codex_sol_medium'
PROVIDERS = (CURSOR, AGY, CODEX)
AGY_MODEL = 'claude-sonnet-5-5-medium'
CODEX_MODEL = 'gpt-6.1-sol:medium'
CAPACITY_CODES = frozenset({'QUOTA_EXHAUSTED', 'RATE_LIMIT', 'CAPACITY_EXHAUSTED'})
ORIGINS = frozenset({'native_top_level_error', 'trusted_preflight_budget_check'})


@dataclass(frozen=True)
class Route:
    provider: str
    admitted: bool = False
    qualified: bool = False
    ready: bool = False
    executor: str = ''
    model: str = ''

    def available(self):
        return (self.provider in PROVIDERS and self.admitted is True
                and self.qualified is True and self.ready is True
                and bool(self.executor and self.model)
                and (self.provider != AGY or self.model == AGY_MODEL)
                and (self.provider != CODEX or self.model == CODEX_MODEL))


@dataclass(frozen=True)
class Reviewer:
    executor: str
    model: str
    qualified: bool = False
    admitted: bool = False
    ready: bool = False


def _route(routes, provider):
    route = routes.get(provider)
    return route if isinstance(route, Route) and route.provider == provider and route.available() else None


def _decision(action, reason, initial_provider, bucket, counts, provider=None, **extra):
    return dict(action=action, reason=reason, policy_version=POLICY_VERSION,
                initial_provider=initial_provider, provider=provider, bucket=bucket,
                history_counts=counts, **extra)


def select_author(*, routes, complexity, work_kind, history_counts=None,
                  policy_enabled=False, new_task=False, current_provider=None,
                  frozen_decision=None, mobile_522=False, pending_unknown=False):
    """Caller freezes the result once per admission; counts include new tasks only.

    history_counts is the count mapping for this exact (complexity, work_kind)
    bucket, or None when historical measurement is missing. Repairs never count.
    A frozen decision is caller-owned trusted immutable admission evidence.
    """
    bucket = (complexity, work_kind)
    counts = None if history_counts is None else dict(history_counts)
    result = lambda action, reason, provider=None: _decision(
        action, reason, provider, bucket, counts, provider)
    if pending_unknown:
        return result('HOLD', 'pending_operation_unknown')
    if frozen_decision is not None:
        # Returning the original record avoids recomputation, including on retries.
        return frozen_decision
    if not policy_enabled or not new_task or current_provider is not None:
        return result('KEEP', 'existing_task_or_legacy_policy', current_provider)
    if not complexity or not work_kind:
        return result('HOLD', 'missing_existing_classification')
    if counts is not None and (set(counts) != {CURSOR, AGY}
            or any(type(n) is not int or n < 0 for n in counts.values())):
        return result('HOLD', 'invalid_bucket_counts')
    candidates = [p for p in (CURSOR, AGY) if _route(routes, p)]
    if not candidates:
        return result('HOLD', 'no_admitted_qualified_primary')
    if mobile_522 and AGY in candidates:
        return result('ASSIGN', 'mobile_522_preference', AGY)
    provider = min(candidates, key=lambda p: (counts[p] if counts is not None else 0,
                                            (CURSOR, AGY).index(p)))
    return result('ASSIGN', 'missing_history_deterministic_default' if counts is None
                  else 'least_assignments_in_bucket', provider)


@dataclass(frozen=True)
class Operation:
    task: str
    operation: str
    provider: str
    source_sha: str
    scope_id: str
    original_base: str


@dataclass(frozen=True)
class CapacityFailure:
    binding: Operation
    fingerprint: str
    code: str
    origin: str
    schema: str = 'GB_PROVIDER_CONTROL_FAILURE_V1'
    domain: str = 'PROVIDER_CONTROL'


@dataclass(frozen=True)
class StopProof:
    binding: Operation
    failure_fingerprint: str
    stopped: bool = False
    source_reconciled: bool = False
    within_scope: bool = False
    pending_unknown: bool = True
    checkpoint_ref: str = ''
    receipt_refs: tuple[str, ...] = ()
    partial_state: str = ''  # preserved_diff | confirmed_empty_diff


@dataclass(frozen=True)
class CapacityStop:
    failure: CapacityFailure
    proof: StopProof


def _sha(value):
    return isinstance(value, str) and len(value) == 40 and all(c in '0123456789abcdef' for c in value)


def _valid_stop(stop):
    if not isinstance(stop, CapacityStop):
        return False
    failure, proof = stop.failure, stop.proof
    if not isinstance(failure, CapacityFailure) or not isinstance(proof, StopProof):
        return False
    b = failure.binding
    return (isinstance(b, Operation) and b.provider in PROVIDERS
            and bool(b.task and b.operation and b.scope_id)
            and _sha(b.source_sha) and _sha(b.original_base)
            and failure.schema == 'GB_PROVIDER_CONTROL_FAILURE_V1'
            and failure.domain == 'PROVIDER_CONTROL'
            and failure.origin in ORIGINS and failure.code in CAPACITY_CODES
            and bool(failure.fingerprint)
            and proof.binding == b and proof.failure_fingerprint == failure.fingerprint
            and proof.stopped is True and proof.source_reconciled is True
            and proof.within_scope is True and proof.pending_unknown is False
            and bool(proof.checkpoint_ref) and isinstance(proof.receipt_refs, tuple)
            and bool(proof.receipt_refs) and all(proof.receipt_refs)
            and proof.partial_state in ('preserved_diff', 'confirmed_empty_diff'))


def capacity_handoff(*, current, failure, proof, routes, initial_provider,
                     cumulative_attempts, history_refs, chain=(), reviewer=None):
    """Return a proposed new admission, never launch or clear a HOLD.

    chain contains accepted prior capacity stops for this same task, oldest first.
    Missing subscription measurement is not operation UNKNOWN: only the trusted
    reconciliation proof determines whether actual effects remain unknown.
    """
    def hold(reason):
        return dict(action='HOLD', reason=reason, policy_version=POLICY_VERSION)

    if not isinstance(current, Operation) or not isinstance(failure, CapacityFailure):
        return hold('invalid_typed_failure')
    if failure.binding != current or not _valid_stop(CapacityStop(failure, proof)):
        return hold('capacity_or_stop_reconciliation_unproven')
    if (initial_provider not in (CURSOR, AGY) or not isinstance(chain, tuple)
            or type(cumulative_attempts) is not int or cumulative_attempts < len(chain) + 1
            or not isinstance(history_refs, tuple) or not history_refs or not all(history_refs)):
        return hold('missing_preserved_history')
    stops = chain + (CapacityStop(failure, proof),)
    providers = []
    operations = []
    for stop in stops:
        if not _valid_stop(stop):
            return hold('invalid_prior_capacity_stop')
        b = stop.failure.binding
        if (b.task, b.scope_id, b.original_base) != (current.task, current.scope_id, current.original_base):
            return hold('chain_identity_mismatch')
        providers.append(b.provider)
        operations.append(b.operation)
    order = (initial_provider, AGY if initial_provider == CURSOR else CURSOR, CODEX)
    if tuple(providers) != order[:len(providers)] or len(set(operations)) != len(operations):
        return hold('repeated_or_invalid_capacity_chain')
    if len(providers) >= len(order):
        return hold('capacity_chain_exhausted')
    target = order[len(providers)]
    route = _route(routes, target)
    if route is None:
        return hold('backup_unavailable')
    # Existing default QA is Codex Sol Medium for Cursor/AGY authors. A Codex
    # author always needs an explicit separate qualified executor AND model.
    if (not isinstance(reviewer, Reviewer) or reviewer.qualified is not True
            or reviewer.admitted is not True or reviewer.ready is not True
            or not reviewer.executor or not reviewer.model
            or reviewer.executor == route.executor or reviewer.model == route.model):
        return hold('independent_reviewer_required')
    if target != CODEX and reviewer.model != CODEX_MODEL:
        return hold('default_codex_qa_required')
    return dict(action='REQUIRE_NEW_ADMISSION', reason='confirmed_capacity_handoff',
                policy_version=POLICY_VERSION, initial_provider=initial_provider,
                provider=target, chain=stops, cumulative_attempts=cumulative_attempts,
                history_refs=history_refs, reviewer=reviewer,
                handoff=dict(task=current.task, previous_operation=current.operation,
                             previous_provider=current.provider, source_sha=current.source_sha,
                             scope_id=current.scope_id, original_base=current.original_base,
                             checkpoint_ref=proof.checkpoint_ref, receipt_refs=proof.receipt_refs,
                             partial_state=proof.partial_state,
                             required_new_operation=True, required_new_admission=True,
                             preserve_all_before_switch=True))
