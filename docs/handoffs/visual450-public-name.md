# Handoff — #450 public name + Russian release repair

**Assignment:** VISUAL450_QA1_MESSAGING_INBOX_NAME_REPAIR
**Author:** cursor:auto · attempt 2 · base `0cb55d788e1f984ea834202f8f1b694daf67f3ad`
**App candidate:** `0.1.0-alpha.9` · API wire unchanged `0.22.0` · UAT=NOT_TESTED
**Refs:** #450 · originating visual report PR #449 / #448 · Style Guide `PLAYER_BROWSING_STYLE_GUIDE.md`

## Materials read

- QA1 `final.txt` (verdict FAIL on `0cb55d7…`) — conversation/inbox peer DTO leak
- Prior pass-1 handoff retained below as history; this pass addresses QA1 only

## QA1 FAIL retained (pass 1 candidate)

Independent Codex Medium QA1 FAIL: after `/players` → Написать → `/messages?to=peer`, conversation DTO returned raw `peer.displayName` from `player_social_profiles` (`messaging.service.ts` ~619/1051); inbox returned raw `title` + `peer.displayName` (~321/332). Email-shaped legacy name would show to the counterpart. Prior public catalogue/profile scrub was correct; messaging/inbox presentation boundaries were uncovered.

## Pass 2 — messaging + inbox presentation boundaries (FIXED in source)

**Change:** reuse existing `safePublicDisplayName` at conversation peer DTO projections (list / get / create-return path) and inbox `projectItem` for `dm` / `dm_request` title + peer. Game invitation / game chat titles stay literal game titles (not treated as private account names). Empty peer still projects «Игрок» when `peer_public_player_id` present. Storage, raw message body, own profile, rights/blocks/restricted/private 404, cursors unchanged.

**Paths:**
- `apps/api/src/messaging/messaging.service.ts` (list ~555, get ~619, loadDto ~1051)
- `apps/api/src/inbox/inbox.service.ts` (`projectItem` title + peer)
- Regressions in existing `ls03.text-dm` + `ls06.composed-inbox` (email-shaped peer → «Игрок» in conversation/summary title/peer; ordinary names; game chat title with `@` stays; guest 401)

## Pass 2 — alpha.9 user prose (FIXED in source)

- Removed compile-time «Выпуск alpha.9 ещё не принят…» from `known_limitations`; rely on receipt/status fields. Kept truthful «Основной сайт обновляется отдельно.»
- Replaced computerish «хранилище…» with natural Russian; mentioned личные сообщения in the public-name fix line. API wire / app version unchanged `0.22.0` / `0.1.0-alpha.9`.

## Pass 1 history (unchanged claims)

### Finding 1 — public email-shaped name (FIXED in source; catalogue/profile/radar/friendships)

Reuse `safePublicDisplayName` at public DTO boundaries: `profiles` `mapPublic`, unified/geographic/radar (+ proofs), friendships peer. Own-profile `mapOwn` and `users.display_name` untouched. Cursor still encodes raw SQL `display_name`.

### Finding 2 — «Kirill Panov» / directory-off bio (NO source change)

Owner #448 keeps proven immutable initial synthetic defaults ON and real modified OFF. Exact cohort verification remains trusted-operator.

### Finding 3 — Russian release history (FIXED in source; pass 1)

`CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.9`; accepted alpha.8 in `TRUSTED_HISTORICAL_SEED`. Pass 2 only adjusted transient acceptance claim + prose wording above.

### Finding 4 — trainer-profile 404 (NO source change; exact behavior)

HTTP 404 for missing trainer is not an app error banner. API contract unchanged.

### Finding 5 — game chat 404 for non-participant (NO source change; HOLD)

Private fence retained. Remains open from #445 p.4. Out of scope for this repair.

## Checks

- Author: targeted source edits only on allowed paths; no package/lock/rules edits.
- Integration regressions authored in `ls03` / `ls06`; full DB suite may be unavailable in isolated author — trusted operator runs actual current candidate.
- Prior pass-1 recorded: API/web typecheck PASS, helper unit PASS, isolated PostGIS ls01 + radar.unified PASS; release tests PASS after restored authored module.
- Remaining: independent QA of this repair, Product CI, security checks, DEV ACCEPTED + smoke; Owner UAT=NOT_TESTED.

## Explicit non-claims

- Source PASS ≠ runtime READY/ACTIVE. No PROD activation. No new framework/architecture/High/model research.
- Independent Codex Medium QA + Product CI + DEV release still required after this author pass.
- PG-3/PG-4/C5 untouched. Original authored test module not recreated/duplicated/deleted.
