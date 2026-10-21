# Venue popup owner fixes — source handoff, refs #156

- From: source author (Codex).
- To: integrator / independent QA and visual reviewer.
- Date: 2026-10-22.
- Status: READY_FOR_REVIEW_SOURCE_ONLY; checks requiring dependencies and visual parity are NOT_TESTED. This is not an independent QA verdict, merge approval, deployment or Owner acceptance.
- Assignment: immutable `GOBADMINTON_AUTONOMY_V1`, `source_only`, target `dev`, supplied in this session. A–D are PM_REPORTED requirements. Issue association and absence of earlier source attempts are PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW. Prior independent QA input was `{}`.
- Exact base and unchanged HEAD: `4977074ee7b45ea612dde592b88b354d99839aea`.
- Observed branch decoration: `automation/issue-156` (also `automation/issue-152` at the same HEAD). Initial tracked diff was empty. No external writer/lock service was accessed; task declares locks `web:venue-popup`, `web:game-create`.
- Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/4977074ee7b45ea612dde592b88b354d99839aea
- Execution deviation: the initial read-only `git rev-parse --show-toplevel` (exit 0, task worktree path) was outside the task Git command whitelist. It did not mutate metadata. Subsequent Git commands used only log/diff. This deviation is recorded rather than claiming perfect command adherence.
- Exact candidate commit/permalinks: integrator must add after capturing these source bytes. No commit, push, Git metadata mutation or publication is authorized for this author.

## Scope and source changes (D1 / A–D)

Six existing files changed:

1. `apps/web/src/components/consumer/games/VenueSheet.tsx`: exports and uses `VenueSheetGameRow`, with `GameCover`, time, title, levels, organizer `Avatar`, seats and one native button. No duplicated cover URL policy; `GameCover` and `VenueCover` are unchanged. Existing `coverSlot`, sheet dimensions and 16:9 info photo remain.
2. Same file exports and uses `VenuePublicContacts`: one heading, honest empty state, validated hostname, phone and whitelisted messengers, outlined rows and decorative inline SVG. Telegram/WhatsApp share a row when both exist. Original `hasForbiddenContactCharacters` / `contactUrl`, normalization, whitelist, deduplication, rel/target and independent handling of damaged fields remain. Only `venue.publicContacts` enters this block; no private/booking fields or invented venue facts are added.
3. Same file opens `CreateGamePage` locally with a button only for `gamesReady && games.length === 0`. Create survives empty days, game refreshes and unavailable schedules. Its React key includes popup venue city and ID. Header back and embedded cancel return to info; popup close retains the original collapse action. Draft selection has no map/camera callback. No polling or game-fetch code changed.
4. Same file adapts the existing capture handler, with no second handler: defer to `.gb-venue-picker` / `dialog[open]` before Escape or Tab; include visible enabled button/link/input/select/textarea/tabindex targets, exclude negative tab indices, disabled/aria-disabled, hidden inputs, hidden/inert ancestors, invisible or unrendered controls. Body scroll/focus restoration and popup drag implementation remain in place.
5. `apps/web/src/components/consumer/pages/CreateGamePage.tsx`: optional `embedded`, `initialVenue`, `onClose`, including default argument for `CreateGamePage()`. The controller feeds the exported, actually used `CreateGamePresentation` for both route and popup. Full route retains ConsumerShell, navigation and venue links. Embedded omits them, uses the existing picker, and preview GameTerms returns to form/picker through a local action. Photo selection stays mounted across preview/edit. Publication and recovery use the existing auth, CSRF, validation, mutation guard, session epoch and photo pipeline. Results remain local with explicit game/summary links and a local return button. Auth/setup continue explicitly through encoded `venueCreatePath` and existing safe-return helpers; there is no auth bypass.
6. `apps/web/src/styles/venue-popup.css`: local contact/media composition and embedded single-column fields, preview and actions at popup420; mobile action bar is static inside the popup. Existing popup geometry is retained. Minimum controls are 44px; overflow/rendering requires visual validation.
7. `apps/web/test/venue-public-contacts.test.tsx`: original harness/security assertions retained; visible text expectations updated for SVG/hostname and empty labels.
8. `apps/web/test/venue-sheet.test.tsx`: original harness retained, with extracted-row traversal and DOM visibility/modal fixtures. Adds assertions for modal deferral, excluded focus targets and create identity/persistence. Existing focus, cleanup, drag and interaction assertions remain.
9. `apps/web/test/create-game-venue-cta.test.tsx`: original auth/city/no-write harness retained; traverses shared presentation, enters via the local button, tests initialVenue auth/setup return independently of unrelated query, and keeps full-route catalog/city tests.

Three files created (D1):

- `apps/web/src/lib/venue-popup-create.ts`: production pure `initialCreateVenue` and `selectCreateVenue`, used by the controller. A valid same-city prop takes priority even before catalog load; invalid/foreign/null explicit prop blocks query fallback. Route query resolves only against same-city catalog. Manual selection, manual empty picker and new-venue mode are not overwritten by catalog/refresh.
- `apps/web/test/venue-popup-owner-fixes.test.tsx`: real React SSR production row/contacts/presentation and production pure selection tests. No React/hooks/component mocks, fake renderer, source-file string assertions, skips or suppressions. HTML assertions inspect actual rendered markup/text. Real Next PathnameContext supplies SSR route context.
- This handoff.

The counts above describe logical changes; only the nine allowed paths are edited. No API/contracts/migrations/dependencies/config/workflows/control documents/map loader changes. No network, install, deployment, DB/admin/runtime/service/PROD/PLAN/VPN work.

## D2–D3 coverage and limits

New SSR cases cover game → venue → regular/trainer fallback; invalid media paths; organizer avatar distinct from game media; time/title/levels/seats; one button and no nested buttons/anchors. Contacts cover null/empty/malformed/unsafe/valid data, private field exclusion, safe neighbors, normalized hostname/phone, messenger hosts/order/dedup and rel/target. Shared presentation covers full/embedded form and preview, new-venue fields, photo readiness, validation text, publication/recovery results, and default route SSR.

Pure helper cases cover prop > query, invalid/foreign prop without query fallback, late same-city route catalog, manual and new-venue choices, refresh stability, and encoded safe return path. These are authored coverage, not executed evidence: Vitest was unavailable. SSR cannot validate events/effects, focus, dialog portals, uploads, authentication or publication. The three retained historical harnesses use their existing hook mocks; this limitation does not apply to the new SSR file and does not count as independent/browser QA.

## D4 author validation commands

All commands ran offline from the task worktree. No dependency installation or fallback network execution was attempted.

| Exact command | Exit | Observation/status |
| --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 254 | NOT_TESTED: `Command "tsc" not found`. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | 1 | NOT_TESTED: `eslint: not found`, `spawn ENOENT`; pnpm reports local `node_modules` missing. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-popup-owner-fixes.test.tsx test/venue-public-contacts.test.tsx test/venue-sheet.test.tsx test/create-game-venue-cta.test.tsx` | 254 | NOT_TESTED: `Command "vitest" not found`. All four test files remain in the candidate. |
| `git diff --check` | 0 | No tracked diff whitespace errors. |
| `git diff --no-index --check /dev/null apps/web/src/lib/venue-popup-create.ts` | 1 | No whitespace diagnostics; new-file difference against `/dev/null`. |
| `git diff --no-index --check /dev/null apps/web/test/venue-popup-owner-fixes.test.tsx` | 1 | No whitespace diagnostics; new-file difference against `/dev/null`. |
| `git diff --no-index --check /dev/null docs/handoffs/venue-popup-owner-fixes.md` | 1 | No whitespace diagnostics; new-file difference against `/dev/null`. |

The unavailable dependency commands were not repeated after source edits: the missing executables remain the limiting condition, so these commands must run on the exact integrated candidate in CI/QA. No test execution or type/lint success is claimed.

## D5 STYLE_GUIDE_PARITY

Read in-repository: `AGENTS.md`, `docs/rules/README.md`, `docs/rules/PROJECT_RECORD_POLICY.md`, Owner decisions/manifest/bootstrap/architecture/module boundaries, ChatOps/PM route and onboarding, plus:

- `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`.
- `docs/decisions/OWNER_DECISION_MAP_POPUPS_V001.md`.

`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent at base (`No such file or directory`). The required read-only replacement and its provenance were attempted, but the active filesystem sandbox returned `Permission denied`. The same applies to frozen App/CSS and all three supplied audit reports. No denied path was bypassed, copied from another host or treated as an operative historical source.

| UI → frozen reference | Family → production mapping | Parity status |
| --- | --- | --- |
| Map popup → frozen `#construction-kit` Drawer / BottomSheet; screen-specific map reference in Owner decision | Existing sheet/popup shell and `coverSlot`; local embedded content in VenueSheet | UNVERIFIED: frozen source unavailable; actual popup retained as bounded source baseline, not visual authority. |
| Schedule row → frozen ListRow + MediaBlock | `VenueSheetGameRow` + unchanged `GameCover` and `Avatar` | UNVERIFIED: exact frozen row composition not observed. |
| Contacts → frozen ListRow/buttons | `VenuePublicContacts`, outlined local rows, decorative SVG, messenger pair | STYLE_GUIDE_GAP VP-CONTACT-COMPOSITION: proposed bounded contact/icon arrangement required by PM; exact availability/parity in frozen kit UNVERIFIED, not a claim that the kit lacks primitives. |
| Embedded create → frozen FormGroup / Validation, FormActions / StickyActionBar | Shared `CreateGamePresentation`, unchanged form/photo/action primitives; popup CSS constrains columns and actions | STYLE_GUIDE_GAP VP-EMBEDDED-CREATE: proposed bounded popup420 adaptation of existing form families; exact frozen popup-create composition UNVERIFIED. |

Required read-only operative references (expected checksums supplied by assignment; actual bytes/checksums NOT_VERIFIED because access was denied):

- `/opt/gobadminton-clean-qa/style-guide/src/App.tsx`: SHA-256 `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`.
- `/opt/gobadminton-clean-qa/style-guide/src/index.css`: SHA-256 `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`.
- `/opt/gobadminton-clean-qa/style-guide/refs/FRONTEND_STYLE_GUIDE_FIRST_V001.md`: SHA-256 `d0339e1505047a4080d3eb7e7b95c23a034cfc8333623c550bb55c035d689fb9`.
- Adjacent `FRONTEND_STYLE_GUIDE_FIRST_V001.provenance.json`: unavailable. Archived host paths/SHA inside it are provenance only, never substituted as operative inputs.

No OWNER_VISUAL_OVERRIDE is known or claimed. No external screenshot/image was used as an input. #147 is historical provenance only. Exact frozen contact glyphs, screen-specific popup/create composition, rendered sizing, live public contact data, venue/game covers and organizer avatars are unavailable/unobserved; fixtures do not represent observed live data. Rating 4.8, gallery 1/4, court counts, parking/showers and private/booking contacts are not fabricated.

| Required observation | Status |
| --- | --- |
| Rendered mobile 390px and 430px, desktop viewport 1440px; popup420; no horizontal overflow; touch targets | NOT_TESTED: no browser/rendering session. |
| Info photo/16:9/coverSlot and game/venue/default photo behavior | NOT_TESTED visually; SSR test authored but not run. |
| Focus wrap/visibility/restore, scroll, picker portal/native dialog, drag cleanup | NOT_TESTED in browser; retained harness not run. |
| Auth/setup return, local create/cancel/close, preview/edit/photo preservation | NOT_TESTED interactively. |
| Publish/duplicate-submit/session invalidation/recovery/local return | NOT_TESTED against API/runtime; not authorized in source-only task. |
| Draft venue choice and popup/map/camera independence; polling continuity | NOT_TESTED interactively; no map/polling source edits. |

Separate merge/CI, independent behavioral QA and frozen-guide visual gate are required. Source completion does not clear those gates.

## D6 historical reviews and assignment bounds

These identifiers/mappings come from assignment DATA, not independently inspected reports or prior source candidates. The relationship to #156, and the statement that no earlier source attempts exist, remain PM_REPORTED / UNVERIFIED_BY_THIS_REVIEW. a1/a2 are prompt reviews, not code QA. Historical code and historical PASS claims were not checked, and no prior verdict is transferred.

| Historical reference | Reported finding → current acceptance mapping |
| --- | --- |
| #156 a1 `1298a029` | stale base → D1; missing guide → D5/snapshot; old-test prohibition/scope → D2; parity ambiguity → D5; history labels → D6; auth/picker → D3; CREATE paths → D1. |
| #156 a2 `533275e2` | IDs/mapping → D6; old mocks → D2; guide/archived SHA → D5/snapshot (provenance only); acceptance >3500 → D6; screenshot override → D5; non-self-contained target → D1/A–D. |
| #156 a3 `de5a3186` | incomplete IDs/relationships → D6; fixture adaptation prohibition → D2; goal5357 → D6. |

Supplied report references, all unreadable in this sandbox: `refs/venue-popup-review1.txt` (`1a73c92d`), `refs/venue-popup-review3.txt` (`90932ca3`), `refs/venue-popup-review4.txt` (`f9035ef4`), under the read-only guide directory above. Availability was PM_REPORTED; actual reads failed with `Permission denied`. Their abbreviated identifiers are not verified digests here and are not assumed to map one-to-one to the prompt IDs above.

The supplied goal/acceptance text was counted as decoded Unicode characters (including newlines): goal **4985 <= 5000**, acceptance **3373 <= 3500**. This is an assignment-bound check, not a code verdict. Final source bytes need a new digest and a new independent review.

## Source byte manifest and continuity

SHA-256 for the eight code/test artifacts (handoff excluded to avoid a self-referential hash):

```text
9094519444047e80fac66604cee4a4e61924e5d2a63ef3524d09bdeff49d502e  apps/web/src/components/consumer/games/VenueSheet.tsx
6e5f5c3456cef5f029d548dcb8345974519ac89a194386f2f334cdcf382981ea  apps/web/src/components/consumer/pages/CreateGamePage.tsx
77c4d0964be5e9cbbabd6a2527f9eacb16ae1602380ba29a8b68cc5f266770e0  apps/web/src/styles/venue-popup.css
7bed1e547431e301beb637b4e12940a20e15cbb47e30f96ed90e3e0935a227c6  apps/web/src/lib/venue-popup-create.ts
a9931d0025ac16de34cb802e97f9eba1c76019dfbc705d3e9625e214bfa8a0ca  apps/web/test/venue-popup-owner-fixes.test.tsx
96cd10ec1051adbe7b58143ac88463be8ac351c79866045049f186b98cd85284  apps/web/test/venue-public-contacts.test.tsx
36c8cdbf0213bcfce7846cbea2a38f1b0e6d480c03d59a0680a09b22d2bf6801  apps/web/test/venue-sheet.test.tsx
741611ed0a45d6e458a14d2b546c279838c6e58b006dca7f3640e5f6bdf34b8a  apps/web/test/create-game-venue-cta.test.tsx
```

Integrator must capture all nine paths, including the three created/untracked artifacts. Ordinary tracked-only `git diff` omits new files until the integrator captures them. For the final nine-file digest: sort relative POSIX paths lexicographically; for each compute SHA-256 of its bytes; hash the UTF-8 concatenation of `hex_digest + "  " + relative_path + "\n"`. Recompute on any byte change, including this handoff. Do not carry this source manifest forward after changes.

Next bounded action: integrator captures these bytes into a reviewable Git candidate, adds exact permalinks, and routes that exact candidate through D4/independent QA and the frozen-guide visual gate before any manual dev merge. Publication and CI are integrator effects, not facts established here.

Rollback: integrator applies the inverse candidate diff against the exact captured base, including removal of the three new files, preserving any later unrelated changes. No force push, reset or runtime rollback is performed by this author.
