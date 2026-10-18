# Миграции, хранение и удаление

Статус: **TECH_SELECTED**; retention intervals ниже — предложенные defaults для review, не юридические сроки.

## Миграции

Только versioned SQL под review. Автосинхронизация ORM-схемы с PROD запрещена. Команды миграции используют отдельную DDL-роль; API runtime роль не должна менять схему. Ранее применённые файлы immutable. В release record сохраняются commit, migration IDs и checksums.

Подход expand → deploy compatible readers/writers → bounded backfill → validate → switch → позднее contract. Rename/drop поля не совмещается с выпуском первого клиента, которому оно больше не нужно. Mobile clients могут жить дольше серверного rollout. Large indexes/constraints требуют оценки locks; concurrent DDL выполняется отдельно от обычной transaction migration, если СУБД этого требует.

Каждый schema change проходит: новая пустая БД; upgrade предыдущего schema snapshot; повтор без изменений; failure/recovery; restore backup в отдельную БД. Выполнять всё на PostgreSQL/PostGIS, не SQLite. Production DB не копировать в DEV; синтетические fixtures покрывают города, timezones, unicode, места и отмены.

## Proposed retention

| Данные | Начальный default для проверки |
|---|---|
| Auth transaction / одноразовый handoff | TTL порядка 5 минут / 60 секунд; удалить после потребления и короткого диагностического окна без токенов |
| Session material | До expiry/revoke; очистка expired records по расписанию |
| Idempotency response | 24 часа; по истечении доменные uniqueness/transition rules всё равно защищают от дублей |
| Operational logs | 14 дней, redacted; security evidence по отдельному обоснованному сроку |
| Raw attribution events | До 90 дней; затем агрегировать/удалять после согласования purpose |
| Профиль/участия/audit | Отдельный purpose-based график до real-data launch; не бессрочно по умолчанию |
| Backups | Предложение: 30 дней rolling, encrypted; сроки согласовать с deletion policy |
| Future finance | Только отдельная юридически проверенная policy финансового этапа |

## Удаление аккаунта

Reauthentication → deletion request → немедленная блокировка новых sessions и revoke existing → обработка organizer ownership/future games → удаление/обезличивание профиля, identities, media и analytics keys согласно policy → запись минимального deletion evidence. Минимальная псевдонимизация истории возможна только при документированном основании; не объявлять все данные «аудитом» ради вечного хранения.

После восстановления backup повторно применять deletion journal до открытия доступа; иначе удалённые люди появляются снова. Журнал не должен содержать лишние восстановимые PII. Срок исчезновения из rolling backups объясняется пользователю. Provider unlink и полное удаление User — разные операции.

Публичный web deletion route и in-app initiation проектируются заранее для mobile stores; [S16–S17](../reference/SOURCES.md). Не размещать реальные заявления/контакты и дампы в Git.

## Post-game records

[ADR-0018 retention/rollout](../architecture/POST_GAME_V001.md#10-миграции--rollback--измерение): notes/reviews/disputes/notices/case evidence имеют разные purpose и retention; численные сроки ещё не утверждены. Open-case evidence не стирать обычным hide/delete, но audit не оправдывает вечное хранение текста. Existing 0031 support evidence synthetic-only: real-data policy требует отдельного разрешённого расширения, не обхода immutable triggers. Upgrade не выдумывает историческое посещение. Rollback сохраняет историю и доступ к исправлению, не destructive down-migration.
