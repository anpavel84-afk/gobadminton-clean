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
old installed two-image helper remains compatible. PROD opt-in remains forbidden;
valid downloaded DEV Admin metadata is validated then dropped from PROD requests.
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


## Bounded correction after independent QAa1 FAIL (2026-10-15)

From: native bounded source-fix author. To: NEW independent source QA / PM.
Status: READY_FOR_REVIEW, unpublished working diff; NOT APPROVED / NOT INSTALLED.
Exact correction base and historical QAa1 FAIL candidate:
[`8281215643a484fe80b95c1bd33b446386bbaaf6`](https://github.com/anpavel84-afk/gobadminton-clean/tree/8281215643a484fe80b95c1bd33b446386bbaaf6).
This does not supersede that FAIL. Prior product QA3/Foundation and parent offline
70 tests (49 PASS / 21 root-dependent SKIP) remain historical evidence only.
Owner's current bounded assignment: fix only the two supplied QAa1 source defects,
add isolated regressions, preserve TMPDIR behavior/history, update this handoff,
and stop without commit/push/network/root/runtime effects for NEW independent QA.

QAa1 findings retained: (1) default-OFF client rejected the commissioned DEV
manifest preserved by prepare-prod.sh, blocking existing API/Web promotion;
(2) acceptance could cross its durable pending deadline during verification under
the watchdog lock and still write ACCEPTED. Read-only QA found no real helper
ownership bypass, but did not run tests/runtime/hosted root CI or live security.
DNS/TLS/provider callbacks/real passkey proof remain unresolved or unproven.

Correction mechanics:
- prepare-prod.sh is read only and unchanged: its downloaded manifest preserves
  extra admin_digest and adds expected_previous_sha. Shared deploy.sh permits a
  strictly valid optional digest for PROD OFF, but builds the SSH payload using
  the commissioned flag, so PROD always receives only API/Web. DEV OFF still
  rejects Admin metadata; DEV ON retains exact flag/ref/repo/env/SHA/digest gates;
  PROD ON still fails before credentials/commands. Unknown/partial image fields
  remain rejected. No promotion architecture or actual PROD config changed.
- Helper rechecks durable pending.deadline after healthy/verify_version immediately
  before accepted mutation. Expiry uses existing rollback and fails without a new
  accepted receipt. Root/trusted checks, locking, compensation and watchdog are
  unchanged for both image modes.
- New disposable client fixture uses fake SSH/npm/Playwright/node and FAKE
  credentials, captures both split-target payloads, checks exact API/Web/baseline
  fields and no Admin, and rejects malformed/partial manifests before SSH.
  New receiver fixture advances fake time from 99 to deadline 100 inside fake
  HTTP verification for both two/three-image modes; asserts image restoration,
  no pending, ROLLED_BACK and no accepted state/public receipt. No timing sleeps.
  All test artifacts honor private TMPDIR, with stubs only in disposable copies.

Validation and limitations are recorded below after the completed local run.
Source rollback: reverse only this correction diff against exact8281215; no live
rollback performed. Only deploy.sh, gb-deploy-helper.sh, test_admin_deploy.py and
this handoff changed; test_helper.py ownership tests remain unchanged for hosted CI.
Next bounded action: independent QA reviews the new diff/candidate; PM separately
publishes an exact candidate permalink and runs hosted root receiver CI. No
self-approval, deployment, live/DNS/TLS/provider/passkey or PROD approval claim.

Actual author validation on this correction (unprivileged, offline):
- `TMPDIR=/tmp/gb-model-wib4jp0w python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_*.py'`:
  72 tests, 51 PASS / 21 root-dependent SKIP, 23.377s. Includes both new regressions.
- `bash -n scripts/chatops/deploy.sh scripts/chatops/server/gb-deploy-helper.sh`,
  `node --check scripts/chatops/smoke.mjs`, `git diff --check`: passed.
- `python3 -B scripts/check_foundation.py`: static PASS (169 Markdown files,
  164 draft API operations); no runtime/independent QA implication.
- Initial author fixture runs FAILED (generated fake SSH newline escaping, then
  fake npm --prefix argument index). Both corrected only in disposable fixture
  generation before the successful full rerun; these failures are not concealed
  or represented as product regressions.

NOT_TESTED: real Docker/build/runtime, hosted root ownership/receiver CI, sudo/SSH,
actual backup/rollback/watchdog execution, Actions, DNS/TLS, provider registrations
and callbacks, passkeys, live security, DB/UAT. Root-dependent SKIP is not PASS.
No downloads, network, real credentials, live/config/service/DB/PROD changes,
commit or push. Publication remains explicitly prohibited in this bounded turn;
there is no new candidate SHA/permalink yet. Historical QAa1 FAIL remains in force
until NEW independent exact-candidate QA; author tests do not self-approve it.

## Owner-requested DEV `/admin` path candidate — 2026-10-16

From: existing bounded Ops source author, UID1002 Germany. To: Supervisor / NEW
independent read-only QA. Status: READY_FOR_REVIEW — NOT APPROVED — NOT INSTALLED.
Exact starting HEAD: `9f4659765dadf5778a380a5e9f0a5dd3d911fec2`, clean worktree,
branch `automation/admin-dev-delivery-20261015`. Existing PR49 candidate diff was
reviewed locally against product base `96de66bd415473206df98dbbf68872a7cd05f005`,
including previous deadline/promotion correction. No network PR lookup performed.
Source receipt: https://github.com/anpavel84-afk/gobadminton-clean/tree/9f4659765dadf5778a380a5e9f0a5dd3d911fec2
PR: https://github.com/anpavel84-afk/gobadminton-clean/pull/49
Historical QAa1 FAIL and all previous source/test receipts above remain intact;
author checks do not supersede independent QA or imply Issue46 acceptance.

### Explicit assignment / authorization record

Owner explicitly requests main DEV `https://dev.gobadminton.ru/admin` entry,
avoiding the dev-admin DNS blocker, using EXISTING AdminApp and its separate Admin
audience/session/passkey/UV/step-up and optional image pipeline. Source-only writes
in this worktree: apps/admin (no lockfiles), API env and relevant security tests,
allowlisted ChatOps build/deploy/smoke/server/tests, CI/DEV workflows and this handoff.
No other model/worker/daemon/service, live config/DB/grants/deploy, secret reads,
PROD/PLAN/VPN/neighbors, commit/push/merge/rebase or network. Concurrent product
worktrees/state/runtime must remain untouched. Supervisor owns safe integration of
base divergence before any deployment. No frontend design changes authorized or
made beyond preserving existing assets under the compiled path.

Required implementation: exact explicit DEV path opt-in; default OFF/local root
and dedicated-origin guards preserved; pure URL Origin separate from `/admin`;
exact explicit provider callbacks; cookies keep __Host names and Path=/; no consumer
cookie/bearer authority or new auth/fallback; CSRF/passkey checks intact; no activation
in URLs/logs or JS secrets in persistence. nginx snippets insert into EXISTING DEV
vhost only; main /v1 stays API, AdminApp forwards to unprefixed /v1/admin on main DEV,
never dev-api. Preserve loopback18088, three-image SHA/digests, lock/deadline/rollback
and first-enable compensation. Verify actual Admin page plus API/meta same SHA,
use DOMContentLoaded and readiness assertions, provide executable regressions and
run available offline tests/Foundation. No self-approval or live acceptance claim.

### Current source behavior (supersedes dedicated-host prerequisites above)

The previous dedicated-host nginx template and DNS prerequisite are historical.
The initial path candidate supplied two INSERTABLE locations for the existing main DEV
HTTPS vhost: `= /admin` returns 303 to `/admin/` without any incoming query, and
`^~ /admin/` forwards the original URI to loopback18088. No server/certificate,
wildcard, existing location, unrelated dev-api upstream or live file is changed.
Access logging was off in both locations; inherited error/debug logging and the
second public /v1 callback hop remained uncovered. The serial completion below
supersedes that incomplete logging boundary. Provider authorization codes necessarily
arrive at the registered callback URL, then are removed from navigation by AdminApp.
Activation remains password-input React memory / POST body, never a navigation URL.

Only the existing optional commissioned DEV Admin build gets Docker build argument
`ADMIN_DEV_PATH_BUILD=1`. Default Docker/local builds stay at root. Next compiles
basePath `/admin` and matching public URL prefix; runtime requires matching build,
`ADMIN_INTERNAL_APP_ENABLED=1`, `ADMIN_DEV_ENABLED=1`, **new independent**
`ADMIN_DEV_PATH_ENABLED=1`, NODE_ENV=production, APP_ENV=mvp|stage, exact
PUBLIC_WEB_ORIGIN / ADMIN_ORIGIN / ADMIN_API_URL `https://dev.gobadminton.ru` and no
test config. Every default remains OFF. Dedicated-origin mode retains its original
exact dev-admin origin with root build and path flag OFF. APP_ENV=prod stays denied.
`skipTrailingSlashRedirect` in the path build prevents Next/nginx slash loops;
nginx owns canonical `/admin/`. API path flag is independently default0 and requires
both pre-existing API Admin/DEV flags and exact existing DEV API/web origins,
Secure cookies, dedicated pepper and provider configuration. ADMIN_ORIGIN remains
an origin, never `.../admin`, query, fragment, userinfo or prefix lookalike.

Operator must explicitly configure BOTH callback URIs in API/provider registration:
- `https://dev.gobadminton.ru/admin/v1/admin/auth/vk/callback`
- `https://dev.gobadminton.ru/admin/v1/admin/auth/yandex/callback`

No flag/provider registration/env file was enabled or written here. No real secrets,
identities, grants or enrollment created. API passkey expectedOrigin stays the pure
main DEV origin; expectedRPID becomes `dev.gobadminton.ru` through existing hostname
logic. Credentials enrolled for a different RP require normal authorized enrollment;
this does not migrate credentials or bypass verification.

Browser API, logo, query cleanup and auth-ticket requests use compiled prefix;
font uses existing local Onest asset via Next local-font asset pipeline. Callback
redirects stay `/admin/?auth=complete|failed`, immediately cleaned to `/admin/`.
Proxy additionally checks exact request pathname, retains route allowlist, forwards
only Admin cookies/CSRF/idempotency headers, strips consumer cookie/bearer, and uses
unprefixed main DEV `/v1/admin/...` upstream. Existing API audience, current principal,
role, CSRF, UV-required assertion and ten-minute sensitive-action step-up remain
unchanged. Existing short-lived HttpOnly handoff cookie remains Path=/; no new
localStorage/sessionStorage/IndexedDB state or secret persistence was introduced.

**Residual risk:** this is same-origin consumer/Admin. Consumer XSS can issue Admin
requests and read same-origin responses with browser ambient Admin cookies,
including CSRF bootstrap/handoff. HttpOnly, separate Admin audience, CSRF and actual
UV/step-up reduce specific threats but DO NOT provide independent-origin XSS
isolation. Existing CSP prevents frames/objects and restricts base URI; it is not a
comprehensive consumer-XSS defense. This exposure is not described as eliminated.

Compose healthcheck now exercises `/admin/` enabled page. Helper requires exact
public main `/admin/` response URL and main `/v1/meta`; it checks title, login heading,
compiled Admin asset prefix and absence of disabled page, alongside same-SHA API
metadata and existing healthy digest-matching containers. Consumer HTML cannot
satisfy the normal Admin acceptance markers. Browser smoke uses DOMContentLoaded,
canonical path, title, hydrated enabled login, no privileged navigation, JS-error
assertions and anonymous auth/me=401. Provider/passkey remains NOT_TESTED.
Three-image digests/source labels, rollback/deadline/locks and first-enable
compensation were not changed. PROD workflow/prepare-prod were not edited.

### Validation and limitations

Offline native Node regression executes actual TypeScript Next config, runtime
validator and proxy with mocked fetch (only disposable import resolution is adapted,
no source security stub). It covers default/path builds and slash policy, exact flags,
PROD rejection, root/dedicated mode, origin lookalikes, guest consumer-negative 401,
wrong Origin, wrong path, unprefixed upstream and both clean provider callbacks.
Vitest regressions additionally cover API env path flags/callbacks and app transport.
Python fake-Docker build checks require the Admin-only build argument; receiver
regressions reject consumer HTML and noncanonical/public-response lookalikes.

Package-test attempts: this worktree has no installed node_modules and pinned pnpm
is absent from Corepack cache. Initial `pnpm --filter ... run test:unit` for Admin/API
unexpectedly attempted Corepack download and failed DNS (`EAI_AGAIN`); no package was
downloaded. This attempted network access was an author execution mistake against
the no-network constraint. Subsequent attempts used `COREPACK_ENABLE_NETWORK=0`
and failed explicitly without network. Neither package suite ran; no PASS claimed.
No further dependency/network attempt made. Real Next build/typecheck/lint and image
build remain NOT_RUN here; pinned-node CI runs native regression and path image build.

Completed final offline checks and exact changed-file inventory follow below.

Final author validation (unprivileged, offline; not independent QA):
- `TMPDIR=/tmp/gb-model-elfrj3r_ python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_*.py'`:
  75 tests in 34.378s, 54 PASS / 21 root-dependent SKIP. Includes actual-config/proxy
  Node regression, mock build/receiver/deadline/rollback and consumer-page negative.
- `python3 -B scripts/check_foundation.py`: static PASS, 169 Markdown files,
  164 draft API operations. `scripts/test_email_contract_policy.py`: 1 PASS;
  `scripts/test_check_foundation.py`: 8 PASS.
- `bash -n` build-pair/deploy/gb-deploy-helper, `node --check` smoke and
  `git diff --check`: passed. PyYAML parsed CI, DEV workflow and Compose source.
- Earlier in this turn before new regressions: 72 tests, 51 PASS / 21 SKIP;
  native Node check independently ran successfully. These are author checks only.

NOT_TESTED: package Vitest/typecheck/lint, real Next build and basePath browser
runtime, Docker/Compose/nginx, provider registration/consent/callback, real UV/passkey
and enrollment, Actions/GHCR, root ownership/receiver/SSH/sudo, live rollback/watchdog,
DB/UAT and actual DEV ingress acceptance. Real browser entry remains unproven until
new independent exact-candidate QA, hosted build/CI and separately authorized
installation/live verification. No runtime work, flags, permissions or grants changed.

Exact changed/new source files relative to starting HEAD (no lockfiles):

```text
.github/workflows/ci.yml
apps/admin/.env.example
apps/admin/Dockerfile
apps/admin/README.md
apps/admin/next.config.ts
apps/admin/src/app/internal/auth-ticket/route.ts
apps/admin/src/app/layout.tsx
apps/admin/src/app/v1/admin/[...path]/route.ts
apps/admin/src/components/AdminApp.tsx
apps/admin/src/lib/admin-client.ts
apps/admin/src/lib/admin-path.ts
apps/admin/src/lib/server-config.ts
apps/admin/src/styles/admin.css
apps/admin/test/path-build.test.ts
apps/admin/test/security-transport.test.ts
apps/api/src/config/env.ts
apps/api/test/unit/admin-security.test.ts
docs/handoffs/ISSUE46_ADMIN_DEV_DELIVERY_OPS.md
scripts/chatops/build-pair.sh
scripts/chatops/server/dev-admin-compose.example.yml
scripts/chatops/server/dev-admin-nginx.example.conf
scripts/chatops/server/dev.conf.example
scripts/chatops/server/gb-deploy-helper.sh
scripts/chatops/smoke.mjs
scripts/chatops/tests/admin-path-regression.mjs
scripts/chatops/tests/test_admin_deploy.py
scripts/chatops/tests/test_admin_path.py
scripts/chatops/tests/test_helper.py
```

Source rollback: reverse only this bounded diff against starting9f46597, including
new files, without resetting any other worktree or changing runtime. Operational
rollback remains the existing receiver compensation/watchdog with its matching
installed profile; finish pending release recovery before changing config.
Next bounded action: Supervisor publishes/integrates this source safely without
self-merging/rebasing here, records exact candidate permalinks, and requests NEW
independent read-only QA. No commit/push or new candidate permalink exists from this
turn because the source-author role was prohibited from publication; Supervisor retains Owner delivery authority. The prior QA FAIL is preserved,
not converted to approval by these author checks. No PROD authorization is implied.


## Bounded source correction after independent QAa1 FAIL of exact c902 (2026-10-16)

WORKING DRAFT — NOT APPROVED — NOT CANONICAL. From source author to Supervisor
and NEW independent QA. Exact base/unchanged HEAD:
`c902850d822d0e33825d4d9b0bd4e750db0a934f` ([historical candidate](https://github.com/anpavel84-afk/gobadminton-clean/commit/c902850d822d0e33825d4d9b0bd4e750db0a934f)).
This is the same separate Ops worktree, branch `automation/admin-dev-delivery-20261015`.
Owner assignment is bounded to request logging, mandatory DEV receiver gate and
this handoff. No root, network, other models, commit/push, live runtime/config,
DB/secrets/grants/flags, PROD/PLAN/VPN or other worktrees are authorized here.
Supervisor has Owner delivery authority; the publication restriction applies to
this source-author role only. A new SHA/permalink must be recorded by Supervisor
before NEW independent QA; this uncommitted diff is not an exact-new-SHA candidate.

Historical independent QA data (preserved verbatim; prior FAIL/results above remain):

```json
{"verdict": "FAIL", "findings": ["apps/admin/src/app/v1/admin/[...path]/route.ts:32-47 forwards callback code/state in the upstream GET URL, while apps/api/src/main.ts:17 enables Fastify's default request logger without URL redaction. Admin OAuth authorization codes and state therefore enter API request logs; disabling nginx logging only for /admin does not protect this upstream request.", ".github/workflows/dev-deploy.yml:19,23,47 allows deployment after ci.sh fast and image building without requiring the root receiver tests in Product CI. scripts/chatops/ci.sh never runs test_helper.py or the Ops regression suites, and Product CI does not run on dev pushes. The mandatory actual root-helper CI gate can therefore be bypassed before deployment."], "reviewed_sha": "c902850d822d0e33825d4d9b0bd4e750db0a934f"}
```

Changes (author implementation, not acceptance):
- `apps/api/src/main.ts` uses `common/api-logger.ts`: existing Fastify/Pino logger,
  allowlisted request method/path without query, response status and opaque error
  type; fixed log message prevents raw URL/not-found/provider error interpolation.
  Request IDs and completion timing remain. Headers, cookies, bodies, arbitrary
  log fields and error message/stack are omitted. Nest exception logging and
  bootstrap failure also suppress potentially credential-bearing errors.
- Admin/consumer callbacks still receive untouched query inputs. Existing Admin
  gate/proxy/receiver/three-image protocol is unchanged. Reviewed callback/provider
  failures use bounded problem messages; unhandled failures reach the safe logger.
- `apps/api/test/unit/api-logger.test.ts` executes actual Fastify inject/logger/sink
  with synthetic callback queries, header/body credentials, not-found and thrown
  errors. It checks raw logs and successful code/state delivery, plus Nest error
  sink suppression. No live OAuth/credentials. Product CI API unit suite includes
  it; DEV checks explicitly run it before images as well.
- DEV workflow adds mandatory pinned-Node receiver job at exact `GITHUB_SHA`,
  including actual root `test_helper.py` disposable fake-Docker/curl fixtures and
  current Ops/autonomy/client/path regressions. Images need both checks and receiver;
  deploy needs images. No continue-on-error or status shortcut. Root fixtures run
  only on hosted CI, never against the installed deployment helper. Existing DEV
  environment/ref/flags/image SHA gates, backups and rollback remain unchanged.

### SAFE COMMISSIONING prerequisite (operator/Supervisor, not executed)

1. Before changing API environment for same-origin Admin, deploy the new API
   path-support source with Admin flags OFF through the existing two-image DEV
   protocol and obtain server **ACCEPTED**. The old `4c` API rejects main-origin
   Admin. Retain exact accepted API/Web baseline and receiver receipt.
2. Only after this acceptance, back up ingress, root profile and private env
   explicitly using the authorized operator procedure. Commission three images
   against that API-compatible baseline; previous API image must be able to start
   under the installed fixed environment for first-enable image rollback.
3. Image-only rollback does NOT restore changed configuration. On failed
   commissioning the operator must explicitly restore backed-up ingress/root
   profile/private env as required, in coordination with pending release recovery.
   Do not add automatic secret/env restoration or caller-controlled receiver fields.

Real provider and passkey/UV remain **NOT_TESTED**. No deployment or self-approval.

### Validation of this correction

- Node is `v24.21.0`. No node_modules; pinned pnpm is absent from Corepack cache.
  `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/api exec vitest run
  --project unit test/unit/api-logger.test.ts` exited 1: network disabled/cache miss.
  No download occurred. Fastify test, typecheck/lint/build are NOT_RUN locally;
  hosted CI execution is required before acceptance.
- Foundation static PASS (170 Markdown files, 164 draft API operations); email
  policy 1 test PASS; foundation policy 8 tests PASS. These are author checks only.
- Bash syntax for all ChatOps shell files, Node smoke syntax, YAML parse and DEV
  images->checks/receiver->deploy dependency assertions passed.

Source rollback: reverse only this bounded diff against exact c902 above; do not
reset other work or change runtime. Next single bounded action: Supervisor records
new source SHA/permalinks through authorized publication and requests NEW independent
QA at that exact SHA. Historical QAa1 FAIL remains until independent review; hosted
CI and subsequent authorized commissioning are separate facts.

Final offline regression receipt for this correction:
`TMPDIR=/tmp/gb-model-mhoa45j7 python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_*.py'`:
75 tests in 38.474s, 54 passed / 21 root-dependent skipped. Actual native
Node Admin config/proxy/path regression ran successfully within this suite.
Root ownership/permission fixtures were skipped locally, and are mandatory in DEV
hosted receiver gate. No root elevation or installed helper invocation occurred.
Final `git diff --check` passed. Changed files are limited to:
`.github/workflows/dev-deploy.yml`, `apps/api/src/main.ts`, new
`apps/api/src/common/api-logger.ts`, new `apps/api/test/unit/api-logger.test.ts`,
and this handoff. No lockfile or dependency changes.


## SERIAL source-only ingress logging completion — 2026-10-16

WORKING DRAFT — NOT APPROVED — NOT CANONICAL. From: bounded serial source author.
To: Supervisor / NEW independent exact-candidate QA. Base HEAD remains
`c902850d822d0e33825d4d9b0bd4e750db0a934f`, branch
`automation/admin-dev-delivery-20261015`. Initial logging/CI author exited; no
concurrent writer per assignment. Existing API logger, API regression and DEV CI
correction sources were inspected and preserved unmodified. All historical QA FAIL
receipts above remain in force; this is no self-approval or Issue46 acceptance.

Owner-authorized Supervisor assignment: complete only main DEV ingress source,
relevant executable regressions and this handoff. No root/network/other models,
live config/services/grants, commit/push, PROD/PLAN/VPN. This paragraph records the
bounded prompt so continuation does not require chat history.

Supervisor read-only audit fact (provided, not independently re-audited here): main
DEV nginx `/v1/` proxies API18084 and inherits global access logging. AdminApp sends
callbacks to PUBLIC main DEV `/v1/admin/auth/{vk,yandex}/callback?code=...&state=...`.
Fastify logger redaction alone therefore leaves a second nginx query leak.

Current source boundary in `scripts/chatops/server/dev-admin-nginx.example.conf`:
- Four INSERTABLE locations in the EXISTING main DEV HTTPS vhost: existing `= /admin`
  and `^~ /admin/` to AdminApp18088, plus exact `= /v1/admin/auth/vk/callback` and
  `= /v1/admin/auth/yandex/callback` to existing API18084.
- Every one explicitly sets `access_log off` and `error_log /dev/null crit`.
  A location-local error sink replaces inherited error/debug sinks, including
  upstream-failure diagnostics that can interpolate request URI/query. Both the
  browser -> AdminApp and AdminApp -> public main DEV -> API callback hops are
  covered at location logging time. General consumer `/v1`, legacy dev-api and
  PROD logging/routing are unchanged. `/admin/` already had scoped access suppression;
  its scoped error sink also covers provider callback failures at that first hop.
- Exact API matches retain original URI/query (proxy_pass has no URI suffix),
  Host/forwarded HTTPS/host/Origin headers and normal request headers/body forwarding.
  No new redirect, rewrite, host/certificate/auth stack/network, or caller-controlled
  bypass header. Existing `/admin` canonical redirect remains unchanged.

Regression source: `scripts/chatops/tests/test_admin_path.py` now checks the four
fixed locations, both per-location log overrides, exact ports, untouched callback
URI/query forwarding contract and preserved proxy headers. Only fixed Admin
callback exceptions are allowed; no broad `/v1` replacement. Existing actual Node
Admin config/proxy regression still verifies successful code/state forwarding.
No executable test in the starting tree asserted exactly two nginx locations;
the historical handoff's two-location assumption is explicitly superseded above.
These are source-contract checks, not an nginx runtime/error-injection test.

nginx executable is unavailable locally. NOT_TESTED: real nginx syntax/effective
config and upstream-error log capture, live ingress, provider/passkey flows,
deployment or historical log remediation. Location overrides do not prove safety
of any separately configured pre-location/global debug capture or external logging
system; authorized commissioning must verify effective config and absence of such
capture before real callbacks. No deployed nginx/log scrubbing claim is made.

Source rollback: reverse only the serial completion edits to this snippet,
`test_admin_path.py` and this handoff; preserve the previous author's API/CI diff.
Next bounded action: Supervisor publishes source under its authority, records exact
new SHA/permalinks, then requests NEW independent QA and required hosted CI.
Publication is prohibited here, so no new durable GitHub permalink is claimed.

Serial completion author validation (offline, unprivileged):
- `TMPDIR=/tmp/gb-model-4v20zxm7 python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_*.py'`:
  77 tests in 25.458s; 56 passed, 21 root-dependent skipped (not PASS).
- `python3 -B scripts/check_foundation.py`: static PASS, 170 Markdown files,
  164 draft API operations. Email policy: 1 passed; foundation policy: 8 passed.
- Focused `test_admin_path.py`: 3 passed, including actual native Node proxy/config
  regression and two new nginx source-contract regressions.
- Final `git diff --check`: passed. No dependency install or network attempt.

## Bounded hosted-CI / installed DEV protocol correction — 2026-10-16

WORKING DRAFT — NOT APPROVED — NOT CANONICAL. DRAFT CI candidate only;
source-ready does not mean DEV approval. From: bounded source author. To:
Supervisor / NEW independent exact-SHA reviewer. Same Ops worktree and branch,
initially clean; exact base `9290a5df5fb869abe8c3060817ff2cb283e254c5`:
https://github.com/anpavel84-afk/gobadminton-clean/tree/9290a5df5fb869abe8c3060817ff2cb283e254c5

Assignment: correct only the supplied API serializer type failure, consumed Admin
callback fixture, and DEV graph compatibility; add workflow regression and preserve
all historical independent QA FAIL / hosted CI FAIL evidence. No other writer per
Supervisor assignment. No runtime executor or installed bridge inspection/change,
root/network/models/livefiles/secrets/DB/services/flags/grants, commit/push,
PROD/PLAN/VPN/neighbors. No publication performed; Supervisor must publish as DRAFT
CI candidate and record exact new SHA/permalinks. This file is the source handoff
for that future durable publication, not a claim of a published new revision.

### Actual hosted evidence supplied by Supervisor (not queried locally)

Product CI push run **38820541328**, exact9290, full CI **FAIL**:
https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38820541328
- source(api) job **116715779419**: TS2322 at api-logger.ts:10; error serializer
  returned type only, missing required string message and stack.
  https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38820541328/job/116715779419
- source(admin) job **116715779059**: security-transport.test.ts:135, second
  provider callback expected303 / actual503.
  https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38820541328/job/116715779059
- Root-owned hosted receiver job **116715779087 PASS** is a separate fact. It
  does not change full CI FAIL or prove live receiver/commissioning acceptance.
  https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38820541328/job/116715779087
- **ReviewerMissingEvidenceFAIL9290** remains preserved and unresolved. All earlier
  independent QA FAIL and hosted CI FAIL receipts remain historical facts; no
  author check below supersedes them or constitutes independent review.

### Source changes / compatibility

API error serializer now returns constant type/message/stack strings, satisfying
required return fields without inspecting real error details, assertions/casts,
or typecheck suppression. Actual Fastify hooks/request correlation and security
canary regression remain; regression additionally requires the safe error record.
No real message or stack is forwarded. Package typecheck is still required hosted.

Admin fixture defect is confirmed by source inspection: mockResolvedValue reused
one Response for two providers; proxy calls upstream.json(), consuming its body.
Second json() throws into the existing safe503 handler. mockImplementation now
creates a fresh upstream Response per invocation. Both provider303, canonical
/admin/?auth=complete, query filtering, binding-only cookie and handoff assertions
are unchanged. No Admin product source changed. Existing offline native regression
executes actual proxy code with fresh responses for both providers.

Supervisor's new installed compatibility finding: autonomous_issues.py requires
EXACT DEV_JOBS={'checks','images','deploy'} and the checks step display name
'Run bash scripts/chatops/ci.sh fast'. A fourth receiver job blocks successful
future autonomous dev_wait. Installed/runtime bridge and its gates are untouched.
The former DEV receiver block is now unconditional inside existing checks, after
pinned ci-setup and logging/fast checks. It verifies exact checkout SHA, shell/Node
syntax, workflow/autonomy/Ops/client/path regressions and actual isolated root
receiver fixtures via hosted sudo. Images needs checks; deploy needs images.
No continue-on-error, conditional bypass or always() shortcut added. Product CI
workflow and its seven expanded jobs are unchanged. This supersedes only the
historical four-job DEV design description above, not its historical evidence.

New dependency-free test_dev_workflow.py enforces exactly three jobs, unnamed fast
step (required default display name), pinned-SHA checkout, setup/logging/fast/receiver
ordering, exact mandatory commands including sudo root fixtures, no checks
conditions/error tolerance, and both needs edges before build/deploy. It runs
unconditionally in DEV checks and under local offline unittest discovery.

Changed files only:
- apps/api/src/common/api-logger.ts
- apps/api/test/unit/api-logger.test.ts
- apps/admin/test/security-transport.test.ts (fixture only)
- .github/workflows/dev-deploy.yml
- scripts/chatops/tests/test_dev_workflow.py
- docs/handoffs/ISSUE46_ADMIN_DEV_DELIVERY_OPS.md

Source rollback: reverse only this six-file correction against exact9290, without
resetting other work or invoking any runtime rollback. Next bounded action:
Supervisor publishes DRAFT CI candidate with exact SHA, obtains NEW independent
review including missing evidence and fresh hosted full CI. No DEV approval,
commissioning or self-approval is granted by this source result.

### Actual offline author validation of exact9290 correction

- `TMPDIR=/tmp/gb-model-fub4h9w_ python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_*.py'`:
  78 tests in 27.330s, **57 PASS / 21 root-dependent SKIP**. Includes new DEV graph
  contract and actual native Node Admin proxy/config regression for both callbacks.
  Root-dependent SKIP is not PASS; no local sudo/root invocation performed.
- `python3 -B scripts/check_foundation.py`: static PASS (170 Markdown files,
  164 draft API operations). Email policy: 1 PASS; foundation policy: 8 PASS.
- All ChatOps shell files `bash -n`, `node --check scripts/chatops/smoke.mjs`:
  PASS, Node v24.21.0. PyYAML parses both workflows; DEV exact three jobs and
  checks->images->deploy edges asserted. Product CI source was not modified.
- `git diff --check`: PASS. After tightening the new image-job conditional
  assertion to multiline, focused workflow regression re-run PASS.

Package Vitest/API typecheck/Admin typecheck/lint/build NOT_RUN: native package
dependencies absent. No pnpm/Corepack invocation, download or network attempted.
Fresh hosted typecheck, both real Vitest suites, root checks and full CI remain
required for the new candidate. No real build/runtime/nginx/SSH/provider/passkey,
DB/UAT, livefiles or services tested/changed. The supplied hosted receiver PASS
belongs only to old exact9290; it is not a new-source/full-CI PASS. All historical
FAIL including ReviewerMissingEvidenceFAIL9290 remain preserved.

## Bounded Admin font investigation on exact2b5b (2026-10-16)

From: bounded source author. To: parent Supervisor / source reviewer.
Status: WORKING_DRAFT — NOT APPROVED — NOT CANONICAL; BLOCKED on asset scope,
not source-ready. Base: `2b5b1c09dbe0f7acfa273cb3cb5b9b4ee888e564`;
initial worktree clean. Assignment permits only Admin layout/CSS, narrowly necessary
Admin tests and this handoff; prohibits network, models, root, live config, secrets,
services, DB, grants, commit/push, PROD/PLAN/VPN and other worktrees.

Supervisor-supplied hosted evidence (not queried by this author): actual Product CI
**38821535095 FAIL**, Admin job **116719002692**, Docker build with compiled
`/admin` path fails in Turbopack `next/font/local/target.css`, unexpected data
version / `get_font_fallbacks`, reached from layout.tsx. Admin unit tests now PASS;
source(api), web, contracts, foundation and receiver passed on that hosted source.
These are distinct facts, not a full-CI PASS:
https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38821535095/job/116719002692
Historical **38820541328 FAIL** / exact9290 and all prior FAIL above remain intact.

Local offline finding: `apps/admin/public/fonts/Onest.woff2` is **not WOFF2**.
Its 71,117 bytes start with gzip magic `1f 8b`; Python standard-library
`gzip.decompress` yields 124,376 bytes starting with TrueType `00 01 00 00`.
The decoded `fvar` table confirms variable `wght` min/default/max 100/400/900.
Original asset SHA256:
`c2475a4eb6479e2d5f5a0c1929ed29839ac9e61169e5aa5660299b8b77144275`.
This malformed input is consistent with the font-parser failure; actual compiler
confirmation of the cause remains outstanding. A plain relative CSS URL to the
existing gzip-wrapped file does not repair the browser font bytes. The initial
offline WOFF2 signature assertion FAILED; gzip/TrueType/fvar inspection then PASS.

A candidate removal of next/font plus relative CSS @font-face was evaluated and
withdrawn after the byte validation failed; layout and CSS are unchanged against
exact2b5b. No broken-font fallback is presented as preserving canonical Onest.
No dependencies are installed locally; actual Next/Turbopack builds, Docker builds,
Vitest and browser checks were NOT_RUN. No static test claiming basePath output was
added: it would not exercise the missing compiler or verify emitted font bytes.

Next bounded action: Supervisor must authorize the additional bundled-font asset
write needed to replace the gzip wrapper with its existing decoded font (prefer a
correctly named .ttf and CSS format("truetype"), without download/dependencies),
then remove next/font/local and reference that bundled asset relatively in CSS.
Require real builds for both default root and ADMIN_DEV_PATH_BUILD=1, inspect
emitted font URLs/bytes and verify Onest loads before claiming the fix. An inline
166KB base64 font in CSS was not introduced as a workaround for the asset scope.
No Next config, CI or security guards changed. Only this handoff remains changed;
source rollback is removal of this section. Parent publication, independent review
and fresh full hosted CI remain separate gates; no approval/runtime claim.

## Authorized asset-scope correction after docs-only a221 (2026-10-16)

From: bounded source author. To: Supervisor / independent reviewer.
Status: SOURCE_READY — WORKING DRAFT — NOT APPROVED — NOT CANONICAL.
Exact base: `a221f76665c045b73acc9269a9248fcb5aaa8800`, initially clean
`automation/admin-dev-delivery-20261015` worktree. No commit/push performed.

Historical correction: a221 changed **only this handoff**, despite its font-fix
commit title. It contains no font/source fix. Supervisor reports Product CI
38822111047, Admin job 116720892791 failed with the same
`get_font_fallbacks` unexpected-data-version failure:
https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38822111047/job/116720892791
This evidence is supplied by Supervisor, not independently queried here. Previous
failures and the asset-scope block above remain historical facts.

Supervisor explicitly authorized this narrowly necessary asset correction within
existing Issue #46: add exact gzip-decoded original Onest.ttf; delete malformed
Onest.woff2 only after verifying no active reference; Admin layout/CSS/tests;
expand only the existing source(admin) CI build step to root and path builds;
update this handoff. No network/download/dependency/version changes, other
worktrees, root, services/live configuration, DB/grants, commit/push, PROD/PLAN/VPN
or additional agents were used. This authorization resolves the previous asset
scope block. Its suggested removal of next/font was a proposal, superseded here
by preserving the existing local-font pipeline.

Actual changed source:
- `apps/admin/public/fonts/Onest.ttf`: 124376 exact decompressed original bytes;
  SHA256 `3faa4b905661849b2332e394b42f91b5bf5575e553c516caa81811e868a4d589`.
  No font redesign or replacement/download. Existing provenance/attribution file
  is unchanged; its SHA256 continues to identify the original gzip source bytes.
- `apps/admin/src/app/layout.tsx`: next/font/local now points to .ttf and declares
  its actual variable weight range 100–900. Next retains generated/hashed asset
  handling for default root and optional /admin; no consumer root font URL.
- Removed old malformed .woff2 after repository reference search and inspection
  found no remaining active consumer. Historical handoff references remain.
- `apps/admin/test/font_asset_test.py`: dependency-free exact historical gzip
  byte comparison, TrueType table bounds/signature/fvar checks, local layout
  reference/weight checks, and absence of the malformed source reference.
- `.github/workflows/ci.yml`: same existing source(admin) build step now executes
  two real sequential Docker builds: default root (`admin-ci-root`) and
  ADMIN_DEV_PATH_BUILD=1 (`admin-ci-path`), no push. No other jobs/steps, guards,
  Next configuration, Admin security flags or DEV contract changed.

Executed local author checks (PASS):
- `python3 -B apps/admin/test/font_asset_test.py` (2 tests; compares against exact
  a221 asset in Git, original SHA256 c2475a4e…44275).
- `python3 -B scripts/check_foundation.py` (170 Markdown files, 164 draft ops).
- `python3 -B scripts/test_email_contract_policy.py` (1 test).
- `python3 -B scripts/test_check_foundation.py` (8 tests).
- `git diff --check`.

NOT_TESTED: actual Next/Turbopack builds, both Docker builds, package typecheck,
lint/Vitest, emitted font URLs/bytes, browser font loading at root and /admin,
security/path runtime regression, hosted CI, deployment and independent QA.
No dependency installation or Corepack attempt was made. Static checks do not
prove build/runtime success; this is source-ready, not self-approved or deployed.

Rollback: restore only the listed changed files to exact base a221 (including
restoring old .woff2), remove the new .ttf and new font test; no runtime rollback
is involved. Do not present restored malformed bytes as a valid solution.
Next bounded action: Supervisor reviews/publishes the actual source diff, obtains
fresh exact-SHA hosted CI for both builds and independent verification of emitted
font bytes/URLs and browser loading in both modes. Publication is pending under
this assignment's explicit no-commit/no-push restriction; no new candidate
permalink exists yet. This handoff plus exact base and diff permit continuation
without old chat; no approval or release authority is implied.
