# GoBadminton CLEAN

Рабочий monorepo: `anpavel84-afk/gobadminton-clean`.

**[Эталонная архитектура системы разработки и регламент PMA](docs/rules/ENGINEERING_OPERATING_MODEL.md)** — один полный документ для PMA, технического PM, авторов, эксперта Astra, QA и OPS. Обязательная точка входа: [AGENTS.md](AGENTS.md). [Документация приложения](docs/README.md).

Целевая схема: Owner → PMA из ChatGPT Work или Grok-бота → GitHub Issues/Projects → Actions → два защищённых слота Germany → автор/тесты/QA → DEV. Содержательный FAIL → Astra High → точный repair brief → автор → новые проверки. Возможность в эталоне не считается установленной без evidence.

Код: `apps/web`, `apps/api`, `apps/worker`, `apps/admin`, `apps/mobile`, `packages`, `infra`. `dev` — продуктовая интеграция. Документ не обновляет автоматически main, controller pin или PROD; production требует отдельного Owner GO.

Операционное состояние — Actions и server receipts. Старые очереди/архивы не являются текущим источником запуска. Изменять архитектуру в том же каноническом файле через reviewed PR, не создавать параллельный «финальный» регламент.
