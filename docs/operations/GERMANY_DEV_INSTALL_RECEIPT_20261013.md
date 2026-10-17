# Germany DEV · original-host installation receipt · 2026-10-13 UTC

**Status:** `DEV_WEB_DEPLOYED / DEV_API_DEPLOYED / DEV_POSTGIS_LIVE / PUBLIC_HTTPS_PASS / DEV_BROWSER_AUTH_PENDING / CI_NOT_CONNECTED`.
Owner authorized bringing the **existing** GoBadminton to final placement, not restarting architecture or the paused Runner.

## Real hosts and routes

- Germany `vmi3510488`, `169.58.183.182`: separate DEV Web + API + DB/media; existing PROD API + DB/media retained.
- Moscow `ruvds-68jzd`, `194.87.214.217`: original PROD Web at `https://gobadminton.ru` unchanged; API uses installed GoBadminton XHTTP v2 reverse link.
- `https://dev.gobadminton.ru`: German Nginx TLS → DEV Next.js loopback `18086`; same-origin `/v1/*` → DEV API loopback `18084`. Next standalone rewrite built with `API_BASE_URL=http://api:3000` (local DEV-only Docker DNS).
- `https://api.gobadminton.ru`: separate TLS vhost → existing German PROD API `127.0.0.1:18080`.
- **Legacy exception:** `https://dev-api.gobadminton.ru` still points to PROD API, despite its name. It is referenced by real PROD `PUBLIC_API_ORIGIN` and OAuth configuration and cannot be repointed to test data without separate callback/consumer migration. Its vhost was not changed. DEV browser/API traffic uses `dev.gobadminton.ru` and never this legacy hostname.

## Exact installed artifacts

| Component | Exact identity |
|---|---|
| DEV Web image | `sha256:53eeaa1f539b9d9306e76ecfa481e1961097c5417307eb42b0bf02beea8ff0bd` |
| DEV API image | `sha256:5f8713f744a5751c56622803f880ed6e0468b122c0b503bc2b51603814e22298` |
| Radar DEV source origin | Legacy PR #195 source `16b97821cccec15d9b26f4e8e2b3073dd0bb3ee3`, **not** a fresh clean-main commit |
| DEV Dockerfile SHA-256 | `d0e8b4e2be216802339ded1fa8ba69eda0a1a5f600d7d655171bdae5e937b464` |
| DEV Compose overlay SHA-256 | `901a1e93573273bbcedb3b7fb5cc66e152a5dfc5295f6667028f01f9bd2885a7` |
| DEV TLS Nginx vhost SHA-256 | `4a919b4de38c4779ccf438f9aa692ac85c4f3d76fd61e572b41aee9f90ef48f2` |
| PROD API alias TLS vhost SHA-256 | `2e26c23eecd1b386c5720b51200bab6cde57bb075b8fa527aa2c7775fe795cc3` |

Owner DNS confirmed on host: `dev`, `dev-api`, `api` → `169.58.183.182`. Two independent Let's Encrypt certificates for new `dev` and `api` hostnames obtained via existing webroot; `certbot.timer=enabled`.

Existing DEV Compose project `gobadminton_dev_preview`: DEV DB `gobadminton-dev-preview-db` (PostGIS 18-3.6) + separate `gobadminton_dev_preview_pgdata` volume; DEV API `gobadminton-dev-preview-api` and media `gobadminton_dev_preview_avatars`; new Web `gobadminton-dev-germany-web`. DEV DB migration count **31**, not copied from PROD during this release. No schema migration executed during the new DEV Web/API bring-up. DEV API image changed only in isolated DEV Compose. Both containers `healthy`, restart `unless-stopped`.

DEV Web network `gobadminton_dev_preview_web_api` contains only DEV Web and DEV API; Docker DNS lookup for `db` from DEV Web returned `DB_NOT_RESOLVABLE`. DEV API also joins DEV backend network `gobadminton_dev_preview_internal` with DEV DB. PROD API and DB retain distinct `gobadminton_mvp_internal` network and `gobadminton_mvp_pgdata`, `gobadminton_mvp_avatars` volumes. Limits: DEV Web 768 MiB / 0.7 CPU; DEV API 800 MiB / 0.7 CPU; DEV DB 1024 MiB / 0.5 CPU. Existing PROD containers untouched.

DEV API secrets: private PROD and DEV `DATABASE_URL`, `AUTH_PEPPER`, moderation fingerprint, and effective moderation API key compared in memory and confirmed **different**. Removed inherited duplicated moderation credential from DEV `.env`, its saved environment snapshot, DEV Compose references and old DEV inspection backup; no value printed. The current DEV-only moderation key is an **invalid placeholder**: moderation fails closed until a real separate DEV key is provisioned.

## Real tests (not a browser-auth PASS)

- Germany DEV localhost ports `18086` (Web) and `18084` (API): health, players, radar, games, ready, cities returned HTTP200; both Docker health checks `healthy`.
- Germany Nginx deploy script `/root/gb-dev-germany-20261013/deploy_vhosts.sh` returned exit0: 9/9 exact expected public host/endpoint statuses, including anonymous `/v1/me` HTTP401 and PROD API alias 200.
- **From Moscow externally:** `https://dev.gobadminton.ru/v1/health` 200, `/players/radar` 200, `https://api.gobadminton.ru/v1/health` 200, `https://dev-api.gobadminton.ru/v1/health` 200, `https://gobadminton.ru/v1/health` 200 and PROD Radar 200. All SSL certificate checks `tls=0`.
- Nginx syntax PASS; unrelated-host existing HTTP2 option warnings were logged but no syntax failure.
- No browser with authorized DEV user was run. **DEV /v1/auth/methods** currently reports `vk.available=false`, `yandex.available=false`, `email.available=false`. No false login, session injection or PROD identity reuse.

## Remaining exact gaps

1. **DEV login and authenticated product smoke** need an independent DEV-scoped VK/Yandex OAuth application and callback `https://dev.gobadminton.ru/v1/auth/{provider}/callback` (or another valid DEV-only login mechanism). Do **not** copy PROD OAuth clients or sessions. Until then authenticated Profile/Messages/avatar/Radar consent cannot be accepted as PASS. UI route and anonymous smoke are LIVE.
2. Replace the fail-closed DEV moderation placeholder with a real DEV-only moderation credential before moderation-dependent acceptance tests.
3. Official new `gobadminton-clean` main and CI/Runner are still not bound to this deployed environment. Rebuild exact images against new canonical source and independent QA before enabling automated DEV delivery (clean Issues #4/#6). No legacy source QA claim transferred to new SHA.
4. PROD `dev-api` legacy hostname must remain PROD until production OAuth/consumer origins are reconfigured and checked against `api.gobadminton.ru`. Never repoint it to DEV simply because the name suggests that.

## Rollback

Original-host private release files and HTTP bootstrap backups live under `/root/gb-dev-germany-20261013`. The syntax-checked rollback entrypoint `bash /root/gb-dev-germany-20261013/rollback_vhosts.sh` restores only the two newly introduced DEV and PROD API alias vhosts **by known SHA**, validates Nginx and gracefully reloads; it never touches the live legacy `dev-api`, databases, or PROD Web/API. DEV API old image/Compose settings and env backup are preserved (with duplicated moderation key scrubbed), so the DEV-only image can be restored separately if required. No rollback was needed in the executed window.

**Caution:** existence of DEV deployment is distinct from `DEV_FULL_PRODUCT_SMOKE_PASS`; do not close Issue #3 as fully product-accepted until OAuth and moderation gaps are resolved.
