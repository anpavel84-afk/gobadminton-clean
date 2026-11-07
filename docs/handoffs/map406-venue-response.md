# #406 public venue-cover response bytes — source handoff

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_MEASURED406_REPAIR_CONFIRMED_ACCEPT_Q_VALIDATION` · attempt 2.
Status: SOURCE_REPAIR_COMPLETE / NOT_TESTED (no author CI, DEV install, Slow4G smoke, or PASS claim).
Exact base: `aa4f2a60bcb71fc7e8a5c43133769e32f6bcf1bf` (independent release #41 uninvolved; #42 metadata not now).

## Independent QA FAIL (pass 1 → this repair)

Reviewed SHA: `aa4f2a60bcb71fc7e8a5c43133769e32f6bcf1bf`
Verdict: **FAIL** (P2). Not PASS.

Finding: malformed / out-of-range `q` was ignored, leaving default weight 1 — e.g. `Accept: image/webp;q=NaN` or `q=2` still selected WebP without a valid positive weight. Such variants must be rejected for that explicit media item; address with focused tests.

QA limits (unchanged): source + saved logs only; DEV / real browser / Slow4G on approved photo not checked by QA.

## Repair (attempt 2 — allowed paths only)

| Path | Change |
| --- | --- |
| `apps/api/src/profiles/venue-cover-response.ts` | Strict RFC 9110-style `q` grammar (`0[.ddd]` / `1[.000]`, ≤3 fractional digits). Malformed, out-of-range, nonfinite, or duplicate `q` on that `image/webp` item is skipped (no fallback to default 1). Honour `q=0`. PNG fallback + derive path unchanged. |
| `apps/api/test/unit/venue-cover-response.test.ts` | Focused cases: `q=NaN` / `2` / `-1` / `Infinity` / `garbage` / overlong fraction / `1.1` / duplicate `q` → reject; `q=0` / `q=0.5` / `q=1.000` behaviour preserved; consent/security/read-order/fallback tests untouched. |
| `docs/handoffs/map406-venue-response.md` | This handoff: records QA FAIL + repair; no PASS / CI / DEV claim. |

No controller / media / service / storage / profile / game / release metadata changes.

## Prior measured residual (alpha.40 cold install — context only)

Source: `map406-gallery-timing-alpha40-pass2/timing-summary.json`
SHA-256: `096e9ef96d46bae2c9def1365bd81559fcfc8ec500e982cfaf750d0d145de701`

| Profile | Venue cover transfer | Decoded PNG | Photo visible |
| --- | ---: | ---: | ---: |
| COLD_NORMAL | 23.8 ms | 1_054_377 B | 731 ms |
| EMULATED_SLOW4G_150ms_1.6Mbps | **5555 ms** | 1_054_377 B | **8656 ms** (placeholder → photo 5617 ms) |

Root lab note from prior pass (not republished here): approved photo local check aa4f → 1_054_377 PNG → 46_230 WebP in 73 ms; screenshot quality review done; **not** published / network smoke yet.

## Goal (bounded — unchanged product intent)

Compatible HTTP response optimization **only** for public venue-cover GET:

- After existing `AvatarService.readVenueCover` authorization, if `Accept` explicitly allows `image/webp` with a **valid positive** weight (not `q=0`, not malformed), emit a bounded in-memory WebP derivative via already-installed `sharp`.
- Otherwise return original PNG bytes.
- Retain `Cache-Control: no-store`, add `Vary: Accept`, keep `nosniff` + CSP sandbox.
- Preserve stored PNG/key/moderation/hash/audit/rights; all profile/game cover routes unchanged; no disk cache, worker, DB, uploads, new deps, or provider calls.

## Limits / non-claims

- Does **not** claim independent QA PASS after this repair (re-review required).
- Does **not** claim CI green, DEV ACCEPTED, Slow4G smoke, or iPhone physical improvement.
- Clients without explicit valid `image/webp` keep full PNG (no wildcard assumption; invalid `q` does not unlock WebP).
- Conversion CPU cost is per-request, in-process, after auth; no stale derivative after hide/unapproval (no cache).
- Expected Slow4G win remains transfer-bound for WebP-capable browsers only; Root must re-measure same photo cold Slow4G before improvement claim.

## Out of author path / Root gates

ONE source writer on allowed files only. Root independent QA + Product CI + installed same-photo cold Slow4G smoke before any improvement claim. Truthful alpha.42 metadata only after actual #41 accepted — not this pass. No PROD. No merge/deploy from author.

## Checks

Author: bounded Accept-`q` repair + focused unit cases only. Author self-check ≠ independent QA. UAT: NOT_TESTED.
