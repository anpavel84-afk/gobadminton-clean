# Общий tooling

Будущие shared TypeScript/lint/test/config presets. Пока runtime toolchain не установлен. F-01 фиксирует exact versions, lockfile, clean install/build и проверку dependency boundaries.

Не хранить secrets или runtime domain logic здесь. Разные app peer versions допустимы при явной совместимости. Обновление tooling — отдельный PR с проверкой всех затронутых apps, не неявный latest при deployment.
