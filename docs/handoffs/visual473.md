# Handoff — #473 Visual QA / completion train (source only)

**Assignment:** `OWNER_COMPLETION_VISUAL473_ACTUAL_RELEASE_PAGE_STALE_NOTE`
**Author:** cursor:auto · attempt 2 · base `55771fb711b3f00b94a1267bf59b48c3770e6e58` (pass1 source committed)
**Exact DEV readback:** `360001c6231157f30fdf11606ef8111c291fb099` · original PR #472
**App candidate:** `0.1.0-alpha.27` · API unchanged `0.33.0` · no second version bump · no duplicate alpha.26 seed · `source_sha` / release receipt **unknown** until acceptance · UAT=**NOT_TESTED**
**Refs:** #473 · route `/releases` · files.anpavel.ru макет не менялся (no redesign)

## Pass1 (already on candidate)

1. Role review eligibility copy — source imported + committed; **not** independently QA/deployed.
2. alpha.20 history clarification («автор может снять свой отзыв с публикации») — phrase is history text, **not currently rendered** as a live `/releases` surface string; clarification does **not** claim a live bug.
3. Guest repro of role-panel point: **not reproduced** on public/guest path; private authenticated path remains **NOT_TESTED** (no cookies/tokens/sessions sought).

## Pass2 — new actual browser finding (receipt)

**Finding:** on exact DEV `/releases`, current note still showed first-alpha false claims:
`Раздел Admin служебный. Вход по электронной почте недоступен. Результаты и отзывы после игры не запущены. Push-уведомления не активны. Тестовая геопозиция не для обычных пользователей.`
(`staleCurrentNote: true`; old ambiguous alpha.20 phrase `oldAmbiguousPhraseVisible: false`)

Email / Postgame / Push already delivered in accepted alphas — **no product development** claimed here. Physical Push Owner UAT is **not** claimed done.

## Exact source repair

1. `/releases` lists `visibleKnownLimitations(model.named)` — current `known_limitations` only; first-alpha `FIRST_ALPHA_KNOWN_LIMITATIONS` retained **only** when named row is actually first release (`full_baseline` / alpha.1). Baseline constants and history counts **35 / 6 / 2** unchanged; past seeds not rewritten.
2. Hardcoded false feature paragraph replaced with neutral note: technical DEV install ≠ Owner UAT; Admin + test geo stay internal.
3. alpha.27 delta notes: one fix line about corrected release-screen limitations; current known limits stay truthful (Owner acceptance + Admin/test geo).
4. One proportionate SSR/behavior check: page shows current limits, not first-alpha false email/postgame/push claims (`apps/web/test/releases.test.tsx`).

## Paths touched (allowed only)

- `apps/web/src/app/releases/page.tsx`
- `apps/web/src/lib/releases.ts`
- `apps/web/test/releases.test.tsx`
- `docs/handoffs/visual473.md`

## Status

Source candidate only. No Git publish / deploy / network / auth / sessions by author. Independent Sol Medium QA → Product CI → merge `dev` → server DEV ACCEPTED — Root PMA. Preserve UNKNOWN and history. Mode B / AGY READY not claimed. PROD forbidden.
