# ADR-0013 — Foreground messaging updates and private contact resolution

Date: 2026-10-08. Status: SOURCE CANDIDATE — awaiting independent implementation QA and PM acceptance.
Scope: FB01 Owner observations 002/004 only. No deployment authority.

## Context and authority

Owner requested automatic incoming DM updates and contextual profile navigation.
The independently PASS-reviewed [bounded contract](https://github.com/anpavel84-afk/gobadminton/blob/a5cbd6bce89059f41334b40e736e9fdae9cc8d41/docs/workbench/architecture/fb01-review-messaging-v001/CONTRACT_V001.md)
selects REST polling and an additive private resolver. [Independent contract QA](https://github.com/anpavel84-afk/gobadminton/blob/727fb2d6eea0a78fe32a21d2d4648e0db22bf7c7/docs/workbench/qa/qa-fb01-review-messaging-v001/README.md)
accepts its readiness, not implementation or release. This records implementation of that selection rather than a new product decision.

## Options and selection

Reuse existing REST reads now. SSE/WebSocket would require separately admitted server/proxy lifecycle work.
One document coordinator owns private subscriptions, coalescing foreground events and sharing reads by actor/session generation and resource key.
DM cycles run three seconds after completion; Inbox and game cycles fifteen seconds. The Inbox response owns global counts when subscribed; header uses the counts endpoint elsewhere.
GET deadline is ten seconds, errors back off with jitter, and 429 observes Retry-After. Hidden/offline documents pause scheduled reads.
Account/session invalidation clears private caches and fences stale completions. Different tabs retain separate document owners.

DM consumes decimal-string afterSeq pages, at most four message pages per cycle, continuing immediately if necessary.
On resume and every thirty seconds, authorized descending ranges replace loaded history; merge-only caches cannot retain hidden or purged messages.
Every published authorized history snapshot, including legitimate empty history, advances the publication revision and fences all earlier in-flight pagination. Concurrent older-page publication also fences a cycle built from the preceding snapshot; the existing coordinator retries its 499 result. Older-page navigation preserves its scroll anchor. Read markers use loaded incoming messages only while foreground at the bottom.
Drafts clear on confirmed send; existing uncertain-send keys and receipt handling remain unchanged.

Authenticated `GET /v1/me/contact-state?targetPublicPlayerId=...` returns a no-store discriminated state.
It reads existing indexed pairs/memberships in one repeatable-read snapshot, including archived threads; it never creates, expires, accepts or unarchives anything.
Accepted relationships precede new-request contact policy. Block/social/account eligibility remains authoritative and denial is generic.
Public Player DTOs remain compatible and contain no private relationship state. Mutations continue to enforce existing pair locks, idempotency and optional Radar proof fences.

## Consequences and compatibility

No migration, streaming infrastructure or new public DTO is needed. Clients gain one additive endpoint.
Foreground polling costs bounded REST reads rather than push infrastructure. Server-side policy changes take effect at the next authoritative cycle; commands always recheck them.
Older DM cursor now selects the lowest descending page edge, correcting overlapping paging without changing wire fields.
Game chat retains its fifteen-second snapshot behavior through the coordinator; it does not acquire new DM consent semantics.

## Verification and rollback

Author evidence and remaining independent criteria are indexed in the task handoff.
Revert the resolver, OpenAPI projection and frontend coordinator together. No data migration or runtime rollback is involved in this source-only task.
Supersession requires a separately reviewed transport contract.
