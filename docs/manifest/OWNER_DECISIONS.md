# Решения владельца

Статус: **OWNER_CONFIRMED**. Дата актуализации: 2026-10-02. Источник: прямые сообщения Pavel в GoBadminton-чатах. Это запись поручений для работы в репозитории, не подтверждение записи в Agent Agency Hub.

| ID | Решение | Последствия |
|---|---|---|
| OD-001 | GoBadminton и BadmintonOpen — разные проекты. | Greenfield; нет наследования кода/БД/runtime/design. |
| OD-002 | Архитектура охватывает web, iOS, Android, backend; MVP помещается в долгосрочную архитектуру. | Target architecture и delivery slices разделены. |
| OD-003 | Первый рынок Москва/Россия, затем расширение. | География/locale не зашиваются как единственные значения. |
| OD-004 | В первом этапе внутренних платежей нет. | Только внешние условия расчёта; финансовый контур позже. |
| OD-005 | Первая авторизация только VK и Яндекс. | Provider-independent Identity; новые провайдеры отдельно. |
| OD-006 | Архитектору делегирован технический выбор и docs/structure в `anpavel84-afk/gobadminton`. | ADR в технической области допустимы без рутинного возврата к Owner. |
| OD-007 | Немецкий VPS `vmi3510488` разрешён для технического MVP backend. | GoBadminton backend/runtime изолирован от других проектов на shared host. |
| OD-008 | Implementation выполняется через **Cursor AUTO на PLAN**, GitHub — canonical source. | Серверы получают exact Git candidates; не кодировать напрямую на VPS. |
| OD-009 | Домен **gobadminton.ru** приобретён; API hostname должен быть независим от физического backend host. | `api.gobadminton.ru` / `dev-api.gobadminton.ru` остаются стабильными именами при переносах. |
| OD-010 | Текущая MVP-топология: **frontend/nginx на отдельной VPS Rucloud в Королёве (Москва), backend/API/worker/PostgreSQL в Германии на `vmi3510488`**. | Browser идёт same-origin через московский web proxy; DB остаётся рядом с API в Германии. Никакой БД через WAN. |
| OD-011 | GoBadminton Implementation/QA/queue execution переносится на Germany VPS `vmi3510488`; VPS получает repo-specific write access к `anpavel84-afk/gobadminton`. PLAN остаётся paused recovery/reference и не является обычным writer. | Germany VPS — primary execution host для Cursor/Codex queue; PLAN и VPS не пишут одновременно; Git access не даёт deploy/PROD/acceptance authority. |

## Текущие host facts

Moscow web host:
- device: `ruvds-68jzd`;
- public IPv4: `194.87.214.217`;
- Ubuntu 24.04 LTS;
- 2 vCPU / 4 GiB RAM / 40 GiB SSD;
- `gobadminton.ru` и `www.gobadminton.ru` указывают на этот IP.

Germany backend host:
- device: `vmi3510488`;
- public IPv4: `169.58.183.182`;
- более мощный shared host;
- `dev-api.gobadminton.ru` указывает на этот IP.

## Не решено владельцем

Юридический оператор/privacy/возраст, точная шкала уровня, финальная коммерческая модель, production data-residency, бюджет долгосрочного hosting, iOS store-login и сроки платформ остаются отдельными gates.

Размещение frontend в РФ **не решает само по себе** вопрос хранения персональных данных: пока primary DB находится в Германии, public real-data launch требует отдельного legal/data-residency решения.

## Supersession

OD-010 фиксирует split-host MVP topology и отменяет промежуточную идею размещать весь стек на московской VPS.

OD-011 supersedes OD-008 **только в части execution host**: Implementation больше не обязан выполняться через PLAN. Germany VPS `vmi3510488` — primary execution host; PLAN остаётся recovery/reference. GitHub остаётся durable project record.

Временный GoBadminton runtime, ранее поднятый на немецкой VPS в F-01, был полностью снят 2026-10-02 при промежуточном retarget. Код сохранён в GitHub и backend должен быть чисто redeployed, а не переписан заново.
