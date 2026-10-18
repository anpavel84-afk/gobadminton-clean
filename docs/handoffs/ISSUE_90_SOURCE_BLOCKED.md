# Issue 90 source handoff

From: source author. To: PM / authorized task launcher. Date: 2026-10-19.
Status: BLOCKED / UNVERIFIED. No implementation or acceptance claimed.

## Assignment and source

Bounded source-only successor to Issue 88 / PR 89: restore the single map return capsule and remove old map controls, add focus and visibility coverage, preserve existing map behavior. Marker separation, selected ring and marker CSS belong to M1d and are excluded.

Worktree: `/srv/gobadminton-clean/worktrees/issue-90`.
Branch: `automation/issue-90`.
Exact base / HEAD: `1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf`.
Required reapplication source: `0ce158e062d4509e8528abbbf33b520a21210ecf`.
Source permalink: https://github.com/anpavel84-afk/gobadminton-clean/commit/0ce158e062d4509e8528abbbf33b520a21210ecf

## Blocking prerequisite

The assignment requires fetching origin automation/issue-88 and verifying its current tip before reapplication, stopping otherwise. The enclosing instruction prohibits changing git metadata. Fetch would change git metadata; it was not run. Repository-specific SSH identity files are also outside permitted reads.

Read-only evidence:

```text
$ git status --short
[no output: initially clean]
$ git branch --show-current
automation/issue-90
$ git rev-parse HEAD
1d24f50dc8cb16c3f05f9611b840d5a9790c3bcf
$ git rev-parse refs/remotes/origin/automation/issue-88
fatal: ambiguous argument 'refs/remotes/origin/automation/issue-88': unknown revision or path not in the working tree.
$ git cat-file -t 0ce158e062d4509e8528abbbf33b520a21210ecf
commit
$ git show-ref --heads --tags
[relevant entry]
0ce158e062d4509e8528abbbf33b520a21210ecf refs/heads/automation/issue-88
```

The local branch and object exist, but neither establishes the current origin tip. No mismatch is asserted; remote tip is UNVERIFIED. No source was re-applied from the candidate. No fix was implemented and no coverage is claimed.

## Scope, checks and rollback

Only this allowed `docs/handoffs/**` file was added. No application files, git metadata, automation, dependencies, secrets, services or deployment were changed. Rollback is removal of this handoff file by the receiving workflow.

Web unit tests, lint, typecheck, build, all three browser scripts and physical iOS: NOT_TESTED. Work stopped at STEP 1; no self-QA was performed. Read-only inspection commands additionally included `pwd`, `git remote -v`, rule/context document reads and `rg --files docs/handoffs`. No commit or push was performed; this artifact needs publication by the authorized workflow before it has a durable GitHub permalink.

## STYLE_GUIDE_PARITY

Read the binding frontend Style Guide first Owner decision. No visual change was made, no new pattern introduced and no parity claim made. The referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` does not exist at this base.

## Next bounded action

PM / task launcher must provide verified current origin tip evidence in the authorized task inputs, or resolve the fetch versus git-metadata prohibition. Resume this same bounded task only after its prerequisite can be satisfied. Preserve the M1d exclusions and the prohibition on commit, push and deployment.
