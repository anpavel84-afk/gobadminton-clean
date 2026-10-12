# Radar geographic G1 source contract

Status: READY_FOR_REVIEW — source candidate only; no deployment, live policy cutover or real-user consent authorization.
Authority: [PM/Owner freeze](../decisions/RADAR_GEOGRAPHIC_G1_CONTRACT_FREEZE_V002.md), accepted merge `fc4ce7cf7eca7a1cd3ce4a33f2423800862bf00f`; [Architect contract](https://github.com/anpavel84-afk/gobadminton/blob/d18e8217e553ec9b0139df263bfb8317cf4f8ce8/docs/workbench/architecture/social-player-network-messaging-v002/RADAR_GEOGRAPHIC_VISIBILITY_CONTRACT_V001.md).
Wire source: [OpenAPI](../../packages/contracts/openapi.json), version0.17.0.

## Independent viewing

`GET /v1/radar/config` authenticates an active eligible consumer, returns policy/model/disclosure and supported cities, and creates no presence or profile. Configuration has an account-wide30/min budget. `enabled` reflects the separate source-staged switch. Map availability is **missing**: this task verified no registered artwork, and list-only rendering is required.

`POST /v1/radar/results/query` is an authenticated cookie read with exact Origin, CSRF and a compatibility Idempotency-Key header. The key is validated, but no geographic response is stored in an idempotency receipt. Query and preview responses are no-store. A city query with `{kind:none}` uses no GPS, viewer consent, presence or social-profile bootstrap. An explicit social restriction denies viewing; an absent profile does not.

Inputs are strict city/scope/origin unions; unsupported city, arbitrary bbox/target/search filters, radius outside3/5/10, coercible strings and unknown properties fail. Moscow is admitted for live namespace; Moscow/SPB for synthetic namespace. Profile city is not geographic authority. Owner debug global is never a general query city.

This is a separate Radar subset, K=1, cap20, no pagination or totals. The ordinary Players directory endpoint, search, filters and pagination remain independent. No-origin ordering is a stable city sample, never nearest. Origin ordering uses exact distance between **coarse** centers in SQL, then stable server-seeded hash/public ID; the total order precedes LIMIT20. Radius applies only to nearby. Queries have a2s statement and lock timeout, fail safely with503 on timeout, and use regional/policy and GiST indexes.

Every location comes from the stored1000m regional grid center, WGS84 rounded to5 decimals. The digits locate the cell center, not a person's accuracy. No raw GPS/accuracy/cell index/target session timestamps, numeric peer distances or displaySlot is returned. Snapshot generatedAt/validUntil is absolute, bounded by45s and current target/session/origin validity. Client must subtract network delay, replace the set and clear stale frames; G2 implementation is separate.

Private foreground origin is quantized without creating presence/consent/profile; current_activation requires same-session ownership/current policy/region. Signed originRef contains only the viewer's own coarse center and binding, and is readable, not encrypted. It is memory-only, expires by captured fix+6min/session, and reuse/renewal does not extend that expiry. Activation-origin version/generation changes invalidate it. Query cadence1/30s and120/hour, geo12/hour, preview10/min, city changes6/15min, radius cooldown5min/2 changes per15min are account-wide, surviving session/STOP/start changes. Context counters store only quota hashes, not fixes or results.

## Explicit sharing and withdrawal

`SOCIAL_RADAR_GEOGRAPHIC_ENABLED` defaults **false**, independently of existing live/demo flags. No deployment/compose/runtime flags are changed by this candidate. While false, legacy Radar semantics and proofs remain selected; geographic query is disabled. Config advertises capability/version without publishing anything.

After a separately admitted coordinated cutover, start/takeover requires exact `consentPolicyVersion=radar-geographic-sharing-v1`, a valid foreground fix and explicit ON. First acceptance also requires `consent={disclosureId:'radar-geographic-sharing-v1.ru.v1',accepted:true}`. Exact locale/text/SHA256 are in the immutable disclosure registry. An existing current receipt may support later explicit ON; old boolean/privacy/OAuth/legacy policy never authorizes new geographic publication. A failed activation rolls back any acceptance. Idempotent replay cannot duplicate an event or resurrect a stopped generation.

Migration0021 adds a disclosure registry, non-geographic accepted/withdrawn events, current profile/presence evidence references and a regional index; no consent/presence backfill or durable location history. Composite FKs prevent evidence from another user. Presence stays UNLOGGED. Generic social-profile `radarConsented:true` is rejected after cutover. False/social restriction appends withdrawal, clears evidence/projection and deletes presence in the existing transaction. Directory opt-out alone does not withdraw geographic consent.

One owner/session/generation, CAS, foreground90s, location6min, TTL15min and hard lifetime30min remain. Heartbeat/renew without a new accepted fix cannot extend fix validity. STOP uses exact generation, bypasses viewer/policy/quota gates, and cannot delete a newer takeover. Geographic own status remains readable when ordinary exposure switches are off; legacy status behavior remains unchanged while geographic switch is off. Status expiry cleanup compares the observed generation/version and rechecks expiry, protecting concurrent refresh.

## Current proof and contact fences

v2 resultRef uses a separate signature purpose and strict schema: wire audience, policy, viewer/session/query/city/region/namespace/scope/origin, target public identity/generation/version and bounded issue/expiry. It carries **no target coordinates**. No reciprocal viewer ON is required. Invalid supplied proof, including empty string after cutover, cannot fall back to directory. v1 never redeems a geographic target.

Issuance proves prior inclusion; unrelated top20 churn does not revoke a still-safe target. Preview/contact revalidates current target receipt/policy/account/owner session/generation/region, natural expiry, origin and bilateral block. DM still requires independent directory/contact permission; invitation still requires current Game management/lifecycle/capacity rules. No-proof ordinary contact and existing conversations/invitations remain independent.

Contact order is actor/session → idempotency → existing Game/profile fences → Pair → command object/participation locks → presence SHARE → current plain eligibility reads → persistence. A final geographic authority/clock read after persistence uses already-held visibility fences and introduces no earlier-order locks. No second account SHARE lock is acquired for a geographic first contact. Identity ActorFence uses NO KEY UPDATE: it still conflicts with actor status mutations/deletion and serializes own commands, but permits foreign-key KEY SHARE references needed by opposed contacts and revoke/contact races. This narrow lock-strength correction affects no identity IDs or permissions.

Account status retirement invalidates its presence via an additive same-transaction database trigger, including accounts with no uploaded avatar. DM Game-context validation takes the Game lock before Pair, matching invitation lock order.

Session revoke/owned revoke/revoke-others lock the account before session changes, delete owned presence in the **same transaction**, and serialize with OFF-viewer commands as well. Withdrawal also conflicts with target presence in its eligibility transaction. Pair blocks conflict with the same Pair fence. No target identity/profile/session locks are acquired after presence; final reads use wall clock after waits. A contact owning the fence can commit before a waiting revocation; a revocation that commits first denies new contact. Already delivered snapshots may remain visible up to their absolute lease and cannot erase screenshots.

## Recovery, logging and release boundary

No geographic query/preview bodies or peer locations enter audit, jobs, outbox or mutation receipt bodies. New read services do not log raw fixes/tokens/results; existing Fastify default logs request metadata, not POST bodies, and Radar metrics remain allowlisted. Origin/result refs belong only in POST bodies and client memory; operational HTTP/body/SQL logging must preserve redaction before separately authorized release.

Keep logical backup `--exclude-table-data=radar_presences`; UNLOGGED alone is not backup exclusion. Restore/rollback must empty all presences before serving traffic, retain consent evidence without activating it, and rotate `RADAR_GEOGRAPHIC_TOKEN_EPOCH` to invalidate restored-session transient origin/result tokens. Epoch is a nonsecret purpose/key namespace, default source-stage-v1; it is independent of provider/session credentials. Real backup/restore, live consent retention/operator wording and release remain separate operational gates.

Independent QA must bind the immutable code candidate, reproduce synthetic PostGIS/privacy/race evidence and explicitly recommend merge. Source QA/merge gives no deployment, provider, real-user GPS or live consent authority, and does not start G2.
