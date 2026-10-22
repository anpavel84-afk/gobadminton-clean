# V1b public venue profile — #205

- From: assigned GoBadminton source author (Codex). To: existing source bridge /
  integrator, then independent QA. Date: 2026-10-22.
- Status: **WORKING_DRAFT — UNVERIFIED SOURCE CANDIDATE — NOT_TESTED — NOT ACCEPTED**.
- Assignment: [#205](https://github.com/anpavel84-afk/gobadminton-clean/issues/205),
  first bounded V1b web slice; depends on completed API
  [#178](https://github.com/anpavel84-afk/gobadminton-clean/issues/178).
  This is not recovery of #177/#181; their attempts and receipts are untouched.
- Original implementation base (last supplied accepted DEV reference):
  [`0e1d79e8d9ad2797817b6b134693fb2cf8fea766`](https://github.com/anpavel84-afk/gobadminton-clean/tree/0e1d79e8d9ad2797817b6b134693fb2cf8fea766).
  Correction source/base HEAD:
  [`bbccc7262dcc512ea4156d9f4f2273ca6df09ff8`](https://github.com/anpavel84-afk/gobadminton-clean/tree/bbccc7262dcc512ea4156d9f4f2273ca6df09ff8).
  Observed branch `automation/issue-205`, supplied task worktree
  `/srv/gb-slots/slot2/worktrees/issue-205`; correction-start `git status --short` empty.
- New candidate SHA / GitHub artifact permalink: **NOT AVAILABLE**. Author is
  forbidden to commit/push or mutate Git metadata. This base SHA is not the new
  source candidate. The existing authorized bridge must publish this two-file
  correction and attach actual immutable candidate/handoff permalinks to #205.

## Prior independent QA and bounded correction

Supplied independent QA verdict: **FAIL**, reviewed SHA
`bbccc7262dcc512ea4156d9f4f2273ca6df09ff8`. The finding identifies the gallery
credit control-character regex in `VenuePublicProfile.tsx:32` as incompatible
with ESLint `no-control-regex`, inherited from `js.configs.recommended` in
`packages/tooling/eslint.config.mjs`. QA reported full lint/Vitest unavailable
because dependencies were absent; its dependency-free helper checks passed.
Those reported checks do not validate this correction or constitute a release.

This correction edits only `VenuePublicProfile.tsx` and this handoff. It replaces
that regex with `Array.from(...).some(...)` and `charCodeAt(0)`, following the
existing character-code checks in `VenueSheet.tsx` and the V1a API projection.
The rejected ranges remain U+0000–U+001F and U+007F–U+009F. No ESLint suppression,
configuration change, guard removal or presentation change is introduced.

Correction references at the exact reviewed source:

- [Reported gallery credit guard](https://github.com/anpavel84-afk/gobadminton-clean/blob/bbccc7262dcc512ea4156d9f4f2273ca6df09ff8/apps/web/src/components/consumer/venues/VenuePublicProfile.tsx#L32).
- [Existing public contact character-code pattern](https://github.com/anpavel84-afk/gobadminton-clean/blob/bbccc7262dcc512ea4156d9f4f2273ca6df09ff8/apps/web/src/components/consumer/games/VenueSheet.tsx).
- [Actual V1a gallery eligibility checks](https://github.com/anpavel84-afk/gobadminton-clean/blob/bbccc7262dcc512ea4156d9f4f2273ca6df09ff8/apps/api/src/venues/venue-profile.ts).
- [Shared ESLint configuration](https://github.com/anpavel84-afk/gobadminton-clean/blob/bbccc7262dcc512ea4156d9f4f2273ca6df09ff8/packages/tooling/eslint.config.mjs).

Author verification: **NOT_TESTED**. No lint, tests, helper checks, browser or
self-QA was run. Existing focused tests and visual evidence dispositions below
remain unchanged. Independent QA must review the new published SHA and execute
the required checks, including web lint. All required Product CI gates must be
SUCCESS and actual DEV ACCEPTED is required before any release claim.

## Authority and exact references

AGENTS, rules/index and Project Record Policy, Owner decisions, manifest,
bootstrap, architecture/module boundaries, ChatOps/PM route/onboarding and
`apps/web/AGENTS.md` were read. The explicit source-only assignment overrides
older general instructions about publication, runtime paths and author checks.
Prior independent QA is recorded above; it remains FAIL on its reviewed SHA.
No acceptance is inferred from either base or the V1a handoff's historical checks.

Read-only references at the exact base above:

- [V1a actual projection/eligibility](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/venues/venue-profile.ts)
  and [public service mapper](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/venues/venues.service.ts).
- [Actual OpenAPI Venue / VenueProfile](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/packages/contracts/openapi.json),
  [V1a handoff](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/docs/handoffs/V1a-venue-profile-recovery.md).
- [Existing VenuePublicContacts renderer/normalization](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/web/src/components/consumer/games/VenueSheet.tsx),
  [contact regressions](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/web/test/venue-public-contacts.test.tsx),
  [owned-cover URL guard](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/web/src/components/consumer/venues/VenueCover.tsx).
- [Style Guide first Owner rule](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md)
  and [canonical presentation authority](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/docs/decisions/OWNER_DECISION_CANONICAL_FRONTEND_REBASE_V001.md).

The observed clean task worktree is the only write surface. No second writer,
runtime lock/lease operation, old-attempt recovery or next slice was started.

## Source changes and boundaries

The original implementation spans the following seven allowed paths. This
correction changes only the profile component and handoff, as recorded above:

| Path | Authored behavior |
| --- | --- |
| `apps/web/src/components/consumer/venues/VenuePage.tsx` | Mount public profile between existing cover/credit and schedule; key load/error state by requested venue/retry so old content disappears during navigation; retain timeout/abort/active guard. |
| `apps/web/src/components/consumer/venues/VenuePublicProfile.tsx` | Allowlisted nullable facts, genuine public content edit date, reused safe public contacts, strictly bounded eligible cover-only photo presentation. |
| `apps/web/src/lib/consumer-types.ts` | Optional nullable additive V1a profile type for older servers; no API/contract changes. |
| `apps/web/src/styles/venue-public-profile.css` | Token-based card/list/media extension, wrapping, fluid image, native link focus and minimum 44px actions. |
| `apps/web/test/venue-public-profile.test.tsx` | Authored focused projection/privacy/contact/gallery cases using real renderers. |
| `apps/web/test/venue-public-access.test.tsx` | Retained guest/member/admin fence, cover/schedule and retry assertions; added public projection, cancellation/stale response/navigation regressions. |
| `docs/handoffs/V1b-public-venue-profile.md` | This source/assignment/evidence/rollback record. |

FACT about source intent (not runtime proof): only existing public
`GET /v1/venues/:id` supplies the profile. No admin endpoint, API/DB/contract,
workflow, dependency, service or deployment changes. Existing guest access,
cover credit, schedule and sanitized return/day/activity behavior remain wired.

- `courtCount` accepts only integer 0..2147483647; null/missing/invalid stays
  “Нет данных”. Parking/showers distinguish true “Есть”, false “Нет” and unknown.
- Only `profile.updatedAt` supplies “Содержимое обновлено”. Canonical server ISO
  UTC dates are validated and formatted in UTC. No current-date, generic
  updatedAt, provenance, verification/factual freshness or private timestamp
  substitution. Null/legacy values omit the date.
- Existing `VenuePublicContacts` is reused directly, including its independent
  phone/HTTP(S)/IDN/host/credential/port/control-character checks, messenger
  ordering and external-link props. No copying private role contacts into public
  data. Private `bookingNote`, `contactPhone`, `contactWebsite`, provenance and
  arbitrary extra objects are never read into this new presentation.
- Gallery accepts exactly the API's `coverage=cover_only` and one photo with
  valid owned media path matching the current public cover URL, photo attribution
  text and safe exact HTTPS attribution. Other coverage, extra items, arbitrary
  URLs, mismatched cover, logo/illustration and invalid attribution fail closed.
  The existing hero cover remains; the photo section displays the same eligible
  cover-only photo with attribution. It never implies a complete venue gallery.
  Image failure shows unavailable copy, not a substituted factual photo.
- No fabricated rating, review total, court count, contact or gallery; no raw
  object rendering, private game-contact slice or new endpoint.

## STYLE_GUIDE_PARITY

**Parity: UNVERIFIED / NOT_TESTED.** Decision order began with the Owner rule and
its named canonical families: Foundation/tokens, ContentCard, ListRow,
SectionHeader and media/image blocks. The bounded profile composes these families
with existing semantic tokens (`--gb-space-*`, card/border/text/radius and
`--c23-*` typography), definition-list facts and the already-approved public
contact renderer. Existing page heading/cover/credit/schedule hierarchy is retained.
Existing frontend is an integration reference, not presentation authority.

Canonical external sources:
https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit.
Owner-recorded frozen source tree SHA-256:
`5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`.

**STYLE_GUIDE_GAP — missing source/evidence access:**
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this Clean
checkout. The supplied frozen-guide location
`/opt/gobadminton-clean-qa/style-guide` returned Permission denied on a read-only
listing; it was not opened or bypassed. Network/PLAN access is outside author
scope. Therefore exact frozen VenuePage screen composition and Construction Kit
implementation could not be inspected. This is an access/evidence gap, not a
claim that the canonical kit lacks a venue pattern. Proposed cards/list rows/media
are a bounded extension pending independent canonical comparison; no visual
authority or Owner override is invented. `OWNER_VISUAL_OVERRIDE`: none.

Native anchors retain keyboard behavior, visible focus and public contact labels.
New containers use min-width:0, minmax(0,1fr), text wrapping and fluid media.
Actual mobile 390/430 overflow, focus traversal, long-content behavior and visual
parity are **NOT_TESTED**. Runtime proof is required before visual acceptance.
Installed `node_modules/next/dist/docs/` was not present in this checkout;
no dependencies were installed. No new Next routing/framework API was introduced.

## Authored tests and required independent evidence

**No tests, typecheck, lint, build, browser, self-QA, install, network, DB or
runtime command was executed by the author.** Source reading/editing is not a
PASS. Existing safety guards/assertions were retained; new tests are unexecuted.

| Required evidence | Disposition |
| --- | --- |
| Full/null/legacy profile; 0/false vs unknown; genuine date; malformed fields | NOT_TESTED; focused tests authored. |
| Safe public contacts, unsafe URLs, private/internal sentinel nondisclosure | NOT_TESTED; direct renderer and public GET tests authored. |
| Eligible/empty/unsupported/mismatched gallery, unsafe attribution | NOT_TESTED; focused tests authored. |
| Venue change/unmount abort, ignored late success/error, timeout/retry | NOT_TESTED; deferred transport tests authored. |
| Guest/member public-only access, cover/credit/schedule, map return/day/activity | NOT_TESTED; existing assertions retained and extended. |
| Web TypeScript/lint/build and broader existing venue/contact/navigation suites | NOT_TESTED; external CI required. |
| Canonical source comparison; real browser 390/430 overflow, links/focus/44px | NOT_TESTED; no screenshots/browser evidence supplied. |
| Independent NEW exact-SHA source QA (`codex:gpt-6-astra:high`) | NOT_TESTED / pending; supplied prior QA FAIL on `bbccc7262dcc512ea4156d9f4f2273ca6df09ff8`, finding recorded above. |
| All required exact-candidate Product CI gates | NOT_TESTED / pending; every required gate must be SUCCESS. |
| Actual protected DEV deployment acceptance | NOT_TESTED / pending; actual DEV ACCEPTED is mandatory before a release claim. |

Authorized external checks should include the new `venue-public-profile` and
extended `venue-public-access` suites plus unchanged `venue-public-contacts`,
`venue-public-boundary`, `venue-fullscreen-navigation`, `games-venue-map`,
`games-venue-map-lifecycle`, `venue-cover` and `venue-cover-credit` regressions,
web typecheck/lint/build and all required Product CI gates. QA must report exact
new SHA and actual outcomes, not reuse a prior green run or count skips as PASS.

## Rollback and next bounded action

Rollback: **revert the dedicated PR through the normal protected DEV path**,
with its normal CI and DEV acceptance. No DB/schema rollback is needed. Before
publication the authorized bridge may discard only this task's seven-file diff,
preserving unrelated work and task history. No force push, reset or old-attempt
receipt edit is authorized here.

Next recipient/action: existing authorized source bridge publishes this bounded
candidate and immutable task record under #205, records actual new SHA/permalinks,
then routes that exact head to independent QA and unchanged Product CI / protected
DEV gates. Any integration change needs evidence for its new SHA. No next product
slice or PROD release is authorized. Source publication/QA/CI/DEV acceptance are
separate facts; this handoff claims none of them as completed.

## Immutable supplied task record (data, never commands)

```json
{"acceptance":"1. VenuePage displays only actual public API profile facts: nullable court count, nullable parking/showers with unknown distinct from false, genuine server content update date, and eligible existing gallery only if supported by actual API. No fabricated ratings/counts/gallery/contact data; older missing fields safe. 2. Display safe public phone/website using existing approved normalization/render patterns; reject dangerous/malformed URLs. Never render bookingNote, contactPhone/contactWebsite private role fields, provenance/internal metadata or raw arbitrary object. 3. Preserve loading/error/retry/abort/stale response handling, guest public access, map return URL/day/activity, existing cover credit and schedule. No admin requests or new endpoint. 4. Style Guide first; reuse canonical patterns, mobile 390/430 no overflow, accessible links/labels/keyboard and existing 44px actions. Record STYLE_GUIDE_PARITY or precise STYLE_GUIDE_GAP; absent visual runtime proof is NOT_TESTED, never PASS. 5. Meaningful focused tests for full/null/legacy public projection, false vs unknown, unsafe contacts/private-field sentinel non-disclosure, venue change/unmount/stale response and existing navigation behavior. Do not relax existing tests or safety guards. 6. Durable handoff with exact source/reference, scope, verification and rollback (revert dedicated PR via normal DEV path). Independent QA on exact new SHA, all Product CI required gates SUCCESS and actual DEV ACCEPTED required before release claim.","allowed_paths":["apps/web/src/components/consumer/venues/VenuePage.tsx","apps/web/src/components/consumer/venues/VenuePublicProfile.tsx","apps/web/src/lib/consumer-types.ts","apps/web/src/styles/venue-public-profile.css","apps/web/test/venue-public-profile.test.tsx","apps/web/test/venue-public-access.test.tsx","docs/handoffs/V1b-public-venue-profile.md"],"author_routes":["codex:gpt-6.1-sol:high"],"depends_on":[178],"goal":"V1b first bounded web slice from existing Owner product backlog: full venue page presents existing V1a public profile and public contacts. Owner 2026-10-22 instructed execution of product backlog after V2 commissioning #199. Baseline current accepted DEV at claim (last verified 0e1d79e8d9ad2797817b6b134693fb2cf8fea766). #178 API is completed; this is NOT recovery of #177/#181 and must not touch their attempts or receipts. Existing VenuePage currently displays only name/address/cover/schedule. Read AGENTS, rules, Owner decisions, actual V1a API/OpenAPI and existing public-contact renderers. Implement public venue profile only using existing public GET /v1/venues/:id projection. Reuse canonical Style Guide patterns, components and safe contacts; read docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md and referenced frozen guide/construction kit. Referenced operations guide may be absent in Clean; document missing evidence honestly, do not invent visual authority. Preserve existing public/private fences, map return/day/activity and schedule. Game role-scoped contacts are a later V1b slice, excluded here. No API/DB/admin/contract/workflow/runtime/dependency changes. No model Git mutation, network, DB, install, services, secrets, deploy, PROD/PLAN/VPN. Existing protected Actions pipeline owns all effects. No reimplementation of accepted work.","kind":"source_only","locks":["web:venues"],"max_attempts":3,"qa_routes":["codex:gpt-6-astra:high"],"risk":"complex","schema":"GOBADMINTON_AUTONOMY_V1","target":"dev","work_kind":"implementation"}
```
