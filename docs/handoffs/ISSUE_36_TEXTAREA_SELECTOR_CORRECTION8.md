# Issue 36 / PR 42 — bounded correction 8: filled bio selector

From: source author. To: parent publisher → independent read-only exact-SHA QA8.
Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED, uncommitted source only.

## Assignment and exact base

Latest supplied Owner CONTINUE authorizes one minimal correction8 only: replace the two failing exact-label bio lookups in `apps/web/test/profile-cover.browser.mjs` with the verified accessible textbox role. Preserve assertions and subsequent normal profile save/concurrent-tab regression. Inspect nearby selectors; change others only for the same concrete defect. No automatic attempt9.

Entry HEAD: [`f5b254991bbca243590691b9415e33c3eb771f3f`](https://github.com/anpavel84-afk/gobadminton-clean/tree/f5b254991bbca243590691b9415e33c3eb771f3f), branch `automation/issue-36`, initially clean. Exact assignment supplied in this session; no network evidence fetched. Writes limited to the browser regression and this handoff. No additional writer/delegation, product implementation/API/client/SQL/layout changes, dependency installation, commit/push, Git metadata, automation, services, root, live, secrets or PROD access.

## Chronology preserved (parent-supplied evidence)

- QA6 **P1 FAIL** remains recorded in [correction7 history](https://github.com/anpavel84-afk/gobadminton-clean/blob/f5b254991bbca243590691b9415e33c3eb771f3f/docs/handoffs/ISSUE_36_PROFILE_COHERENCE_ATTEMPT7.md): cover-only reconciliation could overwrite concurrent non-cover profile changes.
- Independent QA7 **PASS**, no findings, reviewed exact entry SHA above. [Full push CI38752155488](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38752155488) and [PR CI38752164245](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38752164245) reported PASS. Actual DEV `r38755838664-a1` reported root ACCEPTED, backup 407276 bytes. These facts concern the prior SHA and were not reverified here.
- Actual live UAT harness **FAIL** at `getByLabel('О себе',{exact:true})` for an initially filled textarea. Parent reports trusted isolated real Chromium153 comparison on the SAME labelled filled textarea: exact-label count 0, accessible exact textbox role count 1. Actual DEV screenshot showed authoritative concurrent bio, no JS errors; fixture cleanup PASS. This does not establish full functional/live UAT PASS.

## Minimal change and parity

Both bio lookups now use `getByRole('textbox',{name:'О себе',exact:true})`. The exact `fields.bio` assertion, local append, save and route assertions remain intact; no tests removed/skipped, assertions weakened or sleeps added. Nearby name/area inputs and city select were inspected against ProfilePage markup: no same filled-textarea defect established, so their selectors remain unchanged. File/range selectors also remain unchanged.

No visual/composition change. Existing Style Guide parity and `STYLE_GUIDE_GAP #36-cover-crop-preview` records remain as previously reviewed; no new pattern, override or rendered parity claim.

## Limited local checks, not self-QA

- `node --check apps/web/test/profile-cover.browser.mjs`: exit 0, syntax only.
- `python scripts/check_foundation.py`: unavailable (`python: command not found`); retried with installed `python3`.
- `python3 scripts/check_foundation.py`: exit 0, bounded static Foundation check (160 Markdown files, 159 draft API operations).
- `git diff --check`: exit 0, whitespace only.

Browser runtime, lint/typecheck/build, independent QA8, fresh full hosted CI, new DEV receipt and real authenticated mobile/desktop full browser UAT are **NOT_TESTED** for this diff. No source/functional/live PASS or product acceptance claimed. No candidate commit SHA/permalink exists until parent normal publication.

## Rollback and next bounded action

Rollback only the two selector substitutions and remove this handoff; retain reviewed product implementation and all prior FAIL/PASS chronology. No database/runtime action.

Parent normal commit/push and exact artifact permalinks → NEW independent read-only QA8 on that exact SHA → fresh full hosted Product CI at the same SHA → separately authorized existing DEV backup/paired images/smoke/receiver and actual root-owned ACCEPTED exact SHA/digests/pending=false → full real authenticated synthetic mobile/desktop profile, replace/delete and forbidden-action browser UAT. Unchecked actions remain NOT_TESTED; source QA is not product acceptance. No PROD or automatic correction9.
