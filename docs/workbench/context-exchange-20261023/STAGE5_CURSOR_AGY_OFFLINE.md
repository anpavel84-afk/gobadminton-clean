# Stage 5 — offline сравнение full canon и scoped_v1 для Cursor и Antigravity

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.**

Статус: `OFFLINE_VERIFIED` для байтов и fail-closed поведения в unit-тестах. `RUNTIME_VERIFIED` — нет. `scoped_v1` для Cursor и Antigravity **не включён**. Это не admission, не квалификация роли и не установка.

Норма: EOM 1.4 §10.3 и §10.9. Первый шаг — только offline, `provider_calls=0`.

## Preflight

| Поле | Значение |
|---|---|
| Роль | Cursor Auto, автор source. Не PMA и не independent QA |
| Repo | `anpavel84-afk/gobadminton-clean` |
| Base | `dev` `2446bcc583ec11975246f63d476ff1492e153cdb` |
| Канон сравнения | EOM 1.4, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`, 113203 байта UTF-8. **VERIFIED**: рабочий файл совпал с `CONTEXT_SOURCES.json` и с `git show` этого commit |
| Runtime pin | EOM 1.3, commit `1169e965976e9498d4e5e1e23aae201e97ec9665`, SHA-256 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`, 100818 байт. **Не менялся** |
| Assignment | Stage 5 §10.9, первый шаг: сравнение размеров и отрицательные тесты fail-closed. Без PROD, VPS, политики, бюджетов, `train-stage.yml`, `train-dispatch.yml`, `native_antigravity.py` |
| Requested / effective route | Cursor Auto author / Cursor Auto author |
| Writer | Один автор этого PR. Чужой PR #294 не переписывался |

Candidate head, список файлов, тесты и CI — в конце, после прогона.

## Что сравнивалось

Сохранённые входы: `saved_stage_inputs()` в `offline_replay.py` этого каталога. Это прежний синтетический stage: task, FAIL findings, excerpt 24 КБ и три prior receipts. `diagnosis_view` их не мутирует. Байты data-секции: **26345**. SHA-256 data: `dffbca8a4f86816f101a26e0f3bf3feeac0e8ab01d5febb3a6d017aaf72415d4`. **VERIFIED** повторным запуском.

Пакет, одинаковый для обеих сторон:

`utf-8 rules_prefix + "\nSAVED_STAGE_DATA\n" + canonical JSON diagnosis_view`

Маркер `Поправка SR0` есть в полном каноне и отсутствует в scoped prefix. **VERIFIED** скриптом; иначе скрипт падает и не пишет отчёт.

Машины: `python3 -B docs/workbench/context-exchange-20261023/stage5_offline_compare.py`. Числа ниже совпадают с `STAGE5_CURSOR_AGY_COMPARE.json`. Тест пересчитывает JSON и сверяет его с файлом.

### Роли

В каноне нет маркера `GB_CONTEXT_V1:analyst`.

| Операционная роль | Capsule | Почему |
|---|---|---|
| `independent_qa` | `qa` | Единственный capsule независимой QA. Живой AGY QA вызывает `inject(..., qa=True)` |
| `analyst` | `planner` | Живая пара к `independent_qa` — `technical_pm_product_analyst`. Capsule Technical PM — `planner` |

Capsule `research` («исследователь/аналитик») — другая роль и в этот пакет не входит.

Размер scoped снят синтетическим probe, который возвращает True только если reference равен exact commit/hash/size. Это измерение размера, не доказательство чтения получателем. `scoped_selected_for_delivery=false`. Реальный `verified_access` получателя: **NOT_PROVEN**.

## Байты

Cursor и Antigravity компилируются одной функцией. Четыре строки посчитаны отдельными вызовами. Хэши пакетов Cursor и AGY для одной роли совпали. `providers_byte_identical=VERIFIED`.

| Provider | Роль | Full canon | Full prefix | Scoped capsule | Scoped prefix | Data | Full package | Scoped package | Δ bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cursor | analyst | 113203 | 113431 | 4219 | 4671 | 26345 | 139794 | 31034 | 108760 |
| cursor | independent_qa | 113203 | 113426 | 4238 | 4685 | 26345 | 139789 | 31048 | 108741 |
| agy | analyst | 113203 | 113431 | 4219 | 4671 | 26345 | 139794 | 31034 | 108760 |
| agy | independent_qa | 113203 | 113426 | 4238 | 4685 | 26345 | 139789 | 31048 | 108741 |

Разница full prefix 113431 и 113426 — пять байт слова роли в заголовке (`planner` и `qa`), не разница канона. Delivered policy full для всех строк — 113203 байта.

Δ bytes — разность длин пакетов. Это не стоимость, не latency и не доля экономии. `byte_delta_is_not_cost_or_latency=true`.

## Токены

`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`: **not_exposed**.

Токенизатор Cursor и Antigravity не читался. Модули `tiktoken` и `tokenizers` не использовались: общий BPE не является их provider accounting. `bytes/4` не применялся.

Latency, cost, cache hit, missed findings, provider usage, фактическое чтение канона получателем и role canary: **NOT_MEASURED**.

## Fail-closed

`context_native_delivery.cursor_agy_context` для `cursor` и `agy`, ролей `analyst` и `independent_qa`:

- запрошенный профиль по умолчанию — `full`;
- `SCOPED_QUALIFIED` остаётся False, параметра включения нет;
- если запрошен `scoped_v1`, а `verified_access` отсутствует, возвращает не True, или бросает исключение — payload побайтно равен `inject(..., context_profile='full')`, причина `RECIPIENT_RULES_ACCESS_UNVERIFIED`;
- если probe вернул True — payload всё равно полный, причина `CURSOR_AGY_SCOPED_NOT_QUALIFIED`;
- в исходнике gate единственный вызов `inject` передаёт `context_profile='full'`.

Живой stage Cursor по-прежнему отдаёт полный pin 1.3. Stage AGY не оборачивает prompt до native adapter. Единственный `inject` в `native_antigravity.py` не получает `context_profile` и не получает `verified_access` (файл не редактировался). Квалификация scoped для этих provider — отдельное решение.

Установленный Codex pin и его scoped-путь для Codex этим изменением не переключались.

## Проверки

Команда:

`python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*.py'`

Локальный результат на этом дереве, до commit: **616 tests, OK, skipped=1**, 13.404s. Пропущенный тест не объявлен выполненным. Это авторская проверка, не independent QA. **VERIFIED** как локальный прогон этой команды. Повторный CI-прогон той же команды — отдельно ниже.

Адресные новые тесты в `test_actions_train_context_cursor_agy.py`: 12 tests, OK.

CI GitHub Actions: **NOT_MEASURED** до завершения run на candidate head. Draft PR не мержится. PROD и VPS не запускались.

## Candidate

- base sha: `2446bcc583ec11975246f63d476ff1492e153cdb`
- code commit, на котором посчитаны байты и локальные 616 тестов: `78b36c5dd5e98b9241bc69ea646658b8e6feb8c2`
- строка с этим sha добавлена следующим commit и не меняет код, JSON или тесты. Head PR — тот commit. CI ниже относится к head, на котором Actions реально запустились
- файлы этого шага:
  - `docs/workbench/context-exchange-20261023/offline_replay.py`
  - `docs/workbench/context-exchange-20261023/stage5_offline_compare.py`
  - `docs/workbench/context-exchange-20261023/STAGE5_CURSOR_AGY_COMPARE.json`
  - `docs/workbench/context-exchange-20261023/STAGE5_CURSOR_AGY_OFFLINE.md`
  - `scripts/chatops/actions_train/context_native_delivery.py`
  - `scripts/chatops/actions_train/manifest.json` — только SHA-256 нового модуля, чтобы install pin совпал с деревом. Установка на VPS не выполнялась
  - `scripts/chatops/tests/test_actions_train_context_cursor_agy.py`

Следующий допустимый шаг — отдельная квалификация actual-recipient access. Этот отчёт её не заменяет.
