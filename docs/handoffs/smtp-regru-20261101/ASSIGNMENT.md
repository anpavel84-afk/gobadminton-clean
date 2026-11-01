# Owner-direct SMTP slice · 2026-11-01

Role: bounded implementer/OPS of the explicit Owner SMTP assignment, not a second
PMA. Repo anpavel84-afk/gobadminton-clean; base DEV
7a36b8d94a5df412426155e5852fddd9da7b0045. Accepted rules EOM 1.4 commit
bc8bad0c38a861f8e72296d0a323e2941b9322e0, SHA256
017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269;
common+author capsules and full navigation read. User directly authorizes code,
protected mail runtime and DEV after QA/CI. PROD is forbidden; C5 off.

Scope: apps/api auth SMTP adapter/template, config and existing worker selection;
mail-specific tests/dependencies; scripts/mail DEV wiring and this runbook/handoff.
One isolated task clone, no overlapping open SMTP PR found. No Train/dispatcher,
PMA, unrelated service or other project changes. Rollback is documented in
operations/SMTP_REGRU.md. Credentials never enter source, logs or GitHub.

Acceptance: independent Codex QA → Product CI → existing DEV accepted workflow →
real mailbox UAT to the Owner-approved primary Gmail address. Report each status
separately. Registration/recovery require their actual user scenarios.

Credential preflight: authorized info-mail.env contains only metadata/path;
authorized info-mail.auth was empty. Owner then supplied a credential, installed
root:root 0600 through a non-echoing prompt. REG.RU SMTP AUTH passed; password not
retained here. No unrelated secrets were searched.

Initial local findings and independent read-only Astra repair brief: explicit
SMTP 4xx response must override Nodemailer EMESSAGE/EAUTH/EENVELOPE labels;
assert decoded MIME, not folded headers/raw base64; timeout stimulus must withhold
the greeting deliberately. Applied these bounded fixes; 24 focused tests, API
typecheck and lint passed. This is author evidence, not QA PASS or DEV acceptance.
