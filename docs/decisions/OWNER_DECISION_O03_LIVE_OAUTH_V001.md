# OWNER DECISION — O-03 live VK/Yandex OAuth credentials and E2E v001

Status: **OWNER_AUTHORIZED / O-03 CLOSED FOR LIVE OAUTH E2E**

Date: 2026-10-05

## Decision

Owner has created and approved dedicated GoBadminton OAuth applications for the current MVP providers:

- VK ID
- Yandex ID

The provider-side configuration is accepted for the bounded GoBadminton live OAuth integration and verification lane.

## Approved provider configuration

### VK ID

- App name: `GoBadminton`
- App ID: `54804605`
- Redirect URI: `https://dev-api.gobadminton.ru/v1/auth/vk/callback`
- Base domains: `gobadminton.ru`, `www.gobadminton.ru`
- VK login: available
- Mail via VK ID: available
- OK via VK ID: available
- GoBadminton backend provider key remains `vk`; this decision does not create separate `mail` or `ok` provider contracts.

### Yandex ID

- App name: `GoBadminton`
- Client ID: `00b2b5de978b4c069087b37ccd533e22`
- Redirect URI: `https://dev-api.gobadminton.ru/v1/auth/yandex/callback`
- Permissions: `login:info`, `login:email`, `login:avatar`
- App type: user authorization / web services
- Provider-side service verification is not currently treated as a blocker for the bounded development E2E unless Yandex itself rejects the live authorization flow.

## Secrets

Real VK and Yandex client secrets have been staged outside Git in the Germany GoBadminton runtime configuration.

Durable records must store only presence/readback status, never secret values.

PM/runtime verification established:

- `VK_CLIENT_ID` matches the approved VK app
- `VK_CLIENT_SECRET` is present
- `VK_REDIRECT_URI` matches the approved callback
- `YANDEX_CLIENT_ID` matches the approved Yandex app
- `YANDEX_CLIENT_SECRET` is present
- `YANDEX_REDIRECT_URI` matches the approved callback
- runtime env remains private (`600 root:root`)

## Authorization granted

This decision authorizes the existing bounded task:

`auth-live-vk-yandex-v001`

and its dependent independent QA:

`qa-auth-live-vk-yandex-v001`

The implementation lane may perform GoBadminton-only runtime restart/recreate required to load the approved credentials, followed by real VK/Yandex start/callback/session verification and bounded repair if QA finds a concrete defect.

## Boundaries

This decision does **not**:

- close O-01;
- close O-02;
- authorize public real-user launch;
- authorize payments;
- authorize unrelated PROD changes;
- authorize exposing provider secrets in Git, logs, screenshots, or QA evidence;
- authorize Google/Apple production auth;
- change Game Chat / composed Inbox policy gates.

Synthetic development and the canonical frontend train remain independent.

## Completion criterion

O-03 is considered closed for live OAuth E2E when the approved provider configuration is durable in Git and the existing live OAuth implementation + independent QA lane can run against the configured Germany runtime.
