# REG.RU email-code delivery

Owner assignment: SMTP delivery using the existing email auth and PostgreSQL/pg-boss
queues. No PROD enablement is authorized. C5 remains off. SMTP uses Nodemailer,
verified TLS 1.2+ to mail.hosting.reg.ru:465, info@gobadminton.ru for username,
From and Reply-To. Provider protocol/content logging and URL/file attachments
are disabled. Connection/greeting 10s, idle 20s. SMTP 4xx/network failures retry
through the existing four-attempt budget; 5xx is permanent. No adapter retry loop.

`EMAIL_AUTH_TRANSPORT=smtp` enables the existing API and worker. `fake` remains
loopback/local/NODE_ENV=test only, including its memory-sink observation methods.
All three distinct EMAIL_AUTH_{HMAC,ENCRYPTION,RATE}_SECRET values remain required.
The API needs these shared email-code keys, but does not need the SMTP password.

The worker reads `MAIL_AUTH_FILE` (default
`/srv/gobadminton/mail-runtime/info-mail.auth`): a regular file, owned by the
worker UID, exactly 0600, 1–4096 bytes, no symlink, raw mailbox password with one
optional final line ending. No password env/client/public-config input exists.
A missing/empty/insecure secret blocks worker startup without exposing its value.
Rotate the file through root OPS and restart only the mail worker.

## DEV installation after source QA and Product CI

Use the existing DEV deploy workflow, not PROD. Verify accepted.json and live API
GIT_SHA equal the reviewed source release. OPS installs dev-email-compose.yml
in /etc/gobadminton/deploy and adds that fixed root-owned file to the existing
DEV COMPOSE_FILES array, with rollback copy. Provision root:root 0600
mail-runtime/dev-email.env containing EMAIL_AUTH_TRANSPORT=smtp and three
independent random email-code keys (no SMTP password). These keys must be stable
and shared with API/worker across restarts. Recreate only DEV API through the
existing fixed Compose profile and accepted candidate. Preserve the accepted
image, existing API env and other services. Never print docker inspect env/config.

Install dev-worker.py and its systemd unit from scripts/mail. This runs the
existing `dist/worker-main.js` and its existing queues/schedules, not a second
scheduler implementation. No other mail worker may be running. It verifies the
accepted DEV API SHA, image digest, exact DEV origins and enabled SMTP; uses the
API environment privately and mounts the existing root-only password read-only.
The container has no Linux capabilities, a read-only root filesystem, and no-new-
privileges. Root inside this restricted container is needed to read the authorized
root:root 0600 bind mount; the public API remains its existing nonroot UID.

After every future DEV image deployment, restart this worker once the new image
is accepted so API and worker keep the same release. A mismatched/unaccepted API
blocks worker restart. This is an OPS step, not a new polling service. Rollback:
stop/disable only gobadminton-dev-mail-worker.service, remove the mail override
from DEV COMPOSE_FILES, recreate only DEV API using its previous configuration.
Keep credential/key files private for recovery; never commit them.

## Acceptance and limits

Source tests use a local TLS SMTP fixture for AUTH, real template transmission,
535, 451/retry, connection refusal and a deliberately stalled greeting. Existing
DB/API/pg-boss suites verify generation fencing, concurrency, budgets, retry,
consumption and ciphertext cleanup. Product CI runs those on disposable PostGIS.
The adapter returns only a deterministic opaque Message-ID, not SMTP response text.

SMTP acceptance is not mailbox receipt. Real UAT must use the existing email-code
API → durable queue → worker → REG.RU → approved mailbox, then verify the code
through the bound API flow without printing it. Verify inbox receipt separately.
Do not label registration/account recovery accepted from transport tests alone.
SMTP cannot guarantee exactly-once delivery across an ACK-loss or process crash
between provider acceptance and DB commit; deterministic Message-ID and existing
DB fencing reduce duplicates but are not a provider idempotency guarantee.
