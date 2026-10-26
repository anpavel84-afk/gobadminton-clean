# Решения Owner — актуальная навигация CLEAN

22.10.2026: операционные решения сведены в [единый регламент разработки и PMA](../rules/ENGINEERING_OPERATING_MODEL.md). Исторические формулировки и основания сохраняются в Git. Сам реестр не создаёт машинных полномочий: нижеприведённая standing delegation действует по **прямому решению Owner от 26.10.2026**, исключительно в указанной области и с действующими gates.

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
| OD-012 | **26.10.2026 · Standing OPS Delegation.** Действующий единый PMA может через **существующий доверенный root OPS-интегратор** без отдельного Owner micro-GO на каждую root-команду и SHA выполнить штатный DEV/OPS цикл на Germany `vmi3510488`: подготовка → установка → `dry` → `apply` → `verify` → предусмотренный `rollback`. В том числе ограниченное завершение [#329](https://github.com/anpavel84-afk/gobadminton-clean/pull/329) **только** по его независимо проверенному контракту; повторная установка существующего скрипта не нужна. Предусловия обязательны: точный SHA скрипта, независимая QA PASS, применимый CI PASS, утверждённый scope, проверка живых процессов/locks/drift и состояния VPS, сохранность UNKNOWN, attempts, бюджетов, истории, backup, транзакционность, безопасный отказ, проверяемый rollback. Временный `policy` toggle — только внутри проверенной транзакции с exact restoration. **Не разрешены** произвольный root/sudo или новые права source-моделям, PROD, другие проекты/VPN, постоянное ослабление security, новые платные сервисы или обход отказов инструментов. При любом несоответствии/FAIL/платформенном отказе — остановить этот эффект и сообщить причину. Отменено лишь прежнее требование поштучного Owner GO на такие точно ограниченные root/SHA операции; контрольные gates и специальные полномочия для иных эффектов сохраняются. |

| OD-013 | **26.10.2026 · Плановая совместимость DEV/OPS версий по всей вертикали.** [Единое scoped Owner-решение](../decisions/OWNER_DECISION_DEV_OPS_VERSION_COMPATIBILITY_V001.md) обязательно для ChatGPT/Grok PMA, technical planning, author/QA, trusted OPS/Actions и каждого handoff. Разные source/dev/VPS версии штатны при доказанной эквивалентности или точном OLD→NEW; запрещено глобально игнорировать SHA, security, controller, receipts или UNKNOWN. EOM 1.4 pins не изменены этим документом; доставка в машинные capsules/OPS-код требует отдельного reviewed rollout. |

**Приоритет и согласование с EOM 1.4:** OD-012 — точное последующее решение Owner по §1 и §7 [Engineering Operating Model](../rules/ENGINEERING_OPERATING_MODEL.md), а не отдельный регламент, bypass или machine admission. Его standing-границы дополняют EOM §§1, 2.1, 3, 6.4, 7–8 и заменяют только устаревшую формулу «Owner GO на каждую root-команду/SHA» в прежних handoff/локальных инструкциях. Текст, принятые SHA-256 и установленный rules pin EOM этим документом **не меняются**. Исполнение подтверждается только фактическими receipts и независимыми gates; протокол передачи PMA остаётся прежним.

## Более поздние операционные основания

- Owner t417u/t418u/t420u/t424u: [Stage A materials](DESIGN_MATERIALS.json), approximate mockups и [scoped Style Guide supersession](../decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md); публикация не включает runtime enforcement.

- [#158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158): Actions-owned bounded train, сохранение изоляции/истории и отсутствие второго dispatcher.
- [#175](https://github.com/anpavel84-afk/gobadminton-clean/issues/175): GitHub Projects/Issues — единый backlog; сайт — read-only Owner Monitor.
- [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199): этапы и маршрутизация Cursor/Codex/Antigravity; квалификация перед активацией.
- [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211): экономная маршрутизация, Astra High не обычная QA; последующие Owner-комментарии уточняют снятие искусственного дневного cap и восстановление Cursor/Antigravity.
- [PR #212](https://github.com/anpavel84-afk/gobadminton-clean/pull/212): ревизия и единый нормативный текст по прямому поручению Owner; публикация не равна runtime применению.

Текущие DNS/процессы/версии не хранятся в этом реестре как вечные факты. Юридические, data-residency, store и финансовые решения вне подтверждённого scope остаются отдельными gates; нахождение frontend в РФ само по себе их не закрывает.

Предметные новые решения находятся в [ADR/Owner decisions](../decisions/README.md) и exact Issue. При конфликте использовать правила приоритета и supersession разделов 1/11 регламента, не старую дату snapshot как текущую authority.
