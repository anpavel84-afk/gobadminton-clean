# OWNER DECISION — MVP public-content moderation v001

Status: **OWNER_CONFIRMED — BINDING PRODUCT DIRECTION**
Date: 2026-10-07
Scope: GoBadminton public user-generated content
Source: direct Product Owner instruction in project chat

## 1. Goal

GoBadminton must have a minimal but real content-safety gate before wider real-user testing.

The first target is public user-generated content that can immediately affect other users:
- profile avatar / public profile image;
- public display name / nickname;
- Game title and other short public Game text that is shown in discovery;
- future Venue/Game cover images and public Venue-submission text when those upload surfaces are admitted.

The immediate risks to block include:
- explicit sexual/nude imagery;
- graphic/gory violence;
- obviously unacceptable harmful imagery covered by the selected moderation provider;
- profanity/obscene language in public nicknames and Game titles;
- contextually abusive/hateful/threatening public text where supported.

This is a preventive publication gate, not an automatic user-punishment system.

## 2. MVP provider choice

For MVP, use the **OpenAI Moderation API** as the external content classifier for supported text/image moderation.

Current official capability at decision time:
- moderation endpoint accepts standalone text and images;
- `omni-moderation-latest` supports text and image input;
- moderation endpoint is currently free for OpenAI API users.

Official references:
- https://developers.openai.com/api/docs/guides/moderation
- https://developers.openai.com/api/docs/models/omni-moderation-latest
- https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use

Architect must re-check provider capabilities at implementation admission time because external APIs/models may change.

The exact model alias/snapshot, SDK use, timeout/retry policy and policy mapping are architecture/implementation details, not Owner choices.

## 3. Profanity requires a local deterministic layer

OpenAI moderation categories are not a Russian profanity dictionary.

Therefore public nickname/Game-title moderation must include a small local deterministic profanity layer in addition to contextual external moderation.

It should be designed for Russian-first use and handle obvious evasion such as:
- case changes;
- `ё/е`;
- punctuation/spaces inserted into a word;
- common Latin/Cyrillic substitutions;
- simple leetspeak/transliteration where practical.

Do not implement naïve substring matching that creates obvious false positives inside legitimate words. Exact dictionaries, normalization rules and exceptions are implementation/policy details.

## 4. Public image publication rule

A newly uploaded public image must not replace the currently accepted public image until:
1. file validation succeeds;
2. it is decoded/re-encoded/sanitized into the canonical derivative;
3. required moderation succeeds;
4. the moderation decision allows publication.

If a new avatar fails or moderation is temporarily unavailable:
- the old accepted avatar remains public;
- the rejected/unverified candidate must not become public;
- the user may retry.

Deleting/removing existing content must not depend on the external moderation service being available.

## 5. Text publication rule

For new/changed public names/titles:
- run deterministic local profanity validation;
- run external contextual moderation where the admitted policy requires it;
- only commit the public mutation after required checks pass.

For MVP a single rejected item does **not** automatically ban or restrict the account.

Repeated abuse may later feed Trust/Admin workflows, but that is a separate policy/admission.

## 6. Scope boundary

This decision does **not** automatically require moderation of:
- private/direct messages;
- Game chat;
- all historical existing content;
- every internal/admin-only field.

Those may be added later by Product/Trust policy.

This decision is first about public profile/discovery content and public media.

## 7. Provider/data boundary

OpenAI API credentials stay server-side only.

Architecture must explicitly account for the fact that user-provided text/images are sent to an external processor:
- no secrets/client key in web/native bundles;
- minimize content sent;
- do not log image payloads/base64;
- avoid retaining unnecessary provider request bodies/responses;
- update the technical processor/data-flow inventory and public privacy disclosures before real-user public launch as required.

This Owner decision is a product/technical direction, not a legal conclusion.

## 8. Moderation policy semantics

Architect/Product should define a versioned moderation policy with at least:
- input surface/type;
- local profanity result where applicable;
- provider/model identifier;
- provider category flags needed for the product decision;
- decision: allow / reject / optional future review;
- checked timestamp;
- policy version.

Do not make long-lived policy depend solely on raw floating confidence thresholds unless separately calibrated. Provider scores may be retained only when there is a justified operational need.

## 9. Failure semantics

For **new public content**, moderation/provider failure should default to fail-closed for publication:
- do not publish unverified content;
- return a retryable user-visible state;
- preserve previous accepted content.

This does not mean fail-closed for:
- deletion/removal;
- logout;
- account safety actions.

## 10. Future evolution

The MVP architecture should leave a clean adapter boundary so that later GoBadminton can:
- add/replace a local image classifier;
- add another moderation provider;
- route uncertain content to human Admin review;
- add specialized child-safety tooling if required;
- moderate additional UGC surfaces.

Do not build a full generic media platform or ML moderation pipeline now.

## 11. Required next step

Architect must publish a bounded integration design before Implementation changes upload/publication contracts.

The architecture task must reconcile:
- current avatar storage/publication flow;
- public text mutation paths;
- OpenAI adapter/secrets/egress;
- synchronous vs queued moderation;
- fail-closed behavior;
- audit/decision persistence;
- Admin/reports extension point;
- privacy/data-flow implications;
- independent QA matrix.

This decision does not itself authorize implementation, deploy, API-key creation or production provider activation.
