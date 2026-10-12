# ADR-0005 — Identity независимо от поставщика

Status: TECH_SELECTED, initial allowlist OWNER_CONFIRMED OD-005. Date: 2026-10-01.

## Decision

User UUID отдельно от ExternalIdentity. Начальные adapters — VK ID и Яндекс ID; собственные browser/mobile sessions. Authorization code+PKCE, server-side provider exchange, explicit link after reauth. Не объединять аккаунты по email/phone. Native получает только одноразовый handoff code с собственным verifier; provider secrets не клиентские.

## Alternatives

VK ID как primary User key заблокировал бы другие providers. Автоматический merge по email увеличил бы риск захвата/раскрытия. Собственный универсальный identity provider или сразу семь login SDK не нужны.

## Consequences

Нужны session/revocation/linking tests и отдельные provider configs по окружениям. Изменение provider не меняет внутреннюю историю пользователя. MAX/Сбер/другие методы только будущие adapters, без кнопок в MVP. Публичный iOS потребует отдельного compliance решения O-04; Sign in with Apple не добавлен этим ADR.

## Verification

Q-02–04, Q-17–19, реальные live test credentials перед пилотом. [AUTH](../integrations/AUTH.md), [PROVIDERS](../integrations/PROVIDERS.md).
