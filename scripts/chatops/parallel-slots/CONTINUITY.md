# OPS #155 — continuity v3, изолированная коррекция installer, 2026-10-21

From: OPS / isolated source copy. To: PM и независимый root installer security review.
Статус: исправленные исходники, offline tests и самодостаточный installer; установки на VPS не было.
Это кандидат на независимый security review и root DRY, не заключение о live/review PASS.
Пять входных SHA256 из supplied `pinned-originals/manifest.json` закреплены в builder.
Installer принимает именно deployed originals, а не предыдущий v1 candidate.
Защищённые wrappers/reviewer pins и прежний telemetry installer не изменены.

Политика устанавливается только reviewed installer в `/etc/gobadminton-slots/continuity.json`:

```json
{"schema":"GB_SLOT_CONTINUITY_V1","enabled":true,"max_attempts":3,"max_integrations":3,"read_backoff_seconds":240}
```

Разрешены только эти поля, boolean enabled и целые границы: attempts 1–3,
integrations 1–3, read backoff 120–3600 секунд. Файл root-owned, regular, single-link,
без symlink и group/world write; все родители root-owned и не writable для group/others.
Отсутствующий/disabled файл сохраняет ручной RESUME. Недоверенный/невалидный файл закрывает
автоматический путь. Legacy `--slot default` не импортирует slots.py и не использует policy.

Автоматические переходы:

* Только уже admitted immutable source task, прежние allowed_paths, max_attempts ≤3.
  Из blocked/CI FAIL при оставшейся попытке проверяются неизменность admission, clean HEAD/branch,
  точный remote candidate, отсутствие незавершённых Git mutations, saved QA PASS на тот же SHA,
  ancestry base→candidate/DEV и последний exact-head completed/failure Product CI.
  Принимаются только известные jobs/check names; raw logs не читаются и не копируются.
  В slot-режиме разрешён точный bootstrap origin `/srv/gb-slots/base.git` для fetch/push URL;
  другие локальные origins запрещены. Runtime использует только явные GitHub READ_REMOTE/WRITE_REMOTE,
  exact branch/head gates сохранены. URL rewrites, includes, core.sshCommand/core.gitProxy запрещены.
* Действующий Owner RESUME сохраняет реальный comment ID и note. Без него repair получает
  policy schema/SHA256 в history, без фиктивного comment ID. Автору передаются bounded job/step
  summary и доступный Owner note как данные; он обязан воспроизвести failing check, исправить
  только scope и повторить проверку. Независимая QA также проверяет failing check и запрет
  подавлений/удаления проверок. Repair расходует одну прежнюю попытку; budgets/ledger не обнуляются.
* Новый DEV не запрещает repair старого кандидата. После новых QA/CI используется существующая
  сериализованная integration queue: обычный non-force merge, очистка QA/CI, новые QA и CI на
  merge-SHA, затем прежние ff promotion, DEV deploy, server ACCEPTED и live-meta gates.
  Не более трёх интеграций на задачу. QA каждой новой версии оплачивается прежним бюджетом.
* HTTP/DNS/reset/timeout известных reads, PR/Actions absence/in-progress сохраняют фазу и
  durable backoff. Общая API spacing 65 секунд неизменна. Push, commit, model и неизвестные ошибки
  не повторяются как network read. Restart developing/QA с неопределённым результатом закрыт.
  Restart integrating принимает только clean commit с точными двумя сохранёнными parents;
  merge не запускается повторно. Незавершённый merge требует ручного разбора.
* При исчерпанном exact QA FAIL/CI FAIL либо доказанном clean abort настоящего merge-конфликта
  задача с exact snapshot/evidence сохраняется в `deferred.json`, затем checkpoint active=None.
  Запись архива предшествует state; crash между ними завершается идемпотентно. Это **не done
  и не Owner PARK**. Исходный `parked.json` остаётся только для настоящего Owner PARK, чтобы
  старый reader сохранял свою схему. QA файлы и before-defer snapshots сохраняются.
  Перед этим проверяются clean HEAD/branch и отсутствие незавершённой Git mutation; slot Owner PARK
  проходит ту же проверку, legacy PARK сохраняет прежнее поведение. После durable archive/state
  освобождаются integration mutex и lease, и только затем публикуется свободный статус.
  После сбоя release/publication следующий discovery завершает release и публикацию без re-admission.

Scheduler продолжает только независимые admitted JSON задачи. Зависимость от deferred/parked
issue остаётся незавершённой даже при завершении successor. Семантическую связь PM обязан
выразить immutable `depends_on`; prose backlog не становится executable task. Clean остановленный
writer освобождает file locks; dirty/unknown writer сохраняет exclusion через lease и status.
Identity/auth/изменённый admission или Git transport, rewritten history, out-of-scope,
неопределённые promotion/deploy и неизвестные blocks не освобождаются автоматически.

Публичный `status.json` и `slots.py status` сохраняют **точную GB_SLOT_STATUS_V1**:
никаких новых reason/resume_phase/wait/deferred полей. Подробности остаются в private checkpoint,
history/deferred.json и CLI journal. Событие автоматического отложения называется `deferred`,
а не Owner PARK. При занятых слотах supervisor возвращает `busy: no free slot/capacity`
до issue/comments fetch и budget reads, не расходуя общую API квоту 65 секунд.
Остальные queue причины сохраняются: no admitted tasks, conflict, dependency, budget/UNKNOWN.
Telemetry collector, строгий writer validator и UI знают `integrating`; подпись —
«интеграция с текущим DEV; новые QA и CI ожидаются». Сохраняются семь этапов;
во время integrating QA/CI ещё не пройдены для новой версии. Старые PASS в telemetry не экспортируются;
после merge новый SHA получает qa=None/ci=None и проходит прежние exact gates заново.
UNKNOWN, idle после deferral и source QA PASS не означают DONE/DEV acceptance.

Обоим ролям author/QA в обоих слотах выдаётся только read для существующего публичного
`/opt/gobadminton-clean-qa/style-guide`; родитель явно deny, соседние каталоги не открываются.
Перед model call и installer install/DRY проверяются no-symlink root-owned родители и дерево,
запрет group/world write, публичная читаемость, наличие refs и SHA256 `src/App.tsx`, `src/index.css`.
Pins приведены в EVIDENCE.md. Credentials, state и другие homes по-прежнему запрещены;
никакие credentials или копии Style Guide installer не создаёт.

Installer генерируется командой `python3 build_continuity_installer.py --original <папка pinned originals>`.
Он содержит readable Python controller и пять сжатых payloads с проверкой SHA256; генерация обновляет
все payload hashes. На review-host root сначала выполняет `DRY=1 bash slots-continuity.sh`.
DRY не создаёт lock/backup, не меняет code/policy и не вызывает service mutations.
Обычный запуск принимает только exact original bytes и отсутствующую либо точную disabled policy.
Повторный install/remove проверяет полный managed set и идемпотентен.

Выделенный lock `/run/gobadminton-slots-continuity.lock` не конфликтует с outer gb-run lock.
Private root backup `/var/lib/gobadminton-slots-continuity/managed.json` содержит только code,
policy и unit status/metadata. Checkpoints, worker.lock, counters, histories, credentials не копируются
и не изменяются installer. Root-owned nofollow single-link managed files и trusted parents обязательны.
Installer проверяет безопасные фазы и children, freeze закрывает race перед stop, затем проверяются
пустые descendant cgroups и фазы ещё раз. Контролируются только два slot units и supervisor.
Enable/disable, daemon-reload, сторонние units не вызываются; исходные enabled/active состояния сохраняются.

Весь managed set: `/usr/local/lib/gobadminton-slots/{autonomous_issues.py,slots.py}`,
`/usr/local/lib/gb-ops-monitor/opsmon/{slot_telemetry.py,writer.py}`,
`/usr/local/lib/gb-ops-monitor/web/app.js`, `/etc/gobadminton-slots/continuity.json`.
Эти пять файлов кода вместе с policy проверяются, backup/restore выполняется на весь набор.
Monitor timer прочитает новые файлы на следующем tick; units, PIN, nginx и auth монитора не меняются.

`DRY=1 bash slots-continuity.sh --remove` проверяет обратный путь; `bash slots-continuity.sh --remove`
возвращает точные preinstall bytes/modes/ownership и active states только при quiescent compatible state.
Policy, отсутствовавшая до install, удаляется. Архивы задач не меняются. Старый scheduler полностью
игнорирует deferred.json и мог бы re-admit такую задачу. Поэтому **непустой policy deferred.json
запрещает remove/DRY remove до file/unit mutations**. Необходима отдельная reconciliation;
installer не фабрикует park_comment и не переписывает checkpoints, попытки или бюджеты.
Interrupted partial install/remove оставляет durable prepared manifest; повторный `--remove` восстанавливает
целый managed set при тех же safety/compatibility условиях. Не удалять backup до проверки отката.

Ошибки и HUP/INT/TERM запускают rollback. Если частично успешный restart уже начал нового writer,
installer не убивает его ради отката. То же относится к появившейся после restart policy deferral:
перед возвратом старого runtime повторяются compatibility guards при frozen и stopped units.
При отказе код/policy не откатываются к небезопасной старой версии; retained workers размораживаются,
выдаётся **ROLLBACK INCOMPLETE**, private backup сохраняется для безопасного ручного разбора.
Неустранимая ошибка systemd/диска
также не маскируется как PASS. Бюджетные и security/PROD gates остаются fail closed.

Коррекция v3 закрывает finding независимого review о failed service после неудачного start.
`System.status()` проверяет структуру systemctl show, LoadState, KillMode, enabled-state и freezer;
допустимые runtime states определяются отдельно для операции. Первичная установка по-прежнему
принимает только healthy active/running либо inactive/dead. Rollback и `--remove` дополнительно
принимают failed/failed только при MainPID=0, пустом либо отсутствующем trusted cgroup и отсутствии
процессов во всех descendant cgroups. Активные units проходят прежние freeze/children/checkpoint
guards; activating/deactivating, неизвестные states и failed с живыми descendants запрещены.
Enable/disable/reset-failed не вызываются; enabled-state pin сохраняется.

Одноразовый failed start любого из трёх units, включая сбой после успешного запуска другого,
при безопасном состоянии возвращает весь managed set, manifest и исходные active/enabled states.
При постоянном сбое start файлы восстанавливаются целиком, остальные службы восстанавливаются
независимо от неисправной, выдаётся ROLLBACK INCOMPLETE, backup сохраняется. Фаза manifest `removed`
означает восстановленные файлы; повторный `--remove` проверяет службы до сообщения «Уже удалено.»
и при несовпадении active states повторяет безопасное восстановление. DRY remove только проверяет
этот путь. Состояние failed перед recovery означает quiescence; при неудаче самой операции remove
оно может остаться inactive/dead, без попытки искусственно воспроизвести failed.
Новый writer либо policy deferral по-прежнему запрещают откат к старому runtime; retained units
размораживаются, backup остаётся для reconciliation. Payloads executor/slots/monitor и их pins в v3
byte-identical входному v2. Точный новый installer требует НОВЫХ независимого security review и DRY.

Проверки — в EVIDENCE.md. Disposable Git histories настоящие; Actions, QA/author model edges,
root metadata и systemd в tests симулируются. Эти tests не доказывают live CI, systemd freezer
или работоспособность model/SSH credentials на VPS; их проверяет независимый deployment review.
