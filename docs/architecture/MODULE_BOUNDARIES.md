# Границы модулей и пакетов

Статус: **TECH_SELECTED**.

| Модуль | Владеет | Публичные use cases | Не имеет права |
|---|---|---|---|
| Identity | User, ExternalIdentity, Session, linking/deletion | authenticate, link/unlink, revoke, deletion request | Делать организатора по данным social profile |
| Profiles | PlayerProfile, level declaration | update own profile, read permitted participant view | Публиковать чужие private contacts |
| Organizers | Organizer, Membership, onboarding status | create personal organizer, authorize manager | Принимать деньги или считать места |
| Venues | Venue, адрес/координаты, каталог качества | select/suggest/approve venue | Представлять координаты как бронь корта |
| Sessions | Game, Participation, GameInvitation, attendance/outcome, share links | publish, request, confirm, reject, withdraw, cancel, invite, accept/decline/revoke invitation, close | Делить транзакцию capacity между внешними сервисами; считать pending invitation местом |
| Discovery | Public read model, фильтрация | search public games | Разрешать участие на основании cached availability |
| Communications | Inbox, delivery attempts, device endpoints | record/send notification | Менять статус заявки вследствие delivery receipt |
| Attribution | First/last touch, participation source snapshot | record touch, attribute committed event | Объявлять коммерческую новизну по UTM |
| Trust & Operations | Reports, moderation, audit access | suspend/hide through owner module, inspect audit | Прямо менять таблицы Sessions в обход его команд |
| Payments (future) | Order, attempt, refund, settlement, ledger | Явный будущий financial API | Существовать как boolean `game.paid` |

Все domain writes проходят через владельца модуля. Read-only SQL projection может соединять необходимые таблицы в одном backend, но описывается как projection, не копирует write-policy. Транзакционный orchestrator допускается только внутри явно объявленной local transaction; сетевые вызовы внутри неё запрещены.

## Пакеты

`packages/domain`: серверные pure policies/value objects, разложенные по bounded module; не свалка shared. `packages/contracts`: единственный wire-contract и event schemas. `packages/sdk`: генерируемый клиент, не копия backend. `packages/design-tokens`: только визуальные значения и их semantic names. `packages/tooling`: общие lint/test/config, не runtime secrets.

Клиенты могут импортировать contracts/sdk/tokens. Импорт `apps/api`, ORM, server domain, database URL или provider adapters в web-client/mobile запрещён. Web server renderer также не читает БД напрямую: использует API, чтобы не создавать обходные пути.

## События

В транзакции владельца записывается outbox: `eventId`, `type`, `schemaVersion`, `aggregateId`, `aggregateVersion`, `occurredAt`, `correlationId`, минимальный payload. Начальный набор: `game.published`, `game.cancelled`, `participation.requested`, `participation.confirmed`, `participation.withdrawn`, `game.outcome_recorded`.

Worker lease имеет expiry; после crash запись можно обработать снова. Consumer хранит dedupe key. Уведомления переоценивают актуальность состояния перед отправкой: запоздавшее confirmed-сообщение не должно скрывать уже отменённую игру. Event payload не содержит access tokens, телефонов или всей копии User.

Event log не является event sourcing: текущая реляционная модель — source of truth; audit/outbox служат другим задачам. Миграции событий и consumers поддерживают текущий и предыдущий format на период rollout.
