# GoBadminton CLEAN — обязательная точка входа

Единственный рабочий репозиторий: `anpavel84-afk/gobadminton-clean`.

## Эталон системы разработки

**[ENGINEERING_OPERATING_MODEL.md](docs/rules/ENGINEERING_OPERATING_MODEL.md) — единственная полная целевая архитектура и регламент PMA/исполнителей.** Читать целиком из принятой ревизии перед значимой работой, затем exact assignment и необходимые предметные документы. Ссылка не означает, что текст загружен. При недоступности обязательного входа сообщить точный пробел; не восстанавливать полномочия по памяти.

В preflight зафиксировать commit/content hash правил, base/candidate SHA, Issue и неизменяемый допуск, роль, пути/эффекты, маршрут модели и владельца работы. Candidate не может менять правила собственной QA. Статус документа не доказывает установленный runtime.

## Обязательные ориентиры

- PMA — одна роль, доступная Owner из ChatGPT Work или Grok-бота. Общие GitHub задачи и Actions train; смена чата не перезапускает работу и не создаёт второго управляющего.
- Технический PM предлагает маршруты по коду и риску; PMA проверяет; router выбирает только допущенные квалифицированные варианты.
- Содержательный QA/CI FAIL перед доработкой проходит отдельный диагноз Astra High. Исправляет автор, проверяет независимая QA. Точный цикл, лимиты и статус внедрения — в эталоне, не в отдельной копии правил.
- GitHub Issues/Projects — backlog; Actions — диспетчер; Germany — защищённое исполнение; Owner Monitor — read-only состояние. Не запускать старый Supervisor/Autopilot.

## Непересекаемые границы

GoBadminton не является BadmintonOpen: не использовать его код, данные, серверы или учётные записи. Автоматические source/QA процессы — только в разрешённых task workspaces на Germany `vmi3510488`; PLAN не исполняет модельные задачи. Deployment-каталог не является checkout автора.

Один writer на задачу/пересекающийся scope; два слота — только для независимой работы. Не стирать чужие изменения и не force push. Соблюдать sandbox, least privilege, неизменяемые admissions, историю попыток и независимую exact-SHA QA.

DEV — существующий разрешённый pipeline с проверками/откатом. PROD — отдельный явный Owner GO на конкретный выпуск. Чужие VPN/проекты не трогать. CLI, подписка, Markdown и зелёный CI не создают дополнительных полномочий.

## Предметные источники

[Owner decisions](docs/manifest/OWNER_DECISIONS.md), [манифест](docs/manifest/PROJECT_MANIFEST.md), [архитектура приложения](docs/architecture/OVERVIEW.md), [границы модулей](docs/architecture/MODULE_BOUNDARIES.md), [API policy](docs/api/API_POLICY.md), [безопасность продукта](docs/security/SECURITY_AND_PRIVACY.md).

Для визуальных изменений `apps/web/**`: [Style Guide first](docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), принятые макеты/компоненты и применимый Owner override. Старый frontend не является визуальным каноном. Непокрытый паттерн — `STYLE_GUIDE_GAP`, не самовольный редизайн.

Бизнес-поведение сопровождается контрактами/тестами; существенное архитектурное изменение — ADR. Платежи, новые login providers и другие продукты не добавлять без scope.

## Code Review Rules

Проверять exact diff, acceptance и затронутые privacy/auth/idempotency/concurrency риски. Авторская самопроверка и диагноз Astra не являются независимой QA. Невыполненный тест — NOT_TESTED, обязательная проверка остаётся до приёмки. Не ослаблять проверки ради PASS.

## Завершение

[Project Record Policy](docs/rules/PROJECT_RECORD_POLICY.md): exact commit/PR, реальные evidence, ограничения, состояние CI/DEV и следующий разрешённый шаг. Не заявлять запуск, установленный adapter или deployment без доказательств. История и совместимые указатели не образуют второй регламент.
