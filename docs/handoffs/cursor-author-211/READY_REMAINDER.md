# Cursor Auto author: остаток canary → ready

**Статус: WORKING DRAFT — NOT APPROVED — NOT CANONICAL.** Не admission, не смена marker, не install, не grant, не QA PASS и не DEV ACCEPTED.

- From: author (этот source candidate). To: PMA/OPS (единственный mutating PMA — Grok).
- Дата: 2026-10-25.
- Роль: author. Base: `dev` `0ebd58e57d31e4f273708dc98aab59f1572eedcf`. Candidate реализации: `ca79c962c98142aa5c77e9eb118a135b23eb4658`.
- Правила, фактически прочитанные и сверенные по байтам: EOM 1.4 commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, 115079 bytes; SMART_ROUTING 1.0 commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`, 76720 bytes. Статус политики: POLICY_ACCEPTED, только SR0. SR1–SR6, ROLE_QUALIFIED, RUNTIME_VERIFIED — не выполнены.
- Факты marker на VPS (сообщены Owner, read-only, этим candidate не перечитывались и не менялись): `/etc/gobadminton-slots/cursor-author.json`, schema `GB_CURSOR_AUTHOR_211_V1`, `phase=canary`, slots `slot1`/`slot2`, `canary_task_sha256=4570522ac1c4a3685ba253a921561d1bb866c863878b3e084c6063a13efe3005`, successor issue 225, parent 211. Установленные модули: `native_cursor.py` `02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089`, `native_guard.py` `dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762`. CLI bundle `/opt/gobadminton-cursor-cli/2026.10.01-e373342`, login уже есть.

## Что уже проверено

Квалификация CLI/адаптера и приёмка продукта — разные факты (EOM §6.2).

| Факт | Evidence | Чего это не доказывает |
|---|---|---|
| Изоляция и inference Cursor Auto, QA v18 PASS | Issue #211, launcher `8f35a86f64119661cecdc7710e8df4acd63baddd83ed66a5a02e3eb39e9bf481`, stream `a70fc6301962bb84efad730498f1856401cf319d6f160421c09ae8058f1117aa` | Product PASS, DEV ACCEPTED, `phase=ready` |
| Shell в native sandbox, QA v20 PASS | Issue #211, stream `e3730ce3f9f8e4f0b8eec575d351d2dc2ae8fa263a83154ce7705d59bc511a70`, QA `af8d263e5c29f97626d85998067b2fc836aa7906c013b1f19c0176229e3e3d12` | То же |
| Реальный author через Actions, кандидат и CI | #211 run `39881694976`, candidate `95c138460cbaeeeab03b5bf781dea4cbfddadceb`, PR #224, CI `39882042536` 7/7 | QA PASS. QA FAIL: `json.loads` принимал NaN/Infinity/-Infinity |
| Диагноз парсера | Manual Astra R2 `cf277ca0e02f12e989eee02c68d5e6e145f49f541e85c267dcd8a65b3b15548a`. Автоматический #218 не установлен | Не повторять Astra. `parse_constant` обязан поднимать ValueError |
| Successor author один раз | #225 run `39892222822`, candidate `76c2b417b88aee3b8b70a0249c6b156c76a6cbdd`, PR #228 (open, не merged), CI `39892485120` 7/7 | QA PASS и DEV. QA `39893062064` FAIL |

Открытый дефект #225 (QA `39893062064`, lifecycle DEFERRED run `39893306366`, entry `29d739556ea2a46a75ef2613a9321220259c266a0cf1b8e51cce2afef0336a36`): 12 тестов кандидата проходят и на неисправленном парсере `95c13846`. Верхнеуровневые константы отклоняет схема, потому что значение не receipt-dict. Вложенные фикстуры не содержат обязательных полей receipt, поэтому FAIL даёт `validate()`, даже если `json.loads` константу принял. Нужны: прямой отказ парсера на NaN/Infinity/-Infinity и те же литералы внутри extra object/array у иначе валидного receipt. Исходный допуск #211 и счётчик 1/1 не сбрасываются. Archive #211 `97b0713cf85f8a97f1c84e620692c6090d1017c338b9857ca17dbccc7f756a88` остаётся прежним.

`native_cursor.qualification` (строки 66–69) пускает любую задачу только при `phase=ready`. При `canary` задача должна совпасть с `canary_task_sha256`. Иной путь запуска в коде нет: `cost_policy.preferred_route` выбирает уже допущенный `cursor:auto`, `core.route` вызывает `native_cursor.available`, `stage.py` вызывает `native_cursor.invoke`.

## Точный акт смены marker и кто его выдаёт

Единственный предусмотренный акт для текущего successor-marker — root-only `accept` в `scripts/chatops/ops/cursor_successor_upgrade.py` (`accept_canary` → `complete_qualification`). Его выполняет reviewed root integrator (`os.geteuid()==0`). Автор допуск себе не выдаёт (EOM §6.3): его оформляет доверенный PMA/OPS этим уже существующим скриптом.

`accept` пишет marker только после всех условий сразу: journal `active-canary`; policy `active` и тот же controller; marker `phase=canary` и тот же `canary_task_sha256`/`successor`; ровно один slot с issue 225, `phase=done`, attempt 1; QA PASS на exact head; CI sha, live `gitSha` и server `ACCEPTED`/`source_sha` равны этому head; ровно одна confirmed author-операция (`cursor`, effective `Auto`, `charged_calls=1`, native receipt `imported`), одна confirmed Codex QA (`charged_calls=1`) и одна confirmed dev. Затем marker становится `phase=ready` с `accepted_canary` и `qualified_at`, journal проходит `qualifying-ready` → `active-ready`. Задача, attempt, lease и ledger не переписываются.

`scripts/chatops/ops/cursor_author_upgrade.py accept` — прежний акт для исходного #211 journal (`cursor-author-211.json`, issue 211). Текущий marker уже successor #225, поэтому применим successor-скрипт, journal `cursor-successor-211.json`. Merge этого PR marker не меняет: файл живёт в `/etc/gobadminton-slots/`, не в git.

## Что сделано в этом candidate

- `docs/handoffs/cursor-author-211/receipt_check.py`: `parse_constant` поднимает `ValueError` на литералы NaN/Infinity/-Infinity. Поведение схемы, duplicate-key и лимита размера сохранено. Это source-кандидат по открытому дефекту QA, не повтор вызова Cursor и не сброс 1/1.
- `docs/handoffs/cursor-author-211/test_receipt_check.py`: прежние проверки плюс прямой отказ парсера и extra object/array внутри валидного receipt. Для extra-фикстуры тест показывает, что обычный `json.loads` плюс `validate()` дали бы PASS.
- `scripts/chatops/tests/test_actions_train_cursor_receipt.py`: тот же набор виден обычному `unittest discover` train CI.
- `scripts/chatops/tests/test_actions_train_cursor.py`: `phase=ready` пускает другой task hash через тот же `qualification` + `core.route` и не вызывает `invoke`; `phase=canary` по-прежнему отказывает; ready не назначает Cursor задаче без допущенного первого `cursor:auto` и не переписывает immutable V1. Классификатор SMART_ROUTING не включается.

## Заблокированные задачи

### 1. Модельный вызов Cursor Auto через Actions

Получатель: PMA/OPS, затем существующий controller. Результат: если продукт #225 должен быть написан именно train-автором, один новый bounded author attempt `cursor:auto` без fallback, только два Python-файла checker/tests, с сохранённой историей #211/#225. Non-goals: повтор Astra, сброс 1/1, второй launcher, смена sandbox/PIN/AppArmor, новый API-ключ, переустановка CLI.

**Блокер:** допуск #225 исчерпан (1/1, DEFERRED `39893306366`). Новый вызов требует отдельного bounded admission от доверенного PMA/OPS. Этот candidate такой допуск не создаёт и вызов не выполняет.

### 2. Смена marker canary → ready

Получатель: reviewed root integrator. Команда — существующий `cursor_successor_upgrade.py accept` с тем же bundle/manifest/controller/stage/dispatch, которые записаны в journal. Non-goals: ручная правка `/etc/gobadminton-slots/cursor-author.json`, подделка QA PASS, запуск `cursor_author_upgrade.py accept` вместо successor-акта.

**Блокер:** входы `accept` ложны. QA кандидата `76c2b417` — FAIL; DEV ACCEPTED нет; PR #228 не merged. EOM §6.2 запрещает объявлять READY по продуктовому FAIL. Этот candidate marker не меняет.

### 3. Install

**Блокер:** установка runtime сменила бы проверенные module pins marker и не нужна для offline-checker. CLI уже установлен; повторная установка, новый ключ и смена AppArmor/sandbox/PIN не предлагаются и этим PR не делаются.

### 4. Grant / budget

**Блокер:** автор не выдаёт grant. Внутренний `budgets.json` (`cursor.author=unlimited`) — не подписка Cursor и не квалификация роли (EOM §6.1). Старые attempts, receipts и #207 UNKNOWN не переписываются.

Разрешённый следующий шаг после независимого exact-SHA QA и обычного CI этого candidate: PMA решает, принимать ли source как ремонт покрытия без нового model call или оформлять новый bounded admission на тот же scope. Marker `accept` — только после QA PASS, CI и DEV ACCEPTED exact head по правилам successor-скрипта.

## Учёт CLI Auto в подписке

Репозиторий не называет план login `agentagency-dev` и не содержит цену Auto.

Что фиксируют receipts и код: effective route `Auto`; `underlying_model` null; `provider_internal_calls` null; `effort` null; provider-reported token counts, когда CLI их отдал (v18 input 29185 / output 1246 / cacheRead 30080 / cacheWrite 0, три `model_call_id`; v20 input 35946 / output 2514 / cacheRead 80768 / cacheWrite 0, пять id; ранний file-tool trial input 6767 / output 520 / cacheRead 25472 / cacheWrite 0). Поле `money` в `cost_policy.usage` остаётся null. Внутренний ledger считает `charged_calls` вызова, это не счётчик подписки. EOM §6.1 и SMART_ROUTING SR-T23: неизвестные usage и цена остаются UNKNOWN, не ноль и не выдуманная модель.

Публичные страницы Cursor на 2026-10-25 (не receipt этого login): [Usage and limits](https://cursor.com/help/models-and-usage/usage-limits), [Legacy plans](https://cursor.com/docs/account/pricing/legacy-cursor-plans). Для legacy Pro+ ($60/mo) включённый расход — два месячных пула, Cursor Models и Other Models; on-demand для индивидуального плана выключен, пока его не включат. Та же страница limits говорит, что Cost mode (classic Auto) на индивидуальном плане списывается как запрос Cursor-model из включённого пула, какой бы backend ни ответил, и что у individual plans только Cost mode. Страница legacy plans отдельно говорит, что Auto, ушедший в стороннюю модель, списывается из Other Models по цене этой модели. Какой из двух текстов применяет CLI `--model auto` бандла `2026.10.01-e373342`, в какой пул попали вызовы #211/#225 и включён ли on-demand — в репозитории нет. Деньги, пул и backend — UNKNOWN.
