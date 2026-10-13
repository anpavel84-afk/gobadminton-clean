# Independent QA · Friends S1 API

ID qa-friends-dev-s1-api-20261013-v001; depends strictly on producer friends-dev-s1-api-20261013-v001; suite friends-s1-germany-dev-privacy-v001. Read-only Codex reviewer, no write-privileges or source changes.

Verify exact bound producer receipt, committed candidate SHA/tree/branch, no self-review and trusted root-specific authorization before issuing acceptance. Legacy PR #198 QA is historical only.

Run unit/integration/migration in explicitly disposable DB; verify actor/blocked/anonymous/hidden profile, incoming/outgoing requests, duplicate/replay, cancel and accept race, personal data deletion/revocation, no leaked precise Radar coordinates or private contacts. Verify source does not extend PROD permissions or enable real user launch.

Record tests and findings with evidence and strict PASS/FAIL/BLOCKED. A model report alone is NOT a root-protected QA receipt. Do not unlock dependent source or deployment without true verifier policy.
