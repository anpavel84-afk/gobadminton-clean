# Issue 90 source handoff

From: source author. To: PM / authorized task launcher. Date: 2026-10-19.
Status: BLOCKED / UNVERIFIED. No implementation or acceptance claimed.

## Assignment and source

Bounded source-only successor to Issue 88 / PR 89: restore the single map return capsule and remove old map controls, add focus and visibility coverage, preserve existing map behavior. Marker separation, selected ring and marker CSS belong to M1d and are excluded.

Worktree: `/srv/gobadminton-clean/worktrees/issue-90`.
Branch: `automation/issue-90`.
Exact base / HEAD for this successor attempt: `0b6976bbd17ac2e8183c1b0cf3b7907b49d6a606`.
Original development base: `1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf`.
Required reapplication source: `0ce158e062d4509e8528abbbf33b520a21210ecf`.
Source permalink: https://github.com/anpavel84-afk/gobadminton-clean/commit/0ce158e062d4509e8528abbbf33b520a21210ecf

## Blocking prerequisite

The assignment requires fetching origin automation/issue-88 and verifying its current tip before reapplication, stopping otherwise. The enclosing instruction prohibits changing git metadata. Fetch would change git metadata; it was not run. Repository-specific SSH identity files are also outside permitted reads. This attempt additionally tried a read-only HTTPS remote-tip lookup with credential helpers disabled; it failed because github.com could not be resolved. Therefore the prerequisite remains unsatisfied, rather than assuming that the local candidate is the current remote tip.

Read-only evidence:

```text
$ git status --short
[no output: initially clean]
$ git branch --show-current
automation/issue-90
$ git rev-parse HEAD
0b6976bbd17ac2e8183c1b0cf3b7907b49d6a606
$ git rev-parse refs/remotes/origin/automation/issue-88
fatal: ambiguous argument 'refs/remotes/origin/automation/issue-88': unknown revision or path not in the working tree.
$ git cat-file -t 0ce158e062d4509e8528abbbf33b520a21210ecf
commit
$ git -c credential.helper= ls-remote https://github.com/anpavel84-afk/gobadminton-clean.git refs/heads/automation/issue-88
fatal: unable to access 'https://github.com/anpavel84-afk/gobadminton-clean.git/': Could not resolve host: github.com
```

The local branch and object exist, but neither establishes the current origin tip. No mismatch is asserted; remote tip is UNVERIFIED. No source was re-applied from the candidate. No fix was implemented and no coverage is claimed.

## Scope, checks and rollback

Only this allowed `docs/handoffs/**` file was updated. No application files, git metadata, automation, dependencies, secrets, services or deployment were changed. Rollback is restoration of this file from the exact base above by the receiving workflow.

Web unit tests, lint, typecheck, build, all three browser scripts and physical iOS: NOT_TESTED. Work stopped at STEP 1; no self-QA was performed, as explicitly prohibited by the enclosing source-author instruction. STEP 2 in the task data conflicts with that prohibition. No assertion failures or PASS are claimed. Read-only inspection commands in this attempt included `pwd`, `git status --short`, `git branch --show-current`, the revision/object queries and HTTPS lookup quoted above, and rule/context document reads. No commit or push was performed; this artifact needs publication by the authorized workflow before it has a durable GitHub permalink.

Prior independent QA reviewed this exact base and returned FAIL: C1–C4 implementation and C6/C7 evidence are absent. This attempt does not resolve those findings. C5 behavior has not been verified. Source was NOT re-applied from the candidate; marker separation, selected ring and marker CSS (M1d) remain excluded, along with all other source edits while the prerequisite is unresolved.

## STYLE_GUIDE_PARITY

Read the binding frontend Style Guide first Owner decision. No visual change was made, no new pattern introduced and no parity claim made. The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` does not exist at this base.

## Next bounded action

PM / task launcher must provide verified current origin tip evidence in the authorized task inputs, or resolve the fetch versus git-metadata prohibition. Resume this same bounded task only after its prerequisite can be satisfied. Preserve the M1d exclusions and the prohibition on commit, push and deployment.

## Current source-author retry evidence (2026-10-19)

The supplied immutable assignment was read as task data. Initial worktree was clean;
HEAD was `0b6976bbd17ac2e8183c1b0cf3b7907b49d6a606` on `automation/issue-90`.
The read-only remote-tip lookup was repeated in this attempt and returned exit 128:

```text
$ git -c credential.helper= ls-remote https://github.com/anpavel84-afk/gobadminton-clean.git refs/heads/automation/issue-88
fatal: unable to access 'https://github.com/anpavel84-afk/gobadminton-clean.git/': Could not resolve host: github.com
```

Local object existence was reconfirmed (`git cat-file -t` returned `commit`), but
`refs/remotes/origin/automation/issue-88` is absent. Neither observation verifies
the remote branch tip. Fetch and checkout were not run because the enclosing
source-author instruction prohibits git metadata changes. The task's STEP 1
stop condition remains controlling; the existing source object was not silently
substituted for verified remote evidence.

C1–C6 remain unresolved; no implementation or PASS is claimed. STEP 2 commands,
browser scripts and physical iOS remain NOT_TESTED. The explicit enclosing
prohibition on self-QA was respected. Only this handoff was edited, with no
commit, push, network deployment, automation, secret, service or PROD changes.
Rollback: restore this handoff's contents from the exact HEAD above through the
authorized receiving workflow. Publication remains the receiving workflow's
responsibility; no new durable GitHub artifact permalink exists in this attempt.
