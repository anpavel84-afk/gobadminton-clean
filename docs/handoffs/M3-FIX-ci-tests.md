# M3-FIX — lifecycle listener and map test handoff

- From: Codex, source author.
- To: GoBadminton integrator, then independent QA.
- Date: 2026-10-20.
- Status: READY_FOR_REVIEW; typecheck/tests NOT_TESTED; not independently QA-verified or accepted.
- Exact base: `bce61bcc38830c7e0909f9e57b4ec4641313b2c5` (HEAD, `automation/issue-131`); initial tracked diff empty.
- Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/bce61bcc38830c7e0909f9e57b4ec4641313b2c5
- Assignment: source-only M3-FIX, issue-131 worktree; fix exactly the obsolete map navigation test and the two Tab cleanup cases after PR #128 / Issue #127. No API/contracts/data/dependencies/workflows changes. No git metadata writes, publication, installation, network access, services or deployment authorized.
- PM-reported CI source: https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/39353858661/job/118404048646 (reported 3/659 failures; not fetched or independently verified offline).
- Binding map direction: [OWNER_DECISION_MAP_POPUPS_V001.md §1](../decisions/OWNER_DECISION_MAP_POPUPS_V001.md).

## Diagnosis: facts and limits

Source inspection confirms that `GamesMapView` selects a real `VenuePreviewCard`, then its `onOpen` renders `VenueSheet`. The old expectation of `location.assign` to `/venues/venue-id` contradicts that flow and the Owner decision. `GamesMapView.tsx` was read only.

The two existing parameterized Tab cases require no reaction after effect cleanup. In this checkout Vitest uses `environment: "node"` and the test window is a real Node `EventTarget`. A standalone diagnostic executed on Node **v24.21.0** (exit 0) reproduced the options behavior:

```js
for (const options of [true, { capture: true }]) {
  const target = new EventTarget();
  let calls = 0;
  const listener = () => calls++;
  target.addEventListener("keydown", listener, options);
  target.removeEventListener("keydown", listener, options);
  target.dispatchEvent(new Event("keydown"));
  console.log(JSON.stringify(options), calls);
}
```

Observed output:

```text
true 1
{"capture":true} 0
```

This confirms a local Node EventTarget boolean-capture cleanup behavior that explains the post-cleanup Tab interception. It is **not** evidence of mismatched handler references: the original effect already used the same keydown function, window and capture=true. The CI runtime/logs and browser behavior were not independently examined, so attribution of all three reported CI failures rests on source inspection plus this local reproduction, not a rerun of the original CI.

## Changes and acceptance mapping

- **D1:** `VenueSheet.tsx` adds a single `{ capture: true }` options object shared by add/remove on the same window with the same keydown handler. JSX, focus-trap logic, Escape interception, focus restoration and overflow code remain unchanged. Exactly this component, both assigned test files and this new handoff are the intended delivery.
- **D2:** `games-map-refresh.test.tsx` renames the obsolete scenario. After the existing load completes, `clickVenue` must produce the real preview node for the requested venue; calling its `onOpen` must produce the real sheet node with that same venue ID and only its game IDs. Both steps assert no assign, unchanged pathname/search and unchanged request count. Child hooks are never statically rendered into parent `hooks.slots` in these steps. The separate `venueId` branch retains assertions for «Расписание площадки», `/games/game-id`, «Delayed game», absent catalog and absent game for `other-venue`. Other loading/pagination/refresh assertions are preserved; one obsolete comment is updated.
- **D3:** Both existing `shift=false/true` Tab tests and all their expectations are unchanged: boundary interception, focus transfer, interior freedom and no interception after cleanup. No test-error justification or weakening is needed. A new test mounts, dispatches real Escape, cleans up, verifies no Escape callback or default prevention and no Tab interception, then repeats on the same EventTarget with fresh hook slots. Each cleanup checks restored initiator focus and overflow. Listener removal is not mocked. No skips, TypeScript suppression, new `any`, or index non-null assertions were added.
- **D4:** Required commands were attempted separately; results below. Test/typecheck success is not claimed. New code follows inherited `strict` / `noUncheckedIndexedAccess` conventions, including explicit missing-node guards, but compiler verification is NOT_TESTED.

## Commands and evidence

Working directory for both commands: `apps/web`.

```text
COREPACK_ENABLE_NETWORK=0 pnpm exec tsc -p tsconfig.json --noEmit --incremental false
exit: 1 — NOT_TESTED

COREPACK_ENABLE_NETWORK=0 pnpm exec vitest run --no-cache test/games-map-refresh.test.tsx test/venue-sheet.test.tsx
exit: 1 — NOT_TESTED
```

Both emitted exactly:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Corepack could not resolve the required pnpm locally with network disabled. Neither TypeScript nor Vitest started. No dependencies were installed and no network fallback was enabled.

`git diff --check` from the worktree root: exit 0, no output (PASS). This checks whitespace only and does not replace typecheck, tests or independent QA. No full suite, visual check, deployment or independent self-acceptance was performed.

## STYLE_GUIDE_PARITY

No visual changes; no visual verification performed. Existing M3 compact preview / expanded BottomSheet composition is preserved; no new pattern or screen composition introduced. No STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE used. Binding rule read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`. The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in this checkout; no replacement document was authored. Frozen external Make sources were not accessed offline.

## Integration, rollback and next bounded action

Integrator must manually combine this base-scoped diff with any newer dev. Publish only after normal review; the integrator adds the actual final commit SHA and exact permalink here. The source author has not committed, pushed or invented a result permalink.

Rollback: reverse-apply only this delivered diff (the component change, both test changes and this new handoff), preserving unrelated work. The author performs no git writes.

Next bounded action: integrator supplies the exact candidate to independent QA in an environment with existing dependencies; QA runs the two D4 commands and verifies D1–D3. Do not infer green CI, deployment, Owner acceptance or browser parity from this handoff. Preserve popup-over-map semantics and unchanged Tab assertions.
