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
