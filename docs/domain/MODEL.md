# Доменная модель

Статус: техническое основание **TECH_SELECTED**; конкретные пилотные product defaults отмечены в [scope](../product/SCOPE.md).

## Сущности и смысл

| Сущность | Смысл / граница |
|---|---|
| User | Один аккаунт человека с внутренним UUID. Не равен VK или Яндекс аккаунту. |
| ExternalIdentity | Привязка issuer/provider namespace + subject к User. Для pairwise subjects учитывается app/client namespace. |
| UserGamePreferences | Приватный versioned шаблон публичного контакта игры, owned by Profiles; не часть social/directory DTO. |
| PlayerProfile | Отображаемое имя, locale, предпочтительный город, self-declared level; не публичное досье. |
| Organizer | Организаторский контекст: отдельный от человека и площадки. Вначале personal organizer; team/club — future capability. |
| OrganizerMembership | Связь User с Organizer и scoped ролью. Нельзя вычислять права из имени, email domain или provider claims. |
| Venue | Физическая площадка: адрес, city/country, timezone, координаты и качество данных. Не подтверждение брони корта. |
| Game | Конкретный временной экземпляр игры/занятия на Venue, с Organizer, уровнем, форматом и capacity. |
| Participation | Текущий статус заявки одного User на один Game плюс version/attempt history. Заявка и подтверждённое место различаются. |
| GameInvitation | Отдельный Sessions-ресурс приглашения на Game. Pending не резервирует место. Accept подтверждает Participation по текущим правилам вместимости. Не Participation и не побочный эффект сообщения. |
| ParticipationTransition | История решения: actor, from/to, reason, version, timestamp. Не редактируется задним числом. |
| ShareLink | Ссылка на публичную/неиндексируемую игру и источник привлечения. Не разрешение администратора и не подтверждение участия. |
| Attendance / GameOutcome | Отдельные сведения о фактическом посещении и проведении игры с источником подтверждения. |
| AttributionTouch | Ограниченная информация о канале; не трекинг всей активности пользователя. |
| Notification / DeliveryAttempt | Внутреннее сообщение и попытки доставки. Не источник business status. |

## Главные различия

Человек может играть и организовывать: это не взаимоисключающий глобальный `user.role`. Тренер — характеристика организатора/профиля, а не безусловный доступ ко всем чужим играм. Club не равно Venue, член команды не равен владельцу площадки, публикация не равна брони корта.

Один Game = один конкретный интервал `startsAt < endsAt`. Будущая регулярность задаётся GameSeries, порождающей самостоятельные экземпляры. Изменение серии не переписывает прошлые подтверждения. В MVP таблицы/редактор серий не нужны.

Один User запрашивает одно место. Групповые заявки, анонимные гости и оплата за несколько людей отложены. Для уже набранного в чатах состава используется **externalReservedCount** без загрузки персональных данных этих людей. Для новой regular-игры создатель получает одну реальную confirmed Participation при создании draft; externalReservedCount описывает других людей. Trainer-led и исторические игры сохраняют существующие строки, без backfill. Management и место независимы; remove/withdraw не снимают management.

## Level / format

Шкала уровней: `scaleId`, `levelId`, version, sortRank, localized label, provenance `self_declared`/future `coach_verified`. Буквы нельзя сравнивать лексикографически и нельзя автоматически считать универсальными между странами. Game содержит допустимый интервал/набор внутри одной scale. Нет обещания объективного рейтинга.

В MVP self-declaration служит фильтру и решению организатора, а не сертификатом квалификации. Конкретная шкала и виды форматов требуют product freeze с тренерами. Начальное направление — badminton; общая `sportKey` не означает запуск мультиспорта.

## Условия расчёта

Game хранит `settlementMode=external`, `priceMinor` nullable, `currency` при указанной сумме, `settlementTerms` и контакт/правила организатора. Null price значит «условия уточняются», 0 значит бесплатно. Система не хранит статус «оплачено» в MVP. Снимок условий заявки/подтверждения сохраняется, чтобы правка карточки не подменяла ранее принятый смысл.

## Visibility

`public` — находится в discovery; `unlisted` — доступен по share link, не попадает в индекс. Unlisted **не private**: адрес и детали доступны получившему ссылку. По-настоящему закрытые группы потребуют отдельной ACL-модели. В обоих режимах private applicant data никогда не включаются в публичную карточку.

## Уточнение Attendance / GameOutcome и Feedback

См. [утверждённый post-game пакет](../architecture/POST_GAME_V001.md), sections 3–6. ParticipantContext сохраняет минимальную историческую связь; Attendance unknown/present/absent независима от Participation. GameOutcome unknown/held/not_held не вычисляется по времени. Revisions и Dispute сохраняют авторство и право исправить ошибку. PersonalGameNote, GameReview(peer/organization/training) и ReviewReply — разные типизированные записи с разными ACL; AbuseReport остаётся отдельным процессом. Creator seat не означает present; manager role не даёт self/peer rating без собственного опыта. Таблицы и API этого расширения ещё не реализованы этой документацией.
