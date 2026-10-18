# Architecture Decision Records

Technical decisions are made in the delegated OD-006 area and do not imply product/release acceptance.

| ADR | Decision |
|---|---|
| [0001](ADR-0001-INDEPENDENT-PROJECT.md) | Independent GoBadminton project |
| [0002](ADR-0002-MONOREPO-MODULAR-BACKEND.md) | Monorepo + modular backend |
| [0003](ADR-0003-WEB-AND-NATIVE-CLIENTS.md) | Next.js web + RN/Expo mobile |
| [0004](ADR-0004-POSTGRES-GEO-TRANSACTIONS.md) | PostgreSQL/PostGIS |
| [0005](ADR-0005-PROVIDER-INDEPENDENT-IDENTITY.md) | Provider-independent identity |
| [0006](ADR-0006-REGIONS-AND-OPERATIONS.md) | Region/operations gates |
| [0007](ADR-0007-PAYMENTS-BOUNDARY.md) | No internal payments in MVP |
| [0008](ADR-0008-CONTRACTS-AND-COMPATIBILITY.md) | Schema-first REST/OpenAPI |
| [0009](ADR-0009-STABLE-API-DOMAIN.md) | Stable API DNS independent of host |
| [0010](ADR-0010-SPLIT-MVP-HOSTING.md) | Moscow web + Germany API/DB, direct HTTPS with tunnel fallback |

| [0011](ADR-0011-UNIFIED-PLAYERS-RADAR.md) | Unified Players Radar source candidate; deferred revision fence and additive v2 consent/model, pending independent QA/source acceptance |

| [0012](ADR-0012-GAME-CONTACT-CREATOR-SEAT.md) | FB01 private contact default and real regular-draft creator seat; source candidate pending independent QA |

| [0013](ADR-0013-FOREGROUND-MESSAGING-UPDATES.md) | FB01 foreground REST coordinator and private contact resolver; new M15 repair candidate pending independent implementation QA |
| [0015](ADR-0015-EMAIL-AUTH-INTERNAL-FOUNDATION.md) | Internal-only verified email code foundation and fake delivery |

Template: Context → Options → Decision → Consequences → Verification → Supersession.
- [ADR-0016 — bounded email method replacement proof](ADR-0016-EMAIL-METHOD-CHANGE-PROOF.md) — internally admitted E2/E3 source candidate, no release.

- [Owner post-game model v001](OWNER_DECISION_POST_GAME_MODEL_V001.md) — OWNER_CONFIRMED, не runtime acceptance.
- [ADR-0018 — post-game outcomes, attendance and feedback](ADR-0018-POST-GAME-OUTCOMES-FEEDBACK.md) — TECH_SELECTED, implementation pending; [единый пакет](../architecture/POST_GAME_V001.md).
