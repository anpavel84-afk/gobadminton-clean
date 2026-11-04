# Handoff #460 — Сводка пилота (Admin aggregates)

## Что доставлено

Read-only раздел Admin **«Сводка пилота»** для роли `superadmin` (permission `pilot.read`):

- `GET /v1/admin/pilot-metrics?cityId&from&to` — агрегаты по городу и окну UTC `[from, to)` (по умолчанию 30 суток, максимум 365).
- `from`/`to` — RFC3339 date-time с `Z` или numeric offset; без таймзоны / calendar rollover → 400.
- Без cityId — только каталог городов для селектора.
- UI в `apps/admin`, transport allowlist `pilot-metrics`, `Cache-Control: no-store`.
- API contract **0.32.0**, приложение **0.1.0-alpha.25** (SHA/digests/UAT = null / NOT_TESTED до server receipt).
- Исторический seed: принятая alpha.24 (`002d09c9…`, `r41839403532-a1`) добавлена; 28 строк / 33 deployment.

## Формулы (кратко)

| Метрика | Определение |
|---|---|
| Заявки | Число границ попытки → `pending` (первая или после withdrawn/rejected/removed/expired) в рабочей когорте (не draft/не cancelled/не demo). Не клики и не текущий rowcount. |
| Подтверждения | `pending→confirmed`, каждое сопоставленное ровно одной валидной заявке той же попытки. Сиротский confirmed без pending-origin → coverage, не числитель. |
| Confirmation rate | confirmations / applications; `null` при нулевом знаменателе; rate>1 не допускается за счёт сиротских confirm. |
| publishedEligible vs due | published/completed в окне `starts_at` (может включать upcoming); `dueInWindow` / исходы / посещаемость — только `ends_at ≤ asOf`. |
| Held rate | held / (held + not_held) по текущим `game_outcomes` на due-играх; unknown только у due без явного исхода; время само не означает held. |
| Посещаемость | Confirmed на held due: явные present/absent; **отсутствие строки** = unknown. |
| Повтор | Пользователи с ≥2 distinct held+present / с ≥1. |
| Организаторы | Distinct `created_by_user_id` с eligible published / held due / ≥2 играми; без ID и рейтингов. |
| Cancelled | `cancelledDisclosed` отдельно; не входят в заявки/статусы/исходы/посещаемость. |

DEMO/DEV-QA: UUID `d0f0xxxx-0000-4000-8000-…` и issuer `demo:synthetic:foundation-v001`. Draft исключены. Неразмеченные ручные тесты не угадываются по имени/email.

## Isolated fixture readiness

Интеграционный тест `apps/api/test/integration/admin.pilot-metrics.test.ts` (включается `RUN_DB_INTEGRATION=1`):

- request + confirm + withdraw + reapply + confirm;
- late outcome correction;
- attendance / repeat на двух held;
- missing attendance mark → unknown (P460-A);
- cancelled disclosed, apps excluded (P460-B);
- future published ≠ due/unknown (P460-C); timings relative to DB `clock_timestamp`;
- orphan confirm → coverage, rate≤1 (P460-D);
- RFC3339 rejection (P460-E);
- demo namespace exclusion; window/city boundaries; manager join multiplicity;
- zero denominator / empty window; deny anonymous / non-superadmin; no PII keys.

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
- Incomplete / inconsistent legacy transitions → coverage notes, без выдуманных фактов.
- PROD / C5 / tracking SDK / новые таблицы / retention — вне scope.
