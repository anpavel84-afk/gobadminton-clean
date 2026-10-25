# Admission PM for Issue #29

Source implementation, AUTHOR self-check only. **Not installed; no runtime admission
or provider qualification is claimed.** Grok remains the single mutating PMA.
Admission PM is a finite deterministic command in the existing AI Train, with zero
model calls. It does not schedule work or dispatch a provider. GitHub Actions and
the existing receiver continue executing the separately admitted stage.

This assignment permits only `admission_pm.py`, the shared-helper refactor in
`owner_package_admission.py`, delegated provenance support in
`antigravity_qa_recovery.py`, their bundle manifest, synthetic tests, and this file.
No installed C5 pins, marker, permissions, AppArmor, sandbox, network configuration,
secrets, budgets, or historical state were changed. No installation or commit was
performed.

Preflight source: `anpavel84-afk/gobadminton-clean`, supplied dev checkout at
`0ebd58e57d31e4f273708dc98aab59f1572eedcf` (detached HEAD; no local dev ref).
Role: AUTHOR under the direct Owner assignment in this task; Grok retains runtime
ownership. Base/source is that SHA; candidate is the uncommitted allowed-file diff.
Accepted EOM 1.4: commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256
`8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, full text
loaded. Routing policy: SR0 accepted, classifier not installed; this change makes
no model-route or mandatory-QA change. Requested/effective author route is this
assigned Codex session; backend model identity/effort is not exposed in the task
inputs. This record is not a runtime grant or independent QA.

## Procedure and CLI

Grok's instruction “get next admission for Issue #29” maps to a trusted operator
invocation with the exact role, delegation comment ID and immutable request data.
No new bot identity, permission, workflow, scheduler or always-on service is added.
Existing authorized trusted root OPS invokes the installed script:

```sh
python3 /usr/local/lib/gb-actions-train/admission_pm.py --dry-run \
  --issue 29 --role technical_pm_product_analyst \
  --delegation-comment-id 6390011223 \
  --request-json '{"source_base":"b0e4d233bc150f42ada86c4c0f56897c57e0d0fe","source_head":"0ebd58e57d31e4f273708dc98aab59f1572eedcf","input_revision":"0ebd58e57d31e4f273708dc98aab59f1572eedcf","input_path":"scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json","input_sha256":"40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55"}'
```

These are example data, not a claim that the installed canary has these revisions.
Use `--apply` for enrollment or exact intent recovery; `--status` only reads an
existing result. All modes require trusted root ancestry and hold the same
`STATE/controller.lock` used by receiver and personal Owner enrollment. This is
the existing receiver lock domain, not an additional lock or admission ledger.

The request has exactly `source_base`, `source_head`, `input_revision`,
`input_path`, `input_sha256`. Revisions must be full lowercase immutable Git SHAs.
The fixed native canary HEAD must equal `source_head`; the base must expose the
existing INERT analysis artifact at that exact revision. Every input is read by
the existing native root Git read helper and its SHA-256 verified. QA inputs must
pass the existing `GB_AGY_29_QA_TEST_CONTRACT_V1` contract, including exact candidate
and successful test receipts. No candidate test command is executed by this helper.

One request registers one finite one-use role grant in the existing
`GB_AGY_29_OWNER_PACKAGE_V1` ledger schema, with validated `delegation` provenance
in both ledger and grant. Package/receipt names use a deterministic SHA-256 of
issue, role, delegation ID and request. Repeating the same request returns
`ALREADY_GRANTED` with the same ID; it never rewrites or recharges the package.
`--dry-run` returns `GRANTED` with `dry_run=true`, without writing a receipt or
exposing a grant. Otherwise results are `GRANTED`, `BLOCKED`, `NEEDS_OWNER`, with
paths, reason, remaining budget and `model_calls=0`. Nonstandard or refused cases
set `needs_review=true`; they do not invoke Technical PM or another model.

Authentication performs the same public read-only GitHub comment fetch as the
personal Owner path. No GitHub write or credential is needed. All author tests
mock HTTP transport; no network, provider CLI or installed protected state is
accessed during source verification.

## Immutable Owner delegation comment

Owner numeric ID must be `318610566`, login `anpavel84-afk`, association
`OWNER`, `MEMBER`, or `COLLABORATOR`, and the response must identify Issue #29
in CLEAN. The response is limited to 32768 bytes. The comment must have valid UTC
`created_at == updated_at`; editing invalidates it. The prefix is exactly
`GOBADMINTON_ADMISSION_DELEGATION_V1` followed by one newline. The JSON body uses
Python `json.dumps(value,sort_keys=True,separators=(',',':'))`: no extra whitespace,
trailing newline, duplicate keys, extra fields or nonfinite numbers.

Concrete canonical example (one prefix line, one JSON line; example ID only):

```text
GOBADMINTON_ADMISSION_DELEGATION_V1
{"allowed_input_paths":[{"path":"scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json","revision":"0ebd58e57d31e4f273708dc98aab59f1572eedcf","sha256":"40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55"}],"controller_sha":"INSTALLED_ACTIVE","delegation_comment":6390011223,"expires_at":"2026-11-25T00:00:00Z","issue":29,"max_calls_per_package":5,"max_packages":3,"max_total_calls":5,"model":"claude-sonnet-5-5-medium","repo_id":1416250340,"roles":["technical_pm_product_analyst"],"rules_sha256":"8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5","schema":"GB_ADMISSION_DELEGATION_V1","scope":"DEV_OPS_ONLY"}
```

**Publication prerequisite remains unresolved:** `delegation_comment` must equal
the comment's actual self-ID at creation. GitHub assigns that ID after posting;
this change supplies no ID-preallocation mechanism. The example cannot simply
be posted unchanged, and posting then editing the ID is rejected. Before real
use, Owner/PMA must resolve this constraint in the specified protocol; an amended
protocol would need its own reviewed change. Never fabricate an Owner response,
accept an edited bootstrap, guess a comment ID, or impersonate Owner to install it.

Fields are a closed set. Roles may only narrow the two existing addressed roles;
model, rules, CLI, permission mode, transport, timeout, output cap, slot and canary
scope retain existing constraints. V1 supports exact `{revision,path,sha256}`
triples only, with the existing `scripts/chatops/tests/fixtures/agy-*.json` path
shape. It deliberately does not implement wildcard authority. Analysis remains
bound to the existing INERT #230 artifact and its existing hash. QA may bind a
new full QA fixture, but must retain the existing source/test contract and prior
COMPLETE analysis with `view_file`, `run_command` and two verified source reads.
Source artifacts are read-only inputs; none authorize product implementation.
Money, PROD, access expansion, product authority or QA waivers have no fields.

## Accounting, history and refusal

The package lineage is **all dynamic personal Owner packages plus all delegated
packages for #29**, regardless of the new delegation comment ID. All their
receipts must be complete and match their original enrollment checksum. Used
calls count unique consumed grant operations, including FAIL/UNKNOWN charges;
cumulative counters in successors are never summed again. A new package starts
at that already-spent count. Both the delegated ceiling (at most 5 under EOM
§6.3) and finite total-call/package limits apply to the whole package lineage.

Older fixed qualification, addressed and supplemental allowances remain separate
historical budgets, as defined by their existing schemas. They are not recast
into dynamic packages or added again as inherited dynamic-package calls. The
existing HIST/SUP/BUDGET SHA pins and original UNKNOWN pin remain checked, and
are never rewritten. Every dynamic predecessor is additionally referenced by
filename and exact SHA-256; runtime reservation validates those pins, its
inherited counter and the predecessor analysis row. No predecessor is modified
by admission. Old unused grants are not dispatched through the new marker.

An unresolved UNKNOWN, unfinished operation, safety-refusal evidence, unfinished
other enrollment, missing receipt, changed source/input/hash, busy slot or
foreign transaction state returns `BLOCKED`. Existing exact scheduling
reconciliation receipts may release the three specifically pinned old UNKNOWNs;
they do not erase their results or charges. There is no general UNKNOWN release
or retry in Admission PM. An unrecognized historic UNKNOWN remains blocked even
if no process is currently live. Recovery does not waive diagnosis or QA gates.

Missing/expired delegation, role/scope/model outside authority, wrong controller,
exhausted calls/packages or an input outside the allow-list returns `NEEDS_OWNER`.
This is a refusal to invent missing authority, not a request for model review.
New facts or broadened delegation never reset existing calls or packages.

The shared Owner write-ahead transaction writes intent, disables policy, writes
package/marker/generation through exact-before/exact-after `safe_put`, validates
the native descriptor and historical pins, completes the receipt, and restores
active policy. Interrupted operations resume only their exact snapshots under
the same lock. Changed policy or targets fail closed; no historical rollback is
performed. The marker retains the native 65536-byte limit. The personal Owner
comment enrollment/QA CLI, fields, two-call limit and authentication are preserved.

## Install and rollback (instructions only)

1. PMA publishes the exact candidate SHA and runs independent exact-candidate QA,
   mandatory CI and applicable controller review. Resolve the immutable comment
   publication prerequisite above. The canonical example and green author tests
   provide no installation authority.
2. Use the existing reviewed root OPS upgrade procedure against the actual
   installed baseline, with backup/readback, quiescent slots and receiver lock.
   The initial `installer.prepare` refuses an existing installation; do not use it
   as an upgrade shortcut. Install only the reviewed manifest payload and its
   approved controller pin through the existing upgrade process. No C5 marker,
   privilege, network, sandbox, secret or money change is part of this source task.
3. Keep policy disabled during replacement; retain exact before hashes, controller
   policy, code backup and historical ledger/receipt hashes. Verify full bundle
   hashes and accepted rules, then the existing required disabled shadow/CI gates
   and readback. Do not hot-swap while a model operation or unresolved intent runs.
4. After normal activation, validate the actual unedited personal Owner comment,
   exact canary source/input revisions and remaining lineage budget with dry-run.
   Apply the exact request once. Record the returned package/receipt ID. Let the
   existing Actions/receiver dispatch it; record real model/QA receipts separately.
   For QA, use the exact full QA fixture after confirmed native COMPLETE analysis.
5. Before any delegated enrollment/dispatch, rollback may restore the backed-up
   code and prior disabled policy through the same approved OPS process with exact
   readback. Preserve every receipt and ledger. After any delegated grant is
   published or consumed, older code does not understand its provenance: stop at
   the safe boundary and require a reviewed compatible rollback plan. Never delete
   a delegated ledger, undo generation/history, refund calls, or reactivate an old
   marker to replay work. A partial admission must be recovered or reviewed before
   changing code; an expired delegation does not authorize reactivation.

## Offline evidence

`test_admission_pm.py` creates local synthetic Git commits for the adapter-fix and
full-QA-input scenario; no production SHA is hard-coded into that scenario. It
executes real immutable input reads, ledger validation, transaction writes,
descriptor checks and root reservation logic, with host UID/quiescence metadata
replaced by synthetic fixtures. HTTP and provider launches are denied/mocked;
subprocesses during admission are restricted by the tests to Git reads. Failure
injection covers every durable write. These checks are AUTHOR self-verification,
not independent QA, CI, installation evidence, or DEV acceptance.

Author verification on this uncommitted candidate (all temporary fixtures under
`/home/agentagency-dev/author-evidence-apm2-20261025` via `TMPDIR`):

| Check | Exact outcome |
| --- | --- |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_admission_pm.py'` | 30 tests, PASS; includes both roles at all 7 durable crash points |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_owner_package.py'` | 9 tests, PASS; existing tests unchanged |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*recovery*.py'` | 76 tests, PASS |
| Direct `test_actions_train_antigravity*.py` discovery | 96 tests run, FAILED with 23 subtest errors; legacy entrypoint fixture crossed its synthetic boundary |
| Same Antigravity discovery, synthetic cursor-marker SHA fixture supplied in memory | 96 tests, PASS; existing assertions unchanged; no protected read |
| `python3 scripts/check_foundation.py` | PASS: 287 tracked Markdown files, 168 draft API operations |

The direct legacy run's first available refusal was:
`PermissionError: [Errno 13] Permission denied: '/etc/gobadminton-slots/cursor-author.json'`.
The call chain was legacy `execute_checked` → `preserved` → `installer.sha` →
`Path.exists/stat`. Its later missing synthetic `state/patch.json` errors followed
failure before the installation-intent write. This is a filesystem EACCES, not an
OpenAI safety refusal, GitHub denial, model refusal, or Admission PM test failure.
The protected read was not retried. The corrected test operation supplies a
synthetic SHA before filesystem access; it neither reads the marker nor changes
production verification. Reproduce that synthetic boundary with:

```sh
TMPDIR=/home/agentagency-dev/author-evidence-apm2-20261025 python3 - <<'PY'
import hashlib, sys, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path('scripts/chatops/tests').resolve()))
sys.path.insert(0, str(Path('scripts/chatops/actions_train').resolve()))
import test_actions_train_antigravity_entrypoint_patch as E
real_sha = E.U.i.sha
synthetic_pin = hashlib.sha256(b'synthetic immutable cursor marker, not installed data').hexdigest()
def synthetic_sha(path):
    if str(path) == '/etc/gobadminton-slots/cursor-author.json':
        return synthetic_pin
    return real_sha(path)
with patch.object(E.U.i, 'sha', side_effect=synthetic_sha):
    suite = unittest.defaultTestLoader.discover(
        'scripts/chatops/tests', pattern='test_actions_train_antigravity*.py')
    result = unittest.TextTestRunner().run(suite)
    sys.exit(not result.wasSuccessful())
PY
```

The test groups overlap; their counts are not a distinct-test total. New tests
also cover immutable Owner authentication, all closed fields and ceilings,
whole-lineage inheritance from a personal Owner package, missing/orphan model
reservation receipts, expiry, SHA/hash/QA-contract mismatch, both-role intent
recovery, runtime one-use reservation, predecessor tampering and repeat protection
across delegation IDs. A changed comment ID cannot reissue the same role/candidate
and byte-identical input; different path/revision aliases do not constitute new
facts. HTTP response metadata such as reactions/avatars is excluded from stored
authority so those changes cannot break idempotence.

Independent exact-candidate QA, hosted CI, installed-state readback, real #29
admission, provider calls and DEV verification: **NOT_TESTED**. Next permitted step
is PMA publication/review of this exact diff and its subsequent candidate SHA;
installation must use the existing authorized OPS process after those gates.
