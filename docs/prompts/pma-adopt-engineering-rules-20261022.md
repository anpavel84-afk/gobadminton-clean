# Принятие правил — постоянный указатель

**Историческая инструкция принятия v1.1 / PR #217 от 22.10.2026 не является текущим поручением на повторный commissioning.** Её полный исходный текст сохранён [в immutable snapshot](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/docs/prompts/pma-adopt-engineering-rules-20261022.md).

Актуальный общий вход — [START_HERE.md](../../START_HERE.md); принятый канон и его hash — [CONTEXT_SOURCES.json](../rules/CONTEXT_SOURCES.json). Изменение канона регулируется §11 полного [регламента](../rules/ENGINEERING_OPERATING_MODEL.md), а доставка — §10. Не копировать сюда номер «последней версии» отдельно от проверяемого источника.

Документационный release должен пройти независимое review и требуемые проверки, иметь одинаковые принятые entrypoints на main/dev и проверенные ссылки. Он не обновляет installed controller/rules pin, активные admissions или PROD. Если сам accepted core изменился, его новый doc commit/hash и context consumers переходят отдельным reviewed пакетом, не отключением проверки целостности.

Отчёт разделяет DOCUMENT_PUBLISHED, RULES_EFFECTIVE и RUNTIME_VERIFIED. Доставка должна быть подтверждена для конкретной роли; опубликованный Markdown не доказывает понимания моделью. Нужный rollback — reviewed revert документа, не откат task history/runtime.
