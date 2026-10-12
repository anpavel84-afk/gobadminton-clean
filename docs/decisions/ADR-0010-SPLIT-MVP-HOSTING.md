# ADR-0010 — Split MVP hosting: Moscow web + Germany backend/data

Status: **TECH_SELECTED**  
Date: 2026-10-02  
Owner dependency: OD-010

## Context

GoBadminton has:
- a dedicated low-resource Moscow VPS (Rucloud, Korolёв) suitable for public web edge/runtime;
- a substantially stronger German VPS already available for API/data workloads;
- Russian-facing product traffic and a desire to keep public web entry in Russia;
- concern about Russia↔Germany network variability.

The API/database path must remain simple and correct, while frontend placement should not force a backend rewrite.

## Options

1. Put the entire MVP stack on Moscow 2 vCPU / 4 GiB / 40 GiB.
2. Put the entire MVP stack in Germany.
3. Put web/nginx in Moscow and keep API/worker/PostgreSQL together in Germany.
4. Duplicate backend/data in both regions.

## Decision

Choose option 3 for the current MVP.

Moscow:
- nginx/TLS;
- Next.js web runtime;
- same-origin `/v1/*` reverse proxy.

Germany:
- NestJS/Fastify API;
- PostgreSQL/PostGIS;
- worker when needed;
- backend migrations.

Do not duplicate primary backend/database between regions.

Do not place PostgreSQL in Moscow while API runs in Germany.

## Inter-host transport

Default:
- normal HTTPS/TLS;
- persistent connections/keep-alive;
- shallow API request graph;
- health/latency monitoring.

A VPN/XRay/WireGuard/Tailscale-style tunnel is **not** an application requirement.

If measured direct routing shows material packet loss, jitter, repeated connection failures or operational blocking, introduce a **dedicated GoBadminton tunnel** between proxy and backend. This changes only transport/upstream, not browser/mobile/API contracts.

Do not reuse unrelated personal VPN configuration as project infrastructure.

## Performance consequences

Distance mainly hurts sequential request waterfalls. Therefore:
- API screen DTOs should be reasonably coarse-grained;
- independent reads should run in parallel;
- safe public reads may use short caching;
- mutations always reach authoritative backend;
- DB remains co-located with API.

## Moscow resource consequences

The Moscow host is runtime-first. Heavy builds should prefer PLAN/CI or a stronger build host, then deploy exact artifacts/images.

## Verification

Before F-01 acceptance:
- measure Moscow→Germany RTT/loss/jitter;
- verify API health through the Moscow proxy;
- verify web response on public domain;
- verify DB is not public and no DB traffic crosses WAN;
- observe Moscow memory/disk under runtime;
- document independent rollback for both hosts.

## Supersession

This ADR supersedes any transient all-Moscow MVP idea. ADR-0009 remains valid: stable API DNS stays independent from physical backend placement.
