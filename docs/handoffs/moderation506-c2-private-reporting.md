# #506 MOD-V2-C2 — exact selected-message reports + Cases source (SOURCE 51)

Base: frozen `b549ecc632fcca0123d77dae5c46d16fcbc6bfdf`. Application notes: **0.1.0-alpha.55** (UAT `NOT_TESTED`, candidate not published). Trusted accepted seed latest **alpha.54**. API contract unchanged this pass. Cursor Auto sole source writer. Attempt **51** (parent QA50 FAIL + prior parent failures preserved). C2 app behavior not independently accepted. Private external egress remains **OFF**. Not DONE / not DEV ACCEPTED. Pending QA/CI/DEV.

## Retention selection (explicit)

Reference-only `message_report_bindings` (HMAC fingerprint + consent + identity). Exact-source body read only while original `messages.purge_eligible_at` is **finite and future**. **NULL expiry → unavailable** (Owner legacy question unanswered; mandatory strict fallback). No new 14-day retention, no TTL mutation, no body copy into `case_evidence_items`.

## Attempt 51 repair (QA50 HIGH — allowed paths only)

- `SafetyService.assertGameChatReadAccess`: align with canonical `GameChatService.assertChatAccess` — accept only `game_managers.status === 'active'`, else confirmed `participations.status === 'confirmed'`; preserve published ∧ before `ends_at` lifecycle and existing account/hidden/access rejection path. Revoked manager with materialized `conversation_members` and no confirmed participation denied on first report and idempotent replay.
- API integration `private-message-reports.test.ts`: HTTP regression — materialized membership, revoke `game_managers` only, pending (non-confirmed) participation; revoked peer cannot readchat or report incoming exact message (fresh key + replay + second key); no extra `message_report_bindings` / `abuse_reports` on reject; active owner-manager and later confirmed participant still allowed via real game/chat/report routes.
- No versions/history/schema/provider/runtime/DB/Git/env/slots changes. GameChatService and private DM rights untouched.

## Checks (author)

- Input QA50 `final.txt` FAIL finding retained (revoked manager without `status=active`).
- Local `node_modules` / DB integration may be unavailable in this sandbox → package typecheck and focused `RUN_DB_INTEGRATION=1` HTTP suite **NOT_RUN** here; parent runs exact HTTP suite / API types / lint then independent delta QA.
- No push/merge/deploy; no slots/env writes; no provider calls; no private body logs; no Git/runtime/DB.

## Pending gates

Independent Codex Sol Medium QA → Product CI → trusted merge/DEV → smoke → Owner UAT (`NOT_TESTED`). Do not announce DONE / PASS. Candidate pending QA/CI/DEV.
