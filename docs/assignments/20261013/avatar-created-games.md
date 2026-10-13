# Implementation · Created Games organizer/avatar rendering

ID avatar-created-games-ui-20261013-v001; Owner Issue #15. Source-only Germany DEV, no changes to moderation key, PROD VPN/XHTTP, or real users.

User bug: on Created Games organizer/host circle shows initials despite working upload of current user avatar. Existing clean apps/web/src/components/consumer/discovery/DiscoveryGameCard.tsx renders initials unconditionally. Check also apps/web/src/components/consumer/pages/MyGamesPage.tsx and apps/web/src/components/account/MyGamesView.tsx for created-by-me and manager scenarios.

Find true authored game relationship (games.created_by_user_id) and public-safe avatar DTO from existing players/profile API. Add an explicit safe avatar field to game list/detail DTO only if absent, using approved media/proxy URL and profile visibility. Never confuse legacy organizer_id or trainer with creator. Avoid direct private object keys, storage paths, personal contact or internal user IDs in public response.

Render actual image with accessible alt, responsive crop, initials fallback on unset/removed/broken URL, correct update after avatar replacement (cache bust or media version). Reuse existing Image/Avatar component. Preserve exact created games listing and pagination, no layout drift on small iPhone.

Add tests with synthetic author (photo), author without photo, updated photo, manager visibility, unauthorized hidden avatars; API projection and frontend unit/DOM tests. Produce immutable source SHA/tree/branch and rollback; independent QA then safe DEV-only deploy/browser proof. Cannot claim upload bug or moderation defect without evidence.
