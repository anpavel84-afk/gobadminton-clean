# Visual QA #467 — comments actions + postgame copy (pass 2)

Refs: #467, #394. Base SHA `4b6d8c3f7ee4bd382c362014b74a4a73afe56b49`.
No production code changes. Owner UAT: **NOT_TESTED**.

## Route / materials

- QA route: `/games/2cd8b137-8582-4974-8ce0-bd146dc20d93`
- Design: COMMENTS_STYLE_GUIDE (GAME Q&A)
- Findings: pass-1 Typecheck PASS; targeted 49 tests → 46 PASS / 3 FAIL (exact log)

## Test repairs only (allowed paths)

1. **comments-private-boundary** — two `kind=game` scenarios no longer reuse venue `emptyPage`/`replyComment` entityKind/entityId. Page + item fixtures bind `entityKind: "game"` + exact `gameId` + parentCommentId for own-menu and deleted-root/replies. Entity-binding validator unchanged; real list→render path kept (no bypass). Assertions preserved: own 2 actions, other-author safety, deleted metadata absent, replies kept; venue negative fixtures untouched.
2. **releases-server** — seed count strict equality updated 23→**24** after accepted alpha.16 seed; test name → twenty-four / alpha.1–alpha.16; alpha.16 allowed in version allowlist; duplicate-history guards unchanged.

## Out of scope

No source/version/API/permissions/gate changes; no skipped tests; no PROD.
