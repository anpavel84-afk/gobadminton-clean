# GoBadminton — Project Record & Handoff Policy v001

Статус: **OWNER_CONFIRMED**  
Дата: 2026-10-02  
Область: весь проект GoBadminton и все его роли.

## 1. Цель

Проект должен быть полностью подхватываемым другим ИИ, человеком или новой командой.

Для этого существенная рабочая память GoBadminton хранится в GitHub, а не только в чатах.

Правило:

> **Chat is transport. GitHub is durable project record.**

История чатов может помогать, но не является обязательным условием продолжения проекта.

## 2. Что обязательно сохраняется в GitHub

Если материал влияет на работу проекта или нужен следующему участнику, он должен иметь durable GitHub representation:

- правила и guides;
- Owner decisions и архитектурные решения;
- project-specific prompts, assignments и launch instructions;
- рабочие draft-документы;
- UX/UI prototypes и design specifications;
- архитектурные и технические specs;
- QA/review findings и evidence indexes;
- handoffs между ролями;
- implementation notes, migration/release notes и recovery instructions;
- важные open questions и принятые ответы;
- ссылки на внешние editable sources, если сам source нельзя разумно хранить в GitHub.

Не оставлять единственную копию значимого результата:
- только в сообщении ChatGPT;
- только как временный downloadable attachment;
- только в локальном sandbox;
- только в памяти конкретного агента.

## 3. Поверхности хранения

### Canonical project documentation

Окончательные или действующие документы живут в соответствующих разделах `docs/`, `packages/`, `apps/` и других канонических путях проекта.

### Working area

Промежуточные, несогласованные, экспериментальные и ещё не принятые документы помещаются в:

`docs/workbench/`

Публикация в workbench **не означает acceptance**.

Каждый такой документ должен явно содержать:

`WORKING DRAFT — NOT APPROVED — NOT CANONICAL`

и по возможности:
- роль/автора;
- дату и версию;
- exact source/base commit;
- назначение;
- что требует review/decision;
- следующий предполагаемый получатель.

### Prompts

Project-specific prompts и задания хранятся или индексируются в:

`docs/prompts/`

Существенный prompt не должен жить только в чате.

Если canonical launcher физически находится в репозитории `anpavel84-afk/agents`, GoBadminton должен хранить durable index/permalink на exact launcher revision и, когда prompt materially defines project work, собственный project record или handoff, достаточный для восстановления задачи.

### Handoffs

Передачи результата между ролями хранятся в:

`docs/handoffs/`

Handoff — это самостоятельный документ, а не фраза «смотри предыдущий чат».

## 4. Standing Owner authorization для рабочего обмена

Любой участник GoBadminton, у которого технически доступна запись в `anpavel84-afk/gobadminton`, имеет постоянное Owner-разрешение публиковать **свои собственные** промежуточные рабочие документы в `docs/workbench/` и собственные handoff/prompt records в соответствующие project surfaces.

Для такого сохранения собственного рабочего артефакта не требуется ждать восстановления Hub только ради файлового обмена, если публикация:

- не меняет application/production code;
- не переписывает canonical truth как будто решение принято;
- не принимает решение от имени Owner;
- не редактирует чужой artifact без необходимости;
- не фабрикует Hub Project/Task/Mission/Result;
- явно сохраняет draft/noncanonical статус.

Hub outage или невозможность проверить binding не должны превращать GitHub-совместимый handoff в временный файл из чата.

Если конкретная профессиональная роль имеет более строгий effect ceiling, он сохраняется: это правило не выдаёт implementation authority роли, которой её не положено иметь.

## 5. Prompt rule

Новый существенный project prompt должен быть воспроизводим.

Минимум:
- role/recipient;
- objective;
- exact canonical sources / base revision;
- scope;
- allowed writes/effects;
- non-goals;
- required outputs;
- acceptance/review criteria;
- return/handoff contract.

Предпочтительный процесс:

`prompt in GitHub → exact permalink → ссылка в чат → выполнение → GitHub result/handoff permalink`.

Не использовать чат как единственный canonical prompt store.

## 6. Handoff rule

Каждый значимый handoff должен позволять следующему участнику начать работу без чтения исходного чата.

Минимальный handoff содержит:

1. From / To / Date / Status.
2. Цель выполненной работы.
3. Exact source/base commit.
4. Что сделано.
5. Что является FACT / OWNER_CONFIRMED / ACCEPTED / PROPOSED / WORKING DRAFT.
6. Exact artifacts и commit permalinks.
7. Проверки/evidence и что **не** проверено.
8. Open decisions / blockers / risks.
9. Что нельзя потерять или переинтерпретировать.
10. Один следующий bounded action и ожидаемый recipient.

Legacy `HANDOFF_TEMPLATE.md` отсутствует в Clean extraction; использовать обязательные поля выше.

## 7. Permalink rule

Для handoff, review, prompt и принятого результата использовать по возможности **exact commit permalink**, а не плавающую ссылку на `main`.

`main` допустим как навигационная точка, но evidence/handoff должен указывать exact revision.

После публикации участник возвращает в чат:
- короткий итог;
- commit SHA;
- GitHub permalink(s);
- статус документа;
- следующий шаг.

Не копировать в чат многостраничный документ, если он уже доступен через GitHub.

## 8. Внешние и бинарные источники

Если editable source разумно живёт вне GitHub (например Figma), GitHub всё равно должен содержать manifest/handoff с:
- точной ссылкой;
- владельцем;
- версией/status;
- назначением;
- связанным GitHub commit;
- правилами доступа;
- при необходимости export/snapshot или checksum.

Нельзя оставлять проект с единственной фразой «макет был где-то в Figma».

## 9. Статусы

Рекомендуемые явные статусы:

- `WORKING_DRAFT`
- `PROPOSED`
- `READY_FOR_REVIEW`
- `OWNER_CONFIRMED`
- `TECH_SELECTED`
- `ACCEPTED`
- `SUPERSEDED`
- `DEFERRED`
- `UNVERIFIED`

Статус должен описывать реальное состояние. Публикация файла сама по себе ничего не принимает.

## 10. Continuity test

Перед завершением крупного этапа задавать вопрос:

> «Сможет ли новый ИИ/новая команда, имея только репозиторий и разрешённые внешние ссылки, понять текущее состояние и продолжить работу без старого чата?»

Если нет — handoff/documentation неполны.

## 11. Hub и GitHub

Когда Agent Agency Hub доступен:

- Hub = operational truth для Project / Initiative / Task / Mission / Run / Result / responsibility state.
- GitHub = durable/versioned project knowledge, artifacts, prompts, specs, handoffs, code и evidence locators.

Не создавать в GitHub параллельный task board.

Если Hub временно недоступен, GitHub artifacts всё равно сохраняются с честным статусом; нельзя выдумывать Hub state.

## 12. Existing chats

Это правило применяется и к уже открытым GoBadminton-чатам.

После получения ссылки на это правило роль:
1. сохраняет текущий контекст;
2. добавляет это правило к своим project operating rules;
3. не требует пересоздания чата;
4. начиная со следующего значимого результата публикует durable artifact/handoff через GitHub;
5. для ранее созданного полезного результата по возможности делает retrospective publication вместо повторного выполнения работы.

## Owner-authorized product obligations register (2026-10-10)

The historical 2026-10-10 Owner assignment authorized `docs/product/backlog/registry.json` as the durable source of truth for **product requirements and Owner acceptance**, with append-only history and stable GB IDs. This is a narrow distinction from operational Hub/Runner task execution state, not a replacement of those systems. Historical `docs/product/backlog/REGULATION.md` and the registry are not included in Clean extraction. For current task navigation use the Owner-approved [ChatOps / GitHub Projects and Issues route](../operations/chatops/PM-CHEATSHEET.md); preserve historical GB IDs as references, without importing the legacy registry. No existing QA/security/privacy/release gate or execution authority is waived.
