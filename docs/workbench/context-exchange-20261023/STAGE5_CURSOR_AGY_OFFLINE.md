# Stage 5 — Cursor author scoped_v1 и offline сравнение с Antigravity

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.**

Cursor author: **IMPLEMENTED + OFFLINE_VERIFIED**, **NOT RUNTIME_VERIFIED**, не установлен. AGY: **OFFLINE_VERIFIED only** для сравнения байтов и full fallback; scoped delivery не включён, `SCOPED_QUALIFIED=False`. AGY author — **NOT_QUALIFIED until #312**; этот отчёт не квалифицирует его scoped delivery. Это авторская самопроверка, не independent QA, не admission и не разрешение установки.

## Preflight

| Поле | Значение |
|---|---|
| Repo / роль | `anpavel84-afk/gobadminton-clean`; independent-session AUTHOR source + offline tests, не mutating PMA |
| Checkout / source | `cursor/stage5-cursor-scoped-20261025`, `00197e5feb15e048cd55416d57ca69924fab4af2` |
| Dev base | `bdd912a82a2f0087f4cfc9c6820edc8c49ee6527`; source включает offline-материалы draft PR #298 |
| Accepted rules | EOM 1.4: commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, 115079 байт UTF-8. Сверены файл, CONTEXT_SOURCES и immutable Git blob |
| Assignment / admission | Прямое ограниченное поручение Stage 5 Cursor Auto author scoped_v1; machine admission/runtime call не создавался |
| Allowed paths / effects | Только `actions_train/{stage.py,context_cursor_delivery.py,context_native_delivery.py,manifest.json}`, `scripts/chatops/tests/*`, этот workbench. Только рабочие файлы и локальные Python-проверки |
| Writer ownership | Одна текущая авторская сессия в этом scope; чужую работу не удалять. Git metadata рабочего checkout, commit/push, сеть, secrets и OPS не затрагиваются |
| Requested / effective route | Source-only AUTHOR + offline tests / эта отдельная авторская сессия; вызовы Cursor/AGY/Codex CLI отсутствуют. Целевой runtime route остаётся Cursor Auto author |
| Candidate | Незакоммиченный diff поверх source SHA; exact candidate commit создаст другая сессия после передачи |

`native_cursor.py` и `native_guard.py` сохранены побайтно. Проверка использует pins из поручения, а не чтение protected READY marker. `context_policy.py`, `context_exchange.py`, native AGY, core, budgets и OPS не менялись. Codex scoped-ветвь и AGY-ветвь в stage не редактировались. `context_native_delivery.py` сохранён как прежний always-full offline gate.

## Доставка Cursor

`context_cursor_delivery.export_view()` читает tracked names и использует `native_cursor.source_name`, `_source`, MAX_FILE/MAX_TREE и прежний лимит 10000 файлов. Probe ничего не пишет. Для полного канона необходимы regular single-link readable file, отсутствие symlink в пути, tracked/exported status, exact hash и size. Reference сравнивается с `context_policy.RULES_*` работающего модуля при каждом вызове, без hard-coded pin.

Только обычный author stage с подтверждённым export получает common+author из `compile_capsule` той же принятой редакции. Guidance указывает workspace-файл `docs/rules/ENGINEERING_OPERATING_MODEL.md`, exact commit/hash/bytes и read tool для спорного или недостаточного capsule. Сокращённых пересказов или truncation нет. При ошибке, несовпадении pin, неизвестной роли, recovery или budget retry payload равен прежнему full `inject` побайтно. Cursor QA остаётся запрещён.

Перед первым разрешением changed path wrapper проверяет единственный user-event в stream.jsonl: UTF-8 stdin hash, prefix, verbatim capsule, markers и FULL_RULES_REFERENCE. Export hash сверяется с running outbox receipt; скопированный туда stdin hash проверяется дополнительно и не считается независимым измерением. Несовпадение **или отсутствие доказательства** до импорта вызывает Refused и `failed_no_automatic_replay`; исходники не импортируются. Попытка изменить сам canonical rules path отклоняется при любом callback.

После invoke proof дополнительно сверяет native transcript SHA-256, source export и changed_paths. Недоступный stream после уже завершённого validated import записывается как NOT_PROVEN, без повторного model call и без падения уже завершённого импорта. Proof содержит hashes/booleans, без prompt и credentials. VERIFIED доказывает доставку текста, не понимание модели и не independent QA.

## Installed pin и dev pin

По фактам поручения установленный pin: 113203 байта, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`. Source dev pin: 115079 байт, commit/hash выше. Этот этап не читает protected installation и не меняет pin.

Даже после установки нового delivery-модуля scoped Cursor останется на **точном full fallback**, пока RULES_* установленного context_policy не совпадут с canonical rules file экспортируемого repo. Pin bump и accepted artifact принадлежат другому executor и проходят отдельную проверку/установку. В JSON `running_module_pin` означает атрибуты импортированного source-модуля, а не наблюдение установленного runtime. Тесты проверяют настоящий dev canon, synthetic variant с другими patched RULES_* и matching accepted tuple, а также wrong-pin export.

## Детерминированное сравнение

Команда: `python3 -B docs/workbench/context-exchange-20261023/stage5_offline_compare.py`.

Скрипт использует RULES_* и CONTEXT_SOURCES, проверяет immutable accepted Git blob и сохраняет `STAGE5_CURSOR_AGY_COMPARE.json`. Fresh run должен совпадать с committed JSON. Provider calls = 0; installation/live mutations = 0.

Сохранённые синтетические входы — `offline_replay.saved_stage_inputs()`: task, failure/findings, 24 КБ excerpt и три prior receipts. DATA после diagnosis_view: **26345** байт, SHA-256 `dffbca8a4f86816f101a26e0f3bf3feeac0e8ab01d5febb3a6d017aaf72415d4`; inputs не мутируют, findings/evidence не теряются.

Пакет сравнения: `utf-8 rules_prefix + "\nSAVED_STAGE_DATA\n" + canonical JSON diagnosis_view`. Это единая offline форма для сравнения ролей; фактический legacy Cursor full stdin и его guidance проверяются отдельно unit-тестами. Full wire у runtime остаётся прежним inject. Маркер `Поправка SR0` присутствует только в full canon. Scoped size probe — synthetic reference equality, не actual-recipient proof. `scoped_selected_for_delivery=false` во всех offline строках.

| Provider | Роль | Full canon | Full prefix | Scoped capsule | Scoped prefix | DATA | Full package | Scoped package | Δ bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cursor | author | 115079 | 115306 | 4120 | 4571 | 26345 | 141669 | 30934 | 110735 |
| cursor | analyst | 115079 | 115307 | 4219 | 4671 | 26345 | 141670 | 31034 | 110636 |
| cursor | independent_qa | 115079 | 115302 | 4238 | 4685 | 26345 | 141665 | 31048 | 110617 |
| agy | author | 115079 | 115306 | 4120 | 4571 | 26345 | 141669 | 30934 | 110735 |
| agy | analyst | 115079 | 115307 | 4219 | 4671 | 26345 | 141670 | 31034 | 110636 |
| agy | independent_qa | 115079 | 115302 | 4238 | 4685 | 26345 | 141665 | 31048 | 110617 |

Для одинаковой роли provider packages byte-identical: **VERIFIED**. `author` → author capsule; `independent_qa` → qa; `analyst` → planner (technical_pm_product_analyst). В каноне нет analyst marker; research не выбран. Cursor analyst/QA строки — только историческое offline сравнение размеров, не разрешённые runtime роли.

### AGY QA stage budget

Лимит final stdin — **262144** байта. Скрипт самостоятельно считает full по той же формуле prefix + RULES_SIZE + suffix, что `native_antigravity.qa_rules_overhead()`; тест сверяет её с native-функциями, когда модуль importable, и с точным full inject.

| Вариант | Rules overhead | Оставшийся stage budget |
|---|---:|---:|
| Full, running source pin | 115653 | 146491 |
| Hypothetical scoped QA | 4713 | 257431 |

Scoped формула: qa rules_prefix + `BOUNDED STAGE INSTRUCTIONS:` и newline, без дополнительного guidance. Это **HYPOTHETICAL_NOT_QUALIFIED**, не изменение native AGY. Legacy AGY gate при probe None/False/exception возвращает exact full; даже probe True оставляет full из-за SCOPED_QUALIFIED=False. Native AGY inject не получает context_profile/verified_access.

## Токены и реальные reference facts

Реальный Cursor Auto full baseline #313, переданный Owner: provider_reported_usage **input 74745, output 6140, cacheRead 216576, cacheWrite 0**; **7 model call ids**, **13 tool events**, **API duration 82.6 s**, stdin **122326 байт**, profile **full**. Reference stage size **8545 байт** — документированный факт, **не input этого сравнения**. Эти receipts не переисполнялись и не читались из protected runtime в этой сессии. Cache fields не прибавляются повторно к input total.

Codex scoped_v1 QA #313: delivered policy **4238 байт**, tokens **NOT_MEASURED**.

Для текущего offline сравнения tokens/tokenizer — **not_exposed**. Generic BPE и bytes/4 не используются. Новые provider usage, latency, cost, cache hit, missed findings, actual-recipient runtime read и role canary — **NOT_MEASURED**. Δ bytes не означает проценты денег или latency.

## Проверки и передача

Финальный локальный прогон source/tests diff: **Ran 963 tests in 761.470s**, **OK (skipped=1)**. Один существующий skip не объявлен выполненным. Команда:

`python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*.py'`

Полный log: `/home/agentagency-dev/author-evidence-stage5-cursor-20261025/stage5-final-unittest.log`. В нём также `R4 seeded fuzz: seed=3070405 cases=23868 accepted_ignored=1521`. Адресный прогон context/Codex/AGY/Cursor + manifest/bootstrap + HTTP wire: **59 tests, OK**; исправленные entrypoint fixtures: **7 tests, OK**. Offline script: **rows=6, provider_calls=0, tokens=not_exposed**, exit 0; fresh measurement соответствует JSON. Manifest: все **34** записи совпали с файлами; относительно HEAD изменены только stage.py и новый context_cursor_delivery.py. `git diff --check` и аудит allowed paths — PASS, 11 изменённых/новых файлов, все в разрешённом scope.

Pins без изменения: native_cursor.py `02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089`; native_guard.py `dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762`. context_native_delivery.py остался `af0aa8ecac3190eefee8406200f1b6cbe009917326903b73bc118345d94fb367`.

История самопроверки сохранена: предварительный прогон той же команды до финализации manifest/отчёта дал **Ran 963 tests in 902.450s; FAILED (failures=3, errors=24, skipped=1)**. Три failures — ожидаемые незавершённые manifest/bootstrap/таблица отчёта. Старый entrypoint fixture выполнял stat реального marker и получил `PermissionError: [Errno 13] Permission denied: '/etc/gobadminton-slots/cursor-author.json'`; реальный marker не прочитан. Другой тест создавал localhost socket и получил `PermissionError: [Errno 1] Operation not permitted`. Повтор реальных обращений не выполнялся: первый fixture теперь хэширует свой synthetic marker и проверяет его сохранность; второй подаёт synthetic HTTP response bytes через стандартный HTTP parser/HTTPErrorProcessor при явно запрещённых sockets. Assertions об отказе первого слота и успешном втором сохранены. Production OPS не менялся. Реальный socket transport остаётся NOT_TESTED по no-network scope; новый тест проверяет HTTP wire parsing и API error handling в памяти.

TMPDIR направлен в разрешённый `author-evidence-stage5-cursor-20261025`; native invoke в unit fixtures получает fake-popen и job dir внутри disposable fixture. Реальные /tmp jobs, secrets, модели и installation не читались/не запускались. Tests используют отдельные synthetic Git fixtures; Git metadata рабочего checkout не изменяется.

NOT_TESTED: независимая QA exact diff, CI нового candidate, реальный Cursor scoped invocation, AGY scoped/author runtime, real socket transport, установка, DEV/PROD. Неразрешённых implementation gaps нет; source/tests ограничение соблюдено. Candidate SHA отсутствует: commit/push запрещены этим поручением. Следующий разрешённый шаг — независимая QA точного результирующего diff в другой сессии; pin bump/install и real canary отдельно. Full fallback и старые FAIL/UNKNOWN/grants/receipts не переписываются.

Исторический provenance #298 (не результат текущего candidate): source `78b36c5dd5e98b9241bc69ea646658b8e6feb8c2`, CI-observed head `5accd87d05e3074ebb83fe97dcd6466cd4c5e283`, [run 40149669426](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40149669426), сообщённые 616 tests / skipped=1 и Product CI 7/7. Эти числа сохранены как история и не являются CI/QA для нового незакоммиченного diff.
