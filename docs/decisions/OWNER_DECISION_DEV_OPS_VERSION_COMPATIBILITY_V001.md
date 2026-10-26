# OD-013 · Плановые различия версий в DEV/OPS

**OWNER DIRECT · 26.10.2026 · GoBadminton CLEAN.**
**Область:** вся вертикаль разработки и проверенных DEV/OPS-операций: ChatGPT/Grok PMA, Technical PM, author/repair (Cursor, Codex, Antigravity), независимая QA, failure diagnosis, GitHub Actions/bridge, release/root OPS-интегратор, handoff и вспомогательные агенты. Это конкретное последующее решение Owner по §1 EOM 1.4; оно не создаёт второй полный канон, не расширяет machine admission, бюджет, PROD и права моделей.

**Правило:** GitHub `dev`, reviewed source, release bundle и установленная VPS могут закономерно иметь разные версии. Это штатный **переход OLD → NEW**, а не ошибка само по себе. Нельзя заставлять намеренно обновляемый модуль иметь OLD==NEW. Нельзя и глобально игнорировать SHA, security, controller/workflow или UNKNOWN: нужна проверка того, *какое* расхождение возникло.

## Обязательный read-only preflight

**До дорогого цикла автор → QA → CI → OPS install** установить:
- `installed_before`: действительные байты/SHA, owner/mode, controller, policy, workflow, manifest, применимые protected receipts, процессы, locks/leases/slot checkpoints;
- `desired_after`: точные утверждённые source commit, релевантные target bytes и новый release bundle;
- `unchanged_dependencies`: замкнутый набор frozen library/rules/adapter dependencies с hash/provenance;
- `allowed_transition`: утверждённые пути и эффекты, полные OLD→NEW pins для обновляемых файлов, QA/CI/release evidence и rollback;
- `fact_proof`: ссылки на read-only receipts, а не предположение по имени ветки, старому handoff или одному exit code.

Это облегчённый анализ существующими средствами, не новый сервис, scheduler или многодневная квалификация. Проводить только в пределах действующих прав. На границе записи **повторно подтвердить** живые preconditions, lock, leases, planned change, exact state и backup.

## Единая классификация несовпадений

| Класс | Как действовать |
| --- | --- |
| `CONTENT_EQUIVALENT` | Commit/ref иной, но проверенный исполняемый/dependency closure byte-identical. Переиспользовать только относящиеся к этим байтам точные QA/CI доказательства, не перезаписывая исторические receipt SHA. |
| `PLANNED_UPGRADE` | OLD совпадает с installed, NEW с reviewed target; оба хеша точны и scope разрешён. Различие **ожидаемо**: выполнять guarded OLD→NEW. |
| `UNRELATED_DRIFT` | Изменились docs/tests/иной код **вне доказанной relevant closure**. Не блокировать runtime release из-за одного Git SHA; не повторять независимую QA прежних байтов. |
| `DEPENDENCY_UPDATE` | Изменились связанные native_guard/adapter/manifest/controller/workflow/rules. Подготовить согласованный source/ref-only/bundle pin набор и его адресную QA/CI **до** установки. Не дополнять scope молча. |
| `UNSAFE_DRIFT` | Неподтверждённая provenance, новые исполняемые/privileged байты, auth/policy/owner/mode, правила безопасности или несовместимость без утверждённого перехода. Fail-closed с точным диагнозом. |
| `ACTIVE_OR_UNKNOWN` | Незавершённый writer, занятые locks/leases, неизвестные эффекты или protected UNKNOWN. HOLD/reconcile; никакого сброса, replay, скрытого изменения бюджетов. |

Эквивалентность НЕ определяется только размером diff, названием версии, успешным тестом, совпадением отдельных полей или зелёным CI другого SHA. Для зависимых security-компонентов нужно byte/contract-aware доказательство.

## Применение по ролям

- **PMA ChatGPT/Grok и takeover:** читать OD-013 из durable GitHub, сверять реальное состояние VPS и целевого bundle до задания новым авторам; сохранять `installed_before/desired_after/classification/proofs` в handoff; не создавать скрипт/PR/повторную QA ради нерелевантного SHA.
- **Planner/Technical PM:** перед постановкой передавать OLD/NEW, frozen closure, контроллер/workflow readiness; несовместимость, выявляемую по Git и VPS, нельзя оставлять до root dry-run.
- **Author/repair:** менять только допустимый source, указывать planned OLD→NEW и relevant dependencies; не исправлять чужие pins вручную ради PASS, не выдавать candidate за установленный runtime.
- **Independent QA:** оценивать именно изменённые байты и риск перехода, отличать stale fixture от ошибки runtime; не переносить PASS на новую security dependency без доказательства, не FAIL по одному непохожему commit, если scope byte-identical.
- **Failure diagnosis:** различать `stale_fixture`, `source_version`, `installed_version`, `dependency_change`, `unsafe_drift`, environment и platform denial; выдавать минимальный repair brief.
- **Trusted GitHub Actions/bridge/OPS integrator:** автоматически, где это уже поддерживается, сравнивать installed before с reviewed after и dependency pins, сверять exact package provenance; при новой/несовместимой зависимости выполнять только reviewed release/ref-only transition, с backup/rollback.
- **Вспомогательные агенты:** не выводить installed SHA из moving `dev`; передавать доказательные источники/дату.

## Примеры и минимальная приёмка

1. Новый `dev` после чужого docs merge, но тот же runtime closure → `CONTENT_EQUIVALENT` / `UNRELATED_DRIFT`, не новая модельная QA.
2. Проверенный модуль заменяет installed OLD на approved NEW → `PLANNED_UPGRADE`; OLD и NEW не обязаны равняться.
3. Утверждённый новый `native_guard.py` отсутствует в frozen зависимостях старого Stage 5 installer → `DEPENDENCY_UPDATE`, согласовать release/bundle/refs; **не обойти существующий guard и не подставлять другой checkout**.
4. Контроллер и workflow остаются прежними по корректному контракту: не создавать фиктивное новое поколение только ради installation; если существующий installer строго требует другого ref — сначала reviewed update контракта, а не silent bypass.
5. Неизвестная security/version/mode зависимость или live writer/UNKNOWN → отказ без protected write.
6. Смена PMA ChatGPT ↔ Grok не теряет точных версий, текущих операций и обязательного правила.

Сохранять семь обязательных Product CI jobs, независимую QA по риску, exact receipt, rollback и соответствующий DEV smoke. Любая запись `version_contract` — human-readable projection в уже существующем issue/evidence, **не новая wire schema** и не подмена controller policy.

## Ввод во всей вертикали

**Шаг 1, документационный:** зафиксировать Owner OD-013 в Owner Decisions и указателях AGENTS, START_HERE, Cursor/Copilot/Claude/Gemini, technical PM/QA/OPS runbooks и handoff; независимый review, применимые CI, безопасный merge dev и синхронизация main. Статус `DOCUMENT_PUBLISHED`, без изменений EOM SHA или live VPS.

**Шаг 2, trusted-context:** поскольку принятый EOM 1.4 имеет byte-pinned `GB_CONTEXT_V1:common` и role capsules, ссылок из AGENTS недостаточно. Ввести ту же семантику в full/common+role capsules штатным reviewed EOM §10.9/11 переходом с exact document commit/hash/size, `CONTEXT_SOURCES`, кодовыми pins/fixtures, без обхода действующих verifier. Проверить реальную доставку во все применимые новые роли. Ранее pinned активные задания и UNKNOWN не переписывать.

**Шаг 3, исполняемый OPS preflight:** реализовать/переиспользовать version-contract checks в существующем release generator/bridge (не новая архитектура), получить независимую QA, CI и guarded DEV/OPS install, доказать соответствующие сценарии выше. `CONTEXT_DELIVERED` и `RUNTIME_VERIFIED` — отдельные receipts; Markdown не доказывает установку.

**Не меняются:** цель/очередь Master Plan, OD-012 bounds, прошлые grants/attempts/budgets/UNKNOWN, безопасность, другие проекты/VPN, PROD. Отказ инструмента или платформы нельзя обойти переименованием команды либо сменой identity.
