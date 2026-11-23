# Enterprise / внешние партнёры: границы будущей интеграции

**Статус TARGET / НЕ РЕАЛИЗОВАНО.** Это не допуск новой B2B функции, tenancy, платёжной системы, административных прав или PROD. Источники: [модули и ownership](../architecture/MODULE_BOUNDARIES.md), [API policy](../api/API_POLICY.md), [AUTH](AUTH.md), [security/privacy](../security/SECURITY_AND_PRIVACY.md), [ADR-0002](../decisions/ADR-0002-MONOREPO-MODULAR-BACKEND.md).

Два независимых сценария:
1. **Компания-разработчик:** внешний участник пишет часть исходного кода в GitHub через ограниченные PR; требования в [governance](../governance/PLATFORM_WORKSTREAMS_AND_EXTERNAL_TEAMS.md).
2. **Компания-оператор (enterprise):** будущий партнёр получает только назначенные владельцем действия в продукте/через API, например scoped управление площадками или мероприятиями. Это отдельная продуктовая, юридическая и security задача.

## Проектные ограничения для будущего enterprise scope

| Область | Требование до приёмки |
|---|---|
| Пользователь и организация | разделить личный User, Membership, организационную роль и отдельную интеграционную identity; **не утверждать, что multi-tenancy уже готово** |
| Авторизация | на сервере проверять actor + operation + конкретный resource и отзыв полномочий; внешний UI не создаёт прав |
| Источник истины | только существующий domain owner и HTTPS REST/OpenAPI; партнёр не пишет/читает PostgreSQL напрямую |
| Данные | минимальный разрешённый DTO; изоляция организаций, scoped history, приватные сообщения/контакты только при легальном назначении |
| Контракт | `packages/contracts/openapi.json`, версии, idempotency/retries, авторитетный error model и совместимость старых клиентов |
| Интеграция | в будущем scoped API/webhook/adapters только после use-case и review; signed event, минимальный payload, retries/dedupe; **webhook сейчас не обещан** |
| Администрирование | §apps/admin§ как отдельная elevated граница; отдельная partner UI only if Owner approved |
| Безопасность | service credentials/scopes/expiry/rotation вне Git; audit actor/object/organization/decision, redaction, revocation |
| Законность | договор/DPA, data residency, privacy/retention/delete/export, юридическое разрешение на обработку реальных данных |
| Инфраструктура | shared backend сохраняется; нет новых микросервисов/БД ради возможного партнёра |

## Следующий допустимый шаг перед реальным подключением

Представить одну бизнес-функцию и список объектов, полномочий, юридических участников, API contract/version и data flow. Проверить реально существующие роли и ограничения в текущем коде. Составить threat model: две организации, один пользователь в разных ролях, отмена grant, no cross-tenant leak, идемпотентность/unknown network state и аудит.

После этого — **отдельное** Owner решение, адресный ADR/contract proposal, independent security QA и DEV proof. Не изменять схемы БД, права или PROD на основании одного этого документа.
