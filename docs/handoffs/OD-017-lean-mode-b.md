# OD-017 — Lean Mode B + AGY adapter · source handoff (pass2)

**Date:** 2026-10-28  
**Author:** Cursor Auto (source-only OD-017 repair pass2)  
**Base retained:** first-pass HEAD not accepted/installed/published  
**Authority:** OD-017 Owner directive + Issue #29; short Mode A rules + OD-017 findings.

## Truthful status (this author pass)

| Predicate | Value |
|---|---|
| Source candidate | IMPLEMENTED under allowed_paths (effectful controller path) |
| Independent QA | **NOT_TESTED** (PMA/Codex) |
| Product CI 7/7 | **NOT_TESTED** |
| Root install | **NOT installed / NOT proven** (author must not install) |
| Mode B `enabled` | **false** until PMA commission |
| `MODE_B_ACTIVE` | **false** (installer refuses claim; needs two real task proofs) |
| `AGY_QA_READY` / `AGY_AUTHOR_READY` | **false** (no model calls; no manual ready) |
| C5 | **off** |
| #182 / gameRecommendations | **OFF** |
| Model calls this pass | **0** |
| UAT | **NOT_TESTED** |

## Implemented (working source, not stubs)

| Path | Role |
|---|---|
| `tools/train/run.py` | Finite resumable `run_once` / `execute_claim` / `advance_queue` with injectable adapters; one-writer lease (no nest); intent-before-call; UNKNOWN hold; next admitted auto |
| `tools/train/providers.py` | Cursor/Codex invoke wrappers; AGY `(result,evidence)` parse; **no regex fallback after native-invalid**; Codex exact JSON; Landlock private HOME/scratch (no global `/tmp`); quota 5/issue/UTC |
| `tools/train/host.py` | Fresh `gh api` run verification required (`verified=false` refused); exact workflow path; no commissioning bypass; fixed `client_sha` required |
| `tools/train/install.py` | Regular-file `current` pointer → `releases/<SHA>` (no symlink); trusted resolved host path; commission enables worker but `commissioning=true`, `mode_b_active=false` |
| `tools/train/client.py` | Actions SSH client; **LEAN_CLIENT_SHA required** (no `github.sha` fallback) |
| `tools/train/monitor.py` | Minimal projection helper for existing OPS monitor files |
| `tools/train/test_train.py` | Real `run_once` with mocked adapters (two-task, QA FAIL→repair, duplicate, writer, stale, UNKNOWN, parser, quota, host, monitor) |
| `.github/workflows/lean-delivery.yml` | schedule/comment/dispatch; requires `vars.LEAN_CLIENT_SHA` |
| `scripts/chatops/lean-delivery-receiver.sh` | Resolves pointer → `releases/<SHA>/host.py` |
| `scripts/chatops/tests/test_actions_train_lean_mode_b.py` | Receiver discovery wrapper → `test_train.py` |
| `docs/handoffs/OD-017-lean-mode-b.md` | This handoff |

## Not installed / not proven (do not present as live)

- Root install, helper patch on VPS, workflow-on-main publication
- Live Cursor/Codex/AGY calls, UID1002 publish, Product CI, DEV ACCEPTED
- AGY READY qualification, MODE_B_ACTIVE after two real product Issues
- OPS monitor live wire-up beyond projection helper + installer write attempt
- Intents/helpers alone are **not** working integration until PMA install + commission + live proof

## Author self-check (deterministic)

```bash
cd tools/train && python3 -I -B test_train.py
python3 -I -B run.py --self-check
bash -n ../../scripts/chatops/lean-delivery-receiver.sh
python3 -I -B ../../scripts/chatops/tests/test_actions_train_lean_mode_b.py
```

## Remaining limitations (honest)

1. Launchers are injected adapters; PMA must bind existing Mode A `run_cursor_author` / `launch_medium_qa` / UID1002 gh publisher at install/host wire-up.
2. Host `default_gh_api_fetch` needs host `gh` auth; Actions `GITHUB_TOKEN` is stripped for push.
3. LockRegistry falls back to repo `slots.py` or test FakeRegistry; live path needs `/usr/local/lib/gb-actions-train/live/slots.py`.
4. Queue Issues (e.g. 365 UAT followup, 94 marker separation) are admitted by PMA materials — not invented here.
5. No AGENTS.md / instruction-file edits in this pass (export omits instructions; PMA maintains AGENTS).

## PMA gates (unchanged order)

1. Independent Codex Sol Medium QA on exact candidate SHA  
2. Product CI all 7 on exact head  
3. Trusted PR → merge **dev** (UID1002 `gh`; never `GITHUB_TOKEN` push)  
4. DEV deploy ACCEPTED + live `/v1/meta` SHA  
5. Root install from exact SHA; commission enables worker only  
6. Publish reviewed workflow to **main** with `vars.LEAN_CLIENT_SHA` pinned  
7. Two real product proofs before any `MODE_B_ACTIVE` claim  
8. Separate AGY QA qualification admission (cap 5/issue/UTC day)

C5 off. #182 off. PROD forbidden. Author does not publish/install/runtime.
