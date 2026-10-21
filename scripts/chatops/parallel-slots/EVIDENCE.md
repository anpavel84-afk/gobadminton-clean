# OPS #155 — continuity v2: offline evidence, 2026-10-21

Работа выполнена только в supplied writable copy; сеть, модели, реальные службы и live checkpoints
не использовались. Это source candidate для независимого security review и root DRY, не live install
и не review PASS. Пять deployed originals и manifest в pinned-originals оставлены byte-identical.
Wrapper/reviewer pins, прежний slot-live-telemetry.sh, foundation checker и оба sanitized context JSON
также не изменены. Installer пересобран из supplied deployed originals, не из v1 candidate.

Все Python tests запускались с `PYTHONDONTWRITEBYTECODE=1` и
`TMPDIR=/var/lib/gobadminton-clean-prompt-writer/ops/run.mLZnVt/tmp`.
Текущая директория команд — writable copy из METADATA.

| Команда / проверка | Итог |
| --- | --- |
| `python3 -m unittest discover -s slots-continuity-v2/scripts/chatops/tests -v` | **151 tests, OK**, 33.498 s; весь прежний набор + новые regression tests |
| `python3 -m unittest discover -s slots-continuity-v2/scripts/chatops/parallel-slots/commission-tests -v` | **8 tests, OK**, 0.189 s; 5 прежних + 3 DOM/UI tests через локальную libduktape |
| `python3 slots-continuity-v2/scripts/chatops/parallel-slots/build_continuity_installer.py --original slots-continuity-v2/pinned-originals` | PASS; пять exact original pins проверены, пять актуальных payloads пересобраны |
| `bash -n slots-continuity-v2/scripts/chatops/parallel-slots/slots-continuity.sh` | PASS, exit 0 |
| `PYTHONPYCACHEPREFIX=/var/lib/gobadminton-clean-prompt-writer/ops/run.mLZnVt/tmp/pycache python3 -m compileall -q slots-continuity-v2` | PASS, exit 0; также выполнен py_compile для **19 файлов**, включая supplied pinned originals, cfile в scratch |
| Embedded controller compile + AST extraction/decompress/hash payloads; `test_generated_installer_contains_current_sources_pins_and_exact_controller` | PASS; controller соответствует исходнику, все 5 original/new SHA256 соответствуют manifest/исходникам; повторный builder output byte-identical |
| `git diff --no-index --check -- /var/lib/gobadminton-clean-prompt-writer/ops/run.mLZnVt/orig/slots-continuity-v2 slots-continuity-v2` | Пустой вывод; exit 1 означает наличие diff, whitespace diagnostics нет |
| `node slots-continuity-v2/scripts/chatops/parallel-slots/commission-tests/test-telemetry-ui.cjs slots-continuity-v2/scripts/chatops/parallel-slots/monitor-src/app.js` | Node недоступен, exit 127. Попытка второго fixture test-monitor-idle-ui.cjs и `/usr/local/bin/node --version` тоже exit 127: dangling link. Node fixtures не заявлены PASS |
| `command -v shellcheck` | Недоступен; shellcheck не выполнялся |

Полные финальные логи: scratch `final-tests.log`, `commission-tests.log`.
Первые прогоны обнаружили несовместимость аргумента save() со старыми legacy PARK crash fixtures
и umask в новом Style Guide fixture. Legacy вызов восстановлен, fixture явно задаёт публичные modes;
финальный полный прогон выше зелёный. Правки test_slots ограничены synthetic-host fixture:
root-owned Style Guide не установлен в disposable host, поэтому его validation замокан там явно.
Реальные security/permission отрицательные проверки Style Guide находятся в test_continuity_v2.py.

## Покрытие конкретных замечаний

1. **Bootstrap transport.** Оба настоящих disposable slot clones содержат literal origin
   `/srv/gb-slots/base.git` для fetch/push. Production READ_REMOTE/WRITE_REMOTE не подменены:
   только тестовый subprocess edge заменяет явный GitHub URL локальным bare repo и запрещает
   неявный transport. Пройдены repair → интеграция нового DEV → свежие QA/CI → promotion.
   Другие локальные fetch/push origins, URL rewrite, core.sshCommand/core.gitProxy отвергаются;
   исключение bootstrap origin не добавлено для default mode. Exact branch/head проверки сохранены.
2. **Точная V1 публикация.** Реальный Runtime.publish пишет status.json с blocked/private wait и
   policy archive; supplied original writer._slot_status принимает результат. Новые подробности
   не попадают в V1. Idle также принимается исходным validator; integrating — новым строгим writer.
3. **Telemetry/UI.** Реальные Runtime → telemetry.project/validate → writer.slot_publications
   дают FRESH integrating card. Предыдущие QA/CI PASS скрываются на фазе integrating;
   попытка экспортировать их отвергается validator, mismatch другого candidate SHA не проходит как PASS.
   Новый DOM fixture исполняет **неизменённый app.js** в локальной libduktape с mock DOM и synchronous
   fetch delivery. Проверены семь этапов, подпись текущего DEV, отсутствие QA/CI PASS во время integration,
   legacy done/active/idle, slot CI/blocked/done/idle/stale. Node fixture также расширен integration case,
   но Node недоступен. Это не проверка настоящего браузера, nginx или таймера.
4. **Cheap busy.** Оба слота заняты checkpoint либо assignments; fixture fetch и API pages падают
   при вызове. Ни один не вызван; Budget также не создаётся; возвращён truthful busy reason.
5. **Public Style Guide.** Для slot1/slot2 × author/QA inline TOML содержит только read публичного
   дерева, deny его родителя; исходные filesystem denials совпадают, сеть выключена.
   Проверены root ownership, non-writable parents/tree, symlink root/refs/file, отсутствие refs,
   altered App pin. Один и тот же frozen pin set проверяется runtime и installer preflight.
   UID/GID root в fixtures симулируются, фактическая metadata на VPS здесь не проверялась.
6. **Archive/state/release/free.** Настоящий local Git writer и настоящий registry/mutex:
   durable archive → durable active=None → mutex release → lease release → V1 public free.
   На publication конфликтующий successor уже может взять lock. Проверены policy и Owner PARK;
   dirty/unfinished Owner writer сохраняет exclusion. Crash между archive/state, а также сбой
   release/publication после checkpoint восстанавливаются без network или re-admission.
   Legacy Owner PARK, headless PARK и его crash recovery прошли прежние tests.
7. **Безопасный rollback.** Nonempty deferred.json запрещает remove и DRY remove без изменений
   managed files, backup manifest, units или checkpoints. Empty archive допускает exact restore.
   Если после частичного restart появился новый writer либо policy deferral, автоматический rollback
   возвращает ROLLBACK INCOMPLETE, сохраняет полный новый код/policy и backup, размораживает retained
   units и не запускает старый runtime. Никаких fake park_comment/checkpoint edits.
8. **Restart и root safety.** Сохранены прежние tests exact two-parent merge adoption без повторного
   merge/author, interrupted developing/QA fail closed, read backoff с сохранением phase/attempt,
   budgets/ledger, identity/scope, новая QA/CI на каждом SHA, неизвестные promotion/deploy blocks.
   Installer проверяет все пять файлов кода плюс policy, dedicated lock, trusted metadata, exact inputs,
   frozen/stopped cgroups. Ошибки и SystemExit инжектируются после **каждой** mutation boundary
   полного install, включая все 3 monitor payloads; проверяется полное восстановление bytes/modes/
   ownership/active/enabled states. Partial install/remove recovery, children, phase/freeze races,
   unsafe links/parents, drift и corrupt payload также проверены. Реального root/service DRY не было.

## SHA256

| Файл | Deployed original | Новый payload |
| --- | --- | --- |
| `autonomous_issues.py` | `0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293` | `9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7` |
| `slots.py` | `4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7` | `1b4708b6ff64071074399cfcfd3c4c73f93501efdcd9266e9dafc61b927fb98c` |
| `slot_telemetry.py` | `070eaa290c72ba7a13af8accbd996f3fbe8473e00b857f3f293a868b4d8e5b3f` | `2546f8409c57bd4db25af895518ed77ff46ac21a9e80af10d4bb977945687229` |
| `writer.py` | `9a2364f1ca6175da6c26bcab4ae02884605edf108023d69ce8278f880fdbe132` | `957ebb3fb201efea31c7f29aa174bf142466c09e3222c03e5880b3467a14bc24` |
| `app.js` | `9e9980c6c0580e54b01e42eda52bff573b45af9cd43b2f060cf70fea4f6ea379` | `b8d617d74d3b707cd459c305b90054b5ab263c0f8184bc877c943730bbd13f3b` |

Самодостаточный `slots-continuity.sh`: `dc4e3d52a86f7b06d1fc6145c787cfe34292c6c11ccee3cd9772ebf9cca3ab6b`.
Все embedded payload SHA256 обновлены builder; собственного self-hash в installer нет.
Policy bytes (sorted JSON + newline): `1587e5881d6ef6429d29f3f033aff330faf0dd40ec11f83bfc20ba7e861bce6c`.
Frozen Style Guide pins:

- `src/App.tsx`: `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`.
- `src/index.css`: `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`.

Live commissioning, model/SSH credentials, реальный systemd freezer, monitor next tick и root metadata
требуют независимого deployment/security review и DRY точного итогового installer.
Откат допускается только при quiescent compatible state; unresolved policy deferrals требуют
отдельной reconciliation и не исчезают от возврата старого кода. Подробности — CONTINUITY.md.
