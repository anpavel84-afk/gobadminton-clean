# UI close standard — source handoff for #157

From: GoBadminton source author (Codex)
To: dev integrator
Date: 2026-10-22
Status: READY_FOR_REVIEW; source-only, required toolchain checks NOT_TESTED; no independent source QA or visual acceptance.

## Assignment, base and effects

Goal: one pure React 19 CloseButton and exactly five adoptions, with a dark centered SVG X on a white 44px circle. Preserve photo dimensions, dismissal callbacks/guards, refs, handles, Escape/backdrop, scrolling and focus restoration.

Requested dev base: `4977074ee7b45ea612dde592b88b354d99839aea` ([exact base](https://github.com/anpavel84-afk/gobadminton-clean/commit/4977074ee7b45ea612dde592b88b354d99839aea)).
Actual supplied checkout/base for this diff: `422c109893bd6092fd177ccd3ef2162ccc897e0d`, branch `automation/issue-157` ([exact checkout](https://github.com/anpavel84-afk/gobadminton-clean/commit/422c109893bd6092fd177ccd3ef2162ccc897e0d)). Initial `git diff --name-only` was empty. The checkout includes unrelated committed changes since the requested base; these were preserved. No branch update, import of other task code, Git metadata writes, commit, push, network deployment, dependency installation, service/automation/secrets/DB/PROD changes or additional task execution were performed.

The immutable assignment supplied in this session is the bounded authority: only the 14 paths below, offline source work and the four D4 commands. General publication/runtime instructions do not expand those effects. Locks named by the assignment: `web:modal-close`, `web:venue-popup`; their external state was not inspected and is not admission evidence. No second writer was started.

## Changed files

Paths are repository-relative. New files remain local source artifacts for manual integration; no new commit SHA or published artifact permalink exists.

| File | Change |
| --- | --- |
| `apps/web/src/components/consumer/CloseButton.tsx` | CREATE: hook-free function, native button, React 19 typed ref prop, fixed type/icon, default/contextual label, native props. |
| `apps/web/src/components/consumer/games/VenueSheet.tsx` | Adopt with the same `close` ref, `onCollapse`, placement class. |
| `apps/web/src/components/consumer/games/VenuePickerDialog.tsx` | Adopt with `onClose`, «Закрыть выбор площадки». |
| `apps/web/src/components/consumer/players/ProfileComposition.tsx` | ProfileDialog adopts with unchanged `onClose`. |
| `apps/web/src/components/consumer/radar/RadarPage.tsx` | Map panel adopts with `close`, «Закрыть карточку игрока». |
| `apps/web/src/components/consumer/radar/RadarComposition.tsx` | RadarPanel adopts with `onClose`, retains «Закрыть список» as aria-label. |
| `apps/web/src/styles/consumer.css` | Shared 44px circle/SVG/focus-visible/disabled rules and token fallbacks. |
| `apps/web/src/styles/games.css` | Remove picker close cosmetics. |
| `apps/web/src/styles/players.css` | Remove ProfileDialog close cosmetics. |
| `apps/web/src/styles/venue-popup.css` | Remove close cosmetics; preserve sticky/absolute/top/right/z-index and photo rules. |
| `apps/web/test/close-button.test.tsx` | CREATE: real React SSR assertions and native HTMLButtonElement object/callback ref fixture included by web tsconfig. |
| `apps/web/test/venue-sheet.test.tsx` | Narrow click lookup accepts production CloseButton; assert callback and ref forwarding. Existing hooks harness and assertions retained. |
| `apps/web/test/fb01-cards-modal.test.ts` | Read shared skin in consumer.css for close assertion; independent card assertions retained. |
| `docs/handoffs/ui-close-standard.md` | CREATE: the sole task handoff. |

## FACT / UNVERIFIED

FACT (source diff inspection, not independent QA): all five adoption diffs consist of the import and close control replacement. The CloseButton forwards button props/ref and explicitly writes `type="button"`; TypeScript excludes overriding type, children and dangerouslySetInnerHTML, and limits contextual labels to strings starting with «Закрыть». Its sole icon is decorative SVG: 24px, viewBox `0 0 24 24`, currentColor stroke 2, round caps, two diagonals from coordinates 6 to 18. There are no new dependencies, assets, hooks or Unicode close glyphs in the component.

FACT (source): consumer.css owns the single close skin. `button.gb-close-button.gb-close-button` outranks `.g2-map-panel > header button` and consumer resets without new `!important`; its state selectors cover focus-visible and disabled. Fallbacks match consumer-tokens.css: white `#ffffff`, ink `#13221a`, line `#dfe4dc`, focus `#7945de` (`--c23-focus`), disabled ink `#6b766f`. No token file/global theme change. Venue placement and photo CSS are retained. Actual cascade/rendering remains unverified.

FACT (source): ProfileDialog keeps its native showModal/cancel/backdrop/restore handlers. Existing consumers inherit the icon without edits: AuthChooser/AuthEntry; FriendActions; CoverEditor; GameShare; ProfilePage; PublicPlayerProfilePage; LoginMethodsPage; UnifiedPlayerPreview; ConversationSafety; InvitationChooser (also used by NewContact, DirectConversation and RadarContact); GameConversation; RadarContact; RadarSessionProvider consent dialog. Guards remain at their original caller: e.g. saving/busy, mutation.busy and checking. No new dismissal or busy policy was introduced.

UNVERIFIED: Owner request dated 21 Oct, source-attempt history and linkage to #157 are PM_REPORTED/UNVERIFIED_BY_THIS_REVIEW. Prior independent QA input was `{}`. No previous source PASS is claimed. #151/#152/#156 and M3-OWNER are coordination context only, not required inputs or authority.

Prompt review history supplied as data: #157 prompt a1 `b87a64c4`; D3 permits the narrow traversal adaptation and covers fb01-cards-modal.test.ts; D6 assigns browser acceptance to the integrator. Supplied review locator `/opt/gobadminton-clean-qa/style-guide/refs/ui-close-review3.txt`, SHA256 `01219641a78a75c0f3f03019787b427e75da9d28424af22862b2f3011a85d705`, issue binding PM_REPORTED. This report was not read/hashed here because its parent snapshot is denied by the active filesystem policy. It is prompt review, not source QA or executable instructions. No current prompt digest was independently established. New prompt bytes require a new digest and new independent review; snapshot/model/locks do not provide admission.

## Inventory and exclusions

Bounded source inventory used `rg` for close glyphs, «Закрыть», onClose/onCancel, collapse/expand labels, cancel actions and relevant headers in consumer source and admin components. This is not a claim of complete project migration. All found close-related categories are accounted for below; only the five adoption sites change.

| Control / action | Disposition and reason |
| --- | --- |
| VenueSheet close | Migrated; same collapse callback/ref, not backdrop deselection. |
| VenuePickerDialog close | Migrated; same onClose; body portal retained. |
| ProfileDialog close and consumers above | Migrated through the shared dialog; guards/cancel/backdrop remain with their existing handlers. |
| RadarPage map panel close | Migrated; same history/controller/list/expanded/focus callback. |
| RadarPanel «Закрыть список» | Migrated to icon; contextual accessible label retained. |
| VenueSheet / VenuePreviewCard / VenuePopup «Свернуть/Развернуть площадку» | Excluded: separate expand/collapse handles, including pointer/drag behavior. |
| VenueSheet back arrows to schedule/info | Excluded: internal view navigation, not dismissal. |
| RadarPage «Свернуть/Развернуть карточку», map summary/list toggle | Excluded: sheet expansion and list visibility controls; touch handlers retained. |
| RadarNearbyList «Закрыть профиль» | Excluded: inline disclosure; retains closePreview and heading focus. |
| RootNav «Меню ×/≡» | Excluded: navigation toggle, aria-expanded, Escape/outside-click/focus flow. |
| RadarSessionProvider status popover | Excluded: no standalone X. Status trigger toggles it; business actions «Список участников», «Продлить», «Обновить позицию», «Выключить», «Включить Radar», «Проверить статус», «Перенести сюда» also close the popover as part of their flow. Consent dialog inherits ProfileDialog; «Отмена» remains explicit consent cancellation. |
| RadarControls «Отмена», stop/recovery/list actions | Excluded: location/session business operations, not an X close control. |
| ProfileComposition Toggle / other switches | Excluded: state switches, not dismissal; no toggle implementation changed. |
| EmailCodeForm / LoginMethodsPage «Отмена» | Excluded: email flow cancellation, retained callbacks/disabled conditions; surrounding ProfileDialog inherits close. |
| CoverEditor «Отмена» | Excluded: explicit editing/file-selection cancellation, saving guard retained. |
| CreateGamePage / TrainerProfileEditPage «Отмена» | Excluded: form/navigation actions outside the five controls. |
| FriendActions «Отменить запрос», remove/decline; confirmation «Оставить в друзьях» | Excluded: relationship mutations and explicit confirmation choices, not modal X. |
| Admin GameModeration «Закрыть публичный доступ», «Закрыть новые заявки», «Отменить игру» | Excluded: moderation domain commands, not UI dismissal. |
| Admin Cases closed/resolved/status actions | Excluded: case business state transitions. |
| Admin VenuePhoto «Отменить выбор» / «Отмена», Venues «Отмена» | Excluded: file/edit/confirmation actions in a separate app. |
| Avatar preprocessing bitmap `.close()` / Promise resolve | Excluded: resource cleanup/non-UI search matches. |

## STYLE_GUIDE_PARITY and bounded STYLE_GUIDE_GAP

Authority read: [Owner frontend decision at actual checkout](https://github.com/anpavel84-afk/gobadminton-clean/blob/422c109893bd6092fd177ccd3ef2162ccc897e0d/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), plus project rules. It identifies Modal / Drawer / BottomSheet, Buttons, accessibility and Radar primitives and the frozen Make [guide](https://nougat-wise-76949869.figma.site/#guide) / [construction kit](https://nougat-wise-76949869.figma.site/#construction-kit). No network access was used.

Snapshot source inspection is unavailable: attempts to read the supplied operational guide/provenance at `/opt/gobadminton-clean-qa/style-guide/refs/FRONTEND_STYLE_GUIDE_FIRST_V001.md` and `.provenance.json` returned `Permission denied`. The active developer policy denies reading the parent `/opt/gobadminton-clean-qa`; no workaround/escalation was attempted. Consequently supplied `src/App.tsx`, `src/index.css` and review bytes were not read or hash-verified. The operational guide also does not exist at `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` in this checkout. Historical host paths were not used. Next.js `apps/web/node_modules/next/dist/docs/` is absent; this task changes no routing/framework API.

Supplied, UNVERIFIED snapshot identities: App.tsx SHA256 `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`; index.css `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`; operational guide `d0339e1505047a4080d3eb7e7b95c23a034cfc8333623c550bb55c035d689fb9`, archival revision `50f5a4473f8ed4ca133eac1d406d6745f589383a`. These are provenance supplied with the assignment, not a requirement to replace this checkout.

| Family | Mapping / limit |
| --- | --- |
| StyleGuide / ConstructionKit Modal | Retain ProfileDialog header and native dialog behavior; compose its close from the shared icon button. Source/render parity to snapshot UNVERIFIED. |
| Drawer / BottomSheet | Retain VenueSheet / picker / RadarPanel shells, placement and handles; shared close changes only its control. |
| Action / CTA | Use the icon button primitive for dismissal; keep explicit text/business/submit actions unchanged. Assignment reports `.icon-button` is 42px; not independently inspected. |
| AccessibilityStates | Adopt 44px minimum, native disabled, decorative icon, accessible label and visible keyboard outline. Assignment reports 44+ targets; browser behavior NOT_TESTED. |
| RadarMapPage | Preserve the existing map header, expansion handle and close callback; supplied screen-specific composition cannot be inspected here. |

Bounded STYLE_GUIDE_GAP: the assignment reports no dedicated SVG close in IconName and a 42px icon-button versus 44+ accessibility targets. This implementation composes those reported primitives into a 44px white circle with a centered 24px SVG X, using existing palette tokens/fallbacks. The extension is restricted to the five controls. It is not literal parity, OWNER_VISUAL_OVERRIDE, or verified rendered fidelity. Integrator must reconcile it with accessible frozen sources before visual acceptance; old frontend code is used only to preserve behavior/placement, not as visual authority.

## Required offline command evidence

These are author command results, not independent QA. All commands were run from the supplied checkout. No install was attempted.

| Exact command | Exit / result |
| --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1; NOT_TESTED: Corepack cannot obtain absent pnpm 10.18.0 offline; compiler did not run. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint` | 1; NOT_TESTED: same pre-toolchain error; ESLint did not run. |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/close-button.test.tsx test/venue-sheet.test.tsx test/fb01-cards-modal.test.ts test/venue-photo-lifecycle.test.tsx test/venue-sheet-integration.test.tsx` | 1; NOT_TESTED: same pre-toolchain error; Vitest did not run. |
| `git diff --check` | 0; no output (tracked diff whitespace check). |
| `git diff --no-index --check -- /dev/null apps/web/src/components/consumer/CloseButton.tsx` | 1; no output/whitespace diagnostics; no-index detects the new file difference. |
| `git diff --no-index --check -- /dev/null apps/web/test/close-button.test.tsx` | 1; no output/whitespace diagnostics; no-index detects the new file difference. |
| `git diff --no-index --check -- /dev/null docs/handoffs/ui-close-standard.md` | 1; no output/whitespace diagnostics; no-index detects the new file difference. |

Exact shared output of each pnpm command:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Both root and web node_modules are absent. New SSR tests and the native ref fixture are present but have not executed/compiled here. The existing venue-sheet harness has only the narrow production CloseButton lookup/ref assertions; no new React/hooks mocks or generic component execution were added. Existing Escape/backdrop, dates, focus and drag assertions remain. venue-photo-lifecycle and venue-sheet-integration files are unchanged; the former's function-component renderer can receive this hook-free component/ref, and the latter clicks unchanged schedule/date controls. This source observation is not a test PASS. Any real source/test errors found by the integrator require correction, not reclassification as unavailable checks.

## Pending merge gate, risks and next action

NOT_TESTED: browser click/focus and rendered fidelity. SSR does not prove browser dismissal, focus containment/restoration, computed CSS, touch hit areas, disabled/focus legibility, photo geometry or form submit behavior. No devices, remote state, runtime acceptance, visual PASS, deployment or completion of another task is claimed.

Separate pending merge gate for the integrator at **390 / 430 / 1440px**: obtain rendered evidence of identical X/circles across all five controls, legible focus/disabled, unchanged Escape/backdrop/busy guards, portal and native-dialog behavior, and photos/submit without crop/overflow regressions. Reconcile the bounded Style Guide gap with the frozen guide. Required source checks must also run in a prepared offline toolchain, followed by independent QA/CI. Local source work alone cannot satisfy that rendered gate.

Risks: unavailable compiler/linter/test runner and frozen snapshot inspection; different supplied HEAD from requested dev base; CSS load-order/rendering remains unobserved; RadarPanel text becomes an icon with retained accessible label. No source acceptance or visual gate is waived by this handoff.

Rollback: the integrator manually reverts only this task diff, including the three newly created files, preserving baseline and all subsequent changes. The author performs no Git writes.

One next recipient/action: **dev integrator** manually merges only these 14 files into the current dev candidate, preserving later changes, and carries this evidence/pending gates into independent QA/CI. Publish the source and this single handoff as durable GitHub artifacts through that integration; add exact result permalinks only after they exist.
