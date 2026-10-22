# GoBadminton CLEAN

Рабочий monorepo: `anpavel84-afk/gobadminton-clean`.

Начать с [AGENTS.md](AGENTS.md) и [единого регламента разработки/PMA](docs/rules/ENGINEERING_OPERATING_MODEL.md). [Документация продукта](docs/README.md).

Код: `apps/web`, `apps/api`, `apps/worker`, `apps/admin`, `apps/mobile`, `packages`, `infra`. Задачи и приоритеты — существующие GitHub Issues/Projects; исполнение — действующий GitHub Actions train с защищёнными исполнителями на Germany VPS.

`dev` — продуктовая интеграция и изолированный DEV. `main`/контроллер/PROD не обновляются автоматически от изменения документа. PROD требует отдельного Owner GO на конкретный выпуск.

Операционный статус проверять по Actions и серверным receipts. Старое утверждение о постоянном OPERATOR_PAUSED не является текущим статусом. Архивы и dated handoffs сохраняют историю, но не дают полномочий запускать старые службы.
