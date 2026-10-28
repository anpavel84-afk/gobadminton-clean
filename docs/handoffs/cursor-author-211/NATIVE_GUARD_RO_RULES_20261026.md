# Cursor native guard — read-only canon, 26.10.2026

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.** От AUTHOR следующей независимой
QA-сессии. Source/offline candidate, без commit/PR/install; авторская самопроверка
не является independent QA, CI или runtime admission.

## Preflight

| Поле | Проверенный input / граница |
|---|---|
| Repo / checkout | `anpavel84-afk/gobadminton-clean`, origin HTTPS CLEAN; branch `cursor/native-guard-ro-rules-20261026` |
| Source / base | HEAD `e8b4e4f7bcc1d6a31bf9bee3d2a8db956a98af14`; исходный checkout чистый; candidate — resulting uncommitted diff |
| Канон | EOM 1.4 прочитан полностью; commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, 115079 bytes |
| Routing policy | SMART_ROUTING 1.0 прочитан полностью; commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`, 76720 bytes; SR0, не установлен |
| Assignment / admission | Прямое ограниченное поручение пользователя: source + offline tests only; runtime admission не создаётся |
| Роль / ownership | Единственный AUTHOR этого scope, не PMA; действующее назначение Grok из CURRENT не менялось; других agents/моделей не запускал |
| Requested / effective route | Independent-session AUTHOR / эта author-сессия; provider CLI/model calls = 0; исправленный synthetic Cursor probe = True, старый installed guard = False |
| Allowed effects | Только guard, tiny additive delivery probe, manifest, tests и notes в двух указанных каталогах; synthetic disposable test files в разрешённом evidence root |
| Запреты | Без сети, commit/push и изменений Git metadata checkout, OPS/installer edits, protected state, credentials, READY marker, установки, DEV/PROD |

## Изменение

`cursor_namespace_argv(base, command)` сохраняет сигнатуру, все прежние проверки
и argv. Единственная добавленная строка вызывает `cursor_rules_readonly_mounts`
после последнего rw self-bind work, до `--chdir`. Helper проверяет lstat канона
(regular, euid, nlink=1) и обоих предков (real directories, euid), затем добавляет
два ancestor self-bind и один file ro-bind. Отсутствующий файл даёт пустой fragment.
Всегда включён при наличии канона: Cursor author, редактирующий правила, получит
EROFS; rules bumps — Owner/Codex path, исключения не добавлены.

Probe проверяет упорядоченную цепочку mounts; helper bytecode получает те же
synthetic globals, что и builder, без чтения настоящего private root/helper.
Каждый отрицательный argv проверяется на exact legacy FULL на уровне stage,
`RECIPIENT_RULES_NOT_READONLY` и отказ scoped pre-spawn callback без spawn.
`recipient_popen` и `verify_role_received` не редактировались.

Acceptance fixtures теперь загружают exact старые installed module bytes из
immutable исходного Git commit, сверяя SHA с прежними installer pins. Fixture
#319 аналогично использует exact install-time manifest. Это сохраняет реальные
metadata/hash/state assertions; installer/marker pins не переписываются, repo
manifest отдельно проверяется против новых файлов. Старый marker прямо проверен
на отказ `Cursor installed module drift` с новым guard.

## Инвентаризация старого guard SHA

Первоначальный `git grep` нашёл семь мест; классификация каждого:

| Место | Решение / причина |
|---|---|
| `docs/handoffs/cursor-author-211/READY_REMAINDER.md:9` | KEEP: Owner-supplied installed marker snapshot |
| `docs/ops/CURSOR_READY_RUNTIME_ACCEPT.md:16` | KEEP: installed qualification pin |
| `docs/workbench/context-exchange-20261023/STAGE5_CURSOR_AGY_OFFLINE.md:107` | KEEP: historical frozen/marker-pinned baseline предыдущей Stage 5 проверки |
| `scripts/chatops/actions_train/manifest.json:26` | UPDATED: repo-file pin обязан совпадать с новыми байтами guard |
| `scripts/chatops/ops/agy29_pkg_finish_install.py:56` | KEEP: #319 install-time unchanged-state observation |
| `scripts/chatops/ops/cursor_successor_upgrade.py:37` | KEEP: installed runtime/canary marker pin, до отдельного Owner rebind |
| `scripts/chatops/tests/test_actions_train_context_cursor_scoped.py` (бывшая строка 508) | UPDATED: repo-file проверка следует manifest; старое значение сохранено как `INSTALLED_GUARD_SHA256` с KEEP comment (строка 25), отдельно проверяет старый marker |

Повторный `git grep` содержит шесть старых значений: три docs, два installer,
одна KEEP test constant. Ни одного изменения в `scripts/chatops/ops/**` и `docs/ops/**`.

## Проверки

Рабочие команды используют окружение:

```text
TMPDIR=/home/agentagency-dev/author-evidence-nativeguard-20261026
PYTHONPATH=scripts/chatops/tests:scripts/chatops/actions_train
```

Первый targeted run сохранён без удаления FAIL history:

```text
python3 -B -m unittest -v test_actions_train_native_guard_ro_rules test_actions_train_native_guard test_actions_train_context_cursor_scoped test_actions_train_cursor test_actions_train_cursor_runtime_accept
Ran 241 tests in 27.757s
FAILED (failures=659, errors=135, skipped=2)
```

Причина: fixtures копировали новый guard при старом installed pin, и проверки
завершались ранним `qualified adapter drift`. Исправлены только fixtures на exact
старый Git blob; исходный log `targeted-1.log` сохранён. Результат повторного
прогона той же команды (`targeted-2.log`):

```text
Ran 241 tests in 583.916s
FAILED (errors=1, skipped=2)
R4 seeded fuzz: seed=3070405 cases=23868 accepted_ignored=1521
```

238 cases прошли, два real-bwrap tests skipped. Единственная оставшаяся ошибка
была в `test_ready_qualifies_different_task_through_existing_core_route`: реальная
`N.qualification` читала новый repo guard вместо старого fixture install при
старом installed marker. Исправлено только в этом case: `N.__file__` указывает
на уже созданный fixture install; проверка SHA реальных байтов сохранена.
Адресный повтор исправленного case (`targeted-fixture-fix.log`):

```text
python3 -B -m unittest -v test_actions_train_cursor_runtime_accept.RuntimeAcceptance.test_ready_qualifies_different_task_through_existing_core_route
Ran 1 test in 0.544s
OK
```

После локального изменения одного fixture case повторён только этот case;
полный 241-test run после него не повторялся. Остальные checks, source и fixtures
с момента их успешной проверки не менялись. Таким образом, 239 исполняемых
cases проверены успешно, два kernel cases остаются NOT_TESTED, а не PASS.

Дополнительные pin/release/manifest modules:

```text
python3 -B -m unittest -v test_actions_train_pkg_finish test_actions_train_release_equivalence test_actions_train_release_ci test_actions_train
Ran 144 tests in 28.622s
FAILED (errors=1)
```

143 проверки прошли. Единственная ошибка —
`test_actions_train_release_equivalence.DispatchIsolation.test_real_HTTP_refusal_then_other_slot_accepted`:
`PermissionError: [Errno 1] Operation not permitted` при
`http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)` → `socket.socket`.
Это запрет sandbox на socket, не assertion failure; test не ослаблялся, отказ
не превращён в PASS/skip и не повторялся. Полный log `pins-release-1.log` сохранён.

Manifest **35/35** SHA совпадают, изменены только два payload entries.
Проверены bytes против `git show HEAD:<real path>`:

```text
native_cursor.py       02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089 UNCHANGED
native_antigravity.py  01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72 UNCHANGED
receiver.py            6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e UNCHANGED
native_guard.py        334d4c78c57ba9a7f3f5c49e6737ec8e658033e4b4fdc84f92ce168ece9019f9
context_cursor_delivery.py 6352f6bd6175f447bc124a28d6a1dc67837da6514f1ede3a81c128b4623bff11
```

Реальный receiver найден в `scripts/chatops/actions_train/receiver.py`, а не в
`scripts/chatops/ops`. Tests/docs не добавлялись в install manifest payload.

Дополнительно AST-сравнение с HEAD подтвердило: `cursor_namespace_argv` — exact
прежняя функция плюс одна требуемая строка вызова mounts; AST `recipient_popen`
и `verify_role_received` не менялись. `git diff --check` без ошибок.
`git status --porcelain`: только девять разрешённых файлов (семь tracked edits,
два новых untracked notes/tests; `git add` не выполнялся). Проверка diff scope
не обнаружила OPS, installer docs или других вне-scope изменений.

## NOT_TESTED / следующий шаг

Generic real-bwrap test честно skipped: `NOT_TESTED: bwrap namespaces/mounts
unavailable: bwrap: No permissions to create new namespace, likely because the
kernel does not allow non-privileged user namespaces. See <https://deb.li/bubblewrap>
or <file:///usr/share/doc/bubblewrap/README.Debian.gz>.`
VPS test честно skipped: `NOT_TESTED: pinned VPS gb-bwrap/node not installed`.
VPS kernel evidence из задания — design input Owner, не новый результат автора.

NOT_TESTED: local HTTP transport (socket denial выше), independent QA exact diff,
CI/full discover, pinned-VPS kernel checks, model/provider invocation, role canary,
installation/READY marker rebind, DEV/PROD. Полный discover не запускался по
заданию; новый candidate commit отсутствует по запрету commit/push.
Разрешённый следующий шаг: независимая QA resulting diff и указанные kernel tests
на VPS, затем CI; установка и marker rebind — отдельное Owner действие.
