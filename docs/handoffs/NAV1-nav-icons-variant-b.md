# NAV1 — нижняя навигация, вариант B

From: source author (Codex)
To: интегратор Issue #108 → независимый QA
Date: 2026-10-19
Status: PROPOSED — source candidate; tooling checks NOT_TESTED; не приёмка.

## Цель и точная база

Заменить только четыре рисунка мобильной навигации на вариант B «Спортивный акцент»:
games, players, mine, messages. Активная иконка получает круг на существующем токене;
маршруты, подписи, порядок, badge, Radar и layout остаются прежними.

Base SHA / исходный HEAD: 6dd3972d7e5ff237b68878980fc4d11beeecda66.
Checkout: /srv/gobadminton-clean/worktrees/issue-108.
Branch по HEAD: automation/issue-108 (также automation/issue-106 указывает на базу).
До работы tracked diff пуст. Remote не проверялся; работа полностью offline.
Более новый dev интегратор совмещает вручную.

Задание: immutable GOBADMINTON_AUTONOMY_V1, target dev, kind source_only, NAV1.
Разрешены только NavIcon.tsx, nav-icon-paths.tsx, foundation.css,
test/nav-icons-variant-b.test.tsx и docs/handoffs/**. Commit, push, git metadata,
сеть, install, dependencies, API/БД/contracts, automation, services и PROD запрещены.
Максимум попыток: 3; это первая source-реализация, prior independent QA: {}.

## FACT / PROPOSED

- FACT: вариант B выбран владельцем 19.10.2026 по переданному PM заданию.
  Отдельного decision-файла это задание не создаёт.
- FACT: геометрия скопирована из полной спецификации задания; внешний дизайн-кит
  не искался и не проверялся. Справочные provenance checksums не являются
  результатом проверки автором.
- FACT: inline SVG декоративны, currentColor; profile остаётся img.
- PROPOSED: этот незакоммиченный source candidate для независимого review.
  Реализация, независимый QA, публикация, deployment и Owner acceptance —
  отдельные факты. Приёмка и deployment не заявляются.

## Файлы и поведение

- apps/web/src/components/consumer/nav-icon-paths.tsx — новый типизированный
  Record четырёх ReactNode fragments: games 4 path, players circle + 3 path,
  mine 3 path, messages 1 path; точные значения из задания.
- apps/web/src/components/consumer/NavIcon.tsx — inline SVG 24×24,
  viewBox 0 0 24 24, fill none, stroke currentColor/1.8, round cap/join,
  focusable false, aria-hidden true; profile — прежний /brand/profile.svg,
  alt пустой. MessageGlyph, shuttlecockElement, FoldedMapGlyph не изменены.
- apps/web/src/styles/foundation.css — единственное добавление:
  .gb-bottom-nav a[aria-current="page"] .gb-nav-icon с border-radius 50%,
  background-color var(--gb-lime-soft), box-shadow 0 0 0 4px var(--gb-lime-soft),
  внутри существующего max-width: 720px после bottom-nav правил.
- apps/web/test/nav-icons-variant-b.test.tsx — новый SSR regression test:
  реальный RootNav active players без provider; mock только next/link по web94;
  четыре упорядоченные ссылки, единственный current, отсутствие img/message glyph
  и badge; каждый SVG отдельно, все атрибуты и точные независимые фигуры по порядку.
  Дополнительно badge 0/7/142, shared MessageGlyph, profile, единственность
  CSS-правила и balanced media block, underline, grid, safe-area, clamp, gap,
  высота таба и цвета.
- docs/handoffs/NAV1-nav-icons-variant-b.md — этот handoff.

RootNav, nav-items, public/brand, Radar и ContactAction не редактировались.
Новых цветовых литералов нет. CSS underline, размеры и позиции не менялись.

## STYLE_GUIDE_PARITY

Pattern: Navigation/BottomNav из canonical Style Guide / Construction Kit.
Authority: docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md,
base permalink:
https://github.com/anpavel84-afk/gobadminton-clean/blob/6dd3972d7e5ff237b68878980fc4d11beeecda66/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md

Canonical external references:
https://nougat-wise-76949869.figma.site/#guide
https://nougat-wise-76949869.figma.site/#construction-kit

Tokens: --gb-lime-soft (активный круг), --gb-ink-soft (неактивная ссылка),
--gb-ink (активная ссылка), существующий --gb-lime-deep (underline).
Screen-specific Make composition: exact screen parity UNVERIFIED;
внешние страницы и frozen source offline не инспектировались.
OWNER_VISUAL_OVERRIDE не заявляется. STYLE_GUIDE_GAP не установлен:
задание задаёт точную геометрию для существующего семейства Navigation/BottomNav;
новый паттерн не выдумывается.
Указанный в AGENTS.md docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md
отсутствует в checkout (cat: No such file or directory); decision прочитан.
iPhone и внешняя визуальная parity: NOT_TESTED, не gate source diff.

## Команды и evidence

Выполнены отдельно из корня checkout, без установки и сети:

| Команда | Exit code | Результат |
| --- | --- | --- |
| COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false | 1 | NOT_TESTED: Corepack не смог запустить pnpm |
| COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint | 1 | NOT_TESTED: Corepack не смог запустить pnpm |
| COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/nav-icons-variant-b.test.tsx | 1 | NOT_TESTED: Corepack не смог запустить pnpm |
| git diff --check | 0 | PASS для tracked diff; новые файлы остаются untracked до интеграции |

Одинаковая точная причина первых трёх результатов:
Corepack: “Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz”;
“Network access disabled by the environment; can't reach
https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz”.
Typecheck, lint и Vitest фактически не стартовали; это не PASS и не результат
исполненного теста. Пакеты не устанавливались, обход запрета сети не выполнялся.
Независимый QA автором не проводился.

## Риски, откат и продолжение

Риск: новые тесты и strict typecheck не исполнены из-за недоступного локального
pnpm; SSR assertions и visual parity требуют независимого подтверждения.
Runtime, iPhone и внешняя parity не проверены. Стенд не является gate source diff.

Откат: интегратор снимает только этот diff, включая три новых файла;
не откатывает чужие изменения и не переписывает историю.

Следующий bounded action: независимый QA проверяет данный source candidate по
D1–D5 задания NAV1 в подготовленном offline окружении с pnpm 10.18.0,
выполняет три указанные проверки и diff --check, сверяет неизменность
запрещённых поверхностей. Visual/iPhone evidence оформляется отдельно без
превращения его отсутствия в source gate. Новая продуктовая задача не выдаётся.

GitHub публикацию задания/source/handoff и exact result commit permalinks
добавляет интегратор после sandbox. Автор не выполнял commit/push и не
придумывает result SHA, permalink, CI, DEV release или Owner acceptance.
