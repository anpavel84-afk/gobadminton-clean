# Generated API SDK

Будущий клиент из [OpenAPI](../contracts/openapi.json). Пока не сгенерирован и не протестирован; ручные pretend exports не создаются.

F-01 выбирает/pins generator, проверяет browser/RN transport, response error mapping, abort/timeout и nullable/money types. Authentication transport передаётся клиентом; SDK не хранит secrets и не автоматически retry бизнес-mutations новым idempotency key.

Generated artifacts воспроизводимы и проверяются diff в CI. Не редактировать generated DTO вручную. UI cache keys включают account/environment; logout очищает private cache.
