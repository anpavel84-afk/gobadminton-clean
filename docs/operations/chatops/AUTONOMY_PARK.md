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
- A parked Issue is never claimed again (its old admission comment no longer counts).
- An Issue authorized at or after a parked task's own authorization may start only if listed in that task's
  `allow_successors`; earlier-authorized Issues are not blocked. Dependents therefore wait for their predecessor.

Not included: unparking, a new attempt budget, dev sync. A malformed `parked.json` stops the executor (fail closed).
Rollout: PR -> independent QA on the exact SHA -> CI -> backup of adapter and state dir -> install -> restart -> verify.
