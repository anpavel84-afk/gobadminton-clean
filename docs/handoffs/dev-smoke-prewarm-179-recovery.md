# GoBadminton CLEAN · DEV release recovery for #179 · prewarm smoke browser first

Status: **TARGETED RELEASE PIPELINE FIX — CI/DEV PENDING**  
Date: 2026-10-22  
Scope authority: Owner directly authorized repairing compact venue popup #179 and immediate normal DEV release, **not** a new train architecture or PROD. This change is limited to the current DEV/PROD shared script's preparation ordering; no PROD release is triggered.
Base: current `dev` commit when branch was created (contains merged swipe V3 `ae2f9125622d0277d6d4f259522377fd3a32be35`).
Issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/179

## Incident: DEV run #39768116687 failed and automatically rolled back
- GitHub Actions run: https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39768116687
- Product CI for swipe UI PR #190: SUCCESS after legitimate retry of flaky unrelated `venue-profile.test.ts` integration timestamp comparison. No tests bypassed.
- Deployment `r39768116687-a1` temporarily applied `ae2f9125`; live `/v1/meta` returned exactly this SHA while the workflow remained pending.
- Receiver smoke deadline `1792667739` = 2026-10-22 11:15:39 UTC; auto-rollback `1792667780` = 11:16:20 UTC.
- GitHub runner spent over six minutes in `playwright install --with-deps chromium` **after** sending the deploy request. Chromium installation finished ~11:17:26 UTC; `smoke.mjs` then observed old restored SHA `645490379034a205eb43c941ea86c4ff6be90c76` vs expected `ae2f9125`, failed; receiver reported `status:ROLLED_BACK`.
- Thus the failure is **ordering of existing prerequisites against watchdog**. It is not evidence that swipe UI was broken or accepted. Owner has NOT yet seen V3 as a fully accepted DEV release.

## One bounded correction
In existing `scripts/chatops/deploy.sh` only:
- Retain **exact pinned** `playwright@1.56.1`, `npm install --ignore-scripts --no-audit --no-fund`, and `playwright install --with-deps chromium` on ephemeral GitHub runner.
- Move those already-required installation lines **before** constructing/sending the first authorized SSH receiver `action:deploy`, so no pending-smoke watchdog clock is running while installing OS libraries.
- Keep all existing manifest/sha/digest checks, SSH restrictions, deploy receiver, smoke script, accept receipt, rollback trap, and timeout unchanged.
- No new workflow, runner, queue, API, database, model agent, or architecture.

## Required evidence and acceptance
1. Product CI, bash syntax and existing client/receiver checks PASS.
2. On normal `dev` merge, Actions checks/images/deploy all SUCCESS; smoke must run against exact live gitSha; deploy must receive genuine `ACCEPTED`, without rollback, and `/v1/meta` SHA must match release commit.
3. No separate DEV site, no browser on VPS (existing browser-smoke is on GitHub runner), no PROD or PLAN changes.
4. **Owner iPhone UAT of swipe remains PENDING**. #179 stays OPEN until Owner accepts. If swipe still fails, obtain concrete iOS event trace before further guesses.
5. Rollback: revert only release client script and follow normal DEV pipeline. Do not alter the historical failed run records or prematurely close #179.
