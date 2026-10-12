# ADR-0012 — private game contact template and initial creator seat

Status: READY_FOR_REVIEW implementation source candidate, 2026-10-08. Technical contract independently reviewed PASS_WITH_NONBLOCKING_GAPS at [a6181712](https://github.com/anpavel84-afk/gobadminton/blob/a618171206542aad02402375cc7cfe8addcc7649/docs/handoffs/2026-10-08_qa_to_pm_fb01-review-game-v001.md); code acceptance remains independent QA. Authority: bounded FB01 013/014 assignment, no deploy authority.

Context: per-game explicit public contact needs an own private reusable default. Management authority does not itself occupy capacity; Owner requires a real creator seat at regular-game creation.

Decision: Profiles owns empty additive user_game_preferences with optimistic version and explicit atomic create-save. Sessions initializes one confirmed creator Participation in a new regular draft after Game/owner insertion, with transition and sanitized origin-marked outbox evidence. This narrowly extends INV-06; public confirmation remains published-only. Actor/session → Game → manager → Participation → preference ordering retains all effects under one commit. Preference-only writes do not acquire Game. Identity deletion_pending trigger clears the default and advances its version; no product deletion endpoint is introduced.

Alternatives: UI-only occupancy, phantom organizer count and external-seat substitution lose identity or violate capacity. Publish initialization leaves draft counters wrong. Automatic provider prefill or unconditional save loses privacy/user intent and concurrency protection.

Consequences: old create clients omit save and remain compatible, but all newly created regular games receive the real seat. Counts always come from actual rows. Full-game creator request returns existing participation after lifecycle/version checks. Withdraw/remove/cancel release that actual seat without changing manager authority; publish never reinitializes. Trainer-led and all historical games remain unchanged. Draft initialization never creates room membership or delivery jobs; legacy outbox is evidence only. Future consumers must fence draft/self delivery.

Recovery: revert candidate source for application rollback; retain additive table and newly created rows. No destructive down migration or historical repair. Independent source QA and explicit PM runtime admission are separate gates.

Verification: real disposable PostgreSQL/PostGIS HTTP/auth, races, rollback/replay, deletion clear, capacity/lifecycle, fresh/upgrade/replay migrations; producer handoff records exact executed evidence. Frontend is excluded.

Supersession: extends ADR-0004/0008 and narrows INV-06 only for regular draft initialization. Implements reviewed [contract](https://github.com/anpavel84-afk/gobadminton/blob/033869eb16bb12705c566f77c437782f56421458/docs/workbench/architecture/fb01-review-game-v001/CONTRACT.md).
