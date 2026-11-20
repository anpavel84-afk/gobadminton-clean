# GoBadminton CLEAN — Cross-Model QA v1

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.**
**Status:** Advisor design proposal following Owner discussion, 23.10.2026. **This document does not change the accepted operating model, existing assignments/admissions, provider readiness, runtime router, controller, release gates or production permissions.** Only a reviewed canonical rules change and separately accepted implementation can activate a new mandatory QA gate.

## 1. Product outcome and rationale

Owner wants material product work to be assessed from two genuinely different AI perspectives before DEV promotion: one reviewer focused on requirements, user behavior and edge cases, another on code, technical correctness, regression and security. Avoid paying twice for mechanically trivial changes and avoid mistaking two agreeable model responses for independent evidence.

Source of authority: [ENGINEERING_OPERATING_MODEL.md](../rules/ENGINEERING_OPERATING_MODEL.md) §§3–8, 10–12; [AI_TRAIN_MASTER_PLAN.md](../ops/AI_TRAIN_MASTER_PLAN.md); existing [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [#218](https://github.com/anpavel84-afk/gobadminton-clean/issues/218), [#248](https://github.com/anpavel84-afk/gobadminton-clean/issues/248). This is a **proposed refinement of the existing independent-QA stage**, not a second supervisor, dispatcher, queue or admission protocol.

## 2. Proposed risk-tier policy (only for future admitted tasks, after approval)

| Tier | Examples | Proposed minimum checks |
| --- | --- | --- |
| **T1 · Low** | Copy, narrow styling, mechanical/non-behavioral refactor; no access/auth/privacy/schema changes | One independent exact-SHA model QA where appropriate + deterministic CI; existing visual/UAT checks still apply |
| **T2 · Significant** | User-visible feature, API behavior, attendance/game logic, game mapping, business contracts, cross-module changes | **Two independently executed model reviews from different qualified models/families** + applicable deterministic tests/Product CI + DEV smoke/UAT |
| **T3 · Critical** | Auth/identity/admin rights, privacy, concurrency, migrations, payments, secrets, data integrity | Two independent model reviews with explicit threat/invariant coverage **plus** relevant deterministic security/integration tests and targeted expert attention when justified. More model PASSes do not replace testing |

Classification must use impact and risk, not merely diff size, tokens, author preference or available quota. Ambiguous/high-risk changes default upward until PMA records a defensible classification. No additional paid API/provider is implied or approved.

## 3. Review split and independence

**Author:** qualified Cursor or Codex author publishes an immutable candidate using the existing bridge, with an exact SHA, task/admission, rules SHA, diff and applicable test evidence. Author self-review is not QA.

**QA-A: Product/behavioral lens.** Prefer a qualified Antigravity model when actually READY. Independently map Owner acceptance and product contracts to changed behavior, edge cases, permissions, user flows, accessibility/mobile behavior and missing test scenarios; execute available authorized read-only checks. A model's reasoning without real tool/test evidence must not masquerade as executed tests.

**QA-B: Engineering lens.** Prefer a separately qualified Codex model/effort with a different model from QA-A. Independently evaluate exact diff and dependencies, correctness, auth/privacy, data integrity, concurrency, regression, test assertions, failure paths and build/type checks. Role identity, source permissions and immutable scope must be independent of the author.

Both reviewers get the **same candidate SHA and authoritative requirements**, but their initial context must not contain the other's findings, verdict or deliberation. They may run sequentially; parallelism is optional. No source edits by either QA. A different session, model brand or account alone does not prove actual independence: enforce role separation and snapshot identity. A read-only expert diagnosis (Astra High) is **not** a replacement for either QA.

Example when supported: Cursor Auto authors → Antigravity Sonnet independently checks product scenarios → Codex Sol independently checks engineering risks. Until Antigravity is successfully qualified, this is **target routing only**, not a claim of current readiness.

## 4. Aggregation and repair gates

1. Trusted planner records tier, required QA identities/lenses, eligible qualified provider/model/effort, finite budgets and exact admission **before** the author/QA stages. No invented fields in current immutable wire protocol.
2. Deterministic CI and each model QA produce **separate** facts/receipts for the same exact candidate SHA, task/admission, rules revision, source access, tools/tests, requested/effective model/effort, findings and actual usage.
3. Aggregate by independently verified evidence, never by majority vote. **T2/T3 require both genuinely independent PASSes**, necessary tests/CI and product release checks. One PASS cannot override another substantive FAIL, NOT_TESTED or UNKNOWN.
4. On substantive QA/CI FAIL, preserve exact findings, perform the accepted **Codex Astra High read-only failure diagnosis** when that rule applies, then a bounded author repair on the permitted scope and recheck the **new SHA**. Historical PASS/FAIL/attempt/UNKNOWN receipts remain immutable.
5. Reuse a previous QA receipt only through existing conservative provenance/equivalence proof (#248), never fabricate a new PASS or automatically reuse a review after relevant code/contract/security/dependency changes. Recheck the affected lens and applicable tests on material delta; maintain two valid independently sourced acceptance proofs for the final SHA/equivalent scope.
6. Reviewer timeout, auth failure, quota, EACCES, no tool read or missing runtime capability is **not** QA PASS or source FAIL. Preserve UNKNOWN/reservations/charges until the existing bounded reconciliation path resolves its effects. Do not retry an ambiguous charged call blind.
7. When a required distinct qualified reviewer is unavailable, mark the **new T2/T3 gate BLOCKED/DEFERRED for that task**, not global train failure. Continue disjoint eligible tasks. Do not silently substitute an unqualified provider or weaken to one reviewer. An explicitly approved, scoped exception must be recorded before use; it is not labeled cross-model PASS.
8. Product CI, integration/release SHA, controlled DEV deploy/ACCEPTED, browser or manual UAT where required, and explicit PROD GO remain independent mandatory gates.

## 5. Feasible implementation within existing Actions train

**Documentation approval alone is insufficient.** The PMA/OPS implementation later needs targeted changes in the **existing** `scripts/chatops/actions_train/` planner/router/stage and receipt aggregation:
- Add tier/risk-to-QA-plan mapping for **new** admissions only; preserve old assignments/admissions and their frozen gates.
- Select only actually qualified QA provider/model/effort IDs from the installed registry; verify different reviewer identities and legitimate source access, model execution and tool receipts.
- Dispatch the second independent read-only review with its own operation ID/finite grant/budget, using immutable candidate snapshot and existing slots/locks. A new writer, supervisor, queue or service is unnecessary.
- Introduce trusted aggregation requiring all tier-mandated verdicts. Prevent forged/double-counted PASS, cross-SHA mixing, same-reviewer counting twice and accidental promotion on incomplete coverage.
- Surface QA-A/QA-B separately in existing Actions receipts/Owner Monitor, including verdict, reason, evidence, costs, provider-not-ready and targeted fallback/blocked state.
- Preserve exact CI/DEV integration, Astra diagnosis-on-FAIL, #248 QA equivalence, bounded retries, no duplicate writers and protected history.

**Engineering acceptance scenarios:** T1 one QA; T2 two independent PASS; one PASS + one FAIL; one PASS + one UNKNOWN; same model/session fraud; wrong SHA; later repair invalidates relevant QA; conservative equivalence reuse; quota/provider-down without double charge; author/QA conflicts; two-slot independence; Astra diagnosis not counted as QA; critical auth/privacy tests and browser UAT; prior admissions unchanged; no automatic PROD release. Require independent exact-SHA source review, full CI, guarded DEV-only runtime install with rollback, and at least one controlled E2E proof before claiming ACTIVE.

## 6. Safe integration boundary / exclusions

- **This PR is documentation only** in an isolated Advisor branch. No edits to `AGENTS.md`, accepted `ENGINEERING_OPERATING_MODEL.md`, live `AI_TRAIN_MASTER_PLAN.md`, workflows, adapters, slots, grants or protected files. No direct changes on `dev` or any deployment.
- PMA remains the **sole mutating operator** of active train work. Do not merge this proposal during AGY sandbox repair or assume it grants machine authority.
- **No Gemini API or other additional paid services** without separate Owner approval. Antigravity under qualification/HOLD is not quietly treated as READY.
- Canonical adoption later: PMA resolves exact scope and current live state, prepares a reviewed rules delta per §11, then a separate bounded OPS implementation through the usual source QA/CI/installer. Record `RULES_EFFECTIVE`, `SOURCE_READY`, `INSTALLED` and `LIVE_VERIFIED` separately. Existing product work can continue in its preexisting gates until actual authorized activation.

## 7. Owner-facing decision still to formalize

Proposed default: **T1 = one independent QA; T2/T3 = two complementary independent model QAs; substantive FAIL still routes through Astra diagnosis; every tier retains deterministic and DEV evidence.** This is a target decision for review, not a retroactive requirement on currently admitted tasks.
