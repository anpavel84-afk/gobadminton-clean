# ChatOps implementation and commissioning plan — 2026-10-13

Status: IN_PROGRESS, NOT COMMISSIONED. Owner assignment authorizes source/PR/CI and Germany DEV migration; PROD changes require a separate explicit Owner GO. This document takes precedence over deployment ordering in the imported package README. History, claims and QA receipts remain unchanged.

## Audited checkpoint

- Repository: anpavel84-afk/gobadminton-clean, main 30f24bae57123c3fdb53ceef94ec6bae71e4fcd0 (unprotected at initial audit).
- Source worktree: Germany /srv/gobadminton-clean/worktrees/chatops-github-actions-20261013, agentagency-dev uid 1002, no docker group.
- Original reference archive SHA256: c697a44f95a93b61817f895564a05e24b762036c53b6494898c52fb3c6fbaf4c. All 24 manifest entries verified before import; original manifest preserved in docs/workbench/chatops-v2-import-SHA256SUMS.
- Germany checkpoint: /var/lib/gobadminton-chatops/checkpoints/20261013-initial; root-only Compose snapshots, unit definitions, unit states, container image IDs/labels and SHA256SUMS. This is a configuration/runtime checkpoint, NOT a database backup.
- DEV API: gobadminton-dev-preview-api, image ID sha256:5f8713f744a5751c56622803f880ed6e0468b122c0b503bc2b51603814e22298.
- DEV Web: gobadminton-dev-germany-web, image ID sha256:53eeaa1f539b9d9306e76ecfa481e1961097c5417307eb42b0bf02beea8ff0bd.
- API /v1/meta actually reports 16b97821cccec15d9b26f4e8e2b3073dd0bb3ee3. Web /health responds ok. Neither proves Radar rendering.
- DEV project gobadminton_dev_preview uses /srv/gobadminton-dev-preview/docker-compose.yml. API labels reference compose.full-germany-oauth-avatar-v003.yml; Web labels reference compose.full-germany-v001.yml. Root must compare effective service configuration before normalizing to v003. Never recreate DB or networks.
- PROD API project gobadminton_mvp: /srv/gobadminton/compose/docker-compose.yml + docker-compose.p1p4-release-20261010.yml + /srv/gobadminton-dev/worktrees/radar-main-owner-candidate-20261011/compose.main-radar-override.EXACT_SHA_RELEASE_STAGED_NOT_ACTIVE.yml. Runtime labels, not filenames, establish use. Do not execute this configuration in this task.
- PROD Web DNS 194.87.214.217, Moscow runtime not yet audited. ruvds-ftr5s at 45.158.46.119 is NOT that host. Do not install there as a substitute.
- Runner and Autopilot services disabled/inactive. Clean Publisher and DEV-release timers enabled/active. DEV-release service repeatedly fails: CLEAN_DEV_RELEASE_BLOCKED:nonrelease admission is not DEV release. Four clean QA timers and monitor timer disabled. No units stopped.
- PR19 Radar ed1ad372751b25f1d4bddae1f13e1b3876ef5bec; PR20 Friends f98b1ed42e3f3847ac305e487cf3a706d6a458f2; PR21 Runner ca433bd35e07ae60002ab04ebef6119cad5ab0cc at initial audit. No old QA reused for new SHA.

## Execution order, owners and acceptance

| Step | Responsible role | Depends on | Deliverable and acceptance |
|---|---|---|---|
| 1. Freeze audit | Platform | server read access | Checkpoint above, actual runtime source and exact units recorded; DONE |
| 2. Source transport | Platform + Owner credential enrollment | 1 | New repository-only write SSH key on Germany; real push succeeds; DONE. Private key never leaves developer home |
| 3. Cloud CI | Platform | 2 | PR22 adds foundation, contract/module checks, PostGIS migrations and receiver regression on ubuntu-24.04; every required job must pass |
| 4. Repair baseline | Architecture/API + documentation owner; Platform coordinates | 3 | Resolve missing Clean-root docs and real idempotency/body contract findings. No deletion/skipping of mandatory checks, no invented contract claims |
| 5. PM API identity | Owner initial authentication; PM operates | 2 | gh auth status succeeds under a dedicated PM principal; Projects list/read/write verified. Developer key does not grant API privileges. Do not give implementation worker PM admin/release token |
| 6. Single board | PM | 5 | Reuse existing Project; discover real field/option IDs; attach existing Issues including #13; preserve stable GB IDs and role specs; verify write/read. No duplicate backlog or fake claims |
| 7. DEV receiver bootstrap | Platform | 3-5, exact Compose review | DEV-only user/key; forced command, root-owned helper/profile/parents, exact sudo rule; no docker group, socket, general sudo, PTY/forwarding. Pinned known_hosts; inactive canary and negative SSH tests on disposable CI. PROD key absent |
| 8. Radar candidate | Implementation + QA | 3-4 | Compose exact PR19 candidate with accepted platform revision on new integration branch; no Friends migration. Cloud checks and images must identify exact resulting SHA; preserve PR19 provenance |
| 9. DEV release | Actions + Platform | 7-8 | Build on hosted runner; fixed GHCR digests; essential checks; serialize deployment; deploy only api/web with existing env/network/volumes; actual /v1/meta SHA and map smoke; PENDING_SMOKE then ACCEPTED |
| 10. Failure rehearsal | QA + Platform | 9 | Reject arbitrary SSH command/path/digest/role and stale release; fail browser smoke; kill client; bound hung Docker; verify actual prior images and health restored, preserve evidence |
| 11. Legacy retirement | Platform | 9-10 | Exact clean Publisher/DEV-release timers stopped and disabled after confirming no active work; already-disabled Runner/Autopilot/QA kept disabled. Record before/after and inverse enable operations. No app unit, claim, receipt or history mutation |
| 12. Split PROD preparation | Platform + Release | Moscow read-only access | Exact Web Compose/image/baseline and API baseline verified, backward compatibility defined. Source preparation only before GO |
| 13. PROD commissioning/release | Owner + Release | 9-12 and explicit release GO | Owner approval bound to SHA+digests+baseline+CI/DEV evidence; protected release identity/environment; separate PROD key; deep fresh/upgrade/restore tests; promote exact images; API Germany then Web Moscow; both receipts required |

Role owners are responsibilities, not invented GitHub assignees or claims of independent identities.

## Current blockers and evidence

- PR22 first Product CI: https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38482288671
- Receiver source regression job succeeded (15 mock tests); this is cloud author verification, not live SSH commissioning or independent security acceptance.
- Foundation failed with missing documents referenced by AGENTS/docs and OpenAPI idempotency/body findings on linked providers, sessions, avatars and admin auth routes. These sources were not changed by initial package import.
- Actual product checks are split into independent required jobs so foundation failure does not conceal later failures. Deployment still invokes blocking foundation and full checks.
- New repository write key fingerprint SHA256:McJ0ggrpDOAZLNcIdpFsAN0qYCZZ8/2wqOB9JcB+3IM. Push succeeded for 6b31e14fb467c7581f8206e22a5178a70b372ff5.
- gh 2.45.0 installed from Ubuntu repositories. No authenticated host for root or agentagency-dev at audit. Environments/Secrets/Projects cannot be commissioned with an SSH Git key.
- CHATOPS_DEV_COMMISSIONED and CHATOPS_PROD_COMMISSIONED are required opt-in variables; do not set them until their gates above are verified. A skipped deployment is not a delivery receipt.
- PROD RELEASE_ACTOR comparison alone does not prove human GO. Environment/tag/workflow protections and separate release credentials must be configured and audited before enabling PROD. Do not publish a production release in this task.

## Radar smoke and rollback

Anonymous smoke requires the visible map entry, ready MapLibre canvas, a real same-origin PMTiles range response, venue marker popup, camera controls, no private guest markers and no JS errors. Record screenshot and receipt even on browser failure. Private consent/revocation/TTL scenarios need separate synthetic-account QA; anonymous PASS does not imply them. Frozen style guide remains visual authority. Observe-current workflow does not deploy and expects the audited historical source; source drift fails observation.

DEV retains previous actual image IDs and private per-release state. Failed apply or failed smoke rolls images back; no automatic DB dump restore. Watchdog only recovers pending deployments. Docker calls must have hard deadlines; timer must be proved effective under a hung-client/call rehearsal. First Radar admission forbids schema changes; MIGRATE=0 until explicit migration commissioning. On split PROD, acceptance of one host is not global acceptance; compensate both and reconcile statuses after disconnect.

## Rollback of this implementation

PR is draft; main untouched. Source rollback is reverting PR commits. No installed receiver or deploy keys for environments exist from this work. Remove/disable only newly commissioned DEV entry points if commissioning later fails, retaining receipts and previous images. Do not delete worktrees, checkpoints, old automation or database volumes. Do not restart old automation indiscriminately: restore only the units explicitly recorded as active before cutover, after checking competing writers.

## Operating rules

Owner chats provide product direction and explicit PROD GO. PM drives Issues/Projects and launches one CLI task on Germany. GitHub-hosted runners own installation, builds, tests, browser execution. A gh watcher does not provide closed-chat autonomous repair. Cloud tests are independently executed infrastructure; independent reviewer judgment remains a separate recorded fact.

Continue from PR22 and the server worktree. PLAN is only the source of the Owner-provided archive; no development or builds there.
