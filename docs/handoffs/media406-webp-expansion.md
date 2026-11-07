# #406 controlled media PNG→WebP HTTP expansion (pass 5)

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_NEW_GO_CONTROLLED_PNG_MEDIA_WEBP_EXPANSION_AFTER_ACCEPTED42` · attempt 5.
Status: SOURCE_COMPLETE / NOT_TESTED (author self-check ≠ independent QA PASS; no Product CI / DEV ACCEPTED / PROD claim).
Exact base: `e073b5098ec9b4e8079ea5024c038136ab849d76` (isolated from #43 UI PR #504; that UI/metadata not modified).
Canonical Owner admission: comment `6706818638` on #406 (broad controlled media HTTP after accepted venue-only alpha.42). Prior local passes / QA FAIL / costs / receipts retained; no replay or budget reset.

## Truthful scope

| Fact | Value |
| --- | --- |
| Goal | Reduce **network** weight of active image GETs via Accept-negotiated WebP derivatives |
| On-disk originals | Unchanged (~67 PNG / ~49 MB server media remain approved audit material; no rename/copy/batch DB rewrite) |
| Not in this pass | Physical bulk PNG migration; map/MapLibre sprite PNG atlases; PWA platform icons; NGINX/manifest/static rewrite; SVG/vector; upload/input format change; #43 / next #44 metadata |
| Static web PNGs kept exact | 3 PWA icons (~22 KB); 26 map-sprite PNGs (~585 KB) outside app |
| Already non-PNG | 4 venue illustrations WebP; 2 discovery JPEGs |

Read-only inventories used: `runtime-readonly-aggregates.json`, `static-raster-inventory.json`, `map-technical-png.json` (delivered design-inputs).

## Implementation

| Path | Change |
| --- | --- |
| `apps/api/src/profiles/media-image-response.ts` | Shared Accept parser (alpha.42 rules: explicit webp / q=0 / bare q / wildcards), bounded Sharp presets (`avatar` 512×512 / 262144 px; `cover` 1200×400 / 480000 px), quality 82 / effort 4 / timeout 5s, `alphaQuality: 100`, no flatten; transparent sources use lossless WebP so alpha 0/partial/255 stay exact; opaque photos stay lossy |
| `apps/api/src/profiles/venue-cover-response.ts` | Thin backward-compatible exports (`clientAcceptsVenueCoverWebp`, `deriveVenueCoverWebp`, `resolveVenueCoverResponse`, dimension/quality constants) delegating to shared helper |
| `apps/api/src/profiles/avatar.controller.ts` | After existing `avatars.read` (status/restriction): negotiate; `Vary: Accept`; auth/read errors propagate (never PNG-fallback success) |
| `apps/api/src/profiles/cover.controller.ts` | Profile `media/covers/:key`: after `optionalSession` + `readCover`; `Vary: Cookie, Accept`. Venue route keeps qualified `resolveVenueCoverResponse` |
| `apps/api/src/games/game-cover.controller.ts` | After `optionalSession` + `covers.read`; `Vary: Cookie, Accept` |
| `apps/api/test/unit/media-image-response.test.ts` | Sharp-backed: avatar 512, cover 1200×400, photo weight ↓, exact alpha mask, PNG for no-webp/q0/bare-q/failure; controller negatives for avatar/profile/game |
| `apps/api/test/unit/venue-cover-response.test.ts` | Existing venue coverage retained (no rewrite of the 9-suite contract) |

## Invariants preserved

- Existing URLs / `.png` keys / files / approved hashes / attribution / GC / idempotency unchanged.
- Every GET authorizes and reads **before** derive; read/auth errors propagate; derive failure only then falls back to original PNG.
- `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, CSP sandbox kept.
- Avatars never pass through cover 1200×400 resize; covers retain 1200×400 limits; no enlargement.
- No new service/cache/storage pipeline/schema/dependency/rights; reuse sharp + shared response helper only.
- No fake Admin session or privacy weakening in tests.

## Checks (author self-check only)

- Unit: `venue-cover-response` + `media-image-response` (targeted).
- UAT: NOT_TESTED. Root owns actual HTTP/media/image browser smoke on DEV; private session / iPhone NT without authorized session.
- Independent QA → Product CI → DEV release (trusted process). No Git/merge/deploy/PROD from author.

## Out of path

ONE source writer on allowed files only. No #43 UI/metadata. No map/PWA/static PNG rewrite. No PROD. No new framework/negotiator/cache daemon.
