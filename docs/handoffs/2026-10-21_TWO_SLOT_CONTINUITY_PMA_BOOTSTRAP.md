# Bootstrap: продолжить два слота GoBadminton CLEAN
From: PM/integrator → новый PMA. Date: 2026-10-21.
Status: HANDOFF / незавершённая реализация; не acceptance исправления.
Source: ops/slots-commission-20261021, PR #150, исходный HEAD c95f966cf9df031f454a2c6d22d12bf0e67c0514.
Владелец Павел просит перенести продолжение в обычный Chat вместо Work. Старый чат не нужен.

## Поручение и полномочия
Довести полноценную работу двух параллельных слотов, непрерывность train при обычном продвижении DEV/исправимых CI ошибках, правдивый web-монитор с семью этапами, затем выполнить уже подготовленные продуктовые задания. Не останавливаться на аудите/подготовке. Павел разрешил реализацию, объединение дублей, продолжение admitted backlog и DEV при сохранении gates/rollback. Новые micro-GO на уже разрешённые шаги не нужны.
Первоначальная scheduled-проверка была read-only; последующие прямые поручения владельца расширили scope на реализацию. В этом handoff-чате новых runtime-изменений нет.
Перед значимой работой прочитать AGENTS.md, docs/rules/README.md, docs/rules/PROJECT_RECORD_POLICY.md, OWNER_DECISIONS, manifest/bootstrap/architecture и точные assignment rules. Germany CLI — реализация; PM — назначение, контроль, интеграция. Не выполнять модели на PLAN/личном ПК. BadmintonOpen и /srv/gobadminton — не development checkout. PROD требует отдельного Owner GO.

## Главный факт: исправление НЕ установлено
Последняя полная проверка runtime 2026-10-21T20:56:05Z:
- slot1 #151 blocked, attempt2/max3, reason Actions failed, resume_phase ci; head b9aebc69f2d61f232554d030645432ad1cf8f789; base 9d3e092cc30796ffc0096c50584a771e60c18ef3; done_count34.
- slot2 #152 done, attempt1, head 4977074ee7b45ea612dde592b88b354d99839aea; done_count1.
- DEV last GitHub check 20:39Z: 4977074ee7b45ea612dde592b88b354d99839aea.
- /etc/gobadminton-slots/continuity.json ABSENT; continuity.pending ABSENT.
- Live autonomous_issues.py SHA256 0b367097be3aa5596327ebec14807b6f8ca39904e6a7279dbcb67b057c23f293.
- Live slots.py SHA256 4fc51152b0f8a5bc97743101feca7e5f5e97c7ad791d6783def0b3bd3d6324b7.
- Live /usr/local/sbin/gb-ops/codex-review SHA256 8f627b8945255d1a251703e87f4aad8f0634b448d4685c7ddab96681bf52b8a4.
Fresh snapshot/services/self-tests НЕ доказывают работающий train. Нельзя сообщать «возобновлён» без реального продвижения.

## ОДИН АКТИВНЫЙ АВТОР — проверить первым
Remote Desktop Commander device 72512700-e395-40b8-8f6c-9dc3f675b8c6, VPS vmi3510488.
На проверке handoff: outer PID1815915 ещё bash S, elapsed14:12; финальный лог пуст. Не убивать и не запускать дубликат.
Команда уже запущена:
printf '%s\\n' 'slots-continuity-v4.md slots-continuity-v4' | /usr/local/sbin/gb-ops/codex-ops > /var/lib/gb-ops-stage/files/slots-continuity-author4.log 2>&1
Brief /var/lib/gb-ops-stage/files/slots-continuity-v4.md; durable docs/prompts/slots-continuity-v4.md at c95f966.
Input /var/lib/gb-ops-stage/ops-src/slots-continuity-v4.
Sandbox /var/lib/gobadminton-clean-prompt-writer/ops/run.3NL7rz.
Его tmp/core-tests.log:170 tests OK; tmp/commission-tests.log:8 tests OK. Это авторская самопроверка, НЕ независимый review.
Wrapper ограничен 3600s; финальные notes/patch/meta появляются под /var/lib/gb-ops-stage/ops-patches/slots-continuity-v4-<UTC>-<pid>/. Сначала проверить PID, лог, точный финальный артефакт. Не брать изменяемый sandbox за финальный результат.

## Почему train остановился / #155
Issue https://github.com/anpavel84-afk/gobadminton-clean/issues/155.
#151 (PR153) CI push39640478582: web typecheck test/games-map-module-loading.test.tsx(46,33), TS2349 captured.loader (NextLoader union, не всё callable). Нужна корректная typeof-проверка, без any/suppression/удаления теста.
Owner RESUME6321988371 привязан к head b9… attempt2 mode ci_fix; старый resume отказывает, потому что #152 уже продвинул DEV. Не сбрасывать историю/бюджет/attempt и не создавать второй RESUME без анализа существующего.
#152 (PR154) QA PASS, CI39639481114 7/7; DEV receipt /var/lib/gobadminton-deploy-evidence/dev.json ACCEPTED r39642935622-a1, source497…, pendingfalse.
Исполнитель уже умеет merge нового DEV после зелёного CI; отсутствует правильный recovery CI при DEV drift.

Требуемая политика: bounded repair в том же immutable scope и оставшихся попытках; nonforce merge latestDEV, новая QA/CI на exactSHA и обычный DEV ACCEPTED; bounded retry только доказанно идемпотентных read/network waits. Исчерпанные QA/CI и доказанный clean merge conflict — policy deferred (не done и не fake Owner PARK), слот свободен для независимой admitted задачи. Dirty/unknown mutation, changed auth/transport/history, uncertain promotion/deploy остаются failclosed. История, leases, бюджеты и QA/CI gates сохранены.

## Review failures и V4
V2 installer dc4e3d52a86f7b06d1fc6145c787cfe34292c6c11ccee3cd9772ebf9cca3ab6b: independent FAIL Rule7 — failed service startup блокирует rollback.
V3 installer 6e909fbf0abc0c7292e39444cf83ae289895d8a1e9b7fb893795c2fcb1b213cb:160+8 self-tests; independent review3 FAIL:
1) --remove отвергает frozen units, recovery после interruption застревает.
2) первый worker может начать авторство до успешного старта остальных units; второй startup failure оставляет активного writer и невозможный rollback.
Ни V2, ни V3 НЕ устанавливались. Текущий staged installers/slots-continuity.sh всё ещё V3; НЕ запускать его.
Reports preserved at c95f966: docs/workbench/slots-continuity-20261021/references/installer-review{1,2,3}-FAIL.txt.
Review3 source: /var/lib/gb-ops-stage/ops-patches/review-slots-continuity-20261021T203421Z-1743404/notes.txt.
Review2 auth-scope finding был отдельно документирован для неизменённого нормального browser PIN login; реальные Rule7 ошибки НЕ waived.

V4: persistent root-managed /etc/gobadminton-slots/continuity.pending, schema GB_CONTINUITY_PENDING_V1. Runtime constructor FIRST waits before state/lease/budget/API/model; supervise тоже. Новые workers запущены, но заблокированы до подтверждения всех startup/health, durable journal и финального unlink barrier. No marker = обычное поведение. Frozen/failed recovery только доказанно безопасный; активных writers не убивать. DRY без managed writes/service effects. Catchable signals around final activation; после выпуска writers нельзя откатывать под ними.
V4 меняет slots.py; autonomous_issues.py и три monitor payloads должны оставаться V3-identical. Точный итог проверять по notes/diff. Независимый review ещё НЕ получен.

## Установка: обязательный порядок
1. Получить finalized V4, проверить diff/notes/tests и hashes; устранить реальные находки.
2. Stage exact installer /var/lib/gb-ops-stage/installers/slots-continuity.sh; fresh independent review через codex-ops: stdin 'review-installer slots-continuity'. Только exact PASS автоматически allowlists SHA.
3. Исключения /etc/gb-ops/review-exceptions.d/slots-continuity.txt root:root0644 <=16KB сейчас scoped V3SHA. Перенести только exact candidate SHA в уже разрешённых узких scopes: обычный own SSH/Codex login, nonroot fetch/test утверждённого repo, неизменённый browser PIN login/logout. Никаких секретов/копирования credentials/изменения auth. Не расширять scope ради обхода review.
4. gb-run stdin 'install slots-continuity dry', затем 'install slots-continuity' только exactPASS+успешныйDRY+безопасная quiescence. Не direct-copy payloads и не обходить installer. Lock /run/gobadminton-slots-continuity.lock отдельный от gb-run outerlock.
5. Проверить actual hashes, root policy, removed barrier, healthy/enabled 3units, сохранённые state/history/budgets и recovery evidence.
6. Только после установки exact runtime — approved literal metadata helper ниже.
7. Только после runtime compatibility — immutable task admission #156/#157 и проверка РЕАЛЬНОГО продвижения151 и второго слота.

Managed files: /usr/local/lib/gobadminton-slots/{autonomous_issues.py,slots.py}, /usr/local/lib/gb-ops-monitor/opsmon/{slot_telemetry.py,writer.py}, /usr/local/lib/gb-ops-monitor/web/app.js, /etc/gobadminton-slots/continuity.json. Backup/journal /var/lib/gobadminton-slots-continuity/managed.json.

## Metadata pin helper: старый PASS устарел!
Существующий /var/lib/gb-ops-stage/installers/slot-review-continuity-meta.sh SHA57400728a9fdccdae9957a8097bca156db6a9d74a31473d10321a2c6edeef5be имел PASS+DRY, НО НЕ применён и НЕ подходит для V4 slots.py. НЕ устанавливать.
Шаблон scripts/chatops/parallel-slots/slot-review-metadata.sh. Механически заменить только 2 literal runtime pins в codex-review: liveold autonomous0b…/slots4fc… на FINAL reviewed runtime SHA; beforewrapper8f627…; вычислить afterwrapper. Не менять validation/instructions/admission/auth/QA.
V3 autonomous new hash9995d0f268185c56d91cd0e15f986905abf093feb07c6edffec0c9b211e2fec7; V4 проверить.
Устаревший V3 slots hash1b4708b6ff64071074399cfcfd3c4c73f93501efdcd9266e9dafc61b927fb98c.
Сделать новый exact independent review+DRY helper, scope exactbefore/after в существующем slot-review-continuity-meta.txt (root0644), затем apply после установки совпадающего runtime. Это metadata-only, не разрешение bypass.

## Продуктовые задачи: ready definitions, НЕ admitted
Обе последние0comments на20:39Z. Issue body не исполняется автоматически. Тела уже независимо reviewed на DEV4977074e; перед admission проверить свежийDEV и exactbytes.
Durable exact artifacts at f6ffac0789220529aae2c582d12bc5b83ff80588, docs/prompts/:
- #156 venue-popup-owner-v5.body.txt; SHA25621b0bbc2ecdf9a695e076118378523d9e0114f987b1c0bf18543c56576c2713e.
  Stage /var/lib/gb-ops-stage/files/venue-popup-owner-v5.body.txt.
  MOZHNO report /var/lib/gb-ops-stage/reviews/venue-popup-owner-v5.body-4977074e-20261021T195238Z.txt, SHA4e1fcf5d19cb03566503bae910db747c77cdc1e49fa9634301a0f35730fce922; durable workbench references/venue-popup-review5.txt.
  9paths, max3, locks web:venue-popup + web:game-create.
- #157 ui-close-owner-v4.body.txt; SHA256cc6ed0d9227c3052d19e90863427b422659f0c4a28c66f24d14e998a9bd7e30b.
  Stage /var/lib/gb-ops-stage/files/ui-close-owner-v4.body.txt.
  MOZHNO report /var/lib/gb-ops-stage/reviews/ui-close-owner-v4.body-4977074e-20261021T200625Z.txt, SHA83ddcca807e5ebbe457f94361912949019bd786dedbb985b068946a985ff3dcc; durable references/ui-close-review4.txt.
  14paths,max3,locks web:modal-close + web:venue-popup; modelgpt6.1-sol/high.
Use original exact passed body, НЕ REVISED_BODY из отчёта. Публиковать без prefix/suffix отдельным immutable Owner-comment, проверить actualauthor318610566/exactSHA/uniqueadmission. Не редактировать после claim. GitHub add_comment tool принимает issue в pr_number.
156/157 пересекаются и выполняются последовательно;151 может идти параллельно156. Queue status не равен claim/running.

Owner requirements156: картинки игр в списке/расписании площадки; информация карточки карты как target: адрес/описание/удобства/контакты правильными блоками; меньшая текущая высота фото допустима. Не выдумывать отсутствующие контакты/рейтинг/галерею/amenities. Создание игры из карты — внутри popup, сохранить контекст карты, не переход в общую страницу.
157: единый CloseButton для проекта на canonical pattern: native44pxwhitecircle, dark24SVGstroke2, React19typedref; пятьmodal/sheets, сохранить handlers/focus/busy; существующие тесты менять минимально.
Точных screenshot attachments в scratch может не быть; утверждённые задания и frozen guide содержат спецификацию. Не выдавать отсутствие demo contacts за сломанную интеграцию без source/API анализа.
Style Guide first! /opt/gobadminton-clean-qa/style-guide, root-readonly58entries. src/App.tsx SHA04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c; src/index.css SHAf660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a. refs/FRONTEND_STYLE_GUIDE_FIRST_V001.md SHAd0339e1505047a4080d3eb7e7b95c23a034cfc8333623c550bb55c035d689fb9. Reference archive50f5a4473f8ed4ca133eac1d406d6745f589383a не authority импортировать legacycode.
Независимая codeQA и rendered browservisual390/430/1440 отдельно. SSR/self-tests не browserPASS. Продуктовые изменения156/157 ещё НЕ реализованы.

## Runtime и монитор / бэклог
Units gobadminton-slot@slot1.service, gobadminton-slot@slot2.service, gobadminton-supervisor.service включены; max_parallel2,poll240. Old observedPIDs79318/79319/79320 не использовать без freshcheck.
Repos /srv/gb-slots/slotN/repo; task worktrees /srv/gb-slots/slotN/worktrees/issue-N; bothorigin /srv/gb-slots/base.git. ExplicitGitHub READ/WRITEtransport; не заменять origin наугад и не повторять alternates-preflight: собственные objects уже repacked.
States /var/lib/gobadminton-autonomy/slots/slotN/state.json.
Outboxes /var/lib/gobadminton-autonomy/outbox/slotN/{status.json,telemetry.json,ledger.json}.
UIDs agentagency-dev1002,gb-slot2978,supervisorgb-slots-supervisor979,sharedlocks supplementaryGID65042. Не менять другиеgroups/VPN.
PublicAPI sharedspacing65s; no resets/bypass. Budget30author/30QA daily host AND perslot, не менять. Internalbudget не равно OpenAIaccountquota.
Snapshot /var/lib/gb-ops-monitor/snapshot.json. Lastsource_mode slots,source_oktrue,backlog.availabletrue; slot1FRESHblocked151,slot2FRESHdone152. Telemetry30s,fresh<=90s. Свежее время публикации не гарантирует работающий процесс. Seven-stagebar уже существует; V4 согласует integrating+truthfulQA/CI.
PublicV1 activekeys строго issue,phase,attempt,head,base,integration,locks,allowed_paths,depends_on; не добавлять reason/wait/deferred вV1.
Public web dev.gobadminton.ru; OPS normalbrowserPIN, не читать/переносить PIN или обходить auth.
Backlog /var/lib/gb-ops-titles/{backlog_ru.json,titles_ru.json},grokops1003,0644.
34auditentries не 34admittedtasks; дубли/grouping уже представлены.156priority0,157priority1,впланах/queuedfalse, пока не admitted. Старые taskIDs не удалять.151 Игры и152 Radar — разные поверхности, одинаковое описание не доказательство дубля.
Strict loaders writer.load_titles_strict/load_backlog_strict(path,{0,1003}), parenttemp+CASoldbytes+atomicreplace+preserveowner. URL вtitletext режет SECRET_RE.
#149 M2R+M2R-G объединённый draft с APIprivacypermissions ещё требует review; НЕ ready/admitted. Не отправлять старыйweb-onlybody. Новый brief /var/lib/gb-ops-stage/files/M2R-complete-149.brief.md.
Baseline /var/lib/gb-ops-stage/files/continuity-preinstall-baseline.json и durable references/preinstall-baseline.json:34legacydone +14manualparked,152separatedone1. Не сбрасывать.

## Durable evidence и Git workflow
Workbench docs/workbench/slots-continuity-20261021/README.md — хронология; этот handoff уточняет старые промежуточные записи.
c95f966cf9df031f454a2c6d22d12bf0e67c0514 содержит V4brief +reviewfails.
f6ffac0789220529aae2c582d12bc5b83ff80588 содержит final156/157bodies/reports.
Есть исправленные Node24 monitorfixtures (syntheticclassName default и outdatedidleexpectation), references/node-monitor-checks.txt. Не затереть их неизменёнными старыми CJS изV4input; productionpayload они не меняли.
Worktree /srv/gobadminton-clean/worktrees/ops-slots-commission-20261021; branch ops/slots-commission-20261021; draftPR150. Доhandoffчистый.
Git от agentagency-dev с own repoSSHidentity /home/agentagency-dev/.ssh/gobadminton-clean-chatops-ed25519 и known_hosts, HOME/PATH явные. Не печатать keys. Push explicit git@github.com:anpavel84-afk/gobadminton-clean.git, не origin (origin локальный /srv/gobadminton-clean/repo/.git). Без force; не стирать чужую работу.
Сохранять свои prompts/reviews/handoffs в GitHub, exactcommitpermalinks. Новыйчат не должен просить Павла переносить логи вручную.

## Первый bounded action нового PMA
Через Remote Desktop Commander прочитать current PID1815915 +author4log+итоговый ops-patches, fresh state/hash/service/barrier/DEV. Если идёт — не дублировать. Если закончен — получить exactfinalV4 и передать независимому installerreview; послеPASS продолжить порядок выше.
При недоступности RDC честно сообщить точный отсутствующий доступ, не объявлять установку или запуск. Не создавать новуюautomation.
Отчёт Павлу коротко по-русски: что фактически установлено/работает, blocker, следующий конкретныйшаг, нужно ли его действие. Не отчитываться только намерением и не называть author selfcheck независимым PASS.
