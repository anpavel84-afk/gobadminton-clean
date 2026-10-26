# Выпуск и восстановление — CLEAN

Полномочия и критерии: [единый регламент](../rules/ENGINEERING_OPERATING_MODEL.md), технический маршрут — [Actions train](chatops/ACTIONS_TRAIN.md). Здесь нет разрешения новой установки или PROD.

## Version preflight · Owner OD-013

[Сквозное решение OD-013](../decisions/OWNER_DECISION_DEV_OPS_VERSION_COMPATIBILITY_V001.md): перед затратным QA/CI и особенно перед OPS install read-only сверить installed_before / reviewed desired_after / unchanged_dependencies. Различные OLD и NEW для планового обновления штатны; иной `dev` SHA вне closure не blocker. Controller/workflow/native_guard/permissions drift требует адресного пересмотра и согласованного release, а не игнорирования защитного gate. Сверить полный contract снова перед protected write. Руководство само не устанавливает automated resolver.

## Выпуск

Точный source candidate → независимая QA → обязательный Product CI → контролируемая интеграция → immutable paired artifacts → существующий DEV receiver → smoke/ACCEPTED и live проверка. Если конкретный pipeline ставит часть детерминированных checks раньше QA, это не отменяет ни один обязательный gate.

Перед изменением ресурсов: проверить текущие версии/схему, отсутствие конкурирующего deployment, реальные backup/rollback условия. Использовать установленный reviewed receiver и exact artifacts, не сборку latest на production host. Доступность workflows и branch/environment protections проверяется фактически, не выводится из Markdown.

Наличие DEV success не означает Owner UAT или PROD release. PROD требует отдельного конкретного Owner GO и действующих source/image/compatibility gates. Перенос документации на default branch не является продуктовым release.

## Откат и данные

Сохранить предыдущие image digests и restore evidence. App rollback допустим при совместимой схеме/контрактах. Не считать его SQL rollback. Destructive migration требует отдельного reviewed плана; нельзя восстанавливать БД поверх новых пользовательских writes без решения об их сохранности.

Backup не считается проверенным только из-за существования файла. Проверять восстановление в изолированной разрешённой среде, consistency DB/media, дедупликацию outbox и отсутствие повторной отправки уведомлений. RPO/RTO и совместимость утверждаются по реальным drills, не обещаются этим документом.

## Ошибка и recovery

Сохранить точный failure и checkpoints, установить состояние предыдущего процесса/эффектов, выполнить ограниченный штатный recovery. Не запускать второй writer при неизвестном исходе и не стирать attempts/историю.

OPS изменения контроллера/adapter/profile — отдельно reviewed, с backup/rollback и безопасной границей active work. Продуктовое назначение не даёт права чинить production. Незатронутые допустимые задачи продолжаются по действующему train.
