# Пропорциональное тестирование AI Train — пакет v1

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.**

Source baseline для исходных материалов: `bdd912a82a2f0087f4cfc9c6820edc8c49ee6527`.
Материалы сохранены дословно из пакета Owner/Advisor от 26 октября 2026 года.
Наличие этих файлов в Git не изменяет `ENGINEERING_OPERATING_MODEL.md`, не даёт machine admission, не меняет CI, VPS, PROD или полномочия PMA.

## Состав

- [`PROPORTIONATE_TESTING_PROTOCOL_V1.md`](PROPORTIONATE_TESTING_PROTOCOL_V1.md) — предлагаемый регламент и четырёхуровневое T0/T1/T2/T3 тестирование.
- [`TEST_PLAN_AND_ROLE_CAPSULES.md`](TEST_PLAN_AND_ROLE_CAPSULES.md) — шаблон плана для Issue и компактные инструкции PMA, автора и QA.
- [`GROK_TESTING_PROTOCOL_IMPLEMENTATION.md`](GROK_TESTING_PROTOCOL_IMPLEMENTATION.md) — поручение Grok на поэтапное внедрение.
- [`package_manifest.json`](package_manifest.json) — исходные SHA-256 и размеры трёх документов.
- `GoBadminton_Testing_Protocol_v1.zip` — исходный пакет для скачивания; содержит три документа и `package_manifest.json`.

## Граница внедрения

Публикация — **только передача предложения**. Grok как mutating PMA должен проверить актуальные EOM, действующий `Product CI`, существующие `qa_equivalence` и Context Exchange, согласовать закрытые схемы и предложить поэтапные изменения через отдельные reviewed PR.
Сначала прекратить дублирующие тяжёлые локальные тесты и модельный polling, не отменяя текущий обязательный CI.
Затем проверить экономию и реальные инварианты на обычной микро-, опасной однострочной и UI-задаче.
Полный CI, независимая QA, безопасность, rollback и продуктовая пауза сохраняются до отдельного утверждённого изменения.

**Не сливать этот draft автоматически и не использовать его как повод для новой продуктовой работы.**
