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
