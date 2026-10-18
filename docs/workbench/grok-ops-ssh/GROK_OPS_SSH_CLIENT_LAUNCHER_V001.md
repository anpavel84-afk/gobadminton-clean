# GO BADMINTON · GROK BOT OPS · SSH CLIENT ENROLLMENT · V001

Ты — Grok Bot, будущий единственный OPS-оператор GoBadminton. На немецкой VPS серверная часть отдельного SSH-доступа уже подготовлена и прошла локальные тесты. Нужен твой собственный клиентский публичный ключ. Первая задача — закончить клиентскую половину подключения без изменения серверных процессов.

ВАЖНО: работай в терминале СВОЕГО PERSISTENT GROK CLOUD COMPUTER, не на моей VPS, не на PLAN, не в Cursor Cloud Agent, не в GitHub Actions. Не используй оплачиваемый Cursor Cloud для этого.

ПОДТВЕРЖДЁННЫЕ ПАРАМЕТРЫ:
- SSH сервер: 169.58.183.182
- Порт: 22
- User: grokops
- Host: vmi3510488, Германия.
- Аутентификация: только SSH Ed25519 publickey, пароль выключен.
- У Grok ещё НЕ установлен authorized client key: это ожидаемое состояние.
- Серверный ED25519 HOST PUBLIC KEY:
  ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHnaKJ4RJFVxO+Dh97ipC4bvTLQUMtQ8TbGLrzmSkNfB
- Подтверждённый SSH host fingerprint:
  SHA256:8U2knzPaWcyp8xa40hnDX+Xk4xhc0r9OnwG44kgoFT4
- Публичная known_hosts строка:
  169.58.183.182 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHnaKJ4RJFVxO+Dh97ipC4bvTLQUMtQ8TbGLrzmSkNfB

СЕРВЕРНАЯ ПОЛИТИКА:
- Учётная запись grokops изолирована и не имеет root, docker или группы действующего исполнителя.
- Через неё можно открыть SSH-терминал под собственным UID и читать безопасный OPS-статус.
- Единственная разрешённая команда с чужим UID:
  sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status
- Она только читает живой checkpoint / state и выдаёт ограниченный JSON; не запускает модели.
- Нельзя менять рабочие source worktrees, private checkpoint, locks, QA, PROD и сервисы.
- Не создавать второго writer или новый Codex процесс поверх существующего.

ВЫПОЛНИ СЕЙЧАС В ТВОЁМ ОБЛАЧНОМ ТЕРМИНАЛЕ:
1. Проверь, доступны ли ssh и ssh-keygen и что терминал работает на твоём cloud computer.
2. Создай НОВУЮ выделенную пару Ed25519:
   umask 077
   mkdir -p "$HOME/.ssh"
   chmod 700 "$HOME/.ssh"
   Если файл "$HOME/.ssh/gobadminton_grokops_ed25519" уже есть — НЕ перезаписывай, сначала проверь, что это правильный ключ.
   Иначе:
   ssh-keygen -q -t ed25519 -a 64 -N '' -f "$HOME/.ssh/gobadminton_grokops_ed25519" -C "grokbot-gobadminton-ops"
   chmod 600 "$HOME/.ssh/gobadminton_grokops_ed25519"
   chmod 644 "$HOME/.ssh/gobadminton_grokops_ed25519.pub"
3. Получи единственную ПУБЛИЧНУЮ строку:
   cat "$HOME/.ssh/gobadminton_grokops_ed25519.pub"
   А также fingerprint:
   ssh-keygen -lf "$HOME/.ssh/gobadminton_grokops_ed25519.pub" -E sha256
4. Добавь ровно подтверждённую публичную known_hosts строку выше для 169.58.183.182. Если уже есть другая key binding для этого же host, ОСТАНОВИСЬ и сообщи конфликт: не отключай StrictHostKeyChecking.
5. Не печатай содержимое PRIVATE файла. Не пересылай private key, не копируй его в GitHub, чат, документы или screenshots, не устанавливай на VPS и не давай другому боту более высоких прав.
6. Ответь только: CLIENT_PUBLIC_KEY=[полная строка ssh-ed25519 ...], CLIENT_KEY_FINGERPRINT=[SHA256:...], CLOUD_SSH_AVAILABLE=[YES/NO], HOST_KEY_PINNED=[YES/NO], READY_FOR_SERVER_ENROLLMENT=[YES/NO]. Эти поля не являются секретами.
7. ОСТАНОВИСЬ до серверного подтверждения установки твоего публичного ключа в authorized_keys. Никому не проси root-пароль, GitHub PAT или старый Codex OAuth.

ПОСЛЕ СООБЩЕНИЯ О SERVER ENROLLED:
- Проверь SSH соединение со СВОЕГО облачного компьютера, строго по pinned host key:
  ssh -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -i "$HOME/.ssh/gobadminton_grokops_ed25519" grokops@169.58.183.182 'id -un && hostname && sudo -n -u agentagency-dev /usr/local/bin/gb-grok-status'
- Подтверди, что id -un = grokops, hostname = vmi3510488, статус имеет текущие issue/phase, и что это НЕ статус скопированный из bootstrap.
- Укажи проверенное UTC-время, не раскрывай секреты, не запускай моделей и не пиши в state.
- Ошибка Permission denied после ENROLLED: вернуть только код ошибки, НЕ отключать host checking, НЕ создавать новую identity/secret.
- Если из Grok cloud нет выхода на 169.58.183.182:22, сообщи NETWORK_BLOCKED и способ диагностировать; не открывай публичные дополнительные порты на VPS самостоятельно.
- После успешного входа действуй как OPS наблюдатель. Операционное управление разработкой остаётся у единственного утверждённого server executor; расширение команд — отдельный этап с security review.

SERVER SOURCE / HANDOFF:
https://github.com/anpavel84-afk/gobadminton-clean/blob/f9a2ac8de488997f619aadb348b301b8ac78978d/docs/workbench/grok-ops-ssh/GROK_OPS_SSH_SERVER_HANDOFF_20261018_V001.md

ПРИМЕЧАНИЕ ПО БЕЗОПАСНОСТИ:
Все Grok Bots данного пользователя используют один shared cloud computer и общее credential storage. Поэтому этот ключ даёт только ограниченный VPS SSH-доступ, а НЕ права agentagency-dev, root, Docker, секреты Codex, доступ к QA-state или PROD. Не считать отдельное имя бота границей безопасности.
