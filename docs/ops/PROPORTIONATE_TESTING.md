# GoBadminton CLEAN — proportionate testing P1

**Статус: SOURCE / NOT_INSTALLED.** Подчинённый scoped runbook для offline tooling,
не канон, не новая authority, не machine admission и не установленный enforcement. Полномочия, независимость, FAIL routing и приёмку определяют принятые
[EOM 1.4](../rules/ENGINEERING_OPERATING_MODEL.md) и
[SMART_ROUTING 1.0](../rules/SMART_ROUTING.md), exact pins —
[CONTEXT_SOURCES.json](../rules/CONTEXT_SOURCES.json).

AUTHOR repair round 6 preflight, 26.10.2026: repo `anpavel84-afk/gobadminton-clean`,
branch `ops/proportionate-testing-p1-20261026`, PR #323; exact source/base `cd8082973f4b77af3a999ddaf3947e20c72109ba`; candidate — этот uncommitted diff.
Прямое ограниченное задание Owner, один AUTHOR/writer; PMA takeover отсутствует. Requested route — bounded Codex AUTHOR; effective identity задаёт launcher,
этот документ не удостоверяет model ID или квалификацию роли.
EOM commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256
`8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`;
SMART_ROUTING commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256
`1a8c1ed6f6ea11d08ecb1703df1a3bc1540520f7f4d02b7d48bb1f66a8786c63`.
Оба полных текста доступны AUTHOR и сверены по hash. Scope:
`scripts/chatops/testing/*`, `scripts/chatops/tests/test_actions_train_testing_*.py`,
fixtures `proportionate_testing/*` и этот runbook.
Сохранённые replay cases неизменны. Без commit/push/network/root/model calls/install.
Evidence (exact SHA/PR, QA/CI receipts и ограничения) фиксируется в PR и в docs update PR;
статус SOURCE / NOT_INSTALLED. Авторская проверка не является независимой QA.
## 1. Цель и граница

Одинаковая локальная команда не запускается снова без изменённого fingerprint
или закрытого reason code. Размер diff не является входом классификатора.
Инструменты stdlib-only, Python 3.11+, offline; новый Supervisor, scheduler,
queue, service или модельный наблюдатель не создаётся. Detached run — конечный
дочерний процесс той же команды; `collect` блокируется на `flock`.

Все **7 Product CI jobs** остаются обязательными: `foundation`,
`source (api)`, `source (web)`, `source (admin)`, `source (contracts)`,
`database`, `receiver`. `ci.yml`, `ci.sh`, installed code и byte pins не изменяются.
Независимая QA, DEV acceptance, visual/interaction QA и security checks сохраняются.
PROD untouched; Product Train paused — P1 не даёт команды resume/dispatch.
Авторская самопроверка не independent QA, локальный PASS не CI/DEV ACCEPTED.
Прежний FAIL-маршрут контроллера до установки SMART_ROUTING сохраняется.
## 2. Непонижаемые tiers

| Tier | Минимальный scope / признаки | Проверки |
|---|---|---|
| T0 | Только `docs/**/*.md` вне rules и README / README с `.md`, `.rst`, `.txt`; только regular non-executable files | `foundation`; QA по исходным критериям |
| T1 | Test-only (`*.test.*`, `*.spec.*`, `test_*.py`) либо один известный script/library module | `targeted_py` для Python с явными modules; соответствующий `ci_source_*` для product tests |
| T2 | Остальной `apps/{api,web,admin}/src`, UI/CSS/popups; >1 module либо top-level package; DB/receiver dependent paths | `foundation`, затронутые source/dependency groups; visual QA для web/admin components, popup dirs, CSS/SCSS/SASS/LESS/TSX под src |
| T3 | Любой critical path, deletion, type/symlink либо non-regular/non-100644 mode | Strict groups, полный CI, независимая QA; visual QA сохраняется |

Critical paths, даже для одной строки:

- `.github/workflows/**`, `scripts/chatops/actions_train/**` (соседний
  `scripts/chatops/tests/**` не входит в эту директорию);
- `scripts/chatops/{planning,ops,server,testing}/**`;
- `scripts/chatops/autonomous_issues.py`, `migration-ci.py`, direct `*.sh`;
- `docs/rules/**`, root `AGENTS.md`, `.cursor/**`;
- `apps/api/migrations/**`, `apps/api/src/{auth,restrictions,safety,moderation,game-moderation,database}/**`,
  `apps/api/src/tokens.ts`, `packages/contracts/**`;
- любой basename с `budget|admission|resolver|parser|sandbox|permission|privacy|secret|token|policy|qualification`
  case-insensitive, включая test/doc filenames;
- status `D`/`T`, mode `120000`, любой mode кроме `100644` до/после.
  Отсутствующий old mode `000000` при regular addition допустим; deletion всегда T3.

Неизвестный путь получает T2: лучший предположительный T1 повышается на уровень.
Классификация всего change set не ниже максимума отдельных файлов; empty list — error.
Пути должны быть repo-relative, без `..`, пустых сегментов и backslash.
Rename `R` требует валидного `old_path`: классифицируются оба конца. Без него —
T3 с `RENAME_UNPAIRED:<path>`, даже если new path выглядит как docs. Отдельные
path-only R entries не доказывают пару. Raw-diff verifier сохраняет оба конца
и явный `old_path`, включая перенос из critical directory.
`routine -> T1`, `complex -> T2`, `critical -> T3`; T0 отображается в `routine`
существующего risk field. Higher declaration разрешён с `OVER_DECLARED`, lower —
`UNDER_DECLARED`. Risk override в plan builder может только повысить tier.
## 3. TEST PLAN внутри acceptance

Новых schema fields нет. Existing `acceptance` остаётся строкой <=6000 chars.
Блок <=1200 chars, exact markers, compact JSON; ключи закрыты, группы упорядочены:

```text
<!-- GB_TEST_PLAN_V1 -->
{"evidence_rule":"NOT_TESTED/ENV_ERROR never counts as PASS","groups":["targeted_py"],"needs_independent_qa":true,"rerun_policy":"same fingerprint: no rerun without reason code","risk":"routine","tier":"T1","visual_qa":false}
<!-- /GB_TEST_PLAN_V1 -->
```

`render` детерминирован; `parse(render(plan)) == plan`. `attach` сохраняет исходный
acceptance text и заменяет ровно один существующий **валидный** блок; существующий
span проходит тот же strict `parse`, иначе `PlanError` (например, `BAD_FIELD`),
текст не удаляется. Длина исходного acceptance и результата проверяется <=6000.
Overflow не обрезается:
`ACCEPTANCE_TOO_LONG`. Missing block: `MISSING_TEST_PLAN`; multiple blocks:
`DUPLICATE_BLOCK`; invalid/duplicate keys/groups: `BAD_FIELD`; unknown group:
`UNKNOWN_GROUP`; unknown tier: `BAD_TIER`. Нельзя снять independent QA/evidence rule.

```sh
export PYTHONDONTWRITEBYTECODE=1
python3 -B scripts/chatops/testing/plan_block.py render --paths-file changes.json --risk complex
python3 -B scripts/chatops/testing/plan_block.py check --acceptance-file acceptance.txt
python3 -B scripts/chatops/testing/verify_profile.py --base BASE_SHA --head HEAD_SHA --declared T2 --acceptance-file acceptance.txt --json
```

`changes.json` — список `{path,status,mode?,old_mode?,old_path?}`; для `R` old_path
обязателен, иначе T3. Verifier использует реальный
`git diff --raw -z -M --no-abbrev`, требует block tier == declared и все derived
required groups, сохраняет обязательный `visual_qa`. Без acceptance block — violation.
Exit verifier: 0 ok, 1 violation, 2 usage/input error. Это CI-callable script;
**P1 не подключает его к существующим workflows/stage.py**.

## 4. Каталог и запуск

`scripts/chatops/testing/test_groups.json`, schema `GB_TEST_GROUPS_V1`: unique id,
description, argv list, repo-relative cwd, positive timeout_s, tiers, env_flags
(только имена), kind `local|ci_only`. `tiers` описывает применимость: конкретный
набор по путям выдаёт classifier, это не требование запускать каждый catalog row.
Команды взяты из `ci.yml` / `scripts/chatops/ci.sh`; shell-string argv запрещён.

Local groups: `foundation`, `chatops_receiver_actions_train`, `chatops_phase`,
`chatops_testing_tools`, `targeted_py`. Последний использует тот же unittest,
принимает только `^test_[A-Za-z0-9_]+$` и существующий regular test file из
`scripts/chatops/tests`. Имена передаются явно, без autodiscovery всего suite.
`chatops_testing_tools` — быстрый subset receiver; strict plan уже включает его
через `chatops_receiver_actions_train`, повтор subset не требуется.

`ci_source_{api,web,admin,contracts}`, `ci_database`, `ci_receiver` — CI-only.
Их argv — представитель существующего job, не замена всех его steps. Локально
они не исполняются и возвращают `NOT_TESTED`, exit 2. Foundation — седьмой job;
его local static check тоже не заменяет все CI foundation steps.

```sh
python3 -B scripts/chatops/testing/run_test_group.py run --group targeted_py --tests test_actions_train_testing_profiles test_actions_train_testing_runner test_actions_train_testing_verifier
python3 -B scripts/chatops/testing/run_test_group.py run --group foundation
python3 -B scripts/chatops/testing/run_test_group.py run --group chatops_testing_tools --detach
python3 -B scripts/chatops/testing/run_test_group.py collect --fingerprint FULL_64_HEX_FP
```

`--repo DIR`, `--runs-dir DIR`, `--catalog PATH` выбираются явно при необходимости;
`collect` принимает repo/runs-dir и блокируется до завершения worker, без polling.
Default — `<git-dir>/gb-test-runs/`, git-dir из `git rev-parse --absolute-git-dir`;
linked worktrees используют собственный git-dir. Git metadata не является worktree input.
Любой runs-dir в worktree вне git-dir, включая старый `.gb-test-runs/`, refused:
`RUNS_DIR_IN_WORKTREE`. Overrides допустимы только как непосредственные дочерние
каталоги git-dir; остальные — `RUNS_DIR_NOT_IN_GIT_DIR`. Runs-dir создаётся с 0700.
Pre-existing dir признаётся только по внешнему runner-written marker
`<git-dir>/gb-test-runs.<hash(name)>.owner`, связанному с fstat uid/dev/ino открытого
`O_DIRECTORY|O_NOFOLLOW` fd; иначе `RUNS_DIR_UNRECOGNISED`, без chmod/новых файлов.
Symlink/parents, non-directory, group/other write — `UNSAFE_RUNS_DIR`.
Artifacts — owned single-link regular без group/other write (`UNSAFE_ARTIFACT`).
Malformed receipt/посторонний entry — `RUNS_DIR_CONTAINS_SOURCE`.

Lock/markers/state находятся только под git-dir: общий `gb-test-runs.lock`
сериализует run/collect, включая overrides. Detached worker наследует lock.
Во время команды runs-dir имеет 0000; каждый chmod — fchmod проверенного fd,
marker dev/ino сверяется повторно; finally возвращает исходный mode того же inode.
Недоступный 0000 dir после crash **не chmod-ится по pathname**: `RUNS_DIR_UNAVAILABLE`.
Linux O_PATH открывает такой inode, но не допускает fchmod; автоматического self-heal нет.
До исполнения команды pipe-gate ждёт atomic+fsync записи `gb-test-runs.state`:
child PGID, /proc starttime и boot id. State очищается после reap, завершения группы и restoration.
Best-effort PR_SET_PDEATHSIG=SIGKILL дополняет journal; его отказ не ломает запуск.
Boundary держится всю жизнь записанной child process group, включая runner SIGKILL:
свободный flock не разрешает восстановление; живые члены — `PREVIOUS_EXECUTION_ALIVE`
для нового fingerprint/collect, без chmod/исполнения. Timeout/SIGINT/SIGTERM убивают группу.
Любой pending fingerprint или state killed run — `INCOMPLETE_RUN_REQUIRES_RECONCILIATION`;
неизвестный outcome требует отдельного trusted reconciliation, не автоматического replay.
Dead/reused nonpending identity очищается только после проверки группы; identity недоступна —
`ENV_ERROR: EXECUTION_STATE_UNVERIFIABLE`, exit 2: journal, receipts и mode сохраняются,
без исполнения/chmod/fallback. Это относится также к `collect` и digest через runs-directory.
Только ENOENT при no-follow open exact journal name означает отсутствие (`MISSING`).
Журнал <=4096 bytes: exact object `{pgid,start,boot,pending}`, positive int pgid/start
(bool/string запрещены), nonempty str boot, bool pending; extra/duplicate keys запрещены.
Owner marker отдельно проверяется как exact `{dev,ino,uid}` с nonnegative int fields.

| Execution state code (exit 2) | Сохранение evidence |
|---|---|
| `EXECUTION_STATE_CORRUPT` | Invalid JSON/shape/type/size либо unsafe/unreadable journal: без исполнения, chmod, clear/replace/cache |
| `EXECUTION_STATE_UNVERIFIABLE` | Existing identity/boot недоступны: без исполнения, chmod, clear/cache/fallback |

Отказ во время poll/cleanup/restoration сохраняет journal, pending receipt/log и mode;
поздняя успешная проверка не отменяет UNKNOWN. Повреждённый журнал не удаляется cleanup.
Log fd открыт заранее; directory/lock fds child не наследует.
Явные argv/cwd/module paths внутрь runs-dir — `RUNS_DIR_READ_BY_COMMAND`;
скрытое обычное чтение из кода получает PermissionError. Environment: только PATH,
HOME, TMPDIR, LANG и catalog env_flags; даже разрешённые значения, указывающие
на runs-dir/aliases/children, удаляются. Missing required flag — NOT_TESTED.
Если новая identity/chmod/restore недоступны, FS игнорирует mode bits или runner root:
`CACHE_BOUNDARY_UNAVAILABLE`. Нет boundary => нет cache: command исполняется один раз,
summary показывает результат, receipt не пишется, duplicate refusal отсутствует.
Этот fallback разрешён только после проверки отсутствия outstanding journal/live/unknown
execution и pending receipts; недоступная identity старой группы не доказывает её завершение.
Начальная недоступность boundary делает даже `--detach` blocking; uncached log
обрабатывается через anonymous temporary file, не сохраняется. Потеря boundary
во время execution не создаёт нового receipt и не превращает unknown в PASS.
Python argv используют `-B`; для этой AUTHOR работы также задан
`PYTHONDONTWRITEBYTECODE=1`. Environment — ограничение передачи, не OS sandbox.

Полный stdout/stderr сохраняется в `<fp>.log`, результат — `<fp>.json`, lock —
`<fp>.lock`. Лог дополняется на повторе; history хранит reason/time/status всех
запусков, включая первый. Summary <=30 lines: counts, OK/FAILED, <=10 failing IDs,
число остальных, log path и rerun hint. Полные failing IDs остаются в JSON.
Не выводить настоящие secrets/PII из test commands; использовать synthetic fixtures.

## 5. Fingerprint и повторы

SHA-256 canonical JSON связывает worktree digest, group id, sorted unique tests,
catalog SHA-256, runner version и presence booleans env_flags (значения не пишутся).
Worktree digest: sorted unique `git ls-files -z --cached --others --exclude-standard`,
path + фактический mode + content hash, включая uncommitted/untracked inputs.
In-repo artifact exclusions удалены: receipts расположены вне worktree inputs.
Сохранена provenance validation: receipt `GB_TEST_RUN_V1` имеет закрытые ключи,
current runner version, fingerprint == filename stem и SHA-256 canonical inputs;
status/history/job валидируются. Collect/worker используют тот же schema.
Чужой/malformed JSON, wrong stem, неизвестное имя, подкаталог и legacy `.new`
дают `RUNS_DIR_CONTAINS_SOURCE`. Scan/write сериализованы внешним lock.
Старые receipts не переносить в новый runs-dir. Это структурная проверка, не подпись.
Удалённый tracked path имеет MISSING marker. Source читается через `O_NOFOLLOW`
и regular `fstat`; подмена ссылкой — `UNSAFE_WORKTREE_FILE`. Symlink хешируется
по тексту ссылки с mode 120000, цель не читается. Unsupported types/symlink parents дают error.
Игнорируемые Git файлы не входят; submodules не аттестуются этим runner.
Изменение worktree во время команды даёт ENV_ERROR, не PASS.

Conclusive prior PASS/FAIL с тем же fingerprint: команда не запускается, exit 3,
reason `SAME_FINGERPRINT`, status `SAME_FINGERPRINT previous=PASS|FAIL
(not re-verified; not evidence)` на одной строке. Это отказ, не свежий PASS.
`--repeat-reason` разрешает реальное исполнение согласно таблице:

| Reason code | Условие |
|---|---|
| `input_changed` | Только новый fingerprint; идентичный уже записанному всегда refused |
| `env_fixed` | Подтверждён ремонт environment, новый execution сохраняет прежний outcome |
| `flake_probe` | Явная проверка нестабильности, не стирание FAIL |
| `qa_independent_base` | Обоснованный отдельный запуск QA/base |
| `ci_missing` | Не хватает требуемого CI evidence; local run сам не становится CI PASS |

Unknown code refused. Inconclusive ENV_ERROR/NOT_TESTED/TIMEOUT можно выполнить
заново без reason; старый outcome остаётся в history и сам не превращается в PASS.
Pending receipt без владельца lock — `INCOMPLETE_RUN_REQUIRES_RECONCILIATION`;
автоматического повторного запуска неизвестного результата нет.

Exit runner: PASS 0; FAIL 1; ENV_ERROR/NOT_TESTED 2; refused/usage 3; TIMEOUT 4.
Missing command, import/permission failure — ENV_ERROR, `Ran 0 tests` — NOT_TESTED. Причину import/environment failure нужно исследовать по полному логу; это не source PASS.

### Trusted ручной reset после crash

1. В нужном checkout выполнить `git rev-parse --git-dir` (relative path — от checkout;
   linked worktree имеет свой git-dir). Найти `<git-dir>/gb-test-runs` и только его
   `<git-dir>/gb-test-runs.*` metadata: `.state`, `.lock`, `.<hash(name)>.owner`.
2. Проверить процессы и lock: нет активного runner/worker **и ожидающих lock**;
   свободного flock недостаточно. По `gb-test-runs.state` reconcile группу через
   `pgid`, `/proc` start time и boot id. Она должна быть verifiably gone;
   если это оставшаяся test group — завершить именно её и проверить исчезновение.
   При непроверенной identity/неизвестной liveness reset запрещён.
3. Сначала **сохранить evidence вне удаляемых путей**: скопировать state, любые
   UNKNOWN/pending receipts и logs (для 0000 сначала выполнить шаг 4).
   Reset не является reconciliation evidence или PASS.
4. Для mode 0000 trusted human проверяет, что это recognised runs-dir (owner marker,
   uid/dev/ino), принадлежащий ему, без symlink; затем выполняет `chmod u+rwx`
   **на этом exact directory path** для копирования evidence и последующего удаления.
5. После reconciliation и сохранения удалить только `<git-dir>/gb-test-runs` и
   `<git-dir>/gb-test-runs.*` metadata, не весь git-dir; новый запуск создаст их заново.
   Для explicit runs-dir сначала установить его exact path/marker; не удалять соседние каталоги.
6. Не добавлять automatic self-heal: same-uid/root residuals сохраняются.

## 6. Evidence и независимость

`evidence_status` возвращает PASS только при PASS каждого required group; missing,
NOT_TESTED, ENV_ERROR и TIMEOUT не дают PASS. FAIL сохраняется. Для
`compare_base_head` одинаковые **непустые полные** failing-ID sets при двух FAIL —
`PRE_EXISTING_FAIL`: не PASS и не приписывается изменению. Новые head failures —
FAIL; base FAIL + head PASS — `PASS_WITH_BASE_FAIL_FIXED`. Сравнение применимо
только к согласованным group/tests/environment; helper не доказывает их equivalence.

QA запускает **доверенную base-копию runner и соседних catalog.py/safe_io.py/execution_state.py** с
`--catalog /trusted/base/scripts/chatops/testing/test_groups.json --repo CANDIDATE`.
При explicit catalog candidate catalog не загружается как конфигурация, candidate
runner не импортируется/исполняется. Все candidate files, включая эти копии,
хешируются только как DATA для worktree digest. Candidate не выбирает свою QA.
Cache — только duplicate-run guard, **никогда evidence**. QA/CI не используют cache:
каждый требуемый запуск реален; для QA runner нужен `--repeat-reason qa_independent_base`.
QA использует собственный runs-dir на exact candidate. Residual: процесс того же uid
может chmod каталога обратно, root обходит mode bits. Это не sandbox против враждебного
same-uid кода, не подпись и не admission. Ignore/submodule/external inputs этим cache не аттестуются.
Catalog читается без follow (включая parents), non-regular/symlink — `UNSAFE_CATALOG`.
Artifacts открываются относительно directory fd (`O_NOFOLLOW|O_DIRECTORY` для dir,
`O_NOFOLLOW` + regular `fstat` для files); temp receipt — unique `O_CREAT|O_EXCL`,
rename относительно того же fd. Detached worker наследует lock и directory fd.

## 7. Следующие этапы

**P1b (needs a reviewed root install, NOT part of this change):** enforcement
profile/TEST PLAN в `stage.py`, текст EOM capsules, согласованные reviewed pins,
существующий разрешённый install с backup/rollback. SOURCE scripts и этот документ
не устанавливают gates, не меняют active assignments или runtime authority.

**P2/P3 later:** planner hook через immutable `client.py` pin bump;
`phase_task_plan_v2` **не изменён здесь**. Selective CI — отдельное reviewed решение
с dependency/equivalence proof; все 7 Product CI jobs остаются сейчас.
Публикация, независимая QA, CI и последующий допустимый OPS шаг — отдельные evidence.
