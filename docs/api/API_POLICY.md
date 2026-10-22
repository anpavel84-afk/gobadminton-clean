# API policy v1

Статус: **TECH_SELECTED**; [OpenAPI 0.1.0](../../packages/contracts/openapi.json) — **DESIGN_DRAFT**, не опубликованный работающий API. Стандарт OpenAPI 3.1.1 выбран для совместимости tooling [S14](../reference/SOURCES.md).

## Transport и контракты

HTTPS, REST/JSON, `/v1`. UTF-8, ISO8601 instants, UUID resource IDs, explicit IANA timezone, точные денежные строки. Request schemas запрещают неизвестные поля; response clients терпимы к совместимым добавлениям. DTO — разрешённая projection, не сериализация ORM entity. Public Game DTO не содержит applicant roster, identities или private contacts.

`packages/contracts/openapi.json` — первичный wire-contract. SDK генерируется; ручные типы/Swagger-декораторы не должны стать вторым несовпадающим источником. Перед реализацией endpoint: schema validation, примеры success/error, security, pagination, idempotency и contract tests. Ajv/генератор и их exact versions проверяются в F-01; текущий stdlib check не заменяет полноценный OpenAPI validator.

## Authentication

Consumer cookie `__Host-gb_session` либо bearer application token; при одновременном противоречивом credential наборе запрос отвергается, не выбирается наиболее привилегированный. Cookie mutations требуют `X-CSRF-Token` и проверенного Origin; OpenAPI отмечает этот header optional только потому, что bearer mobile не использует CSRF cookie flow. Нельзя трактовать optional header как отключение CSRF для web.

Public paths имеют `security: []`. Получение Game допускает optional authentication, но доступ к draft/unlisted определяется сервером: anonymous unlisted требует действующего `X-Game-Share-Token`, draft — manager. Такой header не даёт доступ к applicants. Для unlisted/private requests — no-store и редактирование журналов, token не в analytics.

Провайдеры в `/auth/providers` — capability allowlist, сейчас только VK/Яндекс. Полный auth start/callback/native exchange/link/refresh/deletion wire-contract доводится в F-02; его security semantics уже описаны в [AUTH](../integrations/AUTH.md). OpenAPI не выдаёт incomplete OAuth draft за реализованный вход.

## Команды, повтор и конкуренция

Все бизнес-mutations требуют `Idempotency-Key` 16–128 символов. Scope записи — actor + operation + key; hash normalized payload (включая target resource identity) исключает reuse с другим содержимым. TTL default 24 часа.

### Bounded Foundation scanner exceptions — Clean issue #23 (2026-10-14)

Provenance: Owner direct source-only assignment for
[Clean issue #23](https://github.com/anpavel84-afk/gobadminton-clean/issues/23),
base `f0b085c9c0608c29bc5c0410fe5908576ab629df`; the declarations already exist
in `packages/contracts/openapi.json` at that revision. This records scanner scope,
not a new implementation, independent QA, release approval or PROD authorization.

Only `POST /admin/auth/{provider}/start`, `POST /admin/auth/webauthn/options`
and `POST /admin/auth/webauthn/verify` may omit Idempotency-Key in this check:
they use the existing `x-auth-challenge-protocol: admin-bound-single-use-v1`
proof ceremony rather than a replayable business-command receipt. The exemption
requires the exact route and marker plus required string `Origin` with the existing
`Exact isolated ADMIN_ORIGIN; consumer origins rejected.` declaration. OpenAPI
has no literal Origin value here; actual Origin validation remains a runtime duty.
Start requires explicit `security: []` and retains declared CSRF behavior.
Options/verify require explicit OR alternatives `AdminSessionCookie: []` and
`AdminMfaTicket: []`, bound respectively to apiKey cookies
`__Host-gb_admin_session` and `__Host-gb_admin_mfa`, and required `X-CSRF-Token`.
Wrong/missing declarations invalidate the exemption; the marker alone grants none.
Required command-body and existing security checks remain in force.

Only bodyless `DELETE /me/linked-providers/{provider}`,
`DELETE /me/sessions/{sessionId}` and `DELETE /me/avatar` may omit requestBody:
the target is identified by the route/current actor (avatar also declares the
profile-version header), so an artificial command body is unnecessary. Their
Idempotency-Key and declared CSRF checks remain blocking. A supplied requestBody
must still be required; other POST/PUT/PATCH/DELETE body rules remain unchanged.
### Identity/session first implementation slice — Clean issue #23

Owner direct source-only assignment, exact base
`55e3775cc284e4266f1537052e9a3260a73b79ef`. The frozen admin exceptions above
were unchanged by this first slice. Avatar still had two blocking key findings at that stage; the subsequent isolated avatar source candidate is described below.

`POST /me/linked-providers/{provider}/link` is OAuth initiation, not a replayable
business command. Its sole scanner exemption requires this exact POST route,
`x-auth-challenge-protocol: consumer-oauth-link-bound-single-use-v1`, required
string `Origin` with the exact `requireCookieMutation` declaration, required
string `X-CSRF-Token`, explicit `security: [{cookieSession: []}]`, and an apiKey
cookie scheme named `__Host-gb_session`. Removing/altering those bindings restores
the key finding. The marker is contract metadata, not a runtime request header.
No other business route inherits this exemption.

Actual runtime: `ConsumerAuthService.requireCookieMutation` rejects bearer
credentials, missing/disallowed Origin, missing/invalid session-bound CSRF, and
missing/revoked/expired/inactive cookie sessions. Initiation creates fresh random
state and PKCE, hashes state/browser binding, encrypts the verifier, and stores
`purpose=link`, exact user/session IDs and expiry in `auth_transactions`. It sets
the HttpOnly auth-binding cookie and returns a no-store authorization URL.
The callback requires the matching browser binding, provider and unexpired state;
`consume` locks the transaction and marks it consumed exactly once. It then
requires the same active user/session cookie before provider exchange/linking;
`linkIdentityToUser` retains its actor/session and recent-auth checks. Provider
identity/email collision never merges accounts.

Limitations: every initiation is fresh, including retries with the same
Idempotency-Key (the header is ignored here). Concurrent starts replace the
browser's binding cookie; an earlier URL then requires its original cookie.
The state is consumed before exact-session validation and provider exchange;
a subsequent mismatch/provider failure requires a new initiation. Consumption
and external exchange are separate operations, not an atomic business receipt.
Start checks session/CSRF at the HTTP edge, not under MutationRunner's fence;
callback linking revalidates the actor under the existing SQL locks. Runtime
retains legacy optional body/query returnPath fallback, while OpenAPI declares
its normal JSON command body. Callback GET does not require mutation Origin/CSRF;
it uses one-time state, browser binding, exact session and PKCE instead. Never
store/replay OAuth URLs, provider tokens or session credentials as success receipts.

`DELETE /me/linked-providers/{provider}` and `DELETE /me/sessions/{sessionId}`
require a real 16–128 character key via `IdempotencyService.requireKey` (400
`IDEMPOTENCY_KEY_INVALID` after cookie authorization). Both contracts declare
required key, Origin and CSRF with cookie-only security and no request body.
The existing global MutationRunner owns the only transaction: actor/session
fence before reservation/replay, insert-first reservation, client-bound mutation,
response projection on that same client, completed receipt, COMMIT. Failure
rolls back effects and receipt together; existing standalone service helpers
retain their own transaction for other callers.

Unlink uses operation `identity.provider.unlink` and hash `{provider}`. Its
own-provider replay authority is the currently fenced actor, actor-scoped receipt,
exact target hash and the existing `lockAuthActor(..., recent=true)` policy.
A removed provider need not exist on replay; a subsequently relinked identity
is not deleted again. Execution retains locked usable OAuth/email method counting,
`PROVIDER_NOT_LINKED`, `LAST_AUTH_METHOD` and recent-auth protections.

Revoke uses `identity.session.revoke` and hash `{sessionId,currentSessionId}`;
the invoking session is included because the response has session-relative
`current` flags. Execution and replay reject the current session and lock/check
the target's owner and consumer audience, including an already revoked target.
Execution revokes the target and deletes its radar presence atomically before
reading active sessions. Changed target (or invoking session) with the same key
returns 409 `IDEMPOTENCY_KEY_REUSED`. Authorized duplicates return the original
200/status list snapshot, which may be stale; fetch the GET list for current state.
Revoked/expired sessions or inactive actors cannot obtain a cached success.
The web apiFetch already supplies a fresh key per non-GET call and preserves an
explicit key; separate calls are separate commands unless the caller retains it.

Verification: dependency-free `python3 -B scripts/test_check_foundation.py` and
`python3 -B scripts/check_foundation.py`; the latter showed exactly two avatar key findings at the first-slice commit.
The follow-up avatar source candidate must instead achieve full Foundation PASS.
Integration/security tests use only the existing disposable PostGIS harness.
Source-only results do not establish independent QA, deployment or Owner acceptance.

### Avatar PUT/DELETE source follow-up — issue #23 (awaiting independent QA)

The proposed source-only avatar implementation in
[the exact handoff](../handoffs/ISSUE23_AVATAR_IDEMPOTENCY_SOURCE_20261014.md)
requires the existing 16–128-character Idempotency-Key on both PUT and DELETE,
alongside the explicitly required cookie session, Origin, CSRF and the
X-Profile-Version optimistic concurrency guard. Both
OpenAPI mutations reference the same required key definition. DELETE keeps
its valid bodyless wire format; PUT keeps its original binary image body.
A single receipt operation binds action, user, expected profile version, MIME
and original-upload SHA256, preventing the same key from silently changing
the command. Actor/session authorization precedes all cached replays.

Existing moderation and disk staging remain outside the actor-locked write
transaction; the authoritative profile/version mutation and completed receipt
commit in one DB transaction. Losing staging artifacts are held in the existing
media GC journal and never deleted if they remain referenced. This is a
candidate implementation pending hosted integration and independent QA;
it does not authorize DEV or PROD release or attest to runtime behavior.

Протокол идемпотентности (S-00A / ADR-SOCIAL-003): в одной бизнес-транзакции сначала insert-first UNIQUE reservation (`reservation_state=processing`), затем авторизация и команда, затем `completed` receipt перед COMMIT. ROLLBACK снимает reservation вместе с эффектами. Параллельный waiter блокируется на UNIQUE; после commit победителя читает completed receipt. Timeout ожидания → `409 COMMAND_IN_PROGRESS` с `Retry-After` (не raw unique-violation 500). Same key / другое тело → `409 IDEMPOTENCY_KEY_REUSED`. Same key / то же тело → сохранённый status/body только после **текущей** actor/resource authorization. Отозванный менеджер/неактивный аккаунт не получает cached private success. TTL cleanup удаляет только expired `completed`, не active `processing`. До 3 технических DB-retry (deadlock/transient) с тем же ключом; business conflicts (capacity/version/authz) не ретраятся.

`expectedVersion` относится к изменяемому ресурсу. Game version увеличивается при изменениях агрегата, включая изменение занятых мест (`pending→confirmed`, `confirmed→withdrawn/removed`, publish/cancel и прочие state/terms changes); pending-only request/reapply/reject/expire **не** увеличивают Game.version. Participation имеет отдельную version. Для новой заявки `expectedGameVersion` привязывает согласие к прочитанному Game snapshot. При stale version — `409 VERSION_CONFLICT`, получить свежие данные и явно повторить, не молча согласиться с новыми условиями. Confirm проверяет Participation version и текущую Game capacity в одной транзакции; required `expectedGameVersion` в confirm body **не** добавляется. Семантический diff условий может позднее получить отдельную revision через ADR.

Authenticated mutations дополнительно держат in-transaction fence: `User.status=active` + действующая consumer session до COMMIT. Edge `/me` и cookie session lookup отвергают inactive/disabled/`deletion_pending`.

`POST /games/{gameId}/participations` возвращает 201 при новой attempt и 200 для уже активной заявки; одинаковый idempotency key воспроизводит первоначальный status/body. Повтор после withdrawn допускает новую attempt. Для terminal rejected/removed/expired нужна отдельная product policy, не скрытый reset.

## Пагинация, ошибки и кеш

Lists: cursor pagination, limit 1–100, default20; stable ordering `(startsAt,id)` для games и `(requestedAt,id)` для personal requests. Cursor непрозрачен клиенту, сервер валидирует его размер/формат/filters. Discovery показывает текущую, не snapshot-consistent выдачу: при изменениях между страницами client dedupe по id. Датный диапазон ограничен server policy; нет неограниченных export queries.

Ошибки — `application/problem+json` по RFC9457 [S15](../reference/SOURCES.md), с `type,title,status,code,requestId`, безопасным detail без stack/SQL/provider tokens. HTTP: 400 malformed, 401 no valid session, 403 known resource forbidden/CSRF, 404 not visible/not found, 409 conflict/full/closed, 422 invalid semantic input, 429 limit, 503 temporary dependency. Retry-After при временном throttling. Коды не отображаются игроку без локализованного текста.

Private endpoints no-store. Public list/card short cache допустим без индивидуальных токенов; command всегда перечитывает primary. Нет cached success для mutation. ETag/read caching не заменяет expectedVersion и authorization.

## Coverage v0.1

В контракте: provider list, self summary, Game create/list/detail/publish/cancel, request/list, own requests и confirm/reject/withdraw. Следующие bounded дополнения: organizer/venue management, profile/identity lifecycle, share lifecycle, attendance/outcomes, moderation/admin, notification preferences и capacity edits. Их отсутствие в draft **не разрешает пропустить их перед live pilot**; F-02/F-03/F-05 включают contract completion и QA.

## LS-01 Profiles / Safety / Directory (v0.8.0)

Admitted consumer routes (feature flag `SOCIAL_DIRECTORY_ENABLED`, default **off** → `404 SOCIAL_DIRECTORY_DISABLED`):

- `GET/PATCH /me/social-profile`, `PUT /me/social-profile/visibility`
- `PUT/DELETE /me/looking-for-game`
- `GET /players`, `GET /players/{publicPlayerId}`
- `PUT/DELETE /me/blocks/{publicPlayerId}`
- `POST /reports`

Rules:

- Mutations reuse S-00A session fence + insert-first idempotency; PairFence before block/report rows; never Game locks on these paths.
- Social-profile bootstrap validates a supplied non-null city against the catalog before INSERT; updates validate before UPDATE. Unknown or malformed city → safe `422 CITY_ID_INVALID`. A failed write rolls back profile/consent/version and idempotency reservation. Omitted/null city remains supported by this API; mandatory city is the web setup prerequisite. Version conflicts and currently authorized successful replay retain their existing precedence.
- Directory projections omit phone/email/provider IDs and internal user UUIDs; use opaque `publicPlayerId`.
- Directory hide does not clear stored Radar consent; social eligibility revoke clears Radar consent. No `/me/radar/**` in this slice.
- Looking intent stores city/area TTL only (no GPS). Expiry enforced on read/commands.
- Block is bilateral for directory visibility and does not cancel Game/Participation.
- Abuse reports are create-only for consumers; no cross-user private browse.
- Lists: default limit 20, max 50, opaque cursor, **no totals**.

PROPOSED product defaults used for fail-closed implementation are labeled in
`docs/workbench/implementation/ls01-profiles-safety-directory-v001/DISPOSITION_REGISTER.md`
and do not close Owner/Legal gates.


## LS-R1 Radar (additive)

OpenAPI `0.9.0` admits ephemeral `/me/radar/**` and `/radar/results/preview` behind `SOCIAL_RADAR_ENABLED` (default off). Nearby rejects arbitrary center/radius filters. Preview is revalidated against current presence and does not create DM/invite contact. PROPOSED synthetic TTL/radius/sparse parameters are fixture defaults, not live policy closure.

## LS-04 GameInvitation (v0.11.0)

Admitted consumer routes (feature flag `SOCIAL_INVITATIONS_ENABLED`, default **off** → `404 SOCIAL_INVITATIONS_DISABLED`):

- `POST/GET /games/{gameId}/invitations`
- `GET /me/invitations`
- `GET /invitations/{invitationId}`
- `POST /invitations/{invitationId}/accept|decline|revoke`

Rules:

- GameInvitation is a Sessions resource: not Participation and not a DM/message side effect.
- Only a current authorized GameManager may create or revoke.
- Pending invitations reserve **zero** seats. Accept re-locks Game, re-checks published/deadline/start/capacity, then confirms Participation with existing capacity protocol.
- `409 GAME_FULL` leaves the invitation pending. `409 GAME_VERSION_CHANGED` when `expectedGameVersion` is stale.
- PairFence + bilateral block fail closed (`404 RESOURCE_UNAVAILABLE`). Block does not cancel already confirmed seats.
- Mutations reuse S-00A insert-first idempotency. Same key / same body replays only after current actor authorization.
- Optional `discoveryProof` on create uses the LS-R2 Radar current-state hook; it is not a bearer grant. Ordinary manager invite does not require Radar.

## LS-05 Game Chat (additive, v0.13.0)

Text-only Game Chat under `/games/{gameId}/chat` (+ messages/read/members). Access derives from current active GameManager or confirmed Participation while the Game is `published` and `now < endsAt`. Cancel/completed/ended deny all consumer chat reads and sends immediately (no retained read-only cohort). Membership rows never authorize alone. Social block does not fence Game Chat; pending applicants are not members and may use ordinary DM with optional `gameContextId` without gaining room access. Feature flag `SOCIAL_GAME_CHAT_ENABLED` default off. Message retention fixture `SOCIAL_GAME_CHAT_MESSAGE_RETENTION_SECONDS` (default 90d) is engineering-only, not Legal final.

## LS-06 Composed Inbox (additive, v0.14.1)

Read-time composition under `GET /me/inbox`, `GET /me/inbox/counts`, and `POST /me/inbox/items/{kind}/{id}/read`. Sources remain LS-03 DM, LS-04 GameInvitation and LS-05 Game Chat; Inbox never becomes a second mutable write model. Ordering is `lastActivityAt DESC, kind DESC, id DESC` with opaque cursor. Opaque cursor `at` must be an ISO-8601 timestamptz; malformed cursor or non-strict `limit` (trailing junk / non-integer) → `400` (`CURSOR_INVALID` / `LIMIT_INVALID`), never `500`. Effective overdue DM request / invitation expiry is projected in the compose SQL without Inbox-owned `UPDATE`s; durable expiry remains Messaging, Invitation and cleanup jobs. Unread counts incoming messages after the reader marker and exclude own sends/hidden rows; pending DM requests and pending invitations are separate named attention counts and are not folded into `dmUnread`/`gameChatUnread`. Muted threads suppress badge counts only. Mark-read for `dm`/`dm_request`/`game_chat` delegates to the owning source services. Feature flag `SOCIAL_INBOX_ENABLED` default off. Polling-first; no Elasticsearch/Redis/Kafka/SSE requirement.

## LS-R2 Radar contact/recovery (additive, v0.12.0)

`resultRef` / optional `discoveryProof` is viewer + owner session + activation/version bound. Preview and first-contact redemption revalidate both current Radar activations, expiry, foreground/location validity, radius/cohort membership, bilateral block and social/Radar eligibility. Stop, logout, revoke, expiry and takeover invalidate future proof use. Already created conversations/invitations follow their own policy and are not deleted by later Radar stop. Feature flag `SOCIAL_RADAR_ENABLED` remains default off (live real-user Radar). Optional `SOCIAL_RADAR_DEMO_ENABLED` (default off) admits synthetic/internal city-scoped Radar for deterministic demo identities in Moscow / Санкт-Петербург only; responses include `exposureMode` (`live` | `synthetic_demo`). Logical dumps must `--exclude-table-data=radar_presences`; restore/failover truncates presence before traffic. No raw coordinates, bearing, meters, background GPS or movement history.
- Expiry is scheduled on pg-boss `social.expiry.cleanup` (`kind=invitation`) and remains correct on-read if the worker is down.
- Fixture TTL: `SOCIAL_INVITATION_TTL_SECONDS` (default 7d), capped by `applicationDeadlineAt`. Not a Legal/Owner policy closure.

## Owner A temporal execution compatibility

New `POST /games` draft creation and `POST /games/{gameId}/publish` execution
require `startsAt > server now`; elapsed starts return `422 GAME_START_NOT_FUTURE`.
The check is inside execution, so an authorized completed idempotency receipt
can still replay after the start. Existing history reads and stored games are
unchanged. All web/mobile/API callers retain existing input shapes and deadline
invariant `applicationDeadlineAt <= startsAt`; equality closes requests at start.
Web Create uses equality and elapsed duration in whole minutes (UI bound 1–1440,
an implementation choice, not an Owner policy or new backend duration bound).
No schema migration or privacy default change.

## Owner B contactability (compatible additive projection)

`PublicPlayer` and `RadarPlayerProjection` add `canRequestContact`. The server
always emits a boolean in an already permitted projection; clients treat a
missing field from a previous server as false. Guests/self, disabled DM or
social directory, inactive/ineligible actors/targets, bilateral blocks and any
existing direct conversation produce false. Hidden/ineligible public targets
remain unavailable; Radar's existing permitted preview may carry false without
exposing directory consent or private policy. No new identity/location fields.
Authenticated guests must sign in and reread; the boolean is not a command grant.
First-contact POST continues to revalidate current target consent, account,
session, block and optional Radar discoveryProof. Accepted conversations remain
available through Messages independently of the first-contact setting.

Own `PATCH /me/social-profile` retains `contactPolicy: requests|closed`, closed
by default, expectedVersion, CSRF and idempotency. Only explicit own action changes
this preference; no migration/backfill. Version conflicts require a reread.
GameChat send retains required bounded `clientMessageId` and Idempotency-Key;
unknown-result retries preserve both for the same logical message.

### Radar toggle/list reconciliation (2026-10-07)

Owner decision `OWNER_DECISION_RADAR_TOGGLE_DIRECTORY_MAP_V001` supersedes the
consumer sparse K=3/random-first behavior: K=1; normative array order is
(band ordinal, floor(coarse-center distance / 1000), viewer/15-minute-epoch
keyed rank, internal ID). Ties never use exact distance. SQL selects the global
first 20 coarse keys WITH TIES before keyed ranking/cap, shared by nearby/proof.
All eligibility, partition, consent, session, freshness and block predicates
precede ranking. No public DTO fields or policy version change; numeric distance,
bucket, rank, coordinates, bearing and last-seen remain private.

## FB01 game backend source candidate (013/014)

`GET /v1/me/game-preferences` читает только собственный приватный шаблон: `{defaultPublicGameContact:null,version:0}` без строки. `PATCH` требует активную cookie session, Origin/CSRF, Idempotency-Key и `{expectedVersion,defaultPublicGameContact}`; null очищает, строка trim 1–320, unknown/omitted fields дают 422, stale version — 409 VERSION_CONFLICT. Все ответы no-store. API не копирует provider/social contacts.

`POST /v1/games` принимает additive optional `savePublicContactDefault:{expectedVersion}`. Сохраняет explicit public game contact snapshot и default атомарно; stale default откатывает Game/manager/seat/audit/outbox/receipt. Omitted extension не меняет default. Replay возвращает исходный snapshot после current actor/session/management checks и не перезаписывает более новый default. Preference edit/clear не меняет существующие games. Deletion_pending очищает preference под existing Identity fence; продуктовый endpoint удаления не включается.

Новая regular draft имеет confirmedCount=1 и availablePlaces=capacity−external−1 из реальной Participation. Trainer-led остаётся без auto-seat. Participation DTO получает server-derived `isCreatorOrganizer`, допустимый на authorized own/roster/command projections (optional для старых invitation receipts); public Game не раскрывает roster. Draft initial event `participation.confirmed` имеет optional origin `creator_initial_seat`, без контактов, requested event, room membership или notification job. Legacy outbox классифицирован KEEP_AS_EVIDENCE; будущий consumer должен подавлять self/draft delivery и проверять актуальный lifecycle.

Реализация — source-only candidate pending independent QA; не runtime release. OpenAPI и generated game DTO являются wire truth; см. [ADR-0012](../decisions/ADR-0012-GAME-CONTACT-CREATOR-SEAT.md).

## Email E1 internal foundation (v0.18.0)

[Email E1 addendum](EMAIL_AUTH_E1_ADDENDUM_V001.md) adds consumer email-code discovery,
challenge/login and explicit linking, preserving OAuth compatibility. Default disabled;
only strict loopback local test fake transport is available. Challenge commands use
single-use/generation and shared issuance budgets rather than a reusable success receipt:
consumed verification cannot replay a session token. No public fake mailbox or live SMTP.

Email proof commands are a narrow exception to business-command Idempotency-Key:
`x-auth-challenge-protocol=bound-single-use-v1` marks only the enumerated login/link/change request/resend/verify/status
routes. Exact Origin/flow/binding and atomic generation/consume prevent duplicate authority;
an already consumed verify returns an error, never a cached session credential.
The foundation checker recognizes only these exact routes with required binding headers.


## Контакты площадки: T0a-1

`GET /games/{gameId}` добавляет в `venue` необязательные `contactPhone`,
`contactWebsite`, `bookingNote` только для текущего активного управляющего игры
(`game_managers`: `owner` или `manager`, `status=active`) либо участника этой игры
с `participations.status=confirmed`. Значения могут быть `null`.
Для остальных, включая анонимных, pending/rejected/withdrawn/removed,
`cancelled_by_game`, expired, посторонних и заблокированных без указанных прав,
все три ключа отсутствуют. Сам факт блокировки не предоставляет прав.
Списки игр (включая управляемые), карта, discovery и каталог/деталь `/venues`
не раскрывают эти поля. Ответ детали игры остаётся `Cache-Control: no-store`.

Существующая admin-команда `edit` принимает три необязательных строковых поля:
`contactPhone` (до 40), `contactWebsite` (до 300, префикс `http://` или `https://`),
`bookingNote` (до 500). Пробелы по краям удаляются, пустая строка записывает SQL
`NULL`, пропуск сохраняет значение. `contact_updated_at` меняется только при
изменении хотя бы одного значения. Контакты не добавлены в admin create или
новые endpoint/UI; audit, step-up, expectedVersion и idempotency сохраняются.
Ошибки валидации используют существующий problem-формат.

### Public venue organization contacts (M3-CONTACTS-R2)

Venue and AdminVenue may contain nullable `publicContacts` (PublicVenueContacts):
required `phone`, `website`, `messengers`; each messenger has required `kind` and
`url`. Only admin edit accepts this field. Omission preserves, null clears to SQL
NULL, object replaces the entire value. Create/propose do not accept/write it.
Unknown/private keys are rejected on write. Reads retain safe neighbors while
nulling invalid phone/website and filtering/deduplicating messengers.

Phone forbids controls before trim, has at most 40 characters after trim and
7–15 ASCII digits, with optional initial + and ASCII spaces/parentheses/hyphens.
URLs forbid controls and backslash before trim, require explicit HTTP(S):// and
an authority without @, credentials or nondefault ports. Standard WHATWG URL
serialization supplies stored/output href: IDN input becomes ASCII punycode,
default ports disappear, dot segments normalize; the 300 character limit applies
AFTER serialization (padding does not count). Messenger kinds are unique, at
most three; HTTPS host is t.me / wa.me / vk.com and normalized path is non-root.
SQL checks canonical ASCII storage rather than implementing WHATWG parsing.

These are public organization contacts, distinct from private `contact_phone`,
`contact_website`, `booking_note`. Private game-detail fields remain available
only to an active owner/manager or a confirmed participant of that game. Game
contracts and authorization are unchanged. Audit/outbox omit contact values.

### V1a venue public profile — #170, source candidate UNVERIFIED

Owner-approved product scope is V1a: one venue profile and organization contacts
model/API. The bounded technical implementation below is proposed source, not
independent QA, admission, acceptance or deployment. Base:
`865d02c7ea39ae8210172629c3cb8e20c8fa52a8`. Evidence, remaining gates and publication
responsibilities: [source handoff](../handoffs/V1a-venue-profile-source.md).
V1b consumer presentation, V3b admin UI, V2 real import and operational FR-2 remain
separate assignments. No Game/VenueSummary/Unified/Radar schema or flow changes.

Full `Venue` and `AdminVenue` have optional-for-rollout `profile`; the current
server emits the complete object on catalog, canonical alias/detail, fuzzy
candidates, proposal/reuse/INSERT RETURNING and existing privileged receipts:

```json
{"courtCount":null,"amenities":{"parking":null,"showers":null},"updatedAt":null,"gallery":{"coverage":"cover_only","items":[]}}
```

`court_count` is nullable PostgreSQL integer, CHECK >=0, with matching DTO range
0..2147483647. `amenity_parking` and `amenity_showers` are nullable booleans.
Unknown facts are NULL, never inferred from names, games or demo data; known
zero courts and false amenities survive. Migration0039 adds these columns and
nullable `public_profile_updated_at` with no defaults/backfill/private data copy.
No factual venue import or rating/review-count source is established here; no
ratings, fake counts, generated photos or numeric placeholders are emitted.

Only existing admin `edit.fields.profile` accepts writes: omission preserves all
three facts; null clears all three to SQL NULL; object replaces them. Object
requires courtCount and amenities; amenities requires parking and showers. Both
levels reject unknown/private/read-only keys and coercion. `updatedAt` and
`gallery` are server-owned, rejected as edit input. Create/propose inputs and
private contact behavior are preserved; no arbitrary media URL input or endpoint.
`AdminVenue.cityName`, already emitted, is now explicitly declared in OpenAPI.

The venue-owned BEFORE trigger sets DB time on INSERT and an actual stored
change of name/address/timezone/location/identity discriminator, public_contacts,
the three facts, cover binding or cover credit. It compares persisted values
null-safely after cover-credit reset, so normalized equivalent public contact
input, omit/no-op, private-only, provenance/version-only and lifecycle-only writes
preserve the date. Legacy rows stay NULL until a tracked write. Supplied dates
cannot override the trigger; private contact_updated_at and generic updated_at
are never used as public dates. The date means last recorded **stored public
content edit since migration**, not verification, factual freshness or import
time. Dynamic moderation visibility changes alone do not update the venue;
actor retirement that actually clears a cover is a tracked content change.
Authorized replay returns its original receipt/date without another write.
Profile/contact/date, audit/history/outbox and receipt roll back in one existing
admin transaction on command or audit failure; payloads contain metadata only.

Gallery coverage is always `cover_only`: at most one actual current
`venue_cover_url` with kind=photo, nonempty photo credit and safe HTTPS attribution.
The existing credit is retained unchanged only if the emitted attribution itself
passes URI-format validation as well as HTTPS safety checks. A WHATWG-parseable
value containing a literal space or another invalid URI character fails closed;
the mapper does not silently rewrite its credit. Denied moderation, inactive
cover actor, retired
venue, absent/replaced/removed cover, logo, illustration, unclassified or unsafe
credit yields empty items. Existing `cover` response behavior is preserved.
Empty items never mean that a full gallery was inspected. The single-cover
platform cannot supply a real multi-photo gallery; that remains an explicit
residual, with no full-gallery completion claim or new media infrastructure.

Public contacts still come exclusively from `public_contacts` and the existing
#142 strict validator/tolerant reader: phone trim with ASCII 7–15 digit/40-character
bounds; pre-trim control/backslash rejection; WHATWG HTTP(S)/IDN href serialization
with 300-character normalized bound, no credentials/nondefault ports; unique
HTTPS messenger whitelist t.me/wa.me/vk.com and non-root normalized path. Do not
guess country codes or republish contactPhone/contactWebsite/bookingNote.
The #82 private game-detail rule remains current active owner/manager or confirmed
participant of **that game** only; no public profile permission expands it.
AdminSessionCookie, exact Origin/CSRF, current venue.manage, fresh step-up,
expectedVersion409, authorized replay, catalog locks and collision review remain.
Identity collision returns unchanged venue/profile/version plus reviewRequired;
only the existing duplicate-review metadata is committed.

Compatibility: public profile projections use per-key `to_jsonb` extraction, so
schema0037 missing columns return null without parse-time new-column references.
Old API SQL continues on the new additive schema; old bodies/receipts may omit
profile. Full Venue/AdminVenue/AdminVenueCommand are outside current generated
Game/Participation/CreateGame, Unified* and Friendship* reference closures;
existing generated files must remain byte-identical under default read-only
scripts. Authored AJV tests check actual service outputs and edit fixtures against
OpenAPI, including negative cases. An actual old-image gate, full source/DB/restore
gates and independent read-only QA on the published candidate remain required;
authored/skipped cases and author checks are not independent QA or PASS.
Application rollback retains additive schema, data and trigger; no destructive
down migration or private data removal is part of rollback.
