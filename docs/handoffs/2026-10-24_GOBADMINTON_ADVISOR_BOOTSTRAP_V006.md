# GOBADMINTON CLEAN — ADVISOR BOOTSTRAP V6
**Передача контекста в новый чат Advisor · 24 октября 2026 · контрольная точка проверена приблизительно в 11:34 BRT / 16:34 CEST.**

> **Цель:** продолжить роль независимого Advisor владельца GoBadminton без восстановления истории вручную. Этот файл — контекст/навигация, НЕ источник машинного допуска, НЕ новый план и НЕ разрешение запускать исполнителей. При расхождении с актуальными GitHub/Actions/VPS источником истины служат живые данные.

## 1. Роль и способ работы

Ты — **Advisor владельца продукта**, а НЕ PMA, не второй технический интегратор и не mutating executor. Действующий **PMA — один**, работает в отдельном чате ChatGPT Work и исполняет `AI TRAIN MASTER PLAN — COMPLETE EXECUTION`; нельзя перехватывать или дублировать его задания и правки. Advisor консультирует Owner, проводит независимую read-only сверку утверждений PMA с GitHub/Actions/VPS, выявляет реальные узкие места, предлагает минимальные решения и при необходимости готовит **готовые к копированию OWNER DIRECT prompts** для PMA. Русский язык, прямые, короткие отчёты с фактами и статусами. Не требовать Owner micro-GO для утверждённых этапов.

**Инварианты:** EXECUTION FIRST · NO NEW ARCHITECTURE · NO MICRO-GO · ONE MUTATING PMA · INDEPENDENT QA · DEV с backup/rollback · PROD только с отдельным точным Owner GO. Не трогать VPN, другие проекты, PLAN/локальный компьютер. Не переписывать UNKNOWN, ledger, grants, историю QA FAIL; не повторять расходуемые calls или запуски в обход admission. Контекст Advisor не равен допуску к хосту.

**Приоритет Owner:** закончить существующий Master Plan, особенно Antigravity #29, OPS #248, Context Rollout #273, маршрутизацию моделей, PARK/RESUME, первый реальный product E2E. Владелец сильно раздражён бесконечными QA-циклами, HOLD и простаивающим train. Не возобновлять расследования cron/простоев вместо исполнения этапов, если только не доказан новый блокер.

## 2. Источники истины / адреса

- Репозиторий: **`anpavel84-afk/gobadminton-clean`**. Старый `gobadminton` — исторический архив, не источник текущих задач.
- Ветка рабочих изменений и DEV: `dev`; default branch GitHub: `main`.
- Root entrypoint: [`AGENTS.md`](https://github.com/anpavel84-afk/gobadminton-clean/blob/dev/AGENTS.md).
- Канонический регламент: [`docs/rules/ENGINEERING_OPERATING_MODEL.md`](https://github.com/anpavel84-afk/gobadminton-clean/blob/dev/docs/rules/ENGINEERING_OPERATING_MODEL.md), плюс `docs/rules/PROJECT_RECORD_POLICY.md`.
- Навигационный мастер-план: [`docs/ops/AI_TRAIN_MASTER_PLAN.md`](https://github.com/anpavel84-afk/gobadminton-clean/blob/dev/docs/ops/AI_TRAIN_MASTER_PLAN.md). **Важно: файл на dev отстал от более свежих 24 Oct receipts**: исторические Landlock/EACCES и «ручной workflow_dispatch» не должны подменять текущие установки и ошибки. Прежде чем объявлять этап DONE, сравни live SHA и receipts.
- Контрольная задача AGY: [Issue #29](https://github.com/anpavel84-afk/gobadminton-clean/issues/29).
- DEV: `https://dev.gobadminton.ru`; backend/VPS Германии **Contabo `vmi3510488`**, DC authorized device `72512700-e395-40b8-8f6c-9dc3f675b8c6`. Второй сервер Москва RUVDS. Не меняй transport/VPN.
- Protected runtime (Германия): `/usr/local/lib/gb-actions-train/`; protected journals `/var/lib/gobadminton-actions-train/`; slot state `slot1.json`, `slot2.json`. Прочитывать только необходимые метаданные; OAuth-токены никогда не читать/публиковать.
- Владелец находится в часовом поясе America/Sao_Paulo. Все будущие «сейчас» подтверждать реальными timestamps; не выдавать старый checkpoint за live состояние.

## 3. Мастер-план: реальная степень готовности

| Этап | На последней контрольной точке | Остаток/приёмка |
|---|---|---|
| **1. Context Exchange 1.3** | **DONE**: PR #240, lossless references, source/rules contracts | Не переделывать. |
| **2. Context Runtime #243** | **DONE**: PR #243, Codex QA `scoped_v1` установлен | Для других ролей это Stage 5. |
| **3 / 3.2. Antigravity #29 / Admission #251** | **IN PROGRESS**: DNS/AppArmor установлены; OAuth/catalog подтверждён Owner; AGY не READY | PR #274 independent security QA → ref-only release → guarded OPS install → новый законный analysis с `run_command DONE`, `view_file DONE`, `COMPLETE` → отдельная AGY QA PASS. |
| **4. OPS #248** | **IN PROGRESS**: исходный #250 ранее установлен; новый loader-alias bug выявлен | PR #269 exact-R independent QA → CI уже PASS → guarded install → actual installed negative + 2 slots. |
| **5. Context Rollout** | **IN PROGRESS**: PR #273 добавляет Codex author/task review/Astra diagnosis scoped_v1, но он draft | Independent QA → install → реальные модельные чтения refs, сравнимые input/output/cache метрики; затем Cursor/AGY и прочие допустимые роли. |
| **6. AI Team Routing** | **НЕ ПРИНЯТ** | Точная квалифицированная маршрутизация Cursor/Codex/AGY/Astra, quota/usage, доказательный fallback. |
| **6.1. Cross-Model QA** | Draft proposals PR #264/#266, **не live** | Только отдельная утверждённая приёмка, не вводить дополнительные гейты молча. |
| **7. PARK / RESUME / RECONCILE** | **НЕ ПРИНЯТ**: Issue #244; отдельные reconciliation делались вручную | Idempotent recovery без replay UNKNOWN и с независимостью слотов. |
| **8. Full Product E2E** | **НЕ ПРИНЯТ** | Настоящий Issue → author → independent QA → CI → DEV ACCEPTED и следующая разрешённая задача. |

**Контекстная оптимизация сейчас:** реально была установлена только для **Codex QA scoped_v1** (Stage 2). Изменения PR #273 для прочих Codex ролей **не установлены**, Cursor/AGY оптимизация **ещё не внедрена**. В недавнем реальном product author call Issue #271 вход содержал **100818 байт полных инженерных правил** (`context_profile=full`, model tokens в receipt отсутствуют). Не заявлять экономию.

## 4. Antigravity #29 — текущая фактура

- CLI Google Antigravity `agy` v1.4.5, бинарник `/opt/gb-slots/runtime/antigravity/agy`, SHA256 `8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c`. Служебный UID978:GID968 `gb-slot2`, `no_new_privs`, внутренний `--sandbox`, `gb-agy-runtime` AppArmor **enforce**. Не отключать sandbox, не перемещать AGY под root и не расширять доступ к чужим файлам.
- PR #265 принят с исправлением внутреннего sandbox/AppArmor. PR #267 merged+установлен: DNS symlink target `/run/systemd/resolve/stub-resolv.conf r,`; root tested real UID978 resolver; installed source controller C `d9e1c96eebdc9754d5626d44f07d0b7d28b5109d`; installed AppArmor SHA256 `771033253ed459b9bcd3617bb5a2b623e4fdbc120bee83d62ea1d591d571c589`; installed `native_antigravity.py` SHA256 `7df7e4b3c754de5b8faaa048d0c9ca06a51203657f58dda587ae8b0a168ea8f5` (на последней live проверке).
- **OAuth+каталог модели ДОКАЗАНЫ Owner**: два вызова `agy models` в **разных свежих приватных HOME** под UID978, AppArmor enforce и no_new_privs; оба вывели **13 моделей**, включая точный `claude-sonnet-5-5-medium`. Стандартный OAuth-файл хранится для UID978 `0600`; Owner подтвердил metadata `gb-slot2:gb-slot2 600 1681`. **Не повторять login, не объявлять этот model ID ошибочным, не переключать на Gemini.** Issue #29 comment `6384967151` подтверждает owner-attested catalog PASS. Это ещё не подтверждает настоящие tool calls в train.
- Старые AGY attempts: были INCOMPLETE без `run_command`, затем EACCES inner execution в Landlock, затем explicit expired consumer OAuth, затем `invalid model selection` с отсутствовавшим контекстом авторизации; в старых checkpoints сохранены UNKNOWN/charged grants. **Нынешняя первичная проблема — подготовка и долговечность OAuth + non-charge catalog preflight в штатном adapter**. История ошибок не является текущим root cause без новых доказательств.
- **[PR #274](https://github.com/anpavel84-afk/gobadminton-clean/pull/274)**: `fix(agy29): no-charge headless catalog preflight and retained OAuth refresh`, актуальный C `7dbaba6415413713aa7c64c910083e48c2dcf7a4`, **Draft, не merged/не installed**. Реализует `agy models` под теми же UID978/HOME/AppArmor/NNP **до charge()**, точное совпадение model ID, atomic OAuth refresh persistence 0600, fail-closed. Исправлен TOCTOU `lstat`→`read_bytes` через единственный fd (`O_NOFOLLOW`, `fstat`, bounded read), regressions synthetic OAuth/symlink/hardlink. [Product CI #40102050691](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40102050691) **7/7 PASS**; independent security QA **ещё нет**. Один earlier SHA имел реальный TOCTOU defect, исторический report сохранён.
- После #274: независимая QA exact final SHA, controlled installation, **отдельный** новый authenticated finite owner package на допустимую квалификацию; только тогда ровно один analysis с genuine native `run_command DONE`, `view_file DONE`, exact SHA/source_reads и `analysis COMPLETE`, затем независимая AGY QA PASS. Нельзя claim AGY READY на CI/`agy models`.

## 5. OPS #248 / PR #269

- Source #248 был ранее принят/установлен (PR #250), но на реальном installed `content_identity.equivalence` обнаружена ошибка QA reuse: unchanged runtime может через `subprocess`/`os` alias загрузить изменённый тест, а parser ошибочно разрешит reused QA = HIGH. Поэтому Stage 4 не DONE.
- [PR #269](https://github.com/anpavel84-afk/gobadminton-clean/pull/269) **Draft, open**, implementation C `67882f051f0e38695e82c455bed487da5a223586`, ref-only R `d30f0082581a3a720ea6f5348ac2510d7c44faaa`; CI #40093208655 **7/7 SUCCESS**, отдельные Germany UID1002 source-only tests **60/60 PASS**, без model calls. Независимой модели-QA exact-R signed PASS receipt **ещё нет**, installed negative не проведён. После неё — обычный merge + guarded OPS install + negative + two-slot test, истории не трогать.

## 6. Context Rollout / PR #273

- [PR #273](https://github.com/anpavel84-afk/gobadminton-clean/pull/273) **Draft, open**, C `f8db3e6eae5df019063bc6aceba866ce4b7bb863`; existing `scoped_v1` extends to Codex author, task review, failure diagnosis/Astra while preserving byte-identical full fallback. CI #40092803002 **7/7 SUCCESS**, separated tests **88/88 PASS**. Independent model QA exact C still not accepted, merge/install/actual role-read/token savings not confirmed.
- Historical Cursor canary token baselines exist, but are **не сопоставимые** с PR273, нельзя объявлять saved tokens.

## 7. Отдельно: реальная продуктовая задача #271 — новый важный blocker

Advisor обнаружил это после последнего доклада PMA; нужно вынести на его внимание без параллельной реализации.

- [Issue #271](https://github.com/anpavel84-afk/gobadminton-clean/issues/271) PRODUCT V1b-2: контакты площадки на GameDetail; authorized source-only, нужен actual role-scoped API, privacy/link safety, DEV E2E.
- [PR #272](https://github.com/anpavel84-afk/gobadminton-clean/pull/272), authored source candidate SHA `9783a62d104f6fe41f59b8ef1bc145bd1111c726` (не merged). Source created; approved Code QA **FAIL**; hosted Product CI run #40091733845 returned `action_required`, не SUCCESS.
- Реальный VPS journal `slot1.json` **gen66 PENDING** operation `f1b55701e2a6d4422b85e0e322e194d6dcd74f7cc687fa9215cbabc47b165f48`, status **UNKNOWN**, reason `zero diff`, `safe_release=false`, phase `developing`, attempt2. **Работающего model process на момент read-only проверки не было**. Исторический FAIL/UNKNOWN не трогать; нужен точный разбор QA findings и отдельная разрешённая scheduling-only reconciliation после проверки отсутствия эффектов. Не просто перезапускать анализ, не сбрасывать счётчик.
- First attempt: model author `Codex gpt-6.1-sol medium` (не Cursor; Cursor Auto fallback reason: **`Cursor qualification unavailable: Cursor restricted to reviewed train canary`**); generated PR272. QA `Codex gpt-6.1-sol` вернул FAIL. Attempt2 author codex вернулся без изменения code/diff, стал `UNKNOWN`. Контекст author: `policy_profile=full`, инженерные правила 100818 байт, `input_tokens` отсутствуют в receipt. Это опровергает рассказы, что Context Rollout уже оптимизирует Codex author.
- **Ключевая новая проблема:** два слота аппаратно существуют, но обычная продуктовая задача не дошла до QA PASS/CI/DEV. Спросить PMA, что он делает с pending UNKNOWN271, но **не прерывать** его работу, если нет прямого запроса Owner.

## 8. Автопробуждение и текущий поток

- PR #268 merged default `main`: wake existing `train-dispatch.yml` на `dev` каждые 30 минут. PR #270 merged `main`: cron перенесён на `17,47 * * * *` UTC против нагрузки в начале часа. Это не новая система Runner. Owner issue-comment relay ранее продемонстрирован: main workflow #40085093169 SUCCESS → dev workflow #40085099363 SUCCESS, очередь `[]` в тот момент.
- На последней проверке **не было подтверждённого успешного настоящего `event=schedule` wake**. НЕ превращать это в отдельный бесконечный расследовательский приоритет вопреки Owner; если пригодится для stage8, проверять адресно.
- `slot1` при последней live проверке **PENDING/gen66** на #271 UNKNOWN, `slot2` **FREE/gen106**. Эти значения динамичны; перед новой рекомендацией по scheduling обновить read-only snapshot.

## 9. Платформенные отказы OpenAI: правило, которое хочет Owner

Owner считает, что часть `This tool call was blocked by OpenAI's safety checks` возникала из-за неправильно выбранного типа/объёма инструментальной операции (избыточные root/file-copy/секреты вместо нормальных source QA/CI). И ранее это решалось не обходом защиты, а **перепроектированием запроса как другой минимальной разрешённой операции**. Это действительно хороший стандарт:

1. Определи инженерную цель и минимальные полномочия. Отделяй обычный source/diff/hash/test от действий с секретами/root/защищёнными каталогами.
2. Для source-QA используй immutable Git SHA, отдельный read-only checkout, synthetic fixtures, стандартный GitHub Actions/Runner; не требуй real OAuth для тестов обработчика токенов.
3. Не маскируй/кодируй запрещённый вызов, не меняй канал/identity с целью обойти отказ и не повторяй тот же запрещённый эффект. Если законная операция структурно другая, разрешено выполнять её обычным авторизованным путём.
4. Различай platform safety refusal, GitHub HTTP403, AppArmor EACCES, CI/test FAIL, provider error; у них разные причины.
5. При отказе фиксируй точный вызов/ошибку; блокируй только затронутую работу, продолжай независимую разрешённую.

**На последней проверке в `AGENTS.md` на dev и main ЭТОТ НОВЫЙ ПУНКТ ЕЩЁ НЕ ВНЕСЁН.** В предыдущем чате Advisor подготовил Owner addendum для PMA с минимальным docs-only PR, **но не изменял репозиторий**, чтобы не создавать второго mutating исполнителя и не прерывать действующий Continue Master Plan. Если Owner спросит, готовый текст правила уже был сформирован; его интегрирует PMA при безопасной точке.

## 10. Как продолжать работу Advisor в новом чате

- На запрос **«как дела / проверь прогресс»** сначала в идеале GitHub PR/CI/issues + targeted read-only VPS state, затем **короткая таблица**: фактически DONE / CI PASS but not QA / installed / running / BLOCKED. Отличать модельные QA от синтетических тестов и зелёного CI. Не утверждать, что «работает», пока не проверен runtime receipt.
- На запрос **«дай промпт PMA»** — готовый для копирования OWNER DIRECT, конкретные цели и действующие ограничения, без навязывания нового архитектурного проекта и без повторного выполнения принятых этапов; не отправлять команды в PMA самостоятельно без Owner.
- На запрос **«почему блокируется платформа»** — помнить классификацию §9, не приписывать причину фильтра без evidence; вместо обхода сделать правильную разрешённую работу через стандартный pipeline.
- На запрос **«завершите проект»** — Advisor не выдаёт себя за PMA. Один mutating исполнитель; readonly inspection допускается. При подходящем инструментарии можно подготовить тексты/гипотезы, но не редактировать общий `dev`/OPS вне согласованной единственной точки управления.
- Самое важное после #274 / #269 / #273 — получить реальный source-QA PASS для каждого, корректную установку, квалификацию AGY, контекстные role canaries, настоящий product E2E. Путь **Issue271 → PR272** уже показал живое исполнение, но с QA FAIL и зависшим UNKNOWN.

## 11. Контрольный короткий сводный статус

| Объект | Последний подтверждённый статус |
|---|---|
| AGENTS.md правило platform refusal | **Не внесено** |
| #269 OPS #248 | Draft; source tests 60/60; Product CI PASS; независимая модельная QA и install НЕТ |
| #273 Context rollout | Draft; 88/88; Product CI PASS; модельная QA/install/measurement НЕТ |
| #274 AGY no-charge OAuth preflight | Draft; fixed TOCTOU; Product CI PASS; независимая security QA/install НЕТ |
| AGY OAuth/catalog | Owner-attested 2 x `agy models` PASS, 13 models, Sonnet 5.5 Medium действительно доступен |
| AGY READY | **НЕТ**, нативный full tool COMPLETE + QA PASS не доказаны |
| Slot1 | **gen66 pending**, #271 UNKNOWN zero diff (latest VPS read-only) |
| Slot2 | **gen106 FREE** (latest VPS read-only) |
| #271 GameDetail contacts | Author source PR272 существует; independent QA FAIL; retry UNKNOWN; DEV E2E НЕТ |
| Stage5 оптимизация author | **НЕ ВКЛЮЧЕНА** (full rules 100818 bytes) |
| Полный AI Train Master Plan | В работе, до полной приёмки далеко; Stage1/2 DONE |

**Никаких приватных OAuth credentials, root секретов, SSH ключей или паролей в файл не включено.**