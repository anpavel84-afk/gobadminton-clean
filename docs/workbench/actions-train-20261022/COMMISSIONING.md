# Actions train commissioning — 2026-10-22 UTC

From: PMA integrator. To: Owner / next PMA / release operator.
Authority: Owner Direct and [OPS #158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158).
Status: **INSTALLED AND ACTIVE; PRODUCT #151 DEV ACCEPTED; PRODUCT #156 DEFERRED, NOT DONE.**
This record is execution evidence, not a claim that every product task or provider is accepted.

## Actual result

Issue #151 completed through the new Actions path: integration422c109893bd6092fd177ccd3ef2162ccc897e0d, new independent QA39699003221 PASS, exact Product CI39698221138 PASS, promotion39699386490, DEV deploy39699415055, server release r39699415055-a1 ACCEPTED, matching live /v1/meta.gitSha, and final acceptance stage39699865418. Its issue appears in the preserved done ledger (slot1 count35). See [actual live/receipt evidence](product151-accepted.json).

Issue #156 genuinely executed via Actions (bounded repair author39698071373/PID3091259, next author39699329980/PID3158300, independent QA and CI). Attempt3 head360aeee8a4f47243e80d802e5f389ec99c8b6d95 received independent QA FAIL39699813345. Exact finding: VenueSheet.tsx120–121 uses getComputedStyle/getClientRects absent from the existing venue-photo-lifecycle fixtures; production Tab handler raises TypeError and fails to prevent Tab. The prior complete CI also reported unmocked apiFetch imports. Three attempts exhausted; stage39700144216 archived the unchanged failed candidate and freed the slot, without fabricating done, Owner PARK, new attempts or resetting budgets. See [retained failure](product156-deferred.json). The failing photo/integration fixture paths are outside the immutable original156 allowed_paths. Further source repairs must have a distinct Owner-authorized corrective scope, not silent attempt reset or duplicate task.

Issue #157 was serialized while156 occupied intersecting files, then claimed automatically39700264816 and authored39700380835/PID3213360, producing6fb9b0cbaad3c1989c521d0612d036ddf4342d7c / PR164. Its current stage is recorded in execution-evidence.json; no DEV success is inferred from publication or an active process.

Actual independent stages overlapped on the VPS: #151 integration/publication/promotion while #156 author ran, backed by root operation start/end times. These are real concurrent tasks, not a claim that two author models ran simultaneously. [Intervals](parallel-stages.json). A duplicate Owner event during #156 author preserved PID/start/boot, operation key, attempt and ledger hash: [proof](duplicate-event-proof.json). Failure of156 did not prevent151 completion or157 scheduling.

## What was transferred / retired

GitHub Issues remain the immutable requirements. Main train-events.yml is the no-secret event/rescue bridge. Dev train-dispatch.yml runs one reconciliation; train-stage.yml runs one bounded claim/author/publish/qa/ci/integrate/promote/dev stage. Germany uses the restricted existing DEV SSH receiver and existing slot identities/sandbox/leases/budgets. No persistent self-hosted runner was added to the public repository and the old infinite Supervisor was not wrapped in a workflow. Full standard Product CI and existing paired-image DEV smoke/ACCEPTED-or-rollback remain mandatory.

The following old units are **inactive and disabled**, including after reboot: gobadminton-supervisor.service, gobadminton-slot@slot1.service, gobadminton-slot@slot2.service. They no longer assign or launch product tasks. Their original code/units are retained solely for reviewed rollback; no historical source or task archive was deleted. Public anonymous polling/65-second api.clock is not used by Actions reads. `gh` login is not required: authenticated short-lived GITHUB_TOKEN is supplied privately to bounded trusted requests; Git source publication uses the existing own-slot SSH identity. No login/session/key bytes were extracted or copied.

Current controller1dc7f0e51ed10ef9b529c2ab846c126549e08a07; exact stage-workflow SHA256804cd9ba9d1e52acfdeb612029e658b3223f0343ea12aa6db40dd4ac28402e12; runtime manifestf434bb707a694f67141beb465fda6ceac2fec7a08cfc9cdb5a7cdcd338fe73a1. Normal merged PRs161/160/162/163 record registration, implementation and concrete hosted interoperability fixes. Fourteen installed payload hashes were verified. No branch/environment protection was removed, no PROD deploy authorized.

## Focused repairs and checks

Actual hosted failures—not hypothetical architecture changes—required canonical API-root URL joining, acceptance of current opaque installation-token syntax, and rejection of redirects that could forward Authorization. Independent token review initially FAILED on that inherited redirect behavior; the exact fix then independently PASSED. Ten real urllib-handler synthetic cases cover301/302/303/307/308 and no second request/token leak;12 focused integrator checks passed. Reports are attached beside this file. No V6 or broad unchanged-platform model review was repeated.

One actual QA startup failed because activation selected the byte-identical /opt Codex binary outside the existing slot1 sandbox allowlist. A zero-inference sandbox probe reproduced Permission denied and proved the original native executable worked. Restored only the already commissioned native path; sandbox access was not broadened. The dead failed operation, spent call and clean detached QA tree were preserved; Actions independently reran QA on exact head and passed. [Reconciliation evidence](slot1-qa-runtime-reconciliation.json). No unknown writer was blindly replayed.

## Routing and monitoring

Profiles auto/codex/cursor/agy and explicit task model/effort are preserved. Auto ranks only proven, permitted, positive-budget adapters. Codex is currently the only proven executable author/QA provider. Cursor is unavailable pending existing quota/provider-proof conditions; agy remains advisory-review only with author/QA forbidden. This is not a claim of live three-provider token balancing. Monitor distinguishes requested/effective model and measured call budgets, not invented provider token balances.

Existing OPS monitor is retained with additive actual workflow/stage/CLI identity. Its refresh time is distinct from last confirmed event. The slot1 live development PID and subsequent no-process state were observed; deferred156 is an error, not done. The root deferred archive remains authoritative when a freed slot has no current issue. Do not infer source progress from fresh snapshot timestamps.

Train attention is an additional finite main workflow (no checkout, no VPS/deploy secret, no model). It observes completed trusted same-repository dev Train-stage runs, validates bounded hashed stage.json artifacts as data without extraction/execution, and posts deduplicated attention into existing OPS158 with Owner mention for deferred/unknown/refused/error or failed/cancelled workflow. No arbitrary issue text or artifact text becomes a command. GitHub API token is never forwarded to the signed blob download. The existing GitHub notification channel is used; email delivery depends on account notification settings, not a configured SMTP sender. Eight targeted alert-parser/security tests and exact inline YAML/AST validation passed. Live alert delivery requires its recorded workflow result; do not claim email receipt from posting a comment.

## Limits and rollback

Product156 is not accepted. Its three-attempt boundary and independent QA are preserved. Current #157 source/QA/CI status is separately tracked. Rendered device/browser acceptance for new product views is not implied by SSR/unit tests.

The new train was not subjected to a destructive live reboot/cancel mid-author merely to create evidence. Duplicate delivery and parallel stages were verified live; crash/reboot/cancel protections have targeted tests and identity/receipt guards. See [rollback procedure](ROLLBACK.md); automatic rollback is deliberately refused while any unknown operation, active writer, integration reservation or Actions-only deferred task is incompatible with the old scheduler.
