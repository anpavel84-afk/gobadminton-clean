# GoBadminton · LIVE STATE (живое состояние для резервного PM)

**Обновлено:** 20.10.2026 07:50 (Сан-Паулу, UTC-3), генератор `ops/grok-toolkit/sync_state.py`
**Активный оператор:** ChatGPT PM с 26.10.2026 11:08 (Сан-Паулу) — по слову Owner «продолжи работы Грока»

> Генерируется автоматически. Руками правится только строка «Активный оператор» (протокол передачи: `docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md` §9). Секретов здесь нет. UNKNOWN ≠ 0.

## 1. Конвейер (исполнитель)

- Исполнитель: `active/running`, MainPID 1438948 (время проверки — в строке «Обновлено»).
- Выполнено задач (`done_count`): **29**.
- Активная задача: **#127** M3 v8: развёрнутый попап площадки поверх карты (преемник #117) — фаза `blocked`, попытка 2, head `ae4df3f6`, PR #128, QA PASS на `ae4df3f6`, причина: Actions failed, resume_phase: ci.
- Последняя выкатка DEV: `r39354396521-a1`, ACCEPTED, pending=False, source `42e87d30`, завершена 19.10.2026 22:40 (Сан-Паулу).
- DEV `/v1/meta`: gitSha `42e87d30`, apiVersion `0.19.0`.
- GitHub `dev` HEAD: `bce61bcc`.
- Сверка dev HEAD = DEV gitSha = квитанция: **НЕ совпадает, разобрать**.

## 2. Следующие задачи и бэклог (топ-10, `backlog_ru.json`)

| # | id | Issue | Задача | Статус | Зависит от | Заметка |
|---|---|---|---|---|---|---|
| 1 | M6 | #106 | Подписи к фото площадок (источник: Фото/Логотип/Иллюстрация) | опубликована | — | #106: текущую работу не менять; DEV и приёмку не переобъявлять. |
| 2 | I1 | #109 | Импорт 20 фото площадок (DEV) | опубликована | M6 | #109: текущий импорт не менять; код и выполнение оператором остаются отдельными фактами. |
| 3 | NAV1 | #108 | Новые иконки нижнего меню (вариант B) | опубликована | — | #108: по владельцу уже на DEV. Сохранить результат; NAV1b исправляет только волан. |
| 4 | M3 | — | Площадка и её игры: единый попап поверх карты | в планах | M2 | Первая после #112; включает весь M4. Маркер выбирает компактную карточку; её тап/стрелка открывает попап. Игру тоже открывать поверх карты. |
| 5 | M2 | #112 | M2: тап по маркеру — карточка поверх карты, без перехода | опубликована | — | #112: по владельцу уже на DEV. Сохранить компактную карточку. Checkout старше текущего dev; реализация #112 здесь не подтверждена. |
| 6 | M2R | — | Радар: карточка игрока и ближайшие игры поверх карты | в планах | M3 | Объединить с M2R-G: один результат, включая API, web и проверки приватности. Не выпускать промежуточный попап с последующей переделкой блока игр. |
| 7 | MAP-FILTER | — | Фильтры карты и согласованные маркеры | в планах | M3, M2R | Добавить отсутствующую запись по имеющемуся брифу. Включить M1f; окончательное оформление маркеров принадлежит этой задаче. |
| 8 | MAP-PERF1 | — | Предзагрузка карты и видимый загрузчик | в планах | MAP-FILTER | Предзагрузка и видимый скелетон без изменения фильтра и попапов. В текущем общем компоненте статус загрузки скрыт визуально; серверный кеш не заменяет клиентскую работу. |
| 9 | V0 | — | Без вызова админки для гостей (убрать 401) | в планах | M3 | Последняя активная задача карты, перед навигацией. Устранить административный запрос гостя на публичных поверхностях, включая отдельную страницу площадки; 401 не маскировать. Источник найден в VenueCoverEditor. |
| 10 | NAV1b | — | Перерисовать иконку волана в меню | в планах | NAV1 | Только геометрия волана варианта B; размер, цвета и остальные иконки сохраняются. Отдельный shuttlecockElement карты попутно не менять. |

Всего в бэклоге не выполнено: 48.

## 3. Открытые PR и Issue (GitHub)

**PR:**
- #120 `automation/issue-117` → `dev` @ `5c38adec`: Refs #117: autonomous source candidate
- #102 `ops/takeover-runbook-v1` → `dev` @ `эта ветка`: Docs: OPS takeover runbook V001 (docs-only, DO NOT MERGE yet)
- #100 `ops/parallel-slots-v1` → `dev` @ `3e5f5b89`: OPS: PARALLEL_SLOTS_V1 executor slots, lock registry, merge queue, budgets (NOT INSTALLED)
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
- #127: M3 v8: развёрнутый попап площадки поверх карты (преемник #117)
- #117: M3: развёрнутый попап площадки поверх карты (стрелка вверх, без переходов)
- #114: V0: без вызова админки для гостей (убрать 401) на карте, в попапе и на странице площадки
- #112: M2: тап по маркеру — карточка поверх карты, без перехода
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
| #109 I1: импорт 20 фото площадок (DEV, CLI оператора) | done на DEV: f0168eac ACCEPTED r39299797649-a1; done_count 27; ждёт root-импорта фото и браузерной проверки | `box: /workspace/outputs/venue_images/batch1/`; `apps/api/src/venues/venue-cover-import.ts`; `apps/api/src/database/import-venue-covers.ts` | дать Павлу root-команду импорта (batch1/ROOT_COMMAND.txt), затем проверка обложек площадок в браузере |
| #104 заглушка обложки по типу игры (корт / корт с ракеткой) | done на DEV: 1b4c97be (теперь под 6dd3972d); проверено, Павлу дан вердикт «готово» | `apps/web/src/components/consumer/venues/VenueCover.tsx`; `apps/web/src/components/consumer/games/GameCover.tsx`; `apps/web/test/venue-cover.test.tsx` | закрыть поток |
| #106 M6: подпись источника обложки площадки (Фото / Логотип / Иллюстрация) | done на DEV: 6dd3972d ACCEPTED r39285408995-a1; done_count 25; ждёт браузерной проверки оператором | `box: /workspace/outputs/venue_images/m6/`; `apps/api/migrations/0037_venue_cover_credit.sql`; `apps/web/src/components/consumer/venues/VenueCoverCredit.tsx` | браузерная проверка подписи источника на карточках площадок; вердикт Павлу; затем I1 фото площадок (пересобрать на 6dd3972d) |
| #108 NAV1: новые иконки нижнего меню (вариант B, лаймовый круг у активного) | done на DEV: 687fa922 ACCEPTED r39293031333-a1; done_count 26; ждёт браузерной проверки оператором | `box: /workspace/outputs/navicons/NAV1.final.body.txt`; `apps/web/src/components/consumer/NavIcon.tsx`; `apps/web/src/components/consumer/nav-icon-paths.tsx`; `apps/web/src/styles/foundation.css` | браузерная проверка нижнего меню на мобильном экране; вердикт Павлу; затем M2 по плану (после MAP-PERF1) |
| #101 M0e: убрать непрозрачный слой над подложкой карты | done на DEV: 58d71ae3 (теперь под 1b4c97be); done_count 24; браузерная проверка карты могла ещё не закрыта | `ops/grok-toolkit/map_split/bodies/published_101_M0e.body.txt`; `box: /workspace/outputs/map_split/` | если вердикт по карте ещё не дан: сравнение с MOCKUP_V001_owner.png; иначе закрыть поток |
| PR #100 параллельные слоты (ops/parallel-slots-v1) | доделывается: QA, CI, установщик под одну root-команду | `ops/grok-toolkit/parallel_v2/`; `box: /workspace/outputs/parallel_slots_pr/` | установка только в окно idle и после «да» Павла; перед этим влить #81 |
| Аудит контактов и описаний площадок | идёт сбор (только чтение, вне очереди) | `box: /workspace/outputs/venue_audit/ (SUMMARY_RU.md, venues_audit.csv, venues_audit.json)` | таблица Павлу на проверку, затем задача в конвейер на добавление данных |
| PR #102 runbook передачи + grok-toolkit + drill | на ветке ops/takeover-runbook-v1, НЕ вливать (merge = DEV-деплой) | `docs/workbench/OPS_TAKEOVER_RUNBOOK_V001.md`; `docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md`; `ops/grok-toolkit/` | пробный подхват резервным PM без публикации |
| OPS-монитор v4 с «Бэклогом» | установлен и работает | `ops/grok-toolkit/ops_monitor/`; `сервер: /var/lib/gb-ops-titles/backlog_ru.json` | обновлять backlog_ru.json при каждой публикации или закрытии задачи |
| #112 M2: тап по маркеру — карточка площадки поверх карты, без перехода | done на DEV: b85f3280 ACCEPTED r39312413798-a1; done_count 28; ждёт браузерной проверки оператором | `apps/web/src/components/consumer/games/GamesMapView.tsx`; `apps/web/src/components/consumer/games/VenuePreviewCard.tsx`; `apps/web/src/styles/venue-popup.css` | браузерная проверка карточки площадки поверх карты (сравнить с макетом); вердикт Павлу; затем M3 единая шторка |
| #114 V0: без вызова админки для гостей (убрать 401) на карте, в попапе и на странице площадки | влита в dev (50014405, attempt 1), выложена на DEV под b2cd0f03 r39349599843-a1 ACCEPTED; done_count 29 | `apps/web/src/components/consumer/venues/VenuePage.tsx`; `apps/web/test/venue-public-access.test.tsx`; `apps/web/test/venue-public-boundary.test.ts` | проверить в браузере как гость: карта, попап и страница площадки без 401; дать Павлу вердикт |
| #127 M3 v8: развёрнутый попап площадки поверх карты (преемник #117) | blocked после CI: PR #128, head ae4df3f6, attempt 2/3, QA PASS, CI source (web) упал (3 vitest-теста: старый тест навигации на страницу площадки и 2 теста фокус-ловушки Tab). RESUME ci_fix опубликован 01:40Z | `box: /workspace/outputs/map_split/popup/`; `apps/web/src/components/consumer/games/VenueSheet.tsx` | ждать, что исполнитель подхватит RESUME; если снова провал или нет прогресса >40 мин — Codex переписывает тело, PARK + преемник с max_attempts 6 |

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

