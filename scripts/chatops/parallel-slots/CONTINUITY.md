# OPS #155 — bounded continuity, 2026-10-21

From: OPS / isolated source copy. To: PM и независимый root installer security review.
Status: исходники, offline tests и самодостаточный installer; установки на VPS не было.
Входные SHA256 закреплены в build_continuity_installer.py. Существующий telemetry installer
и защищённые wrapper/reviewer pins не изменены; обновление проверенных metadata pins — отдельная работа.

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
  задача с exact snapshot/evidence сохраняется в `deferred.json`, затем освобождается active.
  Запись архива предшествует state; crash между ними завершается идемпотентно. Это **не done
  и не Owner PARK**. Исходный `parked.json` остаётся только для настоящего Owner PARK, чтобы
  старый reader мог прочитать его после code rollback. QA файлы и before-defer snapshots сохраняются.

Scheduler продолжает только независимые admitted JSON задачи. Зависимость от deferred/parked
issue остаётся незавершённой даже при завершении successor. Семантическую связь PM обязан
выразить immutable `depends_on`; prose backlog не становится executable task. Clean остановленный
writer освобождает file locks; dirty/unknown writer сохраняет exclusion через lease и status.
Identity/auth/изменённый admission или Git transport, rewritten history, out-of-scope,
неопределённые promotion/deploy и неизвестные blocks не освобождаются автоматически.

UI truth: `slots.py status`, status.json и supervisor journal показывают reason/resume_phase,
read wait, deferred reason/kind и queue причины: no admitted tasks, busy, conflict, dependency,
budget/UNKNOWN. Событие автоматического отложения называется `deferred`, а не Owner PARK.
Старый telemetry parser может показать UNKNOWN во время новой фазы integrating; telemetry/UI
installer здесь не меняется. UNKNOWN, idle после deferral и source QA PASS не означают DONE/DEV acceptance.

Installer генерируется командой `python3 build_continuity_installer.py --original <папка pinned originals>`.
Он содержит readable Python controller и сжатые payloads с проверкой SHA256; генерация обновляет
оба payload hash. На review-host root сначала выполняет `DRY=1 bash slots-continuity.sh`.
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

`DRY=1 bash slots-continuity.sh --remove` проверяет обратный путь; `bash slots-continuity.sh --remove`
возвращает точные preinstall bytes/modes/ownership и active states. Policy, отсутствовавшая до install,
удаляется. Архивы задач не меняются. После rollback старый scheduler не понимает policy-архив:
он может остановиться на сохранённой существующей ветке, до вызова автора. Это безопасная остановка,
а не обещание продолжения bounded continuity старым кодом; evidence и реальные попытки остаются в архиве.
Interrupted partial install/remove оставляет durable prepared manifest; повторный `--remove` восстанавливает
целый managed set. Не удалять backup до проверки отката.

Ошибки и HUP/INT/TERM запускают rollback. Если частично успешный restart уже начал нового writer,
installer не убивает его ради отката: сообщает **ROLLBACK INCOMPLETE**, сохраняет private backup
и требует повторного безопасного разбора после завершения writer. Неустранимая ошибка systemd/диска
также не маскируется как PASS. Бюджетные и security/PROD gates остаются fail closed.

Проверки — в EVIDENCE.md. Disposable Git histories настоящие; Actions, QA/author model edges,
root metadata и systemd в tests симулируются. Эти tests не доказывают live CI, systemd freezer
или работоспособность model/SSH credentials на VPS; их проверяет независимый deployment review.
