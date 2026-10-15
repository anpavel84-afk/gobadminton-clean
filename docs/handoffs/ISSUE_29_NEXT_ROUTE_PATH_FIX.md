# Issue 29 — narrow Next.js route path validator fix

From: Codex implementation → authorized executor maintainer / independent reviewer.  
Date: 2026-10-15. Status: READY_FOR_REVIEW; local uncommitted candidate.

Owner-authorized scope: fix the existing single executor's rejection of preserved
Issue 37 source path `apps/web/src/app/venues/[venueId]/page.tsx`. This is not
Issue 37 product authoring, recovery redesign, or new architecture.

Base: `9a44206ccaa9ed43c5d7492801d8c5ad3f47dcf9`, branch
`automation/next-route-validation-20261015` (initial working tree clean).
[Exact base](https://github.com/anpavel84-afk/gobadminton-clean/tree/9a44206ccaa9ed43c5d7492801d8c5ad3f47dcf9).
Changed artifacts: `scripts/chatops/autonomous_issues.py`,
`scripts/chatops/tests/test_autonomous_issues.py`, and this handoff only.

## Behavior and boundaries

`safe_path` admits brackets only in entire segments matching
`\[[A-Za-z][A-Za-z0-9_]*\]`, underneath the exact literal
`apps/web/src/app/` prefix. Examples: `[venueId]`, `[gameId]`,
`[publicPlayerId]`. A validation-only copy substitutes the identifier for such
segments before applying the existing character grammar. The function returns
the original string unchanged for argv-based git; no decoding or normalization.

Catchall, optional, embedded, malformed and outside-prefix brackets fail closed.
Existing type/240-character limit, traversal/dot/empty-component checks,
control-document restrictions, secret names/extensions and allowed-path admission
remain. Symlink enforcement, private checkpoint/sandbox/GitHub key denial and
PROD gates are untouched. Route admission grants no additional task authority.

## Evidence and remaining gates

Author offline self-checks (FACT):

- `TMPDIR=/tmp/gb-model-zbbp20tx python3 -B -m unittest scripts.chatops.tests.test_autonomous_issues`
  — 35 tests passed, including two new regression methods covering literal routes,
  allowed-path/comment admission, and traversal/control/secret/shell/encoding/
  backslash/catchall/embedded/outside-prefix rejection.
- `git diff --check` — passed.

Independent QA: **NOT_YET**. CI: **NOT_YET**. Runtime install/executor retry:
**NOT_YET**. Issue 37 completion or deployment is not established by these checks.
No product, service, real checkpoint, worktree, git-metadata, CI/config, secrets,
network or PROD changes; no commit or push. Offline fixtures are disposable.

Publication is pending under the explicit no-commit/no-push assignment; no result
SHA or GitHub result permalink exists yet. This file records the assignment and
candidate for later authorized publication, without claiming durable publication.

Next bounded action: independent reviewer inspects this three-file candidate and
its offline evidence. Runtime installation or preserved-source retry requires its
own authorized step. Rollback: reverse only this candidate's three-file diff;
no runtime rollback is needed because runtime was not changed.
