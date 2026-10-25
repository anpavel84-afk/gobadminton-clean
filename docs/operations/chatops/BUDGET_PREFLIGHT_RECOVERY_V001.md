# OPS211: one QA execution after a proven pre-call budget refusal

Status: source candidate, not installed by publication. Refs #199, #211, #213.

## Actual trigger

PR213 merged as `dedca3fe62fd137ec377b0791aa57d6f47526b95`, Product CI39853927367 all7 SUCCESS. Runtime `a731fc9434495e33a5cb300deebb818154d0c2cc` installed ACTIVE, hosted shadow39855003172 SUCCESS. Daily Codex author/QA limits are unlimited with all prior usage intact.
Active reconcile39855245212 dispatched0. Slots remain occupied by #207 attempt2 head `4f3a0ff128242973b8c2b8de17fdfbac72910cac` and #205 attempt3 head `ce148fb6d8c1d369fe3089a3e40747b1a3be9fb3`.
Both root operations consumed recovery_attempts1 on exactly `no safe role-specific provider: {"codex:gpt-6-astra:high": "daily budget exhausted"}` before model selection could reach charge/Popen. Initial and recovery operation before/after checkpoint digests are identical; no routing/model-call/usage receipt exists. The ordinary QA recovery ceiling therefore reports recoverable=false after quota removal.

## Bounded correction

No author/model/task attempt or history is reset. This is one additional **host preflight retry**, preserving the one actual replacement-QA call ceiling:

- Finished stopped QA; exact current issue/head/attempt/digest; original and sole recovery history both have the closed trusted route-budget error and safe_release=false.
- Counter must be the integer1, with no previous correction marker and no model/usage evidence anywhere in either result.
- Root-owned config must explicitly say unlimited for Codex QA at host and this exact slot.
- Root records a one-use budget_preflight_used certificate, appends prior history and increments recovery_attempts1→2 durably **before fork**. The new internal flag is rejected by the public request schema.
- Existing fixed r1 worktree may be reused only when registered, clean, detached at the exact SHA, without symlinks, Git operation markers, current-SHA QA result or recovery receipt. Never delete/recreate it to hide prior execution.
- Next unknown/error cannot get another correction. Provider quota/auth failures, charged calls, other errors, finite/unknown budgets, dirty/different candidates and already-used markers all remain blocked.

Independent source authorizations and model routes are unchanged. The legacy #205/#207 QA route remains Astra High because no approved amendment exists; this correction does not silently substitute another model. New task routing uses the stage-cost policy.

## Controlled installation

`budget_preflight_upgrade.py` accepts only the exact a731 baseline, the already-reviewed unlimited config hash, and exactly two changed library targets: receiver.py and qa_recovery.py. Both current pending operations must independently satisfy the new no-call predicate. It holds controller.lock, requires existing quiescent guards, journals before backup, disables effects, backs up then replaces only code. It preserves all slot/history/recovery/usage files and the prior cost-install receipt.

Use reviewed root-owned git archive and exact manifest/controller/stage/dispatch hashes: dry → apply installed-disabled → real hosted Train dispatcher with both reconcile/publish_phase_drafts SUCCESS → activation. This uses the existing controller and Actions, not a new scheduler or Supervisor. No PROD/PLAN/VPN or model-author permission change.
Rollback is permitted only disabled before activation, with unchanged authoritative bytes and exact before/after target hashes. An interruption before the first backup is safe: unchanged targets need no restore; policy can be restored without touching task history. No rollback after activation/model effects.

Validate actual continuation with the original operation keys, unchanged author attempts, root counter2 plus intact recovery_history and one model-call charge. Subscription/provider errors still fail closed. Report source/merge SHA, CI, DEV ACCEPTED, hosted shadow and actual process/call receipts in #199.
