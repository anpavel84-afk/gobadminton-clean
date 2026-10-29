Current runtime checkpoint: PR #376 native AGY QA READY after real PASS[] on 85a38ec5, trusted UID978 proof; AGY author NOT READY. Mode B itself remains SOURCE ONLY, not installed/active; primary QA Codex Medium. Owner OD-020 supersedes the old five-call policy; source+runtime budget reconciliation is pending and is not a provider limit.

# OD-017 / OD-018 — Lean Mode B · source handoff

**Date:** 2026-10-28
**Author:** Cursor Auto (source-only OD-017 repair3 — live default bindings)
**Base retained:** prior WIP pass2 not accepted/installed
**Authority:** OD-017 Owner directive + Issue #29 comment + Owner chat EXACT assignment.

## Truthful status (this author pass)

| Predicate | Value |
|---|---|
| Source candidate | IMPLEMENTED under allowed_paths (live default bindings in `live.py`) |
| Independent QA | **NOT_TESTED** (RootPMA / Codex after CI) |
| Product CI 7/7 | **NOT_TESTED** |
| Root install | **NOT installed / NOT proven** (author must not install) |
| Mode B `enabled` | **false** until PMA commission |
| `MODE_B_ACTIVE` | **false** (needs two real task proofs) |
| `AGY_QA_READY` / `AGY_AUTHOR_READY` | **false** (no fabricated READY; Medium fallback while not ready) |
| C5 | **off** |
| #182 / gameRecommendations | **OD-018 prospective guarded DEV authorization; not yet released** |
| #94 | **PARK remains** (not auto-cleared; not 365→94 hardcode) |
| This Cursor author launch | **1** (nested AGY/Codex inference in-process = 0) |
| UAT | **NOT_TESTED** |

## Implemented (working source — live defaults, not injected-only helpers)

| Path | Role |
|---|---|
| `tools/train/live.py` | **NEW** production bindings: Cursor author, Codex/AGY QA, UID1002 push/PR, exact-7 CI poll, merge with distinct merge SHA, DEV ACCEPTED/live SHA, canonical Project GraphQL queue, worktree create |
| `tools/train/run.py` | `main`/`run_once` load LIVE defaults; WriterLease ≠ IntegrationLock; WAITING_CI/DEPLOY durable resume; OD-016 wake deadline (no max_repair=8); merge retains candidate + separate merge SHA; CI FAIL→author findings; auto-next after UAT |
| `tools/train/providers.py` | Live launcher defaults; `readable_present` + injectable `auth_path`; `invoke_agy_qa`; honest AUTHOR_PASS_CLAIMS (1 Cursor launch) |
| `tools/train/host.py` | Wake budget ~2400s (fits Actions 45m); no 120s hard kill of author+CI+QA+DEV |
| `tools/train/monitor.py` | ordered_backlog / holds / source / synced_at projection fields |
| `tools/train/install.py` | Includes `live.py` in INSTALL_FILES |
| `tools/train/test_train.py` | Temp integration + auth fixtures; two eligible tasks 701/702; park/UAT exclusion; distinct merge SHA; CI repair; WAITING resume; Project queue_unavailable zero calls; live binding mock boundary |

## Queue authority (corrected)

- Canonical queue = GitHub user Project #1 (Owner Issue #175) via GraphQL + UID1002 auth
- Auth/scope failure → `PROJECT_ACCESS_NOT_VERIFIED` / `INSUFFICIENT_SCOPES` → `queue_unavailable` + **ZERO calls** (no empty backlog, no all-open-Issues fallback, no stale `backlog-after.json` / `backlog_ru.json`)
- Field bindings from actual queried names; absent/ambiguous status fails closed (not guessed READY)
- Owner admission comments freeze role/scope/acceptance; Project priority/status/deps gate eligibility
- #94 PARK remains; #182 prospective OD-018 scope only; delivered 365/308/207/368 = UAT not new product

## Not installed / not proven (do not present as live)

- Root install, helper patch, workflow-on-main publication
- Live Cursor/Codex/AGY paid calls on host, Product CI, DEV ACCEPTED
- AGY READY qualification (code path exists; readiness only after verified real operation + independent acceptance)
- `MODE_B_ACTIVE` after two real product Issues
- Project GraphQL field names commission (PMA verifies fields after auth refresh)

## Author self-check (deterministic)

```bash
cd tools/train && python3 -I -B test_train.py
python3 -I -B run.py --self-check
bash -n ../../scripts/chatops/lean-delivery-receiver.sh
python3 -I -B ../../scripts/chatops/tests/test_actions_train_lean_mode_b.py
```

## Unproven runtime gates (precise — no PMA manual bindings required in source)

1. Host `gh` UID1002 Project scope after Owner auth refresh
2. Independent Codex Sol Medium QA on exact candidate SHA
3. Product CI all 7 on exact head (UID1002 push wakes CI, not GITHUB_TOKEN)
4. Trusted PR merge → distinct merge SHA; DEV ACCEPTED + live `/v1/meta` == merge SHA
5. Root install from exact SHA; commission enables worker only
6. Two real sequential product proofs before `MODE_B_ACTIVE`
7. Separate AGY QA qualification (cap 5/issue/UTC day); Codex Medium fallback meanwhile

C5 off. #182 follows Owner OD-018 comment6483075322; old admissions unchanged. #94 park. PROD forbidden. Author does not publish/install/runtime.
No AGENTS/instruction-file edits in this pass.
