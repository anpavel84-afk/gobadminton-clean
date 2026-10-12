# Email E2/E3 contract addendum
Status: READY_FOR_REVIEW — INTERNAL_TEST_ONLY — NO_PUBLIC_ACTIVATION. 2026-10-08.
Wire source: packages/contracts/openapi.json (current-base version retained); E1 routes/DTOs preserved.

All new commands require exact issuing Origin, JSON, X-GB-Email-Auth:1; authenticated commands additionally require exact active consumer session, CSRF and authenticated_at within 15 minutes, rechecked under User/session fence.

- POST me/auth-methods/email/change/current/challenges `{}`: sends only to the current stored mailbox, never a client-supplied address; captures original credential ID.
- status/resend/verify under this resource use E1 challenge semantics. Verify returns `{proved:true,proofChallengeId}`. This consumed challenge remains a 10-minute proof bound to original credential, Origin, User and exact session. It does not refresh session authentication.
- POST me/auth-methods/email/change/challenges `{email,proofChallengeId}`: requires that current proof, consumes its one issuance opportunity via unique reference; same address rejected. Verify new address atomically revokes original and inserts replacement. Collision consumes new proof without merging or changing either owner. Reuse after a successful replacement returns stale-method conflict; another session/current credential or expiry invalidates proof. Lost issuance response requires a new current proof; no replay/recovery shortcut.
- DELETE me/auth-methods/email `{}`: recent auth and transactional unified OAuth+email last-method guard; success `{unlinked:true}`. Repeat after revoke returns 404. Lost response: reread inventory, do not infer failure or blindly retry. Idempotency-Key follows existing consumer command header convention, but authority always rechecks current state rather than replaying credentials.
- POST each anonymous/link/current/new challenge `/{challengeId}/status` `{}`: read-only browser alias of GET status, requiring mutation-style Origin/JSON/header/CSRF checks to obtain an actual browser Origin header. GET compatibility remains. No code, mailbox owner or binding is disclosed.

OAuth unlink now also requires recent authentication for a supplied browser session. Login rechecks active credential after waiting on User fence, preventing a revoked/replaced credential from authenticating its former owner. A later fresh signup at a revoked address is a separate identity; no automatic merge.

Default email discovery remains false; no live transport or public code endpoint. Browser follows discovery, preserves explicit VK/Yandex choice and routes successful email login through existing city setup only after explicit Continue. No create/join/message/Radar submission is performed by auth completion. Existing required fields/consents are unchanged.

0025/0026 are additive on current 0024; preserve applied 0023/0024 preferences migrations. Source rollback keeps additive credential tables/rows and disables email. No production runtime/migration admitted here.
