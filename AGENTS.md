# GoBadminton — правила для участников и агентов

## Непересекаемая граница проекта

Этот репозиторий — **GoBadminton**, самостоятельный greenfield-продукт. BadmintonOpen — другой проект. Его пути, CMS, репозитории, серверы, данные и задачи не являются источником реализации. Не открывать и не менять их в рамках GoBadminton. Старые launcher/context-файлы, утверждающие обратное, опровергнуты владельцем: см. OD-001.

## Обязательные project rules

Перед значимой работой прочитать [индекс правил](docs/rules/README.md), прежде всего [Project Record & Handoff Policy](docs/rules/PROJECT_RECORD_POLICY.md).

Ключевой принцип: **Chat is transport, GitHub is durable project record.**

Prompts, рабочие artifacts, handoffs, review/evidence и принятые документы должны иметь durable GitHub representation согласно правилам. Значимый результат не должен оставаться только в чате, временном attachment или sandbox.

## AI delivery target and runtime reality

Before selecting Cursor, Codex, Antigravity or independent QA, read [AI delivery target configuration](docs/operations/AI_DELIVERY_TARGET_CONFIG_V001.md) along with the active exact Issue/authorization. The target configuration is a **review proposal until accepted** and does **not** activate a provider, grant effects, or supersede security gates. Use actual runtime capability/evidence for route selection; report unavailable providers and remediation without weakening sandbox or hiding fallback costs.

## Cursor / implementation runtime

Cursor является частью GoBadminton delivery system.

**Current primary execution host:** Germany VPS `vmi3510488`.

- canonical source: `anpavel84-afk/gobadminton-clean`; task worktrees: `/srv/gobadminton-clean/worktrees`;
- current PM task board: GitHub Projects/Issues; checks and release: GitHub Actions;
- implementation: task-scoped Cursor or Codex CLI on Germany, invoked under authorized PM assignment;
- GitHub source write transport: repository-specific SSH identity via `github-gobadminton-clean`;
- legacy Clean Runner/Autopilot are retired from active task execution; never start a second writer;
- PLAN is a control/viewing workstation, not a model executor;
- `/srv/gobadminton` is live backend/deployment material, not the development checkout.

Repository access does not grant product/runtime authority. The authorized GitHub Issue/assignment limits code changes, GitHub Actions gates DEV release, and PROD remains subject to separate Owner GO.

## Frontend visual authority

Любая работа в `apps/web/**` с визуальной/композиционной частью подчиняется Owner rule **Style Guide first**:
- `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`;
- `docs/operations/FRONTEND_STYLE_GUIDE_FIRST_V001.md`;
- frozen Figma Make `#guide` / `#construction-kit`.

Сначала проверить существующий canonical pattern; новый визуальный паттерн допустим только как документированный `STYLE_GUIDE_GAP` или после явного `OWNER_VISUAL_OVERRIDE`. Старый frontend-код не является presentation authority.

При работе через Cursor обязательно:
1. прочитать [ChatOps route](docs/operations/chatops/README.md); legacy `CURSOR.md` отсутствует в Clean extraction;
2. прочитать [PM / GitHub Projects и Issues](docs/operations/chatops/PM-CHEATSHEET.md); legacy `.cursor/rules/` отсутствует в Clean extraction;
3. пройти [Cursor onboarding](docs/governance/CURSOR_ONBOARDING.md);
4. открыть **exact active assignment**, а не выбирать задачу по памяти/дате;
5. работать только в выделенном GoBadminton Clean worktree на Germany VPS под `/srv/gobadminton-clean/worktrees`; PLAN не исполняет модельные задачи;
6. публиковать результат через GitHub branch/PR + durable handoff.

Cursor/CLI/model не дают authority сами по себе. Scope и effects задаются Owner/PM assignment и canonical project rules.

## Загрузка контекста

Прочитать [решения владельца](docs/manifest/OWNER_DECISIONS.md), [манифест](docs/manifest/PROJECT_MANIFEST.md), [bootstrap](docs/governance/BOOTSTRAP.md), [архитектуру](docs/architecture/OVERVIEW.md), [границы модулей](docs/architecture/MODULE_BOUNDARIES.md) и документы точного текущего среза. Не требуется перечитывать всю историю чатов.

Прямое поручение владельца имеет приоритет в его явной области. Технические решения v1 приняты архитектором в пределах делегирования OD-006. Продуктовые предположения отдельно отмечены, не выдаются за слова владельца.

## Работа

1. Проверить фактический repository, branch, HEAD и незакоммиченные изменения. Не стирать чужую работу, не делать force push.
2. Указать scope, точный базовый commit, ожидаемые файлы, проверки и способ отката. Не запускать второго writer поверх неизвестного активного writer.
3. Не расширять MVP платежами, MAX/Сбер, чатами, клубной ERP, бронированием кортов или мультиспортом из старых концепций.
4. Приложения используют API, но не БД. Авторизация и инварианты мест проверяются сервером, а не UI. Секреты не попадают в shared packages или клиентские bundles.
5. Обновлять документацию и контракт вместе с изменением поведения. Архитектурное изменение оформляется новым ADR с последствиями и совместимостью.
6. Не сообщать PASS без выполненной проверки. Самопроверка автора не является независимым QA. Наличие файла не означает реализацию или deployment.
7. Implementation получает отдельный ограниченный slice; не переходить к следующему автоматически.
8. Перед завершением существенной работы проверить continuity: новый ИИ/новая команда должны уметь продолжить проект по репозиторию, exact permalinks и разрешённым внешним references без обязательного чтения старого чата.

## Полномочия и источники

Репозиторий хранит продуктовые и инженерные документы. Если используется Agent Agency Hub, его Project/Task/Mission/Run/Result состояние не заменяется GitHub-таблицами или чатами. Этот файл не создаёт Employee, membership, runtime binding или Mission и не меняет Agency Core.

Долгие handoff-пакеты, prompts и рабочие deliverables публиковать как versioned GitHub artifacts; в чат возвращать короткий итог и exact permalink. Не использовать владельца как постоянного курьера между агентами.

Нельзя самостоятельно оформлять договоры, совершать платежи, подключать production OAuth, публиковать приложения или разворачивать production под видом подготовки структуры.

## Постоянный продуктовый бэклог · Owner 2026-10-10

Перед передачей любого продуктового замечания в работу PM регистрирует или находит его постоянный `GB-###` в GitHub Issue по [ChatOps / Projects route](docs/operations/chatops/PM-CHEATSHEET.md). Legacy `docs/product/backlog/README.md`, `REGULATION.md` и `ROLES.md` не включены в Clean extraction; исторические GB-номера сохраняются как references в Issue, без импорта старого реестра. Код, независимый QA, публикация и приёмка Owner — отдельные факты. Задачи и старые номера не удаляются. Технические Runner/V3 ID связываются с GB-номером и не заменяют его. Реестр не даёт новых прав на выполнение, деплой или снятие защитных ограничений.
