"""Read-only, event-driven compact PM prompt. No task authority or execution."""
from __future__ import annotations

import json
from pathlib import Path

from compact_task_capsule import capsule

ROOT = Path("/srv/gobadminton-clean/runner")
CRITICAL_QA_PREFIXES = (
    "qa-product-web-p4-predeploy-tooling-",
    "qa-product-p5-friends-offline-tooling-",
    "qa-product-p6-composed-release-tooling-",
    "qa-product-runner-monitor-provenance-",
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
        + "Read AGENTS.md, CURSOR.md, docs/rules/PROJECT_RECORD_POLICY.md, "
          "docs/operations/QUEUE_AUTOPILOT.md, "
          "docs/operations/MODEL_ROUTING_AND_BUDGET_V006.md, "
          "and exact current relevant QA/producer handoffs only. Fetch fresh GitHub main. "
          "Do not read all 547 tasks or entire history for unchanged context.\n"
        + "Priority: (1) safe source-only repair of failed P6QA-001 and Monitor QMS-002 "
          "on NEW task IDs with conceptual max5 and NEW independent QA; "
          "(2) guarded exact accepted-source merges of Web/P5 PASS_WITH_NONBLOCKING_GAPS "
          "with blocking_findings=[] and MERGE_RECOMMENDED; "
          "(3) other already Owner-approved independent tasks; else no_safe_action. "
          "Never retry terminal task or exact failed candidate.\n"
        + "Absolute gates: final TRAIN-QA-008 FAIL repair5/5 continuous controller "
          "NO INSTALL/NO MERGE/NO REPAIR6; P5 Friends OFF (G02/G03/G05/G06/G08 D02/D06); "
          "P6 real release HOLD; legal/privacy/data region/SMTP/OAuth/GPS/other-project VPN "
          "and all production effects excluded. No falsified QA evidence. "
          "Only PM documentation, exact prompts/bindings and canonical backlog allowed; "
          "no application code, runtime edits or deleting receipts.\n"
        + "Any source merge requires exact QA candidate SHA/tree/branch, no blocking "
          "findings, no writer conflict, existing publication_guard and immutable "
          "main ancestry. STOP on guard refusal. Preserve old attempt ledgers. "
          "A new repair must be scoped only to precise QA finding with one independent QA. "
          "Use affordable model routing: Luna low/medium routine, Sol medium technical, "
          "Astra high ONLY novel sensitive security, not routine P6 packaging QA. "
          "Never create duplicate work or proof-of-proof planning tasks.\n"
        + "Write exact planner receipt in /srv/gobadminton-clean/runner/autopilot-receipt.json. "
          "For Owner instruction, canonical result binding includes matching id, SHA of "
          "instruction text and exact task IDs. Guarded atomic single-writer Git push; "
          "backlog_sync parity after. If no safe action, leave main untouched, "
          "report short reason without creating readback branch. Stop after ONE action."
    )
