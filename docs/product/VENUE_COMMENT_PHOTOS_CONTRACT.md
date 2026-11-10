# #507 I2a / I2b — venue comment photos contract

Historical I2a source record below, based on accepted DEV76 `dd5b2c1496af57ca168d171decb384d2ecfec5c1`.
Retained architecture SHA-256 `e36606544061503feda403c7f471e527ff201069574265858793b97eaa0c0107`,
slices `f27414fc3556ef3f60899bc7b84ade9cb4349a23e702713cf6db2db499fc6335`,
exact seam `9c415153006725e594472bc27c38d77aeb56cce94fb020c8048aac05ce771c54`,
remaining scope `b275d345c004d73f57382882d90859e62c1714e57bfbbc50d69e8d1e0238bc6f`.
No DEV acceptance, independent QA, CI or Owner UAT is asserted by this document.

## Private operations

All paths below have the existing `/v1` prefix. All responses use `Cache-Control: no-store`.

| Method/path | Admission and result |
| --- | --- |
| POST `/venues/:venueId/comment-photos` | Active cookie session, Origin/CSRF, Idempotency-Key (16–128 characters), raw JPEG/PNG/WebP and exact `X-Photo-Rights: community-photo-rights-v1`. Returns 201 owned ready receipt. |
| GET `/me/venue-photo-submissions/:photoId` | Current authenticated owner, active account, current capability, canonical venue and unexpired ready submission. |
| GET `/me/venue-photo-submissions/:photoId/content` | Same current checks plus exact stored byte SHA and approval fingerprint, then sanitized PNG. No guest route. |
| DELETE `/me/venue-photo-submissions/:photoId` | Active cookie mutation, Origin/CSRF, Idempotency-Key, `X-Photo-Version: 1` and required JSON `{"expectedVersion":1}`. Atomic withdrawal returns version 2 with null preview. |

Withdrawal is a strict JSON command: `expectedVersion` is the only property and must be
the number `1`, matching the still-required exact `X-Photo-Version: 1` header. Missing,
malformed, non-object, extra-field, wrong-type or disagreeing bodies return 400 before
any withdrawal receipt is reserved or photo state changes, including on replay.
Missing/invalid headers retain `VERSION_REQUIRED`; invalid command bodies use
`INVALID_PHOTO_COMMAND` (malformed JSON is rejected by the HTTP parser).
The durable request hash remains the photo ID and validated expected version; valid
same-key retries still replay the owned withdrawn receipt.

Rights v1 means: I own this photo or have publication rights, and have permission from recognizable people to publish it. EXIF/geotags are removed. No face recognition, identity tagging, precise-location or presence verification is performed. This declaration is a bounded user action, not a claim that the service has verified legal ownership.

Receipts expose only ID, canonical venue ID, ready/withdrawn status, version, expiry,
dimensions and an **authenticated private** preview path. They never expose storage keys,
original bytes, provider scores or public gallery/media URLs. Foreign, stale, withdrawn,
expired, merged-away or retired resources return `PHOTO_SUBMISSION_UNAVAILABLE` on reads.
Successful upload replay also reauthorizes current ownership and state. DELETE replay
reauthorizes the owned withdrawn row. Withdrawal works after expiry or venue change and
without a provider or `profile.public` permission; active-account/session and account.access
fences remain. Existing error shape is preserved. Conditional headers cannot return a 304
without authorization: this foundation deliberately always returns an authorized PNG 200.

## Byte pipeline, concurrency and retention

The existing sanitizer accepts at most 5 MiB, 16 MP, 8192 pixels per side, one frame,
strict JPEG/PNG/WebP containers and no trailing container bytes. The new preset autorotates,
strips metadata, preserves the complete frame and never enlarges it. The finite PNG reduction
ladder is 1600 → 1200 → 960 → 768, stopping at the first derivative at most 2 MiB.
Avatar/cover crop transforms, old fingerprint strings and image policy remain unchanged.

`community_photo_image` uses policy `community-photo-image-v1:inside1600-ladder-v1` and a
separate fingerprint/cache identity. Existing provider/model/categories and actual attempt
budgets apply. Actual staged sanitized bytes are classified outside DB locks. Final admission
reuses MutationRunner with actor/session, capability, shared catalog, canonical venue,
capacity, journal and exact staged-byte approval checks. Canonical changes during preparation
fail closed. There are at most eight nonexpired ready submissions per owner; final checks
are serialized by the existing actor lock. The local preparation limit is two; clients also
send at most two uploads concurrently.

Exact request hashes include raw image SHA, requested venue, rights, MIME, preset and policy.
Existing durable processing/UNKNOWN reservations are never reclaimed or blindly reclassified.
Known image rejects are sealed as actual completed 422 receipts using the same runner.
Attempts and rate budgets are retained. Other errors retain the existing runner's retry and
reconciliation semantics; no new ledger or retry engine exists.

AvatarService stages journal-before-write, fsyncs, and verifies exact bytes under its existing
journal lock. A ready submission expires one hour after admission. Its journal row remains
discoverable and protects nonexpired ready references in the existing startup/60-second GC.
Expiry/withdrawal removes read authority immediately; GC can then collect bytes. Immutable
history does not pin expired bytes. Abandoned uncommitted stages expire after one hour;
known failed/rejected stages are released sooner. Unknown commit cleanup remains safe
because GC rechecks live references. No new timer, store or service is introduced.

0069 is additive: private submissions and dedicated approval surface only. SQL guards keep
admission facts immutable, permit only ready → withdrawn/version 1 → 2, and require a real
allow approval for the dedicated policy. Rollback journals every stage before dropping the
private submission table and guard function. It retains paid community approval rows and
their identities, plus the backward-compatible additive `community_photo_image` surface
allowance. Reapplying 0069 reuses a still-valid M1 approval for identical sanitized bytes and
policy without another provider call. Attempts, UNKNOWN reservations, budgets and cost
history are retained; no archive table or system is introduced. It does not modify 0051.
GC tolerates the absent additive table on N-1/rollback schemas.

## Historical I2a boundary and checks

At the I2a boundary, I2b still had to add atomic exact-comment-revision bindings, max four photos/text-or-photos rules,
current public-read/privacy/revocation checks, reporting and paginated community gallery.
I2c must implement the retained composer/viewer UX inside existing R3.1 sheet semantics.
I3 must implement optional creator candidate admission and genuine privileged official-gallery
acceptance. None of those outcomes is enabled by I2a. Existing comments remain text-only;
moderation/reporting and official media remain in their existing ownership paths.

Targeted tests accompany the sanitizer, M1 isolation/failure and guarded disposable API/GC/
rollback paths. The disposable suite requires `NODE_ENV=test`, `RUN_DB_INTEGRATION=1`, and
an explicit loopback database with an empty application schema. Local runs require the
dedicated name `gobadminton_comment_photos_disposable`. The adjacent venue-reviews guard's
hosted disposable exception permits `/gobadminton` only when `GITHUB_ACTIONS=true`,
`GMAP1_DISPOSABLE_DB=1`, `PG_CONTAINER` matches `^gb-ci-\d+-\d+-\d+$`, and the URL port
matches `CI_DB_PORT`; the test/loopback/protocol/no-query/no-fragment checks still apply.
Local/VPS runs must use the dedicated name without pretending to be hosted CI. Restrictions
remain enabled with local Admin simulation, isolated `http://localhost:18995` Admin origin
and a dedicated synthetic Admin pepper. It never falls back to a configured DEV/PROD database.
No Admin login, seed command or real account is used.

## Actual changed files

- `apps/api/src/profiles/avatar-image.ts`
- `apps/api/src/profiles/avatar-http.ts`
- `apps/api/src/profiles/avatar.service.ts`
- `apps/api/src/moderation/moderation.service.ts`
- `apps/api/src/comments/comment-photos.ts`
- `apps/api/src/comments/comments.module.ts`
- `apps/api/src/database/schema.ts`
- `apps/api/migrations/0069_venue_comment_photo_submissions.sql`
- `apps/api/migrations/rollback/0069_venue_comment_photo_submissions.sql`
- `packages/contracts/openapi.json`
- `apps/api/test/unit/avatar-image.test.ts`
- `apps/api/test/unit/moderation.test.ts`
- `apps/api/test/integration/comment-photos.disposable.test.ts`
- `docs/product/VENUE_COMMENT_PHOTOS_CONTRACT.md`

## Historical I2a author verification in the restricted export

Actual PASS: existing friendship/game/unified generators in verification mode (outputs unchanged),
existing Admin protocol checker (53 operations), JSON local-reference/private cookie-security
checks (1884 refs), and native Node TypeScript syntax parsing of the ten changed TS files.
These checks do not substitute for TypeScript typechecking, tests or independent QA.

Actual dependency blocks: `node packages/contracts/scripts/check-openapi.mjs` cannot load
`@apidevtools/swagger-parser`. API typecheck, lint, targeted unit and disposable integration
commands cannot start because the pinned pnpm is absent from Corepack and node_modules is
absent. The first pnpm invocation attempted Corepack's automatic download and failed DNS;
subsequent package commands explicitly disabled Corepack network. No package was installed.
No DB was opened and no migration/GC test was executed. Root must run those checks in the
qualified dependency/disposable environment before QA/CI/DEV gates. This export has no Git
operations, deployment, credentials, live-runtime edits or UAT evidence.

## I2b continuation candidate — #507, attempt 2

This section supersedes the historical I2a-only boundary above. The admitted source
continues preserved WIP `fd305f11e68a25c2672ab30de9a6e928d77a8797` on accepted DEV77
`65c7e59212eab0de2a9ecd50c36ed1c1e7854ad9`. It does not establish QA, CI, DEV acceptance,
Owner UAT or completion of #507. The prior timed-out attempt and unfinished-cost UNKNOWN
remain historical facts; no provider/cost reconciliation or paid execution is asserted here.
OpenAPI `info.version=0.42.0` is the API contract version, not an application/release number.

### Atomic publication

POST `/venues/:venueId/comments` accepts optional `text`, ordered `photoIds` and
`parentCommentId`. PUT `/comments/:commentId` requires `expectedVersion`; for venue
comments omitted `photoIds` retain the current set and `[]` removes it. Omitted, null
or blank text clears text. Nonempty text is trimmed and limited to 1000 Unicode code
points. The resulting comment must contain text or one to four unique photos.
Photo-only create/edit needs no invented empty text approval. Text, when present,
still uses actual server text moderation and public masking. Game POST/PUT retain
their strict text-required shapes and reject `photoIds`.

Both commands retain cookie session, Origin, CSRF and Idempotency-Key requirements.
Legacy text-only normalized hashes and successful receipts remain compatible. The existing
MutationRunner reserves before external preparation; same-key processing/UNKNOWN is not
replayed into a provider call. Current actor/session, ownership, canonical parent,
expected version, exact staged bytes, approval and GC journal are checked before commit.
Reject, unavailable provider and failed CAS leave the previous body and photos together.
Publication reuses the existing exact-byte community image approval without another image
classification. No new service, storage root, scheduler, worker or cost ledger is added.

A new photo must be owned, ready, version 1, approved under the community policy,
unexpired and staged for the current canonical venue. Only IDs retained from this same
comment's immediately current revision may cross staging expiry. A removed ID cannot be
reattached later; an ID cannot migrate to another comment, owner or physical venue.
Published submissions cannot use private-stage DELETE; remove them through source
comment edit/delete. Private preview authority still expires at its original TTL.

Migration `0070` adds immutable origin and ordered exact-revision attachment tables.
Deferred SQL checks reject empty/whitespace-only live content, game attachments, mismatched
current body/revision, invalid ordering and attachments on tombstones. Historical revisions,
origins, approvals and attempts are retained. Delete advances the version and leaves a null
body and no current photos. Withhold/restore copies the same ordered IDs into a new staff
revision; author edits never clear withholding. The rollback deliberately raises instead of
silently discarding published UGC/history. Roll application traffic back with writes disabled
and retain the additive schema; this is not permission to run the old writer against photo-only data.

### Public reads, gallery and historical Cases evidence

- GET `/comments/:commentId` provides the currently permitted source for gallery attribution.
- GET/HEAD `/comments/:commentId/revisions/:version/photos/:photoId` requires that exact
  current revision and attachment, a live clear comment, active unrestricted author,
  readable canonical venue and no bilateral viewer block. Edit/removal, delete,
  withholding and current rights changes revoke old URLs. Authorized responses are
  full-frame sanitized PNG with `no-store` and `nosniff`; conditional headers never
  bypass authorization or produce an unauthorized 304. There is no avatar alias.
- GET `/venues/:venueId/community-photos` returns 24 items plus `nextCursor`, newest first
  by immutable first publication timestamp and photo ID. Each item identifies its source
  comment, parent comment, current resource version and source path. Each page applies
  current read authority. The opaque cursor binds canonical ID and all family catalog
  versions; merge/retire/restore changes return `409 VENUE_CANONICAL_CHANGED` with reset
  information. Invalid cursors return `400 COMMENT_CURSOR_INVALID`. Paging is a current
  projection, not a frozen snapshot; clients deduplicate IDs across pages.

Reports bind the exact revision body and ordered photo IDs, approval IDs, content
fingerprints and byte SHA values using the dedicated v2 HMAC. Text-only HMAC identities
remain v1-compatible, including an empty photos array. Client fingerprints are not trusted.

The existing GET `/admin/cases/:id/community-reports/:reportId` returns exact reported
metadata and ordered historical photo references. Its optional `photoId` query returns
that attachment's sanitized PNG through the same route. Every request requires current
linked case assignment, `evidence.assigned.read`, independent human reviewer, fresh step-up
and the existing internal Admin gate; consumer sessions and unassigned staff have no grant.
The read is audited with IDs/versions only. Historical evidence never substitutes a newer
authored revision. Staff withhold/restore lineage may remain actionable only when the body
and ordered evidence are unchanged; any intervening authored edit makes the old report
non-actionable. Public withholding revokes all photos while assigned historical evidence
remains private. Missing collected/corrupt bytes fail closed, never fall back to raw keys.

The existing AvatarService GC protects current comment references (including withheld
content needed for restore) and exact reported historical references, as well as unexpired
private stages and existing avatar/cover/gallery references. Other obsolete or abandoned
bytes can be collected; immutable metadata does not imply all historical bytes are retained.
No UI/composer/viewer or I3 official-gallery admission is included.

### Verification and concrete remaining blockers

The continuation uses local deterministic syntax/contract/policy checks only. Full pinned
TypeScript, ESLint, OpenAPI parser, Vitest policy units, owned PostGIS publication/Cases and
legacy photo suites, separate migration smoke, independent QA and release gates remain for
the parent. Disposable suites retain their explicit test/loopback/empty-schema guard before
Pool construction and the narrowly accepted hosted CI exception. Run with both default and
JSON reporters; a skipped DB suite is not a PASS.

The known obsolete I2a photo-only prohibition is replaced with an ownership-negative POST:
a foreign actor cannot attach the owner's stage, and the owner can still read it afterward.
All other assertions in that foundation test are preserved.

There is one additional concrete compatibility blocker: the old I2a suite applies all
migrations and its final test directly rolls back `0069`. After `0070`, the retained
`entity_comment_photo_origins.photo_id` FK prevents dropping `venue_photo_submissions`.
That old test must be exercised on its original `0069` schema in the separate migration
smoke, or receive a bounded fixture update. This continuation does not remove the FK,
rewrite `0069`, alter those other legacy assertions or claim that the legacy suite passes.

The restricted export also omits root/web `AGENTS.md`: full Foundation static validation
reports the missing required root file and twelve local links to those omitted files.
The unchanged full Foundation unit suite consequently fails its documentation-inventory
assertion (9 tests pass, 1 fails). Contract/local-reference/business-command rules are
checked separately without waiving any finding. No missing instruction file is invented.
No dependency installation, live database, deployment or independent QA is performed here.

Actual continuation results in this export:

- PASS: native Node 24 TypeScript syntax parsing of all 25 admitted TS paths (not typechecking).
- PASS: Foundation contract/local-ref/security/command rules, 262 operations, zero findings;
  scoped contract documentation local-link check also passes.
- PASS: existing Admin protocol checker, unchanged 53-operation inventory; game, friendship
  and unified generators in verification mode (no generated files written).
- PASS: 13 direct native helper assertions for photo-only source availability, legacy HMAC
  compatibility and ordered exact photo evidence. The report helper harness replaces only
  its unused Nest exception import; this does not execute Vitest or transport/DB behavior.
- PASS: existing dependency-free email contract policy test (one test).
- FAIL: full Foundation static/unit documentation inventory because the export omits the
  instruction files listed above. No contract rule/checker was exempted or modified.
- BLOCKED: full OpenAPI checker cannot import `@apidevtools/swagger-parser` (no node_modules).
  Pinned TSC, lint and Vitest were not run; dependencies were not installed. SQL, actual
  media GET/HEAD/revocation, transaction/CAS/UNKNOWN races, GC, migrations/rollback and
  disposable integration fixtures remain unexecuted here. The legacy rollback conflict
  above is identified from source, not presented as an observed DB test result.

Process deviation: the initial full Foundation unit command invoked the checker's existing
`git ls-files` discovery internally before its filesystem fallback. This was a read-only
attempt, contrary to the no-Git constraint; it was not repeated. Subsequent Foundation
checks called its rule functions with filesystem enumeration and did not invoke Git.
No Git mutation, network call, install or database connection was performed.
