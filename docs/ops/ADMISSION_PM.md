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
`c985b8e4271d123e9e7d0f120d616f2db83597d5` (draft PR #306, round-2 revision).
Role: AUTHOR under the direct Owner assignment in this task; sole writer for the allowed-file revision, Grok retains runtime
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
  --delegation-comment 6390011223 \
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
`GRANTED` with the same ID and `replayed=true`; it never rewrites or recharges
the package. First enrollment has `replayed=false`. `--dry-run` returns `GRANTED`
with `dry_run=true`, without writing a receipt or exposing a grant. The status
field has only `GRANTED`, `BLOCKED`, `NEEDS_OWNER`. Every result, including a
refusal, has the deterministic admission ID, paths, a short reason, remaining
budget (null when verification stopped before accounting), and `model_calls=0`.
Replay reports the recorded enrollment budget snapshot. Nonstandard or refused
cases set `needs_review=true`; they do not invoke Technical PM or another model.

A new dry-run or apply performs exactly one public GET of
`https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/comments/<id>`
with timeout 10 seconds and response limit 32768 bytes. The HTTPS endpoint is
fixed; redirects (including same-host redirects), proxies, retries and pagination
are disabled. No other network access or model invocation is part of this helper.
No GitHub write or credential is needed. `--status` and a completed identical
replay consult local receipts first and work fully offline, without fetching or
renewing authority, even after delegation expiry. Exact intent recovery uses its
stored verified comment, requires unexpired authority and acquires no new grant.
All author tests stub only the last HTTPS transport, run the production fetcher,
and block/count socket connect, create_connection and getaddrinfo. No network,
provider CLI or installed protected state is accessed during source verification.

## Immutable Owner delegation comment

Owner numeric ID must be `318610566`, login `anpavel84-afk`, association
`OWNER`, `MEMBER`, or `COLLABORATOR`, and the response must identify Issue #29
in CLEAN. The response is limited to 32768 bytes. The comment must have valid UTC
`created_at == updated_at`; editing invalidates it. The prefix is exactly
`GOBADMINTON_ADMISSION_DELEGATION_V1` followed by one newline. The JSON body uses
Python `json.dumps(value,sort_keys=True,separators=(',',':'))`: no extra whitespace,
trailing newline, duplicate keys, extra fields or nonfinite numbers.

Concrete canonical example (one prefix line and one JSON line; no self-ID):

```text
GOBADMINTON_ADMISSION_DELEGATION_V1
{"allowed_input_paths":[{"path":"scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json","revision":"0ebd58e57d31e4f273708dc98aab59f1572eedcf","sha256":"40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55"}],"controller_sha":"INSTALLED_ACTIVE","expires_at":"2026-11-25T00:00:00Z","issue":29,"max_calls_per_package":5,"max_packages":3,"max_total_calls":5,"model":"claude-sonnet-5-5-medium","repo_id":1416250340,"roles":["technical_pm_product_analyst"],"rules_sha256":"8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5","schema":"GB_ADMISSION_DELEGATION_V1","scope":"DEV_OPS_ONLY"}
```

Publication and verification:

1. Owner posts the prefix and canonical JSON as a new Issue #29 comment. Set the
   exact reviewed input revisions/hashes, expiry and finite limits before posting.
   Do not include `delegation_comment` or any other self-ID field; it is rejected.
2. Read the GitHub-assigned comment ID from its URL, for example
   `https://github.com/anpavel84-afk/gobadminton-clean/issues/29#issuecomment-6390011223`.
3. Trusted OPS runs `--dry-run --delegation-comment 6390011223` with the exact
   request, then `--apply --delegation-comment 6390011223` with the same request.
   The CLI verifies that exact API response ID and binds it into the receipt and
   deterministic admission digest. The old `--delegation-comment-id` spelling
   remains an alias. A different posted ID produces a different digest, without
   bypassing unchanged-input duplicate protection across comments.
4. Never edit the comment: `created_at != updated_at` invalidates it. If authority
   must change, Owner posts a new canonical comment; historical charges remain.

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

The call lineage includes **historical qualification, one-shot, addressed and
supplemental charges, all dynamic personal Owner packages and all delegated
packages for #29**, regardless of delegation comment ID. Dynamic receipts must
be complete and match their original enrollment checksum. Usage is the union
of consumed operation IDs, including FAIL/UNKNOWN charges. The original fixed
reservation is already part of the qualification lineage and is counted once;
cumulative successor counters and supplemental `legacy_used_calls` are not
summed again. BUDGET is a pinned limits configuration, not another usage ledger.

A new package starts at that already-spent count. For example, safely released
UNKNOWN history at 2/2 plus a ceiling-5 delegation starts at `used_calls=2`, with
3 calls left. Histories of 1/1 and 3/3 leave 4 and 2 calls respectively. History
at or over the applicable ceiling refuses continuation. The package ceiling
is at most 5 under EOM §6.3, and the delegation's total-call limit also applies
across the entire call lineage. `max_packages` limits the number of dynamic
personal Owner and delegated package enrollments; historical ledgers retain
their existing identities and are not converted into dynamic packages.

The existing HIST/SUP/BUDGET pins, qualification-lineage pin, original reservation
and UNKNOWN pins remain verified and are never rewritten. Historical counters
must match their consumed rows and every charge must retain its journal entry.
Every dynamic predecessor is additionally referenced by filename and SHA-256;
runtime reservation uses the same historical accounting helper and validates
the inherited counter and predecessor analysis. No predecessor is modified by
admission. Old unused grants are not dispatched through the new marker.

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
   mandatory CI and applicable controller review. The canonical example and
   author tests provide no installation authority. Until reviewed installation,
   existing checks remain authoritative.
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

`test_actions_train_admission_pm.py` creates local synthetic Git commits for the adapter-fix and
full-QA-input scenario; no production SHA is hard-coded into that scenario. It
executes real immutable input reads, ledger validation, transaction writes,
descriptor checks and root reservation logic, with host UID/quiescence metadata
replaced by synthetic fixtures. HTTP and provider launches are denied/mocked;
subprocesses during admission are restricted by the tests to Git reads. Failure
injection covers every durable write. These checks are AUTHOR self-verification,
not independent QA, CI, installation evidence, or DEV acceptance.

Round-2 author verification uses the non-root process and default sandbox
temporary directory (`TMPDIR` unset); no installation or commit. The test groups
overlap and are not a distinct-test total. Round-1 evidence remains in the
[immutable PR #306 source record](https://github.com/anpavel84-afk/gobadminton-clean/blob/c985b8e4271d123e9e7d0f120d616f2db83597d5/docs/ops/ADMISSION_PM.md).

| Check | Exact round-2 outcome |
| --- | --- |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_admission_pm.py'` | 47 run, 47 PASS; both-role crash recovery and historical-spend recovery at all 7 durable writes |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_owner_package.py'` | 9 run, 9 PASS; existing tests and Owner-only helper unchanged in round 2 |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*recovery*.py'` | 76 run, 76 PASS |
| `python3 -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_addressed*.py'` | 51 run: 49 PASS, 1 FAIL, 1 skipped |
| `python3 scripts/check_foundation.py` | PASS: 289 Markdown files, 168 draft API operations |
| Five targeted in-memory regression mutations | All 5 detected by assertion failures; no mutated files written |

The addressed failure is
`test_actions_train_addressed_218.ActualTaskReviewWrapper.test_codex_only_wrapper_returns_review_contract_without_source_qa_parser`.
It expects the literal `Role: qa.` in the prompt, while the existing context
wrapper emits `ROLE qa; CONTEXT_PROFILE scoped_v1`. This failure also reproduces
on source HEAD `c985b8e4271d123e9e7d0f120d616f2db83597d5`: the three admission Python
modules were restored from `git show HEAD:<path>` into memory in an isolated
non-root process, then the exact original test was run (1 run, 1 failure,
0 errors, 0 skipped). No source checkout, assertions or context rules were
changed. Fixing that baseline regression requires files outside this assignment;
the mandatory addressed group is therefore **not PASS**. The existing skip is
`NOT_TESTED: requires protected root/UID978 fixture`; this verification is non-root.

The mutation probes separately removed historical accounting, fetched before
status receipt lookup, accepted a self-ID field, returned the old replay status,
and removed refusal IDs. Each corresponding new regression test failed on its
intended assertion. Production HTTPS fetching is exercised through a synthetic
`HTTPSHandler.https_open`; socket connect/create_connection/getaddrinfo and model
invocations remain blocked and their call counts are zero. Completed replay and
status have zero transport calls as well. Manifest pins match the on-disk bytes
of admission_pm.py, antigravity_qa_recovery.py and owner_package_admission.py.

Independent exact-candidate QA, hosted CI, installed-state readback, real #29
admission, provider calls and DEV verification: **NOT_TESTED**. Next permitted step
is PMA publication/review of this exact diff and its subsequent candidate SHA;
installation must use the existing authorized OPS process after those gates.
