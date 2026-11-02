# Visual QA #467 — mobile composer button class (pass 3)

Refs: #467, #394. Base SHA `b28ce4bed4ba33f7fe1e90ebc1b7a86495e8806e` (alpha.17 ACCEPTED).
Candidate application: **0.1.0-alpha.18**. API contract **0.26.0** unchanged.
Owner UAT: **NOT_TESTED**. No fabricated alpha.18 SHA/date/receipt.

## Route / materials

- Finding: installed alpha.17 `own-390.png` — «Отправить» letter-per-line in ~40px column
- Agreed mobile reference: `game-normal-mobile.png` (comments394 design study)
- Style: COMMENTS_STYLE_GUIDE (GAME Q&A); scoped comments CSS only

## Cause

Desktop 3-col / mobile 2-col composer grids already existed (`comments.css`).
Both button selectors targeted obsolete `.gb-button`; shared `Button` emits `.gb-c23-btn`,
so mobile `grid-column: 1 / -1` never matched and submit auto-placed in the avatar column.
Mobile media also overrode `--inline` / `--reply` back to two columns.

## Fix (allowed paths only)

1. **comments.css** — composer `> .gb-c23-btn` (desktop + mobile full-row); reassert one-column for `--inline` / `--reply` inside `@media (max-width: 720px)`.
2. **releases.ts** — seed alpha.17 verbatim from supplied history JSON; CURRENT → alpha.18 mobile delta; `source_sha` null.
3. **releases tests + CHANGELOG** — strict seed count **25** (24 + alpha.17); negative checks preserved.
4. No CSS string-mirroring tests; no comments permission/test changes; no global Button / API / PROD.

## Out of scope

No backend/schema/auth/net/root/model/Git; no new framework/deps; layout primary verification remains trusted PMA browser rects/screenshots at 320/390/1440.
