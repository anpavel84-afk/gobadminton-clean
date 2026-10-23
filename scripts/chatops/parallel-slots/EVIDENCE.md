# OPS #155 — continuity v5: offline evidence, 2026-10-21

Только isolated source candidate: сеть, live services/checkpoints, credentials и VPS не использовались.
Исправлены post-stop regression, fully removed V4 journal migration и alternates-absent slot2 preflight.
Это не security review PASS и не live/root DRY.
Точный входной V4 installer: `0f0be31059e7f0ce6ea0768de733627137b93eaee0e42b95df632def4a5f5c3b`.
Все пять pinned deployed originals и manifest, autonomous_issues.py, monitor payloads, protected
wrappers/reviewer pins, telemetry installer, foundation checker и sanitized contexts byte-identical входу.
Из payloads изменён только Git readiness slots.py; startup barrier v4, task/scheduler/budget/auth logic сохранены.

Команды выполнялись из `slots-continuity-v5` в writable copy METADATA, с
`PYTHONDONTWRITEBYTECODE=1` и `TMPDIR=/var/lib/gobadminton-clean-prompt-writer/ops/run.h2KxOV/tmp`.

| Проверка | Результат |
| --- | --- |
| `python3 -m unittest discover -s scripts/chatops/tests -v` | **183 tests, OK**, 52.168 s, 0 failures/errors; прежние 170 + 9 installer и 4 slot regression methods; всего 42 installer methods |
| `python3 -m unittest discover -s scripts/chatops/parallel-slots/commission-tests -v` | **8 tests, OK**, 0.162 s, 0 failures/errors, включая DOM/UI через локальную libduktape |
| `python3 scripts/chatops/parallel-slots/build_continuity_installer.py --original pinned-originals` | PASS; exact deployed pins, новый slots SHA256 и embedded controller/payload |
| `bash -n scripts/chatops/parallel-slots/slots-continuity.sh` | PASS |
| `python3 /var/lib/gobadminton-clean-prompt-writer/ops/run.h2KxOV/tmp/verify-candidate.py` | PASS: 19 Python sources + embedded controller, compilation только в scratch, AST/decompression/SHA256, reproducible builder, allowed diff и неизменные payloads/pins |
| Scratch verifier: byte-exact V4 controller/slots.py + actual embedded payloads | V4 post-stop failure и sole alternates-absent preflight failure воспроизведены; V5 проходит те же fixtures, archive/install/remove и read-only DRY с unpatched V4 SHA allowlist |
| `git diff --no-index --check -- /var/lib/gobadminton-clean-prompt-writer/ops/run.h2KxOV/orig/slots-continuity-v5 .` | Нет whitespace diagnostics; exit 1 означает наличие diff |
| `command -v shellcheck` | Недоступен; shellcheck не запускался |

Полные логи: scratch `core-tests.log`, `commission-tests.log`, `verify-candidate.log`.
Generated installer после builder возвращён к mode 0600 supplied writable copy; wrapper представляет
read-only originals как 0400. Новых permission bits в итоговом кандидате нет.
Собственного self-hash в installer нет; embedded slots payload data/new SHA обновлены builder.
Все old pins и четыре остальных embedded payload dictionaries сохранены точно.

## Проверки v5

1. Post-stop polling проверен через production System.status/pids/command, mock subprocess show
   и реальные scratch cgroup.procs: stop-sigterm → PID0 → cleared ControlGroup → inactive/dead;
   исчезнувший bound cgroup с PID0; живой descendant при очищенном поле отвергается.
   Never-settles исчерпывает monotonic deadline; сигнал, чужой PID/cgroup/child, enabled drift,
   activating и unknown stop substate не допускают file switch. Install, remove и прежние rollback
   tests проходят; transient states по-прежнему запрещены при entry и вне собственного stop poll.
2. Removed prior journal мигрируется только после проверки всех old/new data/SHA/metadata и current
   originals, safe slots/units, неизменного enablement и отсутствия pending. Архив содержит полные
   исходные journal bytes, metadata и unit history; durable archive предшествует новому prepared.
   DRY не вызывает write/service actions и не создаёт lock/archive. Fault/signal после archive
   допускает retry; abrupt process exit после КАЖДОЙ migration mutation сохраняет audit и recovery.
   Prepared/installed/pending, mixed/drift, unknown candidate, недостающие/ложные digest, null/empty
   manifest, invalid units, corrupted archive и archive без managed journal отвергаются до mutations.
3. Исходное active/active/inactive с enabled slot2 сохраняется, даже если V4 journal содержал три
   active. До commit проверены все intended active units и installed journal при существующем barrier.
   Одноразовый и постоянный failed start при migration возвращают originals и свежий V5 removed
   journal с ТЕКУЩИМ inactive slot2; prior V4 journal остаётся в архиве. Повторный V5 --remove
   восстанавливает остальные units без запуска slot2. Checkpoint bytes не меняются.
4. Реальные disposable local Git repos: shared exact-base alternates и repacked self-contained без
   alternates проходят; проверено отсутствие Git writes/смены remote. Empty/relative/other/multiple/
   symlink/dangling alternates, missing commit/blob, dirty/untracked tree, mismatched common-dir,
   linked objects/pack, http-alternates, shallow/grafts и promisor config/pack отвергаются.
   UID/GID/groups, capabilities, proof freshness/binding и budget regressions сохранены.

Первый полный промежуточный запуск: 181 tests, 3 failures + 32 subtest errors из-за слишком строгого
сравнения cgroup path при recovery failed units. Исправлено проверкой пустоты обоих trusted cgroups;
финальный полный запуск выше — 183 tests, 0 failures/errors. Лог первого запуска сохранён в scratch
`core-tests-first-run.log`; это не нерешённый defect итогового candidate.

## Сохранённые проверки v4 (выполнены в общей suite v5)

1. **Первая работа runtime/supervisor.** Настоящие wait/deployment_pending проверяются до Layout,
   Budget, supervisor config/API/tick. Пока marker существует, downstream entry недостижим;
   read-only status доступен. Marker отсутствует — entry проходит. Metadata tests сохраняют реальные
   file types/modes/link counts и синтезируют только root UID/GID. Unknown/extra/duplicate schema,
   oversized marker, symlink/hardlink/directory/FIFO, неправильные mode/owner, untrusted/symlink parent
   и untrusted parent даже без marker fail closed. Installer также отказывает orphan marker без backup.
2. **Реальные disposable workers.** Отдельные Python processes входят через настоящий Runtime slot1,
   slot2, pinned старый autonomous_issues.activate_slot с новым Runtime и supervisor main.
   WAIT handshake означает фактическое чтение persistent marker; timing не служит activation proof.
   До commit отсутствуют lease, task mutation, ledger/charge и supervisor work.
   В успешном пути проверяются все три starts и active/running states, затем durable installed journal,
   затем unlink/fsync. Только после release выполняются настоящие registry.acquire, atomic task write
   и Budget.charge (ровно одна author charge); supervisor достигает config/scheduling entry.
   Никакая настоящая модель или API не вызывается.
3. **Второй/третий failed start.** Первый real process уже находится внутри barrier до injected
   systemctl failure. До freeze/stop нет task/lease/charge, stop завершает disposable process.
   Все шесть managed files (bytes/modes/owner), исходные unit states, policy absence/disabled policy,
   checkpoints и removed journal проверяются; pending marker исчезает только после безопасного restore.
   Сохраняются v3 tests одноразового/постоянного сбоя всех трёх starts, восстановление остальных служб,
   честный ROLLBACK INCOMPLETE при persistent failure и последующий повторный remove.
4. **Crash/restart.** Отдельный installer process вызывает os._exit без Python rollback/finally после
   каждой write/system mutation install и remove: prepared journal, marker, каждый freeze, stop,
   каждый из шести file switches, каждый start, installed/removed journal, final marker removal.
   Parent восстанавливает только simulated systemd state; новый Installer читает persistent disk state.
   До activation новый worker/restarted старый executor с новым Runtime остаётся на marker.
   Pending installed journal не позволяет shortcut «Уже установлено». DRY remove не меняет marker,
   journal, units. Повторный remove возвращает весь original set и исходные states, затем идемпотентен.
   Отдельно abrupt exit непосредственно до unlink и после unlink ДО directory fsync: код не откатывается
   после возможного release; surviving marker удерживает entries до явного remove.
5. **Commit uncertainty/signals/logging.** Реальные HUP/INT/TERM до commit и до/после unlink внутри
   commit проверены. В критическом участке сигнал доставляется после fsync и восстановления mask.
   Ошибка до unlink, directory fsync, после fsync либо print не запускает rollback под новыми workers.
   Полный новый код и installed journal сохраняются; наличие marker определяет blocked/released entry.
   Проверено отсутствие service actions после входа в final activation; logging error не превращает
   доказанный commit в uncommitted installation.
6. **Frozen/failed recovery.** MockSystemctl подменяет только subprocess systemctl edge, production
   System.status/pids/command разбирают полные property lines и настоящие scratch cgroup.procs.
   Recovery prepared/installed/removed journal проверен с frozen active units и с frozen failed PID0,
   пустым/отсутствующим cgroup. Early thaw не вызывается: simulated normal stop thaw повторяет
   документированную systemd job semantics. Все bytes/states восстанавливаются, repeat remove безопасен.
   Child/unsafe writer/nonempty deferral/enabled drift отвергаются до mutations также при frozen units.
   LoadState/KillMode/FreezerState, descendants, unknown/transitional states и failed PID guards сохранены.
7. **Порядок и DRY.** Durable prepared journal + marker предшествуют slots.py, затем autonomous_issues;
   originals возвращаются в обратном порядке. Последняя managed mutation успешного пути — marker unlink.
   Сохраняются прежние DRY no-lock/no-backup/no-managed-write/no-service-mutation assertions,
   inactive/disabled/static unit states и guards на непустой deferred.json/несовместимый parked.json.
   Искусственно появившиеся unsafe child/writer/policy deferral не разрешают небезопасный rollback:
   код не заменяется, backup/marker сохраняются, retained workers thaw, результат ROLLBACK INCOMPLETE.

Core suite повторно проверяет прежние local Git integration/restart, admission, legacy default mode,
budgets, exact-head QA/CI, deferral/archive/release, Style Guide security и telemetry compatibility.
Старые no-deployment runtime fixtures явно симулируют уже активированный host; новые barrier tests
используют реальное ожидание и отдельные процессы. Metadata ownership/systemd остаются симуляцией:
проверки не доказывают реальный freezer, service start или crash durability диска на VPS.

## SHA256

| Payload | Deployed original | Новый payload |
| --- | --- | --- |
| autonomous_issues.py | `0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293` | `9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7` |
| slots.py | `4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7` | `19d07c8d680d31ff65e13b3d8611b93fab1898461a918e69390a77bf8bb5ad02` |
| slot_telemetry.py | `070eaa290c72ba7a13af8accbd996f3fbe8473e00b857f3f293a868b4d8e5b3f` | `2546f8409c57bd4db25af895518ed77ff46ac21a9e80af10d4bb977945687229` |
| writer.py | `9a2364f1ca6175da6c26bcab4ae02884605edf108023d69ce8278f880fdbe132` | `957ebb3fb201efea31c7f29aa174bf142466c09e3222c03e5880b3467a14bc24` |
| app.js | `9e9980c6c0580e54b01e42eda52bff573b45af9cd43b2f060cf70fea4f6ea379` | `b8d617d74d3b707cd459c305b90054b5ab263c0f8184bc877c943730bbd13f3b` |

Самодостаточный slots-continuity.sh: `117e38e3ab9890c60d39533a78f8340e366fbafceb8ba09b58f329d7817b50e9`.
Policy SHA256: `1587e5881d6ef6429d29f3f033aff330faf0dd40ec11f83bfc20ba7e861bce6c`.
Style Guide pins неизменны: App.tsx `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`,
index.css `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`.

Нужны НОВЫЙ независимый exact-SHA security review и root DRY итогового installer; metadata pin refresh
выполняется отдельно после review. Внешний reviewer должен проверить exact-SHA `DRY=1 bash slots-continuity.sh`
на реальном removed V4 journal и `DRY=1 bash slots-continuity.sh --remove` по применимому состоянию.
Unknown/pending prior V4 требует его reviewed recovery, не V5 migration. При post-install проверке
slot2 должен оставаться inactive/enabled до отдельного явного start от PMA; preflight/реальный systemd
freezer, start, stop timing и disk crash durability здесь не доказаны.
Здесь ни live install, ни claims об успешном VPS commissioning нет.
