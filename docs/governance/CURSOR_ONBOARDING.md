# Cursor Onboarding — GoBadminton v002

Status: **OWNER_CONFIRMED onboarding steps; runtime location and provider status must be reverified**

Cursor must be able to recover project context without chat memory. **Read current [`AGENTS.md`](../../AGENTS.md) and the [AI delivery target](../operations/AI_DELIVERY_TARGET_CONFIG_V001.md) first.** The latter is proposed until reviewed and is not proof of Cursor readiness. Historical details below must not override current `gobadminton-clean` live facts.

## Startup

1. Read `AGENTS.md`.
2. Read [ChatOps route](../operations/chatops/README.md); legacy `CURSOR.md` is not included in Clean extraction.
3. Read [PM / GitHub Projects and Issues](../operations/chatops/PM-CHEATSHEET.md); legacy `.cursor/rules/` is not included in Clean extraction.
4. Read exact active prompt/assignment.
5. Verify exact base/branch/dirty state/writer collision.
6. Load bounded canonical docs.
7. Execute and return durable GitHub handoff.

## Repositories

Product/code/docs:
`https://github.com/anpavel84-afk/gobadminton-clean`

Launchers/professional governance:
`https://github.com/anpavel84-afk/agents`

BadmintonOpen is a separate project.

## Primary execution host — Germany VPS

Host:
`vmi3510488`

Development paths:
- repo `/srv/gobadminton-clean/repo`;
- worktrees `/srv/gobadminton-clean/worktrees`;
- runner `[historical; no assumed active runner path — verify installed Actions train and restricted adapter]`.

Available executors:
- Cursor Agent: **target preference, currently not verified as sandbox-ready** (OPS #199 AppArmor blocker);
- Codex CLI: authorized routes only, exact model/effort from admission and stage routing;
- Antigravity: advisory/research or independent QA only after role-specific permissions and protected trial;
- task-selected model/effort within the admitted assignment; route listing is never runtime proof.

GitHub transport:
- SSH alias `github-gobadminton-clean` (verify effective alias on target host);
- repo-specific write access to `anpavel84-afk/gobadminton`;
- do not copy broad PLAN/account credentials.

PLAN remains paused recovery/reference only. It is not the normal execution route and must not overlap writes with the VPS.

## Current MVP topology

Moscow web:
- `ruvds-68jzd`;
- `194.87.214.217`;
- nginx + Next.js runtime.

Germany backend:
- `vmi3510488`;
- `169.58.183.182`;
- API + PostgreSQL/PostGIS + worker.

DNS:
- `gobadminton.ru`, `www.gobadminton.ru` → Moscow;
- `dev-api.gobadminton.ru` → Germany;
- `api.gobadminton.ru` reserved/unassigned at latest verification.

For historical topology, read [Environments](../operations/ENVIRONMENTS.md); `MVP_VPS_RUNTIME.md` is not included in Clean extraction. For the ChatOps route, read [ChatOps](../operations/chatops/README.md).

## Completion

Local code is not completion. Required: GitHub candidate + exact checks + target smoke where admitted + durable handoff.
