# Правила GoBadminton CLEAN — один канон

Вход для каждой модели: [START_HERE.md](../../START_HERE.md) → [AGENTS.md](../../AGENTS.md) → **[ENGINEERING_OPERATING_MODEL.md](ENGINEERING_OPERATING_MODEL.md)** и принятая политика маршрутизации **[SMART_ROUTING.md](SMART_ROUTING.md)**. Полный канон содержит роли (§3), семейства моделей (§5), попытки/делегацию (§6), FAIL-цикл (§8.1), контекст (§10) и изменение правил (§11); SMART_ROUTING — единственный источник детальной матрицы и классов FAIL.

[CONTEXT_SOURCES.json](CONTEXT_SOURCES.json) фиксирует accepted commit/hash/size, а не новую runtime policy. [DOCUMENT_REGISTER.md](DOCUMENT_REGISTER.md) определяет статус источников и указывает точные supersession; он не добавляет вторую таблицу моделей или backlog. [PROJECT_RECORD_POLICY.md](PROJECT_RECORD_POLICY.md) остаётся единственной специализированной политикой хранения/передачи.

[Master Plan](../ops/AI_TRAIN_MASTER_PLAN.md) — состояние приёмки, [CURRENT handoff](../handoffs/CURRENT.md) — продолжение. [Предметные контракты](../README.md) сохраняют бизнес/privacy-инварианты. Dated evidence, draft-предложения и старые launchers не становятся действующим регламентом из-за наличия в Git.

Принятый core v1.3 при консолидации 24.10.2026 был сохранён byte-for-byte; поправка SR0 (24.10.2026, решение Owner) выпустила редакцию 1.4 и принятую политику SMART_ROUTING 1.0, предыдущий pin 1.3 сохранён в CONTEXT_SOURCES.json. Синхронизация документации не переписывает installed pin, grants или правила активного candidate; перевод кода на 1.4 — отдельный reviewed code-pin. Реальная доставка каждой роли проверяется отдельно; если full reference недоступен, применим lossless full fallback по §10.3.
