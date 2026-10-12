# P4 internal Admin/Venues API

SOURCE_ONLY candidate; not deployed or independently accepted. Exact base and admission are recorded in ADR-0017.

OpenAPI `servers` already includes `/v1`; Admin paths are `/admin/*`. All existing consumer paths/schemas remain intact. Separate Admin host cookie, exact Origin, current database roles, WebAuthn, CSRF, expected versions, reason code, idempotency and no-store apply. Admin is local/test-only and disabled by default. No consumer bearer/cookie fallback.

Venue endpoints under `/v1/admin/venues`: bounded list/create; `/{id}` detail/history; `/{id}/games`; `/{id}/commands` (`edit`, `verify`, `retire`, `restore`, `merge`); `/duplicates` queue; `/duplicates/{id}/dismiss`. Content Manager/Superadmin only. All writes require fresh step-up. Command replay rechecks current authority. Merge requires both source and final target versions. Conflicts return409 and require reload/new confirmation. Edit collision returns `reviewRequired:true` with unchanged Venue/version and commits an audited duplicate candidate. Historical aliases remain resolvable and proposals using old keys reuse the canonical row. Different explicit hall/unit discriminators cannot merge. Restore returns a retired Venue to unverified review.

Current Game list/map use the same moderation projection. Game force-cancel invokes Sessions cancellation; restoration never resurrects a cancelled game. User restriction commands retain capability-specific expiry/reversal and separate deliberate session revocation. Unified/geographic Radar proof paths recheck relevant restrictions; no broad ban flag is added.

Cases and minimal evidence preserve current assignment/role checks on reads and idempotent replay. Policy is disabled unless explicitly synthetic; purge always denied. No global chat browse/export, raw code/token/contact/GPS evidence, real staff privileges, real SMTP or production effects.

The private dependency supplement is cache evidence only. No executor dependency install or future frozen-install claim. Full author checks and independent QA disposition belong to the exact candidate handoff.
