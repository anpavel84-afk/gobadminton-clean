# Завершение игры: архитектура и вход для всех агентов v001

**Product: OWNER_CONFIRMED. Architecture: TECH_SELECTED. Implementation: NOT_IMPLEMENTED by this package.**
2026-10-18 UTC. Repository: anpavel84-afk/gobadminton-clean.
Source baseline: dev @ af210f82e65ab028f8e06927a88175d1ac373c31; это не свидетельство deployed SHA.
[Owner decision](../decisions/OWNER_DECISION_POST_GAME_MODEL_V001.md) · [ADR-0018](../decisions/ADR-0018-POST-GAME-OUTCOMES-FEEDBACK.md) · [API](../api/POST_GAME_CONTRACT_V001.md) · [PM/Implementation/QA](../delivery/POST_GAME_DELIVERY_V001.md).

## 1. Результат и границы

Сценарий: организовать → встретиться → явно сохранить итог/посещение → исправить ошибку → обменяться приватной обратной связью/решить проблему → по желанию пригласить снова.
Не новый рейтинг, соцсеть или административная CRM. Весь первый законченный scope Owner утверждён; PM вправе делить реализацию, но не выбрасывать отзывы/оспаривание как «не MVP».

Точка входа организатора: Мои игры → Управляю → игра → Участники / Итоги.
Участник: Мои игры → история → своё участие/обратная связь, включая утрату чата.
Текущие экраны, navigation, Radar, DM и дизайн-система не переделываются.

## 2. Проверенный baseline / gap

Все пути ниже относятся к exact baseline выше.

| Evidence | Что установлено | Не считать готовым |
|---|---|---|
| docs/domain/MODEL.md, STATES_AND_INVARIANTS.md | Attendance/outcome разделены, time != held, audited correction | Пользовательский post-game flow |
| apps/api/src/games/games.controller.ts; packages/contracts/openapi.json | В просмотренном controller create/publish/cancel/read; в OpenAPI нет attendance/outcome/review путей | Эти новые API |
| apps/api/src/games/game-authority.service.ts | game_managers + active owner/manager, Game fence для revoke | Глобальную organizer authority |
| apps/api/src/safety/safety.service.ts; migrations/0008_profiles_safety_directory.sql | player-only abuse report, reason/detail/evidenceRefs; state submitted/closed; PairFence | game/review/attendance targets, reporter progress workflow |
| migrations/0031_support_cases.sql | support_cases, report/game links, audited actions; evidence synthetic_minimal/internal_synthetic_v1, immutable trigger | Реальные evidence/retention/independent resolution |
| apps/api/src/common/outbox.service.ts | Запись outbox_events с переданным PoolClient | Работающую доставку новых notice types |
| apps/api/src/inbox/inbox-compose-sql.ts | Dynamic DM/invitation/game-chat composition | Новый пост-игровой counter или право открыть закрытый чат |

Нужен schema-first additive implementation. Перед каждым slice перечитать актуальный dev и изменения после baseline; не откатывать чужие исправления. Исторические docs о состоянии БД/hosting не источник текущего runtime.

## 3. Владение и минимальная модель

В одной PostgreSQL и одном Nest backend, без отдельного deployment.
Предлагаемые имена таблиц — технический контракт модели; SQL migration IDs выбираются на актуальной ветке, не резервируются этим документом.

| Record / owner | Поля и ограничения |
|---|---|
| game_participant_contexts / Sessions | UNIQUE(game_id,user_id), participation_id, eligibility_source/version, expected_at_start, prior confirmed relation; минимальные ID/время, не копия профиля |
| game_outcomes / Sessions | game_id PK, value held/not_held; отсутствие строки = unknown; reason обязателен для not_held; actor/source/at/version |
| attendance / Sessions | UNIQUE(game_id,user_id), context_id FK, value unknown/present/absent, late nullable только для present, actor/source/at/version; отсутствие строки проецируется unknown/version=0 |
| post_game_revisions / Sessions | append-only revisions для outcome/attendance: typed FK ровно один, resource_version UNIQUE, actor/source/time, before/after, correction reason; исходная история не редактируется |
| attendance_disputes / Sessions | attendance_id, challenged_version, author=self, explanation, state open/resolved/withdrawn, resolution/revision refs; максимум один open на attendance |
| attendance_acknowledgements / Sessions | UNIQUE(attendance_id,user_id,attendance_version), acknowledge current assertion; не boolean на все будущие версии |
| personal_game_notes / Feedback | author/game/subject context, plain text, version/timestamps; UNIQUE(author,game,subject); ACL author-only |
| game_reviews / Feedback | kind peer/organization/training, game, author, recipient; peer subject context; rating enum либо organization score 1–5, comment/tags optional, provenance, version, edited/visibility state |
| review_replies / Feedback | review_id UNIQUE, author=recipient, plain text/version/edited marker; наследует ACL parent |
| abuse_reports / Safety | существующий ресурс + typed game/attendance/review context, target kind расширяется согласованно с DB/API; reporter-safe progress projection |
| support_case_links / Trust | existing report/game links + attendance_dispute/review при необходимости; без нового case engine |

Review constraints: peer UNIQUE(game,author,subject,kind), author != subject; organization/training UNIQUE(game,author,kind), recipient не часть uniqueness (смена ответственного не даёт второй голос). Peer enum только play_again/neutral/difficulties. Skip = отсутствие review. organization score nullable; нужна хотя бы оценка либо непустой comment. Training отдельный kind, доступен только trainer-led; не вводить оценку техники/новую шкалу без отдельного контракта.
Review edits сохраняют ограниченную revision history, не создают новые голоса; moderation hide — отдельное reasoned audited действие. Для notes не нужен бессрочный журнал всех текстов.

Внешние места externalReservedCount не дают fake accounts/персональную attendance. Не включать внешний агрегат посещения в первую реализацию без отдельного UX-контракта.

### Исторический контекст

Нельзя определять права на отзыв/исправление только по текущему status=confirmed.
При post-game command материализовать context под Game lock из реальных Participation/transitions. expected_at_start определяется подтверждением, действовавшим на startsAt: withdrawn/removed/cancelled раньше исключаются; pending/rejected/invite не ожидаемые игроки.
После включения функции transitions сохраняют достаточные данные для восстановления контекста; нельзя переписать его поздним remove. Проверить наличие полной transition history на текущем source.
Если у старой игры история неполная, eligibility=unknown; не выдумывать expected roster. Разрешить заявить собственное участие для рассмотрения, но не объявлять его подтверждённым. Самодельный импорт списка людей запрещён.

Context не доказывает физическое присутствие. Creator initial seat лишь такая же Participation; неиграющий менеджер не получает peer eligibility. Existing initial seat policy не меняется этой задачей.

## 4. Команды и состояния

### GameOutcome

Нет записи → held / not_held только явной командой текущего GameManager после endsAt.
Позже/dismiss изменяет только собственное напоминание, не outcome.
published после endsAt + record outcome → completed по existing lifecycle; outcome change на completed — audited correction с reason, без reopening.
cancelled остаётся cancelled. Можно записать not_held explanation; held для cancelled — только отдельная case-scoped adjudication с объяснением фактического расхождения, без возобновления записи/переписывания отмены.
not_held не создаёт/стирает attendance; существующие записи сохраняют provenance и никогда не считаются дисциплинарной статистикой.
Unknown attendance разрешена при любом outcome; completion не требует «отметить всех».

### Attendance

unknown ↔ present ↔ absent — явные versioned assertions, не изменение Participation/capacity.
present возможен при сорвавшейся встрече, включая arrived-after-cancellation контекст; для не ожидавшегося человека нужен реальный prior participation + явный arrival source, не создание новой заявки.
absent допустим только для expected_at_start, после endsAt, если outcome != not_held и Game не cancelled. До завершения встречи нельзя преждевременно записать no-show.
Заранее отказавшийся/удалённый не может стать absent. Новое значение unknown — явный сброс ошибочного утверждения с историей.
late optional boolean; observed arrival time только если действительно известен. Нет auto «не предупредил».

Bulk present: клиент передаёт точные context IDs и expected versions, показанные в подтверждении, не «все неизвестные на сервере». Вся пачка одна transaction; чужой/устаревший ID откатывает всё. Конкурентно появившиеся люди не включаются автоматически. Ограничить размер пачки текущим допустимым roster/page policy.

### Возражение и исправление

Участник видит actor/value/time/source, свою историю и текущий dispute. Agree фиксируется для конкретной версии. Disagree создаёт open dispute с explanation/challenged_version; не открывает DM и не требует friendship/social opt-in.
Изменение отметки не удаляет спор. Менеджер предлагает correction с reason; open dispute остаётся, пока участник явно не принимает текущую версию/не отзывает возражение либо независимый case reviewer не разрешит спор.
Менеджер не может закрыть disagreement простым reaffirm absent. Чужой сотрудник, сам автор отметки/участник конфликта, не независимый reviewer.
Истечение времени/нет ответа/прочтение notice не закрывают спор. Поздняя correction/request доступна; нет hard expiry.
Если reviewer не назначен, статус остаётся «На уточнении», без обещания SLA и негативных последствий.
Staff resolution идёт через Sessions command с caseId и privileged audit, не SQL UPDATE из Admin.

## 5. Review eligibility без власти организатора над отзывами

Сервер проверяет связи, а не «любой UUID из каталога». Перед submission автор явно подтверждает собственный опыт.
- Peer: author/subject имеют game context; author заявляет совместную игру. При held + обе present без открытых споров provenance=manager_attested (не independently_verified).
- Если attendance unknown/absent/disputed либо outcome неизвестен/оспаривается: разрешить contextual submission с provenance=self_attested/contested. Пользователь должен описать расхождение при противоречии. Это не исправляет attendance/outcome.
- not_held без оспаривания факта совместной игры: peer-as-played не принимается; доступен organization review/report. Если автор заявляет ошибку outcome и совместную игру, принимается contested record с объяснением, не verified claim.
- Organization: prior applicant/participant, в том числе withdrawn/rejected/cancelled, может оценить реально пережитые организацию/коммуникацию; интерфейс отделяет «организация/отмена» от «сыграли». Manager-only без участия не становится независимым отзывателем самого себя.
- Training: только actual trainer-led context с опытом занятия; disputed submission сохраняется аналогично, но не выдаётся за проведённое занятие. Наличие TrainerProfile у peer не меняет kind.

Вся обратная связь private; никакой публичной публикации или скрытого влияния на recommendations/ranking. Eligibility/provenance пересчитывается при correction и отражается при чтении, не уничтожая авторскую запись.
Нельзя требовать добровольного agree от обоих игроков для подачи — это даст адресату право вето.
Recipient organization review фиксируется из game responsible manager context (по умолчанию game owner на момент записи; не произвольный user ID). Передача ответственности — явная audited операция; не раздавать историю всем новым co-managers. Если адресат ушёл/удалён, автор сохраняет запись; case-scoped support, не автоматическое расширение аудитории.

## 6. Права и видимость

| Действие/данные | Автор/сам участник | GameManager | Другой игрок/гость | Staff |
|---|---|---|---|---|
| Roster/attendance list | Только собственная строка | Текущий scoped manager | Нет | Только case scope |
| Outcome | По разрешённому Game/context read | Write с version/authority | Только уже разрешённые сведения Game, без roster | Case command |
| Своя attendance/history/dispute | Read/agree/disagree, после ухода из чата тоже | Review/correct, не единоличное разрешение спора | Нет | Case scope + audit |
| Private note | Только автор CRUD | Только собственные заметки | Нет | Нет общего доступа |
| Peer review/reply | Автор + адресат | Не получает доступ из manager role | Нет | По конкретному обращению |
| Organization review | Автор + фиксированный ответственный адресат | Не все co-managers | Нет | Case scope |
| Report | Reporter receipt/status/собственное дополнение | Не получает дело автоматически | Нет | Scoped reviewer |

Account/session authentication обязательна. Restricted account не теряет recourse только из-за ограничения social/chat capability: нужен узкий authenticated correction/report capability; suspended login — безопасный support recovery channel, не bypass auth.
Чужие private IDs → одинаковый 404; no-store; count/pagination не раскрывают roster. Не добавлять private text в public profiles, analytics, logs, push или generic Game DTO.
Block не лишает собственных записей, dispute/report/обратной связи. Отзывы не должны становиться обходным бесконечным чатом: одна запись/один reply, rate limits, нет DM доставки, управление уведомлениями адресата и report на злоупотребление.

## 7. Транзакции, уведомления, гонки

Использовать существующие MutationRunner, actor/session fence и insert-first idempotency; не переписывать общий протокол.
После identity/idempotency — Game FOR UPDATE → game_managers при manager command → context/attendance/outcome/review (stable IDs) → revisions/dispute/notice intent/receipt.
Не добавлять обратный захват Game после dependents. Existing Safety player report держит PairFence без Game. Новые contextual report commands не требуют PairFence: не меняют social pair; contextual authorization под Game/target fence. Если будущее решение потребует оба lock, сначала отдельный global lock-order review всех callers, не импровизация.
Никаких network calls под SQL lock.

Для каждой attendance revision в той же transaction записывается durable in-app notice (или реализуемый receipt-backed notice record), с UNIQUE(recipient,attendanceId,version,type). Failure notice insert откатывает assertion. Existing outbox enqueue недостаточен, если consumer для него отсутствует.
Notice source можно читать из собственного account history немедленно после commit. External push optional через текущую job infrastructure: crash/retry не дублирует бизнес-команду, stale push ведёт к актуальной версии. push copy нейтральный, без обвинения/содержимого спора.
Correction/outcome/dispute/review events содержат IDs/version/type, без comment/explanation текстов. Staff case access отдельно audited. Нет новой crypto key hierarchy/шифрования сообщений на уровне приложения; TLS, штатные storage protections, authz и redaction обязательны.

## 8. UI / My Games

Во время встречи primary action present; остальные через secondary menu. После конца held/not_held/later + roster, partial unknown допустим. Показывать «отмечено N из M» отдельно от количества confirmed seats.
Один Game-group «Подвести итоги» в attention. После сохранённого outcome не заставлять закрывать все unknown ради исчезновения badge: неполноту показывать внутри, пользователь может dismiss reminder. Review invite optional.
Показывать source «Организатор отметил», disputed badge и доступное исправление, не «система доказала».
Unknown response/offline → «не удалось подтвердить сохранение», same idempotency intent + reread; не новый голос/отметка. Смена account/logout очищает private cache.
Использовать существующие визуальные компоненты по Style Guide first. Не вводить новый root section.
«Сыграть ещё» использует собственный play_again список; предложение следующей Game и formal invitation требуют отдельного подтверждения и актуальных permissions/block/capacity. Никакого auto-follow/join/invite.

## 9. Safety extension и real-data gate

Не заводить второй Report service. Расширить existing targetKind typed player/game/attendance/review, проверять context consistency и row-level read/report permission. Game target может не иметь target_user_id: constraints/DTO расширяются additive, нельзя подставлять фиктивного пользователя.
Evidence refs не скачивать на backend автоматически (SSRF); no new uploads. Report status submitted/in_review/needs_information/closed в reporter projection; не раскрывать staff notes/чужие evidence/reporter identity target.
Cancelled/rejected context допускается для report; наличие жалобы не доказывает нарушение.
Support 0031 пока synthetic-only: до real-user review необходимо разрешённое расширение evidence policy, case roles, data retention/deletion и operator runbook. Не снимать immutable triggers и не переименовывать реальные данные в synthetic ради прохождения gate.
Private note никогда автоматически не evidence; автор отдельно явно подаёт нужные факты.
No automatic sanctions. Независимый resolution не обещается до назначения ответственного; сохраняются disputed status и отсутствие вредящих эффектов.

## 10. Миграции / rollback / измерение

Additive migrations, immutable старые SQL. Empty DB + previous-schema upgrade + repeat + restore на synthetic fixtures.
Не backfill attendance/outcome по времени, confirmed или приглашению; историческое отсутствие данных = unknown.
Review/report uniqueness, typed FKs/checks, actor/recipient + created/id indexes, game/context and open-dispute indexes. Query plans/limit checks на realistic synthetic history.
Rollout: schema + contract + disabled writes → backend/notice+recourse → UI → independent acceptance → отдельное разрешённое включение. Нельзя включать absent, если нет функционального notice/read/dispute.
Rollback выключает новые обычные writes/UI, но сохраняет собственный history/correction/report/support access для уже созданных записей. No destructive down-migration/restore whole DB to erase disputes.
Retention purpose-based: notes, reviews, disputes, notices и case evidence имеют разные правила; сроки не выдуманы. Real-data gate требует owner-approved policy, privileged purge/redaction, preservation по открытому делу, backup/deletion reconciliation. Audit не оправдывает вечное хранение полного текста.
Metrics: outcome held/not_held/unknown отдельно; attendance asserted/acknowledged/disputed отдельно; feedback submitted отдельно; не превращать self-attestation в verified attendance. Новые private texts не идут в analytics.

## 11. Остаточные решения, не пересмотр модели

- Точный early-present интервал и обычные reminder/review windows: примеры 30m/72h/7d не утверждены. Без freeze — нет раннего check-in/hard expiry; команды present с startsAt, absent/outcome с endsAt.
- Operational reviewer/заместитель, канал восстановления доступа и SLA — PM/Ops до real-user exposure.
- Retention/minors/правовой доступ/real evidence policy — соответствующий release gate.
- Training-specific дополнительные вопросы/шкала — отдельная детализация; первая версия текстового training context не должна оценивать skill.
- Actual migration IDs, runtime readiness и UI component mapping — проверяются в admitted slice, не факты этого docs пакета.

## 12. Следующий шаг

PM читает [delivery pack](../delivery/POST_GAME_DELIVERY_V001.md), связывает с одним постоянным Issue/GB reference, проверяет active writer/integration hold и выдаёт первый bounded assignment. Этот пакет не запускает executor, не меняет очередь и не разрешает merge/deploy.
