# ADR и Owner decisions — полный указатель

Общий вход — [START_HERE.md](../../START_HERE.md); организация разработки — [единый канон](../rules/ENGINEERING_OPERATING_MODEL.md). Здесь перечислены scoped решения, а не повторно утверждённые права. Статус внутри каждого документа (accepted/source candidate/draft) и exact поздние Owner-решения сохраняются. Номер файла или наличие в Git не доказывают runtime приёмку.

## Архитектурные решения

| ADR | Предмет |
|---|---|
| [0001](ADR-0001-INDEPENDENT-PROJECT.md) | Самостоятельный GoBadminton |
| [0002](ADR-0002-MONOREPO-MODULAR-BACKEND.md) | Monorepo / модульный backend |
| [0003](ADR-0003-WEB-AND-NATIVE-CLIENTS.md) | Web и native clients |
| [0004](ADR-0004-POSTGRES-GEO-TRANSACTIONS.md) | PostgreSQL/PostGIS и транзакции |
| [0005](ADR-0005-PROVIDER-INDEPENDENT-IDENTITY.md) | Identity независимо от поставщика |
| [0006](ADR-0006-REGIONS-AND-OPERATIONS.md) | Регионы и эксплуатация |
| [0007](ADR-0007-PAYMENTS-BOUNDARY.md) | Платежи — отдельный будущий scope |
| [0008](ADR-0008-CONTRACTS-AND-COMPATIBILITY.md) | API compatibility |
| [0009](ADR-0009-STABLE-API-DOMAIN.md) | Стабильный API domain |
| [0010](ADR-0010-SPLIT-MVP-HOSTING.md) | Split-host topology; более поздний транспорт — XHTTP V003 ниже |
| [0011](ADR-0011-UNIFIED-PLAYERS-RADAR.md) | Unified Players Radar source candidate |
| [0012](ADR-0012-GAME-CONTACT-CREATOR-SEAT.md) | Private contact / creator seat |
| [0013](ADR-0013-FOREGROUND-MESSAGING-UPDATES.md) | Messaging / contact resolver |
| [0014](ADR-0014-PRIVATE-DISCOVERY-CITY.md) | Private discovery city |
| [0015](ADR-0015-EMAIL-AUTH-INTERNAL-FOUNDATION.md) | Internal-only email foundation |
| [0016](ADR-0016-EMAIL-METHOD-CHANGE-PROOF.md) | Email method replacement proof |
| [0017](ADR-0017-P4-ADMIN-VENUE-COMPOSITION.md) | Admin / Venue composition |

## UI и продуктовые решения

[Frontend Hold](OWNER_DECISION_FRONTEND_HOLD_V001.md) и [Canonical Frontend Rebase](OWNER_DECISION_CANONICAL_FRONTEND_REBASE_V001.md) — исходная область 04.10; последующий exact Owner admission может снять hold только для своей области. [Style Guide first](OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md) остаётся визуальным источником, пока не задан применимый override. [Visual Review Nonblocking](OWNER_DECISION_VISUAL_REVIEW_NONBLOCKING_V001.md) не отменяет QA изменённого UI.

[Game discovery/create defaults](OWNER_DECISION_GAMES_DISCOVERY_CREATE_DEFAULTS_V001.md) · [Games/Venues map](OWNER_DECISION_GAMES_VENUES_MAP_V001.md) · [Map popups](OWNER_DECISION_MAP_POPUPS_V001.md) · [B preview contact route](OWNER_DECISION_B_PREVIEW_CANONICAL_FIRST_CONTACT_ROUTE_V001.md).

[Radar visibility](OWNER_DECISION_RADAR_GEOGRAPHIC_VISIBILITY_V001.md) · [Radar MapLibre/OSM](OWNER_DECISION_RADAR_MAPLIBRE_OSM_V001.md) · [Radar toggle/directory/map](OWNER_DECISION_RADAR_TOGGLE_DIRECTORY_MAP_V001.md) · [Geographic G1 contract freeze](RADAR_GEOGRAPHIC_G1_CONTRACT_FREEZE_V002.md).

[Public content moderation](OWNER_DECISION_PUBLIC_CONTENT_MODERATION_MVP_V001.md) · [PWA/Web Push](OWNER_DECISION_PWA_WEB_PUSH_MESSAGING_V001.md) · [Guest-first demo](OWNER_DECISION_GUEST_FIRST_DEMO_AUTH_V001.md) · [Google/dev auth direction](OWNER_DIRECTION_GOOGLE_DEV_AUTH_V001.md). Direction/future scope не означает включённую функцию или разрешение public launch.

## Транспорт и эксплуатация

[Transport V001](OWNER_DECISION_INTERSERVER_SECURE_TRANSPORT_V001.md) → [V002](OWNER_DECISION_INTERSERVER_SECURE_TRANSPORT_V002.md) → **[XHTTP cutover V003](OWNER_DECISION_INTERSERVER_XHTTP_CUTOVER_V003.md)**. V003 явно supersedes выбор транспорта/избыточные сравнения в своей области, сохраняя исходные safeguards и неприкосновенность стороннего VPN. Это не новая команда выполнить прежний cutover.

[DEV-first / PROD promotion](OWNER_DIRECTION_DEV_FIRST_PREVIEW_AND_PROD_PROMOTION_20261010_V001.md) · [Delta-based verification](OWNER_DECISION_DELTA_BASED_VERIFICATION_V001.md) · [O03 live OAuth](OWNER_DECISION_O03_LIVE_OAUTH_V001.md) · [O03 same-origin callback](OWNER_DECISION_O03_SAME_ORIGIN_BROWSER_CALLBACK_V001.md) · [O01/O02 internal MVP disposition](OWNER_DECISION_O01_O02_DEFERRED_INTERNAL_MVP_V001.md).

## Исторические ограниченные полномочия

[Continuous trains 09.10](OWNER_CONTINUOUS_PRODUCT_TRAINS_20261009_V001.md), [backlog decision 10.10](OWNER_PRODUCT_BACKLOG_SOURCE_OF_TRUTH_20261010_V001.md) и [skip monitor re-QA / A64](OWNER_DECISION_SKIP_MONITOR_REQA_DEPLOY_A64_V001.md) сохраняют исходную дату/scope. Не переносить старый Runner, max5 или отдельный waiver на сегодняшнюю задачу. Текущие delegation/attempts — §6 канона; новый product admission не возникает из такой исторической ссылки.

Технический ADR: Context → Options → Decision → Consequences → Verification → Supersession. Предметные решения не меняют права PMA/author/QA; [DOCUMENT_REGISTER](../rules/DOCUMENT_REGISTER.md) показывает, какие указания заменены, а какие остаются scoped.
