# M3-CONTACTS-R2 / #142 source handoff

From: source author. To: integrator / independent QA. Date: 2026-10-21.
Status: WORKING_DRAFT, NOT INDEPENDENTLY VERIFIED. No QA/live/UAT PASS.
Base: `f50eb6f0f1703efabe86ef1de5b8f42948fc4497` (checkout HEAD,
`automation/issue-142`). Initial tracked diff was empty. Authorized scope is
source-only public organization contacts in venue info; immutable assignment
M3-CONTACTS-R2 #142, successor to #134. No Git write, network, installation,
SQL execution, service, deployment, secret or automation changes authorized.
Integrator must attach the future exact candidate SHA/permalink; no candidate
commit or publication was created here. A newer dev requires manual integration.

## Changes and acceptance mapping

- D1: additive 0038 nullable jsonb, no default/backfill; CHECK uses IS TRUE.
  Strict JSON shape, required keys/types, phone and messenger limits, canonical
  ASCII URL storage functions. Schema includes nullable publicContacts.
  Migration smoke expects 0038 and checks physical column/CHECK. Existing private
  fixtures/assertions retained. New gated 0037→0038 upgrade seeds private data,
  checks SQL NULL, rejects JSON null and malformed values, exercises ledger skip.
- D2: pure module supplies strict Zod write and tolerant unknown read. Added
  ungated tests for IDN, normalized length/padding, fullwidth slash rejection,
  IPv4/IPv6, dot segments, duplicate messenger kinds, private keys, create/edit.
  Typed fake Pool/AdminService tests exercise catalog/alias/detail, fuzzy/RETURNING and admin
  presence/null/serialized-object binds plus audit/outbox projections.
- D3: gated source tests cover IDN edit/storage/catalog/detail/admin detail,
  omission/replacement/clear, replay/stale version, private timestamp preservation,
  audit and create rejection/CSRF. Existing private access tests retained.
  Also includes public contact-specific collision, Origin/step-up/auth and propose
  cases; ungated fakes exercise fuzzy/RETURNING. DB NOT_TESTED; source presence
  is not evidence of executed acceptance.
- D4: new real VenueSheet/listAllCityVenues tests use fetch mock and rendered
  element props for labels/order, tel/external links, old/missing/unsafe API,
  partial safe neighbors, private key omission and readiness-independent empty.
- D5: VenueSheet change is pure contact presentation/validation in info after
  name/address; hooks/handlers/CTA/schedule untouched. Both existing VenueSheet
  test files, CSS, maps, Radar, requests and filters untouched. Browser UNVERIFIED.
- D6: exact attempts below; no dependency install or alternate checks substituted.

`api-client.ts` was read, not edited (outside allowed_paths): pagination already
retains the entire venue object. Consumer VenueSummary/Venue gain optional field;
game wire types remain unchanged. Public values never derive from private
contact_phone/contact_website/booking_note. Private visibility remains active
owner/manager or confirmed participant of the specific game.

## URL policy / SQL boundary

Before trim reject controls U+0000–001F/007F–009F and backslash. Explicit HTTP(S)
authority has no @. Standard new URL rejects invalid IDN (including U+FF0F),
normalizes dot segments, serializes IDN as punycode and removes default ports.
Credentials/nondefault ports rejected; serialized href length <=300. Padding
can exceed 300 in input; escaping can make shorter input exceed output limit.
Canonical hostname labels are ASCII lowercase or WHATWG-valid IP. Messengers
require HTTPS, exact kind host and non-root normalized pathname. Client validates
independently. SQL checks storage form, not raw Unicode/WHATWG equivalence.
Strict writes reject unknown/private keys; reads preserve safe neighbors.

Omission uses explicit presence flag and CASE; clear binds JS null as SQL NULL,
never JSON.stringify(null). Replacement normalizes then serializes whole object.
Private contact_updated_at still changes only for private values. Existing
version/identity/collision/auth/replay flow is preserved. Audit/outbox contain
metadata rather than contact values.

## D6 commands / evidence

Run from repository root, each command separately:

| Command | Exit | Result |
|---|---:|---|
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1 | NOT_TESTED: Corepack needs pnpm-10.18.0.tgz; network disabled |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit` | 1 | same; compiler never started |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-public-contacts.test.tsx` | 1 | same; Vitest never started |
| `RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts test/integration/migration.smoke.test.ts` | 1 | same; Vitest never started, DB disabled |
| `node packages/contracts/scripts/check-openapi.mjs` | 1 | NOT_TESTED: ERR_MODULE_NOT_FOUND @apidevtools/swagger-parser |
| `git diff --check` | 0 | no whitespace errors at execution; repeated after final edits |

Corepack output: `Network access disabled by the environment; can't reach
https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz`. No network was enabled.
No typecheck/test success is asserted. Final source needs independent compilation
and execution in a provisioned environment; author checks are not independent QA.

## STYLE_GUIDE_PARITY

Authority read: OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001 and textual
OWNER_DECISION_MAP_POPUPS_V001. Intended reuse: existing BottomSheet container
and ordered informational ListRow-style text/link rows, existing white/ink/
ink-soft/lime CTA CSS. No new CSS or invented ratings/amenities/gallery.
`/opt/gobadminton-clean-qa/style-guide/src/App.tsx` read attempt failed ENOENT;
BottomSheet/ListRow source parity UNVERIFIED. This is not STYLE_GUIDE_GAP and no
OWNER_VISUAL_OVERRIDE is asserted. Referenced operations guide and local Next.js
node_modules docs also absent. Frozen #guide/#construction-kit not accessed offline.

## History / continuity / rollback

Prior attempt notes from assignment are PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW,
not independently checked history: #134 a1 SQL JSON null, a2 raw IDN vs ASCII,
a3 fullwidth slash; #127/#133/#131 gesture/focus/cleanup/schedule assertions.
This change addresses public-contact normalization/null binding and preserves
existing interaction files/tests without declaring those historical findings fixed.

Compatibility: optional read field supports old API; null/missing/unsafe values
render empty. Create/propose remain without public contact writes. Roll back
application code while retaining 0038 column/data/functions; no destructive down
migration supplied. Source is unpublished per assignment. Integrator owns durable
GitHub branch/PR/permalink publication and independent QA at future exactSHA.
Next bounded action: provisioned independent QA reviews/runs D1–D6, completes
coverage gaps above and evaluates Style Guide/browser parity before release gates.
