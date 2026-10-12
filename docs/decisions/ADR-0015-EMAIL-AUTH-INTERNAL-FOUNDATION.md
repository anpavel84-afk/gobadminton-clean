# Email E1 backend decision v001

Status: TECH_SELECTED for internally admitted E1 source, READY_FOR_REVIEW candidate; no public activation. Date: 2026-10-08.

Authority: exact PM admission at 33e6c5e39ecd3fb5136b8b9e5ff7ca51d7c182ab; full architecture package at dba12af8033dc686b1d27790b97c6ba75a53128b; internal train at 95077d80587014f876b61eaa7f48e20ebd0b95d4. The later internal admission supersedes historical architecture NOT_ADMITTED labels only for internal source/testing.

## Decision

Separate verified email credentials and purpose-bound 8-digit codes, with normalized unique active mailbox/User indexes, preserve provider-independent User identity. OAuth metadata is never an email credential or merge key. Existing consumer session issuance accepts the current DB transaction so User/credential/session/challenge consumption commit together. Authenticated links require exact active consumer session, CSRF and authenticated_at freshness of 15 minutes. OAuth last-method guard counts OAuth + active email under a User fence; OAuth link callback also fences its exact session and recent authentication.

Email ownership advisory fence precedes User/session and challenge locks. Same-mailbox concurrent signup resolves a single owner before inserting; unique indexes remain final database safety. Wrong code attempts and terminal challenge transitions commit before the HTTP error. Cumulative attempt count does not reset on resend. A new issue under the same email/purpose/browser or session/origin supersedes the old challenge; a 60s issue/resend cooldown and shared DB HMAC email/IP/global windows limit floods. New issue after terminal challenge still consumes shared issuance budgets.

Existing pg-boss instance/schema carries same-TX auth.email.delivery jobs with only challengeId/generation. A delivery advisory lease serializes workers without holding a DB transaction across a transport call. Completion fences current generation/state; stale deliveries may arrive after resend but cannot authenticate. Bounded retries keep the same code; terminal/success/expiry wipes ciphertext. Worker sweeps expired secrets and metadata. Correctness independently checks database expiry even if worker is unavailable.

Three dedicated distinct secrets separate verifier/binding HMAC, encrypted transient code and rate-key HMAC from sessions/OAuth. FakeMailTransport is an internal deterministic memory mailbox, with no HTTP mailbox or test-login endpoint. Config requires local NODE_ENV=test, loopback API/web origins and bind host. Default email availability is false. E1 contains no real mail adapter/configuration.

## Compatibility and consequences

GET auth/providers and me/linked-providers remain unchanged compatibility projections. New auth/methods and me/auth-methods provide unified discovery/inventory. Additive 0025 migration backfills authenticated_at from created_at; no applied migration is edited. E1 does not expose email change/unlink or native/Admin auth. E2/E3 will add bounded sensitive method changes and independently test the unified guard; no authority to bypass proof follows.

Single supported active email per User means explicit replacement needs the later change protocol. Unlinked OAuth users may create a second User via email even if OAuth metadata matches: intentional absence of automatic merging. Linked credential count is based on supported stored credentials, consistent with historical OAuth last-method behavior; provider configuration availability is separately advertised.

Rollback older backend ignores additive tables. Keep email disabled on old backend and preserve credential rows; source rollback is branch/candidate rollback, not table deletion. Real SMTP, legal/privacy/retention, sender/domain and live release remain separately gated. Fake evidence proves internal code only.

## Options, verification and supersession

Password and magic link alternatives were evaluated in the exact architecture package; neither is introduced by E1. Reusing OAuth's provider enum for email was rejected because mailbox proof and external issuer/subject authority differ. A second mail queue stack was rejected in favor of existing pg-boss. This decision changes OD-005 only within the already admitted email consumer family, and leaves deployment/real data gates in place.

Author evidence and exact independent review entry point are indexed by docs/workbench/implementation/email-auth-e1-backend-foundation-v001 and the implementation handoff. Tests are producer self-checks, not acceptance. No prior applied schema/ADR is rewritten.

A separate shared `send_hour` cost fence counts actual transport invocations, including
retries. Hourly budget exhaustion becomes a safe terminal delivery failure without a send;
issuance counters alone do not control retry costs. No network is performed in the budget write.

P3 composition 2026-10-10: reviewed historical decision retained under ADR-0015/0016 to avoid current ADR-0011/0012 identities. Current assignment edbf26e39d7aeba475caecfbb6635e8e5be99208 admits source composition onto c39e1942035e526ecf83427329999e65200ee1dd; migrations now 0025/0026. Author evidence: docs/workbench/product-rebaseline/p3-email-composition; fresh candidate requires separate queued QA.
