# Issue 46: existing Admin DEV enablement source handoff

From: source author. To: supervisor / independent source QA / Ops.
Date: 2026-10-15. Status: WORKING_DRAFT / NOT_TESTED, no activation claim.
Base: `734aaa05d166da4b6a98a4c78d5609471e6257f8`, branch `automation/issue-46`.
Assignment: Owner authorization supplied as GOBADMINTON_AUTONOMY_V1 source_only task,
Issue https://github.com/anpavel84-afk/gobadminton-clean/issues/46.
No commit/push authorized; supervisor must publish these source artifacts and attach exact
candidate SHA/permalinks to Issue 46 before independent QA. Historical FAIL and attempt
caps remain intact. Prior QA input was `{}`; no previous verdict is superseded here.

## Source revision following independent FAIL (2026-10-15)

Revision base: `d496f526e0e7937b774aef89e33655144e78fc08`, branch
`automation/issue-46`, initially clean worktree. The earlier paragraph describes
the initial submission; subsequent independent QA returned **FAIL** for this exact
base because executable bootstrap CLI unit regressions were absent. Preserve that
FAIL and the existing attempt count; this revision does not supersede the verdict.
QA also reported unavailable pnpm/dependencies and registry DNS failure, which was
an infrastructure limitation rather than a source defect.

Added `apps/api/test/unit/admin-bootstrap-cli.test.ts`. Tests dynamically import the
actual CLI entry point with real environment parsing and provisioning input schema;
only Pool/persistence primitives and console output are mocked. Synthetic fixtures
cover exact DEV operator opt-in, mvp/stage first-mode dispatch/default role,
explicit enroll role and replay receipt, invalid modes/roles, missing/invalid
reason/operation/user/token, disabled configuration and PROD denial, isolated local
gate/default compatibility, success output limited to receipt, and generic errors
even when a persistence exception contains activation token/pepper. Failure before
validation must not open a Pool; persistence success/error must close it. DB
idempotence remains covered by the existing disposable integration tests rather
than being claimed from mocked CLI dispatch.

Author execution: **NOT_TESTED**; no self-QA, dependency installation, test/build,
DB or network action performed. Independent QA should execute, from `apps/api`,
`pnpm exec vitest run --project unit test/unit/admin-bootstrap-cli.test.ts`, plus
the previously required API/AdminApp suites and disposable DB regressions. Full
hosted Product CI and NEW independent source QA must use the supervisor-published
exact candidate SHA. No live activation, provisioning or Owner role grant occurred.

Only this handoff and the new unit file are changed by this revision. Rollback is
removal of the new test file and this revision section; runtime code/config are
unchanged. Supervisor must publish the candidate and exact artifact permalinks
under Issue 46; author has no commit/push authorization. The existing bounded Ops,
configuration/enrollment, rollback and live acceptance prerequisites below remain.

## Bounded source result

Existing AdminService, provider subjects, separate cookies/audience, WebAuthn UV/RP,
activation, assertion, CSRF, step-up, replay/rate control, epochs, roles and venue ownership
remain the authority. No UI redesign, new auth system, migration or consumer change.

API config admits the original isolated test/local path, or deliberately enabled
`ADMIN_INTERNAL_ENABLED=1` + `ADMIN_DEV_ENABLED=1`, real `NODE_ENV=production`,
`APP_ENV=mvp|stage`, both public consumer/API origins exactly
`https://dev.gobadminton.ru`, Admin origin exactly `https://dev-admin.gobadminton.ru`.
This hostname is a proposed bounded Ops configuration, not evidence DNS/TLS exists.
Admin must not appear in consumer allowed origins. Secure cookies cannot be disabled.
A dedicated >=32 character ADMIN_AUTH_PEPPER must differ from consumer/provider/email/
moderation secrets. Both administrative callback URIs must be exact:
`ADMIN_ORIGIN/v1/admin/auth/vk/callback` and `/yandex/callback`; at least one provider
must have configured client ID/secret. Provider adapters still reject unconfigured providers.
PROD APP_ENV is denied regardless of opt-in; fake test NODE_ENV is denied on DEV.

AdminApp server-only config requires ADMIN_INTERNAL_APP_ENABLED=1, ADMIN_DEV_ENABLED=1,
NODE_ENV=production, APP_ENV=mvp|stage, PUBLIC_WEB_ORIGIN=https://dev.gobadminton.ru,
ADMIN_ORIGIN=https://dev-admin.gobadminton.ru and ADMIN_API_URL=https://dev.gobadminton.ru.
Do not supply ADMIN_TEST_ORIGIN/API_URL on this path. Existing local configuration remains.
No environment values in this document are credentials.

## Trusted provisioning after reviewed deployment only

Existing bootstrap CLI now supports explicit ADMIN_DEV_OPERATOR_PROVISION=1 on validated
DEV. Operator supplies ADMIN_BOOTSTRAP_MODE=first|enroll, exact active existing
ADMIN_BOOTSTRAP_USER_ID, UUID ADMIN_BOOTSTRAP_OPERATION_ID, ADMIN_BOOTSTRAP_REASON
(machine reason, 3–100 alphanumeric/underscore/hyphen), and a private random
ADMIN_BOOTSTRAP_ACTIVATION_TOKEN (32–256 characters). First mode requires superadmin;
enroll requires explicit ADMIN_BOOTSTRAP_ROLE from the existing role enum. Local test
bootstrap retains ADMIN_BOOTSTRAP_SOURCE_TEST=1 and its legacy defaults.

Use the existing packaged bootstrap entry under a reviewed restricted operator process;
never paste token values into CLI arguments, issues, screenshots or logs. Supply process
secrets through the approved operator secret channel, without shell tracing. CLI prints
only principal ID/replay result; errors are generic. Deliver activation privately to the
verified person; it expires under existing 30-minute policy. Exact retry is idempotent;
changed input conflicts. Subsequent enrollment uses immutable audit receipt and the same
authority transaction lock. Existing/revoked principals are not re-created or revived.
Role changes, recovery and revocation continue through authenticated lifecycle commands.
No user, provider subject, credential or session is fabricated by provisioning.

Operator must resolve private Owner identifiers to exact existing active IDs and verify
identity outside the application before any provisioning. No email/header/nickname grants.
One unresolved approved account and the unresolved third nickname remain prerequisites;
do not guess, create accounts or publish private identifiers. Owner must log in through
the bound VK/Yandex identity at the reviewed Admin UI, privately enter activation token,
register a real passkey, then perform the required signed login assertion. Concrete
provider consent/registration/passkey instructions depend on that reviewed UI being live.

## Evidence and required delivery

No self-QA, tests, build, DB command, live configuration, grant, provider registration,
DNS/nginx/service/automation change, deployment, commit or push performed by author.
Added API config and AdminApp fence unit regressions and disposable DB provisioning
regressions alongside the existing A0a normal-user/foreign-provider/revoked/CSRF/MFA/
step-up/replay tests. Their execution and outcomes are NOT_TESTED.
Independent QA must review exact published SHA and execute API/AdminApp unit tests and
A0a disposable PostGIS regressions, including original local path and DEV config matrix.
Full hosted Product CI must run on that same SHA; a source review is not runtime acceptance.

Current .github/workflows/dev-deploy.yml produces only API/Web digests via build-pair.sh;
it does not deliver the separate existing apps/admin Dockerfile/image. Minimal next Ops
slice: extend that SAME pipeline/release manifest with an Admin digest from the same SHA,
its gate/build, restricted DEV service and separate HTTPS ingress, approved config and
provider callbacks, then bind Admin digest to backup/rollback/verification/ACCEPTED receipts.
Keep existing paired API/Web delivery and rollback guarantees; do not add a second deploy
workflow/system. Independently review this integration before applying it. No automation
files are changed in this source task. No PROD, PLAN or VPN actions are authorized.

Before claiming activation supervisor must supply real backup/rollback evidence, exact
paired image verification and Admin image verification, server ACCEPTED, synthetic live
positive/negative UAT, provider and real passkey enrollment evidence. Runtime evidence
remains NOT_TESTED rather than being invented from source. Only operator-verified existing
identities may receive actual roles after reviewed deployment.

Rollback: disable ADMIN_INTERNAL_ENABLED and ADMIN_INTERNAL_APP_ENABLED plus DEV opt-ins,
remove Admin ingress using reviewed Ops rollback and restore prior verified image set.
Do not delete audit or bootstrap state; config rollback is not role/session revocation.
Use existing authenticated revocation for actual principals/credentials/sessions when
required. No DB/schema rollback is introduced. Source rollback is the reviewed reversal
of this bounded source diff. Next action: supervisor publishes candidate and requests
NEW independent exact-SHA source QA; no next product slice is authorized.
