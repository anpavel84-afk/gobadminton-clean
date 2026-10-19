# Autonomy PARALLEL_SLOTS_V1 (параллельные слоты исполнителя)

Статус: **код и тесты, НЕ установлено.** Установка — отдельная root-команда, только в окне простоя исполнителя и только по «да» Owner.
Сначала включается один слот (`max_parallel=1`), второй — после проверок изоляции и второго «да».

## Коротко
- `--slot default` (по умолчанию) — **ровно прежний исполнитель**: те же пути, user-unit `gobadminton-autonomy.service`,
  пользователь `agentagency-dev`, env, имена файлов QA, интервал API. `slots.py` в этом режиме даже не импортируется.
  Два осознанных отличия и в default: (1) PM V1 — необязательные поля задания `depends_on/locks/model/effort`
  валидируются (`check_links`), неверные значения → Issue отклоняется; (2) state с `RETIRED_TO_SLOT.json`
  (после миграции в slot1) → отказ старта. Всё остальное новое поведение — только под `_SLOTS`.
- `--slot slotN` (`slot1`..`slot8`) — изолированный слот: свой пользователь ОС, свой state/checkpoint, свои worktree,
  своя аренда блокировок, свой бюджет; system-unit `gobadminton-slot@slotN.service`.
- Supervisor (`slots.py supervise`, пользователь `gb-supervisor`) читает статусы слотов, строит план по `depends_on`
  и `locks` и пишет слоту назначение. Слот берёт **только назначенный** ему Issue.
- Слияние в dev — строго по одному под общим integration mutex.

## Поля задачи (PM V1, необязательные, проверяются строго)
`depends_on` (≤8 разных номеров Issue, не свой), `locks` (≤8, `area[:sub[:leaf]]`, `[a-z0-9-]`, `global` только один),
`model` + `effort` только вместе и только из закрытого реестра (`gpt-6.1-sol`: `high|medium`). Любое другое поле — Hold, как раньше.
Default-исполнитель их только записывает в checkpoint.

## Раскладка слота
| Ресурс | Путь | Владелец/права |
|---|---|---|
| state/checkpoint | `/var/lib/gobadminton-autonomy/slots/<slot>` | пользователь слота, 0700 |
| outbox (status.json, ledger.json) | `/var/lib/gobadminton-autonomy/outbox/<slot>` | пользователь слота, 0755 / файлы 0644 |
| назначение | `/var/lib/gobadminton-autonomy/assign/<slot>.json` | `gb-supervisor` (или root), не group/world-writable |
| аренды, mutex, API clock | `/var/lib/gobadminton-autonomy/locks/` | `root:gb-slots` 1770 (sticky) |
| repo / worktrees / home | `/srv/gb-slots/<slot>/{repo,worktrees,home}` | пользователь слота, 0700 |
| лимиты | `/etc/gobadminton-slots/budgets.json`, `supervisor.json` | root, 0644 |

`slot1` работает под существующим `agentagency-dev` (свой SSH-ключ и вход Codex, ничего не копируется).
`slotN≥2` — пользователь `gb-slotN`, его ключ и вход готовятся отдельным шагом при включении второго слота.
Слот проверяет при старте, что `--repo/--state-dir/--worktrees-root` — ровно его раскладка и не пересекаются с другими
слотами и legacy-state. В sandbox модели запрещены каталоги всех остальных слотов и legacy-state.

**Git.** Один общий объектный магазин `/srv/gb-slots/base.git` (root, только чтение) и у каждого слота свой clone
через alternates, задачи — `git worktree` внутри clone слота. Один *записываемый* clone на нескольких пользователей
отдал бы слоту A запись в index/refs слота B (метаданные worktree лежат в общем `.git`), поэтому так не делаем.

## Блокировки
- Запись аренды: `{issue, locks, allowed_paths, depends_on}`. Задача без `locks` = `["global"]` (одна).
- Конфликт: одинаковые или вложенные области (`web:games` ~ `web:games:map`), `global|migrations|contracts|workflows|chatops`
  с чем угодно, **или** пересечение `allowed_paths`. Тот же Issue — всегда конфликт.
- Аренда живая, только пока процесс слота держит на ней `flock`. Упал — ядро сняло; чужой файл не удаляется (sticky),
  а просто не считается живым. Захват и проверка — атомарно под `registry.lock`.
- Слот берёт аренду при claim и заново при рестарте до любых действий; конфликт → Hold (blocked), ничего не запушено.
  Аренда освобождается после `done` или PARK. Blocked-задача аренду держит.

## Очередь слияния (по одному)
Когда CI кандидата зелёный, слот ждёт `integration.lock` (checkpoint не меняется, в журнал `merge_wait`). Под mutex:
1. dev не сдвинулся → прежний путь: ff push в dev → DEV deploy → server ACCEPTED → `done`.
2. dev сдвинулся (слил другой слот) → **merge commit кандидата на новый dev** (`--no-ff`, без rebase-переписывания и
   без force push), проверка: новый dev содержит прежний base, все изменённые пути в `allowed_paths`, `diff --check`.
   Новый SHA проходит **полную новую QA** (файл `qa-<n>-a<k>-i<j>.json`) и **полный CI**, затем ff/deploy/accept.
   История прежнего кандидата сохраняется в `history`, попытка не тратится.
3. Конфликт слияния, переписанная история dev или путь вне scope → Hold (blocked), mutex освобождается.
Mutex освобождается при возврате к авторингу (QA FAIL), при blocked и после `done`.

## Бюджеты (UNKNOWN ≠ 0)
`budgets.json`: `providers.<p>.<role>` — дневной лимит на хост, `slots.<slot>.<p>.<role>` — на слот. Нет числа → UNKNOWN:
не «бесплатно» и не «пусто», модель не вызывается и задача не планируется. Вызов списывается **до** запуска модели.
Каждый слот пишет только свой `ledger.json`; итог хоста — сумма всех ledger. Исчерпано → Hold (blocked), решает Owner.
Старт: Codex author 40 / QA 40 в день на хост.

## Адаптеры моделей
Закрытый реестр в коде: `codex` (author/qa/review) — единственный включённый. `cursor` — выключен (нет токенов; включение:
Auto, provider-тест на 3 задачах, «да» Owner). `agy` — только review и выключен; роль QA и author запрещена жёстко, пока не
закрыт #29. QA-гейт всегда Codex. Модель задачи без адаптера → Hold.

## API GitHub
Неавторизованная квота 60 запросов/час общая на IP. В slot-режиме все слоты и supervisor ставят свои чтения через общий
`api.clock` (65 c на хост, общий backoff после 403/429). Поэтому параллельность ограничена чтениями API: 2 слота делят
одну квоту. Расширение — отдельное решение Owner (read-only токен).

## Миграция состояния (код, не запускалась)
`slots.py migrate --src /home/agentagency-dev/.gb-autonomy-state --dst /var/lib/gobadminton-autonomy/slots/slot1 [--apply]`:
без `--apply` только показывает манифест. Отказ, если legacy `worker.lock` занят, `active` не `null`/`done`, или dst не пуст.
Копирует байт-в-байт `state.json`, `parked.json`, `qa-*`, `before-*` с проверкой sha256, без сброса счётчиков и истории,
пишет `MIGRATION.json` и в legacy-каталог `RETIRED_TO_SLOT.json`: default-исполнитель на таком state дальше не стартует.

## Недоступные пути (EACCES)
Слот под отдельным пользователем или с `ProtectHome=yes` не может сделать stat внутри `/home/agentagency-dev`, а на Python 3.12
`Path.exists()` в этом случае бросает `PermissionError`. Поэтому проверки разделены. В read-allowlist (`readable_present`)
недоступный путь считается отсутствующим и не выдаётся. В deny-list (`deny_present`) он считается существующим и
остаётся запрещённым, то есть fail-closed. Импорт исполнителя под непривилегированным пользователем больше не падает.
Для slot2 до включения нужен собственный путь `--codex` и runtime вне `/home` (default `NATIVE_CODEX` лежит в legacy home).
Это отдельный шаг вместе с разрешением на второй слот.

## Тесты
`python3 -B scripts/chatops/tests/test_autonomous_issues.py` (прежние 57, без изменений) и
`python3 -B scripts/chatops/tests/test_slots.py` (новые). CI: job `receiver`.
