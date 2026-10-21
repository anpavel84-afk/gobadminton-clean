# OPS #155 — offline evidence, 2026-10-21

Все команды выполнялись только в writable copy; TMPDIR/bytecode/logs — в предоставленном scratch.
Ни сеть, ни модели, ни реальные systemd/service actions не вызывались. Из исходных файлов изменены
только autonomous_issues.py и slots.py; остальные 8 исходных файлов, включая telemetry installer,
его commissioning tests, foundation checker и оба sanitized context JSON, byte-identical.

| Проверка | Результат |
| --- | --- |
| `python3 -m unittest discover -s slots-continuity-v1/scripts/chatops/tests -v` | **138 tests, OK**, 25.226 s; прежние 108 без правок + 30 новых tests (с subtests) |
| `python3 -m unittest discover -s slots-continuity-v1/scripts/chatops/parallel-slots/commission-tests -v` | **2 tests, OK**, 0.088 s; сообщения об injected TimeoutExpired ожидаемы |
| `py_compile.compile(..., cfile=<scratch>, doraise=True)` для всех Python файлов | PASS, **11 файлов**, bytecode только в scratch |
| `bash -n slots-continuity-v1/scripts/chatops/parallel-slots/slots-continuity.sh` | PASS, exit 0 |
| `compile(embedded_python, ..., 'exec')` для heredoc installer | PASS |
| builder с pinned original directory + test_generated_installer_contains_current_sources_pins_and_exact_controller | PASS; payload/controller соответствуют текущим исходникам |
| Python/difflib проверка trailing whitespace добавленных строк | PASS; просмотрены все 16 файлов дерева до добавления этого отчёта |
| `git diff --no-index --check -- <original> slots-continuity-v1` | Пустой вывод; exit 1 из-за наличия source diff в no-index, whitespace diagnostics отсутствуют |
| `command -v shellcheck` | Недоступен (exit 1); shellcheck не выполнялся |

Полный основной лог: scratch/final-tests.log. Git metadata в writable copy отсутствуют;
сравнение сделано с read-only original. Первые прогоны новых тестов выявили ошибки тестовых
fixtures (не fetched Git object, mock API вместо реального retry helper, umask); они исправлены.
Финальный прогон выше полностью зелёный.

Новые tests проверяют настоящие disposable local Git repos: общий base двух clones, независимое
продвижение DEV, repair с attempt2→3, сохранение task diff, non-force merge обоих histories,
новые QA/CI на каждом SHA и отсутствие promotion при новых FAIL. Проверены mismatched saved QA,
remote HEAD/URL, rewritten DEV, dirty/out-of-scope, cancelled/green/wrong-job-SHA/unrecognized CI,
Owner RESUME при drift, max attempts/merge bounds, неизменность бюджетного ledger,
crash после model charge и после merge commit, crash между archive/state writes,
unsatisfied dependency и реальное tick→assignment→claim независимой задачи.
PR/API/network read backoff проверен через main и повторный запуск без сброса phase/attempt.

Installer tests используют **сам controller**, реальные scratch files и simulated root metadata/systemd:
DRY без mutations, exact byte/mode/active/enabled restore, ошибки и SystemExit после каждой из
10 mutation boundaries успешного install, remove failure, partial install/remove journal recovery,
fresh snapshot повторной установки, children/active phases/freeze race/stopped cgroup rechecks,
symlinks/hardlinks/writable parents/unknown bytes/corrupt payload, сохранение deferred.json при remove.
Отдельно проверено, что rollback не останавливает нового writer после частичного restart и честно
возвращает ROLLBACK INCOMPLETE. No root/service integration claims: freezer/systemd/credentials
на VPS требуют независимого security/deployment review.

| Artifact | SHA256 |
| --- | --- |
| original autonomous_issues.py | `0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293` |
| original slots.py | `4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7` |
| new autonomous_issues.py | `0e90abe26445ec6c9e4679703732bde617d4acb793edefc41654e49a4ee1b638` |
| new slots.py | `44279d66bda355a6d0dc5e74639cd825314617f159aae90b41f157caa955e066` |
| slots-continuity.sh | `bf5564d8909677ebc218f245b90a75af45b8501cd85a8088cdad16253f6814aa` |
| installed enabled policy bytes (sorted JSON + newline) | `1587e5881d6ef6429d29f3f033aff330faf0dd40ec11f83bfc20ba7e861bce6c` |

Перегенерация installer после правок executor/slots/controller обязательна; hashes embedded payloads
обновлены. Сам installer не содержит собственного self-hash. Operation limits, rollback и UI truth
описаны в CONTINUITY.md. Никаких live checkpoint edits или изменения privileged reviewer pins не было.
