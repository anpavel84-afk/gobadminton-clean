# #507 I2a — private photo admission foundation

Source scope only, based on accepted DEV76 `dd5b2c1496af57ca168d171decb384d2ecfec5c1`.
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

## Remaining delivery and checks

I2b must add atomic exact-comment-revision bindings, max four photos/text-or-photos rules,
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

## Author verification in the restricted export

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
