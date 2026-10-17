# GoBadminton · Owner standing execution policy · 2026-10-12

**Status: OWNER-DIRECTED POLICY CHANGE — submitted for canonical integration.**
Applies to new canonical development repository `anpavel84-afk/gobadminton-clean`.
Implements the simpler execution model already requested in [legacy issue #214](https://github.com/anpavel84-afk/gobadminton/issues/214).
This policy resolves *project governance*, not external credentials, OS permissions or a platform tool denial.

## The rule

**Owner says "implement" → the responsible team has one end-to-end task authorization within the stated scope and risk ceiling.**
Perform available work now; do not stop at plans, extra preparation files or new micro-GO requests. An Owner instruction to deliver a production change includes **one bounded release window** with staging, original checks, deployment, product smoke and immediate rollback when those operations are already within the approved scope and a legitimately commissioned release job is available. An Owner instruction for source-only research does not secretly authorize production.

## Automatically included in a task (no extra Owner approval)

- Read code, history and non-secret diagnostics through already authorized access.
- Implement source changes in a scoped branch, run tests in permitted environments and create PRs.
- Independent non-author QA via ordinary reproducible CI/jobs; repeat only checks affected by a new SHA or material environment change. A QA failure stays recorded; an unperformed job is never marked PASS.
- Build immutable images, deploy the accepted version to isolated **DEV** via its commissioned job, execute smoke/rollback and give Owner a working preview URL.
- For a specifically approved regular **PROD** delivery: the commissioned job performs preflight, artifacts, matched Web/API version switch, smoke and rollback in a **single release authorization**. No approval loops between these steps. No automatic retry of writes/POST/PUT after an ambiguous response.
- For P0 incident restoration: read-only incident isolation, an already approved minimal reversible project-only repair and checking the real user experience are a **single task**, not three handoffs. Real host actions still require genuine machine authority.
- Continue the next already admitted independent work slice if the current slice is blocked by its own environment, without changing its dependency or PASS history.

## Permission limits that remain real

- No production database reset, destructive migration, mass account mutation, credential exposure, weakening of auth/privacy boundaries, changing the personal vpn-mow or another project's system, spending, or broadening of OS/Git writer privileges without a *new scope-specific Owner decision*. Ordinary safe rollback does **not** require another GO.
- Preserve separate DEV/PROD databases, users, cookies, secrets and resources. Independent QA remains mandatory for normal production source changes; a pre-approved emergency rollback may run immediately followed by verification.
- No direct ordinary agent write to protected production DB, canonical main without the designated Git writer/CAS, or production machine except through its scoped deploy/rollback job.
- `OPERATOR_PAUSED` on legacy autonomous Runner/Publisher/Codex/timers stays in force until an explicit, named commissioning/unpause event. A targeted Owner request for an authorized recovery operation is **not** a global unpause.
- A GitHub role, a PR comment or an Owner order does not provision Linux user accounts, firewall permissions, CI identities or TLS secrets. Never fabricate operator ACKs, installation, test execution or deployment.
- A platform/security **tool denial cannot be undone by this document or bypassed through another model, wrapper, executor or computer**. Resolve it through the platform's official support/authorization process, or have a genuinely authorized original-host administrator perform the permitted operation in their own administrative channel.

## One-time infrastructure commissioning (real remaining blocker)

An actual Contabo account/VPS administrator and actual RUVDS account/VPS administrator (or their duly delegated OS administrators) must **once** provision and attest the restricted principals/jobs below, using official console/OS access:

1. Germany `vmi3510488`: **DEV** build/install/QA with quotas and no PROD DB access; and separate **PROD API** release/rollback entrypoint restricted to GoBadminton services and pinned artifacts.
2. Moscow `ruvds-68jzd`: separate **PROD Web/nginx** release/rollback entrypoint restricted to the GoBadminton vhost/containers, with known rollback.
3. GitHub `gobadminton-clean`: one authenticated main writer/CAS and a CI workflow created by a credential with official `workflow` authority; independent non-author tests with trusted run receipts.
4. End-to-end job binds exact commit/image/config digests; performs deploy only on the named services and reports real PID/job, smoke and rollback. Secrets remain in host/key store, not chat or GitHub issues.

Commissioning happens **once**, not once per feature. Until it is completed, authorized source changes may proceed, but operators must not report `INSTALLED`, `DEPLOYED` or `PRODUCT PASS`. The standing permission allows use of an actual installed job; it does not invent one.

## Minimal proof instead of paperwork

A single existing GitHub Issue/PR per task shows: exact SHA, actual test verdict, deployed Web/API image/config identity if any, preview/production URL, smoke result, rollback identity and **one real blocker / next action**. Large logs/screenshots stay in restricted external evidence storage. A comment that tells someone to run a job is `INSTRUCTION_POSTED`, not `JOB_STARTED`.

The accountable Supervisor must classify any failure as: **(A) redundant internal GO** → eliminate it immediately; **(B) missing technical permission/job** → resolve by authorized one-time commissioning; **(C) platform denial** → official escalation, no workaround; **(D) real failing code/test** → repair. Do not turn B/C into another speculative architecture or prolonged ACK=NONE reports.

## Precedence and compatibility

For normal work inside an Owner-approved scope, this policy replaces conflicting older multi-GO / task-by-task preflight text in `AGENTS.md`, legacy V3/Runner policies and draft release procedures. Existing technical access limitations, security isolation, historical QA verdicts, owner-approved environment topology, protected production and the pause on the uncommissioned legacy automation are **not** changed.

Until merged to the new canonical `main`, this PR is a published policy candidate; it is not proof of a runtime switch.
