# V0 — публичный просмотр площадки

Дата: 2026-10-20. Автор: Codex, source author. Получатель: интегратор, затем независимый QA.
Статус: WORKING_DRAFT / READY_FOR_REVIEW; typecheck и unit tests NOT_TESTED.
Авторские команды ниже не являются независимым QA. Визуальная приёмка не подтверждена.

## Assignment и точная база

Источник задания: предоставленный Owner immutable JSON `GOBADMINTON_AUTONOMY_V1`, target `dev`, kind `source_only`, worktree issue-114. Это ограниченный TR1-V0: исключить административный запрос из публичного просмотра площадки. Никаких прав из Me, новых запросов/полей, API/БД/contracts, зависимостей, workflow, служб, PROD или M3.

Заявленный Base: `b85f3280e58b02d71f633bd5e943a6c26a582e10`:
https://github.com/anpavel84-afk/gobadminton-clean/commit/b85f3280e58b02d71f633bd5e943a6c26a582e10

FACT: при старте фактический HEAD — `faade9a313e92b77b1b89d6ea7b77991a8350cda`, branch `automation/issue-114`; `git diff --stat` пуст.
https://github.com/anpavel84-afk/gobadminton-clean/commit/faade9a313e92b77b1b89d6ea7b77991a8350cda

Checkout/git metadata не менялись. Diff подготовлен относительно фактического HEAD; интегратор должен учитывать расхождение с заявленной базой. Никакого commit результата и permalink реализации пока нет: прямое поручение запрещает commit/push/сеть/публикацию. Файлы для последующей durable GitHub representation подготовлены здесь, публикация не заявляется.

Прочитаны AGENTS.md, rules index и PROJECT_RECORD_POLICY, Owner decisions, manifest, bootstrap, architecture overview/module boundaries, ChatOps route/PM cheatsheet/onboarding и Style Guide decision. `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md` отсутствует в checkout. Сеть и frozen reference не открывались.

## Изменения и evidence по acceptance 1–6

1. Единственное изменение production-кода: `apps/web/src/components/consumer/venues/VenuePage.tsx` — удалены импорт и JSX `VenueCoverEditor`, включая callback обновления обложки. Пассивные VenueCover, название, адрес, VenueCoverCredit и GamesMapView сохранены. Редактор и `venue-cover-api.ts` сохранены без изменений; отдельный административный вход не создавался. Серверные права записи и гостевой `/v1/me` не менялись.
2. Новый `apps/web/test/venue-public-access.test.tsx`: исполняет реальные VenuePage, GamesMapView и вложенные площадочные компоненты. Исполнитель рекурсивно обходит function components, ведёт раздельные hook slots/effect dependencies/cleanup по экземплярам, выполняет эффекты и рендер после fetch, очищает размонтированные экземпляры. Подменены shell chrome, Next Link и динамический движок карты; редактор, transport и площадочные карточки не подменены. Реальный getMe получает локальный 401 гостя или 200 вошедшего пользователя; публичное дерево проверяется в обоих сценариях без введения флагов в production. Каждый fetch регистрируется до обработки, включая admin 403. Проверки: загрузка/повторный рендер, venueId A→B, выбор A/B на карте, отсутствие редактора/файлового ввода, название/адрес/обложка/заглушка/авторство; игры/пустое/недоступное расписание; отказ публичного GET и успешный retry. Это не SSR-only тест. Реальная глобальная навигационная оболочка здесь вне runtime-теста; её достижимый код включён в boundary test.
3. Новый `apps/web/test/venue-public-boundary.test.ts`: TypeScript AST рекурсивно проходит относительные executable imports, re-exports и literal import(), включая lazy GamesVenueMap и любой достижимый попап, исключая type-only и CSS. Неизвестный nonliteral import() и неразрешённые относительные code edges дают ошибку. Для каждого достижимого файла запрещены VenueCoverEditor, venue-cover-api и строка `/v1/admin/`. Списка только заранее известных карточек и фиктивного M3 нет.
4. `apps/web/test/venue-cover.test.tsx`: сохранены проверки обложек/заглушек и успешного GET/PUT/DELETE протокола. Проверки cookie session, CSRF на mutations, версии PUT/DELETE и ключа повтора сохранены/дополнены. Добавлены все шесть комбинаций GET/PUT/DELETE × 401/403 с локальным fetch, VenueCoverError и исходным status; ложный success запрещён.
5. `apps/web/test/venue-cover.browser.mjs`: вместо админского сценария — синтетический гость, четыре ширины, обложка/заглушка/название/адрес, отсутствие редактора, обновление расписания и счётчик каждого admin endpoint. Любой admin запрос считается до ответа 403. Только origin 127.0.0.1, внешние запросы блокируются; сервисы и браузеры не устанавливались/не запускались. Syntax PASS; исполнение NOT_TESTED — нет подготовленной среды, `.tools` и зависимостей, запуск служб/загрузка браузера запрещены assignment.
6. Новые тесты написаны для strict/noUncheckedIndexedAccess из root tsconfig; без any, TS-подавлений и non-null assertions на индексах. Выполнение typecheck/unit tests не подтверждено (ниже).

## Команды и фактические результаты

Из корня worktree, отдельно:

```text
COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit --incremental false
exit 1 — NOT_TESTED (tsc не стартовал)
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz

COREPACK_ENABLE_NETWORK=0 pnpm --filter @gobadminton/web exec vitest run --no-cache test/venue-public-access.test.tsx test/venue-public-boundary.test.ts test/venue-cover.test.tsx
exit 1 — NOT_TESTED (Vitest не стартовал)
! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz
Network access disabled by the environment; can't reach https://registry.npmjs.org/pnpm/-/pnpm-10.18.0.tgz

node --check apps/web/test/venue-cover.browser.mjs
exit 0, вывод пуст — PASS (синтаксис)

git diff --check
exit 0, вывод пуст — PASS (whitespace tracked diff)
```

FACT: `node_modules` и `apps/web/node_modules` отсутствуют; `.tools` отсутствует. Ничего не устанавливалось. Ограничение среды не означает успешного typecheck или успешного поведения тестов. Код и обязательные тесты остаются в diff/новых файлах, результат не handoff-only.

## M2 / M3 и STYLE_GUIDE_PARITY

FACT: Base имеет компактную M2-карточку с правой стрелкой → в VenuePreviewCard.tsx; GamesMapView.tsx выполняет location.assign на `/venues/...`. Эти файлы только прочитаны. M3 отсутствует, навигация не изменена. V0 не заявляет выполнения Owner 19.10 17:17.

OWNER requirement для отдельной интеграции M3: маркер → компактная карточка → попап над картой; без стрелок вправо и переходов на страницы площадки/игрока, стрелка вверх раскрывает попап; нет ссылок `/venues/...` с карты; карта и URL сохраняются. N означает число игр, не мест. Недоступное расписание не считать пустым. Не выдумывать отсутствующие в Venue/VenueSummary галерею/«1/4», рейтинг, факты и контакты; контакты — будущий V1b. Существующий games-map-refresh.test.tsx ожидает переход Base и относится к M3, V0 его не меняет.

Reference M3 Owner 19.10 17:34:
https://files.anpavel.ru/projects/gobadminton/design/map/M3_venue_mockup.png
Не открывался: для V0 не требуется. Будущая композиция: одинаковые компактные карточки с квадратным фото, названием, адресом, 1–2 строками пустого/ближайшего расписания и количества игр; ручка/круглая стрелка вверх. Попап: фото → название → рейтинг → адрес → факты → контакты → игры; лист игр с назад/датами/карточками, закрытие X/свайп вниз. Данные, которых нет в контракте, не показывать.

STYLE_GUIDE_PARITY: UNVERIFIED; соответствие изображению M3: UNVERIFIED; визуальная приёмка: не подтверждена. V0 не меняет стили и не создаёт новый визуальный паттерн; сохраняет существующие media/credit/schedule элементы. Frozen screen-specific Make composition не проверена. STYLE_GUIDE_GAP — только PROPOSED расширение Style Guide для будущего M3; не выдано за принятую композицию. OWNER_VISUAL_OVERRIDE не заявлен.

## Откат и следующий bounded шаг

Откатить только diff V0 в VenuePage.tsx, venue-cover.test.tsx и venue-cover.browser.mjs; удалить добавленные V0 venue-public-access.test.tsx, venue-public-boundary.test.ts и этот handoff. Не применять reset/rollback всего checkout и не затрагивать изменения интегратора.

Интегратор публикует код, оба новых теста, изменённые тесты и handoff в GitHub с точным commit permalink, повторяет четыре команды в подготовленной offline-среде и передаёт независимому QA. При интеграции M3 повторяет проверки V0 и отдельно проверяет требование 17:17. До этого проверки поведения, независимый QA, deployment и Owner acceptance не подтверждены.
