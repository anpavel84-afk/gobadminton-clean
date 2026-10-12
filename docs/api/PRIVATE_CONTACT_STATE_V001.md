# Private contact state v001

Source candidate for FB01 002/004; OpenAPI is the wire authority.

`GET /v1/me/contact-state?targetPublicPlayerId=<uuid>` requires an authenticated session and returns `Cache-Control: no-store`.
No actor identifier is accepted from the client. Invalid input is 400, unauthenticated input is 401, and infrastructure errors remain errors.

| State | Additional fields | Navigation |
|---|---|---|
| none | canRequestContact=true | exact peer first-contact form |
| accepted | conversationId, version | existing conversation, including archived |
| pending_incoming | conversationId, version | explicit accept/decline card |
| pending_outgoing | conversationId, version | existing sent request |
| terminal | none | no new request |
| unavailable | none | generic unavailable |

All responses echo the supplied targetPublicPlayerId; no private user/provider IDs, block direction or message content are exposed.
The lookup performs no writes. Pending expiry is projected without persisting expiry. Existing accepted membership precedes closed-to-new-requests policy.
The response is a snapshot, never command authorization. Command endpoints retain their existing consent, eligibility, pair-lock, idempotency and discovery-proof checks.
Profile and NewContact resolve privately after login; NewContact verifies the conversation header's peer before routing.
