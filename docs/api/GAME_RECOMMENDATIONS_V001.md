# FR-3A Game recommendations v001

Status: SOURCE DRAFT / NOT_TESTED. Issue [#181](https://github.com/anpavel84-afk/gobadminton-clean/issues/181).
FR-3B UI, independent QA, full Product CI and an ACCEPTED DEV release remain separate facts.
This document confers no deployment, configuration or PROD authority.

A recommendation is a private reference from one authenticated player to exactly one currently
accepted friend about a public upcoming game. It grants no participation, reservation, organizer
invitation, management role, private-game access or conversation. The implementation creates no
notification, outbox event, delivery job, push, message or new social edge.

## Admission and source ownership

Reuse existing `friendsEnabled` admission, including its default OFF and exact DEV/local bounds.
No new flag or runtime setting. `GET /v1/me/social-capabilities` preserves the accepted Friends S1
contract: `gameRecommendations`, `gameAttention` and `socialPush` remain false, including after
migration0041. Installing the API schema does not activate the product UI. Recommendation routes
independently enforce existing Friends admission and schema availability. The separately assigned
FR-3B slice must define and review capability activation along with its UI; FR-3A does not enable it.

Games owns the recommendation-safe projection through `GamesService.recommendationSummary`.
It uses the same `eligibleGames(normalizeDiscovery({temporalScope:'upcoming'}))` and effective venue
projection as `/games`, plus the existing interaction moderation restriction (`requestsLocked`).
Only published/public, activity-typed, future games survive. A manager's access to a draft/unlisted
or moderated game never authorizes a recommendation. A full game or closed application deadline
can still be discovered/recommended; no promise that an application will be accepted is made.

Friends owns the accepted relationship and both current social profiles: active account, directory
opt-in, contact requests enabled, social eligibility, effective account.access/profile.public/
social.directory restrictions, bilateral blocks, matching social epochs. No Radar activation,
location or participant list is consulted. Current player presence means current eligible profile,
not location or inferred attendance. Friendship generation and both epochs are retained as fences;
opt-out/re-enable and remove/re-friend cannot resurrect an old recommendation.

## HTTP contract

The strict wire schemas and statuses are in [OpenAPI](../../packages/contracts/openapi.json).
All routes require the existing active consumer cookie session. Bearer alone does not authenticate
these routes. Mutations additionally require the existing allowed Origin, X-CSRF-Token and
16..128 character Idempotency-Key. No actor/sender/recipient supplied in a body is trusted.
All responses containing actor data and controlled problems are `Cache-Control: no-store`.

| Route | Body/query | Success |
| --- | --- | --- |
| `POST /v1/games/:gameId/recommendations` | Exactly `{friendshipId: uuid}` | 201 first insert; 200 existing active direction; original status on same-key replay |
| `GET /v1/me/game-recommendations` | `view=received\|sent`, optional cursor, limit 1..20 (default 20); unknown fields rejected | 200 `{items,nextCursor,asOf}` |
| `POST /v1/me/game-recommendations/:id/hide` | Exactly `{expectedVersion: integer 1..2147483647}` | 200 minimal hidden receipt, recipient only |
| `POST /v1/me/game-recommendations/:id/withdraw` | Same version body | 200 minimal withdrawn receipt, sender only |

Mutation receipts contain only `{id,version,outcome}`. Outcomes are `sent`, `hidden`, `withdrawn`,
respectively. Version is a bounded numeric integer, unlike Friends' decimal bigint wire version.
A received item contains exactly id, version, state, createdAt, expiresAt, game and peer.
Game contains only id, title, startsAt, endsAt, timezone. Peer contains only the authorized
publicPlayerId and displayName. No internal user/pair IDs, profile bio, contact, host/venue private
contact, participant/opponent data, private game fields, relationship metadata or location is returned.

Generic 404 `RESOURCE_UNAVAILABLE` covers unknown/non-owned IDs, ineligible relationship/game,
blocks and recipient budget. Malformed strict data is 422. Missing/invalid idempotency key is 400;
authentication is 401; CSRF/origin/credential conflict or actor restriction is 403. Stale/terminal
state/version, a changed request under the same key, invalid cursor and bounded lock retry exhaustion
are 409 (existing MutationRunner protocol). Sender budget is 429 with Retry-After; feature or missing
schema on writes is 503. A technical error/unknown COMMIT is never converted into a sent receipt.

## Send, hide, withdraw and retries

There is one persistent row per friendship + game + sender direction, even across friendship
request generations. A repeated send under a new key returns the same active visible recommendation
with 200 and no new audit/rate charge. It cannot re-open a hidden, withdrawn, expired or superseded
recommendation (409); an unavailable game/relationship is 404. Opposite-direction sends are distinct.
No batch body or arbitrary target public/internal user ID is accepted.

Hide changes only `recipient_hidden` and shared version. It removes the item from received lists;
the sent list does not expose this flag. Shared versions can change after either endpoint's action;
they are concurrency fences, not a reason or peer activity feed. Withdraw changes state to withdrawn
and increments version; received lists omit it. Sent lists may retain withdrawn rows, with content
subject to all current authorization rules. Hide never withdraws the sender's recommendation.
Neither action restores content or produces an alert.

Every fresh terminal mutation requires the current version; stale/new-key repeated actions give 409.
A same-key terminal replay acknowledges the earlier safe action, even after a later terminal action,
without returning content or granting rights. Hide/withdraw remain available when Friends is OFF or
the game/peer is unavailable; actor session/account and role still apply. Fully inactive actors cannot
mutate. Send replay revalidates current relationship, game, row version, hidden/state and expiry;
it returns generic 404 rather than confirming a now-inapplicable delivery. After the final
Recommendation row lock (including waits behind a terminal holder), send and same-key replay
refresh the DB clock and re-read upcoming game eligibility under the already-held Game and
relationship fences before any sent receipt. Receipts never prove recipient viewing, game
participation or a reserved seat.

On network failure or 500/unknown COMMIT, a future UI must retain the exact operation/body/key and
show an unconfirmed state. An explicit same-key retry recovers the committed receipt if still
applicable; changing keys is not recovery. A failed replay is not proof the original transaction did
not commit. Refresh the actor's own list, without optimistic delivery or seat confirmation. No UI
retry flow is implemented in FR-3A.

## Read revalidation and bounded storage

Received excludes hidden/withdrawn; sent is sender-only. Each candidate is re-read under fences;
revocation, block, profile/consent changes, restrictions, expiry, cancellation, time and moderation
fail closed. No placeholder reveals an unavailable peer/game. Content can disappear from sent history
as well as received. No public/global recommendation read or lookup endpoint exists.

Scan at most `limit` candidate rows (+1 for continuation) per page, returning at most 20 authorized
items. Omission can produce an empty page with a nextCursor. Clients follow that cursor, never infer
an empty inbox or a foreign row count from page size. Cursor uses HMAC and a purpose-separated actor/
view binding, an actor-owned recommendation ID, and asOf; no internal actor or pair ID is serialized.
It expires after 15 minutes; tampering/cross-actor/cross-view use gives 409. asOf is a candidate creation
cutoff, not a snapshot of authorization; every page revalidates current rights.

Expiration is fixed at creation to the earlier of game start and the existing Friends request TTL,
capped at 30 days. DB clock enforces read expiry without a worker. TTL changes cannot revive a row.
Rate limiting reuses `social_action_rate_buckets` bucket `game.recommend`, the existing Friends window
(capped at 24h), and send/receive limits (capped at 100). Both endpoints are charged in sorted order
only for a new row. Opposite sends/receives conservatively share this endpoint budget; recipient cap
is a neutral 404. There is no approved new runtime policy value in this source change.

## Transactions, migration and compatibility

Send and replay reuse MutationRunner and actor/session/idempotency fences. Ordering is Actor ->
sorted Games SHARE -> sorted endpoint Users KEY SHARE -> sorted profile SHARE -> sorted Pair ->
Friendship -> Recommendation -> sorted budgets. User KEY SHARE conflicts with restriction writers'
FOR UPDATE without conflicting with the opposite consumer ActorFence's NO KEY UPDATE. Status/
privacy writers serialize through the existing user/profile and social epoch paths. Game writes and
moderation share the existing Game fence. Batch reads acquire all fences of a kind before advancing.
Terminal actions need only actor/session and their own recommendation row. Existing-direction send
and same-key replay do not return a sent receipt from pre-wait timestamps: after Recommendation
FOR UPDATE they re-check `clock_timestamp()` expiry/state/version fences and current upcoming
eligibility. Nothing in this module writes Games, Friendships, participants, invitations, consent,
permissions or the block graph.

[0041](../../apps/api/migrations/0041_game_recommendations.sql) is additive. Foreign keys preserve
safe endpoints and game/friendship references, a membership guard verifies the accepted friendship
on creation, bounded state/version and immutable identity prevent recycling, and indexes scope own
sent/received scans. `game_recommendation_actions` is a minimal immutable transaction-local audit
(send/hide/withdraw with actor ID and version); triggers ensure every transition is recorded without
a notification consumer. No private content is copied. Deletes/truncates cannot erase history.
Historical migrations and automation remain unchanged.

Current app with N-1 (through 0040_external_http_url_storage) schema: capability false, own lists empty, writes 503. N-1 app on 0041
schema continues using its existing tables; no historical object/function is replaced. Normal release
must migrate before exposing writes. Application rollback uses existing release tooling and keeps
0041/history; Friends OFF is a release-owner option, not an author action. Empty-install schema
[rollback](../../apps/api/migrations/rollback/0041_game_recommendations.sql) requires caller-owned
transaction and stopped writers; it refuses populated recommendations or audit. Never erase populated
history as release recovery.

## Verification boundary

NOT_TESTED: no author test, typecheck, lint, build, contract validation, DB, migration, git mutation,
service, external network, CI or deployment execution. Authored unit/disposable tests are a QA input.
Independent QA must bind the published exact new SHA and run the existing full Product CI, including
fresh/N-1 migration and restore checks. The new disposable suite accepts either a dedicated empty
local test database `gobadminton_recommendations_disposable` or the exact existing ephemeral Actions
recipe (`gobadminton`, local port, gb-ci container identity and test/disposable flags). No URL fallback;
no live schema is accepted. The external runner owns DB creation/destruction. Automation was not edited.

DEV acceptance requires the existing ACCEPTED server/gitSHA evidence after all gates PASS. No PROD
and no FR-3 completion claim; FR-3B remains dependent UI work.
