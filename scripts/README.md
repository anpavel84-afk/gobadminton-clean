# Foundation checks

`python3 scripts/check_foundation.py` использует только стандартную библиотеку Python3. Проверяет required files, локальные Markdown file paths, JSON parse/duplicates, OpenAPI local refs, operation IDs/path parameters/security references и idempotency/CSRF declarations бизнес-команд.

Проверка **не** исполняет приложение, не валидирует все возможности OpenAPI/JSON Schema, не проверяет URL доступность/Markdown anchors, не сканирует production и не является независимым QA. Полная schema validation/SDK generation/integration tests добавляются с F-01. При ошибке process завершается ненулевым кодом.

E1 email proof commands declare `x-auth-challenge-protocol=bound-single-use-v1`.
The checker permits omission of Idempotency-Key only on the six exact POST challenge
routes with required Origin + X-GB-Email-Auth. Session credentials cannot be replayed
through a stored success receipt. Generic mutations remain subject to the original rule.
Verify this boundary with `python3 scripts/test_email_contract_policy.py`.
