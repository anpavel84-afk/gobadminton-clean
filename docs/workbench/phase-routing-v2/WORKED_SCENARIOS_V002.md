# WORKING DRAFT — NOT APPROVED — NOT CANONICAL
# Phase routing v002 · exact worked examples and prelaunch test matrix

Date: 2026-10-22. Read together with `ROUTING_V002.md` and `BACKLOG_STAGE_PLAN_V002.json`.
This document authorizes NO GitHub Issue writing, no child admission, no CLI author call and no PROD/DEV release.

## Example A: approved post-game product model #73 is not a single Codex assignment

**Owner parent decision**: Outcome/Attendance/Participation independent; no automatic absence; corrections and disputes always accessible; private feedback only; no public ratings. The current architecture package is [historical PR #73](https://github.com/anpavel84-afk/gobadminton-clean/pull/73), still unmerged, and existing `#73` explicitly says **NOT_IMPLEMENTATION_ADMITTED**.

DRAFT DAG (subissue numbers are intentionally unassigned):

```
#73 Owner-approved product outcome
  PG-0 Contract/permission freeze [architect: Codex Astra High]
        └── [independent critique: Antigravity Claude Opus 5.5 High]
        ↓
  PG-1 outcome / attendance / correction / durable notices
        [bounded implementer: Cursor Auto]
        [QA: independent Antigravity Claude Opus 5.5 High]
        ↓
  PG-2 dispute / support link / full audit  → (can be planned concurrently with PG-3
        [critical architecture: Astra High]    only AFTER real API dependency readiness)
        [source: Cursor Auto]
        [QA: Claude Opus 5.5 High]
        ↓
  PG-3 private feedback and one response
        [architecture: Astra Medium/High where privacy unresolved]
        [source: Cursor Auto]
        [QA: Claude Opus 5.5 High]
        ↓
  PG-4 My Games and Participants UI [Cursor Auto]
        [UI review: Claude Sonnet 5.5 Medium; source QA: Sonnet High]
        ↓
  PG-5 integrated test [Opus High + deterministic CI/DEV] → Owner iPhone UAT
```

**PG-0 stage detail**:
1. `stage:intake`: deterministic repo comparison + Codex Sol Medium creates `PG0_plan_v1` with exact unresolved migration/ACL facts; no new Owner commitment.
2. `stage:architecture`: Astra High read-only/writing just versioned ADR/proposal, expected DB tables, permission matrix and API contract. It does not start product API authoring.
3. `stage:arch_review`: independent Claude Opus High evaluates privilege escalation, idempotency, private notes and reply scopes; FAIL -> architecture revision v2.
4. `stage:freeze`: exact references/commit hashes and acceptance matrix make `PG0_APPROVED_TECH`. If required product behavior exceeds Owner #73, stop with one clear comparison for Owner, not a general GO request.
5. `stage:child_admission`: a separate scope validator checks all children are a subset of the parent scope and are within a formally enabled delegated allowance. Under current V1, owner-authored immutable child admission remains required. No impersonated approval.
6. `stage:source`: `cursor:auto` receives ONE frozen PG-1 coding slice + exact ADR SHA. Independent Claude cannot write into the source worktree.
7. `stage:qa` and deterministic `ci`: exact candidate SHA. DEV receipt and Owner UAT remain independent.

No model ever “owns” all of PG-1. Astra owns the hard **analysis artifact**, Cursor the **code artifact**, Antigravity the **review artifact**.

## Example B: small mobile popup correction #179 skips architecture expense

- Source: last Owner feedback says compact swipe cover jumps when starting swipe down; gesture and first-tap Close have been accepted, preserve them.
- Scope/impact: one UI lifecycle fix, no API/schema/ACL.
- Plan: `Sol Medium scoped diagnostic → Cursor Auto narrow code/test → Claude Sonnet High read-only QA → CI/DEV → Owner UAT`.
- No Astra High architecture. If unexpected global state/gesture concurrency is proven and normal repair fails, route a small read-only `Sol High` root-cause stage, then Cursor builds the correction. Still same admission/attempt bound.

## Example C: Cursor Auto subscription exhausted after admission

- Candidate is a bounded `source` stage. Cursor Auto returns **confirmed rate limit before writes**, with exact provider code, zero app worktree change, no open process, no accepted external source publication.
- `router` consults the immutable stage's already approved alternates. If `Codex Sol 6.1 Medium` was explicitly authorized and proven in this slot, emit an auditable `ROUTE_FALLBACK` and execute the same task/attempt identity through Sol. No new task issued and no extra model charge to Cursor.
- If Cursor's result is **unknown**, read actual process+worktree+PR + stage journal. **Do not** run Sol in parallel and do not claim zero effect based only on a timeout.
- If all author providers unavailable: stop with `WAIT_PROVIDER`, preserve stage. Do NOT turn unrelated GitHub “ready” backlog into permission to bypass the limit.

## Example D: QA catches a defect and re-evaluates the model

QA finding: a UI code change breaks a localized fixture; remaining attempts >0.

- Record exact failed assertion/source head, not just `QA FAIL`.
- A deterministic categorizer marks `localized_test_or_source_defect`.
- Cursor Auto receives a **targeted repair** under the same child scope and next legitimate attempt. New QA run still independent and exact SHA.
- If same failure repeats or spans multiple systems, Sol High does **read-only** diagnosis and tightens repair instructions; Cursor implements.
- If the diagnosed defect is actually cross-boundary ACL/data/invariants, Astra High reviews the architecture; model escalation itself is not Owner scope enlargement. Any additional paths/permissions/semantics require scope approval.

## Example E: #177 / #181 exhausted 3/3 recovery

The actual train recorded each as `needs-owner` after a single consumed diagnosis, with no successor. Even though new recovery.py now allows owner-approved product docs with real code, it CANNOT retroactively erase those spent receipts.

Correct continuation:
1. Astra High read-only Owner-level analysis (outside spent model reservation) of exact frozen QA/CI evidence and existing product rights.
2. Produce proposal: genuine source flaw vs environment vs incorrect task assumptions; exact revised path list.
3. Independent Opus review of privacy/security as applicable.
4. If the existing delegated recovery authority DOES NOT permit a new machine successor, return a specific Owner decision request; no automatic retry. Only a separately admitted new child/successor becomes eligible.
5. On completion, dependent #184/#182 are unblocked by **actual DEV ACCEPTED**, not a new PR or successful planner run.

## Example F: model stage quality selection / calibration

A generic public coding benchmark compares a **model + harness + effort**; it cannot establish that one provider is best at *our* owner-approved UI, PostGIS races or recovery. Use 8–12 real historical tasks with frozen, no-write fixtures:
- mobile BottomSheet/first-tap Close regression;
- Radar viewer-specific privacy and proof expiry;
- PostGIS concurrent writes and idempotency;
- Admin superadmin vs organizer media rights;
- Game attendance/dispute API threat model;
- migration upgrade/rollback semantics;
- an exact failed SQL/TypeScript test;
- a read-only bounded source PR audit.

For each phase measure: accepted scope violations (zero allowed), actual tests/evidence found, independent QA agreement, new defects introduced, first-pass CI, task completion time and per-plan model calls. Don't grade by self-proclaimed model confidence or “longer reasoning”.
Calibrate `Astra Medium` vs `Sol High` on architectural tasks and `Sonnet High` vs `Opus High` on independent QA; keep Cursor Auto the default code implementer if it reaches exact gates.

## Prelaunch verification matrix

| ID | Stimulus | Must happen |
|---|---|---|
| P01 | Parent is existing approved #73, no implementation scope admission | Draft children allowed, zero source execution |
| P02 | Parent missing permission for new private visibility | Child blocked, cannot derive approval |
| P03 | Parent #73 gets a PG-0 architecture+PG-1 source plan | Astra artifact first; Cursor implementation later; independent Opus |
| P04 | Small #179 UI | No unnecessary Astra High stage |
| P05 | Cursor Auto returns confirmed quota before effect | Bounded Sol Medium fallback if explicitly allowed |
| P06 | Cursor/CLI times out after unknown write | Reconcile, never second writer automatically |
| P07 | Sonnet QA sees security gap | Hold source, Astra risk reclassification, Opus adversarial review |
| P08 | Source attempt 3/3 used | No attempt4; analyzed successor or needs-owner |
| P09 | Model subscription status UNKNOWN | No invented tokens or active budget; WAIT_PROVIDER |
| P10 | Product #184 depends on #177, #182 depends on #181 | Only DEV ACCEPTED dependency unlocks execution |
| P11 | Two children share contracts/OpenAPI or same UI files | Serial lock despite two free slots |
| P12 | GitHub Projects unreachable | Admit only via existing immutable Issues/Actions authority; UI shows unavailable, no duplicate board |
| P13 | Main-page owner approves broad parent, bot invents extra scope child | Reject the extra child, preserve draft proposal |
| P14 | DEV CI failed vs model QA FAIL | Correct stage-specific recovery; no rerun of unknown mutation |
| P15 | Architecture model route escalates from Sol to Astra due quality | New route decision with reason, not a new Owner authorization |
| P16 | Author + QA use same subscription/provider or Cursor Auto opaque model | Separate read-only QA process/worktree; no self-approval |
| P17 | Model outputs PASS without exact SHA/checks | NOT_TESTED, no promotion |
| P18 | PROD task inferred from DEV success | Forbidden; explicit Owner GO still mandatory |

**Not implemented:** V2 model registry, CLI sandbox qualification, stage-Actions integration, Owner delegation mechanism, Projects field synchronization, exact-model runtime switch, activation of protected train. All require reviewed bounded implementation and acceptance BEFORE launch. This file is an implementation-ready test/design handoff, not a software release.
