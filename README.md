# GoBadminton CLEAN

Рабочий monorepo: `anpavel84-afk/gobadminton-clean`.

## Один вход для всех моделей

**[START_HERE.md](START_HERE.md)** — начинать здесь в Grok, ChatGPT, Cursor, Codex и других разрешённых клиентах. [AGENTS.md](AGENTS.md) — обязательные границы. [Полный регламент](docs/rules/ENGINEERING_OPERATING_MODEL.md) — единственное место организации разработки, матрицы моделей и FAIL-цикла. [Master Plan](docs/ops/AI_TRAIN_MASTER_PLAN.md) — последовательность приёмки. [Текущая передача](docs/handoffs/CURRENT.md) — продолжение работы без повторного запуска.

[Документация приложения](docs/README.md) · [реестр документов](docs/rules/DOCUMENT_REGISTER.md) · [точная редакция контекста](docs/rules/CONTEXT_SOURCES.json) · [backlog](docs/ACTIVE_BACKLOG.md).

Код: `apps/web`, `apps/api`, `apps/worker`, `apps/admin`, `apps/mobile`, `packages`, `infra`. `dev` — продуктовая интеграция. `main` — default discovery; общие entrypoints и принятый канон синхронизируются только как документация, без переноса продуктового кода.

Наличие правила в репозитории не доказывает его получение моделью или установленную функцию. Для исполнения нужны exact assignment, квалифицированная роль и действующие runtime gates. PROD — отдельный Owner GO. Архивные очереди, snapshots и Draft PR не являются текущим допуском.
