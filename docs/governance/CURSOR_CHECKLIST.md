# Checklist исполнения

Применять [единый регламент](../rules/ENGINEERING_OPERATING_MODEL.md); список не выдаёт новых прав.

## До эффектов

- Прочитаны root AGENTS и полный регламент; записан принятый rules commit.
- Установлены exact assignment/base, allowed paths/effects, роль и acceptance.
- Проверены repository identity, Germany task worktree, dirty state и отсутствие второго writer.
- Подтверждены role-specific adapter, sandbox, маршрут/fallback и доступные лимиты.
- Обязательный предметный контекст доступен; неизвестное не заменено догадкой.

## До передачи

- Diff не расширяет scope, contracts/tests отражают изменение.
- Нет secrets и unrelated изменений; self-check не выдан за independent QA.
- Невыполненные проверки названы NOT_TESTED с местом обязательного выполнения.
- Handoff содержит точный commit/PR, evidence, ограничения и следующий шаг.

## До утверждения результата

- QA, CI и DEV относятся к требуемому candidate; интеграционный diff не унаследовал чужой PASS.
- DEV ACCEPTED подтверждён фактически; Owner acceptance не придумана.
- PROD не выведен из DEV-разрешения. История, попытки и rollback сохранены.
