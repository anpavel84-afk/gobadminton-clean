# GoBadminton ChatOps · two environments

Implementation package generated 2026-10-13. NOT installed or run on the user's servers.

## Scope
- Product/Architecture/UI/PM chats publish decisions and task evidence in GitHub Issues/Projects.
- Codex/Cursor writes code on an authorized Linux VPS, not on PLAN.
- GitHub-hosted Actions installs dependencies, tests, builds and deploys.
- `dev` is the single shared integration environment. Feature branches are merged into it by PM.
- PROD uses a published release tag reachable from main and the EXACT successful DEV image digests.
- No new AI scheduler, local agent service or GitHub self-hosted runner is installed.

## Files
- `.github/workflows/dev-deploy.yml`: fast checks; automatic escalation for API/contract changes;
  cached parallel image builds; DEV deploy + real Radar smoke; accepted image manifest artifact.
- `.github/workflows/prod-deploy.yml`: designated release actor; successful exact DEV artifact;
  full CI, migrations, restore test; same-image promotion; accepted PROD manifest.
- `scripts/chatops/`: all shell/Python/Node helpers called by workflows (not stub functions).
- `server/gb-deploy-helper.sh`: restricted per-environment JSON receiver.
- `server/*.example`: root-owned binding, SSH/sudo configuration examples.
- `server/gb-deploy-watchdog@.*`: recovers expired unacknowledged deployments.
- `server/gb-enroll-baseline.sh`: one-time enrollment using actual running version metadata.
- `docs/PM-CHEATSHEET.md`, `scripts/chatops/projects.sh`: PM CLI protocol.

## Mandatory one-time configuration — do not copy production examples blindly

1. Preserve existing app containers, databases, networks and volumes. Stop new dispatch by the
   OLD GoBadminton automation after recording/draining active tasks. This package contains no
   mass-delete, killall or broad service-stop commands.
2. Create separate `gb-deploy-dev` and `gb-deploy-prod` accounts. Give them usable `/bin/sh`
   shells for SSH forced commands, locked passwords, ROOT-OWNED homes and no writable startup
   files. Do not use `/usr/sbin/nologin` for a forced shell command. Never add them to `docker`.
3. Install the helper and narrow sudoers rules from `server/`; validate `visudo -cf ...` and
   `sshd -t` BEFORE reloading anything. Preserve an existing administrative session.
4. Copy the EXISTING effective Compose files to root-owned configured paths (or configure the
   exact existing root-owned paths). Names in examples are binding placeholders, not permission
   to create a new stack. Images may be set by the generated override. The fixed Compose must
   contain `api`, `web` and, on the API host, `migrate` + `db`. Every app service must have a real
   healthcheck. Migration command: `node dist/database/migrate.js`, using the candidate API image.
   No app mounts of host root, Docker socket, production files, or agent workspaces.
5. Profiles `/etc/gobadminton/deploy/dev.conf` and `prod.conf`, Compose files and env files
   must be root-owned and NOT group/world writable. All ancestors must be non-writable and
   non-symlinked. Runtime state: `/var/lib/gobadminton-deploy/{dev,prod}`, mode 0700.
6. GHCR access: package access must permit the repo's GITHUB_TOKEN to push/read images. If
   packages are private, use a SEPARATE read:packages credential in ROOT-ONLY Docker config:
   `/etc/gobadminton/deploy/registry-dev` and `registry-prod`. Do not reuse the PM write token.
   Docker secrets are never sent as command arguments or returned by the receiver.
7. Install watchdog service/timer templates under /etc/systemd/system. Enable only the configured
   env instances: `systemctl enable --now gb-deploy-watchdog@dev.timer` (and prod where bound).
8. First PROD release: enroll the actual running source version using `gb-enroll-baseline.sh`.
   It refuses absent/mixed source metadata. Do not invent INITIAL_PROD_SHA. Set repository variable
   INITIAL_PROD_SHA to that verified SHA. On split hosts confirm matching release provenance.
9. Create GitHub Environments `dev` and `prod` through gh/API. Restrict dev to branch `dev`,
   prod to protected version tags. No redundant GUI approval if Owner approves via PM chat.
   Use DISTINCT environment secrets named DEPLOY_HOST, DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS;
   optional DEPLOY_WEB_HOST for split PROD; DEPLOY_PORT is optional (default 22).
   Set repository variable RELEASE_ACTOR to the designated release principal.
10. Protect main, dev integration and release tags/workflow changes. The implementation CLI must
    not receive PROD key, root, or the release principal's token. Projects labels are NOT an
    authorization boundary. If every chat uses the same GitHub account, the role names do not
    create independent GitHub permissions.

## Existing topology
The repository still describes Germany API/DB + Moscow Web for PROD. The helper supports
SERVICES=(api), SERVICES=(web), or SERVICES=(api web), set only by ROOT config. On a split
PROD, set DEPLOY_HOST=Germany, DEPLOY_WEB_HOST=Moscow and install the PROD restricted key
on both with different fixed service subsets. Migration runs only on API host. Never point
DEV and PROD profiles to the same Compose project, DB volume, secrets, or exposed ports.

Split-host release is NOT an atomic distributed transaction. The client updates API then Web,
runs public smoke, then accepts both. On failure it attempts compensating rollback on every
contacted host; watchdogs recover unacknowledged releases. Temporary API/Web compatibility
and additive schema changes are required. Network partitions may require ChatOps reconciliation
of both receivers' status; never report global success from one host alone.

## Security and trust
- Authorized SSH user is bound to dev/prod by the forced command AND exact sudo command.
- Receiver accepts bounded JSON, validates keys/identities/digests, rejects extra fields, and never
  evaluates client text as shell. It cannot receive arbitrary paths/Compose/commands/networks.
- Root helper is necessarily privileged to use Docker; CI and coding agents do NOT get general
  root or Docker access. This limits the deployment interface, not kernel escape risk.
- Authorized images can access their own application's DB. No wrapper proves malicious SQL
  safe. PROD depends on trusted release/workflow permissions and real code/migration review.
- Code is image-digest pinned and source labels checked. Existing container image IDs are saved
  for rollback; old images must not be pruned before acceptance/retention policy.
- Secrets are only injected in deploy jobs after CI; source/test jobs have no VPS credentials.
- CI actors/workflows with broad repository or release rights are trusted. Apply rulesets and
  narrow tokens; this package is not a substitute for that bootstrap.
- Receiver traps failures, stores pending state, requires live smoke acceptance, and watchdogs
  expired operations. Rollback NEVER restores the whole database automatically.

## Migration constraints
`db-ci.sh` owns a fresh ephemeral PostGIS container, never takes a live DATABASE_URL, and runs
fresh/upgrade/idempotence/restore checks. Historical SQL must not change. This does NOT prove
business compatibility with every production data shape: add representative data/race tests
for changed migrations. Current recipe runs each integration file separately and refuses skipped
mandatory tests. Friends has a verified special DB name. Additional suites may require explicit
fixtures/flags: a failure must be fixed in the recipe/test contract, not hidden.

Helper backs up before API migration and invokes only the fixed migrate service. Reviewed
backward-compatible migrations can run automatically. Destructive schema changes need a separate
expand/contract release plan, not a silent permission bypass. A migration failure can leave committed
additive steps; app rollback is not schema rollback. First Radar release should contain no Friends
migration or accidental feature enablement.

## Product acceptance and speed
Shared DEV updates only from dev. Do not push unrelated feature branches into the same running
DEV stack. Active deployments are not cancelled; outdated PENDING dev workflows may coalesce.
Build API/Web runs in parallel with registry cache. No literal instant deployment is promised.
API/contracts changes automatically use full DB CI; pure frontend iterations use the quick path.

`smoke.mjs` requires a real map canvas, venue marker and no private guest player pins. A fallback
is NOT a map PASS. The existing Radar candidate is DEV-host gated; PROD map activation must be
implemented and reviewed as product work before promotion can pass this smoke. The helper and
workflow do not manufacture a Friends UI, lift test-only flags or complete feature work.

## Chat-only operation and limits
Owner speaks in role chats; PM invokes gh and the VPS CLI through available authorized tools.
Projects stores tasks; it does NOT launch a process merely because Stage became Ready. This
package deliberately contains no new perpetual scheduler. An active PM execution session starts
an ordinary one-task CLI process, then Actions owns the rest. Closed chat + a running gh watcher
does not by itself create an autonomous model that fixes future failures. Fully unattended issue
consumption is a separate supported-worker requirement, not secretly claimed here.

Project updates are emitted by PM after reading actual Actions/deployment evidence. API failure
updating a card must be retried, but must not roll back an already accepted app. Do not close
issues on dev merge if Definition of Done includes PROD. Print the board in the chat.

## Artifacts / baseline retention
DEV promotion manifests are kept 90 days. An expired/missing successful DEV artifact blocks
promotion; do not rebuild a different image and call it the tested one. Archive manifests with
release records for long-term operation. Before enabling unattended releases, configure artifact
retention/registry cleanup so supported rollback and promotion versions remain available.

## Validation performed in this session
See tests/VALIDATION.txt. Local syntax/static checks and mock-based helper integration tests passed.
NO actual GitHub workflow, real Docker/PostGIS migration, live SSH command or DEV/PROD deployment
was executed by this package's author. A disposable/inactive-profile canary and independent review
are required before PROD credentials are enabled.
