# GoBadminton active backlog — clean reset, 2026-10-12

Existing production and automation remain unchanged. Historical task IDs, terminal QA verdicts and old SHA bindings are not adopted as live new-repo authority.

## P0 — Restore and diagnose PROD
1. Repair intermittent Moscow-to-Germany PROD API transport (local mTLS 18442, GoBadminton Xray/Gate). Product PM observed intermittent 503/TLS upstream handshake timeout for Profile/Games. Isolate direct Germany API vs Moscow tunnel before an authorized reversible change.
2. Verify real Profile/Auth/Games/Messages after Radar rollback; keep Radar disabled until transport and independent product QA are stable.

## P1 — Full DEV in Germany
3. Commission separately isolated DEV Next.js, API, PostgreSQL/PostGIS, media and synthetic users on Germany vmi3510488. DEV /v1 traffic stays on Germany; current Germany PROD API/database remain separate. Owner preview dev.gobadminton.ru.
4. Commission QA-backed automatic DEV delivery with exact source/image digest, smoke and rollback. DEV builders/agents must not exhaust Germany PROD resources.

## P1 — Restore the engineering and release pipeline
5. Reassess accepted legacy Runner PR229/230 source on the new baseline; obtain legitimate bounded host installer, nonauthor root QA identity and one authenticated Git/CAS writer. Never replay old trusted_job as fresh attestation.
6. Commission authenticated two-host release/rollback for Moscow PROD web and Germany PROD API; retain actual production DB and privacy restrictions.

## P2 — Product
7. Friends/social games and strict privacy QA on the new DEV; staged code, not live migration authorization.
8. Messaging/profile UX and remaining product defects from actual deployed-version smoke.

Rules: no test screenshots, archives or legacy queue dumps in Git. Store evidence in restricted files.anpavel.ru with per-file SHA256. OPERATOR_PAUSED stays in force; no VPN or unrelated services touched. Old PRs and QA records are archived references only.
