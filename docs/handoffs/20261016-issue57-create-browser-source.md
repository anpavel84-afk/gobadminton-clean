# Issue #57 — committed create-photo browser regression

From: source author. To: existing queue executor / independent exact-SHA SOURCE QA.
Date: 2026-10-16. Status: WORKING_DRAFT — NOT ACCEPTED; source only.
Prior independent QA supplied: `{}`. No independent result is claimed.

## Assignment and base

Bounded follow-up to accepted source #47, after admitted #52/#54, under the supplied
GOBADMINTON_AUTONOMY_V1 assignment (DEV, source_only, original max_attempts=3).
Durable defect/scope:
https://github.com/anpavel84-afk/gobadminton-clean/pull/55#issuecomment-6215993087
Actual clean starting branch: `automation/issue-57`.
Exact base: `550c7c72ba4bfefcbb432d08187866ae5003fb21`.
https://github.com/anpavel84-afk/gobadminton-clean/tree/550c7c72ba4bfefcbb432d08187866ae5003fb21
Local history contains #52 (`386de49`, `1d05117`) and #54 (`da4732e`, base).
Live DEV freshness was not independently verified; no fetch or claim of live state.
The authorized executor must establish actual current DEV at claim and preserve newer
product commits before publishing this candidate. Candidate SHA/permalinks pending:
commit, push and git metadata changes are expressly forbidden in this source session.
This handoff is prepared for authorized durable GitHub publication with the patch.

Only allowed writes: `apps/web/test/**`, `docs/handoffs/**`. No product source,
UI/API/business/privacy/security changes, automation, new executor/queue, services,
secrets, accounts/DB/session/provider principals, network downloads/deployment or PROD.

## Source change

Artifact: `apps/web/test/game-cover-create.browser.mjs`.
The reported historical line-113 failure came from an alt-text query matching both
the intentionally hidden retained editor and the separate publication preview img.
The test now scopes the editor image to its accessible named photo region and uses
the unique accessible image role for publication preview, asserting count and
visibility without positional disambiguation. It captures the confirmed editor
object URL BEFORE leaving editing, then compares the restored editor to that URL.
It does not equate the independent legitimate editor/preview object URLs.

Adds explicit initial confirmation gating/status, preview photo presence/absence,
restored editor uniqueness/visibility, reconfirmed crop values/status/readiness and
second-preview removal/reconfirmation assertions. Existing crop restoration,
cancel-during-decode/late completion, moderation rejection, lost create/upload/publish
receipts, double-click fence, exact mutation event arrays, CSRF/version/idempotency
checks, no copied cover in draft payload and final cover inheritance checks remain.
All ten scenarios remain at 360/1440 (20 cases); no scenario skipped or dropped.
Loopback-only synthetic API routing remains unchanged; no real API proxy is added.
Management runner and runtime/dependency adapters are unchanged.

## STYLE_GUIDE_PARITY

No visual/composition or product source change. Existing Forms/media and preview
composition, canonical Guide gaps and Owner override state remain unchanged.
Binding rule read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
No new visual pattern or override is proposed; no external parity inspection claimed.

## Evidence, history and pending gates

No self-QA was authorized: no syntax/lint/unit/build/browser checks were executed,
no service was started, no PASS or raw execution logs are claimed. Source inspection
and editing are not independent QA. No original-source hash evidence was generated.

Preserve supplied historical facts: Supervisor management-browser execution PASS
(local mocked API); create runner actual FAIL against deployed
`4d72cc269aabe77f508310d48745c98584244324`; authenticated live UAT blocked by HTTP 401.
Those remain history and are not superseded by this unexecuted patch. Root ACCEPTED
is deployment-only. Real live login/venue-manager propagation remains NOT_TESTED
until legitimate sessions exist. No product DONE or Owner acceptance is asserted.

Next bounded action: existing authorized executor publishes the candidate and this
handoff, obtains NEW independent exact-SHA SOURCE QA and full hosted CI. Preserve
the original three-attempt cap; no counter reset or invented attempt history.
Then use only the original existing DEV backup/immutable-images/smoke/receiver path
and real root ACCEPTED exactSHA/noPending, preserving newer product commits.
Actual Supervisor execution must complete BOTH management and create/cancellation
scripts against exact candidate compiled assets, including all 20 create cases,
original source hashes before/after and raw logs. Any dependency/executable-path
adapter must be documented and leave assertions unchanged. Local mocked API evidence
must be labelled synthetic, separate from authenticated live UAT; no live mutations
or fabricated acceptance. These gates are pending, outside this author's authority.

Rollback before publication: discard only this task's test/handoff edits. After
publication: guarded revert of the exact candidate patch, preserving #52/#54 and
newer commits. No runtime rollback is performed here.
