# Final Consumer + Social Web Delivery Map v001

Status: **PM_ACTIVE — DESIGN_FROZEN**
Date: 2026-10-04
Frozen Design Spec: `487a8379ff31c88a95d0f0f130dad7c78f7af6f2`

| Web slice | Surface | Backend gate | Current disposition |
|---|---|---|---|
| WEB-00 | production shell/tokens/navigation | none beyond existing web | **MERGED** on main `14c5b418101b0a44cbec56c114f571d6364035db` (code package `37f784ab0136fdcc132cca93af94bec9c09dd6d5`) |
| WEB-01 | Games completion | existing/accepted Games + Participation + managed-games | **MERGED** on main tip `9e78ac6efbc9fe699c87514adceec984502d2ab1` (code package `d13037c75a51024b1019115e58e0a19c2a473409`) |
| WEB-02 | Players/Profile | accepted Profiles/Safety/Directory | **MERGED** on main via `b62f351abce1531904fa1e15dd7fad1d84800719` retaining tip `eb7fa6c5e1a67419f665e7ce31ce70524745aeef` (code package `6c847bf3e53d5af55a8fdff6310189a38be46c0a`) |
| WEB-03 | DM/Invitations/Inbox | accepted DM + invitation contracts | WAIT |
| WEB-R | Radar | accepted LS-R1 + LS-R2 | WAIT; mandatory before SOCIAL_MVP_READY |
| WEB-04 | Game Chat | accepted Game Chat contracts + P-GC dispositions | WAIT |
| WEB-05 | content/legal/support templates | layout can be prepared; real content gated | WAIT |
| WEB-06 | integrated acceptance | all admitted constituent surfaces | WAIT |

Backend PM v003 continues independently. Web implementation never infers backend readiness from frozen design presence.

## Current backend note

S-00A is merged on main (exact package `3c3960238fdc3d4aed52b92b3c489497b73d21fb`). Independent reverify closed DEF-S00A-01 with `PASS_WITH_NONBLOCKING_GAPS` and zero blocking gaps.

LS-01 Profiles/Safety/Directory is **MERGED** on main at exact QA-tested tip `17b7b98e4ff83857c1c8fd5f16b5b7c3f4bb2632`.

LS-R1 Radar presence/matching is **MERGED** on main at exact QA-tested tip `22afbc1cf35b40c41d145bea6e9a803b58aaa0cb` (code `9dddbf7027afeb6938e9255bc9bea5bfe766196e`). LS-R2 is **MERGED** on main at exact QA-tested repair tip `fceab93aac7c507769074bf9991d15aa8d386be9` (code `9753d60a9057fe663bd3af570bdf17aec7644676`); prior FAIL SHA `2076598…` was not merged. WEB-R remains gated on accepted R1+R2 **and** canonical FR Radar slice (not legacy WEB-R). Canonical FR-01 is **MERGED** on exact QA-tested repair tip `7bb11d352d1ad265314d2802bb9fc2759c8a7998` (code `9a4eccc66ec16d36474b85fcf861147938bb39e8`); original FAIL SHA `3bc71ec…` remains terminal as a candidate head. Canonical FR-02 is **MERGED** via `587a5acf326eb60a5dc3506271b3d8aa489efeea` retaining tip `c0241310a8f0f42813a4e04a1d6c8b45359c0608` (code `2d732bb3fd33204828ac641414c216d725d0d215`). Canonical FR-03 is admitted.

LS-02 durable jobs / pg-boss is **MERGED** on main via `e5f5e3ef6d1f219736d279ee3520d5ad899072c1` retaining tip `66c1130a7ed87a45d37da7a98f162cc5b57d586a` (code package `f33ffd78e071254821ed98dd7a905d6d4490ab3f`).

Synthetic demo foundation seed is **MERGED** on main via `020e4eb12bca6f044c952d6575c0076c29aa1d4d` retaining tip `da1ed33a5ff1c979ed136e134cddbdaf8fd90286` (code `c6ef71b5fd2f8a6f60197b4d39dfa2fe54fe1a14`). Independent reverify closed the repair loop at attempt 3/5 with `PASS_WITH_NONBLOCKING_GAPS` and zero blocking gaps.

Early DEMO_PUBLIC preview deploy freeze `020e4eb12bca6f044c952d6575c0076c29aa1d4d` is independently verified (`PASS_WITH_NONBLOCKING_GAPS`, QA tip `9a2aff1…`) and durably recorded on main via merge `4363cfd…`. Backend LS-03 Text DM is **MERGED** on main at exact QA-tested tip `88c5b9a9407e4e3816f491c5a164161f09fc5ca6` (repair code `d5c5882d992eb4039b611eaf0dc6d7a9601ed422`; repair 1/5 closed). Backend LS-04 GameInvitation is **MERGED** on main at exact QA-tested tip `0dc22d9f7a7b79d440a2b97d74175e62f1d21895` (repair code `f6994aeae94315791b43c09902707241c2bcfa8e`; merge `139271fb…`; prior FAIL SHA `ee53b0db…` not merged). WEB-03 remains gated on accepted DM + invitation contracts and `OWNER_HOLD_FRONTEND_V001`. Demo PASS does not authorize live OAuth, live Radar, real-user launch, or WEB-R.
