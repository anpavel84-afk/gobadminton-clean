# GoBadminton native M1 · #522 · E «Траектория»

React Native + managed Expo Router foundation on accepted alpha84
`8bf111018170ae6200bbb56fa24ff2af9dc61c4a`. This source candidate implements
optional stories → manual city → public DEV games → public game conditions.
It is not a release receipt, independent QA result or device acceptance.

- Entry `/`: restores only story completion and selected city ID from AsyncStorage.
  Skip and Continue Guest immediately finish stories. Returning entry bypasses them.
- `/city`: actual GET city catalog, manual search and all available cities. Missing,
  removed and unsupported cities never select Moscow or request an unfiltered feed.
- `/games`: public city feed with explicit cursor pagination, retry and honest empty
  states. City selection remains reachable during every request state. Stale city,
  pagination and detail responses are fenced by request generation, even if abort
  is ignored by transport. Back from details preserves the mounted feed and city.
- `/games/[id]`: direct route without onboarding/city gating. Server 404/410, null
  or absent response becomes unavailable. Conditions show actual server values,
  including capacity, reservations, levels, trainer fees, deadlines and timezone.
  No fabricated ratings, players, availability or results. Joining is explicitly
  unavailable; no authentication or mutation requests exist.

Only `https://dev.gobadminton.ru/v1` is configured. The adapter exposes GET `/meta`,
`/cities`, `/games?cityId=…&limit=20&cursor=…`, `/games/:id`; screens use the latter
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
receipt before frozen-lockfile CI can run. Web React remains 19.1.1. No global
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
| typecheck / lint / Expo export | NOT_TESTED: dependencies absent; installation forbidden in author |
| ANDROIDBUILD | NOT_BUILT; trusted Node/dependencies, JDK and Android SDK/build tools needed |
| IOSBUILD | NOT_BUILT; external macOS/Xcode/signing access unverified |
| DEVICE / Owner UAT | NOT_TESTED |
| STORE | NOT_READY; outside M1 |

No install, native build, push, merge, deploy, DEV acceptance or release-history
update was performed by this author. API target 0.43.0 is the supplied probe fact,
not a live API check performed here. The existing issue remains open.
