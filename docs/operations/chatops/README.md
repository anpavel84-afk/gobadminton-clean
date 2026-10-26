# ChatOps — GoBadminton CLEAN

[Единый регламент](../../rules/ENGINEERING_OPERATING_MODEL.md) определяет роли, допуски, выбор моделей, автономию, QA и выпуск. [PMA checklist](PM-CHEATSHEET.md), [техническая карта Actions train](ACTIONS_TRAIN.md).

Версионность для **всех** ролей Actions Train и обоих PMA регламентирует [Owner OD-013](../../decisions/OWNER_DECISION_DEV_OPS_VERSION_COMPATIBILITY_V001.md). Плановые различия installed/dev/approved не являются сами по себе отказом; опасные несовместимости сохраняют fail-closed.

GitHub Issues/Projects сохраняют задачи и планирование. Действующий GitHub Actions train выполняет bounded dispatch/reconciliation; Germany adapter исполняет разрешённые этапы. Это не ручной режим «открытый чат запускает каждую задачу» и не новый бесконечный Supervisor.

Source-only авторы не получают publish/deploy полномочия от названия роли. Реальная независимая QA, Product CI, paired artifacts, DEV smoke/ACCEPTED и rollback сохраняются. PROD требует отдельного Owner GO.

Исторический установочный пакет и его bootstrap-команды не являются повторным поручением на установку. Перед OPS изменением сверять реальный installed pin, конфигурацию, активные assignments и точный разрешённый scope. Не переподключать секреты и не ослаблять environment protection для удобства документа.
