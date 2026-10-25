# P1 — default cover photographs

From: source author. To: independent QA / integrator. Date: 2026-10-19.
Status: READY_FOR_REVIEW; checks NOT_TESTED; visual parity UNVERIFIED.

Base: `58d71ae3851d98743cef0eff1d83eed0c6ac530c` (provided HEAD,
`automation/issue-104`). Base reference:
https://github.com/anpavel84-afk/gobadminton-clean/tree/58d71ae3851d98743cef0eff1d83eed0c6ac530c

Assignment: offline source-only P1 cover fallback for issue #104. Allowed writes:
VenueCover.tsx, GameCover.tsx, venue-cover.test.tsx and this handoff. No commit,
push, deployment, Git metadata changes or publication authorized. The integrator
must publish this diff and attach its exact candidate permalink; no candidate
commit or durable GitHub publication is claimed here.

FACT: VenueCover defaults to the existing court photograph; its optional trainer
fallback uses the existing racket/shuttlecock photograph. Both have descriptive
Russian alt text, lazy loading, async decoding, data-cover="default" and
data-fallback. Uploaded-image onError handling is retained; local fallback images
have no error handler. GameCover passes the activity-specific fallback while
preserving game photo → venue photo → default priority. URL validators are unchanged.
One added test covers missing venue cover, invalid trainer cover and both discovery
activity types, including metadata and absence of the old symbol. Existing tests
are retained. No CSS, binaries, contracts, API or map changes.

## STYLE_GUIDE_PARITY

Reused: existing media/image slots and container sizing; frozen Make photographs
listed in `apps/web/public/discovery/provenance.json`. Screen composition remains
the existing DiscoveryGameCard / GameCover composition with the assignment's
Owner-specified photographic fallback. Authority:
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
STYLE_GUIDE_GAP: none introduced. OWNER_VISUAL_OVERRIDE: none introduced.
Visual parity: UNVERIFIED. Referenced operational guide
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout;
local `apps/web/node_modules/next/dist/docs/` is also absent. No framework-specific
behavior was changed and no external references were fetched.

## Required checks

- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run typecheck` — exit 1, NOT_TESTED.
- `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run test/venue-cover.test.tsx` — exit 1, NOT_TESTED.

Both stopped in Corepack before the underlying tool ran: pnpm 10.18.0 was not
available locally; Corepack reported that network access was disabled and it could
not reach `https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`. No installation or
network retry was performed. Strict typecheck and runtime assertions remain
unverified. These author check attempts are not independent QA.

Rollback: integrator removes only this task's diff, retaining unrelated changes.
Next bounded action: independent QA reviews this diff and runs the two required
checks with provisioned tooling. Separately, after an authorized DEV rollout, the
operator checks 390 px layouts: ordinary game and venue show courts, trainer game
shows racket/shuttlecocks, with no gray symbol. That visual check is not this
source task's gate. No acceptance or deployment is claimed.
