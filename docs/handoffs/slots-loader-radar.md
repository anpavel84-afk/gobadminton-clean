# MAP-PERF1: обратная связь загрузки модуля Radar

- From: source author (Codex).
- To: независимый QA; затем интегратор более нового dev.
- Date: 2026-10-21.
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_QA; выполнение проверок ограничено окружением. Не ACCEPTED, не независимый QA, не CI, не выпуск.
- Assignment: source-only, target dev, worktree `issue-152`, lock `web:radar-map-loader`; единственный срез — индикация загрузки существующего dynamic-модуля Radar и обработка отказа import/chunk.
- Base по immutable assignment: dev `9d3e092cc30796ffc0096c50584a771e60c18ef3` = заявленный HEAD checkout. Фактический HEAD/branch через Git не подтверждён: отсутствует доступный alternate object store (см. evidence ниже). Более новый dev совмещает интегратор вручную.
- Base reference: https://github.com/anpavel84-afk/gobadminton-clean/tree/9d3e092cc30796ffc0096c50584a771e60c18ef3 (в этой offline-сессии не открывался).
- Candidate commit/permalink: отсутствует. Commit, push, публикация и git-запись запрещены текущим поручением; этот handoff и код оставлены локальными файлами для последующего durable GitHub record интегратором.

## Scope и artifacts

Изменяются только пять разрешённых путей:

1. `apps/web/src/components/consumer/radar/RadarPage.tsx` — существующий dynamic сохраняет `ssr:false`, получает `loading: RadarMapModuleLoading`; отказ импорта преобразуется в локальный `RadarMapModuleError`. Он сразу рисует прежний alert и после монтирования вызывает `onUnavailable` через `useEffect`, переводя страницу на существующий `failed` путь.
2. `apps/web/src/components/consumer/radar/RadarMapModuleLoading.tsx` — новый чистый компонент без hooks: точный текст «Загружаем карту…», `role=status`, `aria-live=polite`, `aria-atomic=true`, декоративная точка с `aria-hidden=true`.
3. `apps/web/src/styles/radar-geographic.css` — только локальные правила `.gb-radar-layer .gb-radar-map-module-loading` и её декоративной точки. Компактная absolute-плашка, z-index 3, отступ сверху `calc(72px + env(safe-area-inset-top,0px))`, слева 16px, padding 12px, gap 10px, максимальная ширина в пределах viewport, перенос текста и `pointer-events:none`.
4. `apps/web/test/radar-map-module-loading.test.tsx` — новый тест реального компонента через `renderToStaticMarkup`; узкий mock `next/dynamic` перехватывает реальные loader/options из RadarPage. Подменяются GeographicRadarMap и посторонний GamesMapView; карта не создаётся. Отдельные случаи: SSR disabled, настоящий loading, успешный импорт, отказ импорта с alert без loading-текста до mount effect. Индекс mock.calls проверяется явно; нет `any`, TS-подавлений, индексных non-null assertions, hook stores или самодельного renderer.
5. `docs/handoffs/slots-loader-radar.md` — эта передача.

Технический результат — FACT о записанном исходном коде, поведение в runtime ещё не подтверждено. Уведомлением управляет существующий dynamic: после успешного import оно заменяется компонентом карты независимо от загрузки данных/тайлов. Новых preloading promises, запросов, таймеров, map instances или ключей для remount нет. Ветка `mapped && sharedMap`, вход без sharedMap, прежний failed-alert, список, камера, маркеры, выбранная карточка, проверки согласия/приватности и фото не редактировались. Контракты/API/БД/зависимости/automation/services/PROD вне scope.

## STYLE_GUIDE_PARITY

- Authority: [Owner decision](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md), [Construction Kit](https://nougat-wise-76949869.figma.site/#construction-kit), семейство **Feedback & loading / Toast / Snackbar**, указанное точным assignment. Используется оболочка ink/white с lime-акцентом, без таймера Toast и без анимации.
- Foundation: существующие токены `--gb-ink`, `--gb-white`, `--gb-lime`, `--gb-radius-sm`; размер текста 14px, семейство шрифта наследуется от страницы (Foundation / Onest). Новые значения цветов/типографические семейства не вводятся.
- Композиция Radar: существующий viewport, прозрачность `.gb-radar-layer`, видимость переданной sharedMap и прохождение жестов сохраняются; плашка внутри слоя не получает фокус и не перекрывает viewport целиком.
- Замороженный эталон: чтение `/opt/gobadminton-clean-qa/style-guide/src/App.tsx` и `/opt/gobadminton-clean-qa/style-guide/src/index.css` завершилось exit 1, для обоих `No such file or directory`. Визуальная сверка с исходниками — UNVERIFIED; применена спецификация Toast/Snackbar из задания.
- Figma Make: UNVERIFIED — сеть запрещена assignment, ссылка не открывалась. Визуальная браузерная сверка не выполнялась.
- `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md`, указанный в AGENTS.md, отсутствует (`cat`: exit 1, `No such file or directory`); доступное Owner decision прочитано.
- STYLE_GUIDE_GAP: не заявлен; повторно применяется указанный canonical pattern. OWNER_VISUAL_OVERRIDE: не заявлен. Намеренных отклонений от спецификации задания нет; полная визуальная parity пока не подтверждена.

## Результаты acceptance 1–6

| Пункт | Авторский source-only результат / предел evidence |
| --- | --- |
| 1 | Записаны реальный код RadarPage, новый loading-компонент, локальный CSS, новый тест и handoff. Это не handoff-only изменение. Полный Git diff не доступен из-за отсутствующих objects. |
| 2 | Новый тест рендерит реальный чистый компонент и сравнивает точную HTML-разметку с текстом и всеми требуемыми ARIA-атрибутами. Исходники строками не проверяются. Исполнение NOT_TESTED. |
| 3 | Новый тест перехватывает реальные dynamic loader/options; успешный import должен вернуть подменённый map component, отказ — компонент с точным alert без loading. `onUnavailable` вызывается в production через useEffect; прежний failed-alert/список сохранены. Исполнение теста NOT_TESTED; mount effect в SSR-тесте не исполняется, проверка эффекта остаётся независимому QA по diff. |
| 4 | Внесены scoped CSS по заданным размерам и токенам, перенос текста и pointer-events:none. Существующие viewport/прозрачность и логика карты не редактировались. Браузерная проверка NOT_TESTED. |
| 5 | Новый тест использует существующий strict tsconfig с noUncheckedIndexedAccess. Проверки типов/lint/нового теста NOT_TESTED: инструменты отсутствуют. Старые тесты не изменялись и не запускались. |
| 6 | Выполнены попытки всех четырёх точных команд из корня; результаты ниже. Typecheck/lint/Vitest не стартовали. `git diff --check` — FAIL (exit 128, ошибка object store); это не PASS и не заключение о whitespace. |

## Команды и фактический вывод

Проверки автора не означают независимый QA. Установка зависимостей и сеть не использовались.

`COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false`

- Exit: 254. NOT_TESTED — executable `tsc` отсутствует.

```text
undefined
/srv/gb-slots/slot2/worktrees/issue-152/apps/web:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsc" not found
```

`COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web run lint`

- Exit: 1. NOT_TESTED — executable `eslint` и локальные node_modules отсутствуют.

```text
> @gobadminton/web@0.1.0 lint /srv/gb-slots/slot2/worktrees/issue-152/apps/web
> eslint .

sh: 1: eslint: not found
/srv/gb-slots/slot2/worktrees/issue-152/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @gobadminton/web@0.1.0 lint: `eslint .`
spawn ENOENT
 WARN   Local package.json exists, but node_modules missing, did you mean to install?
```

`COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/radar-map-module-loading.test.tsx`

- Exit: 254. NOT_TESTED — executable `vitest` отсутствует.

```text
undefined
/srv/gb-slots/slot2/worktrees/issue-152/apps/web:
 ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "vitest" not found
```

`git diff --check`

- Exit: 128. FAIL команды из-за недоступных Git objects; проверка whitespace не состоялась.

```text
error: unable to normalize alternate object path: /srv/gb-slots/base.git/objects
error: unable to normalize alternate object path: /srv/gb-slots/base.git/objects
error: unable to normalize alternate object path: /srv/gb-slots/base.git/objects
fatal: unable to read 04cce81096af03804d62b2ccdd8d72d962c16f62
```

Стартовая проверка `git show --no-patch --format='%H %D' HEAD`: exit 128, та же ошибка alternate object path и `fatal: bad object HEAD`. До редактирования `git diff --stat` и `git diff --name-only` вернули exit 0 без вывода; это ограниченное наблюдение, а не подтверждение полного состояния репозитория. Git metadata не исправлялись. Локальная документация Next `apps/web/node_modules/next/dist/docs/` также отсутствует (find: exit 1, No such file or directory).

## Ограничения, следующий шаг и откат

- Время загрузки в браузере/iPhone: NOT_TESTED, наблюдений и измерений нет. Нет browser smoke, CI, deployment или Owner acceptance.
- Независимый QA должен проверить этот bounded candidate с доступными Git objects и установленными зависимостями: выполнить указанные четыре команды, проверить diff, затем наблюдать loading / успешный import / chunk failure и сохранение sharedMap. Другие срезы MAP-PERF1 не начинать автоматически.
- Интегратор публикует candidate и этот handoff в GitHub по правилам Project Record Policy и добавляет exact candidate permalink; публикация автором этой offline-задачи не разрешена. Не считать локальный файл уже опубликованным durable record.
- Откат: обратный патч только этого diff в пяти allowed_paths; новые компонент/тест/handoff удалить как часть обратного патча, изменения RadarPage/CSS обратить. Не откатывать чужие изменения и не сбрасывать всю ветку. Git-записи, сервисные и DB-действия для этого source-only отката не нужны.
