# #506 MOD-V2-C1 — local private-message safety (SOURCE repair 43)

Base reviewed: `8775f396ce7791346bed6ff79b86dcdd99eed4b5` (QA42 FAIL). Parent DEV: alpha.53 ACCEPTED (`79e51ff2…` / `r42441987882-a1`). Application notes: **0.1.0-alpha.54** (UAT `NOT_TESTED`, `source_sha` null). API contract **0.37.0** (compatible; no new request fields). Cursor Auto sole source writer. Attempt **43** (SOURCE repair of QA42 threefindings; original 42 paid results/FAIL preserved). C2/D/#507 **not** done. Private external gates remain **BLOCKED/OFF**. M1/public moderation/quota Jan 1 unchanged.

## QA42 repair delta (this attempt)

1. **HIGH** `private-text-policy.ts` — narrowed obvious-direct-threat matching: removed ambiguous roster verb `уберу тебя`; match bounded whole phrases only; strip clearly delimited quoted spans before threat check so attributed quotes allow while unquoted RU/EN threat controls still reject. Added allow regressions for roster removal + attributed quote probes; no private provider / no automatic sanctions; raw body storage unchanged; version remains `private-local-safety-v1` (C1 not yet published).
2. **MEDIUM** `releases-server.test.ts` — seed deployment count expectation **62** / upper accepted **alpha.53** (trusted alpha.53 seed); `releases.ts` history/seed fields untouched.
3. **LOW** `private-message-safety.test.tsx` — replaced GameConversation source-string guard with rendered draft behavior via real mutation callback: policy 422/429 keeps draft; 401/403/404 clears draft and shows private access loss. No production GameConversation/hook change required for this delta.

## What landed (C1 only — parent + repair)

- `apps/api/src/moderation/private-text-policy.ts` — versioned `private-local-safety-v1`: unsafe URL/schemes, basic contiguous spam, identical-body flood + bounded send rate, narrowly listed **direct unquoted** threats. Plain profanity / criticism / quotes / sports talk / roster-removal alone are allowed. No `approveTexts` / OpenAI / provider I/O. No automatic sanctions.
- Wired after access authorization and before INSERT/sequence/preview/push on DM create/send and game chat send (parent 42).
- UI: neutral `PRIVATE_TEXT_*` copy; `GameConversation` retains draft on policy 422/429 and clears on real 401/403/404 access loss (parent 42; behavior covered by rendered regression in 43).
- Release alpha.54 delta + exact trusted alpha.53 seed in history (parent). Coverage matrix C1 SOURCE row; C2/D/#507 remain; privacy gates OFF.

## Paths touched (attempt 43)

| Area | Path |
| --- | --- |
| Policy | `apps/api/src/moderation/private-text-policy.ts` |
| Policy unit | `apps/api/test/unit/private-text-policy.test.ts` |
| Release fixture | `apps/web/test/releases-server.test.ts` |
| Draft UX test | `apps/web/test/private-message-safety.test.tsx` |
| Handoff | `docs/handoffs/moderation506-c1-private-local.md` |

## Checks (author)

- Unit: private-text-policy finite rules + QA42 allow probes + unquoted threat reject controls + live/purged payload match.
- Web: releases-server seed count 62 / alpha.53; GameConversation rendered draft retain/clear; existing onRefresh failure-detail + copy tests.
- No Git / paid providers / liveDB / runtime slots / PROD by author.
- Integration HTTP suite not re-run this repair (unchanged send wiring; policy unit covers false-positive delta).

## Limits (honest)

- Author marks **SOURCE repair 43 pending QA/CI/DEV** — not DONE.
- Independent SolMedium QA (delta of these 3 findings), Product CI, guarded DEV ACCEPTED, Owner UAT — **pending** (`source_sha` null, UAT `NOT_TESTED`).
- C2 message report/consent/Cases not implemented.
- Private external processing remains OFF; no legal signoff invented.
- Quantity pause hard Jan 1 unchanged; M1/public text budgets untouched.
- No Mode B binding claim; no whole-MOD READY/ACTIVE; no universal NLP claim.

## Next gates

Independent Codex Sol Medium QA (exact findings/related delta only) → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
