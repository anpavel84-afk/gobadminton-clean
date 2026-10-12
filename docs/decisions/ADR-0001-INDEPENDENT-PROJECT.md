# ADR-0001 — Самостоятельный GoBadminton

Status: TECH_SELECTED, основание OWNER_CONFIRMED OD-001. Date: 2026-10-01.

## Context

Предыдущая постановка ошибочно считала сайт сообщества BadmintonOpen техническим предшественником приложения GoBadminton. Owner явно разделил проекты и создал `anpavel84-afk/gobadminton`.

## Decision

Greenfield canonical repository для кода и документации GoBadminton. Не наследовать source, CMS/Payload, модели кемпов, данные, окружения, дизайн или deploy BadmintonOpen. Не создавать migration plan из него. `agents` остаётся репозиторием Agency/launchers, а не продуктовой архитектуры.

## Alternatives / consequences

Adapt existing camp site отвергнут как противоречащий Owner intent. Заимствование общего инженерного опыта допустимо, но не implicit coupling или доступ к чужим ресурсам. Новый repo требует собственных credentials, тестов и deployment, которые вводятся по этапам.

## Verification / supersession

Каждый bootstrap читает [OD-001](../manifest/OWNER_DECISIONS.md) и [проектный bootstrap](../governance/BOOTSTRAP.md). Упоминания BadmintonOpen в текущих docs служат только отрицательной границей/объяснением прежней ошибки. Старые launchers с наследованием не являются текущей инструкцией проекта.
