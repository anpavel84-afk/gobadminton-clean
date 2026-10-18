# Права и минимальные раскрытия

Статус: **TECH_SELECTED**. Проверки на сервере для каждого resource ID; UI hiding не является защитой.

| Действие | Гость | Игрок | Organizer owner/manager | Оператор |
|---|---|---|---|---|
| Читать public Game/Venue | Да, public DTO | Да | Да | Да |
| Читать unlisted Game | Только с действующей ссылкой | Ссылка или своя Participation | Свой Organizer | По scoped support доступу |
| Создать заявку | Нет | Только себе | Как игрок, по тем же правилам | Не за другого без отдельной операции |
| Читать Participation | Нет | Только свою | Для своего Game | Только разрешённый support scope |
| Confirm/reject/remove | Нет | Нет | Только свой Game | Через audited override, не прямую БД |
| Изменить Game/capacity | Нет | Нет | Только свой Organizer | Scoped moderation командой |
| Читать player contact | Нет | Свой | Минимум для своего согласованного сценария | По необходимости, audit |
| Управлять membership | Нет | Нет | Только owner; нельзя удалить последнего owner | Audited recovery |
| Удалить аккаунт | Нет | Свой после reauth | Свой, с проверкой ownership transfer | Регламентированный deletion process |
| Просматривать audit | Нет | Нет | Только разрешённую историю своих команд | Отдельный privileged scope |

`OrganizerMembership` роли: owner, manager; расширение до assistant/viewer — позднее. Все membership имеют active/revoked, verified organizer context и audit. Операторские роли не хранятся в public profile и не присваиваются из OAuth email/имени.

Публичный DTO исключает email/телефон игрока, identities, session IDs, analytics identifiers и roster. Контакт организатора публикуется только как выбранный им business contact с согласием; scraped social contact не считается разрешением на публикацию.

Для чужого private resource возвращаем одинаковое `404` без подтверждения его существования. Для известного авторизованному actor ресурса с недостаточным permission допустим `403`. Pagination/counts не раскрывают чужие заявки. Любой фильтр `organizerId` пересекается с permission scope.

Admin — отдельный audience/session boundary, короткие privileged sessions и MFA/step-up перед публичным пилотом. Настоящие platform admin права не зависят только от успеха consumer social login. Recovery-процедура до PROD проверяется отдельно.

Основание для проверки object-level authorization: [S13](../reference/SOURCES.md). Тестовая матрица: [ACCEPTANCE_MATRIX](../quality/ACCEPTANCE_MATRIX.md).

## Post-game permissions (implementation pending)

Нормативная [матрица ACL](../architecture/POST_GAME_V001.md#6-права-и-видимость) дополняет общую таблицу: current GameManager меняет attendance/outcome, сам участник видит/оспаривает свою отметку независимо от чата, notes author-only, reviews author+recipient, staff строго case-scoped. Ответственный адресат organization review фиксируется, не все будущие managers получают историю. Report receipt/status только reporter; target не получает дело автоматически. Ни manager role, ни platform role не дают общего чтения личных заметок. Права проверяются также на idempotent replay и deep links.
