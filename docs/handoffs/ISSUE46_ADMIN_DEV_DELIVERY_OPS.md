# Issue 46 — bounded Admin DEV delivery SOURCE

From: bounded Ops source author (agentagency-dev, Germany). To: PM / independent
read-only source QA / authorized installation operator. Date: 2026-10-15.
Status: WORKING_DRAFT — NOT APPROVED — NOT CANONICAL; source only, no activation.

Base: `6ab2812ad0638ec636e9fa5e454ca89fdf577c61`.
Branch: `automation/admin-dev-delivery-20261015`; initially clean separate worktree
`/srv/gobadminton-clean/worktrees/ops-admin-dev-delivery-20261015`.
Assignment: Owner's explicit bounded Issue 46 DEV rollout/integration source task.
Issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/46
Base source: https://github.com/anpavel84-afk/gobadminton-clean/tree/6ab2812ad0638ec636e9fa5e454ca89fdf577c61
Preceding product/config guards:
https://github.com/anpavel84-afk/gobadminton-clean/blob/6ab2812ad0638ec636e9fa5e454ca89fdf577c61/docs/handoffs/ISSUE46_DEV_ADMIN_SOURCE_2026-10-15.md
No candidate commit/permalink exists: commit/push/network are prohibited for this
assignment. PM must publish this diff/handoff with exact candidate permalinks.

## Source result and preserved boundaries

Existing DEV workflow/build-pair/deploy/receiver/rollback/watchdog path is extended;
no new workflow, queue, runner, service executor, auth stack or UI. Product CI still
has the same seven expanded job names (four source matrix entries plus foundation,
database, receiver). Its existing Admin entry additionally builds the actual Docker
image without pushing; receiver job runs new offline tests plus existing root tests.

`CHATOPS_DEV_ADMIN_COMMISSIONED=false` is the default. Only exact `true` enables
Admin, with exact repo, refs/heads/dev and dev environment checks in build/client.
Missing/invalid Admin digest or mismatched client source SHA fails before SSH.
OFF builds API/Web only and omits admin_digest entirely, including SSH requests;
old installed two-image helper remains compatible. Supplying Admin to PROD fails.
Enabled release is API/Web/Admin from the same source SHA, linux/amd64, with revision
and canonical source labels checked for all three by the receiver. Registry prefix
and image names stay fixed. Existing image cache/package permissions are reused.

Root config has independent strict `DEV_ADMIN_COMMISSIONED=false`; inherited Admin
profile variables are cleared before loading trusted root config. Enabled config
requires SERVICES=(api web admin), private root-owned Admin env, fixed response/meta
URLs and trusted Compose. Enabled client plus old helper fails closed, never drops
Admin silently. Invalid/partial receiver config fails closed.

Pending/status/accepted/rollback state retains Admin digest/source SHA. Enabled
release directory has verified release.json, candidate.json, actual previous image
IDs/version env, previous accepted receipt and (first enable only) admin-absent.
No fabricated previous Admin receipt. The same lock, IDs, sequences and deadlines
apply. Rollback restores all previous containers; first-enable rollback removes
only the new Admin container and restores API/Web. Database is never auto-restored.
Do not change config/helper/Compose while a release is pending; recovery must retain
the matching three-service profile and private env until rollback is finished.

Receiver acceptance requires all enabled containers healthy and matching candidate
image references, API metadata, Admin-host metadata and a real enabled Admin HTML
response. Browser smoke additionally checks Admin anonymous login UI and auth/me=401
in a fresh context. It neither starts OAuth nor creates sessions/passkeys; receipt
explicitly says provider/passkey NOT_TESTED. API/Web smoke remains required as before
(including existing separately authorized platform-canary behavior).

Templates add Admin to the EXISTING Compose project with host loopback binding
127.0.0.1:18088 (PM MUST verify unused). Dockerfile's container HOSTNAME changes to
0.0.0.0 because published host loopback ports cannot reach a container-only loopback
listener. This is packaging only; no host wildcard binding. Dedicated Admin origin
nginx sends /v1/admin through the existing AdminApp route/cookie/Origin filters,
which forward only allowed routes to reviewed API. It does not bypass callback
handoff or inject an Origin. /v1/meta alone goes to the existing API metadata endpoint;
other /v1 paths are denied. No DB/bootstrap/root API exposure. Access logging is off
on Admin host to avoid callback query logging. No real certificate or secret exists
in these templates.

## Author checks (offline, not independent QA)

- `python3 -B scripts/chatops/tests/test_admin_deploy.py`: 16 disposable mock tests
  pass, covering flag/ref/env/repo gates, exact OFF/ON build manifests, malformed
  fields/digests/SHA, wrong revision/source/architecture, three-image acceptance and
  idempotence, missing/wrong running Admin, Admin failure restoring prior images,
  first enable removal, compensating rollback after accept, expiry and watchdog.
- `bash -n` on modified build-pair/deploy/receiver and `node --check` smoke pass.
- Local PyYAML parses both modified workflows and Compose template; seven expanded
  Product CI jobs retained. This is syntax/structure evidence, not Actions validation.
- `git diff --check` passes.
- Existing `test_helper.py`: all 21 tests SKIPPED because this author is not root.
  NOT a PASS for ownership/sudo/PROD integration. Hosted receiver job retains root run.
- New tests bypass EUID/trusted/chown only inside disposable copied helper fixtures;
  real source has no test flag or ownership bypass. Docker/curl are fake executables.

NOT_TESTED: real Docker build/runtime/Compose/nginx, Actions/GHCR, actual root-owned
paths, sudo/SSH, live receiver/watchdog/backup/rollback, DNS/TLS, real provider consent,
callback and real WebAuthn enrollment, live database/UAT. No dependencies downloaded,
network calls, credential/operator-file reads, services, root, git commit/push or
activation performed. No application/test fixture fix from the other worktree.

## Ordered operator prerequisites after QA only

1. Preserve previous failures. Known CI2 fixture users.status='deleted' remains
   unfixed here; PM's separate product executor owns it. PM must integrate its
   corrected base into this branch without force push, publish exact resulting SHA,
   request fresh independent read-only QA and run hosted Product CI on that SHA.
   Source checks here cannot supersede prior FAIL or make Issue 46 feature DONE.
2. Keep BOTH Admin flags OFF. Drain/check pending deployment via existing route;
   record accepted state, current API/Web image IDs, root helper/config/Compose/nginx
   backups and operator rollback plan. Owner-supplied last real accepted baseline:
   r38797721347-a1 / 734aaa05d166da4b6a98a4c78d5609471e6257f8; MainPID 2454510 single
   Issue adapter (not inspected here). Legacy services remain disabled. Never start
   a second writer or modify that runtime in this source task.
3. Operator installs reviewed matching helper and trusted source templates/config
   with backups; preserve SSH/sudo rules and existing project/DB/volumes. Verify
   18088 unused, current API port 18084 binding, registry read access, Compose version,
   healthchecks, file ownership/modes and watchdog timing. Add reviewed Compose path
   only when ready to manage Admin; no ad-hoc compose up outside receiver.
4. External blocker (Owner/PM supplied, not independently queried):
   dev-admin.gobadminton.ru DOES NOT RESOLVE; dev.gobadminton.ru resolves
   169.58.183.182. Authorized DNS operator must add A dev-admin -> 169.58.183.182,
   verify propagation and any AAAA routing, then obtain a real certificate and
   install/test the separate HTTPS host. No TLS/HTTPS availability is claimed.
5. API activation is a SEPARATE explicit reviewed operator step using existing guards:
   ADMIN_INTERNAL_ENABLED=1, ADMIN_DEV_ENABLED=1, NODE_ENV=production, APP_ENV=mvp|stage,
   exact consumer/API origins https://dev.gobadminton.ru and Admin origin
   https://dev-admin.gobadminton.ru. Keep Admin out of consumer allowed origins;
   retain Secure cookies. Dedicated private ADMIN_AUTH_PEPPER >=32 characters must
   differ from existing secrets. No credentials/grants generated by this source work.
6. Private root:root 0600 `/etc/gobadminton/deploy/admin-dev.env` contains only reviewed
   AdminApp server config: ADMIN_INTERNAL_APP_ENABLED=1, ADMIN_DEV_ENABLED=1,
   NODE_ENV=production, APP_ENV=stage (or reviewed mvp),
   PUBLIC_WEB_ORIGIN=https://dev.gobadminton.ru,
   ADMIN_ORIGIN=https://dev-admin.gobadminton.ru,
   ADMIN_API_URL=https://dev.gobadminton.ru. No ADMIN_TEST_* variables, DB credentials,
   consumer secrets or API pepper in AdminApp. Actual API provider secrets remain
   exclusively in its existing separately reviewed private configuration.
7. Authorized provider operator registers exact callbacks:
   https://dev-admin.gobadminton.ru/v1/admin/auth/vk/callback and
   https://dev-admin.gobadminton.ru/v1/admin/auth/yandex/callback.
   Resolve provider consent/domain restrictions with real registration; no assumption
   that consumer callback registration suffices. Real identities/provisioning and
   passkey enrollment remain private operator/Owner actions under existing guards.
8. Only after DNS/TLS/provider/config readiness, set server opt-in/profile together
   as dev.conf.example describes; then set repository Admin opt-in true. Run the
   SAME reviewed DEV workflow, record exact three digests/source SHA, backup/pending,
   anonymous smoke and ACCEPTED evidence. Independent live UAT/provider/passkey proof
   is separate from anonymous deployment acceptance. No PROD authority is implied.

## Recovery / next bounded action

On failure use existing release-ID rollback or watchdog with matching installed
three-image profile. Verify API/Web/Admin restored (or new Admin absent), previous
accepted receipt restored, no pending state; retain images and release directories.
If rollback is unconfirmed, reconcile status and logs; do not claim success. Before
removing the optional profile/config/ingress, finish pending/compensating rollback
first. Then turn client flag OFF and restore reviewed helper/config/ingress backups
as appropriate; never leave an enabled client pointing at a two-image helper.
Restoring source/config does not revoke real grants/sessions or revert additive DB
changes; use existing authenticated lifecycle controls if separately authorized.

Source rollback: reverse only this allowlisted diff against the base; no runtime or
DB rollback was executed. No force reset or deletion of another executor's work.
Next recipient/action: PM publishes and integrates corrected product base, then
requests independent exact-SHA QA + hosted CI. Publication is still outstanding due
to explicit no-commit/no-push constraint, not implied approval or installation.

## PM integration before independent QA

Original author base6ab2812 is historical. PM fast-forwarded this unpublished Ops branch to product correction3 source96de66bd415473206df98dbbf68872a7cd05f005 while preserving all separate Ops edits. That product SHA has NEW independent QA3 PASS and both hosted Product CI38805766488/38805773455 PASS. Ops itself is NOT APPROVED/NOT INSTALLED; its exact candidate SHA will be recorded outside this self-referencing file after commit. DNS/TLS/provider/enrollment and all live three-image behavior remain NOT_TESTED. No PROD/runtime/service/real-user change.

Parent validation before QA initially FAILED under a read-only source Landlock guard because three new disposable fixture paths forced temporary directories into Path.cwd(). They now honor tempfile.gettempdir()/TMPDIR, so only the designated private temporary directory is writable; real receiver ownership checks are unchanged. The original failure log is preserved. New parent test results and independent exact-SHA QA remain separate gates.

The additional validation-only filesystem guard also blocked normal shell fixture /dev/null writes and existing adversarial evidence tests opening parent directories. Full offline tests therefore run with the usual clean environment/private TMPDIR as nonroot UID1002, not with that extra test wrapper. Codex itself remains sandboxed/read-only for QA, and no OS/sandbox/Root/SSH permissions were changed. Foundation retains the extra guard. Guard-induced failures are preserved and are not represented as product defects or PASS.
