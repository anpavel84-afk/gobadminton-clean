# GoBadminton CLEAN — продолжение работы

**Дата этой навигации: 24.10.2026 (checkpoint на dev `2446bcc5`, вечер America/Sao_Paulo). Не новый допуск.** Перед действием сверить live состояние; закрытие чата не означает остановку процесса.

## Управляющая роль

Grok — единственный mutating/runtime PMA по [решению Owner #29 comment 6386401132](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6386401132). ChatGPT — Advisor; [отдельное поручение консолидации документации](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6387368356) ограничено документами и не передаёт runtime обратно. Будущее переключение действительно только по новому точному решению Owner, не по копии этого файла.

## Что читать

[START_HERE.md](../../START_HERE.md) → принятый полный [регламент](../rules/ENGINEERING_OPERATING_MODEL.md) 1.4 → принятая политика [SMART_ROUTING](../rules/SMART_ROUTING.md) (SR0; не установлена — SR1–SR6 NOT_STARTED, прежний FAIL-маршрут контроллера действует) → [Master Plan](../ops/AI_TRAIN_MASTER_PLAN.md) → текущие Issues/PR/Actions и доступные protected receipts. Сохранить роль, exact rules/source SHA, активного writer и незавершённые эффекты до любого нового запуска.

## Источники живого состояния

- [#29 Antigravity / commissioning](https://github.com/anpavel84-afk/gobadminton-clean/issues/29): записи PMA об установках ниже и Owner-пакет [comment 6390016416](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6390016416) (привязан к controller `7d3d6ca0…`). CI, source QA и установка не равны AGY READY; **Stage 3 NOT AGY READY**.
- [#248 OPS](https://github.com/anpavel84-afk/gobadminton-clean/issues/248) / [PR #269](https://github.com/anpavel84-afk/gobadminton-clean/pull/269): Stage 4 установлен (см. «Checkpoint» ниже). Сам PR #269 на GitHub остаётся Draft/OPEN: код вошёл в dev через release-ветку R′ (PR #288). Platform refusal прежнего reviewer не повторять другим каналом.
- [PR #273 Context Rollout](https://github.com/anpavel84-afk/gobadminton-clean/pull/273): source merged `c29604c2…`; scoped install выполнен (PR #290, dev `4031ab9e`), **NOT RUNTIME_VERIFIED**, Stage 5 не DONE. Читать актуальные записи, а не старые численные результаты из описания.
- [PR #294](https://github.com/anpavel84-afk/gobadminton-clean/pull/294) (Draft, не слит): путь Б Stage 3 — Antigravity на uid978 unix-правах + `no_new_privs` без отдельного профиля AppArmor. Проверять live head/CI/QA, а не эту строку.
- [#244 PARK/RESUME](https://github.com/anpavel84-afk/gobadminton-clean/issues/244), [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211), [#218](https://github.com/anpavel84-afk/gobadminton-clean/issues/218): следующие этапы по Master Plan.
- [#271](https://github.com/anpavel84-afk/gobadminton-clean/issues/271) / [PR #272](https://github.com/anpavel84-afk/gobadminton-clean/pull/272): сохранить работу и UNKNOWN; снятие карточки/occupancy не является приёмкой или разрешением нового продуктового запуска.

Проверенные на дату факты отделять от требующих read-back: [Grok record 6387013440](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6387013440) сообщает о scheduling-only reconciliation Slot1 gen66→67, неизменном исходном UNKNOWN и обновлении monitor snapshot. Не выводить из этой записи отсутствие всех возможных эффектов или готовность продукта.

## Checkpoint на dev `2446bcc5` (24.10.2026)

Источник каждого пункта указан в скобках. «Read-back» — значение перечитано из GitHub (Git/PR/Actions) при подготовке этого checkpoint. «Запись PMA» — значение взято из записи PMA в #29 или чата и **не** перечитано с VPS; это не проверенное доказательство runtime.

**Установлено на DEV VPS (guarded scoped install; запись PMA в #29, merge-коммиты в dev — read-back):**

| Что | Merge в dev | Запись PMA |
|---|---|---|
| #274 (OAuth/catalog preflight), controller `86801eb6…` | `a7538561` (PR #286) | [6388565044](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6388565044) |
| #269 (Stage 4, ref-only release R′) | `923625ca` (PR #288) | [6388959978](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6388959978) |
| #273 (Codex-role context, Stage 5 часть), controller `53ff2cc2…` | `4031ab9e` (PR #290) | [6389310436](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6389310436) |
| #292 (без vendor `--sandbox` у `run_command`), controller `7d3d6ca0…`, релиз `316a3c61…` | `2446bcc5` (PR #293) | [6389936383](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6389936383) |

- Read-back: `7d3d6ca0…` является предком dev `2446bcc5`; sha256 `.github/workflows/train-stage.yml` на dev = `80ee50f6b3138a098a885263670afd342772b3d906e54feebc41b5a35c82d715` (= `stage_workflow_sha256` в записи PMA о #292). PR #292 на GitHub отображается как MERGED (его коммиты вошли через #293); формулировка «закрыт как superseded» в [6389936383](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6389936383) неточна.
- Stage 4: два исходных критерия приёмки (отрицательный тест против ложного QA reuse и независимость двух слотов на установленном runtime) сняты решением Owner 24.10.2026 17:37 BRT (запись PMA) и **не являются проверенным доказательством**. Независимое ревью PR #269 на R `d30f0082…` — PASS WITH FINDINGS ([6388254819](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6388254819)); F3 (P2, не регрессия): consumers вне Python (sh/Makefile/Dockerfile/workflow yaml/package.json и др.) всё ещё могут давать `reusable=true`; F1 (P3) — нестрогий regex `test_[a-z0-9_]+`; F1/F3 остаются follow-up, не блокеры.
- Runtime pin правил по-прежнему EOM **1.3** (`38c34012…`): read-back в `context_policy.py` и `owner_package_admission.py` на dev. Переход кода на EOM 1.4 — отдельный reviewed code-pin, не выполнен.
- Все установки: model_calls 0, PROD не затронут (запись PMA).

**Stage 3 (Antigravity) — NOT AGY READY.**

- Owner-пакет [6390016416](https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6390016416) опубликован 24.10.2026 18:55 BRT, привязан к controller `7d3d6ca0…` (max 2 вызова, модель `claude-sonnet-5-5-medium`). Любая замена controller делает этот пакет непригодным и требует нового Owner-пакета.
- **НЕ ПРОВЕРЕНО (нет записи в #29/dev, только сообщение PMA в чате):** первый canary завершился ошибкой на PTY/pty-пути `run_command` и оставил в Slot2 незакрытую операцию (`957fbe33…`, ожидается scheduling-only reconcile gen 107→108). Не переигрывать UNKNOWN, не сбрасывать spend; сначала read-back состояния слотов.
- **НЕ ПРОВЕРЕНО (решения Owner в чате, не записаны в #29):** путь А (расширение AppArmor-профиля `gb-agy-runtime` для PTY) отменён; продолжается только путь Б — [PR #294](https://github.com/anpavel84-afk/gobadminton-clean/pull/294), Draft, head `f88a1e3d…`, не слит. Owner waiver (в теле PR): чтение/запись UID978 вне задачи принято Owner **как риск, не как доказанная безопасность**; global AppArmor и другие сервисы не трогать.
- PR #294 на момент checkpoint: CI 12 success / 2 in progress (read-back, возможно устарел); независимая QA на exact head — **не получена**; не слит, не установлен.
- Следующие шаги Stage 3 (каждый — по отдельному exact-sha допуску Owner): reconcile Slot2, host-скрипт выгрузки профиля, release и controller install, новый Owner-пакет, один canary, затем один независимый QA. До QA PASS Stage 3 не DONE.

**Параллельные ветки, не зависящие от Stage 3 (read-back на checkpoint):**

- [PR #289](https://github.com/anpavel84-afk/gobadminton-clean/pull/289): Draft, docs-only, база `923625ca` (устарела), job `receiver` красный. Охватывает только #274/#269; этот checkpoint его заменяет, #289 нужно пересоздать или закрыть по решению PMA.
- [PR #291](https://github.com/anpavel84-afk/gobadminton-clean/pull/291): Draft, монитор «читаемое состояние слотов + Работа вне слотов» (только отображение), head `7dc38064…`, CI 7/7 success; на VPS **не установлен**; для блока `pma_work` требуется отдельная защищённая установка и allow-list правка live `server.py`.
- [#284](https://github.com/anpavel84-afk/gobadminton-clean/issues/284): Open follow-up к #271 (класс URL-валидации в `VenueSheet.tsx`, `VenuePublicProfile.tsx`); по Issue требуется class-wide fix автора Cursor/Codex с негативными тестами, затем CI и независимый QA.
- [#271](https://github.com/anpavel84-afk/gobadminton-clean/issues/271): PR #272 слит; Issue Open, Slot1 хранит устаревший checkpoint (запись PMA: слот простаивает, active=#271 attempt 2). Любое освобождение — только sanctioned scheduling-only скриптом по отдельному допуску, не правкой файла.

## Полный передаточный snapshot

[Передача Grok 24.10.2026](2026-10-24_GOBADMINTON_GROK_PMA_HANDOFF_V001.md) ведёт к сохранённому точному снимку. В нём есть продуктовая очередь и старые candidate/status; это исторический контекст, не альтернативный канон. Последующие receipts имеют значение в своей области, но не создают новые права.

Текущий assignment/scope и budget читаются из проверенного допуска и журнала, не из summary. Два PMA не запускаются, чужая ветка не переписывается, неизвестная операция не повторяется.
