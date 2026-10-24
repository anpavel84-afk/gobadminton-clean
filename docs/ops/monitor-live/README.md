# OPS monitor: live-only `server.py` (reference copy)

**Reference copy, not the installer and not authority.** The OPS monitor web server is installed on the VPS at `/usr/local/lib/gb-ops-monitor/opsmon/server.py` and has no source in this repository. This record captures the live bytes so a change to it is not untracked drift. Installation facts come from the install receipts and the exact live file, not from this document.

| Item | Value |
|---|---|
| Live path | `/usr/local/lib/gb-ops-monitor/opsmon/server.py` (root:root 644) |
| Copy in repo | [server.py.live.txt](server.py.live.txt) (13324 bytes, `.txt` so it is never run or imported) |
| Previous live SHA-256 | `087aeaffc5b01fa9c3d46c7ba728a0add77702d0c96b52cdf5343f737f8f0ea0` |
| Current live SHA-256 | `6a6c094e20b404bb09a299fc735325c385a08436877778f370f3c9394cee6ca4` |
| Changed | 2026-10-24 about 16:02 America/Sao_Paulo, with PR #279 (external runs card) |

The file holds no secrets: the PIN salt/hash and cookie secret are read from a separate root-owned config file.

## The only change (one line, `KNOWN['top']` allow-list)

```diff
-            'source_mode', 'slots', 'counts_complete', 'parked_count'),
+            'source_mode', 'slots', 'counts_complete', 'parked_count', 'external_runs'),
```

The web server filters `snapshot.json` by this allow-list. Without `'external_runs'` the writer output of PR #279 (`monitor_payload/writer.py`) would be dropped before it reaches the page.

## Rollback

Backup on the VPS: `/var/backups/gb-ops-monitor-ext-20261024T190211Z/` (root-only; holds the old writer.py, app.js and server.py and `rollback.sh`).

```
sudo bash /var/backups/gb-ops-monitor-ext-20261024T190211Z/rollback.sh
```

## Verifying drift

`sudo sha256sum /usr/local/lib/gb-ops-monitor/opsmon/server.py` must equal the current SHA-256 above, or a later record must supersede it. Updating the live file means updating this copy and hash in the same change.

## Proposed (not installed): `pma_work` allow-list entry

The "Работа вне слотов" block adds one more top-level snapshot key, `pma_work`, written by `monitor_payload/writer.py`
from the data-only file `/var/lib/gb-ops-titles/pma_work_ru.json` (same channel and owner rules as `titles_ru.json` and
`backlog_ru.json`). `server.py.live.txt` in this change already contains the new allow-list line:

```diff
-            'source_mode', 'slots', 'counts_complete', 'parked_count', 'external_runs'),
+            'source_mode', 'slots', 'counts_complete', 'parked_count', 'external_runs', 'pma_work'),
```

The live `server.py` is **unchanged until PMA installs it**; after install, replace "Current live SHA-256" above with the new
hash and record the new backup path in the same change. `server.py` loads `app.js` into memory at start, so the monitor web
service must be restarted once after installing `app.js` and `server.py` (the snapshot writer timer needs no restart).
Without the allow-list line the block shows "Список недоступен" (the key is dropped), which is a safe failure.

## «Работа вне слотов» — `pma_work_ru.json` (proposed)

Отдельный блок монитора для задач PMA вне слотов конвейера: установки (#273 и т. п.), независимые QA-ревью,
черновые PR, разборы, пункты, ожидающие решения Owner. Это НЕ продуктовые задачи и НЕ состояние слотов.

* Источник: `/var/lib/gb-ops-titles/pma_work_ru.json` (уже существующий канал публикации `titles_ru.json`/`backlog_ru.json`;
  путь меняется аргументом `--pma-work-external`, правка systemd-юнита не нужна). Писатель — владелец каталога (`grokops`)
  или root; загрузчик принимает только uid ∈ {0, grokops}, ≤ 64 КиБ, ≤ 30 записей, строгие ключи/значения.
  Запись — атомарно (tmp + rename). Монитор читает файл каждые ~30 с вместе с остальным снимком.
* Поля записи: `id` (латиница/цифры/`-_`, уникален), `title_ru` (≤160), `kind` (установка | QA-ревью | черновой PR | разбор |
  решение Owner | другое), `stage_ru` (≤120, необязательно), `status` (идёт | ждёт Pavel | ждёт внешнего | заблокировано | готово),
  `waiting_for_ru` (≤300, чего ждём от Pavel), `link` (только https://github.com/anpavel84-afk/gobadminton-clean/{issues|pull}/N,
  commit/SHA, actions/runs/N), `updated_utc` (ISO с часовым поясом), `fresh_hours` (1..168, необязательно).
* Защита от устаревания считается в writer при каждом запуске, а не в файле: возраст = now − `updated_utc`; запись «не
  подтверждена вовремя» при возрасте > `fresh_hours` (по умолчанию 4 ч для «идёт», 24 ч для остальных) или времени из будущего;
  такие записи затемняются и помечаются; старше 72 ч без подтверждения — скрываются, но считаются в «Скрыто …: N»;
  «готово» исчезает через 24 ч; если весь файл не обновлялся > 24 ч — плашка «список не обновлялся …».
  Нет файла / файл невалиден → блок честно пишет «файл отсутствует», а не пустой список.
* Не используется: GitHub API из монитора (нужен токен у writer), файл в репозитории (не автоматически, нужен деплой),
  Issue #29 (продуктовая задача, не канал статуса).
* Пока PMA не обновляет запись, она сама станет «неактуальной» — это намеренное свойство.
