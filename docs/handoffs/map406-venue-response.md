# #406 public venue-cover response — bare-q Accept repair (pass 4)

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_MEASURED406_REPAIR_CONFIRMED_BARE_Q_PARSE` · attempt 4.
Status: SOURCE_REPAIR_COMPLETE / NOT_TESTED (author does not claim independent QA PASS, Product CI, or DEV.42 ACCEPTED).
Exact base: `e6e95ada016093d2b0ab2c89a98bc52d0761224b`. Allowed paths only: `venue-cover-response.ts`, unit test, this handoff. Release 42 metadata / trusted 41 seed / controller auth/media/storage/Vary/no-store untouched.

## Prior chain (retained)

| Step | Fact |
| --- | --- |
| Independent QA pass 1 | P2 FAIL — malformed / out-of-range `Accept` `q` ignored (default weight 1). Retained. |
| Repair a94e | Strict `q` grammar + targeted unit cases (author). Combined candidate awaited final independent QA. |
| Independent QA final (e6e95ada) | P2 FAIL — bare `q` without `=` (`Accept: image/webp;q` and case/whitespace variants) skipped via `eq <= 0 continue`, then default weight 1 selects WebP. Retained; not argued PASS. |
| DEV alpha.41 | ACCEPTED: PR #502 / SHA `3dbf8e04b978ba5f8a0379379ef46b054008ec44` / `r42366434024-a1` / `accepted_at` `2026-11-07T11:13:52Z`. Remains healthy installed DEV. |
| alpha.42 candidate e6 | Never published/installed. Future Product CI only after final independent repair acceptance. |

## This pass (bare-q parse repair)

| Path | Change |
| --- | --- |
| `apps/api/src/profiles/venue-cover-response.ts` | Local parser: bare parameter with exact name `q`/`Q` (trimmed) and no `=` invalidates that media item; does not pretend q absent. Plain `image/webp` still defaults to 1; valid positive q kept; q=0 / NaN / out-of-range / duplicate q still rejected. |
| `apps/api/test/unit/venue-cover-response.test.ts` | Focused bare `q`/`Q`/trim cases (≥8) + PNG fallback for bare-q Accept; prior PNG fallback and positive compatibility cases remain. |
| `docs/handoffs/map406-venue-response.md` | This handoff: two QA FAIL + current repair; no QA PASS claim. |

### Behaviour locked this pass

- Reject: `image/webp;q`, `image/webp;Q`, trimmed/` Q ` spellings, and same item with only PNG sibling.
- Keep: plain `image/webp` → weight 1; `image/webp;q=0.8` positive; bare non-`q` params ignored; valid sibling may still win.
- `resolveVenueCoverResponse` falls back to PNG for bare-q Accept (same as q=0 path).

## Out of author path / Root gates

ONE source writer on allowed files only. No new deps / Git / network / runtime / paid tools from author. No change to release42 metadata, trusted41 seed/history, controller auth/media checks/storage/Vary/no-store or other routes. Independent P2 recheck → existing CI → DEV pipeline (trusted process). No PROD. No merge/deploy from author.

## Checks

Author: focused unit suite for Accept parser + PNG fallback (self-check ≠ independent QA). UAT: NOT_TESTED. Independent QA must re-verify P2 bare-q finding; do not treat this handoff as PASS.
