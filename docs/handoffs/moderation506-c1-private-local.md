# #506 MOD-V2-C1 — local private-message safety (SOURCE repair 47)

Base reviewed: `cec0a179577f3b431111bb057b40a193a4760368` (contraction-delimiter FN probe). Parent DEV: alpha.53 ACCEPTED unchanged; alpha.54 not deployed. Application notes: **0.1.0-alpha.54** pre-release policy source (UAT `NOT_TESTED`, `source_sha` null). API contract unchanged. Cursor Auto sole source writer. Attempt **47** (SOURCE repair of apostrophe-as-quote-delimiter false negative; attempts/FAIL/CI1 lint FAIL / CI2 CEC history retained). C2/D/#507 **not** done. Private external gates remain **BLOCKED/OFF**. M1/public moderation/quota Jan 1 unchanged.

## Attempt 47 repair delta

1. **`stripClearlyQuotedSpans`** — ASCII `'` inside contractions/names (`I'll`, `you're`, `O'Brien`) is **not** a quote boundary. Standalone paired quotation `'` still strips attributed spans; unquoted remainder is checked. No threat-dictionary / rate / auth / UI / schema / metadata change. Version remains `private-local-safety-v1`.
2. **Unit regressions** — exact reproduced unquoted `I'll kill you if you're late` → reject; contractions/names + quoted attribution → allow; mixed quoted attribution + unquoted direct threat → reject. Prior roster / attributed-quote allow and RU/EN reject controls kept.

## What landed (C1 only — parent + repairs)

- `apps/api/src/moderation/private-text-policy.ts` — versioned `private-local-safety-v1`: unsafe URL/schemes, basic contiguous spam, identical-body flood + bounded send rate, narrowly listed **direct unquoted** threats. Plain profanity / criticism / quotes / sports talk / roster-removal alone are allowed. Word-internal apostrophes are not quote delimiters. No `approveTexts` / OpenAI / provider I/O. No automatic sanctions.
- Wired after access authorization and before INSERT/sequence/preview/push on DM create/send and game chat send (parent).
- UI / release / seed paths **not** touched in attempt 47 (policy delimiter only).

## Paths touched (attempt 47)

| Area | Path |
| --- | --- |
| Policy | `apps/api/src/moderation/private-text-policy.ts` |
| Policy unit | `apps/api/test/unit/private-text-policy.test.ts` |
| Handoff | `docs/handoffs/moderation506-c1-private-local.md` |

## Checks (author)

- Unit: private-text-policy finite rules + QA42 allow probes + unquoted threat reject controls + contraction-delimiter regression + live/purged payload match.
- No Git push/cancel/retry Actions; no paid providers / liveDB / runtime slots / PROD by author.
- CI2 on immutable CEC may complete independently; does **not** qualify this latest candidate.

## Limits (honest)

- Author marks **SOURCE 47 pending targeted QA / new full CI** — not DONE.
- Independent SolMedium QA (delimiter delta), Product CI, guarded DEV ACCEPTED, Owner UAT — **pending** (`source_sha` null, UAT `NOT_TESTED`).
- Original independent reviews and CI1 lint FAIL retained; CI2 CEC not latest-candidate qualification.
- C2 message report/consent/Cases not implemented.
- Private external processing remains OFF; no legal signoff invented.
- Quantity pause hard Jan 1 unchanged; M1/public text budgets untouched.
- No Mode B binding claim; no whole-MOD READY/ACTIVE; no universal NLP claim.

## Next gates

Independent Codex Sol Medium QA (exact delimiter findings/related delta only) → Product CI → trusted merge/DEV → smoke → Owner UAT (NOT_TESTED until then).
