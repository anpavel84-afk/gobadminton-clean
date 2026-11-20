#!/usr/bin/env python3
"""GoBadminton OPS monitor: snapshot writer. Non-LLM, read-only, stdlib only.

Reads (read-only): checkpoint state.json, parked.json, DEV deploy receipt,
`systemctl --user show` of the executor. Writes ONLY its own snapshot.json and
journal.json in the output directory. No network, no GitHub, no secrets.
Runs as the executor's uid (like gb-grok-status) from a systemd timer, every 30 s.
After public slot discovery/legacy retirement, reads only slot1/slot2 public status
and the DEV receipt; never a private slot checkpoint or the retired legacy state.
"""
import datetime, json, os, pwd, re, stat, subprocess, sys, tempfile

MAX_ATTEMPTS = 3
ALLOWED_PHASES = ('claimed', 'developing', 'candidate', 'pr_wait', 'qa', 'ci', 'integrating',
                  'promoting', 'dev_wait', 'blocked', 'parked', 'done')
SECRET_RE = re.compile(r'(?i)password|passwd|secret|token|private|credential|cookie|bearer|api.?key|ssh-|https?://|@')
JOURNAL_MAX = 30
SLOT_OUTBOX = '/var/lib/gobadminton-autonomy/outbox'
SLOT_USERS = {'slot1': 'agentagency-dev', 'slot2': 'gb-slot2'}
SLOT_MAX_BYTES = 65536
# Idle poll is 240s; shared API clock can add 65s per request. This is snapshot age, not process liveness.
SLOT_STALE_S = 600
PRODUCT_OUTSIDE = [  # static, honest: facts about executor only
    {'id': 53, 'title': 'Фото площадок (каталог)', 'status': 'ведётся вне исполнителя'},
]


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc)


def read_json(path, limit, owner=None, owners=None):
    """Safe read: regular file, no symlink, size-limited, optional owner check."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        s = os.fstat(fd)
        if not stat.S_ISREG(s.st_mode) or not 2 <= s.st_size <= limit:
            raise ValueError('invalid file metadata')
        if owner is not None and s.st_uid != owner:
            raise ValueError('unexpected owner')
        if owners is not None and s.st_uid not in owners:
            raise ValueError('unexpected owner')
        if owners is not None and s.st_mode & 0o022:
            raise ValueError('group/world-writable')
        return json.loads(os.read(fd, limit + 1))
    finally:
        os.close(fd)


def load_titles(path):
    """Curated, human-maintained descriptions (display text only). Never raises."""
    try:
        raw = read_json(path, 262144, owner=None)
    except Exception:
        return {}
    out = {}
    for k, v in (raw.items() if isinstance(raw, dict) else []):
        if not (isinstance(k, str) and k.isdigit() and isinstance(v, dict)):
            continue
        e = {}
        for f in ('title_ru', 'meaning_ru', 'result_ru', 'note_ru'):
            t = v.get(f)
            if isinstance(t, str):
                t = ''.join(ch for ch in t if ch.isprintable())
                t = ' '.join(t.split())[:300]
                if t:
                    e[f] = t
        e['closed'] = v.get('closed') is True
        e['queued'] = v.get('queued') is True
        out[int(k)] = e
    return out


EXT_TITLES_MAX = 65536      # hard size cap of the external (no-root-update) titles file
EXT_TITLES_ENTRIES = 300
EXT_TITLES_USER = 'grokops'  # the only non-root owner accepted for the external file
TEXT_FIELDS = ('title_ru', 'meaning_ru', 'result_ru', 'note_ru')


def _clean_text(t):
    t = ''.join(ch for ch in t if ch.isprintable())
    return ' '.join(t.split())[:300]


def load_titles_strict(path, allowed_uids):
    """Strict loader for the external titles file. Returns dict, or None if the file is
    missing/invalid in ANY way (caller then uses the bundled copy). Data only, never code."""
    try:
        raw = read_json(path, EXT_TITLES_MAX, owner=None, owners=allowed_uids)
    except Exception:
        return None
    if not isinstance(raw, dict) or len(raw) > EXT_TITLES_ENTRIES + 1:
        return None
    out = {}
    for k, v in raw.items():
        if k == '_readme':
            if not isinstance(v, str):
                return None
            continue
        if not (isinstance(k, str) and re.fullmatch(r'[0-9]{1,9}', k) and isinstance(v, dict)):
            return None
        if not set(v) <= set(TEXT_FIELDS) | {'closed', 'queued'}:
            return None
        e = {}
        for f in TEXT_FIELDS:
            if f in v:
                if not isinstance(v[f], str):
                    return None
                t = _clean_text(v[f])
                if t and not SECRET_RE.search(t):   # secret-looking text is dropped, not shown
                    e[f] = t
        for f in ('closed', 'queued'):
            if f in v and not isinstance(v[f], bool):
                return None
            e[f] = v.get(f) is True
        out[int(k)] = e
    return out


def pick_titles(ext_path, bundled_path):
    """-> (titles, source). External file wins only if it validates fully and has >=1 entry."""
    uids = {0}
    try:
        uids.add(pwd.getpwnam(EXT_TITLES_USER).pw_uid)
    except KeyError:
        pass
    t = load_titles_strict(ext_path, uids) if ext_path else None
    if t:
        return t, 'external'
    return load_titles(bundled_path), 'bundled'


BACKLOG_MAX_BYTES = 65536
BACKLOG_MAX_ITEMS = 80
BACKLOG_STATUSES = ('в планах', 'не начата', 'ожидает', 'опубликована', 'припаркована')
BACKLOG_KEYS = {'id', 'issue', 'title_ru', 'meaning_ru', 'note_ru', 'status', 'priority', 'depends_on'}
BACKLOG_ID_RE = re.compile(r'#?[A-Za-z0-9][A-Za-z0-9._-]{0,23}')


def load_backlog_strict(path, allowed_uids):
    """Strict loader for the external backlog file (data only, updatable without root).
    Shape: {"_readme": str?, "items": [{id, issue|null, title_ru, meaning_ru?, note_ru?, status,
    priority|null, depends_on: [id]}]}. Returns the list of items, or None if the file is missing
    or invalid in ANY way (the monitor then says so honestly). Never raises."""
    try:
        raw = read_json(path, BACKLOG_MAX_BYTES, owner=None, owners=allowed_uids)
    except Exception:
        return None
    if not isinstance(raw, dict) or not set(raw) <= {'_readme', 'items'} or not isinstance(raw.get('items'), list):
        return None
    if '_readme' in raw and not isinstance(raw['_readme'], str):
        return None
    items = raw['items']
    if len(items) > BACKLOG_MAX_ITEMS:
        return None
    out, seen = [], set()
    for v in items:
        if not isinstance(v, dict) or not set(v) <= BACKLOG_KEYS or not {'id', 'title_ru', 'status'} <= set(v):
            return None
        i = v['id']
        if not (isinstance(i, str) and BACKLOG_ID_RE.fullmatch(i)) or i in seen:
            return None
        seen.add(i)
        iss = v.get('issue')
        if iss is not None and not (type(iss) is int and 0 < iss < 10**9):
            return None
        pr = v.get('priority')
        if pr is not None and not (type(pr) is int and 0 <= pr <= 999):
            return None
        if v['status'] not in BACKLOG_STATUSES:
            return None
        dep = v.get('depends_on', [])
        if not (isinstance(dep, list) and len(dep) <= 8 and all(isinstance(x, str) and BACKLOG_ID_RE.fullmatch(x) for x in dep)):
            return None
        e = {'id': i, 'issue': iss, 'status': v['status'], 'priority': pr, 'depends_on': list(dep)}
        for f in ('title_ru', 'meaning_ru', 'note_ru'):
            if f in v:
                if not isinstance(v[f], str):
                    return None
                t = _clean_text(v[f])
                if t and not SECRET_RE.search(t):   # secret-looking text is dropped, not shown
                    e[f] = t
        if 'title_ru' not in e:
            return None
        out.append(e)
    return out


def backlog_view(items, done=(), active_issue=None, parked=()):
    """Sorted by priority (nulls last, then file order); drops items already done or currently claimed."""
    if items is None:
        return {'available': False, 'note': 'файл бэклога отсутствует или не прошёл проверку', 'items': []}
    done, parked = set(done), set(parked)
    keep = []
    for n, e in enumerate(items):
        iss = e.get('issue')
        if iss is not None and (iss in done or iss == active_issue):
            continue
        e = dict(e)
        if iss is not None and iss in parked:
            e['status'] = 'припаркована'
        keep.append((e['priority'] is None, e['priority'] or 0, n, e))
    keep.sort(key=lambda x: x[:3])
    return {'available': True, 'note': None, 'items': [k[3] for k in keep]}


def pick_backlog(ext_path):
    uids = {0}
    try:
        uids.add(pwd.getpwnam(EXT_TITLES_USER).pw_uid)
    except KeyError:
        pass
    return load_backlog_strict(ext_path, uids) if ext_path else None


def describe(titles, issue):
    t = titles.get(issue) if titles else None
    if not t or 'title_ru' not in t:
        return {'title_ru': 'Задача #%d (описание не добавлено)' % issue, 'described': False,
                'closed': bool(t and t.get('closed'))}
    d = {k: t[k] for k in ('title_ru', 'meaning_ru', 'result_ru', 'note_ru') if k in t}
    d['described'] = True
    d['closed'] = t.get('closed', False)
    return d


def sha(v):
    return v if isinstance(v, str) and re.fullmatch(r'[a-f0-9]{40}', v) else None


def num(v):
    return v if type(v) is int and 0 <= v < 10**9 else None


def short_text(v, n=120):
    """Whitelisted short text; anything suspicious becomes None."""
    if not isinstance(v, str):
        return None
    v = ' '.join(v.split())[:n]
    if not v or SECRET_RE.search(v):
        return None
    if not re.fullmatch(r'[\w .,:;()+/#№«»"\'!?%&=*<>\[\]-]+', v):
        return None
    return v


def title_from_goal(goal, issue):
    if isinstance(goal, str):
        m = re.search(r'TASK\s+([A-Za-z0-9._-]{1,16})\s*:\s*([^\n]{1,200})', goal)
        if m:
            t = short_text(m.group(2))
            if t:
                return {'task_id': m.group(1), 'title': t, 'title_source': 'goal'}
    if issue is not None:
        return {'task_id': None, 'title': 'Задача #%d' % issue, 'title_source': 'fallback'}
    return {'task_id': None, 'title': None, 'title_source': None}


def ci_summary(ci):
    """Only counts/names of CI jobs, defensively (shape of checkpoint ci is not guaranteed)."""
    if not isinstance(ci, dict):
        return None
    jobs = ci.get('jobs')
    out = {'run_id': num(ci.get('id')), 'total': None, 'passed': 0, 'failed': 0,
           'pending': 0, 'result': None}
    items = []
    if isinstance(jobs, dict):
        items = [{'name': k, **(v if isinstance(v, dict) else {'status': v})} for k, v in jobs.items()]
    elif isinstance(jobs, list):
        items = [j for j in jobs if isinstance(j, dict)]
    for j in items[:40]:
        c = str(j.get('conclusion') or j.get('status') or '').lower()
        if c in ('success', 'passed', 'pass', 'completed_success'):
            out['passed'] += 1
        elif c in ('failure', 'failed', 'fail', 'cancelled', 'timed_out'):
            out['failed'] += 1
        else:
            out['pending'] += 1
    if items:
        out['total'] = len(items)
        out['result'] = 'FAIL' if out['failed'] else ('PASS' if out['pending'] == 0 else 'RUNNING')
    return out


def executor_state(show_fn):
    try:
        kv = show_fn()
    except Exception:
        return {'state': 'UNKNOWN', 'substate': None, 'running': None}
    st = kv.get('ActiveState')
    return {'state': st if st in ('active', 'inactive', 'failed', 'activating', 'deactivating') else 'UNKNOWN',
            'substate': kv.get('SubState') if re.fullmatch(r'[a-z-]{1,20}', kv.get('SubState') or '') else None,
            'running': (st == 'active' and kv.get('SubState') == 'running') if st else None}


def systemd_show():
    env = {'PATH': '/usr/bin:/bin', 'XDG_RUNTIME_DIR': '/run/user/%d' % os.getuid(),
           'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/%d/bus' % os.getuid()}
    r = subprocess.run(['/usr/bin/systemctl', '--user', 'show', 'gobadminton-autonomy.service',
                        '-p', 'ActiveState', '-p', 'SubState'],
                       text=True, capture_output=True, timeout=8, env=env, cwd='/')
    if r.returncode != 0:
        raise RuntimeError('systemctl failed')
    return dict(l.split('=', 1) for l in r.stdout.splitlines() if '=' in l)


def dev_receipt(path, owner=0):
    out = {'status': 'UNAVAILABLE'}
    try:
        r = read_json(path, 16384, owner=owner)
    except Exception:
        return out
    acc = r.get('accepted') if isinstance(r, dict) else None
    if not isinstance(acc, dict):
        return out
    rel = acc.get('release_id')
    return {'status': 'READABLE',
            'pending': r.get('pending') if type(r.get('pending')) is bool else None,
            'release_id': rel if isinstance(rel, str) and re.fullmatch(r'r[0-9]+-a[0-9]+', rel) else None,
            'source_sha': sha(acc.get('source_sha')),
            'accepted_status': acc.get('status') if acc.get('status') in ('ACCEPTED', 'ROLLED_BACK', 'FAILED') else None,
            'finished_at': num(acc.get('finished_at'))}


def _unique_slot_keys(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError('duplicate key')
        out[k] = v
    return out


def _slot_file(path, owner):
    """Public outbox only. Reject symlinks in EVERY component; never block on a FIFO."""
    parts = os.path.abspath(path).split(os.sep)
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in parts[1:-1]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                          dir_fd=directory)
            os.close(directory)
            directory = nxt
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC,
                     dir_fd=directory)
        try:
            info = os.fstat(fd)
            if owner is None:
                raise LookupError('expected owner unknown')
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != owner or info.st_nlink != 1
                    or info.st_mode & 0o022 or not 2 <= info.st_size <= SLOT_MAX_BYTES):
                raise ValueError('untrusted metadata')
            raw = os.read(fd, SLOT_MAX_BYTES + 1)
            if len(raw) > SLOT_MAX_BYTES:
                raise ValueError('oversized publication')
        finally:
            os.close(fd)
    finally:
        os.close(directory)
    return json.loads(raw, object_pairs_hook=_unique_slot_keys)


def _slot_ids(value):
    return (isinstance(value, list) and len(value) <= 4096
            and all(type(n) is int and 0 < n < 10**9 for n in value))


def _slot_status(value, slot):
    """Exact GB_SLOT_STATUS_V1 from Runtime.publish; never copy arbitrary data to the web."""
    if (not isinstance(value, dict)
            or set(value) != {'schema', 'slot', 'active', 'done', 'parked', 'at', 'integrating'}
            or value['schema'] != 'GB_SLOT_STATUS_V1' or value['slot'] != slot
            or type(value['at']) is not int or not 0 <= value['at'] < 10**11
            or type(value['integrating']) is not bool
            or not _slot_ids(value['done']) or not _slot_ids(value['parked'])):
        raise ValueError('invalid slot status')
    a = value['active']
    if a is None:
        return value
    if (not isinstance(a, dict)
            or set(a) != {'issue', 'phase', 'attempt', 'head', 'base', 'integration',
                          'locks', 'allowed_paths', 'depends_on'}
            or type(a['issue']) is not int or not 0 < a['issue'] < 10**9
            or not isinstance(a['phase'], str) or a['phase'] not in ALLOWED_PHASES
            or (a['attempt'] is not None and num(a['attempt']) is None)
            or any(a[k] is not None and sha(a[k]) is None for k in ('head', 'base'))
            or num(a['integration']) is None or not _slot_ids(a['depends_on'])):
        raise ValueError('invalid active task')
    for key in ('locks', 'allowed_paths'):
        if (not isinstance(a[key], list) or len(a[key]) > 256
                or not all(isinstance(x, str) and 0 < len(x) <= 512
                           and all(ch.isprintable() for ch in x) for x in a[key])):
            raise ValueError('invalid task fields')
    return value



def _telemetry(card, outbox, slot, owner, now):
    import importlib.util
    spec = importlib.util.spec_from_file_location('gb_slot_telemetry', '/usr/local/lib/gb-ops-monitor/opsmon/slot_telemetry.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    value = module.validate(_slot_file(os.path.join(outbox, slot, 'telemetry.json'), owner), slot)
    age = now.timestamp() - value['at']
    if age < 0:
        raise ValueError('future telemetry')
    card.update(status='FRESH' if age <= 90 else 'STALE', age_s=int(age),
                published_utc=datetime.datetime.fromtimestamp(value['at'], datetime.timezone.utc).isoformat(),
                process=value['process'], telemetry_task=value['task'], checkpoint_status=value['checkpoint_status'],
                checkpoint_age_s=int(now.timestamp()-value['checkpoint_at']) if value['checkpoint_at'] is not None else None,
                note='Состояние службы проверено сборщиком; время ниже — последнее наблюдение.' if age <= 90
                     else 'Сборщик не обновляет данные; показано последнее наблюдение.')
    if value['checkpoint_status'] == 'INVALID':
        card.update(status='INVALID', note='Чекпоинт слота не прошёл проверку.')

def slot_publications(outbox, now, owners=None):
    cards, values = [], {}
    for slot, user in SLOT_USERS.items():
        card = {'slot': slot, 'status': 'ERROR', 'claim': None, 'age_s': None,
                'published_utc': None, 'note': 'публикация недоступна'}
        cards.append(card)
        try:
            owner = owners.get(slot) if owners is not None else pwd.getpwnam(user).pw_uid
            if type(owner) is not int or owner < 0:
                raise KeyError(user)
        except KeyError:
            owner = None
        try:
            value = _slot_status(_slot_file(os.path.join(outbox, slot, 'status.json'), owner), slot)
            age = now.timestamp() - value['at']
            if age < 0:
                raise ValueError('future publication')
        except FileNotFoundError:
            card.update(status='MISSING', note='публикация отсутствует')
            continue
        except LookupError:
            card.update(status='OWNER_UNKNOWN', note='ожидаемый владелец не найден')
            continue
        except (ValueError, TypeError, UnicodeError, RecursionError):
            card.update(status='INVALID', note='публикация не прошла проверку')
            continue
        except OSError:
            continue
        values[slot] = value
        card.update(status='FRESH' if age <= SLOT_STALE_S else 'STALE', age_s=int(age),
                    published_utc=datetime.datetime.fromtimestamp(value['at'], datetime.timezone.utc).isoformat(),
                    note='публичный статус; состояние процесса UNKNOWN' if age <= SLOT_STALE_S
                         else 'публикация устарела; показано последнее известное состояние')
        try:
            _telemetry(card, outbox, slot, owner, now)
        except Exception:
            card.update(status='STALE', note='Регулярная телеметрия недоступна; показан последний статус задачи.')

    return cards, values


def legacy_retired(state_dir):
    # Presence alone is a stop signal; do not open a tombstone or any migrated checkpoint.
    try:
        os.lstat(os.path.join(state_dir, 'RETIRED_TO_SLOT.json'))
    except FileNotFoundError:
        return False
    except OSError:
        return True
    return True


def slots_view(snap, cards, values, journal, titles, backlog):
    j = dict(journal) if isinstance(journal, dict) else {}
    j['slots_seen'] = True  # persisted in the existing monitor-owned journal, across writer restarts
    titles = titles or {}
    done, parked, active = set(), set(), set()
    for card in cards:
        value = values.get(card['slot'])
        if value is None:
            continue
        done.update(value['done'])
        parked.update(value['parked'])
        a = value['active']
        if a:
            card['claim'] = {'issue': a['issue'], 'phase': a['phase'], 'attempt': a['attempt'],
                             'head_sha': a['head'], 'base_sha': a['base'],
                             'desc': describe(titles, a['issue'])}
            if card['status'] == 'FRESH' and a['phase'] != 'done':
                active.add(a['issue'])
    for card in cards:
        if 'telemetry_task' in card:
            task = card.pop('telemetry_task')
            card['claim'] = dict(task, desc=describe(titles, task['issue'])) if task else None
    active = {c['claim']['issue'] for c in cards if c.get('claim') and c['status'] == 'FRESH' and c['claim']['phase'] != 'done'}
    snap.update(source_mode='slots', slots=cards, claim=None,
                executor={'state': 'UNKNOWN', 'substate': None, 'running': None},
                source_ok=all(c['status'] == 'FRESH' for c in cards),
                counts_complete=all(c['status'] == 'FRESH' for c in cards),
                done_count=len(done), parked_count=len(parked),
                done_all=[dict(describe(titles, n), issue=n) for n in sorted(done, reverse=True)[:40]],
                parked=[{'issue': n, 'desc': describe(titles, n), 'closed': describe(titles, n)['closed'],
                         'reason': 'UNKNOWN (публичный статус содержит только ID)', 'attempt': None,
                         'head_sha': None, 'has_successor': None} for n in sorted(parked)[:40]])
    snap['source_error'] = None if snap['source_ok'] else 'не все публикации слотов свежие и доступны'
    snap['queue']['items'] = [dict(describe(titles, n), issue=n) for n in sorted(titles)
                             if titles[n].get('queued') and n not in done and n not in active][:10]
    snap['queue']['note'] = 'назначения слотов UNKNOWN; показаны только отмеченные вручную задачи'
    # Apply the existing backlog rules to both fresh active issues, retaining every other field.
    view = backlog_view(backlog, done, parked=parked)
    view['items'] = [e for e in view['items'] if e.get('issue') not in active]
    snap['backlog'] = view
    snap['recent_done'] = [dict(r, desc=describe(titles, r['issue']),
                                evidence=('release ' + r['release_id']) if r.get('release_id') else 'нет квитанции')
                           for r in j.get('recent_done', [])[:10]]
    return snap, j


def build(state_dir, receipt_path, journal, now, show_fn=systemd_show, checkpoint_owner=None, receipt_owner=0, titles=None, titles_source='bundled', backlog=None, slot_outbox=SLOT_OUTBOX, slot_owners=None):
    """Returns (snapshot, new_journal). Pure with respect to inputs except file reads."""
    snap = {'schema': 1, 'generated_utc': now.isoformat(timespec='seconds'),
            'host': 'vmi3510488', 'source_ok': True, 'source_error': None,
            'queue': {'available': False, 'note': 'ожидает взятия исполнителем', 'items': []},
            'model': {'confirmed': False, 'note': 'не подтверждено'},
            'product_outside': PRODUCT_OUTSIDE, 'titles_source': titles_source}
    snap['dev'] = dev_receipt(receipt_path, receipt_owner)
    cards, values = slot_publications(slot_outbox, now, slot_owners)
    if values or (isinstance(journal, dict) and journal.get('slots_seen') is True) or legacy_retired(state_dir):
        return slots_view(snap, cards, values, journal, titles, backlog)
    if any(c['status'] != 'MISSING' for c in cards):
        snap.update(source_mode='legacy', slots=cards)
    snap['executor'] = executor_state(show_fn)
    snap['claim'] = None
    snap['parked'] = []
    snap['done_count'] = None
    snap['backlog'] = backlog_view(backlog)
    try:
        state = read_json(os.path.join(state_dir, 'state.json'), 1 << 20, owner=checkpoint_owner)
        if not isinstance(state, dict) or not isinstance(state.get('done'), list):
            raise ValueError('checkpoint shape rejected')
    except Exception as e:
        snap['source_ok'] = False
        snap['source_error'] = 'чекпоинт недоступен (%s)' % type(e).__name__
        return snap, journal
    done = sorted({d for d in state['done'] if type(d) is int and 0 <= d < 10**9})
    snap['done_count'] = len(done)
    titles = titles or {}
    snap['done_all'] = [dict(describe(titles, n), issue=n) for n in sorted(done, reverse=True)[:40]]
    snap['queue']['items'] = [dict(describe(titles, n), issue=n) for n in sorted(titles) if titles[n].get('queued') and n not in done][:10]
    a = state.get('active')
    if isinstance(a, dict) and a:
        issue = num(a.get('issue'))
        phase = a.get('phase') if a.get('phase') in ALLOWED_PHASES else 'UNKNOWN'
        q = a.get('qa') if isinstance(a.get('qa'), dict) else {}
        task = a.get('task') if isinstance(a.get('task'), dict) else {}
        goal = task.get('goal') if isinstance(task.get('goal'), str) else a.get('goal')
        reason = a.get('reason')
        claim = {'issue': issue, 'phase': phase, 'attempt': num(a.get('attempt')),
                 'max_attempts': MAX_ATTEMPTS, 'pr': num(a.get('pr')),
                 'base_sha': sha(a.get('base')), 'head_sha': sha(a.get('head')),
                 'resume_phase': a.get('resume_phase') if a.get('resume_phase') in ALLOWED_PHASES else None,
                 'reason': (short_text(reason, 150) or 'WITHHELD') if reason else None,
                 'qa': {'verdict': q.get('verdict') if q.get('verdict') in ('PASS', 'FAIL', 'BLOCKED') else None,
                        'reviewed_sha': sha(q.get('reviewed_sha'))},
                 'ci': ci_summary(a.get('ci')),
                 'assignee': {'confirmed': False, 'note': 'не подтверждено'}}
        claim.update(title_from_goal(goal, issue))
        if issue is not None:
            claim['desc'] = describe(titles, issue)
        snap['claim'] = claim
        snap['queue']['note'] = 'следующая задача берётся исполнителем после текущей'
    # parked (separate file; absence is normal)
    try:
        pk = read_json(os.path.join(state_dir, 'parked.json'), 1 << 20, owner=checkpoint_owner)
        items = pk.get('parked') if isinstance(pk, dict) and 'parked' in pk else pk
        if isinstance(pk, dict) and items is pk:
            items = pk.get('items') or pk.get('active') or []
        for it in (items if isinstance(items, list) else [])[:20]:
            if isinstance(it, dict) and num(it.get('issue')) is not None:
                snap['parked'].append({'issue': it['issue'], 'desc': describe(titles, it['issue']),
                                       'closed': describe(titles, it['issue'])['closed'], 'attempt': num(it.get('attempt')),
                                       'reason': short_text(it.get('reason'), 150) or 'WITHHELD',
                                       'head_sha': sha(it.get('head')),
                                       'has_successor': bool(it.get('allow_successors')) if 'allow_successors' in it else None,
                                       'owner_action': True})
    except Exception:
        pass
    snap['backlog'] = backlog_view(backlog, done, snap['claim']['issue'] if snap['claim'] else None,
                                   [p['issue'] for p in snap['parked']])
    # journal: observe transitions (only own file)
    j = journal if isinstance(journal, dict) else {}
    j.setdefault('last', None); j.setdefault('recent_done', []); j.setdefault('changed_utc', None)
    cur = None
    if snap['claim']:
        c = snap['claim']
        cur = {'issue': c['issue'], 'phase': c['phase'], 'attempt': c['attempt'], 'head_sha': c['head_sha']}
    if cur != j['last']:
        j['changed_utc'] = snap['generated_utc']
        prev = j['last']
        if prev and prev.get('issue') is not None and prev['issue'] in done and (cur is None or cur['issue'] != prev['issue']):
            rec = snap['dev'] if snap['dev'].get('status') == 'READABLE' else {}
            j['recent_done'].insert(0, {'issue': prev['issue'],
                                        'title': j.get('last_title') or 'Задача #%d' % prev['issue'],
                                        'desc': describe(titles, prev['issue']),
                                        'observed_utc': snap['generated_utc'],
                                        'release_id': rec.get('release_id'), 'source_sha': rec.get('source_sha'),
                                        'accepted_status': rec.get('accepted_status')})
            del j['recent_done'][JOURNAL_MAX:]
        j['last'] = cur
    j['last_title'] = snap['claim']['title'] if snap['claim'] else j.get('last_title')
    snap['changed_utc'] = j['changed_utc']
    snap['recent_done'] = [dict(r, desc=describe(titles, r['issue']), evidence=('release ' + r['release_id']) if r.get('release_id') else 'нет квитанции')
                           for r in j['recent_done'][:10]]
    return snap, j


def atomic_write(path, data, mode=0o644):
    d = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=d, prefix='.tmp-')
    try:
        with os.fdopen(fd, 'w') as f:
            f.write(data)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        try: os.unlink(tmp)
        except OSError: pass
        raise


def main(argv=None):
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--state-dir', default=os.path.expanduser('~/.gb-autonomy-state'))
    p.add_argument('--receipt', default='/var/lib/gobadminton-deploy-evidence/dev.json')
    p.add_argument('--out-dir', default='/var/lib/gb-ops-monitor')
    p.add_argument('--receipt-owner', type=int, default=0)
    p.add_argument('--titles', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'titles_ru.json'))
    p.add_argument('--titles-external', default=None, help='data-only titles file updatable without root; falls back to --titles')
    p.add_argument('--backlog-external', default=None, help='data-only backlog file updatable without root (optional)')
    p.add_argument('--slot-outbox', default=SLOT_OUTBOX, help='public slot1/slot2 outbox; auto-discovery, never private slot state')
    p.add_argument('--no-systemd', action='store_true')
    a = p.parse_args(argv)
    jpath = os.path.join(a.out_dir, 'journal.json')
    try:
        journal = read_json(jpath, 1 << 20)
    except Exception:
        journal = {}
    titles, tsrc = pick_titles(a.titles_external, a.titles)
    show = (lambda: {}) if a.no_systemd else systemd_show
    snap, j = build(a.state_dir, a.receipt, journal, now_utc(), show, checkpoint_owner=os.geteuid(), receipt_owner=a.receipt_owner,
                    titles=titles, titles_source=tsrc, backlog=pick_backlog(a.backlog_external), slot_outbox=a.slot_outbox)
    data = json.dumps(snap, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    if len(data) > 131072:
        raise SystemExit('snapshot too large')
    atomic_write(jpath, json.dumps(j, ensure_ascii=False), 0o600)
    atomic_write(os.path.join(a.out_dir, 'snapshot.json'), data, 0o644)


if __name__ == '__main__':
    main()
