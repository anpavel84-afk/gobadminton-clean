# GoBadminton internal Admin A0b

Source candidate, NON-PROD development/test only; independent QA/release not implied.
Separate Next.js entry, package and standalone Docker image. Existing modular API and its one database remain the authority. No consumer dependency/session, business moderation screens, new schema or public ingress is introduced.

Disabled by default. All configuration is server-only:

```
ADMIN_INTERNAL_APP_ENABLED=1
ADMIN_TEST_ORIGIN=http://localhost:18920
ADMIN_TEST_API_URL=http://127.0.0.1:18921
```

The application rejects non-local origins/upstreams. localhost is Chromium's secure test context and accepts Secure host cookies; no TLS/certificate/DNS installation is needed for the disposable fixture. Normal local commands use port3010; fixture uses18920/18921 and a private DB16920. Consumer synthetic origin is a different host127.0.0.1:18922. Never share localhost cookies with a consumer runtime on this test hostname.

API needs the separately accepted A0a internal-only test configuration, test provider override and preexisting synthetic principals/activation records. None of these are supplied by app configuration or real provider credentials. Public staff nomination/invitations/bootstrap remain out of scope. App never creates a principal/grants permissions or reads a DB.

## Transport and views

Only auth/me, auth/vk|yandex/start|callback, auth/webauthn/options|verify, auth/logout and the existing audit/security read are proxied. Future identity/business endpoints return404. Same-origin fetch uses a fixed loopback upstream; exact request origin/Fetch Metadata required; no CORS, arbitrary URLs, bearer forwarding or consumer cookies. GET requests receive exact Admin Origin only after the frontend origin fence. Server API still checks A0a session/audience/current roles, ticket, CSRF, activation, signature/UV/RP, fresh step-up and audit.

The provider callback is the accepted A0a JSON endpoint. The local proxy forwards only the three A0a Set-Cookie names and redirects to a code-free app page. A temporary `__Host-gb_admin_handoff` Secure HttpOnly Strict host cookie carries only ticket summary/CSRF for at most600seconds, read-and-cleared by the same-origin `/internal/auth-ticket` endpoint. It is transport, not authority; tampering cannot create a backend ticket/session. Tickets remain backend-bound and consumed by real assertion. A lost/expired handoff requires restarting login. CSRF/options/activation stay in memory; no localStorage/sessionStorage. No activation appears in query strings/screenshots/logs.

UI supports provider errors, pending enrollment, mandatory login assertion after enrollment, current session summary, step-up, logout uncertainty and same-key explicit retry. It checks authority every15seconds and on focus/visible transition, hides privileged content on refresh failure and refreshes before navigation. Revocation fails at the API immediately; UI refresh interval does not authorize operations. Single action guard prevents duplicate authenticator requests; unmount aborts the credential prompt. Invalid/expired signed attempts start a new challenge, never replay verification automatically.

Role-aware navigation is only an affordance. Overview is available to any valid Admin session; Superadmin can read the existing stepped-up security audit. Future sections are explicitly unavailable and contain no invented feature/data. Current role removal hides their nav; no client permission matrix grants API authority. No principal lifecycle controls were added.

## Visual authority

Frozen Guide and Construction Kit App.tsx/index.css verified against canonical hashes in the task plan. Same Onest/font, logo, ink/paper/lime/purple tokens,8-point rhythm and12/18/28radii. SectionHeader, ContentContainer/narrow/sidebar→stack, SurfacePanel, form/validation, notices/status/empty and primary/outline buttons. `STYLE_GUIDE_GAP ADMIN-SHELL-001`: frozen Make has no Admin/passkey/role-aware shell recipe; this is a bounded composition of existing families. No new product theme or Owner override. Font source is the frozen CSS's Figma Onest reference; self-hosted to avoid browser external requests.

## Checks and rollout preparation

`pnpm --filter @gobadminton/admin typecheck|lint|test:unit|build`; root scripts include Admin. Dockerfile packages the standalone entry, static files and own public assets, runs as UID10001, loopback bind and disabled default. Image build itself is NOT_RUN when the Docker socket is unavailable; task evidence separately exercises that standalone layout.

Reproduce actual signed browser tests with own task harness in docs/workbench/implementation/admin-a0b-internal-shell-v001. A fresh task-owned PostgreSQL/PostGIS is mandatory; never set DATABASE_URL to a live DB. Harness only uses fake provider identities and Chromium CDP virtual authenticator; real staff/physical passkey enrollment NOT_TESTED.

Rollout is preparation only. Before any real rollout, separate PM/Owner admission must name exact independently reviewed source/image, secure Admin origin/redirect/RP configuration, staff/MFA/recovery/legal gates, backend/runtime enablement, bounded ingress/TLS and cookie checks, deployment smoke and independent rollback images. Current internal-only API/app cannot be made publicly usable by flipping these test flags. Consumer and Admin images/processes roll back independently; additive A0a schema remains. No proxy/nginx/DNS/cert changes or deployments accompany this source candidate.
