# Issue #28 — bounded correction after hosted CI4 FAIL

From: native SOURCE author. To: authorized publisher / independent SOURCE QA / PM.
Date: 2026-10-16. Status: SOURCE_READY / WORKING_DRAFT — NOT APPROVED.
Base: `ae29c435e34429db5fc108784f8dc240b6bf5ce7`, branch `automation/issue-28`, initially clean.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/ae29c435e34429db5fc108784f8dc240b6bf5ce7
Verified `86db9232651d9053f9c472695f95eab5478aed2d` is an ancestor of HEAD; Ops ancestry preserved.

## Exact bounded assignment / authority

Owner authorized one native SOURCE CI correction in the same issue-28 worktree,
after real independent QA4 PASS and hosted CI4 FAIL. Existing manager temporarily
stopped for separate reviewed AdminOps commissioning (Owner-provided fact).
Only the two named web test files and relevant handoff may change. No production
source, control files, dependencies, network, models, secrets, services, live DB,
env, CI dispatch, PROD, PLAN, VPN, other worktrees, commit or push authorized.
No second writer or sub-agent launched. No retry-cap reset or next slice.

Preserve previous QA1–3 FAIL, QA4 PASS source a2 and actual CI4 FAIL as separate
historical facts; this patch does not turn any previous receipt green. These
QA/hosted results are supplied by the assignment, not independently reverified here.
Actual hosted failure supplied by Owner:
https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38822924529/job/116723551281
Source(web): pagination TS2532; refresh consistent-type-imports errors; date case
expected schedule empty state while only venue list was open. Other six refresh
cases and 512 other web tests passed in that run, per assignment.

## Correction and finding

- `apps/web/test/games-map-pagination.test.ts`: assert exactly two requests,
  destructure and explicitly narrow both entries before accessing searchParams.
  Assert non-null/nonempty startsFrom and equality across pages. Existing immutable
  ID merge, repeated cursor and offline partial-result rejection assertions remain.
- `apps/web/test/games-map-refresh.test.tsx`: replace import() type annotations with
  a normal type-only React namespace import, including importOriginal module typing.
- Date fixture never selected a venue. Inspection of real GamesMapView shows the
  schedule card requires a selected immutable venue ID; its selected state starts
  null. No production defect was found and no claim that date clears selection is
  needed. After replacement pagination settles, the date case traverses the actual
  component tree and invokes the existing retained venue button's onClick. It then
  rerenders and asserts “Нет игр в выбранную дату” and absence of “Delayed game”.
  Matching “Venue · 0” identifies the fixture's list control; it does not replace
  the schedule empty-state assertion. All existing abort/inFlight/no-orphan request
  counts and timer assertions remain, as do all other cancellation cases and the
  late-aborted-transport case. No skips, suppression or mocked cancellation added.

## STYLE_GUIDE_PARITY

Read Owner Style Guide first decision, admitted `.tools/style-reference/README.md`,
Guide text and map-action observation manifest. Canonical Button/chips, feedback
and schedule-card composition unchanged; only test interaction changes. No new
STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE. Existing #28 parity/gap records remain.
The linked `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent locally;
the Owner decision and admitted Guide observations were available. No visual PASS.

## Local evidence / limits

- `python scripts/check_foundation.py`: NOT_RUN, `python` executable absent.
- `python3 scripts/check_foundation.py`: PASS, 174 Markdown files / 164 draft API
  operations before this handoff; final rerun recorded below.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts -p test_check_foundation.py`:
  PASS, 8 tests. This validates the Foundation checker, not the web regression.
- `git diff --check`: PASS before handoff; final rerun recorded below.
- Final rerun after writing this handoff: Foundation PASS (174 Markdown files /
  164 draft API operations), checker regressions PASS (8 tests), diff whitespace
  PASS. Foundation enumerates tracked files, so its Markdown count excludes this
  new untracked handoff. Final status contains only the two allowed modified tests
  and this untracked handoff.
- Web typecheck, lint, Vitest regression fixtures, build and full hosted CI on this
  patch: NOT_RUN. Root and web node_modules absent. No dependency installation,
  Corepack invocation or network attempted. Actual execution remains required;
  source inspection cannot establish test success.
- Independent QA on this patch, real DEV map/tiles/browser/mobile390/desktop,
  authenticated permission negatives, backup/paired images/receiver acceptance:
  NOT_TESTED. No self-approval, deployment or root-owned ACCEPTED claim.

## Continuity / next bounded action / rollback

This local handoff is prepared for durable GitHub publication; commit/push are
explicitly forbidden in this session, so no new SHA or published patch permalink
exists. Authorized publisher must attach this patch/handoff to an exact new SHA,
then obtain independent SOURCE review and full hosted Product CI exact SHA.
DEV gates and PM product smoke from the original #28 assignment remain mandatory;
PROD requires separate Owner GO. Stop here at source-ready, without acceptance.

Rollback only these two test diffs and this new handoff against exact base above;
retain parent merge/Ops ancestry, earlier QA/CI failures and all prior source work.
