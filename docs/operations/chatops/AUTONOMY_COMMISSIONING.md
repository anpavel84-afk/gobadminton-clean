# Autonomy commissioning — prepared, NOT commissioned

Owner P0 continuation, 2026-10-15. Base: `ce399529b0c7d137a917f45cd4e999234d5a2908`.
Scope: `autonomous_issues.py`, its dependency-free tests, `autonomy-pr.yml`, CI push
branches, this handoff. No product changes, host installation, Issue consumption,
commit/push or deployment performed. This local package still needs authorized
GitHub publication for durable review. Existing `dev-deploy.yml` is unchanged.

## Install after review

Use only the assigned `agentagency-dev` account on Germany, one adapter and one
state directory; never overlap another writer. Install only a **user-level**
systemd service (`systemctl --user`), never a root/system service. No installation
is performed by this document. Enroll the existing repo-specific SSH key and a
verified dedicated known_hosts file; no API write token in the adapter.

Create state outside source/worktrees, owned by the runtime user, mode **0700**;
checkpoints/QA files are 0600 and fsynced before transitions. Retain the entire
state directory across restart and rollback; never clear an active claim to retry.
Launch with absolute non-symlink paths:

```text
python3 -B scripts/chatops/autonomous_issues.py --repo <clean-repo> --state-dir <private-state> --worktrees-root <assigned-root> --known-hosts <verified-hosts> --approved-since <UTC-enrollment-before-canary-creation> --poll 240
```

Use only default `/home/agentagency-dev/.codex` OAuth profile. The old
`/srv/gobadminton-clean/runner/codex-home` credential is revoked and is never used,
even when inherited CODEX_HOME points there. Model 401/Unauthorized blocks the
claim; do not print tokens or raw model output. Validate current CLI compatibility
and OAuth separately before enrollment; no model was launched here.

For non-model foundation validation, Landlock ABI >=3 must enforce restrictions in child commands; failed guard setup
must prevent execution. Run the included child/grandchild tests under the actual
runtime user. Codex tools use the managed profile described below, without an outer Landlock wrapper. If it fails, commissioning is
BLOCKED: retain sandbox, state and SSH isolation; never disable protections.

GitHub-hosted Autonomy PR uses only GITHUB_TOKEN, pull-requests:write, strict
`automation/issue-[1-9][0-9]*`, serialized idempotent open PR creation to dev.
Repository setting “Allow GitHub Actions to create and approve pull requests”
may block creation; inspect the exact workflow failure rather than add a hidden
token. Product CI also runs on automation branch pushes (token-created PR events
alone cannot supply the required push CI proof).

Unauthenticated REST is limited to 60 requests/hour per public IP. Requests are
spaced at least 65 seconds, normal polls default 240 seconds (allowed 120–300).
403/429 preserves the active claim and backs off at least an hour and through
reported reset/retry time. Shared-IP users may still exhaust the budget.

## Commissioning A–E (not executed live)

A. Validate immutable Owner Issues #30/#31: exact first line and schema string
`GOBADMINTON_AUTONOMY_V1`, acceptance string, Owner id 318610566,
created_at == updated_at at first claim. Only #30 may name exactly
`docs/operations/chatops/AUTONOMY_CANARY_A.md`; only #31 may name exactly
`docs/operations/chatops/AUTONOMY_CANARY_B.md`. Other control paths remain denied.
These Issue facts were supplied as verified in the Owner assignment; offline
fixtures implement that contract, not a fresh live Issue read.

B. Start one user worker; a second lock holder must fail. Prove #30 remains
claimed through restart. A dirty or uncertain author/reviewer interruption holds
for operator reconciliation without discarding the claim or rerunning the author.

C. Obtain new independent QA PASS for exact candidate SHA and successful Product
CI push run with every expected job/step. QA FAIL, wrong SHA, CI FAIL, skipped jobs
or skipped DEV acceptance must prevent success. Keep failure evidence.

D. Controlled restart in promoting/dev_wait: re-read saved QA and exact-SHA CI;
remote dev must equal base or candidate during promotion, candidate during DEV
wait. Base permits one normal fast-forward push; candidate skips repeat push;
any drift holds. No force push or automatic baseline rewrite.

E. First actual proof must record candidate SHA, independent QA JSON, PR URL,
exact Product CI run id/attempt/jobs URL, exact DEV run id/attempt/jobs URL,
successful `Apply, browser-smoke, accept; rollback on failure` step and live
`/v1/meta` gitSha equality. Then prove sequential #30 → #31 with #30 in done
and #31 independently checked. Publish checkpoint/evidence links in the authorized
GitHub record without credentials. No such CI/DEV proof exists from this session.

## Rollback / handoff

Stop only the assigned user service, allow the active child to terminate, confirm
no writer survives, preserve private state/QA/worktrees and inspect exact phase/SHA.
Do not start a replacement writer against dirty/uncertain work. Revert the reviewed
source/workflow change through a normal PR if necessary; leave dev-deploy unchanged.
No PROD authority or automatic DEV rollback is created by this package.

Local validation: `python3 -B -m unittest discover -s scripts/chatops/tests -p
test_autonomous_issues.py`, `python3 -B scripts/check_foundation.py`,
`git diff --check`. These are author checks, not independent QA or commissioning.
Next bounded action: independent review of this package, then authorized publication
and controlled A–E commissioning with exact GitHub evidence.

## Issue #29 R1 repair · 2026-10-15 · READY FOR REVIEW, commissioning BLOCKED

Owner bounded assignment: repair candidate `01b32f714e948c6e70fea3391359fce05f41e6ce`
on `ops/p0-chatops-autonomy-20261015`, single writer. Scope: existing bridge/helper,
offline adversarial tests, explicit model probe and user-unit template. No push,
host installation, DEV/PROD action, permissions/workflow changes or canary consumption.
The earlier paragraph saying no commit describes the original candidate only;
this repair was authorized for local commit, but commit is BLOCKED by sandbox:
Git cannot create `/srv/gobadminton-clean/repo/.git/worktrees/p0-chatops-autonomy-20261015/index.lock`
(Read-only file system). Changes remain uncommitted in the assigned worktree.

DONE now requires fixed `/var/lib/gobadminton-deploy-evidence/dev.json`, opened
component-by-component without symlinks, root-owned non-writable ancestors and
root:root 0644 regular file. Receipt must be ACCEPTED for exact run/attempt release
ID and candidate SHA, both complete sha256 digests, pending=false, schema/environment
and acceptance age within the bounded four-hour window described below. It is checked around live meta SHA validation.
Root helper atomically publishes only the filtered DEV receipt plus pending bool
and observation timestamp, on state writes, status and EXIT while holding its lock;
rollback failure retains pending=true. Private state remains 0700. No PROD projection.
A delayed/restarted adapter needs a fresh status projection via the existing
root helper status route; absence/staleness blocks, never falls back to user evidence.
No periodic publisher or new privileged service is introduced.

Required check names follow ci.yml (including each source matrix package).
Missing, duplicate or skipped checks fail; only normal post/artifact steps may skip.
Read-only HTTP calls retry locally up to five attempts with 2/4/8/16-second backoff
and existing public quota spacing; no caller/model/write replay. Exhaustion/401
blocks and retains resume_phase. Quota waits stay inside the same read.

The fixed user service name is `gobadminton-autonomy.service`; runtime verifies
its MainPID and KillMode=control-group before enrollment. Template is under
`scripts/chatops/user/`. SIGTERM unwinds child execution and kills its process
group before flock release; cgroup cleanup additionally covers escaped groups
and uncatchable parent death. Uncertain writer/reviewer recovery stays BLOCKED.
Never run another instance with a different state directory to escape a claim.

Author validation: 16 offline bridge tests pass, including forged evidence,
receipt mutations, required-step skip/removal/duplication, bounded retries and
real child/grandchild SIGTERM with lock reacquisition and delayed survivor proof.
Foundation and whitespace/shell syntax checks pass. Root helper integration tests
are present but skipped under uid 1002; run them in the authorized disposable root
test environment before acceptance (not against installed host state).

Actual CLI 0.160.1 was invoked under Landlock with workspace-write sandbox,
requesting shell `true` and denial of a synthetic key outside allowed roots.
It failed closed with Permission denied before the requested proof. No real SSH
key/token was read by this probe; output was withheld except fixed diagnostic
signatures. Reproducible explicit probe: `python3 -B
scripts/chatops/tests/probe_model_guard.py`. Composition remains BLOCKED; no
sandbox bypass or scope widening was attempted. This is not model/shell success.

Next bounded recipient/action: independent R2 review of the exact repair commit;
then resolve guard composition and execute disposable root helper tests before
any authorized commissioning. Preserve all claims/QA on stop. Rollback source
with a normal revert of the repair commit, no automatic host rollback. Publication
is pending because Owner explicitly forbids push in this assignment; the uncommitted worktree
is the handoff candidate, not a claim of durable GitHub publication.
HEAD remains `01b32f714e948c6e70fea3391359fce05f41e6ce`; an authorized environment
with writable task Git metadata must commit these changes before R2 review.


## Issue #29 supported-profile continuation · 2026-10-15 · BLOCKED runtime proof

This section supersedes earlier sandbox/freshness/HEAD claims. Exact base is
`5067e4615ce3f6c796a8d466ac52eedf292b46a3`; same worktree, sole writer.
Owner scope: model boundary repair, acceptance freshness, hosted unit coverage,
synthetic proof and documentation. No commit (PM commits), install, push, canary,
deployment or repository permission changes. Current changes are an unpublished
handoff candidate; PM must publish them before durable independent review.

Codex uses native installed CLI, `--no-daemon`, ignored user config/rules,
approval never, disabled web search/hooks/apps/MCP, and one CLI inline TOML table
selecting `default_permissions="gb-task"`. Project config is rejected before
launch rather than merged. No legacy `--sandbox` override. See
[official managed permissions](https://learn.chatgpt.com/docs/permissions).
Profile extends `:workspace` for author, `:read-only` for QA: root denied,
minimal runtime read, task worktree write/read respectively, .git/common-dir read,
exact SSH directory and private worker state denied. Shared /tmp denied; only job
TMPDIR writes allowed. Runtime roots are existing OpenAI CLI and standalone Node;
PATH starts with `/home/agentagency-dev/.local/node-v24.21.0/bin`. No neighboring
project runtime is resolved or reused. Foundation retains Landlock without OAuth
home access. CLI OAuth transport is trusted; model tools have network disabled.

Acceptance requires exact release ID, SHA, digests and pending=false, with integer
`finished_at <= observed_at <= now` and acceptance age <=14400 seconds (maximum
bounded wait/recovery window). This tolerates 65-second API spacing and polling;
observation updates cannot renew an old acceptance. Evidence remains checked on
both sides of live meta validation; stale acceptance requires reconciliation.

Autonomy unit tests run in the existing receiver step, preserving its first-line
GitHub-generated name and REQUIRED_STEPS. No named step or gate was removed.

Validation: final 18 offline tests passed, including synthetic symlink/proc denial.
Foundation, one email policy test, eight foundation policy tests and whitespace/
shell checks passed. All 21 root helper tests were skipped under uid1002; no root
helper PASS is claimed. Synthetic probe
runs native sandbox author/QA checks (direct, symlink and /proc/self/root denial,
git read-only and allowed writes), then real `codex exec` and independently checks
its proof. Under this session's enclosing filesystem restrictions, native sandbox
failed before shell with `app-server socket directory must be a user-owned
directory with mode 0700`; real `codex exec --no-daemon` failed before model startup
with `failed to initialize in-process app-server client: Read-only file system
(os error 30)`. No model PASS or allowed proof exists. No real SSH key was read or
printed. No permission widening or sandbox bypass attempted. These are runtime
blockers, not evidence that managed profiles passed in this session.

Next bounded action: PM publishes source/tests and reruns
`python3 -B scripts/chatops/tests/probe_model_guard.py` under the authorized runtime
with its normal writable CLI state, keeping the same managed restrictions. Require
both model result and independent proof checks before commissioning. Root helper
integration still needs the disposable root CI environment; local uid1002 cannot
substitute for it. Rollback: restore changed source files to the exact base; no
host effects need rollback. Preserve all prior R1 recovery and release gates.


### Issue #29 bounded correction · 2026-10-15

Same base and unpublished handoff status as above; preserve existing diff. The
dedicated job TMPDIR now has `:tmpdir=write` as well as its resolved job path
write grant: a deny on the same resolved path wins over write. `:slash_tmp=deny`,
root deny, SSH directory deny and private state deny remain unchanged.
The synthetic probe fixture now creates its private temporary root beneath
`/srv/gobadminton-clean/worktrees/.autonomy-probes`, with parent, root and child
directories mode 0700. Sibling state under masked /tmp prevented bwrap from
scaffolding mounts. Direct/symlink/proc key denial and git read-only checks remain.

Supervisor reports direct DC native sandbox EXIT0 with the real /srv worktree,
job TMPDIR and corrected profile; this is supplied evidence, not a local run.
Do not run nested Codex in this enclosing sandbox: auth HOME cannot be written
and its read-only failure is not evidence about the corrected direct runtime.
PM must run the exact probe directly in DC after handoff. No new model/runtime
PASS is claimed here. No commit, push, install, deployment or canary consumption.
Rollback only this continuation's edits; do not restore whole files over the
pre-existing diff.

Author checks after this bounded correction: 18 offline autonomy tests PASS;
foundation static check PASS; one email policy and eight foundation policy tests
PASS; `git diff --check` PASS. Exact native/model probe intentionally not run
inside the enclosing sandbox; direct DC execution remains PM's next action.


### Issue #29 final bounded source fixes · 2026-10-15

Same exact base `5067e4615ce3f6c796a8d466ac52eedf292b46a3`, sole writer,
preserving the entire pre-existing diff. This latest evidence supersedes earlier
claims that no direct model PASS exists. Supervisor reports direct host positive
model probe PASS in session `01a13d7f-63a9-7cd1-86b2-a5411a50e3d9`: native
`model_command` with current managed profile, shell `true` plus allowed workspace
`printf`, independently verified proof `allowed`, exit 0. Separate direct native
author/QA probes also PASS: direct/symlink/proc secret denial, common/.git read-only,
and QA source read-only. These are supplied Supervisor evidence, not local runs
or a claim that this final source revision has been probed. The combined negative
model prompt returned PROBE_FAIL because it asked for forbidden operations; model
willingness to attempt them is not a permission-negative acceptance criterion.

The model prompt now requests only `true` and the allowed proof write. All native
negative checks and independent unchanged .git/common checks remain. Fixture name
is `forbidden-write`. `run()` classifies authentication rejection only on nonzero
exit with an authentication error signature, avoiding successful stderr transcript
paths/prompts containing `unauthorized`. Regression coverage includes successful
stderr with an unauthorized path/auth text, generic nonzero path failure, and
actual `Unauthorized401` exit 1 blocking. No sandbox/policy permissions changed.

Author validation: 21 offline autonomy tests PASS; foundation static check PASS;
one email policy test and eight foundation policy tests PASS; `git diff --check`
PASS. No nested Codex launch, commit, push, install or deployment. Candidate remains
unpublished at Owner request. Next bounded action: PM runs the updated exact probe
directly on the authorized host and publishes source/evidence for independent
review. Existing CI/root-helper/release gates remain. Rollback only these bounded
edits, preserving all earlier changes.
