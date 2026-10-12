# Narrow successor change ledger — repair 2/5

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

New queued source/base `31d09f45776d7b397a1f66c8f4c9131eb3401f04`; planning read-only `7e24b4a40d7594293df3c72d0792f702dbb89be8`. Original `2485b75c032a5dfed5e1faff9535619382bea28c` / QA `cd9d3f3ef61893692bd394f98d98a8ad64322030` terminal FAIL/B01 and repair01 `55ef0136facdf2996378e29aa56eaf962a69f1e9` / QA `26d5233723b430a6dc9e42a70d2760391157f83a` terminal FAIL/B02 remain immutable. [Source manifest](evidence/source-manifest.json) binds both complete packages/handoffs, failed trees and QA evidence with hashes; no failed commit is a base or merged. B01 correction is retained, no attempt counter reset.

| Resource | Repair02 delta / preserved content | Limit |
|---|---|---|
| LEGACY_LOCK_MAP.md | Replace false link/unlink users-first claim with method/branch table, own transaction and rollback lookup, joined resolve, explicit vs implicit effects, callers and released auth-transaction lock. Retain exact invitation B01/prelude/replay/proof and DM/profile/session/Radar map after source-SHA normalization. | Source facts only, no runtime failure/proof or new lock prescription. |
| SOURCE_MATRIX.md | Narrow Identity/account summary correction, new source and own active observation. Same immutable authority matrix and other source/gate propositions. | Session-revoke fences never attributed universally to Identity; PR state remains unverified. |
| S1_CONTRACT_AND_CONCURRENCY.md | Add method-specific Identity caveat inside legacy compatibility and J11 reference in joint-liveness row. Entire proposed schema/wire/lifecycle/lock order and all other future C cases unchanged after base normalization; repair01 B01 text retained. | No new canonical/locking selection. |
| FUTURE_JOINT_SQL_CRITERIA.md | J01–J10 retained; J08 clarifies actual writer fences versus distinct session-revoke fence. J11 describes Identity explicit/implicit/caller/early-return reachable barriers. | Future disposable two-connection, both-order, timeout/pg_locks/errors/retry/progress/invariant evidence; all NOT_RUN. |
| GATES_AND_NEXT_INTAKE.md | Complete original/repair01 text unchanged except base and new independent QA recipient. | OQ-01 YES; G-05/G-06/G-08/G-03/G-07; S2 nonseat; S3 distinct Game/formal precedence/game:null/UNKNOWN; DD/Style Guide unchanged. |
| README/EVIDENCE/handoff | New task/base/branch/two failure lineage, B02 disposition and B01 retention, fresh checks and one next recipient. | Self-check is not QA; no PR/merge/install/deploy or gate change. |
| Own evidence | Recompute source/authority/old package and QA hashes; extend verifier with direct Identity/caller/implicit checks and original→repair01→repair02 preservation comparisons; freshly rerun pinned serialized model. | Old author-PASS records remain historical at failed SHAs; none copied as fresh results. |

Next bounded recipient `qa-fsg-s0-lock-map-reverify-02-20261009-v001` only. Same slice repair_attempt=2/max=5. No DD re-review, next-task launch, S1 implementation or acceptance authority follows. Rollback affects own documents only.
