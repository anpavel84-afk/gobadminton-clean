# Runner clean-root PR11 — reviewer R1 findings and targeted repair R2

Owner authorization: 2026-10-13, original Germany DEV Runner restoration; refs #4 and Friends task #12.

## Reviewer R1 (read-only, independent Codex session)
Against PR #11 clean SHA `3988f24aef0b0dcb6415ecaf050bcb67876ce9d`. The reviewer found **two P1 findings**; no SOURCE_PASS was declared:

1. `compact_pm_brief.py` imported `compact_task_capsule` missing from clean Git; startup/compile-only tests did not detect it. The module exists on the legacy original-host Runner with Git blob `54e80e11c09c13acd7478eadb36080bd733efdd5`; port its exact source as a nonauthoritative compact context supplier, not a signed QA verdict or task grant.
2. `verified_disjoint_codex` compared raw remote URL hostnames; the authorized SSH Host alias `github-gobadminton-clean` and literal `github.com` could be treated as independent Git writers to the *same* repository. Introduce strict verified Git provider/alias normalization and HOLD on unknown aliases, covering HTTPS and SSH styles, with separate distinct-provider/other-repo positive controls.

The read-only reviewer did **not** install, authorize, merge or dispatch Runner; R1 remains FAIL until a new SHA receives an independent source review.

## Narrow R2 source repair
- Add accepted legacy operational dependency `compact_task_capsule.py` (no task authority; advisory fingerprint only).
- Remove stale 551-task/P6 synthetic priorities from the clean compact PM brief; keep only the bounded Owner Friends #12 / clean DEV tasks and strict independent QA + one writer boundaries.
- Bind known `github-gobadminton-clean` / historical SSH aliases and literal `github.com` to the same provider identity for writer-conflict detection; unknown host aliases FAIL CLOSED. No SSH config, network, credential or model privilege changed by this code.
- Add executable scoped regressions for the exact reviewer failures.

## Original-host author checks (distinct from R2 independent reviewer)
On original Germany `vmi3510488`, isolated root-private source directory `/root/gb-runner-clean-qa-20261013`, real Python 3.12 Linux:
- 8 clean-root binding and path checks PASS.
- 9 existing DAG automation checks PASS.
- 8 root-owned disposable protected QA evidence/replay checks PASS.
- 5 new remote alias/other-Git conflict checks PASS.
- 4 new compact capsule import/advisory checks PASS.
- **TOTAL 34/34 PASS, exit0**, log SHA256 `22aa1a1046ce54882a47cf2a78b5ba2fbeffdca285cb20ba88118a97f2d313bc`.

Next gate: GitHub CI on new exact clean SHA, **new independent** R2 review of both P1 fixes, then original-host tightly controlled installation/signed QA evidence commissioning and first Owner-bound Friends DEV-only task; no self-approval from unit tests.

At source commit: `gobadminton-clean-runner.service` remains active, empty queue, and `prod_authorized=false`; Autopilot/Publisher remain independently paused. No PROD release, legacy queue import, canonical backlog mutation or original-host deploy is claimed here.
