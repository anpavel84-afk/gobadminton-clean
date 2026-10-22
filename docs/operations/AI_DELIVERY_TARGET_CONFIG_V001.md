# GoBadminton CLEAN — target AI delivery configuration v001

> **Status: OWNER-PROPOSED / REVIEW REQUIRED — NOT RUNTIME ACCEPTED.**
> Date: 2026-10-22 (America/Sao_Paulo). Scope: GoBadminton CLEAN engineering/QA/DEV delivery.  
> Related: [OPS #158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158), [OPS #199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [model economy #211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211).  
> Approval/merge may make this document the **target operating model**, but cannot activate a provider or grant permissions merely by its presence in Git.
>
> This document defines the desired end-state **and** how to evidence it, not an assertion that Cursor/Antigravity already work.

## 1. Non-negotiable outcome

GoBadminton must have a working, economical, independently verified, **multi-provider** delivery pipeline. The standard pipeline should be able to use **Cursor**, **Codex**, and **Antigravity** where appropriate. Temporarily disabled adapters are **remediation obligations**, not a silently accepted substitute for the target state.

The operating goal is **working agents with preserved isolation**, never “turn off AppArmor/sandbox for a green check.” A sandbox or access failure must be reported explicitly with a linked remediation item, owner and retest criteria. A provider cannot be labeled ACTIVE until a real end-to-end protected trial passes.

## 2. Sources of authority (avoid parallel systems)

1. **Owner-approved project rules and decisions**: `AGENTS.md`, `docs/rules/README.md`, `docs/manifest/OWNER_DECISIONS.md` and this document **after approval**. `AGENTS.md` is the discovery entrypoint for all development agents.
2. **Durable task authorization**: one approved GitHub Issue and its immutable Owner admission/assignment; never infer permission from a model route, PR, repository credentials, or this policy. Preserve existing `GOBADMINTON_AUTONOMY_V1` semantics, attempts, immutable comments and active assignments.
3. **Planning**: GitHub Projects/Issues are the product/backlog record, not a second runner. Product parent outcomes may be decomposed into scoped, dependency-bound stages only within an authorized scope.
4. **Orchestration and evidence**: existing GitHub Actions train is responsible for dispatch/state/CI/reconciliation; the restricted Germany DEV worker executes bounded commands and returns signed/traceable stage receipts. Existing exact-SHA independent QA, Product CI, image-paired DEV ACCEPTED, smoke and rollback remain authoritative.
5. **Release**: PROD only with explicit scoped Owner GO for the particular release. No script, Issue, or model can convert DEV permission into PROD authorization.

When old docs conflict, verify current `gobadminton-clean` rules and real GitHub/server state before acting; do not treat a historical handoff or the old `gobadminton` repo as live authority.

## 3. Desired executor routing (preference, not false readiness)

| Stage | Preferred route | Proven fallback / decision logic |
| --- | --- | --- |
| Routine implementation, UI, CRUD, safe isolated changes | **Cursor Auto** on Germany VPS | Codex Sol/Luna with effort selected by complexity if Cursor unavailable |
| Hard implementation/debugging | Cursor or Codex high-capability model by measured task needs | Explicit escalation with reproducible issue evidence |
| Critical architecture, security, unusual concurrency, threat model | **Codex Astra High** selectively | Peer review and Owner escalation where needed |
| Ordinary independent QA, review, UX checks | **Antigravity** in *independent protected QA identity*, once proven | Another genuinely independent protected QA route at suitable cost (often Codex Sol Medium); never self-review as independent |
| Research, source attribution, catalog curation | **Antigravity** when its task capability and rights are proven | Approved alternative with source/provenance capture |
| Deterministic tests, build, CI, deploy | GitHub Actions / existing restricted machinery | No unnecessary model calls |

Selection is **stage/risk/skill first**, then availability and actual quotas. Astra High is **not** default QA. Fallback must preserve independence, authorization, task/attempt budget and evidence; if impossible, mark the precise stage BLOCKED instead of fabricating a PASS. Do not launch duplicate writers after unknown timeouts.

The legacy `30/30` is an **operator-configured host limit**, not an OpenAI provider limit. Do not silently treat it as such. Review removing any arbitrary daily hard stop under the existing Owner OPS mandate; continue to enforce per-task max attempts, concurrency, cancellation, budget/loop protections, provider limits, and recorded requests/usage. An `unlimited` mode must not erase historical call counts.

## 4. Isolation and least privilege — acceptance contract

- All model execution runs **on the authorized Germany host**, as a named unprivileged service identity, in an assigned task-scoped worktree. PLAN is for viewing/control, **not execution**. Do not touch unrelated projects, VPN, PROD secrets or directories.
- **Keep effective OS isolation**: AppArmor/user namespaces where applicable, plus a working runtime sandbox/profile or equivalently isolated approved container runtime; scoped filesystem allowlists, CPU/time/resource bounds, limited network where the admitted task allows it. Neither provider subscription nor a successful CLI `--help` proves safety.
- No general root/Docker socket, global SSH credentials, unrestricted writable mounts, arbitrary sudo, broad AppArmor disablement or host-wide unconfined mode for author/QA. Only minimally necessary read access to code/task data; never broaden access to private runtime env, PROD volumes, personal keys or other agents' worktrees.
- Exactly one authoritative source writer per task/scope under current train leases; QA uses an independent principal/context and exact candidate SHA. Keep immutable authorization, admission validation, release gates and fault/rollback recovery.
- Never weaken checks merely to obtain Cursor/Antigravity green status. If the CLI cannot work under a suitable sandbox, it remains **UNAVAILABLE** with an owned, testable remediation; use a proven fallback for unrelated tasks.

## 5. Cursor/AppArmor remediation — what “fixed” means

Current observed blocker from OPS #199: Cursor CLI `--sandbox enabled` fails on Germany under AppArmor. This is **compatibility evidence**, not justification to drop either Cursor or AppArmor.

Assigned OPS integrator must:
1. Reproduce on current installed versions with exact invocation, non-secret stderr, exit code and running account; collect scoped AppArmor audit denials, namespace availability and relevant effective policies, without leaking tokens.
2. Determine whether the defect is Cursor's sandbox implementation, kernel namespace policy, AppArmor profile or existing wrapper; record the actual root cause before changing the host.
3. Evaluate **narrowly scoped** remediation: dedicated approved AppArmor user-namespace policy/profile and sandbox integration, or a separately approved unprivileged/rootless isolated execution environment. Preserve global defaults and avoid broad permissions to service or production data.
4. Prove protected real inference + bounded source change in a test worktree; reject cross-worktree and secret access; verify cleanup, network policy, timeouts, no host privilege escalation, quotas and nonzero error propagation.
5. Enable author routing **only after** security review, independent QA and receipts of the actual installed runtime. Set state READY only after positive proof.

No `--sandbox disabled`, blanket `apparmor=0`, host-wide unconfined profile, root CLI run or equivalent bypass is permitted as a fix.

## 6. Antigravity remediation — what “fixed” means

Current OPS #199 evidence: listed Antigravity routes are not proven as author/independent QA; existing file read restrictions block the adapter; advisory review alone is not QA.

Assigned OPS integrator must:
1. Record exact denied path/operation and process UID/GID, current root/worktree access controls, adapter and model identification.
2. Grant **only required** read permission to the specific designated source snapshot and deliverable inputs; provide a separate restricted QA workspace/identity when doing QA. Never expose secrets or other users' worktrees.
3. Verify a real stage appropriate to its role, including model invocation, provider receipts, stage timeout, failures, bounded files/effects and independent QA attribution (if QA).
4. Only then make the corresponding role selectable; advisory/research readiness must not imply implementation or QA readiness.

## 7. Mandatory live capability register and truthful monitoring

The existing OPS monitor / Actions receipts should show **per provider and role**, at minimum:

- provider + exact model/effort or `unknown`; required role (author, QA, research, architecture);
- status `READY / DEGRADED / UNAVAILABLE / NOT_TESTED`;
- last real protected test timestamp, host, adapter version and *evidence permalink*;
- precise blocker, assigned remediation Issue, next action; controlled fallback;
- selected vs effective model, reason/escalation, provider failure and calls/tokens where available (unknown stays null);
- owned assignment, lease, attempts and whether a model process actually ran.

Don't label a route READY from credentials, subscription, `--help`, a listed model or successful advisory-only invocation. Surface unexpected route outages to the Owner and open/refresh remediation immediately. Do not silently operate for days with a permanently disabled preferred provider.

## 8. Acceptance and change management

**Target acceptance** requires:
1. One accepted *isolated live implementation trial* via Cursor with the required runtime sandbox intact.
2. One accepted *independent protected QA trial* via Antigravity, demonstrating author/QA principal separation and real artifact verification; research role separately proven if enabled.
3. Codex fallback remains working and genuinely bounded; unknown-timeout duplicate-author prevention passes.
4. Provider status in monitor matches reality; CI and DEV release gates are unchanged; failures are shown honestly.
5. Full reproducible receipts (version/config hashes, source SHA, task/stage, invocation without secrets, exit codes, denial/protection tests, cost/attempt accounting) are retained in authorized durable evidence stores.

**Implementation process**: link this target to existing OPS #199/#158/#211 rather than create a competing controller. Changes to host profile, adapters and permissions require a scoped reviewed change, rollback plan, independent security QA and an authorized quiescent install window. No live executor replacement mid-task. No PROD deployment from this policy.

## 9. Documentation drift to repair

`docs/governance/CURSOR_ONBOARDING.md` still mentions historical `anpavel84-afk/gobadminton` and `/srv/gobadminton-dev/*`; `AGENTS.md` names `gobadminton-clean` and `/srv/gobadminton-clean/worktrees`. Update the onboarding in a bounded follow-up to actual verified paths/repository; do not copy old path/credentials into live tools.

**Reminder:** until reviewed and merged, this document is a proposal. Even after merge, it states the desired configuration, not proof of runtime activation.
