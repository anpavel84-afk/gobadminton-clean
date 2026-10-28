# WORKING DRAFT — NOT APPROVED — NOT CANONICAL
# GoBadminton · Stage-first orchestration and model routing v002

Date: 2026-10-22. Role: Owner Advisor / prelaunch design review.
Scope: **existing** GitHub Issues + Project #1 + Actions train + restricted Germany VPS. No new Supervisor, queue service, remote API, product implementation or PROD.
Source examined: `scripts/chatops/actions_train/core.py` (`route`, `plan`); `live/slots.py` (closed adapters, quota); `live/autonomous_issues.py` (exact immutable admission); `recovery_admission.py` (#185 delegated successor); `client.py` and train Actions workflows.
This document is a **design**, not machine admission. It must NOT be imported as runtime policy or treated as evidence of installed models.

## 1. What is actually live

- Old `GOBADMINTON_AUTONOMY_V1` model is an **optional scalar**, currently accepted `gpt-6.1-sol` with `high|medium`, `max_attempts <= 3`. Routing/QA author roles are coupled; `core.route` balances calls over quota only among permitted adapters. Codex author/QA is the only proven executable route in pinned runtime.
- Cursor CLI `agent --model auto --print` is installed on Germany, `auto` appears in its authenticated model list. Adapter `inference_proven=false`, `owner_approved=false`, `executable=false` in closed registry. CLI presence ≠ tested task-scoped executable.
- Antigravity `agy` has real `claude-sonnet-5-5-(medium|high)`, `claude-opus-5-5-high` models, but is still forbidden for automatic QA and author by closed registry. Read-only specialized testing must be proved without sharing author worktree write rights.
- Codex model cache lists `gpt-6-astra` low/medium/high/xhigh/max and `gpt-6.1-sol` similarly, plus Luna, but cache listing is not a proven stage/budget permission.
- Installed protected root train controller: `6b24848520ba01f66d764917a577aa1d2d189a45`, currently `mode=disabled` pending activation. Do NOT restart/activate as part of this proposal.
- GitHub Project #1 is documented but Projects-v2 authenticated access is not proven. Issues/Actions can be read; `gh auth status` on VPS is not a Projects credential. A draft plan is not a new admission.
- Original exhausted #149/#170/#177/#181 attempts and existing #185 receipts are immutable; no implicit fourth try.

## 2. Authoritative unit / hierarchy

**Parent Issue = business outcome / Owner product authority.** Example #73 post-game approved business model.
**Sub-issue = independently deliverable source slice**, only when useful: a frozen API contract, backend implementation, bounded UI, or end-to-end release proof. Prefer one sub-issue with multiple roles for a small change rather than an Issue for every LLM call.
**Stage = one role on an exact sub-issue**; stage produces an immutable GitHub artifact (spec hash, code SHA/PR, QA verdict, release receipt).
**Actions = orchestration** of stages, never a second product-truth database. Projects visualizes parent/subissues, priorities, dependencies and statuses; Actions/PR/checks/DEV are the source of execution evidence.
**Owner scope envelope**: product goal, excluded behavior, allowed paths/effects, privacy/security invariants, dependency links, overall attempt/recovery ceiling. Derived child scopes must be subsets; the system can draft child Issues but cannot mint new Owner permission.

Proposed pipeline for each parent:
1. **Intake/deduplicate** existing Issues and previous accepted code. Read Owner decision, present current code gaps and user-visible acceptance criteria.
2. **Breakdown plan (DRAFT)**: small role-based planner suggests 1–N subissues in an acyclic DAG, dependencies, locks, exact paths/non-goals, risk and model route per stage.
3. **Boundary review** verifies each child does not expand Owner's approved envelope, duplicate a done slice or infer new rights. A change of goal/public visibility/role/migration scope is sent back to Owner with a precise difference, not quietly admitted.
4. **Architecture / contracts** only where needed. For risky schemas/ACL/concurrency, Codex produces a frozen ADR+contract+permission matrix; independent architecture critic examines it. A simple isolated UI fix skips the heavy ADR.
5. **Implementation** is mostly Cursor Auto, in one bounded worktree of one subissue. It consumes the frozen architecture version and cannot change it implicitly.
6. **Independent QA** uses separate Antigravity Claude with read-only access, no code write. For higher-risk adversarial audit prefer Claude Opus 5.5 or a Codex Astra independent review if the author wasn't Codex.
7. **Product CI -> DEV** exact SHA and rollback; Owner UAT separate from CI/source QA.
8. **Record progress** as GitHub subissue/Project status + exact evidence links. Close/defer only on actual agreed Done definition.

Initial Projects field proposal (reuse existing Stage rather than adding another task board):
`Backlog -> Plan ready -> Architecture -> Implementation -> QA -> CI -> On DEV -> Owner UAT -> Done`; `Blocked / Replan` are distinguishable dispositions. If existing Stage values do not allow these, keep Stage high-level and compute detailed phase from exact Actions evidence.

## 3. Complexity/risk classification (stage-local, not whole-Issue)

Human-reviewable rubric; do not let a model silently relabel task scope:
- **Routine:** already-decided local component, known APIs, no new access/privacy/schema rules. Plan via Sol Medium or no model; code Cursor Auto; QA Claude Sonnet Medium if UI or regression-sensitive.
- **Complex:** multiple modules, integration contracts, performance race or uncertain component state. Architecture Sol High or Astra Medium; code Cursor Auto against frozen contract; independent Sonnet High.
- **Critical:** authentication/ACL/privacy, migrations with irreversible data effects, concurrency/idempotency, payment-like side effects, deployment/CI control or recovery code. Architecture Astra High; implementation Cursor Auto if well-specified and provable in sandbox (otherwise Sol High only by explicit stage choice); independent Opus High; extra deterministic checks mandatory.
- **Exploratory:** unknown cause. First read-only diagnosis Sol High, escalate to Astra Medium/High if contradictory evidence or systemic risk; only after root cause is established grant a bounded writer a targeted fix.

Trigger reclassification when a reviewer proves unforeseen auth/data/concurrency risk, a failed QA reveals requirements missing, or proposed allowed_paths/contract changes. Any expansion of product semantics/Owner permissions is a **new approval boundary**, not mere model escalation.

## 4. Model-by-role policy (proposed, not currently executable)

| Role/stage | Primary | Alternatives by evidence | What is preserved |
|---|---|---|---|
| Intake, dedupe, small scope brief | deterministic parser, then Codex Sol 6.1 Medium where judgment needed | Luna Medium on qualified repetitive data-only stage; Cursor plan mode | No Issue/admission mutations without authority |
| Small architecture / exact interface definition | Codex Sol 6.1 High | Astra Medium if conflicting dependencies; Astra Low for brief but hard single decision after calibration | Frozen product requirement |
| Critical architecture / threat model / tricky state machine | **Codex Astra High** | Astra Medium if sufficient, or Sol High if proven on that class | API/ACL/ownership frozen before code |
| UX composition / state prototype | Cursor Auto read-only plan or Antigravity Claude Sonnet 5.5 Medium | Sol Medium for technical UX tradeoffs | Owner Style Guide first |
| Ordinary implementation: web/api/tests | **Cursor Auto** | **Codex Sol 6.1 Medium**, High if integration difficulty; Astra only for exceptional code/diagnosis | Same Issue, scope, author attempt + lock |
| Narrow code debugging | Sol 6.1 High when Cursor cannot resolve a bounded fault | Astra Medium/High only if systemic/critical | No blind stage replay |
| Independent source QA | **Antigravity Claude Sonnet 5.5 High** (Medium for low-risk quick check) | Opus 5.5 High for adversarial/privacy; Codex Sol Medium for provider outage | Different stage identity; read-only, source-specific |
| Critical independent adversarial QA | **Antigravity Claude Opus 5.5 High** | Independent Codex Astra Medium/High, never self-QA | Exact candidate SHA, no QA code edits |
| CI, release, monitor, rollback | **deterministic GitHub Actions/root receiver** | No model fallback to skip failing tests | Exact immutable SHA/receipt |
| Owner visual/product acceptance | **Owner** | No agent can impersonate it | Product decision |

Optional Antigravity Gemini4 Argon = diversity/second read-only check after proof, not default while Owner prefers Claude. Do not assume Opus outperforms Sonnet on every coding benchmark; evaluate by phase with project fixtures. Higher reasoning effort is not always higher value: Astra Medium may be better than Sol XHigh on a difficult compact task. Use Astra XHigh/Max only on demonstrated hard cases, never as automatic retries; Ultra multi-agent bypasses the bounded slot design and is excluded by default.

Exact candidate IDs require installed per-user CLI validation: `codex -m gpt-6-astra -c model_reasoning_effort=high`, `codex -m gpt-6.1-sol -c model_reasoning_effort=medium`, `agent --model auto --print`, `agy --model claude-sonnet-5-5-high --mode plan -p`, `agy --model claude-opus-5-5-high --mode plan -p`. Never pass API/GitHub root credentials to an author.

## 5. Dynamic router decision, in this strict order

1. `stage.role` and `stage.risk` -> type-appropriate ordered candidates (not token ratio).
2. Require **eligible provider capability**: installed, authenticated, proved inference under correct sandbox/worktree, explicitly approved role/effort, immutable parent/child model allowance. A cache or a CLI list is not enough.
3. Independence: QA read-only separate from author, no same process/session and no shared writable candidate checkout. If Cursor Auto conceals its underlying model, record `opaque`, not a made-up engine.
4. Provider availability and finite budget => filter, never auto-increase daily max; report quota `UNKNOWN` as not eligible unless evidenced; subscriptions' weekly usage and internal call budgets are different metrics.
5. Select first task-fit available candidate; resource/time limits only break ties or trigger fallback.
6. Persist `route_decision` in existing GH Actions evidence: parent, child, exact stage, risk, model, effort, reason, fallback, task/revision digest, claim/generation and budget meter source.

**Fallback is not a new implementation attempt by itself**:
- Auth/rate limit/quota failure **proven before source write or model effect** -> take next pre-authorized provider for the same stage, same attempt envelope.
- Ambiguous provider return / timed-out writer / uncertain Git changes -> identity+worktree+PR reconcile FIRST; do not launch second author until exact result resolved.
- QA FAIL with a concrete source defect -> targeted repair on same child within its remaining author attempts; if source problem appears architectural, add a read-only diagnosis and update the exact architecture/acceptance note before editing.
- Three spent source attempts -> `deferred`, audit exact evidence and request a separate reviewed successor when allowed by unchanged Owner envelope. No reset/no fabricated Owner authorization. Other disjoint work keeps running.
- Regression/environment/CI infrastructure failure -> OPS evidence gate rather than blindly retrying code author or spending unrelated model calls.

Model promotions are stage-local: `Cursor Auto -> Sol Medium -> Sol High` for proven implementation trouble. `Sol High -> Astra Medium -> Astra High` for demonstrably difficult architecture. `Claude Sonnet -> Claude Opus` for serious missed review issue. Never escalate just because “tokens available”; never bypass access or increase attempts through a route upgrade.

## 6. Automatic plan revision / decomposition

The planner revises a **DRAFT plan revision**, not a frozen Owner admission. It compares:
- desired outcome vs current code and source;
- existing Issue/PR/release history to prevent duplicate slices;
- dependency graph and known file/lock conflict;
- acceptance proofs, risk class and phase routes.

It emits `stage-plan proposal Vn` + **delta** from Vn-1: new/split/merged child, changed QA, changed allowed path, affected Owner decision, estimated independent slots. Each proposed child starts `NOT_ADMITTED`; another bounded checker verifies subset of Owner envelope. Once an admitted child is claimed, edits to its authorization are forbidden; revise via linked successor Issue and an exact new admission under existing legitimate delegation/Owner approval. Updating a routing suggestion or Project Stage is never authorization.

Current `GOBADMINTON_AUTONOMY_V1` only accepts one `model` scalar. Before enabling new routing, implement and independently review a **versioned phase-route admission extension** that pins an allowlist of roles/providers/efforts within each already authorized subissue. Until then, do not silently rewrite immutable comments or route Codex-only task to Cursor.

For automatic child publication without repeated Owner micro-GOs, Owner can sign ONE finite parent scope/approved child-set envelope, then Actions can create only exact child Issues within it after independent plan review. Reuse the same proof/parent-bound checks as #185 recovery admissions; do **not** re-use #185 receipt as general delegation, impersonate Owner, or allow model-authored content to mint approval. If the parent scope doesn't include a child, stop only that child with a clear specific decision request.

## 7. Validation / rollout gate — PRELAUNCH

A. Read-only task plan examples and policy tests (no live state).
B. Qualify real CLI models in both isolated slot environments under existing role/sandbox/permission boundary. Probe with no write and explicit limited inference, record actual model and budget evidence.
C. Compare model routing on 8–12 previously closed GoBadminton tasks: UI regression, contract, concurrency, security, QA fixture, ambiguous provider result, documentation, long task. Measure exact QA defects found, CI first-pass, Owner UAT regressions, elapsed time, calls, not generic model “score”.
D. Integrate pure plan validator into current GitHub Actions dispatcher; no new always-on service and no duplicate work queue. Validate DAG, immutable Issue ancestry, parents, scopes, lock conflicts, stage IDs and duplicate reservation. All writes are separate permission-gated Actions.
E. Independent OPS/security review, CI, test on safe synthetic/dry mode, exact manifest/pin upgrade with backups and rollback. Keep protected root disabled while reviewing model policy.
F. Only AFTER Owner approval of this routing policy and measured capability proof, activate small canary stage(s), verify no duplicate writer and automatic bounded fallback; then normal rollout. No PROD promotion, no model subscription access guessing.

## 8. What constitutes success

- A real parent Issue is decomposed into understandable child deliverables, with exact links and Owner scope.
- Architecture drafted/reviewed separately, then Cursor writes exact bounded code; Antigravity reviews it independently.
- A simple task skips unneeded heavy architecture stages, while high-risk code does not skip them.
- A confirmed Cursor rate-limit transparently triggers authorized Sol fallback without two writers or lost history.
- A QA defect triggers one bounded repair/replan, a 3/3 exhaustion produces a legitimate reviewed successor or honest `needs-owner`, never a hidden fourth attempt.
- Two slots run independent READY work while critical reasoning/QA runs only as actually required.
- GitHub Projects is a visual view of Issues/Actions evidence, not an additional independent source of admission; Owner knows what is waiting and why.
- Final DEV acceptance requires Product CI, actual release receipt and live SHA; Owner UAT remains a distinct verdict.

This draft does not change the running dispatcher, issue approvals, provider flags, installed root, Projects fields, source tasks, QA decisions, DEV/PROD deployments, or other VPS services.
