# Cursor: runtime qualification canary → ready

Owner-direct source change, 2026-10-25. This runbook separates CLI qualification from product acceptance under EOM §6.2. Issue #225 remains QA FAIL (NaN coverage), deferred; this operation supplies no product QA PASS, CI PASS, DEV ACCEPTED or PROD authority. The original `accept` still requires the complete exact-head product lifecycle.

Author preflight: repository `anpavel84-afk/gobadminton-clean`; source/base `0ebd58e57d31e4f273708dc98aab59f1572eedcf` (`origin/dev`, detached HEAD in the supplied checkout). EOM 1.4 source commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`. Role AUTHOR under this bounded Owner assignment, sole writer of its allowed files; requested/effective execution is this local author session, no provider CLI invocation or runtime admission. Candidate is the uncommitted diff against that base. Runtime PMA ownership remains unchanged. The requested `docs/handoffs/cursor-author-211/READY_REMAINDER.md` was absent from this source checkout.

## Preconditions

Use the existing reviewed root integrator on Germany `vmi3510488`, after independent review of this exact source candidate. This document does not install it. Keep the reviewed helper bundle at one absolute, root-owned path, with no symlink components or group/world writable components. Pin the helper bytes through the existing OPS review/materialization process. The invocation must match the original journal's manifest, controller, stage and dispatch hashes; it must hold the same `controller.lock`.

The journal must be `active-canary`, policy `active` with the same controller, and marker `canary` with identical canary task hash and successor. The marker must equal the journal's installed marker hash. Every marker module must match installed bytes; required pins remain:

- `native_cursor.py`: `02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089`.
- `native_guard.py`: `dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762`.

Exactly one confirmed author operation for the canary task must exist across both slot journals. It must record Cursor / Auto, exactly one charged call and an imported native receipt equal to the pinned on-disk receipt, bound to issue #225 and the canary task. The author's completion must precede every recorded QA/DEV outcome for that task in its slot. A QA/DEV outcome is required; its verdict is not a qualification gate. Historical failures, attempts, native/source receipts and budget ledgers remain intact.

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

After an interrupted apply, reconcile the known operation and repeat that exact command with the same bundle and proof SHA. Existing intent is revalidated, then only its missing effect is completed. A completed replay makes no marker/journal writes. Foreign marker, changed author operation, added second confirmed author, altered evidence/proof, module or policy drift is refused. Do not reset the journal or repeat a provider call. The dry-run hash also detects byte-only proof changes between separate dry-run/apply processes without making dry-run stateful.

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

This narrow action holds `controller.lock`, verifies the same release identity and exact intent hashes, and durably records `reverting-canary` before restoring only `intent.old_marker` through the atomic writer. It refuses foreign marker/module/controller drift. It reverts the journal marker hash to `intent.old_hash` and phase to `active-canary`, retaining the complete original intent and rollback timestamp in `qualification_history`. Policy remains disabled; source, budgets, operations, failures and attempts remain untouched. The original preactivation `rollback` remains unchanged and refuses postactivation rollback.

On interruption, reconcile and repeat the same `rollback-runtime` command. Verify marker equals the archived `qualification_history[-1].intent.old_marker` and its hash equals `old_hash`; journal is `active-canary` with that exact hash, policy remains disabled, and #225 is still deferred. Re-enabling dispatch is a separate existing authorized activation operation; this rollback does not do it. A later runtime acceptance retains the archived qualification history.

## Source validation record

Run all mandatory checks on the exact diff. No commit, installation, runtime promotion, network request, provider call or protected-directory read is performed by this author task. Independent QA and live OPS verification remain separate steps. Tests virtualize root ownership because the author cannot chown files to root; file bytes, SHA-256, no-follow traversal, modes, hardlinks, intent/marker writes and crash replay use synthetic files in an allowed workspace. Foundation checking is bounded static validation.

Author results on this uncommitted candidate:

- New runtime tests: **43 tests, PASS** using `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_cursor_runtime_accept.py'`.
- Existing successor regression file: **17 tests, PASS**; `accept_canary` and `acceptance_operations` also compared byte-for-byte against the base and remained unchanged.
- Required direct `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_cursor*.py'`: the initial invocation ran **71 tests, 5 errors**, all `PermissionError: [Errno 13]` from existing `SourceImport` fixtures requesting `tempfile.mkdtemp(..., dir='/tmp')` in the unchanged native adapter. The active filesystem profile forbids `/tmp`. This direct invocation is **not PASS**. It was not repeated with the same known-denied requests.
- Final complete Cursor discovery with those five synthetic temporary-directory requests redirected into the permitted evidence workspace: **76 tests, PASS**, including the subsequent added boundary tests. No adapter code, CLI invocation, network, permission or protected-directory access was introduced by that fixture adjustment.
- `python3 scripts/check_foundation.py`: **PASS, 287 tracked Markdown files and 168 draft API operations**. The new untracked runbook was separately checked with the same `markdown_errors` function: **1 file, PASS**; the foundation script uses `git ls-files`, so its reported count excludes this new file until integration.
- `git diff --check`: **PASS**. Exact changed/untracked-file scope: **4 allowed files**. Both native module hashes and the qualification proof hash match the values above. The install manifest is unchanged; an OPS helper/proof is not an install payload entry.

Reproduce the permitted synthetic discovery (set both environment variables on the Python command; the direct command above still has the documented `/tmp` limitation):

```bash
TMPDIR=/home/agentagency-dev/author-evidence-ready-20261025 \
PYTHONDONTWRITEBYTECODE=1 python3 - <<'PY'
import os, tempfile, unittest
from unittest.mock import patch
original = tempfile.mkdtemp
redirected = []
def synthetic_temp(*args, **kwargs):
    if kwargs.get('dir') == '/tmp':
        kwargs['dir'] = os.environ['TMPDIR']
        redirected.append(kwargs.get('prefix'))
    return original(*args, **kwargs)
with patch.object(tempfile, 'mkdtemp', side_effect=synthetic_temp):
    suite = unittest.defaultTestLoader.discover(
        'scripts/chatops/tests', pattern='test_actions_train_cursor*.py')
    result = unittest.TextTestRunner(verbosity=1).run(suite)
print('Synthetic /tmp fixture requests redirected:', len(redirected))
raise SystemExit(not result.wasSuccessful())
PY
```

Next authorized step: independent QA of the exact source diff and existing integrator review/materialization, then the OPS dry-run/read-back above. The protected evidence bytes, actual native-receipt equality, root metadata and READY transition remain **NOT_TESTED on VPS** in this author session. Missing historical input `READY_REMAINDER.md` and the chosen runtime QA materialization destinations are explicit integration limitations, not invented runtime facts.
