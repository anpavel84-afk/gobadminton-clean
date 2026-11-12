# V1: план установки OPS (не выполнено, нужен отдельный Owner GO)

## Состав
| Файл | Куда | Кто может |
|---|---|---|
| `executor_validate_issue.diff` (патч `scripts/chatops/autonomous_issues.py`) | репозиторий, ветка `ops/pm-routing-v1`, потом установка от root | только OPS: путь вне зоны автора; нужен GO |
| `pm_map.py`, `test_pm_map.py` | `scripts/chatops/` и `scripts/chatops/tests/` | то же |
| `gb-pm-map.service` + `.timer` (ниже) | `/etc/systemd/system/` | root |
| Блок «Карта связей» в мониторе (installer v4) | через существующий установщик с хешем | root, как v2/v3 |

## Шаги
1. Ветка `ops/pm-routing-v1` от актуального `dev`: патч, `pm_map.py`, тесты. Автор и QA разные сессии, исполнитель в это время не трогается.
2. Независимая QA точного SHA: проверить, что diff касается только `validate_issue` и констант; что старые 53 теста проходят; что новые тесты падают на старом коде (негативные контроли); что `pm_map.py` не импортирует executor и не пишет в state_dir.
3. CI 7/7, слияние в `dev` по обычному пути. Документацию (`docs/operations/chatops/AUTONOMY_PM_MAP.md`) кладёт только OPS-ветка.
4. Установка (root, по образцу RESUME/PARK): бэкап текущего `autonomous_issues.py` и хеш `state.json`/`parked.json`; **ждать, пока слот свободен** (phase done или нет active); положить файлы; перезапустить `gobadminton-autonomy` только в свободный момент; проверить `state.json` без изменений и службу active.
5. Служба карты (нет сети нужна только для api.github.com):
   `gb-pm-map.service`: `User=__EXEC_USER__`, `ExecStart=/usr/bin/python3 /srv/…/pm_map.py --module /srv/…/autonomous_issues.py --state-dir <state_dir> --out /var/lib/gb-pm-map/pm_map.json`, `ProtectSystem=strict`, `ReadWritePaths=/var/lib/gb-pm-map`, state_dir только чтение, без Landlock-расширений.
   `gb-pm-map.timer`: каждые **10 минут** (6 запросов в час; исполнитель уже тратит публичный лимит 60/ч с одного IP, см. риски).
6. Монитор v4: писатель монитора без сети, поэтому он только читает `/var/lib/gb-pm-map/pm_map.json` и кладёт сжатую копию в `snapshot.json`; страница показывает пары и причины. Установка тем же способом: хеш, копии, откат.

## Откат
Вернуть сохранённый `autonomous_issues.py`, удалить `pm_map.py`, остановить и отключить таймер, вернуть монитор v3. Задачи с новыми полями после отката будут отвергнуты как `unexpected task fields`, поэтому **до отката** Issues с полями не публиковать или припарковать.

## Приёмка
a) Issue без новых полей идёт как раньше. b) Issue с `locks`/`depends_on` проходит валидацию и claim, поля не влияют на порядок. c) Issue с опечаткой в поле не берётся и видна в «отклонённых». d) Карта обновляется, хеш стабилен без изменений. e) Расход лимита API не растёт выше 40 запросов/ч в сумме.
