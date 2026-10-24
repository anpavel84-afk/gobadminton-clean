# GoBadminton CLEAN — AI Train Master Plan

**Текущая навигация приёмки · 24.10.2026. Не admission и не второй backlog.** Вход — [START_HERE.md](../../START_HERE.md); организация, роли, попытки и безопасность — [единственный полный регламент](../rules/ENGINEERING_OPERATING_MODEL.md). Перед действием сверять live PR HEAD, CI, active operations и receipts. Изменение статуса в Markdown не означает установки.

## Цель и действующее поручение

Завершить существующие этапы 3–8 без новой архитектуры, затем постоянно выполнять разрешённую продуктовую очередь. Context Exchange и Context Runtime уже приняты. Исторические cron/Runner-расследования не отдельный приоритет, если не блокируют конкретный этап. Grok — runtime PMA; [CURRENT handoff](../handoffs/CURRENT.md) содержит подтверждение роли и актуальные источники.

Приёмка этапов последовательна; независимые source/QA работы #269/#273 разрешены без ожидания AGY. Установки общих компонентов сериализуются. Обычная разрешённая работа не требует micro-GO; новые продуктовые цели, деньги, расширение доступа и PROD — отдельные решения по §1/6 канона.

## Этапы и критерии завершения

| Этап | Фактический уровень на checkpoint | Что необходимо для DONE |
|---|---|---|
| **1 · Context Exchange 1.3** | **DONE**, [PR #240](https://github.com/anpavel84-afk/gobadminton-clean/pull/240) | Принятый lossless exchange; не повторять неизменённые проверки |
| **2 · Context Runtime #243** | **DONE**, [PR #243](https://github.com/anpavel84-afk/gobadminton-clean/pull/243); квалификация только Codex QA `scoped_v1` | Полный fallback и проверенные immutable rules/source; подключение других ролей относится к этапу 5 |
| **3 / 3.2 · Antigravity #29 / Admission #251** | **IN PROGRESS, NOT AGY READY**; [PR #274](https://github.com/anpavel84-afk/gobadminton-clean/pull/274) source merged в `753a6f48d6b280f0d483d16d29648a2f4c3f85a7`; **guarded install выполнен первым** (dev merge `a7538561`, controller `86801eb601a453f8e8db39266c3558beb26f60d3`, receipt `agy29-oauth274-scoped-install.json`); немодельный preflight, конечный analysis и независимая QA PASS ещё не выполнены | Exact source независимая QA и CI → ref-only release → guarded OPS install с rollback → немодельный preflight до charge → один новый конечный analysis с `run_command DONE`, `view_file DONE`, exact source proof, `COMPLETE` → отдельная независимая QA PASS |
| **4 · OPS #248** | **DONE (INSTALLED)**: базовый #250 установлен; ремонт [PR #269](https://github.com/anpavel84-afk/gobadminton-clean/pull/269) установлен **вторым**, после #274 (guarded install, receipt `agy29-content269-scoped-install.json`; dev merge `923625ca7cece72171569a24dd3876a7fbd0a4c1`; active policy controller_sha `cbc7099223590c3e4ce44e520d0da50f7fced0e0`, stage_workflow_sha256 `fe715e45758d2e30d6a279f827f68b41d147910d9bf36fb347dfc8a038c5369a`) | Адресная независимая QA final SHA; CI; принятый ref-only release; guarded install; отрицательный тест на установленном runtime против ложного QA reuse и независимость двух слотов |
| **5 · Context Optimization Rollout** | **SOURCE MERGED, не runtime rollout**, [PR #273](https://github.com/anpavel84-afk/gobadminton-clean/pull/273) → `c29604c2927381fe20f7cb1e832580483404a008`; другие роли не получили автоматическую квалификацию из #243 | После этапа 4 — установка проверенного source; Cursor/AGY/Codex/Astra в применимых ролях реально получают immutable source/rules, обязательный контекст и lossless fallback; история FAIL сохраняется; измерены реальные input/output/cached tokens |
| **6 · AI Team Routing** | **NOT ACCEPTED**, [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211), [#218](https://github.com/anpavel84-afk/gobadminton-clean/issues/218) | Квалифицированные роли выбираются существующим router по §5 и принятой политике [SMART_ROUTING](../rules/SMART_ROUTING.md) (SR0 принят Owner 24.10.2026; SR1–SR6, ROLE_QUALIFIED и RUNTIME_VERIFIED NOT_STARTED); read-only Astra diagnosis — по классу FAIL, до установки классификатора прежний маршрут контроллера (#218); прозрачные requested/effective route и usage; без нового router |
| **7 · PARK / RESUME / RECONCILE** | **NOT ACCEPTED**, [#244](https://github.com/anpavel84-afk/gobadminton-clean/issues/244) | Безопасное продолжение с сохранением candidate/QA/history/budget, без дублей; UNKNOWN не переигрывается; другой слот не блокируется локальным сбоем |
| **8 · Full Product E2E** | **NOT DONE** | Реальная отдельно допущенная продуктовая Issue → Cursor author → independent QA → адресные repair при необходимости → CI → DEV deployment → live smoke/ACCEPTED → автоматическое взятие следующей разрешённой задачи |

### Подтверждённые границы этапов 3–5

Owner [подтвердил OAuth/catalog](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6384967151): два новых изолированных `agy models` PASS, 13 моделей, **`claude-sonnet-5-5-medium` присутствует**. Не менять ID на Gemini и не просить повторную Google-авторизацию. DNS/AppArmor #267 приняты; не повторять полную квалификацию неизменённых частей. Эти факты не доказывают исправление старого nested-tool EACCES или реальный analysis COMPLETE.

#274: [checkpoint Grok #277](https://github.com/anpavel84-afk/gobadminton-clean/pull/277) зафиксировал code-only QA R4 PASS на `86801eb601a453f8e8db39266c3558beb26f60d3`, receipt SHA256 `d58c8a80dc5e78f4682db0973b2f362fbedbe212f781a561f18066f5bde5a5ce`, и CI [40110038125](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40110038125). Позже source merged в `753a6f48…`. Сообщённое в checkpoint source evidence не доказывает installation/DEV acceptance. R1/R2/R3 FAIL остаются историей; обязательные NOT_TESTED закрываются на соответствующем gate, не объявляются PASS.

#269: CI [40093208655](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40093208655) PASS и адресные тесты не заменяют независимую QA. [Отказ прежнего reviewer](https://github.com/anpavel84-afk/gobadminton-clean/issues/248#issuecomment-6384134448) — platform/provider refusal без verdict, не тестовый FAIL. Не повторять тот же запретный запрос и не менять identity/канал ради обхода. Требуется допустимое разрешение этого review; human review можно принять только по явному применимому решению Owner, не выдавая его за модельный PASS.

#273: исходный `f8db3e6e` получил QA R1 FAIL, затем связанный Astra diagnosis и ограниченное исправление автора Codex Sol `5eb42c44bad0d639b5d9b7c6528d377ab2b42426`. [Grok checkpoint в dev](https://github.com/anpavel84-afk/gobadminton-clean/blob/753a6f48d6b280f0d483d16d29648a2f4c3f85a7/docs/ops/AI_TRAIN_MASTER_PLAN.md) сообщает R2 code-only PASS (result SHA256 `e471cd6e3f0ab8a799d5fbeb5cb0f644f11e3d9bee59053c5fc82d615152594e`), 95/95 offline tests, CI 7/7 и merge `c29604c2…`. Это не role canary или измеренная экономия. Далее читать актуальные PR/receipts; старые положительные результаты не переносить на новый SHA без доказательства.

## Следующий разрешённый порядок

1. ~~Завершить release/guarded installation #274~~ — выполнено (порядок установок: #274, затем #269). Далее штатная конечная квалификация #29. Исторические UNKNOWN/гранты не переиспользовать; source merge не подменяет accepted ref-only release.
2. Этап 4 (#269) установлен; подготовка rollout #273 (этап 5): источник уже в dev, установка — только отдельным guarded install после этапа 4 и без изменения слотов/грантов.
3. После принятого этапа 4 установить #273 и доказать реальное использование контекста ролями. Далее этапы 6, 7 и только затем финальный продуктовый E2E.

**Cross-Model QA 6.1** ([#264](https://github.com/anpavel84-afk/gobadminton-clean/pull/264), [#266](https://github.com/anpavel84-afk/gobadminton-clean/pull/266)) — отдельное непринятое направление; не вводить дополнительные обязательные проверки обычных задач из draft.

## Сохранённая продуктовая работа, не команда возобновления

[#271 / PR #272](https://github.com/anpavel84-afk/gobadminton-clean/issues/271) — ранее запущенный product candidate. QA FAIL, UNKNOWN/счётчики и исходники сохраняются; scheduling-only освобождение Slot1 не означает DONE, отмену всех эффектов или новый author admission. Этот Master Plan **не запускает #271**, не выделяет ей попытки и не отменяет текущий приоритет управляющей системы. Любой отдельный продуктовый шаг требует применимого подтверждённого решения и проверки текущего assignment/эффектов, а не только наличия открытой Issue.

## История и обновление

Полная прежняя хронология сохранена [в Master Plan 23–24 октября до консолидации](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/docs/ops/AI_TRAIN_MASTER_PLAN.md), [в последующем checkpoint Grok, включая protected slot facts и #273](https://github.com/anpavel84-afk/gobadminton-clean/blob/753a6f48d6b280f0d483d16d29648a2f4c3f85a7/docs/ops/AI_TRAIN_MASTER_PLAN.md), [передаточном snapshot](../handoffs/2026-10-24_GOBADMINTON_GROK_PMA_HANDOFF_V001.md) и #29/#248. Старые Gemini next action, VENDOR HOLD, slot generations и прежние команды в этих snapshots — история, а не текущая очередь. Последующее source продвижение Grok сохранено, не откачено документацией.

После **реально принятого** этапа PMA обновляет эту страницу exact SHA/QA/CI/install/live receipts и переходит дальше. Состояние операции, бюджет и безопасность продолжения берутся из authoritative records, не из summary. Полный канон и бизнес-контракты от редактирования плана не меняются.
