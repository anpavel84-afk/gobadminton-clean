# #488 / #509 · QA repair4 — supported image.decode + generation fence (PR #513)

From: Cursor Auto (sole source writer). To: independent QA / CI / parent.
Date: 2026-11-07. Status: SOURCE_REPAIR_CANDIDATE — author checks only; no push / DEV.49 / GoBad PASS.
Assignment: `OWNER488_QA_SUPPORTED_IMAGE_DECODE_GENERATION_FENCE_REPAIR` attempt 4.
Base: `a88f3f8d9dd63dcc9e1f88a5baaa3ef2f4f0cb55`. Same PR #513. No next alpha.50; alpha.49 not accepted.

## Independent Sol Medium delta (actual final JSON)

- `coverReady` / `getReadySnapshot` claimed decoded readiness, but `applyLoad` marked `loaded` on `load` / `complete && naturalWidth > 0`.
- With `decoding="async"` those signals do not guarantee decode completion; caption could ready before the raster is decoded.

## Fix (allowed paths only)

| Path | Change |
| --- | --- |
| `SelectedVenueCover.tsx` | When `typeof image.decode === "function"`, mark loaded/paint/emit only after successful `decode()` with image / generation / src / attached-slot guards; dedupe concurrent decode per generation; decode rejection → existing `applyError`; no-decode engines keep honest load/complete fallback (documented, not a strict decode claim) |
| `selected-venue-cover.test.tsx` | Keep all prior F1 / morph / spacing cases on FakeDOM without `decode` (fallback contract); add controlled-`decodePromise` cases: pending until resolve, rejection→failure/retry, obsolete completion after new venue/release ignored, cached complete + compact→sheet one node |
| `venues488-photo-credit-import.md` | This handoff |

Constraints kept: one physical img; no new loader/media architecture; no src/network duplicates; no unbounded retry/scheduler; Ready forwarding in GamesMapView / VenuePreviewCard / VenueSheet unchanged; no OpenAI/API/publication/worker/M1; no PROD/C5/alpha.50.

## Author checks (not Product CI / not independent QA)

Targeted: `selected-venue-cover` (+ gallery via same file) and web typecheck if tooling available.
Parent runs full Web once for the async loader change. No fake full-CI / DEV.49 / GoBad PASS.

## Honest status

- Prior CI repair3 readiness wiring retained; this repair closes the decode-vs-load gap only.
- Installed DEV.48 source `608f44e9` accepted; source.49 not deployed; Product CI web FAIL history preserved.
- Admin UI / Owner / GoBad UAT: **NOT_TESTED**. Private egress OFF. PROD/C5/slots untouched.
