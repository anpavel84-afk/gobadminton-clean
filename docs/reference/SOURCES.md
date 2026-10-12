# Источники и границы проверки

Проверка внешней документации: **2026-10-01**. Использованы первичные официальные документы. Они обосновывают свойства технологий/правила, но не доказывают совместимость нашей сборки, работу credentials, юридическое соответствие или store approval.

Продуктовые источники: [Owner decisions](../manifest/OWNER_DECISIONS.md) и [presentation brief](PRESENTATION_BRIEF.md). Архитектурный выбор/расчёт рисков — собственные проектные решения, а не цитаты поставщиков.

| ID | Первичный источник | Что проверялось |
|---|---|---|
| S01 | [Node release policy](https://nodejs.org/en/about/previous-releases) | LTS-линия24 как основа; точный patch фиксируется при build |
| S02 | [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting) | Самостоятельное размещение Node/reverse proxy; не требуется Vercel |
| S03 | [Nest Fastify adapter](https://docs.nestjs.com/techniques/performance) | Поддерживаемый HTTP adapter и необходимость учитывать совместимость middleware |
| S04 | [PostgreSQL explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html) | Row locking/transaction semantics, не benchmark GoBadminton |
| S05 | [PostgreSQL version policy](https://www.postgresql.org/support/versioning/) | Поддержка major versions; выбор patched18 |
| S06 | [PostGIS ST_DWithin](https://postgis.net/docs/ST_DWithin.html) | Geography radius в метрах и использование индекса |
| S07 | [Drizzle SQL](https://orm.drizzle.team/docs/sql) | Возможность parameterized SQL для специальных запросов |
| S08 | [Expo monorepos](https://docs.expo.dev/guides/monorepos/) | Workspace support и ограничения dependency/peer consistency |
| S09 | [Expo authentication](https://docs.expo.dev/guides/authentication/) | OAuth redirects/dev builds; не хранить server secrets в app |
| S10 | [VK ID official SDK](https://github.com/VKCOM/vkid-web-sdk) | Актуальный VK ID SDK и ссылки на developer configuration; точный native/app flow проверяется F-02 |
| S11 | [Яндекс OAuth code/PKCE](https://yandex.ru/dev/id/doc/ru/codes/code-url) | Authorization code и S256 PKCE; не generic OIDC предположение |
| S12 | [OAuth Security BCP / RFC9700](https://www.rfc-editor.org/rfc/rfc9700.html) | PKCE, redirect/security patterns; дополнительно [RFC7636](https://www.rfc-editor.org/rfc/rfc7636.html) |
| S13 | [OWASP API object authorization](https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/) | Проверка доступа к каждому объекту, а не только наличие login |
| S14 | [OpenAPI3.1.1](https://spec.openapis.org/oas/v3.1.1.html) | Выбранная версия формата контракта; не утверждение, что это latest |
| S15 | [RFC9457](https://www.rfc-editor.org/rfc/rfc9457.html) | Problem details error representation |
| S16 | [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) | 4.8 login-equivalence/exceptions, account deletion, различие physical services/digital purchases; перепроверить перед submission |
| S17 | [Google Play account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) | In-app initiation и web deletion resource при создании аккаунтов |
| S18 | [Яндекс user information](https://yandex.ru/dev/id/doc/ru/user-information) | Профиль/идентификатор через documented userinfo, минимальные разрешения |
| S19 | [Expo local credentials](https://docs.expo.dev/app-signing/local-credentials/) | Возможность работы со своими signing credentials; не разрешение хранить их в Git |

## Что не проверено

Не выполнены реальные OAuth регистрации/обмены, сборки framework stack, provider approval, App Store/Google Play submission, лицензирование карты, создание облака/БД, pentest и юридическое заключение. Правовые вопросы выделены как gates, а не сформулированы как готовая интерпретация законодательства.

Перед интеграцией фиксировать выбранный SDK/version, дату повторной проверки, app-specific параметры и redacted test evidence. Перед релизом заново проверять store/provider правила: сегодняшний URL не является бессрочным контрактом поставщика.
