# Identity и авторизация

## #522 current native client slice · 2026-11-14 · prepared source only

Root-admitted client использует qualified backend `05602db92f3c864d263218992d10963f2650d31b`; предоставленный Root
focused security PASS закрывает два retained whole FAIL findings, но не стирает исторические FAIL/UNKNOWN.
Native flag default0, registry не включён, PROD недоступен. API0.44/0072 — prepared source, не DEV release/API0.43 receipt.
Ни live auth/provider/SMTP, ни registry/association/OTA, ни device здесь не выполнялись. Native visual NOT_VERIFIED,
Owner Samsung S23 FAIL и обязательная full parity сохраняются. Решение/scenario table сведены также в
[IOS_ANDROID](../platforms/IOS_ANDROID.md), без нового framework.

Один постоянный AuthProvider окружает root Stack рядом с PreferencesProvider; координатор не создаётся при переходах.
Состояния validating/hydrating → guest/authenticated, отдельно unverifiable/offline и signing-in. До secure hydration и
проверки `/me` показывается выделенный placeholder, не guest identity. `/me` не кэшируется на диск: memory identity и
список сессий принадлежат точным actorId + sessionId secure envelope. Только actual NativeMe:
`id/displayName/locale/linkedProviders/session{ id,audience:consumer_native,transport:bearer }`. Email/photo/edit не придуманы.

`gobadminton.mobile.auth.v1` — SecureStore version1: refresh credential/session/actor и short-lived pending
PKCE verifier/state/generation/exact client+redirect/expiry/safe return intent. Access только memory.
Ни AsyncStorage, URL, logs, errors, analytics, router params не содержат access/refresh/verifier.
Старый preferences key не меняется. Unknown/corrupt secure version fail-closed и не переписывается; нет destructive
migration, credential retry queue или code-rollback=data-rollback. SecureStore failure не выдаётся за подтверждённую сессию.

Crypto использует expo-crypto random32 bytes + SHA256/base64url S256. Broker device endpoint только
`POST /v1/auth/native/transactions`, `/exchange`, `/refresh`, `/logout`. Public `GET /auth/methods` парсится буквально:
configured WEB method не доказывает доступность native flag; default-disabled transaction отвечает honest unavailable,
сохраняя каноническую игру. Browser URL сверяется с exact broker origin/path/transactionId; pending сохраняется до
открытия system browser. Native никогда не вызывает bind/complete/cancel как bearer, не добавляет Origin/cookie/CSRF.

Root-approved proposed source tuple: `gobadminton-native-dev` +
`https://dev.gobadminton.ru/auth/native/callback`. Проверяются exact raw HTTPS host/path, отсутствие credentials/port/hash,
ровно по одному code/state без лишних query keys, state одного pending, срок и generation. Code и state — единственное
разрешённое краткоживущее одноразовое callback query. Expo Router native-intent потребляет его до навигации;
WebBrowser/Linking дубли объединяются в один exchange. Web fallback не читает/показывает/логирует raw URL/code,
снимает query через history replace и просит начать вход в приложении заново. Custom scheme не auth fallback.
Android exact-path intent filter и assetlinks содержат только owned package/cert из платформенного документа;
это source, не live registry/domain proof. iOS Team/AASA/signing runtime — внешний HOLD.

Refresh singleflight. До отправки exchange/refresh durable envelope лишается одноразового pending/refresh, поэтому crash,
потерянный ответ или неуспешный rotated commit требуют **нового входа**, никогда replay. Новая identity видна лишь после
проверки NativeMe/session/actor и сохранения rotated refresh. Каждое callback/private read/secure write проверяет
session generation; logout/account switch/401/403 сбрасывают private memory, старые completions не восстанавливают её.
Secure writes сериализованы, local clear стоит после уже отправленной старой записи. Logout очищает memory немедленно,
ставит secure clear и делает один bounded server revoke по memory snapshot. Offline remote failure явно unconfirmed;
не храним credential для retry. Storage clear failure явно unverifiable; persistent logout тогда не подтверждён.

Текущие серверные TTL: transaction10min, handoff60s, access10min, refresh idle7d/max30d. Клиент не удлиняет их.
Opted-in bearer только `GET /me`, `GET /me/sessions`, `DELETE /me/sessions/:id`, `POST /me/sessions/revoke-others`;
revoke отправляет новый cryptographic Idempotency-Key, mutation автоматически не повторяется. Current revoke/logout
снимают identity; ownership и account authority остаются серверными. Link/email/reauth/profile edits и game/message/Radar
mutations остаются cookie-only до отдельных native ports. Browser поведение не меняется.

Game intent — только canonical `/games/<id>`, без query/action/external URL. После успешного входа открывается та же игра,
снова читаются public status/terms/capacity; нет auto-apply/join/create. Cancel/unavailable сохраняют безопасный intent.
Profile — header destination, не пятый tab; остальные четыре корня/полный продукт обязательны и не заявлены готовыми.

Следующая update foundation отделена от auth: стандартный expo-updates после допуска owned signed service/account,
default disabled, embedded last-working fallback, fingerprint-compatible signed assets только next natural cold launch,
без auth-form hot replacement/reload. В этом slice нет updates dependency/config/enablement или account purchase.
Data API, будущий bounded typed config, signed JS/assets OTA и native binary имеют разные delivery/trust границы.
Versioned secure pending/intents должны сохраняться совместимо при будущих binary/OTA; rollback не возвращает consumed
credentials. Owner same-binary OTA A→B runtime proof остаётся **NOT_DONE**, см. платформенную таблицу.

Новые dependency-free author tests проверяют PKCE/exact callback/duplicate/expiry, actual NativeMe, storage version/restart,
singleflight/lost refresh, stale actor/logout/private reads/secure write ordering, same-game unavailable/cancel без mutation.
Это self-check, не независимая QA, не binary/HTTPS/device acceptance. Typecheck/lint/Expo export/security+Product CI и
runtime DEV auth smoke требуют trusted parent с resolved lock/deps. История ниже сохранена и не заменена новыми PASS.

## Историческая основа и server handoff (сохранены)

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
