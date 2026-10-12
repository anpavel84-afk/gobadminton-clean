# OWNER DECISION — Delta-Based Verification v001

Status: ACTIVE
Owner: GoBadminton Owner
Date: 2026-10-05

## Decision

GoBadminton switches from repetitive full-slice verification to delta-based verification by default.

The verification budget must be proportional to the change that actually occurred.

### Default rule

For an already accepted flow:

1. Verify only the changed surface.
2. Re-check a small set of critical invariants adjacent to that change.
3. Reuse prior immutable evidence for unchanged behavior.
4. Do not repeat Owner-attended/browser/manual happy paths solely to reproduce evidence that already exists.
5. Do not rerun broad suites merely because a later PM/QA stage exists.

### Full/broad regression is required only when

- a security/auth boundary changed materially;
- persistence schema or migrations changed materially;
- concurrency/authorization semantics changed;
- a prior QA failure proves broader uncertainty;
- release/deploy topology changed in a way that can affect unrelated flows;
- an explicit Owner/PM/QA gate requires it.

### OAuth application to current lane

For `auth-live-vk-yandex-v001`:

- VK live happy path on repaired runtime `56a1c958ea8e9f4f0e4448e358c394192a14c27d` is accepted from Owner-attended evidence:
  `start-ok -> me-ok -> logout-ok`.
- Yandex live happy path was already proven earlier:
  `start-ok -> me-ok -> logout-ok`.
- The VK OAuth 2.1 repair was independently QA-accepted and explicitly regression-tested the unchanged Yandex adapter behavior.
- Therefore another interactive VK or Yandex login is NOT required to close this lane.
- Final verification is limited to exact-runtime bind, evidence review, and a small fail-closed smoke set.
- No speculative fifth repair/login cycle is permitted.

### QA posture

Independent QA should prefer:
- exact immutable evidence review;
- targeted changed-surface tests;
- minimal adjacent security invariants.

It should avoid:
- duplicate browser journeys;
- duplicate broad repository suites already proven on the exact candidate;
- repeating the same negative matrix without a new code change.

This decision changes verification depth, not product/security gates. QA FAIL remains a hard no-merge for a failing immutable candidate.
