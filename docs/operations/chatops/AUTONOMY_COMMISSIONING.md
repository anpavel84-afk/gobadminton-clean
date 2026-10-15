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
