# GoBadminton CLEAN — единый вход для людей и моделей

**Публичная проектная память. Не admission, не команда запуска и не доказательство готовности runtime.** Репозиторий: `anpavel84-afk/gobadminton-clean`. Эта страница одинакова в `main` и `dev`. Она направляет к источникам, а не создаёт вторую версию правил.

## Читать при входе или возобновлении

1. [AGENTS.md](AGENTS.md) — границы действий и обязательная постановка инструментальных операций.
2. [ENGINEERING_OPERATING_MODEL.md](docs/rules/ENGINEERING_OPERATING_MODEL.md) — **единственный полный регламент системы разработки** (редакция 1.4). PMA/Advisor и reviewer правил читают полный принятый текст. Worker получает полный текст либо разрешённый common+role capsule из той же проверенной редакции по §10.3.
3. [SMART_ROUTING.md](docs/rules/SMART_ROUTING.md) — **принятая специализированная политика маршрутизации** (1.0): Technical PM, role × risk матрица, классы QA/CI FAIL, Fast Fix. Принята только на стадии SR0; установка (SR1–SR6) не выполнена, до неё контроллер применяет прежний FAIL-маршрут.
4. [AI_TRAIN_MASTER_PLAN.md](docs/ops/AI_TRAIN_MASTER_PLAN.md) — последовательность приёмки и текущие незавершённые этапы; сверить с живыми Issues/PR/Actions и доступными receipts перед действием.
5. [CURRENT.md](docs/handoffs/CURRENT.md) — точка продолжения и передача PMA, а не новый backlog.
6. Exact assignment и [предметные источники](docs/README.md) своего scope. [Project Record Policy](docs/rules/PROJECT_RECORD_POLICY.md) определяет сохранение результата.

**Матрица моделей: семейства/уровни — §5 полного регламента; детальная role × risk матрица и классы FAIL — только SMART_ROUTING.md; второй таблицы нет.** Роли — §3; продолжение и попытки — §6 (3 + до 2, без изменений); классификация FAIL → direct / Technical PM / Astra → авторская доработка — §8.1 и SMART_ROUTING §8; доставка контекста — §10. Не восстанавливать эту схему из памяти чата, свободного резюме, имени модели или старой таблицы.

## Какая редакция принята

[CONTEXT_SOURCES.json](docs/rules/CONTEXT_SOURCES.json) содержит проверяемые адреса **пары принятых документов** (поправка SR0, решение Owner 24.10.2026 16:11, America/Sao_Paulo):

- **Канон EOM 1.4:** commit `8f32d58b0c29ab3cf1550e147a990f0b7290d197`, путь `docs/rules/ENGINEERING_OPERATING_MODEL.md`, SHA-256 `0c09d9dd09c323d3dfe60e05152fa56d116ed9af04c6b3b598eed10282db688f`, **110710 байт UTF-8**.
- **Политика SMART_ROUTING 1.0:** тот же commit, путь `docs/rules/SMART_ROUTING.md`, SHA-256 `cfb22df374c80a577a0c8d555b205cbe2f2a2e06caa00c8719444441f38df62e`, **71275 байт UTF-8**. Статус: POLICY_ACCEPTED (только SR0); IMPLEMENTED / ROLE_QUALIFIED / RUNTIME_VERIFIED — NOT_STARTED/UNKNOWN.
- **Предыдущая принятая редакция EOM 1.3:** commit `1169e965976e9498d4e5e1e23aae201e97ec9665`, SHA-256 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`, 100818 байт. **Это по-прежнему pin, который проверяет установленный runtime**: код контроллера и его тесты не менялись; их переход на 1.4 — отдельный reviewed code-pin. Публикация документов не переписывает runtime pin, grants, budgets и существующие immutable assignments.

Неизменяемые тексты: [EOM 1.4](https://github.com/anpavel84-afk/gobadminton-clean/blob/8f32d58b0c29ab3cf1550e147a990f0b7290d197/docs/rules/ENGINEERING_OPERATING_MODEL.md), [SMART_ROUTING 1.0](https://github.com/anpavel84-afk/gobadminton-clean/blob/8f32d58b0c29ab3cf1550e147a990f0b7290d197/docs/rules/SMART_ROUTING.md), [EOM 1.3](https://github.com/anpavel84-afk/gobadminton-clean/blob/1169e965976e9498d4e5e1e23aae201e97ec9665/docs/rules/ENGINEERING_OPERATING_MODEL.md). Branch URL служит навигацией; exact commit и hash — проверкой входа. Наличие файла или ссылки не означает, что модель получила его содержимое.

**Что действует сейчас.** Нормативный текст классификации FAIL, роль Technical PM и граница Astra — принятая политика. Пока versioned классификатор не установлен и не проверен, контроллер продолжает прежний маршрут «содержательный FAIL → Astra failure_diagnosis»; Grok, Technical PM и автор не пропускают Astra по собственному слову «простая ошибка».

## Как контекст получают разные участники

| Участник | Доставка | Проверка |
|---|---|---|
| Grok / ChatGPT PMA, Advisor | Прочитать эту точку входа и полный канон через разрешённый GitHub connector либо публичный immutable источник | Записать rules commit/hash, роль, текущий assignment и источники live checkpoint |
| Cursor / Codex author | Trusted launcher передаёт полный канон либо квалифицированный common+author capsule и exact task | Receipt принятой редакции, фактически переданного текста и выбранного маршрута |
| Независимая QA / Astra diagnosis / Antigravity | Свежая отдельная сессия, trusted принятые rules, immutable candidate и относящиеся к задаче evidence | Проверить exact source/rules; кандидат не может изменить правила собственной проверки |
| CLI без autoload или модель без GitHub/network | Trusted интегратор передаёт **полный текст** и нужные предметные inputs в разрешённый контекст | Не требовать новых прав или раскрытия credentials; ссылка без доступных байтов непригодна |

Файлы `.cursor/rules/00-gobadminton.mdc`, `.github/copilot-instructions.md`, `CLAUDE.md`, `GEMINI.md` и вложенный `apps/web/AGENTS.md` — только указатели. Они не устанавливают клиент, не подтверждают его autoload/квалификацию и не включают новую модель. При отключённом автоматическом чтении правил используется trusted explicit delivery; не снимать `--ignore-rules` и sandbox вслепую.

Если источник недоступен фактической identity, использовать lossless full fallback по §10.3. Если нет даже проверенного полного текста, указать конкретный отсутствующий вход и не совершать спорный эффект. Доступ на чтение правил не даёт записи в protected state, доступа к реальным секретам или разрешения запускать продуктовую задачу.

## Где искать остальное

[Реестр документов и supersession](docs/rules/DOCUMENT_REGISTER.md) различает действующие правила, предметные контракты, runbooks, drafts и историю. [Owner decisions](docs/manifest/OWNER_DECISIONS.md) и [ADR/решения](docs/decisions/README.md) сохраняют продуктовые решения. [Backlog](docs/ACTIVE_BACKLOG.md) указывает на GitHub Issues/Projects, не копирует очередь.

Готовность роли, установленный controller и новая приёмка подтверждаются только соответствующими receipts/Actions. Публикация этой навигации не означает RUNTIME_VERIFIED для всех клиентов. Непринятые PR, включая Cross-Model QA, не вводят дополнительные обязательные проверки обычных задач.
