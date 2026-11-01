# GoBadminton release notes

## #372 — PG-3 private reviews + personal notes (0.1.0-alpha.6 prospective)

Private peer/organization/training reviews with recipient reply singleton, author patch + history, personal manager notes with versioned tombstone, GET me/reviews, optional GameResults.feedback projection. API contract additive `0.23.0`. Migration `0048` additive. Writes remain `POST_GAME_INTERNAL_ENABLED` default OFF. Typed review Safety complaint extension remains **remaining** (existing player report reused). **Not** READY / not DEV ACCEPTED / not PROD. Prospective only: current merge SHA and acceptance date unbound until accepted live projection. Historical alpha.3 / alpha.4 / SMTP alpha.5 records retained below.

- Application version (prospective candidate): `0.1.0-alpha.6`
- API contract (candidate): `0.23.0`
- Refs: #372 / PG-3
- Independent QA / Product CI / DEV install: pending trusted process
- Owner UAT: NOT_TESTED
- Known limits: no PG-4 / #394 public comments; PROD unchanged alpha.2 / email=false; complaint typed extension remaining

## #442 — SMTP one-time code delivery (0.1.0-alpha.5 DEV ACCEPTED)

TLS SMTP transport (REG.RU) wired to the existing durable email-code queue and worker. Login code sent from `info@gobadminton.ru`; transient errors keep prior bounded retries. Worker bound to the accepted API registry manifest reference; secrets read only by protected worker runtime. Public DEV discovery reports email=true — **not** proof of delivery to a real mailbox. Registration/recovery/Owner UAT NOT_TESTED. PROD remains alpha.2 with email=false; no PROD email enablement claimed.

- Application version: `0.1.0-alpha.5`
- API contract: `0.22.0`
- Accepted source: `06991b099317a702dc102eeef53ee64cfa841f0e`
- Refs: #442 / PR #443
- DEV release: `r41317332177-a1` (accepted `2026-11-01T14:52:56Z`)
- Owner UAT: NOT_TESTED
- Delivery to real mailbox: NOT_VERIFIED by release receipt

## #372 — PG-2 dispute response + scoped case resolution (0.1.0-alpha.4 DEV ACCEPTED)

Manager response/correction (including versioned unknown) without unilateral close; participant consent with exact open dispute versions; help escalation progress (not abuse report); staff intake case-from-dispute + scoped admin resolution under existing Cases/step-up/assignment. API contract additive `0.22.0`. Migration `0047` additive. DEV accepted source `7a36b8d94a5df412426155e5852fddd9da7b0045`, release `r41310911419-a1`, accepted_at `2026-11-01T13:34:38Z`. Runtime writes default OFF until DEV activation. PROD unchanged alpha.2. Owner UAT NOT_TESTED.

- Application version: `0.1.0-alpha.4`
- API contract: `0.22.0`
- Accepted source: `7a36b8d94a5df412426155e5852fddd9da7b0045`
- Refs: #372 / PG-2 / PR #441
- DEV release: `r41310911419-a1` (accepted `2026-11-01T13:34:38Z`)
- Owner UAT: NOT_TESTED

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
