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
