# #406 public venue-cover response — release metadata alpha.42

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_MEASURED406_RELEASE42_METADATA_ONLY` · attempt 3.
Status: SOURCE_METADATA_COMPLETE / NOT_TESTED (author does not claim independent QA PASS, full CI, or DEV.42 ACCEPTED).
Exact base: `5a6a2ae238d0777e5000b65219e46c8d1df5746e`. Allowed paths only: release catalogue + this handoff. WebP feature / q-repair source and tests untouched.

## Prior chain (retained)

| Step | Fact |
| --- | --- |
| Independent QA pass 1 | P2 FAIL — malformed / out-of-range `Accept` `q` ignored (default weight 1). Retained. |
| Repair a94e | Strict `q` grammar + 8 targeted unit cases PASS (author). Combined candidate awaits final independent QA. |
| DEV alpha.41 | ACCEPTED: PR #502 / SHA `3dbf8e04b978ba5f8a0379379ef46b054008ec44` / `r42366434024-a1` / `accepted_at` `2026-11-07T11:13:52Z`. Full CI 7/7; images/health/meta/worker/push UI 4 cases PASS. |
| Public SPB 2-row identity | Applied separately with backup/CAS/audit/readback — not a new source feature of alpha.42. |

## This pass (metadata only)

| Path | Change |
| --- | --- |
| `apps/web/src/lib/releases.ts` | `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.42`; API contract stays `0.37.0`. Append exact trusted alpha.41 seed → **50** historical deployments (previous 49 preserved). Current named release: `source_sha` null, Owner UAT `NOT_TESTED`. |
| `apps/web/src/lib/releases.test.ts` | Literals track alpha.42 + alpha.41 seed date `2026-11-07T11:13:52Z`. |
| `apps/web/test/releases.test.tsx` | Seed length 45 / deployments 50; alpha.41 accepted assertions; current prose = WebP delta. |
| `apps/web/test/releases-server.test.ts` | Fifty deployments; accepted_at list appends `2026-11-07T11:13:52Z`; allowlist includes alpha.41. |
| `docs/handoffs/map406-venue-response.md` | This handoff. |

### Exact trusted alpha.41 seed (attached)

- SHA-256 of delivered seed JSON: `f3aeee64779b6655afa463edfd0bbeca23f087f93788db8930298ecc3a0fceaf`
- `source_sha`: `3dbf8e04b978ba5f8a0379379ef46b054008ec44`
- `release_id`: `r42366434024-a1`
- `accepted_at`: `2026-11-07T11:13:52Z` (literal date assertions unchanged otherwise)

### Russian product notes (alpha.42)

- Public venue photographs transferred as smaller WebP when the browser explicitly supports it; original PNG retained for others.
- Live moderation / availability checks and `no-store` maintained; game and player covers unchanged.
- Does **not** claim all 134 photos completed, full catalog prefetch, or map rewrite.
- Time/venue editing and related push remain deferred; iPhone / provider / Owner UAT: `NOT_TESTED`.
- Root local approved-photo check (1_054_377 → 46_230 B / 73 ms, visually reviewed) is lab context only — **not** installed Slow4G improvement; no invented speed numbers in product notes; no network PASS claim.

## Out of author path / Root gates

ONE source writer on allowed files only. No new deps / Git / network / runtime / paid tools from author. Independent QA on combined candidate → Product CI → DEV.42 smoke afterward (trusted process). No PROD. No merge/deploy from author.

## Checks

Author: release metadata + handoff only. Author self-check ≠ independent QA. UAT: NOT_TESTED.
