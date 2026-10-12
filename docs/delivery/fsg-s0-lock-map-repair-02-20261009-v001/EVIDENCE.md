# Author evidence and reproducibility limits — repair02

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

Queued source/branch base `31d09f45776d7b397a1f66c8f4c9131eb3401f04`; planning comparison `7e24b4a40d7594293df3c72d0792f702dbb89be8`. B02 source correction and B01 retention are reviewable. Author self-check is not independent QA; prior candidates' terminal FAIL remains unchanged.

| Evidence | Executed check and practical limit |
|---|---|
| [Source manifest](evidence/source-manifest.json) | Fresh exact source hashes/permalinks, both complete comparison packages and handoffs/terminal QA hashes, repair2/max5 ledger, immutable authority lineage, own point-in-time active observation. Historical observations are labelled historical, not new PASS. |
| [Verifier](evidence/verify_docs.py), [results](evidence/docs-verification.json) | Focused direct Identity method/branch/caller SQL checks, explicit vs implicit FK/unique distinction, retained invitation create/Accept, actual actor/idempotency/replay and proof branches, DM/profile/session/Radar helpers. Recomputed links/hashes/frozen DD custody, original and repair01 carry-forward comparisons, inventory, allowed paths and Git whitespace. Static source checks cannot prove concurrency or exhaustive physical lock order. |
| [Serialized model](evidence/serialized-model-rerun.json) | Freshly execute pinned PR132 Python source in memory, no install:65 finite serialized proposal assertions/exit0. Exact SHA/hash and original OQ-01 conditional metadata retained; separate Owner YES stays closed. No current API/SQL/implementation proof follows. |
| [Publication freshness](evidence/publication-freshness.json) | Fresh Git main/material-source and own active-lock observation before commit/push. Mandatory receipt records final NEW candidate SHA/tree, immutable handoff ref and verified remote branch head after push; no circular self-SHA in candidate. No PR claimed. |

Reproduce on the exact new candidate: `python3 docs/delivery/fsg-s0-lock-map-repair-02-20261009-v001/evidence/verify_docs.py`. Verifier reads pinned Git and workspace, emits JSON to stdout, executes only the exact finite serialized proposal model. Evidence records actual source/check limitations; checks do not grant technical, API, Owner or release acceptance. Git branch creation needed task-authorized escalation because the provided worktree's Git metadata is stored in a read-only shared repository directory; no other workspace or control-plane state was changed. Per-command `gc.auto=0` avoids unrelated Git housekeeping while retaining inherited hooks.

**NOT_RUN:** application tests/build/typecheck/lint; PostgreSQL/PostGIS/migrations/concurrency/EXPLAIN; browser/render/device/keyboard/PWA/push; hosted CI; live runtime/deployed API/web; independent QA; fresh PR UI; canonical Architect/Product/API/Owner/Legal/release acceptance. All J01–J11 and future C01–C16 remain NOT_RUN. No dependency/browser/DB provisioning, install, system/runtime change, flags, main merge or next-task launch. Only own task progress/receipt are Runner writes. Rollback discards/reverts own docs only.
