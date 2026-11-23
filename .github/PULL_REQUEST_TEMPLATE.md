## Продукт и допуск

- Owner/Issue: Refs #...
- Цель и пользовательское поведение:
- Точная разрешённая база / SHA, paths и scope:
- Approved Web/design/API reference:

## Затронутые поверхности

- [ ] Web / PWA / Windows browser-installed
- [ ] Android native
- [ ] iOS native
- [ ] Shared API / contract / worker
- [ ] Admin
- [ ] Enterprise / external partner (separate grant required)
- [ ] Только docs (без изменения runtime/CI/permissions)

## Проверка

- Independent QA / reviewer (или NOT_TESTED):
- Product CI / exact SHA:
- API backward-compat (текущий и предыдущий mobile):
- Security: auth/ACL, idempotency, privacy, scopes:
- UI parity с точным accepted Web/design (или not applicable):
- DEV readback и rollback (или NOT_DEPLOYED):
- APK/AAB/iOS build/sign и device UAT (или NOT_TESTED):
- Web/PWA installed browser, OTA A→B (или NOT_IMPLEMENTED):
- Остаток, blockers и Owner UAT:

PR не создаёт новый машинный admission или PROD GO. Обязательны [Engineering Operating Model](../docs/rules/ENGINEERING_OPERATING_MODEL.md), exact Owner scope и существующие gates. Никаких секретов и реальных личных данных в описании.
