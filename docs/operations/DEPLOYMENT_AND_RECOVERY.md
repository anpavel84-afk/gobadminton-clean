# Deployment, backup и восстановление

Статус: **TECH_SELECTED**, runbook target. Реального deployment/backup drill ещё нет.

## CI и выпуск

PR: docs/contract checks → clean dependency install → typecheck/lint → unit/integration/security tests → API diff → build candidates. Фактическая foundation CI пока запускает только `scripts/check_foundation.py`; будущие команды добавляются с исполняемым кодом, не имитируются успешными echo.

Application release: exact Git commit → immutable OCI images/digests → STAGE → миграции по плану → smoke/independent QA → approval → те же images в PROD. Не собирать «latest main» непосредственно на PROD. Worker/API совместимость и previous mobile clients проверяются до продвижения.

Branch protection/required checks и environments approvals — настройки GitHub, их наличие не следует из YAML/документации. Защиту main и credentials нужно настроить до многопользовательской разработки/release.

## Deploy steps

Записать текущие images/schema revision и backup checkpoint; проверить отсутствие конкурирующего deploy; выполнить backward-compatible expand migration отдельной DDL-ролью; выпустить API/worker/web с readiness; smoke authentication/read/write/cancel в разрешённом scope; наблюдать ошибки, latency, locks, outbox. Остановить rollout при нарушении correctness/security, а не ждать общего error threshold.

## Rollback

App rollback к previous image допустим только при совместимой схеме и contracts. destructive migration не имеет гарантированного автоматического down. Для неё нужен отдельный reviewed plan: forward fix или restore/controlled replay. Никогда не откатывать БД поверх новых пользовательских writes без решения об их сохранении/потере.

Store binary rollback не мгновенный: отключить проблемную server capability, обеспечить совместимость, выпустить исправление. OTA не используется как способ обойти native review.

## Backups

Предлагаемый начальный target: PostgreSQL base backups + WAL/PITR, encrypted object storage/versioning, off-host копия в согласованном регионе. Конкретные RPO/RTO проверяются drill, не обещаются одной галочкой backup.

Перед real-data pilot: восстановить БД+media mapping в чистом изолированном окружении, проверить число записей/constraints, возможность входа test users, capacity, outbox dedupe, deletion journal; зафиксировать время и найденные потери. Восстановление не должно повторно отправить старые уведомления или будущие financial effects.

## Incident flow

Назначенный человек принимает инцидент → ограничивает вред/отключает affected writes → сохраняет redacted evidence → оценивает пользователей/данные → принимает recovery/communication → проверяет consistency → возвращает трафик → оформляет причины и предотвращение.

Нет бесконечных autonomous retry loops: ограничение попыток и escalation. Error recovery не создаёт новый writer, пока не установлен статус предыдущего. Production incident не чинится под архитектурной ролью без отдельного scope.
