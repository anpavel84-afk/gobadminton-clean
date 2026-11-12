# План проверки изоляции (выполнять на сервере ДО max_parallel=2)

Ничего не запущено. Всё ниже — проект.

## Проверки (каждая должна вернуть ожидаемое)
1. `systemctl show gobadminton-slot@slot1 gobadminton-slot@slot2 -p User,StateDirectory,ReadWritePaths,PrivateTmp`: у каждого свои пути, пересечений нет.
2. `realpath` всех worktree и state-каталогов слотов: ни один не префикс другого и не совпадает с путями старого исполнителя.
3. Перекрёстная запись: `systemd-run -p ... --uid=<slot1> touch /srv/gb-slots/slot2/worktree/x`, ожидается EACCES/EROFS. То же для state slot2 и checkpoint старого исполнителя.
4. `git -C slot1/worktree worktree list` и `rev-parse --git-dir`: разные HEAD и index, один repo без общего index.
5. Блокировка: два процесса `flock -n /run/gb-slots/slot1.lock`, второй получает отказ. `kill -9` первого, после чего захват удаётся.
6. Integration mutex: два supervisor-вызова `integrate`, второй получает отказ. `kill -9` держателя, после чего захват удаётся.
7. Конфликт блокировок: dry-run планировщика на двух фиктивных задачах `web:games` и `web:games:map` (ожидается serial), затем на `web:games` и `api:profiles` (ожидается parallel), затем на `migrations` с чем угодно (ожидается solo).
8. Адаптеры: `supervisor adapters --status` показывает codex enabled, а cursor и agy disabled с причинами. agy в роли qa получает AdapterDisabled.
9. Checkpoint slot1 после переноса: sha256 совпадает с исходным checkpoint (без сброса счётчиков и истории).
10. Shadow-прогон: 1 задача при max_parallel=1 проходит весь путь до DEV ACCEPTED.
11. Секреты: `journalctl -u 'gobadminton-slot@*'` и логи supervisor без токенов (grep по известным префиксам, печатается только счётчик).

## Что сделала бы одна root-команда (подготовить, не запускать)
Форма команды (как у codex-review): `sudo bash -c 'install … stage/parallel-v2-install.sh /root/…; echo "<sha256>  /root/…" | sha256sum -c - && bash /root/parallel-v2-install.sh'`
Установщик:
1. Отказывается работать, если исполнитель не в `idle` или lock занят.
2. Делает backup: unit-файлы, sudoers, `autonomous_issues.py`, весь state-каталог (tar + sha256).
3. Сверяет sha256 новых файлов (supervisor, slot unit-шаблон, исправленный `autonomous_issues.py` с ops-ветки после QA и CI).
4. Создаёт пользователей и каталоги слотов (0700), `git worktree add` для slot2, переносит state текущего исполнителя в slot1 через `mv` с проверкой sha.
5. Ставит `gobadminton-slot@.service` и `gobadminton-supervisor.service` с `max_parallel=1`, отключает старый unit (не удаляя его).
6. Прогоняет проверки 1–9. Если хоть одна красная, выполняется автоматический rollback.
7. `--remove`: восстанавливает старый unit и state из backup.
Переключение на `max_parallel=2` — отдельный шаг, только после проверки 10 и «да» Павла.
