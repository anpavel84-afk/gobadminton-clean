# Команда и ответственность

Статус: **предложенная рабочая схема**, не подтверждение Hub memberships. Роли не равны моделям/провайдерам и не создаются автоматически от появления документа.

| Контур | Базовая профессия / specialization | Ответственность |
|---|---|---|
| Owner | Человек | Product/risk/budget/legal и release decisions, не рутинный курьер |
| PM | project_orchestrator | Зависимости, согласование slices, актуальные результаты и roadmap в каноническом рабочем инструменте |
| Product/UX | domain_specialist / product_strategy_ux_research | Функциональные flows, edge cases, понятные правила и pilot metrics |
| Architect | project_architect | Стек/домен/API/границы, ADR и bounded assignments; не application coding |
| Implementation | implementation, reusable | Исполняемый код и self-tests точного slice, evidence |
| QA | qa_diagnostics, reusable | Независимая проверка exact candidate; не ремонт и не Owner acceptance |
| Pilot/Growth | domain_specialist / pilot_operations_growth | Организаторы/игры/каналы/feedback/операционная поддержка и реальные метрики |
| Design Director | design_director | Самостоятельная визуальная стратегия GoBadminton, brief и review |
| Visual Designer | visual_concept_designer | **Рисует конкретные экраны, компоненты и прототипы**, передаёт editable sources/варианты/состояния |
| Design Spec Engineer | design_spec_engineer | Из approved visuals извлекает точные состояния/responsive/specs, по необходимости |
| Content | content_director | Микрокопи/onboarding/error/условия участия; по необходимости |
| Legal/privacy reviewer | Квалифицированный human/domain review | Реальные документы/оператор/data-flow/store/финансовые gates, не выдуманное заключение агента |

## Передачи

Product и Architect формируют функциональные инварианты и интерфейсы. Design Director задаёт brief, **Visual Designer создаёт визуалы**, Spec Engineer детализирует при необходимости. Implementation получает exact контракты и approved designs; QA получает exact implementation candidate и критерии. Architect после initial baseline подключается к существенным интерфейсным/доверительным изменениям, не к каждой CSS-правке.

Pilot/Growth работает параллельно engineering и не заменяет Product/UX; подтверждение состоявшейся игры/новизны клиента требует реального наблюдения/ответа организатора, а не генерации цифр. Внешние сообщения, расходы и коммерческие обязательства требуют отдельной авторизации.

Отдельные постоянные DevOps/Data/Payments/Map Employees пока не обязательны. Их задачи имеют владельцев: инфраструктура — Implementation + Architect + ops person, analytics — Product + Implementation + Pilot, financial review — позже отдельный специалист. Сложность выросла — пересмотреть роли по фактам, не заранее создать десятки чатов.

## Единый status layer

Если подключён Agent Agency Hub, он хранит Project/Task/Mission/Run/Result. Этот документ — распределение обязанностей, а [slice plan](../delivery/IMPLEMENTATION_SLICES.md) — архитектурные зависимости, не второе состояние задач. PM не является обязательным шлюзом для прямого Owner → specialist поручения.
