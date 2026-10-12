# Cursor Execution Workflow

## Phase 0 — admission

Receive one exact assignment.

Confirm:
- scope;
- base SHA;
- allowed effects;
- target resources;
- acceptance criteria;
- stop boundary.

## Phase 1 — preflight

On PLAN:
- fetch;
- verify remote;
- verify branch/base;
- verify clean state;
- inspect existing worktree;
- verify required toolchain/access.

For VPS work:
- inspect host health/resources;
- inspect existing containers/networks/volumes/listeners;
- confirm GoBadminton boundary is free/non-conflicting.

## Phase 2 — implementation

Use Cursor AUTO in the local product checkout.
Make the smallest bounded change.

Do not silently redesign architecture, product semantics or deployment topology.

## Phase 3 — self-check

Run exact required checks.
Repair only inside scope.
Bound repeated repair loops.

## Phase 4 — GitHub candidate

Commit branch.
Push.
Open/update PR.
Wait for relevant CI.
Record exact candidate SHA.

## Phase 5 — target verification

If deployment is admitted:
- deploy exact candidate;
- do not deploy a dirty local tree;
- run smoke;
- compare unrelated shared-host services before/after;
- capture exact resource names/ports/images/volumes.

## Phase 6 — handoff

Write durable handoff under `docs/handoffs/`.

Return:
- PR and candidate;
- evidence;
- limitations;
- rollback;
- next bounded recommendation.

Do not automatically start the next slice.
