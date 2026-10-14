# Cursor Onboarding — GoBadminton v002

Status: **OWNER_CONFIRMED project operating rule**

Cursor must be able to recover project context without chat memory.

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
`https://github.com/anpavel84-afk/gobadminton`

Launchers/professional governance:
`https://github.com/anpavel84-afk/agents`

BadmintonOpen is a separate project.

## Primary execution host — Germany VPS

Host:
`vmi3510488`

Development paths:
- repo `/srv/gobadminton-dev/repo`;
- worktrees `/srv/gobadminton-dev/worktrees`;
- runner `/srv/gobadminton-dev/runner`.

Available executors:
- Cursor Agent;
- Codex CLI;
- task-selected model/effort within the admitted assignment.

GitHub transport:
- SSH alias `github-gobadminton`;
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
