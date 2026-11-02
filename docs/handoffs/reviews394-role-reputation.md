# Handoff · #394 role reputation usable public roundtrips (attempt 22)

Assignment: `OWNER394_ROLE_REPUTATION_USABLE_PUBLIC_ROUNDTRIPS_AND_REAL_HUMAN_HTTP_REPAIR`
Base: `0501f20c55142305e2ea5446751d7dd10327ee9e`
Attempt: **22** · continues preserved #394 history (not UNKNOWN replay)
Parent: #372 · coordinated with same branch next UI pass
C5 OFF · PROD forbidden · no Git commit/push/deploy in this author pass

## Scope of this pass

Backend API integration readiness repair **before** frontend.
Repairs public reply/report addressing, revision/version DTO fields, reply consent preview,
listMine intake progress, multiline plain text, safe public displayName, and real HTTP fixtures.
**UI + changelog + release notes follow on the SAME source branch / SAME PR** after actual HTTP proof.
This pass does **not** claim QA/CI/DEV/human UAT or whole usecase DONE.

## Exact changes (this pass)

### Consumer API (`role-reputation.*`)
1. **Public handle addressing** — `POST /role-reviews/{reviewHandle}/reply-commands` and
   `POST /role-reviews/{reviewHandle}/reports` resolve `reviewHandle` (32-hex) server-side.
   Own commands remain UUID from `/me/role-reviews`. Optional `gameId` on report for
   game-context surface re-check (handle alone is not authorization).
2. **Public revision fields** — items expose `publishedRevision` (approved review
   `resource_version`) and `replyAggregateVersion`; published reply exposes
   `publishedRevision`. Queried from approved revision rows, not pending.
3. **Consent preview** — discriminated `targetKind: "reply"` (reviewHandle + text) for
   historical subject reply hash including server-derived reviewRevision; existing review
   preview remains backwards-compatible; self-review still forbidden; no client subjectUserId.
4. **listMine** — latest intake progress returns `waiting_intake` / `linked` with receipt
   (no longer filters only `waiting_intake`).
5. **plainBounded** — CRLF→LF, allow newlines, reject NUL/other controls, keep 500 bound.
6. **displayName** — `safePublicDisplayName` on public projection (same as ProfilesService).

### Contracts
- OpenAPI path params for reply/report → `reviewHandle` 32-hex pattern
- `PublicRoleReviewItem` / reply DTO revision fields
- Consent-preview `oneOf` review|reply

### Tests
- Consumer disposable: complete games SQL fixture (deadline + required fields + attendance user_id
  + transitions versions); public read → handle/revision → pending not public → human HTTP
  approve → report/reply via handle + server preview; multiline text.
- Admin disposable: one real HTTP e2e submit → intake → source → approve → public → report →
  remove/restore → own withdraw; COI/subject cannot intake; unassigned source denied; stale
  revision + generic status≠publish; stale step-up; AJV against current OpenAPI where used.
- Unit: reply hash binds `reviewRevision`.

## Remaining (same branch / same PR — next UI pass)

1. Consumer UI: discovery trainer filter, game detail, public profile sections, own composer/consent,
   review drawer — use public `reviewHandle` + `publishedRevision` / `replyAggregateVersion`,
   consent-preview `targetKind: "reply"`, multiline text; never private slot/account/game IDs
   for reply/report.
2. Admin Cases UI buttons for pending kind + decide/basis
3. Alpha changelog / release-agent description (not this pass)
4. Trusted PMA: real DB migrate, types, contracts check, disposable HTTP with PostGIS
5. Independent Codex Sol Medium QA → Product CI/security → merge `dev` → DEV ACCEPTED smoke
6. Human moderation UAT = **NOT_TESTED** until authorized Admin session observes approve/remove/restore

## Author checks run / not run

| Check | Result |
|---|---|
| Unit policy test | source updated; not executed in author slot (no node_modules / no DB) |
| Disposable DB HTTP | **notrun** (no dedicated disposable DB in author slot; PMA runs after import) |
| Product CI / security / DEV smoke | not claimed |
| Independent QA | not started |
| Owner UAT | NOT_TESTED |

## Known issues / notes

- Missing historical proof for pre-0054 games remains honest `missing_history`.
- Venue writer CLOSED unchanged; private PG-3 never published via this path.
- Knowing opaque `roleHandle` / `reviewHandle` alone cannot bypass profile/game surface gates.
- Pending submissions wait for human intake; offline reviewer does not block consumer POST receipt.
