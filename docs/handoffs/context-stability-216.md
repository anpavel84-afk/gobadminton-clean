# OPS #216 — сохранение работы и стабилизация исполнительного контекста

Это runbook ограниченного OPS-изменения, не второй регламент. Канон:
[ENGINEERING_OPERATING_MODEL.md](../rules/ENGINEERING_OPERATING_MODEL.md), редакция1.1,
Owner-accepted source `b4a746a0b9834d80b8c65ecb9a093257f989bae7`,
57544bytes, SHA256 `0755f8b5eb2cce575e58137a0f0462448109d8af0173e36d67f6551342b35ba6`.

## Сохранённая граница

Действующий controller0f769e3e053c79621c5dae9c27b3772a0f84678d ограничен существующим
policy mode=disabled под controller.lock. #205 завершён прежним DEV-verifier:
f3522fe940e937fcc1cdb1d15a5ed5dc4e39fb28, accepted r39861742371-a2.
#207 остаётся ci/UNKNOWN до отдельного штатного reconciliation: journal не очищается,
author не повторяется, installed context upgrade не даёт recovery authority.

Приватная однократная инвентаризация:
`/var/lib/gobadminton-actions-train/context-stability-216/inventory-before.json`.
Git common stores,734registeredworktrees,dirty source,unique commits,all history,
attempts/recovery/usage/leases и provider login сохранены. Количество объектов само
по себе не доказывает их ненужности.

| Объект | Consumer / решение |
| --- | --- |
| CLEAN common repo и task worktrees | REQUIRED: Git object store и точные lease-bound cwd; не переносить/удалять |
| Legacy /srv/gobadminton-dev/repo,control-plane worktrees | ARCHIVE/rollback provenance; не writer, не context source; все dirty/unique данные сохранить |
| gb-pipeline.service | Пустой прежний отдельный drafting/installer poller; штатный stop после повторной проверки queue/status/config/journal, затем mask под его существующим lock |
|33inactivelegacy services/timers | Точный закрытый список в context_policy.LEGACY_UNITS; обратимый mask с backup, без запуска и удаления payload |
|gobadminton-autopilot.service | Уже masked; сохранить защиту |
|LegacyCodexprojecttrust | Удалить только project sections /srv/gobadminton-dev/ и /srv/gobadminton-control-plane-v3/; unrelated settings и auth не менять |
|Old completed AGY M0c advisory | Отдельное exactPID/start/UID/boot review и private full archive; не действующая task/QA. Никаких process-name/group signals |
|DEV deployhelper,apps,transport/gate/xray | REQUIRED/out of cleanup; не менять |
|OwnerMonitor,telemetry,watchdog,root/nonroot administrative channels | REQUIRED; сохранить running/periodic services |

## Что меняется в действующем launcher

`context_policy.py` открывает exactroot-owned installed context с fd/O_NOFOLLOW,
проверяет ancestors/regularsinglelink/mode/size/SHA256 и передаёт полный текст
в stdin до stage prompt. Не ищет policy в candidate,cwd,HOME или сети.
`--ignore-rules --ignore-user-config` обязательны; source/candidate инструкции
не могут заменить QA authority. Receipt содержит accepted commit/hash/bytes/role,
actual cwd и hash фактического stdin; process receipt связывает это с PID/start/boot
и exactCLIhash. При отсутствии/дрейфе trustedrules модель не вызывается.

Единый установленный artifact `accepted-engineering-rules.md` — проверенная копия
канона, не отдельная редактируемая policy. PMA/planner/diagnostician и ещё не
квалифицированные adapter роли не объявляются runtimeverified по наличию файла.

Одна дешёвая проверка в существующем receiver.guard проверяет35exactunitsmasked/
inactive/MainPID0 и отсутствиестарых projecttrust. Новых scheduler/daemon нет.

## Применение и откат

Использовать `scripts/chatops/ops/context_stability_upgrade.py` из root-owned
reviewed immutable bundle. Exact manifest/helper hashes проверяются ДО import.
Обязательны independentQA,exactSHArequiredCI и нормальный PRmerge.

1. Сохранённое безопасное окно; root DRY с exactcontroller/manifest/workflowhashes.
2. APPLY записывает write-ahead journal ДО backup; privatebackups кода,unitfiles,
   userconfig до replacements; сохраняет authoritative hashes,политику и installationrecord.
3. Пустой gb-pipeline штатно остановить; взять существующий /run/gb-pipeline.lock,
   повторить доказательство пустоты; exactunitmask/configtrim/contextcodeinstall.
4. Оставить installed-disabled. Freshprocess preflight. Hosted train shadow должен
   иметь2successfuljobs,reconcile+publish_phase_drafts,точный workflowSHA послеinstall.
5. Activate сверяет statepreservation,installedhashes и настоящий GitHubAPIproof;
   один bounded control pass квалифицированным Codexroute с независимой QA/CI/DEV.

При исключении/прерывании режим остаётся disabled. `rollback` принимает
backing-up/applying/installed-disabled, проверяет свои exactbefore/aftertargets
и privatebackup, восстанавливает только code/config/unitfiles/installationmetadata.
Не откатывает task/usage/history и автоматически не запускает legacy services.
Послеactive обычный reviewed successor/revert без rewind liveeffects.

Контрольный проход и фактические SHA/Actions/PID/DEV receipts публикуются в#216/#199.
Зелёные тесты/mergedPR не являются завершением уборки. Cursor symlink escapeFAIL и
Antigravity qualification остаются#211; обязательный AstraFAILstage —#218.
