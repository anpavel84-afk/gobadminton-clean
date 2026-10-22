# Ревизия правил GoBadminton CLEAN — 22.10.2026

**Статус: отчёт автора ревизии, не независимый QA PASS и не runtime acceptance.**

Поручение: Павел потребовал проверить ранее подготовленные правила, удалить действующие старые маршруты/репозитории и подготовить один финальный документ для PMA и исполнителей. Работа продолжает PR #212, не создаёт второй управляющий проект.

## 1. Проверенные входы и границы

- Начальный PR #212: head `b983cdb799959c9cde30c92355a9d1eabdb567e3`, base/dev `84a0564e11908373b2865d04c03f6b7c5db52036`.
- Архив exact head прочитан программно; SHA256 tar.gz `6df40e6c5ce0c1e283cecae956e8b7bb6d4fe8e17a7c0cb32cf54f770aa17c66`.
- Индексировано 466 выбранных текстовых файлов до 700000 bytes каждый; 248 Markdown/MDC, из них 145 вне workbench/handoffs/assignments. Проведён поиск legacy repo/path/host/Hub/paused/routing формулировок и содержательная ревизия операционных entrypoints. Это не заявление о полном security review всего кода приложения.
- Отдельно прочитаны GitHub rules/governance/Owner decisions, текущие `ACTIONS_TRAIN.md`, `core.py`, foundation checker, ENVIRONMENTS, DEPLOYMENT_AND_RECOVERY и Issue #211 comments. Прямой repo checkout на Germany оказался историческим `c9916e1...`; он не принят за актуальную source base и не изменялся.
- Отдельный пакетный read через VPS был отклонён инструментом; отклонённая команда не повторялась обходным способом. Использованы уже полученный scan и разрешённые точечные чтения GitHub. Серверная конфигурация и действующие процессы не менялись.

## 2. Главные находки и исправления

| Находка | Исправление |
| --- | --- |
| В собственном предыдущем PR #212 осталась repo-specific write ссылка на старый repo | Cursor onboarding/map полностью приведены к CLEAN, а не частично заменены строки |
| Cursor workflow предписывал PLAN/local product checkout; ENVIRONMENTS предлагал PLAN build/check | Исполнение на назначенной защищённой Германии; PLAN только управление/просмотр |
| README/ACTIVE_BACKLOG фиксировали исторический OPERATOR_PAUSED как постоянный статус | Удалены статические текущие состояния и копия очереди; живые факты берутся из receipts/Actions |
| AGENTS/rules/bootstrap/team требовали Hub и внешний launcher | Один восстанавливаемый путь внутри CLEAN; GitHub Issues/Projects + Actions, без второго task board |
| Старый ChatOps описывал запуск из открытого чата вместо действующего train | Новый единый цикл; автор bounded, контроллер автоматически продолжает допущенные задачи |
| Старый регламент запрещал auto, но #199 выбрал Cursor Auto; календарный запрет Cursor до 23.10 | Различены router profile, provider selection и effective model; readiness проверяется, а не назначается датой |
| Quota balancing мог конкурировать со stage/risk selection | Способность/сложность/риск сначала; стоимость/квота — фильтр и оптимизация |
| Размыто, кто составляет routing table | Технический PM предлагает по коду; PMA проверяет по делегации; router выбирает внутри admission; автор не меняет маршрут |
| Astra High фактически могла стать обычной QA | Отдельная оценка автора и QA; детерминированные checks сначала; экспертная эскалация по конкретному риску |
| Предыдущий draft преуменьшал AGY проблему до file permissions | Добавлены проверки CLI/tool contract, изоляции, парсинга/отказов, контекста, filenames и effective receipts |
| Target readiness смешивалась с успешным startup probe | Отдельные DOCUMENT_PUBLISHED, RULES_EFFECTIVE и PROVIDER_READY; role-specific proof обязателен |
| Старые правила содержали несуществующие CURSOR.md/.cursor routes | Добавлен реальный короткий `.mdc` loader, корневой AGENTS и единый полный текст |
| Nested web AGENTS мог стать единственным прочитанным контекстом | Добавлена явная связь с root/policy, сохранён generated Next.js block |
| Первая draft-версия предлагала ещё «рассмотреть» снятие 30/30 | Учтён последующий Owner update #211: снятие разрешено; история и остальные границы сохраняются |
| Начальные deployment/DNS сведения выдавались за текущие | Оставлены границы и процесс; dated source facts отдельно, без фиктивного live состояния |
| Старые Runner README оставались возможной стартовой инструкцией | Явные исторические указатели; code/history не удаляются и не запускаются |

## 3. Нормативная структура после ревизии

Единственный полный операционный документ: [ENGINEERING_OPERATING_MODEL.md](../../rules/ENGINEERING_OPERATING_MODEL.md). Root [AGENTS.md](../../../AGENTS.md) — короткий обязательный вход. [Project Record Policy](../../rules/PROJECT_RECORD_POLICY.md) — узкая политика хранения. Остальные governance/ChatOps файлы — scoped checklist, техническая навигация либо superseded pointer, без второй матрицы моделей.

Изменены активные entrypoints: root README/AGENTS/CONTRIBUTING; docs README/ACTIVE_BACKLOG; rules index/record policy; governance BOOTSTRAP/TEAM и четыре CURSOR файла; Owner decisions; прежний GOBAD_REGLAMENT; target draft; ENVIRONMENTS/DEPLOYMENT; ChatOps README/PM-CHEATSHEET/ACTIONS_TRAIN/IMPLEMENTATION_PLAN; web AGENTS. Добавлены Cursor/GitHub loaders, этот отчёт, единый регламент и PMA handoff. Два Runner README явно выведены из operational authority.

Прежние тексты восстанавливаются из [exact CLEAN tree до ревизии](https://github.com/anpavel84-afk/gobadminton-clean/tree/b983cdb799959c9cde30c92355a9d1eabdb567e3). Это сохраняет provenance, не создавая второй активный файл правил.

## 4. Что не следует удалять или молча переименовывать

В исторических ADR, delivered evidence, `docs/LEGACY_ARCHIVE.md`, dated handoffs/workbench и старых prompts остаются references на прежний репозиторий и его точные SHAs. Они классифицированы как история, не как текущая очередь/authority. Механическая замена slug уничтожила бы достоверность ссылок. Предметные API/privacy/product contracts не отменяются этой операционной ревизией.

Старые installer-specific Owner exceptions не превращены ни в blanket разрешение, ни в blanket отзыв: действуют только в своей доказанной области через существующий review механизм. Продуктовые решения о Style Guide и попапах сохранены ссылками.

## 5. Проверенный source/runtime gap на момент аудита

В `core.py` на `84a0564...` новый stage route использует `work_kind`, `risk`, `author_routes`, `qa_routes`; неподтверждённые native Cursor/AGY adapters отвергаются. В закрытом Codex source registry есть `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, medium/high с ограничением Luna Medium. Это source observation, не гарантия доступа конкретной подписки или установленного runtime. Не добавлять неподдерживаемые JSON поля по примеру документа.

[#211 / 6350751378](https://github.com/anpavel84-afk/gobadminton-clean/issues/211#issuecomment-6350751378) фиксирует Owner разрешение убрать искусственный дневной cap с сохранением ledgers и семь неисправностей AGY adapter. [Следующий receipt 6350782203](https://github.com/anpavel84-afk/gobadminton-clean/issues/211#issuecomment-6350782203) сообщает успешный защищённый read-only Cursor startup после узкого executable-specific AppArmor профиля, но прямо не даёт author/QA admission.

Следовательно, прежняя формулировка «Cursor вообще не запускается» уже недостаточно точна. Правила не фиксируют это вечным запретом: квалификация роли/adapter integration остаётся отдельным проверяемым результатом. Доведение #199/#211 не заменяется этой документацией.

## 6. Загрузка инструкций — проверенные внешние контракты

Официальные справочные источники, проверены 22.10.2026:

- [Codex AGENTS discovery](https://developers.openai.com/codex/agent-configuration/agents-md): chain/override/ограничение контекста; нельзя предполагать, что вложенный линк автоматически прочитан.
- [Cursor Rules](https://cursor.com/docs/rules): `.mdc`, `alwaysApply`, короткие указатели; ссылка не inlines файл.
- [GitHub instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions): repository instructions и nested AGENTS имеют особенности загрузки.
- [Antigravity Rules](https://antigravity.google/docs/rules): наличие документации провайдера не доказывает autoload конкретного установленного адаптера. Непроверенный loader не создан; PMA должен проверить actual launcher/context.

Repository instruction не является OS security boundary. Потребность включить полный принятый текст и записать rules SHA явно задана PMA; runtime implementation/receipt проверяется отдельно.

## 7. Проверки и честный статус

Документы подготовлены в отдельной ветке PR #212. В этой ревизии не изменяются application code, contracts/migrations, workflows, controller adapters/pins, admission schema, серверные ACL/profiles, активные процессы, quota ledgers или PROD.

Авторская ревизия не является независимой QA. Итоговые changed-files/CI evidence фиксируются в самом PR на точный опубликованный head. До штатного merge и подтверждения загрузки ролями статус — **DOCUMENT_PUBLISHED, RULES_EFFECTIVE NOT VERIFIED**. Ни compilation, ни документационный merge не объявляются commissioning Cursor/Antigravity.

Порядок следующего действия: [handoff PMA](../../prompts/pma-adopt-engineering-rules-20261022.md). Не нужен новый круг придумывания архитектуры или повторное утверждение уже разрешённых целей.
