# Handoff · #394 role reputation bound case decisions + own receipt (attempt 23)

Assignment: `OWNER394_ROLE_REPUTATION_BOUND_CASE_DECISIONS_AND_OWN_RECEIPT_REPAIR`
Base: `ec781d44971e1ce34629e012a3ddb01792a957d0`
Attempt: **23** · continues preserved #394 history (not UNKNOWN replay)
Parent: #372 · same coordinated delivery; UI still next sequential pass
C5 OFF · PROD forbidden · no Git commit/push/deploy in this author pass

## Scope of this pass

Backend integration / privileged-decision defects **before UI**.
Repairs: consent-preview HTTP 200, own-list LATERAL foreign-report bleed, admin
approve/restore current admission+consent gates, exact case↔intake↔revision binding,
COI with bound pending/report submitter (+ appeal prior decision FK), small own/subject
DTO fields for stable next UI. No Astra / no architecture / no PROD.

## Exact changes (this pass)

### Consumer (`role-reputation.*`)
1. **`POST …/consent-preview` → 200** — `@HttpCode(200)` (documented non-create POST; Nest default was 201).
2. **`listMine` LATERAL** — only actor's own `review_submit`/`appeal` intakes
   (`submitted_by_user_id = author`); foreign report/reply waiting_intake no longer
   overwrites linked own receipt/status.
3. **Own DTO** — `roleHandle` + `subjectDisplayName` (safeDisplayName) for recipient without private IDs.
4. **Public item** — `subjectOwnReply: { status, version, pendingRevision } | null`
   only for subject viewer (no pending body text leak).
5. **`assertCurrentPublishGates`** — exported narrow validator for admin approve/restore
   (current admission, immutable consent hash, proof tip vs revision refs; withdrawn/non-current restore denied).

### Admin (`admin/role-reputation.*`)
1. **decide/readSource** bind `role_reputation_case_links.pending_intake_id` → exact
   review/reply revision; reject foreign/new revision under old case.
2. **approve/restore** call consumer `assertCurrentPublishGates` inside transaction;
   remove/retain unchanged (no silent delete of published criticism).
3. **assertIndependent** includes bound pending/report submitter even after reassignment;
   appeal excludes prior decision principal (`prior_decision_id`).
4. **resolveBasis** only corrects bound case game/role (not arbitrary unrelated targets).
5. Same guards on privileged command execute **and** authorizeReplay.

### Migration 0054 (unapplied additive)
- `role_reputation_pending_intakes.prior_decision_id` → `role_reputation_decisions(id)` for appeal COI.
- No applied-history rewrite.

### Contracts / tests
- OpenAPI `PublicRoleReviewItem.subjectOwnReply`
- Admin disposable: basis-changed approve denied → legitimate approve; own linked after foreign report;
  reporter-after-reassign COI; oldCase/newRevision deny; withdrawn restore deny; retained e2e path.
- Consumer disposable: consent-preview 200 assertion unchanged (fix was correct).

## Remaining (same branch / same PR — next UI pass)

1. Consumer UI: discovery/game/profile/composer using `roleHandle`, `reviewHandle`,
   `publishedRevision` / `replyAggregateVersion`, `subjectOwnReply`, consent-preview reply shape.
2. Admin Cases UI buttons for pending kind + decide/basis
3. Alpha changelog / release-agent description (not this pass)
4. Trusted PMA: real DB migrate, types, contracts check, disposable HTTP with PostGIS
5. Independent Codex Sol Medium QA → Product CI/security → merge `dev` → DEV ACCEPTED smoke
6. Human moderation UAT = **NOT_TESTED** until authorized Admin session observes approve/remove/restore

## Author checks run / not run

| Check | Result |
|---|---|
| Unit policy test | source untouched for policy; not executed (no node_modules / no DB) |
| Disposable DB HTTP | **notrun** (no dedicated disposable DB in author slot; PMA runs after import) |
| Product CI / security / DEV smoke | not claimed |
| Independent QA | not started |
| Owner UAT | NOT_TESTED |

## Known issues / notes

- Source PASS ≠ DEV claim. UI not in this pass.
- Private PG-3 never published via this path; venue writer CLOSED unchanged.
- Mode B / AGY READY not claimed.
