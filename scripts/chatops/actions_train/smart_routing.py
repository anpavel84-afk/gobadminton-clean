"""SR1 classifier and validator. Offline only.

The live controller keeps the #218 Astra-before-repair path. This module is not
imported by core, failure_diagnosis, cost_policy, stage, or the Antigravity
adapter, and it does not install, publish, or rewrite an admission.

A new-policy decision is produced only when the case explicitly selects the
classifier, semantics are new, and the code, capsule, and policy pins agree.
Legacy tasks never receive Fast Fix or a rewritten route. The new policy is not
stored inside GOBADMINTON_AUTONOMY_V1.
"""
import copy
import re

CASE_SCHEMA = "GB_SMART_ROUTING_CASE_V1"
PLAN_SCHEMA = "GB_SMART_ROUTING_PLAN_V1"
DECISION_SCHEMA = "GB_SMART_ROUTING_DECISION_V1"
AUTONOMY_SCHEMA = "GOBADMINTON_AUTONOMY_V1"
LEGACY_ROUTE = "legacy_astra_failure_diagnosis_before_source_repair"
FORBIDDEN_TASK_KEYS = frozenset(("smart_routing", "fast_fix", "classifier"))
ROUTES = frozenset((
    "codex:gpt-6.1-sol:medium", "codex:gpt-6.1-sol:high",
    "codex:gpt-6-astra:medium", "codex:gpt-6-astra:high",
    "codex:gpt-6-luna:medium", "cursor:auto",
    "agy:claude-sonnet-5-5-medium", "agy:claude-sonnet-5-5-high",
    "agy:claude-opus-5-5-high",
))
MODELS = frozenset((
    "gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna",
    "claude-sonnet-5-5-medium", "claude-sonnet-5-5-high", "claude-opus-5-5-high",
))
SENSITIVE = frozenset((
    "auth", "guard", "permission", "sandbox", "admission", "budget",
    "secret", "qa_reuse", "apparmor",
))
ALLOWED_EFFECTS = frozenset(("read", "source_edit_within_scope", "deterministic_tool", "none"))
SEARCH_METHODS = frozenset(("grep", "ast", "lint", "test"))
SCHEMA_REPAIR_BUDGET = 2
_SHA40 = re.compile(r"[0-9a-f]{40}\Z")
_SHA64 = re.compile(r"[0-9a-f]{64}\Z")
_OP = re.compile(r"[A-Za-z0-9._:-]{1,64}\Z")
_CASE_KEYS = frozenset(("schema", "semantics", "classifier_selected", "binding", "pins", "evidence"))
_BIND_KEYS = frozenset(("task_sha", "rules_commit", "rules_sha256", "head", "operation_id"))
_PIN_KEYS = frozenset((
    "code_commit", "code_sha256", "capsule_commit", "capsule_sha256",
    "policy_commit", "policy_sha256", "policy_bytes_match",
))
_PLAN_KEYS = frozenset((
    "schema", "author_route", "qa_route", "planner_calls", "astra_calls", "fast_fix",
    "effects", "model_ids", "rights_delta", "binding", "delete_assertions",
    "weaken_auth", "disable_security", "executable",
))
_EVIDENCE_KEYS = frozenset((
    "template_id", "template_applicable", "template_tool", "risk", "change_surface",
    "suggested_class", "cause", "critical_signs", "difficult_or_repeating", "findings",
    "brief_usable", "prior_fast_fix", "defect_fingerprint", "author_attempts",
    "continuation_used", "progress", "no_progress_streak", "unknown_effect", "reconciled",
    "platform_refusal", "refusal_operation", "proposed_retry_operation", "proposed_provider",
    "quota_exhausted", "effects_proven_absent", "fallback_route", "fallback_equivalent",
    "context_complete", "context_hash_ok", "missing_inputs", "agy_catalog",
    "agy_qa_qualified", "qa_route_proof", "qa_independent", "session_shared",
    "effective_model_exposed", "invented_model_id", "invented_cost", "class_search",
    "dispatch_duplicate", "schema_repair_attempts", "plan_json_valid", "history",
    "acceptance_unchanged", "scope_within_admission", "finite_budget", "regression_known",
    "minimal_action_known", "architecture_research_required", "external_effects_unknown",
    "line_count", "event_text", "whole_class_plan", "author_qa_same_snapshot", "complexity",
    "event_kind", "requirement_conflict", "plan",
))


def _finish(base, **updates):
    payload = dict(base)
    payload.update(updates)
    return _decision(**payload)


def _decision(**updates):
    decision = {
        "schema": DECISION_SCHEMA,
        "policy_applied": False,
        "executed": False,
        "rejected": False,
        "reason": "",
        "event_class": "LEGACY",
        "route": LEGACY_ROUTE,
        "author_route": None,
        "qa_route": None,
        "planner_calls": 0,
        "astra_calls": 0,
        "model_calls": 0,
        "operation_id": None,
        "fast_fix": False,
        "fast_fix_closed": False,
        "author_attempts": 0,
        "author_attempts_delta": 0,
        "continuation_used": 0,
        "continuation_granted": False,
        "next_ordinary_attempt": None,
        "history_reset": False,
        "history": [],
        "ledger_category": None,
        "risk": None,
        "findings": [],
        "qa_verdict": None,
        "effective_model": None,
        "cost": None,
        "fallback_reason": None,
        "missing_inputs": [],
        "full_trusted_fallback": False,
        "circuit_breaker": False,
        "independent_queue_continues": True,
        "policy_rewritten": False,
        "rewritten_task": None,
        "activation_blocked": False,
        "whole_class": False,
        "owner_micro_go": False,
        "writer": False,
        "duplicate_suppressed": False,
        "plan_honored": None,
        "agy_ready": False,
    }
    decision.update(updates)
    return decision


def refuse_unsupported_task(task):
    """Refuse to store this policy inside an unsupported admission schema."""
    if type(task) is not dict or type(task.get("schema")) is not str:
        return _decision(rejected=True, executed=False, reason="unsupported schema",
                         event_class="REJECTED", route="hold")
    if task.get("schema") == AUTONOMY_SCHEMA and FORBIDDEN_TASK_KEYS & set(task):
        return _decision(rejected=True, executed=False, policy_applied=False,
                         policy_rewritten=False, rewritten_task=None,
                         reason="new policy is not written into an unsupported schema",
                         event_class="REJECTED", route="hold")
    if task.get("schema") != CASE_SCHEMA:
        return _decision(rejected=True, executed=False, reason="unsupported schema",
                         event_class="REJECTED", route="hold")
    return _decision(rejected=True, executed=False, reason="case is not an admission",
                     event_class="REJECTED", route="hold")


def validate_plan(plan):
    """Return an error string, or None when the plan schema is closed and safe."""
    if type(plan) is not dict or set(plan) != _PLAN_KEYS:
        return "incompatible plan"
    if plan["schema"] != PLAN_SCHEMA:
        return "incompatible plan"
    for label in ("author_route", "qa_route"):
        if plan[label] is not None and plan[label] not in ROUTES:
            return "disallowed model or route"
    if type(plan["planner_calls"]) is not int or not 0 <= plan["planner_calls"] <= 1:
        return "unbounded planner"
    if type(plan["astra_calls"]) is not int or not 0 <= plan["astra_calls"] <= 1:
        return "unbounded expert escalation"
    if type(plan["fast_fix"]) is not bool:
        return "incompatible plan"
    if type(plan["effects"]) is not list or any(item not in ALLOWED_EFFECTS for item in plan["effects"]):
        return "dangerous plan effect"
    if type(plan["model_ids"]) is not list or any(item not in MODELS for item in plan["model_ids"]):
        return "disallowed model or route"
    if type(plan["rights_delta"]) is not list or plan["rights_delta"]:
        return "new rights refused"
    if _binding_error(plan["binding"]):
        return "incompatible plan binding"
    for flag in ("delete_assertions", "weaken_auth", "disable_security", "executable"):
        if type(plan[flag]) is not bool:
            return "incompatible plan"
    if plan["delete_assertions"] or plan["weaken_auth"] or plan["disable_security"]:
        return "security check would be weakened"
    return None


def decide(case):
    """One deterministic classification. Does not call a provider or write source."""
    error = _case_error(case)
    if error:
        return _decision(rejected=True, reason=error, event_class="REJECTED", route="hold")
    evidence = _evidence(case["evidence"])
    if type(evidence) is str:
        return _decision(rejected=True, reason=evidence, event_class="REJECTED", route="hold",
                         operation_id=case["binding"]["operation_id"])
    base = _carry(case, evidence)
    plan = evidence["plan"]
    if plan is not None:
        plan_error = validate_plan(plan)
        if plan_error:
            return _finish(base, rejected=True, executed=False, writer=False,
                             policy_rewritten=False, reason=plan_error,
                             event_class="REJECTED", route="hold", plan_honored=False)
    active, why = _activation(case)
    if not active:
        blocked = why == "pin_mismatch"
        return _finish(base, policy_applied=False, executed=False, writer=False,
                         activation_blocked=blocked, fast_fix=False, reason=why,
                         event_class="LEGACY", route=LEGACY_ROUTE, plan_honored=False)
    if not evidence["plan_json_valid"]:
        return _schema_repair(base, evidence)
    if evidence["dispatch_duplicate"]:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         duplicate_suppressed=True, model_calls=1,
                         reason="duplicate dispatch suppressed",
                         event_class="DUPLICATE", route="hold", operation_id=case["binding"]["operation_id"])
    if evidence["unknown_effect"] and not (evidence["reconciled"] and evidence["effects_proven_absent"]):
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         fallback_reason=None, reason="unknown effect awaits reconciliation",
                         event_class="UNKNOWN_EFFECT", route="hold")
    if evidence["platform_refusal"]:
        return _finish(base, policy_applied=True, executed=False, writer=False, rejected=True,
                         model_calls=0, reason="platform refusal is not replayed through another provider",
                         event_class="PLATFORM_REFUSAL", route="hold")
    if plan is not None and plan["binding"] != case["binding"]:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         reason="binding changed after planning; revalidation required",
                         event_class="STALE_BINDING", route="revalidate", plan_honored=False)
    if evidence["session_shared"] or evidence["author_qa_same_snapshot"]:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         qa_verdict=None, reason="author and QA are not independent",
                         event_class="INDEPENDENT_QA_REJECTED", route="hold")
    if not evidence["context_complete"] or not evidence["context_hash_ok"]:
        missing = list(evidence["missing_inputs"])
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         qa_verdict=None, missing_inputs=missing,
                         full_trusted_fallback=not missing,
                         reason="incomplete context" if missing else "context hash mismatch; full trusted fallback",
                         event_class="INPUT_MISSING", route="hold")
    if evidence["no_progress_streak"] >= 2:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         circuit_breaker=True, independent_queue_continues=True,
                         reason="two repairs without progress",
                         event_class="CIRCUIT_BREAKER", route="hold")
    if evidence["quota_exhausted"]:
        return _quota(base, evidence)
    kind = evidence["event_kind"]
    if kind == "pending":
        return _finish(base, policy_applied=True, executed=True, writer=False,
                         reason="wait for the existing controller event",
                         event_class="PENDING", route="wait")
    if kind == "config_precall":
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         reason="fix admitted configuration and rerun non-model preflight",
                         event_class="CONFIG_PRECALL", route="ops_preflight")
    if kind == "transient_infra":
        return _finish(base, policy_applied=True, executed=True, writer=False,
                         model_calls=0, astra_calls=0, reason="bounded infra retry only",
                         event_class="TRANSIENT_INFRA", route="retry_backoff")
    if evidence["requirement_conflict"] or kind == "requirement_conflict":
        expert = _floor(evidence) == "critical"
        return _finish(base, policy_applied=True, executed=not expert or _critical_qa(evidence) is not None,
                         writer=False, astra_calls=1 if expert else 0, model_calls=1 if expert else 0,
                         qa_route=_critical_qa(evidence) if expert else None,
                         reason="unresolved product choice goes to the Owner; expert only if the risk is critical",
                         event_class="REQUIREMENT_CONFLICT", route="owner" if not expert else "codex:gpt-6-astra:high",
                         risk=_floor(evidence))
    return _classify(base, evidence, plan)


def _classify(base, evidence, plan):
    risk = _floor(evidence)
    honored = None if plan is None else True
    if plan is not None and plan["fast_fix"] and (risk == "critical" or _class_open(evidence)):
        honored = False
    search_error = _search_state(evidence["class_search"])
    if evidence["class_search"] is not None and search_error:
        return _finish(base, rejected=True, reason=search_error, event_class="REJECTED",
                         route="hold", risk=risk, plan_honored=False)
    if _template_ok(evidence, risk):
        tool = evidence["template_tool"] == "deterministic_tool"
        route = "deterministic_tool" if tool else "cursor:auto"
        model, cost = _auto_receipt(route, evidence)
        return _finish(base, policy_applied=True, executed=True, writer=not tool,
                         planner_calls=0, astra_calls=0, model_calls=0 if tool else 1,
                         fast_fix=False, route=route, author_route=route, qa_route=_ordinary_qa(evidence),
                         effective_model=model, cost=cost, risk=risk, ledger_category="ordinary",
                         reason="proven template; no planner or Astra",
                         event_class="TEMPLATE", plan_honored=honored)
    if risk == "critical" or evidence["difficult_or_repeating"]:
        qa = _critical_qa(evidence)
        fast_demanded = plan is not None and plan["fast_fix"]
        if qa is None:
            return _finish(base, policy_applied=True, executed=False, writer=False, risk="critical",
                             astra_calls=1, planner_calls=0, model_calls=0, fast_fix=False, qa_verdict=None,
                             reason="critical path needs an independent qualified QA route",
                             event_class="SOURCE_CRITICAL", route="hold",
                             plan_honored=False if fast_demanded else honored)
        return _finish(base, policy_applied=True, executed=True, writer=False, risk="critical",
                         astra_calls=1, planner_calls=0, model_calls=1, fast_fix=False,
                         author_route="codex:gpt-6.1-sol:high", qa_route=qa,
                         route="codex:gpt-6-astra:high", ledger_category="ordinary",
                         reason="critical or hard defect uses read-only Astra and independent QA",
                         event_class="SOURCE_CRITICAL", plan_honored=False if fast_demanded else honored)
    if _class_open(evidence):
        return _pm(base, evidence, risk, whole_class=True,
                   reason="Fast Fix refused; defect class is not proven closed")
    if evidence["prior_fast_fix"] and evidence["prior_fast_fix"]["fingerprint"] == evidence["defect_fingerprint"]:
        return _finish(base, policy_applied=True, executed=True, writer=False, risk=risk,
                         fast_fix=False, fast_fix_closed=True, planner_calls=1, astra_calls=0, model_calls=1,
                         author_attempts_delta=0, route="codex:gpt-6.1-sol:high", author_route=None,
                         qa_route=_ordinary_qa(evidence), next_ordinary_attempt=evidence["author_attempts"] + 1,
                         reason="Fast Fix for this fingerprint is closed",
                         event_class="SOURCE_UNCERTAIN", plan_honored=False)
    if evidence["author_attempts"] >= 3 and evidence["brief_usable"] and evidence["progress"]:
        if evidence["continuation_used"] >= 2:
            return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                             reason="continuation budget is exhausted", event_class="LIMIT", route="hold")
        return _finish(base, policy_applied=True, executed=True, writer=True, risk=risk,
                         planner_calls=0, astra_calls=0, model_calls=1, continuation_granted=True,
                         owner_micro_go=False, history_reset=False,
                         author_route="cursor:auto" if evidence["complexity"] != "complex" else "codex:gpt-6.1-sol:high",
                         qa_route=_ordinary_qa(evidence), route="continuation", ledger_category="ordinary",
                         next_ordinary_attempt=evidence["author_attempts"] + evidence["continuation_used"] + 1,
                         reason="bounded continuation reuses the brief; history is kept",
                         event_class="CONTINUATION", cost=None, plan_honored=honored)
    if evidence["brief_usable"] and evidence["cause"] in ("proven", "supported") and evidence["author_attempts"] < 3:
        model, cost = _auto_receipt("cursor:auto", evidence)
        return _finish(base, policy_applied=True, executed=True, writer=True, risk=risk,
                         planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                         author_route="cursor:auto", qa_route=_ordinary_qa(evidence), route="cursor:auto",
                         effective_model=model, cost=cost, ledger_category="ordinary",
                         reason="usable brief is reused; no extra planner or diagnosis",
                         event_class="SOURCE_KNOWN_STANDARD", plan_honored=honored)
    allowed, fast_reason = _fast_fix_block(evidence, risk)
    fast_candidate = (evidence["cause"] == "proven" and evidence["minimal_action_known"]
                      and not evidence["architecture_research_required"])
    if fast_candidate and allowed:
        model, cost = _auto_receipt("cursor:auto", evidence)
        return _finish(base, policy_applied=True, executed=True, writer=True, risk=risk,
                         fast_fix=True, planner_calls=0, astra_calls=0, model_calls=1,
                         author_attempts_delta=0, ledger_category="fast_fix", author_route="cursor:auto",
                         qa_route=_ordinary_qa(evidence), route="cursor:auto", effective_model=model, cost=cost,
                         whole_class=False, reason="all eight Fast Fix conditions hold",
                         event_class="SOURCE_KNOWN_LOCAL", plan_honored=honored)
    if fast_candidate and not allowed:
        return _pm(base, evidence, risk, whole_class=_class_open(evidence) or not _search_saved(evidence),
                   reason="Fast Fix refused; " + fast_reason)
    if evidence["cause"] == "proven" and evidence["complexity"] == "complex":
        return _author(base, evidence, risk, "codex:gpt-6.1-sol:high", "SOURCE_KNOWN_COMPLEX",
                       "known complex noncritical cause; Astra is not required", honored)
    if evidence["cause"] == "proven":
        route = "cursor:auto"
        return _author(base, evidence, risk, route, "SOURCE_KNOWN_STANDARD",
                       "known cause uses an evidence-bound repair", honored)
    if evidence["cause"] == "missing_evidence":
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk, qa_verdict=None,
                         missing_inputs=list(evidence["missing_inputs"]) or ["source evidence"],
                         reason="missing evidence; do not guess with a larger model",
                         event_class="INPUT_MISSING", route="hold")
    return _pm(base, evidence, risk, whole_class=False, reason="one read-only Technical PM pass")


def _pm(base, evidence, risk, *, whole_class, reason):
    return _finish(base, policy_applied=True, executed=True, writer=False, risk=risk,
                     planner_calls=1, astra_calls=0, model_calls=1, fast_fix=False, whole_class=whole_class,
                     route="codex:gpt-6.1-sol:high",
                     author_route="cursor:auto" if evidence["complexity"] != "complex" else "codex:gpt-6.1-sol:high",
                     qa_route=_ordinary_qa(evidence), reason=reason, event_class="SOURCE_UNCERTAIN",
                     plan_honored=False if whole_class else base.get("plan_honored"))


def _author(base, evidence, risk, route, klass, reason, honored):
    model, cost = _auto_receipt(route, evidence)
    return _finish(base, policy_applied=True, executed=True, writer=True, risk=risk,
                     planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                     author_route=route, qa_route=_ordinary_qa(evidence), route=route,
                     effective_model=model, cost=cost, ledger_category="ordinary",
                     reason=reason, event_class=klass, plan_honored=honored)


def _quota(base, evidence):
    route = evidence["fallback_route"]
    allowed = (evidence["effects_proven_absent"] and evidence["fallback_equivalent"]
               and route in ROUTES and not route.startswith("agy:"))
    if not allowed:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         fallback_reason=None, reason="quota exhausted without an admitted equivalent fallback",
                         event_class="QUOTA", route="hold")
    return _finish(base, policy_applied=True, executed=True, writer=False, model_calls=1,
                     route=route, author_route=route, fallback_reason="quota_exhausted_equivalent_fallback",
                     reason="quota exhausted equivalent fallback",
                     event_class="QUOTA", qa_route=_ordinary_qa(evidence))


def _schema_repair(base, evidence):
    if evidence["schema_repair_attempts"] >= SCHEMA_REPAIR_BUDGET:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         planner_calls=0, astra_calls=0, model_calls=0,
                         reason="schema repair budget exhausted",
                         event_class="SCHEMA_REPAIR", route="hold")
    return _finish(base, policy_applied=True, executed=False, writer=False,
                     planner_calls=0, astra_calls=0, model_calls=0,
                     reason="finite schema repair; Astra is not escalated",
                     event_class="SCHEMA_REPAIR", route="schema_repair")


def _carry(case, evidence):
    return {
        "operation_id": case["binding"]["operation_id"],
        "author_attempts": evidence["author_attempts"],
        "author_attempts_delta": 0,
        "continuation_used": evidence["continuation_used"],
        "history": copy.deepcopy(evidence["history"]),
        "history_reset": False,
        "findings": copy.deepcopy(evidence["findings"]),
        "risk": _floor(evidence),
        "agy_ready": bool(evidence["agy_catalog"] and evidence["agy_qa_qualified"]),
        "owner_micro_go": False,
        "qa_verdict": None,
        "cost": None,
        "policy_rewritten": False,
        "rewritten_task": None,
        "independent_queue_continues": True,
    }


def _activation(case):
    if case["semantics"] != "new":
        return False, "legacy_semantics"
    if case["classifier_selected"] is not True:
        return False, "classifier_not_selected"
    pins = case["pins"]
    commits = (pins["code_commit"], pins["capsule_commit"], pins["policy_commit"])
    hashes = (pins["code_sha256"], pins["capsule_sha256"], pins["policy_sha256"])
    if pins["policy_bytes_match"] is True and len(set(commits)) == 1 and len(set(hashes)) == 1:
        return True, "pins_agree"
    return False, "pin_mismatch"


def _floor(evidence):
    if evidence["critical_signs"] or evidence["change_surface"] in SENSITIVE or any(
            item["severity"] == "critical" for item in evidence["findings"]):
        return "critical"
    return evidence["risk"]


def _template_ok(evidence, risk):
    return bool(evidence["template_applicable"] and evidence["template_id"]
                and risk != "critical" and evidence["change_surface"] not in SENSITIVE
                and not evidence["critical_signs"])


def _ordinary_qa(evidence):
    proof = evidence["qa_route_proof"]
    if evidence["agy_qa_qualified"] and type(proof) is str and proof.startswith("agy:") and proof in ROUTES:
        return proof
    return "codex:gpt-6.1-sol:medium"


def _critical_qa(evidence):
    if not evidence["qa_independent"] or evidence["session_shared"] or evidence["author_qa_same_snapshot"]:
        return None
    proof = evidence["qa_route_proof"]
    if proof in ("codex:gpt-6.1-sol:high", "codex:gpt-6-astra:high"):
        return proof
    if evidence["agy_qa_qualified"] and type(proof) is str and proof.startswith("agy:") and proof in ROUTES:
        return proof
    return None


def _auto_receipt(route, evidence):
    if route != "cursor:auto":
        return None, None
    if evidence["invented_cost"] or evidence["invented_model_id"]:
        return "not_exposed", None
    if not evidence["effective_model_exposed"]:
        return "not_exposed", None
    return None, None


def _class_open(evidence):
    """A saved search that is not exactly one real instance blocks single-site Fast Fix."""
    search = evidence["class_search"]
    if type(search) is not dict:
        return False
    return not (search.get("saved") is True and search.get("assurance_only") is False
                and search.get("method") in SEARCH_METHODS and bool(search.get("pattern"))
                and bool(search.get("scope")) and search.get("instances") == 1)


def _search_saved(evidence):
    search = evidence["class_search"]
    return type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False


def _search_state(search):
    if search is None:
        return None
    if type(search) is not dict or set(search) != {
            "saved", "method", "pattern", "scope", "instances", "assurance_only"}:
        return "invalid class search"
    if type(search["saved"]) is not bool or type(search["assurance_only"]) is not bool:
        return "invalid class search"
    if search["method"] not in SEARCH_METHODS:
        return "invalid class search"
    if type(search["instances"]) is not int or search["instances"] < 0:
        return "invalid class search"
    if type(search["pattern"]) is not str or type(search["scope"]) is not str:
        return "invalid class search"
    if len(search["pattern"]) > 200 or len(search["scope"]) > 240:
        return "invalid class search"
    return None


def _fast_fix_block(evidence, risk):
    """Return (allowed, reason). Allowed only when every condition holds."""
    search = evidence["class_search"]
    prior = evidence["prior_fast_fix"]
    same_prior = type(prior) is dict and prior.get("fingerprint") == evidence["defect_fingerprint"]
    checks = (
        (evidence["cause"] == "proven" and evidence["acceptance_unchanged"] and bool(evidence["defect_fingerprint"]),
         "condition 1 cause or acceptance"),
        (evidence["minimal_action_known"] and not evidence["architecture_research_required"],
         "condition 2 architecture still open"),
        (risk in ("low", "moderate") and not evidence["critical_signs"]
         and evidence["change_surface"] not in SENSITIVE and not evidence["external_effects_unknown"]
         and not evidence["unknown_effect"],
         "condition 3 risk floor or unknown effect"),
        (evidence["scope_within_admission"] and evidence["finite_budget"],
         "condition 4 scope or budget"),
        (evidence["regression_known"], "condition 5 regression check"),
        (not same_prior, "condition 6 Fast Fix already used"),
        (True, "condition 7 assertions and auth"),
        (type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False
         and search.get("method") in SEARCH_METHODS and bool(search.get("pattern")) and bool(search.get("scope"))
         and search.get("instances") == 1,
         "condition 8 defect class is not proven closed"),
    )
    for ok, reason in checks:
        if not ok:
            return False, reason
    return True, ""


def _case_error(case):
    if type(case) is not dict or set(case) != _CASE_KEYS:
        return "unexpected case fields"
    if case["schema"] != CASE_SCHEMA or case["semantics"] not in ("legacy", "new"):
        return "unsupported case schema"
    if type(case["classifier_selected"]) is not bool:
        return "invalid classifier selection"
    if _binding_error(case["binding"]) or _pin_error(case["pins"]):
        return "invalid binding or pins"
    if type(case["evidence"]) is not dict:
        return "invalid evidence"
    return None


def _binding_error(binding):
    if type(binding) is not dict or set(binding) != _BIND_KEYS:
        return "invalid binding"
    if not _SHA64.fullmatch(binding["task_sha"]) or not _SHA64.fullmatch(binding["rules_sha256"]):
        return "invalid binding"
    if not _SHA40.fullmatch(binding["rules_commit"]) or not _SHA40.fullmatch(binding["head"]):
        return "invalid binding"
    if not _OP.fullmatch(binding["operation_id"]):
        return "invalid binding"
    return None


def _pin_error(pins):
    if type(pins) is not dict or set(pins) != _PIN_KEYS:
        return "invalid pins"
    for key in ("code_commit", "capsule_commit", "policy_commit"):
        if not _SHA40.fullmatch(pins[key]):
            return "invalid pins"
    for key in ("code_sha256", "capsule_sha256", "policy_sha256"):
        if not _SHA64.fullmatch(pins[key]):
            return "invalid pins"
    if type(pins["policy_bytes_match"]) is not bool:
        return "invalid pins"
    return None


def _evidence(raw):
    if set(raw) - _EVIDENCE_KEYS:
        return "unknown evidence"
    try:
        evidence = _defaults()
        for key, value in raw.items():
            evidence[key] = value
        _check_evidence(evidence)
    except ValueError as error:
        return str(error)
    evidence["findings"] = copy.deepcopy(evidence["findings"])
    evidence["history"] = copy.deepcopy(evidence["history"])
    evidence["missing_inputs"] = list(evidence["missing_inputs"])
    if evidence["class_search"] is not None:
        evidence["class_search"] = copy.deepcopy(evidence["class_search"])
    if evidence["prior_fast_fix"] is not None:
        evidence["prior_fast_fix"] = copy.deepcopy(evidence["prior_fast_fix"])
    if evidence["plan"] is not None:
        evidence["plan"] = copy.deepcopy(evidence["plan"])
    return evidence


def _defaults():
    return {
        "template_id": None, "template_applicable": False, "template_tool": None,
        "risk": None, "change_surface": "", "suggested_class": None, "cause": "missing_evidence",
        "critical_signs": False, "difficult_or_repeating": False, "findings": [],
        "brief_usable": False, "prior_fast_fix": None, "defect_fingerprint": "",
        "author_attempts": 0, "continuation_used": 0, "progress": False, "no_progress_streak": 0,
        "unknown_effect": False, "reconciled": False, "platform_refusal": False,
        "refusal_operation": "", "proposed_retry_operation": "", "proposed_provider": "",
        "quota_exhausted": False, "effects_proven_absent": False, "fallback_route": None,
        "fallback_equivalent": False, "context_complete": False, "context_hash_ok": False,
        "missing_inputs": [], "agy_catalog": False, "agy_qa_qualified": False, "qa_route_proof": None,
        "qa_independent": False, "session_shared": False, "effective_model_exposed": False,
        "invented_model_id": None, "invented_cost": False, "class_search": None,
        "dispatch_duplicate": False, "schema_repair_attempts": 0, "plan_json_valid": True,
        "history": [], "acceptance_unchanged": True, "scope_within_admission": False,
        "finite_budget": False, "regression_known": False, "minimal_action_known": False,
        "architecture_research_required": True, "external_effects_unknown": True,
        "line_count": None, "event_text": "", "whole_class_plan": False,
        "author_qa_same_snapshot": False, "complexity": "standard", "event_kind": None,
        "requirement_conflict": False, "plan": None,
    }


def _check_evidence(evidence):
    if evidence["risk"] not in (None, "low", "moderate", "critical"):
        raise ValueError("invalid risk")
    if evidence["cause"] not in ("proven", "supported", "unresolved", "missing_evidence"):
        raise ValueError("invalid cause")
    if evidence["complexity"] not in ("mechanical", "standard", "complex"):
        raise ValueError("invalid complexity")
    if evidence["event_kind"] not in (None, "pending", "config_precall", "transient_infra", "requirement_conflict"):
        raise ValueError("invalid event kind")
    if evidence["template_tool"] not in (None, "deterministic_tool"):
        raise ValueError("invalid template tool")
    for key in ("template_applicable", "critical_signs", "difficult_or_repeating", "brief_usable",
                "progress", "unknown_effect", "reconciled", "platform_refusal", "quota_exhausted",
                "effects_proven_absent", "fallback_equivalent", "context_complete", "context_hash_ok",
                "agy_catalog", "agy_qa_qualified", "qa_independent", "session_shared",
                "effective_model_exposed", "invented_cost", "dispatch_duplicate", "plan_json_valid",
                "acceptance_unchanged", "scope_within_admission", "finite_budget", "regression_known",
                "minimal_action_known", "architecture_research_required", "external_effects_unknown",
                "whole_class_plan", "author_qa_same_snapshot", "requirement_conflict"):
        if type(evidence[key]) is not bool:
            raise ValueError("invalid evidence flag")
    for key in ("author_attempts", "continuation_used", "no_progress_streak", "schema_repair_attempts"):
        if type(evidence[key]) is not int or evidence[key] < 0 or evidence[key] > 7:
            raise ValueError("invalid counter")
    if evidence["line_count"] is not None and (type(evidence["line_count"]) is not int or evidence["line_count"] < 0):
        raise ValueError("invalid line count")
    if evidence["fallback_route"] is not None and evidence["fallback_route"] not in ROUTES:
        raise ValueError("invalid fallback")
    for key in ("template_id", "change_surface", "suggested_class", "defect_fingerprint",
                "refusal_operation", "proposed_retry_operation", "proposed_provider",
                "invented_model_id", "event_text", "qa_route_proof"):
        if evidence[key] is not None and (type(evidence[key]) is not str or len(evidence[key]) > 500):
            raise ValueError("invalid evidence string")
    if type(evidence["findings"]) is not list or len(evidence["findings"]) > 32:
        raise ValueError("invalid findings")
    seen = set()
    for item in evidence["findings"]:
        if type(item) is not dict or set(item) != {"id", "severity", "location"}:
            raise ValueError("invalid finding")
        if type(item["id"]) is not str or not item["id"] or item["id"] in seen:
            raise ValueError("invalid finding")
        if item["severity"] not in ("low", "moderate", "critical"):
            raise ValueError("invalid finding")
        if type(item["location"]) is not str or len(item["location"]) > 240:
            raise ValueError("invalid finding")
        seen.add(item["id"])
    if type(evidence["missing_inputs"]) is not list or any(type(item) is not str or not item for item in evidence["missing_inputs"]):
        raise ValueError("invalid missing inputs")
    if type(evidence["history"]) is not list or len(evidence["history"]) > 32:
        raise ValueError("invalid history")
    for item in evidence["history"]:
        if type(item) is not str or len(item) > 500:
            raise ValueError("invalid history")
    prior = evidence["prior_fast_fix"]
    if prior is not None:
        if type(prior) is not dict or set(prior) != {"fingerprint", "result"}:
            raise ValueError("invalid prior fast fix")
        if type(prior["fingerprint"]) is not str or prior["result"] not in ("pass", "fail"):
            raise ValueError("invalid prior fast fix")
    if evidence["plan"] is not None and type(evidence["plan"]) is not dict:
        raise ValueError("invalid plan")
