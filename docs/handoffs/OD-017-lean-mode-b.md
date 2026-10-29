# OD-017 / OD-018 — Native AGY Author source checkpoint · 2026-10-29

Attempt 22 (Cursor Auto source-only). Continues Draft PR #377; base 1826d84. C5 off; PROD forbidden. No Root/install/publish/marker writes by author.

## Truthful status (this author pass)

| Predicate | Value |
|---|---|
| Source candidate | IMPLEMENTED under allowed_paths |
| Landlock CI fixture | FIXED (mock existing executable; Path.exists filter retained) |
| OD-014A author upgrade | SOURCE rewritten (Git blobs; author module + marker + unlimited budget only) |
| Live `agy_author_live` | SOURCE binding present (978 staging → 1002 atomic import) |
| Author selection | `task.authorroute` → qualified AGY or pre-launch Cursor fallback |
| `AGY_AUTHOR_READY` | **false** — no fake Runtime READY; parent product386 qual pending |
| Native AGY QA | remains REAL READY (unchanged N/Guard pins) |
| Independent QA / Product CI / DEV | **NOT_TESTED** (parent) |
| Mode B ACTIVE | **false** |
| This Cursor author launch | **1** (nested AGY/Codex = 0) |
| UAT | **NOT_TESTED** |

## Implemented (narrow)

| Path | Change |
|---|---|
| `native_antigravity_author.py` | `product_role_ready` / module pins for guarded READY predicate |
| `antigravity_author_upgrade.py` | OD-014A Git-blob install; quiet_v5; author=unlimited; no core/stage downgrade |
| `test_actions_train_antigravity_author.py` | Landlock fixture uses `sys.executable` as AGY stand-in |
| `test_actions_train_agy_author_upgrade.py` | Matches OD-014A / unlimited / pin-verify / no foreign targets |
| `tools/train/live.py` | `agy_author_live`, `owner_safe_atomic_import`, qualification gate helper |
| `tools/train/providers.py` | `select_author_provider`; `role_ready(agy_author)`; invoke routes without mislabel |
| `tools/train/run.py` | Imports `select_author_provider` |
| `tools/train/test_train.py` | Selection / fallback / inject import / gate denial tests |
| `manifest.json` | Author module digest refresh |

## Remaining parent limits (precise)

1. Root protected install of author module + canary marker (exact canary task SHA from fresh immutable task)
2. Real product #386 AGY author qual call → Codex Sol Medium QA → mandatory CI → DEV ACCEPTED
3. Only then atomic Root READY proof/marker; bind adapter revision+UID/model/modules
4. Operator #375 local import recovery (Cursor already completed; 11 files preserved)
5. Mode B ACTIVE still requires two real unattended DEV deliveries after commission

## Author self-check (deterministic)

```bash
cd scripts/chatops/tests && PYTHONPATH=.:../actions_train python3 -I -B \
  test_actions_train_antigravity_author.py Parser.test_author_landlock_uses_private_workspace_and_scoped_pty
PYTHONPATH=.:../actions_train python3 -I -B test_actions_train_agy_author_upgrade.py
cd ../../../tools/train && python3 -I -B test_train.py \
  AgyQaLiveBindingTests.test_select_author_provider_agy_or_prelaunch_fallback \
  AgyQaLiveBindingTests.test_agy_author_live_prelaunch_fallback_no_charge \
  AgyQaLiveBindingTests.test_agy_author_qualification_gates_and_fake_ready_denial
```
