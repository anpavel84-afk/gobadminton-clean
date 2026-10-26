# OWNER DECISION — Frontend Style Guide First v001

Status: **OWNER_CONFIRMED — BINDING FRONTEND DEVELOPMENT RULE**
Date: 2026-10-04
Scope: GoBadminton consumer frontend visual/composition work

## Decision

All GoBadminton frontend visual/composition work is **Style Guide first**.

Canonical Style Guide source:
- published page: https://nougat-wise-76949869.figma.site/#guide
- direct Construction Kit view: https://nougat-wise-76949869.figma.site/#construction-kit
- frozen local source on PLAN: `C:\Users\PLAN\Documents\gobadminton\GoBadminton Web App Design`
- frozen source tree SHA-256: `5a04ac69a259245c72da3ed5618326e8398396b4dd2c861b6eef4aecd726b1d6`
- `src/App.tsx` SHA-256: `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`
- `src/index.css` SHA-256: `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`

The frozen source contains the Style Guide page and its `ConstructionKit`, whose own source description is:

**“Canonical screen-building grammar for GoBadminton.”**

## Required decision order

Before inventing any new visual/component/composition:

1. identify the UI need;
2. inspect the relevant existing Style Guide / Construction Kit family;
3. use an existing canonical pattern when it fits;
4. if no single component fits, compose the screen from existing canonical primitives;
5. only if the Style Guide genuinely lacks a suitable pattern, record `STYLE_GUIDE_GAP` and derive a bounded extension in the same system;
6. if Product Owner explicitly rejects the existing Style Guide pattern for that case, record `OWNER_VISUAL_OVERRIDE` and a new visual solution may be created.

“Existing code is easier” is not a valid reason to bypass the Style Guide.

## Canonical families already present

The Style Guide / Construction Kit includes, among others:
- Foundation / tokens / Onest typography;
- Buttons, selectors, inputs, chips, tabs, toggles;
- Navigation: desktop / compact / bottom nav;
- GameCard and PlayerCard families;
- HeroBanner;
- ActionBanner;
- InformationalBanner;
- PromotionBanner;
- ContentCard / ListRow / SummaryCard / StatusCard;
- DesktopFooter;
- EditorialContentLayout / LegalDocumentLayout;
- SectionHeader / ContentContainer / SurfacePanel / ResponsiveGrid;
- Forms / FormGroup / validation / StickyActionBar;
- Modal / Drawer / BottomSheet / Popover / Dropdown;
- Empty / Error / Skeleton / Toast / Notices;
- media/image blocks;
- responsive recipes;
- motion/accessibility recipes;
- social / Radar / Messages / Game Chat primitives.

Canonical screen-specific composition in the frozen Make source outranks a generic kit example for that exact screen.

## Banners are first-class

Do not silently drop canonical banners or replace them with plain technical cards.

Where a frozen screen uses a Hero, Create/Action banner, promo/community region or other branded banner family, preserve that composition unless an exact Owner/DD authority authorizes removal.

## Acceptance

Every frontend implementation handoff must include a `STYLE_GUIDE_PARITY` section naming:
- patterns reused;
- screen-specific Make composition reused;
- any `STYLE_GUIDE_GAP`;
- any `OWNER_VISUAL_OVERRIDE`.

Independent frontend QA treats an uncited bypass of an available canonical Style Guide pattern as a blocking visual finding.

## Supersession by Owner direction t420u (scoped, 2026-10-25)

В области GoBadminton UI mockup/Style-Guide handling действует более позднее
прямое решение Owner t420u: макеты **всегда приблизительные**, Style Guide —
ориентир. Пиксельное совпадение не требуется. В этой области superseded как
blocking rules: обязательный decision-order gate, «canonical screen composition
outranks», требование сохранять banners, блокирующая приёмка STYLE_GUIDE_PARITY
и «uncited bypass = blocking finding» из текста выше.

`STYLE_GUIDE_GAP` и NEW elements — разрешённый записанный **non-blocking** путь:
обоснование, рассмотренные альтернативы, reuse компонентов/tokens и reference
на результат сохраняются в предметном record. Блокируют только существенные
нарушения: сломанная функция; проигнорированное Owner Decision;
проигнорированное переиспользование существующего компонента без причины;
нарушение privacy. Само отклонение от макета или Style Guide не блокирует.

Следствие: формулировки «bound by / STYLE_GUIDE_PARITY» при чтении
[Visual Review Nonblocking](OWNER_DECISION_VISUAL_REVIEW_NONBLOCKING_V001.md)
понимаются в той же ограниченной области; этот файл не изменён. В текущей
repo-копии указанных буквальных фраз нет, это не утверждение об их наличии.
Заголовок `STYLE_GUIDE_PARITY` сохраняется только как совместимое имя записи
использования reference, а не parity gate.

Frozen Style Guide source bytes не изменены. Точный реестр входов и границы
приблизительной ссылки: [DESIGN_MATERIALS](../manifest/DESIGN_MATERIALS.json),
[M2R working spec](../product/M2R_DESIGN_SPEC.md). Решения t417u/t418u/t420u/t424u
доставлены PMA в прямом Stage A assignment; merge reviewed record закрепляет
exact mockup bytes только как approximate reference inputs, не все нарисованные
действия и данные.
