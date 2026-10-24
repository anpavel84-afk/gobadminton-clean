# Правила GoBadminton CLEAN — один канон

Вход для каждой модели: [START_HERE.md](../../START_HERE.md) → [AGENTS.md](../../AGENTS.md) → **[ENGINEERING_OPERATING_MODEL.md](ENGINEERING_OPERATING_MODEL.md)**. Полный канон содержит роли (§3), модели (§5), попытки/делегацию (§6), FAIL-цикл (§8.1), контекст (§10) и изменение правил (§11).

[CONTEXT_SOURCES.json](CONTEXT_SOURCES.json) фиксирует accepted commit/hash/size, а не новую runtime policy. [DOCUMENT_REGISTER.md](DOCUMENT_REGISTER.md) определяет статус источников и указывает точные supersession; он не добавляет вторую таблицу моделей или backlog. [PROJECT_RECORD_POLICY.md](PROJECT_RECORD_POLICY.md) остаётся единственной специализированной политикой хранения/передачи.

[Master Plan](../ops/AI_TRAIN_MASTER_PLAN.md) — состояние приёмки, [CURRENT handoff](../handoffs/CURRENT.md) — продолжение. [Предметные контракты](../README.md) сохраняют бизнес/privacy-инварианты. Dated evidence, draft-предложения и старые launchers не становятся действующим регламентом из-за наличия в Git.

Новая Owner-directed редакция core **v1.4** от 24.10.2026 заменяет проектные запреты, автоматически возникавшие после отказа OpenAI/другого провайдера; исходный отказ остаётся фактом конкретной попытки, другие квалифицированные маршруты доступны по обычным правилам. Exact doc commit `89c974875ead4c9bb3f17add7a19548758ecf2bc`; 104492 байта, SHA-256 `96690bc66680bca085bf004083e21a4efe29e1409293cf3e5ceb1eeb4f0bffe0`. Публикация документации сама не переписывает installed runtime pin, grants или правила active candidate. Реальная доставка каждой роли проверяется отдельно; если full reference недоступен, действует lossless full fallback по §10.3.
