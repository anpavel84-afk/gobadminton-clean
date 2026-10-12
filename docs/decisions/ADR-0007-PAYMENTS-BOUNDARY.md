# ADR-0007 — Платёжный контур позже

Status: TECH_SELECTED в пределах OWNER_CONFIRMED OD-004. Date: 2026-10-01.

## Decision

MVP хранит только внешние условия, точную nullable цену/валюту и контакт организатора. В дальнейшем платежи добавляются как отдельные Order/Attempt/Refund/Settlement и необходимые financial records. Participation не становится financial ledger.

## Alternatives / consequences

Полностью запретить будущие платежи противоречит Owner. Реализовать checkout сейчас тоже противоречит первому этапу. Компромисс — чёткие границы, snapshots, idempotency и future coordination design без пустой PSP-интеграции.

До financial implementation нужны merchant/agent модель, refunds/чеки/налоги, provider support, seat-hold policy, reconciliation и store billing. Цифровое продвижение и физическое занятие не считаются одинаковой purchase category.

## Verification

MVP Q-15: отсутствуют charge/refund/payout APIs и обещания автоматического возврата. Будущий финансовый QA отдельный, включая duplicate webhook, late payment и hold-expiry race. [PAYMENTS_FUTURE](../integrations/PAYMENTS_FUTURE.md).
