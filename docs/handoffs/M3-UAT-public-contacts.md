# M3 UAT 2/2 — public organization contacts source handoff

- From: Codex, source author. To: GoBadminton dev integrator, then independent QA.
- Date: 2026-10-20. Status: READY_FOR_REVIEW / runtime NOT_TESTED.
- Exact base: `f50eb6f0f1703efabe86ef1de5b8f42948fc4497`, initial HEAD on
  `automation/issue-134` (also referenced by `automation/issue-138`). Initial diff empty.
- Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/f50eb6f0f1703efabe86ef1de5b8f42948fc4497
- Assignment: immutable GOBADMINTON_AUTONOMY_V1 source_only/dev task, M3 UAT 2/2.
  Only assigned source paths and this new handoff may change. No commit, push,
  git metadata write, install, network, services, SQL/DB/migration execution,
  admin/import/deploy, credentials, PROD/PLAN/VPN or independent self-QA.
  Required D6 author commands are recorded below; they do not constitute QA/UAT.
- Prior independent QA supplied for this attempt: `{}`. No acceptance, live UAT,
  independent QA PASS, release or deployment claim. Integrator adds the final
  candidate SHA and exact published artifact permalinks; none are invented here.

## Source deliverables and D1–D4

D1: `0038_public_venue_contacts.sql` adds nullable jsonb `public_contacts`, without
column default, backfill or changes to the private columns. A named CHECK uses
immutable validation functions to reject wrong outer/field types, extra/missing
keys, invalid phone/URL values, more than three messengers, duplicate kinds and
extra messenger keys. The Drizzle schema mirrors the nullable typed column.
Migration smoke sources expect ledger entry `0038_public_venue_contacts`, nullable
jsonb with no default and the CHECK. The existing contacts suite retains its old
assertions and adds fresh-schema CHECK tests plus a disposable 0037→0038 upgrade
with synthetic private values, SQL NULL default, ledger rerun without repeated
ALTER, and old application projection/update preserving public data. **DB NOT_TESTED:
source-only instruction prohibits executing SQL even if a DB is available.**

D2: `public-venue-contacts.ts` defines the public type, strict Zod write schema and
safe unknown read projection. Controls are checked before trim. Phone accepts only
ASCII digits/spaces/parentheses/hyphens and optional initial +, 7–15 digits and
trimmed length <=40. Website permits absolute HTTP(S), <=300; messenger URLs permit
HTTPS, <=300, exact kind-specific hosts and a nonroot pathname. Credentials,
nondefault ports and backslashes are rejected. Read chooses only approved safe
fields, nulls bad phone/website, filters/deduplicates messengers with a limit of 3.
No private-column value or player contact is used as a fallback.

Only admin edit fields add `publicContacts`; shared venueFields and create remain
closed. Admin edit omission preserves, null clears and object replaces. The
existing private update expressions and contact_updated_at comparison remain;
public-only edits do not alter private values/timestamp. Public data participates
in the existing command payload fingerprint; permission/step-up/CSRF/Origin,
version, collision, receipt and audit protocols are retained. Audit/outbox payloads
still select identifiers/state/version, without contact values. Admin projection
safely exposes publicContacts, including detail and edit result.

VenuesService maps safe publicContacts for catalog, detail, reused venues, fuzzy
candidates and propose RETURNING. All venue-bearing projections select the new
column. A merged alias resolves to the final target's contacts. INSERT does not
write public contacts. GamesService and the game's VenueSummary/generated contract
remain unchanged. OpenAPI adds PublicVenueContacts and fields to Venue,
AdminVenue and inline admin edit fields; create schemas are unchanged. API policy
adds only the public organization contact behavior, preserving the private matrix.

The new ungated describe in `venue-contacts.test.ts` needs no DB and covers strict
parser/DTO boundaries, safe partial reads, SQL capture and typed fake Pool/Client
service projections, aliases, fuzzy candidates and propose RETURNING/INSERT.
The fake mutation runner invokes the service callback only; it is not evidence
for authorization/transaction behavior, which belongs to gated DB test sources.

D3: gated sources add public edit→guest catalog/detail and admin detail,
omission/replacement/null, private value/timestamp preservation, version/stale
version, authorized replay and rejection after session revocation, audit/outbox
value exclusion, permission/authentication/CSRF/Origin/step-up rejection and
collision without publication. Fresh DB sources assert admin create rejection
and propose ignoring public/private contact input without storing either.
These are authored assertions, **never executed in this assignment**.

D4: consumer VenueSummary/Venue add an optional publicContacts field. Existing
`listAllCityVenues` already stores the complete returned venue object and required
no edit (`api-client.ts` is outside allowed_paths). VenueSheet independently
projects unknown input without a server import. The info section after
cover/name/address and before existing status/CTA contains «Контакты площадки»,
«Публичные контакты организации», safe tel text/link, site and messenger labels,
or «Публичные контакты не указаны». HTTP(S) links use _blank with noopener noreferrer;
tel does not open a new tab. No CSS, transport, Radar, filters or schedule changes.
New `venue-public-contacts.test.tsx` uses the real paginated API client with fetch
mock and real sheet under React server rendering, inspecting returned elements,
props, labels and order. It covers populated/old/missing/unsafe/partly safe values,
private-key exclusion, URL hazards, tel normalization and link attributes. Effects
and native browser focus are outside that harness and remain unverified.

## D5 — preserved history

All history below is **PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW**, not independently
reproduced here. No historical SHA is used as an additional Git input.

- #127 a1 `1b705883`: persistent guard across unmount; missing gesture/focus cases;
  empty schedules and retained sheet output assertions.
- #133 a1 `92fbb830`: embedded Tab boundary includes handle; cancel/lostcapture
  clear guard; horizontal rejection resets settlement; consume-once horizontal
  click and next-tap reset.
- #127 a2 `ae4df3f6`, Actions run39353858661/a1 job118404048646: obsolete navigation
  assertion and both shift=false/true Tab cleanup cases. Reportedly corrected by
  #131 a1 `62c78997`; reasons in M3-FIX-ci-tests.md.

Read references: TR1-M3-venue-sheet.md, M3-UAT-drag-cta.md and M3-FIX-ci-tests.md.
The existing `venue-sheet.test.tsx` and `venue-sheet-integration.test.tsx` are
unchanged, including their assertions. VenuePopup is unchanged. VenueSheet modal
handlers, shared capture-options object, embedded Tab boundary, cleanup, overflow,
focus restoration, state transitions and prior CTAs are unchanged.

## D6 — exact commands, exits and limits

All commands were attempted separately from repository root, offline; no install
or alternate network bootstrap was attempted. RUN_DB_INTEGRATION was explicitly 0
for the API test attempt. Source refinements after these attempts are likewise
not compiler/test verified; blocked tooling was not repeatedly retried.

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit 1 — NOT_TESTED

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit
exit 1 — NOT_TESTED

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-public-contacts.test.tsx test/venue-sheet.test.tsx test/venue-sheet-integration.test.tsx
exit 1 — NOT_TESTED

RUN_DB_INTEGRATION=0 COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run --project integration --no-cache test/integration/venue-contacts.test.ts
exit 1 — NOT_TESTED
```

All four emitted exactly:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Neither tsc nor Vitest started: required pnpm 10.18.0 is not locally available.
This is a tooling failure, not an observed application/test failure.

```text
node packages/contracts/scripts/check-openapi.mjs
exit 1 — NOT_TESTED
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@apidevtools/swagger-parser' imported from /srv/gobadminton-clean/worktrees/issue-134/packages/contracts/scripts/check-openapi.mjs
Node.js v24.21.0
```

The missing import stopped module loading; contract validation did not execute.
No generated files were written. No new any, TS suppression, skip or relaxed
compiler/check configuration was added. The existing DB gate remains intact.

`git diff --check`: exit 0, no output; whitespace only. No live/browser tests,
SQL execution, independent QA, product UAT or render parity verification occurred.

## STYLE_GUIDE_PARITY — UNVERIFIED

Binding Owner decisions read: OWNER_DECISION_MAP_POPUPS_V001.md (textual mockup
sufficient for scope) and OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md.
Documented canonical families: BottomSheet and ListRow, existing typography/media
and empty-state primitives. The info section uses existing sheet content elements
and styling; no new CSS, token, invented rating/facility/contact data or layout
system. Screen direction follows the mockup's contacts-before-CTA sequence.

Attempts to read `/opt/gobadminton-clean-qa/style-guide/manifest.json`, `src/App.tsx`
and `src/index.css` each returned `No such file or directory`. The referenced
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is also absent. Frozen Make
composition and rendered parity remain UNVERIFIED; no network/PLAN access was
used. Unavailability is **not** STYLE_GUIDE_GAP. No STYLE_GUIDE_GAP or
OWNER_VISUAL_OVERRIDE is asserted; these proposed primitive mappings need review.

## Compatibility, rollback and next bounded action

Public organization contacts are explicit opt-in data, independent of
contact_phone/contact_website/booking_note and players. Old API payloads and clients
remain supported through optional field/null handling. Migration has no backfill.
Application rollback reverses application/contract/UI code only and **retains
0038's column, CHECK/functions, ledger entry and all stored public data**. Do not
DROP the column or copy public/private values during rollback.

Integrator manually reconciles this base-scoped diff with newer dev, publishes
source plus this handoff with exact permalinks and gives the exact candidate to
independent QA with preinstalled dependencies. Required runtime/contract checks
and a visual/product review remain outstanding. DB tests remain NOT_TESTED for
this source-only author assignment; any later DB execution needs its own assigned
QA scope. No next feature or release is authorized by this artifact.
