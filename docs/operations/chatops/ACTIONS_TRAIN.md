# Actions-owned train — техническая карта

Нормативный источник: [единый регламент](../../rules/ENGINEERING_OPERATING_MODEL.md). Основания: [#158](https://github.com/anpavel84-afk/gobadminton-clean/issues/158), [#199](https://github.com/anpavel84-afk/gobadminton-clean/issues/199), [#211](https://github.com/anpavel84-afk/gobadminton-clean/issues/211). Этот файл не утверждает текущий installed pin или состояние процессов.

## Источники реализации

На default branch код контроллера не копируется: ссылки ниже указывают exact принятую dev-ревизию, а не установленный runtime.

- [train-dispatch.yml](../../../.github/workflows/train-dispatch.yml) — bounded reconcile.
- [train-stage.yml](../../../.github/workflows/train-stage.yml) — один ограниченный этап.
- [core.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/0da396b4dcd5eefceb0cae11ba118cc1941fb53a/scripts/chatops/actions_train/core.py) — закрытый wire contract, проверка и маршрутизация.
- [stage.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/0da396b4dcd5eefceb0cae11ba118cc1941fb53a/scripts/chatops/actions_train/stage.py), [receiver.py](https://github.com/anpavel84-afk/gobadminton-clean/blob/0da396b4dcd5eefceb0cae11ba118cc1941fb53a/scripts/chatops/actions_train/receiver.py) — этап и серверная граница.
- [manifest.json](https://github.com/anpavel84-afk/gobadminton-clean/blob/0da396b4dcd5eefceb0cae11ba118cc1941fb53a/scripts/chatops/actions_train/manifest.json) и проверенные host receipts — происхождение bundle/установки, не interchangeable evidence.

Читать конкретную принятую ревизию, а не брать latest из старого текста. Код на ветке, зарегистрированный workflow, checkout SHA workflow и установленный root pin могут различаться.

## Этапы

| Этап | Результат |
| --- | --- |
| claim | Проверенный admission, ownership/lease, task worktree |
| author | Ограниченный source candidate; не independent QA |
| publish | Разрешённая публикация exact branch/PR |
| qa | Отдельная защищённая проверка exact SHA |
| ci | Наблюдение обязательных runs/jobs и конкретных отказов |
| integrate | Контролируемая интеграция; обновлённый candidate проверяется по действующим gates |
| promote | Разрешённое продвижение прошедшего candidate в dev |
| dev | ACCEPTED, live meta/smoke и достоверное завершение |

Recovery — ограниченные diagnose/task_review и существующие процедуры; не бесконечный новый scheduler. Events/queues — сигналы, не источник допуска. Реальные tasks/checkpoints/journals должны переживать потерю или повтор события. Не отменять активный этап ради нового reconcile.

## Защита и версии

Сохранить существующую схему trusted control workflow, проверенный checkout/pins, restricted DEV channel, минимальные token permissions и разделение candidate от secrets. Event registration на main не является разрешением запускать privileged candidate checkout или расширять environment protection. При расхождении нужный способ обновления определяется действующим reviewed OPS путём.

Не менять bundle/pins, права, limits или installed runtime по документации. Root/OPS installer имеет отдельный exact review и rollback; active/unknown work сначала согласуется по штатной границе. Никогда не сбрасывать checkpoints/attempts/ledgers.

Маршруты выбирать по полному [регламенту](../../rules/ENGINEERING_OPERATING_MODEL.md), но фактическую executable способность — только по установленному registry и свежему role-specific proof. Отсутствующая в коде поддержка остаётся gap с remediation; таблица target не включает её автоматически.

Первоначальная спецификация #158 с V6 pins, старой таблицей Codex-only и историческими install-примерами сохранена в Git и [карте ревизии](../../workbench/rules-revision-20261022/REVIEW.md); не использовать её как текущую инструкцию установки.
