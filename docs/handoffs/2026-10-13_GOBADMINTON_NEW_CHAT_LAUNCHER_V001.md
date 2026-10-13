# GoBadminton · OWNER → NEW CHAT LAUNCHER · 2026-10-13 v001

**Purpose:** Paste the entire text in the block below as the **first message of the next chat** (within GoBadminton Project). The detailed companion is [FULL SUPERVISOR HANDOFF](./2026-10-13_GOBADMINTON_FULL_SUPERVISOR_HANDOFF_V001.md). This launcher is a GitHub versioned artifact, not a new project or a substitute for current GitHub/host checks.

---

## COPY-PASTE PROMPT FOR NEW CHAT (RU)

~~~text
OWNER DIRECT · GOBADMINTON · CONTINUE EXECUTION AFTER CHAT HANDOFF

Роль: мой основной Supervisor / Advisor по существующему продукту GoBadminton. Это ПРОДОЛЖЕНИЕ старой работы, не новое проектирование. Даю сквозное разрешение на обычные работы внутри согласованного объёма на DEV: организовать Runner, инженеров, независимую QA и реальные поставки на DEV. Не проси микро-GO для каждого шага. Production — только после отдельного моего принятия конкретного релиза.

ПЕРВОЕ ОБЯЗАТЕЛЬНОЕ ДЕЙСТВИЕ: открой через подключённый GitHub плагин (а не публичный web) оба документа из нового приватного GitHub:
1. Ланчер: https://github.com/anpavel84-afk/gobadminton-clean/blob/main/docs/handoffs/2026-10-13_GOBADMINTON_NEW_CHAT_LAUNCHER_V001.md
2. ПОЛНЫЙ handoff 13 разделов: https://github.com/anpavel84-afk/gobadminton-clean/blob/main/docs/handoffs/2026-10-13_GOBADMINTON_FULL_SUPERVISOR_HANDOFF_V001.md

Сверь там точные ссылки, результаты QA, VPS, Git SHA, GitHub Issues, устройство безопасности, фактическое состояние Runner, карту, аватары, модерацию и старые исторические PR. Не отвечай по догадкам; прочитай полный handoff и затем проверь LIVE Git/host. Если инструмента нет, скажи точный блокер, не имитируй выполнение.

Исходная точка, ПРОВЕРЕННАЯ 13.10.2026 около 11:28 UTC:
- Канонический новый private GitHub anpavel84-afk/gobadminton-clean main fd9a667ea2a21a81469a38079c8e8ee2ac5181af; исторический anpavel84-afk/gobadminton — архив. НИКОГДА не переносить 551 старую задачу в Runner или переписывать старый Git.
- Runner: Германия vmi3510488, unit gobadminton-clean-runner.service active/enabled/unpaused, параллелизм 2. Состояние IDLE, tasks=6 и все enabled=false, history=0, active=0. PR #11 с новым принятым source MERGED (merge SHA 16ab3e2a...) и PR #17 с шестью source/QA заданиями MERGED (merge SHA fd9a667...), но установленный executable runner.py всё ещё старого blob 58c7e1c6... вместо принятого 1a5aa2a4...! Не запускать до его корректной установки и commissioning защищённой QA/Publisher.
- ТОЧНЫЙ БЛОКЕР: mcp__Remote_Desktop_Commander__write_file отклонил подготовку /root/gb-clean-runner-main-install-20261013.sh, ошибка "This tool call was blocked by OpenAI's safety checks. Please double check what you are sending." Скрипт НЕ записался, установленный Runner НЕ обновился. Не пытайся обходить этот отказ через другой executor, упаковку или канал: найди официальный разрешённый путь и продолжай другую допустимую работу.
- В новом Git активные Owner Issues: #12 Friends, #13 Radar карта/кнопка/площадки/consented people, #14 уже реально размещённые немецкие MapLibre assets, #15 фотографии создателей в карточках игр. Шесть producer + independent QA заданий зафиксированы в clean main, выключены до настоящего Owner-bound допуска.
- Реальный DEV https://dev.gobadminton.ru (Next.js Web + API + отдельный PostGIS и media в Германии). В DEV 20 синтетических игроков, 20 тестовых игр, 105 площадок, рабочая модерация OpenAI и подтверждённая владельцем смена аватара. Production site https://gobadminton.ru; Moscow Web ↔ Germany PROD API использует отдельный XHTTP v2. Не менять PROD, чужие VPS и частный VPN.
- НОВЫЙ Runner Monitor уже переехал, доступен https://dev.gobadminton.ru/runner-monitor/; старый https://gobadminton.ru/runner-monitor/ отдаёт 302 туда. Монитор read-only и показывает НОВЫЙ немецкий Runner.
- КАРТОГРАФИЯ: 1 038 файлов точной Moscow MapLibre/PMTiles версии проверены по SHA и реально размещены в Германии DEV. Стиль https://dev.gobadminton.ru/map-assets/releases/moscow-20261007-p4-098a869f-v001/style-dev.json HTTP200; PMTiles byte-range HTTP206. Но оригинальный manifest=CANDIDATE_NOT_REGISTERED, mapId отсутствует; КНОПОЧКА КАРТА и реальные venue/person pins в интерфейсе ещё не включены: нельзя говорить, что Radar закончен. Privacy: человек на карте только после активного согласия на геопозицию, с серверными TTL/блокировками.
- БАГ созданных игр: организатор показывается как кружок с инициалами из DiscoveryGameCard, даже если фото профиля уже обновлено. Нужны безопасный author-avatar DTO, изображение в My Games/Created Games, fallback, QA, DEV.
- Friends: в историческом PR #198 уже существует foundation (0032_friendship_core.sql, service, controller, policy, тесты). Повторно использовать source с адаптацией к clean main, а не писать с нуля. Нужна отдельная независимая QA, consent/privacy/idempotence, затем реальная публикация на DEV.
- Reader GitHub SSH access read-only и отдельный Publisher deploy key write dry-run уже проверены на Германии. НО root-protected clean QA policy/issuer не установлен, отдельный Publisher service inactive, Autopilot masked; нельзя фабриковать QA PASS, менять disabled tasks вручную в обход guard, выдавать источник за релиз или включать продакшн.

ТВОЯ БЛИЖАЙШАЯ ЦЕЛЬ: устранить официальный инсталляционный блокер, установить точный принятый Runner source с backup/rollback на оригинальном немецком хосте, настроить независимый root QA verifier и единый guarded Publisher, затем допустить настоящий Friends S1 + Radar Map (по разным locks — api/db и web/map) через два слота Runner, Avatar — после освобождения конфликтующих locks. Получить НЕЗАВИСИМУЮ QA точных SHA, реальное обновление DEV и браузерное доказательство. Если заблокирован — продолжай допустимые код/QA/подготовку и назови ровно один следующий разрешённый шаг.

Требования к взаимодействию: говори со мной по-русски, краткие конкретные отчёты со ссылками и реальными exit codes; работай самостоятельно, не подменяй работу отчётами. Не копируй в чат/GitHub приватные ключи, OpenAI API key, пароли, session cookies, реальные персональные данные. Старые R1/R2 FAIL должны оставаться историей. Первый ответ: коротко подтверди прочтение handoff и LIVE-сверку, после чего ПРОДОЛЖАЙ ИСПОЛНЕНИЕ.
~~~

---

## HOW TO USE

1. Create new chat **in the existing GoBadminton Project**, ideally with tool-enabled configuration.
2. Paste the entire text from **COPY-PASTE PROMPT FOR NEW CHAT** above. You may also simply paste the URL of this GitHub launcher and write "Продолжай по этому handoff" if the new chat can read the connected private GitHub.
3. If the new chat cannot access private repo by URL, connect the existing GitHub plugin. Do not try to obtain private repository sources via ordinary public web search.
4. The companion FULL HANDOFF documents exact files, issue numbers, operative rollback and evidence. The new Supervisor should read it first, then independently re-check current GitHub/host state before making claims.

**Owner direction is one continuous DEV delivery.** The next chat should NOT start another planning-only cycle or ask Owner to repost all prior history.
