# WORKING DRAFT — NOT APPROVED — NOT CANONICAL
# V002 review results, activation prerequisites and minimum implementation path

Owner directive: refine the **planning + per-stage model assignment system** before any normal backlog writer is launched.
Date: 2026-10-22.

## Verified baseline and constraints

- Root actions_train `mode=disabled` after #185 controller replacement. This proposal has not touched runtime policy, tasks, slots or installed services.
- Actual task contract `GOBADMINTON_AUTONOMY_V1` has one optional scalar `model` and scalar `effort`; closed supported Codex is `gpt-6.1-sol` medium/high. It cannot authorize different stage models just by changing a Github Project field. It also requires immutable numeric Owner-authored enrollment.
- OpenAI Codex model *cache* on Germany advertises Astra/Sol/Luna and efforts; this is metadata rather than successful task-scoped inference+permission.
- Cursor `agent --list-models` includes `auto`; `agent --mode plan` provides a read-only planning mode. Current closed runtime Cursor adapter is **not** enabled.
- Antigravity `agy models` lists `claude-sonnet-5-5-(medium/high)`, `claude-opus-5-5-high`; `--mode plan` available. Current automatic QA adapter is **not** enabled.
- **Antigravity independent read-only review attempt** against this proposal failed with host `Matches user-configured deny rule` for both file reads and shell reads. Verdict **BLOCKED / NOT_TESTED**, not FAIL of routing design and not PASS of Antigravity QA. Do not bypass or weaken the configured deny with broader permissions or copied secret material; the supported isolated QA project identity must be reviewed/provisioned.
- Projects #1 is documented, but `gh auth status` is not signed in as the execution user and Projects-v2 writes cannot be assumed available. Avoid a duplicate local backlog.
- Owner-approved post-game model #73 is not automatic execution admission; #177/#181 spent recovery reservations must remain spent.

## Independent architecture review R1

Codex Astra review of proposal source at `89264793aff62b5acd8c1d6d7982592a3a8213c6`: **FAIL**, six confirmed gaps:
1. QA could be proposed without exact independent identities/session/worktree/commit.
2. Complex code could proceed with architecture not explicitly frozen.
3. Known code writes conflated with unknown effects; CI infra status after 3/3 wrongly categorized.
4. Integer author attempt ledger not strictly validated; provider fallback needed same-attempt reservation proof.
5. Draft dependency check ignored invalid external dependency types; it did not validate any parent security envelope.
6. Owner UAT treated as an automatic deterministic success gate.

Corrected simulator at `3b12bf92540b8dac82214538740484d2a49b079c`:
- QA now requires separate author/reviewer identities, sessions and worktree labels plus an exact 40-hex candidate SHA; runtime must independently authenticate these claims.
- Complex/critical implementation requires explicit frozen architecture SHA and evidence; exploratory code cannot execute until diagnosis and reclassification.
- Model failure stage uses `NO_EFFECT/KNOWN_EFFECT/UNKNOWN_EFFECT`, a same-reservation proof, integer consumed attempts and separate CI environmental classifier. Unknown effects always reconcile before fallback.
- Graph checker strictly validates external issue integers and cycles, and explicitly reports `unverified_gates` for Owner scope, duplicate work, dependencies and path/lock conflicts. It CANNOT claim admission.
- Owner UAT returns `AWAIT_OWNER_ACCEPTANCE`, never CI/DEV-style success.
- **22 pure unprivileged unit tests PASS** on exact corrected code. This is not independent QA approval or runtime authorization.

## Minimum changes BEFORE activation

1. **Approve role routing envelope** (this draft) as intended product/OPS policy; no running task is silently reauthorized. Record Owner-approved risk/role/effort candidate profiles with a finite fallback list.
2. **Provider qualification (no live source writes):** prove Cursor Auto author call under both actual slot contexts; Antigravity Claude Sonnet/Opus QA read-only with correct verified worktree/path scope; Codex Astra and Sol exact model/effort under allowed subscription. For each candidate record CLI path, user, exact model, sandbox, identity, non-secret result, quota evidence. A CLI listing is insufficient.
3. **Immutable stage admission extension:** version the task envelope for parent/child/phase model alternatives and allowed effects. Root validates verified numeric Owner/delegation, exact parent scope subset, no duplicate child, no unauthorized paths, exact model/effort candidate allowance. Do not edit past `GOBADMINTON_AUTONOMY_V1` comments or assume Project status is machine admission.
4. **Plan proposal Action, not a new scheduler:** reuse Github Actions dispatcher; a read-only, bounded planner produces a draft subissue DAG and exact stage artifacts. Native GitHub subissues represent independent product deliverables. A security-review Action checks each proposed subissue against an immutable parent scope. Only the separately authorized publisher can register those children through Github, without pretending to be Owner.
5. **Stage execution / model route Action:** route stages by type and risk, provider proof and model-allowed set; preserve the existing two-physical-slot executor locks/attempt journal. Architecture/critic are read-only except approved docs; Cursor code stage receives a bounded write scope; independent QA has another worktree and no write. CI/DEV deterministic. No new persistent server worker.
6. **Automatic replan:** use exact QA/CI/error artifacts. New stage-plan revision or successor, not source commit overwrite; if a live writer is unknown reconcile first. 3/3 has no fourth attempt. Escalation from Sol to Astra is a new stage-route revision, not extra Owner product permission.
7. **Projects / monitoring:** reflect relationships, priorities and status via existing GitHub Issues/Projects when authenticated. Monitor only derived status: product goal, stage, selected CLI/model and effort, reason for switch, CI/DEV evidence, why waiting, Owner action required. No separate manually maintained backlog.
8. **Canary and acceptance:** model comparisons on 8–12 frozen GoBadminton scenarios; run one small safe UI author + cross-model QA, one critical architecture before Cursor code and one *confirmed pre-effect* quota fallback. Verify exact SHA, no second writer, finite task/model budget, authorization and rollback. No PROD without GO.

## Additional safety definition

Model upgrade is permitted only within the preapproved role/model list and existing task scope. Switching from Cursor to Codex on a known completed/unknown write is not allowed without reconciliation. Architecture review may change technical constraints only within the Owner-approved product envelope; widening private data visibility, permissions, migrations, or write paths requires separate approval. A CI/run result cannot be fabricated as passing just because a model says PASS.

**NOT DONE / NOT CLAIMED:** role-stage API integrated into live train, Cursor/Antigravity adapter authorization, real independent Antigravity QA, Projects-v2 integration, root activation, automatic issue splitting, automatic published successor, real DEV/canary. This draft PR must remain unmerged pending model review and explicit bounded approval.
