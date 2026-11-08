# Smart Model Routing V3 — B1 SOURCE_ONLY

Issue #527; immutable original base `fec196e48effb4d3e7b97c5ea820663202692648`.
Policy version: `GB_AUTHOR_ROUTING_V3_B1`. This delivery is a pure stdlib helper
and synthetic tests. It does not install or activate routing, authenticate error
records, qualify an author, clear a HOLD, or establish independent QA/CI/DEV
acceptance. Existing Cursor product author and runtime remain untouched.

## Assignment contract

`tools/train/author_routing.py` has no IO, model, process, ledger or runtime calls.
`select_author` consumes caller-supplied `Route` records and the task's existing
`complexity` and `work_kind`; it does not introduce a classification system.
Only explicitly admitted, qualified, ready routes with an executor/model record
are eligible for a new assignment. AGY means the existing Sonnet model
`claude-sonnet-5-5-medium`; Codex means `gpt-6.1-sol:medium`. Readiness is supplied
from existing accepted proofs; a Python record does not establish readiness.

For each exact `(complexity, work_kind)` bucket, `history_counts` is either
`{cursor_auto: nonnegative_integer, antigravity_sonnet: nonnegative_integer}` or
`None`. Counts represent **new task assignments**, once per frozen admission;
repairs, fallback attempts and internal model calls do not increment them.
The smaller eligible count wins, with Cursor as deterministic tie breaker.
This approximates 50/50 when both primary routes remain eligible. Mobile #522
prefers eligible AGY. Codex is only a capacity backup, not a balancing target.
There are no percentages, forecasts, reset tracking, token, money or quota
estimates. Missing historical measurement stays `None`; deterministic Cursor
preference (or the sole eligible primary) does not invent historical counts or
rebalance old tasks. The caller can accumulate future assignments from that point.

The caller freezes the decision **once per admission**, with task revision,
route proof identities and the pipeline revision, before attempting execution.
It supplies `frozen_decision` on retries; the same record is returned without
ranking again. That argument must be the trusted stored decision, not task input.
Unknown actual operation effects take precedence and yield HOLD even on retry.
With the policy absent/disabled, an existing author, or an ordinary fix,
`KEEP` preserves the old path. KEEP conveys no new author authorization. The
legacy caller continues its existing admission and readiness checks.

Assignment metadata records reason, policy version, initial provider, exact
bucket and the measured counts (or honest `None`). No retrospective reassignment
or history mutation occurs in this module.

## Typed provider-control boundary

`CapacityFailure` is the exact normalized failure schema:

| Field | Contract |
| --- | --- |
| `schema` | `GB_PROVIDER_CONTROL_FAILURE_V1` |
| `domain` | `PROVIDER_CONTROL` |
| `binding` | `Operation(task, operation, provider, source_sha, scope_id, original_base)` |
| `fingerprint` | Nonempty caller-preserved identity of the supported error envelope/preflight result |
| `code` | Exactly `QUOTA_EXHAUSTED`, `RATE_LIMIT`, or `CAPACITY_EXHAUSTED` |
| `origin` | Exactly `native_top_level_error` or `trusted_preflight_budget_check` |

These normalized fields are **not external authentication**. B2 must derive them
only from a supported top-level native provider-control error envelope or a
trusted preflight budget check. It must retain the raw evidence reference and
fingerprint in protected operation receipts. Native vendor codes may map to the
three codes only through an explicitly supported trusted adapter. Never derive
them from task/user/source/tool/test output, substring searches, exit code alone,
program FAIL, QA FAIL or security refusal. B1 does not parse raw vendor failures
and does not install actual failure detection. A copied dataclass, or JSON that
looks like it, is not evidence of provenance.

Missing subscription measurement alone is not an operation UNKNOWN and is not
capacity exhaustion. Actual unresolved effects of any old operation require
HOLD and reconciliation; absence of a measurement must never conceal UNKNOWN.

## Capacity handoff contract

`capacity_handoff` proposes only this bounded order:

- Cursor → admitted, qualified, ready AGY Sonnet → qualified Codex author.
- AGY → admitted, qualified, ready Cursor → qualified Codex author.
- An unavailable immediate backup, exhausted Codex, or invalid evidence → HOLD.

Codex requires both primaries to have confirmed capacity stops in the preserved
chain. No skipping an unavailable primary to reach Codex. Each provider and
operation occurs at most once; no cycles or automatic retry loops.

Every accepted stop pairs `CapacityFailure` with `StopProof`. Their full
`Operation` bindings and failure fingerprints must match. The binding includes
current task and operation IDs, provider, exact 40-character source SHA, scope
identity and immutable 40-character original base. The caller must compare these
identities to its authoritative admission, process and source state; equality
between two caller-created records is not that external verification.

The proof must explicitly confirm stopped process, reconciled source, source
within scope, and no pending UNKNOWN, and carry a checkpoint reference and
nonempty receipt references. Partial state must be `preserved_diff`, or
`confirmed_empty_diff` after explicit verification; even empty diffs need a
checkpoint. Missing partial state never silently discards edits. Source SHA may
advance through successive reconciled checkpoints; task, scope and original base
must remain identical across the chain. A new operation must start from the
preserved handoff source, not reset to the original base.

The caller passes the complete prior `CapacityStop` tuple, the immutable initial
provider, cumulative attempts and preserved history references. It must retrieve
them from its protected history, not reconstruct/truncate them from provider or
task output. The result retains the chain, attempts, history, current checkpoint,
receipts, scope, source SHA and original base. No attempt counter is reset.

For Cursor/AGY authors the reviewer record must represent the existing qualified,
admitted, ready Codex Sol Medium QA executor. A Codex author requires an explicit
qualified, admitted, ready separate reviewer executor **and different model**.
The helper never emits QA PASS; author self-checks cannot satisfy this requirement.

`REQUIRE_NEW_ADMISSION` means the caller must preserve all evidence before
switching, obtain a new immutable admission and unique operation identity, and
hand off the checkpoint. It is not permission to launch immediately. HOLD is a
declarative result; B1 never clears runtime holds or reconciles UNKNOWN itself.

## B2 boundary and bounded verification

B2 must wire the helper into existing Lean admission and protected history,
resolve authoritative readiness/authorization and reviewer proofs, normalize
supported native errors, verify process stop and source reconciliation, freeze
selection/counting once, and implement the new-admission handoff. That work
requires independent QA and existing gates. B1 changes no providers/run/live/
native/install modules, config, leases, markers, workflows, application or PROD.
No new service, scheduler, monitoring system or quota pipeline is introduced.

Run only the focused synthetic checks for B1:

```sh
python3 -B scripts/chatops/tests/test_actions_train_author_routing_v3.py
python3 -B - <<'PY'
import ast
from pathlib import Path
for name in ('tools/train/author_routing.py',
             'scripts/chatops/tests/test_actions_train_author_routing_v3.py'):
    ast.parse(Path(name).read_text(), filename=name)
print('AST syntax: OK (2 files)')
PY
```

The 22 tests use controlled records: comparable assignments, legacy/fix retention,
Mobile preference and qualification, frozen retries, both capacity directions,
Codex after both stops, unavailable backups, chain/history retention, identity
mismatch, stop/source/UNKNOWN holds, explicit empty checkpoints, missing
measurement, rejected quota-like literals/program/QA/security failures, and
independent reviewer requirements. They consume no real provider capacity and
make no qualification/model/native calls. These are author checks, not independent
QA, Product CI, install, shadow execution, runtime activation or DEV acceptance.

## B2 source candidate — no runtime activation

The B2 source adds `author_handoff.py` and binds the existing controller, provider
wrapper and live dispatch. B1 policy and protected native modules/guard hashes
are unchanged. No install, config write, model call, qualification, lease reset,
CI, independent QA, DEV release or Owner UAT has been performed by this source
pass. This is **SOURCE_ONLY**, not DONE, READY or ACTIVE.

The existing protected config may prospectively select `author_routing.mode`:
absent/`off` preserves legacy behavior; `shadow` stores a proposed decision but
executes the legacy route; `on` consumes the frozen decision. The host entry
binds the actual installed release SHA, rather than a task-provided pipeline ID.
PMA controls installation/configuration separately. The code-only installer now
packages both routing source modules; this pass does not invoke it.

Only new claims get a binding. Classification uses the admitted task's existing
`complexity`/`work_kind`; missing classification holds an enabled decision.
Counts are prospective new comparable claims, not measured subscription usage
or a reconstruction of older unknown assignments. Repairs, continuations and
capacity successor admissions do not count. A later revision of the same Issue
keeps its latest recorded author. Both `invoke_cursor_author` and live dispatch
read the same claim/intent binding; neither reranks it. Disabling routing affects
future claims; existing bindings and all attempt/history records remain.

Policy `antigravity_sonnet` maps explicitly to native `agy_author`.
Policy `codex_sol_medium` maps to **author** `codex_author`, never the QA alias.
Codex author requires pinned `core.live()` registry/role qualification and uses
its secure `autonomous_issues.model_command`, exact `gpt-6.1-sol`, medium effort,
UID1002, private exported source and the existing owner-safe importer. Routing QA
requires separately qualified `gpt-6-sol:medium` and a separate QA invocation.
The current exported legacy registry does not contain that exact QA model;
B2 therefore holds until an authoritative existing qualification admits it.
No marker, registry entry, native module or qualification hash is rewritten.
Native Cursor `qualification(...).phase=ready` suffices without a Lean cosmetic
marker. Bound AGY unavailability or local governance cannot silently select Cursor.

### Capacity evidence and successor admission

The current native Cursor/AGY streams have **no supported authoritative capacity
control schema**. Production adapters therefore install no capacity decoder and
HOLD on failures; a raw quota-looking string cannot switch providers. The existing
Adapters seam accepts a trusted installed `author_capacity` decoder only for a
supported control contract. Task JSON cannot supply this callback. Controlled
tests use typed provider-control fixtures; they do not establish a vendor schema.
A decoder must authenticate/prove the schema, bind the exact operation/provider/
task/base/source/scope/evidence fingerprint, and reconcile the final native
receipt and retained bytes before supplying a CapacityStop. `reconciled_stop`
provides the fixed binding/closure predicate; a dataclass alone is not proof.
Local per-Issue/shared budget, charge UNKNOWN, spend, auth, security, program,
QA FAIL and missing schema are HOLD, never subscription/model capacity.

A valid stop produces a persisted `REQUIRE_NEW_ADMISSION` proposal, never another
paid invocation within the same operation. The finite B1 chain and cumulative
attempts/history survive in the old claim. An unavailable immediate backup holds;
Codex requires both primary stops and separate exact-model QA qualification.
The trusted integrator must prepare the retained checkpoint through the normal
source process, then obtain a new canonical immutable admission with
`handoff_from_revision`, `checkpoint_fingerprint`, `checkpoint_sha` and `base`
(equal to that prepared checkpoint SHA). Successor binding reads the old protected
proposal, checks the exact scope/base/operation binding, full Git diff, imported
bytes and actual retained payload hashes, and reuses the original review base.
It refuses reused admissions. It neither resets the source nor imports it itself.
No new service, scheduler, polling loop or global lock is added.

### Retention boundary

AGY uses only the existing native `invoke(popen=...)` seam. The wrapper delegates
the original command, environment, preexec, stdin/communicate and process attributes;
it invokes the ORIGINAL native owned reap on the original process before taking
a bounded source snapshot. Native parsing, charge/raw/error receipts, guard
restoration and cgroup cleanup still run unchanged. The snapshot survives native
private-tree deletion and parser/exit failures, but is explicitly UNVALIDATED.
The caller must reconcile the FINAL native receipt after invoke/finalizers;
AGY needs `cgroup-quiet` and no cleanup/guard/refresh/persist failure. Failed
observation never replaces a native success or exception; no checkpoint means
no fallback. Cursor likewise reaps the owned group on success and failure and
retains partial source before parsing and cleanup.

Snapshots traverse only the private source directory, use original checkout
ignore decisions, scan even ignored output for old/current/refreshed credentials
in memory, and compare two complete bounded scans for races. Links, nonregular
files, excessive counts/bytes, chmods unsupported by the byte-only native import,
OOS changes and secrets refuse retention. AGY control exclusion requires the
exact native `.agents/agents/<AGENT>.md` path, definition and unchanged tree.
Payload files are ordinal names with hashes calculated from the actual retained
bytes. Private auth/home/cache is never exported into the checkpoint. Raw/native
receipts remain separate; unknown provider usage is never rewritten as zero,
and unknown actual effects always prevent handoff.

Focused source checks: the B1 22-test suite, B2 runtime fixture suite and relevant
`test_train` classes. These are author checks. Full Product CI/security gates,
independent QA, actual installed exact-model qualification, supported vendor
capacity schema, runtime shadow/activation, native live cleanup/guard readback,
DEV acceptance and Owner UAT remain **NOT_TESTED**. Mobile #522 was not executed.

### B3 Root reviewer authority delivery (source candidate; NOT runtime accepted)

Normal `run_once → default_live_adapters → build_live_adapters` constructs a
reviewer-authority callback. Selectors, invocation wrappers, Codex backup,
claim metadata and capacity proposals receive it outside task/event JSON.
Frozen metadata is provenance, never a grant; live invocation rechecks authority.
Actual author remains `gpt-6.1-sol:medium`; independent QA is `gpt-6-sol:medium`,
or High only with acceptance of that exact effort. Handoff preserves actual tags.

The existing `/etc/gobadminton-lean/config.json` may reference
`codex_qa_authority.<medium|high> = {path, sha256}` pointing strictly beneath
`/var/lib/gobadminton-lean/results` to an existing
`qa-intent-codex_sol_medium.json`. Root acceptance is recorded in that intent;
no registry, READY marker or separate grant store is introduced. All ancestors
and receipt/config files must be Root owned, nonlink, non-group/world-writable;
reads are bounded, stable and reject duplicate JSON keys. Missing, stale,
revoked, mismatched model/role/effort/UID/CLI/security closure holds routing.
The historical sample SHA/operation remain evidence, not restrictions on future
product candidates. Recipe closure hashes code and CLI/rules bytes independently
of product SHA; each operation also records actual argv and permissions hashes.

Bootstrap is the separate Root-only `codex_qa_probe_live()` entry. A protected
`codex_qa_probe` pointer references a `GB_LEAN_QA_PROBE_ADMISSION_V1` receipt in the
same qa-intent family, binding one operation, revision, candidate, scope hash,
author executor, exact recipe and task. Its evidence directory is a separate
`qa-*` child of the admission directory. It uses the same operator and command
factory as normal Lean QA. Exclusive intent creation consumes the operation;
failed/UNKNOWN operations cannot replay. It does not grant normal routing or
accept itself. After a future real operation, trusted Root may explicitly call
`accept_codex_qa_intent` on the exact intent path/hash after examining the real
raw/completion/final, readonly byte hashes and owned process-stop evidence.
PMA alone later updates the existing config pointer with guarded CAS/backup.
Neither acceptance nor probe nor config change was performed in this source task.

Historical Mode A completions lack historical CLI/argv proof and cannot satisfy
this contract retroactively. Independent QA, CI7 and a scheduled actual Lean
review remain pending. Actual vendor capacity export remains separately BLOCKED;
default OFF/SHADOW, C5 OFF, no installation, activation or PROD change.

B3 repair1 source candidate: QA now resolves the pinned scoped native Codex
binary directly; normal QA and the one-shot Root probe share command and
permission construction. Qualification binds complete Lean/native OPS Python
bytes, effective UID/GID/paths, timeout/native/Node bytes and short rules, while
its product SHA remains a historical sample. Acceptance requires protected
probe admission, exact author claim provenance and operation, reconstructed
command/permissions/output paths, raw completion, and a Root-captured Linux
PID/start-time/group/UID/command record with matching reap/stop completion.
Legacy Mode A raw output and boolean stop assertions cannot qualify a role.
The trusted authority selects Medium first, or accepted High when Medium is
unavailable; selectors and the actual QA operator recheck that authority.
Successor claims retain and recheck the protected proposal's reviewer contract.
No runtime acceptance, automatic READY, provider invocation or vendor capacity
transport is implied. OFF/SHADOW defaults and vendor capacity BLOCKED remain.

B3 repair2 initial origin is a discriminated `GB_LEAN_INITIAL_MODE_A_AUTHOR_V1`
receipt in the **existing RESULTS family**, selected by the protected probe
admission's `author_receipt` path/hash. It supplies author provenance only for
that one Root-admitted probe. Normal V3 still requires accepted independent QA;
this receipt is neither READY nor an author registry grant. No receipt, config,
probe, install or acceptance is created by this source change.

Before a separately scheduled Root operation, the operator must independently
verify the genuine completed `b3-completion-author/receipt.json` operation:
Mode A, author, native UID1002, gpt-6.1-sol Medium, one completed turn,
candidate 13e45a0a8814e4e9b80a3135dbf555d3e580ac0c and exact allowed source
scope. Its UID1002/0644 raw receipt is input, never authority. Root must retain
that original receipt and hash-bound copies of the original frozen task,
source/scope snapshot, raw events, final output, completion, owned stop and
operator launch provenance under RESULTS, with protected ancestors and files.
No UNKNOWN/partial attempt may be relabelled completed. If original launch,
source import/candidate, raw/final or owned-stop facts cannot be reconciled,
HOLD at that missing factual boundary; a new JSON assertion is insufficient.

The sealed receipt has `revoked:false`, `root_verified:true`, computed probe
`revision`, original `task`, `scope_sha256`, and `author_provenance` containing
`source_bytes` and `candidate_sha`. All of receipt/completion/operator/stop/source
bind `operation_id`, `candidate_sha`, `role:author`, `executor:native:codex:1002:author`,
`executor_uid:1002`, `model:gpt-6.1-sol`, `effort:medium`, `mode:A`.
Hash pointers are `source_receipt`, `task_proof`, `source_proof`,
`completion_proof`, `operator_proof`, `stop_proof`, `raw_proof`, `final_proof`.
The source proof binds `task_sha256`, `scope_sha256`, `source_bytes`.
Completion binds `exit:0`, `turn_completed:true`, `pending_unknown:false`,
`raw_sha256`, `final_sha256`, exact `operator` and `stop_record` copies.
Operator binds actual argv/permissions and their fingerprints, CLI/prompt hashes,
PID/PGID/start ticks; original receipt launch hashes must match. Stop additionally
binds `reaped:true`, `group_gone:true`, `exit:0`. These inputs require independent
Root verification against actual operation evidence; this validator does not
manufacture missing historical facts. Current task/probe fields cannot grant them.

Normal probe revision is checked against outer frozen claim revision separately
from original task comparison; only known computed runtime additions are
normalized. Unknown underscore Owner requirements remain binding. Production
capacity handling derives trusted accepted QA effort and carries it into the
proposal; successor/QA continue rechecking that exact authority. Failure cleanup
uses the unchanged SHA-pinned native owned reap primitive even after leader exit,
checks group absence and retains failure stop proof without changing UNKNOWN
to PASS. The stable recipe binds effective Git and Python executable bytes,
resolved paths and owner IDs, alongside existing native/timeout/Node/OPS closure
and effective process IDs. On the observed host Git is `/usr/bin/git`
(SHA256 eb54b535467e0975c1284d4c4d08eea779aeb248a5d34b02e2ee171382e22201),
Python `/usr/bin/python3` resolves to `/usr/bin/python3.12`
(SHA256 e50d468e8b0adfb05733f5b87b3cff34829c4a8c1aea50c865aa8bdfe4bb150f).
Runtime hashes current effective bytes; historical sample hashes and future
product candidate identity remain separate. Actual vendor capacity stays
BLOCKED; default OFF/SHADOW, CI7, independent cumulative High QA and separate
Root runtime acceptance remain required.
