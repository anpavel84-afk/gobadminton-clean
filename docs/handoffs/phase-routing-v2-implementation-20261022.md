# GoBadminton · Stage-first Actions train V2 implementation — bounded first slice

Date: 2026-10-22 UTC
From: Owner-authorized Advisor implementation
To: independent OPS/security review, GitHub Actions, DEV integration
Issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/199
Original prelaunch proposal: https://github.com/anpavel84-afk/gobadminton-clean/pull/198

**Status: SOURCE IMPLEMENTED · QA / CI / ROOT INSTALL NOT YET ACCEPTED. NOT ACTIVE.**

## Owner decision implemented

One product parent is NOT assigned wholesale to one model. The same approved outcome can have independent bounded architecture/API/web/admin child Issues, each with separate author and QA model preferences, real dependency edges and exact scope. Risk/work role selects preferred models, not the remaining token proportion. Typical assignment: Codex Astra High for critical architecture; Cursor Auto preferred for routine implementation; independent Antigravity Claude Sonnet/Opus preferred for QA; Codex Sol Medium/High as standby. No new scheduler service or second task board.

## Existing train changes (source only)

1. `live/autonomous_issues.py`: optional immutable `work_kind`, `risk`, `author_routes`, `qa_routes` fields added to original V1 exact admission; strict closed IDs and no scalar-model ambiguity; critical implementation requires an independently admitted architecture dependency. Original old Issue bodies/comments remain valid byte-for-byte, exhausted attempts intact.
2. `live/slots.py`: exact Codex Astra and Luna map to the existing Codex adapter; Cursor and AGY adapter flags **remain disabled**.
3. `core.py`: for new phase-route tasks, iterate the immutable stage candidate order; choose the first qualified model with known positive internal budget. Cursor or Antigravity entries currently fail closed as `native sandbox adapter not installed`, then Codex fallback if explicitly preapproved; no fake Cursor/AGY run. Legacy tasks retain their old Codex routing. Report true selected model/effort and unavailability reason.
4. `stage.py`: feed the selected exact Codex model and effort to the existing Codex CLI's sandboxed `Bridge.model`. QA remains in its separate read-only worktree/CLI session, and cannot be mislabeled as an unavailable other provider.
5. `core.PINS` and `manifest.json` pin changed existing train files.
6. `phase_task_plan_v2.py`: verified exact Owner `GOBADMINTON_PHASE_SCOPE_V2` parent Issue/comment, derives bounded draft architecture/API/web/admin graph and candidate role models, detects missing approved architecture paths, prohibits mutable governance docs, duplicates, traversal and unauthorized scope expansion.
7. `client.py`: writes `evidence/phase-plan-preview-v2.json` on each ordinary Actions reconciliation without mutating root/Issues, independent of the existing source queue.
8. `phase_plan_publish_v2.py`: hosted-only idempotent Issue-comment publisher, recomputes exact live Owner scope, marks `GOBADMINTON_PHASE_PLAN_V2_DRAFT` and NEVER mints machine admission or child Source issues. **Publisher action is not yet wired**; source is ready for a separate reviewed least-privilege GitHub Actions job after new pinned checkout commit is known.

## Verified evidence

Unprivileged exact source checkout, 49 new focused tests PASS covering model type/role routing, Astra architecture, Codex QA fallback, disabled provider refusal, immutable Owner parent signatures, path subset, DAG, revisions, exact detached planning artifact, idempotent hosted Issue publication and no fabricated approvals.

Old Actions test suite (134 selected tests) under `agentagency-dev` encounters 12 existing root-only read permission exceptions on `/var/lib/gobadminton-clean` during synthetic install tests. No source assertion failure beyond stale pre-manifest digest, which was corrected in this branch. Do NOT claim the whole existing suite PASS locally; Product CI on GitHub must run in normal environment.

## Provider safety

- Cursor Auto `agent --model auto` is listed and installed. Germany sandboxed probe `--sandbox enabled` failed: `Sandbox mode is enabled but not available on this system. Sandbox failed to start, possibly due to AppArmor configuration`. The alternate `--sandbox disabled` was NOT used. Thus production-ready Cursor source adapter not proven.
- Antigravity `agy models` exposes `claude-sonnet-5-5-high`, `claude-opus-5-5-high`. Independent reviewer could not access proposed source tree because a configured read denial blocked it. Did NOT bypass policy. This role remains unqualified for source QA.
- Codex `gpt-6-astra` and `gpt-6.1-sol` are available in authenticated cache; earlier read-only Astra review completed successfully. Actual use inside the protected train requires reviewed root install and exact task admission. Stage selection tests alone do not prove a live model stage.

## Installation and release boundary

The installed root controller `6b24848520ba01f66d764917a577aa1d2d189a45` remains `mode=disabled` after existing `hotfix-191.json` `installed-disabled`. Neither this branch nor CI should change root policy, model budgets, admitted task reservations, legacy worktrees, systemd, PROD, PLAN/VPN. A separate reviewed quiescent transactional OPS upgrade and exact hosted checkout pin are mandatory for this changed install manifest. Do not reuse one-shot hotfix191 apply. Hosted publisher must have `issues:write` ONLY in its own job and reverify the Owner exact parent before posting a DRAFT plan; no SSH/DEV secrets.

## Next bounded steps

1. Independent security/source QA of exact final branch and Product CI; correct any findings without weakening legacy.
2. Merge approved source to `dev`; close superseded draft PR #198 with link to this release.
3. Pin exact updated controller in both `train-dispatch.yml` and `train-stage.yml`; add hosted phase draft-comment publication; verify explicit event/JSON and no bot self-approval.
4. Qualify Cursor/AGY native sandbox adapters **before** flipping flags or routing real work to those providers. No user-account secrets/log data to a model.
5. Commission root safely with new manifest under existing controller.lock, backup, proof/rollback and read-only shadow, then activate; prove an actual newly approved architecture + source + QA chain with correct SHA and no double author.
6. Delegate bounded child admission only through a separate reviewed Owner parent delegation contract; DRAFT plans cannot claim tasks. No automatic 3/3 reset or unauthorized successor.

**Acceptance is not achieved by this source PR alone.** Product work in existing #177/#181 stays `needs-owner`; no attempts or historical receipts have been touched.
