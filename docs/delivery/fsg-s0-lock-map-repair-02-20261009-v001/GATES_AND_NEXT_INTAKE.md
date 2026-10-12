# S2 / S3 safety, frozen DD custody, gates and future S1 intake

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

Base `31d09f45776d7b397a1f66c8f4c9131eb3401f04`. Everything here is a recommendation for separately admitted slices; no API/DB/UI implementation, dispatch or gate change.

## S2 — one-recipient non-seat recommendations

Use a dedicated `game_recommendations` aggregate in a later additive migration, not GameInvitation/Participation/DM/Inbox. Fields: id/game_id, distinct sender/recipient, friendship_id+captured generation, both captured social epochs, state active/dismissed/revoked/invalidated, positive bigint version, recipient_participation_version_at_create (0 if absent or current withdrawn version), immutable expires_at, created/updated/ended timestamps. UNIQUE(game_id,sender_user_id,recipient_user_id) across retained terminal as well as active rows. Pair membership must match friendship; bounded recipient/sender/game/friend-generation/expiry indexes. No message text, contacts, profile/location/Game snapshots. Retention/purge and post-purge dedupe are G-08/G-03, not invented perpetual storage.

Before send lock Game→profiles→Pair→friendship per S1 proposal and check current authenticated ordinary **non-manager**, public published/currently joinable Game, one visible eligible accepted mutual friend, no block, live generation/epochs and target normal self-application eligibility. Game time/deadline/current actual availablePlaces must pass; recipient existing pending/confirmed or non-reapplicable terminal Participation denies generically. Manager mode uses existing formal invitation route/authority; friends are a convenient subset, never globally required by that route. No target Participation status is leaked in picker/send response.

Proposed routes, **NOT CURRENT API**:

- GET `/v1/games/{gameId}/friend-picker?mode=recommend|formal_invite&q=&cursor=&limit=`: reauthorize current mode/Game/friends; radio one friend. Stale picker or known public ID is not authority; no forged Radar proof.
- POST `/v1/games/{gameId}/recommendations`: strict `{recipientPublicPlayerId,expectedGameVersion,expectedFriendshipVersion}` only, no arrays. 201 new/200 same retained triple; same idempotency key on uncertain retry. One durable send/event, expiry never extended by duplicate.
- GET `/v1/me/game-recommendations?direction=incoming|outgoing&gameId=&cursor=&limit=` and GET `/v1/game-recommendations/{id}`: owner-scoped. Sender receipt `{id,gameId,createdAt,submission:"recorded"}` only; never exposes recipient read/dismiss/apply/state/version oracle.
- POST `/v1/game-recommendations/{id}/dismiss` with recipient expectedVersion; sender `/revoke` with `{}` is monotonic/versionless safe own intent (fixed triple, no later resend instance). Removal remains possible while peer/Game unavailable.

Effective state recomputes current ownership/privacy/generation/epochs, persisted removal, original expiry and Game lifecycle, then Participation version advancement, then fullness. Apply→withdraw must never revive a recommendation because baseline version advanced. Block/remove/re-friend or hide→show never revives captured-generation/epoch actions. Expiry/Game cancellation resolves immediately with worker down. Temporarily full remains view_only, contributes no recommendation attention, no apply CTA; capacity returning can restore an otherwise valid action without a new send/event. Future reversible visibility transitions must permanently invalidate old sources within their Game transaction, separately admitted; no expanded Game edit workflow is added here.

Recommendation writes make **zero** Participation, confirmedCount, capacity/external reserve, Game version, managers, formal invitation or conversation/membership changes. Recipient view/self-apply uses unchanged `/games/{id}` and POST `/v1/games/{id}/participations` with current Game version/seat checks. There is no recommendation Accept endpoint. Optional sourceCode is untrusted attribution, never authorization. Formal invitation Accept remains its own Sessions confirmation path. Share remains external link.

## S3 — distinct actionable Game attention and joined personal cards

Recommended GET `/v1/me/game-attention?cursor=&limit=` is a read-time source projection, not a new universal notification/action table or unread count. One key `game:<uuid>` with authorized `game:SafeGameSummary|null` and typed facets:

| Facet | Effective actionable condition / presentation |
|---|---|
| Formal invitation | Invitee-owned effective pending, time/Game/availability/block/Participation compatibility. Reuse current source predicates; no new original-issuer role-loss rule. Full may disable Accept while valid Decline remains a decision. Expired/cancelled/already confirmed source is not attention. Private/unlisted without read authority yields `game:null`, generic owned receipt, permitted Decline only, no functional Accept. |
| Friend recommendations | Only current active eligible sources; multiple senders are bounded provenance under the one Game. Same-Game formal invitation takes primary CTA precedence; recommendations are informational while that formal decision exists. Full/view_only, removed/dormant/expired/resolved recommendations do not inflate attention just because dismiss is available. |
| Managed requests | Active manager for that Game, published/future/in decision period and pending Participation. Twelve applicants are **one Game** with pendingCount12, at most3 authorized previews, hasMore and existing manager review link; full may prevent confirm while authorized review/reject remains possible. Role loss drops facet on next read; mutation still rechecks role under Game lock. |

`actionableGamesCount = COUNT(DISTINCT game_id having at least one effective actionable facet)`, across **all** scoped groups before page limit. Facet breakdown may overlap and must not be summed. Friend request count belongs to Friends, own pending Participation to Участвую, DM/GameChat unread to Messages.

Required stress fixtures: same Game three recommendations + one formal invitation → one group/count1, formal primary; one managed Game twelve pending applicants → count1, pendingCount12, preview3; two distinct Games → count2; no effective sources → verified count0. DB/network/auth/capability failure → unavailable/UNKNOWN, never synthetic count0. Required-source failure must not return partial undercount as complete. Empty hides section only after successful authorized read.

Page/count share one SQL statement or one bounded REPEATABLE READ READ ONLY transaction with a common DB time anchor. Reuse reviewed shared effective predicates for both; current Inbox's multiple READ COMMITTED queries are not equivalent. No write locks/network inside read transaction, no per-item getGame calls. Count covers full scope, not visible page. Cursor actor/filter/version-bound, keyset `(starts_at,id)` proposed; current auth rechecked per page. Fresh asOf/validUntil bounded by earliest action expiry; live pagination is **not** an indefinite cross-request snapshot. Refocus/mutation/network recovery refresh; stale data cannot enable actions or prove zero. Exact freshness duration is reviewed server policy, not hardcoded Owner quota.

SafeGameSummary follows current authorized Game DTO subset including existing venue/version/time/capacity semantics, never friend-based private access, roster or private contact default. Manager applicant identity uses existing authorized applicant projection; otherwise `peer:null`. A join is not read authority. G-06 safe null applies even when actor owns invitation metadata.

Recommended GET `/v1/me/game-cards?relation=participating|managed&view=upcoming|history&cursor=&limit=` joins bounded source rows with current authorized GameDto/null. Keep existing `/me/games`, `/me/participations`, invitation and inbox routes. Own Participation and active owner/non-creator-manager sources remain distinct; accepted invitation is not a second card for same Participation. Preserve `/my-games`, `tab=created`, `view=history` and current terminal/history classification. Inaccessible Game/null preserves own source state; network failure must not reclassify active Participation as history. Current regular creator seat and GMap public projection remain correct; preferences/contact-default must never leak. Use representative synthetic EXPLAIN/query-count/privacy fixtures; no claim of measured SQL performance in S0.

## Frozen DD delta custody — no redesign or S4 dispatch

Authority: [exact DD freeze](https://github.com/anpavel84-afk/gobadminton/blob/f48187ddafbb2e769acd38f94b708ecb7b375d9a/docs/workbench/design/friends-social-games-integration-design-spec-v001/DESIGN_DIRECTOR_FREEZE.md). FR-01..04, GS-01..04, MG-ATT-01..02 remain frozen/contract-gated.

| Correction | Exact later insertion rule / current source reconciliation |
|---|---|
| DD-FR-01 | Local Каталог/Друзья below RadarStatusControls, **outside** Radar on/off/checking content conditional; Friends remains accessible while Radar ON. Selecting Friends never stops/renews lease, changes GPS/consent or filters friends by Radar. Current PlayersDirectory also has unified city/nearby controls; preserve both existing unified and geographic directory flows. Use semantic anchors, not old line numbers. |
| DD-FR-02 | FriendRelationRow immediately after the **complete** public player-profile-hero section and before player-profile-grid. Current hero now uses ContactAction/ContactNote rather than the older inline DM markup; preserve this improved contact-state behavior, hero and safety. No row inside hero. |
| DD-FR-03 | Friends content order incoming decisions → accepted friends → outgoing. Counts stay local to Friends, never My Games. |

GS keeps external Share and Participation GameActionBar; ordinary recommend and manager formal CTA are distinct permitted modes, not a second seat button. OneFriendPicker allows one radio recipient, success replaces picker. Attention inserts below My Games header and above unchanged relation/history controls, one GameAttentionGroup. Preserve shell/brand/nav/footer/editorial imagery/current Player/Game cards, Radar, DM, Profile hero and non-friend manager invitations. No Figma screen replacement or Style Guide alteration. Approved composites use existing Style Guide families; no new STYLE_GUIDE_GAP/OWNER_VISUAL_OVERRIDE is claimed here. App source serves insertion anchors only, not presentation authority. Runtime screenshots/browser/render/device checks are NOT_RUN; S4 waits for separately accepted API source contracts.

## Gates deliberately preserved

| Gate | Status / owner | Permitted bounded progress and blocked effect |
|---|---|---|
| OQ-01 | OWNER_CONFIRMED YES / CLOSED | Do not re-ask. Fixed one-friend nonseat public recommendation vs manager-only formal vs link Share. This does not close technical/Legal acceptance. |
| G-02 | Product handoff privacy-first; technical proof pending | Dormant accepted relation/redacted peer, safe removal, terminal block/remove generation; no DM/Radar/private read grant. S1 SQL/negative authorization proof required. |
| G-03 UX / numbers | UX selected for handoff; **numeric quotas/TTL/cooldown OPEN, ARCHITECT_PROPOSED** | Dedupe/crossed explicit decision/unknown retries mandatory. Server supplies capability/timing; exact thresholds require Product/Trust/Architect review/config. No 7d/24h or numeric budget declared Owner-approved. |
| G-04 | Product handoff distinct Game / formal precedence | S3 count/snapshot/API proof still needed; no combined Messages+MyGames sum. |
| **G-05** | **OPEN Owner/Sessions** | Keep issued formal offer behavior after issuer manager-role loss. Current-authority create/revoke remains enforced. No invented auto-revocation or accept issuer recheck. Any change needs separate Sessions scope/decision. |
| **G-06** | **OPEN Owner/Architect for private/unlisted preview/read/Accept policy** | Safe `game:null`, no title/address/roster/functional preview or Accept without current accepted authority. Generic actor-owned Decline can remain. No broad read grant from friendship/invitation/Participation join. |
| **G-07** | In-app-first selected; actual optional social Push **OPEN / DEFERRED** | S1–S5 do not depend on Push. Later category opt-in, actual messaging PWA baseline, worker/current-state checks and real-device QA; no second SW, OS prompt or auto-enrollment. |
| **G-08** | **OPEN Owner/Legal** retention/privacy/erase/backups/minors/residency/real-user processing | Disposable synthetic source tests/docs may advance. Real-user social activation/retention/physical erase policy remains blocked until exact review. Germany primary DB/topology does not close Legal/O-01/O-02. No contracts/payments/OAuth/PROD release authority. |
| API/DB/technical disposition | Architect/Product review + independent QA pending | This S0 package proposes a boundary. PR132/135 aren't canonicalized here; new migration/DTO/flags/lock implementation needs accepted exact contract and later admission. |
| Visual delta | DD_FROZEN / CONTRACT_GATED | No visual blockers need another design round; no S4 dispatch before S1–S3 API acceptance. Frozen visual authority isn't API/runtime acceptance. |

Open scoped gates are not a reason to block completion of this docs-only S0. They restrict their affected later surfaces. No Owner/release-gate change or self acceptance occurs here.

## Old clients, flags and rollback

Additive routes/tables only; existing wire DTOs/endpoints remain, current numeric versions stay numeric. Update contracts/generated exports together in future S1, not by hand inventing parallel transport truth. New flags default OFF and capabilities false until implementation is accepted and separately enabled; friends/recommendations/attention/push capabilities remain independent. UI hides/unavailable new features when old backend lacks them; 404/timeouts are not empty Friends or count0. Keep ordinary Games/Player Catalog/Radar/Profile/DM/MyGames and safety working on old clients.

Later release must separate source merge, schema rollout, feature enablement, API deployment and web deployment. Deploy additive schema before matching source, with separately authorized backup/migration/restore evidence. Disable new sends while retaining owned cleanup/safety; old backend rollback must tolerate additive tables. Do not drop stored data as “rollback”; undo/purge needs separate data/retention authority. No production schema, flag or deployment effect is included in S0.

## Concrete future S1 intake — NOT_ADMITTED

One next bounded recipient now: **independent qa-fsg-s0-lock-map-reverify-02-20261009-v001** reviews this exact new candidate SHA/tree; PM then disposes findings and Architect/Product proposed contract. No executor starts it or S1 automatically. Docs review success is not implementation acceptance.

A later S1 assignment must contain:

1. Accepted exact S0/Architect/Product contract disposition; fresh base SHA, current migration inventory and no overlapping live API/schema writer (refresh state; this S0 snapshot is not a lock reservation).
2. Exact source allowlist: new `apps/api/src/friendships/**`; explicit module wiring `apps/api/src/app.module.ts` (present at inspected base); `safety/safety.service.ts`, `profiles/profiles.service.ts`, reviewed supported account-lifecycle/epoch guard paths; `database/schema.ts`; next-free `apps/api/migrations/NNNN_friendship_core.sql`; `config/env.ts`; `packages/contracts/openapi.json` and exact generated export paths; new friendship integration fixtures and narrowly named retained regressions. Expand a shared path only in the reviewed admission, not opportunistically. Recheck module wiring at actual admission.
3. Exclusive conservative `api,schema-contracts` locks or independently proven current hierarchy equivalents; no lowering another active lock. Exclude `apps/web/**`, Game/Participation/Invitation/DM/Radar behavior changes, recommendation table/API, Runner/backlog, real accounts or runtime. Any proven shared-lock repair needs a separate or explicitly expanded bounded assignment before acceptance.
4. Exact additive migration/DTO/flag-OFF/replay/error plan, supported lifecycle writer inventory, nonresurrection and real SQL schedule criteria from [S1 contract](S1_CONTRACT_AND_CONCURRENCY.md). No inferred graph, numeric Owner default or new account deletion feature.
5. Producer source checks/build/typecheck/lint and disposable PostgreSQL migrations/concurrency/retained auth/seat/DM/Invitation/Radar regression evidence; separate independent QA candidate-bound verdict and transport. Flags/release/Legal remain separate.
6. New immutable source SHA/tree/base/branch/handoff/receipt, no main merge/install/deploy/next-task authority. QA FAIL/BLOCKED terminal for that candidate; any repair requires new separately admitted candidate/lineage.

Existing conditional S1–S4 prompt files are planning records, not active admission. This executor changes none of them. S2 waits for S1 independently accepted merged stable contract; S3 active recommendations wait for S2 (formal/managed facets may be planned earlier); S4 waits for accepted S1–S3 API plus DD freeze/free web writer; S5 independent integration and S7 Legal/release remain separately gated.
