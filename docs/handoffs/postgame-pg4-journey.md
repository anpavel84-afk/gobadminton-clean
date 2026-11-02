# Issue #372 / PG-4 connected private history journey — Mode A author handoff (pass 2)

From: Cursor Auto (`OWNER_APPROVED_PG4_TARGETED_QA_REPAIR_AND_ACTUAL_RELEASE_HISTORY`, attempt 2, base `6aaf2501271b2493dbf71c5fdd28da10f862ca19`).
To: one independent Codex Sol Medium QA → mandatory Product CI → trusted DEV release/smoke → Owner UAT.
Status: **SOURCE CANDIDATE repaired** / UAT=**NOT_TESTED** / **alpha.13 NOT installed** / no DEV ACCEPTED claim for 13 / no PROD.
Parent #372 PG-4 UI slice. Typed Safety complaint extension **remaining** (handoff only). Public comments #394 later. Mode B binding NOT claimed. Author checks ≠ independent QA.
C5 OFF. Antigravity Author not required. API contract note remains `0.23.0` (unchanged).

## QA FAIL preserved (pass 1)

Independent Codex Medium QA1 on `6aaf250…`: verdict **FAIL**, four P2 (MyGames dual-tab bucket; managed orphan leak; received `recipientDisplay` as author-like; release alpha.12 notes / missing alpha.13 prep). Raw usage / FAIL JSON retained upstream; not reset (OD-016).

## Four finding repairs

1. **MyGames bucket on public getGame 404** — confirmed participation with past authoritative own `endsAt` leaves Upcoming; appears once in History. Bucket uses own server timestamp only; invalid/missing stays unknown; covered ids prevent orphan duplicate.
2. **History «Управляю»** — orphan own participant results no longer leak into managed view (own projection ≠ manager proof). Negative case covered in tests.
3. **GameReviewsHistory received** — `recipientDisplay` is viewer-recipient; omitted on received. Sent may label `для {recipient}`. No author DTO extension.
4. **Release metadata** — HistoricalReleaseSeed for accepted alpha.12 (`6383ef4…`, `r41368959239-a1`, `2026-11-02T00:59:40Z`, exact digests, API `0.23.0`). `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.13`; `CURRENT_NAMED_RELEASE` Russian PG-4 history delta; `source_sha: null`; UAT `NOT_TESTED`. User-facing notes without Safety/PG-4/PROD jargon.

## Author checks run

```text
apps/web: vitest run test/my-games-results.test.tsx test/game-reviews-history.test.tsx test/releases.test.tsx test/releases-server.test.ts
→ 4 files / 35 tests PASS

apps/web: TMPDIR=<work>/.tmp tsc -p tsconfig.json --noEmit --incremental false
→ exit 0
```

Native DONE for this source repair only — no publish / no DEV install from author / alpha.13 **not installed**.

## Residual / explicit non-claims

- Typed review-specific Safety extension — **REMAINING** (outside this UI slice; technical tail only here)
- Authorized browser Owner UAT — **NOT_TESTED**
- Alpha.13 — **not installed** / no guessed runtime acceptance
- Public comments #394 — later
- Full PG-3/PG-4/parent DONE — **not claimed**
- PROD / main / C5 / Mode B READY — **not claimed**

## Allowed paths touched

`MyGamesPage.tsx`, `GameReviewsHistory.tsx`, `game-results.ts`, focused tests (`my-games-results`, `game-reviews-history`, `releases`, `releases-server`), `releases.ts`, `docs/releases/CHANGELOG.md`, this handoff.
