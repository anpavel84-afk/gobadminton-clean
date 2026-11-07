# #406 public venue-cover response bytes — source handoff

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_MEASURED_PUBLIC_VENUE_RESPONSE_BYTES_ONLY` · attempt 1.
Status: SOURCE_COMPLETE / NOT_TESTED (no author CI, DEV install, Slow4G smoke, or iPhone claim).
Exact base: `904621096874cbdadba0bd50bc3bd507edf97716` (PR502 child-base candidate; this writer did not touch ongoing PR502 / release metadata / runtime).

## Measured residual (alpha.40 cold install — input)

Source: `map406-gallery-timing-alpha40-pass2/timing-summary.json`
SHA-256: `096e9ef96d46bae2c9def1365bd81559fcfc8ec500e982cfaf750d0d145de701`

| Profile | Venue cover transfer | Decoded PNG | Photo visible |
| --- | ---: | ---: | ---: |
| COLD_NORMAL | 23.8 ms | 1_054_377 B | 731 ms |
| EMULATED_SLOW4G_150ms_1.6Mbps | **5555 ms** | 1_054_377 B | **8656 ms** (placeholder → photo 5617 ms) |

One existing approved venue photo PNG; placeholder immediate on Slow4G. Residual is transmission of original PNG bytes on public `GET /v1/media/venue-covers/:key`, not map/slider/fallback/catalog prefetch.

## Goal (bounded)

Compatible HTTP response optimization **only** for public venue-cover GET:

- After existing `AvatarService.readVenueCover` authorization, if `Accept` explicitly allows `image/webp` (not `q=0`), emit a bounded in-memory WebP derivative via already-installed `sharp`.
- Otherwise return original PNG bytes.
- Retain `Cache-Control: no-store`, add `Vary: Accept`, keep `nosniff` + CSP sandbox.
- Preserve stored PNG/key/moderation/hash/audit/rights; all profile/game cover routes unchanged; no disk cache, worker, DB, uploads, new deps, or provider calls.

## Source changes (allowed paths only)

| Path | Change |
| --- | --- |
| `apps/api/src/profiles/venue-cover-response.ts` | Pure Accept parser + `deriveVenueCoverWebp` (q≈82, effort 4, ≤5s, max 1200×400 without enlargement) + `resolveVenueCoverResponse` (conversion failure → original PNG). Wildcards do not imply WebP. |
| `apps/api/src/profiles/cover.controller.ts` | `readVenue` sets security headers + `Vary: Accept`, **then** `readVenueCover`, **then** resolve body/type. Auth/read errors propagate (never treated as image success). Profile `media/covers` untouched. |
| `apps/api/test/unit/venue-cover-response.test.ts` | Explicit WebP vs `q=0`/PNG/wildcards; photographic fixture dimension + valid WebP + substantial size cut; converter failure → PNG; controller: unauthorized read never resolves/transcodes/sends body; headers/no-store. |
| `docs/handoffs/map406-venue-response.md` | This handoff. |

## Author lab evidence (not DEV/CI)

Deterministic 1200×400 rich PNG fixture (same generator as unit test): PNG ≈1.44 MB → WebP ≈193 KB (~13% of PNG) at 1200×400 `image/webp`.
Unit: `pnpm exec vitest run --project unit test/unit/venue-cover-response.test.ts` → **6 passed** on this worktree (Node 24.5.0; pinned 24.21.0 not available here).

**Limits / non-claims**

- Does not claim all images, all clients, or iPhone physical improvement.
- Does not claim CI green, DEV ACCEPTED, or Slow4G smoke on the installed 1.05 MB photo.
- Clients without explicit `image/webp` keep full PNG (no wildcard assumption).
- Conversion CPU cost is per-request, in-process, after auth; no stale derivative after hide/unapproval (no cache).
- Expected Slow4G win is transfer-bound for WebP-capable browsers only; Root must re-measure same photo cold Slow4G before improvement claim.

## Out of author path / Root gates

ONE source writer done. Root independent QA + Product CI + installed same-photo cold Slow4G smoke before any improvement claim. Root integrates after real alpha.41; truthful alpha.42 metadata only if QA ready. No PROD. No merge/deploy from author.

## Checks

Author: bounded source + targeted unit only. Author self-check ≠ independent QA. UAT: NOT_TESTED.
