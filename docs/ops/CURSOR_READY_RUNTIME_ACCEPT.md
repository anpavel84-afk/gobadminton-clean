# Cursor: runtime qualification canary → ready

Owner-direct source change, 2026-10-25. This runbook separates CLI qualification from product acceptance under EOM §6.2. Issue #225 remains QA FAIL (NaN coverage), deferred; this operation supplies no product QA PASS, CI PASS, DEV ACCEPTED or PROD authority. The original `accept` still requires the complete exact-head product lifecycle.

Historical initial author preflight (superseded by the real-state assignment below): repository `anpavel84-afk/gobadminton-clean`; source/base `0ebd58e57d31e4f273708dc98aab59f1572eedcf` (`origin/dev`, detached HEAD in the supplied checkout). EOM 1.4 source commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`. Role AUTHOR under this bounded Owner assignment, sole writer of its allowed files; requested/effective execution is this local author session, no provider CLI invocation or runtime admission. Candidate is the uncommitted diff against that base. Runtime PMA ownership remains unchanged. The requested `docs/handoffs/cursor-author-211/READY_REMAINDER.md` was absent from this source checkout.

Current author preflight (2026-10-25): repository `anpavel84-afk/gobadminton-clean`, PR #307 branch `codex/cursor-ready-runtime-accept-20261025`, exact source/base HEAD `38bdbc49ad3854849bf3a87d4f917e846ad973a2`. Candidate is the uncommitted diff against that head. Role AUTHOR, sole writer of the three allowed source/test/runbook files under Owner Pavel's direct R4 repair and targeted attestation assignment (t407u); no runtime admission or PMA takeover. Requested/effective route is this local author session; no model CLI, network or delegation. Full accepted EOM 1.4 (`13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`) and SMART_ROUTING 1.0 (`bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`) were read locally and verified. Allowed effects: source/test/runbook edits and synthetic offline author checks, evidence under `/home/agentagency-dev/author-evidence-readyfix5-20261025`. No secrets, protected directories, installation, commit or live write. Grok retains runtime PMA ownership. The supplied R4 findings and Owner-directed repair scope are the repair inputs; no new diagnosis or model call is performed here.

## Preconditions

Use the existing reviewed root integrator on Germany `vmi3510488`, after independent review of this exact source candidate. This document does not install it. Keep the reviewed helper bundle at one absolute, root-owned path, with no symlink components or group/world writable components. Pin the helper bytes through the existing OPS review/materialization process. The invocation must match the original journal's manifest, controller, stage and dispatch hashes; it must hold the same `controller.lock`.

The journal must be `active-canary`, policy `active` with the journal controller or the exact C5 controller below, and marker `canary` with identical canary task hash and successor. The marker must equal the journal's installed marker hash. Every marker module must match installed bytes; required pins remain:

- `native_cursor.py`: `02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089`.
- `native_guard.py`: `dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762`.

Installed code pins come from the live `STATE/backup.json.after`. Both backup and journal `record_before` require exactly `schema/manifest/before/after/units/activated/targets` with the existing member types and schema `GB_ACTIONS_TRAIN_BACKUP_V1`. Every prior `after` path and every non-marker journal `changes` path must remain in the live inventory. The live manifest, before, targets, units, activated and hashes may have advanced; old journal change hashes do not override the live inventory. Every marker module must belong to it. Every inventory path is canonical and absolute, without `..`, bounded to `INSTALL` or the installer's exact helper/monitor destinations; every hash is lowercase 64-hex. Every file is read through `runtime_bytes()` (root-owned, single-link regular file, no symlinks or group/world write in any component) and must match its live inventory hash, subject only to the exact rules-file exception below. No directory scan or `preserved` state is used as a replacement inventory.

Exactly one issue-#225 author across both slot journals must be the qualified, finished, confirmed Cursor / Auto author for the exact task, with integer (not boolean) `charged_calls: 1` and an imported native receipt equal to the pinned evidence. All issue-225 authors count regardless of task/status/charge. An additional author is allowed only as the exact non-executing deferral described below; failed, unknown, running, unfinished, extra confirmed or charged operations still refuse. The qualified author's completion must precede every recorded QA/DEV outcome for that task in its slot. At least one outcome is required; its verdict is not a qualification gate. All history, attempts and budget ledgers remain intact. These rules apply only to runtime qualification; original product `accept` selection is unchanged.

Runtime qualification validates structure before selecting operations or dereferencing their fields. Each slot journal and its `operations` must be dictionaries; operation keys are strings, values are dictionaries, and every binding has an exact integer issue (never boolean, float, string or null) and string stage. An invalid identity refuses the whole qualification rather than disappearing as another issue. For a valid other-issue binding, result/routing/usage are not inspected. Issue-225 QA/DEV operations only require valid types for the optional task hash and completion timestamp that selection reads; historical verdicts and unrelated stages such as `qa_qualification` remain admissible. The sole author additionally requires dictionary result/usage/native receipt, integer run and the fields used for confirmation. Null routing retains the existing empty-routing/executor-refusal behavior; list/string routing refuses as malformed. Missing/null result refuses cleanly. Timestamps follow receiver's numeric format (finite numbers, excluding booleans); missing/null completion still fails the sole-author completion requirement.

The successor journal, policy, marker/modules, backup inventory and its members, changes/pins, qualification intent/proof/operations and rollback history are checked before effects. The pinned receipt JSON also requires a dictionary with string phase/task hash and exact integer issue, independently of equality with the operation receipt. Malformed state produces `core.Refused` with a reason identifying the affected structure. Unknown or failed historical attempts are retained; these checks do not require product QA PASS.

The closed-schema [qualification proof](../handoffs/cursor-author-211/QUALIFICATION_PROOF.json) lists twelve artifacts with the Owner-supplied exact SHA-256 values. Its own SHA-256 in this source candidate is `dd287f87048cbbf67a6297bb069e9881b2bcdc797b973582979ca6d39e04b63f`. The helper rejects extra/missing fields, entries or altered pins, and verifies every available file's actual bytes on dry-run, apply, replay and rollback, with only the exact absent-artifact exception below. Files and every traversed directory must be root-owned, without group/world write; files must be regular, single-link and have no symlink components. Proof is bounded to 64 KiB, each evidence artifact to 64 MiB.

The three runtime QA artifact names below are **new root-owned materialization destinations**, not claims about their original locations:

- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v18-stream.jsonl`.
- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v20-stream.jsonl`.
- `/var/lib/gobadminton-actions-train/cursor-qualification-20261022/runtime-qa-v20-qa.json`.

Only these three files are to be materialized from the surviving originals by the Owner; never create a file named `runtime-qa-v18-launcher.py`. The integrator must materialize the already reviewed evidence through the existing authorized evidence process, preserving bytes and matching all proof hashes. Do not execute a historical launcher, rerun a model, substitute evidence, copy credentials, or relax metadata to satisfy a missing input. The remaining eight artifact paths are exactly those supplied by Owner. No evidence contents are included in public output. This source session did not access any protected state/evidence directory.

## Real-state compatibility

The supplied read-only audit found three legitimate changes since successor installation. This author session did **not** inspect the VPS and has **not run this candidate against live state**.

1. The journal still records its installed controller (`f377bb1e…`), while reviewed later installers advanced the active policy to C5, `41e12be2d551158e97ea30eaf8e95f992f998615`. Runtime acceptance permits only the journal controller or this exact `RUNTIME_C5_CONTROLLER`. Its write-ahead intent retains `controller == journal.controller` and separately records the actually observed `policy_controller`. Pending/completed replay, direct completion and rollback require that controller to remain pinned. Even switching between these two individually allowed controllers after intent refuses. Rollback retains its existing disabled/quiescent requirement; qualification requires active mode. No journal controller or live policy is rewritten.
2. `backup.json` is the live installed-code inventory, legitimately advanced by C5/scoped installers: seven additions, 15 newer hashes including superseded `stage.py` and monitor payloads, and changed metadata/manifest. The descendant checks above replace install-time equality. Every live inventory entry is hashed through the unchanged safe reader. Only `INSTALL/accepted-engineering-rules.md` permits recorded EOM 1.3 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c` with disk EOM 1.4 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`, or equality on either of these pins. A third rules SHA, including third==third, and the **reverse** recorded-1.4/disk-1.3 pair refuse. This exactly mirrors `foreign_inventory_matches` in `git show fd0696e:qa-artifacts/install291/install291_c5.py`. Inventory and rules bytes are never rewritten by acceptance.
3. Slot2 contains the qualified author and a subsequent pre-call refusal after `max_attempts=1`: result exactly `{"checkpoint": null, "reason": "attempts exhausted", "safe_release": true, "status": "deferred"}`. A tolerated extra must have exactly these four result keys, deferred status (also at operation level if present), true safe_release, null checkpoint and string reason. It must have the same task hash and a finite numeric completion strictly after the qualified author's completion. If `started_at` is present it too must be finite numeric and strictly later; no new required timestamp field is invented. No `routing`, `usage`, `charged_calls` or `native_receipt` key may occur anywhere in the operation, even nested. Every tolerated operation's key/digest is stored under its slot in intent `deferred_operations`; replay compares the whole map, catching added, removed, moved or changed deferrals. The existing `operations` field still pins the qualified author. `QUALIFICATION_PROOF.json` and its format remain unchanged.

The marker must still have exact canonical bytes matching its journaled hash and unchanged native-module pins. It reaches READY only through the existing journaled write path. All twelve proof pins remain mandatory. Eleven original files must be present after the three materializations above; only the exact absent v18 launcher can be replaced by the derived attestation below. No product acceptance gate, accounting history or safe-reader metadata protection is relaxed.

## Targeted qualification attestation (Owner t407u)

The original `cursor-qualification-20261022/runtime-qa-v18-launcher.py` no longer exists; the Owner confirms it cannot be supplied. `RUNTIME_MISSING_EVIDENCE` is exactly key `runtime_qa_v18_launcher`, name `cursor-qualification-20261022/runtime-qa-v18-launcher.py`, SHA-256 `8f35a86f64119661cecdc7710e8df4acd63baddd83ed66a5a02e3eb39e9bf481`. There is no wildcard, prefix or permission to substitute another key/hash/path. `QUALIFICATION_PROOF.json` remains byte-identical and lists all twelve pins.

Only `lstat` ENOENT at this exact path enables attestation. A present original is verified normally against its pin and needs no attestation. A wrong hash, symlink, directory, unreadable file or EACCES refuses. The other eleven files are still read by the unchanged no-follow, root-owned, regular, single-link safe reader and SHA-256 checked. The attestation does **not** claim the missing launcher content was reviewed or reconstructed. Never forge or execute it.

`verify_runtime_attestation` derives a receipt from already hash-verified surviving bytes. It checks the pinned v20 independent QA schema/verdict/reviewer, exact Auto/auto route, no credential leak files, the supplied original receipt and v20 launcher hashes, twelve started/completed tools, and a closed set of twenty-four checks whose values must all be boolean true. Its stream hash and integer size must match the pinned v20 stream and actual 130272 bytes; its guard pin must match `RUNTIME_MODULES['native_guard.py']`. The v18 stream must be exactly 85608 bytes of nonempty JSONL with every line parsed through the duplicate-rejecting loader. The author receipt retains its original shape and operation equality checks. No guessed schema is imposed on the other pinned artifacts. The v20 launcher's hash `489d365b314b1741ebfb9a5aaf649c73f1a5ef85e9583a8d219fa07142d73084` is solely a QA consistency fact, never the missing v18 launcher pin.

The computed `GB_CURSOR_RUNTIME_ATTESTATION_V1` block binds the eleven verified hashes, missing artifact and derived facts. It is stored only inside the existing `accepted_canary` proof, identically in journal, write-ahead intent and marker. It requires **independent QA PASS of the reviewing head and Owner ratification** before live use. Author self-checks do not satisfy that requirement. This source change does not grant READY or attest that those deployment gates have happened.

Pending/completed replay, rollback and completed rollback replay re-derive and compare the full proof, including the attestation and explicit absence status. If the original launcher appears after intent, even with its correct hash, the evidence mode changes and replay refuses with zero writes. Preserve that intent; reconcile through the existing authorized process (including rollback while the original evidence mode is restored, if applicable). A fresh acceptance after completed rollback verifies a recovered original normally. Never repin an in-flight intent or hand edit the marker. A forged journal attestation refuses before effects.

## Completion and rollback integrity (R4)

A shared `runtime_journal_acceptance` validator binds `journal.accepted_canary` exactly to `intent.proof` in qualifying-ready, active-ready and reverting-canary, before completion effects or success, including direct completion/write callers. The first qualifying-ready journal write already contains the runtime proof; null, empty, product-basis and other pre-acceptance values are never legitimate in that phase. Completed rollback has neither `accepted_canary` nor `qualification_intent`; its last history intent remains available for validation.

A shared slot walker validates both slot journals and all operation identities before selection or rollback. Issue-225 authors share `runtime_author_shape` in both paths. Rollback requires every intent-pinned qualified-author and deferred-operation digest unchanged, in its original slot/key. Shape-valid later unrelated activity may be added or updated without blocking rollback; rollback does not re-run the qualification sole-author selection against those later records. New author records for the same canary task also refuse; later authors for different task hashes remain admissible when shape-valid. Later unrelated QA verdicts remain historical data. Missing/moved/changed pinned operations or malformed operations in either slot refuse before any write, also on completed rollback replay. Disabled policy, quiescence, controller pin, marker/inventory checks and history retention remain mandatory.

## Live no-write preflight

An authorized root integrator on Germany must use an absolute **root-owned mode-0700 bundle built from the exact independently reviewed head**, including its unchanged qualification proof. This source checkout is not a deploy bundle. Do not invoke the uncommitted author candidate on live state. The existing root-owned `controller.lock` must already exist and be empty: `main()` calls the existing `receiver.locked()` (`O_RDWR|O_CREAT|O_NOFOLLOW`, exclusive flock). With that precondition dry-run writes nothing except opening/flocking the existing lock; no content is written to it. It does not write marker, journal, policy, inventory or monitor. A missing lock would be created by the legacy locking API, so establish the existing-empty-lock precondition through the normal read-only OPS check before running.

Exact command template (angle-bracket values are placeholders):

```text
python3 -B <bundle>/scripts/chatops/ops/cursor_successor_upgrade.py accept-runtime --dry-run --bundle <bundle> --manifest <journal.manifest> --controller <journal.controller> --stage-hash <journal.stage_sha256> --dispatch-hash <journal.dispatch_sha256>
```

All four CLI release values come from the original successor journal, **not** from live policy C5, live backup manifest, bundle source SHA or current workflow files. `main()` requires all these flags for this action; it has no separate apply flag. Dry-run needs no `--proof-sha256`. Apply is the same invocation with `--dry-run` removed and `--proof-sha256` set to the reviewed dry-run's `accepted_canary.qualification_proof_sha256`.

Expected JSON contains `dry_run: true`, `phase: qualifying-ready` for the initial in-memory preview (or the replay phase), `would_change.marker_phase: ready`, `would_change.journal_phase: active-ready`, `would_change.old_hash/new_hash`, and `accepted_canary` with runtime basis, slot, author_run, proof SHA and all twelve evidence paths/hashes. With the launcher absent, its evidence entry explicitly includes `status: ABSENT_REPLACED_BY_ATTESTATION`, and `accepted_canary.attestation` contains the missing artifact key/name/full SHA, the eleven `bound_sha256` pins, derived facts and the independent-QA/Owner requirement. Review this entire block and explicitly record the absence. A successful preview does not claim product acceptance. Review and retain it through the existing private OPS evidence channel before applying.

| Refusal | Meaning / authorized next step |
| --- | --- |
| `runtime canary acceptance identity` | Initial controller is neither journal nor exact C5, mode is not active, or canary task/successor/marker identity differs. Reconcile; do not rewrite pins. |
| `qualification intent drift` / `qualification policy controller drift` | Live policy or observed controller changed since intent, including journal↔C5. Preserve intent and reconcile. |
| `installed code drift: invalid backup schema` / `malformed backup record: members` | Wrong keys/schema/member types. Obtain the existing authoritative inventory; do not fabricate one. |
| `installed code drift: unrecorded or missing inventory entry` | A prior inventory path or non-marker journal change path was removed. Reconcile installer history. |
| `installed code drift: path outside installation` | Noncanonical path, `..`, relative path or destination outside exact install/helper/monitor scope. Refuse that inventory. |
| `installed code drift` | Invalid SHA, ordinary disk/inventory mismatch, third rules SHA or reverse rules pair. Diagnose the exact file through authorized OPS. |
| `installed code drift: unrecorded marker module` / `qualified adapter drift` | Missing inventory module or changed native adapter. Preserve marker and investigate. |
| `one confirmed runtime canary author required` / `runtime canary executor/confirmation mismatch` | Missing/extra executing author, wrong task/charge/receipt, or extra author fails the strict deferral shape/time/no-execution checks. Preserve every attempt. |
| `malformed operation record…` | Invalid author/binding/result/timestamp types, including malformed deferrals. Reconcile without deleting history. |
| `runtime qualification operation evidence changed` / `qualification operation evidence changed` | Qualified author or pinned deferral map changed after intent. Do not repin an existing intent. |
| `foreign qualification marker…` / `runtime qualification journal marker drift` | Marker bytes/hash or journal phase/hash no longer match the recorded transition. No hand edits. |
| `runtime evidence missing or unsafe` / `runtime evidence sha256 mismatch: …` | Missing evidence or wrong bytes; use the Owner's reviewed materialization process. All eleven surviving files remain required; only the exact absent launcher permits the verified attestation. |
| `untrusted runtime evidence metadata` / `invalid runtime evidence file` | Unsafe ownership/mode/link/file type. Use existing authorized root materialization, never loosen the reader. |
| `runtime rollback identity drift` / `runtime rollback replay drift` | Policy differs from pinned policy with disabled mode, including controller change. Reconcile before rollback. |

This live preflight is **NOT_TESTED** here. The commands below are templates for the authorized integrator.

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
python3 -B "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  accept-runtime "${cursor_accept_args[@]}" --dry-run
```

Review the returned `would_change` hashes and `accepted_canary`: basis `runtime_qualification`, exact author run, proof SHA and all evidence digests. Dry-run makes no marker/journal writes and does not publish the monitor. The existing controller lock is acquired. Save the reviewed dry-run output in the existing private OPS evidence channel. Then apply with **the SHA returned by that dry-run**, which must match the reviewed proof above:

```bash
CURSOR_PROOF_SHA=dd287f87048cbbf67a6297bb069e9881b2bcdc797b973582979ca6d39e04b63f
python3 -B "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  accept-runtime "${cursor_accept_args[@]}" --proof-sha256 "$CURSOR_PROOF_SHA"
```

Apply revalidates all inputs and completion checks, then persists `qualification_intent` before any marker effect: journal `active-canary → qualifying-ready → active-ready`, marker `canary → ready`. The runtime completion writer is also used for runtime intent replay through `complete_qualification`; product replay retains its original implementation. Intent pins proof path/SHA, all evidence hashes, selected author-operation and per-slot deferral digests, exact old/new marker objects/hashes, policy, controller, task and successor. Marker and journal `accepted_canary` explicitly record `acceptance_basis: runtime_qualification`.

The exception boundary is the decorated read/validate/prepare functions `runtime_dispatch_preflight`, `runtime_accept_preflight`, `runtime_completion_preflight` and `runtime_rollback_preflight`. Initial acceptance also completes replay validation in memory before persisting its intent. Rollback prepares its complete ordered write plan before its first atomic write. An unexpected `Exception` during these preflights becomes `core.Refused('runtime acceptance refused: malformed or unreadable state (<ExceptionClassName>)')`; an existing `core.Refused` passes through as the same exception. `KeyboardInterrupt` and `SystemExit` propagate. The atomic intent/marker/journal writes and monitor publication are outside this converting handler. Their exceptions propagate unchanged and may mean a partial write; reconcile the journal before replay. A write failure is never presented as a preflight refusal with zero effects. Dry-run only returns the prepared preview. Original product acceptance/replay uses its preserved implementation.

After an interrupted apply, reconcile the known operation and repeat that exact command with the same bundle and proof SHA. Existing intent is revalidated, then only its missing effect is completed. A completed replay makes no marker/journal writes. Both pending and completed replay recheck the complete live code inventory and all issue-#225 authors. Foreign marker, changed qualified author or pinned deferral set, extra executing author, altered evidence/proof, installed-code or policy drift is refused. Do not reset the journal or repeat a provider call. The dry-run hash also detects byte-only proof changes between separate dry-run/apply processes without making dry-run stateful.

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
python3 -B "$BUNDLE/scripts/chatops/ops/cursor_successor_upgrade.py" \
  rollback-runtime "${cursor_accept_args[@]}"
```

This narrow action holds `controller.lock`, verifies the same release identity and exact intent hashes, and durably records `reverting-canary` before restoring only `intent.old_marker` through the atomic writer. It refuses foreign marker/controller drift and rechecks the complete live installed-code inventory before rollback effects. It reverts the journal marker hash to `intent.old_hash` and phase to `active-canary`, retaining the complete original intent and rollback timestamp in `qualification_history`. Policy remains disabled; source, budgets, operations, failures and attempts remain untouched. The original preactivation `rollback` remains unchanged and refuses postactivation rollback.

On interruption, reconcile and repeat the same `rollback-runtime` command. Verify marker equals the archived `qualification_history[-1].intent.old_marker` and its hash equals `old_hash`; journal is `active-canary` with that exact hash, policy remains disabled, and #225 is still deferred. Re-enabling dispatch is a separate existing authorized activation operation; this rollback does not do it. A later runtime acceptance retains the archived qualification history.

## Source validation record

### R4 and targeted attestation author verification against 38bdbc49 (uncommitted)

2026-10-25, PR #307; source/base `38bdbc49ad3854849bf3a87d4f917e846ad973a2`, direct Owner t407u assignment, AUTHOR only. The changes and deployment conditions are documented above. Only this runbook, `scripts/chatops/ops/cursor_successor_upgrade.py` and `scripts/chatops/tests/test_actions_train_cursor_runtime_accept.py` changed. No standalone attestation document is needed: the attestation is computed from verified bytes. All twelve proof pins and the proof file bytes remain unchanged.

Author self-checks: **182/182 runtime tests PASS** with private TMPDIR mode **0700** (640.035 s), and **182/182 PASS** with a TMPDIR child of actual mode **1777** (641.375 s). There are **22 new test methods**; all 186 existing test/fixture methods remain byte-identical. Each run includes deterministic seed `3070405`: **23,868** field/container mutations over pending, completed, rollback and rollback-replay; **1,521** accepted mutations only within the test's explicit ignored/history set, otherwise clean `Refused`, zero atomic writes and zero monitor publication. Accepted outcomes/effect destinations equal their unmodified baseline. No unhandled exceptions occurred. The cheap fuzz fixture uses trusted in-memory synthetic bytes and memoizes derivation only for exactly identical already-verified byte inputs. Dedicated metadata negatives retain the real safe reader and unchanged ownership fixture. Semantic-negative fixtures re-pin synthetic bytes to exercise derivation independently of hash rejection. The explicit recovered-original test uses a synthetic sentinel hash, never actual missing launcher bytes.

Mutation results: **40/40 killed, no surviving mutants**, including each of the three QA R4 survivors in independent caller tests. The retained first pass found three additional survivors (stream-size constant redundant with actual-size comparison, slot walker redundant with later errors, completion-preflight proof check redundant with writer check). Tests now distinguish each: coherent wrong stream-size pair; an unpinned malformed boolean issue; direct preflight invocation. All three are killed in the recorded rerun. Existing tests and production checks were retained. Other Cursor suites: successor **17 PASS**, receipt **16 PASS**, upgrade **3 PASS**, cursor **14 PASS**. The two unchanged `SourceImport` methods with known direct denied `/tmp` requests remain **NOT_TESTED**, without retry or redirection. Foundation and diff/scope/byte-identity checks pass. `acceptance_operations()`, `accept_canary()`, `execute()`, `runtime_bytes()` and legacy product completion remain byte-identical to HEAD.

Evidence: `/home/agentagency-dev/author-evidence-readyfix5-20261025/SUMMARY.txt`, `runtime-private-final.log`, `runtime-1777-final.log`, `mutation-final-results.json`, `weakening-review.json`, `static-identity.log` and `candidate.diff`. The weakening review enumerates all 25 removed production lines and their retained/strengthened replacement checks. Earlier diagnostic failures and interrupted superseded runs are preserved as history. These are author checks; **independent QA, CI, actual original evidence/live no-write preflight and DEV remain NOT_TESTED**. No commit, network/model CLI, secret/protected-directory access, installation or live marker edit occurred. Next: fresh independent QA of the exact resulting candidate, Owner ratification, then the existing authorized OPS materialization of only the three QA files and live no-write preflight.

### Real-state compatibility against 1aae87fe (uncommitted)

2026-10-25, AUTHOR self-check under the current preflight above. Production changes are limited to A–C in “Real-state compatibility”; no new write destination exists. `acceptance_operations`, `accept_canary`, `execute`, `complete_product_qualification`, `runtime_evidence` and `runtime_bytes` remain byte-identical to HEAD. `QUALIFICATION_PROOF.json` and the controller manifest remain byte-identical. All 125 existing test methods remain, with 35 real-state methods added (160 total). The original install-time fixture remains the default, and `TrustedRuntimeTree` is unchanged. Five old test inputs/assertions needed explicit updates because their old inventory expectations contradict the requested descendant contract: changes-only files now need a live inventory entry; a conflict is checked against live bytes; valid recorded additions and changed manifests are allowed, while drift and non-string metadata still refuse. No test method was removed.

The real-state fixture uses an install-time successor journal, a 32-entry descendant inventory with exactly seven additions and 15 newer hashes (including `stage.py`, receiver and external monitor payloads), changed manifest/before/targets/units, exact C5 policy and the supplied four-key deferred result. Rules files are real public Git blobs read offline from EOM 1.3 commit `1169e965976e9498d4e5e1e23aae201e97ec9665` and C5 commit `41e12be2d551158e97ea30eaf8e95f992f998615`, with actual SHA-256 assertions; no reader or hashing mock substitutes for these pins. The only subprocesses used by this fixture load those local immutable Git blobs before per-test no-command patches. All runtime file checks retain real no-follow reads, link counts, modes, bytes and atomic journal/marker writes under synthetic ownership metadata.

New negative tables cover initial acceptance, dry-run, pending and completed replay (both dry-run and apply), wherever applicable. Each refusal checks complete file snapshots, write counts and monitor publication. They cover the third/reverse rules pins, ordinary drift, removed prior/change paths, malformed/foreign inventory, third controller and disabled C5, policy/controller drift after intent, every specified bad deferral shape/status/execution/timestamp/task binding, charged UNKNOWN in the other slot, altered/moved/removed/new deferrals after intent and malformed new intent fields. Positives cover dry-run, apply, all interrupted writes/replay, direct completion, same-pin rules equality, per-slot deferral pinning and rollback/history replay. `started_at`, when present, is also checked strictly after qualified completion; this is a stricter compatible guard, without requiring an extra timestamp field absent from the supplied example.

Non-vacuity: **35/35 new test methods detect corresponding scratch mutants**, including separate deletion of rules-pair, ordinary disk-match, prior-descendant, change-descendant, backup-schema, path and individual deferral predicates. Redundant controller-policy identity checks are removed together where necessary to expose drift; deferred-map comparison is removed separately to expose otherwise-valid post-intent tampering. **7/7 positive real-state methods reject exact `1aae87fe5bc060c4a54f24aa6d19985f4e4abaa4` production**, at its canary identity refusal, with zero setup/import errors. All mutant and baseline source copies live under private TMPDIR, never in the checkout. These are author self-checks, not independent QA.

Final runtime discovery: **160/160 PASS** with private mode-0700 TMPDIR (`runtime-private-verified.log`, 520.433 s), and **160/160 PASS** with a TMPDIR child of actual mode **1777** (`runtime-1777.log`, 624.039 s). The final path-fixture witness also passes independently in 1777 (`runtime-1777-final-fixture.log`); fixture files retain real metadata checks. Default denied `/tmp` and actual root execution remain NOT_TESTED. `python3 -B scripts/check_foundation.py`: **PASS**, 289 Markdown files / 168 draft API operations. `git diff --check`: **PASS**; status contains only the three allowed files, HEAD unchanged. Production SHA-256 `b6c3d623b4d35f21122cd81895bcbc663af82aaa0abc0c0c3a01cdfb7ac06238`; test SHA-256 `099ca2482639e57e57a9d3ebbb98f9cda6aff2f86076fdaa33eab1981437b63a`.

Cursor regressions: successor **17 PASS**, receipt **16 PASS**, upgrade **3 PASS**, cursor **14 PASS**. The two unchanged `SourceImport` methods with known direct `/tmp` EACCES remain **NOT_TESTED**; those denied requests were not repeated or redirected. The actual live state, CI, independent QA and DEV are **NOT_TESTED**. No commit, network, model call, secret/protected-directory access, installation or live READY change occurred. The next permitted step is fresh independent QA of this exact candidate, followed by authorized root-bundle materialization and the no-write preflight after all evidence is present.

Local author logs, scratch sources and mutation metadata are under `/home/agentagency-dev/author-evidence-readyfix4b-20261025/`: `runtime-private-verified.log`, `runtime-1777.log`, `nonvacuity-verified.log`, `nonvacuity-results.json`, `static-identity.log`. The mutation JSON names every test and scratch log; retained earlier diagnostic logs are not acceptance evidence.


### MEDIUM QA R3 repair against 9acda75c (uncommitted)

2026-10-25, PR #307 source/base HEAD `9acda75c2af9235b6cb505bc6e2c4899df1edb7b`, supplied detached checkout of `codex/cursor-ready-runtime-accept-20261025`, repository `anpavel84-afk/gobadminton-clean`. Role AUTHOR under Owner's direct bounded R3 repair assignment and supplied findings, sole writer of the three allowed files: this runbook, `scripts/chatops/ops/cursor_successor_upgrade.py` and `scripts/chatops/tests/test_actions_train_cursor_runtime_accept.py`. Candidate is the uncommitted diff against that SHA; no new candidate commit exists. Requested/effective route is this local author session, without model CLIs or delegated agents. No runtime admission or PMA takeover; Grok remains runtime PMA. Both full local accepted texts were read and hashes verified: EOM 1.4 commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`; SMART_ROUTING 1.0 commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`.

R3 adds the shape rules and preflight exception boundary described above. All issue-225 authors still count; the F1 installed inventory and F2 sole-author conditions remain. Initial apply now finishes completion validation before its first intent write. Runtime replay validates both slots and the sole author before comparing operation digests, so corrupt identities/results cannot disappear behind selection or digest drift. Rollback builds its entire journal/marker/history write plan before effects, including replay of `reverting-canary` and completed rollback history. Original `acceptance_operations()`, `accept_canary()` and `execute()` source text is byte-identical to HEAD; the first two also match the original dev base `0ebd58e57d31e4f273708dc98aab59f1572eedcf`. The original complete-qualification body is preserved under `complete_product_qualification`; the dispatcher retains legacy product replay. The added execute wrapper routes only `accept-runtime` and `rollback-runtime` through runtime preflights.

Author self-check results (synthetic files, uid **1002**, no root privileges):

- Required runtime discovery: **125 tests PASS** with private mode-700 TMPDIR, then **125 tests PASS** with mode-1777 TMPDIR. All 80 existing tests remain; **45 methods added**. All 95 original test/fixture methods, including `TrustedRuntimeTree`, are byte-identical to HEAD. Actual default `/tmp` is **NOT_TESTED** because the sandbox denies it; the fixture still uses ordinary `TemporaryDirectory()` selection and models only ancestor trust metadata, with real fixture modes, links, hashes and atomic writes.
- New negative tables exercise both slots and initial/pending/completed qualification, with both dry-run and apply wherever applicable. They assert stable refusal reasons, unchanged full file snapshots, unchanged write counts and no monitor publication. Coverage includes malformed operation identity/container/author fields, QA/DEV fields actually read, slot journals, successor/policy/marker shapes, backup members, changes/pins, intent/proof/operations, direct completion, runtime release identity and rollback pending/reverting/completed replay. A pinned-receipt parser fault injection also verifies receipt shape independently of Python's numeric equality. Positive historical operations remain accepted. Separate tests preserve the exact existing `Refused`, propagate `BaseException`, and prove that write-phase exceptions propagate unchanged after a real partial write.
- **39/45 new methods FAIL** against exact `9acda75c` production loaded from scratch, with **zero setup/import errors**. The six expected baseline passes cover existing invalid-change-pin and backup-schema guards, historical-operation compatibility, `Refused` identity, `BaseException` propagation and write-exception propagation. Those checks were already correct; their new coverage is intentional. **45/45 corresponding scratch mutants are detected**, including separate deletions of both surviving installed-code guards and the sole-author task-hash, completion and status conjuncts. The task-only and completion-only cases begin with a different string hash and numeric zero respectively, so their mutants cannot rely on an unrelated malformed type. No checkout production file was mutated for these checks.
- Cursor regressions: successor **17 PASS**, receipt **16 PASS**, upgrade **3 PASS**, cursor **14 PASS**. The two unchanged `SourceImport` methods `test_one_charged_call_imports_only_authorized_source` and `test_failure_timeout_offscope_and_secret_never_import` remain **NOT_TESTED** due to their known sandbox `/tmp` EACCES; the known-denied requests were not repeated or redirected.
- `python3 scripts/check_foundation.py`: **PASS**, 289 Markdown files and 168 draft API operations. `git diff --check`: **PASS**. Scope is exactly the three allowed files. `QUALIFICATION_PROOF.json` and `manifest.json` remain byte-identical to HEAD; the manifest's `files` map pins none of the changed files.

Local author evidence is under `/home/agentagency-dev/author-evidence-readyfix3-20261025/`: `runtime-private-verified.log`, `runtime-1777-verified.log`, regression logs, `static-identity.log`, `nonvacuity-verified.log` and `nonvacuity-results.json`. The latter identifies the scratch copies/logs under the private TMPDIR (`r3-nonvacuity-n12v8ofj`). Candidate production SHA-256 is `0667c022f0b5c9e6700da069401bf1a19ae7ad3a673504174d662805f6606d57`; test-file SHA-256 is `af9e29fc9d7527682b5ef6adb11209e93eb40e3ac36c4085709d05e81435a3c5`. These are author evidence, not independent QA.

No commit, network request, model call, secret/protected-state access, installation, runtime READY change or DEV promotion occurred. CI, independent QA and live integrator dry-run/read-back are **NOT_TESTED** in this source session. The next permitted step is fresh independent QA of this exact resulting candidate, followed by the existing authorized integration process after its gates. No file outside the allowed source list needed editing.

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
