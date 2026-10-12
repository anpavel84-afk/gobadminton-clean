# Owner / PM decision · B preview canonical first-contact route v001

Date: 2026-10-07
Status: ACTIVE_RECOVERY_DECISION

## Decision

The Messaging B product does **not** define `/messages/new` as a consumer route.

The accepted first-contact deep link is:

`/messages?to=<publicPlayerId>`

with optional `&action=invite`.

This is the route implemented and independently exercised by the accepted B producer/QA matrix. `/messages/new` appeared only in the preview deploy smoke prompt and is therefore an acceptance-specification defect, not a product defect.

## Consequences

- Preserve the historical `DEPLOYED_FAIL` / retry 5/5 record for `preview-owner-b-messaging-v001`; do not rewrite history.
- Do not create a product repair whose only purpose is to invent `/messages/new`.
- Do not retry the terminal task or reset its attempt counter.
- Supersede the old preview pair in the active queue.
- Perform one new read-only lean reverify of the currently deployed B surfaces using the canonical route.
- The reverify must not log in real users, create messages, mutate data, redeploy, or alter flags.
- The already accepted B product QA remains authority for authenticated request → Inbox → accept → conversation/read/block and GameChat idempotent-send behavior.

## Current runtime binding

At this decision point:

- accepted B producer: `2e31ba0440e5d1653dbdfd595240abf8845e5d73`;
- accepted B independent QA: `c9b36e5df7c9b344264fd2c8eba0a646cf189f7d` (`PASS_WITH_NONBLOCKING_GAPS`, zero blockers, merge recommended);
- B merge / current Moscow web: `1e9922df7c3092c79142221ef83cc94925732c03`;
- current Germany API successor: `6dee7e157922e7e12a4ce2981b288905d23e80b9`;
- the API successor differs from B release only by the separately tested Owner Radar global-debug hotfix and its tests/compose passthrough;
- original historical failed preview evidence publication: `4e432cf30417d1e7c4ecf8b09ba20f4f4431fe1e`.

The B reverify therefore binds the actual split runtime pair rather than pretending API and web still share one SHA.
