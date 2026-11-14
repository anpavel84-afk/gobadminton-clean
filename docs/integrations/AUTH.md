# Identity и авторизация

Статус: **TECH_SELECTED**. Первый consumer allowlist по OD-005: `vk`, `yandex`. MAX, Сбер, password, SMS, Telegram, Apple/Google не включены автоматически.

## Не связываем аккаунт с провайдером

Внутренний User UUID стабилен. ExternalIdentity определяется проверенными `provider + issuer/app namespace + subject`; mapping unique. Email, телефон, display name и avatar могут отсутствовать, меняться и совпадать у разных identities. **Auto-link по совпадению email/телефона запрещён.**

Link нового провайдера возможен только из действующей GoBadminton session после reauthentication текущего способа и успешного полного flow нового; уникальная identity не может принадлежать двум User. Unlink последнего действующего способа входа запрещён без безопасного альтернативного recovery. Account merge — отдельная проверенная процедура, не SQL update по email.

## Browser flow

1. Backend создаёт короткоживущую одноразовую auth transaction: случайные state, PKCE verifier/challenge S256, provider/client, exact redirect, allowlisted returnPath, browser binding. На фронтенд не уходит client secret.
2. System/browser redirect к provider authorization endpoint. Не использовать implicit flow или встроенную форму сбора provider password.
3. Backend callback проверяет state, срок, binding, точный provider и однократность, затем обменивает code server-side. Provider-specific параметры валидируются, не копируются произвольно из request. Для VK ID в обмен передаётся только callback `device_id` (обязателен, fail closed); произвольные token/userinfo URL от клиента не принимаются.
4. Проверяет identity через documented response/userinfo; OIDC nonce/issuer/audience/signature проверяются **только когда flow действительно OIDC**, не притворяемся что OAuth2 Яндекса автоматически им является.
5. Создаёт/находит внутренний User и выдаёт собственную opaque browser session cookie: Secure, HttpOnly, host-only, SameSite=Lax. Политика `__Host-` требует Path=/ и отсутствия Domain. Provider tokens после получения нужного профиля не удерживаются без необходимости.
6. Возвращает только на разрешённый локальный путь. Не логирует callback query, code/verifier/token, не вставляет их в analytics/Referrer.

Все cookie-auth mutations защищены CSRF token + Origin validation. CORS — allowlist конкретных origins; wildcard с credentials запрещён. Consumer и admin sessions имеют разные audience, cookie names и policy. UI не получает токен в localStorage.

## Native flow

System browser + verified app/universal links, development build, без embedded webview. Backend остаётся broker. Mobile создаёт отдельный verifier/challenge для **handoff GoBadminton**; это не тот же секрет, что provider PKCE, которым владеет backend.

После provider callback backend возвращает в приложение только short-lived одноразовый handoff code. `POST session exchange` принимает его с native verifier и привязкой к исходному client/redirect. Перехват ссылки без verifier недостаточен. Access/refresh tokens не передаются через URL.

Mobile получает короткий application access token и rotating opaque refresh token. Refresh хранится в Keychain/Keystore через соответствующее secure storage, access — в памяти по возможности. Server хранит hashes, family/revoke state; replay refresh отзывает family. Предложенный access TTL 10 минут, refresh максимум 30 дней с idle/revoke policy; exact сроки проверяются security slice. Немедленная блокировка пользователя/прав не откладывается до expiry JWT: sensitive mutations проверяют server state.

## Отказоустойчивость и безопасность

Provider недоступен — fail closed для нового входа, но уже действующие GoBadminton sessions не обязаны зависеть от постоянного provider availability. Каталог доступен гостям. Rate limits на start/callback/exchange/refresh, bounded retries, запрет неизвестного provider. JWT/crypto/OAuth primitives — maintained libraries, не собственная криптография.

Первый F-02 проверяет account creation, repeated login, collision, cancelled consent, state replay, mismatched redirect/provider, expired code, двойной callback, mobile process restart, revoke, unlink и logout. Требуются отдельные credentials каждого окружения. Live flow ещё не проверен.

Особенность iOS 4.8 не обходится: [IOS_ANDROID](../platforms/IOS_ANDROID.md), O-04. Источники: [S09–S12, S18](../reference/SOURCES.md).

### #522 native server foundation (source only; default disabled)

`NATIVE_AUTH_ENABLED=0` and `NATIVE_AUTH_CLIENTS_JSON=[]` preserve browser behavior.
Opt-in registry format: `[{"clientId":"android.dev","redirectUris":["https://app.example.test/auth/callback"]}]`.
At most 16 unique clients, 8 exact HTTPS callback URLs each; no query, fragment, credentials,
port, noncanonical URL or caller-selected browser origin. Enabled configuration requires
secure local `NODE_ENV=test,APP_ENV=local` origins with explicit secure cookies, or exact
`https://dev.gobadminton.ru` API/web origins in mvp/stage. PROD is rejected.
This source does not register links, configure runtime or establish device acceptance.

The native client creates `/v1/auth/native/transactions` with S256 challenge, exact client/
redirect tuple, 16–128 base64url callback state and a local returnPath. The returned system-
browser URL is fixed to PUBLIC_WEB_ORIGIN `/auth/native?transactionId=…`. GET grants nothing.
The browser POSTs bind using allowed Origin, JSON and `X-Native-Auth: 1`; a dedicated
HttpOnly SameSite=Lax nonce binds once and survives email/provider redirects and reload.
A second browser cannot rebind a bound transaction. Existing VK/Yandex and email flows
remain unchanged; the chooser's narrow native return option skips profile setup only for
this bridge. An existing account must explicitly confirm **Вернуться в приложение**.
Completion additionally requires active browser cookie, CSRF and ActorFence. Cancel
invalidates the bound transaction. Expired/consumed/failed flows require a new app login.

The 10 minute transaction issues a one-use 60 second handoff code. Only code and state
appear in the registered callback URL. Exchange atomically consumes the grant after
verifier/tuple/expiry and current browser account/session/capability checks. Credentials
are HTTPS no-store JSON: opaque access (10 minutes), rotating refresh (7 day idle, 30 day
absolute maximum from login). Only keyed hashes are stored; consumed refresh hashes stay
available for replay detection. Refresh locks User before family/session, rotates once;
replay durably revokes family/session and invalidates all access before HTTP rejection.
**A lost refresh response requires reauthentication. Never blindly retry a refresh token.**
Logout accepts valid native access or recognizable refresh even after access expiry,
revokes only the native session/family, and is idempotent without cookie logout effects.
Persisted global/IP/operation counters bound attempts; auth bodies are bounded to 4 KiB.
The existing API logger allowlist omits request bodies, credentials, query and error text.

Only GET `/me`, GET `/me/sessions`, DELETE `/me/sessions/:sessionId` and POST
`/me/sessions/revoke-others` opt into native bearer. Invalid, duplicate or mixed explicit
Authorization fails closed. Native `/me` has session metadata and no browser CSRF secret;
browser `/me` is unchanged. Linking, email change, reauth, Admin and all other private
consumer routes remain cookie-only. Session ownership/idempotency, Push/Radar cleanup,
User-before-Session fencing and independent account restriction enforcement remain in force.
Explicit Admin consumer-session revocation includes both server-issued consumer audiences.

Migration 0072 is additive and preserves browser rows and their mandatory cookie/CSRF fields.
Native parent rows have neither; hashes live in child access/refresh records. Safe rollback
is feature-off with schema and replay history retained; destructive rollback is unsupported.
Parent validation must run the new security, DB concurrency/replay and rendered bridge tests,
applicable existing identity/email/auth-security/S00A/restriction regressions, migration smoke,
API/web typecheck+lint and contracts check using pinned deps and a disposable local database.
No skipped DB test counts as PASS. This private export has no dependencies: runtime, CI,
independent QA, DEV acceptance, UAT, live mail/providers and verified links remain NOT_TESTED.

Source handoff file inventory (28 paths, source only):

- `apps/api/src/auth/auth.module.ts`
- `apps/api/src/auth/consumer-auth.service.ts`
- `apps/api/src/auth/session.service.ts`
- `apps/api/src/auth/auth.service.ts`
- `apps/api/src/auth/constants.ts`
- `apps/api/src/common/actor-fence.service.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/database/schema.ts`
- `apps/api/src/admin/user-restrictions.service.ts`
- `apps/web/src/components/consumer/players/ProfileComposition.tsx`
- `packages/contracts/openapi.json`
- `packages/contracts/src/index.ts`
- `docs/integrations/AUTH.md`
- `apps/api/test/unit/api-logger.test.ts`
- `apps/api/test/integration/migration.smoke.test.ts`
- `apps/api/src/auth/native-auth.controller.ts`
- `apps/api/src/auth/native-auth.service.ts`
- `apps/api/src/auth/native-session.service.ts`
- `apps/api/src/auth/native-auth-security.ts`
- `apps/api/migrations/0072_native_auth_sessions.sql`
- `apps/api/migrations/rollback/0072_native_auth_sessions.sql`
- `apps/web/src/app/auth/native/page.tsx`
- `apps/web/src/components/consumer/players/NativeAuthBridge.tsx`
- `apps/web/src/lib/native-auth.ts`
- `packages/contracts/src/native-auth.ts`
- `apps/api/test/unit/native-auth-security.test.ts`
- `apps/api/test/integration/native-auth.foundation.test.ts`
- `apps/web/test/native-auth-bridge.test.tsx`
