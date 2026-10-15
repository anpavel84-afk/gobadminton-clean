# Issue 36 / PR 42 — bounded correction 7: shared profile coherence

From: source author. To: parent publisher → NEW independent read-only SOURCE QA7.
Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED, uncommitted source only. No independent QA verdict or product acceptance.

## Assignment, authority and exact base

One bounded correction 7 under supplied Owner CONTINUE and [PR42#6194316393](https://github.com/anpavel84-afk/gobadminton-clean/pull/42#issuecomment-6194316393). Original Wave B2 authority: [#5#6182091853](https://github.com/anpavel84-afk/gobadminton-clean/issues/5#issuecomment-6182091853). These are assignment references supplied by parent, not newly fetched evidence. Only fix complete snapshot/version coherence after cover 409 or ambiguous write, preserve the crop draft, and add concurrent NON-cover regression. No automatic correction 8.

Exact entry/source base: [`78b93bc3b2b322ea01c57c6b23d2748408b995da`](https://github.com/anpavel84-afk/gobadminton-clean/tree/78b93bc3b2b322ea01c57c6b23d2748408b995da), branch `automation/issue-36`, initially clean. This source author is the sole writer started in this session; no additional writer/delegation. Allowed changes for this correction: Web client/source/tests and this handoff only. No API/SQL/contracts, automation, dependencies, Git metadata, secrets, services, accounts, root, live environment or PROD changes. No commit/push, network request, deployment or author self-QA.

## Prior facts and FAIL history

Supplied independent QA6 on the exact entry SHA is **FAIL, P1**: ProfilePage merged a cover-only receipt at its line 165; CoverEditor reconciliation advanced version at lines 75–82 without refreshing name/bio/visibility/form values. Tab A v1 → tab B non-cover update v2 → A cover 409 → cover-only reconciliation v2 → subsequent profile save could silently overwrite tab B. Earlier browser fixtures changed cover/version only and missed this defect.

Parent reports [full push CI38749525710](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38749525710) PASS on candidate6; candidate6 was **NOT deployed**. Actual DEV/base remains `03c6abb1157276d58432728c9ebae528c446243d` / `r38742345608-a2`, previously root ACCEPTED according to parent. No live state was read or reverified here. CI success does not supersede QA6 FAIL.

All earlier Foundation/QA2/QA3/CI/UAT failures and separate approvals remain in [source history at the entry SHA](https://github.com/anpavel84-afk/gobadminton-clean/blob/78b93bc3b2b322ea01c57c6b23d2748408b995da/docs/handoffs/ISSUE_36_PROFILE_COVER_SOURCE.md), [attempt4](https://github.com/anpavel84-afk/gobadminton-clean/blob/78b93bc3b2b322ea01c57c6b23d2748408b995da/docs/handoffs/ISSUE_36_CROP_FIDELITY_ATTEMPT4.md) and [attempt5](https://github.com/anpavel84-afk/gobadminton-clean/blob/78b93bc3b2b322ea01c57c6b23d2748408b995da/docs/handoffs/ISSUE_36_CI_LINT_ATTEMPT5.md). They are preserved verbatim. Historical `.tools/style-reference/ACTUAL_CI_SOURCE_ERRORS.md` logs concern earlier rejected candidates, not fresh errors for this diff.

## Source correction (authored behavior, not executed acceptance)

- `apps/web/src/lib/api-client.ts`: new `reconcileMyCover` reads COMPLETE `OwnSocialProfile` from existing authenticated `/v1/me/social-profile`, using the same bounded 5-second media request wrapper, parent abort signal, credentials, no-store and existing session handling. Cover write routes, CAS, CSRF and replay keys stay intact.
- `CoverEditor.tsx`: reconciliation uses that full read and a separate typed `onReconcile` callback. It does not send a cover-only receipt through `onChange` to advance the shared version. Only a successful non-stale, non-aborted read reaches adoption and clears uncertainty; failed/stale reads retain it. Existing operation/busy locks, version/CSRF abort, unauthorized exit and unmount cleanup remain. Confirmed successful CAS write receipts still use the existing write-success callback.
- `ProfilePage.tsx`: full reconciliation calls existing `hydrate`, replacing the authoritative profile and ALL profile/looking form values together. It does not set loading/reload, remount CoverEditor, or reset selected file/crop/preview/blob URL. Subsequent profile editing starts from the complete snapshot. A later concurrent server mutation still conflicts through existing server CAS.
- `cover.test.tsx`: bounded reconciliation deadline now targets the full profile endpoint; additional wire regression checks complete unrelated fields plus private no-store transport. Static editor fixture supplies the full-snapshot callback.
- `profile-cover.browser.mjs`: existing synthetic loopback regression at 320/360/390/1440 now changes name, bio, city, area, directory visibility and contact preference as tab B, independently of cover changes. It covers offline and committed-but-lost responses, plus true 409 from a prior non-cover update followed by retry OR cancel. It checks full-profile reads (no cover-only reconciliation), failed/stale reads retain uncertainty, held reads lock controls, retained blob URL/crop/image pixels, updated header/visibility/preferences, and subsequent profile form values and authenticated PATCH payload/CAS. Local bio edits must append to tab B's bio while preserving its name/location. Preview still follows the actual panel if authoritative text changes its height; the retained image bitmap is checked independently of that responsive framing. Existing upload/replace/delete/default/fallback/keyboard/unauthorized checks remain. This is a mocked API regression, not live auth/security evidence.

## STYLE_GUIDE_PARITY

Read the binding Style Guide decision, supplied `.tools/style-reference/README.md`, profile and Construction Kit observations. Reuse existing canonical profile desktop media-left/identity-right and mobile media-above-identity composition, Button/ProfileDialog/form/notice primitives and responsive crop framing. This correction introduces no visual/composition change or new pattern. Existing `STYLE_GUIDE_GAP #36-cover-crop-preview` remains; no OWNER_VISUAL_OVERRIDE. The linked `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` is absent locally. No PLAN/frozen-tree/hash or newly rendered parity claim.

## Actual author checks and limitations

These are limited author checks, not independent QA or source/product PASS:

- `node --check apps/web/test/profile-cover.browser.mjs`: exit 0, JavaScript syntax only.
- `git diff --check`: exit 0, whitespace only.
- Attempted Web typecheck with `--incremental false`, lint, and targeted cover/preprocess unit suites through `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run …`: each stopped before execution because pinned pnpm 10.18.0 is unavailable and network was explicitly disabled. No dependency install/fetch or bypass.
- `node apps/web/test/profile-cover.browser.mjs`: stopped before browser/server access with `ERR_MODULE_NOT_FOUND` for `.tools/node_modules/playwright/index.mjs`. No service started or browser sandbox bypass.

Typecheck, lint, unit runtime, browser runtime, build, fresh full hosted Product CI, independent QA7, DEV release/backup/paired digests/smoke/root receiver ACCEPTED and authenticated mobile/desktop synthetic UAT are **NOT_TESTED** for this diff. No new exact candidate SHA or durable publication exists until parent commits/publishes normally.

## Rollback and next bounded action

Rollback: inverse only this correction's five Web file diffs and remove this new handoff; retain all prior implementation, migrations, framing and FAIL history. No database or runtime action.

Parent publishes a normal commit, records new exact SHA/blob permalinks in PR42/Issue36, and obtains fresh independent read-only QA7 and full hosted Product CI for that SAME SHA. Only the separately authorized parent/operator continues existing DEV backup/paired-image/smoke/receiver process to actual root-owned ACCEPTED exact SHA/digests/pending=false, followed by real authenticated synthetic mobile/desktop cover and forbidden-action UAT, including recovery and subsequent non-cover edits. Unchecked live/UAT actions remain NOT_TESTED; source review is not product acceptance. No PROD and no automatic extra correction 8.
