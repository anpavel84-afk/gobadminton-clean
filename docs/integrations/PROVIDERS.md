# Реестр внешних интеграций

Статус: **TECH_SELECTED / UNVERIFIED credentials**. Документация проверялась 2026-10-01; доступность кабинетов, разрешение приложений и реальные credentials не проверены.

| Provider | Сейчас | Adapter contract / условия |
|---|---|---|
| VK ID | Выбран для MVP | Текущий VK ID OAuth 2.1 (не `oauth.vk.com`, не generic OIDC). Callback обязан сохранить `device_id`. Token exchange: `POST https://id.vk.com/oauth2/auth` с query `grant_type`, `redirect_uri`, `client_id`, `code_verifier`, `state`, `device_id` и body `code`; `client_secret` в этот обмен не отправляется. User info: `POST https://id.vk.com/oauth2/user_info?client_id=` с body `access_token`. Контракт SDK: [vkid-web-sdk `auth.ts` @ 8ff76cfe](https://github.com/VKCOM/vkid-web-sdk/blob/8ff76cfe59ea72e370c4c6c3b40712ecfd43aadd/src/auth/auth.ts). |
| Яндекс ID | Выбран для MVP | OAuth2 authorization code, S256 PKCE, серверный token exchange; профиль через documented userinfo. Минимальные scopes, email/phone не считать обязательным идентификатором. |
| MAX | DEFERRED по Owner | Ни app, ни SDK, ни кнопки сейчас не создаются. |
| Сбер | DEFERRED по Owner | Не создаётся интеграция в первом этапе. |
| Apple / Google / прочие | FUTURE | Добавляются adapters после product/store решения. Для iOS действует O-04. |
| Maps / geocoder | Поставщик не выбран | Coordinates/provenance отдельно от display SDK; условия хранения/geocoding/атрибуции проверить перед лицензированием. |
| APNs / FCM / иные push | FUTURE delivery slice | Device tokens private, без PII в payload; транспорт не владеет статусами игр. |
| SMTP / email / SMS | Поставщик не выбран | Email может быть отсутствующим; phone и SMS не становятся скрытым login requirement. |
| S3-compatible storage | Техническая граница выбрана | Region, access policy, backup и лицензия у конкретного поставщика проверяются до подключения. |
| Payment provider | FUTURE | Только после финансового ADR и юридической модели. |

## Публичные точки входа по источникам

VK: официальный SDK VKCOM и связанные им developer docs. Яндекс: `https://oauth.yandex.ru/authorize`, `https://oauth.yandex.ru/token`, documented information endpoint. Эти адреса — справка для adapter implementation, не доказательство настроенной интеграции. Provider endpoints фиксируются в серверной конфигурации; не принимать произвольный token URL от клиента.

## Что понадобится от владельца позже

Домен/поддомены и назначенный владелец кабинетов; VK app ID и разрешённые scope/platforms; Яндекс OAuth app ID/redirects; secrets через secret store, не сообщение в GitHub. Для магазинов — аккаунты публикации/идентификаторы приложений и утверждённое решение O-04. Не использовать аккаунты/секреты Traffic или BadmintonOpen.

## Provider interface

`startAuthorization`, `exchangeCode`, `fetchVerifiedIdentity`, optional `revoke`; capability flags отражают реальные особенности провайдера. `VerifiedIdentity` содержит stable subject namespace и provenance, а не готовое application permission. Неподдерживаемая capability не имитируется. Endpoint/scopes/version changes требуют контрактных тестов и обновления [SOURCES](../reference/SOURCES.md).
