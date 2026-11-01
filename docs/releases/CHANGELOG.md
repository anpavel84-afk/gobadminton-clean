# GoBadminton release notes

## #445/#450 residual — map empty gate + trainer fetch skip (0.1.0-alpha.11 candidate)

Map no longer announces an empty city catalogue while venues are loading or the
venues response failed; genuine empty is gated on a fulfilled current-city venues
result (sr-only). Ordinary non-trainers no longer auto-GET `/v1/me/trainer-profile`
from `/profile` and `/games/create` when `OwnSocialProfile.trainer` is false; active
trainers still fetch real version/status. API wire unchanged `0.22.0`. Base accepted
DEV alpha.10 `1dc50002…`. PROD remains accepted alpha.8. Owner UAT: NOT_TESTED.

- Application version (candidate): `0.1.0-alpha.11`; API contract unchanged `0.22.0`.
- Base accepted SHA: `1dc5000280d617c3160fc959ee87607db394410c` (alpha.10 DEV).
- Candidate source SHA / DEV receipt: unbound until trusted ACCEPTED.
- Independent Medium QA / Product CI / DEV acceptance: pending for this candidate.
- Owner UAT: NOT_TESTED.
- Does not claim all of #445/#450 closed; chat non-participant 404 and unrelated items remain.
- PG-3/PG-4 untouched; C5 untouched; no PROD activation.

## #402 — own profile actions under hero (0.1.0-alpha.10 DEV ACCEPTED)

Compact open action group on `/profile` under the shared hero: lime «Изменить
профиль», outline «Изменить обложку», ghost «Настройки». Layout and cover
handlers only; no API/privacy/public-profile change. Accepted on DEV
`r41349542541-a1` (`2026-11-01T21:03:36Z`), source
`1dc5000280d617c3160fc959ee87607db394410c`. API wire remains `0.22.0`.
PROD remains accepted alpha.8. Owner UAT: NOT_TESTED.

- Application version: `0.1.0-alpha.10`; API contract unchanged `0.22.0`.
- Accepted source: `1dc5000280d617c3160fc959ee87607db394410c`.
- DEV release: `r41349542541-a1` (accepted `2026-11-01T21:03:36Z`).
- Digests: api `sha256:a71fe6979b045a09bb348cce3e7f57ffbab952e5b52edc632849ef3776e49970`,
  web `sha256:3d57f99e22af3f1fac4a64956a38745862d434abd42ce17f9ff026e7cf0a87b0`.
- Owner UAT: NOT_TESTED.
- PROD unchanged (remains alpha.8).

## #450 — safe public name + Russian release history (0.1.0-alpha.9 DEV ACCEPTED)

Visual QA repair on accepted alpha.8 (`26f3ba38…`). Public directory, player
profile, unified/radar and friendship peer DTOs scrub email-shaped or empty
display names to «Игрок» at the read boundary without rewriting own-profile or
login storage; catalogue cursor ordering stays on raw stored names. Accepted on
DEV `r41345457119-a1` (`2026-11-01T20:21:50Z`), source
`783a1897167be1f531312b9a6812b6240181e2c3`. PROD kept alpha.8. API wire
`0.22.0`. Owner UAT: NOT_TESTED.

- Application version: `0.1.0-alpha.9`; API contract unchanged `0.22.0`.
- Accepted source: `783a1897167be1f531312b9a6812b6240181e2c3`.
- DEV release: `r41345457119-a1` (accepted `2026-11-01T20:21:50Z`).
- Digests: api `sha256:722cf29edad73ef6c30bc215a0a69801259b581b46faf12a421293c0b41f1267`,
  web `sha256:d13dc563b86e7f36c2dfa168a93e25dbd9ea6d2c605904ecd0668f5832c440d1`.
- Owner / Go Bad UAT: NOT_TESTED.
- PROD unchanged (remains alpha.8).

## #448 — visibility and messages defaults with preserved user choice (0.1.0-alpha.8 ACCEPTED both sites)

For eligible accounts, directory listing and contact requests are on by default;
an explicit saved user opt-out is preserved. Accepted on DEV `r41339991160-a1`
(`2026-11-01T19:18:15Z`) and managed PROD (`2026-11-01T19:30:08.857934Z`),
source `26f3ba38d9c04730674b084c0266afc193662398`. Post-install browser findings
are tracked in #450 and are not back-dated as fixed in this release record.
API wire `0.22.0`. Owner UAT: NOT_TESTED.

## #445 followup points 2/3/5/6 — map aliases, finder, friends guidance (0.1.0-alpha.7 DEV ACCEPTED)

Bounded visual-qa followup for #445 points 2, 3, 5 and 6 only (point 1 already DEV
ACCEPTED as alpha.6). Legacy `/games/map` and `/venues` enter the existing canonical
map; invalid non-game UUID terminates before API; neutral finder prerequisite fits
desktop and mobile; Friends/recommendations show own-profile save/visibility guidance
with `/profile` link instead of a false outage when own profile is unsaved/hidden.
No auto opt-in and no backend permission changes. Point 4 needs reporter game URL/role;
postgame fixture waits reporter ID. Do not claim all fresh users eligible, private
profiles enabled, or all of #445 done — Issue #445 stays OPEN / retest pending.

- Application version: `0.1.0-alpha.7`; API contract unchanged `0.22.0`.
- Accepted source: `dd3839814fdb4ed8e05a64301e4aaaacff5cf0cc` (PR #447).
- Product CI: run `41330759194`, 7/7 PASS.
- DEV release: `r41331655353-a1` (accepted `2026-11-01T17:33:52Z`).
- Digests: api `sha256:c11807e1d7d9661f284a64236288c98f8afc1a53d1029c59ec51c9121b9f3705`,
  web `sha256:25a6f51d6d5b5a5218a9b8e2ae84fdf3561dde274e1ff6705bb07501f1e9fba1`.
- Owner / Go Bad UAT: NOT_TESTED.
- PG-3/PG-4 still not installed; PROD unchanged (remains alpha.2).

## #445 point 1 — create-game level range common track (0.1.0-alpha.6 DEV ACCEPTED)

Visual QA repair for Go Bad report point 1 (source PR #433 / canonical #432; delivery
PR #446): «От»/«До» native range handles share one visual track with stable global
NTRP 1..7 coordinates and selected-interval fill. Defaults 3.0..3.5, inclusive
`allowedLevelIds`, regular/trainer forms preserved. API contract unchanged.
Points 2–6 of #445 were out of scope for this release.

- Application version: `0.1.0-alpha.6`; API contract unchanged `0.22.0`.
- Accepted source: `4fdf232ac576b7c830c77405267795634b9ae43b` (merge / PR #446).
- Product CI: run `41328299309`, 7/7 PASS.
- DEV release: `r41329378049-a1` (accepted `2026-11-01T17:07:45Z`).
- Digests: api `sha256:753b6ba373560b59cb0840b3d69ed19100629d8332004e208ac9fdced762c0c0`,
  web `sha256:7a8c300478d2a2ab428cee687f5e64cfb3db294eb38f25f3f48dae9a16163e40`.
- Owner / Go Bad visual UAT: NOT_TESTED.
- PROD unchanged; PG3 parked separately.

## REG.RU SMTP email-code delivery (0.1.0-alpha.5 accepted)

Existing email-code API and pg-boss delivery queue gain verified TLS SMTP delivery
from info@gobadminton.ru, with protected worker-only password file, bounded retries
and private error reporting. Fake delivery remains local/test only. Distinct later
DEV install of the same application version used worker-fix source `84ced…`
(`r41319296538-a1`); digests/receipts are not mixed under SMTP source `06991…`.

- Application version: `0.1.0-alpha.5`; API contract unchanged `0.22.0`.
- SMTP source: `06991b099317a702dc102eeef53ee64cfa841f0e`, release `r41317332177-a1`
  (accepted `2026-11-01T14:52:56Z`).
- Worker-fix source: `84cedf79ec6d0582ef1197589acd808f9470f62c`, release `r41319296538-a1`
  (accepted `2026-11-01T15:08:02Z`).
- Owner UAT: NOT_TESTED; PROD unchanged.

## #372 — PG-2 dispute response + scoped case resolution (0.1.0-alpha.4 DEV ACCEPTED)

Manager response/correction (including versioned unknown) without unilateral close; participant consent with exact open dispute versions; help escalation progress (not abuse report); staff intake case-from-dispute + scoped admin resolution under existing Cases/step-up/assignment. API contract additive `0.22.0`. Migration `0047` additive. DEV accepted source `7a36b8d94a5df412426155e5852fddd9da7b0045`, PR `#441`, Product CI `41310154224` 7/7, release `r41310911419-a1`, accepted `2026-11-01T13:34:38Z`. Postgame/cases subsequently activated DEV only. PG-3/PG-4 not delivered. PROD unchanged. Owner UAT NOT_TESTED. Alpha.3 final DEV record retained below.

- Application version: `0.1.0-alpha.4`
- API contract: `0.22.0`
- Refs: #372 / PG-2 / PR #441
- Accepted source: `7a36b8d94a5df412426155e5852fddd9da7b0045`
- Product CI: run `41310154224`, 7/7 PASS
- DEV release: `r41310911419-a1` (accepted `2026-11-01T13:34:38Z`)
- Postgame/cases: activated DEV only after acceptance
- Owner UAT: NOT_TESTED
- Known limits: no PG-3/PG-4, PROD unchanged

## #372 — PG-1b attendance + results (0.1.0-alpha.3 DEV ACCEPTED)

Bounded post-game attendance with provenance, durable own notice + explicit mark-version agreement, basic dispute, and unified results screen within PG-1b. DEV accepted source `7b75fbed6b2582c9594ff71566566df625b5672d`, release `r41298675161-a1`, accepted_at unix `1793530473` (`2026-11-01T10:54:33Z`). Config activation POST_GAME_INTERNAL_ENABLED on DEV only. PROD unchanged alpha.2. Owner UAT NOT_TESTED.

- Application version: `0.1.0-alpha.3`
- API contract: `0.21.0`
- Refs: #372 / PG-1b / PR #440
- DEV release: `r41298675161-a1`
- Owner UAT: NOT_TESTED

## #438 — Swipe false exhaustion repair (0.1.0-alpha.2 accepted)

Finder «Свайп» waits for own social-profile readiness before peer-capability filtering. Hidden own profile (`directoryVisible` / `socialEligible`) shows a profile-settings prerequisite with link to `/profile` — no automatic privacy change. Profile load failure is a real retry error; all-peer `unavailable` is generic unavailable/retry, not catalogue exhaustion. Genuine outgoing/mutual skip/exhaustion and UNKNOWN/account-switch protections retained. Application version `0.1.0-alpha.2` (delta); first named `0.1.0-alpha.1` baseline kept literal.

- Application version: `0.1.0-alpha.2`
- Accepted source: `38a4700c68ed85189007dcab3c859c98eb37bf46`
- Refs: #438
- DEV release: `r41287889091-a1` (accepted `2026-11-01T08:17:46Z`)
- Managed PROD: accepted `2026-11-01T08:19:28.308318Z` (application-only; pipeline release_id absent)
- Owner UAT: NOT_TESTED

## #434 — First named application version 0.1.0-alpha.1 (DEV releases page)

First formal application version number for this code build (not API contract `0.20.0`, not package metadata alone). DEV-only `/releases` product page: what the app does, simple DEV/PROD installation status, readable dates, and known limits in plain Russian. Technical SHA/API/receipts stay under collapsed details. Trusted historical seed (unnumbered 855/115) and live SHA vs `__release-info` comparison retained. Footer version badge + DEV-only «Версии» link. Web `/health` reports `applicationVersion` + `gitSha`. Pass2 repairs: fail-soft out-of-range finished/observed timestamps; full 40-hex SHA required before `accepted_current`.

- Application version: `0.1.0-alpha.1`
- API contract remains: `0.20.0`
- UAT: NOT_TESTED until Owner verifies
- Deployment: DEV/PROD receipts filled by trusted integrator after install

## #435 — PROD public feature parity (Friends / play interest / Moscow maps)

Owner-approved source repair so exact canonical PROD (`NODE_ENV=production`, `APP_ENV=prod`, `PUBLIC_WEB_ORIGIN`/`PUBLIC_API_ORIGIN` = `https://gobadminton.ru`) can use the same public Friends, recommendations (via `friendsEnabled`), play-interest, and registered Moscow map preview paths already admitted on DEV, without relaxing directory/TTL/rate/eligibility/privacy/bounds or map resource prefix/style integrity. Basemap bytes remain the existing public immutable DEV asset bundle URLs; trusted integrator set the PROD map preview flag after install and added bounded CORS for exact `https://gobadminton.ru` on that static route only.

- Source candidate: `d837448a315f0758db0056dfeed9e79a86c057e0` (PR #436)
- Merged / accepted source: `11558239cf284a2f20e3c1c6906ae217c703325f`
- Independent QA: PASS (Codex Medium)
- Product CI: run `41253691550`, 7/7 PASS
- DEV release: `r41254244816-a1` (accepted `2026-11-01T00:02:38Z`)
- Managed PROD: accepted `2026-11-01T00:04:47.811785Z` (application-only; pipeline release_id absent)
- Owner UAT: NOT_TESTED
