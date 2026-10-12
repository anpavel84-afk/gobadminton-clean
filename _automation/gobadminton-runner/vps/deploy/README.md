# Restricted VPS Demo Deploy Channel v001

Status: **OWNER_AUTHORIZED / ACTIVE**
Date: 2026-10-04

Purpose: let the Germany GoBadminton execution user deploy accepted DEMO_PUBLIC releases without PLAN and without general root/sudo access.

## Security boundary

- Dedicated ED25519 key: `gobadminton-runtime-deploy`.
- Germany local root key is restricted to loopback source and forced command `/usr/local/sbin/gobadminton-deploy-germany`.
- Moscow root key is restricted to Germany public source IP and forced command `/usr/local/sbin/gobadminton-deploy-moscow`.
- SSH options use `restrict`, no PTY/forwarding/agent forwarding.
- Host keys were verified out-of-band through Desktop Commander before being pinned.
- Private deploy key remains runtime-only under `/home/agentagency-dev/.ssh/` and is never committed.

Observed host-key fingerprints at setup:
- Germany ED25519: `SHA256:8U2knzPaWcyp8xa40hnDX+Xk4xhc0r9OnwG44kgoFT4`.
- Moscow ED25519: `SHA256:GMQj8tzoE4ggqmeFl9QvjGHDKpOZPXqq95TyyGtRqQw`.
- Deploy public-key fingerprint: `SHA256:1J7mlGs91woPAoI8zWOmnPJbSZ9+xVdXroqxiEXr8qc`.

## Runner-side aliases

- `gobadminton-runtime-deploy` → root@127.0.0.1 forced Germany gate.
- `gobadminton-moscow-deploy` → root@194.87.214.217 forced Moscow gate.

## Allowed Germany commands

- `status`
- `api-deploy <40-char-sha>` — fetch exact commit through agentagency-dev, isolated worktree, API image build, accepted compose sync, migration, API/worker recreate, loopback health.
- `web-build <40-char-sha>` — exact worktree web image build and gzip artifact under `/srv/gobadminton/artifacts/`.
- `demo-seed foundation|full` — runs fixed API image entrypoint `node dist/database/seed-demo.js --mode ...`.

## Allowed Moscow commands

- `status`
- `web-deploy <40-char-sha>` — reads gzip image on stdin, validates/loads exact tag, backups env, recreates only GoBadminton web, verifies loopback health.

## Required implementation contract

The demo seed implementation must compile an executable entrypoint at `apps/api/dist/database/seed-demo.js` from source under `apps/api/src/database/seed-demo.ts` (or equivalent build output path that exactly resolves to `dist/database/seed-demo.js`). It must support `--mode foundation` and `--mode full`, be deterministic/idempotent, and never touch non-demo rows.

## Example deploy sequence

```bash
ssh gobadminton-runtime-deploy "api-deploy <sha>"
ssh gobadminton-runtime-deploy "demo-seed foundation"
artifact=$(ssh gobadminton-runtime-deploy "web-build <sha>")
cat "$artifact" | ssh gobadminton-moscow-deploy "web-deploy <sha>"
```

`gobadminton-deploy-germany` `with_worktree` must assign `sha` and `wt` on **separate** `local` lines. Combined `local sha="$1" wt="$DEPLOY_WT/$sha"` is fatal under `set -u` (`sha: unbound variable`) and blocks `api-deploy` / `web-build`. Live `/usr/local/sbin` is root-owned; the execution user cannot install the fix.

### Root operator install (Germany host only)

As root on `vmi3510488` (Desktop Commander / console — not `agentagency-dev`):

```bash
bash /srv/gobadminton-dev/worktrees/demo-preview-deploy-v001/_automation/gobadminton-runner/vps/deploy/install-germany-gate.sh
# or from a published branch tip:
# bash /srv/gobadminton-dev/repo/_automation/gobadminton-runner/vps/deploy/install-germany-gate.sh
```

The installer refuses the known-broken combined-`local` pattern, installs mode `750` root:root, then the queue can retry `api-deploy`.

Deployment authority remains limited to Owner-authorized DEMO_PUBLIC tasks. Real-user/OAuth/legal gates remain separate.
