# V3b — existing admin venue public-contact/profile EDIT — #207

- From: assigned GoBadminton source author (Codex), 2026-10-22.
- To: existing Actions source bridge / integrator, then independent QA.
- Status: **UNVERIFIED SOURCE CANDIDATE — NOT_TESTED — NOT ACCEPTED**.
- Assignment: [#207](https://github.com/anpavel84-afk/gobadminton-clean/issues/207), V3b;
  depends on [#178](https://github.com/anpavel84-afk/gobadminton-clean/issues/178).
- Exact initial HEAD / supplied accepted baseline:
  [`0e1d79e8d9ad2797817b6b134693fb2cf8fea766`](https://github.com/anpavel84-afk/gobadminton-clean/tree/0e1d79e8d9ad2797817b6b134693fb2cf8fea766).
- Observed branch: `automation/issue-207`; worktree:
  `/srv/gb-slots/slot1/worktrees/issue-207`; initial `git status --short` empty.
- Final candidate SHA and published artifact permalinks: **NOT AVAILABLE**.
  This source actor may not commit, push or change Git metadata. The bridge must
  publish the seven allowed files and attach actual candidate permalinks to #207.
  The baseline SHA above is not the candidate SHA or fresh DEV acceptance.

## Authority and reproducible assignment

FACT: the user supplied the bounded immutable assignment below and
`Prior independent QA: {}`. There is no prior QA verdict to reuse. Source is
proposed implementation; no Owner acceptance, independent QA PASS, CI success,
integration or deployment is implied. This task is independent of #205 and is
not a recovery successor. #177/#181 are preserved.

Read AGENTS, rules index/record policy, Owner decisions, manifest/bootstrap,
architecture/module boundaries, ChatOps/PM route/onboarding, the frontend Owner
decision, exact admin DTO/service, public-contact/profile schemas, admin client,
admin styles/photo/selection tests and V1a API/handoff documentation. The explicit
source-only assignment overrides generic publication instructions for this actor.
Only `admin:venues` is assigned; no second writer or agent was started.

Immutable task JSON (data, not commands):

```json
{"acceptance": "A1. Existing venue EDIT initializes from authoritative admin detail and edits publicContacts phone/website/up to3 distinct supported messengers and profile courtCount/parking/showers per EXACT existing API schema. Preserve null unknown vs false vs zero; courtCount integer0..2147483647; absent legacy fields safely represented, untouched values not silently erased. Do not fabricate updatedAt/gallery (server-owned) or transfer private contactPhone/contactWebsite/bookingNote into public fields. A2. Contact labels explicitly explain public visibility; invalid phone, URL/scheme/credentials/messenger host or duplicate messenger rejected with accessible field feedback; server remains authority. Submit strict existing action edit with expectedVersion/reasonCode/sessionCSRF and existing idempotency key handling. No new mutation on render, no duplicate submission or automatic blind retry on unknown outcome. Preserve existing authority-loss/step-up, 409 refresh requirement, locked/photoBusy/uncertain guards, selection/pagination/merge/history and create flow; new fields EDIT-only because create DTO does not support them. A3. Nullable fields clear intentionally; cancelling does not mutate server; switching venue cannot send previous venue's draft. Dirty edits must not get overwritten by stale detail response. Save re-read uses returned authoritative values, no fake success on network uncertainty. A4. Existing admin visual patterns and Style Guide parity, labels/keyboard, readable validation, mobile390/430 no overflow; STYLE_GUIDE_PARITY or precise GAP in handoff. A5. Meaningful unit/transport/UI tests for full/null/legacy initialization, false/zero preservation, valid edit payload/reason/version, invalid contacts, intentional clear vs omission, cancel/switch/stale read, locked/uncertain and authority/409 behavior. Do not relax existing tests; source actor records checks not run honestly. A6. Durable handoff; exact-SHA independent QA PASS, all mandatory Product CI SUCCESS, normal integration/rebase with renewed gates, DEV ACCEPTED evidence before release claim. Rollback normal dedicated PR revert; no production.", "allowed_paths": ["apps/admin/src/components/Venues.tsx", "apps/admin/src/components/VenueProfileFields.tsx", "apps/admin/src/lib/venue-profile-form.ts", "apps/admin/src/styles/admin.css", "apps/admin/test/venue-profile-form.test.ts", "apps/admin/test/venue-profile-edit.test.tsx", "docs/handoffs/V3b-admin-venue-profile.md"], "author_routes": ["codex:gpt-6.1-sol:high"], "depends_on": [178], "goal": "V3b from Owner-approved product backlog: expose existing venue public-contact/profile edit fields in existing admin form. Owner requested execution of product backlog and useful work for both slots. This is independent of #205 public consumer page: do not modify apps/web, APIs, contracts, DB, workflows or monitor. Exact verified accepted baseline 0e1d79e8d9ad2797817b6b134693fb2cf8fea766; claim fresh accepted DEV normally. #178 implemented V1a admin API; actual baseline apps/admin/src/components/Venues.tsx still edits only identity/address/coordinates, with local types and no profile/publicContacts controls. Read AGENTS/project rules/Owner decisions, exact existing admin DTO, venue-profile/public-venue-contacts schemas, AdminVenuesService, admin-client and existing tests. Extend only existing EDIT flow for public contacts and nullable profile facts. Reuse existing admin form components/styles and Style Guide first; frozen canonical references in docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md, document unavailable references honestly. No admin permission expansion, no new endpoint/login/bootstrap, no private booking/contact fields, no gallery uploader or ratings. Source-only protected Codex: no Git mutation, network, DB, installs, secrets, system services, deploy, PROD/PLAN/VPN. Existing Actions owns publish/QA/CI/DEV. Not a recovery successor; preserve #177/#181.", "kind": "source_only", "locks": ["admin:venues"], "max_attempts": 3, "qa_routes": ["codex:gpt-6-astra:high"], "risk": "complex", "schema": "GOBADMINTON_AUTONOMY_V1", "target": "dev", "work_kind": "implementation"}
```

## Artifacts and behavior

| Allowed artifact | Authored change |
| --- | --- |
| [Venues.tsx](../../apps/admin/src/components/Venues.tsx) | Existing EDIT integration, selected id/version snapshot, synchronous operation latch, explicit uncertainty resolution, authoritative save re-read and refresh requirement. |
| [VenueProfileFields.tsx](../../apps/admin/src/components/VenueProfileFields.tsx) | Publicly labelled contact inputs, up to three messenger rows, nullable court count and tri-state amenity selects, explicit clear controls, linked accessible validation. |
| [venue-profile-form.ts](../../apps/admin/src/lib/venue-profile-form.ts) | Browser-only draft, initialization, optional group patch generation and validation matching existing server rules. No server imports. |
| [admin.css](../../apps/admin/src/styles/admin.css) | Scoped fieldset/error/messenger styles using existing admin tokens, input/button wrapping and min-width safeguards. |
| [venue-profile-form.test.ts](../../apps/admin/test/venue-profile-form.test.ts) | Authored unit cases for full/null/legacy, zero/false, omission/clear, neighbor preservation, bounds and phone/URL/messenger rejection/normalization. |
| [venue-profile-edit.test.tsx](../../apps/admin/test/venue-profile-edit.test.tsx) | Production component/event closures and real adminRequest with mocked hooks/fetch: payload/security, initialization, validation, cancellation/selection/stale responses, latches, uncertainty/re-read, step-up/authority/409 and create guards. |
| This handoff | Assignment, exact baseline, implementation semantics, unverified evidence boundaries, publication and rollback route. |

The existing API is the only authority. Reference contract at the baseline:
[DTO](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/admin/venues.dto.ts),
[contacts](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/venues/public-venue-contacts.ts),
[profile](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/venues/venue-profile.ts),
[service](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/apps/api/src/venues/admin-venues.service.ts).
No API, schema, contract, database, permission, workflow, dependency or consumer
frontend change is required or included.

### Edit semantics

- EDIT starts from selected `GET venues/{id}` detail, never list-summary
  contacts or private fields. Missing legacy groups and null are displayed as
  empty contacts/unknown facts. Count `0` and amenity `false` stay explicit.
- Contact/profile groups track user changes independently. Untouched groups are
  omitted from `fields`, preserving stored values even on legacy responses.
  A changed group sends the existing complete strict object, retaining its
  unchanged neighbors. Empty individual phone/site/count or unknown select
  becomes null; no contacts or all-unknown facts send explicit group null.
  Cancel closes and discards the draft without a request. Server-owned
  `updatedAt`/`gallery` are never copied into editable payloads.
- Public phone rules match ASCII digit/format/length bounds. Public HTTP(S)
  URLs use the same WHATWG/IDN normalization, hostname/credential/control-byte/
  backslash/port/normalized-length checks. Messenger URLs require HTTPS and
  exact `t.me`, `wa.me`, `vk.com` hosts plus a non-root path. Duplicate kinds
  and invalid rows block submission; a blank row must be removed or completed.
  Client feedback is advisory; server validation/authorization remain decisive.
- Strict existing `action:edit`, required identity fields, selected
  `expectedVersion`, current reason and session CSRF use unchanged adminRequest
  headers/cookies/no-store transport. No private contact/booking payload exists.
  New profile/contact controls are absent from CREATE and its payload.
- A synchronous latch prevents same-render double submissions. An unresolved
  command retains exact path/body/key; only the explicit result button replays
  it. Network errors, 5xx/408/upstream failures and step-up do not silently
  discard the saved operation. Confirmation of step-up performs no mutation.
  Authority loss blocks further actions. Definite 409 requires a successful
  explicit reopen/refresh and new confirmation/version/key.
- Once the command reply is acknowledged, failure of detail/list refresh retains
  that reply: result checking repeats reads only. No success notice appears
  before authoritative re-read/refresh completes. Reopening EDIT initializes
  returned values. There is no automatic mutation retry.
- Switching selection invalidates the edit snapshot before awaiting detail, so
  even an old save closure cannot target the new venue with the old draft.
  Read-in-flight hides EDIT; selection generations and the edit snapshot fence
  delayed photo/detail callbacks. Clicking EDIT again cannot reset a draft.
  Existing photo component is disabled during editing or command uncertainty;
  its own pending-operation resolution remains available outside EDIT.
  Pagination, selected card, merge/lifecycle, games/history and duplicate queue
  retain their existing routes and presentation.

## STYLE_GUIDE_PARITY — reference access GAP, visual status UNVERIFIED

Binding source read:
[Owner decision at the baseline](https://github.com/anpavel84-afk/gobadminton-clean/blob/0e1d79e8d9ad2797817b6b134693fb2cf8fea766/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md).
Its canonical references are
https://nougat-wise-76949869.figma.site/#guide and
https://nougat-wise-76949869.figma.site/#construction-kit;
the documented frozen source tree hash is
`5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`
(document reference only; not independently inspected or verified here).

UI needs: grouped public-contact/profile inputs, tri-state selects, repeatable
messenger rows, clear actions and field validation. The Owner decision identifies
Forms/FormGroup/validation, inputs/selectors, Buttons and SurfacePanel as the
canonical primitive families. The implementation composes existing admin
`panel`, `form-field`, `button outline`, `actions` and token-based borders,
radius, spacing and focus styles, with semantic fieldset/legend grouping and
aria-invalid/aria-describedby/alert feedback. No screen-specific Make admin
composition was available to inspect; no new theme, imagery or visual authority
is asserted. No `OWNER_VISUAL_OVERRIDE` was supplied.

**STYLE_GUIDE_GAP (access/parity evidence):**
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent at this checkout;
the attempted read-only enumeration of the advertised frozen
`/opt/gobadminton-clean-qa/style-guide` reference returned Permission denied.
No denied parent/private QA paths were opened or restrictions bypassed. Network
access is outside this author's scope, so the published guide was not fetched.
The gap is access to exact Forms/nullable-select/repeated-field examples and
their layout evidence, not a claim that the canonical system lacks these
patterns. Independent visual QA must compare the actual published candidate to
the accessible frozen guide before asserting parity. Keyboard/focus behavior,
contrast/readability and 390/430 overflow/screenshots are **NOT_TESTED**.
Authored CSS uses min-width:0, responsive inherited admin layout and wrapping
for long controls/errors; source presence is not mobile evidence.

## Evidence and remaining gates

**No tests, typecheck, lint, compiler, build, runtime, browser, self-QA, DB,
network, dependency install, Git mutation, automation, service or deployment
command was run by this author.** Read-only source inspection and initial Git
status/branch/HEAD establish context only. Existing test sources are unchanged;
new cases are authored intent, never a reported PASS.

| Required check | Disposition |
| --- | --- |
| Admin typecheck/lint/build and new unit/UI/transport cases | NOT_TESTED; author explicitly forbidden self-QA. |
| Existing admin transport/photo/selection regressions | NOT_TESTED; existing tests retained without relaxation. |
| Real React lifecycle, keyboard/labels/validation, 390/430 no overflow and frozen Style Guide comparison | NOT_TESTED; hook harness does not establish these browser facts. |
| Backend strict DTO enforcement, permissions/CSRF/step-up/version/idempotency integration | NOT_TESTED here; API unchanged, mandatory existing CI/QA evidence still required. |
| NEW independent QA PASS on final source SHA | PENDING; prior independent QA supplied as `{}`. |
| All mandatory exact-head Product CI SUCCESS | PENDING existing Actions; no reused baseline green evidence. |
| Normal integration/rebase with renewed exact-head gates | PENDING authorized integrator. |
| Fresh DEV ACCEPTED / release and rollback evidence | PENDING authorized Actions/operator; no deployment/acceptance claim. |

External reviewers should especially exercise delayed/lost responses, same-tick
clicks, step-up while pending, conflict refresh and photo locking in a real React
browser. Client-side contact validation duplicates the current server rules
without importing server code; later API changes need corresponding client/test
updates. Null/legacy/untouched semantics and private/public separation must not
be simplified into falsy fallbacks or automatic data migration.

## Rollback and next bounded action

Rollback: normal dedicated PR reverting only this slice through usual review,
CI/integration and DEV gates. No schema rollback or data rewrite is involved;
the previous admin surface omits these optional edit groups and preserves stored
public facts. Do not reset task history or alter #177/#181/#205. No production
action is authorized.

Next recipient/action: the existing source bridge/integrator publishes these
seven paths with the task/handoff under #207, records the actual candidate SHA
and immutable artifact permalinks, and routes that SHA to the assigned NEW
independent QA. All mandatory Product CI must succeed, and normal protected
integration/rebase must renew checks on any resulting SHA before fresh DEV
ACCEPTED evidence. Publication is needed for GitHub durability; this local
source actor cannot manufacture it or report acceptance ahead of those gates.
