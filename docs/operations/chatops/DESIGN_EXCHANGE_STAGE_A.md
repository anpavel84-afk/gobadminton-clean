# Design exchange — Stage A checkpoint / OPS runbook

2026-10-25. Scope: **trustworthy inputs only**, Owner t424u «Да этап А».
[Реестр](../../manifest/DESIGN_MATERIALS.json), [M2R spec](../../product/M2R_DESIGN_SPEC.md).
Этот candidate предлагает docs + неактивные stdlib helpers; merge не заявлен.
После reviewed merge они будут в Git. Реальные PNG остаются только на hub;
ROOT OPS import, actual-identity probes и их receipts ещё не выполнены.

## Preflight автора

Repo `anpavel84-afk/gobadminton-clean`; source/base
`bdd912a82a2f0087f4cfc9c6820edc8c49ee6527`, detached HEAD. Candidate — exact diff
поверх этого SHA, commit не создаётся по assignment. Единственный writer —
AUTHOR этой сессии, identity agentagency-dev; PMA Grok не заменён. Прямой
ограниченный AUTHOR TASK Stage A разрешает только перечисленные там docs,
context_exchange.py + его единственную manifest entry, два новых OPS helpers,
focused tests/fixtures. Эффекты — source edits и offline synthetic self-check;
no network/install/sudo/Git writes, deployment или изменение admission.
Requested/effective route: предоставленная Codex AUTHOR session; точный model
ID/effort launcher не предоставил, не угадан. Независимая QA — отдельная сессия.

Rules EOM 1.4: commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, sha256
`8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, 115079 bytes;
SMART_ROUTING 1.0: commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, sha256
`1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`, 76720 bytes.
Локальные hashes проверены. Полный EOM доступен identity; pointer не считается
доказательством доставки будущим ролям. Это не новый admission и не изменение
policy pins. Старый Astra-before-repair маршрут не отменён.

## ROOT OPS после review: точные операции

Команды ниже **не выполнены автором**. OPS выбирает exact reviewed checkout,
сохраняет SHA/diff, проверяет существующие readers/locks и пути. Пример
назначения dest root `/opt/gobadminton-design-inputs` требует существующего
OPS-owned root:root каталога без symlink и записи для других identities;
его создание/доступ на проход — отдельный разрешённый ROOT OPS шаг, не код
импортёра. Полный путь должен быть доступен task launcher. Frozen reference
`/opt/gobadminton-clean-qa/style-guide/manifest.json` только читается, не меняется.

В shell OPS определить TASK_REPO как **фактический** exact reviewed checkout,
DESIGN_DEST как выбранный root, OPS_RECEIPTS как существующий закрытый каталог
receipts. Не подставлять этот author checkout как установленный runtime.

```bash
DESIGN_REGISTRY="$TASK_REPO/docs/manifest/DESIGN_MATERIALS.json"
DESIGN_OPS="$TASK_REPO/scripts/chatops/ops"
DESIGN_SOURCE=/opt/shared-artifact-hub/data/projects/gobadminton/design/map/
python3 -B "$DESIGN_OPS/design_materials.py" validate-registry --registry "$DESIGN_REGISTRY" --repo-root "$TASK_REPO"
python3 -B "$DESIGN_OPS/design_materials.py" closure-digest --registry "$DESIGN_REGISTRY" --closure-id map-mockups-v1
```

(a) Первая команда валидирует strict registry, локальные git-text bytes и
approval refs. До merge это candidate bytes; после merge OPS привязывает exact
commit. Digest считается canonical JSON, не raw pretty-JSON file hash.

(b) Import DRY-RUN (default; reads + hashes всех файлов, пишет **ничего**):

```bash
python3 -B "$DESIGN_OPS/design_materials.py" import --registry "$DESIGN_REGISTRY" --repo-root "$TASK_REPO" --closure-id map-mockups-v1 --source-root "$DESIGN_SOURCE" --dest-root "$DESIGN_DEST" --dry-run
```

(c) Import APPLY — выполнить **как root в разрешённом OPS процессе**, не sudo
из модельного author. SHA256SUMS рядом с PNG unsigned и не authority.

```bash
python3 -B "$DESIGN_OPS/design_materials.py" import --registry "$DESIGN_REGISTRY" --repo-root "$TASK_REPO" --closure-id map-mockups-v1 --source-root "$DESIGN_SOURCE" --dest-root "$DESIGN_DEST" --apply --receipt-out "$OPS_RECEIPTS/design-import.json"
```

Файлы ≤16 MiB, closure ≤64 MiB; no symlink/hardlink/device/FIFO. Три попытки
только transient errno EAGAIN/EIO/ETIMEDOUT/EBUSY, backoff 1s/3s; integrity/path
отказы без retry. Fresh staging 0700 → files/CLOSURE.json 0444 → rehash → dir
0555/root:root → atomic rename. Existing closure reuses только byte-identical
canonical CLOSURE.json и exact file set; mismatch не ремонтируется overwrite.
Receipts O_EXCL, не перезаписывать старые; повтор с неизвестным исходом запрещён.

(d) Read-only verification. DESIGN_CLOSURE_SHA — exact closure_sha256 из
проверенного registry/receipt, DESIGN_CLOSURE_DIR="$DESIGN_DEST/$DESIGN_CLOSURE_SHA".

```bash
python3 -B "$DESIGN_OPS/design_materials.py" verify --registry "$DESIGN_REGISTRY" --repo-root "$TASK_REPO" --closure-id map-mockups-v1 --closure-dir "$DESIGN_CLOSURE_DIR" --receipt-out "$OPS_RECEIPTS/design-verify.json"
```

(e) Access probe. ADAPTER_REVISION и PERMISSION_PROFILE_DIGEST — реальные
launcher revision и SHA-256 actual permission profile, **не придуманные
значения**. Runuser проверяет Unix identity, но сам по себе не доказывает gb-task
namespace/AppArmor/model launcher доступ. Plain AUTHOR Unix probe из OPS:

```bash
runuser -u agentagency-dev -- python3 -B "$DESIGN_OPS/design_access_probe.py" --closure-dir "$DESIGN_CLOSURE_DIR" --role author --adapter-revision "$ADAPTER_REVISION" --permission-profile-digest "$PERMISSION_PROFILE_DIGEST"
```

Ниже **шаблон model-free codex sandbox формы**, to be run by OPS with the actual
launcher flags; flags not guessed. OPS заполняет AUTHOR_SANDBOX_FLAGS точными
subcommand/flags фактического gb-task launcher (включая namespace/profile и
разрешённые read paths), не ослабляя их. Без этих данных шаблон не запускать:

```bash
runuser -u agentagency-dev -- codex sandbox "${AUTHOR_SANDBOX_FLAGS[@]}" -- python3 -B "$DESIGN_OPS/design_access_probe.py" --closure-dir "$DESIGN_CLOSURE_DIR" --role author --adapter-revision "$ADAPTER_REVISION" --permission-profile-digest "$AUTHOR_PROFILE_DIGEST"
```

QA — отдельный реальный QA run profile и его adapter revision. Plain form для
той же Unix identity (если actual QA launcher использует другую — OPS берёт её,
не подменяет role=qa доказательством identity):

```bash
runuser -u agentagency-dev -- python3 -B "$DESIGN_OPS/design_access_probe.py" --closure-dir "$DESIGN_CLOSURE_DIR" --role qa --adapter-revision "$QA_ADAPTER_REVISION" --permission-profile-digest "$QA_PROFILE_DIGEST"
runuser -u agentagency-dev -- codex sandbox "${QA_SANDBOX_FLAGS[@]}" -- python3 -B "$DESIGN_OPS/design_access_probe.py" --closure-dir "$DESIGN_CLOSURE_DIR" --role qa --adapter-revision "$QA_ADAPTER_REVISION" --permission-profile-digest "$QA_PROFILE_DIGEST"
```

QA_SANDBOX_FLAGS — TODO OPS: точные actual QA launcher flags, не guessed.
Для Cursor и AGY fallback — **TODO OPS** каждый собственный actual launcher /
namespace run, role=fallback, его revision/profile digest; wrapper от Codex
не доказывает их доступ. Никаких модельных вызовов в probe. Receipts сохранить
существующим разрешённым OPS evidence каналом; `--receipt-out` допускается
только в разрешённый отдельный output path, никогда внутри closure.

Probe проверяет closure binding, readable exact bytes, O_WRONLY-open denial
без записи и directory W_OK. Запуск как root обязан FAIL по writable, это
negative control, не повод снимать проверку. Не-root PASS вне actual launcher
не означает actual-identity PASS. Также нужны доказательства чтения required
frozen Style Guide manifest и git-text inputs фактическими обеими identities:
map closure probe не выдаёт receipt за недоставленный frozen/source input.

(f) Rollback удаляет только собственные по uid `.staging-<closure>-<random>`
leftovers старше minimum age; dry-run default. Published closure никогда
автоматически не удаляется. Удаление published — отдельное root решение после
доказательства, что нет ссылок/читателей; такой команды здесь нет.

```bash
python3 -B "$DESIGN_OPS/design_materials.py" rollback --dest-root "$DESIGN_DEST" --min-age 3600 --dry-run
python3 -B "$DESIGN_OPS/design_materials.py" rollback --dest-root "$DESIGN_DEST" --min-age 3600 --apply
```

## Stage A exit criteria (§8 architect addendum, как передано в assignment)

- Reviewed docs/closure.
- Exact import receipt.
- Both actual-identity receipts (AUTHOR и QA).
- Negative controls pass.
- Audit resolves actual questions.

Полный текст architect addendum §8 не приложен внутри clone; выше сохранён
переданный набор критериев, дополнительные требования от его имени не выдуманы.
Source self-check не закрывает ROOT OPS/access пункты. Audit здесь означает
проверку фактов/вопросов, не реализацию Task Audit Stage C.

**NOT claimed:** image perception, visual PASS, runtime qualification; также
не full-tree Style Guide PASS. Manifest pin только PMA-verified, aggregate
`owner_tree_pin_only_not_recomputed`; embedded decision 3383 bytes отличается
от repo 3308 bytes до append. Frozen bytes не исправлены.

**Until A passes: no canary author start, no image-checker inference, no global
UI enforcement, no receiver/DEV protocol change.** Non-UI packets без binary
refs сохраняют прежние bytes/digest. Ничто не подключено к admission, Train
controller, workflows или receiver.

## Дальше и открытые решения

Stage B — visual canary/qualification; Stage C — hard enforcement, admission
field, Task Audit machinery, CI/receiver enforcement. Всё это вне Stage A,
не построено и не stubbed.

O1 unresolved: player-popup games A map-only (Architect recommends A;
**default pending Owner answer**) либо B game-page navigation/return.
Ответ в repo не найден; GAMES_VENUES_MAP:28 — venue scope, не этот вопрос.
O2 Stage C unresolved: authentic answer-confirmation channel — recommend A
PMA relay + one Owner GitHub confirmation, B chat-only лишь после authenticated
ingress proof. O3 Stage B/C unresolved: manual vs pending visual acceptance
при отказе image route — recommend explicit manual review when useful.
Все три non-blocking для Stage A, Owner ответ не выдуман.

## AUTHOR offline checkpoint — 2026-10-26

Это самопроверка source candidate, не independent QA / CI job / DEV acceptance.
Фактическая identity — uid/euid 1002 agentagency-dev. Для временных synthetic
fixtures задан TMPDIR внутри разрешённого fixtures/design_exchange; реальные
PNG и frozen VPS bytes не читались.

Выполнено на финальной версии helpers:

```bash
TMPDIR="$PWD/scripts/chatops/tests/fixtures/design_exchange" PYTHONPATH=scripts/chatops/tests python3 -B -m unittest test_actions_train_design_materials test_actions_train_context_exchange
python3 scripts/check_foundation.py
python3 -B scripts/test_check_foundation.py
python3 -B scripts/test_email_contract_policy.py
TMPDIR="$PWD/scripts/chatops/tests/fixtures/design_exchange" python3 -B scripts/chatops/tests/test_ci_workflow.py
python3 -B scripts/chatops/ops/design_materials.py validate-registry --registry docs/manifest/DESIGN_MATERIALS.json --repo-root .
git diff --check
```

Результат: focused **50 tests, OK, skipped=1** (реальный root-only negative
control; non-root PASS и simulated-root FAIL выполнены). Foundation PASS:
291 tracked Markdown / 168 draft API operations; отдельно вызван тот же
markdown_errors для двух новых untracked Markdown, PASS. Foundation tests 8,
email policy 1, CI-workflow tests 3 — OK. Registry CLI PASS; synthetic CLI import
`--dry-run` PASS, destination не создан. Real import/actual-profile probes NOT_RUN.

Golden packet снят read-only из `git show` base context_exchange.py: 496 bytes,
sha256 `c3b42447b94d491e5e07ed9632693254be77659a3bb27d91a5d6d6f483d4600b`.
Без binary refs те же bytes/digest, callback не вызывается. Style Guide append
сохранил исходные 3308 bytes byte-identical. Payload manifest меняет только
context_exchange.py; метод — `hashlib.sha256(Path(path).read_bytes()).hexdigest()`,
как в repository tests / prepare_train_release.py (никакой text normalization).
Git-text materials пересчитаны по финальным working bytes; commit/merge ещё нет.

Ранний broad discover до добавления новых tests: 929 tests, 2 FAIL / 29 ERROR /
1 skip. Оба FAIL (addressed_218 и failure_diagnosis) ожидают старое `Role: ….`
вместо существующего scoped `ROLE …`; оба воспроизведены отдельным read-only
in-memory replay context_exchange.py из base Git object (sha256
`baa4463cc6919e015ceabb1c05f398e095beb8c22a633191125442435586e132`).
ERROR: 17 PermissionError защищённого host path; 6 отсутствующих synthetic
patch.json после отказов; 5 PermissionError legacy hardcoded temporary path;
1 socket EPERM в localhost HTTP fixture. Защищённые данные не получены,
полномочия не расширены; чужие tests/source не исправлялись. Это не OpenAI safety
refusal и не visual FAIL.

Финальный broad command:

```bash
TMPDIR="$PWD/scripts/chatops/tests/fixtures/design_exchange" python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*.py'
```

Результат: **960 tests in 1372.464s; FAILED (failures=2, errors=29,
skipped=2)**. Наборы FAIL/ERROR headers совпали с ранним прогоном; новые Stage A
cases не добавили отказов. Этот broad был начат до последних двух локальных
hardening правок (проверка destination в rollback и явный root refusal probe);
обе покрыты повторным focused 50-test прогоном на финальной версии. Broad PASS
не заявлен. Старые несвязанные source/tests не менялись; scope/hash checks PASS.
Временные stdout-файлы удалены после сохранения counts и причин в этом checkpoint.
