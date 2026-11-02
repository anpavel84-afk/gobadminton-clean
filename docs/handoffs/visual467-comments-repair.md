# Visual QA #467 — comments actions + postgame copy (pass 1)

Refs: #467, #394. Base accepted SHA `841bbec37739f56e9561a756731490891ed70d19` (alpha.16).
Application candidate: **0.1.0-alpha.17**; API contract **0.26.0** unchanged. Owner UAT: **NOT_TESTED**.

## Route / materials

- QA route: `/games/2cd8b137-8582-4974-8ce0-bd146dc20d93`
- Source PRs: #465 / #466; alpha.16 PR #468
- Design: COMMENTS_STYLE_GUIDE (GAME Q&A). Agreed game-comments screenshot `game-normal-desktop.png` read as image (desktop mock; not venue policy).
- Venue reviews mockup `style-guide/reviews/20261102-astra-v1` is postgame proposal only — not applied as game-comments redesign.

## Repairs

1. **Own menu** — `canAuthorSafety` false when `item.mine`; menu shows only Изменить/Удалить. No publicId identity fallback; other-author safety unchanged via `profilePublic` + `publicPlayerId`.
2. **Tombstones** — deleted root and reply render only «Комментарий удалён» without avatar/name/profile link/timestamp; reply traversal/pagination preserved.
3. **VenuePage** — placeholder keeps «Отзывы после игр появятся здесь» and adds honest closed explanation; no composer/writer.
4. **GameResultsComposition** — attendance `SectionHeader` reflects missing vs saved-unknown vs marked; request/dispute logic unchanged.
5. **GameFeedbackPanel** — side safety copy is concise Russian about profile complaint; no typed-extension jargon.

## Releases

- `CURRENT_APPLICATION_VERSION` → `0.1.0-alpha.17`
- alpha.16 seed preserved verbatim into `TRUSTED_HISTORICAL_SEED` from supplied JSON
- Candidate SHA / merge / acceptance unbound; CHANGELOG delta only

## Tests (proportionate)

- own menu only 2 actions; other author still safety
- root/reply tombstones metadata absent; replies kept
- missing heading truthful (source + existing mutation coverage)
- closed venue writer still absent
