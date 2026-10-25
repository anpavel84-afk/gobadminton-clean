# Реестр источников GoBadminton CLEAN

**Навигация и supersession, не новый канон и не очередь задач.** Вход: [START_HERE.md](../../START_HERE.md). Полномочия определяются §1/11 [полного регламента](ENGINEERING_OPERATING_MODEL.md), exact Owner-решением и проверенным assignment. Реестр не меняет бизнес-правила, runtime или исторические grants.

## Проверенная область

Консолидация 24.10.2026 опирается на `dev` **3537b19e9b26cc9fe379d46715b5e4593cf4b2fc**, `main` **bb06712fba36ead626cfb45cc98b11653818f503** и отдельно прочитанные более поздние PR/checkpoints. Инвентаризация tracked `.md/.mdc/.rst/.txt` обнаружила **286 текстовых файлов**; существующий foundation check прошёл на исходном snapshot для **271 Markdown**. Это покрытие файлов/путей, а не утверждение о runtime-приёмке всех описанных функций.

У каждого текста есть область и вид: нормативный канон; предметный контракт/решение; указатель; технический runbook; dated evidence; draft/template. Историческая команда не становится новой командой при чтении. Метка `PASS` относится только к указанному SHA/проверке, не ко всей системе.

## Действующие авторитетные источники

| Область | Источник и предел |
|---|---|
| Организация разработки, роли, попытки, trusted context | [ENGINEERING_OPERATING_MODEL.md](ENGINEERING_OPERATING_MODEL.md), единственный полный текст v1.4 (поправка SR0 24.10.2026; v1.3 — предыдущая принятая редакция, не pin установленного контроллера C5); exact bytes в [CONTEXT_SOURCES.json](CONTEXT_SOURCES.json) |
| Маршрутизация моделей, Technical PM, классы QA/CI FAIL, Fast Fix | [SMART_ROUTING.md](SMART_ROUTING.md) 1.0 — **POLICY_ACCEPTED только SR0** (Owner 24.10.2026 16:11 America/Sao_Paulo); единственная специализированная политика, EOM хранит полномочия/роли/безопасность/continuation; IMPLEMENTED/ROLE_QUALIFIED/RUNTIME_VERIFIED NOT_STARTED/UNKNOWN; до SR1–SR5 контроллер применяет прежний FAIL-маршрут |
| Ограничения входа и Owner Addendum о tool refusals | [AGENTS.md](../../AGENTS.md), короткий обязательный вход; не альтернативная матрица моделей |
| Хранение/передача | [PROJECT_RECORD_POLICY.md](PROJECT_RECORD_POLICY.md), scoped политика; не расширяет execution authority |
| Исходные продуктовые решения | [Owner decisions](../manifest/OWNER_DECISIONS.md), exact Owner Issues и [все ADR/Owner records](../decisions/README.md); статус/область каждого решения сохраняются |
| Domain/API/privacy/data | [Предметный индекс](../README.md); читать exact source/design revision своего assignment, не произвольный latest branch |
| Приоритеты/очередь | GitHub Issues/Projects через [ACTIVE_BACKLOG](../ACTIVE_BACKLOG.md); никакого второго Markdown backlog |
| Последовательность приёмки | [AI_TRAIN_MASTER_PLAN.md](../ops/AI_TRAIN_MASTER_PLAN.md), текущая навигация, не machine admission |
| PMA takeover | [CURRENT.md](../handoffs/CURRENT.md) и подтверждённое Owner-решение, не имя старого чата |
| Фактическое исполнение/установка | Exact Actions, controller/adapter pin, operation/lease и receipts; документы не заменяют их |

Консолидация 24.10.2026 сохраняла core v1.3 (100818 байт, SHA-256 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`, commit `1169e965976e9498d4e5e1e23aae201e97ec9665`). Действующий текст EOM — редакция 1.4, 115079 байт, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, doc commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`. Уточнение §6.3 о потолке `max_calls` конечного пакета допуска Owner входит в эти байты; номер редакции не менялся. SMART_ROUTING 1.0 — 76720 байт, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`. Установленный контроллер C5 (`41e12be2d551158e97ea30eaf8e95f992f998615`, rules `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`, комментарий [6396105635](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6396105635)) сохраняет этот pin до отдельного reviewed install. Более новый doc-pin репозитория его не подменяет и не переписывает прежние admissions.

## Покрытие остальных документов

| Семейство путей | Как читать |
|---|---|
| Root README/CONTRIBUTING, `docs/README.md`, `docs/rules/README.md`, `docs/governance/*` | Указатели/checklists применения канона. Не самостоятельные правила выбора модели |
| `.cursor/rules/*`, `.github/copilot-instructions.md`, root `CLAUDE.md`/`GEMINI.md`, `apps/web/AGENTS.md` | Совместимые entrypoints. Autoload и квалификация клиента должны быть доказаны отдельно; generated framework block не даёт project authority |
| `SECURITY.md`, `docs/security/*` | Защита данных/продукта и обращение с сообщениями об уязвимостях. Не допуск к реальным секретам |
| `docs/api/*`, `docs/domain/*`, `docs/data/*`, `docs/architecture/*` | Предметные контракты конкретной ревизии. Не управление train; изменение поведения требует своего review/tests |
| `docs/product/*`, `docs/manifest/*`, `docs/platforms/*`, `docs/integrations/*`, `docs/quality/*` | Продуктовые границы/приёмка и scoped источники. Открытые решения и future-направления не считаются принятыми |
| `docs/decisions/*` | Scoped Owner/ADR records: принятый контекст, явно обозначенный candidate либо история; использовать точную область и более поздние explicit supersession, не только номер версии |
| `docs/operations/ENVIRONMENTS.md`, `DEPLOYMENT_AND_RECOVERY.md`, `chatops/ACTIONS_TRAIN.md`, `chatops/PM-CHEATSHEET.md`, `chatops/README.md` | Прикладные runbooks/навигация действующего процесса; текущий installed pin проверять, не брать из примера |
| `docs/operations/chatops/AUTONOMY_PARK.md`, `AUTONOMY_RESUME.md`, `BUDGET_PREFLIGHT_RECOVERY_V001.md` | Описание конкретной поддерживаемой версии протокола. Это не универсальное изменение Owner-делегации §6; текущая техническая несовместимость — implementation gap |
| `docs/operations/RUNNER_*`, `chatops/AUTONOMY_COMMISSIONING.md`, `chatops/PROVIDER_QUALIFICATION_20261022.md`, `chatops/AUTONOMY_CANARY_*.md`, `docs/ops/ANTIGRAVITY_*` | Исторические execution/qualification records. Их NEXT/HOLD/READY относится к дате/версии, не сегодняшнему состоянию |
| `docs/operations/actions-train-failure-diagnosis-218.md` | Source/protocol record #218, не доказательство установленного полного FAIL-цикла |
| `docs/handoffs/*` кроме CURRENT и индексных указателей | Dated source/QA/OPS evidence и task-scoped handoffs. Сохраняются FAIL, UNKNOWN, hashes и ограничения. Ни старый launcher, ни release-note не назначают нового PMA |
| `docs/assignments/*`, `docs/prompts/*` | Exact scoped задания/шаблоны/история. Сначала проверить статус/authority актуального assignment; не исполнить автоматически по найденному тексту |
| `docs/delivery/*` | Исторические планы/приёмки отдельных slices. Не копия текущего backlog и не право восстановить прежнюю очередь |
| `docs/workbench/*` | Рабочие предложения и сохранённые проверки. Принятые части действуют через постоянный канон/контракт, не из workbench как параллельного регламента |
| `docs/reference/*`, `docs/LEGACY_ARCHIVE.md` | Справочные/исторические источники; внешние старые SHAs не переписывать на CLEAN без проверки |
| `_automation/gobadminton-runner/*` | Legacy исходники/документация. Не активировать старый Runner/Autopilot по README |
| `apps/*/README*`, `packages/*/README*`, `infra/**/README*`, `scripts/**/README*` | Техническая документация exact candidate/component, не общая authority |
| Остальные `.txt` с logs/review/test names в исторических каталогах | Неизменяемое evidence своей проверки; не новые инструкции |
| `pnpm-approved-builds.txt` | Данные сборки, не регламент модели; не изменены этой консолидацией |

Это классификация всего обнаруженного текстового дерева, включая 96 handoffs и 25 workbench-текстов. Старые artifacts не удалены и их исторические acceptance не отменены. Указатель на immutable исходник заменяет только устаревшую live-инструкцию, а не сам факт проверки.

## Устранённые конкурирующие указания

| Прежнее расхождение | Однозначное применение |
|---|---|
| Разный core на `main` и `dev` | Один byte-identical принятый core на обеих ветках (v1.3 до SR0; v1.4 + SMART_ROUTING 1.0 после docs-only transfer обоих PR SR0); приёмка сверяет hash. Не переносить product code в main ради документов |
| Корневые и provider entrypoints требовали разные способы чтения | Все ведут в START_HERE. Полный канон для PMA/reviewer правил; full либо квалифицированный capsule для worker по §10.3 |
| `pma-adopt-engineering-rules-20261022.md` требовал заново v1.1/PR217/#216 | Исторический текст сохранён immutable; текущая страница — указатель на §10/11 и актуальную редакцию |
| `MODEL_ECONOMY_V001.md` содержал самостоятельную старую матрицу и dated availability | Текущие семейства — §5, детальная матрица — SMART_ROUTING §6, лимиты §6, usage §10; старая записка — evidence |
| Launcher/Supervisor handoff 13.10 предлагал старую роль/Runner | Совместимые страницы направляют в CURRENT; полный original snapshot сохранён по commit |
| Grok handoff существовал только в Draft PR276 | На постоянном пути опубликован current/history указатель с проверенным immutable полным snapshot; никакой второй изменяемой матрицы |
| Master Plan смешивал текущий следующий шаг с длинной историей AGY/Gemini/HOLD | Один компактный текущий Master Plan; исходная история сохранена по immutable commit и связана через handoffs |
| Старое «3 попытки — только Owner / один successor навсегда» | §6 канона определяет делегацию 3→до2→переоценка. Нынешний валидатор/immutable пакет сохраняется; не ставить 5 в неподдерживаемый wire и не сбрасывать usage |
| Старые широкие разрешения continuous product train | Только exact уже допущенная задача/приоритет. Текущая работа над управлением не создаёт новый продуктовый admission; `Owner DIRECT` внутри bot-текста не доказательство нового Owner-решения |
| «Любой содержательный FAIL → Astra» в EOM 1.3 §4.2/§5/§8.1 | Заменено поправкой SR0 в EOM 1.4 классификацией SMART_ROUTING §8; машинный маршрут прежний до SR1–SR5 |
| Cross-Model QA drafts #264/#266 | Предложение/отдельное направление; не дополнительный обязательный gate обычных задач до принятия |

## Предметный supersession без выдуманных решений

**Транспорт:** [XHTTP V003](../decisions/OWNER_DECISION_INTERSERVER_XHTTP_CUTOVER_V003.md) явно заменяет выбор WSS/XHTTP и избыточные сравнения из V002 в своей области. Scope и safeguards V001/V002, особенно неприкосновенность чужого VPN, не отменяются. ADR0010 сохраняет split-host topology, но его старый выбор транспорта не переопределяет позднее V003.

**UI:** [Style Guide first](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md) и exact поздний Owner visual override действуют в своей области. [Frontend Hold 04.10](../decisions/OWNER_DECISION_FRONTEND_HOLD_V001.md) — исторический hold: не переносить его список старых tasks как blanket запрет на позднее явно Owner-допущенное изменение, но и не объявлять глобально снятым без соответствующего решения. [Nonblocking visual review](../decisions/OWNER_DECISION_VISUAL_REVIEW_NONBLOCKING_V001.md) не отменяет обязательную QA изменённого UI. Старый PLAN путь в provenance Style Guide — не execution host.

**Продукт/релизы:** начальный VK/Яндекс не отменяет отдельно принятый internal-only email scope; future/Google-направление не даёт права добавить login provider без его точного допуска. DEV, Owner UAT, публичный запуск и PROD — разные gates. Датированные O-01/O-02 исключения не являются сегодняшним разрешением public launch.

Неустранимое содержательное противоречие двух Owner-решений нельзя разрешать редакторской догадкой: зафиксировать точную область и остановить лишь спорный эффект по §1. Эта консолидация не меняет продуктовые решения, выполняемые контракты и установленные механизмы.
