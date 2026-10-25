# Owner UAT #174 — Venue popup actions and visibility

Status: **SOURCE READY FOR CI; OWNER MOBILE VISUAL ACCEPTANCE PENDING**.
From: Owner-authorized manual Advisor implementation.
To: Product CI / DEV release / Owner.
Date: 2026-10-22.
Base: `fbc544387358a4440cc8d5d250d63e7536aa17f5` on `dev`.
Owner issue: https://github.com/anpavel84-afk/gobadminton-clean/issues/174
Predecessors: accepted #156 and follow-up #171 / PR #172.

## Owner-observed issues
1. Lime `Создать игру на этой площадке` button in map popup displays unintended blue native text. Set explicit `--gb-ink` on lime CTA; keep icon/link variants unaffected.
2. `Без своего фото` button physically touches the file input. Explicit photo-form group and reset-button spacing applied in shared `games.css`, for embedded and standalone routes. Photo upload/crop/publish pipeline untouched.
3. Map > selected venue > game details has no participation/request/share actions. The same legitimate participation route is now accessible **in the map popup** with server reads, CSRF and optimistic version checks using existing API. Native `GameShare` gained an optional text label; ordinary icon-only usage remains unchanged. Button `Поделиться / отправить другу` sends a **public game URL** via the native share sheet or existing clipboard fallback.

## Important honest product boundary
No in-app Friends/FR-3 recommendation or invitation action is present in the current product. The new share text is **external link sharing**, and never claims to have invited a selected in-app friend or reserved a seat. Owner's internal invite workflow must be developed under its own product authority and API contract.

## Auth and mutation safety
- `VenueGameActions` fetches authoritative Game and the viewer's participation state before offering the real POST; expired/full/cancelled/waiting states cannot request via optimistic UI.
- POST is guarded against double clicks, sends the server-returned Game version and existing CSRF token, and rereads after success or an uncertain result; it does not auto-retry.
- Guest intent reuses the existing `AuthChooser`, with approved return route `/games/:id`.
- Existing withdrawal/review path remains authoritative; no added API endpoints, rights or subscriptions.
- Closing/changing the popup unmounts this bounded action component; stale async responses do not repaint the next game's actions.

## Modified files
- `apps/web/src/components/consumer/games/GamePhotoSelection.tsx`
- `apps/web/src/components/consumer/games/GameShare.tsx`
- `apps/web/src/components/consumer/games/VenueGameActions.tsx` — NEW
- `apps/web/src/components/consumer/games/VenueSheet.tsx`
- `apps/web/src/styles/games.css`
- `apps/web/src/styles/venue-popup.css`
- `apps/web/test/venue-popup-actions-174.test.tsx` — NEW

## Style Guide parity
Preserves existing `BottomSheet` / `FormGroup` / `GameAction` / `Button` / `GameShare` / shared close and brand tokens. Bounded new composition is a gameplay action row within the approved popup. No global visual override.

## QA / DEV acceptance
- Execute existing **Product CI** (web typecheck, lint, tests, plus repository gates).
- Test file checks shared game link, safe initial participation gate, photo reset separation and explicit CTA color; **tests alone do not establish mobile pixel parity**.
- Owner specifically requested no VPS-browser QA. After DEV deploy, Owner will review the actual iPhone result and report issues.
- DEV rollout only through existing `dev` push workflow with normal smoke/rollback. Until the receipt and live SHA match, do not claim DEV ACCEPTED.
- No DEV/PROD/PLAN/VPN/train runner configuration changes or model writers.

## Rollback
Revert only the bounded PR. No DB/schema/secret/workflow modifications or migration. Preserve prior #156/#171 acceptance histories.

## Next action
Upon mandatory CI PASS, merge the bounded PR to dev, let normal DEV deploy run, and report exact SHA, run, and server ACCEPTED evidence. Owner visually checks mobile. No separate site/browser work.
