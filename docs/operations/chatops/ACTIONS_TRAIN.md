# Actions-owned train — техническая карта

Вход — [START_HERE.md](../../../START_HERE.md); нормативный источник — [единый регламент](../../rules/ENGINEERING_OPERATING_MODEL.md). Основания: [#158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158), [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211). Эта страница не утверждает текущий installed pin или состояние процессов.

## Источники реализации

Ниже **публичные immutable ссылки на исходный snapshot `3537b19e…`**, доступные одинаково из main/dev. Они заменяют относительные ссылки на код, отсутствующий в default branch. Для исполнения требуется фактическая принятая controller/source revision текущего assignment; эта карта не выбирает её.

- [train-dispatch.yml](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/.github/workflows/train-dispatch.yml) — bounded reconcile.
- [train-stage.yml](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/.github/workflows/train-stage.yml) — один ограниченный этап.
- [core.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/scripts/chatops/actions_train/core.py) — wire contract, проверка и маршрутизация.
- [stage.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/scripts/chatops/actions_train/stage.py) / [receiver.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/scripts/chatops/actions_train/receiver.py) — этап и серверная граница.
- [manifest.json](https://github.com/anpavel84-afk/gobadminton-clean/blob/3537b19e9b26cc9fe379d46715b5e4593cf4b2fc/scripts/chatops/actions_train/manifest.json) — происхождение исходного bundle. Фактические host receipts проверяются отдельно; manifest не заменяет installation evidence.

Код на ветке, зарегистрированный workflow, checkout SHA workflow и установленный root pin могут различаться. Не импортировать product/dev runtime в main ради открытия документации.

## Этапы

| Этап | Результат |
|---|---|
| claim | Проверенный admission, ownership/lease, task worktree |
| author | Ограниченный source candidate; не independent QA |
| publish | Разрешённая публикация exact branch/PR |
| qa | Отдельная защищённая проверка exact SHA |
| ci | Наблюдение обязательных runs/jobs и конкретных отказов |
| integrate | Контролируемая интеграция; обновлённый candidate проверяется по действующим gates |
| promote | Разрешённое продвижение прошедшего candidate в dev |
| dev | ACCEPTED, live meta/smoke и достоверное завершение |

Recovery — ограниченные diagnose/task_review и существующие процедуры, не новый бесконечный scheduler. Events/queues — сигналы, не источник допуска. Tasks/checkpoints/journals должны переживать потерю или повтор события. Не отменять активный этап ради нового reconcile.

## Защита и версии

Сохранить trusted control workflow, проверенный checkout/pins, restricted DEV channel, минимальные permissions и разделение candidate от секретов. Event registration на main не разрешает privileged candidate execution или расширение environment protection.

Не менять bundle/pins, права, limits или installed runtime по документации. OPS installer требует отдельного exact review, backup/rollback и безопасной границы active/unknown work. Не сбрасывать checkpoints, attempts и ledgers.

Маршруты — §5 полного канона; фактическая executable способность — installed registry и свежий role proof. Неподдерживаемая функция остаётся implementation gap; таблица target не включает её автоматически.

Первоначальная спецификация #158, V6 pins и старые install-примеры сохранены в Git и [исторической ревизии правил](../../workbench/rules-revision-20261022/REVIEW.md); это не команда повторить установку.
