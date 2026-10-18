# Состояния, места и атомарность

Статус: **TECH_SELECTED**, product defaults v1. Canonical semantics для [API](../api/API_POLICY.md).

## Game

`draft → published → cancelled` либо `draft → published → completed`.

`draft` не виден каталогу. `published` означает запланированную игру, а не доказательство её проведения. `cancelled` терминален для данного экземпляра; восстановление — новая игра. `completed` устанавливается командой после окончания с явным `outcome=held|not_held`; автоматический cron не может объявить `held`. Данные исхода можно исправлять только audited correction, не тихим overwrite. Время окончания само по себе делает игру прошедшей в UI, но не добавляет attendance.

Опубликованную игру с заявками нельзя произвольно переносить по времени/месту или менять финансовые условия: MVP-default — отменить и создать новую либо отдельный будущий reconfirmation flow. Это защищает уже согласованный смысл. Текстовые исправления без изменения условий допустимы с version/audit.

## Participation

| Команда | Из | В | Actor / условие |
|---|---|---|---|
| initialize creator | нет записи | confirmed | Только create новой regular draft, создатель; одна транзакция Game/owner/seat/audit/outbox |
| request | нет записи | pending | Сам игрок; published; открыта запись; сейчас есть место |
| reapply | withdrawn | pending | Сам игрок; новая attempt/version; запись открыта |
| confirm | pending | confirmed | Менеджер данного Organizer; проверены capacity/время/актуальность |
| reject | pending | rejected | Менеджер данного Organizer; reason |
| withdraw | pending, confirmed | withdrawn | Сам игрок; до начала игры |
| remove | confirmed | removed | Менеджер; reason; до начала |
| cancel game | pending, confirmed | cancelled_by_game | Команда Game.cancel, одна транзакция |
| expire request | pending | expired | Worker/команда после deadline; повтор безопасен |

`rejected`, `removed`, `cancelled_by_game`, `expired` не превращаются автоматически обратно в pending. В пилоте нет waitlist и автоматического продвижения. Pending после заполнения игры остаётся нерешённой заявкой до отказа/expiry, а не «резервным местом».

Повтор request при уже активной заявке возвращает существующее состояние, не создаёт новую строку. Повтор успешно применённой команды с тем же idempotency key возвращает сохранённый результат только после проверки действующей авторизации.

## GameInvitation

Отдельный агрегат Sessions. Не Participation и не сообщение.

| Команда | Из | В | Actor / условие |
|---|---|---|---|
| create | нет pending | pending | Текущий authorized GameManager; published; запись открыта; PairFence; нет bilateral block |
| accept | pending | accepted | Invitee; Game `FOR UPDATE`; текущая вместимость/состояние; accepted Participation rules |
| decline | pending | declined | Invitee |
| revoke | pending | revoked | Текущий authorized GameManager |
| expire | pending | expired | Worker или on-read после TTL / deadline |
| cancel game | pending | cancelled_by_game | Та же транзакция Game.cancel |

Pending invitation **не** расходует capacity (INV-03). Accept проигравшего последнее место получает `409 GAME_FULL`; invitation остаётся pending до expiry/decline/revoke. Block/revoke/cancel/expiry закрываются fail-closed. Duplicate/replay идемпотентен.

Accept связывает `participationId` только после успешного confirm. UI не должен сливать invitation status и Participation status, если переход участия не состоялся.

## Инварианты

- INV-01: `capacity > 0`; `externalReservedCount >= 0`.
- INV-02: `confirmedCount + externalReservedCount <= capacity`.
- INV-03: `availablePlaces = capacity - externalReservedCount - confirmedCount`; pending не расходует capacity.
- INV-04: не более одной текущей Participation на `(gameId,userId)`; переходы/attempts сохраняются отдельно.
- INV-05: изменение статуса, audit и outbox атомарны; notification delivery — после commit.
- INV-06: обычный confirmation разрешён только published-игре до `applicationDeadlineAt`, не позже startsAt. Единственное исключение — начальное confirmed-место создателя новой regular draft внутри create-транзакции (FB01 014). Не разрешает confirm заявок/приглашений в draft.
- INV-07: посещение, подтверждение места и оплата — разные сущности/факты.
- INV-08: share link не даёт organizer/admin authority.
- INV-09: revoked membership не остаётся разрешением из клиентского кеша или старой role claim.

## Транзакционный протокол

Обычная isolation — READ COMMITTED. Любая команда, затрагивающая места, заявку, deadline, capacity, external count или отмену, блокирует **строку Game `FOR UPDATE`** до Participation/dependents. Затем читает актуальные Participation и membership, проверяет инварианты, меняет данные и записывает audit/outbox в одной транзакции. Authorize-check и снятие membership координируются lock/transaction policy: нельзя проверять только до начала транзакции.

Относительный порядок для Game-touching commands (S-00A):

`idempotency reservation / actor+session fence → Game FOR UPDATE → game_managers when required → Participation / GameInvitation (and other dependents) → transition/outbox/receipt completion`

Для команд только с `participationId` допускается unlocked pre-read immutable `game_id`, затем lock Game, затем re-read/lock Participation с проверкой identity/state. Pre-read не является authorization. Identity/session и idempotency fences могут предшествовать Game; их взаимный порядок одинаков у всех callers. Процедура revoke membership (включая test helper) использует Game fence. DB calls ограничены timeout; сеть и ожидание пользователя внутри транзакции запрещены. Параллельные confirmations последнего места сериализуются на Game; проигравший получает `409 GAME_FULL`.

Счётчик confirmed вычисляется внутри заблокированной агрегатной транзакции из строк с индексом `(game_id,status)`. Кешированные counters допустимы позднее только как проверяемая оптимизация. Cache/read replica никогда не источник решения о последнем месте.

Отмена игры переводит активные Participation и записывает соответствующие события в той же транзакции. Конкурирующий confirm либо успевает раньше и затем отменяется, либо видит cancelled и отклоняется. Нет допустимого конечного состояния «confirmed в cancelled game».

Capacity нельзя уменьшить ниже занятого количества. Перевод внешнего участника в платформенного требует атомарной команды `reconcileExternalSeat`; до её реализации нет автоматического объединения и нельзя сначала confirm, а потом уменьшать external count.

Основание для lock semantics: [S04](../reference/SOURCES.md). Псевдоалгоритм — проектное решение, не готовая функция; обязательны реальные конкурентные тесты.

## FB01 013/014 — source candidate

Новая regular draft получает ровно одну реальную confirmed Participation создателя. Publish/replay не создают и не восстанавливают место. Trainer-led и исторические игры не получают backfill. External count относится к другим людям, `1 + externalReservedCount <= capacity` проверяется при regular create. Withdraw/remove/cancel меняют реальную строку; management authority остаётся отдельной. Active participation возвращается request до проверки GAME_FULL, после текущих version/lifecycle/time gates.

Приватный contact default принадлежит Profiles: explicit save-on-create выполняется после Game/manager/Participation в той же транзакции. Preference-only PATCH не блокирует Game. Deletion_pending очищает default и увеличивает version под account fence. Новый API не активирует удаление аккаунта как продуктовую функцию. См. [ADR-0012](../decisions/ADR-0012-GAME-CONTACT-CREATOR-SEAT.md), source candidate pending independent QA.

## Post-game invariants · ADR-0018

[Подробные переходы и locks](../architecture/POST_GAME_V001.md).
- PG-INV-01: отсутствие attendance/outcome = unknown; никакого inferred held/no-show.
- PG-INV-02: outcome/attendance не меняют seats/Participation; cancelled не reopening через outcome.
- PG-INV-03: absent только expected-at-start после endsAt, не canceled/not_held; подтверждение места не доказательство прихода.
- PG-INV-04: mutation + revision + durable own notice атомарны; same-key replay не повторяет эффект.
- PG-INV-05: silence/timeout/correction автором не закрывают open dispute автоматически; acknowledgement привязан к версии.
- PG-INV-06: собственная история/оспаривание не зависит от chat/block/current confirmed status.
- PG-INV-07: manager не может лишить подачи feedback посредством absent; provenance contested, не verified.
- PG-INV-08: один review на author/subject/game/kind, один reply; no self-review, no auto skill/reputation effects.
- PG-INV-09: пакет present содержит exact подтверждённые IDs+versions и применяется целиком.
Post-game authority — действующий GameManager; старые generic OrganizerMembership формулировки не использовать для этого сценария. Численные окна 30m/72h/7d не стали утверждёнными cutoff.
