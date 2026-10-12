# Email E1 contract addendum

Status: source candidate READY_FOR_REVIEW, INTERNAL_TEST_ONLY; 2026-10-08.

Wire source: packages/contracts/openapi.json. Routes below are under /v1.

- GET auth/methods: supported OAuth availability plus email_code availability. Email is false unless strict local test-only fake transport is selected.
- GET me/auth-methods: connected OAuth methods + masked verified email. Existing linked-providers stays OAuth-only.
- POST auth/email/challenges: email and optional safe returnPath; existence-safe 202; sets host-only HttpOnly email binding cookie. No User before mailbox proof.
- GET auth/email/challenges/{challengeId}: safe status, no identity data.
- POST .../{challengeId}/resend: JSON {}, 202, rotates generation and code. 60s cooldown; previous code invalid immediately. Failed-attempt counter is cumulative.
- POST .../{challengeId}/verify: 8-digit string code; 200 authenticated/returnPath and existing session cookie once only.
- Corresponding request/status/resend/verify under me/auth-methods/email/link/challenges: active same user/session, CSRF mutations and recent auth; success {linked:true}; collision 409, never merge.

All challenge operations require exact issuing Origin. Mutations require application/json plus X-GB-Email-Auth: 1; anonymous operations require preauth cookie except initial request. Link mutations additionally require X-CSRF-Token. Status also requires exact Origin and binding/session. No code/binding hash/credential ownership appears in response or job data. Cache-Control: no-store.

422 covers malformed input, invalid/expired/replayed/superseded code. 429 with Retry-After covers attempts/cooldown/shared rates; 403 denies binding/Origin/freshness. Disabled transport yields 503. Verified inactive User yields ACCOUNT_UNAVAILABLE after proof and no new session. Correct-code collision/account-unavailable consumes the proof, avoiding replay. Lost response after committed login requires a fresh challenge.

Shared DB defaults: email 5/hour,15/day; source IP 20/hour,100/day; environment hourly cap 1000 configurable within 1..10000; each challenge max5 failures, 10m TTL. Source IP comes from Fastify request.ip (no new trustProxy/X-Forwarded-For authority). HMAC bucket keys store no raw email/IP.

No E1 email change/unlink routes, public mailbox retrieval, native/Admin session, real mail or deployment. Sensitive successor operations must preserve the User/session fence and unified last-method guard. Schema/cleanup details and rollback: docs/decisions/ADR-0015-EMAIL-AUTH-INTERNAL-FOUNDATION.md.

Actual transport calls, including retries, independently reserve the same configured
hourly environment cap in shared DB (`send_hour`). Exhaustion fails delivery safely and
wipes ciphertext without another transport call. Issuance and send cost counters are distinct.
