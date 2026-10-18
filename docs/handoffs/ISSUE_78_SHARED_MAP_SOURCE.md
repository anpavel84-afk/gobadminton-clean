# Issue 78 — Issue 76 candidate reuse and A1 compatibility fixes

From: source author. To: authorized dispatcher / independent exact-SHA QA.
Date: 2026-10-18. Status: WORKING_DRAFT / UNVERIFIED, uncommitted source only.
Authority: supplied immutable GOBADMINTON_AUTONOMY_V1 source-only assignment for Issue 78, Owner decision A1 (18Oct2026). Single executor; no delegation or second writer.

## Source and scope

Exact clean starting base: `598bc7ab846db214530dcb6e6fa4b978a3da1e07`, branch `automation/issue-78`.
Reused candidate: `6434b6f00d7ebbc5e43e10e589f34b16db58d7f4` from `automation/issue-76`.
Candidate reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/6434b6f00d7ebbc5e43e10e589f34b16db58d7f4 .
Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/598bc7ab846db214530dcb6e6fa4b978a3da1e07 .

All 18 candidate files were reproduced directly using read-only git diff/show and byte writes, including the unchanged `ISSUE_76_SHARED_MAP_SOURCE.md`. No implementation was regenerated. The only intended deviation among these 18 files is adding URL to the file-level global declaration in `shared-map-public.browser.mjs`.

Two existing tests receive only the requested A1 updates: `web01-games-completion.test.ts` renames its Games-lane test and retains the displaySlot/proximityBand exclusion while permitting Radar status; its GameDetailPage and other assertions remain. `web02-players-profile.test.ts` matches `export function RadarStatusAffordance(` to allow the actual optional mapControls prop. No lint rule/configuration change.

Expected writes: those 18 candidate paths, the two old test files, and this handoff, all within allowed_paths. Rollback: authorized integrator discards only this assignment's source changes against the exact starting base. No runtime rollback is needed.

## STYLE_GUIDE_PARITY

No visual redesign: reuse the exact candidate's canonical Button, Avatar, Modal/Drawer, Radar popover, tokens and focus treatment. Owner OPTION3 “Svetlaya kapsula” authority and prior STYLE_GUIDE_GAP are recorded in the preserved Issue 76 handoff. Binding frontend decision was read; referenced `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent. Frozen Make parity remains UNVERIFIED. The local Next.js documentation path specified in apps/web/AGENTS.md is also absent; no dependencies were installed.

## R1–R7 coverage for independent QA

These are coverage requirements, not executed results. Preserve the detailed assertions and remediation coverage in `ISSUE_76_SHARED_MAP_SOURCE.md`.

| ID | Required coverage |
| --- | --- |
| R1 | `shared-map-return.test.ts` and legitimate-session browser assertion: fresh entry with saved camera centres own avatar once; manual pan/zoom survives publication/OFF-ON; explicit venue return resumes camera. |
| R2 | `shared-map-controller.test.ts`: map(true), nextMapCursor, limit 100 and bounded windows. Browser at both entries: existing Radar popover pagination, drag and PageDown reach later pages without camera/venue reset. |
| R3 | Browser with legitimate session at both entries: existing RadarStatusAffordance ON/OFF preserves camera/filter/venues; OFF removes person focus targets. |
| R4 | Controller same-name/distinct-publicPlayerId coverage plus browser pressed-state/preview assertions keyed by publicPlayerId. |
| R5 | Browser at both entries: native consent dialog Escape cancels consent without map exit; role=dialog also guards map Escape; unobstructed map Escape retains return behaviour. |
| R6 | `shared-map-public.browser.mjs` plus browser Back/Escape checks: return focus to rendered mobile/desktop entry; hidden twin never receives focus. |
| R7 | Mobile browser: native participant preview has visible >=44px close target and dialog focus behaviour; button/Escape/Back close it and return focus to the exact marker. Retest participant-list close/expand/touch and status-trigger focus. |

## Evidence and next bounded action

NOT_RUN: author self-QA, lint, unit tests, typecheck, build, hosted Product CI and independent source QA, per explicit source-only instruction. NOT_TESTED: public browser geometry/live MapLibre/tiles/API and authenticated Radar flows; authenticated flows require a legitimate session. No PASS or acceptance claimed. Prior independent QA supplied for this assignment is `{}`.

Dispatcher must publish the candidate to obtain a new exact SHA/permalink, then request NEW independent exact-SHA source QA and all seven existing hosted Product CI jobs, including web lint and unit tests. Independent QA must compare candidate files against the reused commit, allowing only the intended lint edit within the original 18 files, and verify the two narrowly updated old tests without other weakened assertions. Actual public browser coverage must include 390/430/768/1024/1440 widths, 390x600, 390x1000 and 900x390, retaining all original assertions, venues and real interactions.

DEV release/root ACCEPTED/live META exact SHA/no Pending are subsequent authorized release gates, not source-author effects or achieved facts. No commit, push, Git metadata, automation, secrets, services, network deployment or PROD changes performed. No result SHA/permalink exists until dispatcher publication. Immutable assignments and counters for Issues 66/68/76 and others remain untouched. Preserve #66 geometry FAIL and #54 historical FAIL; historical UAT PASS on `3c1f7c84` is not evidence for the new SHA.
