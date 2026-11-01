# GoBadminton release notes

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
