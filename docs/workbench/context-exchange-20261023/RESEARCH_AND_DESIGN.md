# Контекст между агентами: исследование, проверенные причины и принятое проектное решение

**23.10.2026. SOURCE PROPOSAL / OFFLINE VERIFIED; не runtime activation и не независимая QA.**
Нормативный текст внесён в тот же `docs/rules/ENGINEERING_OPERATING_MODEL.md`, §10/11, prospective редакция1.3. Этот файл — rationale/evidence, не второй канон. Существующие standing decisions1.2 из PR235 сохранены, не заменены старой1.1. Действующий PMA остаётся единственным runtime-интегратором.

## 1. Какие системы изучены и что берём

Исследование по первичным материалам, просмотренным 23.10.2026. Это pattern transfer, не установка их SDK/платформ в GoBadminton.

| Источник | Подтверждённый механизм | Применение здесь / ограничение |
|---|---|---|
| [Anthropic: effective context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) | Содержимое рабочего окна нужно отбирать; upfront контекст можно сочетать с just-in-time retrieval; compaction/notes/subagents решают разные задачи | Exact task + необходимое evidence ядро inline; крупные доступные материалы по demand. Не сжимать authority или терять subtle constraints ради размера |
| [OpenAI Agents SDK: handoffs](https://openai.github.io/openai-agents-python/handoffs/) | Handoff по умолчанию передаёт предыдущую историю; input filter меняет модельный ввод, не обязательно durable record. Server-managed history имеет отдельные ограничения | Fresh stage view вместо всей истории; исходные записи не менять. Summary не является redaction или authority |
| [LangChain context engineering](https://docs.langchain.com/oss/python/langchain/context-engineering) | Transient model context отделяется от persistent state/tool/lifecycle inputs | Журнал контроллера не промпт. Filter/projection — отдельная чистая функция, не новая state machine |
| [DeepAgents subagents](https://docs.langchain.com/oss/python/deepagents/subagents) | Изолированная задача возвращает результат, а не обязательно весь transcript; fork и isolated-context отличаются | Автор, QA и эксперт получают свои задачи; PMA получает exact результат+refs. Не переносить авторское самоодобрение в QA как доказательство |
| [Anthropic multi-agent research](https://www.anthropic.com/research/multi-agent-research-system) | Контекст и действия subagents разделяются; coordinator получает полезные выводы | Не создаём новых агентов ради уменьшения context; используем уже существующие роли и краткие handoffs |
| [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Стабильный общий prefix может повторно использоваться; попадание в кеш надо измерять | Policy/role before dynamic task/SHA/time. CLI может не открыть cache controls/usage, поэтому UNKNOWN; не обещать перенос кеша между providers |
| [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Кеширование зависит от конкретного API/структуры контекста и cache usage | Не превращать caching в повод всегда слать всю историю. Cached input всё равно часть окна и не cross-provider memory |
| [Anthropic: code execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp) | Детерминированная фильтрация данных/вывода кодом экономит модельный контекст | Счётчики/JSON/выбор exact failures обычным Python; модель не читает 3.7МБ журнала ради подсчёта |
| [GitHub Actions artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data) | Артефакты хранят результаты и передают данные между jobs | Используем существующие Actions/Artifact Hub; это transport, не автоматический selector контекста модели |
| [OpenAI compaction](https://developers.openai.com/api/docs/guides/compaction), [Cursor rules](https://cursor.com/docs/rules) | Управление контекстом/правилами зависит от конкретного клиента | Не переносить opaque compaction другого API в AGY/Cursor. Проверенный source rules artifact остаётся один |

Общий вывод: оптимизировать **модельный вход**, а не уничтожать аудит; материализовать evidence получателю, а не заменить его недоступной ссылкой; стабильный prefix полезен лишь при поддерживаемом и измеренном кешировании. Ни один источник не доказывает причину конкретного ChatGPT `Connection interrupted`.

## 2. Что реально найдено в GoBadminton

Аудит source на exact dev `ff0acea256d6f4717f2c5f8853128e7893150625`, installed controller read-only `3ce9a1339a73e1c9b3fb2ca5b269483faf2fc4f8`.

**A. Реальный вход последнего AGY analysis.** В сохранённой phase13 записи операции `b5c03a490452401693c6f64db5775231`: semantic_input_bytes63015; stdin_bytes63542; status success; analysis_completion INCOMPLETE; Sonnet Medium. Accepted rules1.1 —57544bytes. Значит, общий регламент составляет91.32% именно **нашего initial semantic stdin**, а не обязательно полного provider context с tool definitions/history. Прежние ~305КБ относятся к synthetic transport fixture другой проверки, не к этому run. Total27122tokens из прежнего run не переобозначены input tokens. TTFT/качество/cost причинно размером не установлены.

**B. AGY source collector** (`native_antigravity.py:303–362`) берёт полные changed files, AGENTS, recursively resolved dependencies и полный diff. У него есть конечная1МиБ граница, но нет distinct prompt budget или reference-backed large-file selection. Он правильно отказывает при отсутствующем mandatory context; нельзя «оптимизировать» удалением этого условия. Opportunity — hybrid injection после доказательства recipient access.

**C. Дублирование Astra** (`failure_diagnosis.py:142–177`): `value` вставляется в current inputs, а затем тот же `value` уже находится внутри только что записанного pending receipt в `previous=c['receipts']`. Старые receipts также содержат целые inputs/history. Это доказанный source-level повтор, исправленный проектным model-facing view; история/ключи/расходы не переписаны.

**D. Журнал3.7МБ** прочитан локально только для размеров. На момент сверки3777778bytes, preserved10374entries, duplicated activation_intent map. Не передаётся по проверенному AGY model path. Это installer/recovery reader вопрос; его текущий PMA fix не перехватывается. Удвоенный write-ahead snapshot нельзя удалять вслепую.

**E. PMA interface.** Controller/model run и соединение ChatGPT — разные вещи. Документы ранее практически приглашали PMA долго собирать все данные. Теперь правило: короткая управляющая операция и durable checkpoint; provider/CI waiting остаётся на existing Actions/VPS. Перезапуск чата не отменяет неизвестную операцию.

## 3. Архитектура без новой платформы

```text
canonical rules + exact immutable task
               |
      existing trusted collector
               |
   deterministic context_exchange view
    /                |                 \
common+role     current task/evidence   verified local refs
from same canon    + brief delta        at exact snapshot
    \                |                 /
             existing CLI adapter
                     |
    concise result + hashes + actual usage
                     |
    durable FULL record retained separately
```

`context_exchange.py` не читает файлов/сеть, не запускает модели, не содержит credentials, не изменяет task state. Он компилирует роль из reviewed markers, строит packet, дедуплицирует идентичные blobs и показывает current failure/previous briefs без nested input trees. Контроллер остаётся владельцем всех admission/lease/budget/recovery решений. Участок простого инструмента excerpt не делает verdict и не заменяет failed assertion.

**Не весь пакет немедленно selected в runtime.** В source интегрирован diagnosis projection и размерная telemetry existing inject. Scoped injection реализован как opt-in keyword и имеет lossless full fallback. Native collector ещё требует actual-recipient artifact materialization/probe перед превращением source bytes в refs. Нельзя объявить адресное офлайн API готовым end-to-end transport без такого доказательства.

## 4. Почему короткий capsule не второй регламент

Full human specification остаётся одним файлом. Common и role блоки лежат прямо в нём и извлекаются verbatim проверенной функцией по sha256. Никто не просит LLM пересказывать нормы на каждом вызове. PMA при takeover и reviewers политики читают всё. Worker получает применимые базовые обязанности плюс exact task и предметные обязательства; при споре/сложной authority — full.

В consolidation добавлены сохранённые решения1.2 и подробный человеческий §10; full document теперь больше старого. Поэтому **нельзя объявлять экономию от одной установки нового полного файла**: compact delivery нужно применять вместе с проверенной доступностью полного канона/исходников. Full default оставлен для совместимости старых consumers/grants; он осознанно не выдаётся за уже оптимизированный runtime. Soft targets не блокируют задачи и не заменяют hard transport bounds.

## 5. Offline results и пределы доказательства

[REPLAY_REPORT.json](REPLAY_REPORT.json) содержит машинные размеры и воспроизводимость. Role policy текст (без wrapper/задачи): author3726, QA3939, diagnosis3566, planner3404, PMA3675, research3248bytes при full100818bytes. Это уменьшение policy block, не обещание уменьшения полного bill/latency на тот же процент.

Синтетический diagnosis fixture с24КБ assertions и тремя сохранёнными input receipts:98497→26193bytes, минус73.41%. Current task/current evidence/failure и предыдущие substantive briefs/failures сохранены; журналы не мутируются. Никаких платных provider calls. Тест проверяет структуру и поведение Python, а не cognitive equivalence модели. Один адресный independent review и маленький реальный role canary остаются до production claims.

Точки latency instrumentation описаны в каноне. В этом PR не обещаны отсутствующие provider timing/token counters. Основной replay оценивает bytes/dedup/provenance; actual speed, missed findings и cache hit проверяются в штатном запуске, не новым benchmarking service.

## 6. Совместимость и источники правил

Консолидировано поверх current dev и exact PR235 head `7ded6ac5f9108b950c887d9953380006dbd70817`: standing delegation, bounded continuation, tool permissions, отсутствие искусственных one-shot тупиков сохранены. Source из235 поверх нового AGY кода не копируется. Только его canonical/checklist/audit решения объединены с новым контекстом. PR237 Artifact Hub policy не редактируется. Doc commit → payload commit C → ref-only release R сохраняют существующую binding проверку, не вводится новый installer.

Действующие root rules, marker hashes, active grants, UNKNOWN, другие projects/VPN и PROD не затронуты. Source adoption не равен installed runtime. Подробные шаги для единственного действующего PMA — [PMA_HANDOFF.md](PMA_HANDOFF.md).

### Финальная авторская проверка

14 новых адресных тестов, существующая полная train-suite:447tests за10.218s, OK с1 прежним skip (не заявлен выполненным). Первое полное выполнение выявило hardcoded old rules hash в synthetic one-shot descriptor; исправлен только prospective unit fixture, добавлено явное отрицание неверного rules hash. Реальные historical grants не переписаны. Benchmark воспроизводится `python3 -B docs/workbench/context-exchange-20261023/offline_replay.py`. Это авторская проверка, не independent QA и не real runtime acceptance.
