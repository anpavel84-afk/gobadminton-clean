# M0e — shared Radar layer transparency

From: source author (Codex).
To: integrator / independent QA.
Date: 2026-10-19.
Status: READY_FOR_REVIEW source only; independent QA and visual evidence UNVERIFIED.
Base: `47fa3fdeb7155de5ce1f947216b3f0ef13c8b576` (initial HEAD, branch `automation/issue-101`). Initial tracked diff empty.
Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/47fa3fdeb7155de5ce1f947216b3f0ef13c8b576

## Assignment / scope

Immutable Issue 101 M0e source_only slice, successor of #98: remove the opaque shared Radar background above the Games basemap, preserve fullscreen composition, markers, return capsule and Radar. Only four files are delivered: `apps/web/src/styles/radar-geographic.css`, `apps/web/test/radar-layer-transparent.test.ts`, `apps/web/test/games-map-basemap-visible.browser.mjs`, and this handoff. No Git metadata, commits, publication, network, dependencies, workflows, services or runtime changes authorized. No status of #98 is asserted. Publication and exact candidate permalink are for the integrator; none exists for this uncommitted source.

## Source FACT versus operator report

Source FACT: GamesVenueMap load calls setSharedMap; shared RadarPage renders `div.gb-consumer.gb-radar-layer.fr3`. The base `.gb-radar-layer` is absolute/inset 0 with pointer-events none; `.gb-consumer` supplies min-height 100dvh and background var(--c23-canvas), resolving through --gb-paper to #f5f6f2. Base lacks the more specific override.

Operator report supplied in assignment, not reproduced by author: at 390/1200 px the opaque rgb(245,246,242) layer hides streets/water although canvas has the basemap and no resource errors; temporary CSS restores visibility with markers and return control. Operator screenshots are absent from checkout. This is not new browser PASS, proof of all map issues resolved, or visual acceptance.

## Changes → coverage

- The sole product addition beside `.gb-radar-layer` is `.gb-consumer.gb-radar-layer { background: transparent; min-height: 0; }`. No component, map resource, token or other product rule changed.
- Vitest/node test reads real CSS with node:fs/promises, node:path and __dirname. A shared helper strips comments and requires both declarations within the standalone exact selector block. It tests real CSS, in-memory removal, commented rule, other/split/descendant selectors, missing properties and opaque background. No Git/history dependency, Proxy, suppressions or mocks. The fixtures are not an executed separate red-run; no red/green claim.
- Read-only future-QA browser script validates exact DEV origin and absolute local Playwright module before import/launch/navigation. Missing configuration/module/executable yields NOT_TESTED and nonzero exit; other errors yield FAIL. At 390x900 and 1200x900 it waits for ready+settled and actual layer, prints canvas/layer geometry and computed styles before assertions, and checks positive canvas size plus transparent background/no image/min-height 0px/pointer-events none for every layer. Error paths collect available diagnostics. Optional screenshots use the existing QA evidence directory in finally; screenshot errors cannot mask the original failure and browser closure is attempted regardless. No mocks, login, clicks or DOM/CSS writes. Computed styles do not prove tile contents; elementsFromPoint is not used.
- Existing lifecycle/continuity tests and all identity/focus/listener/polling/failure logic remain untouched.

## Actual command results

Commands executed separately from repository root, offline:

| Command | Exit | Result |
| --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run typecheck` | 1 | NOT_TESTED: Corepack needs unavailable pnpm-10.18.0.tgz from registry.npmjs.org; network disabled; tsc did not start. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | 1 | NOT_TESTED: same unavailable Corepack pnpm archive; ESLint did not start. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run test:unit` | 1 | NOT_TESTED: same unavailable Corepack pnpm archive; Vitest did not start. |
| `node --check apps/web/test/games-map-basemap-visible.browser.mjs` | 0 | PASS: syntax only. |
| `git diff --check` | 0 | PASS: tracked diff whitespace at execution; repeated after handoff creation. |

Browser-run: NOT_TESTED by author instruction and offline scope. No installation/download performed. No independent QA, CI, hosted runtime, acceptance or deployment result claimed. Tooling absence does not remove code/tests from delivery.

## STYLE_GUIDE_PARITY

Authority read: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`, frozen Make https://nougat-wise-76949869.figma.site/#guide / #construction-kit, and `docs/handoffs/ISSUE_76_SHARED_MAP_SOURCE.md`. External references were not loaded. Reused: existing fullscreen shared map composition, marker overlays, Radar control and return capsule. Issue 76 records reported Owner OPTION3 white/lime/violet capsule authority; this slice introduces no new visual pattern or override.

STYLE_GUIDE_GAP: no new pattern gap; referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent in checkout, as previously recorded in Issue 76. OWNER_VISUAL_OVERRIDE: no new override requested or introduced. Visual evidence and exact Make parity: UNVERIFIED.

## Rollback / continuity / next bounded action

Integrator removes only this four-file diff; base remains unchanged. No runtime rollback required for this source-only result. Preserve historical independent findings; this author check is not independent QA.

One next bounded action: after delivery of the candidate, independent QA uses preinstalled Playwright and its browser with `GB_MAP_ORIGIN=https://dev.gobadminton.ru`, an absolute `GB_MAP_PLAYWRIGHT_MODULE`, and optionally an existing `GB_MAP_EVIDENCE_DIR`, then runs `node apps/web/test/games-map-basemap-visible.browser.mjs`. In the same bounded QA review, visually verify streets/water, markers, attribution and return at 390/1200 px, and execute the pending source checks with ready tooling. This is future evidence, not a source gate. Integrator supplies publication/exact candidate permalink.
