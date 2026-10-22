"""Stage-first GoBadminton Issue planner V2 — pure, closed, read-only.

An exact Owner-authored parent scope permits a *draft plan*. It does not permit
the bot to issue a GOBADMINTON_AUTONOMY_V1 task or start an LLM. Children need
independent exact admission by the existing trusted verifier/delegation.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Mapping, Sequence

OWNER_ID = 318610566
PARENT_MARKER = "GOBADMINTON_PHASE_SCOPE_V2"
DRAFT_MARKER = "GOBADMINTON_PHASE_PLAN_V2_DRAFT"
RISK = frozenset({"routine", "complex", "critical"})
SHA256 = lambda item: hashlib.sha256(json.dumps(item,ensure_ascii=False,
                                    sort_keys=True,separators=(",",":")).encode()).hexdigest()
ROUTE = {
    ("architecture","routine"): (["codex:gpt-6.1-sol:high"],
                                  ["agy:claude-sonnet-5-5-high","codex:gpt-6.1-sol:high"]),
    ("architecture","complex"): (["codex:gpt-6-astra:medium","codex:gpt-6.1-sol:high"],
                                  ["agy:claude-opus-5-5-high","codex:gpt-6.1-sol:high"]),
    ("architecture","critical"): (["codex:gpt-6-astra:high","codex:gpt-6.1-sol:high"],
                                   ["agy:claude-opus-5-5-high","codex:gpt-6.1-sol:high"]),
    ("implementation","routine"): (["cursor:auto","codex:gpt-6.1-sol:medium",
                                     "codex:gpt-6.1-sol:high"],
                                    ["agy:claude-sonnet-5-5-high","codex:gpt-6.1-sol:high"]),
    ("implementation","complex"): (["cursor:auto","codex:gpt-6.1-sol:high",
                                     "codex:gpt-6-astra:medium"],
                                    ["agy:claude-sonnet-5-5-high","codex:gpt-6.1-sol:high"]),
    ("implementation","critical"): (["cursor:auto","codex:gpt-6.1-sol:high",
                                      "codex:gpt-6-astra:medium"],
                                     ["agy:claude-opus-5-5-high","codex:gpt-6.1-sol:high"]),
}
BLOCKED = "NEEDS_OWNER_SCOPE_OR_REVIEW"


class InvalidPlan(ValueError):
    pass


def need(ok, reason):
    if not ok:
        raise InvalidPlan(reason)


def _paths(values):
    need(type(values) is list and 1 <= len(values) <= 32 and
         all(type(x) is str and 2 <= len(x) <= 240 for x in values) and
         len(values) == len(set(values)), "invalid parent allowed paths")
    for value in values:
        need(value[0] not in ('.','/') and '\\' not in value and
             value.startswith(("apps/","packages/","docs/")) and
             all(part not in ("", ".", "..") for part in value.split("/")) and
             not value.startswith(("docs/operations/","docs/rules/","docs/governance/","docs/manifest/")),
             "unsafe or control parent path")
    return values


def _scope(issue, comments):
    """Only immutable, numeric-Owner Issue/comment can form a scope envelope."""
    need(type(issue) is dict and type(issue.get("number")) is int and
         issue["number"] > 0 and issue.get("state") == "open" and
         not issue.get("pull_request"), "not an open Issue")
    need((issue.get("user") or {}).get("id") == OWNER_ID, "not Owner parent")
    body=issue.get("body") or ""
    sources=[]
    if issue.get("updated_at") == issue.get("created_at") and body.startswith(PARENT_MARKER+"\n"):
        sources.append(body)
    for c in comments:
        if ((c.get("user") or {}).get("id") == OWNER_ID and
            c.get("updated_at") == c.get("created_at") and
            c.get("issue_url") == f"https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/{issue['number']}" and
            isinstance(c.get("body"),str) and c["body"].startswith(PARENT_MARKER+"\n")):
            sources.append(c["body"])
    need(len(sources)==1,"no unique immutable Owner parent scope")
    raw=sources[0]
    need(len(raw.encode())<=16384,"parent scope over limit")
    try:
        data=json.loads(raw.split("\n",1)[1])
    except (ValueError,TypeError) as exc:
        raise InvalidPlan("bad parent JSON") from exc
    need(type(data) is dict and set(data)=={
        "schema","goal","acceptance","allowed_paths","risk","max_attempts","approved_product_scope"},
        "unexpected parent scope fields")
    need(data["schema"]==PARENT_MARKER and data["approved_product_scope"] is True and
         data["risk"] in RISK and type(data["max_attempts"]) is int and
         1<=data["max_attempts"]<=3 and
         all(type(data[k]) is str and 1<=len(data[k])<=6000 for k in ("goal","acceptance")),
         "unapproved/invalid parent scope")
    _paths(data["allowed_paths"])
    return data, SHA256(raw)


def proposal(issue: Mapping, comments: Sequence[Mapping]) -> dict:
    """Deterministic DAG; never a model-issued admission."""
    data, parent_hash=_scope(issue,comments)
    paths=data["allowed_paths"]
    kinds={"api":[],"web":[],"admin":[],"other":[],"architecture":[]}
    for path in paths:
        if path.startswith(("docs/api/","docs/architecture/","docs/handoffs/")):
            kinds["architecture"].append(path)
        elif path.startswith(("apps/api/","packages/contracts/")):
            kinds["api"].append(path)
        elif path.startswith("apps/web/"):
            kinds["web"].append(path)
        elif path.startswith("apps/admin/"):
            kinds["admin"].append(path)
        else:
            kinds["other"].append(path)
    # Critical source work requires a separate frozen-architecture dependency.
    # Without a parent-approved docs path the planner may not invent one.
    architecture_required=data["risk"]=="critical" and any(kinds[k] for k in ("api","web","admin","other"))
    if architecture_required and not kinds["architecture"]:
        return dict(schema=DRAFT_MARKER,parent_issue=issue["number"],
            parent_hash=parent_hash,status="BLOCKED_NEEDS_ARCHITECTURE_PATH",
            reason="critical implementation requires Owner-approved docs/api or architecture path",
            children=[],can_start_execution=False)
    children=[]
    def add(key,kind,selected,depends):
        if not selected:return
        role="architecture" if kind=="architecture" else "implementation"
        # Parent critical architecture is high-effort; web code may be complex
        # after architecture but retains the original strict acceptance.
        r=data["risk"] if role=="architecture" or kind!="web" else (
            "complex" if data["risk"]=="critical" else data["risk"])
        author,qa=ROUTE[(role,r)]
        children.append(dict(key=key,parent_issue=issue["number"],kind=kind,
            work_kind=role,risk=r,goal=f"{data['goal']} · {key}",
            acceptance=data["acceptance"],allowed_paths=list(selected),
            depends_on_keys=list(depends),author_routes=list(author),qa_routes=list(qa),
            max_attempts=data["max_attempts"],can_start_execution=False))
    arch=bool(kinds["architecture"])
    add("architecture","architecture",kinds["architecture"],[])
    backend=bool(kinds["api"])
    add("api","api",kinds["api"],["architecture"] if arch else [])
    add("web","web",kinds["web"],(["api"] if backend else
        ["architecture"] if arch else []))
    add("admin","admin",kinds["admin"],(["api"] if backend else
        ["architecture"] if arch else []))
    add("other","other",kinds["other"],["architecture"] if arch else [])
    need(children,"no bounded child slices")
    ownership={path:child["key"] for child in children for path in child["allowed_paths"]}
    need(len(ownership)==len(paths) and set(ownership)==set(paths),
         "path lost or duplicated between children")
    return dict(schema=DRAFT_MARKER,parent_issue=issue["number"],parent_hash=parent_hash,
                status="PLAN_PROPOSED_NOT_ADMITTED",children=children,
                can_start_execution=False,
                review_gates=["exact parent Owner consent","scope subset","dependency Issues resolved",
                              "independent stage review","child immutable machine admission",
                              "provider sandbox qualified"])


def revise(previous: Mapping, current: Mapping) -> dict:
    """Diff drafts only. Never edit frozen source task or grant new admission."""
    need(previous.get("schema")==DRAFT_MARKER and current.get("schema")==DRAFT_MARKER
         and previous.get("parent_issue")==current.get("parent_issue"),
         "revision not same parent")
    prior={c["key"]:SHA256(c) for c in previous.get("children",[])}
    updated={c["key"]:SHA256(c) for c in current.get("children",[])}
    return dict(schema="GB_PHASE_PLAN_DELTA_V2",parent_issue=current["parent_issue"],
                old_scope_hash=previous.get("parent_hash"),
                new_scope_hash=current.get("parent_hash"),
                scope_changed=previous.get("parent_hash")!=current.get("parent_hash"),
                new=sorted(set(updated)-set(prior)),
                dropped=sorted(set(prior)-set(updated)),
                changed=sorted(k for k in updated.keys()&prior.keys()
                               if updated[k]!=prior[k]),
                can_start_execution=False)


def preview_for_issues(issues: Sequence[Mapping], comments_by_issue: Mapping[int,Sequence[Mapping]]) -> dict:
    """Bounded Action evidence report, never a second task board."""
    results=[]
    for issue in issues[:80]:
        if "pull_request" in issue:continue
        try:
            results.append(proposal(issue,comments_by_issue.get(issue["number"],[])))
        except InvalidPlan as err:
            results.append(dict(parent_issue=issue.get("number"),
                                status=BLOCKED,reason=str(err)[:250],
                                can_start_execution=False))
    return dict(schema="GB_PHASE_PREVIEW_V2",results=results,can_start_execution=False)
