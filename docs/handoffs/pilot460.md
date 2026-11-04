# Handoff #460 — Сводка пилота (Admin aggregates)

## Что доставлено

Read-only раздел Admin **«Сводка пилота»** для роли `superadmin` (permission `pilot.read`):

- `GET /v1/admin/pilot-metrics?cityId&from&to` — агрегаты по городу и окну UTC `[from, to)` (по умолчанию 30 суток, максимум 365).
- Без cityId — только каталог городов для селектора.
- UI в `apps/admin`, transport allowlist `pilot-metrics`, `Cache-Control: no-store`.
- API contract **0.32.0**, приложение **0.1.0-alpha.25** (SHA/digests/UAT = null / NOT_TESTED до server receipt).
- Исторический seed: принятая alpha.24 (`002d09c9…`, `r41839403532-a1`) добавлена; 28 строк / 33 deployment.

## Формулы (кратко)

| Метрика | Определение |
|---|---|
| Заявки | Число переходов в `pending` (первая или после withdrawn/rejected/removed/expired). Не клики и не текущий rowcount. |
| Подтверждения | Переходы `pending → confirmed` той же когорты игр. |
| Confirmation rate | confirmations / applications; `null` при нулевом знаменателе. |
| Held rate | held / (held + not_held) по текущим `game_outcomes`; unknown отдельно; время само не означает held. |
| Посещаемость | Явные present/absent/unknown на confirmed участиях held-игр. |
| Повтор | Пользователи с ≥2 held+present / пользователи с ≥1. |
| Организаторы | Distinct `created_by_user_id` с eligible published / held / ≥2 играми; без ID и рейтингов. |

DEMO/DEV-QA: UUID `d0f0xxxx-0000-4000-8000-…` и issuer `demo:synthetic:foundation-v001`. Draft исключены; отмены раскрыты отдельно. Неразмеченные ручные тесты не угадываются по имени/email.

## Isolated fixture readiness

Интеграционный тест `apps/api/test/integration/admin.pilot-metrics.test.ts` (включается `RUN_DB_INTEGRATION=1`):

- request + confirm + withdraw + reapply + confirm;
- late outcome correction;
- attendance / repeat на двух held;
- demo namespace exclusion;
- window/city boundaries;
- manager join multiplicity;
- zero denominator / empty window;
- deny anonymous / non-superadmin;
- no PII keys in aggregates.

Автор **не** пишет fixture в живой DEV.

## Полная пилотная приёмка (ручной маршрут, не автозапуск)

1. Организатор создаёт и публикует игру в выбранном городе.
2. Игрок подаёт заявку.
3. Организатор подтверждает.
4. Явно фиксирует исход held или not_held.
5. На held отмечает present/absent.
6. Сводка пилота за окно, включающее `starts_at`, показывает согласованные агрегаты.

Реальный внешний пилот / маркетинг / оплата провайдеров **не стартуют** этим выпуском.

## Ограничения

- UAT Admin и физическая приёмка: NOT_TESTED.
- Incomplete legacy transitions → coverage notes, без выдуманных фактов.
- PROD / C5 / tracking SDK / новые таблицы / retention — вне scope.
