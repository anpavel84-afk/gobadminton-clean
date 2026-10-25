# Cursor: runtime qualification canary → ready

Owner-direct source change, 2026-10-25. This runbook separates CLI qualification from product acceptance under EOM §6.2. Issue #225 remains QA FAIL (NaN coverage), deferred; this operation supplies no product QA PASS, CI PASS, DEV ACCEPTED or PROD authority. The original `accept` still requires the complete exact-head product lifecycle.

Author preflight: repository `anpavel84-afk/gobadminton-clean`; source/base `0ebd58e57d31e4f273708dc98aab59f1572eedcf` (`origin/dev`, detached HEAD in the supplied checkout). EOM 1.4 source commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`. Role AUTHOR under this bounded Owner assignment, sole writer of its allowed files; requested/effective execution is this local author session, no provider CLI invocation or runtime admission. Candidate is the uncommitted diff against that base. Runtime PMA ownership remains unchanged. The requested `docs/handoffs/cursor-author-211/READY_REMAINDER.md` was absent from this source checkout.

## Preconditions

Use the existing reviewed root integrator on Germany `vmi3510488`, after independent review of this exact source candidate. This document does not install it. Keep the reviewed helper bundle at one absolute, root-owned path, with no symlink components or group/world writable components. Pin the helper bytes through the existing OPS review/materialization process. The invocation must match the original journal's manifest, controller, stage and dispatch hashes; it must hold the same `controller.lock`.

The journal must be `active-canary`, policy `active` with the same controller, and marker `canary` with identical canary task hash and successor. The marker must equal the journal's installed marker hash. Every marker module must match installed bytes; required pins remain:

- `native_cursor.py`: `02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089`.
- `native_guard.py`: `dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762`.

Installed code pins are the union of non-marker `journal.changes[*].after` and `STATE/backup.json.after`, not just `marker.modules`. Every pinned file is hashed again through `runtime_bytes()` with its root ownership, no-follow traversal, single-link regular-file and no group/world write checks. Missing, unreadable or malformed backup records refuse acceptance. The record must retain the `GB_ACTIONS_TRAIN_BACKUP_V1` structure and the journal's `record_before` metadata, with the new journal manifest. Its `after` must retain every prior entry, may add only entries recorded in `changes`, and must agree with changes on shared paths and with prior hashes on unchanged paths. Marker modules must belong to this recorded union; an extra marker module or an unrecorded backup entry refuses acceptance. The install tree is bounded to `INSTALL` plus the installer's existing exact deploy-helper and monitor destinations; absolute paths, canonical spelling and no `..` are required. Arbitrary paths outside those destinations refuse acceptance. This uses the existing installation records, without treating a directory scan, `preserved` state hashes or marker modules as a replacement code inventory. Files outside the recorded union are not newly inventoried by this action.

Exactly one issue-#225 author-stage operation in total must exist across both slot journals. Every such operation counts, regardless of task hash, status, completion or charge; a missing/different task hash cannot hide another attempt. The sole operation must be finished and confirmed for the exact canary task, with Cursor / Auto, an exact integer (not boolean) one charged call and an imported native receipt equal to the pinned on-disk receipt. Any second author, including unknown, unconfirmed, failed, rejected, unfinished or uncharged, refuses acceptance. Other issues and QA/DEV stages do not count as authors. The author's completion must precede every recorded QA/DEV outcome for that task in its slot. A QA/DEV outcome is required; its verdict is not a qualification gate. Historical failures, attempts, native/source receipts and budget ledgers remain intact. These stricter rules apply only to runtime qualification; the original product `accept` selection is unchanged.

The closed-schema [qualification proof](../handoffs/cursor-author-211/QUALIFICATION_PROOF.json) lists twelve artifacts with the Owner-supplied exact SHA-256 values. Its own SHA-256 in this source candidate is `dd287f87048cbbf67a6297bb069e9881b2bcdc797b973582979ca6d39e04b63f`. The helper rejects extra/missing fields, entries or altered pins, and verifies every file's actual bytes on dry-run, apply and replay. Files and every traversed directory must be root-owned, without group/world write; files must be regular, single-link and have no symlink components. Proof is bounded to 64 KiB, each evidence artifact to 64 MiB.

The four runtime QA artifact names below are **new root-owned materialization destinations**, not claims about their original locations:

- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v18-launcher.py`.
- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v18-stream.jsonl`.
- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v20-stream.jsonl`.
- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v20-qa.json`.

The integrator must materialize the already reviewed evidence through the existing authorized evidence process, preserving bytes and matching all proof hashes. Do not execute a historical launcher, rerun a model, substitute evidence, copy credentials, or relax metadata to satisfy a missing input. The remaining eight artifact paths are exactly those supplied by Owner. No evidence contents are included in public output. This source session did not access any protected state/evidence directory.

## Dry-run and apply

The following commands run in the existing authorized root OPS session, not the author workspace. Set `BUNDLE` to the independently reviewed absolute bundle path. Resolve all four original release identities read-only from the existing root-owned journal; do not substitute the new source candidate SHA for the installed controller SHA.

```bash
set -euo pipefail
BUNDLE=/absolute/path/to/reviewed-root-owned-bundle
mapfile -t cursor_release < <(python3 - <<'PY'
import sys
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
from receiver import STATE, read
j = read(STATE/'cursor-successor-211.json', 0)
for key in ('manifest', 'controller', 'stage_sha256', 'dispatch_sha256'):
    print(j[key])
PY
)
cursor_accept_args=(--bundle "$BUNDLE"
  --manifest "${cursor_release[0]}" --controller "${cursor_release[1]}"
  --stage-hash "${cursor_release[2]}" --dispatch-hash "${cursor_release[3]}")
python3 "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  accept-runtime "${cursor_accept_args[@]}" --dry-run
```

Review the returned `would_change` hashes and `accepted_canary`: basis `runtime_qualification`, exact author run, proof SHA and all evidence digests. Dry-run makes no marker/journal writes and does not publish the monitor. The existing controller lock is acquired. Save the reviewed dry-run output in the existing private OPS evidence channel. Then apply with **the SHA returned by that dry-run**, which must match the reviewed proof above:

```bash
CURSOR_PROOF_SHA=dd287f87048cbbf67a6297bb069e9881b2bcdc797b973582979ca6d39e04b63f
python3 "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  accept-runtime "${cursor_accept_args[@]}" --proof-sha256 "$CURSOR_PROOF_SHA"
```

Apply revalidates all inputs, persists `qualification_intent` before any marker effect, then calls the same `complete_qualification` path as product `accept`: journal `active-canary → qualifying-ready → active-ready`, marker `canary → ready`. Intent pins proof path/SHA, all evidence hashes, selected author-operation digest, exact old/new marker objects/hashes, policy, controller, task and successor. Marker and journal `accepted_canary` explicitly record `acceptance_basis: runtime_qualification`.

After an interrupted apply, reconcile the known operation and repeat that exact command with the same bundle and proof SHA. Existing intent is revalidated, then only its missing effect is completed. A completed replay makes no marker/journal writes. Both pending and completed replay recheck the complete recorded code union and all issue-#225 authors. Foreign marker, changed author operation, any added author, altered evidence/proof, installed-code or policy drift is refused. Do not reset the journal or repeat a provider call. The dry-run hash also detects byte-only proof changes between separate dry-run/apply processes without making dry-run stateful.

## Verify READY and the existing route

Read back under the normal authorized OPS identity; verify marker `ready`, journal `active-ready`, exact new marker hash, matching `accepted_canary`, runtime basis and proof SHA. Verify the #225 deferred record, QA FAIL, attempts and budget history remain unchanged using the existing private read-back process. Record actual runtime results in the OPS receipt; local tests below are author self-checks.

```bash
python3 - <<'PY'
import hashlib, json, sys
from pathlib import Path
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
from receiver import STATE, read
j = read(STATE/'cursor-successor-211.json', 0)
m = read(Path('/etc/gobadminton-slots/cursor-author.json'), 0)
intent = j['qualification_intent']
assert j['phase'] == 'active-ready' and m['phase'] == 'ready'
assert hashlib.sha256(json.dumps(m, sort_keys=True).encode()).hexdigest() == intent['next_hash']
assert m == intent['next_marker'] and m['accepted_canary'] == j['accepted_canary']
assert m['accepted_canary']['acceptance_basis'] == 'runtime_qualification'
assert m['accepted_canary']['qualification_proof_sha256'] == 'dd287f87048cbbf67a6297bb069e9881b2bcdc797b973582979ca6d39e04b63f'
print('READY metadata verified; product #225 acceptance unchanged')
PY
```

For a separately admitted ordinary task whose task hash differs from the canary, use a root-owned read-only materialization of its exact task object as `NEXT_TASK`, and its admitted slot as `SLOT`. This probe reads qualifications and budgets; it never invokes or charges a model and does not create admission:

```bash
python3 - "$NEXT_TASK" "$SLOT" <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, '/usr/local/lib/gb-actions-train')
from receiver import read
from core import digest, live, route
from cost_policy import preferred_route
from native_cursor import qualification
task = read(Path(sys.argv[1]), 0)
slot = sys.argv[2]
task_hash = digest(task)
marker = qualification(slot, task_hash)
assert marker['phase'] == 'ready' and task_hash != marker['canary_task_sha256']
policy = task['routing_policy']
assert preferred_route(policy, task, 'author', policy['author']['complexity']) == 'cursor:auto'
_, slots = live()
layout = slots.Layout(slot)
budget = slots.Budget(slots.CONFIG_ROOT/'budgets.json', layout.state_root/'outbox', layout.registry)
choice = route(slots, task, 'author', 'auto', budget, slot)
assert choice['provider'] == 'cursor' and choice['effective_model'] == 'Auto'
print('Different task qualifies through existing core.route; no model invoked')
PY
```

Ordinary execution continues through `cost_policy.preferred_route → core.route → native_cursor.qualification/invoke`, with existing exact admission, worker locks, provider budget checks and receipts. Routing, sandbox, executable PINs, AppArmor, network and secret surfaces are unchanged.

## Rollback without hand edits

Use the existing authorized disabled/quiescent OPS process first; reconcile in-flight work and preserve UNKNOWN. The policy must equal the intent's original policy except `mode: disabled`. The same reviewed/pinned quiescence helpers check legacy units, workers, leases, recovery and integration. No marker or policy is edited by hand by this procedure.

```bash
python3 "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  rollback-runtime "${cursor_accept_args[@]}"
```

This narrow action holds `controller.lock`, verifies the same release identity and exact intent hashes, and durably records `reverting-canary` before restoring only `intent.old_marker` through the atomic writer. It refuses foreign marker/controller drift and rechecks the complete recorded installed-code union before rollback effects. It reverts the journal marker hash to `intent.old_hash` and phase to `active-canary`, retaining the complete original intent and rollback timestamp in `qualification_history`. Policy remains disabled; source, budgets, operations, failures and attempts remain untouched. The original preactivation `rollback` remains unchanged and refuses postactivation rollback.

On interruption, reconcile and repeat the same `rollback-runtime` command. Verify marker equals the archived `qualification_history[-1].intent.old_marker` and its hash equals `old_hash`; journal is `active-canary` with that exact hash, policy remains disabled, and #225 is still deferred. Re-enabling dispatch is a separate existing authorized activation operation; this rollback does not do it. A later runtime acceptance retains the archived qualification history.

## Source validation record

### HIGH finding repair against bdbf7536 (uncommitted)

2026-10-25, PR #307 source/base HEAD `bdbf7536cfe3c5009d67b650950f2d1d4810fd91`, detached checkout of `codex/cursor-ready-runtime-accept-20261025`, repository `anpavel84-afk/gobadminton-clean`. Role AUTHOR under the direct bounded Owner assignment to repair the two supplied HIGH QA findings, sole writer of the allowed scope. Candidate is the uncommitted diff against this SHA. No runtime admission or PMA takeover; Grok remains runtime PMA. Requested/effective route is this local author session, without model CLIs or delegated agents. Both full local accepted rules were read and hashes verified: EOM 1.4 commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`; SMART_ROUTING 1.0 commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`.

F1 now uses the recorded code union and safe reader described above during initial acceptance, pending/completed intent validation and rollback-runtime's existing identity validation. The fixture models the real installation record and stage-only code change, with `receiver.py` only in backup inventory. F2 counts all issue-#225 authors before qualifying the sole operation; replay shares this stricter helper. Existing checks and tests remain. `acceptance_operations()`, `accept_canary()` and `execute()` source text are byte-identical to HEAD; install/apply behavior is unchanged. Runtime replay's existing module hash check also uses the safe reader, while product `accept` retains its prior behavior.

Author self-checks (uid 1002, synthetic files, no root privileges):

- Required runtime discovery: **80 tests, PASS** in private TMPDIR; **80 tests, PASS** again under its child with actual mode **1777**. All 50 earlier methods retained, 30 added (27 negative methods and three positive controls). `TrustedRuntimeTree` remains the metadata fixture; real no-follow reads, hashes, modes, links and write/replay behavior remain exercised. Actual default `/tmp` is **NOT_TESTED** because sandbox access is denied; the file continues to use ordinary `TemporaryDirectory()` selection without a special TMPDIR requirement.
- New negatives cover backup-only drift/missing/symlink/parent-symlink/writable/hardlink/foreign-owner files; changes-only drift and unsafe metadata; conflicting inventories; missing/malformed/unsafe backup; path escape, missing/extra inventory entries and unrecorded marker modules; drift after pending intent, completed acceptance and before rollback; extra unknown authors in either slot, failed/rejected/unconfirmed/unfinished/uncharged authors, missing/different task hashes, and added authors during pending/completed replay. Refusals assert reasons and zero writes; rollback checks its own unchanged snapshot/write count. The retained changes-only hash mismatch already refused on the old code; its new safe-reader case distinguishes the strengthening.
- All **27/27 new negative methods FAIL** against exact `bdbf7536` production source loaded from a scratch file, with **zero setup/import errors**. In separate scratch copies, reverting only the F1 inventory call to the old changes-only check makes **21/21 F1 negatives FAIL**; restoring only old `runtime_author()` makes **6/6 F2 negatives FAIL**. Subtest failures are attributed to their parent methods. No production mutation was made in the checkout. Logs and source copies are in the private local evidence directory `/home/agentagency-dev/author-evidence-readyfix2-20261025/f1f2-author-selfcheck/`; these are author evidence, not independent QA.
- Cursor regressions: successor **17 PASS**, receipt **16 PASS**, upgrade **3 PASS**, cursor **14 PASS**. The two unchanged `SourceImport` methods with known explicit `/tmp` calls remain **NOT_TESTED** under the sandbox; known-denied requests were not repeated or redirected.
- `python3 scripts/check_foundation.py`: **PASS**, 289 Markdown files and 168 draft API operations. `git diff --check`: **PASS**. Scope: only the production helper, runtime test file and this runbook. The manifest `files` map pins none of these files; manifest and qualification proof remain unchanged because evidence pins did not change.

No commit, network access, model call, protected-directory read, installation, DEV promotion or runtime READY write was performed. Local checks are author self-verification; independent QA of the exact resulting candidate and authorized integrator dry-run/read-back remain the next steps. No file outside the allowed list needed editing.

### Earlier test-environment repair (bdbf7536)

Test-environment repair for [PR #307](https://github.com/anpavel84-afk/gobadminton-clean/pull/307), 2026-10-25: source/base HEAD `4bab74350735d3bd9cf62e84a9c17e4ffb2a6b7b` (PR branch `codex/cursor-ready-runtime-accept-20261025`; supplied checkout is detached). Candidate is the uncommitted diff against that exact head. Role AUTHOR, sole writer of `scripts/chatops/tests` and `docs/ops` under the direct bounded Owner assignment; no runtime admission or PMA takeover. Requested/effective route is this local author session, without provider CLI calls. Accepted EOM 1.4 commit/hash are recorded above; SMART_ROUTING 1.0 commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`. Both full local texts were read and their hashes verified. The production helper, native adapters, manifests and qualification proof are unchanged by this repair. No commit, installation, runtime promotion, network request, provider call or protected-directory read was performed.

`test_actions_train_cursor_runtime_accept.py` is hermetic with respect to runner uid and TMPDIR, including default `/tmp`, other writable temporary locations and root/non-root execution. `TrustedRuntimeTree` patches only the `os.fstat` used by the upgrade module. It identifies fixture inodes by `(st_dev, st_ino)`, enumerated lazily on each call so later files and atomic replacements are included. Fixture ownership is modeled as root unless a test marks an inode uid 999; real modes, file types, link counts and all other stat attributes remain intact through a delegating result wrapper. Only real ancestors outside the fixture model a trusted system chain: uid 0 with group/world write bits cleared. This isolates host `/tmp`/home/TMPDIR metadata without sanitizing fixture permissions.

Runtime module, marker, proof and evidence walkers all use `runtime_bytes()` and its real no-follow `os.open` traversal plus `os.fstat`; none is bypassed or replaced. No `stat/lstat` patch is needed for these walkers. The existing receiver read and execute-dispatch boundary mocks remain scoped to their original tests. Real bytes, hashes, symlinks, parent symlinks, hardlinks, chmod, intent/marker writes and crash replay remain exercised. Explicit refusal reasons distinguish unsafe ownership/modes, unsafe paths, invalid file link counts, missing files and hash drift. New chmod cases reject evidence files 0664/0666 and fixture parents 0775/0777; the same trees pass after restoring 0644/0755. Proof and installed-module modes are also checked, with positive controls after restoration.

Author self-check results for this diff (uid 1002, no root privileges):

- Required runtime discovery: **50 tests, PASS** (43 retained + 7 new) using `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_cursor_runtime_accept.py'`, with TMPDIR in an allowed private directory.
- CI reproduction: the original unmodified HEAD file in a real **1777** TMPDIR stand-in ran **43 tests, 23 FAIL + 18 ERROR**, matching [CI run 40203170876](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/40203170876). The fixed file in that same environment ran **50 tests, PASS**. The fixture and temporary-directory stand-ins were owned by uid 1002. The actual `/tmp` and a real root run were **NOT_TESTED** here: `/tmp` is denied by this sandbox and this task forbids privilege escalation.
- Successor discovery: **17 tests, PASS**. Other permitted Cursor regressions: **33 tests, PASS** across `test_actions_train_cursor.py`, `test_actions_train_cursor_receipt.py` and `test_actions_train_cursor_upgrade.py`.
- Separate pre-existing sandbox limitation: two unchanged `SourceImport` methods request five `tempfile.mkdtemp(dir='/tmp')` fixtures through the native adapter. Earlier direct discovery recorded five `/tmp` EACCES errors. Those two methods were excluded from the 33-test regression run; their fixtures were neither modified nor redirected, and known-denied requests were not repeated. This limitation does not apply to the runtime-acceptance test file or impose a TMPDIR requirement on it.
- `python3 scripts/check_foundation.py`: **PASS, 289 Markdown files and 168 draft API operations**. `git diff --check`: **PASS**. Changed-file scope: only this runbook and `scripts/chatops/tests/test_actions_train_cursor_runtime_accept.py`; HEAD remains unchanged, with no commit.

For permitted local reproduction, set TMPDIR to an existing writable directory. To simulate CI without accessing `/tmp`, create a child directory there with mode 1777, select it as TMPDIR, and run the same runtime discovery in a fresh Python process. `TemporaryDirectory()` still uses its default location selection; the test file needs no special temporary path. The local verification stand-ins are disposable synthetic test artifacts.

Independent QA and live OPS verification remain separate steps. Next authorized step: independent QA of the exact source diff and existing integrator review/materialization, then the OPS dry-run/read-back above. The protected evidence bytes, actual native-receipt equality, root metadata and READY transition remain **NOT_TESTED on VPS** in this author session. Missing historical input `READY_REMAINDER.md` and the chosen runtime QA materialization destinations remain explicit integration limitations.
