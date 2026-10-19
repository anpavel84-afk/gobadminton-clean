# GoBadminton · OPS Takeover Runbook V001

**Статус:** WORKING DRAFT, документ только для передачи. Новых полномочий не даёт, не является OPS/PROD GO и не меняет систему.
**Дата снимка:** 19.10.2026, около 09:45 (Сан-Паулу, UTC-3).
**Назначение:** другая система или оператор должны по этому файлу принять ведение проекта целиком: понять, кто есть кто, где точки входа, как проходит задача, что запрещено и как безопасно начать.

> Репозиторий публичный. Поэтому здесь **нет** IP-адресов, имён пользователей ОС, имён ключевых файлов, токенов, PIN монитора и содержимого авторизаций. Вместо них стоят абстрактные имена: `<VPS>`, `<executor-user>`, `<ops-user>`, `<monitor-web-user>`. Реальные значения хранятся у Owner и в приватных заметках текущего OPS. Всё, что не удалось проверить, помечено **UNKNOWN**. UNKNOWN не значит «нет» и не значит 0.

> **Живое состояние** — в [ops/grok-toolkit/LIVE_STATE_RU.md](../../ops/grok-toolkit/LIVE_STATE_RU.md) (там же строка «Активный оператор»). **Инструменты** — [ops/grok-toolkit/README_RU.md](../../ops/grok-toolkit/README_RU.md). **Учения и протокол передачи резервному PM** — [OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md](OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md). Снимок в §7 ниже — на 19.10 09:45, живые данные важнее.

Источники проверки (только чтение, 19.10.2026): ветка `dev` @ `47fa3fde`; `scripts/chatops/autonomous_issues.py` на `ops/executor-park-v1-1` @ `970e5a47`; PR #100 @ `8dcdfad6`; `docs/workbench/GROK_OPS_AI_AGENT_INVENTORY_HANDOFF_20261019_V001.md` @ `a1a6ab4e`; `docs/workbench/GROK_BOT_OPS_BOOTSTRAP_20261017_V001.md` (ветка `docs/grok-ops-bootstrap-20261017-v001`); живой снимок монитора и `gb-grok-status` на `<VPS>`; `https://dev.gobadminton.ru/v1/meta`; рабочие файлы OPS-оператора (см. §2.4).

---

## 1. Назначение и кто есть кто

| Роль | Кто | Что делает | Чего не делает |
|---|---|---|---|
| **Owner** | Павел (GitHub `anpavel84-afk`, numeric id `318610566`) | Ставит цели, принимает продуктовые и рискованные решения: PROD, деньги, права, внешние сообщения, установка на сервер. Только его Issue и комментарии исполнитель принимает к работе | Ручных серверных шагов не делает. Максимум вставляет одну подготовленную root-команду |
| **OPS-оператор / технический PM** | Сейчас Grok Bot («Go Bad», облачный) | Режет цели на узкие задачи, пишет тела Issue, прогоняет линтер и ревью, публикует задачи от имени Owner, следит за конвейером, сам проверяет DEV в браузере после выкатки, разбирает провалы и пишет преемников, готовит серверные изменения (стейдж + одна root-команда) | Сам код продукта не пишет. Не обходит QA, не трогает PROD и состояние исполнителя |
| **Исполнитель** | `gobadminton-autonomy.service`: systemd **user**-сервис под `<executor-user>` на `<VPS>` (немецкий DEV-сервер), `KillMode=control-group` | Берёт одну авторизованную задачу, вызывает автора (Codex), коммит, PR, независимая QA точного SHA, CI, fast-forward в `dev`, проверка DEV | Не берёт следующую задачу, пока активная задача в состоянии `blocked` |
| **Советник / супервайзер** (ChatGPT, роль Owner) | Опционально | Продуктовые вопросы, приоритеты, критерии «готово» | Решения из списка «только с GO Owner» не принимает |

### 1.1 Инвентарь моделей и их состояния

Состояния не смешивать: **installed** (бинарник есть) / **catalog** (модель в списке клиента) / **authenticated** (клиент залогинен) / **inference** (реальный вызов доказан) / **approved** (Owner разрешил роль в конвейере) / **quota** (известен остаток).

| Клиент | installed | catalog | authenticated | inference | approved | quota |
|---|---|---|---|---|---|---|
| Codex CLI `0.160.1` | да | n/a | да | да: все автор/QA-прогоны исполнителя; 19.10 через `codex-review` доказан вызов модели `gpt-6.1-sol` с effort `high` | **да: единственный автор и единственная независимая QA** | UNKNOWN (в дизайне слотов лимит 40 вызовов автора и 40 QA в день) |
| Cursor Agent CLI `2026.10.01-e373342` | да (под `<executor-user>`) | 265 строк | да («Logged in» на аудите 19.10) | 19.10 не выполнялась | **нет**, исполнитель не маршрутизирует | токены закончились. Вернётся в режиме Auto после нового расчётного периода, дата UNKNOWN |
| Antigravity `agy 1.4.2` | да (под `<executor-user>`) | 13 вариантов (Gemini 4 Argon, Gemini 3.8 Flash, Claude Sonnet/Opus 5.5, GPT-OSS 120B) | UNKNOWN (каталог отвечает) | только исторически: пилоты 15.10 в #29 и #53 | **нет**. Запрещён как постоянная QA, пока не закрыты 7 дефектов из #29 | UNKNOWN |
| `gh 2.45.0` | да | — | — | не модель | транспорт | — |

- Старые ID `gpt-6.1-sol` / `gpt-6-astra` из архивных политик сами по себе текущими не считаются. Исключение: `gpt-6.1-sol` high реально отработал 19.10 через `codex-review`.
- В текущем исполнителе нет `-m` и effort для каждой задачи. Модель выбирает конфигурация Codex по умолчанию.
- Подробности: `docs/workbench/GROK_OPS_AI_AGENT_INVENTORY_HANDOFF_20261019_V001.md` (ветка `docs/grok-ops-bootstrap-20261017-v001`, @`a1a6ab4e`). Этот документ Owner велел принимать как факт.

---

## 2. Карта точек входа

### 2.1 Таблица

| Точка | Где / как | Кто читает / пишет | Примечание |
|---|---|---|---|
| Репозиторий | `anpavel84-afk/gobadminton-clean` (публичный), default `main` | все читают; push от Owner | Канонический источник |
| Ветка `dev` | HEAD `47fa3fde` (Refs #98 attempt 3) | пишет только исполнитель (ff) и Owner | **Любой push в `dev` запускает `dev-deploy.yml` (checks → images → deploy на DEV)**, фильтра путей нет |
| Ветки `automation/issue-N` | создаёт исполнитель | исполнитель | `autonomy-pr.yml` создаёт PR; `ci.yml` гоняет Product CI. Ручные ветки с таким именем не создавать |
| Ветки `ops/*` | изменения исполнителя и OPS-инструментов: `ops/executor-park-v1-1` (PR #81, PARK_V1.1), `ops/parallel-slots-v1` (PR #100), `ops/train-watchdog-20261017` | Owner/OPS | Путь: QA точного SHA → CI → отдельное «да» Owner → установка root-командой |
| Issue-задание | Первая строка `GOBADMINTON_AUTONOMY_V1`, дальше JSON (§2.2) | публикует только Owner (id 318610566) | Нельзя редактировать после публикации: `updated_at` должен быть равен `created_at` |
| Комментарий `GOBADMINTON_RESUME_V1` | в Issue заблокированной задачи | Owner | Только когда упал CI и попытки остались (§2.3) |
| Комментарий `GOBADMINTON_PARK_V1` | в Issue заблокированной задачи | Owner | Паркует задачу и освобождает слот (§2.3) |
| Сервис исполнителя | `gobadminton-autonomy.service` (user unit `<executor-user>`) | только `<executor-user>` | Фазы: `claimed → developing → candidate → pr_wait → qa → ci → promoting → dev_wait → done`, плюс `blocked` |
| Состояние исполнителя | `<executor-home>/.gb-autonomy-state/`: `state.json` (`{active, done}`), `parked.json`, `qa-<issue>-a<k>.json`, `before-resume-*.json`, `before-park-*.json` | только `<executor-user>` (каталог 0700) | **Не трогать.** OPS читает только через `gb-grok-status` и снимок монитора. QA-файлы для преемников читаются через разрешённый read-only канал Desktop Commander к `<VPS>` |
| Worktrees | `/srv/gobadminton-clean/worktrees` | исполнитель | — |
| Статус | `sudo -n -u <executor-user> /usr/local/bin/gb-grok-status` (ровно ноль аргументов) | `<ops-user>` | JSON: claim (issue/phase/attempt/head/pr/qa), `dev_receipt`, worker (MainPID, state) |
| Снимок монитора | `/var/lib/gb-ops-monitor/snapshot.json` (пишется каждые 30 с) | читает `<ops-user>` | Без секретов и без goal целиком |
| OPS-монитор | `https://dev.gobadminton.ru/ops-monitor/` → nginx → `127.0.0.1:18090`. Сервисы `gb-ops-monitor-web.service`, `gb-ops-monitor-writer.timer` и `.service`. Конфиг `/etc/gb-ops-monitor/config.json` (хеш PIN, root:`<monitor-web-user>` 0640) | вход по PIN Owner | **v4 (с «Бэклогом») установлена:** sha установщика `ddf4eb69…` совпадает, web перезапущен 19.10 в 09:26. PIN знает Owner, в документах не хранится |
| Названия задач (рус.) | `/var/lib/gb-ops-titles/titles_ru.json` | пишет `<ops-user>` без root (`.tmp` + `mv`) | Русские названия и смысл задач для монитора |
| Бэклог (рус.) | `/var/lib/gb-ops-titles/backlog_ru.json` | пишет `<ops-user>` без root | Строгая схема: `{_readme, items:[{id, issue, title_ru, meaning_ru?, note_ru?, status, priority, depends_on[]}]}`. Ошибка в файле = «Бэклог недоступен» |
| Установщик монитора | `sudo /usr/local/sbin/gb-ops/monitor-install` (pinned sha), код в `/usr/local/sbin/gb-ops/lib/monitor-installer.sh` | root-обёртка, доступна `<ops-user>` через sudo | Откат v4 → v3: см. §8.4 |
| `codex-review` | `/usr/local/sbin/gb-ops/codex-review` (sha256 `4ad1ef62…`) | `<ops-user>` через sudo | Read-only ревью текста. Вход: `echo "NAME.body.txt <sha256>" \| sudo /usr/local/sbin/gb-ops/codex-review`. Результат: `/var/lib/gb-ops-stage/reviews/NAME.body-<sha8>-<UTC>.txt`, до ~15 мин. Откат: `sudo bash /root/codex-review-install.sh --remove` |
| Прочие root-обёртки gb-ops 1.0 | `/usr/local/sbin/gb-ops/{status, monitor-uninstall, restart-dev-services, nginx-apply, stage-copy, dev-operator-command}` | `<ops-user>` через sudo, без аргументов | Узкие, вшитые хеши. Других прав root у `<ops-user>` нет |
| Стейдж | `/var/lib/gb-ops-stage/{files,reviews,nginx}` (0700, `<ops-user>`) | `<ops-user>` пишет по SFTP | Здесь лежат установщики под root-команду и тела на ревью |
| DEV | `https://dev.gobadminton.ru`, версия: `/v1/meta` → `gitSha` | публично | На 09:43: `gitSha=47fa3fde`, apiVersion `0.19.0` |
| Квитанция DEV | root-owned `/var/lib/gobadminton-deploy-evidence/dev.json` (видна в `gb-grok-status.dev_receipt`) | читает исполнитель | Последняя: `r39248271537-a1`, ACCEPTED, `pending=false`, source `47fa3fde`, finished 19.10 в 09:00:35 |
| Страховка выкатки | `gb-deploy-watchdog@dev.timer` (system) | root | Не отключать |
| CI | `.github/workflows/ci.yml` (PR в dev/main и push `automation/**`, `chatops/**`): 7 jobs `foundation, source (api), source (web), source (admin), source (contracts), database, receiver`. `dev-deploy.yml` (push в dev): `checks, images, deploy` с шагом `Apply, browser-smoke, accept; rollback on failure`. `prod-deploy.yml`: только при публикации release | GitHub Actions | «Зелёный» засчитывается только для точного SHA |
| Ассеты карты | MapLibre, подложка Protomaps/OSM (pmtiles, стиль, глифы) отдаются с DEV-сервера. Код: `apps/web/src/components/consumer/games/*Map*.tsx`, `lib/radar-map-assets.ts`, `styles/*.css`. Эталон: `MOCKUP_V001_owner.png` (рабочие файлы OPS) | — | 19.10 файлы карты загружаются без ошибок, проблема в CSS (§7.2). Для СПб файлов нет (M7) |
| Наблюдение за трейном | Расписанная рутина OPS-оператора, раз в ~30 мин. Журнал: `train_watch.md` в рабочих файлах OPS | OPS | Только чтение. Будит оператора на вехах и блокерах, после каждой выкатки DEV запускает браузерную проверку. Промпт ещё упоминает ревью Antigravity/Opus, нужно заменить на codex (TODO) |
| SMTP-сторож #69 | `gobadminton-train-watchdog.{service,timer}` (user units `<executor-user>`) | — | По bootstrap 17.10: SMTP не настроен, timer выключен. Текущее состояние UNKNOWN. Не считать работающим |

### 2.2 Формат задания `GOBADMINTON_AUTONOMY_V1` (проверено по `validate_issue`)

```text
GOBADMINTON_AUTONOMY_V1
{"schema":"GOBADMINTON_AUTONOMY_V1","target":"dev","kind":"source_only",
 "goal":"...","acceptance":"...","allowed_paths":["..."],"max_attempts":3}
```
- Ровно 7 ключей: `schema, target, kind, goal, acceptance, allowed_paths, max_attempts`. Лишний ключ или дубль ключа приводят к Hold. PR #100 добавляет необязательные `depends_on/locks/model/effort`, но он ещё **не установлен**.
- Автор Issue: numeric id `318610566`. Issue открыт, не отредактирован (`updated_at == created_at`), возраст ≤ 7 дней.
- Лимиты: тело ≤ 16384 байт; `goal` и `acceptance` по 1–6000 символов; `max_attempts` 1–3; `allowed_paths` 1–32 записи без дублей, `/**` разрешён.
- Пути разрешены только в `apps/`, `packages/`, `docs/`. Запрещены: `docs/operations`, `docs/rules`, `docs/manifest`, `docs/governance`, `docs/decisions` (кроме канареек #30/#31); сегменты `agents.md`, `node_modules`, `secrets`, `credentials`, файлы `*.pem`/`*.key`; скрытые сегменты, `..`; `[param]` только в `apps/web/src/app/`.
- Линтер OPS строже исполнителя: goal ≤ 5000, acceptance ≤ 3500, ≤ 14 путей, без `apps/**` и `apps/web/**`, обязательно `docs/handoffs/**`, без условий «остановись», без сети и git-записи в шагах автора, ≤ 9 пунктов acceptance.

### 2.3 Служебные комментарии Owner

| Маркер | JSON-поля (ровно) | Когда допустим | Эффект |
|---|---|---|---|
| `GOBADMINTON_RESUME_V1` | `schema, issue, head, attempt, mode="ci_fix", note (≤2000)` | `phase=blocked`, `resume_phase=ci`, `reason="Actions failed"`, `attempt < max_attempts`, head = 40-hex и совпадает | Новая попытка на исправление CI. Один комментарий срабатывает один раз. Тело ≤ 8192 байт, без редактирования |
| `GOBADMINTON_PARK_V1` | `schema, issue, head, attempt, reason (1–500), allow_successors (≤3 номера)`; для задачи без diff («zero diff», PARK_V1.1) `head=null` + `base` | задача `blocked` и **не** подходит под RESUME | Запись в `parked.json`, слот освобождается, задача **не** `done` |

Исполнитель на сервере запущен из ревизии, которую аудит 19.10 зафиксировал как `5c883c3f`. Содержит ли он PARK_V1.1 — UNKNOWN. Косвенный признак: #80 запаркована без head. PR #81 (PARK_V1.1) открыт и не влит.

### 2.4 Рабочие файлы OPS-оператора (теперь в `ops/grok-toolkit/`)

С 19.10 копии инструментов лежат в репозитории в [ops/grok-toolkit/](../../ops/grok-toolkit/README_RU.md) на этой ветке (секреты заменены плейсхолдерами, тесты проходят). Оригиналы остаются в рабочем каталоге Grok (`outputs/`). Что сознательно не выложено и почему — в README тулкита.
- `issue_lint/` — `lint_issue.py`, `REVIEWER_PROTOCOL.md`, `make_review_input.py`, тесты.
- `successor_loop/` — `successor_loop.py` (collect, pm, review, lint, compare, publish), README.
- `codex_review/` — исходник обёртки, установщик, тесты, `root_cmd.txt`.
- `ops_monitor_standalone/` — код монитора, установщики v2–v4, тесты.
- `backlog/backlog_ru.json`, `map_split/` (тела M*, `INDEX.md`, макет), `parallel_v2/` (дизайн слотов), `pm_v1/`, `postgame_plan_v2.md`, `train_watch.md`.
- PIN монитора из локального `RUN.md` удалён 19.10 (там теперь ссылка на приватное хранилище OPS). PIN даёт Павел лично.
- Живое состояние для резервного PM: `ops/grok-toolkit/LIVE_STATE_RU.md`, генератор `ops/grok-toolkit/sync_state.py` (источник потоков — локальный `grok_streams.json` у Grok).

---

## 3. Жизненный цикл: от поручения до DEV ACCEPTED

1. **Поручение.** Owner говорит цель голосом или текстом. OPS режет её на узкие независимые задачи: один набор файлов и одна приёмка на задачу.
2. **Тело Issue.** Нужны: база (`dev` HEAD SHA), цель, read-only источники, ≤ 9 проверяемых пунктов приёмки, конкретные `allowed_paths` (не `test/**`, а конкретные файлы тестов), `max_attempts: 3`. Фразы: «NEVER stop … no stop conditions», «NOT_TESTED с точной причиной вместо остановки», «handoff-only diff = FAIL». Без сети и без git-записи для автора: песочница автора офлайн, разрешены только `git show/cat-file/diff/log`.
3. **Линтер:** `python3 lint_issue.py BODY.txt` (нужен токен на чтение GitHub в окружении). Результат: ноль FAIL.
4. **Независимый ревьюер** по `REVIEWER_PROTOCOL.md` (12 пунктов, вердикт MOZHNO/NELZYA): сейчас Codex через `codex-review`. Ревьюер не должен быть автором тела. Вердикт сохраняется рядом с телом.
5. **Публикация** от имени Owner через токен Owner (§6). Сразу добавить русское название и смысл в `titles_ru.json` и обновить `backlog_ru.json`.
6. **Исполнитель:** claim → developing (Codex пишет в worktree) → candidate (проверка, что изменены только `allowed_paths`, commit) → push `automation/issue-N` → pr_wait (PR создаёт Actions) → **qa** (отдельная read-only Codex-сессия на точном SHA, результат в `qa-N-aK.json`) → **ci** (все 7 jobs на точном SHA) → promoting (normal fast-forward в `dev`) → dev_wait (`dev-deploy.yml`, receiver, root-квитанция ACCEPTED, `/v1/meta.gitSha` равен SHA) → done (`done_count` +1).
7. **Сбой.** QA FAIL или CI FAIL при оставшихся попытках: исполнитель сам повторяет. CI FAIL с `blocked/resume_phase=ci`: Owner-комментарий RESUME_V1. Попытки кончились или QA FAIL на последней: PARK_V1, потом цикл преемника (§4).
8. **Проверка DEV в браузере после каждой выкатки.** Рутина наблюдения замечает новый `gitSha`. OPS сам открывает DEV в своём браузере, проверяет изменённые экраны (карту сверяет с `MOCKUP_V001_owner.png`), смотрит консоль и сеть.
9. **Вердикт Owner: одна строка, без скриншотов.**
   - «Готово, идите проверьте» (что именно смотреть).
   - Или «Не готово, вернула на доработку». Скриншоты и детали уходят в задачу на доработку (тело преемника или исправления), а не Owner.
10. **Фиксация.** Обновить бэклог (выполненная задача скрывается сама) и записать веху в журнал наблюдения.

Пять разных фактов готовности не подменяют друг друга: проверки автора ≠ независимая QA ≠ CI ≠ ACCEPTED + live ≠ UAT на устройстве.

---

## 4. Цикл преемника и правило истории QA

**Когда:** задача запаркована, исчерпала 3 попытки или провалила QA.

1. `collect`: тело предшественника, **все** `qa-<N>-a<k>.json` всех попыток (read-only), точные ошибки CI по каждой попытке, комментарии RESUME/PARK, файлы PR.
2. `pm`: технический PM на старшей модели (Codex `gpt-6.1-sol` high через `codex-review`) читает код, называет корневую причину и пишет черновик.
3. **Обязательный раздел «Замечания QA предыдущих попыток»** (правило Owner 19.10.2026): по пункту на каждое замечание каждой попытки в форме `#N aK sha8: замечание -> как учтено (пункт acceptance)` или `-> вне scope: причина`. Пропуск или пункт без `->` даёт FAIL линтера (правило [Q]) и «НЕТ» у ревьюера (пункт 3).
4. `review`: отдельная чистая Codex-сессия. Ей передаётся тело и история QA: `make_review_input.py BODY.txt qa_history.json OUT.txt --issues N`. Приложение помечено «НЕ часть тела». Если NELZYA, исправленный текст ревьюера проверяется ещё один раз, не больше. Ревьюер другой семьи моделей (`--reviewer cmd:...`) предусмотрен, но **выключен**: `agy` отключён до исправления #29 и «да» Owner.
5. `lint`: `lint_issue.py`, плюс валидатор формата исполнителя, плюс проверка покрытия QA (`compare`).
6. `publish` только с явным `--publish`: Issue от Owner, русское описание в мониторе, контроль, что исполнитель взял задачу. Если `dev` ушёл вперёд до claim, перепроверить базу (пункт 9 протокола).

Команды (из рабочего каталога OPS):
```bash
~/sshvenv/bin/python successor_loop.py all <N> --pr <PR> --qa-dir evidence/<N>   # без публикации
~/sshvenv/bin/python successor_loop.py compare <N> --body FILE
~/sshvenv/bin/python successor_loop.py publish <N> --title ... --title-ru ... --meaning-ru ... --publish
```
Запрещено: сбрасывать попытки, увеличивать `max_attempts`, плодить Issue ради обхода лимита, редактировать опубликованное тело.

---

## 5. Параллельные слоты

**Решение Owner (19.10, 08:46):** правило «один писатель» действует на отдельный изменяемый ресурс (worktree, checkpoint, конфликтующий файл, операция слияния), а не на весь проект. Цель: ограниченное параллельное выполнение независимых задач под одним OPS-циклом. Сначала проверить изоляцию, потом включать. Умолчания приняты 19.10 в 08:53.

Принятые умолчания (`parallel_v2/DECISIONS.md`):
1. systemd-шаблон `gobadminton-slot@<slot>.service` плюс `gobadminton-supervisor.service`.
2. `git worktree` от одного clone.
3. Отдельный пользователь ОС на слот.
4. Старт с 2 слотов (активен 1, shadow), третий после недели без инцидентов.
5. Лимит Codex 40 вызовов автора и 40 QA в день плюс измерение. UNKNOWN-квота не планируется.
6. Ревьюер в цикле: Codex.
7. Cursor (Auto): provider-тест на 3 задачах плюс «да» Owner.
8. Установка только в окно `idle`.
9. Сначала ops-ветка, QA и CI, потом одна root-команда.

Механика: реестр блокировок по `areas` и `globs`. Всегда в одиночку: `global, migrations, packages/contracts, workflows, scripts/chatops`, а также задача без объявленных областей. Слияние строго по одному под общим mutex: merge нового dev (`--no-ff`, без переписывания истории) → полная новая QA → полный CI → ff → DEV → ACCEPTED. Аренды держатся через `flock`, поэтому при падении процесса снимаются ядром, без ручного сброса.

**Статус на 19.10, 09:45:**
- PR #100 `ops/parallel-slots-v1` (head `8dcdfad6`): открыт, **не установлен**, 7/7 CI зелёные на `8dcdfad6`. Стоит поверх PR #81, его нужно влить первым.
- Отчёты Codex-QA лежат в стейдже (`QA100-0ada371.txt`, `QA100b-8dcdfad.txt`). Итоговый вердикт в этом документе не сверен: UNKNOWN.
- Режим `--slot default` повторяет прежний исполнитель байт-в-байт: старые 57 тестов проходят без изменений.
- Проверки изоляции до `max_parallel=2` (11 пунктов): `parallel_v2/ISOLATION_PLAN.md` и `docs/operations/chatops/AUTONOMY_SLOTS.md` в PR #100.

**Включить:** QA и CI #81 и #100 → «да» Owner → окно, когда исполнитель `idle` → одна root-команда установщика. Он откажет, если исполнитель занят. Делает backup unit-файлов, sudoers, `autonomous_issues.py` и state (tar + sha256), переносит state в `slot1` **без сброса** (sha совпадает), запускает supervisor с `max_parallel=1`. Затем зелёные проверки 1–10 и отдельное «да» на `max_parallel=2`.
**Выключить / откат:** установщик с `--remove` восстанавливает старый unit и state из backup. Старый unit не удаляется, только отключается. Установщик ещё не собран: UNKNOWN.

---

## 6. Жёсткие правила и запреты

1. Не сбрасывать checkpoint, счётчики попыток, `done_count`, lock и историю, ни вручную, ни через новый state-каталог.
2. Никакого `force push`, `reset --hard`, `clean -fdx` в чужих worktree, переписывания опубликованной истории.
3. Не подделывать QA: не принимать своего автора в обход ревьюера, не переносить вердикт на другой SHA, не ослаблять тесты (`skip`, `continue-on-error`, удаление assertions).
4. **PROD** только по отдельному GO Owner, привязанному к release ID, SHA и digests. PLAN, личный VPN и другие проекты не трогать.
5. Не запускать `autonomous_issues.py` руками. Не запускать второй исполнитель или старый Runner/Autopilot. Не создавать вторую копию исполнителя на общем checkpoint.
6. Не трогать один конкретный Desktop Commander device из списка запрета Owner. Его ID хранится в приватных правилах OPS и в публичный репозиторий не пишется.
7. Сообщения третьим лицам (почта, Slack, внешние сервисы) уходят только через черновик, который подтвердил Owner.
8. Не запускать модельные CLI от `<executor-user>` (в том числе через Desktop Commander как обходной путь), не копировать логины и OAuth-профили, не переустанавливать инструменты, не запрашивать новую авторизацию без доказанной нужды.
9. Не расширять права `<ops-user>`: только `gb-grok-status`, перечисленные обёртки gb-ops и стейдж.
10. Не обходить автоматические проверки безопасности (Auto-review): не переименовывать и не кодировать команды. Блок означает: либо безопасный путь к той же цели, либо карточка одобрения для Owner.
11. Публиковать Issue и комментарии как Owner только через токен Owner с правом push. Он хранится как секрет окружения OPS-оператора (переменная `GH_PUSH_TOKEN`), владелец Павел. Никогда не печатать его и не класть в файлы. Коннектор `cursor-github` используется только для чтения.
12. Секреты, токены, PIN монитора и содержимое авторизаций никогда не печатать и не коммитить. Можно только назвать, где они лежат.
13. **Разрешение «безопасное умолчание за 30 минут»:** если на рутинный технический вопрос нет ответа около 30 минут, OPS выбирает безопасный вариант (запарковать и идти дальше или возобновить после падения CI) и сообщает об этом. **Не распространяется** на PROD, траты, внешние сообщения и необратимые действия.
14. **Серверные изменения: одна root-команда.** OPS собирает файл, тестирует офлайн, кладёт в `/var/lib/gb-ops-stage/files/` по SFTP, сверяет sha256 на сервере, делает DRY-прогон. Owner получает **одну** команду вида `sudo bash -c 'set -e; … sha256sum -c … && cp -a <старое> /root/<…>.bak && install … && <запуск>'` и отдельную команду отката. Owner не выполняет ручных шагов.
15. AGY не используется как постоянный QA-гейт до исправления 7 дефектов #29. Cursor не включается до нового расчётного периода, provider-теста и «да» Owner.
16. Не публиковать OPS-материалы в ветки `automation/issue-*` и не ставить настоящий маркер `GOBADMINTON_AUTONOMY_V1` в первую строку не-заданий.
17. Нет агрессивного опроса GitHub API с IP сервера: исполнитель держит интервал ≥ 65 с.

---

## 7. Снимок текущего состояния (19.10.2026, ~09:45)

### 7.1 Конвейер
- Исполнитель `active/running`, MainPID 1456, `KillMode=control-group`.
- **Выполнено задач: 22** (`done_count`).
- **#98 (M0c, ядро стабильности карты):** `phase=done`, попытка 3/3, head `47fa3fde`, QA PASS на `47fa3fde`, CI 7/7, PR #99 влит в dev. Issue на GitHub ещё открыт.
- **Последний релиз DEV:** `r39248271537-a1`, ACCEPTED, `pending=false`, source `47fa3fde`, завершён 19.10 в 09:00:35. Live `/v1/meta.gitSha = 47fa3fde`.
- Мерцание карты после #98 ушло.
- **Следующая задача: #101 M0e** (опубликована 19.10 в 09:42:58, преемник #98, база `47fa3fde`, `max_attempts 3`). `allowed_paths`: `apps/web/src/styles/radar-geographic.css`, `apps/web/test/radar-layer-transparent.test.ts`, `apps/web/test/games-map-basemap-visible.browser.mjs`, `docs/handoffs/**`. На 09:43 исполнитель её ещё не взял.
- Запаркованы (`parked.json`): #68, #76, #80, #86, #88, #90, #94, #96, у всех `owner_action`.
- Открытые PR: #100 (слоты), #81 (PARK_V1.1), #97, #95 (кандидаты запаркованных задач), #73 (docs итогов игры), #44.

### 7.2 Баг подложки карты (DEV)
- Симптом: на карте игр видны только маркеры и кластеры на бежевом фоне, улиц и воды нет. Атрибуция OSM/Protomaps на месте.
- Причина: коммит `5577fae` (Refs #78, attempt 1) отрисовывает Radar-слой как `div.gb-consumer.gb-radar-layer` (`RadarPage.tsx`). `.gb-radar-layer` абсолютный, на весь экран (`inset:0`), а `.gb-consumer` даёт ему `min-height:100dvh` и непрозрачный фон `--c23-canvas` = `#f5f6f2`. Этот фон закрывает canvas подложки. Файлы карты, стиль и тайлы грузятся без ошибок, а локальная подмена CSS возвращает карту.
- Исправление: #101 M0e. Одно правило `.gb-consumer.gb-radar-layer` (прозрачный фон, без min-height), unit-тест и браузерный тест, что подложку видно. Перед публикацией сделаны два ревью Codex (`SL98-review1`, `SL98-review2` в стейдже). Их итоговые вердикты в этом документе не сверены: UNKNOWN.

### 7.3 Инфраструктура OPS
- Монитор v4 с «Бэклогом» **установлен и работает** (sha `ddf4eb69…`, web перезапущен в 09:26). Писатель снимка: каждые 30 с.
- `codex-review` установлен (sha `4ad1ef62…`).
- Слоты: PR #100, не установлены (§5).
- PM V1 (поля `depends_on/locks/model/effort`, карта связей): дизайн `pm_v1/DESIGN.md`. Код вошёл в PR #100, не установлен.

### 7.4 Бэклог по приоритету (`backlog_ru.json`)
1. M0c (#98) — выполнено. Следом M0e (#101), очередь исполнителя.
2. M0d — режим `?mapdebug=1`. Лог не должен раскрывать координаты: фильтр должен ловить и целые числа (замечание QA #96).
3. M1f1 — разведение совпадающих маркеров (текст готов).
4. M1f2 — визуальные состояния маркеров по макету (текст готов).
5. M1f3 — пересчёт маркеров на zoomend (после M1f1 и M1f2, текст готов). M1f1–M1f3 должны получить раздел истории QA и пройти codex-review.
6. M2 — выбор площадки и компактная карточка.
7. M3 — нижний лист площадки.
8. M4 — игры площадки в том же листе.
9. M5 — полировка.
10. M6 — источник фото (нужно решение D4).
11. M7 — реестр городов и СПб (ждёт файлы карты СПб на сервере).
12. I1 — фото площадок в каталоге (после M6).
13. D1 — телефон площадки в форме создания игры (нужно решение Owner).
14–16. T0a-2, T0a-3, T0a-4 — бронь и контакты площадки (тексты готовы).
17–26. T1…T10 — итоги игры, посещаемость, споры, напоминания, отзывы, уровень, тренер, UI (строго последовательно; план `postgame_plan_v2.md`).
27. OPS-slots — установка слотов (окно простоя и «да» Owner).
28. ML614 — MapLibre 6.14.0, необязательно, ждёт лог с iPhone.
Без приоритета (старые Issue без формата исполнителя, не сверены): #69, #53 (ведётся вне исполнителя), #29, #23, #14, #6, #5, #4, #3, #2, #1. По ним нужно решение: закрыть или переписать.

### 7.5 Открытые вопросы к Owner
- Ставить ли ops-задачу на предустановку пакетов в песочнице автора и QA. Сейчас там нет сети, и типизация с тестами реально проверяются только в CI.
- D4: модель данных источника фото (M6).
- D1: показывать ли телефон площадки до создания игры.
- Файлы карты Санкт-Петербурга (M7).
- Окно простоя и «да» на установку слотов. Перед этим нужно влить #81.
- Старые Issue #1–#29, #69: закрыть или переписать.

---

## 8. Как принять управление

### 8.1 Доступы, которые надо проверить (не копировать чужие)
- [ ] GitHub на чтение (коннектор или токен).
- [ ] Токен Owner с правом push для публикации. Выдаёт сам Owner, это не копия из другого чата.
- [ ] SSH как `<ops-user>` к `<VPS>` (ключ и known_hosts выдаёт Owner). Проверить, что `sudo -n -l` показывает только `gb-grok-status` и обёртки gb-ops.
- [ ] Вход в OPS-монитор (PIN у Owner).
- [ ] Браузер для проверки DEV.
- [ ] Рабочие файлы OPS из §2.4: `ops/grok-toolkit/` на ветке `ops/takeover-runbook-v1` (линтер, протокол ревью, successor_loop, бэклог, макет).
- [ ] Резервный PM (ChatGPT): таблица доступов и Desktop Commander — [учения §2](OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md).

### 8.2 Что прочитать первым
1. Этот файл.
2. `docs/workbench/GROK_OPS_AI_AGENT_INVENTORY_HANDOFF_20261019_V001.md` и `GROK_BOT_OPS_BOOTSTRAP_20261017_V001.md` (§2, §10–§18, §21, §23), ветка `docs/grok-ops-bootstrap-20261017-v001`.
3. `scripts/chatops/autonomous_issues.py`: `validate_issue`, `validate_resume`, `validate_park`, `PHASES`, `CI_JOBS`.
4. `docs/operations/chatops/AUTONOMY_PARK.md`, PR #81 и #100.
5. `REVIEWER_PROTOCOL.md`, README `successor_loop`, `map_split/INDEX.md`, `backlog_ru.json`.

### 8.3 Первые безопасные read-only команды
```bash
# GitHub
gh api repos/anpavel84-afk/gobadminton-clean/branches/dev --jq .commit.sha
gh issue list --repo anpavel84-afk/gobadminton-clean --state open --limit 30
gh pr list   --repo anpavel84-afk/gobadminton-clean --state open
# DEV
curl -s https://dev.gobadminton.ru/v1/meta        # gitSha
# VPS как <ops-user>
sudo -n -u <executor-user> /usr/local/bin/gb-grok-status   # ровно без аргументов
cat /var/lib/gb-ops-monitor/snapshot.json
sudo /usr/local/sbin/gb-ops/status
```
**Здоровое состояние:** `worker.state=active/running`. `dev_receipt.accepted_status=ACCEPTED`, `pending=false`. `dev_receipt.source_sha` = `/v1/meta.gitSha` = HEAD `dev`. Claim либо движется по фазам, либо `done` и ждёт новую задачу. Снимок свежее 90 с, иначе монитор показывает «Нет свежих данных». `blocked` означает: прочитать `reason` и `resume_phase` и решить по §3, шаг 7.

### 8.4 Чего не делать в первый час
- Ничего не устанавливать, не перезапускать, не вливать в `dev`. Не публиковать Issue и служебные комментарии без согласования с Owner.
- Не запускать модели под `<executor-user>`, не трогать state, lock и worktrees.
- Не включать второй канал наблюдения, который опрашивает GitHub с IP сервера.
- Не работать одновременно с прежним OPS: сначала Owner явно передаёт роль, прежний OPS останавливает свою рутину наблюдения (принцип «без двух операторов», bootstrap §23). Механика: строка «Активный оператор» в `LIVE_STATE_RU.md`, протокол — учения §9.

### 8.5 Аварии и откат
| Ситуация | Действие |
|---|---|
| Задача `blocked`, `Actions failed`, попытки есть | Найти точный run и jobs на head SHA, классифицировать ошибку. Подготовить RESUME_V1 (`issue`, `head`, `attempt` = как в checkpoint), Owner публикует |
| `blocked`, попытки кончились или QA FAIL | PARK_V1 от Owner, затем цикл преемника (§4) |
| Сервис остановлен или упал | Только диагностика (журнал, кто остановил). Перезапуск делает Owner/root. Второй worker не запускать |
| Квитанция DEV pending, stale или нет | Разбирать через существующий receiver и `gb-deploy-watchdog`. Руками не править |
| Регрессия на DEV после выкатки | Вердикт «не готово, вернула на доработку» и узкая задача-исправление. `dev` вручную не откатывать без решения Owner. Откат кода ≠ откат схемы БД |
| Монитор сломан | Мгновенно выключить: `sudo systemctl stop gb-ops-monitor-web`. Откат v4 → v3 (root): `sudo bash -c 'set -e; L=/usr/local/sbin/gb-ops/lib/monitor-installer.sh; W=/usr/local/sbin/gb-ops/monitor-install; echo "a298a0c4e2c014978216fc8af4a5fe3dcb5aaf0970e2741e7609fdd85c838a41  /root/monitor-installer.sh.v3.bak" \| sha256sum -c - && install -m 0644 -o root -g root /root/monitor-installer.sh.v3.bak $L && install -m 0755 -o root -g root /root/monitor-install.v3.bak $W && $W && systemctl restart gb-ops-monitor-web'`. Полное удаление: обёртка `monitor-uninstall` |
| `codex-review` мешает | `sudo bash /root/codex-review-install.sh --remove` (root) |
| Ошибка в `backlog_ru.json` / `titles_ru.json` | Залить исправленный `.tmp` и сделать `mv`, root не нужен. Монитор отклоняет невалидный файл целиком и показывает «Бэклог недоступен» |
| Ошибка 401 модели, отозван OAuth | Классифицировать без вывода учётных данных и сообщить Owner. Профили не копировать |
| Квота 403/429 | Ждать backoff или reset, claim сохраняется. Опрос не усиливать |

---

## 9. Стиль общения с Owner

- Русский язык, коротко, читается с телефона. Технические идентификаторы оставлять как есть. Текущий OPS пишет о себе в женском роде.
- Писать Owner только о **решениях, вехах и блокерах**. Нормальный ход и «без изменений» не сообщать.
- После выкатки одна строка: «готово, идите проверьте (что смотреть)» или «не готово, вернула на доработку (одной фразой почему)». Скриншоты Owner не слать, они идут разработчикам в задачу.
- Вопрос к Owner: один конкретный, с вариантами и рекомендацией. Без ответа ~30 мин действует правило безопасного умолчания (§6, п. 13).
- Серверные изменения: одна готовая root-команда плюс команда отката, без ручных шагов.
- Честность: не выдавать активный процесс за прогресс, source QA за UAT, а снимок за живое состояние. UNKNOWN писать как UNKNOWN.

## Приложение: что не проверено (UNKNOWN)

Закрыто тулкитом 19.10:
- ~~Рабочие файлы OPS только у Grok~~ → `ops/grok-toolkit/` (линтер + тесты, протокол ревью, successor_loop + тесты, codex_review src/установщик/тесты, монитор v4 src/тесты/сборка установщика, parallel_v2, pm_v1, map_split с макетом и телами, backlog/titles, планы, шаблоны RESUME/PARK).
- ~~Где живое состояние для подменного оператора~~ → `LIVE_STATE_RU.md` + `sync_state.py`.
- ~~Как не работать вдвоём~~ → строка «Активный оператор», учения §9.
- Рутина наблюдения: суть и порядок действий описаны в учениях §7. Сам текст промпта и расписание по-прежнему живут в настройках OPS-бота (частично UNKNOWN).

Остаётся UNKNOWN:
- Есть ли PARK_V1.1 в фактически запущенной ревизии исполнителя.
- Итоговый вердикт Codex-QA по PR #100. Установщик слотов ещё не собран.
- Дата нового расчётного периода Cursor и квоты Codex и AGY.
- Текущее состояние SMTP-сторожа #69.
- Под каким пользователем ОС работает Desktop Commander резервного PM и что показывает его `sudo -n -l` (проверяется на учениях, §2).
- Есть ли у резервного PM fine-grained токен Owner и браузер для DEV (проверяется на учениях).
