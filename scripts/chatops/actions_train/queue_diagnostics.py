"""Pure queue explanation. Informational data only: never grants execution authority."""
CODES = ('done', 'deferred', 'not_admitted', 'dependency', 'conflict', 'unavailable', 'assigned', 'ready')

def provider_ready(card, profile):
    table = card.get('availability')
    if table is None: return True  # legacy/test snapshot; execution gates remain mandatory
    names = ('codex', 'cursor', 'agy') if profile == 'auto' else (profile,)
    return bool(table.get('codex', {}).get('qa')) and any(table.get(p, {}).get('author') for p in names)

def explain(s, snap, issues, candidates, intents, profile='auto'):
    done = set().union(*(set(c['done']) for c in snap['slots'].values()))
    deferred = set().union(*(set(c['parked']) for c in snap['slots'].values()))
    occupied = []
    for card in snap['slots'].values():
        a = card.get('active')
        if a and a['phase'] != 'done': occupied.append(s.task_record(a['issue'], a['task']))
        if card.get('reservation'): occupied.append(card['reservation'])
    tasks = dict(candidates); scheduled = {r['issue'] for r in intents}; decisions = []
    free = [c for c in snap['slots'].values() if c['owned'] and not c.get('pending') and
            (not c.get('active') or c['active']['phase'] == 'done')]
    for issue in issues:
        if 'pull_request' in issue: continue
        n = issue['number']; task = tasks.get(n)
        if n in done: code = 'done'
        elif n in deferred: code = 'deferred'
        elif task is None: code = 'not_admitted'
        elif n in scheduled: code = 'assigned'
        elif set(task.get('depends_on', [])) - done: code = 'dependency'
        elif any(s.conflicts(s.task_record(n, task), r) for r in occupied): code = 'conflict'
        elif free and not any(provider_ready(c, profile) for c in free): code = 'unavailable'
        else: code = 'ready'
        decisions.append({'issue': n, 'code': code})
    counts = {k: sum(x['code'] == k for x in decisions) for k in CODES}
    slots = {}
    for name, card in snap['slots'].items():
        idle = not card.get('active') or card['active']['phase'] == 'done'
        if not card['owned']: reason = 'not_owned'
        elif card.get('pending') or not idle: reason = 'occupied'
        elif any(i['slot'] == name for i in intents): reason = 'dispatch_pending'
        elif not provider_ready(card, profile): reason = 'provider_or_budget'
        elif counts['ready'] or counts['assigned']: reason = 'dependencies_or_conflicts'
        else: reason = 'no_eligible_admission'
        slots[name] = {'generation': card['generation'], 'reason': reason}
    return {'schema':'GB_TRAIN_PLANNING_V1','slots':slots,'counts':counts,'decisions':decisions[:100]}

def valid_report(value):
    if not isinstance(value, dict) or set(value) != {'schema','slots','counts','decisions'}: return False
    if value['schema'] != 'GB_TRAIN_PLANNING_V1' or not isinstance(value['slots'],dict) or set(value['slots']) != {'slot1','slot2'}: return False
    if not isinstance(value['counts'],dict) or set(value['counts']) != set(CODES): return False
    if any(type(n) is not int or not 0 <= n <= 10000 for n in value['counts'].values()): return False
    for card in value['slots'].values():
        if not isinstance(card,dict) or set(card) != {'generation','reason'}: return False
        if type(card['generation']) is not int or not 0 <= card['generation'] <= 10**9: return False
        if card['reason'] not in ('not_owned','occupied','dispatch_pending','provider_or_budget','dependencies_or_conflicts','no_eligible_admission'): return False
    rows=value['decisions']
    return (isinstance(rows,list) and len(rows)<=100 and all(isinstance(r,dict) and set(r)=={'issue','code'} and
            type(r['issue']) is int and 0<r['issue']<10**9 and r['code'] in CODES for r in rows) and
            len({r['issue'] for r in rows})==len(rows))
