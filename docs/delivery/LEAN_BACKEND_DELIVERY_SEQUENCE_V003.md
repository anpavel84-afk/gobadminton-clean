# Lean backend delivery sequence v003 — Radar-required MVP

Status: **PM_ACTIVE — BACKEND_COORDINATION**
Date: 2026-10-03
Supersedes: Radar-specific ordering in `LEAN_BACKEND_DELIVERY_SEQUENCE_V002.md`
Authority: PM Radar successor v003 + OWNER_DECISION_RADAR_MVP_V001 + ADR-SOCIAL-004

## Principle

Radar is mandatory before `SOCIAL_MVP_READY`. Existing S-00A is not restarted. One overlapping backend/schema/contracts writer remains the default.

## Sequence

| Stage | Scope | Gate | Completion minimum |
|---|---|---|---|
| S-00A | Transaction/auth/idempotency/Game.version reconciliation | DONE on main | independent QA + merge; no social endpoints |
| LS-00 | Scoped contract/policy decisions including Radar profile | docs-only | exact parameter/status register; unresolved Product/Trust items explicit |
| LS-01 | Profiles + Safety | DONE on main `17b7b98…` | opt-in profile, minimal projection, block/report, explicit Radar consent separate from directory visibility |
| **LS-R1** | Radar presence + acquisition + coarse matching + result proof | DONE on main `22afbc1…` / code `9dddbf7…` | real Postgres/PostGIS R1 backend candidate + independent QA; no contact flow claim |
| **LS-02** | First necessary durable jobs / pg-boss | DONE on main tip `66c1130…` / code `f33ffd7…` (merge `e5f5e3e…`) | only needed jobs; Radar correctness never depends on worker |
| Demo seed | Reversible 20-account synthetic foundation | DONE on main tip `da1ed33…` / code `c6ef71b…` (merge `020e4eb…`) | no fake Radar people; DEMO_PUBLIC deploy separately verified |
| DEMO_PUBLIC preview | Early synthetic public deploy | DONE freeze `020e4eb…` (QA `9a2aff1…`; evidence merge `4363cfd…`) | no live OAuth / real-user launch |
| LS-03 | Text DM | DONE on main tip `88c5b9a…` / code `d5c5882…` (FF; repair 1/5 closed) | request/accept/decline/send/list/read with current eligibility |
| LS-04 | GameInvitation | DONE on main tip `0dc22d9…` / code `f6994ae…` (merge `139271fb…`; repair 1/5 closed) | manager-only invite, capacity-safe acceptance; prior FAIL SHA `ee53b0db…` not merged |
| **LS-R2** | Radar preview/contact/recovery integration | DONE on main tip `fceab93…` / code `9753d60…` (FF; repair 1/5 closed; prior FAIL `2076598…` not merged) | discoveryProof revalidation, DM/invite integration, post-lock expiry, revoke/stop races, recovery/backup proof + independent reverify |
| auth-live | Bounded live VK/Yandex OAuth E2E | DONE lean QA PASS_WITH_NONBLOCKING_GAPS on runtime `56a1c95…` (QA `bbc44b7…`; producer tip `f5308c5…`; apps Yandex scope `1632ed9` not merged) | O-01/O-02/real-user launch remain open |
| P-GC closure | Game Chat policy dispositions | DONE on tip `305b6cf…` (`docs/manifest/PM_GAME_CHAT_POLICY_DISPOSITIONS_V001.md`) | four P-GC/IR-GC pairs closed for non-prod slice; legal/real-user gates remain |
| LS-05 | Game text chat | DONE on main tip `0528e211…` / code `2f355fb…` (FF; repair 1/5 closed; prior FAIL `8cc32b1…` not merged) | Game-locked listMembers fence; P-GC dispositions remain; legal/real-user gates open |
| LS-06 | Composed Inbox | DONE on main tip `dbe4549…` / code `1a11a2e…` (FF; repair 1/5 closed; prior FAIL `3c4cfa8…` not merged) | separate unread/action counts, polling; no second write truth |
| LS-07 | Social acceptance/readiness | all required social slices including R1/R2 | synthetic E2E + Radar R01–R18 evidence + separate browser readiness statement |

## Radar invariants

- No raw latitude/longitude persisted beyond transient request handling.
- No exact peer coordinate/bearing/meters/cell ID/last-seen in client DTO.
- Mutual effective-active predicate is evaluated from current primary state.
- Block/ineligible/off/expired/revoked users are filtered before cohort/cap.
- No fake dots below sparse threshold.
- Presence expiry is enforced on read/commands; worker outage cannot extend visibility.
- Radar never creates Game/Participation or bypasses GameManager/capacity.
- Established DM/invite survives later Radar stop.
- Feature/config default remains off until a separate rollout admission.

## Scheduling rule

R1 is intentionally placed as soon as its real prerequisites are accepted, before DM, because presence/matching does not require contact APIs. R2 is delayed until DM + invitations exist. This shortens the Radar critical path without creating an overlapping backend writer.

No later slice may leapfrog a failed/blocked prerequisite on the same dependency chain. No automatic deploy follows from merge.
