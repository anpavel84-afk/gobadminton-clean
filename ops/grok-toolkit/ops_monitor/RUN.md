# Как поставить OPS · Монитор (5 шагов)

1. **Скопируйте файл** `gb-ops-monitor-install.sh` на немецкий VPS, например с вашего компьютера:
   `scp gb-ops-monitor-install.sh root@<адрес-VPS>:/root/`
   (или вставьте его содержимое через Desktop Commander в файл `/root/gb-ops-monitor-install.sh`).
2. **Запустите на VPS** (под root):
   `sudo bash /root/gb-ops-monitor-install.sh`
   Сначала можно пробный запуск без изменений: `DRY=1 bash /root/gb-ops-monitor-install.sh`.
3. Когда спросит **PIN**, наберите PIN (PIN здесь не хранится: см. приватное хранилище OPS на box, /home/box/.private/monitor_pin.txt, или спросите у Павла лично) и Enter. На экране символы не видны, это нормально.
4. В конце скрипт покажет проверки. Откройте на iPhone **https://dev.gobadminton.ru/ops-monitor/**, введите PIN, затем Safari → «Поделиться» → «На экран Домой».
5. **Остановить:** `sudo systemctl stop gb-ops-monitor-web` (страница перестанет открываться).
   **Удалить полностью:** `sudo bash /root/gb-ops-monitor-install.sh uninstall --purge-config --purge-data`.

Исполнитель задач и приложение GoBadminton монитор не затрагивает. Если что-то пошло не так, пришлите мне последние строки вывода.
