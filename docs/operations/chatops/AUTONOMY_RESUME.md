# Autonomy RESUME_V1 (CI-failure recovery)

Scope: `scripts/chatops/autonomous_issues.py`, the single `gobadminton-autonomy.service` executor. No new process, queue or phase.

A task blocked with `resume_phase=ci` and `reason="Actions failed"` and an unspent attempt (`attempt < max_attempts`)
can be resumed by ONE Owner comment in that Issue. The first line is `GOBADMINTON_RESUME_V1`, followed by JSON with exactly
`schema`, `issue`, `head`, `attempt`, `mode` (`ci_fix`), `note` (up to 2000 characters, what failed).

The comment is ignored (state untouched) unless: authored by Owner id 318610566, not edited, parent is this Issue,
`head` equals the checkpoint head, `attempt` equals the checkpoint attempt, its id was not used before, and it is
newer than enrollment. Exactly one such comment must exist.

Before any change the executor verifies: clean worktree on `automation/issue-N` at head, remote branch equals head,
remote `dev` equals `base` (no drift; dev sync is intentionally not part of V1), saved QA PASS for the head, and
that Product CI for exactly that head is a completed failure. Then, in one checkpoint, it backs up the state to
`before-resume-<issue>-a<attempt>.json`, appends the old attempt to `history`, records the comment id in `resumes`,
and starts author attempt `attempt+1` from the existing candidate head. The normal path follows unchanged:
push (fast-forward, no force) -> QA on the new SHA -> full CI -> promote -> DEV ACCEPTED.

Never reset: counters, lock, QA files, `done`, historical FAIL. A failed last attempt stays blocked.
Parking of truly blocked tasks is NOT part of V1.
