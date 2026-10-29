# OD-017 / OD-018 — Native AGY Author source checkpoint · 2026-10-29

Attempt 23 (Cursor Auto source-only). Continues Draft PR #377; base 962dd282. C5 off; PROD forbidden. No Root/install/publish/marker writes by author.

## Truthful status (this author pass)

| Predicate | Value |
|---|---|
| Source candidate | SOURCE22 repairs under allowed_paths |
| Cursor timeout UNKNOWN | `invoke_cursor_author` preserves `cursor_timeout_unknown` (AGY keeps `agy_author_timeout_unknown`) |
| Canary pre-READY path | exact native digest via `canonical_task_payload` / `qualification`; role_ready stays false |
| Prompt / materials | private-export cwd only; materials fail-closed NO_CALL (no silent drop/truncate) |
| Author IPC | os.fork + bounded JSON (`_agy_ipc_*`); no multiprocessing.Queue/pickle |
| Repair HEAD | snapshot current HEAD; retain frozen base; `author_attempt` in fingerprint/routes |
| Qualification gates | `merged_sha` + exact Codex reviewed candidate when present |
| `AGY_AUTHOR_READY` | **false** — no fake Runtime READY; parent product386 qual pending |
| Independent QA / Product CI / DEV | **NOT_TESTED** (parent) |
| Mode B ACTIVE | **false** |
| This Cursor author launch | **1** (nested AGY/Codex = 0) |
| UAT | **NOT_TESTED** |

## Remaining parent limits (precise)

1. Root protected install of author module + canary marker (exact canary task SHA from `canonical_task_digest`)
2. Real product #386 AGY author qual call → Codex Sol Medium QA → mandatory CI → DEV ACCEPTED
3. Only then atomic Root READY proof/marker; bind adapter revision+UID/model/modules
4. Mode B ACTIVE still requires two real unattended DEV deliveries after commission

## Author self-check (deterministic)

```bash
cd tools/train && python3 -I -B test_train.py \
  NativeImportPreflightTests.test_post_spawn_timeout_unknown_not_treated_as_no_call \
  AgyNativeTransportTests.test_agy_author_canary_exact_vs_wrong_precharge \
  AgyNativeTransportTests.test_agy_author_prompt_cwd_and_material_fail_closed \
  AgyNativeTransportTests.test_agy_author_repair_head_keeps_base_and_attempt \
  AgyNativeTransportTests.test_agy_author_qualification_gates_and_fake_ready_denial
python3 -I -B test_train.py
cd ../../scripts/chatops/tests && PYTHONPATH=.:../actions_train python3 -B \
  test_actions_train_antigravity_author.py \
  Qualification.test_canonical_task_payload_strips_runtime_keeps_revision
```
