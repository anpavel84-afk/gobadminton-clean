# M2R — входы приёмки

Статус: **WORKING SPEC for M2R acceptance inputs**. Stage A, 2026-10-25.
Не новый продуктовый scope и не доказательство приёмки реализации.
Источник: Issue #308, lineage #149 → #177 → #308 (сведения PMA в assignment);
[API source candidate](../api/UNIFIED_PLAYERS_RADAR_V001.md),
[реестр exact материалов](../manifest/DESIGN_MATERIALS.json).

## Назначение и authority t420u

Полный путь: Radar marker → compact player preview → expanded player card с
≤3 действительно разрешёнными upcoming public games **поверх той же карты**.
Owner t420u: макеты всегда приблизительные, Style Guide — ориентир. Function
и visual оцениваются отдельно; pixel parity не требуется. Записанный NEW element
допустим. [Решение 19 октября](../decisions/OWNER_DECISION_MAP_POPUPS_V001.md):11
имеет приоритет над стрелкой/CTA на макете; drag handle + up-arrow раскрывают
popup. [Scoped supersession](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md)
уточняет старый строгий Style Guide gate.

## Human-verified semantic note M2R

Описание передано PMA, который видел изображение. Автор Stage A его не видел
и не утверждает image perception. M2R_mockup.png — phone-frame set из трёх панелей:

1. Карта с круглыми player-avatar markers, один выбран и крупнее; compact bottom
   card: фото, имя, уровень «Средний», «Ищу игру», место «Пресня (demo)»,
   расстояние «1.2 км», активность «активна сейчас», круглая кнопка right-arrow.
2. Expanded «detail popup» поверх затемнённой карты: drag handle, close X,
   большое фото с badge «в сети 5 мин назад», имя, level chip, район
   «Москва · Пресня (demo)», «Радар рядом · 1.2 км»; три fact chips «Парная игра»,
   «Ищу игру», «124 игры»; lime CTA «Открыть профиль игрока ›», вторичные
   «Написать» и «Позвать на игру», footnote «Только публичная информация».
3. Sheet «Ближайшие игры игрока»: back chevron, close X, date chips
   Сегодня/Завтра/Ср/Чт; game card: время, «Demo Saturday Morning», badge
   «Обычная игра», organizer, «Свободно 5 из 6», right arrow; строка
   «Последние игры и отзывы — в профиле ›».

Четыре callout: marker tap открывает маленький preview; подробный popup
остаётся поверх карты (фото, уровень, район, основные действия; × или swipe
вниз закрывает); games sheet позволяет быстро оценить соответствие; только
разрешённые публичные поля, private data не раскрываются. Это описание
композиции, а не разрешение на каждое показанное поле/действие.

## FUNCTIONAL — наблюдаемые assertions для будущих browser tests

| ID | Состояние / взаимодействие | Observable assertion |
|---|---|---|
| M2R-F1 | Map idle with markers | Видны доступные сервером markers, popup отсутствует; карта смонтирована |
| M2R-F2 | Compact preview | Marker tap выбирает игрока и показывает его compact card поверх карты, URL страницы не меняется |
| M2R-F3 | Expanded card | Drag handle / up-arrow раскрывает выбранную карточку; видны имя и разрешённые поля, тот же map instance |
| M2R-F4 | Games loading | До завершения запроса виден loading; нет пустого сообщения или старых игр другого игрока |
| M2R-F5 | Games retryable error | Ошибка отличается от empty; доступный Retry повторяет разрешённый preview-запрос и приводит к loading |
| M2R-F6 | Games checked-empty | После проверенного пустого ответа показано ровно «Нет доступных ближайших публичных игр»; нет догадки о private games |
| M2R-F7 | Games list ≤3 | Отрисованы 1–3 уникальные разрешённые игры в порядке startsAt/id; нет счётчика скрытого total |
| M2R-F8 | Close и back | X, swipe/drag down, Escape закрывают popup; browser back где применим закрывает его history entry, не уводит со страницы карты |
| M2R-F9 | Keyboard/focus/a11y | Marker и up-arrow доступны с клавиатуры, Enter/Space открывают; у close/retry есть accessible names; modal focus удерживается в popup и после close возвращается trigger; loading/error сообщаются assistive technology |
| M2R-F10 | Map continuity | При открытии/раскрытии/закрытии map mount count не растёт; camera center/zoom/bearing/pitch сохраняются; нет переходов на venue/player pages |
| M2R-F11 | Selection/invalidation | Смена marker/закрытие/истечение proof отменяют или игнорируют старый ответ; игры старого игрока не появляются |
| M2R-F12 | Game-card interaction | **A_map_only — default pending Owner answer**: game cards не навигируют; URL и camera остаются прежними (O1) |

Browser tests здесь только описаны, не реализованы и не выполнены. Жест имеет
клавиатурную альтернативу; responsive layout не должен скрывать close/retry.
Открытие карты не включает/выключает Radar: существующее
[решение Radar toggle](../decisions/OWNER_DECISION_RADAR_TOGGLE_DIRECTORY_MAP_V001.md):37.

## DATA / PRIVACY

Wire authority: `packages/contracts/openapi.json`:20787 (`UnifiedPreview`,
additionalProperties:false), :20806 (`upcomingGames`, maxItems:3), :25276
(`UnifiedUpcomingGame`, additionalProperties:false). Разрешены только public
game id, title, activityKind, startsAt, endsAt, timezone, cover.uploadedUrl,
venue.{name,cover.uploadedUrl}; это совпало с
`docs/api/UNIFIED_PLAYERS_RADAR_V001.md`:51–54. Никаких roster/status/contacts/
notes/coordinates/provider metadata/counts. Player fields — только из текущего
`RadarPlayerProjection`, без реконструкции отсутствующих данных; округлённое
расстояние — только по действующему контракту, не буквальные «1.2 км» из demo.

`docs/api/UNIFIED_PLAYERS_RADAR_V001.md`:23–27: resultRef-only `u1.` preview,
cookie/CSRF/key protection, no-store; никакого нового player-ID schedule route.
:29–49: viewer-scoped server authorization **до** LIMIT, current public creator
или подтверждённое участие при viewer roster authority; публичность игры сама
по себе не раскрывает участие. Proof/session/consent/blocks и финальные fences
сохраняются. :56–60: клиент проверяет весь preview/schedule, identity/deadlines;
loading, retryable error, checked empty различаются. Указанное empty сообщение
ничего не утверждает о private games. В task-фактах и этих repo-контрактах
расхождений по allowlist/лимиту не найдено; live Issue/network не проверялись.

## EXCLUSIONS

Right arrow navigation, «Открыть профиль игрока» и «Последние игры и отзывы —
в профиле» исключены решением 19 октября. Mockup-only activity/online badge,
«124 игры», organizer, «Свободно 5 из 6», message/invite actions **EXCLUDED**:
они не авторизованы DTO allowlist/Issue scope; допускаются только если конкретное
существующее contract field и исходный scope действительно дают их (не выводить
их из изображения). Нельзя фабриковать last activity, games, metrics/counts или
private data. Новый API, scope expansion, visual checker, admission и Task Audit
machinery не входят в Stage A.

Date chips vs plain list, card layout, colours, spacing, hero photo — presentation:
связный выбор автора с reuse rationale, non-blocking по t420u, не Owner questions.

## REUSE и разрешённый NEW-ELEMENT record

Перед изобретением искать Style Guide PlayerCard, Radar preview, Drawer/BottomSheet
families. Проверенные source targets: `apps/web/src/components/consumer/players/ProfileComposition.tsx`
(PlayerCard), `radar/UnifiedPlayerCard.tsx`, `radar/UnifiedPlayerPreview.tsx`,
`radar/RadarComposition.tsx` (все radar paths под тем же consumer/),
`apps/web/src/components/consumer/games/VenuePopup.tsx` — drag-sheet из решения
19 октября. Старый frontend — inventory для reuse, не самостоятельный visual canon.

NEW-ELEMENT — разрешённый **non-blocking** путь, не новый approval gate.
Record содержит: id, version, task_ref, rationale, alternatives_considered,
reused tokens/components, screenshot_ref{hub_locator,sha256,bytes,state,viewport},
owner_decision_refs, status. Screenshot хранится на files.anpavel.ru, не в Git;
пока его нет — честное pending/not captured, не придуманный hash. Эти поля
описывают будущую запись результата, никакая runtime-схема Stage C не добавляется.

## Что блокирует / что никогда не блокирует

По t420u блокируют только существенные нарушения: broken function; ignored
Owner Decision; ignored existing-component reuse without reason; privacy.
Сами по себе deviation from mockup/Style Guide, отсутствие pixel parity,
STYLE_GUIDE_GAP и обоснованный NEW element **никогда не блокируют**.
Проверка пригодности exact входов Stage A не означает visual verdict.

## Конфликты и открытые вопросы

- C1 resolved: mockup arrow/CTA/profile link проигрывают MAP_POPUPS:11–13.
- C2 resolved: mockup-only data исключены действующим DTO/privacy contract.
- C3 resolved: прежний #149 admission «M2R_mockup not mounted / not a required
  input» — исторический факт из PMA brief; под t417u/t420u/t424u exact mockup
  становится approximate reference input, **никогда parity assertion**.
- C4 unresolved, Stage A non-blocking, связан с O1.
- O1: A = map-only slice, game cards do not navigate; B = permit game-page
  navigation/return behaviour. Architect recommends A; **A_map_only — default
  pending Owner answer**. Поиск в `docs/decisions`, `docs/product`,
  `docs/manifest/OPEN_DECISIONS.md` не нашёл ответа для player-popup games.
  `OWNER_DECISION_GAMES_VENUES_MAP_V001.md`:28 касается **VENUE** popup → Game
  detail; это другой scope и не решает O1.
- O2 (Stage C): authentic Task-Audit answer-confirmation channel — A PMA relay +
  one Owner GitHub confirmation; B chat-only after proven authenticated ingress.
  Recommended A; unresolved, non-blocking для Stage A, только перечислен.
- O3 (Stage B/C): manual vs pending visual acceptance when image route fails.
  Recommended explicit manual review when useful; unresolved, non-blocking для
  Stage A, только перечислен.

## Честность проверки

Spec фиксирует проверяемые входы, не подтверждает реализацию, image perception,
visual PASS, independent QA, browser/runtime qualification, DEV или full-tree
Style Guide PASS. Frozen manifest/bytes не читались автором; pins даны PMA.
Embedded Style Guide decision (3383 bytes) отличается от исходной repo-копии
(3308 bytes до append), и frozen aggregate tree не реконструирован.
Принятие exact candidate/merge и actual-identity access receipts — отдельные факты.
