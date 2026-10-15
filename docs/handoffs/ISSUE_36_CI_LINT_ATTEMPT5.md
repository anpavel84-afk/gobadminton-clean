# Issue 36 / PR 41 — supervised CI correction attempt 5

From source author to parent publisher and NEW independent read-only QA5. Date: 2026-10-15. Status: READY_FOR_REVIEW / UNVERIFIED; no new QA or product acceptance claimed.

Exact base: `fb47c412b0df424aaefb87cb176bd56950a2eed0`, branch `automation/issue-36`, entry worktree clean. Assignment: one tiny supervised attempt5 under standing Owner CONTINUE / [PR41#6192505189](https://github.com/anpavel84-afk/gobadminton-clean/pull/41#issuecomment-6192505189). No task/scope or automatic retry-cap reset; no automatic attempt6. No live DEV base accessed.

## Change

Added `getComputedStyle` to the existing file-local ESLint browser-global declaration in `apps/web/test/profile-cover.browser.mjs`, following `header-identity.browser.mjs` and `product-consumer.browser.mjs`. This addresses the reported `no-undef` at line 57. Geometry/pixel comparisons and every assertion remain intact. No UI/API/DB/preview, visual pattern, global lint settings, automation or dependency changes. Existing Style Guide parity and gap record in the attempt4/source handoffs remain unchanged.

## Evidence and remaining gates

Assignment-supplied evidence: independent QA4 **PASS**, no findings, reviewed exact SHA `fb47c412b0df424aaefb87cb176bd56950a2eed0`. [Hosted CI38736496641](https://github.com/anpavel84-afk/gobadminton-clean/actions/runs/38736496641) had 6/7 PASS; Web failed on the undeclared browser global above. Prior `.tools/style-reference` concerns concern earlier SHAs and were reported fixed. These results do not validate this new uncommitted correction or constitute product acceptance.

No self-QA, lint, tests, build, browser execution or acceptance performed in this author attempt. New exact SHA and durable artifact permalink await parent publication. No commit/push, git metadata changes, root/services/live/secrets/PROD actions performed.

Rollback: remove only the added `getComputedStyle` declaration entry and this handoff; preserve all prior implementation and corrections.

Next bounded action: parent verifies Foundation and performs normal commit/push, records exact new SHA/permalinks, then obtains NEW independent read-only QA5 and full hosted Product CI on that SHA. DEV backup/paired images/smoke/receiver, actual root-owned ACCEPTED exact SHA/digests/pending=false, and authenticated synthetic mobile/desktop profile upload/replace/delete/forbidden-action UAT remain NOT_TESTED by this author and required downstream gates. No PROD and no automatic attempt6.
