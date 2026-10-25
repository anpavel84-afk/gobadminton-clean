# GoBadminton Clean — DEV ChatOps commissioning checkpoint

Date: 2026-10-14 UTC. Scope: Germany DEV only. PROD was not touched.

## Source and acceptance

- Canonical repository: https://github.com/anpavel84-afk/gobadminton-clean
- ChatOps PR: https://github.com/anpavel84-afk/gobadminton-clean/pull/22
- Independently reviewed API P2 source baseline: 4790dc9ef2b79b15e3322a85716471032cc02cdf (R2 PASS, historical R1 FAIL retained).
- Independent R3 review: a06dc2150fcec0829623190262494c44313670e3 (DEV canary labeling only; PASS).
- Built and cloud-tested application baseline: 5ca74f4be734421f1d50fa3570f552b4c1333368. This repaired the missing contracts source in the Web Dockerfile. Hosted Product CI 38551661586: 7/7 PASS.
- No migrations on initial DEV switch: the existing PostGIS stays in place, server receiver has MIGRATE=0.

## Verified DEV operations

- Branch dev exists; GitHub Actions dev-deploy.yml owns hosted checks, immutable GHCR API/Web image builds, restricted SSH deploy, browser smoke and acceptance.
- Existing DEV receiver, dev-only GitHub Environment and branch allowlist reused. No new executor or credentials.
- GitHub run https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38551728979, attempt 2: release r38551728979-a2 ACCEPTED on source 5ca74f4; real browser platform canary PASS.
- Compensating rollback of r38551728979-a2 executed by existing root-owned fixed-operation helper, not a simulated test. Receiver reported ROLLED_BACK; actual API and Web image IDs matched pre-release snapshots. Public API returned previous source 16b97821cccec15d9b26f4e8e2b3073dd0bb3ee3; both containers healthy.
- Same run, attempt 3: r38551728979-a3 ACCEPTED on source 5ca74f4 with new API/Web digests; all GitHub Actions jobs SUCCESS, https://dev.gobadminton.ru/v1/meta returned the accepted SHA and /players HTTP 200.
- Existing gobadminton-clean-publisher.timer and gobadminton-clean-dev-release.timer were disabled/stopped only after successful DEV and real rollback. Runner and Autopilot remain disabled. Existing DEV deploy watchdog remains enabled.

## Intentional limitation and next actions

- CHATOPS_DEV_COMMISSIONED=true. Explicit temporary CHATOPS_DEV_PLATFORM_CANARY=true selects infrastructure browser smoke and writes PLATFORM_CANARY_PASS with radarAcceptance NOT_TESTED. Without this exception, DEV defaults to mandatory full anonymous Radar/map smoke. No map or private-player consent approval is claimed.
- The next ordinary product work is Radar, tracked by Issue #13. Only after map and independent Radar QA succeeds, remove the temporary canary variable so all DEV pushes require the full map smoke.
- This handoff's subsequent normal fast-forward push into dev is the remaining end-to-end trigger test for automatic push-to-DEV delivery. Acceptance of that later release must be recorded separately in PR #22; this document does not preclaim it.
- ChatGPT PM can write GitHub tasks directly; Codex runs on Germany under agentagency-dev. This checkpoint does not claim unattended GitHub Issue-to-Codex dispatch.
- PROD needs an independent explicit Owner GO, prod-only approval and separate Moscow runtime audit. Do not modify PROD Web, VPN or PLAN.
- If retiring the new DEV pipeline, first quiesce GitHub deployments and then, only after confirming no parallel writer, restore the two old timers with systemctl enable --now. Do not restore timers during normal ChatOps operation.
