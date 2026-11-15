# Паритет функций и независимая приёмка платформ

**Шаблон доказательств, не второй backlog и не текущая таблица PASS.** Реальные статусы — в exact Issue, PR/SHA, CI, build/sign receipts и отдельно Owner UAT. Web релиз ≠ Android binary ≠ iOS binary.

## На каждую затронутую функцию — один общий contract

| Сценарий | Web (эталон) | Android | iOS | Проверка |
|---|---|---|---|---|
| Первое знакомство / город | approved UI SHA | native E, city | native E, city | фото, переходы, ошибки |
| Вход / session / logout | browser cookies | system-browser/bearer, restart | system-browser/bearer, restart | один аккаунт, два actors, revoke |
| Каталог / карточка / заявка | exact accepted Web flow | APK workflow | iOS workflow | server ACL, retry, UNKNOWN |
| Игроки / Radar / карта | Web source | native location/gesture | native OS consent/gesture | privacy + rendering |
| Мои игры / Postgame | Web source | native hub | native hub | state/provenance/history |
| Чаты / уведомления | Web + PWA push | native client | native client | два аккаунта, no auto-mutation |
| Площадки / фото / UGC | Web source | native gallery | native gallery | rights/moderation |
| Installed app/updates | browser Web deploy | Android APK + optional OTA | iOS binary + optional OTA | signed artifact/device |

Значения в строках — **названия проверяемых областей, не заявления об их реализации**. Для текущего этапа заполнять точный accepted Web SHA, исходный native SHA, версии API, фактические тесты/ограничения и фото/видео бинарника. Функция не переносится автоматически только потому, что она готова в Web.

## Gates, без подмены смыслов

- Сначала accepted Web UI и API contract/permission, затем native implementation в собственных controls, без WebView.
- Платформенные безопасные области, клавиатура, системные back/gestures и доступность могут адаптироваться, но функциональное поведение/содержание должны соответствовать эталону. Преднамеренное отличие документировать.
- Авторские тесты, независимый QA, Product CI, DEV acceptance, native build+sign, установочный/визуальный тест и Owner UAT — **разные статусы**.
- Web сравнение на сопоставимых viewport; native проверять в **установленном приложении**. Снимок HTML, JS export, review исходников и emulator timeout не равны native PASS.
- Тестировать поддерживаемый старый мобильный клиент против нового API; back-compat, server-side ACL, idempotency, privacy неизменны.
- Предыдущий Owner FAIL нельзя превратить в PASS слиянием PR без новой настоящей UAT. Непроверенное = `NOT_TESTED`.

## Обновления: три независимых канала

| Изменение | Применимый канал |
|---|---|
| Данные (игры, сообщения, фото), permissions | существующий backend/API; клиент не назначает полномочия |
| Ограниченные параметры уже существующих экранов | будущая проверяемая remote config; это НЕ действующая функция |
| Совместимый JS/assets патч mobile | штатный `expo-updates` после реализации/подписанного A→B proof и проверки policy |
| Нативные модули, SDK, разрешения, изменения, требующие store review | новая подписанная Android/iOS сборка |
| Web | Web deploy/cache; это не native rollout |

На дату аудита (15.11.2026) `apps/mobile/package.json` не содержит `expo-updates`, а `app.json` не задаёт `runtimeVersion`: считать OTA **NOT_IMPLEMENTED** до реального отдельного DEV/preview signed A→B test, а не обещать удалённые обновления старым APK.

Живой пример обязательной незавершённой mobile-поставки — [#522](https://github.com/anpavel84-afk/gobadminton-clean/issues/522); эта страница не повторяет переменчивый статус APK/CI/DEV.
