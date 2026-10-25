# OPS #199 · Stage-aware V2 root controller update · runbook

**STATUS: CODE CANDIDATE; NOT INSTALLED; NO ROOT EFFECT AUTHORIZED BY THIS FILE.**
Last author check: 2026-10-22 UTC.
Product authority: Owner Issue [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199).
Stage-aware source: [PR #200](https://github.com/anpavel84-afk/gobadminton-clean/pull/200), merged.
Hosted pin & serialized DRAFT planning: [PR #201](https://github.com/anpavel84-afk/gobadminton-clean/pull/201), subject to exact CI.
Installer: `scripts/chatops/ops/phase_v2_upgrade.py` (one-shot root OPS utility, NOT a new daemon).

## Why

The prior V2 recovery controller was installed with a bounded one-shot `hotfix-191.json`. It is currently `mode=disabled`, root controller `6b24848520ba01f66d764917a577aa1d2d189a45`, prior hotfix journal `installed-disabled`. Do NOT replay that old installer, reset old #177/#181 3/3, edit other projects, or change PROD/VPN. The new source has exact five changed installed files:
`client.py`, `core.py`, `stage.py`, `live/slots.py`, `live/autonomous_issues.py`.

This separately reviewed utility uses existing root `installer.payload()`, `receiver.controller.lock`, signed manifest and already installed `recovery.policy`. `dry` is read-only. `apply` requires a quiescent boundary and exact old/new SHA for all five files; preserves untouched 15 installed files and all source, budget, attempt, recovery and outbox histories. Root-only backup and write-ahead `hotfix-phase-v2.json` precede effects. All work is deliberately left disabled. Exact checked-out GitHub stage and dispatcher files must have two immutable refs each to the approved source commit, and the stage SHA256 must match the operator input. `rollback` refuses after any ACTIVE stage, restores root-owned exact originals and remains disabled. `activate --probe <verified-run-id>` creates `activating` write-ahead marker before policy becomes ACTIVE; if crash lands between those two updates, the same exact probe can safely finalize while preserving any later effects, never resetting counters or silently rolling back.

## Sequence to execute only after QA/CI

1. Independently review this precise OPS script and tests on final SHA. Product CI 7/7 and restricted receiver source QA PASS required. Make PR change only if evidence demands it.
2. Merge PR #201 only once exact checkout pin source SHA and security review match; merge OPS installer source separately. Verify current DEV commit source and workflow SHA; do not substitute `latest green`.
3. Root operator creates a ROOT-OWNED versioned staging bundle from exactly reviewed GitHub `dev` SHA, with no symlinks, zero group/world write, and records exact installer.py/phase_v2_upgrade.py SHA256. This is a source archive, **not an installed model process**.
4. Root `dry --bundle <bundle> --manifest <sha256 of manifest> --controller dfef68... --stage-sha <sha256 of pinned train-stage.yml>`. Fail-closed on drift, unknown active process, mismatched source bytes, root lock conflict, budget/checkpoint drift.
5. Under the same safe quiescent boundary, root `apply` once; verify exit `INSTALLED_DISABLED`, current installed file SHA, manifest and root mode disabled. Existing `hotfix-191.json` MUST stay unchanged.
6. Run real hosted read-only `train-dispatch` on DEV, verify source SHA pinned and hosted stages, exact Success and root remains disabled. A generated DRAFT comment is NOT a product admission. Independently verify real Actions run ID.
7. Only when checks pass, root `activate --probe <exact successful run id>`. Reconcile resulting policy and task state. Then execute one authorized synthetic/bounded stage via unchanged GitHub Actions, never a forbidden deferred #177/#181 replay.
8. Independently verify stage model attribution, CLI worktree and QA source proof, CI and DEV receipts. Record run, server SHA, script SHA, root journal, rollback in #199.

## Important production readiness limits

- Cursor Agent CLI lists `auto` but native sandboxed probe failed due AppArmor user namespace policy on Germany VPS. No attempt was made to disable the host-wide security gate. **Cursor writer remains disabled; the code routes to preapproved Codex Sol when available.**
- AGY Claude models are listed but its read-only workspace access was denied by configured policy; no bypass. AGY independent QA remains disabled until genuinely qualified. This is *not* a claim of full three-provider production.
- The new stage planner produces only read-only drafts and can post an exact immutable GitHub Actions bot DRAFT comment; a separate Owner-authorized execution admission is still mandatory.
- GitHub Projects access was not authenticated with `gh`; Projects cannot be treated as real active queue authority.
- Neither a green Product CI nor Source QA allows PROD. No automatic Owner approval and no unlimited 3/3 successor.

## Previous high-risk upgrade lessons

In old #185 transactions, real review found interrupted source replacement and policy/journal crash windows. V2 unit tests explicitly simulate an interruption during source replacement, one just before policy ACTIVE, one after policy ACTIVE but before journal update. That does NOT prove every host-specific crash condition; independent review and root `dry` remain mandatory.
