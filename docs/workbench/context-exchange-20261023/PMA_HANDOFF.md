# PMA: применить контекстную оптимизацию небольшими шагами

**Owner поручил Advisor самостоятельно исследовать и подготовить оптимизацию. Это source/rules работа, не takeover и не новый admission. Текущий AGY independent QA / journal fix не прерывать.**

Канон: тот же ENGINEERING_OPERATING_MODEL, prospective1.3 (§10/11). Решения pending PR2351.2 сохранены; не накатывай позднее старую1.2 поверх1.3. PR237 Artifact Hub остаётся независимым и не перезаписывается.

## Уже сделано

- Новый stdlib-only `context_exchange.py`: stable rule prefix, deterministic same-canon common+role capsules, exact task+evidence packet, identical-blob dedup, actual-recipient-reference predicate, lossless fallback, explicit tool excerpt and context byte metrics.
- Existing `failure_diagnosis.prompt_for` использует projection: current evidence один раз, прежние briefs/findings без повторных inputs. Cache/fingerprint/reservation/история не изменены.
- Existing `context_policy.inject` сохраняет полный default prompt и добавляет измерения; opt-in `scoped_v1` поддержан и проверяется, но **существующие stage/AGY consumers пока его не выбирают автоматически**.
- Исследование и offline replay; проверки на exact bytes/provenance, полное сохранение task/criteria/findings, отсутствие state mutation и неразрешённого reference-drop.

## Следующее одно короткое поручение

**Предметный review нового §10/capsules и изменённых source функций, затем обычный CI.** Не аудит всех sandbox/providers. Не запускать модели ради пересказа уже готового исследования. Проверить, что сохранены Owner1.2 и прежние acceptance/UNKNOWN semantics. Установку в этой задаче ещё не заявлять.

## После review — отдельный короткий шаг

На новой допустимой QA/author операции проверить возможность передать compact profile: принятый полный rules artifact и exact relevant sources реально доступны identity получателя, hashes совпадают. Сначала маленький deterministic read probe **без модели**, без чтения credentials и без новой sandbox архитектуры. Использовать existing allowed task materialization; не давать root или новые глобальные права ради оптимизации. Если reference недоступен, full inline fallback и точный blocker: модель не тратить на повторное INCOMPLETE.

Путь включения: existing trusted launcher/context configuration, не arbitrary field candidate/task и не автоматическая догадка по имени provider. Native analysis branch имеет отдельную замену full-context role label; прежде её scoped применения заменить это строковое предположение совместимо. Старые grants/context hashes не перезаписывать. Изменение маршрута доставки для обычного нового task применять только после reviewed source/rollback-safe install.

## Затем — один реальный comparative checkpoint

Одна обычная разрешённая задача с полноценным source access, компактными правилами и свежей independent QA. Зафиксировать initial bytes, rules/source/diff shares, actual input/output/cache если exposed, tool/read completeness и длительность. PASS должен опираться на исходники и реальные результаты, не на read receipt. Провайдерные кеши не считать доступными без evidence. Обязательные gates не пропускать.

После этого переносить доказанный способ на остальные роли адресно. AGY `collect` big-file→reference включать лишь там, где actual workspace/tool access доказан. Не заменять весь diff/contracts слепой сводкой. Общие счётчики total_tokens не называть input_tokens. Timing breakdown дальше добавляется внутри existing receipts, не новой daemon.

## Чего НЕ делать

Не удалять preservation journal, не обнулять попытки, не менять grant существующего canary, не копировать все logs в PMA, не переизобретать scheduler/хранилище. Soft byte targets — ориентиры, не новые стопоры. Полный документ вырос как human specification; установка full-profile без compact consumer не называется оптимизацией. Не сливать PR235 старой редакцией после принятия этой consolidation. Не закрывать текущие OPS задачи только по наличию кода.

Отчёт на каждом шаге: exact SHA/profile → что действительно применено → bytes/actual usage → findings/непроверенное → один следующий шаг. Owner не должен переносить длинный transcript между исполнителями.
