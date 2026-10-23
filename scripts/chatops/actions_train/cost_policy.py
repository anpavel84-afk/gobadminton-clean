"""Prospective stage-cost policy. No model/API/state writes, no price estimates."""
SCHEMA = "GB_STAGE_COST_V1"
EPOCH = "2026-10-22T20:16:57+00:00"
MATRIX = {
    "simple": "codex:gpt-6-luna:medium",
    "standard": "codex:gpt-6.1-sol:medium",
    "complex": "codex:gpt-6.1-sol:high",
    "expert": "codex:gpt-6-astra:medium",
    "critical": "codex:gpt-6-astra:high",
}
REASONS = {"bounded_docs", "standard_ui", "standard_api", "complex_logic",
           "expert_risk", "critical_architecture", "security", "concurrency", "hard_blocker"}
CRITICAL = {"critical_architecture", "security", "concurrency", "hard_blocker"}

def require(ok, reason):
    if not ok:
        raise ValueError(reason)

def validate_policy(task):
    policy = task.get("routing_policy")
    require(type(policy) is dict and set(policy) == {"schema", "author", "qa"}
            and policy["schema"] in (SCHEMA, "GB_STAGE_COST_V2"), "invalid stage cost policy")
    require(all(k in task for k in ("author_routes", "qa_routes", "work_kind", "risk")),
            "cost policy requires explicit immutable V2 routes")
    for role in ("author", "qa"):
        row = policy[role]
        require(type(row) is dict and set(row) == {"complexity", "reason", "evidence"},
                "invalid stage classification")
        level, reason, evidence = row["complexity"], row["reason"], row["evidence"]
        require(type(level) is str and level in MATRIX and type(reason) is str and reason in REASONS,
                "unknown stage classification")
        require(type(evidence) is str and 1 <= len(evidence.strip()) and len(evidence) <= 1200
                and all(c.isprintable() for c in evidence), "stage evidence required")
        preferred = preferred_route(policy, task, role, level)
        require(preferred in task[role + "_routes"], "minimum stage route not explicitly admitted")
        if level == "critical":
            require(reason in CRITICAL and len(evidence.strip()) >= 20,
                    "Astra High requires specific critical escalation evidence")
        if level == "expert":
            require(reason in CRITICAL | {"expert_risk"} and len(evidence.strip()) >= 20,
                    "Astra Medium requires expert-risk evidence")
    return policy

def preferred_route(policy, task, role, level):
    first = task[role + '_routes'][0]
    if policy['schema'] == 'GB_STAGE_COST_V2':
        if role == 'author' and level in ('simple', 'standard', 'complex') and first == 'cursor:auto':
            return first
        if role == 'qa' and level in ('simple', 'standard') and first == 'agy:claude-sonnet-5-5-medium':
            return first  # Qualification is still mandatory in core._route_immutable.
    return MATRIX[level]

def selection(task, role):
    """Never add a route; pick the approved minimum for the classified STAGE."""
    p = validate_policy(task)
    row = p[role]
    minimum = MATRIX[row["complexity"]]
    preferred = preferred_route(p, task, role, row['complexity'])
    return preferred, {
        "approved_fallback_routes": [minimum] if preferred != minimum and minimum in task[role + "_routes"] else [],
        "policy": p["schema"], "stage_complexity": row["complexity"],
        "selection_reason": row["reason"], "selection_evidence": row["evidence"],
        "escalation_reason": row["reason"] if row["complexity"] in ("expert", "critical") else None,
        "expense_diagnostic": None, "risk_is_not_complexity": True,
    }

def annotate_legacy(task, choice):
    expensive = choice.get("effective_model") == "gpt-6-astra" and choice.get("effort") == "high"
    return {"policy": "immutable_legacy", "stage_complexity": None,
            "selection_reason": "preserved_exact_immutable_authorization",
            "selection_evidence": "No existing routing amendment mechanism; permission was not rewritten.",
            "escalation_reason": None, "risk_is_not_complexity": True,
            "expense_diagnostic": "UNRECORDED_ESCALATION_REASON" if expensive else None}

def usage(before, after, completion, qa_result=None):
    delta = after - before if type(before) is int and type(after) is int and after >= before else None
    return {"charged_calls": delta, "tokens": None, "money": None,
            "usage_source": "same_slot_provider_role_ledger",
            "token_usage_reason": "CLI adapter does not expose structured token usage",
            "model_completion": completion,
            "qa_verdict": qa_result.get("verdict") if isinstance(qa_result, dict) else None,
            "repeat_needed": completion != "returned" or isinstance(qa_result, dict) and qa_result.get("verdict") == "FAIL"}
