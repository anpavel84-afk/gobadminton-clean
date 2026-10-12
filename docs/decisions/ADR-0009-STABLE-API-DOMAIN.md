# ADR-0009 — Stable API domain separated from physical backend placement

Status: **TECH_SELECTED**  
Date: 2026-10-02  
Owner dependency: OD-009

## Context

Owner acquired `gobadminton.ru`, plans public frontend hosting in Russia, and authorizes the MVP backend on German `vmi3510488`. Backend location may change later.

Client code must not depend on a server IP or require broad rewrites when backend moves.

## Options

1. Hard-code VPS IP/origin in frontend/mobile.
2. Use environment-specific API hostnames under `gobadminton.ru`.
3. Hide all backend identity behind only the web origin, including mobile.

## Decision

Use stable DNS names:
- `api.gobadminton.ru` — production API contract hostname;
- `dev-api.gobadminton.ru` — DEV/MVP API hostname.

Web browser preferably calls relative `/v1/*`; Russian frontend/reverse proxy sends requests to `api.gobadminton.ru`. Native/mobile calls `api.gobadminton.ru/v1` directly.

Origins are configuration, not application constants.

For MVP, `dev-api.gobadminton.ru` may point to the German VPS. `api.gobadminton.ru` is reserved for production rollout and can later point anywhere without changing API paths.

## Consequences

Benefits:
- backend migration = DNS/upstream/deployment change;
- environment separation;
- no IPs in client contracts;
- same-origin browser cookies/CSRF possible despite split physical hosting.

Costs:
- DNS/TLS and nginx/proxy configuration are explicit operational dependencies;
- direct cross-origin fallback requires audited CORS/credentials policy.

## Verification

Before enabling a hostname:
- DNS resolves to intended target;
- TLS certificate is valid;
- nginx site is isolated from unrelated virtual hosts;
- health endpoint works through hostname;
- browser proxy/direct CORS behavior is tested;
- no DB/internal ports are exposed publicly.

## Supersession

Supersede only with a later ADR if API naming/topology changes.
