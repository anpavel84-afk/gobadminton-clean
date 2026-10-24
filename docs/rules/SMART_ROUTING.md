# GoBadminton CLEAN — SMART ROUTING 1.0

**Дата:** 24.10.2026. **Статус:** DESIGN PROPOSAL / FOR ACCEPTANCE — проект специализированной спецификации, не установленная политика и не machine admission.

**Поручение Owner:** сохранить Grok единственным управляющим PMA, передать содержательный технический анализ и подбор моделей техническому PM на VPS; выбирать маршрут исправления по реальной ошибке, а не посылать каждый FAIL на Astra. Не создавать новую очередь, второго PMA или постоянный модельный Supervisor.

**Постоянный предполагаемый путь:** `docs/rules/SMART_ROUTING.md`. **Проверенный source baseline:** `9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e`. **Действующий канон:** EOM 1.3, immutable commit `1169e965976e9498d4e5e1e23aae201e97ec9665`, SHA-256 `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`.

> Пока этот проект не принят совместно с согласованной поправкой EOM, действует прежний канон и существующие immutable assignments. Этот документ НЕ разрешает самовольно пропускать обязательную Astra, изменять budgets, запускать модель или менять runtime. Его можно использовать для обсуждения, оценки и подготовки реализации. Статусы DOCUMENT_PUBLISHED, POLICY_ACCEPTED, IMPLEMENTED, ROLE_QUALIFIED и RUNTIME_VERIFIED различны.

## 1. Решение в одном абзаце

**Grok управляет целью, приоритетом и результатом. Технический PM на VPS анализирует код и выбирает достаточные маршруты отдельных стадий. Существующий детерминированный контроллер проверяет полномочия и запускает работу. Cursor/Codex пишет; отдельная QA проверяет; Astra решает экспертную неопределённость.** Для уже известного безопасного исправления используется готовый разрешённый маршрут без нового planner-вызова. Дорогая модель не назначается из-за слова FAIL, числа попытки или отсутствия дешёвой квоты.

Цель — уменьшить суммарные модельные затраты, повторные ошибки и время до принятого результата, не просто выбирать самый дешёвый отдельный вызов. Дополнительный planner оправдан, только когда он сокращает ошибочные назначения/ремонты или нужен для управления риском.

## 2. Что подтверждено в нынешней системе, а что предлагается

Чтение source baseline подтвердило следующее; это не аудит установленной версии на VPS.

| Факт исходников/канона | Следствие для изменения |
|---|---|
| EOM §3 уже выделяет Technical PM/planner, отдельно от PMA | Использовать существующую роль; не назначать второго управляющего |
| EOM §4.2/§5/§8.1 требует Astra High перед любым содержательным FAIL-ремонтом | Fast Fix требует явной согласованной поправки, а не интерпретации слова «простой» |
| `cost_policy.py` содержит общую MATRIX сложности и поправки для Cursor/AGY | Один уровень сложности способен назначить Astra и автору; нужна явная связь role × work class × risk |
| `core.route()` ограничивает выбор уже допущенными маршрутами и проверяет доступность | Сохранить этот механизм проверки; модель не выдаёт себе новые права |
| `core.diagnosis_route()` и `failure_diagnosis.py` жёстко задают `codex:gpt-6-astra:high` | Не переименовывать любой brief в существующий Astra receipt; новые пути должны иметь честное происхождение |
| `failure_diagnosis.validate_brief()` проверяет строгую схему, evidence и allowed paths | Сохранить проверки и совместимость; свободный ответ тех-PM не становится допуском |
| В EOM уже есть 3 авторские попытки → до 2 continuation → техническая переоценка | Не вводить новое Owner-согласование для каждого номера и не обнулять историю |

Фразы «код пишет только Cursor», «любой QA FAIL означает Sol High» и «Astra никогда ни в какой роли не участвует в реализации» неточны как пересказ EOM 1.3. Канон допускает Codex-резерв и экспертные роли; в новой схеме ниже предлагается более чёткая граница: **Astra — read-only эксперт, не обычный автор и не принимающий собственный диагноз QA**. Это предлагаемое уточнение, не утверждение, что старый registry уже так работает.

## 3. Компоненты и границы полномочий

```text
Owner
  ↓ цель / приоритет / разрешённый scope
Grok — один управляющий PMA
  ↓ нормализованная задача и ссылки, НЕ произвольное назначение модели
Существующий controller: preflight / готовый шаблон / capability / locks
  ├─ проверенный простой шаблон → готовый маршрут, без LLM planner
  └─ новый технический предмет → Technical PM на Germany VPS, read-only
                                  ↓ структурированный план и маршруты
Детерминированная проверка плана и существующий admission
  ↓
Cursor/Codex author → CI → отдельная QA → integrate/DEV gates
                         ↓ FAIL
     классификация по evidence → direct repair / Technical PM / Astra / OPS
```

### 3.1. Grok: управление, но не техническая догадка

Grok сохраняет исходные требования Owner, приоритеты и принадлежность к Master Plan, связывает задания с GitHub и инициирует разрешённый этап. Он может отклонить план из-за расширения scope, неверного приоритета или нового расхода. Он **не понижает** предложенный техническим PM уровень по собственной субъективной оценке и не подменяет его выбор «Astra на всё».

Если задача очевидно соответствует уже принятому шаблону, Grok передаёт template ID; его применимость проверяет код. Если возникают новые продуктовые требования, права, деньги либо PROD, Grok эскалирует только этот вопрос Owner. Ожидание CI и завершение обычного ремонта не требуют нового сообщения Owner.

### 3.2. Технический PM на VPS: отдельная ограниченная роль

Это конечная read-only модельная стадия в существующем защищённом executor на Germany, а не постоянно запущенный сервис. Она читает exact задачу, исходники, contracts, prior findings и capability snapshot; оценивает автора и QA отдельно; выдаёт план, условия дальнейших переходов и минимальную достаточную модель.

Технический PM не редактирует source, Git, настройки controller, admissions, бюджеты, secrets, активные leases или критерии приёмки. Не выбирает продуктовую задачу из backlog сам, не делает publish/deploy и не выдаёт себе новый вызов. Его результат — проверяемое предложение внутри standing delegation; исполнение оформляет существующий доверенный контур.

**Предлагаемый default:** Codex Sol High для нового нетривиального planning/triage. Должна быть подтверждена именно пригодность read-only planner-роли и соответствующего sandbox, а не только наличие модели в CLI. Недоступный Sol High не заменяется слабым Grok-анализом. Для принятого простого шаблона planner не вызывается вовсе. Sol Medium допустим для заранее квалифицированного ограниченного уточнения шаблона, но не как молчаливое понижение сложного анализа. Astra — только для доказанного экспертного вопроса.

### 3.3. Controller: проверка и исполнение

Controller не «рассуждает как человек»: он проверяет схему, evidence bindings, scope, актуальность версии, конечный бюджет, capability, независимость ролей и отсутствие дубля. Нельзя считать LLM-план исполнимой командой, запускать сгенерированный shell или принимать новый model ID из текста модели.

Политика выбирает класс маршрута; установленный registry сопоставляет ему разрешённый provider/model/effort. Только действительный admission разрешает вызов. Один mutating PMA и один writer на пересекающийся scope сохраняются.

## 4. Экономный порядок принятия решения

### 4.1. Уровень 0 — без модельного анализа

Обычный код проверяет snapshot, схему, права, действующий rules/policy revision, состояние операции, доступные маршруты, budgets и признаки критического риска. Он также узнаёт конечный набор **принятых и протестированных** шаблонов.

Примеры кандидатов в шаблоны: formatter-only diff; точная правка документационного пути; уже установленный неправильный импорт с однозначной заменой. Одного кода TypeScript/ESLint или слова «опечатка» недостаточно. Если шаблон не доказывает применимость, используется технический PM, а не догадка.

Детерминированная операция вроде штатного formatter может обойтись без author LLM, только если доверенный bridge уже допускает такой эффект. Это не даёт QA-модели право редактировать candidate.

### 4.2. Уровень 1 — один содержательный planning-проход

Technical PM вызывается один раз для нового существенного входа. За один проход определяет план и маршруты автора/QA, а при наличии FAIL — причину, достаточный repair brief и новый маршрут. Не нужно отдельно оплачивать «определить сложность», затем «выбрать модель», затем «составить тот же план».

Результат переиспользуется при неизменных входах. Ожидание CI, повтор webhook и сообщение «продолжай» не повод пересобирать план моделью.

### 4.3. Уровень 2 — экспертная задача

При подтверждённом critical risk или сложной неизвестной причине задача направляется сразу в отдельный read-only Astra High assessment/diagnosis. Не требуется обязательная предварительная платная Sol-сессия только для повторения «это критично». Экспертный brief должен содержать и техническую рекомендацию маршрутов, чтобы не оплачивать затем ещё одного planner для пересказа.

## 5. Что именно оценивается

**Сложность написания, сложность проверки, риск, неопределённость и доступность — разные оси.** Их нельзя складывать в среднее, в котором несколько лёгких признаков компенсируют риск утечки данных.

| Ось | Значения | На что влияет |
|---|---|---|
| Author complexity | mechanical / standard / complex | Способность автора, размер понятного задания |
| QA complexity | standard / complex / specialist | Глубина и способность независимого проверяющего |
| Risk | low / moderate / critical | Непонижаемые проверки, экспертное участие |
| Cause certainty | proven / supported / unresolved / missing_evidence | Нужна ли диагностика вообще |
| Change surface | локальная / компонент / несколько связанных компонентов | Контекст, зависимости, критерии переоценки |
| Evidence completeness | complete / incomplete | Допустимость вывода и следующего эффекта |
| Role capability | qualified / degraded / unavailable / unverified | Какие маршруты допустимы сейчас |

Пример: исправление одного оператора в проверке прав может иметь author complexity=mechanical, но risk=critical и QA complexity=specialist. Цена и число строк не позволяют отправить его в Fast Fix.

Critical risk — изменение прав/identity, доступа к secrets/PII, границ sandbox, допуска/бюджета/QA reuse, конкурентных операций, денег, миграций с потенциальной потерей данных, rollback или необратимых эффектов. Проверять также зависимости и назначение кода, не только имя файла. Чистая правка комментария в чувствительном файле не автоматически critical, но её отсутствие исполняемых эффектов должно быть доказано. Неизвестность эффекта исключает Fast Fix.

Уверенность — категория с evidence, а не придуманная вероятность «0.97». Для proven нужны конкретная причина, воспроизведение/однозначное статическое доказательство и способ отличить правильное исправление от сокрытия ошибки.

## 6. Целевая матрица по РОЛЯМ

Это предлагаемая специализированная матрица. До согласованного принятия не заменяет действующую §5 EOM. Exact IDs и доступность берутся из registry; перечисленные семейства не являются разрешением нового провайдера.

| Роль / предмет | Предпочтение | Допустимый резерв / граница |
|---|---|---|
| Grok PMA | Текущая модель интерфейса | Не используется вместо Technical PM для сложной технической оценки |
| Новый Technical PM / обычная неизвестная причина | Codex Sol High, read-only | Принятый template bypass; не автоматический Astra |
| Author: обычный продукт / стандартный repair | Cursor Auto | Codex Sol Medium, если роль и конкретный scope квалифицированы |
| Author: доказанная механическая правка | Cursor Auto либо уже принятый детерминированный tool | Квалифицированный Codex Luna Medium; затем Sol Medium. Не включать Luna ради одной правки |
| Author: сложная реализация, state machine, сложный repair | Квалифицированный Cursor маршрут | Codex Sol High. Непрозрачный Auto допустим только по role/task qualification |
| Author: адресный OPS repair без квалифицированного Cursor OPS-пути | Codex Sol High | Существующий допущенный OPS author; не новый обходной launcher |
| QA: обычная задача | Квалифицированный Antigravity | Codex Sol Medium в отдельной свежей read-only сессии |
| QA: сложная задача | Квалифицированный сложный AGY-маршрут | Codex Sol High в подтверждённой для этого риска QA-роли |
| QA: критическая граница | Специально квалифицированный AGY или соответствующий specialist-review путь | Sol High только при отдельном достаточном proof для этой границы, не по одному наличию route; иначе локальный hold |
| Эксперт архитектуры/security/трудного FAIL | Astra High, read-only | Только явно разрешённый эквивалент; не скрытое понижение |
| CI, сборка, ожидание, publication, smoke | Существующие инструменты / Actions | Не модельные «наблюдатели» и не лишний planner |

В этом проекте Astra по умолчанию **не автор**, не routine QA, не диспетчер и не планировщик любой мелочи. Она может входить в экспертный read-only review сложной границы, но не заменяет принимающий независимый QA после собственного диагноза. Особое изменение этой роли — отдельное обоснованное решение, не автоматический fallback.

Новый FAIL не означает обязательной смены бренда модели. Можно оставить Cursor при доказанной локальной причине; повысить effort/класс автора при сложности; обратиться к Astra при экспертной неопределённости. Смена модели ради самого факта FAIL — не интеллектуальная маршрутизация.

## 7. Route Plan: одно техническое решение с условиями продолжения

Для новой нетривиальной задачи Technical PM возвращает компактный машинно проверяемый план:

- task/lineage/admission references, task hash, exact source/base, policy/rules revision;
- цель, исходные acceptance criteria и non-goals без переписывания требования;
- observed paths/dependencies, allowed effects, риск и evidence по каждой оси;
- независимые author и QA profile, явно допустимые fallback и основания;
- требуемые deterministic checks, доказательства готовности source/context и остановки;
- условия direct repair, Technical PM re-triage, expert escalation и OPS/reconciliation;
- число доступных в текущем пакете author/QA/diagnosis/planning вызовов, ссылка на authoritative ledger;
- ограничения и missing inputs; формат результата, lineage и условия invalidation.

Не хранить в плане доступные модели «по памяти». Registry snapshot должен иметь provenance и актуальность. Exact model ID, инструменты и sandbox-профиль проверяются перед запуском повторно; отсутствие usable route не меняет требования задачи.

Пример представления для PMA: `author=Cursor Auto → Sol Medium; QA=AGY standard → Sol Medium; risk=moderate; diagnosis=conditional; first plan=Sol High; reason=existing CRUD pattern`. Это summary, не исполнимый wire JSON.

Схема нового результата — prospective: нельзя вставлять неизвестные поля в существующий closed admission. Совместимый формат и handler проходят отдельную реализацию/QA в имеющемся контуре. В существующем протоколе можно переиспользовать нужные поля `routing_policy`, `author_routes`, `qa_routes` только в их реально поддерживаемой семантике.

## 8. Обработка QA/CI FAIL: решается тип проблемы

Все ошибки сначала связываются с exact candidate, check/review identity, версиями правил и исходными критериями. Отдельный QA возвращает verdict и findings; suggested class допустим как рекомендация, но не как власть снизить risk floor.

| Класс события | Следующий шаг | Нужна Astra? |
|---|---|---|
| `PENDING` / ожидаемый CI | Ожидание события существующим controller | Нет |
| `CONFIG_PRECALL` — неверный путь/ID/схема до inference | Исправить проверенную конфигурацию в допущенном OPS scope; повторить немодельный preflight | Не автоматически |
| `TRANSIENT_INFRA` — подтверждённая временная сеть/сервис, без UNKNOWN-эффектов | Ограниченный retry/backoff либо разрешённый equivalent fallback | Нет, пока не выявлен source-дефект |
| `PLATFORM_REFUSAL` | Зафиксировать точную операцию и отказ, остановить затронутое действие; продолжать независимое | Нельзя выбирать другую модель/канал для повторения запретного действия |
| `UNKNOWN_EFFECT` | Reconcile процесса/remote effects через существующий механизм | Не новый author и не blind fallback |
| `INPUT_MISSING` | Адресно получить недостающий source/evidence или full-context fallback | Не гадать с более дорогой моделью без входных данных |
| `SOURCE_KNOWN_LOCAL` | Fast Fix по §9 → author → checks → QA | Нет |
| `SOURCE_KNOWN_STANDARD` | Использовать достаточный evidence-bound brief → подходящий автор | Нет, если нет critical risk |
| `SOURCE_KNOWN_COMPLEX` | Сложный author/QA по уже доказанной причине | Не автоматически; дорогая реализация не равна неизвестному диагнозу |
| `SOURCE_UNCERTAIN` без critical признаков | Один read-only Technical PM triage; результат сразу brief/route | При остающейся экспертной неопределённости |
| `SOURCE_CRITICAL` или трудный системный/повторяющийся дефект | Отдельный expert diagnosis/assessment → author → независимая QA | Да, Astra High |
| `REQUIREMENT_CONFLICT` | Технически исследовать; нерешаемый продуктовый выбор передать Owner | Только если нужен технический эксперт, не вместо продуктового решения |

Один известный текст `timeout`, `permission denied`, `AssertionError`, TS-код или `401` не определяет класс. Ошибка timeout в логике приложения может быть source-дефектом; настоящий неизвестный исход провайдера требует reconciliation. Отказ OS и платформенный safety refusal имеют разные каналы разрешения. Никто не снимает AppArmor или permissions ради «исправить доступ».

## 9. Fast Fix: все условия должны быть доказаны

Fast Fix допускается только при одновременном выполнении:

1. Есть exact candidate и проверяемый FAIL; причина однозначна, а acceptance не изменяется.
2. Известны исправляемый участок и минимальное действие; не требуется исследовать архитектуру/семантику.
3. Нет critical risk, неоднозначного влияния на зависимости или неизвестных внешних эффектов.
4. Исправление внутри уже допущенных paths/effects и разрешённого маршрута автора; действует finite budget.
5. Известен тест/проверка, которая обнаруживает исходный дефект, и критерий, который подтвердит исправление.
6. Нет предыдущего безрезультатного Fast Fix того же defect fingerprint.
7. Не удаляются tests/assertions, не подгоняются expected values без контракта, не ослабляются auth/QA/timeout limits.

Пример: неправильное имя export при наличии точного правильного символа и прежних API-критериев. Контрпример: TypeScript предлагает `any`, но ошибка связана с nullable authorization; это не Fast Fix. Смена snapshot для сокрытия изменённого поведения — не Fast Fix. Обновление manifest hash возможно лишь после доказанного соответствия уже разрешённым исходникам, а не для «лечения» любой integrity mismatch.

FAST — свойство доказанного исправления, а не порог «меньше 10 строк/двух файлов». Число файлов/строк может ограничивать конкретный шаблон как дополнительный guard, но не заменяет оценку риска.

Если Fast Fix не устранил тот же дефект, повторный быстрый маршрут закрывается. Далее Technical PM пересматривает причину, либо Astra при critical/сложном риске. Новый независимый простой lint после полезного ремонта не требует автоматической Astra, но вся история остаётся видимой.

## 10. QA находит несколько ошибок

QA представляет findings отдельно: ID, severity, место, доказательство, нарушенный критерий/инвариант, reproduction или ограничение проверки, suggested fix class и uncertainty. Для доверенного controller это данные, не команды.

Technical PM/шаблон группирует findings по корневой причине и связанному change surface. Несколько сообщений одного root cause не требуют нескольких диагнозов. Если есть хотя бы один critical finding, он не понижается из-за остальных лёгких.

Один writer может исправить связанную группу; независимые группы можно разнести только при реально непересекающихся ресурсах и исходных критериях. Нельзя параллельно запустить двух авторов одного candidate. Сохраняется полный список findings: `resolved`, `still_open`, `not_reproduced`, `needs_evidence`; отсутствие строки в summary не означает закрытие.

Новая QA проверяет исправленные findings и затронутые риски на final SHA. Неизменённые доказательства переиспользуются только при существующем проверенном equivalence-механизме. Пока ремонт OPS #248 не принят, новая схема не может самовольно объявить его evidence reuse безопасным.

## 11. Когда перепланировать, а когда переиспользовать

План задачи действителен для неизменных scope/acceptance, rules, capability constraints и релевантных исходников. Для каждого нового candidate контроллер проверяет соответствие envelope и обновляет exact binding, но не обязан оплачивать новый LLM planning-проход.

**Новый анализ нужен:** появилась новая область source/dependency; риск повысился; исходное предположение опровергнуто; новый тип FAIL; допустимый fallback отсутствует; обнаружен конфликт требований; два ремонта не дают прогресса. Смена только CI-status, повтор webhook или истечение времени без изменения входов не повод.

Различать semantic defect fingerprint и точную execution binding. Первый связывает повторяющуюся причину в истории; второй включает SHA/политику/проверки и не допускает использования stale receipt. Старый диагноз можно использовать как reference; его пригодность для нового кода надо проверить. Нельзя считать одинаковое сообщение теста доказательством одинакового дефекта.

Cache готового плана/brief — в существующих task artifacts/журналах, не новая vector DB. Decision ID и входной hash проверяются атомарно перед launch. Отредактированный локальный JSON не заменяет authority.

## 12. Повторные попытки и продолжение без micro-GO

Сохраняется EOM §6: **3 обычные author attempts → до 2 контролируемых continuation → оценка прогресса**. Отдельная issue-преемник — внутренняя lineage, не новое продуктовое согласование. Технический PM предлагает recovery, Grok/доверенный контур оформляет его в той же Owner-делегации. Обещать max_attempts=5 в нынешнем closed wire нельзя.

После пяти нет автоматического вопроса Owner: при доказанном прогрессе возможен следующий конечный пакет по действующей делегации. Но не автоматическое бесконечное продление: нужны новая гипотеза, сохранённый candidate и evidence. Два законченных ремонта без полезного продвижения на одном дефекте запускают локальный circuit breaker и переоценку, не остановку всей очереди.

Раздельно учитывать conceptual author attempt, отдельные provider calls, tokens, QA/diagnosis/planning calls, инфраструктурные retries. Await CI и проверенный отказ до inference не превращаются в новый содержательный ремонт. Уже учтённый charge не возвращать вручную; UNKNOWN usage не равно нулю. Если исторический ledger классифицировал иначе, сохранить его и записать новую категорию отдельно.

Дефект схемы/JSON ответа planner: сначала немодельная валидация; максимум один заранее допущенный schema-repair turn без новых прав. Дальше локальный hold или квалифицированная переоценка. Каждый вызов учитывается; валидатор не выполняет неподтверждённый план и не назначает Astra просто из-за лишней запятой.

## 13. Независимость и предотвращение самоодобрения

Технический PM не заменяет независимую QA. Автор не оценивает свой PASS. Astra, выдавшая diagnosis, не принимает своё решение в той же сессии. Финальная QA получает исходные требования, полный список findings и exact candidate; не обязана соглашаться с автором/экспертом.

Применим fresh context и изоляция сессии. Один provider/бренд может исполнять разные роли только по существующей принятой модели независимости; наличие другого аккаунта само по себе её не доказывает. Разные provider предпочтительны, когда квалифицированы; обязательный новый cross-model gate из draft #264/#266 не вводится.

QA scope определяется рисками исходной задачи и новых изменений, а не только последней косметической правкой. Critical defect не превращается в обычный QA после исправления одной строки.

Предлагается сохранить действующие verdict schemas на первом этапе: дополнительная классификация findings идёт отдельным связанным routing artifact. Изменение closed QA JSON — только с versioned parser/validator/tests и без подделки старых receipts.

## 14. Реальная доступность, квоты и fallback

Перед каждым платным вызовом проверять именно provider × role × model/profile × sandbox × task scope. Отдельно: installed, authenticated, qualified, enabled, quota available, source/context accessible. OAuth/catalog PASS не означает успешный native tool run или квалифицированную QA.

Registry хранит проверенный exact model ID/effort и reference на qualification; semantic aliases из этой спецификации не выполняются как CLI arguments. Имена `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-luna`, `cursor:auto` и AGY IDs в существующем коде — факты source baseline, не доказательство живой доступности сегодня.

Fallback выбирается детерминированно только из заранее допустимых эквивалентных маршрутов с тем же risk/capability floor. Не выбирается самая дешёвая модель из оставшихся. При исчезновении AGY ordinary QA может использовать квалифицированный Sol; для critical QA нужен отдельно достаточный role proof. Недоступность Astra для обязательного экспертного риска не превращает задачу в Fast Fix.

Временная quota exhaustion допускает fallback/ожидание, только если нет неизвестного исхода предыдущего вызова. **Платформенный refusal не допускает повторения запретной операции через другой provider/канал/identity.** Это не quota fallback.

Cursor Auto backend может быть `not_exposed`; не приписывать ему точную модель по строке requested route. Проект не включает новые paid API, подписки или сверхлимитный billing автоматически. При недостаточной квалификации блокируется конкретная стадия, другие независимые допустимые работы продолжаются.

## 15. Файлы, данные и доставка контекста

Готовый контекст роли: exact task/acceptance, канон/SMART_ROUTING version и нужные role blocks, source/diff/dependencies, findings, предыдущие применимые repairs и authoritative references. Не передавать каждый раз весь PMA-чат или все исторические stdout.

Technical PM обычно получает planner/context-policy профиль; Astra — problem/evidence packet; автор — ясное задание и применимый brief; QA — fresh immutable snapshot и критерии. Правила/ссылки должны быть реально доступны identity исполнителя. При недоступности references — lossless full fallback, не лишний платный вызов для догадки.

Trusted helper проверяет context revision/hash и provenance до launch. Хеш подтверждает bytes, не понимание моделью. Model response и candidate instructions — untrusted data, не право редактировать свои ограничения. Секреты не попадают в prompts/публичные receipts; synthetic inputs используются в диагностике, когда достаточно их.

Public route plan/brief содержит безопасные решения и hashes/references. Полный приватный trace остаётся в разрешённом хранилище; ключевая инструкция/схема/команда не должна существовать только в домашней папке одного оператора.

## 16. Структура событий и receipts

Ниже смысловые поля будущего решения, **не новые поля действующего wire без реализации**:

| Группа | Минимум |
|---|---|
| Identity | task/lineage, stage/role, operation/idempotency key, attempt, prior receipt refs |
| Inputs | rules/routing policy revision, source/base/candidate, task hash, evidence refs, failure fingerprint |
| Decision | decision source: deterministic template / Technical PM / expert; class, risk, причины и найденные ограничения |
| Route | requested profile/model/effort, allowed alternatives, actual effective provider/model/effort или not_exposed |
| Availability | registry/qualification reference, refusal or quota category, preflight result |
| Independence | author/reviewer session identity и scoped permissions; не один бренд как «доказательство» |
| Outcome | started/returned/unknown, exit и semantic verdict отдельно, charge state, remaining lineage budget |
| Usage | input/output/cache-read/cache-write/reasoning — только exposed; latency раздельно; cost только при известном тарифе |

Допустимые reason codes должны быть замкнутым протестированным набором. Примеры для обсуждения: `TEMPLATE_PROVEN`, `KNOWN_LOCAL_REPAIR`, `COMPLEX_IMPLEMENTATION`, `CRITICAL_BOUNDARY`, `UNRESOLVED_CAUSE`, `QUALIFIED_FALLBACK`, `INSUFFICIENT_EVIDENCE`, `PLATFORM_REFUSAL`, `UNKNOWN_EFFECT`. Arbitrary free-form reason не выдаёт полномочия.

Перед launch сверять decision bindings и состояние под существующим lock/CAS. Duplicate delivery возвращает прежний operation/result, а не делает ещё один model call. Если task/source/admission изменились, просроченное решение не исполняется. Планировщик не запускается одновременно как второй writer; его snapshot read-only.

## 17. Псевдокод выбора

```text
handle(task, event):
    state = reconcile_required_state_without_model_call()
    validate_task_authority_and_exact_source(task, state)

    if event is UNKNOWN_EFFECT:
        return existing_reconciliation_path
    if event is PLATFORM_REFUSAL:
        return affected_operation_hold_with_exact_refusal
    if event is WAITING_CI:
        return existing_event_driven_wait
    if verified_precall_or_transient_infra(event):
        return bounded_existing_ops_path_without_source_attempt_reset

    evidence = collect_bound_evidence_and_scope(task, event)
    if evidence.required_inputs_missing:
        return obtain_authorized_inputs_or_local_hold
    risk_floor = trusted_risk_rules(evidence)

    if valid_approved_template(task, event, evidence, risk_floor):
        plan = deterministic_template_plan()
    elif valid_existing_plan_or_brief(task, event, evidence, risk_floor):
        plan = verified_reuse_with_new_exact_binding()
    elif critical_or_expert_problem(evidence, risk_floor):
        plan = one_admitted_read_only_astra_assessment()
    else:
        plan = one_admitted_read_only_technical_pm_sol_high()
        if plan.has_unresolved_expert_problem:
            plan = one_admitted_astra_on_precise_remaining_question()

    validate_plan_schema_scope_evidence_and_risk_floor(plan)
    route = existing_router.select_from_admitted_qualified_routes(plan)
    if no_equivalent_route:
        return local_hold_without_global_train_stop
    reserve_and_dispatch_once_via_existing_controller(route, plan)
```

Это схема поведения, не runnable script. Пока нет versioned classifier/validator, слова Grok «здесь понятно» не заменяют valid_approved_template. До policy activation действует старый FAIL-маршрут.

## 18. Примеры и ожидаемые маршруты

| Ситуация | Решение |
|---|---|
| ESLint: неиспользуемый импорт, side effects отсутствуют, scope подтверждён | Fast Fix: принятый tool либо Cursor/квалифицированный Luna/Sol Medium; без planner/Astra |
| TS-код из-за неоднозначного authorization/null-flow | Не Fast Fix по одному коду TS; critical assessment, затем author и specialist QA |
| Кнопка с опечаткой, текст и макет уже утверждены | Template/direct author, QA изменённого текста; не новый дизайн/PM |
| Обычная новая форма с ясным API-контрактом, нет template | Technical PM Sol High один раз → Cursor → CI → ordinary independent QA |
| QA нашёл неверный locale/date rendering, точная причина и критерий уже доказаны | Standard repair напрямую автору; Sol High только если сложность действительно требует |
| Создание дубля участия при гонке за последним местом | Critical concurrency → Astra diagnosis → Cursor complex/Sol High → независимые concurrency tests и QA |
| #273: потеря контекста/failure history либо небайт-идентичный fallback | Сложный контекстный/authority-sensitive риск, не «пара строк»; expert по реальной границе, сильный author и отдельный QA |
| #274: OAuth path safety, FIFO block или потеря evidence после charge | Security/accounting boundary → Astra, Sol High/квалифицированный OPS author, specialist QA |
| Изменился manifest hash, исходный diff и accepted source неизвестны | Не автоматически обновлять expected hash; сначала установить provenance |
| CI не стартует из-за временного outage | OPS/backoff, не author repair и не Astra по умолчанию |
| Codex завершился неизвестно, возможен push | UNKNOWN reconciliation; не fallback на Cursor и не второй writer |
| Provider safety refusal | Зафиксировать локальный отказ; не повторять запрос иной моделью |
| AGY не квалифицирован для QA | Допущенный Sol fallback нужного класса; не считать catalog CLI доказательством QA |
| Две правки не устранили один и тот же assertion | Закрыть повтор Fast Fix; переоценка причины, при трудном повторе Astra |
| QA ошибочно требует новую функцию за рамками Owner scope | Разобрать контракт; не исправлять продукт под чужой критерий; предметный Owner-вопрос только при настоящей неоднозначности |
| Grok без evidence предлагает Astra автором простой формы | Validator отклоняет role/profile mismatch; маршрутизация не зависит от уверенного текста Grok |

## 19. Экономия: что измеряем и чего не обещаем

Базовая метрика — ресурсы **до принятого результата**, включая planning, diagnosis, author retries, QA, ожидание и повторные проверки. Отдельно показывать цену/квоту модельной подписки и дополнительные денежные списания; отсутствие цены не делает токены бесплатными.

Измерять долю template/no-planner, полезность planning, число Astra-вызовов по причинам, first-pass QA success, повтор дефекта, ошибки после DEV, escalation/de-escalation, wall-clock до ACCEPTED и реальное usage каждого provider. Cache tokens не суммировать повторно с total input, если API включает их в него; provider-specific семантику сохранять. Нераскрытые метрики — null/not_exposed.

Сравнивать сопоставимые задачи по роли, исходной сложности и риску; не объявлять экономию только из-за меньшего prompt или двух разных CI runs. Shadow-классификация не расходует новые model calls на каждый webhook: использовать сохранённые безопасные traces и конечную офлайн выборку. Численные цели экономии определяются после baseline, не обещаются заранее.

Качество — ограничитель экономии: missed critical findings и false Fast Fix недопустимы. Если Sol High planning не даёт пользы для класса задач, создавать проверенный template или сокращать вход, а не переносить всю аналитику слабой модели PMA.

## 20. Встраивание в текущий код, не новый оркестратор

Карта возможных изменений для будущего исполнителя; точные final paths проверяются перед новым assignment:

| Существующий участок | Требуемая ограниченная доработка |
|---|---|
| `actions_train/cost_policy.py` | Role-aware selection, независимые author/QA оценки, risk floors; исключить общий complexity→Astra author default в новой policy |
| `actions_train/core.py` | Вызов existing validated route по принятому plan, квалификация, fallback, condition-based next stage |
| `actions_train/stage.py` | Bounded planner/triage handler в существующем executor, context binding и validated result; отдельная роль без source write |
| `actions_train/failure_diagnosis.py` | Оставить Astra expert path; добавить совместимое различение direct/technical/expert provenance, не подделывать Astra brief |
| `context_policy.py` / `context_exchange.py` | Exact принятый routing context и lossless delivery применимым ролям, без повторения всей истории |
| `recovery.py` и существующие журналы | 3+2/переоценка по делегации, lineage и no duplicate calls; старые grants не изменять |
| Существующие monitor/receipts | Коротко показывать кто решил, какой маршрут выбран и почему; не новая monitoring-система |
| Существующие tests/manifest | Deterministic fixture matrix, exact hashes и совместимость; не отключать CI/security gates |

Это не заявление, что каждый файл непременно надо менять. Сначала gap-analysis точного текущего кода и минимальный diff. Не строить multi-agent framework, новый планировщик очереди, daemon, отдельную БД и универсальный доступ к root. Наличие нового логического planner stage не означает второго PMA.

## 21. Как не создать вторую противоречащую политику

После принятия этот файл должен стать **единственным специализированным источником алгоритма SMART ROUTING**. EOM сохраняет authority, роли/independence, безопасность, continuation и ссылки; детальную новую матрицу не держать в двух независимо редактируемых местах.

Приёмочный documentation diff обязан синхронно:

1. В EOM §3/§4.2/§5 определить Technical PM и ссылку на routing spec; заменить безусловное «любой FAIL → Astra» на утверждённую классификацию.
2. В §8.1 и related common/author/planner/PMA/failure_diagnosis capsules согласовать direct/technical/expert ветви. Не оставить capsule со старым обязательным вызовом на каждом FAIL.
3. Сохранить §6 continuation и исключения старых immutable tasks. Изменение default не переписывает старое разрешение.
4. Обновить START_HERE, AGENTS, DOCUMENT_REGISTER и CONTEXT_SOURCES так, чтобы обе принятые revisions были доступны и проверяемы, без альтернативной таблицы моделей.
5. Опубликовать одинаковые принятые policy bytes на main/dev; обновить trusted context pins штатно после review, не принимать изменённые candidate rules за собственную authority.

Если принят только draft-документ, а EOM/consumer ещё не обновлены, статус остаётся DESIGN/NOT_ACTIVE. Никакого скрытого Fast Fix exemption из ссылки на эту страницу.

## 22. План внедрения и проверяемые checkpoint

**SR0 — согласованная спецификация и канон.** Docs-only review, точный change map EOM/capsules; одна принятая source revision. Без provider calls и runtime изменения из-за одного Markdown.

**SR1 — классификатор и валидатор.** Набор синтетических случаев §23; несовместимый/опасный plan отклоняется. Старые задания продолжают старую семантику. Новую policy не записывать в неподдерживаемую схему.

**SR2 — Technical PM в существующем VPS-контуре.** Один конечный read-only вызов на отдельной допущенной квалификационной задаче: exact source access, заданный результат, no writes, корректный context receipt. Повтор события не создаёт второй вызов.

**SR3 — shadow comparison.** Сохранённые fixtures/traces: классификация и предложенный route без реального author dispatch. Отдельная review ошибок классификации; никакого непрерывного платного самоаудита.

**SR4 — реальные адресные canaries.** Одна простая доказанная ошибка без planner/Astra; одна обычная задача с Technical PM; один known-standard repair; один critical expert path с нужной role qualification; один quota fallback и UNKNOWN/no-replay negative. Использовать уже полученные exact доказательства, где применимо, не повторять всю DNS/AppArmor-квалификацию.

**SR5 — ограниченное включение новым задачам.** Совместимый existing guarded install с backup/rollback на безопасной границе. Сначала конечный выбранный класс задач, затем расширение после evidence; активные UNKNOWN и leases не трогать. Новые branches/grants создаются только существующим доверенным процессом.

**SR6 — измерение и приёмка.** Реальный no-micro-GO цикл до DEV ACCEPTED, прозрачный usage, правильные fallback и остановки. Это часть этапа 6 существующего AI Train Master Plan, с зависимостью от пригодных ролей и Context Rollout, а не отдельный бесконечный commissioning-проект.

Rollback возвращает last accepted classifier/routing policy для будущих безопасных запусков; не повторяет завершённые calls и не удаляет принятые source результаты. Семантический итог уже исполненных задач не меняется задним числом.

## 23. Минимальные приёмочные тесты

| ID | Проверка | Ожидаемый результат |
|---|---|---|
| SR-T01 | Проверенный простой шаблон | Нет planner/Astra calls, допустимый author/tool |
| SR-T02 | Внешне простой TS/ESLint с изменением auth/guard | Fast Fix отклонён; risk floor сохранён |
| SR-T03 | Неизвестная обычная задача | Один Sol High Technical PM, валидный план автора и QA |
| SR-T04 | Полный diagnosis/brief уже пригоден | Без лишнего planner/diagnosis replay |
| SR-T05 | Known complex noncritical cause | Sol High/подходящий Cursor author без обязательной Astra |
| SR-T06 | Critical defect, даже одна строка | Экспертный path и независимый qualified QA |
| SR-T07 | Первый Fast Fix не помог | Повторный Fast Fix того же дефекта закрыт |
| SR-T08 | Несколько findings, один critical | Ни один finding не потерян; critical не усреднён |
| SR-T09 | Подмена SHA/task/rules после planning | Decision не исполняется до revalidation |
| SR-T10 | Повтор event/dispatch | Один model call, тот же operation ID |
| SR-T11 | UNKNOWN предыдущего вызова | Никакого fallback/повторного writer до reconciliation |
| SR-T12 | Quota exhausted без effects | Только разрешённый equivalent fallback; причина в receipt |
| SR-T13 | Platform refusal | Нет того же действия через иной provider/identity/формулировку |
| SR-T14 | AGY catalog есть, QA qualification нет | AGY не выбран как READY |
| SR-T15 | Grok/author предлагает непозволенную модель или новые права | Validator отказывает, policy не переписывается |
| SR-T16 | Неполный context, неправильный hash | Full trusted fallback либо precise missing input; не fake QA PASS |
| SR-T17 | Repair предлагает удалить assertion/ослабить auth | Fast Fix отклонён; критерии сохранены |
| SR-T18 | Три попытки закончились, есть прогресс/brief | Бounded continuation до двух без Owner micro-GO, история не обнулена |
| SR-T19 | Нет прогресса два ремонта подряд | Локальный circuit breaker, независимая очередь идёт |
| SR-T20 | Автор и QA имеют одну сессию/изменяемый snapshot | Независимая приёмка отклонена |
| SR-T21 | Некорректный plan JSON повторяется | Конечный schema-repair budget, без бесконечного Astra escalation |
| SR-T22 | Старая immutable task использует прежнюю policy | Совместимость без скрытого Fast Fix/route rewrite |
| SR-T23 | Effective Auto model не exposed | Честный not_exposed, без выдуманного model ID/стоимости |
| SR-T24 | Обновление EOM без capsule/pin согласования | Активация новой policy заблокирована до исправления согласованности |

Критерий успеха — не наличие 24 зелёных fixture-тестов само по себе, а подтверждённые переходы и реальные роль/call receipts там, где требуются. Source PASS, install, role qualification и E2E записываются отдельно.

## 24. Что видит Owner

Одна карточка задачи, без переноски внутренних номеров:

```text
Задача: исправить поведение формы
Решение: Technical PM / Sol High — план принят
Автор: Cursor Auto (fallback: Sol Medium)
QA: отдельный Sol Medium; AGY пока не квалифицирован для этой роли
Ошибка CI: доказанная локальная, Fast Fix
Диагностика Astra: не нужна; причина и regression test уже установлены
Авторская попытка: 2/3; continuation до 2 — по standing delegation
Статус: CI → независимая QA; Owner-действие не требуется
```

Это иллюстрация формата, не текущий статус проекта. Grok сообщает результат и точный вопрос лишь при действительном новом решении Owner. Каждое существенное назначение имеет короткое основание и requested/effective route; нет фразы «я делаю Astra» без указания роли.

## 25. Источники и пределы этой редакции

Проверены через подключённый GitHub, source baseline `9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e`:

- [EOM — роли, routing, continuation, FAIL, context](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/docs/rules/ENGINEERING_OPERATING_MODEL.md).
- [core.py — route, diagnosis_route, next_stage](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/scripts/chatops/actions_train/core.py).
- [cost_policy.py — MATRIX, preferred_route, selection](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/scripts/chatops/actions_train/cost_policy.py).
- [failure_diagnosis.py — closed schema, reservations, brief validation](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/scripts/chatops/actions_train/failure_diagnosis.py).
- [AGENTS — tool operations, refusals, independent roles](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/AGENTS.md).
- [START_HERE — принятый context и публичные источники](https://github.com/anpavel84-afk/gobadminton-clean/blob/9e95eb16de5ed86f51c3baf3e8311ef7f74cf08e/START_HERE.md).

Эта редакция — разработанная спецификация по новому поручению Owner. Она не проверяет живые квоты/процессы и не утверждает, что Grok слабее конкретной модели по измеренному benchmark. Выделение Technical PM — организационное решение о достаточном анализе и проверяемом результате. Не заявлены доказанные сравнительные цены, проценты экономии, независимый QA этого проекта спецификации или runtime readiness нового SMART ROUTING.

**Итог:** Grok координирует; Technical PM решает нетривиальное; trusted code проверяет; author реализует; отдельная QA принимает; Astra включается по доказанной экспертной необходимости. Простое исправление не превращается в совещание моделей.
