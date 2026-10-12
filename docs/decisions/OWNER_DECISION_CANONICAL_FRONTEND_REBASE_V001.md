# OWNER DECISION — Canonical Frontend Presentation Rebase v001

Status: **OWNER_CONFIRMED — FRONTEND REBASE REQUIRED — CURRENT FRONTEND PRESENTATION NONCANONICAL**
Date: 2026-10-04
Scope: GoBadminton consumer web frontend presentation layer

## Decision

The currently implemented consumer frontend presentation is not the canonical visual/composition authority.

The accepted canonical presentation authority remains:

1. the Owner-accepted frozen Figma Make source/composition;
2. the merged Final Consumer + Social/Radar Production Design Spec;
3. the Design Director Freeze at merge SHA `487a8379ff31c88a95d0f0f130dad7c78f7af6f2`.

Existing frontend implementation work remains valuable as:
- API wiring;
- routing;
- auth/session integration;
- loading/error/unknown-result handling;
- domain-safe interaction logic;
- tested edge-case behavior.

It is **not** presentation authority where it diverges from the frozen composition.

## Required direction

Rebuild/rebase the consumer presentation layer inside the existing `apps/web` Next.js application.

Do not create a second app and do not transplant the Figma Make Vite project as production architecture.

For each surface:

- **Figma Make frozen source = composition / visual hierarchy / imagery / appearance authority.**
- **Production Design Spec + DD Freeze = responsive/production interpretation and explicit design dispositions.**
- **Current backend/OpenAPI/domain contracts = behavior/business truth.**
- **Existing web code = integration/edge-case reference, not visual authority.**

## Canonical fidelity requirements

Do not remove, simplify, replace or reinterpret a canonical visual/composition element merely because it is not itself a data authority.

Examples:
- Games discovery hero remains part of the product hierarchy;
- branded imagery/composition remains where frozen source/spec requires it;
- desktop/compact right-side map/community/promo region remains a visual composition element even if it is not business/data authority;
- branded footer remains on ordinary scrolling pages where frozen spec requires it;
- technical/internal concepts such as `authority`, `MVP`, API paths, `GET /v1/*`, `live authority`, `not-map`, implementation notes or QA terminology must never be rendered to consumer users.

Technical truth must be expressed through ordinary consumer copy, not internal engineering language.

## Current implementation disposition

Previously completed frontend code is preserved as evidence/reference and may be selectively reused for:
- API calls;
- mutations;
- intents;
- forms/state machines;
- domain rules;
- error handling;
- test cases.

Presentation markup/CSS/components may be replaced substantially when needed to restore canonical composition.

Do not preserve incorrect DOM/CSS merely to minimize diff size.

## Frontend hold

The active `OWNER_DECISION_FRONTEND_HOLD_V001` remains in force while PM plans this rebase.

Backend-only work may continue.

A later explicit PM/Owner admission may release the hold only for the bounded canonical-rebase train defined from this decision.

## Design / architecture boundary

No new Design Spec cycle is required before planning because the frozen Design Spec and DD Freeze are already sufficient.

No new Architect cycle is required for the presentation rebase because backend/domain semantics are unchanged.

Escalate only if implementation discovers:
- a real contradiction or missing rule in the frozen Design Spec → Design Director / Design Spec bounded clarification;
- a real missing or contradictory API/domain contract → Architect/Product/API bounded clarification.

Do not reopen frozen design merely because current code differs from it.

## Acceptance principle

A frontend slice is not accepted based on functional tests alone.

It must pass:
1. functional/contract QA;
2. **canonical visual/composition fidelity QA** against the frozen Make source + Design Spec + DD Freeze.

Visual fidelity QA must explicitly check presence and hierarchy of canonical components, not only colors/tokens.

## Target train

Recommended bounded sequence:

- FR-00 — canonical shell/foundation;
- FR-01 — Games discovery;
- FR-02 — Game Detail / Create / Preview / My Games;
- FR-03 — Players / Profile;
- FR-04 — Messages / Invitations;
- FR-05 — Radar;
- FR-06 — Game Chat / Inbox / content integration;
- FR-07 — integrated canonical frontend acceptance.

Exact sequencing may adapt to backend dependency readiness, but all frontend slices must derive from the same canonical presentation authority.

## Boundary

This decision does not itself deploy or mutate runtime.
