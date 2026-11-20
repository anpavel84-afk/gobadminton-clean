# OPS #155 · V6 controlled-stop fix

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

From: PMA → independent installer review/integrator. Date: 2026-10-21.
Base: `b25eaef` on `ops/slots-commission-20261021`.
Status: **SOURCE FIX ONLY, NOT LIVE INSTALLED**.

V5 exact installer `117e38e3ab9890c60d39533a78f8340e366fbafceb8ba09b58f329d7817b50e9` passed independent security review and root DRY but live apply rc1 (log `/var/log/gb-ops/runs/20261021-234507-inst-slots-continuity-2226838.log`) at wait_stopped, with `unsupported/busy unit: gobadminton-slot@slot1.service`. systemd logged the Python service exit status=143/FAILURE during controlled stop. Failed/failed with PID0 may appear after stop. Rollback confirmed original runtime files, absent continuity.json/pending, journal phase removed; slot1 and supervisor active, slot2 inactive/dead but enabled. No #151 recovery or application task execution was claimed.

V6 narrowly accepts `failed/failed` as a **quiescent result only AFTER the installer's own stop** in wait_stopped and restore_units. It still requires MainPID=0, empty current and prior descendant cgroups, unchanged unit enablement and all existing entry/rollback/activation barriers. Initial status checks and final health/QA/CI remain strict. New focused regression simulates the real exit-143 unit and separately rejects remaining children. Old stop transition tests retained.

Changed only installer controller, generated exact installer and one regression test; `slots.py`, `autonomous_issues.py`, monitor and task states unchanged from V5. V6 installer SHA256 `cbeb700a2ddb5269c69fdb7353dc60b5e95e7f8829f431f85db81c73be6cd658`. Focused independent local tests: new regression 1 OK; existing stop-poll 3 OK; `bash -n` OK; builder hash OK. Last full V5 suite independently ran 183 OK, V6 did not rerun all 183 per Owner request. Requires independent exact-SHA reviewer PASS, root DRY and actual safe apply before accepted. Metadata helper V5 matches unchanged V6 runtime hashes, not installed until V6 compatibility is proven. No PROD, no budget reset, no bypass of QA/CI.
