# Acceptance matrix v1

Статус: **DESIGN_DRAFT**. Это критерии будущих проверок, ни одна строка не означает пройденный тест. Источник семантики: [инварианты](../domain/STATES_AND_INVARIANTS.md).

| ID | Сценарий | Ожидаемое доказательство |
|---|---|---|
| Q-01 | Гость ищет игру по времени/городу/уровню | Только public published results; пагинация ограничена; player PII отсутствует |
| Q-02 | Вход VK и Яндекс | Оба реальных test flows возвращают внутренний User; повторный вход стабилен; MAX/Сбер не предлагаются |
| Q-03 | OAuth replay/mismatch | Истёкшие/повторные state/code, неверный verifier/provider/redirect отвергаются |
| Q-04 | Identity collision/link | Совпадение email не объединяет аккаунты; явный linking требует reauth; unlink последнего метода не разрешён |
| Q-05 | Два менеджера подтверждают последнее место | Только один confirm; второй conflict; INV-02 сохраняется при серии параллельных запусков |
| Q-06 | Confirm конкурирует с cancel | После обеих операций нет confirmed в cancelled Game; audit/outbox соответствуют committed state |
| Q-07 | Изменение externalReservedCount/capacity | Capacity никогда ниже occupied; pending не занимает место; external participants не требуют PII |
| Q-08 | Double tap / transport retry | Один текущий Participation; idempotency key с другим payload даёт conflict; retries не удваивают событие |
| Q-09 | Чужие resource IDs | Игрок A не видит/не меняет заявку B; organizer A не управляет игрой B; guessed UUID не обходят scope |
| Q-10 | Отзыв organizer membership | Sensitive command после revoke не проходит через старый client cache/session role claim |
| Q-11 | Share/unlisted | Ссылка открывает нужную карточку, не создаёт membership/confirm; unlisted отсутствует в discovery/index |
| Q-12 | Deadline/withdraw | Confirm/request после deadline запрещены; withdraw до начала освобождает ровно одно подтверждённое место |
| Q-13 | Истечение времени | Ни held, ни attendance не выставляются автоматически; unknown outcome виден в метриках |
| Q-14 | Часовые пояса/география | Москва и второй timezone, DST ambiguous time, lon/lat/radius units проверены на fixtures |
| Q-15 | Деньги первого этапа | Только external terms, null и zero различаются; нет charge/refund/payout endpoints или кнопок |
| Q-16 | Outbox crash/replay | Повтор обработки не меняет бизнес-статус; stale notification не противоречит актуальной отмене |
| Q-17 | Web/mobile cache/session | Нет private data после logout/account switch; tokens не в URL/localStorage/logs; server rights проверяются |
| Q-18 | Полный mobile journey | iOS и Android: system-browser login, cold deep link, process restart, slow network, keyboard, font scaling |
| Q-19 | Удаление аккаунта | Reauth/revoke, organizer ownership handling, media/identity cleanup и повтор deletion после restore |
| Q-20 | Backup + rollout | Восстановление в чистое окружение, измеренные RPO/RTO, отсутствие повторных side effects |
| Q-21 | Privacy/abuse | Scoped moderation, report/support path, redacted logs, upload SSRF/XSS tests |
| Q-22 | Измерение пилота | Click/request/confirm/attend различаются; retries дедуплицируются; unknown и new-client evidence не скрыты |

QA выбирает exact строки для bounded slice и добавляет regression зависимости. Полная матрица не означает требование запускать stores/платежи при каждом PR. Независимый QA foundation: пока **не выполнен**.

## Post-game extension

[PG-Q01…PG-Q18](../delivery/POST_GAME_DELIVERY_V001.md#independent-acceptance-matrix) — обязательная расширенная матрица для [ADR-0018](../decisions/ADR-0018-POST-GAME-OUTCOMES-FEEDBACK.md): time/unknown, canceled arrival, bulk/version races, notices/disputes, anti-censorship, audience isolation, typed reports, migration/rollback и mobile flow. Статус NOT RUN; требуется independent QA exact implementation SHA. Q-05…Q-10/Q-13/Q-16/Q-17/Q-20/Q-21 остаются regression dependencies.
