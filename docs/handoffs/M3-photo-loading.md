# M3-PHOTO #141 — source handoff

From: Codex, source author
To: GoBadminton integrator → independent QA
Date: 2026-10-20
Status: READY_FOR_REVIEW; execution checks NOT_TESTED (offline toolchain unavailable)

## Assignment and base

Exact assignment: supplied immutable GOBADMINTON_AUTONOMY_V1 task, source_only,
DEV, M3-PHOTO #141. Original task base:
`f50eb6f0f1703efabe86ef1de5b8f42948fc4497`, branch `automation/issue-141`.
Revision checkout: `e99a2f0aaae6497529c84b7631813a087f6d6ac7` (prior QA FAIL).
This revision removes name from resource identity and updates uploaded alt in a
commit effect. Unit and real-UI lifecycle regression cases cover name refresh
without another image or src assignment. Handoff trailing whitespace is removed.
Initial tracked diff was empty. Base reference:
https://github.com/anpavel84-afk/gobadminton-clean/tree/f50eb6f0f1703efabe86ef1de5b8f42948fc4497
Task reference: https://github.com/anpavel84-afk/gobadminton-clean/issues/141

Only the assigned source/test/handoff paths were written. No commit, push,
Git metadata write, dependency installation, remote check, service operation or
deployment was performed. Publication and an exact result-SHA permalink belong
to the integrator; this local handoff does not claim GitHub publication or Owner
acceptance. Newer DEV must be combined manually by the integrator.

## Changes / acceptance evidence

- D1: changed GamesMapView, VenuePreviewCard and VenueSheet; created
  `apps/web/src/components/consumer/venues/SelectedVenueCover.tsx`,
  `apps/web/test/selected-venue-cover.test.tsx`,
  `apps/web/test/venue-photo-lifecycle.test.tsx`, and this handoff.
  Preview/sheet accept optional coverSlot; existing VenueCover is their default.
  VenueSheet changes are confined to its prop/import/media slot.
- D2: the selection-scoped hook builds a pure resource in GamesMapView. Stable
  commit refs create an eager/async DOM img at first slot attachment, then move
  that same node between compact and info spans with appendChild. No React image
  children, portal, cloned image, preload, manual fetch or shared image cache.
  Unit tests describe normalization, metadata, lazy ordinary covers, same-resource
  rerender, loaded reopen identity, one creation and one source assignment.
- D3: listeners have source-generation and node-identity guards. Uploaded error
  switches once to the existing court fallback, retiring uploaded listeners;
  default error does not retry. Final slot detachment removes listeners/node/src
  via removeAttribute. Tests preserve and invoke stale listeners after source,
  selection, city, fallback and final-detach changes, including re-registration.
- D4: new lifecycle tests execute real GamesMapView/GamesVenueMap, VenuePopup,
  VenuePreviewCard, VenueSheet and SelectedVenueCover functions. The local
  node-environment harness provides independent hook storage per mounted function
  and detach/attach commit refs. Only transport, Next DOM/dynamic boundaries,
  MapLibre/PMTiles and DOM APIs are stubbed. The map container has zero width, so
  real GamesVenueMap runs without starting a network map. Selection enters via
  its real onSelect contract. Tests cover cold/loaded open-close-reopen,
  nonempty schedule output and info return, moving/settling, city switch and
  deselection cleanup; unselected images are not created.
  The harness is bounded evidence, not a browser renderer or independent QA.
  VenuePopup and all pre-existing tests remain unchanged, including gesture
  guards/reset/consume-once, dialog/handle boundary, capture options, Tab checks
  in both directions and navigation assertions. Contacts #134/PR140 are not
  implemented or reinterpreted by this slice; base UI/data/privacy are retained.
- D5: required commands were attempted separately from repository root; results
  below. No test PASS or typecheck PASS is claimed.

## Commands / exit / output

1. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false`
   — exit 1, NOT_TESTED; Corepack exited before TypeScript ran.
2. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx`
   — exit 1, NOT_TESTED; Corepack exited before Vitest ran.

Both commands emitted exactly:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

No installation/network workaround was attempted. Source and both tests remain
in the working diff. Tests use explicit checked indexing, no any, TS suppression,
non-null index assertions or skipped cases; project strict/noUncheckedIndexedAccess
configuration is unchanged. Their compilation and execution remain unverified.

3. Revision checks: `git diff --check` and
   `git diff --check f50eb6f0f1703efabe86ef1de5b8f42948fc4497`
   — each exit 0, no output. The latter includes the original implementation
   and handoff, addressing the prior QA whitespace finding. Files already exist
   in revision checkout; no staging was performed.

The two execution commands above were attempted again for this revision with
the same exit 1 and exact Corepack output. No independent self-QA was performed.

## STYLE_GUIDE_PARITY

STYLE_GUIDE_PARITY=UNVERIFIED.

Canonical text decisions read:
`docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md` and
`docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
Reused families: media/image block (MediaBlock), BottomSheet.
Existing cover classes preserve the compact 64px square and expanded 16:9 photo
before name/address/CTA. CSS, white surface and ink/lime tokens are unchanged.
No new composition, gallery, rating or amenities are introduced.

Frozen Make screen-specific composition: UNVERIFIED. Reads of
`/opt/gobadminton-clean-qa/style-guide/src/App.tsx` and `src/index.css` failed
with "No such file or directory". The referenced
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is also absent in this base.
No external PNG or network reference was fetched. No STYLE_GUIDE_GAP or
OWNER_VISUAL_OVERRIDE is claimed.

## Limitations / next bounded action / rollback

Browser/iPhone/flicker: NOT_TESTED; no timings or visual measurements.
Cold networks cannot be promised an immediately available image. This change
retains the selected DOM image across presentation transitions, including with
no-store media responses; it does not speed up the first network transfer.
API/DB/contracts/auth/NGINX/service worker and ordinary lazy VenueCover behavior
are outside the diff. No photo-specific timers are introduced.

Next action, integrator: publish this bounded candidate and handoff at an exact
SHA, combine with newer DEV if needed, then obtain independent QA and mandatory
Product CI on that exact integrated SHA. Re-run the two D5 commands with the
provisioned toolchain and inspect failures before acceptance. Author did not
launch remote checks. Preserve existing gesture/focus/navigation regression
assertions; author checks would not replace independent QA.

Rollback only this diff: reverse the changes in the three named existing
components and remove the new SelectedVenueCover, the two new tests and this
handoff if still exclusive to #141. Preserve unrelated integrator changes;
no reset/force-push or service rollback is authorized by this handoff.

Revision rollback: reverse only the uncommitted changes to SelectedVenueCover,
the two new-task test files and this handoff relative to
`e99a2f0aaae6497529c84b7631813a087f6d6ac7`; retain the original #141 implementation.
The full-slice rollback above is for the integrator only.

## CI repair — 2026-10-20

From: Codex, source author. To: integrator → independent QA.
Status: READY_FOR_REVIEW; typecheck and test execution NOT_TESTED.
Exact repair base/HEAD: `a1cd85eb8dad0edf4557fac726d630425f1ed68c`.
Initial tracked diff was empty. This addendum preserves the preceding attempt
history; no attempt counters are reset. Prior independent QA reported PASS on
that SHA, but the supplied CI report subsequently identified two test-harness
failures in source (web), run 39492337637 attempt 1 (Owner also referenced
run 39492347839 / job 118868513914).

Only `apps/web/test/venue-photo-lifecycle.test.tsx` and this handoff change:

- The async next/dynamic mock imports the real GamesVenueMap before returning
  it, avoiding access to the test module's uninitialized static import while
  GamesMapView initializes. The harness still executes the real map component.
- Tree traversal recognizes DOM hosts using `typeof value.type === "string"`;
  fragments still traverse their children without creating a host. This removes
  the invalid string/Fragment comparison without any or TS suppressions.

All assertions and implementation remain intact, including resource identity
by city/venue/URL without name and alt updates without another image. No visual
composition changes; STYLE_GUIDE_PARITY remains UNVERIFIED as recorded above.

Required local commands attempted separately from repository root:

1. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false`
2. `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/selected-venue-cover.test.tsx test/venue-photo-lifecycle.test.tsx`

Each exited 1 before TypeScript/Vitest execution, with the exact Corepack
download/network-disabled output recorded in the earlier Commands section.
Both are NOT_TESTED. No dependency installation or network workaround, remote
CI, independent self-QA, Git write, service operation or deployment was performed.
`git diff --check` exited 0 with no output for the repair diff.
Browser/iPhone/flicker remain NOT_TESTED.

Next bounded action: integrator publishes a new exact candidate SHA, obtains
new independent QA and full mandatory Product CI on that SHA. Earlier QA PASS
does not cover this repair. Rollback only these two files' repair changes
relative to `a1cd85eb8dad0edf4557fac726d630425f1ed68c`, preserving the candidate
and all prior fixes. Publication/permalinks remain the integrator's responsibility.
