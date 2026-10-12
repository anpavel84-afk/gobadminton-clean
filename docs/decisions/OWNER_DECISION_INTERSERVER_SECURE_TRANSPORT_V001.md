# OWNER DECISION — Dedicated inter-server transport Moscow ↔ Germany v001

Status: **OWNER_CONFIRMED PRODUCT/INFRA DIRECTION — ARCHITECTURE REQUIRED BEFORE PRODUCTION SWITCH**
Date: 2026-10-07
Project: GoBadminton
Scope: permanent Moscow frontend ↔ Germany API/worker connectivity and bounded artifact transfer

## Intent

The Owner wants a reliable, continuously available, authenticated, encrypted inter-server path for GoBadminton because direct Russia↔Germany connectivity can be unstable, filtered or rate-limited.

An existing, separate Germany↔another Moscow VPS installation reportedly has a stable disguised Xray-based path. That is **a candidate technology and empirical clue**, not proof that the exact same topology will work for the GoBadminton frontend VPS or application traffic.

The Owner has already launched an isolated Implementation experiment to inspect access/Xray/reverse transport and test file transfer. Do not interrupt or take ownership of that experiment.

## Target product/topology meaning

- The public web/PWA stays on the Moscow frontend host and continues using ordinary public HTTPS.
- Static maps/PMTiles remain served to end users directly from the Moscow static map origin.
- Germany remains the authoritative NestJS API, worker and PostgreSQL host.
- The inter-server link may carry the Moscow nginx-to-Germany API traffic and carefully selected internal operation/deployment/file-transfer flows **only after separately approved route/security/performance review**.
- Browser requests do not traverse a user-facing VPN. User geolocation and session semantics do not change.
- No direct cross-border PostgreSQL client connection is added. The database remains Germany-local.

## Architecture direction

Design a **dedicated, service-scoped, persistent, encrypted transport** for GoBadminton between the **current actual Moscow frontend VPS** and the **actual Germany backend VPS**.

Evaluate the already-working Xray transport first, including whether it offers a usable local TCP stream listener/reverse path, and compare only genuinely viable alternatives. The Architect must recommend an actual endpoint/proxy/routing arrangement, not stop at a generic "use VPN" slogan.

Separate credentials, process/runtime units, address bindings and observability from the Owner's existing unrelated VPN. Do not attach GoBadminton wholesale to that network or mutate a working unrelated VPN service. A third VPS relay is not a hard product requirement; use it only if direct service-scoped endpoints are demonstrably inadequate and the reliability/security implications are documented.

## Security boundaries

- No default-route hijack or blanket host traffic tunneling. Only explicitly allowed destinations/ports/flows.
- Server peers mutually authenticated by narrowly scoped keys/credentials.
- Preserve HTTPS/TLS peer verification, signed release artifacts, application authentication, authorization, CSRF and session protections; transport encryption is defense-in-depth, not application authorization.
- Expose no PostgreSQL, Docker, Admin, runner-control plane or internal management sockets through the tunnel.
- Never place tunnel keys/passwords/tokens in Git, prompts, chat or screenshots; rotation and revocation must be documented.
- Retain a separate break-glass management/deploy path, but do not silently fall back to an unrestricted public API route.
- Ensure no cross-account or user-payload logging by transport/proxies.

## Availability and performance

The transport must be **measured against the current direct HTTPS path**, not assumed superior because it is disguised:
- sustained small JSON/API traffic and concurrency;
- p50/p95/p99 latency and error rates;
- connect/reconnect and restart behavior;
- packet loss/retransmission/MTU/MSS if relevant;
- DNS/TLS/streaming/WebSocket/SSE behavior if applicable;
- CPU/RAM overhead on each VPS;
- detection of stale-but-running tunnels.

Explicitly model failures: tunnel process crash, Germany reboot, Moscow reboot, upstream path partial outage, stalled connection, credential rotation, DNS changes, key compromise and simultaneous API deployment.

Do not claim HA if the transport still relies on the same single physical route and servers.

## Large map artifacts are a distinct flow

Map bundles are generated off the Moscow live host, then copied to Moscow and served locally.

A permanent tunnel may be a **transport option for an authorized publisher**, but PMTiles delivery integrity must stand independently:
- resumable transfer;
- temporary staging path;
- full-file SHA-256;
- immutable bundle promotion only after verification;
- no half-written public archive;
- independent HTTP Range/CORS checks after publishing.

Do not pass public tile Range requests from user browsers back across Germany. The tunnel is not a replacement for artifact validation.

## Change control / sequencing

1. Allow the current Implementation Xray feasibility experiment to finish; preserve its actual evidence, exact hosts and measurements.
2. Architect audits current app proxy/deploy topology, existing SSH gates, current experiment result and security/ops constraints.
3. Architect proposes a bounded transport ADR and staged rollout, with accepted direct HTTPS fallback/disposition explicitly decided.
4. PM admits an isolated implementation/config candidate only after checking writer conflicts and recording rollback.
5. Independent QA checks API transport and large-artifact transfer separately.
6. A separate authorized release cutover changes nginx upstream only after health/performance/security gates pass.

This decision is **not** permission to modify production nginx now, change server firewalls/routing, install system services, or seize another worker's session.

## Success criterion

If a dedicated link is approved and demonstrated, the Moscow frontend can reach Germany application APIs reliably through its local/protected transport endpoint without exposing new internal services, changing business logic or requiring end users to use VPN. A tunnel failure has an explicit safe incident/fallback procedure, and PMTiles continue to load from Moscow.

The exact Xray protocol/mode, failover behavior, addressing, keys, certificates and tuning remain Architect-selected after evidence, not pre-decided by Owner.
