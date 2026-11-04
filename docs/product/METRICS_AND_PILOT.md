# Пилот, метрики и атрибуция

Статус: **DEV_SLICE_AVAILABLE** (#460). В Admin для суперадминистратора доступна read-only агрегированная «Сводка пилота» по существующим фактам БД (заявки/подтверждения/явные исходы/посещаемость). Это не запуск внешнего пилота и не коммерческая KPI-платформа. Презентационная рамка 4–6 недель / 5–10 тренеров остаётся предложением, не договорным сроком.

## Ответственность

Pilot/Growth готовит предложение и каналы параллельно продукту: контакты отобранных организаторов, реальные занятия, проверка адресов/времени/условий, обучение confirm/cancel, маршрут поддержки. Product/UX определяет метрики/интервью. Implementation пишет instrumentation. QA проверяет дедупликацию и доступ. PM сводит факты, Owner принимает коммерческие решения.

## Определения

| Метрика | Как считаем | Что не подменяет её |
|---|---|---|
| Applications | Число различных committed-попыток с явной границей → pending (первая или после withdrawn/rejected/removed/expired) в рабочей когорте (не draft/не cancelled/не demo) | Click на кнопку, HTTP retry, участие на cancelled |
| Confirmations | pending→confirmed, сопоставленное ровно одной валидной заявке попытки; сиротский confirmed → coverage unknown | Подтверждение не равно посещению; частичная история не выдумывает rate |
| Confirmation rate | Валидные confirm / валидные заявки той же когорты; `null` при нулевом знаменателе | Нельзя получить rate>1 за счёт confirm без pending-origin |
| publishedEligible / due | published/completed в окне `starts_at` (может включать upcoming); due = `ends_at ≤ asOf` | Upcoming не становится due/unknown от времени; due=0 ≠ «нет подходящих» при наличии published/apps |
| Held rate | held / (held + not_held) для due-игр с явным outcome; отдельно unknown только у due | Прошедшее время не считается held |
| Attendance | Confirmed на held due: явные present/absent; отсутствие строки отметки = unknown | Статус confirmed сам по себе не present |
| coverage.sufficient | true только при наличии due и полной известности фактов: нет unknown outcome, нет unknown attendance на held due, нет участий без proof попытки | Не KPI-порог и не сигнал «полный пилот»; notes об unknown остаются видимыми при неполных фактах |
| Repeat attendance | Игроки с ≥2 distinct held+present / игроки с ≥1 в окне | Повторный просмотр и повторная заявка |
| New client | Технический candidate + подтверждение отсутствия прежних посещений у данного организатора | `first seen in DB` или UTM недостаточно |
| Acquisition cost | Документированные затраты канала / измеримый agreed outcome | Не приписывать неизвестные расходы нулю |
| Organizer retention | Организаторы, опубликовавшие следующую игру после пилотного результата | Сам факт регистрации |

Окна измерения — RFC3339 UTC (`Z`/offset); late updates; exclusions DEMO UUID/issuer; cancelled раскрываются отдельно и не входят в рабочие когорты. Нет придуманных численных KPI, которые якобы утвердил Owner.

## События и privacy

Серверные `participation.requested/confirmed/withdrawn`, `game.cancelled/outcome_recorded` происходят из outbox после commit. Клиентские `discovery_viewed/game_opened/request_clicked` отделены от них. Events содержат eventId, schemaVersion, UTC time, internal/pseudonymous IDs, channel tag и минимальные props; не email, phone, provider token или точную историю геопозиции.

Share link имеет campaign/source code. При request фиксируется attribution snapshot. Источник нельзя перезаписать последующей рекламной ссылкой. Предложенный default: отдельно first touch, last eligible touch и share source; коммерческая модель не выбирается техническим attribution алгоритмом. Конкретное окно attribution — product decision до монетизации.

Региональное хранение analytics, consent/lawful basis и сроки — [Security/privacy](../security/SECURITY_AND_PRIVACY.md). Сторонний SDK трекинга не включается по умолчанию.
