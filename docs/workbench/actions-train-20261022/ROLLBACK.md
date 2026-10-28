# Actions train rollback — exact operational procedure

Scope Germany GoBadminton DEV only. Never start the old scheduler while new Actions ownership can launch stages. No PROD, VPN or unrelated units. Do not overwrite state.json, ledgers, attempts, histories or deferrals from an old snapshot.

## Evidence and prerequisites

Original root install backup: /var/lib/gobadminton-actions-train/backup.json and backup/ files. Contains exact original helper/monitor hashes and original enabled flags, not copies of user sessions or credentials. Current code after hashes correspond to manifestf434bb707a694f67141beb465fda6ceac2fec7a08cfc9cdb5a7cdcd338fe73a1. Root installer /usr/local/lib/gb-actions-train/installer.py is the reviewed code. Original safe task handoff is /var/lib/gb-actions-migration/quiescent-handoff.json; retain it for evidence, do not restore it over completed/new work.

A root DRY reversal of the disabled installation passed before activation (evidence path /var/lib/gb-actions-installer-20261021/evidence/rollback-disabled-dry.json). No claim that a blind reversal is safe after new task progress.

## Controlled reversal

1. Stop accepting new stage launches through the existing root controller ownership policy under controller.lock; set mode disabled, retaining owned slots and all provenance. This prevents effectful Actions requests while preserving status reads. Do not cancel/kill an unknown in-flight source process. Inspect both root slot journals and own-UID process identities/worker locks. Wait for bounded operations to finish or reconcile exact remote Git/DEV state first. Event jobs may continue read-only but cannot start work while disabled.
2. Require no pending/unknown operations, no live writer, clean compatible source worktrees, no unfinished integration.json reservation. Exact code/backup hashes must match. **Actions-only deferral #156 currently blocks old-scheduler rollback**: reconcile that preserved task explicitly first; old code must not silently re-admit it, fabricate Owner PARK or erase attempts. Do not bypass this check.
3. Run the reviewed root command without --apply; it performs DRY, no managed writes:

```sh
python3 -I -B -c 'import sys,runpy;sys.path.insert(0,"/usr/local/lib/gb-actions-train");runpy.run_module("installer",run_name="__main__")' rollback
```

4. Only after actual DRY passes at a compatible quiescent boundary, run the identical command with `rollback --apply`. It disables new dispatch before reversal, restores exact original managed bytes/modes and original unit enabled flags, and leaves all task/budget/history changes intact. It does not start old services. A refused reversal remains disabled and preserves journals for operator reconciliation; do not claim completed rollback.
5. Verify restored hashes and disabled Actions policy, no active pending stage/lease, no model children. Only then explicitly start the existing original slot workers and Supervisor under their preserved tasks, if restoring the old dispatch path is intended. Never enable both dispatchers.

Keep /var/lib/gb-actions-api-root-fix-20261021, /var/lib/gb-actions-token-format-fix-20261021, /var/lib/gb-actions-redirect-fix-20261021 and /var/lib/gb-actions-slot1-diagnostics private receipts for narrow update/recovery audit. These do not replace the original pre-migration rollback manifest. Failed source/QA checks cannot be overridden by successful infrastructure installation.
