# #506 MOD-V2-C1 — local private-message safety (SOURCE candidate)

Base accepted: `79e51ff2b0b4846a9fee3be0f429f3f3d6c822ab` (alpha.53 ACCEPTED / `r42441987882-a1`). Application notes: **0.1.0-alpha.54** (UAT `NOT_TESTED`, `source_sha` null). API contract **0.37.0** (compatible; no new request fields). Cursor Auto sole source writer. Attempt **42**. C2 exact consent/report Cases **not** claimed. Private external gates remain **BLOCKED/OFF**.

## What landed (C1 only)

- New `apps/api/src/moderation/private-text-policy.ts` — versioned `private-local-safety-v1`: unsafe URL/schemes, basic contiguous spam, identical-body flood + bounded send rate, narrowly listed obvious direct threats. Plain profanity / criticism / quotes / sports talk alone are allowed. No `approveTexts` / OpenAI / provider I/O. No automatic sanctions.
- Wired after access authorization and before INSERT/sequence/preview/push on:
  - `MessagingService.createRequest` (first DM)
  - `MessagingService.sendMessage` (subsequent DM)
  - `GameChatService.sendMessage` (game chat)
- Exact live `clientMessageId` payload/destination/(first-DM) `gameContext` comparison; purged/unprovable → stable `CLIENT_MESSAGE_ID_UNAVAILABLE`; mismatch → `CLIENT_MESSAGE_ID_REUSED`. Fresh DM send-scope auth on duplicate/same-key replay; history-read rules unchanged. Game chat already rechecks membership/lifecycle.
- **No migration 0067** — existing live `body_text`/`kind`/`content_state` suffice; durable fingerprint column not required for C1.
- UI: neutral `PRIVATE_TEXT_*` copy via `messaging-presentation`; `GameConversation` retains draft on policy 422/429 and clears on real 401/403/404 access loss; `useSocialMutation` passes failure details to `onRefresh` (other callers unchanged).
- Release alpha.54 delta + exact trusted alpha.53 seed appended to history. Coverage matrix C1 SOURCE row; C2/D/#507 remain; privacy gates OFF.

## Paths touched

| Area | Path |
| --- | --- |
| Policy | `apps/api/src/moderation/private-text-policy.ts` |
| DM | `apps/api/src/messaging/messaging.service.ts` |
| Game chat | `apps/api/src/game-chat/game-chat.service.ts` |
| Web UX | `GameConversation.tsx`, `useSocialMutation.ts`, `messaging-presentation.ts` |
| Tests | `private-text-policy.test.ts`, `private-message-safety.test.ts`, `private-message-safety.test.tsx` (+ focused release/fr04 asserts) |
| Contract | `packages/contracts/openapi.json` (descriptions + 429; API 0.37 compatible) |
| Coverage / release / handoff | `CONTENT_MODERATION_V2_COVERAGE_V001.md`, `releases.ts`, this file |

## Checks (author)

- Unit: private-text-policy finite rules + live/purged payload match.
- Integration: synthetic HTTP for 3 send paths, reject rollback, duplicates/cross-context, purged, block fence, fetch egress spy (skips without `RUN_DB_INTEGRATION=1`).
- Web: policy copy + onRefresh failure details + GameConversation draft retain source guard.
- No Git / paid providers / liveDB / runtime slots / PROD by author.

## Limits (honest)

- Author marks **SOURCE pending QA/CI/DEV** — not DONE.
- Independent SolMedium QA, Product CI, guarded DEV ACCEPTED, Owner UAT — **pending** (`source_sha` null, UAT `NOT_TESTED`).
- C2 message report/consent/Cases not implemented.
- Private external processing remains OFF; no legal signoff invented.
- Quantity pause hard Jan 1 unchanged; M1/public text budgets untouched.
- No Mode B binding claim; no whole-MOD READY/ACTIVE.

## Next gates

Independent Codex Sol Medium QA (exact findings/related delta) → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
