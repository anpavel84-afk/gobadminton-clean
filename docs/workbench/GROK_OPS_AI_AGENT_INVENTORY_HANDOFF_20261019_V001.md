# GoBadminton CLEAN — фактическая конфигурация AI-агентов на немецкой VPS · Grok OPS handoff V001

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

**Аудит:** 2026-10-19, приблизительно 11:00 UTC. **Автор:** независимая проверка OPS для Owner. **Адресат:** Grok Bot / GoBadminton OPS. **Источник актуального состояния:** реальные read-only команды на Германии `vmi3510488` под пользователем `agentagency-dev` плюс публичная история GitHub. Данные о старых модельных запусках специально помечены HISTORICAL; нельзя выдавать их за успешный live inference сегодня.

**Принцип:** это информационный handoff, а не новая модельная политика, не допуск задачи, не OPS/PROD GO и не разрешение менять системные настройки, OAuth, sandbox или текущий исполнитель. В `dev` и сервисы ничего этим документом не вносится.

## 1. Самое важное для Grok

**Grok ошибается, если утверждает, что на немецкой VPS нет Antigravity или Sol.** Они существуют, но в разных смыслах:

- **Antigravity CLI `agy` установлен и отвечает**: версия `1.4.2`, read-only `agy models` успешно вернул **13 вариантов**, включая Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet 5.5, Claude Opus 5.5 и GPT-OSS 120B. В октябрьском пилоте реальные запросы через Antigravity выполнялись и приносили полезный результат. Это НЕ означает, что Antigravity сейчас является производственным автором или доверенным QA.
- **Cursor Agent CLI `cursor-agent` установлен и авторизован**: версия `2026.10.01-e373342`, `cursor-agent status` ответил `Logged in`. Read-only `cursor-agent models` выдал **265 строк каталога**, среди которых `gpt-5.6-sol-high`, `gpt-5.6-sol-xhigh`, `gpt-5.6-luna-high`, Claude, Gemini, Grok и Composer. Каталог не гарантирует свободную квоту или право конкретного платного запуска.
- **Codex CLI `codex` установлен**: версия `codex-cli 0.160.1`. Это **единственный штатный AI runtime**, который текущий автономный executor автоматически вызывает для написания кода и для отдельной read-only source QA.
- **GitHub CLI `gh` установлен**: `2.45.0`. Это инструмент GitHub, не AI-модель.
- **Grok Bot** — отдельный OPS-координатор в облаке, не «четвёртый локальный model binary». Для него настроен SSH пользователь `grokops` с **ограниченным доступом к диагностике**, но не к секретам и не к произвольным процессам разработки.

### Таблица фактов

| Компонент | Команда | Версия / текущее состояние | Штатная маршрутизация в single executor |
| --- | --- | --- | --- |
| Codex CLI | `codex` | `0.160.1`; реальное исполнение Code + independent QA | **ДА** — единственный подтверждённый штатный маршрут |
| Cursor CLI | `cursor-agent` | `2026.10.01-e373342`; логин подтверждён; 265 позиций в списке моделей | **НЕТ**, наличие CLI не даёт вызова через текущий executor |
| Antigravity CLI | `agy` | `1.4.2`; успешно выдаёт 13 моделей; ранее работали реальные inference пилоты | **НЕТ**, ранее экспериментально использован для диагностики/исследований |
| GitHub CLI | `gh` | `2.45.0` | AI НЕ ЯВЛЯЕТСЯ; GitHub-транспорт/инструмент |
| Grok OPS | облачный бот + `grokops` SSH | read-only SSH мониторинг; нет прямого `agentagency-dev` shell/модельного запуска | Координатор/заказчик, не автор под серверным UID |

Проверенные `command -v` пути под `agentagency-dev`:
- `/home/agentagency-dev/.local/bin/codex`
- `/home/agentagency-dev/.local/bin/cursor-agent`
- `/home/agentagency-dev/.local/bin/agy`
- `/usr/bin/gh`

CLI-пути — инвентарь, а НЕ разрешение Grok запускать бинарники в неподходящем аккаунте или копировать профили авторизации.

## 2. Какие модели Antigravity реально объявляет сегодня

Live `agy models` на `vmi3510488` завершился с кодом **0** и перечислил:

| Семейство | Точные model IDs из живого вывода |
| --- | --- |
| Gemini 4 Argon | `gemini-4-argon-low`; `gemini-4-argon-medium`; `gemini-4-argon-high` |
| Gemini 3.8 Flash | `gemini-3.8-flash-low`; `gemini-3.8-flash-medium`; `gemini-3.8-flash-high` |
| Claude Sonnet 5.5 | `claude-sonnet-5-5-low`; `claude-sonnet-5-5-medium`; `claude-sonnet-5-5-high` |
| Claude Opus 5.5 | `claude-opus-5-5-low`; `claude-opus-5-5-medium`; `claude-opus-5-5-high` |
| GPT-OSS 120B | `gpt-oss-120b-medium` |

**Это 13 вариантов из каталога, а не 13 гарантированно доступных для генерации квот.** По сравнению с подтверждённым пилотом 15 октября, где в каталоге было 10 вариантов, появился Gemini 4 Argon. Нового inference-turn от 19 октября ради аудита **не запускали**, чтобы не тратить ресурсы и не вмешиваться в активный train. Свободную квоту, billing и время reset надо измерять отдельно при наличии поддерживаемых read-only provider-метрик, а не угадывать.

Read-only `agy --help` сегодня подтвердил опции `--model`, `--effort`, `--sandbox`, `--json-schema`, `--print`, `--print-timeout` и режимы. Опция `--dangerously-skip-permissions` существует, но её **запрещено использовать** для обхода ограничений.

### Исторические, действительно выполненные Antigravity пилоты

A. 15 октября: реальный `agy models`, проверка headless `Gemini3.8FlashLow` с JSON schema; структурированный ответ `ready=true`. Sonnet 5.5 Medium выполнил read-only диагностику куска исходников, нашёл один фактический TS дефект, но пропустил другой. Это **пилот**, не релиз-гейт.
Ссылка: https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6200225429

B. Реальный `Claude Sonnet 5.5 Medium` через AGY (модельный ход 28.5 с, около **21 573 total tokens**) помог диагностировать два дефекта тестовых fixtures #37; предложенные изменения затем прошли через **существующий Bridge**, а не через отдельный AGY-writer. Это доказанный пример полезного совместного использования квот.
Ссылка: https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6200511985

C. Реальный `Gemini 3.8 Flash Medium` консультировал подготовку #12/#28: input 32 382, output 4 365, total 36 747 токенов; результат advisory, тесты НЕ исполнялись. Один пробный некорректный schema request завершился HTTP 400 до inference и сохранился как исторический FAIL.
Ссылка: https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6202177724

D. `Issue #53` — 99 записей поиска источников для фотографий площадок с использованием Antigravity и `search_web`; это **метаданные/кандидаты**, не 99 проверенных и опубликованных снимков.
Ссылка: https://github.com/anpavel84-afk/gobadminton-clean/issues/53#issuecomment-6204385494

### Почему Antigravity всё ещё не основная независимая QA

Попытка permanent QA adapter на локальном кандидате `9eda3980dfa5d49cd6ebba2c1002c3f3154fff6a` получила **FAIL независимого Codex review, семь конкретных проблем**, поэтому НЕ была установлена или назначена релиз-гейтом. В числе проблем: недостаточно доказанная изоляция tools и данных, отличие реальных CLI argv/stdin/timeout от предположений, ошибочная интерпретация финального JSON SUCCESS при наличии ошибок/denied tool events, неполные event/result receipts, filename filtering, недостаточная проверка actual model/policy. 48 offline PASS + 21 SKIP не заменяют безопасность и независимую QA.
Ссылка: https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6200772175

**Нельзя объявлять permanent Antigravity QA восстановленной на основании успешного `agy models` или отдельных модельных пилотов.** Переход в релиз-гейт — только после устранения дефектов, новых точных тестов, независимого exact-SHA QA и штатного CI, с сохранением исходного Codex QA до доказанной замены.

## 3. Cursor CLI и Sol / Luna: они действительно есть

Текущий `cursor-agent status`: **Logged in** (учётные данные намеренно не разглашаются). `cursor-agent models` завершился с кодом 0 и сообщил **265 строк каталога**, включая:

- `gpt-5.6-sol-high`, `gpt-5.6-sol-high-fast`, `gpt-5.6-sol-xhigh`, `gpt-5.6-sol-xhigh-fast`;
- другие уровни Sol (`none`, `low`, `medium`, `max`), не все перечислены здесь;
- `gpt-5.6-luna-high`, `gpt-5.6-luna-xhigh` и другие уровни Luna;
- `claude-opus-5-5-medium` / `high` / `xhigh`, Gemini 4 Argon, Composer и другие.

Таким образом, фраза «Sol в проекте отсутствует» **НЕВЕРНА**, если речь про доступные в каталоге **Cursor CLI** маршруты. Но это НЕ доказывает наличие точно таких же ID в нативном Codex CLI — у разных клиентов свои идентификаторы моделей, авторизация и лимиты.

**Никаких выводов о платном облачном Cursor Cloud on-demand:** логин в CLI и модельный каталог не равны свободной квоте cloud-агентов. Не включать платные режимы без разрешения Owner. Реального авторского вызова Cursor CLI 19 октября мы не делали.

## 4. Активный single-executor на Германии

Фактически установлен `gobadminton-autonomy.service` — systemd **user** service под `agentagency-dev` (UID 1002). На аудите состояние `active/running`, `KillMode=control-group`. Единственный private state в `/home/agentagency-dev/.gb-autonomy-state`; активные worktrees под `/srv/gobadminton-clean/worktrees`. Старый Runner/Autopilot не запускать.

**Точная рабочая ревизия adapter при аудите:** `5c883c3f594206ef1bb9be1d581e369f6c09cdb2` в существующем worktree `autonomy-existing-issues-20261015`. Проверенный source содержит `model_command(codex, ...)`, а `Bridge.model(...)` всегда формирует argv из `self.c.codex`; `Bridge.review(...)` использует **отдельную независимую Codex QA-сессию** на отдельном read-only worktree. В этом текущем вызове нет автоматического маршрута на `agy`/`cursor-agent` и нет явного per-task `--model` и effort assignment.

**Сам Codex CLI поддерживает `-m/--model` и configuration overrides.** Однако перечень Sol/Astra из исторических политик не надо автоматически копировать в native Codex без доказательства, что этот backend действительно принимает точный model ID и effort.

Executor по-прежнему принимает один авторизованный Issue, контролирует scope, QA exact SHA, CI, DEV release и честное blocked/parked. Планировщик моделей и бюджетов, если вводится, должен быть ограниченным отдельным этапом **внутри существующего конвейера** и не добавлять второго конкурирующего writer.

При аудите 19 октября около 11:00 UTC: active Issue `#98`, `pr_wait`, попытка 1; это снимок времени, не гарантированное текущее состояние.

## 5. Почему Grok не видит AI CLI напрямую

Grok Cloud подключён на Германию по SSH **как `grokops`, а не `agentagency-dev`**. Это отдельный сознательно ограниченный principal:
- изоляция от частного checkpoint, рабочих деревьев, модельных OAuth-профилей, deploy keys и секретов;
- единственный утверждённый cross-user diagnostic: `sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status` с нулём аргументов;
- нет произвольного `sudo`, входа root, права запускать модели от имени `agentagency-dev` или второго writer.

Из этого **нельзя заключать, что агенты отсутствуют**. Grok просто не должен иметь прямой доступ к защищённой среде модели. Используй **эту документированную проверку**, GitHub evidence и разрешённую команду status. Не предлагай перенос OAuth/key в `grokops`, расширение root-доступа или новый runner.

Для live каталога под `agentagency-dev` выше приведены реальные выполненные команды и снимок результатов. При желании освежить их — поставь ограниченное read-only OPS поручение доверенному серверному исполнителю; Grok не должен сам обходить границу SSH.

## 6. Историческая политика модельного маршрута — НЕ текущая настройка clean runtime

В *архивном* репозитории `anpavel84-afk/gobadminton` были регламенты `MODEL_ROUTING_AND_BUDGET_V004/V005/V006`. Они предписывали:
- PM/autopilot — `gpt-6.1-sol`, `high`;
- рутинный UI/preview/smoke — дешёвый `Luna low/medium`;
- содержательная backend/domain/concurrency работа — `Sol medium/high`;
- неоднозначная безопасность/права/приватность — `Astra high`;
- Cursor временно suspended из-за исчерпания лимита.

Ссылки на исторические источники:
- https://github.com/anpavel84-afk/gobadminton/blob/main/docs/operations/MODEL_ROUTING_AND_BUDGET_V004.md
- https://github.com/anpavel84-afk/gobadminton/blob/main/docs/operations/MODEL_ROUTING_AND_BUDGET_V006.md

**Это историческая продуктовая политика, НЕ действующая конфигурация `gobadminton-clean`.** В частности, старые `gpt-6.1-sol` и `gpt-6-astra` нельзя считать текущими native Codex идентификаторами. Современный Cursor перечисляет `gpt-5.6-sol-...`; Antigravity — Gemini/Claude/OSS с другими IDs. Нужна валидированная таблица provider → client → actual model ID → effort → ограничения → стоимость/квоты.

## 7. Предлагаемая безопасная схема для внедряемого Technical PM

`Owner → Grok OPS → bounded technical PM (read-only analysis) → deterministic plan validation → SAME executor → scoped author → independent exact-SHA QA → 7-job Product CI → DEV accepted`.

- Grok следит за поручениями, очередью, принятием решений и общим расходом.
- Technical PM, первоначально на подтверждённой сильной модели, читает релевантный код/issue/архитектуру, составляет **машинно-проверяемый** план с зависимостями и аргументированным выбором CLI, model ID, effort, бюджета и QA.
- Executor решает **обычным кодом**, что план допустим; только он выдаёт источник записи, вызывает CLI, обеспечивает single-writer, попытки, sandbox, CI и delivery.
- Pilot routing стартовать с нативного Codex. Cursor и Antigravity — только после provider-specific security/format/runtime tests. Никаких silent QA bypass.
- Для простого CI статусного действия — `gh`/Python без LLM. Для сложной диагностики — подходящая сильная модель. Не делать большой PM inference для каждого poll и каждых двух строк lint.
- Источник token counts, quota, pricing, reset по каждому клиенту документировать. **UNKNOWN не равно 0**. 13 или 265 позиций в каталоге не означает столько доступных бесплатных подписок.
- Новый model routing не вправе автоматически открыть Cursor on-demand, платный API или PROD.

## 8. Быстрый контрольный список для Grok

1. Прочитай эту справку и четыре указанных evidence-комментария #29.
2. Прекрати смешивать слова **installed CLI**, **catalog-listed model**, **authenticated client**, **successful actual inference**, **approved author**, **independent QA provider**, **quota available**. Это разные состояния.
3. Признай фактическое наличие `agy`, `cursor-agent`, доступных Cursor Sol/Luna и ранее успешных Gemini/Sonnet inference пилотов.
4. Проверь живой статус единственного executor разрешённой диагностикой. Не тестируй AI CLI с учётной записью `grokops`, не устанавливай CLI заново и не копируй логины.
5. При планировании нового технического PM исходи из реальных client-specific model IDs и ограничений. Не включай AGY в независимый QA до исправления его исторических QA-блокеров.
6. При необходимости сообщи Owner один конкретный недостающий, узко ограниченный диагностический интерфейс — не проси произвольный доступ root, OAuth или общий model budget.
7. Ответь кратко: что уже можно использовать, что проверено исторически, что сейчас запрещено для gate, что требует небольшой отдельной работы, и на каких точных evidence это основано.

## 9. Границы и непроделанная работа

Эта проверка использовала исключительно:
- локальный `--version` и `--help` CLI;
- read-only `agy models`, `cursor-agent models`, `cursor-agent status` с обезличиванием учётных данных;
- проверку существующего systemd user service и нескольких фиксированных source-строк;
- GitHub evidence.

**НЕ выполнялось:** ни одной новой модельной inference-сессии или списания токенов намеренно; не измерены live remaining quotas / тарифы / chargeability; не модифицированы .codex, .cursor, AGY auth, token-файлы, private state, сервисы, pipeline, GitHub `dev`, PROD, PLAN, VPN или другое приложение.

**Никакие реальные ключи, токены, cookies, OAuth-профили и приватные данные в этой справке не приводятся.**
