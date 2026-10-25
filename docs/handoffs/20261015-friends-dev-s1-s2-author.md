# Friends functional DEV S1/S2 — producer handoff

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

- From: agentagency-dev, producer author. To: independent QA / PM for existing Issue #12, parent #5.
- Date: 2026-10-15. Status: READY_FOR_REVIEW source draft; no independent QA acceptance.
- Repository: `anpavel84-afk/gobadminton-clean`; branch `feat/dev-friends-social-20261014`.
- Exact initial HEAD/base: `5a8e77655b096510c1fec647b6d2470d9e75e1ab`.
- DEV predecessor: `3d6731243ec8e2a737fa1ea7353aee06b3219af0`.
- Existing S1 source: PR #20 `f98b1ed`, already ported at initial HEAD; do not rebuild it.
- Source permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/5a8e77655b096510c1fec647b6d2470d9e75e1ab
- Assignment: direct Owner continuation of #12/#5; local [S1](../assignments/20261013/friends-s1-api.md) and [QA](../assignments/20261013/qa-friends-s1-api.md). GitHub issue comments could not be read: gh has no authenticated token; read-only web fetch also failed. Independent reviewer must read exact issue QA evidence before acceptance.

## Reproducible bounded Owner assignment

Deliver minimal genuine Friends S1/S2 on DEV by extending the already implemented S1 API, additive 0032 migration, rollback and generated contract. Preserve server privacy, blocking, contact consent, session/CSRF/idempotency, Yandex auth, avatar moderation and Radar consent. UI entry from public `/players/[publicPlayerId]`: request, outgoing/cancel, incoming accept/decline, accepted/remove with confirmation; no optimistic entitlement. `/friends` has accepted/incoming/outgoing views, canonical avatar/card composition and bounded paging; link from Profile, no new primary navigation or duplicate catalog. Only explicitly admitted production-mode DEV origins may opt in; PROD must fail config validation. Unknown outcomes are never automatically replayed; manual retry retains exact key/body. Invitation work is optional and feature/host constrained.

Owner effect ceiling: edit only this worktree; **leave all files uncommitted**. No commit, push, deployment, live DB/migration writes, PROD/PLAN/VPN access or package installation. Separate producer owns `PlayersDirectoryPage.tsx`, `unified-directory.ts` and Radar tests: these are excluded from this slice. Publication authority in general project rules does not override this explicit no-push instruction. This handoff is prepared for later authorized GitHub publication; there is no new candidate SHA/permalink yet.

## Implementation facts

- Existing S1 controller/service lifecycle and migration SQL retained. Generated contract unchanged; web imports `@gobadminton/contracts/friendship-types`.
- Config `superRefine` rejects `FRIENDS_INTERNAL_ENABLED=1` in production runtime (and always for APP_ENV=prod) unless APP_ENV is `mvp` or `stage`, **both raw origins exactly** `https://dev.gobadminton.ru`, directory enabled and all four policy values explicit and bounded.
- Maximum DEV policies: request TTL 2,592,000 seconds (30 days), rate window 86,400 seconds, send/receive limits 100 each. All must be positive integers. These are admission ceilings, not recommended runtime defaults. Existing local/test admission retains its former requirements; flag off stays off. No env/config runtime files changed.
- `friendsEnabled` independently applies the same DEV origin/environment/limit fences, including when passed an already constructed environment object.
- Existing `unrestrictedSql` privacy checks for account.access/profile.public/social.directory now apply inside Friends on admitted production-mode DEV even with the global restriction/Admin service off. No global Admin/invitations capability is enabled. Existing actor/session transactions and profile/epoch/block fences remain in place.
- Public profile mounts Friends only for an authenticated actor, reads capabilities first, then current relationship. Controls follow server capabilities; exact decimal versions and request/friendship IDs are used. Removal opens the existing native dialog before writing.
- `/friends` uses three view selectors (Friends/Incoming/Outgoing), renders only permitted peer projection, and can remove an accepted relationship whose peer is unavailable without displaying peer identity. API list is bounded to 20; opaque cursor is encoded, each next page replaces the current page rather than accumulating stale identity data. Tab/action refresh returns to the first page. Errors clear old data; cursor errors require refresh.
- Unknown mutation outcomes keep the existing `useSocialMutation` pending lock and sessionStorage identity. Explicit “Проверить отправку” replays the exact saved body/key; nothing automatically replays on mount/reload. 401/409 clear the attempt and trigger a fresh auth/state read before new controls. No author changes to this shared hook.
- Private view registration + session-expiry listeners clear list/profile actions on 401. Late reads are ignored after retirement. Profile component is keyed by actor/CSRF/public player; list handles session changes and clears page/actor. Returning to a visible tab rereads state.
- Optional invitation extension omitted: existing invitations remain feature-gated; this slice grants no seats or invitations and does not turn on the disabled DEV invitations service.

## Exact changed/new paths

Changed:
- `apps/api/src/config/env.ts`
- `apps/api/src/friendships/friendships.policy.ts`
- `apps/api/src/friendships/friendships.service.ts`
- `apps/web/src/components/consumer/pages/ProfilePage.tsx`
- `apps/web/src/components/consumer/pages/PublicPlayerProfilePage.tsx`

New:
- `apps/api/test/unit/friends-dev-admission.test.ts`
- `apps/web/src/app/friends/page.tsx`
- `apps/web/src/components/consumer/pages/FriendsPage.tsx`
- `apps/web/src/components/consumer/friends/FriendActions.tsx`
- `apps/web/src/components/consumer/friends/ProfileFriendship.tsx`
- `apps/web/src/lib/friendships.ts`
- `apps/web/test/friendships.test.tsx`
- `apps/web/test/friends-retry.test.ts`
- `apps/web/test/friends.browser.mjs`
- `docs/handoffs/20261015-friends-dev-s1-s2-author.md`

## STYLE_GUIDE_PARITY

Authority: [Owner Style Guide first](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md); frozen Make `https://nougat-wise-76949869.figma.site/#guide` / `#construction-kit` and hashes from that decision. The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this extraction. The Next guide required by `apps/web/AGENTS.md` under `node_modules/next/dist/docs/` is also absent with the dependencies; the new page uses the existing route/component grammar and must pass the version-bound build in CI. Read-only fetch of Make failed; no PLAN access attempted.

Patterns reused: ConsumerShell with active=players; existing Button variants; Avatar and PlayerCard card grammar from ProfileComposition; ProfileState for loading/error/empty/unavailable; native ProfileDialog for confirmation; profile section and action layout; existing MutationNotice. No new CSS, tokens, navigation items or component family. `/friends` composes the listed canonical card/list, selector, error/empty and modal families; no claimed frozen Friends-specific screen composition is available locally. Existing public and own profile composition is retained with bounded content insertions.

STYLE_GUIDE_GAP: none claimed (no new visual family). OWNER_VISUAL_OVERRIDE: none. **Visual parity UNVERIFIED**: independent QA must compare against frozen Make at mobile/desktop widths; reused code alone is not visual acceptance.

## Author evidence and checks

Executed on this source draft:
- `python3 scripts/check_foundation.py`: exit 0; local Markdown/JSON/reference/contract foundation checks only.
- `node packages/contracts/scripts/generate-friendship-types.mjs`: exit 0; existing types verified, not rewritten.
- `node packages/contracts/scripts/generate-game-types.mjs`: exit 0.
- `node packages/contracts/scripts/generate-unified-types.mjs`: exit 0.
- `node --check apps/web/test/friends.browser.mjs`: exit 0 (syntax only).
- `git diff --check`: exit 0.

NOT RUN locally: Vitest, API/web typecheck/lint/build, full dependency-backed OpenAPI validator, browser suite, disposable PostGIS integration/0032 forward/rollback. No installed node_modules or pre-provisioned Playwright in this worktree; Owner forbids package installation on VPS. Historical 57 independent S1 tests are Owner-reported prior evidence, not re-executed or extended QA acceptance by this author.

Required dependency-equipped checks (CI/QA, no VPS installation):
```
pnpm --filter @gobadminton/api exec vitest run test/unit/friendships.test.ts test/unit/friends-dev-admission.test.ts
pnpm --filter @gobadminton/web exec vitest run test/friendships.test.tsx test/friends-retry.test.ts
pnpm --filter @gobadminton/api typecheck
pnpm --filter @gobadminton/web typecheck
pnpm --filter @gobadminton/api lint
pnpm --filter @gobadminton/web lint
pnpm --filter @gobadminton/contracts check
pnpm --filter @gobadminton/web build
```

New Vitest cases cover exact DEV/stage admission, PROD/wrong/normalized-looking origins rejected, missing/oversized/zero limits, flag-off, global services not enabled, DEV SQL restriction fence, existing eligibility/block/epoch withdrawal invariants, authorized UI controls, hidden peer removal, bigint version integrity, bounded same-host paging, manual same-key retry/reload restoration, no automatic replay and 401/409 denial.

Browser suite uses synthetic intercepted `/v1` only, rejects non-loopback origin, blocks external network, writes no real DB, and does not depend on retired legacy fixtures. With independently provisioned Playwright and an already built loopback Next server:
```
FRIENDS_ORIGIN=http://127.0.0.1:18987 node apps/web/test/friends.browser.mjs
```
Optional FRIENDS_PLAYWRIGHT_PATH selects the already provisioned `playwright/index.mjs`; no installer is invoked. Output defaults to `/tmp/gobadminton-friends-author-checks` (report/screenshots); reviewer must publish actual evidence to a durable QA artifact. Cases cover profile lifecycle + removal confirmation at 390/1440px, unknown outcome/manual retry across reload, 401/409, list selectors/encoded paging/withdraw/session expiry and flag-off. This prepared suite is **NOT_TESTED**, not independent QA.

## DEV migration and admission checklist — no live execution by author

1. Independent QA binds a published exact candidate SHA/tree and verifies #12 and #5 scope. Review full delta from initial HEAD; retain existing S1 QA evidence, then rerun affected suites. Do not infer permission from this draft.
2. Run existing `friends-s1.disposable.test.ts`, `0032_friendship_core.smoke.sql` and `0032_friendship_ledger_guard.focused.sql` on explicitly disposable synthetic PostGIS only, through the approved CI recipe. Verify fresh/upgrade/duplicate/race/session-revoke/block/withdraw/deletion and empty forward/rollback; never substitute a live DATABASE_URL.
3. Separate authorized DEV release verifies target is DEV with its own DB and backup/restore evidence. Keep `FRIENDS_INTERNAL_ENABLED=0` while deploying additive `apps/api/migrations/0032_friendship_core.sql` **only after independent QA**. Source presence does not mean this migration is installed. No SQL changed by this continuation.
4. Verify root-owned DEV configuration and exact origins. Only the authorized config owner may explicitly set FRIENDS_INTERNAL_ENABLED=1 and SOCIAL_DIRECTORY_ENABLED=1 plus reviewed bounded values (example synthetic pilot: TTL=604800, window=3600, send=20, receive=50). This draft is not authority to apply that example. Keep APP_ENV=mvp/stage, NODE_ENV=production. No PROD admission; config flag remains off there.
5. Authorized browser QA uses two provisioned synthetic DEV accounts with active sessions and current explicit directory/contact consents, approved avatars. Obtain public IDs from their own profiles; do not copy real credentials here. Check A→B send; A outgoing/cancel; B incoming/decline; resend/accept; both accepted list; remove confirmation; 401/revoke, block, hide/contact-off, stale versions, duplicate retry and no contacts/precise Radar location leakage.
6. Browser and independent security/privacy QA record results against exact candidate and DEV image provenance in #12, including frozen Style Guide parity. Public/real-user activation still requires its existing separate gates.

## Rollback, risks and next action

Application rollback: authorized release turns Friends flag off first, restores previous reviewed API/web image through existing release path, leaves additive 0032/ledger/history intact. It must not replay unknown browser operations under a new key. Source rollback for this uncommitted patch is selective reversal of the exact paths above; never blanket reset/clean this shared worktree or touch separate producer paths.

Schema rollback: existing `apps/api/migrations/rollback/0032_friendship_core.sql` is only for a verified **unused/empty** installation, with writers stopped and caller-owned BEGIN/COMMIT; it refuses populated tables. Populated ledger/history must be retained, using application rollback instead. This author executed neither direction.

Remaining risks: dependency-equipped compilation/tests and full rendered visual/browser verification pending; issue QA comments inaccessible; shared hook restoration behavior and browser session-race handling require independent exercised evidence; SQL restriction query is mocked in new unit coverage, not a real DB restriction proof. No deployment, migration, config enablement, commit, push or acceptance is claimed.

One next bounded action: independent QA reviews this uncommitted delta after an authorized publisher creates an exact candidate, runs the prescribed suites and publishes the result to existing #12. PM must not unlock DEV config/migration from this author's static checks alone. The local handoff and explicit path list provide continuity without old chat; GitHub durability is still pending under Owner's no-push ceiling.
