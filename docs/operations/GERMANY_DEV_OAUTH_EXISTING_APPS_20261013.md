# GoBadminton DEV OAuth: reuse existing provider apps — installed receipt

**Date:** 2026-10-13 UTC. **Owner input:** additional DEV callback URLs registered in the existing Yandex ID / VK ID applications. **Actual runtime status:** `DEV_OAUTH_CONFIG_DEPLOYED / TWO_OAUTH_STARTS_PASS / PROVIDER_CALLBACK_BROWSER_PENDING`. This records an executed original-host DEV-only update, not QA or authenticated user acceptance.

## Routes

DEV application: `https://dev.gobadminton.ru` — Germany `vmi3510488` Nginx to isolated DEV API port `18084` and DEV Web `18086`.

Existing shared provider applications, independent callback URLs:

| Provider | Existing PROD callback (untouched) | Added DEV callback |
|---|---|---|
| VK ID | `https://gobadminton.ru/v1/auth/vk/callback` | `https://dev.gobadminton.ru/v1/auth/vk/callback` |
| Yandex ID | `https://gobadminton.ru/v1/auth/yandex/callback` | `https://dev.gobadminton.ru/v1/auth/yandex/callback` |

**Explicit tradeoff:** DEV and PROD share provider OAuth client IDs/secrets by Owner choice, but retain **separate application identities/sessions** via isolated DEV DB, `AUTH_PEPPER`, host-only Secure/HttpOnly/SameSite cookies and fixed callback origin. Provider-client compromise could affect both environments; separate provider apps would be stricter security isolation but are not needed for this agreed configuration.

## Original-host installation

- Existing Germany PROD `gobadminton-mvp-api` had both functioning VK and Yandex credentials. German DEV `gobadminton-dev-preview-api` previously had no `VK_CLIENT_ID`, `VK_CLIENT_SECRET`, `YANDEX_CLIENT_ID`, `YANDEX_CLIENT_SECRET` or corresponding redirect URIs.
- Through already-authorized Remote Desktop Commander, original-host root-only preparation copied **only** those four provider credential fields internally from the running PROD API container to the DEV-owned root `0600` `/srv/gobadminton-dev-preview/.env`; their values were **never printed or sent to chat/GitHub**. Existing DEV environment backup created at `/srv/gobadminton-dev-preview/.env.before-oauth-20261013` (root `0600`).
- New DEV-only overlay: `/srv/gobadminton-dev-preview/compose.full-germany-oauth-v002.yml`, SHA256 `ccf00cabfddadd933c2074f6649314e4ab8bf0733dc1c056c1226c93d4595c46`. It references the four root-private `DEV_*` variables and binds both fixed DEV callbacks; **no OAuth secret literal in versioned source**. Previous DEV overlay `compose.full-germany-v001.yml` remains pinned and available, SHA256 `901a1e93573273bbcedb3b7fb5cc66e152a5dfc5295f6667028f01f9bd2885a7`.
- Compose rendered config was validated without printing resolved secrets. Runtime identity checks verified provider application values are expected and redirects differ by environment; DEV `DATABASE_URL`, `AUTH_PEPPER` and moderation credentials remain different from PROD.
- Executed on Germany:
  `docker compose --env-file .env -f docker-compose.yml -f compose.full-germany-oauth-v002.yml up -d --no-deps --no-build api`.
  Only isolated DEV API was recreated, keeping **same pre-existing image** `sha256:5f8713f744a5751c56622803f880ed6e0468b122c0b503bc2b51603814e22298`. No DB migration, PROD container restart, PROD secrets edit, Nginx change, Moscow release, or Runner activation.

## Actual checks

- DEV API `healthy`, DEV `/v1/health` HTTP200, DEV Web Radar HTTP200; Moscow external access to DEV health/auth/radar valid TLS.
- `https://dev.gobadminton.ru/v1/auth/methods`: `vk.available=true`, `yandex.available=true`, email false (unchanged). PROD `/v1/auth/methods`: same two OAuth providers remain available.
- **2/2 real DEV OAuth starts PASS**, one per provider via live DEV HTTPS /v1/auth/{provider}/start. Asserted generated authorization URL uses the correct VK/Yandex authorize hostname, **DEV redirect_uri, `response_type=code`, PKCE S256, nonempty state, and DEV host-only Secure/HttpOnly/SameSite OAuth binding cookie**. OAuth secrets, client IDs, authorization URLs, states, challenge values and cookies were not logged or published.
- PROD callback URLs checked unchanged inside running PROD API; PROD API immutable image remained `sha256:349d81a96d19c5031cc6f42b7f0495a95b4fa0bc57d8a38baf9bb498a3e23c2a`, PROD public /v1/health HTTP200, Moscow PROD Nginx vhost SHA `cac10f29855e63236f0fa3d4b5dee09288e3549928ab2622eeb568e717a32a92`.

## Pending and rollback

**Full external provider consent and browser callback have NOT been exercised**; the Owner must sign into the real DEV site with a test-controlled Yandex/VK user and verify that the provider accepts its added DEV callback and the resulting session works. Then check Profile/avatar, Games, Messages, Radar consent and location privacy. Do not claim authenticated smoke or independent QA PASS until verified.

DEV-only rollback is staged and syntax checked (not invoked) at `/root/gb-dev-germany-20261013/rollback_dev_oauth_only.sh`; tracked equivalent `infra/scripts/rollback_germany_dev_oauth_v002.sh`. It checks live DEV source/environment fingerprints, recreates DEV API with the previous pinned v001 overlay, restores only root-private DEV .env backup and confirms both DEV providers are disabled again. Never changes PROD.

DEV-first policy is published separately in [draft PR #10](https://github.com/anpavel84-afk/gobadminton-clean/pull/10). Clean CI auto-delivery and generic release helper remain uncommissioned (`OPERATOR_PAUSED` on legacy Runner/Publisher/Codex/Autopilot persists). This DEV deployment used permitted direct Desktop Commander, not the old Radar-specific v002 production helper.
