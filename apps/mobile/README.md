# #522 CURRENT · address3 source maintenance

Supplied actual address2 base: `b2af9342288449261b09d5d74993f78a70c3a451`.
Address1 `e5a7ca9784a658a99a0c6302a5288b4d0619d8b7` fixed same-owner UNKNOWN
quarantine while retaining the immutable command key/body. Type-only address2
`b2af9342288449261b09d5d74993f78a70c3a451` has actual mobile TSC and exact-file
lint **PASS**, per supplied receipt
`ba3d544f636e5089f019af96fcd03e4bf931324f86d702ab19b135401d32cf65`.
Retained evidence: **103/103 mobile units**, **2 Expo exports** (Android/iOS),
**4/4 management DB cases** and **2/2 Players DB cases**; not rerun by this author.

Positive native coverage for the selected **8** operations is retained, including
authorized private roster/confirm in the actual management cases. This static
legacy regression maintenance moves only two old negative sentinels to remaining
cookie-only neighbors: GET `/v1/me/discovery-preference` keeps **401** and POST
`/v1/games/:id/cancel` keeps **403**, bearer owner and `{ expectedVersion: 1 }`.
This avoids premature positive-confirm mutation before the unchanged browser
confirm, withdraw, capacity and version assertions. No earlier legacy runtime
failure is claimed; fresh legacy-fixture lint/DB verification remains for Root.

Independent whole-source QA (original B through address3, all four normal source
attempts), Product/security CI, build/APK4 and a new DEV release remain **NOT_DONE**;
delivery is **PARTIAL**, Owner UAT **FAIL_RECHECK_PENDING**, native visual
**NOT_VERIFIED**, full native parity **MANDATORY_NOT_COMPLETE**. Earlier FAIL,
UNKNOWN and attempt history remains preserved. Native 0.1.0/code4, API 0.44.0,
schema72, owned5208 and the existing enabled native registry remain unchanged.

## HISTORICAL original a366 source text — preserved verbatim below

The old **Known CI blocker** and check/status statements below describe original
`a366` source history; the CURRENT prefix above records subsequent evidence and
this repair. They are not current blocker or release claims.

---

# #522 native create/publish and game management · source candidate on accepted alpha.88

Bounded source work in the private export only, admitted base
`d8dcb45607fa99c79ec983c511fc569cc5897449`. This export has no accessible Git history;
base/strict release/APK3 evidence is supplied by Root, not locally reverified.
Android source versionCode **4**, versionName **0.1.0**, same package. No binary,
signing/certificate validation, registry, runtime configuration, OTA, deployment or
new application release receipt is claimed. Existing code3/APK3/alpha.88 history below
is frozen; Owner S23 UAT **FAIL_RECHECK_PENDING**, native visual **NOT_VERIFIED**.

`/games/create` uses authoritative OwnSocialProfile city/trainer context, game
preferences (including initial version 0), the manually selected city and paginated
canonical public venues with each selected venue's timezone. Missing profile/city
requires profile setup; native profile editing remains a mandatory follow-up, with
no invented profile write or inert setup CTA. Trainer data is read only when the own
profile says trainer; legitimate absent/inactive trainer permits ordinary games.
Strict calendar/DST/duration/future helpers are copied from accepted WEB without
web/DOM/server imports. External reservation is the accepted literal 0. The form
uses accepted format, visibility, NTRP range, contact and settlement labels.

Preview → explicit **Опубликовать** owns the normal draft-create → publish chain.
The separate root GameManagement owner keeps immutable keys/bodies and canonical
IDs/versions across navigation and UNKNOWN. Only explicit same-packet reconciliation
retries an uncertain command; reconciliation never auto-publishes. Same-owner auth
return retains only a known canonical game reference, clears form/contact/private
DTOs, and requires fresh reads and explicit publication. Logout removes the reference;
account/generation fences discard late responses. No new disk schema or auth-envelope
migration. Existing Messages/Participation owners and their UNKNOWN packets remain
independent. A published receipt allows an explicit new-game action.

`/games/manage/:id`, reachable from My Games, checks actual paginated `/me/games`
authority for creator owners or delegated noncreator managers before authorized
game/roster reads. Participant pagination, loading/empty/error, draft publication and
explicit confirm/reject/remove use current versions, reasons, rights and counts.
Revoked access removes private game/roster projections. Capacity editing/cancel are
unavailable, matching accepted WEB. Existing four-tab chrome and root owners remain.

Exactly **8** existing operations gain NativeBearer security and principal guards;
API remains **0.44.0**, 72 migrations unchanged. Browser Origin/CSRF, services, global
auth, default flags, locks and idempotency stay unchanged. Only the old Players closed
neighbor URL moves to `/me/discovery-preference`, retaining its exact 401 assertion.
All eight supplied operation preimage hashes match when only the security additions
are removed (game-preferences previously had explicit cookie-only security).

New `native-game-management.foundation.test.ts` owns a random
`native_game_management_*` loopback database through dedicated
`NATIVE_GAME_MANAGEMENT_TEST_DATABASE_URL` ending in `/postgres`, self-migrates and
gracefully drops only its owned DB. It uses synthetic OAuth/moderation and a distinct
synthetic fingerprint secret. The existing db-ci per-suite environment case passes
that variable only to this fixture and unsets it for every other fixture, preserving
the existing Messages case, reports and no-skips gates.

Author checks: earlier full mobile unit run **95/95 PASS**; after related repairs the
named game-management/auth/native-contract suites **36/36 PASS** (10 new management,
18 auth, 8 contract). Existing unchanged checks are reused. TypeScript strip-parser
checks passed for the new coordinator/DB fixture and changed auth/API clients; an
initial direct Node --check on the API CommonJS fixture could not parse its valid TS
inline type import and was replaced with the explicit TypeScript parser. This is
syntax checking, not typechecking. Contract structural rules: **276 operations PASS**;
Game/Friendship/Unified generated types unchanged; Admin protocol **56 operations
PASS**; `bash -n scripts/chatops/db-ci.sh` PASS. Author checks are not independent QA.

**Known CI blocker outside this allowlist:**
`apps/api/test/integration/native-participation.foundation.test.ts:104–105` still
expects native manager roster GET 401 and confirm POST 403 for an actual owner.
Those routes now intentionally opt in; their proper outcomes are authorized reads
and confirm. The file is not authorized for this pass and remains untouched.
Trusted Root must admit the exact stale-expectation repair before a full db-ci PASS
can be claimed. No production guard/test gate was weakened to satisfy old assertions.

**NOT_TESTED:** real DB fixture, API/contracts/mobile typecheck, changed-file lint,
Swagger validator, Expo Android/iOS exports, independent QA, Product/security CI,
DEV acceptance/smoke, device/auth lifecycle and visual QA. No dependencies are present
in this export; no install, download, Corepack resolution or provider call was made.
Full native parity remains **MANDATORY_NOT_COMPLETE**, with mandatory future work:
new venue creation and optional candidate photo; game cover/media/private court
booking; invitation create/revoke and contact initiation; full postgame/maps/Radar;
UGC/social preferences/moderation; signed OTA; iOS, physical device and App Links
acceptance. No stubs/inert controls or full-native/DONE claim.

Prior source, release, FAIL/rollback, UNKNOWN and paid-attempt history follows unchanged.

---

# #522 native Messages source candidate on accepted alpha.87

Source routes: `/messages`, `/messages/direct/:id`, `/messages/game/:id`,
`/messages/invitations/:id`. All four existing inbox kinds open native screens;
all/unread/attention, pagination/refresh, direct request decisions, text send,
older/catchup history, game members and invitation decisions use closed bearer APIs.
Main navigation follows the accepted WEB white bar, soft lime icon circle and
30×3 lime underline. Root Messages state keeps immutable UNKNOWN packets and drafts
across tab changes without resetting the existing participation owner. Retry is
explicit and reuses the exact packet; logout/access loss clears private state.
Focused foreground DM catches up every 3 seconds; game chats and inbox/counts refresh
every 15 seconds. Polling pauses on blur, background and any unresolved Messages
packet, retains loaded thread history/cursors, and never sends or retries commands.
Read mutations require incoming RN-viewable rows, focus, foreground and near-bottom.

Exactly 17 existing operations opt into native principals. Cookie Origin/CSRF,
Idempotency-Key, existing mutation services/locks and neighboring cookie-only routes
remain. GET invitation adds recipient-only pending acceptance context, including
current gameVersion and actual terms, without granting public/unlisted game access.
API stays 0.44.0; native versionName 0.1.0 / Android versionCode 3. No registry,
activation, signing, deployment, provider, dependency or migration change.

Author selfcheck: **77/77 mobile units PASS** (68 retained + 9 Messages/auth tests),
using `node --experimental-strip-types --test --test-isolation=none
apps/mobile/test/*.test.ts`. Author tests are not independent QA. The isolated DB
suite requires `RUN_DB_INTEGRATION=1` and a dedicated loopback admin
`NATIVE_MESSAGES_TEST_DATABASE_URL` ending in `/postgres`; it creates, self-migrates
and drops only a random `native_messages_*` database. It uses fake OAuth/moderation,
HTTP PKCE/session issuance and real service guards. **DB, typecheck, lint, contract
validator, Android/iOS bundles, device/auth smoke and runtime visual: NOT_TESTED**
in this dependency-free export. Root must run the owning gates and independent QA.
The contract-only Foundation rules found no errors across 276 operations; existing
Friendship/Game/Unified generated types verified unchanged; existing Admin protocol check passed (56 operations). Full Foundation static
check returned **FAIL** solely for omitted `AGENTS.md` files/references in this export;
no gate or missing source was reconstructed. No Git metadata is exposed here; canonical admission/alpha.87 acceptance are supplied
Root evidence, not locally reverified or replaced by a new release claim.

Source only. Full native parity remains MANDATORY_NOT_COMPLETE; new contact,
invitation create/revoke, hide/report/block/preferences/social-matched UI and the
remaining accepted WEB surfaces remain mandatory later slices. Existing DEV native
registry stays enabled; no activation replay. Owner Samsung S23 FAIL_RECHECK_PENDING,
native visual NOT_VERIFIED, prior FAIL/timeouts/UNKNOWN/cost evidence and all earlier
source/release history below remain unchanged. No phone PASS, fullnative or DONE claim.

---

## Current bounded #522 source on alpha.86 (2026-11-14)

Adds real native Игры → Игроки → Мои игры navigation, with Profile in the header;
`/players` and `/players/:publicPlayerId` use the current public projection, city/name/
looking/trainer filters, cursor pages, read retry and unavailable states. Auth and
participation owners remain above the Stack; authenticated icon entry waits for both
storage owners and skips intro. Only the two Players GETs gain native principal opt-in.
Android source `versionCode` is 2 (`versionName` remains 0.1.0); this is separate from
server alpha.86. No APK was patched, built or published here.

Author deterministic checks: 57 cases across the eight affected/related pure suites
passed using Node 24 directly (including preserved UNKNOWN/participation fences). Typecheck/lint/DB integration/Expo export/build/device visual:
NOT_TESTED (no dependencies in this private export). A typecheck invocation reached
Corepack's missing-pnpm download and failed DNS; no package was installed and no
retry was made. The new isolated DB suite self-migrates its fresh disposable CI DB.
Independent QA/CI/DEV acceptance remain the trusted parent's work. Samsung S23 Owner
UAT remains FAIL_RECHECK_PENDING; native rendering NOT_VERIFIED. Full parity remains
MANDATORY_NOT_COMPLETE: Messages, Players private actions, full MyGames management,
invites/recommendations/postgame, maps/Radar, UGC/updates and iOS remain mandatory.

Earlier passes and their historical status/evidence follow unchanged.

# #522 bounded Games → explicit application → My Games source candidate

This pass adds only native participation request, own pending/confirmed withdrawal,
all-page own participation reads and managed-game reads. Four existing API controller
operations opt into verified native principals; manager/applicant-list routes keep
cookie-only authority and browser mutations keep Origin/CSRF. Public catalog/detail
requests remain credential-free. Existing auth protocol, services, MutationRunner,
registry, flag defaults, migrations, dependencies, assets and release files are unchanged.

- Game detail rereads current public conditions and every own participation cursor page.
  Login returns to the same game without POST. A separate review and explicit confirmation
  sends expectedGameVersion and a random idempotency key. Pending does not reserve a place.
  Own pending/confirmed withdrawal reviews the action and sends expectedVersion.
- Root-owned participation state survives route unmount/navigation. Sending/UNKNOWN holds
  one frozen actor/session/game/participation/body/key packet; reads cannot replay it or
  create a new key. No unresolved retry is offered. Rereads may reveal pending/confirmed
  request or withdrawn result; otherwise the packet remains honestly unresolved and blocked.
  Unsent review intent stays with its game. Logout, account switch and authority loss clear
  private rows/commands; stale reads and callbacks cannot restore them. This route-state
  memory is not a durable offline command journal or a claim of process-kill recovery.
- `/my-games`, reachable in the existing product header, combines owner/manager projection
  from `/me/games` with applications, deduped by gameId. Real filters cover all, managed,
  applications, pending and confirmed. Existing native cards render actual available data;
  unavailable public details remain unavailable, including private/unlisted detail reads.
  Partial/failed cursor sources remain explicit and never become an empty list. Managed
  cards are read-only; organizer.id does not grant management. No fake management or chat.

Author selfchecks: `node --experimental-strip-types --test --test-isolation=none
apps/mobile/test/*.test.ts` — **47/47 PASS**, including 10 targeted participation tests
and all retained assertions. A focused initial run found incorrect 401 error classification;
it was corrected and the focused/full units passed. Final related auth/participation
rerun after session-fence hardening: **21/21 PASS**. OpenAPI JSON/source selfcheck
confirmed exactly four opt-ins, preserved cookie/manager boundaries and unchanged 0.44.0. API integration source uses fake OAuth
and the existing disposable PostGIS pattern; it is **NOT_TESTED** here. No `.git`,
node_modules, tsc or eslint is available in this export. No install/download/Corepack,
real DB/SMTP/DEV/provider/device/network call or baseline reconstruction was performed.
Parent must run actual API integration, contracts/security/Product CI, mobile typecheck,
lint/exports, independent QA, builds, DEV acceptance/smoke and release stage.

**Source only; no alpha86 release receipt.** Accepted server remains supplied
`fd9c4cfa2a14694fc6cf3d1f4d8b3f60c0a8d210` / alpha85 / API0.43; source native auth API0.44
and migration72 remain undeployed/disabled. Default native flag0; PROD unavailable.
Samsung S23 Owner FAIL / recheck pending and native visual NOT_VERIFIED remain.
Mandatory full Android-first/iOS parity is unfinished: management/create, invitations,
recommendations, postgame, Players/Messages, full discovery/date/filters/map, profile
editing/link/reauth, venues/Radar and other accepted surfaces still require later ports.
Actual Android/iOS binary, verified associations/provider lifecycle, store/OTA proof,
independent QA/CI and Owner device/UAT are not established by these unit tests.

All prior attempts, timeout/QA lineage and limitations are retained below as history.

---

# GoBadminton native #522 · current auth/profile SOURCE ONLY · 2026-11-14

This bounded candidate adds one persistent root AuthProvider/session coordinator,
system-browser PKCE sign-in source, real NativeMe/profile and owned-session lifecycle,
exact HTTPS callback handling and Android association source. It uses qualified backend
`05602db92f3c864d263218992d10963f2650d31b`; supplied Root focused security PASS closes the
two retained backend whole FAIL findings without deleting their history. **Not deployed,
not independently reviewed, not full product parity.** Native flag remains default0,
registry/live auth/PROD are unavailable. **Samsung S23 Owner FAIL remains; native visual
NOT_VERIFIED; full Android-first/iOS native parity MANDATORY_NOT_COMPLETE.**

Current working source destinations: optional intro, manual city, real upcoming public
games with pagination/errors/retry, direct public game conditions and `/profile`.
One canonical SVG replaces the separate product wordmark; E lockup remains intro only.
Header provides city/profile access and contextual Back. Card source now has overlay
activity badge when genuine media exists, actual available/total seats, Trainer before
Organizer, accepted arrow and user-initiated RN Share of the canonical public game URL.
Share cancellation/failure is honest; manual selectable URL fallback contains no current
queries. No fake photos, reputation, counts, application action or inert root tabs.

The coordinator stores refresh and version1 pending PKCE in SecureStore
`gobadminton.mobile.auth.v1`, never AsyncStorage; access remains in memory. Legacy city/
story preferences are unchanged. Unknown secure versions are preserved and fail closed.
There is no disk Me cache. Identity/session rows are exposed only for the exact verified
secure actor/session after durable refresh commit. Hydration has an allocated placeholder.
Refresh is singleflight; durable one-use consumption before dispatch means lost response,
process death or commit failure requires fresh sign-in. Generation fences cover callbacks,
rotation, private reads and serialized secure writes. Logout clears private memory at once,
queues secure clear and attempts one bounded remote revoke; remote/storage failure is
explicitly unconfirmed, with no persisted credential retry queue.

Sign-in requests truthful GET `/auth/methods`, then native `/transactions`; native default-off
returns unavailable and keeps the game intent. Only the exact Root-reviewed HTTPS tuple
`gobadminton-native-dev` / `https://dev.gobadminton.ru/auth/native/callback` is accepted.
Crypto is expo-crypto random32 + S256; callback checks unique code/state, expiry and pending
generation, and duplicate Linking/WebBrowser delivery exchanges once. Router native-intent
consumes callback before navigation; sanitized callback screen never reads credentials.
Native never calls browser bind/complete/cancel, sets Origin, adds cookies or bypasses guards.
Login returns to the SAME canonical game and rereads public conditions; zero auto-join/
apply/create. Current bearer operations are ONLY `/me` and owned sessions list/revoke/
revoke-others. Profile shows actual id-derived identity displayName/locale/linkedProviders
and session lifecycle, with no invented email/photo/edit capability.

Android exact-path autoVerify + source assetlinks use package `ru.gobadminton.mobile.dev`
and ONLY owned public SHA256
`5208faba0b474c6c94e4c237cbc345a10c7d3d0f5b3eb285ac8e271f9bd8c051`.
This is not live association/registry/signing/device verification. iOS Team/AASA is absent:
no fake entitlement or custom-scheme auth fallback; verified iOS callback runtime is HOLD.
The web callback fallback does not read/render/log raw URL/code and removes its query.
No credentials, providers, SMTP, live writes, browser/device actions or package downloads
were used by this author. The private export has no .git or dependencies; no source SHA,
commit, lock resolution, release, merge or DEV acceptance is claimed.

Dependency manifest only: Crypto ~58.0.8, SecureStore ~58.0.3, WebBrowser ~58.0.8; installed
baseline Linking58.0.17/Expo58.0.25/RN0.88.1/React19.3.0/Router58.0.31 retained. These new
ranges are supplied installed SDK compatibility, not exact resolved patches. Trusted
parent generates the lock and verifies binary integration. `@gobadminton/contracts/native-auth`
is a pure type-only subpath with typesVersions; root node:fs never enters mobile.
No expo-updates dependency/config/remote config/OTA implementation in this auth slice.
The mandatory next standard signed-update foundation, backward compatibility, four eventual
roots and scenario table are reconciled in `docs/platforms/IOS_ANDROID.md` and
`docs/integrations/AUTH.md`, retaining historical text. Owned service/account/trust readiness
is UNKNOWN; default disabled, embedded last-working fallback, next-natural-cold-launch-only
policy, no hot auth/form replacement. Owner same-binary signed OTA A→B proof is **NOT_DONE**.

## Current author checks and remaining gates

- PASS: Node24.21.0 dependency-free units, **37 named tests (26 retained + 11 new), 0 failures**:
  `node --experimental-strip-types --test --test-isolation=none apps/mobile/test/*.test.ts`.
  New tests cover RFC S256, exact/duplicate/expired callback, actual NativeMe wire fields,
  storage version/restart, singleflight rotation, lost exchange/refresh response, stale actor/
  logout/private completion, secure write ordering/failure and same-game return with zero mutation.
- PASS: direct deterministic JSON assertions for exact Android callback/package/owned certificate,
  absent fake iOS association, SDK58 manifest ranges, pure contracts export/typesVersions,
  and no expo-updates implementation. This is source consistency, not association/device proof.
- Initial new-test execution FAIL: Node strip-only rejected a TypeScript parameter property.
  Replaced it with an ordinary typed field; subsequent focused and full named tests PASS.
  This failed author attempt remains recorded; it was not a provider/model call or independent QA.
- NOT_TESTED: typecheck, lint, Expo Android/iOS exports, native builds, existing backend/security
  runtime suites, Product/security CI, DEV smoke and real auth lifecycle. No node_modules,
  tsc or eslint is installed here; installation/download/lock/SDK actions are forbidden.
- NOT_DONE: independent QA, CI, trusted generated lock, verified Android registration/sign-in/
  restart/logout, actual device visual/UAT. No ready/active/release claim follows unit PASS.

Mandatory concrete product gaps: working Players/My Games/Messages roots; game applications,
withdraw/organizer/create, full discovery date/filters/map; explicit bearer ports for each
private operation; profile edits/reauth/link/email/avatar; venues/maps/Radar; UGC/results and
remaining accepted consumer behavior. Card avatar and real role-reputation/history disclosure
are not ported; no invented replacement controls were added. Full card/disclosure/layout parity
and Samsung S23 recheck remain required. iOS Team/AASA/signing/macOS readiness, store compliance
and actual signed OTA service/A→B proof are external holds, not waived requirements.

Exact changed paths for this bounded client pass (22; no lock/backend/CI/OPS/old asset edits):

```text
apps/mobile/package.json
apps/mobile/app.json
apps/mobile/README.md
apps/mobile/app/_layout.tsx
apps/mobile/app/+native-intent.tsx
apps/mobile/app/auth/native/callback.tsx
apps/mobile/app/profile.tsx
apps/mobile/app/games/[id].tsx
apps/mobile/src/native-auth-protocol.ts
apps/mobile/src/native-api.ts
apps/mobile/src/auth-coordinator.ts
apps/mobile/src/auth-runtime.ts
apps/mobile/src/auth.tsx
apps/mobile/src/components/ui.tsx
apps/mobile/src/components/game-card.tsx
apps/mobile/src/components/discovery-icon.tsx
apps/mobile/test/auth.test.ts
packages/contracts/package.json
apps/web/public/.well-known/assetlinks.json
apps/web/src/app/auth/native/callback/page.tsx
docs/platforms/IOS_ANDROID.md
docs/integrations/AUTH.md
```

Repository instruction lookup found no root or scoped AGENTS.md in this private export.
Web fallback follows the supplied hash-pinned installed Next page guide; no unavailable
original worktree, baseline reconstruction, secret or live runtime was accessed.

## Historical source/QA/harness lineage (preserved below)

# GoBadminton native M1 · #522 · E «Траектория»

React Native + managed Expo Router foundation on accepted alpha84
`8bf111018170ae6200bbb56fa24ff2af9dc61c4a`. This source candidate implements
optional stories → manual city → public DEV games → public game conditions.
It is not a release receipt, independent QA result or device acceptance.

- Entry `/`: restores only story completion and selected city ID from AsyncStorage.
  Skip and Continue Guest immediately finish stories. Returning entry bypasses them.
- `/city`: actual GET city catalog, manual search and all available cities. Missing,
  removed and unsupported cities never select Moscow or request an unfiltered feed.
- `/games`: upcoming public city feed with explicit cursor pagination, retry and
  honest empty states. Every request sends the supported `startsFrom` lower bound;
  strict `startsAt > now` is reapplied on receipt, page merge and cached display.
  A local expiry timer and native foreground event remove games as they start,
  without polling the API. Empty loaded pages retain the server's next cursor.
  City selection remains reachable during every request state. Stale city,
  pagination and detail responses are fenced by request generation, even if abort
  is ignored by transport. Back from details preserves the mounted feed and city.
- `/games/[id]`: direct route without onboarding/city gating. Server 404/410, null
  or absent response becomes unavailable. Conditions show actual server values,
  including capacity, reservations, levels, trainer fees, deadlines and timezone.
  Formats use accepted discovery labels; levels use exact NTRP v1 half-steps or
  gb-social-pilot v1 labels. Unknown formats are omitted; unknown levels ask the
  organizer, without exposing internal IDs or guessing another scale/version.
  Trainer names use the simple «Тренер» label. Direct details may truthfully show
  completed games; the upcoming filter applies only to the catalog.
  No fabricated ratings, players, availability or results. Joining is explicitly
  unavailable; no authentication or mutation requests exist.

Only `https://dev.gobadminton.ru/v1` is configured. The adapter exposes GET `/meta`,
`/cities`, `/games?cityId=…&limit=20&startsFrom=…&cursor=…`, `/games/:id`; screens use the latter
three. Requests omit cookies and have no auth/Origin/CSRF headers. Meta is available
for trusted diagnostics; the UI does not block on it. No production endpoint,
location/Radar, provider login, private API, push, maps, media upload or store flow.
The development URL scheme provides route entry; HTTPS app/universal links are
**not verified or claimed**. DEV bundle/package identifiers are development-only.

E uses approved purple `#7945DE`, lime `#A7F447`, pure black `#000000` on every
primary label, including disabled with opacity 1. Approved assets are unchanged;
SHA-256 values are recorded in `assets/provenance.json`. `brand-mark.ts` is the
lossless XML string of `go-badminton.svg` for `react-native-svg`'s `SvgXml`, not a new
mark. The lockup has one accessibility label and Onest 700/500 text. Native launch
shell uses only the existing sign. The OS splash has a plain white background
(no advertising or timed wait); no replacement app icon has been drawn.

M1 targets phones only (`ios.supportsTablet: false`); no iPad layout is introduced.
Native safe areas, wrapping scalable text, scrolling below the bottom inset,
48-point minimum secondary targets and 52-point primary targets are used.
City entry supports the keyboard (iOS avoidance / Android resize). Artwork,
orbits and loading placeholders are static; Reduce Motion is read and subscribed
to. Actual Dynamic Type, font weight rendering, assistive readers, keyboard,
edge-to-edge, hardware Back and artwork decoding require native device checks.

## Dependency and validation handoff

The author is prohibited from network access and dependency installation. No
lockfile was manually edited. Trusted parent must resolve the exact manifest
pins and generate `pnpm-lock.yaml`, preserving app source hashes and recording a
receipt before frozen-lockfile CI can run. Mobile pins React/ReactDOM 19.3.0,
React Native 0.88.1, React Native Web 0.21.4 and React/ReactDOM types 19.3.0 for
the supplied SDK 58 peer requirements. Web/admin manifests remain unchanged at
React 19.1.1; this manifest edit does not prove the regenerated peer graph.
No global
hoisting or custom Metro configuration is introduced; use Expo's default monorepo
support. Node 24.21.0 is required (installed author binary:
`/home/agentagency-dev/.local/node-v24.21.0/bin/node`).

After trusted resolution, from repo root:

```sh
pnpm --filter @gobadminton/mobile run typecheck
pnpm --filter @gobadminton/mobile run lint
pnpm --filter @gobadminton/mobile run test:unit
pnpm --filter @gobadminton/mobile run export:check
```

Dependency-free author tests can run directly with Node 24:

```sh
node --experimental-strip-types --test apps/mobile/test/*.test.ts
python3 -B scripts/chatops/tests/test_ci_workflow.py
```

Address1 author check in this private export: Node 24.21.0 with
`node --experimental-strip-types --test --test-isolation=none apps/mobile/test/*.test.ts`
reports **20 tests, 20 pass, 0 fail** (the original 15 plus five focused regressions).
The ordinary isolated invocation here reports only six passing file subtests;
the nonisolated invocation above verifies the actual named assertions. New cases
cover accepted labels and unsupported identities, strict expiry, delayed server
responses, cached/page expiry with cursor retention, deduplication and city races.
This is author verification, not independent QA or native rendering evidence.

Historical lineage is retained: first source `d42ae139a74844f965d9839f6ef244ab72d84a28`
→ trusted generated-lock child/base `e5ef4a25656e170f237ef64d38aad97d947a2ad6`.
The supplied parent evidence records 15 units and both native Expo exports passing,
but typecheck and lint **FAIL**. Address1 repairs the Node `URL` type identity and
uses two justified line-local lint exceptions for Metro's literal native asset
requires. Historical lock-guard failure, peer-graph adoption and parent FAIL remain
history; historical passes are not current post-repair passes. No source QA has
been performed. Accepted server84 remains the supplied `8bf1110…` baseline.

Unit tests exercise public request URLs/credentials, unavailable/empty/network
retry, story/returning entry, unsupported cities, stale city/pagination responses,
and server condition presentation. Source/style checks cover native font/assets,
primary colors, scaling, safe area and Reduce Motion wiring; they do not claim
rendered/device accessibility proof. The Product CI mobile checks execute inside
existing `source (web)`; the other matrix entries and seven Product CI jobs remain.

`export:check` exports Android and iOS JS/assets only. It proves neither an APK nor
an iOS binary. Native `expo run:android` / `expo run:ios` scripts are for the trusted
parent build archive. Do not commit generated android/ios/dist trees.

| Stage | Author handoff status |
|---|---|
| SOURCE | IMPLEMENTED_CANDIDATE; independent QA/CI pending; not SOURCE_READY |
| Address1 author units | PASS: 20 named tests using Node `--test-isolation=none`; original 15 retained |
| Owning CI workflow definitions | PASS: 4 existing `test_ci_workflow.py` tests; not a Product CI execution |
| typecheck / lint / Expo export | NOT_TESTED: dependencies absent; installation forbidden in author |
| ANDROIDBUILD | NOT_BUILT; trusted Node/dependencies, JDK and Android SDK/build tools needed |
| IOSBUILD | NOT_BUILT; external macOS/Xcode/signing access unverified |
| DEVICE / Owner UAT | NOT_TESTED |
| STORE | NOT_READY; outside M1 |

No install, native build, push, merge, deploy, DEV acceptance or release-history
update was performed by this author. API target 0.43.0 is the supplied probe fact,
not a live API check performed here. The existing issue remains open.

Address1 changed files (all relative to `apps/mobile/`): `package.json`, `app.json`,
`app/_layout.tsx`, `app/games/index.tsx`, `app/games/[id].tsx`,
`src/components/ui.tsx`, `src/hooks.ts`, `src/public-api.ts`, `src/presentation.ts`,
`src/upcoming.ts`, `test/native-contract.test.ts`, `test/public-api.test.ts`,
`test/presentation.test.ts`, `test/upcoming.test.ts`, and this README. The private
export has no `.git`; no new commit SHA or branch verification is claimed.

## #522 bounded compact correction · 2026-11-14

The Owner rejected M1 product scope and compact rendering on Samsung S23.
Historical compiler/QA/CI/APK/server evidence above remains historical technical
evidence; it is **not full native product acceptance**. This source repair follows
the fully read Root compact specification
`ab7f3dd8d50c216afaf1b65ed36317f8d7f203939b51cf3e8d899c0809baa529`.
The exact S23 logical viewport, font scale, density and navigation mode are unknown.

E is now **intro only**. Its approved assets, wordmark, purple surface and black
labels on green primary buttons remain. Skip shares the persistent brand header;
three progress marks, centered two-part title/lime emphasis and grouped actions
replace the separate nine-child composition. Artwork consumes the space left
by the measured text and actions below the measured header, with logical window
width/height/fontScale and all four safe edges. Decoration may disappear on short
windows; enlarged text and actions retain natural sizing and scroll in the purple
surface. This sizing policy is not a rendered fit/device PASS.

Existing guest screens use accepted mobile-web hierarchy and tokens directly
read from these owning references (read-only):

- `apps/web/src/components/consumer/{ConsumerShell,RootNav,NavIcon,Logo}.tsx`, `nav-items.ts`
  and `styles/{consumer-tokens,foundation,mobile-controls}.css`: white persistent
  header, 16dp product gutters, ink/secondary text, line colors and bordered controls.
- `pages/GamesDiscoveryPage.tsx`, `discovery/{DiscoveryComposition,DiscoveryGameCard}.tsx`
  and `styles/discovery.css`: compact copy without E art, city/current date scope,
  210dp cover when published media exists, date/time/title/venue/terms/host hierarchy.
- `games/GameCover.tsx` and `venues/VenueCover.tsx`: only server-projected
  `/v1/media/game-covers/<64 lowercase hex>.png` and venue equivalents are accepted.
  The detail CTA arrow ports the exact path from `apps/web/public/discovery/arrow.svg`
  through native SVG primitives. Relative paths resolve only against the fixed DEV API origin. No arbitrary remote
  URL, provider image or stock illustration is introduced. Missing media renders no
  fabricated photo; failed images have a real retry, with game-to-venue fallback.

The city input is near the top, below fixed chrome, and selection dismisses the
keyboard. The catalog owns one FlatList with stable IDs, explicit pagination and
existing request/expiry fences; Back keeps the existing mounted feed. Direct
public detail remains independent of entry/city preferences. No private API,
authentication, mutation, fake actions, tabs or new destinations were added.
The “Когда / Все ближайшие” block is a static description of the real query,
not a date-picker control. Full date/filter behavior is still missing parity.

The original **22 named tests remain**, with assertions adapted for persistent
chrome/FlatList and stronger presence checks. Four additional pure regressions
cover compact layout allocation, short/enlarged layouts, the safe media policy
through real DTO parsing, and card date/city presentation. Synthetic group sizes
are function inputs, not recorded native measurements. Source assertions are not
rendering proof. No tests/builds were run in this bounded author pass: the parent
owns execution, and this private export has no node_modules or .git. No installation,
network, SDK/Gradle, provider, GitHub, publication or deployment call was made.

| Current compact handoff | Status |
|---|---|
| Source | BOUNDED_CANDIDATE; independent QA pending |
| 22 existing + 4 added tests | NOT_TESTED by this author; parent execution required |
| Typecheck / lint / Expo exports / native builds | NOT_TESTED; parent execution required |
| Native compact 360×780, 393×~850 at 1.0/1.3/2.0; short landscape | NOT_TESTED |
| Keyboard, Cyrillic font weights, gesture/3-button navigation contrast | NOT_TESTED |
| Samsung S23 visual recheck / Owner product validation | NOT_TESTED / existing FAIL retained |
| Full native parity / #522 | UNFINISHED / OPEN, InProgress |

Next mandatory work remains real four-tab navigation and its destinations, native
auth/profile, Players, My games, Messages, full game filters/date/map/create/share,
join/participation/organizer flows, venues/Radar and accepted UGC behavior, with
existing privacy/role boundaries. Profile is not a fifth bottom tab. This compact
patch cannot establish full parity or close #522. Trusted parent still owns native
captures (with actual logical dimensions, scale, density, safe edges and OS/nav-mode
metadata), independent QA/CI, build/import/commit and any accepted DEV release.

Exact changed paths for this compact source pass (no generated/release files):

```text
apps/mobile/app/+not-found.tsx
apps/mobile/app/city.tsx
apps/mobile/app/games/[id].tsx
apps/mobile/app/games/index.tsx
apps/mobile/app/story.tsx
apps/mobile/src/components/discovery-icon.tsx
apps/mobile/src/components/game-card.tsx
apps/mobile/src/components/ui.tsx
apps/mobile/src/layout.ts
apps/mobile/src/media.ts
apps/mobile/src/presentation.ts
apps/mobile/src/public-api.ts
apps/mobile/src/theme.ts
apps/mobile/test/compact-layout.test.ts
apps/mobile/test/media.test.ts
apps/mobile/test/native-contract.test.ts
apps/mobile/test/presentation.test.ts
apps/mobile/README.md
```
