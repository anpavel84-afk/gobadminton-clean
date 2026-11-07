# Handoff — #506 MOD-V2-B1a · alpha.47 release metadata candidate (attempt 20)

## Assignment

- Issue: #506 continuation (`OWNER506_B1A_ALPHA47_RELEASE_METADATA_AFTER_ACCEPTED46`)
- Author: Cursor Auto
- Base: `e331a66861faca1353476ba09232163d919c0a1a` (accepted46 `264d9e1c…` into source repair19 `250bf7ad…`; zero overlapping paths; no app/moderation logic in this pass)
- Scope **only**: releases catalogue + release tests + this handoff
- Not claimed: moderation architecture, B1b/B2/C/D, #507 open, PROD, deploy, independent QA PASS, Owner UAT PASS

## Prior source (repair19 — retained)

B1a public game comment create/reply/edit prepublication text gate lives in source repair19 (`250bf7ad…`): claim-owner fencing, unknown reservation without second paid prepare, retain draft/prior published body on reject/unavailable, safe same-key replay and concurrent fences. That source still needs **independent parent QA** (prior handoff said parent QA needed). This metadata pass does **not** invent that PASS.

## What changed (this metadata pass)

- `CURRENT_APPLICATION_VERSION` / `CURRENT_NAMED_RELEASE` → **0.1.0-alpha.47**; API contract stays **0.37.0** (same success DTO, no new endpoint).
- Current candidate: `source_sha` **null**, no invented PR/QA/CI/DEV receipt; Owner UAT **NOT_TESTED**.
- User-facing delta: B1a game comment create/reply/edit text check before publish; rejection/temporary unavailability keeps draft and already-published text. Not full moderation B.
- Known limits (plain language): role/venue reviews and broad venue-page comments not in this release; private-message external check off; time/place change deferred; no physical iPhone / GoBad / Owner UAT claim; legal/support/account-deletion unfinished.
- Trusted historical **alpha.46** seed appended exactly from Owner input (`264d9e1cf63b4272732b2b9ad2317e9f9b9d320f` / `r42400302014-a1` / `2026-11-07T18:20:21Z` digests). Alpha.45/44 untouched. Actual45A and46 no-photo WebP correction already delivered — recorded as history only.
- Runtime broad venue comments remain closed pending admitted #507 I1 (not permanent policy). Private external egress OFF. B1b role/venue public reviews/Cases, B2 venueAdmin/import, C/D/#507 unfinished.

## Checks run by author

- Existing release unit/server/tsx suites for catalogue integrity (targeted).
- No fictitious independent QA PASS, CI green claim, or DEV.47 ACCEPTED.
- No Git/runtime/DB/provider/network/deploy; no `.evidence` scratch in repo.

## Remaining / next (parent)

1. Independent delta QA of source repair19 + this metadata20 (own DB).
2. Full Product CI → actual guarded DEV.47 → smoke; then bind `source_sha` / deployments from real acceptance.
3. Owner UAT stays NOT_TESTED until Owner tests after DEV ACCEPTED.
4. B1b / B2 / C / D / #507 remain future admitted work.
