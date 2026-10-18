# Autonomy PARK_V1 (parking of a genuinely blocked task)

Scope: `scripts/chatops/autonomous_issues.py`, the single `gobadminton-autonomy.service`. No new phase, process or queue.
`state.json` keeps exactly `{active, done}`. Parked tasks live in a separate `parked.json` (`{"parked": [...]}`, mode 0600).

Use only for a task that is `blocked` and NOT resumable by RESUME_V1 (attempts exhausted, or a failure other than CI).
Parking is NOT success: the issue number is never added to `done`.

Marker: Owner (id 318610566) comment in the blocked Issue. First line `GOBADMINTON_PARK_V1`, then JSON with exactly
`schema`, `issue`, `head`, `attempt`, `reason` (1..500 chars), `allow_successors` (0..3 distinct Issue numbers).
Ignored (state untouched) unless: not edited (`updated_at == created_at`), parent is this Issue, created after enrollment,
`issue`/`head`/`attempt` equal the blocked checkpoint, the comment id was not used, exactly one valid PARK comment exists.

Effect, in this order: backup `before-park-<issue>-a<attempt>.json` (never overwritten); append the full snapshot
(task, QA, history, attempts, base/head/pr, admission) to `parked.json`; only then `active = None`.
A crash between the two writes is idempotent: the same entry is reused on the next pass.

Claim rules while anything is parked:
- A parked Issue is never claimed again, not from its old admission comment and not from a fresh one (no unpark in V1).
- There is NO ordering barrier. Issues authorized after the park (a successor, the post-game backlog, anything new)
  are claimed normally. The executor cannot tell a dependent from an unrelated Issue, so dependents of a parked task are
  NOT blocked automatically: the Owner controls order by when a dependent Issue is published. `allow_successors` is only
  recorded in `parked.json` for audit and is not enforced.

Crash recovery: if the process stops after `parked.json` is written but before `state.json` is saved, the next pass
finishes the park from durable evidence only (the `parked.json` entry must equal the checkpoint snapshot and
`before-park-*.json` must equal the current state). The Owner comment is not re-read, so editing or deleting it
meanwhile changes nothing. Any mismatch stops with a Hold for manual reconciliation (state untouched).

Known limits: parking requires the Issue to be open and unchanged (`unchanged_issue`); a blocked task with no candidate
head cannot be parked.

Not included: unparking, a new attempt budget, dev sync. A malformed `parked.json` stops the executor (fail closed).
Rollout: PR -> independent QA on the exact SHA -> CI -> backup of adapter and state dir -> install -> restart -> verify.
