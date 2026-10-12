# OWNER DECISION — Guest-first access + temporary DEMO_PUBLIC login v001

Status: **OWNER_AUTHORIZED**

Date: 2026-10-04

## Decision

GoBadminton consumer web must be usable for browsing without authentication.

Unauthenticated users may browse public discovery surfaces backed by accepted public projections. Authentication is required only when an action actually needs an account/session.

Until real VK/Yandex OAuth is configured, the synthetic public demo may expose a one-click **demo session** for a deterministic fictional demo identity so the Owner/QA can exercise authenticated flows.

## Guest-first contract

Guest users must be able to:
- open the application shell and navigate without a forced login redirect;
- browse public Games list and public Game detail;
- browse the public Players directory and public Player profile for profiles that explicitly opted into directory visibility;
- use location/filter/navigation/read-only UI that does not mutate account/domain state.

Guest users must not be able to perform authenticated mutations. Create/join/withdraw/manage/invite/message/Radar/profile-edit/My Games/account actions remain session-gated. Pressing such an action must preserve return intent and enter the available login path; lack of login must not break or blank the browsing shell.

## DEMO_PUBLIC temporary login

The temporary path is **not a fake OAuth provider** and must not appear as VK/Yandex.

Implement one same-origin demo-session bootstrap that:
- is disabled by default;
- requires an explicit runtime flag such as `DEMO_PUBLIC_AUTH_ENABLED=true`;
- is refused when `APP_ENV=prod`;
- can issue a normal GoBadminton consumer session only for one deterministic account inside `DEMO_ISSUER_NAMESPACE`;
- accepts no caller-selected user id, subject, role, provider or privileges;
- validates allowed web Origin and safe local return path;
- reuses the ordinary session cookie/CSRF/session-revocation machinery;
- creates no real identity and reads no real-person data;
- fails closed if the synthetic demo identity is absent or provenance does not match.

The public demo web may show a one-click **Войти в демо** action when this capability is advertised by the API. When real configured providers exist, the normal provider login path remains available.

## Public Players API correction

`GET /v1/players` and `GET /v1/players/:publicPlayerId` are public read endpoints over the accepted public projection.

For anonymous viewers they return only currently directory-visible, socially eligible, active profiles and never private/contact/session fields.

For authenticated viewers the existing self-exclusion and mutual-block filtering remains enforced. Anonymous access must not weaken authenticated block semantics.

## Supersession boundary

This decision supersedes earlier wording that no synthetic public login can ever be exposed **only for the Owner-authorized DEMO_PUBLIC environment**. It does not authorize a synthetic OAuth provider or any real-user/prod bypass.

It does not close O-01/O-02/O-03, does not authorize live OAuth, real-user launch, live Radar, or production deployment outside the already-authorized synthetic demo channel.
