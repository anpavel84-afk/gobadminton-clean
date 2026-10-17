# #62 history scroll repair

From: source author. To: existing executor / independent read-only QA.
Date: 2026-10-17. Status: WORKING_DRAFT, source only, NOT ACCEPTED.
Assignment: supplied immutable GOBADMINTON_AUTONOMY_V1 task #62; no new task.
Exact base/reviewed SHA: f2f16d644ad045594aa1ea3a4fbbda7b8a2b80a9.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/f2f16d644ad045594aa1ea3a4fbbda7b8a2b80a9

Prior independent QA: FAIL. List A → map → Back → list B → Forward → Back
restored A because only the map action saved scroll. This finding supersedes the
earlier handoff's statement that no independent QA was supplied; it remains
historical FAIL evidence, not a PASS after this source edit.

GamesDiscoveryPage now saves list scroll per existing city/date/activity key on
scroll and outgoing popstate. Listeners are active only for the list and retain
the outgoing render's key during history navigation. Saving is suspended while
the existing list restoration is pending. Existing action saving, feed settling,
URL context, pagination and map camera behavior remain in place.

STYLE_GUIDE_PARITY: behavioral repair only; existing #62 canonical patterns and
bounded Owner visual direction recorded in 20261017-issue62-view-actions-source.md
remain unchanged. No new visual pattern, icon, gap or override introduced.

No self-QA, tests, build, browser, CI or deployment executed, per explicit user
instruction. No PASS claimed. Independent QA must reproduce A/B Back/Forward,
including repeated cycles, different city/date/activity contexts and optional
session storage unavailable, against the newly published exact candidate SHA.
All broader task acceptance, real-map/public-browser UAT and historical failures
remain outstanding as recorded in the original handoff. Original max_attempts=3
is unchanged; this document does not claim or reset an executor attempt counter.

Only this source file and this handoff edited. No commit/push or git metadata,
automation, secrets, services or PROD changes. Publication is prohibited in this
source-author session; the existing publisher must supply the candidate permalink
and durable GitHub representation. Next bounded action: new independent exact-SHA
read-only source QA by the existing executor route. Rollback: remove only this
repair patch; no runtime rollback performed.
