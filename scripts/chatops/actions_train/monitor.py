"""Compatible source extension. Retains monitor backlog/titles/history and seven-stage order.
Install mapping: /usr/local/lib/gb-actions-train/monitor.py; call extend(snapshot, train_status)
from the existing monitor source after slots_view. Never infer work from publication mtime.
"""
import time
def need(ok, reason):
    if not ok: raise ValueError(reason)

STAGES = ('Task', 'Code', 'PR', 'QA', 'CI', 'DEV', 'Accepted')

def project(card, now=None):
    now = int(time.time()) if now is None else now
    a = card.get('active') or {}
    last = card.get('last') or {}
    pending = card.get('pending')
    cli = card.get('cli') or {}
    phase, head = a.get('phase'), a.get('head')
    qa, ci = a.get('qa') or {}, a.get('ci') or {}
    failure = a.get('ci_failure') or {}
    if not ci and failure:
        ci = dict(sha=failure.get('head'), id=failure.get('run'), failed=True)
    stage = {'claimed': 'Task', 'developing': 'Code', 'candidate': 'Code', 'pr_wait': 'PR',
             'qa': 'QA', 'ci': 'CI', 'integrating': 'Code', 'promoting': 'DEV',
             'dev_wait': 'DEV', 'done': 'Accepted', 'blocked': 'Task'}.get(phase)
    confirmed_event = card.get('confirmed') or last
    confirmed = confirmed_event.get('confirmed_at')
    status = 'waiting'
    if not a: status = 'not_started'
    if pending:
        status = 'running' if pending['status'] == 'running' else 'unknown'
    elif last.get('status') == 'deferred': status = 'error'
    elif confirmed and now - confirmed > 3600: status = 'stale'
    elif phase == 'done': status = 'confirmed'
    idle = not a or phase == 'done'
    planning = card.get('planning')
    reason = last.get('reason') or ('root migration not activated' if not card['owned'] else 'stage not_started' if not pending else None)
    if idle and not pending:
        status = 'waiting' if card['owned'] else 'not_started'
        if planning:
            labels = {'no_eligible_admission':'Нет допущенных готовых задач',
                      'provider_or_budget':'Нет доступной пары автор/QA или исчерпан бюджет',
                      'dispatch_pending':'Подходящая задача передана Actions; запуск ещё не подтверждён',
                      'dependencies_or_conflicts':'Ожидание зависимостей или освобождения путей',
                      'not_owned':'Управление слотом не передано Actions','occupied':'Слот занят'}
            counts = planning['counts']
            label = labels[planning['reason']]
            if (planning['reason'] == 'dependencies_or_conflicts' and counts.get('assigned', 0)
                    and not counts['dependency'] and not counts['conflict'] and not counts.get('ready', 0)):
                label = 'Все готовые задачи уже назначены другим слотам; других допущенных задач нет'
            reason = (label + ': без допуска ' + str(counts['not_admitted']) +
                      ', отложено ' + str(counts['deferred']) + ', зависимости ' + str(counts['dependency']) +
                      ', конфликты ' + str(counts['conflict']) + '. Проверка очереди: run ' + str(planning['workflow_run']))
            if now - planning['observed_at'] > 3600:
                status = 'stale'; reason = 'Проверка очереди устарела. Последнее подтверждение: ' + reason
        else: reason = 'Нет активной задачи; свежий результат планирования ещё не получен'
    diagnosis = a.get('failure_diagnosis') or {}
    receipts = diagnosis.get('receipts', {})
    current_failure = qa if qa.get('verdict') == 'FAIL' else a.get('deterministic_failure') or failure
    relevant = [r for r in receipts.values() if (r.get('inputs') or {}).get('head') == head
                and ((r.get('inputs') or {}).get('failure') or {}).get('result') == current_failure]
    latest = relevant[-1] if relevant else {}
    loop_status = None
    if 'failure_diagnosis' in a.get('task', {}):
        if pending and pending.get('stage') == 'failure_diagnosis':
            loop_status = 'ASTRA DIAGNOSING' if pending.get('status') == 'running' else 'ASTRA UNKNOWN'
        elif phase == 'developing' and a.get('attempt', 0) > 1:
            loop_status = 'AUTHOR REPAIR'
        elif latest.get('status') == 'ready' and (qa.get('verdict') == 'FAIL' or failure or a.get('deterministic_failure')):
            loop_status = 'REPAIR BRIEF READY'
        elif latest.get('status') in ('pending', 'blocked'):
            loop_status = 'ASTRA UNKNOWN' if latest['status'] == 'pending' else 'ASTRA BLOCKED'
        elif qa.get('verdict') == 'FAIL' or failure or a.get('deterministic_failure'):
            loop_status = 'QA/CI FAIL'
        else:
            loop_status = 'QA/CI'
    return dict(schema='GB_ACTIONS_MONITOR_V1', stages=list(STAGES), stage=stage,
                status=status, issue=a.get('issue'), attempt=a.get('attempt'), head=head, pr=a.get('pr'),
                qa=dict(status='not_started' if not qa else ('error' if qa.get('verdict') == 'FAIL' else 'confirmed') if qa.get('reviewed_sha') == head else 'unknown',
                        verdict=qa.get('verdict'), head=qa.get('reviewed_sha')),
                ci=dict(status='not_started' if not ci else ('error' if ci.get('failed') else 'confirmed') if ci.get('sha') == head else 'unknown',
                        run=ci.get('id'), head=ci.get('sha')),
                workflow_run=(pending or last).get('workflow_run'), workflow_attempt=(pending or last).get('workflow_attempt'),
                operation=pending.get('stage') if pending else last.get('stage'),
                process=cli.get('process'), supervisor=pending.get('process') if pending else None,
                model=cli.get('model') if pending else None if idle else (last.get('routing') or confirmed_event.get('routing')),
                process_observed_at=cli.get('observed_at'), last_confirmed_event=confirmed,
                wait_reason=reason, planning=planning,
                previous_result=dict(issue=last.get('issue'), reason=last.get('reason'), status=last.get('status')) if idle else None,
                failure_loop=dict(status=loop_status, calls=diagnosis.get('calls'),
                    failure_fingerprint=latest.get('input_hash'), brief_hash=latest.get('brief_hash'),
                    routing=latest.get('routing')),
                alerts='not_applicable')  # This package does not invent a notification channel.


def extend(snapshot, train_status, now=None):
    need(train_status.get('schema') in ('GB_ACTIONS_TRAIN_V1', 'GB_ACTIONS_MONITOR_SOURCE_V1'), 'invalid monitor source')
    now = int(time.time()) if now is None else now
    observed = train_status.get('observed_at')
    stale = train_status['schema'] == 'GB_ACTIONS_MONITOR_SOURCE_V1' and (
        type(observed) is not int or not 0 <= now - observed <= 90)
    for card in snapshot.get('slots', []):
        name = card.get('slot') or card.get('name')
        if name in train_status['slots']:
            card['actions_train'] = (project(train_status['slots'][name], now) if train_status['schema'] == 'GB_ACTIONS_TRAIN_V1' else dict(train_status['slots'][name]))
            if stale: card['actions_train']['status'] = 'stale'
    return snapshot
