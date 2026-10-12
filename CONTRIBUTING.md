# Изменения GoBadminton

Рабочая ветка создаётся от проверенного актуального main. Начальная foundation опубликована по прямому разрешению владельца; дальнейшие изменения — небольшими pull request. Защита ветки и required checks должны быть включены отдельно; наличие этого документа не означает включённых настроек GitHub.

PR описывает цель, затронутые решения/контракты, точный scope, обратную совместимость, проверки и rollback. Изменения API и БД включают соответствующие документы и тесты. Не менять уже применённую миграцию; добавлять следующую. Не добавлять production-секреты или реальные пользовательские fixtures.

Основные команды F-01: `pnpm install --frozen-lockfile`, `pnpm run foundation:check`, `pnpm run contracts:check`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run build:api`, `pnpm run build:web`. DB smoke требует реального PostgreSQL/PostGIS и `RUN_DB_INTEGRATION=1`.

Общие правила: [AGENTS.md](AGENTS.md). Обязательная политика project memory/handoffs/prompts: [PROJECT_RECORD_POLICY](docs/rules/PROJECT_RECORD_POLICY.md). Правила API: [API_POLICY](docs/api/API_POLICY.md). Проверки: [TEST_STRATEGY](docs/quality/TEST_STRATEGY.md). ADR: [индекс](docs/decisions/README.md).
