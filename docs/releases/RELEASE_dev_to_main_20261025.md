# Release candidate dev → main — 2026-10-25

Авторский candidate. Это не merge в `main`, не PROD deploy и не independent QA.

## Head

| Поле | Значение |
|---|---|
| Репозиторий | `anpavel84-afk/gobadminton-clean` |
| Ветка | `release/dev-to-main-20261025` |
| `dev` на старте | `0652efc2a2e5c349f7fd1d3683eca12461d955f2` |
| `main` на старте | `fafd45c6006005b1fb84753e5c40d8364500103a` |
| Merge-base | `30f24bae57123c3fdb53ceef94ec6bae71e4fcd0` |
| Расхождение на старте | `dev` 700 впереди, 23 позади |
| Merge commit | `23880c461681839b3309059ec0ecb551b5b94300` (родители: `dev`, затем `main`) |
| Code head до этой заметки | `e06a2364bb3b168868aa3bb7e8310c3cb964350f` |
| Release head | tip этой ветки: commit, который добавляет этот файл, родитель `e06a2364bb3b168868aa3bb7e8310c3cb964350f` |

Контроллер берёт SHA только так: `git rev-parse origin/release/dev-to-main-20261025`. Не проверять `dev` `0652efc` и не проверять `main` `fafd45c`. CI этого SHA на момент записи: **NOT_RUN**. Push ветки `release/*` не входит в триггеры Product CI. PR не открывался: его открывает контроллер.

## Правила, которые реально прочитаны

- EOM 1.4, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`, 113203 байт UTF-8. Локальный файл на `dev` и копия на `main` совпали с pin.
- SMART_ROUTING 1.0, тот же commit, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`, 76720 байт. Статус политики SR0; классификатор не установлен.
- Прочитаны `START_HERE.md`, `AGENTS.md`, канон §§7–8 и §10.3, capsules common+author, `AI_TRAIN_MASTER_PLAN.md`, `CURRENT.md`.
- Роль: release author/PM. Эффекты: ветка и push. Нет merge в `main`, нет deploy, нет серверов, нет секретов, нет PR.

## Конфликты

`git merge-tree` и реальный merge дали ровно три add/add конфликта. Остальные main-only файлы вошли без конфликта.

### 1. `.github/workflows/train-dispatch.yml`

Обе стороны добавили файл после merge-base.

- В merge commit `23880c4` исполнитель `dev` был сохранён (pin `41e12be2d551158e97ea30eaf8e95f992f998615`, `publish_phase_drafts`, `queue: single`), и поверх добавлены main-only `issue_comment` и `schedule: 17,47 * * * *`.
- Это ломает `scripts/chatops/tests/test_actions_train_phase_v2_workflows.py`: `test_no_second_scheduler_or_untrusted_webhook` запрещает в этом файле строки `issue_comment:` и `schedule:`.
- Исправление `e06a236` вернуло файл байт-в-байт к `dev` `0652efc`.
- Пробуждение с default branch и Owner admission не удалены: они уже лежат в main-only `.github/workflows/train-events.yml`, файл идентичен `main` (cron `7,22,37,52 * * * *`, маркеры `GOBADMINTON_AUTONOMY_V1`, `GOBADMINTON_RESUME_V1`, `GOBADMINTON_TRAIN_RECONCILE_V1`).
- Относительно сегодняшнего `main` пропадает отдельный cron `:17/:47` внутри `train-dispatch.yml` и его `queue: max`. Остаётся расписание `train-events.yml`.

### 2. `.github/workflows/train-stage.yml`

Взят `dev`. Pin `41e12be2d551158e97ea30eaf8e95f992f998615`, job `publish_recovery`, право `checks: read`. У `main` был более старый pin `d4567dfddbfc26d95236839343d841841067e72c` и не было `publish_recovery`. Уникального поведения `main` в этом файле нет.

### 3. `docs/ops/README.md`

Взят `dev`. Текст `main` — подмножество: на `dev` есть ещё строка про reference copy `monitor-live/README.md`. Ни одна фраза зеркала `main` не выброшена.

### Без конфликта, сохранено с `main`

- `docs/rules/ENGINEERING_OPERATING_MODEL.md`, `SMART_ROUTING.md`, `CONTEXT_SOURCES.json` — байты уже совпадали с `dev`.
- `.github/workflows/train-events.yml`
- `.github/workflows/train-attention.yml`
- `docs/workbench/actions-train-20261022/**` (evidence #158, включая `COMMISSIONING.md` и `ROLLBACK.md`)
- Зеркала документации #287 / #280 / #278 не конфликтовали: канон на обеих ветках один и тот же.

`apps/admin/public/fonts/Onest.woff2` есть на `main` и нет на `dev`. Это не main-only commit: общий предок уже содержал файл, `dev` заменил его в `a59eb7b` (Refs #46, ttf + provenance). Merge оставил удаление. Код приложения — сторона `dev`.

## Что увидит пользователь

Сейчас PROD соответствует `main` (схема до `0031`). В candidate входит продукт `dev` после этого предка. Admin-приложение этим PROD-путём не выкладывается.

- **Площадки.** Публичная карточка и лист: обложка, кредит обложки, публичные контакты, число кортов и удобства. Пустые поля остаются пустыми: миграции не заполняют старые строки. #296 ужесточает проверку исходного HTTP(S) authority у URL контакта, кредита и связанных полей; кривой URL, который раньше проходил, будет отвергнут.
- **Игры и карта.** Обложка игры, лист площадки, поведение карты и выбора площадки в consumer web. Это видимое изменение PROD web, не только API.
- **Профиль.** Своя обложка. В аккаунте есть ссылка «Друзья». На PROD друзья не включаются: `FRIENDS_INTERNAL_ENABLED` по умолчанию `0`, а значение `1` при `APP_ENV=prod` валит загрузку env. Страница должна показать недоступность, а не живой граф. Живой экран не проверялся.
- **Радар.** Существенный consumer-diff карты и радара. Отдельные DEV-флаги (`RADAR_DEV_*`) на PROD запрещены схемой env.
- **Admin.** Код admin есть в образе API, но workflow PROD не ставит admin-сервис и запрещает admin digest на prod. `ADMIN_*` dev-флаги на PROD не включаются.
- **Train/OPS.** На `main` впервые окажутся `ci.yml`, `dev-deploy.yml`, `prod-deploy.yml` и актуальные train workflow с `dev`. Это не новая пользовательская функция сайта.

## Миграции сверх `main`

На `main` последняя миграция — `0031_support_cases.sql`. Вперёд только:

| id | Суть | Разрушение данных |
|---|---|---|
| `0032_friendship_core` | таблицы друзей; `player_social_profiles.social_action_epoch NOT NULL DEFAULT 1`; триггеры на профиле и `users.status` | нет |
| `0033_owned_cover` | nullable cover на профиле; CHECK `content_moderation_approvals.surface_key` расширен, старые ключи сохранены | нет DROP данных |
| `0034_venue_cover` | nullable cover площадки + функция `venue_cover_url` | нет |
| `0035_game_cover` | nullable cover игры | нет |
| `0036_venue_contacts` | nullable телефон, сайт, заметка | нет |
| `0037_venue_cover_credit` | nullable кредит обложки | нет |
| `0038_public_venue_contacts` | nullable `public_contacts jsonb` | нет; rollback SQL нет |
| `0039_venue_public_profile` | nullable корты/удобства; BEFORE INSERT/UPDATE на всех записях `venues` | нет; rollback SQL нет |

`apps/api/migrations/rollback/` содержит SQL только для `0032`–`0037`. Каталог `rollback/` мигратор не применяет (`readdir` без рекурсии). В прямых миграциях нет `DROP TABLE`, `DROP COLUMN`, `DELETE` пользовательских строк и `TRUNCATE`.

P0 по разрушению схемы: **нет**.

Совместимость со схемой и процессом, которые сейчас на PROD (`main`, API до этих колонок):

- Новые колонки nullable либо с константным default. Старый INSERT/UPDATE, который не перечисляет новые колонки, должен пройти.
- Новые триггеры на `users`, `player_social_profiles`, `venues`, `games` начнут исполняться на старом API сразу после COMMIT соответствующей миграции. Ожидаемое поведение — доп. запись epoch/timestamp, не отказ. На копии PROD это **NOT_TESTED**.
- Новый API без этих объектов неживой: публичные выборки площадок в `apps/api/src/venues/venues.service.ts` читают `public_contacts`, `cover_credit_*` и `venue_cover_url()`. Поэтому миграция обязана выполниться до того, как новый API начнёт обслуживать трафик.
- `ALTER TABLE` берёт короткий `ACCESS EXCLUSIVE`. Это пауза, не потеря строк.

## Что происходит при merge в `main`

Merge в `main` **не выкладывает PROD** и **не гоняет миграции**.

Файлы `ci.yml`, `dev-deploy.yml`, `prod-deploy.yml` сейчас есть на `dev` и отсутствуют на `main`. После merge они появятся на `main`, но их триггеры такие:

| Workflow | Триггер | Эффект merge в `main` |
|---|---|---|
| Product CI `ci.yml` | `pull_request` в `main`/`dev`; push только `chatops/**`, `automation/**` | push merge-commit на `main` CI не запускает. CI будет на PR до merge |
| DEV deploy | push в `dev` | нет |
| PROD deploy | GitHub Release `published`, не prerelease | нет |
| Runner clean-root QA | push в `main` только при изменении `_automation/gobadminton-runner/**` или своего workflow | этот diff пути не трогает |
| Train events | в том числе push в `main` при изменении `.github/workflows/train-*.yml` | **да, побочный эффект.** Merge меняет `train-dispatch.yml` и `train-stage.yml`, job `wake` отправит один `workflow_dispatch` существующего dispatcher на ref `dev`. Моделей и SSH в этом job нет. PROD не трогает |

PROD deploy, когда его отдельно запустят публикацией release:

1. Actor обязан совпасть с repository variable `RELEASE_ACTOR`.
2. `scripts/chatops/prepare-prod.sh` требует: tag `vMAJOR.MINOR.PATCH`, не draft и не prerelease; SHA — предок `origin/main`; успешный workflow `DEV deploy` именно этого SHA на ветке `dev` (job `deploy` = success). Образы не пересобираются. Берётся artifact `dev-release`.
3. Нужен предыдущий PROD SHA: из последнего успешного prod-run либо variable `INITIAL_PROD_SHA`.
4. Job `qa` гоняет `scripts/chatops/ci.sh full` (foundation, contracts, typecheck, lint, unit, `db-ci.sh`).
5. Job `deploy` выполняется только если `vars.CHATOPS_PROD_COMMISSIONED == 'true'`.
6. Job сидит в GitHub Environment `prod`. Сейчас API `GET .../environments/prod` возвращает **404**. Environment `dev` есть, protection — только branch policy, required reviewers не видны. Список variables/secrets этой identity недоступен (HTTP 403). Живые значения не читались.
7. `scripts/chatops/deploy.sh prod` по SSH (`gb-deploy-prod`) ставит те же digest API и web. Admin digest на prod отвергается. Если задан `DEPLOY_WEB_HOST` и он отличается от `DEPLOY_HOST`, сначала API-хост, потом web-хост. Это не атомарная пара.
8. Серверный `gb-deploy-helper.sh` требует уже принятый baseline и root-файл `/etc/gobadminton/deploy/prod-owner-go.json`: точное совпадение release id, SHA, digest и `expected_previous_sha`, срок не дольше 24 часов. Файл не создаётся из репозитория и не создаётся SSH-ключом job.
9. Миграции: только если в `/etc/gobadminton/deploy/prod.conf` сервисный список содержит `api` и `MIGRATE=1`. Иначе в скрипте default `0`. В репозитории `MIGRATE=1` есть лишь в фикстуре `scripts/chatops/tests/test_helper.py`. Живой conf **не читался**. При `MIGRATE=1` helper делает `pg_dump -Fc` и запускает migrate-контейнер того же API-образа со штатным `DATABASE_URL` окружения. Потом поднимает `api` и `web`. Worker в список сервисов helper не входит и этим workflow не обновляется.
10. Smoke на runner, затем `accept`. Ошибка до accept шлёт `rollback` на уже задетые хосты. Rollback образов не откатывает SQL и не восстанавливает dump.

Новых обязательных секретов, чтобы процесс API поднялся со значениями по умолчанию, в схеме `apps/api/src/config/env.ts` нет. Новые флаги друзей, DEV-радара и DEV-admin на `APP_ENV=prod` либо default `0`, либо запрещены и не дают процессу стартовать. Обложки пишутся в уже существующий `AVATAR_MEDIA_ROOT`. Отдельного bucket/volume в этом candidate нет.

Пока этот tip не стоит на `dev` и DEV deploy этого SHA не зелёный, `prepare-prod.sh` release отклонит. Практический порядок для контроллера, без выполнения здесь: independent QA и Product CI этого tip → fast-forward `dev` на тот же SHA и зелёный DEV deploy → fast-forward `main` на тот же SHA → отдельный Owner GO-файл на сервере → GitHub Release не-prerelease тем actor, который задан в `RELEASE_ACTOR`.

## Откат

1. Не публиковать Release и не вызывать deploy, пока gates ниже не зелёные.
2. Если deploy уже начат и smoke/accept не прошёл, штатный путь — image rollback helper (`action: rollback`). Dump `pre-migration.dump` автоматически не восстанавливается. Так и должно оставаться, если после миграции уже были новые записи.
3. Откат образов на предыдущий PROD API при уже применённых `0032`–`0039` опирается на совместимость старого кода с новыми колонками и триггерами. Это ожидаемо по виду SQL и **не доказано** на копии PROD.
4. Ручной SQL rollback `0032`–`0037` существует и разрушает данные друзей и обложек. `0038` и `0039` такого файла не имеют. Запускать их только отдельным решением, когда записи остановлены.
5. Откат приложения не является откатом БД.

## Локальные проверки этого дерева

Node `24.21.0`, pnpm `10.18.0`, `pnpm install --frozen-lockfile`.

| Проверка | Результат |
|---|---|
| `python3 scripts/check_foundation.py` | PASS (286 Markdown, 168 draft API operations) |
| `pnpm run check:foundation` | FAIL локально: в скрипте вызван `python`, бинарника нет. На CI job foundation вызывает `python3`. Это не дефект candidate |
| `pnpm run check:contracts` | PASS, OpenAPI 3.1.1, 145 paths |
| typecheck contracts/api/web/admin | PASS |
| lint тех же пакетов | PASS |
| unit admin | PASS, 5 files / 35 tests |
| unit web | PASS, 102 files / 1037 tests |
| unit api | PASS, 38 files / 344 tests |
| unit contracts | PASS, тот же contract check |
| `pnpm run build` (api, web, admin) | PASS |
| `pnpm run build:worker` | PASS |
| `scripts/test_check_foundation.py`, `test_email_contract_policy.py` | PASS |
| `bash -n` scripts/chatops `*.sh` | PASS |
| `test_actions_train*.py` после `e06a236` | PASS, 622 tests, 1 skipped |
| `test_phase_*.py`, `test_autonomous_issues.py`, `test_ci_workflow.py`, `test_admin_deploy.py`, `test_admin_path.py`, `node --check smoke.mjs` | PASS |
| `sudo python3 scripts/chatops/tests/test_helper.py` | PASS, 21 tests |
| `scripts/chatops/db-ci.sh` и 55 integration-файлов API | **NOT_TESTED**: Docker и PostGIS в этой среде нет; `db-ci.sh` сам выходит вне GitHub Actions |
| Admin image build из CI (`docker build`) | **NOT_TESTED** |
| Визуальная проверка площадок 390/430 px по #296 | **NOT_TESTED** |
| Independent QA | не выполнялась и этой записью не заменяется |

До исправления `e06a236` train-набор падал одним тестом на втором scheduler. Других красных product-тестов локально не было.

## Go / no-go

**NO-GO** и на merge в `main` как на выпуск, и на PROD.

P0 — блокирует выпуск:

- Нет independent QA этого tip.
- Product CI этого SHA не запускался. Ветка сама CI не включает; нужен PR в `main` или `dev`.
- Этот SHA нет на `dev`, успешного DEV deploy этого SHA нет. Без него PROD promotion по `prepare-prod.sh` невозможна.
- GitHub Environment `prod` отсутствует (404). `CHATOPS_PROD_COMMISSIONED`, `RELEASE_ACTOR`, `INITIAL_PROD_SHA` этой identity не прочитаны (403). Даже при включённом флаге helper требует серверный `prod-owner-go.json`, его здесь нет.
- Живой `MIGRATE` в `/etc/gobadminton/deploy/prod.conf` неизвестен. Если это не `1`, новый API сломает публичные чтения площадок. Подтвердить до любого deploy, не из этой сессии.

P1:

- 55 integration/DB-проверок и admin image build локально не выполнялись. Их обязан закрыть CI `database` / admin docker, не эта заметка.
- Визуальная проверка площадок на 390 и 430 px для #296 не сделана.
- Деплой API и web при split-host не атомарен: возможное окно нового API со старым web или наоборот.
- Worker этим workflow не обновляется.
- У `0038` и `0039` нет rollback SQL. Откат после записей в эти колонки — отдельное решение, dump поверх новых writes нельзя.

P2:

- Ссылка «Друзья» видна в профиле, а сервис на PROD выключен и не должен включаться.
- Короткий lock на `ALTER TABLE`.
- После замены `train-dispatch.yml` пропадёт cron `:17/:47`. Пробуждение останется через `train-events.yml` (`:07/:22/:37/:52`). Merge в `main` один раз разбудит DEV dispatcher.
- Совместимость старого PROD API с новыми триггерами не прогнана на копии PROD.

P3:

- Этапы Master Plan 3–8 не DONE. Этот candidate их не закрывает и не объявляет runtime train установленным.
- `pnpm run check:foundation` красный только из-за отсутствия бинарника `python` в этой среде.

Следующий разрешённый шаг: контроллер открывает PR этой ветки, получает зелёный Product CI и отдельную independent QA на exact tip. Merge, Release и PROD — только после этого и отдельного подтверждения `MIGRATE=1` и Owner GO. Этот автор их не делает.
