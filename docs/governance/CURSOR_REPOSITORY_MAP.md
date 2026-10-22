# Карта источников и исполнения — CLEAN

Код, правила, prompts и handoffs: `anpavel84-afk/gobadminton-clean`. [Главная инструкция](../../AGENTS.md), [единый регламент](../rules/ENGINEERING_OPERATING_MODEL.md), [индекс предметных документов](../README.md).

Germany `vmi3510488` — разрешённый host модельных задач. Task worktree, service identity, CLI path и installed controller pin определяются фактическим назначением/проверенными receipts, а не копируются из исторического onboarding. Рабочая копия может быть старой даже при правильном имени каталога.

Git metadata/push принадлежат разрешённому bridge/интегратору. Проверять effective remote и repository-specific identity; не переносить широкие credentials. PLAN не исполняет задания.

DEV — изолированные web/API/DB/media в Германии. PROD web в Москве, API/DB в Германии; отдельные права/данные и отдельный Owner GO. Подробности и границы — [окружения](../operations/ENVIRONMENTS.md).

Внешние launcher repositories и архивные checkout не являются обязательным источником текущей постановки. Исторические источники — только provenance; никакого наследования старой очереди/разрешений.
