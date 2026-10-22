# Решения Owner — актуальная навигация CLEAN

22.10.2026: операционные решения сведены в [единый регламент разработки и PMA](../rules/ENGINEERING_OPERATING_MODEL.md). Исторические формулировки и их основания сохраняются в Git; эта ревизия не создаёт новых продуктовых функций или runtime полномочий.

## Сохраняемые решения

| ID | Содержание и текущая область |
| --- | --- |
| OD-001 | GoBadminton и BadmintonOpen — самостоятельные проекты, без наследования runtime/данных/прав |
| OD-002 | Долгосрочная архитектура охватывает web, iOS, Android и backend; не все платформы входят в текущий slice |
| OD-003 | Москва/Россия сначала, затем расширение; география не зашивается как единственное значение |
| OD-004 | Внутренние платежи не добавляются без отдельного решения |
| OD-005 | Начальный продуктовый вход VK/Яндекс; последующие авторизации — только по отдельно принятым решениям |
| OD-006 | Технические ADR и документация допустимы в делегированном scope; текущий repo — `anpavel84-afk/gobadminton-clean` |
| OD-007 | Разрешённый Germany host — `vmi3510488`; границы shared host/других проектов сохраняются |
| OD-008 | Прежняя инструкция исполнения на PLAN отменена в части execution host; не использовать её для запуска задач |
| OD-009 | `gobadminton.ru` — домен продукта, API hostname не должен зависеть от физического host |
| OD-010 | Split-host production: Moscow web, Germany backend/DB; это не запрет отдельного Germany DEV |
| OD-011 | Модельные implementation/QA выполняются на разрешённой Германии; PLAN не является исполнителем; Git access не даёт PROD authority |

## Более поздние операционные основания

- [#158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158): Actions-owned bounded train, сохранение изоляции/истории и отсутствие второго dispatcher.
- [#175](https://github.com/anpavel84-afk/gobadminton-clean/issues/175): GitHub Projects/Issues — единый backlog; сайт — read-only Owner Monitor.
- [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199): этапы и маршрутизация Cursor/Codex/Antigravity; квалификация перед активацией.
- [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211): экономная маршрутизация, Astra High не обычная QA; последующие Owner-комментарии уточняют снятие искусственного дневного cap и восстановление Cursor/Antigravity.
- [PR #212](https://github.com/anpavel84-afk/gobadminton-clean/pull/212): ревизия и единый нормативный текст по прямому поручению Owner; публикация не равна runtime применению.

Текущие DNS/процессы/версии не хранятся в этом реестре как вечные факты. Юридические, data-residency, store и финансовые решения вне подтверждённого scope остаются отдельными gates; нахождение frontend в РФ само по себе их не закрывает.

Предметные новые решения находятся в [ADR/Owner decisions](../decisions/README.md) и exact Issue. При конфликте использовать правила приоритета и supersession разделов 1/11 регламента, не старую дату snapshot как текущую authority.
