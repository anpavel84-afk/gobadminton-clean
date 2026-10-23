# #218 source proposal — prospective failure diagnosis

This change prepares the existing Actions train. It does not install, activate a provider, rewrite an admission, replay an operation or demonstrate runtime readiness.

New immutable source admissions may explicitly include:

```json
"failure_diagnosis": {
  "schema": "GB_FAILURE_DIAGNOSIS_218_V1",
  "route": "codex:gpt-6-astra:high",
  "max_calls": 3
}
```

The admission owner chooses a finite cap from 1–3. It is separate from, and never increases or resets, max_attempts. Existing admissions without this field retain their exact behavior. In particular, #207 and #225 are not enrolled. A reviewed prospective activation must update the new-task producer/admission validation to require the supported policy and an explicitly authorized finite budget. This proposal supplies the closed protocol mechanism; it deliberately invents no default budget or time epoch and does not amend historical bodies/comments.

For opted-in tasks with a remaining author attempt, a semantic exact-SHA QA FAIL or recognized exact CI source failure plans a separate failure_diagnosis stage. Exact CI job/check identity, full-log digest and bounded assertion excerpts reuse #185 evidence collection. Explicit infrastructure/auth/quota/transport/unknown evidence blocks source diagnosis/repair. Findings about authentication source behavior remain source findings. Ambiguous or missing evidence is not accepted as a repair.

The stage uses the existing qualified Codex QA permissions, native model_command, no automatic candidate/user rules, full trusted accepted rules, ephemeral new session, disabled network/MCP/hooks/apps and read-only candidate. It forces gpt-6-astra/high regardless of ordinary author/QA cost routing; no downshift. Logical role and context receipt say failure_diagnosis; permission/billing role remains qa. Existing slot leases, worker lock and receiver write-ahead operation journal remain authoritative.

Before the external call the active checkpoint durably records the fingerprint, exact inputs, separate consumed call count and pending status. A crash or malformed/unavailable outcome cannot automatically replay that fingerprint. No new daemon, queue, receiver identity or generic successor permission is added. Unknown stages remain unknown in the existing operation journal. A provider refusal is visible and cannot silently select another model.

A successful brief binds task/admission data, candidate/base, attempt/integration, exact failure/findings/logs, prior repair history and accepted rules. It records diagnosis/confidence, exact evidence citations, bounded changes/paths, regression tests, risks, missing inputs, admitted author route recommendation and recheck criteria. Only a complete source_defect brief opens content repair; environment/insufficient outcomes remain blocked. Cached identical results consume no second call. Changed candidate/findings/evidence/rules invalidate the brief. New author candidates still require fresh independent QA and CI; diagnosis never certifies acceptance.

Exhausted author tasks retain ordinary DEFERRED and exact #185 eligibility/lineage/global limits. No call is added solely to extend an exhausted author. For opted-in parents the existing #185 diagnosis reuses an exact matching Astra brief or consumes the same inherited #218 cap before a separate Astra High call, as well as #185's existing one-diagnosis reservation. Exhausted #218 budget blocks an extra recovery call. The certified #185 successor claim inherits the updated consumed #218 calls and prior briefs; it cannot replenish this cap. Historical #185 routes are unchanged. #185 source eligibility, delegation, one-successor decision and author limits are unchanged.

Monitor projection adds QA/CI FAIL, ASTRA DIAGNOSING/UNKNOWN/BLOCKED, REPAIR BRIEF READY, AUTHOR REPAIR and QA/CI details without changing phase enums or the seven-stage UI. Receipts retain requested/effective model/effort, call usage (unknown tokens/money remain null), rules context, failure fingerprint and brief hash.

## Validation and rollout boundary

Focused offline fixtures cover semantic QA and exact-log CI failures, prior-brief refinement, identical cache reuse, candidate/findings/log changes, infrastructure refusal, authentication source findings, finite caps, exhausted author behavior, unavailable Astra, durable unknown/no replay, closed admission/wire validation and independent slots. Existing train/recovery tests remain required because shared stage planning and model context plumbing changed.

Review exact commit and manifest/PINS; run mandatory hosted CI and independent source review. Install only through the existing reviewed controller path at a safe operation boundary, with the revised manifest and workflow/controller pins. Do not hot-swap a pending model operation. Only then qualify the separate role with one real authorized QA FAIL/repair cycle and one real CI FAIL/repair cycle, crash/unknown recovery evidence, and exact receipts. Do not manufacture source failures or deploy known bad code to claim a canary. No provider, installed-controller, DEV or whole-team READY claim follows from offline tests.

## PR227 routing compatibility in this source candidate

Existing AGY qualification/one-call canary remains Sonnet Medium. Native ordinary QA accepts only the closed existing catalogue IDs claude-sonnet-5-5-medium, claude-sonnet-5-5-high and claude-opus-5-5-high, threads the requested ID into argv, requires the same exact initialization model, and records requested/effective ID with null effort (effort is encoded in the ID). Existing ready markers without admitted_models admit Medium only. A future reviewed root marker may explicitly list admitted_models from the Owner-authorized catalogue; canary remains Medium only. The one Medium provider canary qualifies the executor protocol. High/Opus actual use is proven only by each later real QA receipt, with no extra per-model canary or startup probe. No provider call, runtime marker edit or claim of High/Opus runtime PASS occurs here.

For explicit GB_STAGE_COST_V2 preferred routes, complex QA prefers Sonnet High and critical QA prefers Opus High. An unavailable critical Opus route has no automatic Sol High or Astra ordinary-QA substitute; separate exact-risk qualification is not established by listing a fallback. UI-S Cursor can use an explicitly admitted Sol Medium fallback when unavailable; no route is added to an admission. Historical scalar/V1 routing remains unchanged. Gemini research remains unsupported by this source-only author/QA protocol and must not receive a pseudo-source admission. Existing event/wake/attention workflows are reused, with no new scheduler.
