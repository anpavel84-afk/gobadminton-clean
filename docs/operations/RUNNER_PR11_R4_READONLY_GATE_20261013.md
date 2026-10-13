# PR11 R4 · enforce direct source-review READ ONLY · 2026-10-13

Independent original-host Codex review on **R3 candidate** `b1101ff7061d526f9c0b4af33e34391be47e385f` returned **SOURCE FAIL (1 P1)**, not root-signed QA acceptance: `source_review` tasks still passed `runner.validate_backlog` / `publication_guard.validate_admission_batch` with `sandbox=workspace` or `full`, allowing a reviewer to run with arbitrary writes despite purported read-only scope.

**R4 exact changes**: enforce `sandbox == "read-only"` when validating a direct source review both in Runner backlog schema and separate admission guard; extend executable regression to prove rejection of both workspace/full by both validators. Existing source_qa and release_handoff remain read-only and unmodified. The Codex CLI launched for read-only is configured with the actual `--sandbox read-only`; output-only final JSON remains a non-trusted receipt until independent root QA job is validated.

Original Germany isolated staging ran **44/44** focused tests with no failures, `exit0`; exact log SHA256 `a943b85a00bb566d638068b216769c21f3a8a1249a9247bfb4eb297d538c8ab5`. These are author checks. Independent new R4 verdict and clean GitHub CI are **pending on new SHA**. Historical R1/R2/R3 failures preserved. Do not activate previously unaccepted Runner code, old backlog, missing root writer/QA policy or production deployment.

Owner-scope DEV assignments are staged in [PR #16](https://github.com/anpavel84-afk/gobadminton-clean/pull/16), Issues #12–15, but do NOT imply real Runner task admission.
