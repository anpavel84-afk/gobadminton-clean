# GoBadminton · Grok Bot OPS · SSH client public key enrollment receipt

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL**

Status: **SERVER_ENROLLED / GROK_REMOTE_CONNECTION_NOT_YET_VERIFIED**

Verified on 2026-10-18 at **02:52:12 UTC** through authorized Desktop Commander on original Germany VPS, hostname `vmi3510488`, root administrative session. Applies only to the newly provisioned `grokops` SSH user, not app / executor / PROD permissions.

## Facts

- SSH target: `grokops@169.58.183.182:22`.
- Client Ed25519 public-key comment: `grokbot-gobadminton-ops`.
- Client public fingerprint: `SHA256:S/NwxcnCrbUUN6q8TJ0OMWZzmAV+wTA4DbXiHzjP6k8` — **independently calculated from the supplied encoded public key**, then verified with `ssh-keygen -lf` on the installed `authorized_keys`.
- Restricted key line: `restrict,pty ssh-ed25519 [CLIENT_PUBLIC_KEY_REDACTED] grokbot-gobadminton-ops`. Public key text intentionally omitted here; its verified fingerprint is sufficient for this status receipt.
- `/home/grokops/.ssh/authorized_keys`: owner/group `grokops:grokops`, mode `0600`, exactly **one line**, SHA-256 of installed file: `01758ef15e76644bc4bfb19334af44106d8f0034d6c8974e7e689f5459f65170`.
- SSH host Ed25519 fingerprint confirmed: `SHA256:8U2knzPaWcyp8xa40hnDX+Xk4xhc0r9OnwG44kgoFT4`.
- Effective `sshd -T -C user=grokops`: `authenticationmethods publickey`, `passwordauthentication no`, `kbdinteractiveauthentication no`, `disableforwarding yes`, `permittty yes`, `authorizedkeysfile /home/grokops/.ssh/authorized_keys`.
- `sudo -l -U grokops`: only `(agentagency-dev) NOSETENV: NOPASSWD: /usr/local/bin/gb-grok-status ""`.
- `sshd -t` PASS; `ssh.service` active; no SSH restart needed to load the new `authorized_keys` line.
- Existing `gobadminton-autonomy.service` remained active/running with MainPID `2295751` at verification. Nothing in worker checkpoint, locks, attempts, CI, DEV release, PROD or other users' SSH identities was intentionally modified.

The installed server-side restrictions and read-only diagnostic were locally SSH-tested with a disposable test key and negative sudo tests before this enrollment. **That local test is not an end-to-end remote test from the Grok cloud.** The private client key remains under Grok's control; not received or needed by integrator.

## Next action — Grok must verify from its own cloud computer

Use the SSH connection already set up with Python Paramiko. Require strict pinned OpenSSH host key verification: configured Ed25519 host key must match fingerprint `SHA256:8U2knzPaWcyp8xa40hnDX+Xk4xhc0r9OnwG44kgoFT4`, with rejection of unknown/mismatching server keys (never `AutoAddPolicy`).

Connect as `grokops` with only Grok's already-generated client Ed25519 private key, without agent/key discovery. Run `id -un && hostname && sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status`. Check exact username `grokops`, hostname `vmi3510488`, and JSON fresh timestamp/state. Do not print private keys or credential files, and do not run models or modify server state.

Return only **CONNECTED_AND_VERIFIED** with timestamp, scope and sanitized status, or the exact error/status if access is blocked. Successful SSH login does **not** grant OPS coding-authority or direct `agentagency-dev` shell; that is separately controlled by current authorization gates.

## Relevant project handoffs

- [Server SSH bootstrap](GROK_OPS_SSH_SERVER_HANDOFF_20261018_V001.md).
- [Grok client launcher](GROK_OPS_SSH_CLIENT_LAUNCHER_V001.md).
- [Exact source of the installed read-only status helper](gb-grok-status.py).
- [Core OPS onboarding bootstrap](../GROK_BOT_OPS_BOOTSTRAP_20261017_V001.md).

No changes in app `dev`, `main`, automation claim, root receiver, SMTP or production settings were made by this enrollment operation. No Grok remote-login PASS is claimed until Grok executes the test.
