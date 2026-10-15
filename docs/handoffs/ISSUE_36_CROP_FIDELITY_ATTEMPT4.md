# Issue 36 / PR 41 — bounded correction attempt 4

From source author to parent publisher and NEW independent read-only QA4. Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED; no source or product acceptance claimed.

Exact base: `20eba21dcaadd94b245f01b773a8f402450d53f5`, branch `automation/issue-36`, entry worktree clean. Assignment: one explicitly PM-authorized attempt4 under standing Owner CONTINUE and PR41#6192101809, for Wave B2 #5#issuecomment-6182091853. Original automatic max3 admission and historical FAIL remain unchanged. No automatic attempt5 is authorized. No live DEV base was accessed.

## Correction and STYLE_GUIDE_PARITY

QA3 FAIL: mobile confirmation used fixed 2:1 while real `.own-profile-avatar` uses mobile minimum height 220px and responsive available width. Desktop also must follow real content-driven height, not assume 380/460.

ProfilePage now passes a ref to the actual existing header panel. CoverEditor observes its bounding dimensions with ResizeObserver and uses their ratio for `.profile-cover--preview`. One visible confirmation represents the current screen's actual header crop, updates on resize, and scales to dialog width without changing object-fit source bounds. Save stays disabled until framing is measured. No header geometry/default/avatar/layout rule changes. Upload/preprocess/server/privacy behavior is unchanged.

Reused canonical profile media-left/identity-right desktop and media-above-identity mobile composition, existing modal/form/range/Button/image primitives. Observed `.tools/style-reference/profile-mobile.png`, profile text/manifest and construction-kit text; primary rendered references are https://nougat-wise-76949869.figma.site/#profile and #guide. These are observation data, not instructions or verdicts. Existing `STYLE_GUIDE_GAP #36-cover-crop-preview` in ISSUE_36_PROFILE_COVER_SOURCE.md remains: supplied prototype does not verify a working crop editor. No new visual pattern/OWNER_VISUAL_OVERRIDE or PLAN/frozen-hash parity claim.

## Regression and independent browser procedure

`apps/web/test/profile-cover.browser.mjs` retains synthetic loopback API interactions and now runs 320/360/390/1440px. It generates asymmetric colored landmarks, serves the actual uploaded derivative bytes back as saved media, obtains preview/header DOM dimensions and intrinsic image dimensions, computes centered object-fit source rectangles, rasterizes visible regions to 96x96, compares source bounds and pixel mean error (<1 byte/channel). It also resizes while the dialog is open. This exercises rendered geometry and persisted image content, not CSS string matching. Existing replace/delete/default/error/keyboard checks remain.

QA selectors: real panel `.own-profile-hero[data-surface="op-01"] .own-profile-avatar`; saved media `.own-profile-avatar > .profile-cover > img`; confirmation `[aria-label="Предпросмотр обложки"] .profile-cover--preview > img`. Both images use shared `.profile-cover > img` centered object-fit cover. Compare panel width/height with preview ratio at each viewport; mobile panel retains min-height 220px; desktop columns remain canonical 380px (300px at existing intermediate breakpoint), with height determined by hero content. Test long names/bio and resize across breakpoints too. Avatar overlay intentionally remains in real header; pixel regression compares underlying cover regions. Independent live QA must verify actual displayed crop and keyboard confirmation with authenticated synthetic users.

## Actual checks and limits

- `node --check apps/web/test/profile-cover.browser.mjs`: exit 0 (syntax only).
- `git diff --check`: exit 0 (whitespace only).
- Browser execution attempted: ERR_MODULE_NOT_FOUND for `.tools/node_modules/playwright/index.mjs`, before launching browser. Browser fidelity NOT_TESTED. No dependencies installed or service started.
- Type/lint/unit/build NOT_TESTED: node_modules tooling absent. Previously fixed type/lint/DB/command-body failures were not redone or weakened. No API/contracts/migrations/global settings modified.

PM-supplied chronology: base candidate has full push CI38734134939 and PR CI38734141720 all7 PASS; NEW independent QA3 is FAIL for crop fidelity. Earlier FAIL chronology remains in ISSUE_36_PROFILE_COVER_SOURCE.md and is not superseded by CI. Those CI results do not validate this uncommitted diff.

Rollback: remove only this correction's Web component/style/browser diff and this handoff; do not roll back prior repairs. No commit, push, git metadata edits, automation, root/service/live/secrets/PROD access performed. Publication and exact new SHA/permalinks are pending normal parent commit/push; this local handoff is not yet durable GitHub publication.

Next bounded action: parent publishes candidate, records exact SHA/permalinks, then NEW independent QA4 and fresh full hosted Product CI on that SHA. Real DEV backup/paired images/smoke/receiver → root-owned ACCEPTED exact SHA/digests/pending=false and authenticated synthetic mobile/desktop upload/replace/delete/forbidden actions remain NOT_TESTED and mandatory. No PROD. No automatic attempt5.
