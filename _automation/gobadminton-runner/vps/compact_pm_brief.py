"""Read-only, event-driven compact PM prompt. No task authority or execution."""
from __future__ import annotations

import json
from pathlib import Path

from compact_task_capsule import capsule

ROOT = Path("/srv/gobadminton-clean/runner")
CRITICAL_QA_PREFIXES = (
    "qa-friends-dev-s1-api-",
    "qa-friends-dev-s2-web-",
    "qa-friends-dev-s3-integration-",
)


def read(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def render(owner_items, active_admission_only: bool) -> str:
    backlog = read(ROOT / "backlog.json")
    state = read(ROOT / "state.json")
    tasks = {t.get("id"): t for t in backlog.get("tasks", []) if isinstance(t, dict)}
    compact = []
    for h in state.get("history", []):
        tid = str(h.get("id", ""))
        if not tid.startswith(CRITICAL_QA_PREFIXES) or tid not in tasks:
            continue
        try:
            c = capsule(backlog, state, tid, ROOT / "receipts")
            receipt = read(ROOT / "receipts" / (tid + ".json"))
            compact.append({
                "id": tid, "status": h.get("status"),
                "qa": receipt.get("verdict", h.get("verdict")),
                "recommendation": receipt.get("merge_recommendation"),
                "blocking_count": len(receipt.get("blocking_findings") or []),
                "candidate": receipt.get("candidate_sha"),
                "evidence": c.get("evidence_fingerprint"),
                "reason": str(h.get("reason") or "")[:220],
            })
        except (OSError, KeyError, ValueError, TypeError) as exc:
            compact.append({"id": tid, "status": "UNVERIFIED", "gate": type(exc).__name__})
    owner = []
    for item in owner_items or []:
        if not isinstance(item, dict):
            continue
        body = item.get("text") or (item.get("payload") or {}).get("text") or ""
        owner.append({"id": item.get("id"), "origin": item.get("origin"),
                      "text": str(body)[:1900], "sha": item.get("text_sha256")})
    evidence = {
        "owner": owner,
        "recent_qa": compact[-8:],
        "active_claims": sorted((state.get("active") or {}).keys()),
        "source_only": True,
        "prod_authorized": False,
    }
    scope = ("Existing workers RUNNING. Only preapproved disjoint PM source-only task "
             "admissions permitted. Never merge or interrupt active claims." if active_admission_only
             else "Idle Runner. Exact independently accepted source candidate may merge via "
                  "existing guard; no deploy, production or live data change.")
    return (
        "GoBadminton PM / compact budget mode. ONE bounded EVENT, no recurring readback.\n"
        + "Small machine evidence, NOT permission: " +
        json.dumps(evidence, ensure_ascii=False, separators=(",", ":")) + "\n"
        + "Boundary: " + scope + "\n"
        + "Read the canonical clean-root AGENTS.md and exact relevant product "
          "issues only. Repository is anpavel84-afk/gobadminton-clean. "
          "No import or replay of 551 historical Runner tasks or signed receipts. "
          "Do not assume historical source QA proves new clean-root evidence.\n"
        + "Priority: existing Owner-approved Friends DEV Issue #12, starting "
          "with one bounded S1 foundation producer + its OWN independent QA. "
          "S2 UI follows only after S1 privacy acceptance. "
          "Only separately Owner-bound durable admission can enable new work; "
          "otherwise report no_safe_action and leave canonical main unchanged. "
          "Never retry terminal task IDs or an exact QA-failed candidate.\n"
        + "Absolute gates: Friends real-user enablement OFF pending distinct "
          "consent/privacy and deployment approval. Preserve player location "
          "privacy, contact eligibility, game capacity and all account fences. "
          "No production deployment/DB mutations, SMTP/OAuth/other-project VPN "
          "or self-certified QA. Only PM documentation, exact immutable inputs "
          "and guarded canonical backlog publication. No application code or "
          "runtime edits from the PM planner.\n"
        + "Any source merge requires exact QA candidate SHA/tree/branch, no blocking "
          "findings, no writer conflict, existing publication_guard and immutable "
          "main ancestry. STOP on guard refusal. Preserve old attempt ledgers. "
          "A new repair must be scoped only to the precise QA finding with a "
          "new bounded attempt and its own independent QA. Use an available "
          "cost-appropriate model; do not assert authorization by model choice. "
          "Never create duplicate work or proof-of-proof planning tasks.\n"
        + "Write exact planner receipt in /srv/gobadminton-clean/runner/autopilot-receipt.json. "
          "For Owner instruction, canonical result binding includes matching id, SHA of "
          "instruction text and exact task IDs. Guarded atomic single-writer Git push; "
          "backlog_sync parity after. If no safe action, leave main untouched, "
          "report short reason without creating readback branch. Stop after ONE action."
    )
