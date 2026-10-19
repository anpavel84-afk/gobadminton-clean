# GoBadminton · LIVE STATE (живое состояние для резервного PM)

**Обновлено:** 19.10.2026 14:07 (Сан-Паулу, UTC-3), генератор `ops/grok-toolkit/sync_state.py`
**Активный оператор:** Grok (Go Bad) с 2026-10-17

> Генерируется автоматически. Руками правится только строка «Активный оператор» (протокол передачи: `docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md` §9). Секретов здесь нет. UNKNOWN ≠ 0.

## 1. Конвейер (исполнитель)

- Исполнитель: `active/running`, MainPID 1456 (время проверки — в строке «Обновлено»).
- Выполнено задач (`done_count`): **25**.
- Активная задача: **#108** NAV1: новые иконки нижнего меню (вариант B) — фаза `pr_wait`, попытка 1, head `687fa922`, PR —, QA None на `—`.
- Последняя выкатка DEV: `r39285408995-a1`, ACCEPTED, pending=False, source `6dd3972d`, завершена 19.10.2026 13:42 (Сан-Паулу).
- DEV `/v1/meta`: gitSha `6dd3972d`, apiVersion `0.19.0`.
- GitHub `dev` HEAD: `6dd3972d`.
- Сверка dev HEAD = DEV gitSha = квитанция: **совпадает**.

## 2. Следующие задачи и бэклог (топ-10, `backlog_ru.json`)

| # | id | Issue | Задача | Статус | Зависит от | Заметка |
|---|---|---|---|---|---|---|
| 1 | M6 | #106 | Подписи к фото площадок (источник: Фото/Логотип/Иллюстрация) | опубликована | — | взята исполнителем; фаза dev_wait; исключение п.7 ревью — владелец 19.10 |
| 2 | I1 | — | Импорт 20 фото площадок (DEV) | в планах | M6 | текст готов; публикуется после выкатки #106; затем команда для root |
| 3 | NAV1 | — | Новые иконки нижнего меню (вариант B) | в планах | — | макет вариант B; после фото |
| 4 | MAP-PERF1 | — | Предзагрузка карты и видимый загрузчик | в планах | — | кеш статики DEV уже включён отдельно |
| 5 | M2 | — | Тап по маркеру открывает карточку на карте | в планах | — | по макету; маркеры (M1f) отложены |
| 6 | V0 | — | Без вызова админки для гостей (убрать 401) | в планах | — | баг серой полосы / 401 |
| 7 | M3 | — | Шторка площадки на карте | в планах | M2 | по макету |
| 8 | M4 | — | Игры площадки в шторке | в планах | M3 | по макету |
| 9 | V3a | — | Контакты площадки: очистка и дата обновления | в планах | — | исключение п.7 ревью — владелец 19.10; первая из контактов |
| 10 | V1a | — | Профиль и контакты площадки в базе и API | в планах | — | исключение п.7 ревью — владелец 19.10 |

Всего в бэклоге не выполнено: 38.

## 3. Открытые PR и Issue (GitHub)

**PR:**
- #110 `automation/issue-108` → `dev` @ `687fa922`: Refs #108: autonomous source candidate
- #102 `ops/takeover-runbook-v1` → `dev` @ `эта ветка`: Docs: OPS takeover runbook V001 (docs-only, DO NOT MERGE yet)
- #100 `ops/parallel-slots-v1` → `dev` @ `750afb7c`: OPS: PARALLEL_SLOTS_V1 executor slots, lock registry, merge queue, budgets (NOT INSTALLED)
- #97 `automation/issue-96` → `dev` @ `765aebc2`: Refs #96: autonomous source candidate
- #95 `automation/issue-94` → `dev` @ `5cb76118`: Refs #94: autonomous source candidate
- #81 `ops/executor-park-v1-1` → `dev` @ `970e5a47`: OPS: executor PARK_V1.1 (park headless 'zero diff' task)
- #73 `docs/post-game-architecture-v001` → `dev` @ `193276ee`: Docs: утверждённые итоги игры, посещаемость, отзывы и исправления
- #44 `automation/next-route-validation-20261015` → `dev` @ `d0dd6097`: Refs #29 #37: narrowly support Next.js dynamic route paths
- #22 `chatops/github-actions-20261013` → `main` @ `c00a1e95`: ChatOps: hosted product CI and restricted DEV/PROD deployment foundation
- #21 `fix/clean-runner-issue-intake-20261013` → `main` @ `ca433bd3`: Clean Runner: authenticated Owner issue intake + task-scoped Codex execution
- #20 `feature/friends-s1-clean-source-20261013` → `main` @ `f98b1ed4`: Friends S1 #12: rebase historical API, additive schema and tests onto clean Git
- #19 `feature/radar-dev-real-map-20261013` → `main` @ `ed1ad372`: Radar #13: start real Germany DEV map with public venues and opt-in player pins
- #16 `owner/dev-tasks-friends-radar-avatars-20261013` → `main` @ `5ce49154`: Owner DEV task batch: Friends + local map + Radar + organizer avatars
- #10 `policy/owner-dev-first-prod-promotion-20261013` → `main` @ `bfeb3600`: Owner policy: immediate real DEV previews, selective proven PROD releases
- #9 `deploy/germany-full-dev-20261013` → `main` @ `67bed8d0`: Germany DEV Web+API+PostGIS live; PROD API alias with isolation and rollback
- #8 `governance/owner-standing-execution` → `main` @ `7de2c5db`: Policy: one Owner instruction = end-to-end execution; one-time server commissioning
- #7 `fix/p0-reverse-xhttp-lanes` → `main` @ `79e6291e`: P0 transport: isolated reverse-XHTTP lanes + mTLS keepalive (source candidate)

**Issue (открытые, номера ≥ 60):**
- #109: I1: импорт 20 фото площадок (DEV)
- #108: NAV1: новые иконки нижнего меню (вариант B)
- #106: M6: подпись источника обложки площадки (Фото / Логотип / Иллюстрация)
- #104: P1: заглушка обложки по типу игры вместо серого значка (корт / корт с ракеткой)
- #101: M0e: убрать непрозрачный слой над подложкой карты
- #98: M0c: ядро стабильности карты на iPhone (WebGL grace, маркеры, resize, сбои данных)
- #96: M0b: карта не должна пропадать на iPhone (жизненный цикл, лог, mapdebug)
- #94: M1d: состояния маркеров и разведение пересекающихся точек
- #92: M1e: преемник M1c — кнопка К списку и раскладка (реальный код, без fetch)
- #84: M0: восстановить подложку карты и честная ошибка
- #82: T0a-1: venue contact data + privacy-gated game read (API + contracts)
- #78: Narrow successor of #76: web lint fix and A1 test updates on top of the #76 candidate (Radar on the shared map)
- #69: Owner · VPS watchdog трейна без GPT и уведомления через SMTP
- #66: UAT · карта сжимается до 101px на коротком мобильном экране
- #64: Admin · полноценное редактирование площадок и управление обложками каталога
- #62: Owner UX · выделить вход «Все игры на карте» и предложить мобильное переключение
- #61: Owner UX · убрать россыпь площадок с числом игр под картой
- Старые открытые (< 60, нужен разбор Owner): #57, #54, #53, #52, #47, #46, #37, #36, #31, #30, #29, #28, #23, #15, #14, #13, #12, #6, #5, #4, #3, #2, #1

## 4. Рабочие потоки Grok (что в работе и где лежит)

| Поток | Состояние | Пути | Дальше |
|---|---|---|---|
| #104 заглушка обложки по типу игры (корт / корт с ракеткой) | done на DEV: 1b4c97be (теперь под 6dd3972d); проверено, Павлу дан вердикт «готово» | `apps/web/src/components/consumer/venues/VenueCover.tsx`; `apps/web/src/components/consumer/games/GameCover.tsx`; `apps/web/test/venue-cover.test.tsx` | закрыть поток |
| #106 M6: подпись источника обложки площадки (Фото / Логотип / Иллюстрация) | done на DEV: 6dd3972d ACCEPTED r39285408995-a1; done_count 25; ждёт браузерной проверки оператором | `box: /workspace/outputs/venue_images/m6/`; `apps/api/migrations/0037_venue_cover_credit.sql`; `apps/web/src/components/consumer/venues/VenueCoverCredit.tsx` | браузерная проверка подписи источника на карточках площадок; вердикт Павлу; затем I1 фото площадок (пересобрать на 6dd3972d) |
| #108 NAV1: новые иконки нижнего меню (вариант B, лаймовый круг у активного) | взята в работу 19.10 ~13:30; attempt 1/3, фаза pr_wait (автор сделал, ждём PR), база 6dd3972d | `box: /workspace/outputs/navicons/NAV1.final.body.txt`; `apps/web/src/components/consumer/NavIcon.tsx`; `apps/web/src/components/consumer/nav-icon-paths.tsx`; `apps/web/src/styles/foundation.css` | QA, CI, DEV-выкатка; затем браузерная проверка нижнего меню на мобильном экране и вердикт Павлу |
| #101 M0e: убрать непрозрачный слой над подложкой карты | done на DEV: 58d71ae3 (теперь под 1b4c97be); done_count 24; браузерная проверка карты могла ещё не закрыта | `ops/grok-toolkit/map_split/bodies/published_101_M0e.body.txt`; `box: /workspace/outputs/map_split/` | если вердикт по карте ещё не дан: сравнение с MOCKUP_V001_owner.png; иначе закрыть поток |
| PR #100 параллельные слоты (ops/parallel-slots-v1) | доделывается: QA, CI, установщик под одну root-команду | `ops/grok-toolkit/parallel_v2/`; `box: /workspace/outputs/parallel_slots_pr/` | установка только в окно idle и после «да» Павла; перед этим влить #81 |
| Аудит контактов и описаний площадок | идёт сбор (только чтение, вне очереди) | `box: /workspace/outputs/venue_audit/ (SUMMARY_RU.md, venues_audit.csv, venues_audit.json)` | таблица Павлу на проверку, затем задача в конвейер на добавление данных |
| PR #102 runbook передачи + grok-toolkit + drill | на ветке ops/takeover-runbook-v1, НЕ вливать (merge = DEV-деплой) | `docs/workbench/OPS_TAKEOVER_RUNBOOK_V001.md`; `docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md`; `ops/grok-toolkit/` | пробный подхват резервным PM без публикации |
| OPS-монитор v4 с «Бэклогом» | установлен и работает | `ops/grok-toolkit/ops_monitor/`; `сервер: /var/lib/gb-ops-titles/backlog_ru.json` | обновлять backlog_ru.json при каждой публикации или закрытии задачи |

Пути с префиксом `box:` лежат на рабочем компьютере Grok, а не в репозитории. Резервному PM они недоступны: опирайтесь на копии в `ops/grok-toolkit/`.

## 5. Открытые вопросы к Owner

- Ставить ли ops-задачу на предустановку пакетов в песочнице автора и QA (сейчас тесты и типизация реально проверяются только в CI).
- D4: источник фото площадок (M6).
- D1: показывать ли телефон площадки до создания игры.
- Файлы карты Санкт-Петербурга (M7).
- Окно простоя и «да» на установку слотов (перед этим влить #81).
- Старые Issue #1–#29, #69: закрыть или переписать.
- Выложить ли остальные рабочие инструменты Grok в репозиторий (сделано в PR #102 ops/grok-toolkit).

## 6. Последние решения Owner

- 19.10 08:46: «один писатель» — на ресурс, а не на проект; ограниченная параллельность независимых задач. 08:53: умолчания слотов приняты.
- 19.10: преемник обязан содержать раздел «Замечания QA предыдущих попыток», ревьюер это проверяет.
- 19.10: после каждой выкатки DEV OPS сам проверяет в браузере; Павлу только «готово, идите проверьте» или «не готово, вернула на доработку», без скриншотов.
- 19.10: аудит контактов площадок запускать сразу, вне очереди (только чтение).
- 19.10: резервный PM в ChatGPT по фразе «продолжи работы Грока»; один активный оператор; PR #102 не вливать.
- 19.10: handoff инвентаря агентов принят как факт; Codex 0.160.1 — единственный автор и QA.

## 7. Ссылки

- Runbook: [OPS_TAKEOVER_RUNBOOK_V001.md](../../docs/workbench/OPS_TAKEOVER_RUNBOOK_V001.md)
- Учения и протокол передачи: [OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md](../../docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md)
- Инструменты: [README_RU.md](README_RU.md)
- Заметки резервного PM (если были): [BACKUP_NOTES_RU.md](BACKUP_NOTES_RU.md)

