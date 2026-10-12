# Recommended S1 contract and unresolved SQL/lifecycle proof

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

Base `31d09f45776d7b397a1f66c8f4c9131eb3401f04`. This is a bounded proposed intake for Architect/Product/PM review. No migration, DTO or service is implemented here. Draft PR132 is the model input, not technical acceptance.

## S1 ownership and additive migration boundary

SocialConnections owns friend request/accepted lifecycle. Safety owns blocks, Profiles/Identity own availability, Sessions owns all seats/formal invitations. One existing API/database; no graph service, generic Inbox table, Follow, DM consent or provider-based backfill.

Recommend **one additive S1 migration** containing only the following DDL intentions. Suggested filename `0024_friendship_core.sql` is conditional on next free number at actual admission; no slot is reserved. Existing migrations0001–0023 remain byte-identical. S2 later owns `game_recommendations` in its own then-free migration; S3 adds only EXPLAIN-justified indexes if needed.

| Addition | Exact proposed content / constraint |
|---|---|
| `friendships` | UUID PK `id`; UNIQUE FK `pair_id` to social_pairs; endpoint FKs `requester_user_id`, `recipient_user_id`; UUID UNIQUE `request_id` regenerated on each attempt; state enum/check pending/accepted/declined/cancelled/removed/invalidated/expired; positive bigint `generation`, `version`; positive bigint `requester_epoch`, `recipient_epoch`; timestamps requested_at/request_expires_at/accepted_at/ended_at/created_at/updated_at; directional `low_next_request_at`, `high_next_request_at`. |
| Pair membership integrity | Distinct endpoints; exactly pair.user_low/user_high (constraint trigger + application recheck under Pair). Pending requires request_id/expiry; accepted requires accepted_at; positive generation/version/epochs; unique pair permits one current aggregate, not two writable directed edges. |
| Indexes | Partial effective-state starting points: requester/requested_at/request_id for outgoing pending, recipient/requested_at/request_id for incoming pending; accepted_at/id plus pair endpoint joins. Plan/limits must prove bounded owner lists; do not index a public graph export. |
| `social_action_rate_buckets` | user_id FK, bucket, window_start, count>=0, expires_at; PK(user_id,bucket,window_start); expiry cleanup index. Shared future recommendations budget namespace, no recipient counts/raw IP/contact/search text on wire. Dedupe does not charge new sends. Numeric windows/limits remain G-03 review/config. |
| Profile guard | `player_social_profiles.social_action_epoch bigint NOT NULL DEFAULT 1 CHECK >0`. Existing users acquire epoch1, not friendships. No copied names/avatar/location/contact snapshots. Capture both epochs on pending requests; not Radar consent/DM state/profile version. |
| Lifecycle integration | Directory true→false, contact requests→closed, social_eligible true→false and active account→disabled/deletion_pending increment epoch in SAME transaction as transition. Re-enable never resets/decrements. Preserve existing directory opt-out vs Radar opt-out behavior and preference0023 status tombstone. |

Request transitions: new A→B creates pending/new attempt+generation; same-direction live pending dedupes; crossed B→A returns decision-required and requires recipient Accept. Accept/decline are actual-recipient-only; cancel requester-only; accepted Remove either endpoint. Transitions use exact attemptId/version. Remove/block end generation permanently; expiry or epoch mismatch immediately denies pending actions even before sweep. No old attempt may decide a later attempt.

Accepted friendship can remain stored, dormant with `peer:null`, through hide/contact-close/ineligibility; restoring eligibility may restore its usable accepted relation. Pending requests and later recommendations carrying old epochs never revive. Block/remove terminate that generation; unblock/refriend must not restore old accepted state/recommendations. Session logout/revocation denies that session; no epoch reset or friendship deletion. Text/avatar edits do not invalidate social attempts.

### Concrete account writer gap

Current source supports user status values, account/session fences, profile mutations and a private-preference deletion_pending trigger. It does **not** implement the proposed shared social lifecycle guard or full real-account purge workflow. Relevant inspected paths: auth identity/session services, profiles service, migration0023, database demo-seed-ops (synthetic DELETE), and status-changing integration fixtures. No complete disable/delete API is presumed.

Before S1 acceptance enumerate every supported SQL status/erase writer in the actual admitted source and maintenance interfaces. Each status writer must take owner/status account fence → own profile exclusive lock → status+epoch/session changes → commit, with no Game/Pair locks afterwards. If direct status SQL remains supported, Architect must choose a reviewed guard (e.g. additive status trigger sharing that profile lock/epoch) and test it, including coexistence with0023; an application helper alone cannot fence direct SQL. This selection is **not made canonical here**. Hard erasure must first commit ineligibility/revocation, then use a separately authorized bounded purge; G-08 retention/backup policy remains open. Demo-only hard-delete tooling is not a real-user lifecycle solution. A missing guard is a technical S1 acceptance gap, not authority to implement account deletion.

## Proposed S1 wire boundary

All routes below are **NOT IN CURRENT OPENAPI / CONTRACT_PENDING**. One writer must update `packages/contracts/openapi.json`, generated exports and source together only after exact Architect/Product contract disposition. Keep current numeric Game/Participation/invitation versions; new friendship versions are positive decimal strings. Internal pairId/generation/epochs/userIds never become public graph fields.

| Route | Strict input / proposed output | Authorization |
|---|---|---|
| GET `/v1/me/social-capabilities` | `{friends,gameRecommendations,gameAttention,socialPush}` effective booleans. S1 only friends can become available; future unimplemented capabilities false. | Current active consumer; flags plus actor policy, no client assertion of entitlement. |
| GET `/v1/me/friendships` | `view=accepted|incoming|outgoing`, q?, cursor?, limit? → items/nextCursor/asOf. | Owner only, visible-name search; dormant accepted peer redacted. |
| GET `/v1/me/friendship-states` | 1–50 repeated publicPlayerId → same-length permitted view/placeholders. | Bound identity read; no arbitrary internal IDs or graph oracle. |
| GET `/v1/friendships/{friendshipId}` | current FriendshipView | Either endpoint only, independently filtered peer. |
| POST `/v1/friend-requests` | `{targetPublicPlayerId}` →201 own pending receipt;200 same-direction existing pending;409 FRIEND_REQUEST_DECISION_REQUIRED on crossed request. | Actor from session; self denied; permitted visible/eligible identity, contact requests, no bilateral block/quota bypass. |
| POST `/v1/friend-requests/{requestId}/accept` | `{expectedVersion}` → minimal own friendship receipt | Actual recipient, effective unexpired pending attempt, current availability/epochs. |
| POST `/v1/friend-requests/{requestId}/decline` | `{expectedVersion}` → own receipt | Recipient-only safe terminal decision; no peer read grant or decline notification. |
| POST `/v1/friend-requests/{requestId}/cancel` | `{expectedVersion}` → own receipt | Requester-only, exact attempt. |
| POST `/v1/friendships/{friendshipId}/remove` | `{expectedVersion}` → own receipt | Either endpoint; safe removal even peer unavailable. |

FriendshipView fields: friendshipId:string|null, relationship:none/outgoing_pending/incoming_pending/friends/unavailable, version:string|null, request:null|{id,expiresAt}, peer:null|{publicPlayerId,displayName,avatar:existing safe PlayerAvatar}, capabilities:{canRequest,canAccept,canDecline,canCancel,canRemove}. No blocked-by/decline reason/peer participation/contact/Radar fields. Receipts contain only resourceId/version/own outcome, not cached peer data; reread after ack.

Current consumer auth/audience, cookie Origin+CSRF and MutationRunner/idempotency are reused. Idempotency-Key16–128, actor+operation scope, normalized payload hash mismatch conflict; unknown network outcome retries same key then fresh read. On replay verify current ownership and privilege before returning source IDs: a cached accepted/send response after block/remove cannot restore entitlement or identity. Safe own remove/cancel receipts may replay minimally. Generic inaccessible target response, never distinguish hidden/missing/block direction/recipient cap. Actor-owned429 Retry-After and server nextRequestAt/capabilities drive UX; no fixed client countdown from draft G-03 numbers.

List default20/max50, q max80, bounded actor/filter/view-bound opaque cursor with version/expiry and current policy on each page; draft cursor maximum2048. Those transport limits require contract review, not Owner decree. `Cache-Control:no-store`; logout/account switch clear views/keys; failure unavailable/UNKNOWN. No `/players/{id}/friends`, mutual graph counts, export or recommendation/game routes in S1.

Recommend independent default-OFF capability/flag for Friends; recommendation/attention flags are separately introduced by later slices. Feature OFF denies new contact while necessary block/remove/cancel/epoch cleanup for existing records remains possible under active owner auth. Existing SOCIAL_DIRECTORY flag alone cannot authorize Friends. No flag is enabled by source merge or docs acceptance.

## Explicit lock ordering — proposed, not SQL-proven

| Operation | Required order after BEGIN/timeouts; release only at commit |
|---|---|
| S1 request / accept | Existing actor users FOR NO KEY UPDATE + session → idempotency reservation → both existing profile rows FOR SHARE **one at a time sorted user UUID**, read current account/profile/epoch without peer-user lock → sorted PairFence FOR UPDATE → friendship FOR UPDATE/recheck identity/version/generation → sorted(user_id,bucket) rate rows when charging → transition/evidence/required expiry job + receipt. Never profile SHARE→UPDATE upgrade. |
| S1 decline/cancel/remove | Actor/session → idempotency → Pair → friendship CAS. Safe own terminal removal does not depend on peer availability. Immutable request/pair pre-read is locator only; recheck under locks. |
| Safety block/unblock | Actor/session → idempotency → Pair → existing block/pending DM effects + friendship invalidation/generation increment on block. No Game/profile lock afterwards; no recommendation/Participation sweep under Pair. Unblock only own direction, no restore. |
| Profile availability change | Actor/account → own profile FOR UPDATE → existing profile/Radar-consent/presence work + social epoch in same transaction. No friend/recommendation scan or Pair/Game lock after profile. |
| Account closure | Owner/status account → own profile FOR UPDATE → status+epoch/session revocation; no Pair/Game afterwards. Purge later. New contact holds profile SHARE through commit; unsupported bypass path blocks acceptance. |
| S1 cleanup | Pair → friendship, exact attempt/version; never terminal→pending. Read-time TTL/epoch is authoritative with worker down. |
| Later S2 create | Actor/session → idempotency → Game FOR UPDATE → sorted profile SHARE → Pair → friendship → sorted quota rows → recommendation; read target Participation baseline under Game, never mutate it. |
| Later S2 dismiss/revoke | Actor/session → idempotency → Game → Pair → recommendation; own-resource recheck, no peer read requirement; no seats. |

No external call inside transaction. Do not use `ORDER BY` alone as proof of row acquisition order. Keep bounded existing retry/timeout; count retry exhaustion/liveness separately from final invariant safety.

### Legacy compatibility that the draft order does not solve

**Existing source FACT:** non-geographic invitation create follows actor/session → idempotency → Game/manager → sorted users FOR SHARE → profiles FOR SHARE → Pair → Participation row → pending invitation row. **Existing Accept differs:** actor/session → idempotency → Game → invitation → sorted users FOR SHARE → Pair → profiles FOR SHARE → Participation confirmation (relocking the already-held Game). Invitation profile SQL is one `IN ($1,$2) FOR SHARE` query, with no proven profile row acquisition order. Create's geographic/unified-fence branch skips only `lockAccounts`; it still checks profiles before Pair and redeems proof under a later presence SHARE fence. Accept has no discovery-proof branch. Replay follows separate authorization paths rather than these execute chains.

Existing DM create: actor/session → idempotency → sorted users SHARE unless geographic/unified fence → actor profile plain read + target profile SHARE → optional Game SHARE → Pair → conversation; optional proof is redeemed afterwards. Existing DM Accept/Decline: actor/session → idempotency → conversation UPDATE → sorted users SHARE → Pair; neither calls profile-SHARE eligibility helper. Existing accepted DM send adds sorted profiles SHARE after Pair. Block holds Pair before pending-conversation UPDATE. Profile/Radar/session writers have their own fences. The independently traced [existing lock map](LEGACY_LOCK_MAP.md) cites entry points, calls and actual helper SQL. These existing chains are distinct from the unchanged **proposed** S1 order above; no new SQL locking prescription is made here.

Direct Identity link/unlink are separate own transactions beginning with external identity FOR UPDATE; they do not inherit this MutationRunner actor prelude or a prior explicit user fence. Joined resolve locks identity/users in a distinct statement, and insertion FK/unique waits are later implicit effects. [Method/caller source map](LEGACY_LOCK_MAP.md) and [J11 future Identity schedule](FUTURE_JOINT_SQL_CRITERIA.md) distinguish early returns, absent rows and caller locks released before these methods. No Identity runtime repair or new locking prescription is proposed by this correction.

Two actors already fenced on their own users can deadlock on peer FOR SHARE even if the peer loop is sorted. New commands therefore do not copy these account upgrades. Sorted new profile SHARE locks are compatible with each other, but that alone does not prove safety with lifecycle/Radar/legacy paths. Existing Invitation/DM are not blanket S1 refactor scope. Run the separate create/Accept and peer-fence schedules in [future joint SQL criteria](FUTURE_JOINT_SQL_CRITERIA.md), plus the retained cases below; if actual cycles/timeouts violate required progress, PM must admit a bounded shared-lock repair with exact files before accepting S1. Never claim retries or the finite model prove lock order/deadlock freedom.

## Tested semantics vs mandatory future PostgreSQL evidence

[Author rerun](evidence/serialized-model-rerun.json) executed the exact PR132 serialized Python proposal model: **65 assertions, exit0**. It checks crossed explicit accept, same-direction dedupe, stale attempts, generation/epoch nonresurrection, dormant redaction, recommendation zero-seat/DM effects, apply→withdraw resolution, distinct Game/formal precedence and modeled last seat. Original model metadata still calls OQ-01 conditional; separate Owner record now closes it. These are true results for the model only. It assumes serialization, does not execute current API/SQL, and does not test an implemented friend aggregate (none exists).

Existing repository test bodies contain regression coverage for actor/replay/confirm-cancel (`s00a.transaction-auth`), bilateral block without Participation effects (`ls01.profiles-safety`), current contact-state/consent (`ls03.text-dm`), invitations/capacity (`ls04.game-invitation`), composed Inbox (`ls06`), and creator-seat/preference/delete status (`fb01.game-preferences-seat`). **Inspected, NOT_RUN in S0**; test names/presence are not fresh PASS. Reuse their assertions in later admitted regression runs, not their old status as friend QA.

Later S1 must run real disposable PostgreSQL/PostGIS using at least two independent connections, explicit barriers/advisory test synchronization, bounded lock/statement timeouts and both winner schedules. No live DB, fake in-memory lock substitute, arbitrary sleep-only “race” or SQLite. Capture final rows/events/idempotency, SQL error codes/retries, connection cleanup and full migration/teardown evidence tied to immutable source SHA/tree.

| Mandatory case | Required observed invariant / evidence |
|---|---|
| C01 opposed sends, same-direction/new-key duplicates | Exactly one pending request; crossed loser decision-required, never auto-accepted; one event/send quota charge. Force actual overlap, not just sequential model permutations. |
| C02 accept vs cancel/decline, C03 retry after terminal/cooldown | One valid CAS winner; old requestId/expectedVersion cannot act on fresh generation. Expiry equality denies with worker stopped; numeric values come from fixture config. |
| C04 accept/send vs block, C05 block→unblock→refriend | Block commits terminal generation; other direction remains; unblock/re-friend never revives old attempt/cached privileges. DM policy/Participation unchanged. |
| C15 request/accept vs hide/contact-close/ineligible/account disable/deletion_pending | Both commit orders obey profile guard; send first captures old epoch and becomes permanently unavailable, closure first denies send. Hide→show does not revive pending; accepted relation dormant/redacted then usable if restored; no profile snapshots. |
| Account/direct-SQL and0023 coexistence | Actual supported status writer increments epoch under exclusive guard; direct SQL cannot bypass if supported. Preference clearing/version tombstone retained. Missing profile/disabled session/revoked session denied. No real deletion workflow asserted. |
| Replay/hash/rollback/idempotency | Same key+payload one effect; different payload conflict; revoked session/removed relation blocks privilege replay; timeout/rollback leaves no orphan processing/send/event/quota charge. Safe own removal still works with hidden peer/feature off. |
| Multi-pair quota contention | A→B/A→C and different senders→same recipient enforce same sorted budget order and caps atomically; generic recipient-cap failure, no privacy oracle, retries do not charge twice. |
| Joint legacy liveness — NOT_RUN | Execute separate invitation create (profiles SHARE → Pair) and Accept (Pair → profiles SHARE) schedules, profile SHARE/UPDATE and opposed account-fence peer waits, plus distinct Identity link/unlink/resolve paths and DM create/decisions/send, block, lifecycle/account, geographic/unified proof/Radar and Game cancellation peers. [J01–J11](FUTURE_JOINT_SQL_CRITERIA.md) require real two-connection barriers, both commit/winner orders, lock/statement timeouts, pg_locks/errors/retry/progress and final invariants; unresolved acceptance failures require separate PM scope. No SQL proof or implementation here. |
| Migration/old-client/regression | Apply whole chain to empty disposable DB and upgrade previous schema with synthetic rows; no inferred friendships, prior rows unchanged, constraints reject wrong pair/duplicates; old routes/DTOs/feature-off remain valid. Run retained seat/DM/Invitation/Radar integration assertions and rollback fixture. |

S2 additionally requires C06–C13 Game cancellation/self-apply/last-seat/full/duplicate/remove/issuer role-loss tests; S3 C10/C14 count/snapshot/privacy/plans; C16 optional social Push is later. These are future acceptance criteria, **not tests run by S0**. Independent QA remains separate from author tests and terminal for each immutable candidate.
