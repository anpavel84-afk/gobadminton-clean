# Architecture Foundation v1 — handoff

Дата: 2026-10-01. Автор: ARCHITECT · GoBadminton. Получатели: Owner, PM, Product/UX, Design, Implementation, QA.

## Состав

Самостоятельный product manifest, Owner decisions/supersession, выбранный стек, контейнерная/модульная архитектура, домен/state machines/permissions, data/retention model, критический OpenAPI draft, web/iOS/Android/admin boundaries, OAuth/provider adapters, geo/media/notifications, future payment boundary, security, environments/recovery/SLO, QA и bounded implementation sequence. App/package directories содержат ownership README, а не фиктивное приложение.

## Разрешённый эффект этого пакета

DOCS/CONTRACT/REPOSITORY FOUNDATION по прямому поручению Owner. Технические решения v1 приняты в делегированной области OD-006. Продуктовые defaults обозначены отдельно. Никакого изменения Agency Core, создания Hub Project/Employee/Mission, внешней рассылки, регистрации OAuth apps, покупки услуг или deployment этим пакетом не сделано.

## Проверенная публикация

Базовый архитектурный пакет опубликован в main: [commit a48330e9445d2e2757d5065b4b13f4d872b73a9e](https://github.com/anpavel84-afk/gobadminton/commit/a48330e9445d2e2757d5065b4b13f4d872b73a9e).

[GitHub Actions run 36890770550](https://github.com/anpavel84-afk/gobadminton/actions/runs/36890770550) завершился **success** 2026-10-01. Прочитаны status, steps и log job `110465526332`; runner выполнил `python3 scripts/check_foundation.py` на указанном exact commit. Результат: `FOUNDATION STATIC CHECK: PASS (61 Markdown files, 13 draft API operations)`.

Проверено: required files, локальные Markdown file paths, корректный JSON, локальные `$ref`, уникальные operation IDs, path parameters, ссылки security schemes и обязательные декларации idempotency/CSRF для имеющихся команд. Это автоматическая статическая самопроверка автора, **не независимый QA**. Последующие commits получают собственный run; этот исторический PASS не переносится на изменённые байты автоматически.

Это не полная OpenAPI semantic/schema validation, не SDK generation, не TypeScript build, не runtime/integration/e2e, не load test, не security audit и не store approval. До первого runnable slice эти проверки **NOT_RUN**. Пакет — архитектурный baseline, не доказательство готовности приложения.

## Что ещё требует детализации

OpenAPI покрывает критический Game/Participation transport. Полные auth callback/exchange/link/deletion, organizer onboarding, venues/admin/outcomes/share-management и notifications contracts добавляются и проверяются в соответствующих slices **до** реализации endpoint. Business semantics/границы для них уже описаны, но нельзя объявлять coverage 100% API.

Точные версии toolchain, Expo SDK/React Native и lockfile фиксируются после clean compatibility build F-01. Нет подтверждённого domain/runtime, provider credentials или store accounts. [Open decisions](../manifest/OPEN_DECISIONS.md) блокируют только зависимые этапы.

## Следующий ограниченный шаг

Implementation подготавливает F-01 по [slice plan](IMPLEMENTATION_SLICES.md), с exact base и без расширения продукта. Product/UX одновременно уточняет реальные форматы/уровни/пилотные flows, а Design создаёт самостоятельную визуальную систему GoBadminton. Дальнейшая автоматическая execution очередь этой публикацией не запускается.

## Откат

Foundation — versioned text/contracts. При необходимости отдельный revert commit, не переписывание истории. Runtime/data rollback не требуется: они не создавались. Старые bootstrap-файлы в `agents` не редактировались этим пакетом; обязательное проектное supersession находится в [BOOTSTRAP](../governance/BOOTSTRAP.md).
