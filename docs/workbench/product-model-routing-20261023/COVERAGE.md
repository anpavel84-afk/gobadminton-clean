# Покрытие исходных записей: не превращать открытые Issues в новую очередь

Это reconciliation overlay модели/результата, не изменение статусов. Проверенный список репозитория: 79 открытых Issues, PR исключены. Сверка planning — snapshot `2026-10-23T02:01:28Z`, поэтому названия состояний ниже означают **записанный факт в том срезе**, не вечный live status. К #225 отдельно применён последующий сохранённый handoff. Старый record остаётся в истории даже при появлении принятого преемника.

Классы: **сохранить done** — не запускать автора; **frozen/deferred** — не сбрасывать попытки; **unknown** — не повторять эффекты; **parent/OPS** — не выдавать за готовый продуктовый admission. Профили определены в ASSIGNMENTS.json; для done профиль нужен только при будущем новом регрессионном задании.

| Issue | Записанное состояние / назначение | Действие и будущий профиль |
|---|---|---|
| #1 | Исторический транспортный P0, not_admitted | Не запускать из старого поручения; при актуальном инциденте OPS-EXEC, Sol High/Astra по доказанному блокеру |
| #2 | Историческая Radar/Profile revalidation | Не дублировать принятые #13/#28; отдельный воспроизведённый остаток APP-C |
| #3 | Исторический isolated DEV | Сверить фактическую инфраструктуру, не новый setup; OPS |
| #4 | Исторический delivery/QA commissioning | Операционный parent, не авторская задача |
| #5 | Родитель Friends/Messaging/Games roadmap | Ссылаться на реальные дочерние требования, не создавать общую мегазадачу |
| #6 | Исторический Clean cutover | Не повторять миграцию или импорт старого repo |
| #12 | done Friends | Сохранить; FR-2/FR-3 как отдельные результаты |
| #13 | done Radar | Сохранить; будущий delta APP-C/TRUST-K по предмету |
| #14 | Исторические map assets, not_admitted | Не повторять публикацию по старому статусу; актуальный asset gap RESEARCH + OPS-EXEC |
| #15 | done organizer avatars | Сохранить; будущий UI-S |
| #23 | Исторический CI blocker | Не запускать старый fix без текущего воспроизведения |
| #28 | done games map | Сохранить; актуальные остатки M2R/MAP-FILTER/MAP-PERF1 |
| #29 | Старое commissioning / AGY findings | Источник семи AGY finding, не второй runner |
| #30 | done canary | Не повторять |
| #31 | done canary | Не повторять |
| #36 | done profile cover | Сохранить; будущий media delta APP-C |
| #37 | done venue cover capability | Сохранить код; реальное наполнение COVERS-LIB/I1-RUN не объявлено done |
| #46 | done Admin access | Не менять авторизацию ради новой очереди |
| #47 | done game cover | Сохранить; будущий APP-C с media invariants |
| #53 | Библиотека фото, not_admitted | COVERS-LIB: Gemini research, Sonnet QA, отдельный инструмент иллюстраций, операторский импорт |
| #52 | done venue picker layout | Сохранить; будущий UI-S |
| #54 | done horizontal overflow | Сохранить; будущий UI-S |
| #62 | done map entry/mobile switch | Сохранить; будущий UI-S |
| #61 | done removal of count-chip cloud | Сохранить; будущий UI-S |
| #64 | done admin venue covers | Сохранить; не повторять UI; V3b отдельный remaining result |
| #66 | done short-mobile map layout | Сохранить; будущий APP-C |
| #69 | Watchdog OPS record | Не создавать GPT polling; deterministic watchdog |
| #78 | done successor of Radar map work | Сохранить историю родителя, не переавторять |
| #82 | done venue contacts/API | V1b использует существующий contract, не новый API |
| #84 | done basemap | Сохранить |
| #92 | done map shell | Сохранить |
| #94 | deferred marker states | Не повторять frozen task; сравнить с MAP-FILTER before any authorized remainder |
| #96 | deferred mobile map | Сохранить; позднейшие #98/#101 и MAP-PERF1 исключают повторную реализацию |
| #98 | done map stability | Сохранить |
| #101 | done opaque layer fix | Сохранить |
| #104 | done cover fallback | Сохранить; не путать placeholder с заполненной venue library |
| #106 | done M6 | Сохранить; provenance обязателен для контента |
| #108 | done NAV1 | Сохранить |
| #109 | done I1 code | I1-RUN проверяет реальное наполнение, не повторяет импортёр |
| #112 | done M2 | Сохранить |
| #114 | done V0 | Сохранить |
| #117 | deferred M3 parent | Сохранить историю; #142 ready outcome не переписывать |
| #127 | deferred M3 predecessor | Не запускать параллельно последующим исправлениям |
| #131 | done M3 checks fix | Сохранить |
| #133 | done M3 UAT slice | Сохранить |
| #134 | deferred contacts | Сверять accepted #142, не новый duplicate source task |
| #136 | deferred NAV1b | Сохранить; #138 done |
| #138 | done NAV1b | Сохранить |
| #141 | deferred photo | Сохранить; #147 done |
| #142 | done M3 contacts | Сохранить |
| #144 | deferred photo repair | Сохранить; #147 done |
| #147 | done M3-PHOTO | Сохранить |
| #149 | deferred M2R | Вместе с #177 — frozen recovery, APP-C UI/TRUST-K privacy |
| #151 | done games loader | Сохранить; только остаток MAP-PERF1 |
| #152 | done radar loader | Сохранить; только остаток MAP-PERF1 |
| #155 | OPS continuation | Операционный source, не новый продукт |
| #156 | deferred M3-OWNER | Сверить ручные #171/#174/#179, APP-C только на реальный остаток |
| #157 | done UI-CLOSE | Сохранить |
| #158 | Actions train parent | Не перестраивать |
| #170 | deferred V1a | Сохранить; #178 done |
| #171 | not_admitted manual UAT | Сверить PR #172/current source; APP-C для реального остатка, не автоматический повтор |
| #174 | not_admitted Owner UAT | UI-S A/B, APP-C C; current source reconciliation прежде нового допуска |
| #175 | Owner Monitor / Projects | OPS/UI read-only: APP-S, QA Sonnet Medium; доска остаётся единственной |
| #177 | deferred M2R recovery | Не сбрасывать reservation; будущий lawful repair APP-C/TRUST-K |
| #178 | done V1a successor | Сохранить и использовать API |
| #179 | Planner not_admitted, но manual DEV release #193 | Последний комментарий: Owner UAT pending; не заказывать свайп заново |
| #181 | deferred FR-3A | TRUST-K только для разрешённого восстановления, сохранить candidate/attempts |
| #182 | dependency FR-3B | APP-C target; существующий Sol High immutable admission не редактируется |
| #184 | dependency MAP-FILTER | APP-C target; существующий Sol High admission не редактируется |
| #185 | Bounded recovery | Существующий механизм, не глобальное ослабление |
| #199 | Role/phase planning | Применить этот подготовленный пакет, не запускать второго PMA |
| #203 | done V2 canary | Не повторять |
| #205 | done V1b-1 | Старые Sol High/Astra High назначения остаются историей; публичную страницу не переписывать |
| #207 | conflict в planning; UNKNOWN в root checkpoint | Полностью заморожен до reconciliation. Нельзя превратить в новый Cursor вызов простым выбором модели |
| #208 | OPS admission/coalescing/idle alert | Независимое существующее обязательство, без новой очереди |
| #211 | Первый Cursor canary deferred 1/1 | Сохранить candidate/diagnosis; текущую работу PMA не перехватывать |
| #218 | Astra failure_diagnosis | Codex Astra High — эксперт, не обычная QA; действующий PMA реализует этап |
| #225 | Один Owner-authorized successor #211 | Сохранить одну Cursor попытку и Codex Sol Medium QA; никакой замены на AGY посреди приёмки |

**Дополнительные источники вне 79 открытых Issues:** PR #73 содержит утверждённую модель post-game; закрытая #216 содержит приёмку очистки; PR #223 — установленный Cursor adapter; PR #226 — текущая работа PMA по #225; PR #222 — непринятое уточнение правил, не действующая runtime policy. Новые machine admissions или статусы этим документом не создаются.

## Обнаруженные расхождения, уже учтённые в назначениях

1. Старый backlog T6: «игрокам 1–5»; утверждённый post-game: peer categorical feedback, organization 1–5, всё private. Использован второй вариант.
2. T7 «проверка уровня» не становится разрешённой частью post-game: skill mutation/ranking там исключены. Оставлен HOLD.
3. Open GitHub Issue не доказывает отсутствие результата: 40 записей в planning уже done, #179 имеет ручной DEV release. Не пересоздавать.
4. I1 importer done не означает, что площадки получили реальные обложки. Остаток выделен без нового importer.
5. Старые #205/#207 имеют Sol High + Astra High; исторические назначения не переписаны экономным target.
6. Исторический phase planner предлагает High для обычной QA; этот пакет выбирает Sonnet Medium для обычных задач согласно действующему канону, а не механически копирует старую таблицу.
7. Cost-policy/router ещё требует согласования target AGY QA с фактической selection; не выдавать этот JSON за установленный pipeline.
8. Project-only drafts могли не попасть в доступные источники; не заявлять полноту доски, не плодить новый Project.
