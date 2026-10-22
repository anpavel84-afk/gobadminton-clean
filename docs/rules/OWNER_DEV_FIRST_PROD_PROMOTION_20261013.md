# GoBadminton — Owner decision: DEV-first continuous delivery, selective PROD promotion

**Decision:** OWNER_APPROVED on 2026-10-12 (America/Sao_Paulo); published 2026-10-13 UTC.  
**Scope:** existing product in `anpavel84-afk/gobadminton-clean`; no new application redesign, no automatic unpause of Runner/Codex/Autopilot/Publisher.

## Golden rule

**Every approved task must appear promptly on the real, shared `https://dev.gobadminton.ru` after implementation and essential safe checks.** DEV is where the Owner and team see changes in the actual application, not an isolated sandbox hidden for days awaiting a special DEV release.

The engineering default is: **change → fast local checks → real DEV deploy → DEV smoke → Owner/team inspection → fix immediately on DEV**. A long-running QA or bundled PROD release is never a reason to withhold an otherwise safe DEV preview for days. "Immediately" means as soon as the scoped change builds and passes essential safety checks; it does not mean deploy broken code or skip protections.

Branches, worktrees and ephemeral QA fixtures remain permitted for authoring and verification; they **do not substitute for the real Germany DEV site** as a product preview or acceptance receipt. Always return the DEV URL, exact commit/image/config digest and real applied/smoke status. Never report "DEV live" for a source-only patch or unpublished preview.

## Two permanent environments

| Environment | Public entrypoint | Compute/data | Release role |
| --- | --- | --- | --- |
| DEV | `https://dev.gobadminton.ru` | Germany `vmi3510488`: isolated DEV Next.js + DEV API + DEV PostGIS/DB/media, dedicated network, auth and keys | **Continuous delivery** of approved work, fast refresh |
| PROD | `https://gobadminton.ru` | Moscow `ruvds-68jzd`: Web; Germany `vmi3510488`: distinct PROD API/DB/media via GoBadminton reverse XHTTP v2 | **Deliberate, bounded selected release** only |

Germany `https://api.gobadminton.ru` is a PROD API alias. The historical `dev-api.gobadminton.ru` **currently still targets PROD**, due to OAuth/consumer compatibility; never reassign it to DEV without separately verified PROD callback/consumer migration. DEV browser `/v1/*` stays entirely in Germany on its DEV API.

No DEV job may read, import, truncate or write PROD users, cookies, OAuth sessions, avatar storage or DB; no automatic PROD migrations. DEV database and auth credentials are independently scoped; matching human OAuth identity does not imply shared app session or user record.

## One task → fast DEV, one curated PROD release

1. **Authoring:** Implementation changes the existing clean repository in a scoped branch/PR; preserve accepted product behavior and Style Guide. The source commit and relevant test outcome are recorded.
2. **Immediate DEV update:** After essential compilation, contract/security checks and permission/compatibility preflight, apply the updated Web/API or both to the **real DEV** under a short scoped release lock; do not wait for a separate Owner micro-GO when the task includes DEV delivery. Use immutable image/source SHA, actual Docker Compose status, live HTTPS smoke and a rollback target. An independently failing or unsafe change is blocked on DEV until repaired; do not falsify PASS.
3. **Feedback on DEV:** Owner/team see the actual change at `dev.gobadminton.ru`, test it, report defects, and fixes are redeployed to that same DEV without a fresh PROD release cycle. Concurrent branches do not silently overwrite each other on shared DEV: serialize promotions and record the installed SHA.
4. **PROD selection:** Assemble a release **only** from specific tasks/commits previously present and checked on DEV. Map selected task IDs to exact accepted source SHA and Web/API image digests. Changes are not automatically promoted to PROD merely because they reached DEV; choose a compatible tested snapshot, not an arbitrary partial source tree.
5. **PROD safety:** Independent nonauthor QA on exact proposed revision, DB/auth/privacy compatibility, one bounded production authorization, original-host preflight, Moscow Web + Germany API release, public smoke, authenticated product acceptance, and immediate restore of pinned snapshots on regression. Preserve a factual installed-version ledger.

## Execution now versus desired automation

**Operationally possible today:** original-host Desktop Commander on the two named VPS, allowed Docker Compose, Nginx and systemd actions, guarded scripts, source/hash receipts and rollback. This is the authorized *manual fast DEV publication* path; never ask Owner for a separate admin merely to repeat routine permitted DC work. No `dd`; respect platform/tool safety refusals; never switch machines/wrappers to reissue a rejected command.

**Not yet commissioned:** new `gobadminton-clean` authenticated Git writer, CI workflow authority, independent QA job, and automatic DEV-on-commit publisher. Establish this once with least privilege, quotas and real job receipts, so DEV deploys become automatic after required checks. Existing `OPERATOR_PAUSED` for legacy Runner, Codex, Autopilot, Publisher and timers remains. This Owner decision authorizes ordinary DEV delivery through existing permissions; it **does not** claim background automation is already running or grant machine rights.

**Never gate normal DEV publication on the old Radar-specific v002 production helper.** It is historical pinned-release tooling and cannot safely deploy arbitrary current Web/API versions unchanged. Future generic release entrypoints must be bound to actual source/image and runtime fingerprints.

## Authentication and acceptance

DEV OAuth may use separate provider apps **or existing provider apps with an additional explicitly approved DEV callback**, provided PROD callbacks are retained, providers permit both redirect URIs, and DEV keeps its independent database, AUTH_PEPPER, secure cookies and explicit per-environment redirect URI. Do not duplicate PROD provider credentials into Git, chat or frontend. Confirm provider behavior on both environments after adding DEV callback.

Always distinguish `SOURCE_READY`, `DEV_DEPLOYED`, `DEV_SMOKE_PASS`, `DEV_AUTHENTICATED_ACCEPTED`, `PROD_DEPLOYED`, `PROD_AUTHENTICATED_ACCEPTED` and `QA_PASS`. Existing DEV currently lacks configured VK/Yandex login, so **authenticated DEV product smoke is pending**, not implicitly passed by this policy.

## Durable records and applicability

Track execution in [Issue #3 — Germany DEV](https://github.com/anpavel84-afk/gobadminton-clean/issues/3), [Issue #4 — QA/delivery](https://github.com/anpavel84-afk/gobadminton-clean/issues/4), [Issue #6 — Git cutover](https://github.com/anpavel84-afk/gobadminton-clean/issues/6). The broad [Owner execution policy PR #8](https://github.com/anpavel84-afk/gobadminton-clean/pull/8) remains separate. This decision documents the Owner's current delivery intent; creating this file/PR does not itself install the missing CI or imply main merge.
