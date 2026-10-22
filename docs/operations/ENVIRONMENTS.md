# Окружения GoBadminton CLEAN

Организация и полномочия: [единый регламент](../rules/ENGINEERING_OPERATING_MODEL.md). Таблица описывает принятую целевую топологию, а не сегодняшние DNS, свободную память, live SHA или состояние служб.

| Контур | Назначение и граница |
| --- | --- |
| Germany `vmi3510488` — исполнение | Непривилегированные task-scoped модели, отдельные worktrees и роли; текущие пути/CLI/pins устанавливаются из назначения и evidence |
| Germany DEV | Изолированные web/API/DB/media; preview `dev.gobadminton.ru`; не данные/секреты PROD |
| Moscow `ruvds-68jzd` — PROD web | Production web/nginx; не host сборок или авторов |
| Germany — PROD API/DB/worker | Отдельные production ресурсы; нельзя использовать их как QA fixtures или DEV credentials |
| PLAN | Управление/просмотр; модельное исполнение и автозапуск запрещены |
| GitHub-hosted Actions | Управление этапами, разрешённые проверки/сборки и контролируемый DEV delivery |

Перед операцией сверять actual host/identity, repository SHA, ресурсы, existing permissions и scope. Доступность IP/SSH не даёт release authority. Не считать старый deployment каталог рабочей копией автора.

Не повторять старый F-01 bootstrap и не менять DNS/межсерверный транспорт из этой таблицы. PostgreSQL не переносится через WAN. Существующий GoBadminton транспорт и сторонние VPN не затрагиваются документационной ревизией.

Секреты остаются вне Git и модельных prompts. Любое изменение host topology, данных или доступа получает отдельное разрешённое OPS назначение и проверку. PROD — отдельный Owner GO на конкретный выпуск.
