# Issue #149 · M2R + M2R-G source handoff

From: bounded source author. To: integrator and independent source reviewer.
Date: 2026-10-22. Status: **READY_FOR_REVIEW / UNVERIFIED**.
Author checks are not independent QA, Owner admission, CI success or DEV acceptance.
No next slice is authorized by this handoff.

## Assignment, base and effects

Implement only the Owner-approved #149 map player preview + permitted public-game
projection described by the supplied immutable `GOBADMINTON_AUTONOMY_V1`
source-only task JSON. #151/#157 were supplied as ACCEPTED; #156 DEFERRED is not
a dependency. No new rights, runtime bindings, admission or attempt count are
created here. The task specifies gpt-6.1-sol / high; this record does not attest
runtime identity beyond the supplied execution environment.

Supplied immutable CLEAN base:
[`6fb9b0cbaad3c1989c521d0612d036ddf4342d7c`](https://github.com/anpavel84-afk/gobadminton-clean/commit/6fb9b0cbaad3c1989c521d0612d036ddf4342d7c).
Original source pass's initial supplied checkout: branch `automation/issue-149`, clean working
tree, HEAD
[`869d07b921a48737facf8e53afd71543bf9ff8c1`](https://github.com/anpavel84-afk/gobadminton-clean/commit/869d07b921a48737facf8e53afd71543bf9ff8c1).
These differ. Read-only log shows intervening #156/#158 commits; no history or
prior failed #149 source attempt is inferred. The three core implementation
files (Radar service, Games service, RadarPage) have no committed diff between
supplied base and actual HEAD. Work stayed in the supplied checkout, with no
Git metadata changes, checkout, commit, push or network by the source author.
The C8 repair checkout starts clean on the same branch at the supplied reviewed
candidate
[`7118545cac4a1b9ab7db9ada4f3e0a4185bf6fa5`](https://github.com/anpavel84-afk/gobadminton-clean/commit/7118545cac4a1b9ab7db9ada4f3e0a4185bf6fa5).
The current repair is an **uncommitted patch** on that candidate, so no repaired
candidate commit permalink exists. Integrator must publish its exact revision
and link this handoff to Issue #149 for durable GitHub representation; chat is
not its publication record. The supplied independent review verdict for
7118545 is FAIL on C8; this author repair does not supersede that verdict.

The original slice changes only the fourteen task-allowed paths below. This C8
repair changes only `apps/web/test/radar-player-games.test.tsx` and this handoff;
the existing implementation, API contract and other authored tests are retained.

- `apps/api/src/radar/radar.service.ts`, `apps/api/src/games/games.service.ts`.
- `packages/contracts/openapi.json`, `packages/contracts/src/unified.generated.ts`.
- New `apps/api/test/unit/radar-player-games.test.ts`; existing `apps/api/test/integration/radar.unified.test.ts`.
- `apps/web/src/lib/unified-directory.ts`, `apps/web/src/components/consumer/radar/RadarPage.tsx`, `apps/web/src/components/consumer/radar/UnifiedPlayerPreview.tsx`, `apps/web/src/styles/radar-geographic.css`.
- Existing `apps/web/test/unified-directory.test.ts`; new `apps/web/test/radar-player-games.test.tsx`.
- `docs/api/UNIFIED_PLAYERS_RADAR_V001.md`; this new handoff.

No migrations, dependencies/config, automation, reviewer/p7 wrappers, policy,
secrets, services, deployment or PROD changes. No subagents, installs, inference
calls, DB/service execution, hosted CI or browser runtime were used. Rollback is
integrator reverting this bounded source patch; no data rollback is required.

## Implemented source and wire contract

A marker selects a compact player preview. Explicit button/handle expansion and
collapse keep the existing map layer/type/sharedMap reference and camera owner;
no profile route is used for the map transition. Expanded content shows the
existing permitted identity/level/approximate geo and real API games, using
Avatar, GameCover and Button. CloseButton and the dynamic loader with
RadarMapModuleLoading remain. Native buttons support keyboard activation;
Escape/back/close and selection retirement restore the originating control,
with canvas fallback if that control is gone. Ordinary directory dialog/profile
navigation remains. The panel scrolls within bounded desktop/mobile height and
uses existing reduced-motion behavior.

The request is still resultRef-only at the existing cookie/CSRF/Idempotency-Key,
budgeted, no-store endpoint. Only u1 adds required `upcomingGames` to
UnifiedPreview. Other preview shapes remain. Games owns the PoolClient read
projection; no module/service wiring, new endpoint, public-ID lookup, `/me`
substitute, browser roster scraping or fixture-backed runtime path was added.

`UnifiedUpcomingGame` contains exactly public Game id/title/activityKind,
startsAt/endsAt/timezone, cover.uploadedUrl, venue.name and venue.cover.uploadedUrl.
Both nested cover objects and venue are closed, as is the summary itself
(`additionalProperties:false`); upcomingGames has maxItems 3. Canonical
eligibleGames/normalizeDiscovery(upcoming), effectiveVenueCtes,
gameSelectColumns/mapGameRow and effective game/venue cover SQL are reused.
Mapping creates a new allowlisted DTO, never spreads GameDto or a roster row.
No hidden total, internal identity, participation status/reason, contact,
booking/access note, coordinates, source metadata, invented preferences,
rating/activity/count or image is added.

## Privacy truth table and serialization

All rows below first require successful current u1 redemption for the same
viewer/session/target/namespace/filter/origin/consent/model/receipt/activation/
version/lease/owner-session/TTL and existing block/restriction fences.

| Target relationship / viewer authority | Published public classified future discovery-eligible Game | Other Game |
| --- | --- | --- |
| Current active directory-public target is immutable created_by_user_id; directory feature enabled, social_eligible and account.access/profile.public/social.directory allowed; neither direction blocked | May return as public creator | Excluded |
| Confirmed target participation; viewer active game_managers owner or manager | May return under existing roster authority | Excluded |
| Target confirmed; ordinary viewer, even confirmed in the same Game | Excluded | Excluded |
| Target radar-only creator; no viewer roster authority | Excluded (truthful empty permitted) | Excluded |
| Target merely manager/trainer/legacy organizer; no permitted creator or confirmed+viewer-manager relation | Excluded | Excluded |
| Pending/rejected/withdrawn/removed/expired/cancelled_by_game participation or invitation-only relation | Excluded | Excluded |
| Missing, forged, expired, cross-viewer/session/namespace proof, target opt-out/block/restriction/owner-session retirement | Entire preview denied, no schedule | Entire preview denied |

Public eligibility is not permission to reveal membership. The existing
confirmed-only roster boundary is not broadened. There is no waitlist status or
new consent model. Empty copy is exactly **«Нет доступных ближайших публичных
игр»**; it makes no assertion about private games or private membership.

Authorization/eligibility precede LIMIT 3. An OR over Game rows avoids joining
multiple relationships into duplicate output. Games are ordered startsAt,id;
the final DTO also defensively deduplicates/bounds to held ids. At most three
Game SHARE fences are acquired in UUID order after existing pair/presence
fences. A fresh READ COMMITTED statement rechecks relationships, moderation and
eligibility **after** lock waits. If a candidate is retired while waiting, omit
it and do not fill from unfenced Games; refresh/reopening can find replacements.

The preview captures current players_query_revision before work, checks it
under final SHARE after Game waits, and rechecks actor/session and final target
proof. Games rereads after these waits, and a final wall-clock proof check
precedes COMMIT. This protects directory identity changes independently of
queryRef TTL; Game locks serialize withdrawal/authority revocation/cancellation/
moderation writers. u1 statement/lock waits are capped at 2 seconds. Failed
checks roll back without a partial DTO. Independent review must still assess
this lock order against all relevant writer paths and execute the races.

## Whole-schedule client fences

The controller's selection epoch now has its own AbortController. A->B,
close/Escape/back, map-page request (cleared before waiting), filter/city/
activation transitions, pendingStop/opt-out through the existing session
provider, hide/pagehide, actor/session/CSRF replacement and dispose retire the
whole schedule. Reopening always calls authorized preview anew. Transient
failure clears old detail and exposes retry, separately from authorized empty.

Admission and rendering verify matching public player identity and finite live
snapshot/row/preview deadlines. Game summaries must have valid dates/timezone,
uuid, ordering, distinct ids, <=3 bound and no extra fields. Map rendering also
requires active publishing and the matching current filter/activation context.
No proof/schedule is placed in URL/history payload/storage/logs; history uses
only the existing nonprivate boolean preview marker. The existing session
provider's retirement path is reused, not rewritten in this slice.

## STYLE_GUIDE_PARITY / bounded gap

Binding source: [Owner Style Guide First decision at supplied base](https://github.com/anpavel84-afk/gobadminton-clean/blob/6fb9b0cbaad3c1989c521d0612d036ddf4342d7c/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md).
Frozen source references supplied by the assignment:
`/opt/gobadminton-clean-qa/style-guide/src/App.tsx` — RadarPlayerPreview,
RadarMapPage, CompactUpcomingGame/PlayerUpcomingGames, Drawer/BottomSheet,
Empty/Error/Skeleton — and corresponding `src/index.css`.
The decision records source-tree SHA256
`5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`,
App.tsx `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`,
index.css `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`.
These are recorded source authorities, not newly measured hashes.

Read attempts of both frozen files returned **Permission denied** despite the
supplied read exception. The referenced
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` and installed Next guide
`apps/web/node_modules/next/dist/docs/` are absent. No broader filesystem access
or escalation was attempted. This gap is explicit; frozen composition/source
comparison remains NOT_TESTED for integrator/reviewer with authorized access.
The mounted M2R_mockup.png is not required and was not sought.

Source composition reuses existing Avatar approved URL/initial fallback,
GameCover approved game/venue media and court/trainer fallback, Button,
CloseButton, and dynamic RadarMapModuleLoading. The map panel uses existing
foundation tokens `--gb-white`, `--gb-ink`, `--gb-ink-soft`, `--gb-purple`,
`--gb-line`, `--gb-radius-sm`, `--gb-ease`, Onest/inherited type, 44px controls,
safe-area spacing and reduced-motion rules. These repository primitives are
implementation components; old frontend code is not independent presentation
authority.

**STYLE_GUIDE_GAP:** the approved bounded composition puts player expansion and
CompactUpcomingGame-style summaries inside the mounted map's existing
Drawer/BottomSheet instead of Make demo profile navigation. No demo activity,
preferences/counts/rating/photos are copied. **OWNER_VISUAL_OVERRIDE:** none
claimed. **STYLE_GUIDE_PARITY:** source candidate only, unverified against
inaccessible frozen files; no rendered/browser/mobile/desktop parity assertion.

## Authored tests and exact author-check results

New API unit tests exercise actual RadarService.preview and Games projection
with mocked PoolClient/clock: same-client redemption/budget, allowlisted output,
permitted DB-result cases, empty-result cases, final/revision/proof rollback,
fresh-read omission, dedupe/order/bound/fenced-id output and legacy shape.
Mocked DB results and SQL text assertions do **not** establish SQL privacy.
The extended real disposable-DB/HTTP harness supplies creator and roster-manager
positives, ordinary confirmed/radar-only/manager/trainer/invitation/nonconfirmed
negatives, excluded game statuses/moderation/time, allowlist/media, limits/order,
opt-out/block/restriction/session/TTL and forged/wrong actor/session/namespace
proof cases, Game lock waits, revision retirement, pair-wait opt-out and TTL
expiry across a Game wait. Existing directory/radar visibility tests remain.

Web deferred-request/fake-clock tests cover late A/B, all retirement paths,
finite deadlines, malformed/mismatched/extra-field schedule admission, errors
and authorized refresh. New component tests invoke actual RadarPage and
UnifiedPlayerPreview with small local hook mocks and renderToStaticMarkup as
in venue-preview-card.test.tsx: compact/expanded/collapse, API/empty/error/retry,
selection reset, Escape/back/CloseButton/focus, retained map element/reference,
ordinary directory compatibility and rendering fences. This is not a universal
React renderer, browser map lifecycle test or rendered visual evidence.

Original source pass's exact commands attempted offline, with results (historical
author evidence, not newly executed checks for the repaired candidate):

| Command | Result |
| --- | --- |
| `node packages/contracts/scripts/generate-unified-types.mjs --write` | Exit 0: generated allowed unified.generated.ts |
| `node packages/contracts/scripts/generate-unified-types.mjs` | Exit 0: generated bytes verified (also repeated after source edits; schema unchanged) |
| `git diff --check` | Exit 0: whitespace check only |
| `pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | Exit 254: tsc not found; typecheck NOT_TESTED |
| `pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | Exit 254: tsc not found; typecheck NOT_TESTED |
| `pnpm --filter @gobadminton/contracts exec tsc -p tsconfig.json --noEmit` | Exit 254: tsc not found; typecheck NOT_TESTED |
| `pnpm --filter @gobadminton/api run lint` | Exit 1: eslint not found / node_modules missing; lint NOT_TESTED |
| `pnpm --filter @gobadminton/web run lint` | Exit 1: eslint not found / node_modules missing; lint NOT_TESTED |
| `pnpm --filter @gobadminton/contracts run lint` | Exit 1: eslint not found / node_modules missing; lint NOT_TESTED |
| `pnpm --filter @gobadminton/api exec vitest run --project unit test/unit/radar-player-games.test.ts` | Exit 254: vitest not found; unit execution NOT_TESTED |
| `pnpm --filter @gobadminton/web exec vitest run test/unified-directory.test.ts test/radar-player-games.test.tsx` | Exit 254: vitest not found; web execution NOT_TESTED |
| `pnpm --filter @gobadminton/contracts run check` | Exit 1: @apidevtools/swagger-parser missing; full contract validation NOT_TESTED |

No installs/network were attempted to repair missing dependencies. DB
integration/migrations/services were **never executed** (NOT_TESTED by explicit
source-only assignment), even though integration tests were authored. No author
check is independent source QA or an independent PASS. Git status/diff are
source inventory checks only.

## C8 repair and current author checks

Supplied independent finding: the local useState setter dereferenced mutable
`hooks.slots` after pageHarness.render restored ambient storage. Expansion
callbacks therefore wrote outside the RadarPage state, leaving expandedPlayer
null. The setter now captures its creating render's slots array, matching the
established venue-preview-card.test.tsx local mock. The actual page interaction
test retains its expansion/collapse assertions and additionally checks that
both callbacks leave ambient storage unchanged, even across separate preview
render scopes. No product behavior, visual composition, dependencies or test
framework changed. Style Guide access was attempted again: frozen App.tsx and
index.css remain Permission denied; the operations guide and installed Next
docs remain absent. The source parity limitations above still apply.

Current exact offline command attempts:

| Command | Result |
| --- | --- |
| `node packages/contracts/scripts/generate-unified-types.mjs` | Exit 0: generated bytes verified; no file rewrite |
| `pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit --incremental false` | Exit 254: tsc not found; NOT_TESTED |
| `pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | Exit 254: tsc not found; NOT_TESTED |
| `pnpm --filter @gobadminton/contracts exec tsc -p tsconfig.json --noEmit --incremental false` | Exit 254: tsc not found; NOT_TESTED |
| `pnpm --filter @gobadminton/api run lint` | Exit 1: eslint not found, node_modules missing; NOT_TESTED |
| `pnpm --filter @gobadminton/web run lint` | Exit 1: eslint not found, node_modules missing; NOT_TESTED |
| `pnpm --filter @gobadminton/contracts run lint` | Exit 1: eslint not found, node_modules missing; NOT_TESTED |
| `pnpm --filter @gobadminton/api exec vitest run --project unit test/unit/radar-player-games.test.ts` | Exit 254: vitest not found; NOT_TESTED |
| `pnpm --filter @gobadminton/web exec vitest run test/unified-directory.test.ts test/radar-player-games.test.tsx` | Exit 254: vitest not found; NOT_TESTED |
| `pnpm --filter @gobadminton/contracts run check` | Exit 1: @apidevtools/swagger-parser missing; NOT_TESTED |
| `git diff --check` | Exit 0: whitespace check only |

The following dependency-free diagnostic was also executed exactly (exit 0,
Node emitted an experimental stripTypeScriptTypes warning). It exercises the
actual extracted mock's delayed direct and functional setters with restored
ambient storage. It is not execution of RadarPage, React, or the Vitest suite;
full component/test execution remains NOT_TESTED.

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync('apps/web/test/radar-player-games.test.tsx', 'utf8');
const start = source.indexOf('  useState<T>');
const end = source.indexOf('  useRef(', start);
assert.ok(start >= 0 && end > start);
const method = stripTypeScriptTypes(`({${source.slice(start, end)}})`);
const hooks = { slots: [], cursor: 0 };
const { useState } = Function('hooks', `return ${method}`)(hooks);
const pageSlots = [];
hooks.slots = pageSlots;
const [, setExpanded] = useState(null);
const ambientSlots = [];
hooks.slots = ambientSlots;
setExpanded('Player A');
assert.equal(pageSlots[0], 'Player A');
setExpanded(previous => previous === 'Player A' ? null : 'wrong owner');
assert.equal(pageSlots[0], null);
assert.deepEqual(ambientSlots, []);
console.log('Extracted useState mock: delayed direct and functional setters retain owning slots; ambient storage unchanged. Full Vitest NOT_TESTED.');
NODE
```

No DB/migrations/services, browser, network, installs, Git metadata changes,
commits, pushes or independent self-QA were performed. Independent source QA,
CI and all remaining integrator gates below are still mandatory. Rollback of
this repair alone is an integrator revert of its two-file patch; rollback of
the whole slice remains the bounded source revert described above.

## Remaining bounded integrator gates

The next action is independent review of this exact patch for Issue #149,
followed by integrator publication of the reviewed source revision and this
handoff. Integrator must reconcile the supplied-base/actual-HEAD difference,
run required typecheck/lint/contracts/unit checks with provisioned dependencies,
execute the synthetic disposable DB harness and lock-wait races, obtain the
frozen Style Guide source comparison and browser/mobile/desktop evidence
(including real camera/marker persistence, keyboard/back and focus behavior),
and run hosted CI and existing DEV admission/acceptance/release gates under
existing authority. PROD requires its separate Owner GO. No gate is satisfied
by file presence, authored tests, this handoff or chat. Integrator must add exact
candidate/evidence commit permalinks; there is no source-author publication
permission in this assignment.
