# #506 MOD-V2-C2 — exact selected-message reports + Cases source (SOURCE 48)

Base: trusted DEV alpha.54 `cce49ce72daed8c81f89ddc845deabbb8ac5d7aa` (C1 local send ACCEPTED). Application notes: **0.1.0-alpha.55** (UAT `NOT_TESTED`, `source_sha` null). API contract **0.38.0** (additive message report + Cases source). Cursor Auto sole source writer. Attempt **48**. C1 behavior preserved; no paid architecture; private external egress remains **OFF**. Not DONE / not DEV ACCEPTED.

## Retention selection (explicit)

Reference-only `message_report_bindings` (HMAC fingerprint + consent + identity). Exact-source body read only while original `messages.purge_eligible_at` is **finite and future**. **NULL expiry → unavailable** (Owner legacy question unanswered; mandatory strict fallback). No new 14-day retention, no TTL mutation, no body copy into `case_evidence_items`.

## What landed

- Migration **0067** + rollback: `abuse_reports.target_kind` adds `message`; immutable `message_report_bindings`.
- `POST /v1/reports` discriminated `targetKind=message` with exact `messageId` + XOR `conversationId`/`gameId`, reason/detail, `shareMessageWithSupport=true`. Server resolves author/content; rejects own/foreign/hidden/purged; DM readable after block without send/unblock.
- Cases `GET /admin/cases/:id/message-reports/:reportId`: assigned principal (even manager), `evidence.assigned.read`, step-up, link, consent, COI, fingerprint + availability.
- Web: ConversationSafety message mode (select one loaded incoming + consent); DirectConversation / GameConversation pass loaded history + context. Player-only report remains.
- Admin Cases: typed exact-source action + clearing on case/assignment/session/errors; honest limited-availability copy.
- Tests: API integration, migration smoke, web selection/consent, Admin Cases clearing (allowlisted path).
- Releases: alpha.55 current; **entire** trusted alpha.54 seed preserved.

## Checks (author)

- Targeted TypeScript/vitest where runnable without DB; DB suites authored for parent `RUN_DB_INTEGRATION=1`.
- No push/merge/deploy; no slots/env writes; no provider calls; no private body logs.

## Pending gates

Independent Codex Sol Medium QA → Product CI → trusted merge/DEV → smoke → Owner UAT (`NOT_TESTED`). Do not announce DONE by implementation alone.
