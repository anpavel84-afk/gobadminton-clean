# GoBadminton · Grok Bot OPS SSH bootstrap · server-side handoff V001

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

From: GPT OPS integrator → Grok Bot / Owner.
Date of host check: **2026-10-18 02:36 UTC**.
Scope: German VPS `vmi3510488` only. This is a **new restricted observer account**, not a replacement for the product execution worker and not delegated source writer authority.

## Outcome

**SERVER PREPARED; NOT YET ENROLLED / GROK REMOTE LOGIN NOT TESTED.**

Dedicated `grokops` created as local UID/GID `1003`, shell `/bin/bash`, home `/home/grokops`, only own group. Password locked. Authorized keys file exists but is **empty**, mode 0600. No client key has been enrolled. **Do not claim Grok is connected before its own key is installed and a real remote test succeeds.**

Verified public endpoint: `169.58.183.182:22`. OpenSSH already existed. Host's Ed25519 **public** identity:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHnaKJ4RJFVxO+Dh97ipC4bvTLQUMtQ8TbGLrzmSkNfB
SHA256:8U2knzPaWcyp8xa40hnDX+Xk4xhc0r9OnwG44kgoFT4
```

Config created:

- `/etc/ssh/sshd_config.d/99-gobadminton-grokops.conf` — root:root 0644, SHA256 `37bcfdd2e8e6d044e16d8f1bd1e612b22d843458d4ca0cf87a598f08632685d7`.
- `/etc/sudoers.d/90-gobadminton-grokops` — root:root 0440, SHA256 `2ad4842406db8c0d238aaee93e7131374f86a0abd48474ae7d55930d828ca5a8`.
- `/usr/local/bin/gb-grok-status` — root:root 0755, SHA256 `f89b849b59556e9fe665ac19dcde0ee0ad53cec2d79815aea2c61a8a7ee1920d`.
- [Exact source archive for status helper](../grok-ops-ssh/gb-grok-status.py), matching bytes of installed script, no credentials.
- `/home/grokops/.ssh/authorized_keys` — grokops:grokops 0600, zero length awaiting **Grok-generated Ed25519 public key**.
- `/home/grokops` — 0750, `.ssh` — 0700.

`Match User grokops`: publickey-only, no passwords, no keyboard interactive, no forwarding (TCP/agent/X11/stream/local/tunnel), allows interactive PTY, max two SSH sessions. No changes to sshd defaults for existing users. Existing SSH listener on port 22 and active connection retained. SSH config `sshd -t` PASS and `systemctl reload ssh` succeeded.

Sudo access: **only** `sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status`, with **no arguments allowed**. It is run as existing user `agentagency-dev`, **not as root**. Root-owned Python script uses isolated interpreter, fixed paths, O_NOFOLLOW, file-owner/size checks and field allowlist. No raw task contents, secrets, private QA findings or env are emitted. No write to state. `sudo -n id`, `sudo -u agentagency-dev /bin/sh` and argument variants all denied in real tests.

New account can use a limited general shell under its *own* permissions and `/home/grokops`; it has no membership in `gobadminton-clean-control`, `docker` or admin groups, no inherited Codex OAuth profile, no root privileges, no access to existing private worker state or active source worktrees. Direct launching of another writer or model through the privileged execution identity is not permitted. Future controlled commands require separate authorization and QA; the present bootstrap is limited to **transport and trustworthy read-only operations**.

## Verified tests

- `sshd -t` PASS; effective `sshd -T -C user=grokops` shows publickey-only and disabled forwarding.
- `visudo -cf` PASS and global `visudo -c` PASS.
- One-time locally generated test Ed25519 key, installed with `restrict,pty`, successfully completed real SSH authentication on `127.0.0.1:22`.
- Interactive PTY test PASS.
- SSH command `sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status` PASS and returned live checkpoint, worker state and sanitized DEV receipt.
- SSH `sudo -n /usr/bin/id -u` explicitly denied. Separate runtime shell explicitly denied.
- Test key removed from authorized_keys and local temporary key files destroyed. Final authorized_keys empty.
- Existing `gobadminton-autonomy.service` remained active during checks; no checkpoint mutation, model launch, Git push, deployment or PROD changes.

**Not verified**: outbound port 22 from the actual Grok cloud computer; Grok's own SSH private/public key pair; real Grok login; GitHub write privileges for Grok; any expanded model control. Do not conflate local probe and end-to-end remote authorization.

## Exact next action: client key enrollment

Grok must, on its **own persistent cloud computer**, generate a new isolated `ed25519` key pair into its `~/.ssh`, modes 0700/0600. It must present **only** the `.pub` line and fingerprint to the trusted server integrator via the user's approved communication channel. Private key must never be pasted into chat, GitHub, user prompt, tickets, screenshots, logs or repo; it remains on Grok's shared cloud machine. Official Grok docs confirm command-line credentials are shared among all Bots on the same user's computer; this is why VPS account is deliberately limited.

After receiving public key, the integrator validates format/fingerprint and installs **one** line with `restrict,pty` in `/home/grokops/.ssh/authorized_keys`, preserving mode and ownership; no new sshd reload is necessary for authorized_keys update. Then Grok must test **from its cloud**:

```sh
ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -i ~/.ssh/gobadminton_grokops_ed25519 grokops@169.58.183.182 \
  'id -un && sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status'
```

Pin `169.58.183.182 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHnaKJ4RJFVxO+Dh97ipC4bvTLQUMtQ8TbGLrzmSkNfB` in the Grok computer's `~/.ssh/known_hosts` before connecting and independently compare displayed fingerprint to above. Never use `StrictHostKeyChecking=no` as a shortcut.

A successful remote test completes **read-only SSH access**, not operational authority for GitHub/deploy. This new account cannot repair `blocked` by modifying state or running Codex directly. Development remains through the existing owner-approved admission and worker.

## Revocation and rollback

To revoke only Grok SSH access, clear **only** the Grok authorized_keys file and terminate **only** Grok sessions if necessary. Do not disable SSH service or change other keys/users.

For full rollback of this new access surface, after revoking client key and draining Grok sessions:

1. Remove only `/etc/ssh/sshd_config.d/99-gobadminton-grokops.conf`; validate `sshd -t`; `systemctl reload ssh`.
2. Remove only `/etc/sudoers.d/90-gobadminton-grokops`; validate `visudo -c`.
3. Remove only `/usr/local/bin/gb-grok-status` (after not in use).
4. Remove only the dedicated account `grokops` and its home if it contains no evidence that must be retained.
5. Confirm existing `agentagency-dev` user service, active worker lock, DEV/API/DB and SSH for other accounts remain unaffected.

The source and this document are stored on the docs-only onboarding branch. They are not an independent QA acceptance, not deployment of app code and not automatic authorization for subsequent privileged OPS commands.

## Live snapshot at setup

During verification: worker `gobadminton-autonomy.service` active, Issue #66 `blocked`, QA `PASS` for candidate `e81c6ee6b27a6711b865d8f895fb965221c73c40`; reason `Actions failed`. Historical snapshot only: Grok must re-read status at connection time.
