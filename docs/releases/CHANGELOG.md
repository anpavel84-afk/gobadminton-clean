# GoBadminton release notes

## #372 — PG-1b attendance + results (0.1.0-alpha.3 candidate)

Bounded post-game attendance with provenance, durable own notice + acknowledge, basic dispute, and unified results screen within PG-1b. Runtime write flag remains default OFF; do not claim DEV-ready/exposed until trusted activation. PROD stays on accepted alpha.2. First named alpha.1 baseline unchanged; trusted history seed retains alpha.1 and appends accepted alpha.2 DEV/PROD receipts. Candidate SHA, QA, release ID, and acceptance dates unknown until trusted DEV ACCEPTED.

- Application version (candidate): `0.1.0-alpha.3`
- Refs: #372 / PG-1b
- Independent QA / Product CI / DEV install: pending
- Runtime feature flag: default OFF (not claimed enabled)
- Owner UAT: NOT_TESTED
- Alpha.3 source SHA / acceptance dates: not invented
- Known limits: no PG-2 adjudication, no ratings/reviews/comments, PROD out of this slice

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
