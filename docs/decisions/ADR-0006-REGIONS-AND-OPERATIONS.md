# ADR-0006 — Регион и эксплуатация

Status: TECH_SELECTED, deployment NOT_PROVISIONED. Date: 2026-10-01.

## Decision

Начальный российский data plane как технический default, собственные окружения/секреты, portable containers, self-hostable apps. Реальные поставщик/домен/бюджет/юридические основания проходят gate. Не использовать чужой VPS/БД по умолчанию. Backups, telemetry, media и OAuth/push входят в data-flow review.

## Alternatives / consequences

Обязательный зарубежный BaaS/edge storage отвергнут как ненужная зависимость; автоматическое глобальное multi-region active-active не оправдано. Managed PostgreSQL может уменьшить операционные обязанности при согласованном бюджете; self-managed требует назначенного оператора.

International-ready identifiers/timezones/currency не означают юридическую или техническую готовность международного запуска. Нагрузочные цели и RPO/RTO — targets до измерения. Бумажный runbook не доказывает восстановление.

## Verification

F-05/F-07: restore drill, private network/roles, log redaction, runtime ownership, alert recipients, cost approval. [Окружения](../operations/ENVIRONMENTS.md), [восстановление](../operations/DEPLOYMENT_AND_RECOVERY.md).
