# Actions-owned train · OPS #158

Implementation for Owner Direct Pavel, 2026-10-21. **Prepared, not installed or accepted.**
Scope authority: [Issue #158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158).
Author changes no Git metadata, services, credentials, environment settings or deployment.
PMA reviews changed risks, publishes the branch/PR and installs separately. Product PROD is outside this migration.

## Execution contract

GitHub-hosted `train-dispatch.yml` performs one reconciliation pass; `train-stage.yml` performs
one stage per dispatch. Both need installation on default `main` before event/dispatch operation.
The commissioning branch push only runs local tests and an inline installed-receiver status probe.
It never checks candidate code out in the probe job with SSH secrets. Normal privileged jobs
check out the exact default-branch event SHA, with persisted credentials disabled.

Events: numeric Owner Issue opened/comment created, authenticated same-repository push workflow
completion for Product CI, Autonomy PR or DEV deploy, explicit dispatch, and 15-minute rescue.
No labels, prose, fork completion, or bot approval authorizes a task. Admission reuses the exact
LIVE body XOR one Owner comment schema, including immutability, enrollment, age, scope and limits.
Existing claims retain their immutable fingerprints across age/restart. There is no new task schema.

Both queues use `cancel-in-progress: false`, `queue: max` (100 pending). Queues are delivery hints:
Issues preserve approved intent, existing slot checkpoints preserve work, root journals preserve
pending operations and results. A dropped/cancelled/overflowed event is rediscovered by rescue.
A stage completion requests explicit `workflow_dispatch` only when its own factual checkpoint
changed. Own workflow completion is not a dispatcher trigger. GITHUB_TOKEN suppression is not
worked around with hidden approvals. SSH source pushes retain the existing identity and trigger
Product CI/Autonomy PR and DEV deploy normally.

The execution job has only `contents: read`, `issues: read`, `pull-requests: read`, `actions: read`.
Only that short-lived read token travels through private SSH stdin. A separate hosted continuation
job has `actions: write`, no SSH secrets and no checkout. The dispatcher has Actions write locally,
but sends no token in status requests. No new credential or persistent authenticated runner exists.
Authenticated reads use bounded retries for transient failures and actual Retry-After/reset values;
there is no inherited 65-second anonymous API clock. Read-only waits retain the checkpoint.

## One request, one stage

| Stage | Effects and boundary |
| --- | --- |
| claim | Fetch unique approved Issue, preserve done/parks, claim checkpoint, lease, create worktree at observed dev. No model. |
| author | One new sandboxed Codex session; existing budget charge, path/foundation checks and candidate commit. No push/QA. |
| publish | Reconcile/push exact candidate through existing nonroot SSH identity; stop at PR wait. No force push. |
| qa | Observe exact same-repository dev PR; one new detached read-only exact-SHA Codex session. No repair. |
| ci | Observe exact push run/jobs/required steps; save success or concrete recognized source failure. No promotion. |
| integrate | Recheck QA/CI; if dev moved, ordinary bounded merge and clear gates for fresh publication/QA/CI. Otherwise prepare promotion. |
| promote | Recheck immutable task, clean source, saved exact QA, real CI and dev ancestry; one ff push to dev. |
| dev | Check exact DEV jobs/accept step, trusted fresh ACCEPTED receipt, live meta and receipt stability; only then done. |

The adapter uses exact V6 `Bridge` primitives, **never `Bridge.execute`, `_execute` or `main`**.
The bundled `live/` libraries are byte-identical to the supplied installed pins, not checkout copies:

- autonomous: `9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7`
- slots: `19d07c8d680d31ff65e13b3d8611b93fab1898461a918e69390a77bf8bb5ad02`
- foundation: `c2975b19bd46d00acbdbc08227545b8f9c9501d7b8e8783e9b397751c612bd13`

Existing sandbox, leases, atomic budget ledger, worktrees, QA evidence, done/Owner parks and
history are retained. The reviewed V6 continuity policy must already be enabled. Repairs cannot
exceed the immutable task cap (maximum three); integration uses the existing policy bound.
Repair snapshots and diagnostic history survive; independent QA gets the CI-repair diagnostic.
Known clean exhaustion, unavailable approved model and proven merge conflict archive an Actions
deferral without adding done or fabricating Owner PARK. Independent tasks can continue; dependents
wait for actual done. Unknown dirty author/QA/push outcomes retain occupancy and fail closed.

## Root receiver and recovery

The helper has a DEV-only fixed `train` hook before its deployment lock/config. PROD keeps its
original input/lock/deployment path. All existing deploy/status/accept/rollback/watchdog logic is
byte-identical after removal of that hook/read relocation; a test checks the LIVE helper hash.
The hook executes only root-installed code, never a candidate payload. Requests contain only
closed stage/slot/profile names, issue/run/attempt/generation integers, expected phase/head and
the private read token. No shell, path or environment selection is accepted.

Root serializes admission/journal operations briefly. A detached supervisor then runs exactly one
bounded stage, not a daemon/scheduler. Before any Git/model operation it drops to the existing
slot UID/primary GID plus group 65042 and a minimal environment. The trusted adapter disables
process dumpability; candidate children do not receive the API token in environment, prompt,
logs or files. Existing CLI auth is used in place; auth/session/private-key bytes are never copied.
Every model/Git mutation rechecks root ownership, old units and the held slot lease/worker lock.
Source operations do not hold the deployment lock.

The operation key binds issue, phase, head, attempt, generation, stage, slot and profile; the record
also binds originating workflow run/attempt. Repeated delivery returns the original result/status.
Pending is fsynced before effects; PID/start/boot identities prevent PID reuse or reboot from
looking like a live writer. Completed receipts move to immutable history files, not deletion.
No same-stage replay recharges a model. There are at most three read-only recovery attempts,
96 read-only wait attempts per operation and 128 semantic stage generations per task.

SSH cancellation leaves the detached bounded stage under supervision. Reconnect queries status.
A dead/unknown author or QA is never relaunched. Unknown publication/promotion checks remote refs;
an unknown merge adopts only a clean completed exact two-parent merge; DEV rechecks run/receipt.
An absent/uncertain push is not repeated by recovery. The 2,200-second supervisor deadline kills
its stage descendants, including separate CLI process groups; model timeout remains 1,800 seconds.

Root rejects overlapping live/pending tasks even between stages when kernel leases are released.
At most slot1 and slot2 can source concurrently. A durable root integration reservation plus the
existing integration mutex serializes integration/promotion through DEV ACCEPTED across requests.
An uncertain DEV outcome retains that reservation for reconciliation.

## Profiles and evidence

| Profile/provider | Known exact model | Approved roles / effective policy |
| --- | --- | --- |
| Codex / `codex` | `gpt-6.1-sol`, medium/high effort | author, qa, review; existing measured daily call budget must be known and positive |
| Cursor / `cursor` | No proven exact executable model mapping in LIVE registry | installed/authenticated author adapter remains disabled pending quota/provider proof |
| Antigravity / `agy` | No proven exact executable model mapping in LIVE registry | advisory review only; author/qa hard forbidden; not an executable acceptance gate |
| `auto` | Select only an enabled proven exact adapter | ranks permitted candidates by measured call-budget utilization; presently only Codex can execute |

Owner can select a profile in authorized workflow_dispatch. It does not edit claimed task JSON,
change its requested model, enable a provider, or select an unregistered model. Explicit unavailable
profiles return precise refusals. QA stays independent Codex. Results distinguish requested/effective
model, provider, role, fallback reason, used/remaining calls and unavailable alternatives. These are
call-budget counters, not invented provider token balances. Unknown quota is never free.

## Installation and reversal — PMA only

Review `manifest.json` and its digest independently. Copy the reviewed installer plus its `core.py`
and `receiver.py` dependencies into a root-owned non-writable review directory before executing
it as root. Do not execute an unreviewed candidate installer as root. The bundle is data read by
that reviewed installer; it is not imported or executed from the candidate. Example commands
below require actual PMA paths and exact reviewed values, not guessed host facts.

```sh
python3 -I -B -c 'import sys,runpy;sys.path.insert(0,"/root/reviewed-train");runpy.run_module("installer",run_name="__main__")' prepare --bundle /root/reviewed-bundle --manifest-sha256 REVIEWED_DIGEST
# Same command with --apply installs code and the helper hook DISABLED first.
```

Default DRY performs no managed mkdir/copy/chmod, lock creation, unit change or policy write.
Prepare captures actual before hashes, installed target hashes and unit states, backs up files,
commits disabled policy, installs exact-hash code, then exposes the helper. It rejects helper drift
from LIVE `f5e442d7ddd6c22834a1f31dc858deeb995377afd4b95be81791ad52813d5a1b`.
No old runtime, model auth, sudoers or unrelated unit is changed. Reinstall/upgrade requires a
new reviewed drift plan; prepare intentionally refuses an existing installation.

PMA separately integrates main-control workflows/client through a reviewed PR. Check that existing
`dev` Environment branch rules admit this exact main controller and the read-only commissioning
probe; secrets stay the existing DEV channel. Verify actual unit names, executable paths, group,
restricted SSH, default-branch runs and recorded shadow probe. No author network/install happened.

Activation requires a root-owned proof file with exactly schema `GB_ACTIONS_TRAIN_PROOF_V1`,
manifest digest, exact `controller_sha`, actual successful `probe_run` integer, `reviewed: true`,
and `codex` mapping of slot1/slot2 to their existing executable paths. PMA creates this evidence
only after the real reviewed probe; a boolean in a file is not independent QA or live proof.
Run `activate --controller-sha SHA --proof PATH --codex-slot1 PATH --codex-slot2 PATH` DRY,
then `--apply` only after workers drain. Installer never stops them. Both workers/supervisor must
be inactive, no model children/worker locks/leases, clean worktrees at a known compatible boundary.
Unknown claimed/author/QA/push/deploy states refuse takeover. At activation it captures actual
checkpoint hashes/enabled states, disables old autostart units without stopping processes,
rechecks hashes, then commits root ownership. Reboot therefore cannot enable two dispatchers.
The installed controller SHA is pinned; changing main control requires PMA's reviewed pin update.

`rollback` defaults DRY. With `--apply` it first disables new dispatch, then refuses pending/unknown
operations, active models, incompatible phases, code/backup drift or unfinished DEV reservation.
Only compatible quiescent state restores original code and exact old enabled flags; it does not
start services or restore old checkpoints. New attempts/history/budgets are never overwritten.
Actions-only deferrals require compatibility reconciliation before old scheduling can be restored.
A refused rollback remains disabled with its journal/history available for PMA recovery.

## Monitor mapping

`GB_SLOT_STATUS_V1` is unchanged. `actions-process.json` is a versioned own-UID companion with
actual CLI PID/start/boot and model facts. Root produces filtered public
`/var/lib/gobadminton-deploy-evidence/actions-train.json` on status/result observations.
`monitor.py`, `monitor_extension.js`, and `monitor-mapping.json` provide additive Python/browser
integration against the supplied writer/app hashes. PMA maps them to actual existing monitor
paths, backs up those files and applies the exact insertions; the installer does not guess paths
or rewrite unrelated units. Existing titles, backlog, history, CSS and seven stages remain.

The display separates workflow/supervisor from actual CLI, confirmed event from publication time,
and not_started/not_applicable/unknown/waiting/error/stale. Expired observations become stale.
Existing configured alerts remain; this package creates no SMTP or notification destination.

## Verification and remaining live boundary

Author checks are recorded in [handoff](../../handoffs/actions-train-158.md). They exercise isolated
subprocesses/simulations, not an installed V6 review. Local success is not independent QA,
installation, live restricted-SSH proof, workflow acceptance, DEV smoke or PROD authorization.
GitHub run artifacts retain filtered results/reconcile snapshots for 90 days; private immutable
operation receipts/checkpoints retain recovery history. PMA publishes this code/handoff to GitHub
and retains required operational evidence before Actions artifact expiry under project policy.

## Binding integration addendum (supersedes earlier main-execution assumptions)

Environment dev allows only branch dev. Register the two train dispatch workflows on default main, plus the separate no-checkout/no-SSH Train events bridge; run controller and stage jobs via explicit workflow_dispatch(ref=dev). Their checkout must be a literal reviewed controller commit. Freeze the final train-stage.yml SHA256 in root activation proof/policy and verify its bytes from each actual dev-ref run. Advancing product DEV does not require re-pinning unchanged controller code. Never relax environment protection or run candidate checkout with secrets.

The one-stage job has contents/issues/PR/actions READ permissions. Its ephemeral GITHUB_TOKEN is sent only via private SSH stdin and held in trusted process memory, never persisted or exposed to model tools. A separate hosted continuation job has actions:write and no SSH credentials. Numeric Owner admission and existing nonroot model permissions/budgets remain required. Root ownership/cgroup/kernel-lock checks prevent legacy and Actions writers from overlapping.

Install prepare remains disabled. Actual proof must bind manifest SHA, immutable controller SHA, stage_workflow_sha256, handoff_sha256 of the root quiescent migration record, successful shadow probe run, reviewed=true and the two existing Codex paths. Only exact unchanged root-proven unpublished promotion can migrate; unknown in-flight push/deploy still refuses. No checkpoint rewrite. Explicit profile is durable for each admitted task; auto cannot silently replace it. Other providers stay visibly unavailable until existing role/availability gates allow them.

Monitor payloads use existing writer and app.js paths with exact baseline hashes and full backup. Prepend the additive rendering module to app.js, preserving existing static route/CSP/session verification. Restart only gb-ops-monitor-web.service after verified install so its cached static asset changes. On rollback restore its original asset and restart the same service; no new monitor daemon is created.
