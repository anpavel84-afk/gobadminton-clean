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

Landlock ABI >=3 must enforce restrictions in child commands; failed guard setup
must prevent execution. Run the included child/grandchild tests under the actual
runtime user. Ubuntu bwrap preflight is reported available by Owner; full nested
CLI + Landlock + bwrap remains unverified here. If it fails, commissioning is
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
and observed_at within 300 seconds. It is checked around live meta SHA validation.
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
