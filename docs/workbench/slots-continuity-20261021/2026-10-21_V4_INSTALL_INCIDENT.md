# Continuity V4 real-install incident / OPS #155

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

From: PMA (continuation, 2026-10-21). To: independent V5 author, reviewer, integrator.
Base: `ops/slots-commission-20261021` at `877ceb3d26cbb52a05a950c51391ae3be2a880f7`.
Status: **FACT: reviewed V4 attempted, FAIL/ROLLBACK; V5 not yet reviewed or installed**.
Scope: **DEV two-slot continuity**, no PROD, no changes to unrelated services/VPN/PLAN.

## Exact observed gates and incident

* V4 author candidate installer SHA256 `0f0be31059e7f0ce6ea0768de733627137b93eaee0e42b95df632def4a5f5c3b`, original inputs SHA pinned. Author 170 core + 8 commissioning tests OK (self-test ONLY).
* Independent installer review `review-slots-continuity-20261021T210621Z-1957204`: `PASS` on exactly that installer SHA, 467s. The three recorded exceptions are narrowly scoped to existing normal SSH/Codex operations, non-root approved Git source/test reads, and pre-existing same-origin OPS web browser login; NO Rule7 rollback/installer waiver. Exact preserved report: `references/installer-review-v4-PASS.txt`, metadata `references/installer-review-v4-meta.txt`.
* `gb-run install slots-continuity dry`: **DRY PASS**, 2026-10-21 21:15:03Z. No managed writes.
* `gb-run install slots-continuity`: **FAIL rc1**, 2026-10-21 21:15:24Z, log `/var/log/gb-ops/runs/20261021-231524-inst-slots-continuity-2010893.log`. Installer raised `RuntimeError: unsupported/busy unit: gobadminton-slot@slot1.service`, controller `install.py` line489 immediately after `systemctl stop` on all managed units. Bounded wait for systemd deactivation was missing; do not treat momentary stop transition as quiescent.
* Actual rollback verified: exact preinstall live SHA256 `slots.py 4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7`, `autonomous_issues.py 0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293`; continuity policy **ABSENT**, pending barrier **ABSENT**. Root journal `/var/lib/gobadminton-slots-continuity/managed.json` exists, phase **removed**, preserving original/new records, and expected preinstall service states three enabled/active. Journal cannot be discarded as if no install had been attempted.
* After rollback old `slot2` was unable to start: preflight `slots.py:slot2_preflight.git_ready()` insists on Git alternates path which is intentionally absent after complete repack into own self-contained object store. Preflight executed as correct UID978/GID968 + supplementary GID65042 yielded **one failure only**: `own Git clone/common dir/dev/clean checkout`. Other runtime capabilities/proof succeeded. No alternate file recreated and no security policy weakened.
* PMA explicitly stopped only the crash-looping `gobadminton-slot@slot2.service`, leaving it **inactive/dead but enabled**. `slot1` and Supervisor remain active. This is a temporary controlled hold, NOT both slots restored.
* Slot state unchanged: #151 `blocked`, attempt2, CI typecheck TS2349, existing authorized RESUME comment6321988371; #152 `done`, DEV `4977074ee7b45ea612dde592b88b354d99839aea`. #156/#157 definition-review only, no admission, no code acceptance.

## Next bounded action

Isolated **V5** author requested using `docs/prompts/slots-continuity-v5.md`; repair (1) bounded post-stop quiescence, (2) trusted self-contained own Git without `alternates`, and (3) safe prior `phase=removed` journal transition when payload hashes change. Preserve durable backup, startup barrier, no concurrent writers, budgets, QA/CI gates, true OPS stage telemetry, exact scoped tests. V5 is not installed by merely having a patch. Once finalized: exact independent SHA review → root DRY including old rollback journal → safe apply → exact runtime hashes/barrier/services → separately re-enable active slot2 by start (already enabled) → separately review+DRY/apply metadata pins matching V5 → admit original reviewed #156/#157 once runtime compatible → observe actual independent progress of #151 and #156, and later #157.

No claim of DEV promotion, application QA or browser/rendered PASS before actual evidence. No manual owner intervention requested as of this record.
