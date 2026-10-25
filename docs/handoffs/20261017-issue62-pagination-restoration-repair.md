# #62 paginated list restoration repair

From: source author. To: existing executor / independent read-only QA.
Date: 2026-10-17. Status: WORKING_DRAFT — NOT ACCEPTED; source only.
Assignment: supplied immutable GOBADMINTON_AUTONOMY_V1 #62, narrowed to the
reported pagination restoration defect. No new assignment or executor.
Exact base and prior reviewed SHA: c4a9facd31d2ee88e91d251bb9a9ee2acc25158e.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/c4a9facd31d2ee88e91d251bb9a9ee2acc25158e

Prior independent QA verdict remains FAIL: loading more pages, entering map,
opening a venue, returning to map and selecting list loses the loaded pages;
the saved offset then clamps against the first page. Earlier historical FAIL
and UAT/rollback evidence remain unchanged. This patch is not acceptance.

## Source change

`apps/web/src/components/consumer/pages/GamesDiscoveryPage.tsx` records successful
page depth per existing city/timezone/day/activity key in sessionStorage, with
an in-memory fallback. Initial load and refresh replay that many pages through
the existing public list API using fresh cursors, deduplicate items and apply
the existing future-game filter. No game records or cursors enter persistent
storage. Replay stops at the current end of the feed if availability changes.
Loading waits for URL context initialization. Scroll restoration waits for the
complete replay, rather than treating the first page as a settled list.

A replay failure uses the existing complete in-memory stale snapshot or error
state; a partial replay is not presented as a complete ready feed. An error
does not consume the pending restoration, so retry can finish it. Previously
saved pagination depth remains available for retry. Optional browser storage
being unavailable prevents cross-document restoration; in-document refs still
work. Changed/expired/removed games can shorten the fresh list and naturally
limit the attainable offset; no historical game data is fabricated.

## STYLE_GUIDE_PARITY

Behavioral repair only. Existing #62 buttons, icons, filters, composition and
bounded Owner visual direction remain as recorded in
`20261017-issue62-view-actions-source.md`. No visual pattern, STYLE_GUIDE_GAP
or OWNER_VISUAL_OVERRIDE added. The referenced operations style guide file is
absent in this checkout; the binding Owner decision was read.

## Evidence and next action

No self-QA, tests, build, browser, CI or deployment executed, as explicitly
instructed. No PASS claimed. Independent QA must reproduce a list with multiple
loaded pages → scroll into later pages → map → exact venue → back to map → list,
including Back/Forward, context isolation, replay failure/retry and feeds that
shrink. Verify fresh eligible game content, final scroll, next cursor and loading
behavior. Full hosted ProductCI, original commissioned DEV pipeline and all real
public browser/map UAT from the immutable assignment remain outstanding.
Original max_attempts=3 remains unchanged; no attempt counter reset is claimed.

Only the source file above and this handoff are edited. No commit, push, git
metadata, automation, secrets, services or PROD changes. Publication is prohibited
in this session; existing publisher must publish the candidate and this record
and supply exact candidate permalinks before independent new exact-SHA QA.
Next bounded action: independent read-only source QA through the existing route.
Rollback: remove only this repair patch; no runtime rollback performed.
