# Пилот, метрики и атрибуция

Статус: **PROPOSED_PRODUCT**. Презентация предлагает 4–6 недель и 5–10 тренеров; это рабочая рамка проверки, не договорный срок запуска.

## Ответственность

Pilot/Growth готовит предложение и каналы параллельно продукту: контакты отобранных организаторов, реальные занятия, проверка адресов/времени/условий, обучение confirm/cancel, маршрут поддержки. Product/UX определяет метрики/интервью. Implementation пишет instrumentation. QA проверяет дедупликацию и доступ. PM сводит факты, Owner принимает коммерческие решения.

## Определения

| Метрика | Как считаем | Что не подменяет её |
|---|---|---|
| Applications | Число различных `(game,user,attempt)` с committed pending | Click на кнопку и HTTP retry |
| Confirmations | Число подтверждённых переходов с отдельным current status | Подтверждение не равно посещению |
| Confirmation rate | Заявки с confirm / валидные заявки в зафиксированной когорте | Нельзя скрывать pending без отчёта о них |
| Held rate | held / (held + not_held) для наступивших игр; отдельно доля unknown | Прошедшее время не считается held |
| Repeat attendance | Игроки с ≥2 recorded attended / игроки с ≥1 recorded attended в окне | Повторный просмотр и повторная заявка |
| New client | Технический candidate + подтверждение отсутствия прежних посещений у данного организатора | `first seen in DB` или UTM недостаточно |
| Acquisition cost | Документированные затраты канала / измеримый agreed outcome | Не приписывать неизвестные расходы нулю |
| Organizer retention | Организаторы, опубликовавшие следующую игру после пилотного результата | Сам факт регистрации |

Окна измерения, late updates, exclusions тестовых аккаунтов, отменённые/неопределённые записи фиксируются до эксперимента. Нет придуманных численных KPI, которые якобы утвердил Owner.

## События и privacy

Серверные `participation.requested/confirmed/withdrawn`, `game.cancelled/outcome_recorded` происходят из outbox после commit. Клиентские `discovery_viewed/game_opened/request_clicked` отделены от них. Events содержат eventId, schemaVersion, UTC time, internal/pseudonymous IDs, channel tag и минимальные props; не email, phone, provider token или точную историю геопозиции.

Share link имеет campaign/source code. При request фиксируется attribution snapshot. Источник нельзя перезаписать последующей рекламной ссылкой. Предложенный default: отдельно first touch, last eligible touch и share source; коммерческая модель не выбирается техническим attribution алгоритмом. Конкретное окно attribution — product decision до монетизации.

Региональное хранение analytics, consent/lawful basis и сроки — [Security/privacy](../security/SECURITY_AND_PRIVACY.md). Сторонний SDK трекинга не включается по умолчанию.
