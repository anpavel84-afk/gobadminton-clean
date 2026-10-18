# Post-game API contract design v001

Status: **TECH_SELECTED design, NOT executable OpenAPI / NOT implemented**.
Baseline: af210f82e65ab028f8e06927a88175d1ac373c31.
Normative semantics: [architecture](../architecture/POST_GAME_V001.md).
During admitted implementation update packages/contracts/openapi.json and generated clients together; this document does not add runtime routes.

## Common protocol

Prefix /v1. Current consumer cookie/Origin/CSRF validation and authenticated read policy. Every mutation Idempotency-Key, current actor/resource authorization on execution AND replay, expectedVersion for changed existing resource (0 for absent singleton). Resource identity + normalized body in request hash.
No-store on private success/errors, plain bounded text, unknown fields rejected, ISO8601 UTC timestamps, UUID IDs. Do not accept actorId/visibility/staff status from client. Current API error envelope retained.
400 invalid protocol, 401 no valid session, private 404 indistinguishable missing/foreign, 403 known lost capability, 409 VERSION_CONFLICT / COMMAND_IN_PROGRESS / IDEMPOTENCY_KEY_REUSED, 422 invalid lifecycle/value/context. Return current authorized projection on success, not DB row.
Conflicts do not silently overwrite. Retry unknown transport result with same key/body; changed intent needs new key and current version.

## Target route inventory

| Method/path | Purpose / request | Authorization / response |
|---|---|---|
| GET /games/{gameId}/results | outcome + own permissions; manager bounded roster, cursor/limit | current manager projection; participants only own record and allowed Game info |
| GET /me/game-results | own historical contexts and notices, cursor/limit | self only, survives chat loss |
| PUT /games/{gameId}/outcome | expectedVersion, outcome held/not_held, reason (required not_held/correction) | current manager; outcome/version; Game transition as architecture |
| PUT /games/{gameId}/attendance/{contextId} | expectedVersion, value unknown/present/absent, late optional, correctionReason | current manager; attendance/version/source/dispute status |
| POST /games/{gameId}/attendance/bulk-present | items:[contextId,expectedVersion], confirmedExactSelection:true | current manager; all-or-nothing; no dynamic «remaining» expansion |
| POST /games/{gameId}/attendance/{contextId}/acknowledgements | attendanceVersion; optional resolvingDisputeId with expectedDisputeVersion | self; explicit accept current assertion; silence never writes |
| POST /games/{gameId}/attendance/{contextId}/disputes | attendanceVersion, explanation | self; one open dispute; stale assertion => conflict + reread |
| POST /attendance-disputes/{id}/withdraw | expectedVersion, reason | self only; withdrawal does not rewrite attendance |
| GET /attendance-disputes/{id} | current state + safe revision/history projection | self/current authorized manager/scoped case reviewer |
| PUT /games/{gameId}/notes/{contextId} | expectedVersion, text | current manager creates own note on allowed context; existing author can read/edit own note after revoke without roster access |
| DELETE /games/{gameId}/notes/{contextId} | expectedVersion | own note only; not a deletion of any feedback/report |
| POST /games/{gameId}/reviews | kind, subjectContextId for peer, rating or organizationScore, comment/tags, experienceAssertion, discrepancyExplanation if contested | own relevant context; server derives recipient/visibility/provenance |
| PATCH /reviews/{id} | expectedVersion, own editable text/rating/tags | author only; same review identity, edited marker/history |
| GET /me/reviews | own authored/received, cursor/limit | own/recipient ACL; no public list endpoint |
| PUT /reviews/{id}/reply | expectedVersion, text | designated recipient only; unique singleton, updates retain edited marker |
| POST /reports | existing player payload OR new typed target/context payload | authenticated permitted reporter, including canceled/rejected relation; no directory opt-in requirement for own case |
| GET /me/reports | safe receipt/progress list | own reports only; no staff evidence |
| GET /reports/{reportId} | own receipt/status/request-for-information | reporter or separately authorized staff, distinct projection |
| POST /reports/{reportId}/information | expectedVersion, text/evidenceRefs | own report when accepting information; case-controlled bounded input |

Admin resolution route must use existing isolated admin audience, capabilities, step-up and privileged audit; design command ResolveAttendanceDispute(caseId,disputeId,expectedDisputeVersion,expectedAttendanceVersion,resolution,reason) calls Sessions. It is NOT consumer manager closure. Freeze exact admin path with current Admin contract in slice PG-2; no general admin permission is introduced here.

## DTO semantics

Attendance:
{contextId, value, version, late, assertion:{actorDisplay,source,at}, acknowledgedVersion:null|number, dispute:{id,status,challengedVersion}|null, allowedActions}.
Absent record = unknown/version 0; source/actor null, not fake organizer confirmation.
An open dispute can reference an earlier revision while current assertion changes; expose both safely. The change does not clear open state.
Self-mark by playing manager uses source=self_attested, never independently_verified.

GameResults:
{gameId, outcome:{value:"unknown"|"held"|"not_held",version,reason?}, myAttendance?, roster?, nextCursor?, summary?, allowedActions}.
roster and summary only permitted manager scope. Unknown/dismissed are not completed facts. Rights are UI hints; commands revalidate.
No public response has review text, attendance list, dispute count or personal notes.

Review:
{id,gameId,kind,subjectContextId?,recipientDisplay,rating?,organizationScore?,comment?,tags,experienceProvenance,version,editedAt?,reply?,allowedActions}.
Peer rating required enum play_again/neutral/difficulties. Organization optional integer 1–5; at least score or comment. Training v1 plain experience comment, no skill score. Comment optional for peer; optional tag vocabulary communication/teamwork/agreements.
Neither client nor manager can assign independently_verified. No aggregate player score/count route.
Creation UNIQUE violations translate to existing owned review/conflict, not second vote.
Post-game text limits and per-actor rate budgets must be frozen in OpenAPI before implementation; reuse existing validation/error conventions, no unbounded strings/arrays.

## Typed report compatibility

Keep existing targetKind=player, targetPublicPlayerId, reasonCode, detail, evidenceRefs payload working.
Extend as discriminated union:
- player + optional authorized gameId;
- game + gameId;
- attendance + attendanceId + challengedVersion + consistent gameId;
- review + reviewId + consistent gameId.
Server resolves subject/context; no arbitrary JSON object/URL as authority. Compare cross-object IDs under scoped read, reject mismatches without disclosure.
Existing target_user_id NOT NULL / no-self / target_kind check must evolve only for typed non-player targets; do not weaken existing player no-self behavior.
Existing submitted/closed receipts stay compatible. Add progress projection with in_review/needs_information only with implemented case lifecycle; legacy clients must tolerate new statuses or use separately versioned progress field.
Report reasons extended explicitly (including dangerous_behavior/agreement_issue/abusive_review), not inferred from low feedback. Evidence refs are bounded opaque references/links, never auto-fetched.
No report created merely by attendance dispute; escalation may link existing dispute to one support case without duplicating claims.

## Compatibility checklist

- Contract tests for each DTO audience, forbidden fields, schema examples and errors.
- Additive migrations before new writers; don't reserve migration number until exact base.
- Existing Game/Participation statuses, seats, identity, social directory, DM, invitations unchanged.
- Current old-client reads remain valid; new client handles absent feature/error/unknown, not fabricated zero.
- Staff/evidence and recipient access are server checks, not hidden UI buttons.
- Deletion/hide review commands are NOT generic manager delete; follow authored content withdrawal and audited case moderation policy frozen before exposing such controls.
