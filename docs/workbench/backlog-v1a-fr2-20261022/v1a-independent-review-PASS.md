VERDICT: PASS

Independent exact-definition review of V1a / Issue #170, 2026-10-22. This reviewer did not prepare the body. Authority/effect ceiling: `/var/lib/gb-next170-20261022/review-scope.json`; read-only definition review only.

Reviewed body: `/var/lib/gb-next170-20261022/body-final.txt`
bodySHA256: `a3244e1db1efdfd38c6fe922461c43063b60084bd11ee2e5454ab3782f6e2324`
sourceSHA: `865d02c7ea39ae8210172629c3cb8e20c8fa52a8`
Source: supplied read-only snapshot `/var/lib/gb-next170-20261022/source`. The snapshot has no `.git`; sourceSHA is its explicit scope identity, not a locally verified Git HEAD. Body hash was independently computed and matches scope. Prep notes were not used as evidence.

Blocking findings: none. Minimal correction: none.

Definition feasibility and privacy findings:

- The body and scope have identical 13-path inventories and eight criteria. All eight declared existing files exist; the five declared new files are absent. Model, existing edit DTO/service, public/admin projections, OpenAPI, authored tests, migration smoke and documentation are covered together. Nullable bounded integer/boolean facts and server-owned date/gallery can be implemented within these paths.
- Actual migration runner discovers sorted SQL and records each migration transactionally. The existing smoke test explicitly ends its ledger at 0038; D5 correctly requires its update and physical-column assertions. Migration 0037 has the BEFORE UPDATE trigger `venue_cover_credit_reset`. To meet the defined comparison of actual stored values, the new timestamp trigger must run after that reset and compare final NEW values; this is feasible entirely in new migration 0039. Existing rows need no backfill. Cover bindings/credit are venue columns, so media-service edits are unnecessary.
- Public catalog, detail/alias, fuzzy and proposal RETURNING paths are in `venues.service.ts`; admin reads/receipts share the mapper in `admin-venues.service.ts`. Existing per-key JSON extraction supports absent public columns on schema 0037. The new fields can use the same pattern. Private game-contact access remains outside this slice; no public mapping needs private booking fields or private timestamps.
- `venue_cover_url` already enforces lifecycle, active actor and allowed cover moderation. Combining that result with photo-only credit and fail-closed HTTPS attribution permits the defined single-cover gallery. Full gallery, ratings and factual population are explicitly residual. Timestamp semantics accurately exclude dynamic visibility changes outside the venue row.
- `AdminService.privilegedCommand` checks current cookie/Origin/CSRF/role/step-up before receipt replay, and supplies the transactional boundary. Existing catalog locks/version/collision/audit/history/outbox can remain intact. Existing offline contact fakes pin the admin SELECT prefix and public-contact parameters $13/$14; adding a cover projection after `v.*` and appending profile bindings can preserve those assertions. No additional mandatory test-path expansion was identified.
- Offline typed service tests and actual OpenAPI validation are feasible using existing Vitest, pg types, AJV 2020 and ajv-formats. Inspection and a small reference-closure calculation confirm full Venue/AdminVenue/AdminVenueCommand are outside all three generator closures; the Game closure includes VenueSummary, which remains unchanged. AdminVenue.cityName is emitted today and absent from its closed OpenAPI schema; D6 explicitly covers the correction.

Checks performed: read-only source/rules/test/hook inspection; SHA256, JSON parsing, exact path inventory/count and generator reference-closure calculation. No full tests, SQL, DB, runtime, network, dependency installation, models, GitHub calls or source/body/scope edits. Required DB/restore/old-image/DEV gates remain hosted-CI/integrator work; authored tests are not execution evidence.

The acknowledged Issue #149 OpenAPI/schema-contracts occupancy remains a scheduling wait. It is not a definition defect and this PASS does not release its lock. This verdict grants no implementation/runtime admission and establishes no source QA, release, deployment or Owner acceptance. Integrator owns durable GitHub publication of this review under the supplied effect ceiling.
