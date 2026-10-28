# Checklist исполнения — без второй политики

Нормативные условия — [единый регламент](../rules/ENGINEERING_OPERATING_MODEL.md). Вход — [START_HERE.md](../../START_HERE.md).

До эффектов: получены и проверены accepted rules commit/hash и full либо квалифицированный common+role capsule (§10.3); установлены exact assignment/base/candidate, критерии, allowed paths/effects; проверены worktree/identity/ownership, реальная квалификация маршрута и доступность необходимых inputs. Невыполненная проверка не считается пройденной.

До передачи: diff остаётся в scope, существенные assertions сохранены, source/test результаты отделены от независимой QA; нет secrets/unrelated изменений; NOT_TESTED указан явно. Handoff содержит exact commit/PR, evidence, ограничения и следующий допустимый шаг.

До приёмки: exact-SHA независимая QA, обязательный CI, интеграционные и DEV gates подтверждены в нужной стадии; stale PASS не переносится на изменённый candidate без предусмотренного доказательства. PROD не выводится из DEV-разрешения. История, budgets и rollback сохраняются.
