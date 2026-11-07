# #498 — late valid map load recovery (point 3)

Refs: Owner remaining-backlog train assignment `OWNER_REMAINING_TRAIN_MAP498_RECOVER_LATE_VALID_LOAD`; visual-qa / Go Bad report on DEV `298917fe` (alpha.38); PMA Chromium diagnosis.

## Point 3 — fixed (source)

**Fault:** Startup uses a bounded 20s timeout. When `style-dev.json` (or init) finishes after that budget, MapLibre still reaches a real `load` for the current city/attempt (`ready`/`settled`/markers), but `fatal` from the timeout left the error card («Карта не загрузилась / Карта не ответила вовремя»), list fallback, and disabled filters in place until manual «Повторить».

**Repair (small control-flow only):** Keep showing the existing timeout card while style/init is still pending. When the **current** attempt’s MapLibre `load` fires for that same effect lifecycle, clear a prior **timeout** failure and restore availability. Genuine fatal style-hash / origin / resource-policy, WebGL/init/module failure, retry, unmount/city fences, and radar-on-real-ready are unchanged. Markers alone do not clear failure. The 20s budget is not increased; the warning is not hidden in CSS.

**Regression:** `apps/web/test/games-venue-map-lifecycle.test.tsx` — 20s timeout → late current `load` → banner removed + availability restored. Existing true-fatal / retry / context-loss / city-switch / unmount cases retained.

**Files:** `GamesVenueMap.tsx`, `games-venue-map-lifecycle.test.tsx`, this handoff.

## Points 1 / 2 / 4 — not claimed PASS

PMA cold Chromium on DEV38/`298917fe` did **not** reproduce idle venue polling bursts, multi-request focus coalescing defects, or a separate fullscreen city selector in the current DOM. Go Bad findings for 1/2/4 remain open / auth-pending; this pass does **not** rewrite polling, coalescing, or city selection, and does not declare those PASS.

## Evidence limits

- Fix targets the confirmed timeout→late-valid-`load` state stickiness (fault injection in the lifecycle harness + PMA late style observation). It does **not** claim identity with every genuine network latency profile beyond that control-flow path.
- No release-catalogue / alpha.39–40 metadata in this pass; follow-up release notes must use the actual DEV39 receipt only.
- No LIVE deploy/API/DB/Git/model calls in this author pass. Independent QA + Product CI + DEV smoke remain required before DONE.
