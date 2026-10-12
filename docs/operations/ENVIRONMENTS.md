# Окружения и размещение

Статус: **TECH_SELECTED / SPLIT MVP HOSTS VERIFIED / NOT YET PUBLIC**.

| Surface | Physical target | Public name | State |
|---|---|---|---|
| local / PLAN | PLAN workstation | none | Cursor AUTO / build / checks |
| MVP web | Rucloud, Королёв, `ruvds-68jzd`, `194.87.214.217` | `gobadminton.ru`, `www.gobadminton.ru` | SSH/DC ready; app not yet deployed |
| MVP API + DB | Germany, `vmi3510488`, `169.58.183.182` | `dev-api.gobadminton.ru` | previous F-01 runtime removed; clean redeploy pending |
| PROD API name | movable backend | `api.gobadminton.ru` | DNS not assigned yet |
| STAGE | later decision | later | not provisioned |

## Verified DNS — 2026-10-02

- `gobadminton.ru → 194.87.214.217`
- `www.gobadminton.ru → 194.87.214.217`
- `dev-api.gobadminton.ru → 169.58.183.182`
- `api.gobadminton.ru` — no A result at verification time.

## Moscow web host

`ruvds-68jzd`:
- Ubuntu 24.04 LTS;
- 2 vCPU;
- ~3.8 GiB RAM + 1 GiB swap;
- 40 GiB SSD, ~34 GiB free at onboarding;
- dedicated to GoBadminton;
- Desktop Commander systemd service installed/enabled;
- PLAN SSH alias: `gobadminton-moscow`;
- public IP: `194.87.214.217`.

Because this host is small, treat it as **runtime-first**, not a heavy build machine. Prefer build/test on PLAN/CI or a stronger build host, then deploy exact artifacts/images.

## Germany backend host

`vmi3510488`:
- Ubuntu 24.04.4 LTS;
- 8 vCPU / ~23 GiB RAM;
- shared with unrelated services;
- PLAN dedicated project alias: `gobadminton-backend`;
- public IP: `169.58.183.182`.

Backend/API/PostgreSQL must be isolated in GoBadminton resources only. The previous GoBadminton containers/network/volume/path were removed cleanly on 2026-10-02; source work remains in GitHub PR #4.

## Request path

Browser:
`browser → https://gobadminton.ru/v1/* → Moscow nginx → Germany API`.

Native/mobile later:
`mobile → https://api.gobadminton.ru/v1` directly.

PostgreSQL never crosses the Moscow↔Germany WAN boundary; API and DB stay co-located in Germany.

## Inter-host transport

Primary MVP transport: ordinary TLS/HTTPS with persistent connections and measured health.

Do **not** couple application code to XRay/VPN.

Before adding a tunnel measure:
- RTT;
- packet loss;
- jitter;
- connect/TLS latency;
- repeated request latency over time.

If direct Russia↔Germany routing is materially unstable, insert a **dedicated GoBadminton tunnel** at the network/proxy layer. Do not reuse the owner's unrelated personal VPN configuration as application infrastructure.

## Configuration

Server-only secrets remain outside Git. API origins/upstreams are environment configuration, never hard-coded VPS IPs.
