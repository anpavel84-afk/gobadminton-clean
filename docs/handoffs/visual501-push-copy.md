# Handoff — #501 Visual QA push discoverability / label (source only)

**Assignment:** `OWNER_VISUAL501_EXISTING_PUSH_DISCOVERABILITY_AND_LABEL_FIX`
**Author:** cursor:auto · attempt 1 · base `fd9173919e212f5b6bbae974d8b1c39e702964de`
**Refs:** #501 · original PR #499 · mockup N/A
**Route:** `/profile/settings` (push) · profile `op-02` «Изменить» at 390px
**App candidate:** source only — no alpha.43 / release metadata in this pass (PR #503 / alpha.42 stay independent)
**UAT:** Owner / Go Bad / physical iPhone = **NOT_TESTED**

## Finding (verbatim scope)

1. MEDIUM — with master OFF, settings still headed «Уведомления о сообщениях»; game / «Подведите итоги» opt-ins hidden; no iPhone Home Screen hint.
2. LOW — profile «Изменить» last letter wraps alone at 390px (`.editable-section-header > button` could shrink).

## Exact source repair (option B)

1. General block heading / `aria-label`: «Уведомления» (eyebrow «Настройки»).
2. When master OFF: plain discoverability hint that after enabling notifications the user can **separately** choose invitations, applications/cancellations, and «Подведите итоги».
3. Visible canonical iPhone helper before the permission gesture: add to Home Screen and open from there (no new popup/flow/component).
4. Message-consent button copy unchanged: «Включить уведомления о сообщениях». No silent rename to game-enable; no consent-default / auto-opt-in / API / SW / push-client / session-fence edits; event fields stay OFF until after consent as already implemented.
5. Narrow `.fr3 .editable-section-header` flex: title `span` may shrink/wrap; action `button` `flex: 0 0 auto` + `white-space: nowrap` so «Изменить» does not break the last letter.

## Paths touched (allowed only)

- `apps/web/src/components/consumer/push/PushSettings.tsx`
- `apps/web/src/styles/players.css`
- `apps/web/test/web-push.test.tsx`
- `docs/handoffs/visual501-push-copy.md`

## Checks (author lane)

- Targeted `apps/web/test/web-push.test.tsx`: master-OFF discoverability + iPhone copy; master-ON five OFF + callback wiring; consent/session/fence assertions preserved.
- No hardcoded viewport / CSS-mirror tests; Root browser fixture measures wrap.
- No new dependencies / network / Git publish / runtime / PROD / release.42 metadata.

## Status

Source candidate only. Independent Sol Medium QA → Product CI → merge `dev` → server DEV ACCEPTED — Root PMA after alpha.42 accepted. Child integrates then; next metadata **43** from real 42 receipt. No CI/DEV ACCEPTED / READY / Mode B claim by author.
