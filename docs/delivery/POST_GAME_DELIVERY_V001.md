# PM → Implementation → QA: post-game delivery v001

**Product OWNER_CONFIRMED; architecture TECH_SELECTED; NOT_IMPLEMENTATION_ADMITTED; NOT_DEPLOYED.**
From Architect to PM / Product / UI / Implementation / QA / Ops.
Source: gobadminton-clean dev @ af210f82e65ab028f8e06927a88175d1ac373c31.
Read [entry/spec](../architecture/POST_GAME_V001.md), [Owner decision](../decisions/OWNER_DECISION_POST_GAME_MODEL_V001.md), [ADR](../decisions/ADR-0018-POST-GAME-OUTCOMES-FEEDBACK.md), [API](../api/POST_GAME_CONTRACT_V001.md), root AGENTS.md and current [ChatOps route](../operations/chatops/PM-CHEATSHEET.md).

## Prompt for PM

Ты PM GoBadminton. Подготовь bounded assignments по уже утверждённой модели, не обсуждай заново необходимость отзывов/жалоб/исправления.
1. Найди существующий Issue по этой продуктовой задаче; если отсутствует, зарегистрируй один постоянный Issue/GB reference по действующим правилам. Не создавай параллельный реестр/новый runner и не дублируй старые номера. Подзадачи связаны с этим требованием.
2. Прочитай exact docs revision; перечитай текущий dev и active writer/hold. Package основан на af210f82…, это не разрешение откатить dev. Учитывай текущий integration hold; docs publication не отменяет его.
3. Зафиксируй source-gap matrix и точные contract/SQL/UI файлы каждого slice; проверь actual notification и support readiness. Не считать synthetic-only support готовым для реальных споров.
4. Получи UI delta на текущих экранах по Style Guide first. Не запускай полную перерисовку/Radar/DM изменения.
5. Заморозь bounded wire contract, text/rate limits, read projection и numeric policy по открытым пунктам. Не подменяй approval модели произвольным утверждением 72h hard cutoff.
6. Выдай первый отдельный implementation assignment только по действующим permissions и после необходимых gates; этот handoff не запрашивает немедленный запуск. Каждый следующий slice имеет отдельное разрешение.
7. Независимый QA получает exact candidate SHA, сценарии ниже, исходные approved docs, synthetic fixtures и критерии FAIL. Не разрешай автору объявлять собственную проверку независимой.
8. DEV deployment и PROD promotion — отдельные факты. PROD только отдельный Owner GO; не ставь Released/Owner accepted из существования docs/PR.

## Последовательность (весь scope обязателен, номера не queue IDs)

| Slice | Результат | Dependencies / gate |
|---|---|---|
| PG-0 | Contract/schema/permissions freeze; конкретный UI delta; migrations plan; reviewer/retention gaps recorded | Current source reconciliation; no app enablement |
| PG-1 | Sessions outcome/context/attendance/revisions; idempotent commands; durable own notices/history; self acknowledgement/dispute; manager correction | PG-0. Internal synthetic only until весь safety path готов; absent не включать отдельно |
| PG-2 | Case linkage/independent resolution; typed report contexts; safe reporter status; real-data evidence/retention/runbook | PG-1 + actual Trust capability review; не снимать synthetic constraints вслепую |
| PG-3 | Private notes + peer/organization/training feedback, one reply; eligibility/provenance/moderation | PG-1/2 contracts; privacy and abuse tests |
| PG-4 | Existing My Games/Participants/Results integration; attention grouping; full notice/dispute/review/report UX; explicit next invitation | PG-1…3; Style Guide; old-client compatibility |
| PG-5 | Independent integrated QA, allowed DEV demonstration, operational readiness and feature enablement record | Full release-unit gates; PROD separately |

PG-1/2/3 могут существовать за disabled flag; ни промежуточная кнопка absent, ни создание спорных real-user records без recourse не выпускаются как самостоятельный продукт.
Feature kill switch не должен отрезать собственные history/dispute/report уже затронутым пользователям.

## Каждый implementation prompt обязан содержать

- Issue/GB, exact base SHA and accepted spec SHA, one slice objective.
- Allowed paths/effects, non-goals, current writer lock/worktree and no parallel writer.
- Schemas/API/ACL/source-of-truth before controllers/UI; generated DTO update where applicable.
- Deterministic PostgreSQL integration tests; synthetic accounts only; no live DATABASE_URL.
- Migration upgrade/failure/restore plan; no edits to applied SQL.
- Before/after version and same-key retry semantics; access on replay.
- Rollback preserving dispute/evidence/history and no automatic deployment/PROD permission.
- Output: exact commit/PR, changed files, actual commands/results/CI links, not-run checks, risks, next bounded recipient.
- No bypassing failing tests/approval, no invented PASS or predicted runtime behavior.

## Independent acceptance matrix

Все строки ниже = REQUIRED/NOT RUN этой архитектурной работой.

| ID | Scenario | Expected result |
|---|---|---|
| PG-Q01 | startsAt/endsAt passed; no explicit action | outcome/attendance unknown, no cron held/no-show |
| PG-Q02 | held with some unknown; later/dismiss | partial save allowed; later no domain fact; one Game attention item, not N people |
| PG-Q03 | not_held/cancelled, player arrived | present allowed with context/source; no mass absent; canceled not reopened |
| PG-Q04 | pending/rejected/withdrawn/removed before start; creator only manager | not expected no-show; no automatic present; confirmed creator also unknown |
| PG-Q05 | bulk confirmation + roster change/version race | exact IDs only, full rollback on conflict; no partial-success lie |
| PG-Q06 | two managers change attendance; revoke/cancel concurrently | one current version, audited conflict; revoked writer/replay denied, correct lock order |
| PG-Q07 | duplicate command / lost HTTP response / process crash | one mutation/revision/notice; same-key recovery, different-body conflict |
| PG-Q08 | attendance notice insertion fails; delivery retries | assertion rolls back on durable notice failure; one in-app revision notice, stale push reads current |
| PG-Q09 | absent → dispute → correction → participant accept | original version/author kept; correction alone not silently resolve; explicit resolution trace |
| PG-Q10 | no reply / after 72h / block / left chat / restriction | no auto agreement; own recourse accessible securely, no chat dependency |
| PG-Q11 | malicious manager marks reviewer absent/removes historical relation | submitted feedback survives with correct provenance; no manager censorship |
| PG-Q12 | random directory user, self review, duplicate/reply races | forbidden context; no self-review; one root per context and one reply |
| PG-Q13 | third player/co-manager/new manager/guest guesses IDs | no note/review/complaint leakage; author/recipient/case ACL, indistinguishable private 404 |
| PG-Q14 | not_held, disputed outcome, trainer profile vs trainer-led | organization/cancellation feedback valid; peer claimed experience contested; training separate, no skill mutation |
| PG-Q15 | canceled/rejected participant report; target IDs mismatch; SSRF evidence link | reporting not dependent on attendance; mismatches denied; no server auto-fetch, no automatic sanctions |
| PG-Q16 | staff self-conflict; case reads; deletion while case open | independent reviewer restriction, audit and minimal scope; governed preservation/purge, no synthetic-policy bypass |
| PG-Q17 | fresh/upgrade/repeated migration/old client/rollback/restore | historical unknown, preserved seats/cases, backward compatibility; recourse remains after flag off |
| PG-Q18 | mobile slow network/keyboard/a11y; logout; next invitation | clear unknown/error/edited/disputed, cache cleared; invitation only explicit, current permissions checked |

Use barriers/two DB connections to exercise real races, not just Promise.all without known overlap. Repeat tests for deadlocks and assert final data/revisions/notices, not only HTTP 200.
Regression: participation capacity/cancel, current per-game authority, auth/idempotency, reports, Inbox/chat, friendships/invitations, profile privacy and active Game UI.
No global test bypass, no independent QA claim from author-local tests.

## Requirements traceability

| Approved requirement | Architecture section | Delivery/tests |
|---|---|---|
| One evolving screen, partial result, later | 4,8 | PG-4; Q01–05,Q18 |
| Facts separated; creator/external semantics | 3,4 | PG-1; Q01–04,Q17 |
| Notice, corrections, history, chat-independent recourse | 4,6,7 | PG-1/2; Q06–10,Q16 |
| Private notes, contextual three-step peer feedback, one reply | 3,5,6 | PG-3; Q11–14 |
| Organization 1–5; trainer context; no censorship | 5,6 | PG-3; Q11–14 |
| Existing Safety, contextual problem/status | 9 | PG-2; Q15–17 |
| Explicit next invitation, no ratings/penalties | 5,8 | PG-4; Q18 + no-ranking side-effect assertions |
| Durable inter-agent documentation | 12 | PM links this exact revision in Issue before admission |

## Gates / handoff

FACT: source/docs read, no SQL/API/UI executions. OWNER_CONFIRMED: product model. TECH_SELECTED: this architecture. OPEN: numeric timing options, operator assignment, real-data evidence/retention/legal conditions. NOT DONE: implementation, CI, independent QA, rollout, runtime smoke, Owner acceptance of working feature.

Next bounded recipient **PM**: reconcile current Issue/hold, link package, prepare PG-0 contract/UI/admission record. Do not use Owner as courier for each agent. Neither this document nor a new issue label starts an executor automatically.
