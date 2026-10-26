"""SR1 classifier and validator. Offline only.

The live controller keeps the #218 Astra-before-repair path. This module is not
imported by core, failure_diagnosis, cost_policy, stage, or the Antigravity
adapter, and it does not install, publish, or rewrite an admission.

A new-policy decision is produced only when the case explicitly selects the
classifier, semantics are new, and the code, capsule, and policy pins agree.
Legacy tasks never receive Fast Fix or a rewritten route. The new policy is not
stored inside GOBADMINTON_AUTONOMY_V1.

Fast Fix (§9) is granted only by structured facts: a closed surface enum, one
concrete path whose segments are on the closed path vocabulary, a diff of at
most _MAX_DIFF_HUNKS hunks, and the other §9 proofs. Free text (event text, goal,
diagnostics, findings, paths and all other evidence fields) passes one bounded
schema/vocabulary walk before copying. It can only downgrade eligibility and
never creates a writer. Downgrade collapses every separator and repeated letter,
then matches stems in the original script and in Latin transliteration. Text
outside the closed vocabulary goes to Technical PM with no writer. The same
downgrade applies to a standard brief, a template, a complex cause, and a
continuation. After three ordinary attempts the only writer is a continuation
that still has progress.
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
# Free text never grants a writer. It can raise the floor or downgrade eligibility.
# Separators are deleted and repeated letters collapse before a stem comparison.
# "author" / "authors" are not "auth". "secretary" is not "secret".
_EN_STEMS = (
    "authoriz", "authoris", "authorit", "authent", "oauth", "identit", "password",
    "passwd", "credential", "sandbox", "apparmor", "admission", "budget", "permiss",
    "concurren", "payment", "billing", "migrat", "rollback", "irreversib", "privilege",
    "rbac", "money", "pii", "qareuse", "dataloss", "guard", "rights",
    "access", "security", "session", "token",
)
# Word prefixes on Cyrillic, before any Latin confusable fold.
# "платформу" is not a payment. "правильно" is not "права". "секретарь" is not "секрет".
_RU_PREFIXES = (
    "авториз", "аутентиф", "идентиф", "идентичн", "миграц", "мигрир", "откат", "деньг",
    "платеж", "оплат", "персональн", "парол", "токен", "сесси", "доступ",
)
_RU_RIGHTS = frozenset(("прав", "права", "право", "правом", "правами", "правах", "правам"))
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
# Structured Fast Fix bound. A larger diff is not a minimal repair.
_MAX_DIFF_HUNKS = 32
# Positive vocabulary for free text that may accompany Fast Fix or a brief writer.
# A token outside this set downgrades eligibility. It does not list attacks.
_CLOSED_VOCAB = frozenset((
    "a", "api", "apps", "author", "authors", "export", "in", "index",
    "internal", "latest", "name", "notes", "old", "remove", "rename", "secretary",
    "fp", "other", "defect", "attempt", "rules", "state",
    "comment", "docs", "formatting", "format", "test", "fast", "fix", "fail",
    "src", "the", "timeout", "to", "ts", "typo", "web",
    "автор", "хелпер", "не", "опечатки", "переименовать", "платформу",
    "правильно", "против", "протест", "секретарь", "таймаут", "тестовый", "трогать",
))
# File names are data, not instructions to remove tests. Keep this extension
# local to canonical paths; it does not admit new instruction vocabulary.
_PATH_WORDS = frozenset(("spec", "fixture", "delete"))


# Descriptors: text/path use the ONE vocabulary gate; enum/regex are closed
# string schemas, obj/list recurse, and optional admits only an explicit None.
# No fallback validator: adding a field without a descriptor closes writing.
def _enum(*values):
    return ("enum", frozenset(values))


def _optional(rule):
    return ("optional", rule)


_BOOL = ("bool",)
_TEXT = ("text",)
_PATH = ("path",)
_COUNT = ("int", 0, 7)
_ROUTE = _optional(_enum(*ROUTES))
_FIELD_VALIDATORS = {
    "evidence": {
        "template_id": _optional(_enum("formatter", "eslint-simple")),
        "template_tool": _optional(_enum("deterministic_tool")),
        "risk": _optional(_enum("low", "moderate", "critical")),
        "change_surface": _TEXT,
        "suggested_class": _optional(_enum(*_WRITER_EVENTS, "SOURCE_CRITICAL", "SOURCE_UNCERTAIN")),
        "cause": _enum("proven", "supported", "unresolved", "missing_evidence"),
        "complexity": _enum("mechanical", "standard", "complex"),
        "event_kind": _optional(_enum("pending", "config_precall", "transient_infra", "requirement_conflict")),
        "defect_fingerprint": _TEXT,
        "refusal_operation": ("operation",), "proposed_retry_operation": ("operation",),
        "proposed_provider": _enum("", "cursor", "codex", "agy"),
        "fallback_route": _ROUTE, "qa_route_proof": _ROUTE,
        "invented_model_id": _optional(_enum(*MODELS)),
        "line_count": _optional(("int", 0, 1000000)),
        "event_text": _TEXT, "goal": _TEXT,
        "paths": ("list", _PATH), "diagnostics": ("diagnostics",),
        "findings": ("list", ("obj", "finding")),
        "missing_inputs": ("list", _TEXT), "history": ("list", ("history",)),
        "prior_fast_fix": _optional(("obj", "prior")),
        "class_search": _optional(("obj", "search")),
        "plan": _optional(("obj", "plan")),
        "diff_check": _optional(("obj", "diff")),
        **dict.fromkeys(("author_attempts", "continuation_used", "no_progress_streak", "schema_repair_attempts"), _COUNT),
        **dict.fromkeys((
            "template_applicable", "critical_signs", "difficult_or_repeating", "brief_usable",
            "progress", "unknown_effect", "reconciled", "platform_refusal", "quota_exhausted",
            "effects_proven_absent", "fallback_equivalent", "context_complete", "context_hash_ok",
            "agy_catalog", "agy_qa_qualified", "qa_independent", "session_shared",
            "effective_model_exposed", "invented_cost", "dispatch_duplicate", "plan_json_valid",
            "acceptance_unchanged", "scope_within_admission", "finite_budget", "regression_known",
            "minimal_action_known", "architecture_research_required", "external_effects_unknown",
            "assertions_unchanged", "expected_values_unchanged", "qa_unchanged", "timeout_unchanged",
            "auth_unchanged", "fast_fix_history_checked", "critical_qa_qualified", "whole_class_plan",
            "author_qa_same_snapshot", "requirement_conflict"), _BOOL),
    },
    "finding": {"id": ("finding_id",), "severity": _enum("low", "moderate", "critical"), "location": _PATH},
    "prior": {"fingerprint": _TEXT, "result": _enum("pass", "fail")},
    "search": {"saved": _BOOL, "assurance_only": _BOOL, "method": _enum(*SEARCH_METHODS),
               "pattern": _TEXT, "scope": _PATH, "instances": ("int", 0, 32),
               "matched_count": ("int", 0, 32), "scope_listing": ("list", _PATH),
               "diff_identifiers": ("list", _TEXT)},
    "diff": {"tool": _enum(*_DIFF_TOOLS), "hunks": ("int", 0, 1000000),
             **dict.fromkeys(_UNCHANGED, _BOOL)},
    "plan": {"schema": _enum(PLAN_SCHEMA),
             "author_route": _optional(_enum(*ROUTES, "deterministic_tool")), "qa_route": _ROUTE,
             "planner_calls": ("int", 0, 1), "astra_calls": ("int", 0, 1), "fast_fix": _BOOL,
             "effects": ("list", _enum(*ALLOWED_EFFECTS)), "model_ids": ("list", _enum(*MODELS)),
             "rights_delta": ("empty_list",), "binding": ("obj", "binding"),
             **dict.fromkeys(_PLAN_WEAKEN + _UNCHANGED + ("executable",), _BOOL)},
    "binding": {"task_sha": ("regex", _SHA64), "rules_sha256": ("regex", _SHA64),
                "rules_commit": ("regex", _SHA40), "head": ("regex", _SHA40),
                "operation_id": ("regex", _OP)},
}
_PLAN_ROUTE_FIELDS = {"author_route": "author_route", "qa_route": "qa_route"}
_MAX_NODES = 1024
_MAX_TEXT = 16384
_MAX_DEPTH = 12


class _ValidatedEvidence(dict):
    """One local proof, computed before copying or classification; never input data."""


def _text_gate(value):
    """Bounded schema walk of EVERY key/value. Unknown keys/types cannot disappear.

    Structured strings are accepted only by their field's enum/ID schema. Every
    other string takes the same normalization and vocabulary path. Sensitive
    stems use all leaf/field/aggregate views; destructive intent uses instruction
    text views so that metadata cannot supply an instruction's target.
    """
    texts, fields, instructions, claims = [], [], [], []
    nodes = total = 0
    active = set()
    outside = False
    aggregate_known = True

    def walk(item, rule, depth=0, instruction=False):
        nonlocal nodes, total, outside, aggregate_known
        nodes += 1
        if nodes > _MAX_NODES or depth > _MAX_DEPTH:
            raise ValueError("evidence bounds exceeded")
        if type(item) is str:
            total += len(item)
            if len(item) > 500 or total > _MAX_TEXT:
                raise ValueError("evidence text bounds exceeded")
        kind = rule[0]
        if kind == "optional":
            if item is None:
                return
            return walk(item, rule[1], depth + 1, instruction)
        if kind == "obj":
            if type(item) is not dict:
                raise ValueError("invalid closed schema object")
            schema = rule[1]
            table = _FIELD_VALIDATORS[schema]
            if len(item) > len(table):
                raise ValueError("unknown closed schema fields")
            if id(item) in active:
                raise ValueError("cyclic evidence")
            active.add(id(item))
            start = len(texts)
            key_rule = _enum(*table)
            for key in item:
                # Keys are closed enums too, never unexamined free text.
                walk(key, key_rule, depth + 1)
            # Canonical traversal makes field/aggregate views and validation
            # errors independent of dictionary insertion order, at every depth.
            for key in sorted(item):
                child = item[key]
                try:
                    walk(child, table[key], depth + 1,
                         (schema == "evidence" and key in
                          ("event_text", "goal", "diagnostics", "history"))
                         or (schema == "finding" and key == "id"))
                except ValueError as error:
                    raise ValueError(schema + "." + key + ": " + str(error)) from error
            if schema != "evidence":
                required = _SEARCH_BASE if schema == "search" else set(table)
                if not required <= item.keys():
                    raise ValueError("missing closed schema fields")
            if schema == "evidence" and "findings" in item:
                ids = [finding["id"] for finding in item["findings"]]
                if len(ids) != len(set(ids)):
                    raise ValueError("duplicate findings")
            fields.append(" ".join(texts[start:]))
            active.remove(id(item))
            return
        if kind in ("list", "empty_list", "diagnostics"):
            if kind == "diagnostics" and type(item) is str:
                return walk(item, _TEXT, depth + 1, instruction)
            if (type(item) is not list or len(item) > (0 if kind == "empty_list" else 32)
                    or (kind == "diagnostics" and not item)):
                raise ValueError("invalid closed schema list")
            if id(item) in active:
                raise ValueError("cyclic evidence")
            active.add(id(item))
            start = len(texts)
            for child in item:
                walk(child, _TEXT if kind == "diagnostics" else rule[1], depth + 1, instruction)
            fields.append(" ".join(texts[start:]))
            active.remove(id(item))
            return
        if kind == "bool":
            valid = type(item) is bool
        elif kind == "int":
            valid = type(item) is int and rule[1] <= item <= rule[2]
        elif kind == "enum":
            valid = type(item) is str and item in rule[1]
        elif kind == "regex":
            valid = _matches(rule[1], item)
        elif kind == "operation":
            valid = type(item) is str and (item == "" or _matches(_OP, item))
            # Operation syntax is closed, but a sensitive operation still raises risk.
            if valid and item:
                texts.append(item)
                aggregate_known = aggregate_known and all(
                    token in _VOCAB_WORDS for token in _vocab_tokens(_prepare(item)[0]))
        elif kind == "history":
            if _matches(re.compile(r"attempt-[1-7]\Z"), item):
                return
            return walk(item, _TEXT, depth + 1, instruction)
        elif kind == "finding_id":
            valid = type(item) is str and (re.fullmatch(r"f[1-9][0-9]{0,5}", item) is not None)
            if not valid and type(item) is str:
                return walk(item, _TEXT, depth + 1, instruction)
        elif kind in ("text", "path"):
            if type(item) is not str:
                raise ValueError("invalid closed vocabulary text")
            texts.append(item)
            if kind == "text":
                claims.append(item)
            if instruction:
                instructions.append(item)
            prepared, residue = _prepare(item)
            tokens = _vocab_tokens(prepared)
            vocabulary = _VOCAB_WORDS | _PATH_WORDS if kind == "path" else _VOCAB_WORDS
            aggregate_known = aggregate_known and all(token in vocabulary for token in tokens)
            if (residue or _ambiguous(prepared) or not tokens
                    or any(token not in vocabulary for token in tokens)
                    or re.search(r"[0-9]", prepared)):
                outside = True
            if kind == "path" and not _concrete_path(item):
                outside = True
            return
        else:
            raise ValueError("unknown validator")
        if not valid:
            raise ValueError("invalid closed schema " + kind)

    walk(value, ("obj", "evidence"))
    # Bound the aggregate once before normalization; no permutations or pairwise search.
    views = list(texts) + fields
    joined = []
    for order in (texts, sorted(texts), list(reversed(texts)), sorted(texts, reverse=True)):
        views.append(" ".join(order))
        joined.append("".join(order))
    views = list(dict.fromkeys(views))
    joined = list(dict.fromkeys(joined))
    sensitive = any(_sensitive(text) for text in texts)
    # Keep provenance of known word boundaries when removing separators. Otherwise
    # "to author" becomes "oauth", or adjacent Russian/English words look mixed.
    # Unknown fragments still reassemble; known words never license unknown text.
    # Path-only vocabulary is known only at its own leaf. A benign filename
    # must not cause the surrounding known words to be re-glued into a stem.
    # Unknown path fragments still take every aggregate scan, as before.
    if not aggregate_known:
        sensitive = sensitive or any(_sensitive(text) for text in views)
        sensitive = sensitive or any(_collapsed_sensitive(_prepare(text)[0]) for text in joined)
    # Preserve split/reordered instruction detection without borrowing a target
    # such as "test" from a file name or search pattern. Free-text history is
    # direct intent too; only closed attempt IDs are history metadata.
    # A complete destructive claim in any free-text leaf still refuses; only
    # instruction/finding text may combine separate words across fields.
    intent_views = list(claims)
    for order in (instructions, sorted(instructions), list(reversed(instructions)),
                  sorted(instructions, reverse=True)):
        intent_views.extend((" ".join(order), "".join(order)))
    weakens = any(_weakens(text) for text in intent_views)
    return {"outside": outside, "sensitive": sensitive, "weakens": weakens}


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
    reason, replan, whole_class = _writer_proof(evidence, plan, updates)
    if reason:
        if replan:
            return _pm(base, evidence, _floor(evidence), whole_class=whole_class,
                       executed=False, reason=reason)
        return _finish(base, **_deny_write(updates, reason))
    updates["plan_honored"] = bool(updates.get("executed"))
    return _finish(base, **updates)


def _routes_match(plan, decision):
    return all(plan[requested] == decision.get(actual)
               for requested, actual in _PLAN_ROUTE_FIELDS.items())


def _writer_conditions(evidence, action):
    """§9's eight conditions, plus the route-specific direct-repair proofs.

    1: cause/candidate fingerprint and immutable acceptance (§7/11, EOM §8.1).
       §8 STANDARD/COMPLEX may use a supported cause; LOCAL must be proven.
    2: known minimal action, no open architecture/semantics research.
    3: noncritical risk/dependencies, no unknown external effects.
    4: admitted scope and finite budget (effects/routes are checked below).
    5: known regression check, also required in an ordinary repair brief (EOM §8.1).
    6: checked history, no blind replay of the failed Fast Fix (§11, EOM §8.1).
    7: intact tests/limits proven by diff. LOCAL additionally requires the
       explicit unchanged declarations on evidence and plan (§9).
    8: saved single-instance search covering every repair/finding, diff symbol
       and the diagnosed fingerprint. A suggested class cannot change that class.

    These facts are required for templates too. A usable brief is no waiver.
    The enclosing envelope (pins, context, exact binding, duplicate/refusal and
    reconciliation) is checked before classification and rechecked below for
    writers. §3.3/13 add independent QA; §7/11/12 add executable bound routes
    and the finite ordinary/continuation envelope.
    """
    local = action == "SOURCE_KNOWN_LOCAL"
    plan = evidence["plan"]
    return (
        (evidence["acceptance_unchanged"] is True
         and evidence["cause"] in (("proven",) if local else ("proven", "supported"))
         and bool(_fingerprint_key(evidence["defect_fingerprint"])),
         "condition 1 cause or acceptance"),
        (evidence["minimal_action_known"] is True
         and evidence["architecture_research_required"] is False,
         "condition 2 architecture is open or the minimal action is not proven"),
        (_floor(evidence) in ("low", "moderate") and not evidence["difficult_or_repeating"]
         and evidence["external_effects_unknown"] is False and evidence["unknown_effect"] is False,
         "condition 3 risk floor or unknown external effect"),
        (evidence["scope_within_admission"] is True and evidence["finite_budget"] is True,
         "condition 4 scope or budget is not inside the admission"),
        (evidence["regression_known"] is True, "condition 5 regression check"),
        (evidence["fast_fix_history_checked"] is True and not _prior_closed(evidence),
         "condition 6 Fast Fix history"),
        (_diff_proven(evidence.get("diff_check")) and not _weakens_any(evidence)
         and (not local or _condition_seven(evidence, plan)),
         "condition 7 writer proof is incomplete: assertions, expected values, QA or timeout"),
        (_class_closed(evidence),
         "condition 8 defect class is not proven closed or search coverage is incomplete"),
    )


def _writer_proof(evidence, plan, decision):
    """The single final writer-admission predicate. Return a reason and disposition.

    All executed source actions, including tools, reach this via _emit. Facts
    come only from the validated case, never from a branch's success label.
    """
    action = decision["event_class"]
    # Keep safety-specific reasons even for unknown instruction vocabulary.
    if _weakens_any(evidence):
        return "condition 7 assertions, expected values, QA or timeout", False, False
    if type(plan) is not dict or plan.get("executable") is not True:
        return "plan is missing or is not executable", False, False
    for number, (ok, reason) in enumerate(_writer_conditions(evidence, action), 1):
        if not ok:
            return reason, number == 8, number == 8
    if evidence.policy_active is not True or plan["binding"] != evidence.binding:
        return "policy or exact plan binding requires revalidation", False, False
    if (evidence["qa_independent"] is not True or evidence["session_shared"] is not False
            or evidence["author_qa_same_snapshot"] is not False):
        return "author and QA are not independent: qa_independent proof required", False, False
    if (evidence["context_complete"] is not True or evidence["context_hash_ok"] is not True
            or evidence["missing_inputs"]
            or evidence["dispatch_duplicate"] or evidence["platform_refusal"]
            or evidence["reconciled"] is not True or not evidence["plan_json_valid"]):
        return "writer context, operation or reconciliation proof is incomplete", False, False
    if evidence["no_progress_streak"] >= 2:
        return "two repairs without progress", False, False
    continuation = action == "CONTINUATION"
    if ((continuation and not (evidence["author_attempts"] == 3
                              and evidence["continuation_used"] in (0, 1)
                              and evidence["progress"] is True and evidence["brief_usable"] is True))
            or (not continuation and evidence["author_attempts"] >= 3)):
        return "ordinary or continuation budget/progress is not proven", False, False
    if action == "SOURCE_KNOWN_STANDARD" and evidence["brief_usable"] is not True:
        return "standard repair brief is not usable", False, False
    # §8 permits a complex repair to name a nonempty non-Fast-Fix surface.
    surface_proven = (_safe_surface(evidence) or
                      (evidence["complexity"] == "complex" and bool(evidence["change_surface"].strip())))
    if not surface_proven:
        return "writer proof is incomplete: change surface", False, False
    effects = set(plan["effects"])
    if ("source_edit_within_scope" not in effects or "none" in effects
            or (decision.get("author_route") == "deterministic_tool"
                and "deterministic_tool" not in effects)):
        return "plan effects do not admit the selected source action", True, False
    if not _routes_match(plan, decision):
        return "requested plan routes conflict with the selected author or QA route", True, False
    suggested = evidence["suggested_class"]
    compatible = ({"SOURCE_KNOWN_COMPLEX"} if evidence["complexity"] == "complex"
                  else {"SOURCE_KNOWN_LOCAL", "SOURCE_KNOWN_STANDARD", "TEMPLATE"})
    if suggested is not None and suggested not in (compatible if continuation else {action}):
        return "writer proof is incomplete: defect class is not bound to this repair", True, True
    if evidence["complexity"] == "complex" and decision.get("qa_route") is None:
        return "complex QA route is not proven", True, False
    return None, False, False


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
    if (type(task) is not dict or any(type(key) is not str for key in task)
            or type(task.get("schema")) is not str):
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
    if not _closed_keys(plan, _PLAN_KEYS):
        return "incompatible plan"
    if type(plan["schema"]) is not str or plan["schema"] != PLAN_SCHEMA:
        return "incompatible plan"
    for label in ("author_route", "qa_route"):
        allowed = ROUTES | {"deterministic_tool"} if label == "author_route" else ROUTES
        if plan[label] is not None and (type(plan[label]) is not str or plan[label] not in allowed):
            return "disallowed model or route"
    if type(plan["planner_calls"]) is not int or not 0 <= plan["planner_calls"] <= 1:
        return "unbounded planner"
    if type(plan["astra_calls"]) is not int or not 0 <= plan["astra_calls"] <= 1:
        return "unbounded expert escalation"
    if type(plan["fast_fix"]) is not bool:
        return "incompatible plan"
    if type(plan["effects"]) is not list or any(
            type(item) is not str or item not in ALLOWED_EFFECTS for item in plan["effects"]):
        return "dangerous plan effect"
    if type(plan["model_ids"]) is not list or any(
            type(item) is not str or item not in MODELS for item in plan["model_ids"]):
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
        # Accounting and enforcement share the validated, copied plan in _emit.
        # Never revisit raw input here: even equality/hash/deepcopy can be hooks.
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
        return _decision(policy_applied=True, reason="closed schema/vocabulary: " + evidence,
                         event_class="SOURCE_UNCERTAIN", route=SPECIALIST_SOL,
                         planner_calls=1, model_calls=1, plan_honored=False,
                         operation_id=case["binding"]["operation_id"])
    base = _carry(case, evidence)
    # Trusted local envelope proof, never a field accepted from input evidence.
    evidence.binding = dict(case["binding"])
    plan = evidence["plan"]
    if plan is not None:
        plan_error = validate_plan(plan)
        if plan_error:
            return _finish(base, rejected=True, executed=False, writer=False,
                             policy_rewritten=False, reason=plan_error,
                             event_class="REJECTED", route="hold", plan_honored=False)
    active, why = _activation(case)
    evidence.policy_active = active
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
    if (not evidence["context_complete"] or not evidence["context_hash_ok"]
            or evidence["missing_inputs"]):
        missing = list(evidence["missing_inputs"])
        return _finish(base, policy_applied=True, executed=False, writer=False,
                         qa_verdict=None, missing_inputs=missing,
                         full_trusted_fallback=not missing,
                         reason="incomplete context" if missing else "context hash mismatch; full trusted fallback",
                         event_class="INPUT_MISSING", route="hold", plan_honored=False)
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


def _known_local(base, evidence, plan, risk):
    """Fast Fix does not spend an ordinary author attempt."""
    model, cost = _auto_receipt("cursor:auto", evidence)
    return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                 fast_fix=True, planner_calls=0, astra_calls=0, model_calls=1,
                 author_attempts_delta=0, ledger_category="fast_fix", author_route="cursor:auto",
                 qa_route=_ordinary_qa(evidence), route="cursor:auto", effective_model=model, cost=cost,
                 whole_class=False, reason="all eight Fast Fix conditions hold",
                 event_class="SOURCE_KNOWN_LOCAL")


def _classify(base, evidence, plan):
    risk = _floor(evidence)
    class_open = _class_open(evidence)
    prior_closed = _prior_closed(evidence)
    if risk == "critical" or evidence["difficult_or_repeating"]:
        return _expert(base, evidence, plan, risk, class_open, prior_closed)
    if _untrusted_blocks(evidence):
        return _pm(base, evidence, risk, whole_class=class_open, fast_fix_closed=prior_closed,
                   reason="free text is outside the closed vocabulary")
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
                         event_class="CONTINUATION", cost=None)
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk,
                       continuation_granted=False, fast_fix=False,
                       reason="ordinary attempts are exhausted; continuation needs progress",
                       event_class="LIMIT", route="hold")
    if (evidence["template_applicable"] and evidence["complexity"] != "complex"
            and _norm_id(evidence["template_id"])):
        # A template writer needs a closed single-instance search, not a clean sentence.
        if not (_template_ok(evidence, risk) and _class_closed(evidence)
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
                     event_class="TEMPLATE")
    if class_open or prior_closed:
        return _pm(base, evidence, risk, whole_class=class_open, fast_fix_closed=prior_closed,
                   reason="Fast Fix refused; defect class is not closed for a single repair")
    # A usable brief does not lower author or QA complexity.
    if (evidence["cause"] in ("proven", "supported") and evidence["complexity"] == "complex"
            and evidence["minimal_action_known"] and not evidence["architecture_research_required"]):
        return _author(base, evidence, plan, risk, SPECIALIST_SOL, "SOURCE_KNOWN_COMPLEX",
                       "known complex noncritical cause; Astra is not required")
    # All eight Fast Fix conditions outrank a usable brief (§8 LOCAL, §9).
    allowed, fast_reason = _fast_fix_block(evidence)
    if allowed:
        return _known_local(base, evidence, plan, risk)
    if (evidence["brief_usable"] and evidence["complexity"] != "complex"
            and evidence["cause"] in ("proven", "supported") and evidence["author_attempts"] < 3):
        if evidence["architecture_research_required"] or evidence["minimal_action_known"] is not True:
            return _pm(base, evidence, risk, whole_class=False, fast_fix_closed=False,
                       reason="architecture is open or the minimal action is not proven")
        model, cost = _auto_receipt("cursor:auto", evidence)
        return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                     planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                     author_route="cursor:auto", qa_route=_ordinary_qa(evidence), route="cursor:auto",
                     effective_model=model, cost=cost, ledger_category="ordinary",
                     reason="usable brief is reused; no extra planner or diagnosis",
                     event_class="SOURCE_KNOWN_STANDARD")
    if evidence["cause"] == "missing_evidence":
        return _finish(base, policy_applied=True, executed=False, writer=False, risk=risk, qa_verdict=None,
                       missing_inputs=list(evidence["missing_inputs"]) or ["source evidence"],
                       reason="missing evidence; do not guess with a larger model",
                       event_class="INPUT_MISSING", route="hold")
    reason = "Fast Fix refused; " + fast_reason if evidence["cause"] == "proven" else "one read-only Technical PM pass"
    return _pm(base, evidence, risk, whole_class=class_open or not _search_saved(evidence) and evidence["cause"] == "proven",
               fast_fix_closed=prior_closed, reason=reason)


def _expert(base, evidence, plan, risk, class_open, prior_closed):
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
                 reason="critical or hard defect uses read-only Astra, whole-class when another instance exists")


def _pm(base, evidence, risk, *, whole_class, reason, fast_fix_closed=False, executed=True):
    nxt = evidence["author_attempts"] + 1 if fast_fix_closed else None
    return _emit(base, evidence, evidence.get("plan"), policy_applied=True, executed=executed, writer=False,
                 risk=risk, planner_calls=int(executed), astra_calls=0, model_calls=int(executed), fast_fix=False,
                 fast_fix_closed=fast_fix_closed, whole_class=whole_class, next_ordinary_attempt=nxt,
                 route="codex:gpt-6.1-sol:high",
                 author_route="cursor:auto" if evidence["complexity"] != "complex" else SPECIALIST_SOL,
                 qa_route=_ordinary_qa(evidence), reason=reason, event_class="SOURCE_UNCERTAIN",
                 plan_honored=False)


def _author(base, evidence, plan, risk, route, klass, reason):
    model, cost = _auto_receipt(route, evidence)
    return _emit(base, evidence, plan, policy_applied=True, executed=True, writer=True, risk=risk,
                 planner_calls=0, astra_calls=0, model_calls=1, fast_fix=False,
                 author_route=route, qa_route=_ordinary_qa(evidence), route=route,
                 effective_model=model, cost=cost, ledger_category="ordinary",
                 reason=reason, event_class=klass)


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
        "plan_honored": False if evidence["plan"] is not None else None,
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
    if evidence["complexity"] == "complex":
        return _critical_qa(evidence)
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
    return not _class_closed(evidence)


def _search_saved(evidence):
    search = evidence["class_search"]
    return type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False


def _prior_closed(evidence):
    prior = evidence["prior_fast_fix"]
    fingerprint = _fingerprint_key(evidence["defect_fingerprint"])
    if type(prior) is not dict or not fingerprint:
        return False
    return prior.get("result") == "fail" and _fingerprint_key(prior.get("fingerprint")) == fingerprint


def _class_closed(evidence):
    """Closure is a tool result, not a shape that merely looks like an identifier."""
    search = evidence.get("class_search")
    return (type(search) is dict and search.get("saved") is True and search.get("assurance_only") is False
            and search.get("method") in SEARCH_METHODS and search.get("instances") == 1
            and _pattern_proves_class(search, evidence))


def _fast_fix_block(evidence):
    """Return (allowed, reason). Every condition is default-deny: missing proof is failure."""
    checks = ((_safe_surface(evidence), "change surface is not a fast-fix surface"),
              *_writer_conditions(evidence, "SOURCE_KNOWN_LOCAL"))
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


def _prepare(value):
    """NFKD, fold slash lookalikes, decode, and drop marks. Residue stays visible."""
    if type(value) is not str or not value:
        return "", False
    folded = unicodedata.normalize("NFKD", value).translate(_SLASH_FOLD)
    decoded, residue = _decode(folded)
    return _strip_marks(decoded), residue


def _collapse_runs(text):
    return re.sub(r"(.)\1+", r"\1", text)


def _latinize(text):
    """Latin skeleton of one token. Repeats collapse inside the token only."""
    text = re.sub(r"[0-9ьъ]", "", text.casefold()).translate(_TRANSLIT)
    text = _collapse_runs(text)
    text = text.replace("ks", "x").replace("w", "v").replace("k", "c")
    return _collapse_runs(text)


def _norm_token(word):
    """Same skeleton as a scanned token: marks drop, signs and digits drop, repeats collapse.

    NFKD turns й into и plus a breve. The breve is a mark, so the vocabulary
    and the scanned text must both lose it or a quiet word falls outside.
    """
    text = unicodedata.normalize("NFKD", word.casefold())
    text = "".join(char for char in text if unicodedata.category(char) not in _MARK_CATEGORIES)
    text = re.sub(r"[0-9ьъ]", "", text)
    text = re.sub(r"[^0-9a-zа-яё]", "", text)
    return _collapse_runs(text)


_NORM_VOCAB = frozenset(_norm_token(word) for word in _CLOSED_VOCAB if _norm_token(word))
# Vocabulary admission preserves spelling; repeat collapse belongs only to the
# conservative stem scan. A misspelt path token is not a new admitted filename.
_VOCAB_WORDS = frozenset(_strip_marks(word).casefold() for word in _CLOSED_VOCAB)


def _letter_tokens(text):
    """Separators and digits are deleted. Repeated letters collapse inside a word."""
    spaced = _camel_split(text)
    tokens = []
    for piece in re.findall(r"[0-9A-Za-zА-Яа-яЁё]+", spaced):
        word = _norm_token(piece)
        if word:
            tokens.append(word)
    return tokens


def _mask_safe(text):
    """Drop the legitimate author/secretary families before a short-stem search."""
    for prefix in ("secretary", "secretar", "sekretar", "author"):
        text = text.replace(prefix, "")
    return text


def _latin_stems():
    stems = set()
    for stem in _EN_STEMS + _RU_PREFIXES + ("секрет",):
        if len(stem) < 4:
            continue
        stems.add(_latinize(stem))
    stems.discard("")
    return stems


def _cyr_stems():
    stems = set()
    for stem in _RU_PREFIXES + ("секрет",):
        collapsed = _collapse_runs(re.sub(r"[0-9ьъ]", "", stem))
        if len(collapsed) >= 4:
            stems.add(collapsed)
    return stems


_LATIN_STEMS = _latin_stems()
_CYR_STEMS = _cyr_stems()


def _fuzzy_token(token):
    """A non-vocabulary token close to a stem is the transliteration class."""
    if token in _NORM_VOCAB or len(token) < 5:
        return False
    latin = _latinize(token)
    if latin in _NORM_VOCAB or len(latin) < 5:
        return False
    for stem in _LATIN_STEMS:
        if len(stem) < 5 or abs(len(latin) - len(stem)) > 2:
            continue
        if _common_prefix(latin, stem) >= 6 or _edit_distance(latin, stem) <= 1:
            return True
    return False


def _blob_has_stem(blob, fuzzy):
    """Stem search on one skeleton. Repeats were already collapsed inside tokens."""
    if not blob:
        return False
    if blob in _RU_RIGHTS or blob == "pii":
        return True
    cyr = "".join(char for char in blob if "а" <= char <= "я" or char == "ё")
    if any(stem in cyr.replace("секретар", "") for stem in _CYR_STEMS):
        return True
    # Do not collapse again: that would glue the last letter of one token to the next.
    latin = blob.translate(_TRANSLIT)
    latin = latin.replace("ks", "x").replace("w", "v").replace("k", "c")
    for stem in _LATIN_STEMS:
        haystack = _mask_safe(latin) if stem == "secret" else latin
        if stem and stem in haystack:
            return True
    if "auth" in _mask_safe(latin):
        return True
    if fuzzy:
        return _fuzzy_token(blob)
    return False


def _raw_words(text):
    words = []
    for piece in re.findall(r"[0-9A-Za-zА-Яа-яЁё]+", _camel_split(text)):
        word = re.sub(r"[0-9ьъ]", "", piece.casefold())
        if word:
            words.append(word)
    return words


def _collapsed_sensitive(text):
    """Unknown fragments are joined. A closed-vocabulary phrase is not re-glued.

    Gluing every vocabulary word would turn "to author" into "oauth". Fragments
    outside the vocabulary are the split-stem class and are joined.
    """
    raw = _raw_words(text)
    tokens = [_collapse_runs(word) for word in raw]
    if not tokens:
        return False
    if any(word == "pii" or _collapse_runs(word) in _RU_RIGHTS for word in raw):
        return True
    known = all(token in _NORM_VOCAB for token in tokens)
    if not known and "pii" in "".join(raw):
        return True
    for token in tokens:
        if token in _NORM_VOCAB:
            continue
        if _blob_has_stem(token, fuzzy=True):
            return True
    if known:
        return False
    return _blob_has_stem("".join(tokens), fuzzy=False)


def _vocab_tokens(text):
    return re.findall(r"[0-9a-zа-яё]+", _camel_split(text).casefold())


def _outside_vocab(evidence):
    return evidence.text_proof["outside"]


def _untrusted_blocks(evidence):
    return _outside_vocab(evidence) and not _weakens_any(evidence)


def _sensitive(value):
    if type(value) is not str or not value:
        return False
    stripped, residue = _prepare(value)
    # Residue and anything outside the allowlist are the same class: fail closed.
    if residue or (stripped and _ambiguous(stripped)):
        return True
    if not stripped:
        return False
    if _foreign_script(stripped) or _mixed_script(stripped):
        return True
    return _collapsed_sensitive(stripped)


def _sensitive_any(evidence):
    return evidence.text_proof["sensitive"]


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


def _concrete_path(value):
    """Canonical relative ASCII path. Never repair or normalize an untrusted path."""
    if type(value) is not str or not value or len(value) > 240 or not value.isascii():
        return False
    if not re.fullmatch(r"[A-Za-z0-9_./-]+", value):
        return False
    if any(part in ("", ".", "..") for part in value.split("/")):
        return False
    return "/" in value or ("." in value and value not in (".", ".."))


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


def _pattern_proves_class(search, evidence):
    pattern = search.get("pattern")
    if type(pattern) is not str or not _concrete_path(search.get("scope")):
        return False
    identifiers = search.get("diff_identifiers")
    if type(identifiers) is not list or pattern not in identifiers:
        return False
    listing = search.get("scope_listing")
    if (type(listing) is not list or not listing or len(set(listing)) != len(listing)
            or not all(_concrete_path(item) for item in listing)):
        return False
    scope = search["scope"]
    is_file = "." in scope.rsplit("/", 1)[-1]
    if is_file and listing != [scope]:
        return False
    if not is_file and not all(item.startswith(scope + "/") for item in listing):
        return False
    # Closure must cover EVERY repair/finding, not just a self-consistent search
    # in an unrelated directory. A file scope never includes descendants.
    repair_paths = evidence["paths"] + [item["location"] for item in evidence["findings"]]
    if not all((path == scope if is_file else path.startswith(scope + "/"))
               for path in repair_paths):
        return False
    if not all(path in listing for path in repair_paths):
        return False
    if len(listing) != search.get("matched_count"):
        return False
    if (not identifiers or len(set(identifiers)) != len(identifiers)
            or any(type(item) is not str or not item.strip() or item != pattern for item in identifiers)):
        return False
    if type(search.get("matched_count")) is not int or search.get("matched_count") != 1:
        return False
    if search.get("instances") != 1:
        return False
    parts = _ident_parts(pattern)
    # A generic or diagnostic fragment left after the split does not name a class.
    if not parts or all(_generic_part(part) for part in parts):
        return False
    # Bind the searched diff symbol to the diagnosed defect. The optional fp-
    # label is metadata; the remaining complete identifier components must occur
    # together in the pattern (fp-export -> OldExport / old_export). Never use a
    # substring or a generic diagnostic token as the binding.
    fingerprint = _camel_split(evidence["defect_fingerprint"]).replace(" ", "_")
    defect = _ident_parts(_fingerprint_key(fingerprint))
    if defect[:1] == ["fp"]:
        defect = defect[1:]
    return bool(defect) and not all(_generic_part(part) for part in defect) and any(
        parts[start:start + len(defect)] == defect for start in range(len(parts) - len(defect) + 1))


def _diff_proven(diff):
    if type(diff) is not dict or set(diff) != _DIFF_KEYS:
        return False
    if diff.get("tool") not in _DIFF_TOOLS:
        return False
    hunks = diff.get("hunks")
    if type(hunks) is not int or hunks < 1 or hunks > _MAX_DIFF_HUNKS:
        return False
    return all(diff.get(flag) is True for flag in _UNCHANGED)


def _safe_surface(evidence):
    surface = evidence.get("change_surface")
    if type(surface) is not str:
        return False
    return surface.strip().casefold() in _SAFE_SURFACES


def _stem_occurs(stem, tokens):
    blob = "".join(tokens)
    if stem not in blob:
        return False
    cursor = 0
    spans = []
    for token in tokens:
        spans.append((cursor, cursor + len(token), token))
        cursor += len(token)
    start = 0
    while True:
        at = blob.find(stem, start)
        if at < 0:
            return False
        end = at + len(stem)
        inside = None
        for left, right, token in spans:
            if left <= at and end <= right:
                inside = token
                break
        if inside is None or inside.startswith(stem) or inside not in _NORM_VOCAB:
            return True
        start = at + 1
    return False


def _stem_active(stem, tokens):
    """A stem counts when it crosses fragments, or a token actually starts with it.

    A vocabulary word may contain the letters by accident ("latest" has "test").
    That occurrence does not count. Fragments joined by deleted separators do.
    Repeated letters match either the spelled stem or the collapsed stem, so a
    double letter split across fragments still counts.
    """
    stem = _strip_marks(stem).casefold()
    collapsed = _norm_token(stem)
    if _stem_occurs(stem, tokens):
        return True
    return collapsed != stem and _stem_occurs(collapsed, tokens)


def _weakens(value):
    """Destructive intent blocks. Quiet text does not grant a route.

    Every separator is deleted and repeated letters collapse, so a split verb
    still matches. A hit inside one closed-vocabulary word does not.
    """
    if type(value) is not str or not value:
        return False
    stripped, _residue = _prepare(value)
    if not stripped:
        return False
    tokens = _letter_tokens(stripped)
    if not tokens:
        return False
    def has(*stems):
        return any(_stem_active(stem, tokens) for stem in stems)

    tests = has("test", "assert", "тест", "ассерт", "проверк")
    timeout = has("timeout", "таймаут")
    expected = has("expect", "ожида")
    boundary = has("qa", "security", "auth", "защит", "безопас", "авториз", "доступ")
    cuts = has("delet", "remov", "drop", "strip", "удал", "убрат")
    gated = has("skip", "disable", "xfail", "xit", "отключ", "пропуст", "закомментир")
    if cuts and (tests or timeout or expected or boundary):
        return True
    if gated and (tests or timeout or boundary):
        return True
    if has("comment") and has("out"):
        return True
    if has("weaken", "loosen", "ослаб"):
        return True
    if has("rais", "increas", "extend", "повыс", "увелич", "продл") and timeout:
        return True
    if has("adjust", "updat", "chang", "измен", "подгон", "обнов") and expected:
        return True
    return False


def _weakens_any(evidence):
    return evidence.text_proof["weakens"]


def _case_error(case):
    if not _closed_keys(case, _CASE_KEYS):
        return "unexpected case fields"
    if (type(case["schema"]) is not str or type(case["semantics"]) is not str
            or case["schema"] != CASE_SCHEMA or case["semantics"] not in ("legacy", "new")):
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


def _closed_keys(value, keys):
    """Check exact key types BEFORE set/hash/equality or keyed access."""
    return (type(value) is dict and len(value) == len(keys)
            and all(type(key) is str for key in value) and set(value) == keys)


def _binding_error(binding):
    if not _closed_keys(binding, _BIND_KEYS):
        return "invalid binding"
    if not _matches(_SHA64, binding["task_sha"]) or not _matches(_SHA64, binding["rules_sha256"]):
        return "invalid binding"
    if not _matches(_SHA40, binding["rules_commit"]) or not _matches(_SHA40, binding["head"]):
        return "invalid binding"
    if not _matches(_OP, binding["operation_id"]):
        return "invalid binding"
    return None


def _pin_error(pins):
    if not _closed_keys(pins, _PIN_KEYS):
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
    try:
        proof = _text_gate(raw)
    except ValueError as error:
        return str(error)
    evidence = _ValidatedEvidence(_defaults())
    evidence.update(copy.deepcopy(raw))
    evidence.text_proof = proof
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
