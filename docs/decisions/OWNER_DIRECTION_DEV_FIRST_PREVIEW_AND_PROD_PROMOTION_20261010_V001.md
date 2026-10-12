# OWNER DIRECTION — DEV first, rapid visual preview, explicit PROD promotion v001

**Date:** 2026-10-10, America/Sao_Paulo
**Authority:** OWNER_DIRECT in GoBadminton project chat
**Status:** OWNER_CONFIRMED_PRODUCT_DELIVERY_DIRECTION — environment architecture/details pending Architect + Implementation + independent QA
**Working reference main:** `bfa2828e21f53c69f2525fdd0e5332a3b9e40d65` at the time of initial investigation; refresh before actual work.
**Effect of THIS record:** DOCS ONLY; no DNS, nginx, containers, DB, Runtime, Runner, production release or OAuth mutation.

## Decision

Owner reports NO REAL USERS currently on GoBadminton's pre-beta/demo surface and wants to **see accepted code changes on a separate website immediately**, without repeatedly being held by future real-user production launch gates. Establish a standing, dedicated and clearly marked DEV environment at:

- **DEV consumer:** `https://dev.gobadminton.ru` (interpreting Owner's voice-typed `dev.gobotzmentom.ru` in the context of the registered project `gobadminton.ru`).
- **Stable site / future PROD:** `https://gobadminton.ru` (and `www`) remains unchanged until a distinct promotion approval.

Intended workflow:
`source branch → Implementation author checks → independent QA zero blocking findings → guarded source integration to main → automatic deploy of exact verified build into DEV → fast smoke → Owner visual testing and feedback → separate Owner-approved promote exact image/digest into PROD`.

**No permanent two-branch requirement:** one development integration `main` plus immutable release artifacts/tags and production promotion records is preferred initially; do not add a second permanent Git branch just to simulate a second server. If a technical release branch becomes necessary, Architect/PM may justify it. Main pushes that are documentation-only or not independently accepted code need not trigger a full site deploy; no speculative unverified candidate gets autobuilt onto a public host.

DEV is an **internal pre-beta/test surface**; real-user public-launch legality, minor profiles, live GPS, live email SMTP, real staff/Admin and production gates DO NOT transfer to DEV. DEV can use only authorized test users, synthetic/test fixtures and no production-secrets distribution. However web auth/session/CSRF, role boundaries, API/DB compatibility, baseline migrations, external-provider callback allowlists, no private data leakage, and rollback/smoke remain obligatory. Do not bypass independent blocking QA findings. Owner's absence-of-real-users statement does not license reading, cloning or publishing actual account data.

## Verified infrastructure facts (read-only inspection, 2026-10-10)

- Current Moscow consumer hostname `gobadminton.ru`, `www`, nginx on VPS `ruvds-68jzd`, IPv4 `194.87.214.217`; public web container `gobadminton-mvp-web` exposing **127.0.0.1:18082** with old exact image `gobadminton-mvp-web:258c241904035ce2dd862cdf3923b77739a5866c`. Host has ~2.8 GiB available RAM and ~25 GiB free disk at inspection. Do not assume capacity indefinitely; preflight build/runtime footprint.
- Germany `vmi3510488` currently hosts `gobadminton-mvp-api` image `cc56e76141461493881e5b22f64567af441c756c` plus `gobadminton-mvp-db` PostGIS; other projects coexist. Current browser `/v1/` uses protected dedicated GoBadminton Germany channel from Moscow. Other-project VPN/XRay/WireGuard/NAT/firewall/HAProxy must not be touched.
- `dev.gobadminton.ru` has no A/AAAA response in checked resolver. Authoritative NS: `ns1.hosting.reg.ru` / `ns2.hosting.reg.ru`. Needed DNS record when authorized: `dev A 194.87.214.217`, without unverified AAAA. Current HTTPS certificate for `gobadminton.ru` must not be assumed to cover `dev`; obtain separate TLS via approved ACME/HTTPS method after DNS.
- On Moscow, an installed nginx vhost `p1p4-preview.194.87.214.217.sslip.io` only exposes HTTP port 80 ACME challenge and **returns 404 for application paths**. It is NOT an already running app preview. No DEV Next.js container exists in the observed `docker ps`.
- Published `docs/operations/FREQUENT_FRONTEND_PREVIEW_DEPLOY_POLICY_V001.md` already requires fast preview after each independent-QA accepted user-visible frontend slice, but current target was the old shared synthetic `gobadminton.ru`. This newer Owner DEV-first direction supersedes only the **preview destination and delivery policy**, not its QA/source/smoke safeguards.

## Required split — actual environments, not just two DNS aliases

Architect/Implementation to establish separate web container, image pointer, config, cookie/session origin, deploy lock and logs for DEV, while keeping production container on `18082` unchanged. The dev service must use a distinct loopback port and nginx `server_name dev.gobadminton.ru`, with SSL and same-origin `/v1/` routing.

Crucial: if DEV and PROD share the SAME backend DB/media/messaging configuration, they are **NOT isolated**. Full target is an independently managed DEV API+PostgreSQL(+media/worker/synthetic-only fixtures where relevant), with only approved credentials and strict namespace, DB, ports, volumes and secrets. Reuse the current GoBadminton-only Moscow↔Germany transport patterns, but isolate app upstreams; no modifications to the other-project transport. If a TEMPORARY frontend-only split pointing at the existing demo backend is proposed for speed, label it `SHARED_DEMO_BACKEND — NOT ENVIRONMENT_ISOLATION`, require separate explicit Owner acceptance and forbid any live-user/production claim; do not silently call it a complete DEV/PROD split.

Authenticate properly: dev OAuth VK/Yandex callback origins/CSRF cookies must match the dev hostname and registered redirect URIs; neither DEV nor PROD may silently break sign-in. Feature flags for real Radar/location, live emails, real admins/minors/public audience stay off until relevant separate approval. Make dev identifiable (visible `DEV` label), prevent search indexing and prefer access controls that still allow Owner testing/PWA on phone.

## Automatic DEV deploy and promotion

- Use an exact accepted `main` commit/code-image and immutable digest, not a moving `latest` tag. Trigger automatically after changed frontend/API code is integrated and minimal compatibility+QA source gate is satisfied. Do not create a separate PM approval for every DEV-only accepted UI deployment. Fast focused DEV smoke: HTTP/TLS, `/games`, create/view, venue selector, profile/auth test identities, my-games, `/v1` compatibility, monitor no secrets, mobile 390px/desktop sanity where applicable.
- On smoke/build/DB-incompatibility failure, leave last known good DEV image running, record RED evidence and do not claim deploy. Archive exact DEV deployed image/commit, timestamp, smoke result and clickable `https://dev.gobadminton.ru` link; surface this in PM status/Runner Monitor.
- Promote DEV→PROD by pinning the **same** previously verified image digests/compatible schema, not copying DB, cloning mutable code or rebuilding `main`. Require Owner explicit release approval, prod configuration compatibility, backup/rollback and postdeploy smoke. No automatic promotion.
- Restore former PROD image/config on failure; no destructive DB down migrations or destruction of real data.
- Remove obsolete procedural preview blockers tied only to the assumption `gobadminton.ru` is a real-user production site; retain security/authorization/candidate QA, source compatibility and effects. This Owner direction is not a bypass of any terminal FAIL/5-repair ceiling.

## Responsibility / next bounded action

**Recipient:** PMA / PM. Coordinate technical reconciliation with Architect and then independently tested Implementation/QA, source integration, DEV environment and an automatic DEV delivery train. No overengineering Runner/v3 dispatcher required as prerequisite to making DEV useful. Preserve currently productive Runner work and Writer isolation; do not stop services to create a new environment. Return evidence-backed report and only ask Owner for a genuinely missing DNS provider/account action or an explicit proposed temporary shared-backend compromise.

**Owner-visible success condition:** User opens `https://dev.gobadminton.ru` and sees the exact latest independently-QA-accepted feature build, with visible SHA/version and no manual per-slice prompt; `gobadminton.ru` stays on its earlier known-good image until separate approval.
