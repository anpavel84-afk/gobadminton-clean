# GoBadminton — Project Rules

Статус: **OWNER_CONFIRMED**. Эти правила определяют, как проект сохраняет рабочую память и передаёт результаты между людьми, агентами и будущими командами.

## Обязательные правила

1. [Project Record & Handoff Policy](PROJECT_RECORD_POLICY.md) — GitHub как долговременная память проекта; правила для prompts, drafts, handoffs, reviews и canonical artifacts.
2. [Workbench](../workbench/README.md) — промежуточные и ещё не согласованные рабочие материалы.
3. [Prompts](../prompts/README.md) — проектные задания и launcher/assignment records.
4. [Handoffs](../handoffs/README.md) — передача результата следующей роли/команде.

## Универсальный launcher для всех ролей

Для уже открытых GoBadminton-чатов применять один и тот же launcher:

https://github.com/anpavel84-afk/agents/blob/42619275e47c292b9c37d7db6719239f26c75457/prompts/launchers/gobadminton-project-record-policy/v001.md

Он не меняет профессию/роль и не требует пересоздания чата. Он только подключает обязательное правило project memory, prompts, handoffs и GitHub-based file exchange.

## Основной принцип

**Chat is transport, GitHub is record.**

Существенный результат проекта не должен существовать только в истории чата, временной ссылке или локальном sandbox.

Другой ИИ или новая команда должны иметь возможность начать с [docs/README.md](../README.md), прочитать правила, решения, актуальные документы, prompts и handoffs и продолжить проект без обязательного доступа к старым чатам.

Если Agent Agency Hub доступен, он остаётся источником operational state Project/Task/Mission/Run/Result. GitHub хранит durable project record и не превращается во второй task board.
