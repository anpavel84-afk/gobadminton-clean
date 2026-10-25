"""SR1 classifier and validator. Offline only.

The live controller keeps the #218 Astra-before-repair path. This module is not
imported by core, failure_diagnosis, cost_policy, stage, or the Antigravity
adapter, and it does not install, publish, or rewrite an admission.

A new-policy decision is produced only when the case explicitly selects the
classifier, semantics are new, and the code, capsule, and policy pins agree.
Legacy tasks never receive Fast Fix or a rewritten route. The new policy is not
stored inside GOBADMINTON_AUTONOMY_V1.

Fast Fix (§9) needs every condition, including an allowlisted surface, a diff
tool result for unchanged limits, and a class search that names one identifier
from the diff. Fast Fix text is fail-closed: after normalization, event text,
scope, and listings must be only the allowed alphabet (ASCII letters and digits,
a normal space, limited punctuation, Cyrillic). An encoding residue, a slash or
other separator that splits a word, a digit inside a Cyrillic word, a soft sign
that hides a sensitive stem, or any other ambiguity raises the risk floor and
refuses Fast Fix. A source
writer also needs the diff result and a closed class. After three ordinary
attempts the only writer is a continuation that still has progress.
"""
import copy
import html
import re
import unicodedata
import urllib.parse

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
# Free text never proves a surface is clean. It can only raise the floor or block.
# Stems match inside one word, never across a path segment or a space.
# "author" / "authors" are not "auth". "secretary" is not "secret".
_EN_STEMS = (
    "authoriz", "authoris", "authorit", "authent", "oauth", "identit", "password",
    "passwd", "credential", "sandbox", "apparmor", "admission", "budget", "permiss",
    "concurren", "payment", "billing", "migrat", "rollback", "irreversib", "privilege",
    "rbac", "money", "pii", "qareuse", "dataloss", "guard", "rights",
)
_SENSITIVE_PHRASES = (("qa", "reuse"), ("data", "loss"), ("roll", "back"))
# Word prefixes on Cyrillic, before any Latin confusable fold.
# "платформу" is not a payment. "правильно" is not "права". "секретарь" is not "секрет".
_RU_PREFIXES = (
    "авториз", "аутентиф", "идентиф", "идентичн", "миграц", "мигрир", "откат", "деньг",
    "платеж", "оплат", "персональн", "парол", "токен", "сесси", "доступ",
)
_RU_RIGHTS = frozenset(("прав", "права", "право", "правом", "правами", "правах", "правам"))
# Destructive verbs are word prefixes. "тестовый" and "протест" are not deletions.
_RU_DESTRUCTIVE = ("удал", "отключ", "пропуст", "закомментир", "ослаб", "повыс")
# Lowercase look-alikes, including Latin dotless i. Mixed-script tokens are already critical.
_CONFUSABLE = str.maketrans({
    "а": "a", "б": "b", "в": "b", "е": "e", "ё": "e", "к": "k", "м": "m", "н": "h",
    "о": "o", "р": "p", "с": "c", "т": "t", "у": "y", "х": "x", "і": "i", "ї": "i",
    "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d", "ԛ": "q", "ү": "y", "ғ": "f", "ь": "",
    "ъ": "", "ɡ": "g", "α": "a", "β": "b", "γ": "y", "ε": "e", "ζ": "z", "η": "n",
    "ι": "i", "κ": "k", "μ": "u", "ν": "v", "ο": "o", "ρ": "p", "τ": "t", "υ": "u",
    "χ": "x", "ω": "w", "ı": "i",
})
# Undecoded residue raises risk. The limit stops a nested encoding from looping.
# The pattern is the class of encoding introducers, not a list of bypass strings.
_DECODE_LIMIT = 8
_RESIDUE = re.compile(
    r"%u[0-9A-Fa-f]{4}|%[0-9A-Fa-f]{2}|&#x?[0-9A-Za-z]+;?|&[A-Za-z][A-Za-z0-9]+;|"
    r"\\u\{[0-9A-Fa-f]{1,6}\}|\\u[0-9A-Fa-f]{4}|\\U[0-9A-Fa-f]{8}|\\x[0-9A-Fa-f]{2}|"
    r"\\[0-7]{3}|\\u\{")
_ESCAPE = re.compile(
    r"\\(?:u\{([0-9A-Fa-f]{1,6})\}|u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|x([0-9A-Fa-f]{2})|([0-7]{3}))")
_PCT_U = re.compile(r"%u([0-9A-Fa-f]{4})")
# Fast Fix alphabet. Anything else is an ambiguity and raises the floor.
_ALLOWED_PUNCT = frozenset(" ._-/:@")
_SLASH_FOLD = str.maketrans({
    "\u2044": "/", "\u2215": "/", "\u29f8": "/", "\uff0f": "/", "\uff3c": "\\",
})
_TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o",
    "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts",
    "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
})
_CANONICAL = (
    "authorization", "password", "credential", "sandbox", "identity", "migration",
    "payment", "rollback", "oauth", "permission", "privilege",
)
_DIAGNOSTIC_WORDS = frozenset((
    "error", "errors", "ts", "assertionerror", "assertion", "assertions", "failed",
    "expected", "received", "permission", "denied", "timeout", "timeouts", "fail",
    "failure", "undefined", "exception", "typeerror",
))
_GENERIC_WORDS = _DIAGNOSTIC_WORDS | frozenset((
    "in", "at", "on", "of", "to", "for", "from", "the", "and", "or", "a", "an",
    "src", "source", "app", "apps", "web", "lib", "test", "tests", "file", "files",
    "line", "lines", "code", "path", "dir", "dirs", "pkg", "mod", "module", "fn",
    "var", "let", "const", "true", "false", "null", "none", "py", "js", "tsx", "jsx",
))
# Fast Fix is an allowlist. An unknown surface is not fast, even when the text looks quiet.
_SAFE_SURFACES = frozenset(("rename", "comment", "docs", "formatting", "format", "test-name"))
_MARK_CATEGORIES = frozenset(("Mn", "Me", "Cf", "Cc"))
# Condition 7 is proven only by these explicit fields, on the evidence and on the plan.
_UNCHANGED = ("assertions_unchanged", "expected_values_unchanged", "qa_unchanged",
              "timeout_unchanged", "auth_unchanged")
_PLAN_WEAKEN = ("delete_assertions", "weaken_auth", "disable_security", "weaken_qa",
                "weaken_timeout", "adjust_expected")
SPECIALIST_AGY = "agy:claude-opus-5-5-high"
SPECIALIST_SOL = "codex:gpt-6.1-sol:high"
_WRITER_EVENTS = frozenset((
    "TEMPLATE", "CONTINUATION", "SOURCE_KNOWN_STANDARD", "SOURCE_KNOWN_COMPLEX",
    "SOURCE_KNOWN_LOCAL",
))
ALLOWED_EFFECTS = frozenset(("read", "source_edit_within_scope", "deterministic_tool", "none"))
SEARCH_METHODS = frozenset(("grep", "ast", "lint", "test"))
# §12: at most one schema-repair turn. Attempt 0 is that turn; 1 and above hold.
SCHEMA_REPAIR_BUDGET = 1
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
    "weaken_auth", "disable_security", "weaken_qa", "weaken_timeout", "adjust_expected",
    "assertions_unchanged", "expected_values_unchanged", "qa_unchanged",
    "timeout_unchanged", "auth_unchanged", "executable",
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
    "assertions_unchanged", "expected_values_unchanged", "qa_unchanged", "timeout_unchanged",
    "auth_unchanged", "fast_fix_history_checked", "critical_qa_qualified",
    "line_count", "event_text", "goal", "paths", "diagnostics", "whole_class_plan",
    "author_qa_same_snapshot", "complexity",
    "event_kind", "requirement_conflict", "plan", "diff_check",
))
_SEARCH_BASE = frozenset(("saved", "method", "pattern", "scope", "instances", "assurance_only"))
_SEARCH_OPTIONAL = frozenset(("matched_count", "scope_listing", "diff_identifiers"))
_DIFF_KEYS = frozenset(("tool", "hunks") + _UNCHANGED)
_DIFF_TOOLS = frozenset(("diff", "git", "ast"))


def _finish(base, **updates):
    payload = dict(base)
    payload.update(updates)
    return _decision(**payload)


def _deny_write(updates, reason):
    updates["writer"] = False
    updates["executed"] = False
    updates["fast_fix"] = False
    updates["plan_honored"] = False
    updates["continuation_granted"] = False
    updates["author_route"] = None
    updates["route"] = "hold"
    updates["reason"] = reason
    updates["model_calls"] = 0
    updates["planner_calls"] = 0
    updates["astra_calls"] = 0
    return updates


def _emit(base, evidence, plan, **updates):
    """A source writer needs an admitted, proven, executable plan. Absence is denial."""
    writing = bool(updates.get("writer") or updates.get("fast_fix")
                   or updates.get("event_class") in _WRITER_EVENTS)
    if not writing:
        return _finish(base, **updates)
    if _floor(evidence) not in ("low", "moderate"):
        return _finish(base, **_deny_write(updates, "risk is not proven"))
    if (evidence.get("minimal_action_known") is not True
            or evidence.get("architecture_research_required") is not False):
        return _finish(base, **_deny_write(
            updates, "architecture is open or the minimal action is not proven"))
    if (evidence.get("external_effects_unknown") is not False
            or evidence.get("unknown_effect") is not False):
        return _finish(base, **_deny_write(updates, "external effect is not proven absent"))
    if (evidence.get("scope_within_admission") is not True
            or evidence.get("finite_budget") is not True):
        return _finish(base, **_deny_write(updates, "scope is not inside the admission"))
    if _weakens_any(evidence):
        return _finish(base, **_deny_write(
            updates, "condition 7 assertions, expected values, QA or timeout"))
    if type(plan) is not dict:
        return _finish(base, **_deny_write(updates, "plan is missing"))
    if plan.get("executable") is not True:
        return _finish(base, **_deny_write(updates, "plan is not executable"))
    if (updates.get("writer") or updates.get("fast_fix")) and not _writer_proof(evidence):
        return _finish(base, **_deny_write(updates, "writer proof is incomplete"))
    return _finish(base, **updates)


def _writer_proof(evidence):
    """A writer needs a diff result and one closed class. Fast Fix surfaces are allowlisted.

    A complex cause may name another non-empty surface (§8). Missing proof is denial.
    """
    if not _diff_proven(evidence.get("diff_check")):
        return False
    if not _class_closed(evidence.get("class_search")):
        return False
    if _safe_surface(evidence):
        return True
    surface = evidence.get("change_surface")
    return evidence.get("complexity") == "complex" and type(surface) is str and bool(surface.strip())


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
    try:
        return _refuse_unsupported_task(task)
    except Exception:
        return _decision(rejected=True, executed=False, writer=False, reason="invalid case",
                         event_class="REJECTED", route="hold")


def _refuse_unsupported_task(task):
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
    try:
        return _validate_plan(plan)
    except Exception:
        return "incompatible plan"


def _validate_plan(plan):
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
    for flag in _PLAN_WEAKEN + _UNCHANGED + ("executable",):
        if type(plan[flag]) is not bool:
            return "incompatible plan"
    if any(plan[flag] for flag in _PLAN_WEAKEN):
        return "security check would be weakened"
    if plan["fast_fix"] and (plan["executable"] is not True or any(plan[flag] is not True for flag in _UNCHANGED)):
        return "fast fix proof missing"
    return None


def decide(case):
    """One deterministic classification. Does not call a provider or write source."""
    try:
        return _decide(case)
    except Exception:
        return _decision(rejected=True, executed=False, writer=False, fast_fix=False,
                         reason="invalid case", event_class="REJECTED", route="hold")


def _decide(case):
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


def _known_local(base, evidence, plan, risk, honored):
    """Fast Fix does not spend an ordinary author attempt."""
    model, cost = _auto_receipt("cursor:auto", evidence)
    return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                 fast_fix=True, planner_calls=0, astra_calls=0, model_calls=1,
                 author_attempts_delta=0, ledger_category="fast_fix", author_route="cursor:auto",
                 qa_route=_ordinary_qa(evidence), route="cursor:auto", effective_model=model, cost=cost,
                 whole_class=False, reason="all eight Fast Fix conditions hold",
                 event_class="SOURCE_KNOWN_LOCAL", plan_honored=honored)


def _classify(base, evidence, plan):
    risk = _floor(evidence)
    honored = None if plan is None else plan.get("executable") is True
    search_error = _search_state(evidence["class_search"])
    if evidence["class_search"] is not None and search_error:
        return _finish(base, rejected=True, reason=search_error, event_class="REJECTED",
                       route="hold", risk=risk, plan_honored=False)
    class_open = _class_open(evidence)
    prior_closed = _prior_closed(evidence)
    if risk == "critical" or evidence["difficult_or_repeating"]:
        return _expert(base, evidence, plan, risk, class_open, prior_closed, honored)
    # Continuation exists only on the third ordinary attempt. Later counters hold.
    if evidence["author_attempts"] > 3:
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                       continuation_granted=False, fast_fix=False,
                       reason="continuation is only available on the third author attempt",
                       event_class="LIMIT", route="hold")
    # The third attempt is not a fourth write. Continuation is the only writer
    # here, and only while progress still holds (SR-T18). Fast Fix does not
    # spend an earlier attempt, but it cannot open a writer once three are used.
    if evidence["author_attempts"] == 3:
        if evidence["brief_usable"] and evidence["progress"]:
            if evidence["continuation_used"] not in (0, 1):
                return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                               continuation_granted=False, fast_fix=False,
                               reason="continuation budget is exhausted", event_class="LIMIT", route="hold")
            if evidence["architecture_research_required"] or evidence["minimal_action_known"] is not True:
                return _pm(base, evidence, risk, whole_class=False, fast_fix_closed=False,
                           reason="architecture is open or the minimal action is not proven")
            return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                         planner_calls=0, astra_calls=0, model_calls=1, continuation_granted=True,
                         owner_micro_go=False, history_reset=False,
                         author_route="cursor:auto" if evidence["complexity"] != "complex" else SPECIALIST_SOL,
                         qa_route=_ordinary_qa(evidence), route="continuation", ledger_category="ordinary",
                         next_ordinary_attempt=evidence["author_attempts"] + evidence["continuation_used"] + 1,
                         reason="bounded continuation reuses the brief; history is kept",
                         event_class="CONTINUATION", cost=None, plan_honored=honored)
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                       continuation_granted=False, fast_fix=False,
                       reason="ordinary attempts are exhausted; continuation needs progress",
                       event_class="LIMIT", route="hold")
    if evidence["template_applicable"] and _norm_id(evidence["template_id"]):
        # A template writer needs a closed single-instance search, not a clean sentence.
        if not (_template_ok(evidence, risk) and _class_closed(evidence["class_search"])
                and not prior_closed):
            return _pm(base, evidence, risk, whole_class=class_open, fast_fix_closed=prior_closed,
                       reason="template preconditions are not proven")
        tool = evidence["template_tool"] == "deterministic_tool"
        route = "deterministic_tool" if tool else "cursor:auto"
        model, cost = _auto_receipt(route, evidence)
        return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=not tool,
                     planner_calls=0, astra_calls=0, model_calls=0 if tool else 1,
                     fast_fix=False, route=route, author_route=route, qa_route=_ordinary_qa(evidence),
                     effective_model=model, cost=cost, risk=risk, ledger_category="ordinary",
                     reason="proven template; no planner or Astra",
                     event_class="TEMPLATE", plan_honored=honored)
    if class_open or prior_closed:
        return _pm(base, evidence, risk, whole_class=class_open, fast_fix_closed=prior_closed,
                   reason="Fast Fix refused; defect class is not closed for a single repair")
    # All eight Fast Fix conditions outrank a usable brief (§8 LOCAL, §9).
    allowed, fast_reason = _fast_fix_block(evidence, risk)
    if allowed:
        return _known_local(base, evidence, plan, risk, honored)
    if evidence["brief_usable"] and evidence["cause"] in ("proven", "supported") and evidence["author_attempts"] < 3:
        if evidence["architecture_research_required"] or evidence["minimal_action_known"] is not True:
            return _pm(base, evidence, risk, whole_class=False, fast_fix_closed=False,
                       reason="architecture is open or the minimal action is not proven")
        model, cost = _auto_receipt("cursor:auto", evidence)
        return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                     planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                     author_route="cursor:auto", qa_route=_ordinary_qa(evidence), route="cursor:auto",
                     effective_model=model, cost=cost, ledger_category="ordinary",
                     reason="usable brief is reused; no extra planner or diagnosis",
                     event_class="SOURCE_KNOWN_STANDARD", plan_honored=honored)
    # Not a proven minimal repair: do not fall through to a source writer.
    if (evidence["cause"] == "proven" and evidence["complexity"] == "complex"
            and evidence["minimal_action_known"] and not evidence["architecture_research_required"]):
        return _author(base, evidence, plan, risk, SPECIALIST_SOL, "SOURCE_KNOWN_COMPLEX",
                       "known complex noncritical cause; Astra is not required", honored)
    if (evidence["author_attempts"] < 3 and evidence["cause"] == "proven"
            and evidence["minimal_action_known"] and not evidence["architecture_research_required"]
            and evidence["brief_usable"]):
        return _author(base, evidence, plan, risk, "cursor:auto", "SOURCE_KNOWN_STANDARD",
                       "known cause uses an evidence-bound repair", honored)
    if evidence["cause"] == "missing_evidence":
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk, qa_verdict=None,
                       missing_inputs=list(evidence["missing_inputs"]) or ["source evidence"],
                       reason="missing evidence; do not guess with a larger model",
                       event_class="INPUT_MISSING", route="hold")
    reason = "Fast Fix refused; " + fast_reason if evidence["cause"] == "proven" else "one read-only Technical PM pass"
    return _pm(base, evidence, risk, whole_class=class_open or not _search_saved(evidence) and evidence["cause"] == "proven",
               fast_fix_closed=prior_closed, reason=reason)


def _expert(base, evidence, plan, risk, class_open, prior_closed, honored):
    qa = _critical_qa(evidence)
    nxt = evidence["author_attempts"] + 1 if prior_closed else None
    if qa is None:
        return _finish(base, policy_applied=True, executed=False, writer=False, risk="critical",
                       astra_calls=1, planner_calls=0, model_calls=0, fast_fix=False,
                       fast_fix_closed=prior_closed, whole_class=class_open, qa_verdict=None,
                       next_ordinary_attempt=nxt,
                       reason="critical path needs a specialist QA route with separate proof",
                       event_class="SOURCE_CRITICAL", route="hold", plan_honored=False)
    return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=False, risk="critical",
                 astra_calls=1, planner_calls=0, model_calls=1, fast_fix=False,
                 fast_fix_closed=prior_closed, whole_class=class_open, next_ordinary_attempt=nxt,
                 author_route=SPECIALIST_SOL, qa_route=qa, route="codex:gpt-6-astra:high",
                 ledger_category="ordinary", event_class="SOURCE_CRITICAL",
                 plan_honored=False if class_open else honored,
                 reason="critical or hard defect uses read-only Astra, whole-class when another instance exists")


def _pm(base, evidence, risk, *, whole_class, reason, fast_fix_closed=False):
    nxt = evidence["author_attempts"] + 1 if fast_fix_closed else None
    return _emit(base, evidence, evidence.get("plan"), policy_applied=True, executed=True, writer=False,
                 risk=risk, planner_calls=1, astra_calls=0, model_calls=1, fast_fix=False,
                 fast_fix_closed=fast_fix_closed, whole_class=whole_class, next_ordinary_attempt=nxt,
                 route="codex:gpt-6.1-sol:high",
                 author_route="cursor:auto" if evidence["complexity"] != "complex" else SPECIALIST_SOL,
                 qa_route=_ordinary_qa(evidence), reason=reason, event_class="SOURCE_UNCERTAIN",
                 plan_honored=False)


def _author(base, evidence, plan, risk, route, klass, reason, honored):
    model, cost = _auto_receipt(route, evidence)
    return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                 planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                 author_route=route, qa_route=_ordinary_qa(evidence), route=route,
                 effective_model=model, cost=cost, ledger_category="ordinary",
                 reason=reason, event_class=klass, plan_honored=honored)


def _quota(base, evidence):
    route = evidence["fallback_route"]
    risk = _floor(evidence)
    proofs = evidence["effects_proven_absent"] is True and evidence["fallback_equivalent"] is True
    # Astra diagnoses. It is never an author, including on an ordinary quota fallback.
    astra = type(route) is str and "gpt-6-astra" in route
    ordinary = (risk in ("low", "moderate") and type(route) is str and route in ROUTES
                and not route.startswith("agy:") and not astra)
    qa = _critical_qa(evidence)
    # Critical fallback keeps the same specialist QA proof as the critical path.
    specialist = (risk == "critical" and not astra and qa is not None and (
        route == SPECIALIST_SOL or (route == SPECIALIST_AGY and evidence["agy_qa_qualified"] is True)))
    if proofs and ordinary:
        return _finish(base, policy_applied=True, executed=True, writer=False, model_calls=1,
                       risk=risk, route=route, author_route=route,
                       fallback_reason="quota_exhausted_equivalent_fallback",
                       reason="quota exhausted equivalent fallback",
                       event_class="QUOTA", qa_route=_ordinary_qa(evidence))
    if proofs and specialist:
        return _finish(base, policy_applied=True, executed=True, writer=False, model_calls=1,
                       risk=risk, route=route, author_route=route, qa_route=qa,
                       fallback_reason="quota_exhausted_equivalent_fallback",
                       reason="quota exhausted equivalent fallback",
                       event_class="QUOTA")
    reason = ("critical quota fallback is not a specialist route" if risk == "critical"
              else "quota exhausted without an admitted equivalent fallback")
    return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                   fallback_reason=None, reason=reason, event_class="QUOTA", route="hold")


def _schema_repair(base, evidence):
    # One turn only. Zero means that turn is still available; one or more holds.
    if evidence["schema_repair_attempts"] >= SCHEMA_REPAIR_BUDGET:
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         planner_calls=0, astra_calls=0, model_calls=0,
                         reason="schema repair budget exhausted",
                         event_class="SCHEMA_REPAIR", route="hold")
    return _finish(base, policy_applied=True, executed=False, writer=False,
                     planner_calls=0, astra_calls=0, model_calls=0,
                     reason="one schema repair turn; Astra is not escalated",
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
    if evidence["critical_signs"] or _sensitive_any(evidence) or any(
            item["severity"] == "critical" for item in evidence["findings"]):
        return "critical"
    if evidence["risk"] in ("low", "moderate", "critical"):
        return evidence["risk"]
    return None


def _template_ok(evidence, risk):
    return bool(evidence["template_applicable"] and _norm_id(evidence["template_id"])
                and risk in ("low", "moderate") and not evidence["critical_signs"]
                and evidence["minimal_action_known"] is True
                and evidence["architecture_research_required"] is False
                and evidence["external_effects_unknown"] is False
                and evidence["unknown_effect"] is False
                and not _sensitive_any(evidence))


def _ordinary_qa(evidence):
    proof = evidence["qa_route_proof"]
    if evidence["agy_qa_qualified"] and type(proof) is str and proof.startswith("agy:") and proof in ROUTES:
        return proof
    return "codex:gpt-6.1-sol:medium"


def _critical_qa(evidence):
    """Critical boundary QA is a specialist route plus separate proof, not any AGY id."""
    if not evidence["qa_independent"] or evidence["session_shared"] or evidence["author_qa_same_snapshot"]:
        return None
    if evidence["critical_qa_qualified"] is not True:
        return None
    proof = evidence["qa_route_proof"]
    if proof == SPECIALIST_SOL:
        return proof
    if proof == SPECIALIST_AGY and evidence["agy_qa_qualified"] is True:
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
    """A saved search that is not exactly one real class instance blocks a single-site repair."""
    search = evidence["class_search"]
    if type(search) is not dict:
        return False
    return not _class_closed(search)


def _search_saved(evidence):
    search = evidence["class_search"]
    return type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False


def _search_state(search):
    """The old six keys stay valid. Proof keys are optional, and missing proof is not closure."""
    if search is None:
        return None
    if type(search) is not dict:
        return "invalid class search"
    keys = set(search)
    if not _SEARCH_BASE <= keys or keys - _SEARCH_BASE - _SEARCH_OPTIONAL:
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
    if "matched_count" in search and (
            type(search["matched_count"]) is not int or search["matched_count"] < 0):
        return "invalid class search"
    listing = search.get("scope_listing", None)
    if "scope_listing" in search and (
            type(listing) is not list or len(listing) > 32
            or any(type(item) is not str or len(item) > 240 for item in listing)):
        return "invalid class search"
    identifiers = search.get("diff_identifiers", None)
    if "diff_identifiers" in search and (
            type(identifiers) is not list or len(identifiers) > 32
            or any(type(item) is not str or len(item) > 200 for item in identifiers)):
        return "invalid class search"
    return None


def _prior_closed(evidence):
    prior = evidence["prior_fast_fix"]
    fingerprint = _fingerprint_key(evidence["defect_fingerprint"])
    if type(prior) is not dict or not fingerprint:
        return False
    return prior.get("result") == "fail" and _fingerprint_key(prior.get("fingerprint")) == fingerprint


def _class_closed(search):
    """Closure is a tool result, not a shape that merely looks like an identifier."""
    return (type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False
            and search.get("method") in SEARCH_METHODS and search.get("instances") == 1
            and _pattern_proves_class(search))


def _fast_fix_block(evidence, risk):
    """Return (allowed, reason). Every condition is default-deny: missing proof is failure."""
    plan = evidence["plan"]
    checks = (
        (_safe_surface(evidence), "change surface is not a fast-fix surface"),
        (evidence["cause"] == "proven" and evidence["acceptance_unchanged"] is True
         and bool(_fingerprint_key(evidence["defect_fingerprint"])),
         "condition 1 cause or acceptance"),
        (evidence["minimal_action_known"] is True and evidence["architecture_research_required"] is False,
         "condition 2 architecture still open"),
        (risk in ("low", "moderate") and evidence["critical_signs"] is False
         and not _sensitive_any(evidence) and evidence["external_effects_unknown"] is False
         and evidence["unknown_effect"] is False,
         "condition 3 risk floor or unknown effect"),
        (evidence["scope_within_admission"] is True and evidence["finite_budget"] is True,
         "condition 4 scope or budget"),
        (evidence["regression_known"] is True, "condition 5 regression check"),
        (evidence["fast_fix_history_checked"] is True and not _prior_closed(evidence),
         "condition 6 Fast Fix history"),
        (_condition_seven(evidence, plan), "condition 7 assertions, expected values, QA or timeout"),
        (_class_closed(evidence["class_search"]), "condition 8 defect class is not proven closed"),
    )
    for ok, reason in checks:
        if not ok:
            return False, reason
    return True, ""


def _condition_seven(evidence, plan):
    """Limits are a diff tool result. A sentence or a lone boolean is not that result."""
    if not _diff_proven(evidence.get("diff_check")):
        return False
    if type(plan) is not dict or plan.get("executable") is not True:
        return False
    if any(evidence.get(flag) is not True or plan.get(flag) is not True for flag in _UNCHANGED):
        return False
    if any(plan.get(flag) is True for flag in _PLAN_WEAKEN):
        return False
    if _weakens_any(evidence):
        return False
    return True


def _codepoint(code):
    if code > 0x10FFFF or 0xD800 <= code <= 0xDFFF:
        return None
    return chr(code)


def _escape_char(match):
    if match.group(5):
        char = _codepoint(int(match.group(5), 8))
    else:
        hexes = match.group(1) or match.group(2) or match.group(3) or match.group(4)
        char = _codepoint(int(hexes, 16))
    return match.group(0) if char is None else char


def _decode_layer(text):
    """One pass over the encoding class: percent, %u, HTML, and literal escapes."""
    text = _PCT_U.sub(lambda match: _codepoint(int(match.group(1), 16)) or match.group(0),
                      urllib.parse.unquote(text))
    return _ESCAPE.sub(_escape_char, html.unescape(text))


def _decode(text):
    """Decode until a fixed point. Anything that still looks encoded raises risk."""
    for _ in range(_DECODE_LIMIT):
        decoded = _decode_layer(text)
        if decoded == text:
            break
        text = decoded
    return text, _RESIDUE.search(text) is not None


def _strip_marks(text):
    """NFKD, then drop marks, format, and controls. Spaces stay, so words do not glue together."""
    text = unicodedata.normalize("NFKD", text)
    kept = []
    for char in text:
        if unicodedata.category(char) in _MARK_CATEGORIES and unicodedata.category(char) != "Zs":
            continue
        code = ord(char)
        if 0xFE00 <= code <= 0xFE0F or 0xE0100 <= code <= 0xE01EF:
            continue
        kept.append(char)
    return "".join(kept)


def _camel_split(text):
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    text = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", text)
    return text


def _script(char):
    if not char.isalpha():
        return None
    code = ord(char)
    if code <= 0x7F or 0x00C0 <= code <= 0x024F or 0x1E00 <= code <= 0x1EFF:
        return "lat"
    if (0x0400 <= code <= 0x052F or 0xA640 <= code <= 0xA69F
            or 0x1C80 <= code <= 0x1C8F or 0x2DE0 <= code <= 0x2DFF):
        return "cyr"
    if 0x0370 <= code <= 0x03FF or 0x1F00 <= code <= 0x1FFF:
        return "gre"
    return "other"


def _mixed_script(text):
    for token in re.findall(r"[^\W\d_]+", text, flags=re.UNICODE):
        scripts = {script for script in (_script(char) for char in token) if script}
        if len(scripts) >= 2:
            return True
    return False


def _ru_sensitive_word(word):
    if any(word.startswith(stem) for stem in _RU_PREFIXES):
        return True
    if word.startswith("секрет") and not word.startswith("секретар"):
        return True
    return word in _RU_RIGHTS


def _word_pieces(word):
    """Collapse separators inside one word. Digits drop. Separate words stay apart."""
    translated = _camel_split(word).casefold().translate(_CONFUSABLE)
    pieces = []
    for token in re.split(r"[^0-9a-z]+", translated):
        token = re.sub(r"\d", "", token)
        if token:
            pieces.append(token)
    return pieces, "".join(pieces)


def _stem_with_repeats(stem, token):
    """A stem matches when the token only adds repeated letters, including a prefix."""
    index = 0
    cursor = 0
    while index < len(stem) and cursor < len(token):
        if stem[index] != token[cursor]:
            return False
        char = stem[index]
        stem_run = token_run = 0
        while index < len(stem) and stem[index] == char:
            index += 1
            stem_run += 1
        while cursor < len(token) and token[cursor] == char:
            cursor += 1
            token_run += 1
        if token_run < stem_run:
            return False
    return index == len(stem)


def _token_risky(token):
    if token.startswith("secretary"):
        token = token[len("secretary"):]
    if not token:
        return False
    if "secret" in token or _stem_with_repeats("secret", token):
        return True
    for stem in _EN_STEMS:
        # Short stems such as "pii" match a whole token, not the seam of api+index.
        if len(stem) >= 4 and stem in token:
            return True
        if token.startswith(stem) or _stem_with_repeats(stem, token):
            return True
    # "auth" anywhere in the word, except the author/authors family.
    if "auth" in token and not token.startswith("author"):
        return True
    return False


def _cross_hit(left, right):
    """A separator splits a word when the join, not either side, is the stem."""
    if not left or not right:
        return False
    joined = left + right
    if joined.startswith("secretary") or joined.startswith("author"):
        # "author" is safe, but "author/ization" still extends past "author".
        pass
    for stem in _EN_STEMS:
        if len(stem) <= len(left):
            continue
        if joined.startswith(stem) or _stem_with_repeats(stem, joined):
            return True
    if len("secret") > len(left) and (
            joined.startswith("secret") or _stem_with_repeats("secret", joined)):
        if not joined.startswith("secretary"):
            return True
    return False


def _pieces_risky(pieces, joined):
    if joined and _token_risky(joined):
        return True
    return any(_token_risky(piece) for piece in pieces)


def _phrase_hit(tokens):
    for phrase in _SENSITIVE_PHRASES:
        span = len(phrase)
        if any(tokens[index:index + span] == list(phrase) for index in range(len(tokens) - span + 1)):
            return True
    return False


def _latin_sensitive(text):
    """Stems stay inside a word. Path separators and spaces are not glue."""
    phrase_tokens = []
    for segment in re.split(r"[/\\]+", text):
        letter_run = []
        for word in re.split(r"\s+", segment):
            if not word:
                continue
            scripts = {script for script in (_script(char) for char in word) if script}
            if "lat" not in scripts:
                if len(letter_run) >= 2 and _token_risky("".join(letter_run)):
                    return True
                letter_run = []
                continue
            pieces, joined = _word_pieces(word)
            if not pieces:
                continue
            if _pieces_risky(pieces, joined):
                return True
            if len(joined) == 1:
                letter_run.append(joined)
            else:
                if len(letter_run) >= 2 and _token_risky("".join(letter_run)):
                    return True
                letter_run = []
            phrase_tokens.extend(pieces)
        if len(letter_run) >= 2 and _token_risky("".join(letter_run)):
            return True
        if len(letter_run) >= 2:
            phrase_tokens.append("".join(letter_run))
    if _phrase_hit(phrase_tokens):
        return True
    return any(_cross_hit(left, right) for left, right in zip(phrase_tokens, phrase_tokens[1:]))


def _flat_pieces(text):
    pieces = []
    for segment in re.split(r"[/\\]+", text):
        for word in re.split(r"\s+", segment):
            if word:
                word_pieces, _joined = _word_pieces(word)
                pieces.extend(word_pieces)
    return pieces


def _has_prefix(tokens, prefixes):
    return any(token.startswith(prefix) for token in tokens for prefix in prefixes)


def _iter_texts(value, key=None, seen=None, depth=0):
    if depth > 32 or key in ("binding", "schema"):
        return
    if type(value) is str:
        yield value
        return
    if type(value) is not dict and type(value) is not list and type(value) is not tuple:
        return
    if seen is None:
        seen = set()
    marker = id(value)
    if marker in seen:
        return
    seen.add(marker)
    if type(value) is dict:
        for child_key, child in value.items():
            yield from _iter_texts(child, child_key, seen, depth + 1)
    else:
        for child in value:
            yield from _iter_texts(child, None, seen, depth + 1)
    seen.discard(marker)


def _foreign_script(text):
    """A letter outside Latin and Cyrillic is unrecognized. It raises the floor."""
    for char in text:
        script = _script(char)
        if script is not None and script not in ("lat", "cyr"):
            return True
    return False


def _outside_allowlist(text):
    """Fast Fix text is an allowlist. Any other character is an ambiguity."""
    for char in text:
        if char.isascii() and (char.isalnum() or char in _ALLOWED_PUNCT):
            continue
        if "а" <= char <= "я" or char == "ё" or char in "ьъ":
            continue
        return True
    return False


def _cyr_plain(word):
    """Drop signs that are used to split a stem. Ordinary spelling stays a word."""
    return word.replace("ь", "").replace("ъ", "")


def _cyr_noise(text):
    """A digit inside a Cyrillic word, or a sign hiding a sensitive stem, is noise."""
    for word in re.findall(r"[0-9а-яё]+", text.casefold()):
        if not any(("а" <= char <= "я") or char == "ё" for char in word):
            continue
        if any(char.isdigit() for char in word):
            return True
        plain = _cyr_plain(word)
        if plain != word and _ru_sensitive_word(plain):
            return True
    return False


def _long_hex(text):
    """A long hex blob is an encoded payload, not a rename."""
    for token in re.findall(r"[0-9A-Za-z]{16,}", text):
        body = token[2:] if token.lower().startswith("0x") else token
        if len(body) >= 16 and re.fullmatch(r"[0-9a-fA-F]+", body):
            return True
    return False


def _ambiguous(text):
    return _outside_allowlist(text) or _cyr_noise(text) or _long_hex(text)


def _cyr_sensitive(text):
    words = [_cyr_plain(word) for word in re.findall(r"[а-яё]+", text.casefold())]
    if any(_ru_sensitive_word(word) for word in words):
        return True
    for left, right in zip(words, words[1:]):
        if _ru_sensitive_word(left + right):
            return True
    return False


def _common_prefix(left, right):
    count = 0
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        count += 1
    return count


def _edit_distance(left, right):
    if abs(len(left) - len(right)) > 2:
        return 3
    previous = list(range(len(right) + 1))
    for index, left_char in enumerate(left, 1):
        current = [index]
        for inner, right_char in enumerate(right, 1):
            current.append(min(previous[inner] + 1, current[-1] + 1,
                               previous[inner - 1] + (left_char != right_char)))
        previous = current
    return previous[-1]


def _translit_sensitive(text):
    """Cyrillic transliteration of a sensitive word raises the floor."""
    for word in re.findall(r"[а-яё]+", text.casefold()):
        if word.startswith("секретар") or word == "автор":
            continue
        latin = word.translate(_TRANSLIT)
        forms = {latin, latin.replace("v", "w"), latin.replace("k", "c"), latin.replace("ks", "x")}
        for form in forms:
            if _token_risky(form):
                return True
            for canonical in _CANONICAL:
                if _common_prefix(form, canonical) >= 6 or _edit_distance(form, canonical) <= 1:
                    return True
    return False


def _sensitive(value):
    if type(value) is not str or not value:
        return False
    folded = unicodedata.normalize("NFKD", value).translate(_SLASH_FOLD)
    decoded, residue = _decode(folded)
    stripped = _strip_marks(decoded)
    # Residue and anything outside the allowlist are the same class: fail closed.
    if residue or (stripped and _ambiguous(stripped)):
        return True
    if not stripped:
        return False
    if _foreign_script(stripped) or _mixed_script(stripped):
        return True
    if _cyr_sensitive(stripped):
        return True
    if _latin_sensitive(stripped):
        return True
    return _translit_sensitive(stripped)


def _sensitive_any(evidence):
    return any(_sensitive(text) for text in _iter_texts(evidence))


def _fingerprint_key(value):
    """Identity keeps hyphens. Marks, spaces, and newlines do not make a new defect."""
    if type(value) is not str:
        return ""
    decoded, _residue = _decode(value)
    text = _strip_marks(decoded).casefold().translate(_CONFUSABLE)
    text = "".join(char for char in text if unicodedata.category(char) != "Zs" and char not in "\t\n\r")
    if not text or not re.search(r"[a-z0-9]", text):
        return ""
    return text


def _norm_id(value):
    return _fingerprint_key(value)


def _has_cycle(value, seen=None, depth=0):
    if depth > 32:
        return True
    if type(value) is not dict and type(value) is not list and type(value) is not tuple:
        return False
    if seen is None:
        seen = set()
    marker = id(value)
    if marker in seen:
        return True
    seen.add(marker)
    nested = value.values() if type(value) is dict else value
    for child in nested:
        if _has_cycle(child, seen, depth + 1):
            return True
    seen.remove(marker)
    return False


def _concrete_path(value):
    """A concrete path names a file or directory. Dots, globs, and blanks do not."""
    if type(value) is not str:
        return False
    text = value.strip()
    if not text or text.casefold() in _GENERIC_WORDS:
        return False
    if "/" not in text and "." not in text:
        return False
    if re.fullmatch(r"[\*/\\\.\s]+", text):
        return False
    # A glob is not one file. Condition 8 needs a concrete path (SR-T26).
    if any(char in text for char in "*?[]{}"):
        return False
    if not re.search(r"[0-9A-Za-z]{2,}", text):
        return False
    return True


def _generic_part(part):
    folded = part.casefold()
    return (folded in _GENERIC_WORDS or folded.isdigit() or len(folded) <= 1
            or re.fullmatch(r"ts\d+", folded) is not None)


def _ident_parts(pattern):
    parts = []
    for ident in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", pattern):
        spaced = _camel_split(ident).replace(" ", "_")
        parts.extend(piece.casefold() for piece in spaced.split("_") if piece)
    return parts


def _pattern_proves_class(search):
    pattern = search.get("pattern")
    if type(pattern) is not str or not _concrete_path(search.get("scope")):
        return False
    identifiers = search.get("diff_identifiers")
    if type(identifiers) is not list or pattern not in identifiers:
        return False
    listing = search.get("scope_listing")
    if type(listing) is not list or not any(_concrete_path(item) for item in listing):
        return False
    if type(search.get("matched_count")) is not int or search.get("matched_count") != 1:
        return False
    if search.get("instances") != 1:
        return False
    parts = _ident_parts(pattern)
    # A generic or diagnostic fragment left after the split does not name a class.
    return bool(parts) and not all(_generic_part(part) for part in parts)


def _diff_proven(diff):
    if type(diff) is not dict or set(diff) != _DIFF_KEYS:
        return False
    if diff.get("tool") not in _DIFF_TOOLS:
        return False
    hunks = diff.get("hunks")
    if type(hunks) is not int or hunks < 1:
        return False
    return all(diff.get(flag) is True for flag in _UNCHANGED)


def _safe_surface(evidence):
    surface = evidence.get("change_surface")
    if type(surface) is not str:
        return False
    return surface.strip().casefold() in _SAFE_SURFACES


def _weakens(value):
    """Destructive intent blocks. Quiet text does not grant a route.

    Verbs and nouns match as token prefixes across words, not as a substring of a
    glued sentence, so "latest" is not "test" and "export" is not "expect".
    """
    if type(value) is not str or not value:
        return False
    folded = unicodedata.normalize("NFKD", value).translate(_SLASH_FOLD)
    decoded, _residue = _decode(folded)
    stripped = _strip_marks(decoded)
    if not stripped:
        return False
    cyr_words = re.findall(r"[а-яё]+", stripped.casefold())
    cyr_forms = list(cyr_words)
    cyr_forms.extend(left + right for left, right in zip(cyr_words, cyr_words[1:]))
    if any(any(word.startswith(stem) for stem in _RU_DESTRUCTIVE) for word in cyr_forms):
        return True
    tokens = _flat_pieces(stripped)
    if not tokens:
        return False
    # A separator may split "assertions" or "удалить". Joins are extra tokens, not a glue of the sentence.
    spanned = list(tokens)
    spanned.extend(left + right for left, right in zip(tokens, tokens[1:]))
    if _has_prefix(spanned, ("delet", "remov", "drop", "strip")) and _has_prefix(
            spanned, ("assert", "test", "timeout", "expect")):
        return True
    if any(token.startswith("comment") for token in tokens) and (
            any(token == "out" for token in tokens)
            or any(token.startswith("comment") and "out" in token for token in tokens)):
        return True
    gated = _has_prefix(tokens, ("skip", "disable", "xfail")) or "xit" in tokens
    if gated and _has_prefix(tokens, ("test", "assert", "timeout", "qa", "security", "auth")):
        return True
    if _has_prefix(tokens, ("weaken", "loosen")):
        return True
    if _has_prefix(tokens, ("rais", "increas", "extend")) and _has_prefix(tokens, ("timeout",)):
        return True
    if _has_prefix(tokens, ("adjust", "updat", "chang")) and _has_prefix(tokens, ("expected",)):
        return True
    return False


def _weakens_any(evidence):
    return any(_weakens(text) for text in _iter_texts(evidence))


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


def _matches(pattern, value):
    return type(value) is str and pattern.fullmatch(value) is not None


def _binding_error(binding):
    if type(binding) is not dict or set(binding) != _BIND_KEYS:
        return "invalid binding"
    if not _matches(_SHA64, binding["task_sha"]) or not _matches(_SHA64, binding["rules_sha256"]):
        return "invalid binding"
    if not _matches(_SHA40, binding["rules_commit"]) or not _matches(_SHA40, binding["head"]):
        return "invalid binding"
    if not _matches(_OP, binding["operation_id"]):
        return "invalid binding"
    return None


def _pin_error(pins):
    if type(pins) is not dict or set(pins) != _PIN_KEYS:
        return "invalid pins"
    for key in ("code_commit", "capsule_commit", "policy_commit"):
        if not _matches(_SHA40, pins[key]):
            return "invalid pins"
    for key in ("code_sha256", "capsule_sha256", "policy_sha256"):
        if not _matches(_SHA64, pins[key]):
            return "invalid pins"
    if type(pins["policy_bytes_match"]) is not bool:
        return "invalid pins"
    return None


def _evidence(raw):
    if type(raw) is not dict:
        return "invalid evidence"
    if _has_cycle(raw):
        return "cyclic evidence"
    if set(raw) - _EVIDENCE_KEYS:
        return "unknown evidence"
    try:
        evidence = _defaults()
        for key, value in raw.items():
            evidence[key] = value
        _check_evidence(evidence)
        evidence["findings"] = copy.deepcopy(evidence["findings"])
        evidence["history"] = copy.deepcopy(evidence["history"])
        evidence["missing_inputs"] = list(evidence["missing_inputs"])
        evidence["paths"] = list(evidence["paths"])
        if type(evidence["diagnostics"]) is list:
            evidence["diagnostics"] = list(evidence["diagnostics"])
        if evidence["class_search"] is not None:
            evidence["class_search"] = copy.deepcopy(evidence["class_search"])
        if evidence["prior_fast_fix"] is not None:
            evidence["prior_fast_fix"] = copy.deepcopy(evidence["prior_fast_fix"])
        if evidence["plan"] is not None:
            evidence["plan"] = copy.deepcopy(evidence["plan"])
        if evidence["diff_check"] is not None:
            evidence["diff_check"] = copy.deepcopy(evidence["diff_check"])
    except ValueError as error:
        return str(error)
    except Exception:
        return "invalid evidence"
    return evidence


def _defaults():
    return {
        "template_id": None, "template_applicable": False, "template_tool": None,
        "risk": None, "change_surface": "", "suggested_class": None, "cause": "missing_evidence",
        "critical_signs": False, "difficult_or_repeating": False, "findings": [],
        "brief_usable": False, "prior_fast_fix": None, "defect_fingerprint": "",
        "author_attempts": 0, "continuation_used": 0, "progress": False, "no_progress_streak": 0,
        "unknown_effect": True, "reconciled": False, "platform_refusal": False,
        "refusal_operation": "", "proposed_retry_operation": "", "proposed_provider": "",
        "quota_exhausted": False, "effects_proven_absent": False, "fallback_route": None,
        "fallback_equivalent": False, "context_complete": False, "context_hash_ok": False,
        "missing_inputs": [], "agy_catalog": False, "agy_qa_qualified": False, "qa_route_proof": None,
        "qa_independent": False, "session_shared": False, "effective_model_exposed": False,
        "invented_model_id": None, "invented_cost": False, "class_search": None,
        "dispatch_duplicate": False, "schema_repair_attempts": 0, "plan_json_valid": True,
        "history": [], "acceptance_unchanged": False, "scope_within_admission": False,
        "finite_budget": False, "regression_known": False, "minimal_action_known": False,
        "architecture_research_required": True, "external_effects_unknown": True,
        "assertions_unchanged": False, "expected_values_unchanged": False, "qa_unchanged": False,
        "timeout_unchanged": False, "auth_unchanged": False, "fast_fix_history_checked": False,
        "critical_qa_qualified": False,
        "line_count": None, "event_text": "", "goal": "", "paths": [], "diagnostics": "",
        "whole_class_plan": False,
        "author_qa_same_snapshot": False, "complexity": "standard", "event_kind": None,
        "requirement_conflict": False, "plan": None, "diff_check": None,
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
                "assertions_unchanged", "expected_values_unchanged", "qa_unchanged",
                "timeout_unchanged", "auth_unchanged", "fast_fix_history_checked",
                "critical_qa_qualified",
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
                "invented_model_id", "event_text", "goal", "qa_route_proof"):
        if evidence[key] is not None and (type(evidence[key]) is not str or len(evidence[key]) > 500):
            raise ValueError("invalid evidence string")
    if type(evidence["paths"]) is not list or len(evidence["paths"]) > 32 or any(
            type(item) is not str or len(item) > 240 for item in evidence["paths"]):
        raise ValueError("invalid paths")
    diagnostics = evidence["diagnostics"]
    if type(diagnostics) is str:
        if len(diagnostics) > 500:
            raise ValueError("invalid diagnostics")
    elif type(diagnostics) is list:
        if len(diagnostics) > 32 or any(type(item) is not str or len(item) > 500 for item in diagnostics):
            raise ValueError("invalid diagnostics")
    else:
        raise ValueError("invalid diagnostics")
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
    if evidence["diff_check"] is not None and type(evidence["diff_check"]) is not dict:
        raise ValueError("invalid diff check")
