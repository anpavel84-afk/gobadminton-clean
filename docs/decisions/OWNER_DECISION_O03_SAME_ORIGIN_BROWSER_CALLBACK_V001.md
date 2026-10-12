# OWNER DECISION — O-03 same-origin browser OAuth callback v001

Status: **OWNER/PM TECHNICAL CORRECTION — AUTHORITATIVE**

Date: 2026-10-05

## Problem found by live OAuth E2E

The deployed browser topology is:

`browser -> https://gobadminton.ru/v1/* -> Moscow nginx -> Germany API`

GoBadminton browser auth uses `__Host-` cookies that intentionally omit `Domain`, so both the short-lived auth-binding cookie and the consumer session cookie are host-only.

The previously configured provider callbacks pointed directly to:

- `https://dev-api.gobadminton.ru/v1/auth/vk/callback`
- `https://dev-api.gobadminton.ru/v1/auth/yandex/callback`

That is incompatible with the current browser/session topology. A cookie set on `dev-api.gobadminton.ru` is not available to the consumer web origin `gobadminton.ru`, and a binding cookie created by same-origin web traffic on `gobadminton.ru` is not sent to a direct `dev-api.gobadminton.ru` callback.

## Correct browser callbacks

The canonical browser OAuth callbacks are therefore:

- VK: `https://gobadminton.ru/v1/auth/vk/callback`
- Yandex: `https://gobadminton.ru/v1/auth/yandex/callback`

These paths are same-origin from the browser perspective and are proxied by Moscow nginx to the Germany API.

Provider-side configuration may keep the old `dev-api` callbacks temporarily as additional diagnostic/development redirects if the provider permits multiple URIs, but the GoBadminton browser runtime MUST use the `gobadminton.ru/v1/...` callbacks.

## Security invariant

Do not weaken the cookie model to work around the topology.

Keep browser cookies:

- Secure
- HttpOnly
- SameSite=Lax
- host-only
- compatible with the `__Host-` prefix

Do not introduce `Domain=.gobadminton.ru` merely to share cookies between the web and API subdomain.

## Runtime change

After the provider cabinets contain the same-origin redirects, set:

`VK_REDIRECT_URI=https://gobadminton.ru/v1/auth/vk/callback`

`YANDEX_REDIRECT_URI=https://gobadminton.ru/v1/auth/yandex/callback`

Then recreate only the GoBadminton API container so it loads the changed environment.

## Scope

This correction belongs to the existing `auth-live-vk-yandex-v001` bounded E2E lane. It does not authorize public real-user launch or close O-01/O-02.
