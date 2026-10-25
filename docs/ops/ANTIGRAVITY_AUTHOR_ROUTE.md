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
route. QA's existing critical fallback restriction is preserved. If the first
author route is AGY, every AGY QA entry is refused with “independent QA must be a
different provider”, including when author selection fell back. Codex QA remains
subject to its existing admission and isolation. V1 FORBIDDEN/ADAPTERS are intact.

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
