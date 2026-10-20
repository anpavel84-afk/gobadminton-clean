# NAV1b — games shuttlecock

From: source author (Codex)
To: интегратор Issue #136 → независимый QA
Date: 2026-10-20
Status: PROPOSED — source candidate; не independent QA/acceptance.

## Assignment / base / scope

Immutable GOBADMINTON_AUTONOMY_V1, target dev, kind source_only, NAV1b,
первая source-попытка; prior independent QA: {}. NAV1 (#108), выбор B
19.10.2026, не повторяется. Exact base = исходный HEAD:
`0e75b57fac4ea1ffc995393395147d499e4ff366`.
Checkout `/srv/gobadminton-clean/worktrees/issue-136`; исходный tracked diff пуст.
Branch metadata не читалась/не менялась: разрешён только read-only Git
show/cat-file/diff/log. Более новый dev совмещает интегратор вручную.

Разрешённый результат: games в `apps/web/src/components/consumer/nav-icon-paths.tsx`,
тесты/helpers в `apps/web/test/nav-icons-variant-b.test.tsx`, этот новый handoff.
Другие существующие файлы, включая предыдущий NAV1 handoff, не изменены.
Сеть, install, commit/push, git metadata, API/contracts/БД/dependencies,
automation/services/deploy/PROD исключены. Новых запросов, шторок или
изменений Popup M3 нет. Отдельный QA автором не выполнялся.

## Изменения / итоговые d

Четыре замкнутых path только с d: голова, верх, середина, низ.
Капсулы имеют ширину 2.8; боковые оси -65°/-25°, средняя -45°.
Концы помещены внутри заданных координатных допусков, с симметрией R,
чтобы обеспечить консервативный clearance gate без ослабления порогов.
SVG shell, tokens, active circle, маршруты/подписи и другие иконки сохранены.

```text
M5.4 15 L9 18.6 A2.545584412271571 2.545584412271571 0 0 1 5.4 15 Z
M8.466459066 13.604835896 L12.777165335 4.360496468 A1.4 1.4 0 0 0 10.239503532 3.177165335 L5.928797262 12.421504763 A1.4 1.4 0 0 0 8.466459066 13.604835896 Z
M16.471572875 9.508326112 L19.3 6.679898987 A1.4 1.4 0 0 0 17.320101013 4.7 L14.491673888 7.528427125 A1.4 1.4 0 0 0 16.471572875 9.508326112 Z
M11.578495237 18.071202738 L20.822834665 13.760496468 A1.4 1.4 0 0 0 19.639503532 11.222834665 L10.395164104 15.533540934 A1.4 1.4 0 0 0 11.578495237 18.071202738 Z
```

Тесты используют независимые expectedTabs; изменены только /games shapes.
RootNav SSR проверяется active=games и active=players; badge/profile/CSS
проверки сохранены, mock только next/link. Отдельный NavIcon games SSR
проверяет четыре path без лишних атрибутов и точную голову.
Геометрия извлекается из SSR, не из expectedTabs.

Helpers: полностью потребляемая explicit M/L/C/A/Z грамматика, конечные числа,
точные флаги A; de Casteljau с расстоянием обеих control points до хорды
≤0.01; SVG endpoint-to-center A с rotation/radius correction и вырожденными
случаями; arc step ≤π и sagitta ≤0.01; рёбра ≤0.05.
Reflection gate использует двусторонние расстояния до сегментов плюс h/2+2ε.
Clearance gate разрезает рёбра по capsule B радиуса 1.2−ε, сохраняет все
внешние интервалы, использует расстояния между сегментами и d−2ε≥2.6.
Проверки bbox, u-размахов, среднего головы, концов и ширины используют SSR.
Unit cases включают независимые аналитические bowed C и rotated/corrected A,
синтаксические ошибки, вырожденные A, пересечения/наложения и точные cuts.

## A1–A6 / evidence

| Gate | Evidence / status |
| --- | --- |
| A1 | Source diff ограничен games; изменения тестов и этот новый handoff. SSR grammar/order assertions добавлены; исполнение NOT_TESTED. |
| A2 | Оба active-состояния реального RootNav и отдельный NavIcon SSR покрыты; прежние фикстуры и CSS/badge/profile assertions сохранены. Исполнение NOT_TESTED. |
| A3 | Parser/flattening и аналитические unit cases добавлены. ε=0.01, h=0.05. Исполнение NOT_TESTED. |
| A4 | Symmetry/clearance и segment/capsule unit cases добавлены без изменения численных gates. Исполнение NOT_TESTED. |
| A5 | SSR envelope/ratio/head/tips/normal-width assertions добавлены; запрещённые TS escape hatches не добавлены. Исполнение NOT_TESTED. |
| A6 | Команды ниже; typecheck/Vitest не стартовали, это не PASS. |

Из корня checkout отдельно:

| Command | Exit | Output / result |
| --- | --- | --- |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false` | 1 | NOT_TESTED: Corepack/pnpm недоступен offline |
| `COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/nav-icons-variant-b.test.tsx` | 1 | NOT_TESTED: Corepack/pnpm недоступен offline |
| `git diff --check` | 0 | PASS для tracked diff; новый handoff untracked, публикация интегратором |

Точный вывод обеих pnpm-команд:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

Установка/обход offline запрета не выполнялись. Strict/noUncheckedIndexedAccess
не отключались. Source/tests остаются в diff при NOT_TESTED.

## STYLE_GUIDE_PARITY

Authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`, step 5.
Pattern: существующие Navigation/BottomNav; compose/reuse прежние размер,
stroke/currentColor, active --gb-ink и круг --gb-lime-soft,
неактивный --gb-ink-soft. Screen composition за пределами этого glyph не менялась.

Canonical observation передано immutable assignment как проверенное:
frozen `/opt/gobadminton-clean-qa/style-guide/src/App.tsx`, SHA256
`04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`:
BottomNav (120), ConstructionKit Navigation (1316), icons.games →
`/assets/f8ab5.svg`. `public/assets/f8ab5.svg` в том же frozen дереве —
прямоугольник корта с двумя поперечинами; glyph волана отсутствует в
IconName/Navigation. Автор не выдаёт переданное observation за собственную
повторную проверку frozen файлов.

Bounded `STYLE_GUIDE_GAP=shuttlecock-glyph`: отсутствует подходящий badminton
glyph, а не доступ к source. Расширение ограничено games существующего
Navigation/BottomNav. Форма — **PROPOSED PM**, не Owner-confirmed shape.
Rendered parity **UNVERIFIED**; OWNER_VISUAL_OVERRIDE и Owner acceptance
не заявляются. Provenance: https://nougat-wise-76949869.figma.site/#guide
и https://nougat-wise-76949869.figma.site/#construction-kit; сеть не использовалась.
`docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` отсутствует в checkout;
binding decision прочитан. iPhone **NOT_TESTED**, не source gate.

## Ограничения / rollback / next action

### Повтор по reviewed SHA 23b74f8 (2026-10-20)

From: source author (Codex). To: интегратор → независимый QA. Status: PROPOSED.
Фактический HEAD: `23b74f8bbeac94e66a4f0ef243e136c38c64f5a2`,
branch `automation/issue-136`; исходный tracked diff пуст. Immutable base
`0e75b57fac4ea1ffc995393395147d499e4ff366` не переключалась.
Prior independent QA для этого HEAD: **FAIL**, единственное finding —
невыполненный A6 из-за отсутствующего offline pnpm 10.18.0.

Обе точные команды A6 из таблицы выше повторно выполнены отдельно из корня.
Каждая вернула exit 1 до исполнения tsc/Vitest с тем же точным выводом
Corepack, приведённым выше. Typecheck и тесты **NOT_TESTED**; A6 не пройден,
prior QA FAIL не снят. `git diff --check` и
`git diff 0e75b57fac4ea1ffc995393395147d499e4ff366 --check` вернули exit 0
без вывода. Это обязательные source-команды автора, не независимый QA.

Совокупный diff от immutable base содержит games source, тесты и этот
handoff, ровно три разрешённых файла. Source/tests сохранены без изменений:
code finding в переданном QA отсутствует. Текущий рабочий diff дополняет
только этот handoff; сам по себе он не является новым implementation result.
Устранение отсутствующего pnpm требует подготовки окружения вне allowed_paths;
install/network/dependencies/git metadata не менялись. Следующий bounded шаг —
независимый QA в заранее подготовленном offline окружении с pnpm 10.18.0
и зависимостями. Result permalinks и публикацию добавляет интегратор.

### Повтор по reviewed SHA 06d201b (2026-10-20)

From: source author (Codex). To: интегратор → независимый QA. Status: PROPOSED.
Фактический HEAD этой попытки: `06d201b909be004825d6bca2593a1d902b241467`;
исходный рабочий diff пуст. Immutable base остаётся
`0e75b57fac4ea1ffc995393395147d499e4ff366`; checkout не переключался.
Prior independent QA: FAIL, A6 unmet — pnpm 10.18.0 отсутствует offline,
TypeScript/Vitest NOT_TESTED, не доказанная ошибка исходника.

Обе точные команды A6 из таблицы выше повторно выполнены отдельно из корня.
Каждая завершилась exit 1 до исполнения TypeScript/Vitest; точный вывод:

```text
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
```

`git diff --check` и
`git diff 0e75b57fac4ea1ffc995393395147d499e4ff366 --check`:
exit 0, без вывода. A6 остаётся NOT_TESTED; PASS и снятие prior QA FAIL
не заявляются. Это исполнение обязательных команд автором, не независимый QA.
Совокупный candidate от immutable base содержит реальный games source,
тесты и handoff — ровно три разрешённых файла. Source/tests сохранены;
переписывать их без code finding ради нового рабочего diff оснований нет.
В этой попытке изменён только этот handoff. Зависимости, установка, сеть,
git metadata и публикация не затрагивались.
Следующий bounded шаг — независимый QA в заранее подготовленном offline
окружении с pnpm 10.18.0 и зависимостями. Подготовка окружения не входит
в source-only scope. Exact result permalinks добавляет интегратор.

### Повтор по reviewed SHA 273c743

2026-10-20: фактический HEAD при получении текущего assignment —
`273c7431b508a3e78329a7b52e28c7022a40608b`; рабочий tracked diff пуст.
Base не переключался. Prior independent QA для этого SHA: **FAIL**, только
невыполненный A6 (typecheck/Vitest NOT_TESTED), без доказанной ошибки кода.
Обе точные pnpm-команды A6 повторно запущены отдельно из корня: каждая
exit 1 до исполнения tsc/Vitest, с точным выводом Corepack из таблицы выше.
Локально отсутствует pnpm 10.18.0; offline запрещает его загрузку.
Установка, сеть и обход ограничения не выполнялись. A6 остаётся
**NOT_TESTED**, prior QA FAIL не снят; PASS не заявляется.
Source/tests уже входят в совокупный diff от immutable base
`0e75b57fac4ea1ffc995393395147d499e4ff366`: ровно три разрешённых файла,
включая этот handoff. Их не переписывали ради формального нового diff.
Следующий шаг — независимый QA в заранее подготовленном offline окружении;
подготовка зависимостей находится вне полномочий этого source assignment.

### Повторная source-попытка после независимого QA

На входе этой попытки HEAD уже `ab6fd7dbb285bde57edd9256a9409e5a8608dbfb`,
а не указанная в исходном assignment dev-база. Checkout/base не переключались.
Исходный рабочий diff пуст; совокупный candidate относительно
`0e75b57fac4ea1ffc995393395147d499e4ff366` уже содержит source, tests и этот
handoff (три разрешённых файла). Эта попытка не добавляет новую геометрию
или тесты: независимый QA сообщил только отсутствие исполнения A6,
а не продемонстрированную ошибку кода.

Prior independent QA: **FAIL**, reviewed SHA
`ab6fd7dbb285bde57edd9256a9409e5a8608dbfb`: A6 unmet, typecheck/Vitest
NOT_TESTED из-за отсутствия локального pnpm 10.18.0 и offline Corepack.
2026-10-20 обе точные команды из таблицы A6 повторно выполнены отдельно
из корня: каждая exit 1 до запуска tsc/Vitest, с тем же точным выводом
Corepack выше. `git diff --check` и
`git diff 0e75b57fac4ea1ffc995393395147d499e4ff366 --check` — exit 0,
без вывода. Это проверки автора по assignment, не независимый QA.
Никаких install/network/изменений зависимостей или git metadata не было.
A6 остаётся **NOT_TESTED**, общий PASS не заявлен; prior QA FAIL не снят.
Для следующего независимого QA необходимо заранее подготовленное окружение
с pnpm 10.18.0 и зависимостями; автор не уполномочен устанавливать их.

Source gates требуют выполнения в подготовленном offline окружении:
результат не подтверждён тестовым запуском. Visual/runtime/iPhone не проверялись.
Откат — обратный diff интегратором только этих трёх файлов с сохранением чужой работы.
Следующий bounded шаг: независимый QA по A1–A6 exact NAV1b assignment;
интегратор публикует candidate/handoff, добавляет exact result permalinks и
сопоставляет с новым dev. Автор commit/push/publication не выполнял,
result SHA/CI/deployment/acceptance не заявляет.

Base authority permalink:
https://github.com/anpavel84-afk/gobadminton-clean/blob/0e75b57fac4ea1ffc995393395147d499e4ff366/docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md
