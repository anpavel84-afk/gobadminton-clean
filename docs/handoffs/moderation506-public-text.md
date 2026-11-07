# Handoff · Issue #506 · MOD-V2-A public text (+ integrated #406 alpha.45 notes)

Combined Owner assignment
`OWNER506_406_INTEGRATED_ALPHA45_TEST_AND_RELEASE_NOTES_ONLY`, attempt 9.
Integrated HEAD `0a568b129abe45f06eede3d8a62843b3e098764c` already carries
#506 source `9f2f082e…` (independent source PASS + CI fixture-only pass 8)
and #406 UI `789f3a8d…` (independent QA accepted production repairs;
two remaining test findings fixed in this pass). One next alpha.45
candidate delivers BOTH. No production feature code in this pass —
tests + release notes only. Prior FAIL `42388403418` preserved.
No actual DEV.45 yet; installed remains alpha.44. UAT=NOT_TESTED.

## Proven Product CI failure (retained)

CI `42388403418` database job FAIL; other 6 jobs PASS.
Summary sha256 `c3801e05c3fd0fbd1147d12e4a3d1c9b97a5e8ee1cce11cbb0b4bd1e179e138c`.
Excerpts sha256 `cca20604ab55c4da073961feceb13ffaf16c59a9690cc7541b105a093daf6c8f`.
Fourteen fixture-only repairs from pass 8 remain unchanged; API/business
source not edited in this pass.

## This pass (allowed paths)

- `releases.ts` / release tests — SAME alpha.45 / API 0.37.0; title +
  fixes now include gallery skeleton/loading/error/empty and desktop
  arrows alongside the public-text addition. `source_sha` null;
  alpha.44 trusted history seed unchanged. No future B/C/D/#507 claim.
- Sibling #406 test gates: browser preflight no longer forbids
  `racket-v1.webp`; venue-sheet asserts neutral empty instead of legacy
  `data-cover="default"`. See `docs/handoffs/venue406-skeleton-arrows.md`.
- Handoffs link combined delivery; remaining gates stay with parent.

## Remaining gates (parent — not claimed here)

1. Affected types/lint + targeted suites (incl. venue-sheet; 163→164 PASS expected).
2. Native browser on actual VenueGallery loopback (script preflight unblocked).
3. Representative isolated PostGIS CI-fixture cases; original FAIL preserved.
4. Independent delta QA on this test/notes delta.
5. Full Product CI 7/7 → guarded DEV → server readback/smoke.
6. Owner UAT = NOT_TESTED until after DEV ACCEPTED.

## Still not claimed

- Overall PASS/DONE / independent QA PASS / CI 7/7 / DEV ACCEPTED
- Mode B binding / AGY author / PROD / fabricated acceptance dates
