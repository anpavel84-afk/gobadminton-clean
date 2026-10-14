# Friends S0 — B02 Identity lock-map repair 02 v001

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

Date: 2026-10-09. Producer: isolated Codex executor `fsg-s0-lock-map-repair-02-20261009-v001`, SOURCE_ONLY, `docs:fsg-s0`, non-PROD. Same conceptual slice `fsg-s0-contract-gate-reconciliation-20261009-v001`, repair **2/5**, maximum five; names do not reset the counter. Branch `docs/fsg-s0-lock-map-repair-02-20261009-v001` starts at queued immutable source `31d09f45776d7b397a1f66c8f4c9131eb3401f04`, planning comparison `7e24b4a40d7594293df3c72d0792f702dbb89be8` read-only. Fresh main `89b0dc040ecf7dac9d70cb5e77ff39e0a7f98941` changes only PM queue/evidence; material source/frozen custody unchanged.

[Exact assignment](https://github.com/anpavel84-afk/gobadminton/blob/31d09f45776d7b397a1f66c8f4c9131eb3401f04/docs/prompts/implementation/fsg-s0-lock-map-repair-02-20261009-v001.md) and [sibling admission](https://github.com/anpavel84-afk/gobadminton/blob/31d09f45776d7b397a1f66c8f4c9131eb3401f04/docs/manifest/PM_ADMISSION_FSG_S0_LOCK_MAP_REPAIR02_20261009_V001.md) admit this complete successor and its separate independent QA only.

Original candidate `2485b75c032a5dfed5e1faff9535619382bea28c`, tree `0e80a58f0f486d27ed6192e0936d81d740ab7965`, [terminal QA FAIL/B01](https://github.com/anpavel84-afk/gobadminton/blob/cd9d3f3ef61893692bd394f98d98a8ad64322030/docs/handoffs/2026-10-09_qa_to_pm_fsg-s0-contract-gate-reconciliation-v001.md) and repair01 candidate `55ef0136facdf2996378e29aa56eaf962a69f1e9`, tree `154a497c95a1b2120c75e6808b50a4a1d3708abf`, [terminal QA FAIL/B02](https://github.com/anpavel84-afk/gobadminton/blob/26d5233723b430a6dc9e42a70d2760391157f83a/docs/handoffs/2026-10-09_qa_fsg-s0-lock-map-reverify-01-v001.md) remain immutable/MERGE_NOT_RECOMMENDED. Both complete packages were read as comparison only; neither was merged/cherry-picked or used as branch base. B01 is independently CORRECTED_IN_NEW_CANDIDATE at repair01 and retained here.

B02 correction: direct link/unlink begin their own transactions with external identity FOR UPDATE; no prior explicit users/ActorFence lock. Link existing-owner returns, new-link query/insert, rollback lookup, separate joined resolve and caller transaction boundaries are traced. Implicit FK/unique/write effects remain separate. No runtime defect, deadlock proof, new lock prescription or application change is claimed.

Read in order:

1. [Source/authority matrix](SOURCE_MATRIX.md), [exact source hashes and both failures](evidence/source-manifest.json).
2. [Existing SQL map](LEGACY_LOCK_MAP.md), [retained S1 contract proposals](S1_CONTRACT_AND_CONCURRENCY.md).
3. [Future joint SQL criteria J01–J11 — NOT_RUN](FUTURE_JOINT_SQL_CRITERIA.md).
4. [Preserved S2/S3/gates/DD and future intake](GATES_AND_NEXT_INTAKE.md).
5. [Repair02 change ledger](CHANGE_LEDGER.md), [fresh author evidence/limits](EVIDENCE.md), historical handoff `2026-10-09_fsg-s0-lock-map-repair-02-v001.md` (not included in Clean extraction).

OQ-01 YES stays CLOSED; G-05/G-06/G-08/G-03/G-07, S2 one-recipient/nonseat, S3 distinct actionable Game/formal precedence/private `game:null`/UNKNOWN, DD-FR-01..03 and frozen Style Guide custody remain. All S0 schemas/routes/locking selections remain proposals. S1–S4/app/API/migration/flags/release effects are unadmitted. One next recipient: independent `qa-fsg-s0-lock-map-reverify-02-20261009-v001` reviewing NEW immutable candidate/tree. Publication and author self-check do not constitute independent QA. Rollback discards/reverts own docs only; no runtime resources changed.
