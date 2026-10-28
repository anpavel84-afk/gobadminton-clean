# OD-017 — Lean Mode B + AGY adapter · source handoff

**Date:** 2026-10-28  
**Author:** Cursor Auto (source-only attempt 1)  
**Base:** `b949a090f26e1d1fd9729c2297ed9367cdd76663`  
**Authority:** OD-017 Owner directive + Issue #29 comment admission; Mode A short AGENTS + OD-017 supersession of Mode B deferral only.

## Truthful status (this author pass)

| Predicate | Value |
|---|---|
| Source candidate | IMPLEMENTED under allowed_paths |
| Independent QA | **NOT_TESTED** (PMA/Codex) |
| Product CI 7/7 | **NOT_TESTED** |
| Root install | **NOT_TESTED** (author must not install) |
| Mode B `enabled` | **false** until commission |
| `MODE_B_ACTIVE` | **false** |
| `AGY_QA_READY` | **false** (do not claim; no model calls) |
| `AGY_AUTHOR_READY` | **false** |
| C5 | **off** |
| #182 / gameRecommendations | **OFF** |
| main as product trunk | **no** |
| Model calls this pass | **0** |
| UAT | **NOT_TESTED** |

## What landed (working code, not stubs)

| Path | Role |
|---|---|
| `tools/train/run.py` | Finite controller: Owner admission, claim/revision freeze, one-writer lease hook, receipts, recover-by-readback, schedule HOLD, next-ready |
| `tools/train/providers.py` | Cursor/Codex/AGY routing, AGY quota receipts, Landlock preexec helper, parse-replay no charge, READY predicates (unread → not ready) |
| `tools/train/host.py` | Root Actions request validator; workflow blob vs installed release; closed `action=lean` (no shell/paths/tokens) |
| `tools/train/client.py` | Hosted Actions SSH client (DEPLOY_* temp 0600); concurrency group `gobadminton-lean-delivery` |
| `tools/train/install.py` | Root install from Git blobs → `/usr/local/lib/gobadminton-lean/releases/<SHA>`; config `enabled=false`; helper patch; rollback; commission |
| `tools/train/test_train.py` | Deterministic boundary tests |
| `.github/workflows/lean-delivery.yml` | schedule 15m + Owner issue_comment + dispatch; environment `dev`; never checks out Issue head with secrets |
| `scripts/chatops/lean-delivery-receiver.sh` | DEV `action=lean` → fixed host.py |
| `AGENTS.md` | Short Lean rules; OD-017 Mode B pending activation; C5/#182/main constraints |
| `docs/handoffs/OD-017-lean-mode-b.md` | This handoff |

Does **not** adopt historical `gb-pipeline` queue, enable C5, reopen #29 grants, invent product Issue IDs, or call AGY/Cursor/Codex.

## Author self-check (deterministic)

```bash
cd tools/train && python3 -I -B test_train.py
python3 -I -B run.py --self-check
bash -n ../../scripts/chatops/lean-delivery-receiver.sh
```

Product CI `receiver` job discovers `scripts/chatops/tests/test*.py` only. **`tools/train/test_train.py` is not auto-run** unless PMA adds one line. Suggested exact path (ask PMA; `ci.yml` was outside author allowed_paths):

```yaml
# .github/workflows/ci.yml · job receiver · one additional line after existing unittest discovers:
python3 -I -B tools/train/test_train.py
```

## PMA gates (order)

1. Independent Codex Sol Medium QA on exact candidate SHA (structured JSON `reviewed_sha` / `verdict` / `findings`).
2. Mandatory Product CI **all 7 jobs** on that exact head — never disable security/foundation.
3. Trusted publish PR → merge **dev only** (UID 1002 `gh` CLI; **never** `GITHUB_TOKEN` for push).
4. Wait normal `dev-deploy.yml` (`concurrency: gobadminton-dev`). Acceptance = server **ACCEPTED** line + release/smoke artifacts + public `/v1/meta` SHA — **not** deploy stdout 0.
5. Root install on exact Git SHA (after QA+CI):

```bash
sudo python3 -I -B tools/train/install.py dry-blobs /path/to/clean <EXACT_SHA>
sudo python3 -I -B tools/train/install.py install /path/to/clean <EXACT_SHA>
# inspect: /usr/local/lib/gobadminton-lean/current → releases/<SHA>
# /etc/gobadminton-lean/config.json enabled=false
```

6. If helper patch reports `missing_permission_or_structure`, apply `scripts/chatops/lean-delivery-receiver.sh` via reviewed installer path — **do not invent authority**.
7. Publish **only** reviewed `.github/workflows/lean-delivery.yml` to **main** so schedule/comment events fire; keep product integration on **dev**. Set `vars.LEAN_CLIENT_SHA` to reviewed client commit.
8. Explicit commission after live proof:

```bash
sudo python3 -I -B /usr/local/lib/gobadminton-lean/current/tools/train/install.py commission
```

9. AGY QA qualification (Issue **368** known-safe accepted candidate) is a **separate** OD-017 admission — not this source pass. Cap 5 charged calls/issue/UTC day; parser replay = no charge; unknown ≠ 0. Fallback Codex without blocking other Issues.
10. Record UAT=`NOT_TESTED` and continue independent ready work; do not claim full product acceptance.

## Rollback

```bash
sudo python3 -I -B /usr/local/lib/gobadminton-lean/current/tools/train/install.py rollback [PREV_SHA]
# restores helper backup + config disabled; optional previous current pointer
```

Touched only: lean release tree/pointer, lean config, optional `gb-deploy-helper.sh` backup, optional monitor projection file. No PROD/sudoers/secrets.

## Operator unknowns / facts

- Host VPS paths (`/usr/local/lib/gb-actions-train`, LockRegistry live dir, helper) were **not** reachable from this author sandbox — code targets the documented ground truth; install must verify on German `vmi3510488`.
- If `DEPLOY_*` / environment `dev` / main workflow publication permission is missing, report the **exact** GitHub/Actions fact; do not skip gates.
- Old C5 UNKNOWN / #29 grants remain immutable; Lean READY markers are new files under `/etc/gobadminton-lean/`.
- Two product acceptance Issues still need Owner IDs — **not invented here**.

## Continue

PMA owns QA → CI → publish → install → workflow-on-main → commission → AGY qualification. Author repairs stay on this Issue/PR revision.
