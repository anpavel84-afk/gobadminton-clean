# Limited Antigravity AUTHOR route — t421u

Status: source implementation and offline AUTHOR self-checks only. NOT INSTALLED,
NOT ROLE_QUALIFIED, NOT RUNTIME_VERIFIED. This runbook is not machine admission.
The sole runtime PMA remains the one recorded in [CURRENT](../handoffs/CURRENT.md).

Preflight: repository `anpavel84-afk/gobadminton-clean`; base/source HEAD
`c9d0cb6b59c9099857810ef9a6e8d1eb9047e30b` (dev, merged PR #304). Candidate
is the uncommitted working-tree diff; no candidate commit/PR has been created.
Role AUTHOR, exact assignment P0 t421u supplied by Owner in this session; sole
writer for the assignment's listed adapter/core/stage/cost/manifest/OPS/tests/docs
paths. Effects: local source and synthetic fixture checks only. Requested route:
limited `agy:<exact model>` author on slot2; effective live route: NOT RUN.
No model CLI, network, credentials, protected runtime or deployment was accessed.

Accepted rules: EOM 1.4, commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`,
SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`;
SMART_ROUTING 1.0, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`,
SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`
(SR0 policy only). See [context index](../rules/CONTEXT_SOURCES.json) and
[full canon](../rules/ENGINEERING_OPERATING_MODEL.md). This source does not
change the installed FAIL → Astra diagnosis requirement.

## Accepted effects and limits

The new [author adapter](../../scripts/chatops/actions_train/native_antigravity_author.py)
requires a root-owned exact-fd trusted marker with schema
`GB_ANTIGRAVITY_AUTHOR_V1`. Absent marker, absent/UNKNOWN/exhausted author budget,
unsupported model/effort, wrong task or slot, module/executable drift or failed
executor preflight refuse the route before charge. Canary admits Medium only,
bound to the exact immutable task digest. READY requires a unique, explicit,
nonempty subset of the three existing native model IDs. No marker is created
by importing or invoking the adapter. No installed scheduler flags are changed.

Only explicit V2 author_routes can choose AGY. The cost-policy extension prefers
Medium for simple/standard, Sonnet High for complex, Opus High for critical; it
requires the existing minimum Codex route as a listed fallback, and never adds a
route. QA's existing critical fallback restriction is preserved. If any listed
author route is AGY, every AGY QA entry is refused with “independent QA must be a
different provider”, including QA fallback and cost-policy selection. AGY author
selection requires an executable independent non-AGY QA candidate after the
same cost-policy filtering and model/effort admission as the QA resolver.
Runtime QA availability and budget are checked separately at QA execution.
Codex QA remains subject to its existing admission and isolation. V1 FORBIDDEN/ADAPTERS are intact.

Trusted rules are injected in full for the author, through the ordinary stage
branch used by Cursor. No root-loaded native_auth token is passed to AGY. The
adapter reads the existing uid978 OAuth file and creates a 0600 private copy.
Tracked source exports omit instruction files, stay within Cursor's file/tree
bounds, and refuse links/nonregular files. Agent cwd is a private 0700
`/tmp/gb-agy-author-*` export, never the real checkout. The HOME and invocation
are removed in a finally block. Exact model catalog precharge performs no
inference, OAuth refresh is retained, then exactly one agy/author charge occurs.
No fallback or replay is attempted after a charged failure.

After reaping, checkout integrity, output stream, model/tool protocol, scope,
file types, credentials and file/tree limits must all validate before import.
The ORIGINAL checkout's ignore rules decide generated output; a candidate
.gitignore cannot hide off-scope edits. Additional conservative checks reject
links, instruction/secret paths and credential bytes even in ignored outputs.
Only the adapter's unchanged agent definition is removed before this check;
extra/changed .agents content fails. Allowed deletions use the same scope gate.
The guard is restored before the existing atomic temp/rename writer pattern.
No verdict text authorizes source import.

Receipts in outbox/agy-author-receipt.json use GB_AGY_AUTHOR_RECEIPT_V1 and phases
prepared → charged → running → validated → imported, or
failed_no_automatic_replay. They bind exact task/source/export/output/transcript,
requested/effective model, usage, exit/times, qualification and reaping evidence.
An opaque evidence ID addresses private bounded, credential-scanned streams.
Neither OAuth bytes nor provider exception text are persisted in public receipts.
Failures retain closed metadata, the original charge and no automatic replay.

## Honest executor boundary

filesystem_boundary = uid978_unix_permissions_nnp;
filesystem_roots_enforced = false; requested_native_sandbox = false.
Identity is uid978, gid968, supplementary registry group 65042, capabilities zero
and no_new_privs. RLIMIT_CORE is zero, output files and wall time are bounded.
Invocation cgroup membership/reaping is observed using the QA helpers; a missing
or unobserved cgroup is reported cgroup-absent, never cgroup-quiet.

This is the same Owner waiver class as AGY QA, requiring explicit admission for
this AUTHOR role before enabling it. The waiver records cross-project read
exposure; it is not proof of safety. There is no Landlock, AppArmor or bwrap for
this route. The real checkout belongs to uid978. chmod a-w plus before/after
_candidate_state detects accidental modification only; a malicious same-uid
writer can chmod back and change the checkout or writable Git metadata. This
is a guard, not a confinement boundary. Any detected change refuses import.
A cgroup absent run cannot prove cleanup of a daemon that escaped its session;
that residual risk is retained exactly as for QA.

Hardening option: a separately reviewed AppArmor/bwrap profile installed by an
exact root OPS script, with real tool/executor qualification. It is outside this
PR and must not be inferred from a private cwd or a successful fixture.

## AUTHOR_TOOLS and protocol qualification

One module constant advertises view_file, run_command, write_to_file,
replace_file_content and multi_replace_file_content. The edit names are present
in the pinned binary; their custom-agent CLI availability is UNVERIFIED until
the Medium canary actually uses them. The init must advertise a unique nonempty
subset of that definition, and every tool step must belong to that actual init
set and reach DONE. Unknown tools, denied/error evidence and identity drift
fail closed. There is no implicit finish tool in the tool allowlist.

The author parser is independent of the QA verdict/schema parser. It requires
one exact init, a DONE agent_response, completed tools and one terminal SUCCESS
with the same conversation. No finish tolerances are introduced: it currently
requires a DONE finish STEP as in the saved ordinary envelopes. Non-schema
finish semantics are not yet proven; if the real canary differs, preserve the
failure and obtain a reviewed parser change based on sanitized observed events.
Do not weaken parsing or mark READY based on these synthetic tests.

## Preconditions and root actions still required

The following are supplied task facts, not new live observations: AGY QA marker
is still canary; its native_antigravity.py hash became stale after PR #304;
budgets.json has agy.qa = 2 and no agy.author. Do not inspect or amend them from
this AUTHOR session. No installation or enabling action was performed here.

1. Owner admits the precise AUTHOR waiver/scope and reviewed source candidate;
   independent QA and required CI must review that exact candidate first.
2. Root OPS reconciles all operations/UNKNOWN outcomes, holds the existing
   controller.lock and disables new launches using the existing authorized
   mechanism. Preserve ledgers, grants, receipts and all old marker bytes.
3. Separately review/re-pin the stale QA marker against the installed
   native_antigravity.py/native_guard.py and its qualification evidence.
   This new upgrade refuses stale QA pins and never rewrites that marker.
4. Owner/PMA supplies one immutable docs/tests-only canary task with narrow
   allowed_paths, author `agy:claude-sonnet-5-5-medium`, a listed minimum Codex
   fallback, and independent `codex:gpt-6.1-sol:<admitted effort>` QA (Cursor
   only if independently READY/qualified for QA). QA must never be AGY.
   Bind the canonical task digest, not the file's pretty-printed JSON hash.
5. After exact source review, root uses the
   [upgrade subset](../../scripts/chatops/ops/antigravity_author_upgrade.py).
   Supply --bundle, --manifest-sha256, --base-controller and
   --canary-task-sha256; --author-budget defaults to 1. --action defaults to dry.
   Inspect the dry plan. Then --action apply backs up exact bytes before writes,
   installs only native_antigravity_author.py/core.py/stage.py/cost_policy.py,
   creates the canary marker and inserts host plus slot2 author budgets.
   Run --action verify under the same quiescent baseline. agy.qa remains 2;
   absent/UNKNOWN limits elsewhere remain UNKNOWN; old JSON bytes are retained.
6. A separate reviewed existing OPS integration must bind installed-controller
   metadata, perform disabled shadow verification and activate the reviewed
   controller. This subset never writes policy.json, backup.json, old markers,
   ledgers or PROD; it cannot perform that integration itself. No arbitrary
   script or manual marker edit is authorized by this runbook.
7. Run the single exact-task Medium canary, inspect real init/tool/finish events,
   import and one consumed charge. Independent QA, CI 7/7 and exact DEV ACCEPTED
   are mandatory. Capture source SHA, author/QA receipts, CI run/jobs and DEV
   acceptance. Failures/UNKNOWN require reconciliation and the existing repair
   process, never an automatic repeat or ledger reset.
8. READY promotion remains NOT_IMPLEMENTED in this safe subset. Before normal
   operation, deliver a separately reviewed extension of this upgrade script
   that verifies the exact canary lifecycle, module pins, actual tools, independent
   provider, CI 7/7 and DEV acceptance, then atomically promotes only the author
   marker with explicit admitted_models. Obtain the corresponding Owner/PMA
   admission. Never promote by hand. Higher models need explicit per-model
   admission; a Medium canary does not silently admit High or Opus.

The script deliberately delivers the largest tested install/verify/rollback
subset, as permitted by t421u design item 7. Full activation/READY would need
live lifecycle bindings and policy authority that are absent from this offline
assignment. This is the design deviation; normal READY service is not delivered.

## Rollback and evidence

Before activation and while the same baseline is disabled/quiescent, use
--action rollback with the same arguments. It checks authoritative-history and
target hashes, restores exact backed-up bytes/modes, removes only originally
absent targets, and retains its own journal/backups. It refuses foreign edits.
Once a model has run or history has changed, this generic rollback refuses:
reconcile and obtain an exact reviewed rollback that preserves new usage/history.
Do not restore an old ledger, old policy or old QA/Cursor marker to force it.

Offline checks use synthetic OAuth/catalog/process fixtures under a writable
TMPDIR. The source self-checks are not independent QA, hosted CI or DEV evidence.
The final AUTHOR handoff records exact before/after test counts, known sandbox
EACCES errors and the new tests' failures on a pristine base copy. No commit,
push, install, network access or protected-state read is part of this delivery.

Offline evidence (AUTHOR self-check, 25 October 2026): all 59 new tests pass.
Copied unchanged into a separate local clone of base c9d0cb6, the new test files
produce 15 discovered tests: 2 assertion failures (missing cost preference and
provider independence), 8 errors (missing author adapter/upgrade), with the
unchanged QA/Cursor/V1 regressions passing. This is the required non-vacuity
check; failed imports are not counted as execution of their contained tests.
Both base and candidate phase suites pass 51/51. Foundation passes on both
(291 tracked Markdown, 168 draft operations); the new untracked runbook was
also checked explicitly for Markdown/local-path correctness. The three pinned
adapters, receiver and legacy slots remain byte-identical to HEAD. The full
Actions suite ran 929 tests on the initial clean base and 988 on the candidate,
with the exact same 30 error names, no failures and one skip in each. The errors
are 23 existing OPS-fixture errors (including permission denials and downstream
missing journals), 5 Cursor fixtures using forbidden /tmp, 1 pre-existing missing
relative fixture and 1 denied local socket. They remain NOT_TESTED/error; no
assertion, fixture or runtime permission was weakened. The final 59-test run
covers the final author adapter, routing/stage and installer changes.
Raw logs and scratch clones are local artifacts under the authorized evidence
workspace author-evidence-agyroute-20261025, not published runtime evidence.

Pristine-clone confirmation: a separate local Git clone of exact c9d0cb6 also
ran 929 tests with the identical 30 errors, zero failures and one skip. The
candidate's full run added 59 tests without adding or removing any error name.
No root script, controller activation, real model invocation, independent QA,
hosted CI or DEV acceptance was performed. Next authorized action is review of
this uncommitted source candidate; enabling remains the separately admitted
root sequence above.


## PR #312 — independent-QA repair round 2 (25 October 2026)

AUTHOR/fix-author only, by the direct bounded assignment in this session; no
independent QA claim. Input/source/PR HEAD is
`395221d89e903956d6e099747adfa26c02c6da9a`. Assigned PR branch:
`agy-author-route-20261025`; the actual checkout is detached at that exact HEAD.
Original dev base is
`c9d0cb6b59c9099857810ef9a6e8d1eb9047e30b`. Candidate is the working-tree diff,
without a new commit. Accepted EOM/SMART_ROUTING commits and hashes above were
verified unchanged. This assignment owns only its listed local source, tests,
manifest and runbook paths. It does not create a second PMA/runtime, change
admission, or invoke a model route. Requested role: fix-author; effective live
provider route: NOT RUN. The supplied confirmed findings/reproductions are the
repair inputs; the installed FAIL/Astra policy is unchanged.

1. Credential leak: raw JSON bytes were checked, but decoded usage keys entered
   a shared mutable receipt before validation. Usage now has at most 32 keys
   matching `[a-z][a-z0-9_]{0,63}`, with nonnegative integer values only. Both
   streams receive raw, decoded-line, decoded-event and recursive string key/value
   checks against all original/refreshed token bytes. Parsing and proposed receipt
   fields stay local until verified; stage receives a detached validated receipt.
   Failure reconstructs a bounded whitelist of safe scalar metadata, drops
   provider structures/usage and reports a closed ReviewError. No raw exception
   text is persisted. Tests cover escaped usage keys, result values, nested keys
   and values, tool arguments/responses and response text, both via invoke and
   the actual stage.setup/model finalizer/export; all require one charge, a durable
   failed_no_automatic_replay phase, no credential in disk/choice/trace/result,
   unchanged source and removed private trees.
2. Independence: the old check looked only at author_routes[0]. Any listed AGY
   author now excludes AGY QA, including immutable and cost-policy paths and
   fallback after Codex exhaustion. AGY authors also require a supported listed
   non-AGY QA route (currently Codex; Cursor QA is not admitted by this path).
   Availability/budget gates for other providers and QA-only AGY remain intact.
3. Payload race: snapshot hashes did not bind the later file read. Each payload
   is now read once for SHA-256 comparison, credential scan and import. Changed
   deletions must remain absent. A second existing cgroup reaping-state check
   precedes payload reads; cgroup-absent retains its documented residual risk.
   output_manifest_sha256 binds the validated tree; imported_payload_sha256
   binds the canonical digest of the imported path-to-content-hash map.
4. Cleanup: one exception previously skipped remaining cleanup. Guard restore,
   OAuth unlink, private-tree removal, cgroup removal and evidence close are
   attempted independently, in that order. Private-tree removal repairs directory
   permissions and retries after partial failure. Any observed failure remains
   failed_no_automatic_replay with cleanup='failed' and fixed per-step flags
   (cleanup_restore_guard, cleanup_oauth_copy, cleanup_private_tree,
   cleanup_cgroup, cleanup_evidence); exceptions remain closed ReviewError.

Additional defects of the same class: encoded JSON/string/plain-text stderr
could otherwise enter evidence; the cgroup helper can return without removing
its directory; a reaping exception during failure handling could skip the safe
failure receipt. These paths are now checked/contained. Unicode surrogate pairs
in valid provider JSON remain supported. The existing stage finalizer was read
in full: its AGY author receipt/usage projection is now fed only verified data,
so no stage.py change is required. The upgrade script derives module pins from
the reviewed manifest/bundle and needs no change. Only changed runtime file hash
entries are recomputed; protected adapters, receiver, slots and cost policy are
unchanged.

Regression method names are in the two changed test files. Credential cases:
test_escaped_usage_key, test_escaped_result_value,
test_escaped_nested_keys_and_values, test_escaped_tool_arguments,
test_escaped_tool_response, test_escaped_response_text,
test_decoded_stderr_json_is_checked_before_evidence,
test_decoded_string_stderr_is_checked_before_evidence,
test_escaped_plain_stderr_is_checked_before_evidence,
test_real_stage_finalizer_never_exports_decoded_credentials and the five
test_real_stage_escaped_* methods,
test_failure_receipt_rebuild_discards_untrusted_fields,
test_usage_keys_are_closed_and_bounded. Routing:
test_any_agy_author_entry_blocks_qa_with_or_without_cost_policy,
test_agy_qa_fallback_refused_after_codex_exhaustion,
test_agy_author_requires_listed_non_agy_admitted_qa. Payload:
test_payload_snapshot_race_refuses_import,
test_payload_deleted_after_snapshot_refuses_import,
test_deletion_replaced_with_write_refuses_import,
test_imported_payload_digest_binds_actual_bytes,
test_cgroup_rechecked_before_payload_read. Cleanup:
test_cgroup_cleanup_exception_still_removes_private_tree,
test_real_cgroup_helper_eacces_still_removes_private_tree,
test_guard_restore_failure_does_not_skip_tree_or_cgroup,
test_partial_rmtree_retries_and_removes_oauth_first,
test_cgroup_helper_silent_failure_is_not_success,
test_real_rmtree_permission_repair_is_failed_closed.

Final AUTHOR self-check results (synthetic data only):

- All 31 new test methods execute and fail on exact original HEAD 395221d8 in
  a separate archive under writable TMPDIR, with only the new tests copied in.
  There are 31 failing assertions/subtest events and 8 errors (unexpected old
  exception types/missing receipt fields), covering all 31 distinct methods;
  there are no test-module import errors or unexpectedly passing new methods.
- The three AGY author modules pass 90/90 tests after the fix, including all
  31 regressions. The existing qualification fixture now explicitly lists the
  required independent Codex QA route; its original admission assertions remain.
- Full Actions discovery from scripts/chatops/tests: original HEAD 988 tests;
  final candidate 1019 tests. Both have zero failures, the exact same 30 error
  labels including subtest parameters, and one skip. These are 23 existing OPS
  fixture errors (EACCES/downstream journals), five Cursor /tmp fixture errors,
  the addressed_grants missing relative fixture, and a denied local socket.
  They remain errors/NOT_TESTED, not PASS. No environment permission was changed.
- Both phase discovery runs pass 51/51. Both foundation checks pass (292 Markdown
  files, 168 draft API operations). git diff --check passes. All manifest entries
  match their file bytes; only core.py and native_antigravity_author.py hash
  entries changed. The forbidden adapters/receiver/slots remain byte-identical.

An intermediate full run is retained in after-actions.log: 1019 tests, the same
30 errors/one skip, plus one new fixture failure. That fixture incorrectly
triggered its permission fault at refresh call 3, while the exit-path has two
calls. Correcting the trigger to call 2 exercises the real permission failure;
its assertions pass in both the final 90-test and complete 1019-test runs.
The intermediate result is not the final candidate verification.

Raw local logs, full-comparison.json (exact error labels), new-tests.json,
new-tests-old.json, candidate.patch and verification.json are retained under
`/home/agentagency-dev/author-evidence-agyfix2-20261025`. The exact baseline is
pristine/; the isolated added-test check is tmp/pristine-new-tests/ (both use
local copied Git metadata for immutable offline rules reads). No network,
model CLI, real credentials, successful protected-state read, root operation,
commit, push, installation, hosted CI or DEV deployment is part of this repair.
Next authorized step is fresh independent QA of this uncommitted candidate,
followed by the existing required CI/installation/DEV gates under their separate
authority. AUTHOR self-checks are not independent QA or runtime qualification.


## PR #312 — independent-QA repair round 3 (26 October 2026)

AUTHOR/fix-author self-check only, under the direct final-round bounded assignment.
Exact input/source/PR HEAD: `7c48c44e948b8f2281d5f12dee63081b4c22b62a`;
round-2 fixes remain present. Candidate is the uncommitted working-tree diff.
Repository, accepted EOM 1.4 / SMART_ROUTING 1.0 commits and SHA-256 above are
unchanged and verified. This session is the sole local writer for the assigned
adapter/core/cost/manifest, AGY author tests and runbook paths. Effects are local
source edits and synthetic checks; effective live provider route is NOT RUN.
Grok remains runtime PMA. The supplied findings and exact reproductions are the
repair inputs; this assignment does not change the installed FAIL/Astra policy.

A. The raw QA route list could contain a valid Codex route excluded by critical
cost policy. Policy admission now shares the QA candidate selection logic and
closed Codex model/effort gate with the actual resolver. An AGY author entry
requires at least one executable independent non-AGY QA candidate after policy
filtering. The immutable author path additionally checks the installed model
map before qualification. Missing candidates reject validate_policy,
validate_issue and author selection with a specific reason. This preserves the
critical QA fallback restriction, policy-free tasks, non-AGY tasks, QA-only AGY,
and the existing rule excluding AGY QA for any listed AGY author. Availability
and budget are ignored only for this static existence check.

B. Failure finalisation previously wrote the receipt before publishing terminal
state, allowing receipt I/O to replace the closed error. It now reconstructs a
sanitised terminal receipt and deep-copies it into choice before evidence or
receipt I/O. Disk writes have three bounded attempts; exhaustion records the
fixed receipt_persist='failed' flag in memory. Finally independently retries
an unpersisted terminal receipt, and evidence recording/close failures remain
closed ReviewError paths. A permanently unwritable receipt can remain running
on disk; the stage finalizer still receives the in-memory terminal phase and
persistence flag. The charged launch is never replayed.

C. The pinned shared restoration helper swallows per-file chmod errors. The
author boundary now verifies every recorded mode, retries mismatches once using
its own chmod and verifies again before import. Guard records remain available
until verified, including in finally. Persistent restoration failure prevents
import and records cleanup_restore_guard='failed'. New verification/repair opens
parent components using O_NOFOLLOW and anchored directory descriptors; chmod
uses follow_symlinks=False and touches only recorded paths. The shared helper
is unchanged; the documented same-UID residual risk is unchanged.

Additional checks cover simultaneous evidence-close/receipt-I/O failure and a
symlink ancestor substituted before the adapter's guard verification. The
upgrade script derives its module hashes from the reviewed manifest and needs
no edit. Only the three changed runtime file entries are recomputed in manifest.
No pinned adapter, receiver, stage, slots, authority or protected-state file is
changed. No commit, push, model CLI, network, real credentials, root operation,
installation, hosted CI or DEV run is performed. Next step is fresh independent
QA of this candidate, followed by the existing separately authorised gates.

Regression names, pristine non-vacuity results, complete baseline/candidate logs
and exact error-label comparison are retained under
`/home/agentagency-dev/author-evidence-agyfix3-20261025`.

Round-3 regression method names (all 13 execute and fail on pristine 7c48c44e,
then pass after the fix):

- `test_terminal_receipt_transient_io_is_retried`
- `test_terminal_receipt_persistent_io_stays_closed_in_memory`
- `test_terminal_receipt_finally_retry_fault_is_contained`
- `test_terminal_choice_precedes_every_failed_disk_write`
- `test_terminal_evidence_record_exception_stays_closed`
- `test_real_guard_silent_transient_chmod_failure_verified_before_import`
- `test_real_guard_persistent_chmod_failure_never_imports`
- `test_silent_guard_noop_repairs_all_recorded_modes`
- `test_evidence_close_and_receipt_io_faults_stay_closed`
- `test_guard_retry_refuses_symlink_ancestor_before_import`
- `test_policy_excluded_independent_qa_rejected_at_issue_admission`
- `test_policy_excluded_critical_qa_variants_rejected`
- `test_author_selection_rejects_unreachable_qa_before_qualification`

The pristine run reports 13 assertion/subtest failures and 7 errors across all
13 distinct new methods; none pass unexpectedly and no module imports fail.
Errors are the old implementation's unclosed exception types or refusal after
the import-time mode assertion. These are AUTHOR regressions, not independent QA.

Final round-3 AUTHOR self-check totals, using synthetic fixtures under writable
TMPDIR and the mandated discovery commands from scripts/chatops/tests:

- Full Actions: pristine HEAD 1,019 tests; candidate 1,032 tests. Both have zero
  assertion failures, 30 errors with byte-identical ordered error labels
  (including subtest parameters), and one skip. The unchanged labels include
  addressed_grants immutable_input_hash, 23 OPS-fixture errors, five Cursor
  forbidden-/tmp fixture errors and one denied local socket. They remain
  errors/NOT_TESTED; no fixture, assertion or environment permission was weakened.
- Three AGY author modules alone: baseline 90/90; candidate 103/103, all passing.
- Phase discovery: baseline and candidate both pass 51/51.
- Foundation: both pass (292 tracked Markdown files, 168 draft API operations).
  git diff --check passes. All manifest entries match file bytes; only core.py,
  cost_policy.py and native_antigravity_author.py hash entries changed.
- The complete diff was reviewed for admission compatibility, credential-safe
  terminal receipts, finite retry counts, no replay, mode verification before
  import, recorded-path-only/no-follow guard repairs, cleanup and unchanged pins.

Local evidence: preflight.json, new-tests.json, new-tests-old.log,
new-tests-after.log, before/after-actions.log, before/after-phase.log,
before/after-foundation.log, before/after-agy.log, full-comparison.json,
verification.json and candidate.patch in the evidence directory above. The
pristine source and isolated added-test copy are tmp/pristine and
tmp/pristine-new-tests. Two incorrectly addressed module commands are retained
as invalid-cwd-agy.log / invalid-module-before-agy.log and excluded from totals;
the correctly addressed runs above are complete. An intermediate successful
101-test focused run preceded the final 103-test run. No independent QA, hosted
CI, installation, canary or DEV acceptance was performed.
