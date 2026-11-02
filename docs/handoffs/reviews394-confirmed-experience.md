# Handoff · #394 confirmed experience + missing mark

Assignment: `OWNER_20261102_REVIEWS394_CONFIRMED_EXPERIENCE_AND_MISSING_MARK`
Base (this repair): `9e9f8ece2358375b7653765dea9671c65ea02bac`
Prospective app: `0.1.0-alpha.16` · API `0.26.0` · UAT `NOT_TESTED` · `sourceSha: null`
#394 remains **PARTIAL** until venue-publication / typed reviewSafety.

## QA1 FAIL (preserved) — two findings, this pass repairs only

1. **P1** peer create: `authorizeReplay` + `ownedPrior` returned successful receipt after author → absent without CURRENT confirmed-experience gate.
2. **P2** UI: saved `unknown` with `version>0` shown as missing («Посещение ещё не отмечено» / «Отметки пока нет»).

QA1 accepted unchanged: staffCases / migration / normal-eligible / org+training / role checks + disposable DB suite logs.

## Repair delivered (attempt 11)

- **P1.** Shared `assertCurrentPeerCreateAdmission` under game lock: ended + published|completed + held + historical eligibility BOTH + permitted present BOTH + no open dispute BOTH. Applied before ANY peer create response — same-key `authorizeReplay`, ownedPrior/new-key duplicate, and new insert. Private GET/history/edit unchanged; no delete/public expose of old reviews. Integration expects 422 `FEEDBACK_PEER_EXPERIENCE_UNCONFIRMED` for same-key + new-key after author absent; private sent history + gameReviews still readable.
- **P2.** `GameResultsComposition`: missing = `my.version===0`; existing unknown = `my.value==='unknown' && version>0` → «Отметка требует уточнения» (+ version). Dialog matches. Clarification still uses actual `attendanceVersion`; no ACK-unknown / fake-present. Open-dispute pill stays «На уточнении». Web regression renders both fixtures (not string-only).

## Not in this pass

Migration / admin / release / digest edits. Public venue writer. PROD. C5. New test framework/matrix/modules.

## Checks (author; not independent QA / not DEV)

- `pnpm install --offline --frozen-lockfile --ignore-scripts`: **notrun** — store missing tarballs (`ERR_PNPM_NO_OFFLINE_TARBALL`); no network per assignment. Trusted PMA has deps + disposable DB.
- Targeted web unit / API disposable integration: **notrun** here (deps/DB unavailable in author slot). Source + assertion edits ready for PMA/CI.
- Product CI / security / DEV smoke / Owner UAT: not claimed READY. Independent QA still required after this repair.
