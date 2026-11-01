# Handoff — #402 own profile actions (Astra direct)

**Assignment:** OWNER_OWN_PROFILE_ACTIONS_ASTRA_DIRECT_IMPLEMENTATION
**Author:** cursor:auto · attempt 1 · base `783a1897167be1f531312b9a6812b6240181e2c3`
**App candidate:** `0.1.0-alpha.10` · API wire unchanged `0.22.0` · UAT=NOT_TESTED
**Refs:** #402 · Astra High `final.txt` · Owner photo · alpha9 history seed

## Materials read

- Owner desktop photo `owner-desktop-profile-actions.jpg` (image)
- Astra High `final.txt` — compact row: lime edit / outline cover / ghost settings
- `alpha10-profile402-brief.md` · `alpha9-history-seed-for-alpha10.json`

## Source changes

- `ProfilePage.tsx`: remove `player-profile-actionband` from own band; `own-profile-actions` `role="group"` with accessible label; order primary «Изменить профиль» → one `CoverEditor presentation="action-row"` → ghost «Настройки» (`href=/profile/settings`).
- `CoverEditor.tsx`: optional `presentation="action-row"` only; default path untouched; notice class for slot-local status; all crop/preview/CAS/UNKNOWN/auth/disabled/dialog handlers kept.
- `players.css`: open group, slots 200/200/132 gap 12; ≤720 stack gap 10; direct-trigger cover styles only.
- `SITEWIDE_UI_STYLE_GUIDE.md`: short #402 rule.
- Releases: current → alpha.10 Russian delta; trusted seed appends accepted alpha.9 DEV-only; alpha.8 PROD history + alpha.1 baseline kept. Tests + `docs/releases/CHANGELOG.md` updated.

## Checks

- Author worktree has no `node_modules` / pnpm; web typecheck and release tests not runnable here — PMA runs them.
- Remaining: independent Codex Medium QA, Product CI, DEV ACCEPTED + smoke; Owner UAT=NOT_TESTED.

## Explicit non-claims

- No PROD, API/privacy rewrite, global Button/token/ProfileDialog change, or new framework.
- Source PASS ≠ runtime READY/ACTIVE.
