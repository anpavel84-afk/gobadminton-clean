# grok-toolkit — рабочие инструменты OPS-оператора GoBadminton

**Статус:** копия рабочих инструментов Grok (Go Bad) для резервного PM. Создано 19.10.2026 на ветке `ops/takeover-runbook-v1` (PR #102, **не вливать**: merge в `dev` запускает DEV-деплой и сдвигает базу исполнителя).
Ничего отсюда не устанавливается само. Исполнитель эти файлы не читает.

> Репозиторий публичный. Перед публикацией всё прошло секрет-скан. IP, имена пользователей ОС, имена ключей, hostname сервера, ID устройств Desktop Commander, PIN монитора и токены заменены плейсхолдерами (см. «Окружение»). Реальные значения есть только у Павла и в приватных заметках OPS.

Начинать с: [LIVE_STATE_RU.md](LIVE_STATE_RU.md) → [runbook](../../docs/workbench/OPS_TAKEOVER_RUNBOOK_V001.md) → [учения и протокол передачи](../../docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md) → этот файл.

## Окружение

| Плейсхолдер | Переменная | Что это |
|---|---|---|
| `__VPS_HOST__` | `GB_VPS_HOST` | адрес DEV-сервера (`<VPS>`) |
| `__VPS_HOSTNAME__` | `GB_VPS_HOSTNAME` | hostname сервера (проверяется установщиками) |
| `__OPS_USER__` | `GB_OPS_USER` | `<ops-user>`: узкий OPS-пользователь (SSH, `gb-grok-status`, обёртки gb-ops, стейдж) |
| `__EXEC_USER__` | `GB_EXEC_USER` | `<executor-user>`: пользователь исполнителя |
| `__MON_USER__` | `GB_MON_USER` | системный пользователь web-части монитора |
| `__OPS_SSH_KEY__` | `GB_OPS_SSH_KEY` | имя файла SSH-ключа `<ops-user>` в `~/.ssh` (сам ключ выдаёт Owner) |
| `__KNOWN_HOSTS__` | `GB_KNOWN_HOSTS` | файл known_hosts для сервера |
| — | `GH_PUSH_TOKEN` | токен Owner (запись: Issue, комментарии, push в ops-ветку). Никогда не печатать |
| — | `GH_READ_TOKEN` | необязательный токен только на чтение (линтер и `sync_state.py` берут его первым) |
| — | `GB_PIN_FILE` | путь к приватному файлу с PIN монитора, только для секрет-скана `sync_state.py` |

`./render.sh <папка> <копия>` подставляет значения из окружения в **копию** (например, перед сборкой установщика). Проверено: копия `codex_review/` и исходники монитора после render побайтно совпадают с установленными на сервере.

## Инструменты

| Папка / файл | Что делает | Как запустить | Зависит от |
|---|---|---|---|
| `LIVE_STATE_RU.md` | живое состояние: claim/фаза/попытка, DEV, бэклог топ-10, PR/Issue, потоки Grok, вопросы и решения Owner, **активный оператор** | читать; обновляет `sync_state.py` | — |
| `sync_state.py` | собирает `LIVE_STATE_RU.md` из SSH (`gb-grok-status` + снимок монитора), GitHub, DEV `/v1/meta`, `backlog_ru.json`, `grok_streams.json`. Секрет-скан fail-closed. Коммит и push только при изменении содержимого и только в `ops/takeover-runbook-v1`, без force, с `[skip ci]`. Отказывается (код 3), если активен другой оператор | `python3 sync_state.py --repo <клон ветки> --streams grok_streams.json --backlog backlog_ru.json [--push]` | python3; `paramiko` и `GB_*` для раздела VPS (иначе UNKNOWN); токен для GitHub и push |
| `issue_lint/lint_issue.py` | линтер тела Issue: формат `GOBADMINTON_AUTONOMY_V1`, `validate_issue` исполнителя (через `ai_dev_shim/` → `scripts/chatops/autonomous_issues.py` этого репо), лимиты OPS, запретные пути, база = HEAD dev, раздел истории QA для преемников, запрет stop-условий, сети и git-записи | `python3 issue_lint/lint_issue.py BODY.txt [--dev-sha SHA] [--offline] [--json]`; 0 = нет FAIL | python3; GitHub API (токен желателен, `--offline` без сети) |
| `issue_lint/run_tests.sh` | регрессия линтера на известных телах + `test_stop_neg.py`, `test_successor_qa.py` | `bash issue_lint/run_tests.sh` | тела в `map_split/bodies/`; база закреплена `LINT_DEV_SHA` |
| `issue_lint/make_review_input.py` | вход для ревьюера: тело + история QA (приложение «НЕ часть тела») | `python3 issue_lint/make_review_input.py BODY.txt qa_history.json OUT.txt --issues N` | JSON истории QA (пример `map_split/qa_history_96_94.json`) |
| `issue_lint/REVIEWER_PROTOCOL.md` | 12 пунктов независимого ревью, вердикт MOZHNO/NELZYA | ревьюер читает | — |
| `successor_loop/` | цикл преемника: `collect → pm → review → lint → compare → publish` (публикация только с `--publish`) | `python3 successor_loop/successor_loop.py all <N> --pr <PR> --qa-dir <папка с qa-N-aK.json>`; тесты: `python3 -m unittest discover -s successor_loop/tests` (17) | `pm`/`review` идут через `codex-review` на сервере (нужен SSH `<ops-user>`); остальное — python3 + GitHub. Внешний ревьюер `reviewers/external_reviewer_template.sh` **выключен** |
| `codex_review/` | root-обёртка `/usr/local/sbin/gb-ops/codex-review`: read-only Codex-ревью текста задачи в песочнице без сети (уже установлена, sha `4ad1ef62…`) | на сервере как `<ops-user>`: `echo "NAME.body.txt <sha256>" \| sudo /usr/local/sbin/gb-ops/codex-review`; тесты: `bash codex_review/tests/test_validate.sh` (36). `tests/e2e_ns.sh` — только в root-namespace на box, после `render.sh` | SSH `<ops-user>` + стейдж; установщик требует root (уже сделано) |
| `ops_monitor/` | OPS-монитор v4 («Бэклог»): `opsmon/` (writer + server), `web/`, `deploy/`, тесты | тесты: `cd ops_monitor && python3 -m unittest discover -s tests` (36); сборка установщика: `render.sh` → `build_installer.sh` → `dist/monitor-installer.sh` | python3; браузерный тест — playwright (необязательно). Тестовый PIN `2468` — не настоящий |
| `ops_monitor/root_cmd_v4.txt`, `rollback_cmd_v4.txt` | команды установки и отката v4, которые уже выполнял Owner (sha установщика на сервере `ddf4eb69…`) | справочно | — |
| `parallel_v2/` | дизайн параллельных слотов: `DESIGN_RU.md`, `DECISIONS.md` (умолчания Owner), `ISOLATION_PLAN.md`, прототип `slots.py` | `python3 -m unittest test_slots` в папке (13) | реализация — PR #100 (не установлена) |
| `pm_v1/` | PM V1: поля `depends_on/locks/model/effort`, карта связей `pm_map.py`, план установки | `cd pm_v1 && python3 -m unittest test_pm_map` (18) | `autonomous_issues.py` — копия кандидата из PR #100 для тестов |
| `map_split/` | разрезка карты на задачи: `INDEX.md`, эталон **`MOCKUP_V001_owner.png`**, тела задач `bodies/` | читать | — |
| `map_split/bodies/` | `published_<Issue>_<id>` — точные опубликованные тела (#84–#101, сверены с GitHub); `prepared_M1f1..3` — готовые, **не опубликованы** (до публикации добавить раздел истории QA #94 и пройти codex-review); `draft_M0b_prereview` — черновик до ревью | эталон формата | — |
| `comment_templates/` | реальные служебные комментарии `GOBADMINTON_RESUME_V1` / `GOBADMINTON_PARK_V1` | образец: поменять `issue`, `head` (40 hex), `attempt` строго как в checkpoint | правила §2.3 runbook |
| `state/backlog_ru.json`, `state/titles_ru.json` | копии на 19.10 (живые лежат на сервере в `/var/lib/gb-ops-titles/`, их видно в мониторе) | схема — runbook §2.1 | — |
| `plans/postgame_plan_v2.md`, `plans/multislot_plan.md` | план «после игры» T0a–T10 и ранний план слотов | читать | — |
| `render.sh` | подстановка реальных значений в копию | см. «Окружение» | — |
| `BACKUP_NOTES_RU.md` | журнал резервного PM на время его дежурства | дописывать | — |

## Что сюда сознательно не вошло
- Рабочие прогоны `successor_loop/runs/*` и сырые QA-файлы `evidence/*` (объём и внутренние логи сервера). Формат виден по `successor_loop/tests/fixtures/`.
- Готовый однофайловый установщик монитора (base64-архив с реальными именами пользователей ОС). Вместо него `build_installer.sh`.
- `codex_review/vps.py`, `watch96.sh` (содержат адрес сервера и имена ключей), бэкапы `*.bak`.
- Копии старых `autonomous_issues.orig/patched.py` (дубли PR #100).
- `train_watch.md` (журнал рутины наблюдения с внутренними деталями). Суть рутины описана в runbook §2.1 и учениях §7.
- Аудит площадок (`venue_audit`) ещё идёт; результат появится отдельно после проверки Павлом.

## Проверка после изменений
```bash
bash issue_lint/run_tests.sh
python3 -m unittest discover -s successor_loop/tests
(cd ops_monitor && python3 -m unittest discover -s tests)
(cd parallel_v2 && python3 -m unittest test_slots)
(cd pm_v1 && python3 -m unittest test_pm_map)
bash codex_review/tests/test_validate.sh
```
