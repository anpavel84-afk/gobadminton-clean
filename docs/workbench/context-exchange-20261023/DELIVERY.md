# Контекст между агентами — готовый пакет правил, исходников и офлайн-проверки

**Owner-directed, 23.10.2026. SOURCE_PREPARED / OFFLINE_VERIFIED. NOT_INSTALLED.**

Павел поручил Advisor глубоко изучить опыт подобных систем, спроектировать оптимизированную передачу контекста и подготовить изменения правил/кода самостоятельно. Работа выполнена в отдельной временной копии на Germany, без вмешательства в текущий PMA и AGY canary. Это запись передачи, не новый регламент, scheduler или machine admission.

## 1. Доставленные файлы

Полный пакет хранится в **существующем** Artifact Hub проекта; бинарный Git bundle не коммитится в GitHub. HTTPS скачивание bundle и отчёта проверено по SHA-256. Git bundle импортирован в отдельный чистый проверочный репозиторий, конечный commit совпал.

- [Исследование и архитектурное решение](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/RESEARCH_AND_DESIGN.md)
- [Подготовленная полная редакция единого канона 1.3](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/ENGINEERING_OPERATING_MODEL-1.3.md)
- [Машиночитаемые измерения и результаты](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/REPLAY_REPORT.json)
- [Передача PMA небольшими этапами](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/PMA_HANDOFF.md)
- [Git bundle с exact коммитами](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/context-exchange.bundle)
- [Полный исходный diff](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/context-exchange.patch)
- [Manifest файлов](https://files.anpavel.ru/projects/gobadminton/engineering/context-exchange-20261023-509d462/MANIFEST.json)

**Граница публикации:** серверный проектный SSH-ключ подтвердил read-only и отказал feature push; права/ключи не менялись. Поэтому этот PR регистрирует проверенный bundle, а не притворяется source PR с уже опубликованными runtime-коммитами. Полный source diff находится в bundle/patch, не в двух файлах этого PR. GitHub SHA-ссылки на непубликованные коммиты не фабрикуются. Слияние одного этого delivery PR не устанавливает оптимизацию и не меняет канон.

## 2. Главные факты аудита

Проверен exact source `ff0acea256d6f4717f2c5f8853128e7893150625` и read-only installed controller `3ce9a1339a73e1c9b3fb2ca5b269483faf2fc4f8`.

1. Реальный AGY analysis initial payload: **63 015 semantic bytes**, **63 542 wire bytes**. Принятый полный регламент1.1: **57 544 bytes**, то есть **91,32% нашего начального payload**. Это не доля полного provider context с его tools/history. ~305КБ ранее были synthetic transport fixture. Total27 122tokens не переобозначены input tokens.
2. `native_antigravity.collect` собирает полные changed files, dependencies, AGENTS и diff. Есть конечная transport-граница, но нет эффективного гибридного reference-backed отбора. Просто удалить исходники недопустимо: это снова даст INCOMPLETE.
3. В `failure_diagnosis.prompt_for` current inputs повторяются внутри только что созданного pending receipt и старых receipts. Исправлена именно model-facing projection, без изменения history/fingerprints/расходов.
4. Журнал `antigravity-addressed-upgrade.json` (~3,78МБ в момент сверки) содержит preservation path/hash maps, а не модельный контекст. Его текущий reader fix остаётся работой PMA. Содержимое журнала не отправлялось модели.
5. Причинная связь размеров с зависанием Work/ChatGPT **не доказана**. Нужны отдельные timings подготовки, очереди, CLI, tools/provider и доставки ответа. Мы не обещаем, что уменьшение байтов само устранит Connection interrupted.

## 3. Что взято из практики других систем

Исследованы первичные материалы: [Anthropic context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents), [multi-agent research](https://www.anthropic.com/research/multi-agent-research-system), [code execution/MCP](https://www.anthropic.com/research/code-execution-with-mcp), [OpenAI handoffs](https://openai.github.io/openai-agents-python/handoffs/), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [compaction](https://developers.openai.com/api/docs/guides/compaction), [LangChain context engineering](https://docs.langchain.com/oss/python/langchain/context-engineering), [DeepAgents subagents](https://docs.langchain.com/oss/python/deepagents/subagents), [GitHub artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data), [Cursor rules](https://cursor.com/docs/rules). Полное сопоставление применимого/неприменимого — в исследовании, дата просмотра23.10.2026.

Общий принцип: persistent state не равен model context. Получатель получает необходимый результат предыдущего этапа, а не всё исследование/все tools. Upfront task/criteria сочетаются с actual-readable artifact retrieval. Стабильный prefix полезен для поддерживаемого provider cache, но кеш не сокращает сам контекст и не переносится между клиентами. GitHub Actions — транспорт/исполнение, не автоматический селектор текста для модели. Новый SDK, хранилище, очередь или LLM-summarizer не устанавливаются.

## 4. Реализованное решение

В исходном пакете новая чистая stdlib-функциональность `context_exchange.py`:

- механическое извлечение common+role capsule **из того же принятого канона**, с проверкой хеша, без платного пересказа;
- fresh stage packet: exact task/acceptance, source identity, essential evidence, краткие предыдущие briefs и artifact references;
- дедупликация идентичного blob при сохранении всех путей;
- large-file reference только после доказанного чтения exact материала identity получателя; иначе полный inline fallback, не исчезновение данных;
- явные excerpts больших tool results только при сохранённом полном artifact; exit/failed assertions/NOT_TESTED не скрываются;
- байтовые метрики и nullable фактические tokens/cache; без bytes/4 под видом тарификации;
- новая projection Astra current failure и prior briefs без вложенных копий inputs.

В существующем `failure_diagnosis.py` projection уже подключена **в подготовленном source**. В `context_policy.inject` добавлены metrics и opt-in scoped profile с полным default fallback. Существующий stage/native AGY пока не выбирает scoped profile автоматически. Hybrid source reference utility реализован и проверен, но actual-recipient materialization/consumer wiring остаётся небольшим rollout-шагом, не объявляется действующим.

Обновлены тот же `ENGINEERING_OPERATING_MODEL.md` (§10/11), AGENTS и PMA checklist. **Сохранены Owner continuity/delegation/native-tools решения proposed1.2 из PR235**, а не возвращена старая1.1. PR237 Artifact Hub policy не перезаписана. Общий человеческий канон стал100818bytes: нельзя объявить экономию от установки этого файла в full-only consumer. Приёмка compact delivery и проверенный доступ к полному канону нужны вместе. Редакция1.3 пока prospective.

## 5. Проверки и измерения

- **14 новых адресных тестов** структуры, exact task/criteria, происхождения правил, fallback, отсутствия потери предыдущих FAIL/UNKNOWN и state mutation.
- Существующий полный набор train: **447 tests, OK, один прежний skip**, 10,218s. Не независимая QA и не real-provider canary.
- Первый полный прогон обнаружил старый хеш правил в synthetic one-shot descriptor; исправлен только prospective fixture, отрицательная проверка неверного hash сохранена. Real grants не менялись.
- Foundation static PASS и diff-check PASS.
- Policy capsule: author3726bytes, QA3939, diagnosis3566; прежний full rules57544. Это сокращение **блока правил**, не всего оплаченного вызова.
- Синтетический repeated-diagnosis пакет: **98497→26193bytes, −73,41%**; текущая ошибка/доказательства и пригодные прежние briefs сохранены. Не обещание такой же экономии tokens/latency.
- **0 provider calls** этой работы. Source/script checks выполнялись обычным Python на изолированной Germany-копии.
- Git bundle verify и fresh import: PASS; HTTPS bytes/hash: PASS. В package есть воспроизводимый `docs/workbench/context-exchange-20261023/offline_replay.py`.

## 6. Exact source lineage и безопасное принятие

Base: `ff0acea256d6f4717f2c5f8853128e7893150625`.
Сохранён второй parent с решениями PR235: `7ded6ac5f9108b950c887d9953380006dbd70817`.
Doc commit: `03d2d7af4ff600bccd95881c4125d02419c3b675`.
Payload C: `bffedbc5f3e3820fe1476b777858043f3cdd8b6b`.
Ref-only release R: `730b0a7d9a1f21c0d4333e420112bb85980be7ab`.
Final tested source: `509d462b2fcae5e018770622aac43245bab2c5d9`.

Существующий C→R механизм сохранён: doc object существует до context pin; manifest/hash tests согласованы; R меняет только четыре checkout refs в двух существующих workflows. Никаких новых workflow/services. Старые root artifacts, live pins, grants, attempts, usage, UNKNOWN и PROD не менялись.

Bundle SHA256: `1ab807ebdbc3cd4f3affa78874e15890ebcccd58e19569309ef79166f3567836` (51800bytes).
Patch SHA256: `7723adcd0a03b0a7a3b647c10d5cbc415cc312ec04d3a21c241885172ef250d9` (166161bytes).
Full proposed rules SHA256: `38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c`.

**Следующий шаг PMA — только принять пакет**, не проектировать заново: скачать/сверить hash; `git bundle verify` в отдельном разрешённом checkout с base objects; импортировать HEAD в новую source-review ветку; проверить diff/тесты и опубликовать существующим доверенным write-каналом. Bundle требует objects ff0acea… и b0e4d233… из CLEAN; не трогать активный worktree. Импорт — не merge/deploy/новый допуск. Точный код уже готов.

После source review и обычного CI — отдельный маленький rollout шаг: actual-recipient rules/source read probe, затем одна новая разрешённая роль с compact profile и реальными quality/usage/timing результатами. Не менять grant текущего AGY canary. Не принимать этот docs PR как доказательство установки source. Не сливать позднее старую1.2 поверх принятой1.3.

Refs #199, #211, #218, PR #235, #236, #237. Это продолжение существующей системы, не второй PMA.
