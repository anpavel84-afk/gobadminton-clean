# Issue #12 — Wave C Friends → GameInvitation regression/UAT contract

From: source author. To: independent SOURCE QA, then PM/release/UAT.
Date: 2026-10-15. Status: WORKING_DRAFT / UNVERIFIED, not product acceptance.
Base: `96de66bd415473206df98dbbf68872a7cd05f005` (`automation/issue-12`).
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/96de66bd415473206df98dbbf68872a7cd05f005
Assignment: existing https://github.com/anpavel84-afk/gobadminton-clean/issues/12,
Wave C standing Owner reference https://github.com/anpavel84-afk/gobadminton-clean/issues/5#issuecomment-6182091853.
The supplied immutable source-only assignment is the execution authority; linked remote comments were not fetched or independently verified.

## Scope and source findings

Continue integrated S1/S2 after cover-wave; do not recreate Friends or import historical QA as PASS.
Addressed source paths: `apps/api/test/integration/friends-s1.disposable.test.ts` and this handoff only.
Read the canonical rules, project record policy, Owner decisions, manifest, bootstrap,
architecture/module boundaries and ChatOps/onboarding documents.

Source inspection found existing Friends ownership/version/epoch/pair fences and existing
GameInvitation authority/capacity handling. No new runtime defect is claimed or invented.
The missing contribution is an executable regression contract connecting those existing flows.
No application behavior, API contract, feature admission, privacy policy or runtime settings changed.

Added cases use the actual registered Games, Invitations, Inbox and Friends modules and HTTP
commands in the existing strictly guarded disposable PostGIS suite:

- Accepted friend → pending invitation → recipient inbox; no participation or reserved seat.
- Third actor cannot read/accept that invitation and cannot see it in their inbox.
- Accept → confirmed own participation (the My Games input) and accepted Messages inbox status;
  same-key replay yields the same result and exactly one confirmed recipient row.
- Decline/revoke → terminal status, no seat, stale accept denied.
- Two accepted friends submit accepts concurrently for one remaining seat; one succeeds,
  one gets GAME_FULL and retains a pending invitation without participation.
- Ordinary join request remains pending; normal manager confirmation consumes the same last
  seat, preventing invitation acceptance.
- Expiry without worker denies acceptance without removing the independent friendship.

The real creator initial seat is retained (capacity 2, one remaining place). Fixtures use three
fresh synthetic users per case. The suite still validates a local test-only exact database name,
requires an empty application schema before migrations and preserves the append-only Friends
ledger. It first preserves the existing 0031/0032 upgrade/recovery scenarios, then applies later
source migrations so current game projections include cover-wave columns. No historical SQL edited.
Feature flags added here belong only to the in-memory test env object; no env files changed.
Existing deterministic Pair barrier tests remain; the new invitation race submits concurrent
HTTP requests but does not claim observed lock overlap. Existing S1 coverage of block,
visibility/contact/deletion epochs, session revocation and stale versions remains historical
source coverage, not a new successful test result.

## Verification / evidence boundary

NOT_TESTED: all added tests, compilation, lint, full hosted CI, disposable PostGIS execution,
independent source review, authenticated browser UAT, keyboard/mobile/desktop, live DEV and
release smoke. No self-QA commands were run, as explicitly required by this assignment.
No real user/session, database, services, secrets, CI config, VPN, PLAN or PROD touched.
No commits, push, git metadata changes or publication performed. The candidate has no new SHA
or published artifact permalink yet; PM must record those after authorized publication.

Independent QA should run the existing hosted full DB recipe, including this exact integration
file in its freshly created `gobadminton_friends_s1_disposable` PostGIS database with
`NODE_ENV=test` and `RUN_DB_INTEGRATION=1`. Never substitute a live DATABASE_URL. The suite
refuses a nonlocal, wrong-name or nonempty database. External disposable runner owns destruction.
Report exact candidate SHA, full workflow/job links and actual case results; do not turn skipped
integration tests or this document into PASS. Author test additions are not independent QA.

## STYLE_GUIDE_PARITY

No frontend source, styling or composition changes. Existing canonical Player/Profile/Game cards,
Messages invitation/status cards and action patterns remain the UAT targets. Canonical authority:
https://nougat-wise-76949869.figma.site/#guide and #construction-kit, Owner decision
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this extraction.
No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE introduced. Frozen Make visual comparison,
responsive parity and accessibility are NOT_TESTED; no visual parity PASS asserted.

## Authenticated synthetic DEV UAT for the authorized next role

Prerequisites: independently reviewed exact SHA, full successful hosted CI, normal DEV backup /
paired image deployment / smoke and root-owned ACCEPTED exactSHA/digests/noPending. Record
actual live SHA and image digests before UAT. Use only separately authorized synthetic DEV
accounts A (manager), B and C with isolated browser contexts on Germany. This source assignment
does not authorize creating sessions, enabling global social flags or changing privacy settings.
If bounded account admission/credentials are unavailable, report UAT NOT_TESTED with the reason.

1. Search/profile A→B: none → outgoing/incoming request. Verify both actors, refresh, repeat send,
   opposite send, accept/decline/cancel and unfriend; old tabs/versions cannot undo a newer decision.
   Confirm neutral unavailable state for blocked/ineligible peers without disclosing block direction.
2. Exercise the existing friend/profile invitation entry into A's allowed published game. Pending
   invitation appears in B's Messages, not as a confirmed My Games seat. Confirm title/profile/card
   parity against frozen Make at desktop/mobile widths, keyboard focus and dialog dismissal.
3. Accept, decline and revoke on separate invitations; reload both accounts. My Games follows actual
   participation, Messages follows invitation state. Repeat clicks and retry network failures; no
   duplicate effects or optimistic seat. Expiry must work without waiting for a worker.
4. With one place remaining, B/C compete, and separately ordinary join/manager confirmation competes
   with an invitation. Inspect actual server responses and resulting counts; pending is never a hold.
5. Negative matrix: C guesses A/B invitation/contact identifiers; A loses manager authority; bilateral
   block/unblock, mute, closed contact policy, hidden profile, revoked session and deletion epoch.
   Test private-game search/discovery and direct URLs before/after invitation revocation; friendship
   must not grant visibility, contacts, conversation rights or disclose foreign metadata.
6. Return to stale/background tabs, switch accounts, expire session, fail/retry requests and paginate
   lists. Verify loading/error/retry, disabled pending actions and removal of private stale content.

Each row needs actor, initial server state, actions, expected/actual result, timestamp, liveSHA and
redacted evidence. Unexecuted branches, privacy/mute/private-game cross-flow cases and browser
stale state remain NOT_TESTED until observed; this addition does not supply exhaustive UAT coverage.
No second messenger, matching system or chat, no global enablement, no Owner privacy override.

## Continuity / rollback / next action

Next bounded action: independent SOURCE QA of the published candidate plus full hosted CI.
PM publishes this source/handoff through the authorized path, supplies exact commit permalinks,
and later records release and genuine synthetic browser UAT separately. Acceptance requires all
facts in the assignment, not source-only completion. Any defect returns as a bounded correction
(maximum three attempts), otherwise BLOCKED/rollback; no gates may be relaxed.
Rollback for this source-only change: remove the added test helpers/cases/module imports/current-
schema fixture upgrade and this handoff in a reviewed source change. No runtime/schema rollback
is needed or authorized by this artifact. Keep existing tests and immutable ledger protections.
