#!/bin/bash
set -euo pipefail
# Readable, SHA256-pinned source payloads. No config, credentials, wrappers or unit edits.
exec /usr/bin/python3 -I -B - "$@" <<'PY_SLOTS_MONITOR_V1'
BASELINES = {
    "opsmon/writer.py": "10e0f8aa6ee34328e7468fd4f5357927fcf3b739bb308e56c768e2246a634e5f",
    "opsmon/server.py": "5424603de6f9cd5f8a174dba814f204d0fbac58e63322a6a188cb3ce0d5a674e",
    "web/app.js": "32e926011b2a6508bffe242ace0856020048763875549a93bb3768c462b1da60"
}
PAYLOAD_SHA256 = {
    "opsmon/writer.py": "d7eda09d45d190064499beb4f181448ccbc7d6e20324c90843f99907ac67f7c6",
    "opsmon/server.py": "087aeaffc5b01fa9c3d46c7ba728a0add77702d0c96b52cdf5343f737f8f0ea0",
    "web/app.js": "e74d41d4d2973bb0e506a422624c891f32766b4ff5d1044d6e5a6803b63adca5"
}
PAYLOADS = {
    'opsmon/writer.py': r'''#!/usr/bin/env python3
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
ALLOWED_PHASES = ('claimed', 'developing', 'candidate', 'pr_wait', 'qa', 'ci',
                  'promoting', 'dev_wait', 'blocked', 'parked', 'done')
SECRET_RE = re.compile(r'(?i)password|passwd|secret|token|private|credential|cookie|bearer|api.?key|ssh-|https?://|@')
JOURNAL_MAX = 30
SLOT_OUTBOX = '/var/lib/gobadminton-autonomy/outbox'
SLOT_USERS = {'slot1': 'agentagency-dev', 'slot2': 'gb-slot2'}
SLOT_MAX_BYTES = 65536
SLOT_STALE_S = 90
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
''',
    'opsmon/server.py': r'''#!/usr/bin/env python3
"""GoBadminton OPS monitor: tiny read-only web service (stdlib only).

Reads ONLY snapshot.json. PIN login (salted scrypt hash in a config file), rate limiting,
signed HttpOnly cookie. No write endpoints except login/logout. Listens on loopback;
public access goes through nginx under /ops-monitor/.
"""
import base64, hashlib, hmac, json, os, secrets, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), 'web')
COOKIE = 'gbops'
SNAP_MAX = 131072
STALE_AFTER_S = 90
KNOWN = {
    'top': ('schema', 'generated_utc', 'host', 'source_ok', 'source_error', 'queue', 'model', 'product_outside',
            'executor', 'dev', 'claim', 'parked', 'done_count', 'changed_utc', 'recent_done', 'done_all', 'backlog',
            'source_mode', 'slots', 'counts_complete', 'parked_count'),
}


def hash_pin(pin, salt, n=2 ** 14):
    return hashlib.scrypt(pin.encode(), salt=salt, n=n, r=8, p=1, dklen=32)


class Limiter:
    """In-memory: per-IP and global failure windows."""
    def __init__(self, per_ip=5, lock_s=900, global_cap=30, global_window=3600, clock=time.time):
        self.per_ip, self.lock_s, self.gcap, self.gwin, self.clock = per_ip, lock_s, global_cap, global_window, clock
        self.fails, self.locked, self.gfails, self.glock = {}, {}, [], 0
        self.mu = threading.Lock()

    def check(self, ip):
        """Returns seconds to wait (0 = allowed)."""
        with self.mu:
            t = self.clock()
            w = max(self.locked.get(ip, 0), self.glock) - t
            return int(w) + 1 if w > 0 else 0

    def fail(self, ip):
        with self.mu:
            t = self.clock()
            lst = [x for x in self.fails.get(ip, []) if t - x < self.lock_s] + [t]
            self.fails[ip] = lst
            if len(lst) >= self.per_ip:
                self.locked[ip] = t + self.lock_s
                self.fails[ip] = []
            self.gfails = [x for x in self.gfails if t - x < self.gwin] + [t]
            if len(self.gfails) >= self.gcap:
                self.glock = t + self.lock_s
                self.gfails = []
            if len(self.fails) > 5000:
                self.fails.clear()

    def ok(self, ip):
        with self.mu:
            self.fails.pop(ip, None)



# gb-pipeline: only projected, root-owned status; existing PIN gate is unchanged.
def pipeline_snapshot():
    import datetime, re, stat
    try:
        fd = os.open('/var/lib/gb-ops-monitor/pipeline.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_nlink != 1 or not 2 <= st.st_size <= 16384:
                raise ValueError('file')
            d = json.loads(os.read(fd, 16385))
        finally:
            os.close(fd)
        age = time.time() - datetime.datetime.fromisoformat(d['generated_utc']).timestamp()
        if d.get('schema') != 1 or not isinstance(d['runs'], list) or len(d['runs']) > 2:
            raise ValueError('schema')
        runs, kinds = [], set()
        for r in d['runs']:
            k = r['kind']
            if k not in ('brief', 'install') or k in kinds:
                raise ValueError('kind')
            kinds.add(k)
            if not isinstance(r['name'], str) or not re.fullmatch(r'[a-z0-9-]{1,40}|\[REDACTED\]', r['name']):
                raise ValueError('name')
            start = datetime.datetime.fromisoformat(r['start']).isoformat(timespec='seconds')
            nums = {}
            for key in ('elapsed_s', 'eta_s', 'remaining_s'):
                v = r[key]
                if v is not None and (type(v) not in (int, float) or not 0 <= v < 10**9):
                    raise ValueError('duration')
                nums[key] = v
            phase = r.get('phase')
            if not isinstance(phase, str) or not re.fullmatch(r'[a-z0-9-]{1,32}', phase):
                raise ValueError('phase')
            runs.append(dict(kind=k, name=r['name'], start=start, phase=phase, **nums))
        return dict(available=True, stale=not 0 <= age <= 15, age_s=max(0, int(age)), runs=runs)
    except Exception:
        return dict(available=False, stale=True, runs=[])

class App:
    def __init__(self, cfg, clock=time.time):
        self.cfg = cfg
        self.clock = clock
        self.salt = base64.b64decode(cfg['pin_salt'])
        self.hash = base64.b64decode(cfg['pin_hash'])
        self.n = int(cfg.get('scrypt_n', 2 ** 14))
        self.key = base64.b64decode(cfg['cookie_secret'])
        self.max_age = int(cfg.get('session_seconds', 43200))
        self.secure = bool(cfg.get('cookie_secure', True))
        self.prefix = cfg.get('prefix', '/ops-monitor').rstrip('/')
        self.snapshot_path = cfg['snapshot_path']
        self.limiter = Limiter(clock=clock)
        self.static = {}
        for name in ('index.html', 'app.js', 'style.css', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'):
            with open(os.path.join(WEB, name), 'rb') as f:
                self.static[name] = f.read()

    # --- session
    def make_cookie(self):
        exp = int(self.clock()) + self.max_age
        body = '%d.%s' % (exp, secrets.token_hex(8))
        sig = hmac.new(self.key, body.encode(), hashlib.sha256).hexdigest()
        return '%s.%s' % (body, sig)

    def valid_cookie(self, val):
        try:
            exp, nonce, sig = val.split('.')
            good = hmac.new(self.key, ('%s.%s' % (exp, nonce)).encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(sig, good) and int(exp) > self.clock()
        except Exception:
            return False

    def pin_ok(self, pin):
        if not (isinstance(pin, str) and pin.isascii() and pin.isdigit() and 4 <= len(pin) <= 12):
            hash_pin('0000', self.salt, self.n)  # keep timing similar
            return False
        return hmac.compare_digest(hash_pin(pin, self.salt, self.n), self.hash)

    # --- data
    def snapshot(self):
        try:
            fd = os.open(self.snapshot_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                st = os.fstat(fd)
                import stat as _s
                if not _s.S_ISREG(st.st_mode) or st.st_size > SNAP_MAX or st.st_size < 2:
                    raise ValueError('bad file')
                raw = os.read(fd, SNAP_MAX + 1)
            finally:
                os.close(fd)
            d = json.loads(raw)
            if not isinstance(d, dict):
                raise ValueError('shape')
        except Exception:
            return {'available': False, 'reason': 'снимок недоступен', 'stale': True, 'age_s': None, 'pipeline': pipeline_snapshot()}
        out = {k: d[k] for k in KNOWN['top'] if k in d}
        age = None
        try:
            import datetime
            g = datetime.datetime.fromisoformat(d['generated_utc'])
            age = max(0, int(self.clock() - g.timestamp()))
        except Exception:
            pass
        out.update(available=True, age_s=age, stale=(age is None or age > STALE_AFTER_S), server_utc=
                   time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(self.clock())))
        out['pipeline'] = pipeline_snapshot()
        return out


SEC_HEADERS = [
    ('Cache-Control', 'no-store'), ('Pragma', 'no-cache'),
    ('X-Content-Type-Options', 'nosniff'), ('X-Robots-Tag', 'noindex, nofollow, noarchive'),
    ('Referrer-Policy', 'no-referrer'), ('X-Frame-Options', 'DENY'),
    ('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; "
                                "connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"),
]
TYPES = {'index.html': 'text/html; charset=utf-8', 'app.js': 'application/javascript; charset=utf-8',
         'style.css': 'text/css; charset=utf-8', 'manifest.webmanifest': 'application/manifest+json',
         'icon-180.png': 'image/png', 'icon-192.png': 'image/png', 'icon-512.png': 'image/png'}


def make_handler(app):
    class H(BaseHTTPRequestHandler):
        server_version = 'opsmon'
        sys_version = ''
        protocol_version = 'HTTP/1.1'

        def log_message(self, fmt, *a):  # never log paths/cookies/query; only status
            sys.stderr.write('%s %s\n' % (self.command, a[1] if len(a) > 1 else '-'))

        def ip(self):
            peer = self.client_address[0]
            if peer in ('127.0.0.1', '::1'):
                xr = self.headers.get('X-Real-IP', '')
                if 0 < len(xr) <= 45 and all(c in '0123456789abcdefABCDEF:.' for c in xr):
                    return xr
            return peer

        def send(self, code, body=b'', ctype='application/json', extra=()):
            self.send_response(code)
            for k, v in SEC_HEADERS:
                self.send_header(k, v)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            for k, v in extra:
                self.send_header(k, v)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def jsend(self, code, obj, extra=()):
            self.send(code, json.dumps(obj, ensure_ascii=False).encode(), extra=extra)

        def authed(self):
            for part in (self.headers.get('Cookie') or '').split(';'):
                k, _, v = part.strip().partition('=')
                if k == COOKIE and app.valid_cookie(v):
                    return True
            return False

        def route(self):
            path = self.path.split('?', 1)[0]
            if path == app.prefix:
                return '/redirect'
            if path.startswith(app.prefix + '/'):
                path = path[len(app.prefix):]
            return path

        def do_HEAD(self): self.do_GET()

        def do_GET(self):
            p = self.route()
            if p == '/redirect':
                return self.send(308, b'', extra=[('Location', app.prefix + '/')])
            if p in ('/', '/index.html'):
                return self.send(200, app.static['index.html'], TYPES['index.html'])
            name = p.lstrip('/')
            if name in ('app.js', 'style.css', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'):
                return self.send(200, app.static[name], TYPES[name])
            if p == '/healthz':
                return self.send(200, b'ok\n', 'text/plain')
            if p == '/api/snapshot':
                if not self.authed():
                    return self.jsend(401, {'error': 'auth'})
                return self.jsend(200, app.snapshot())
            return self.jsend(404, {'error': 'not found'})

        def origin_ok(self):
            o = self.headers.get('Origin')
            if not o:
                return True
            host = self.headers.get('X-Forwarded-Host') or self.headers.get('Host') or ''
            return o.split('://', 1)[-1] == host

        def do_POST(self):
            p = self.route()
            ln = int(self.headers.get('Content-Length') or 0)
            if ln > 512 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json' or not self.origin_ok():
                return self.jsend(400, {'error': 'bad request'})
            raw = self.rfile.read(ln)
            if p == '/api/logout':
                return self.jsend(200, {'ok': True}, extra=[('Set-Cookie', self.cookie('', 0))])
            if p != '/api/login':
                return self.jsend(404, {'error': 'not found'})
            ip = self.ip()
            wait = app.limiter.check(ip)
            if wait:
                return self.jsend(429, {'error': 'locked', 'retry_after_s': wait}, extra=[('Retry-After', str(wait))])
            try:
                pin = json.loads(raw).get('pin')
            except Exception:
                pin = None
            if app.pin_ok(pin):
                app.limiter.ok(ip)
                return self.jsend(200, {'ok': True}, extra=[('Set-Cookie', self.cookie(app.make_cookie(), app.max_age))])
            app.limiter.fail(ip)
            time.sleep(0.4)
            wait = app.limiter.check(ip)
            if wait:
                return self.jsend(429, {'error': 'locked', 'retry_after_s': wait}, extra=[('Retry-After', str(wait))])
            return self.jsend(401, {'error': 'pin'})

        def cookie(self, val, age):
            c = '%s=%s; Path=%s/; Max-Age=%d; HttpOnly; SameSite=Strict' % (COOKIE, val, app.prefix, age)
            return c + ('; Secure' if app.secure else '')

        do_PUT = do_DELETE = do_PATCH = lambda self: self.jsend(405, {'error': 'method'})
    return H


def load_config(path):
    st = os.stat(path)
    if st.st_mode & 0o007:
        raise SystemExit('config must not be world-accessible')
    with open(path) as f:
        return json.load(f)


def main():
    cfg = load_config(os.environ.get('OPSMON_CONFIG', '/etc/gb-ops-monitor/config.json'))
    app = App(cfg)
    srv = ThreadingHTTPServer((cfg.get('bind', '127.0.0.1'), int(cfg.get('port', 18090))), make_handler(app))
    srv.daemon_threads = True
    srv.serve_forever()


if __name__ == '__main__':
    main()
''',
    'web/app.js': r''''use strict';
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STAGES = ['Задача', 'Код', 'PR', 'QA', 'CI', 'DEV', 'Принято'];
  var CUR = { claimed: 1, developing: 1, candidate: 2, pr_wait: 2, qa: 3, ci: 4, promoting: 5, dev_wait: 5, done: 6 };
  var PHASE_RU = { claimed: 'задача взята', developing: 'идёт разработка кода', candidate: 'код готов, ждёт PR', pr_wait: 'PR открыт, ждёт проверки',
    qa: 'независимая QA', ci: 'CI (проверки на GitHub)', promoting: 'вливание в dev', dev_wait: 'выкладка на DEV, ждём приёмку',
    blocked: 'ЗАБЛОКИРОВАНО (держит слот)', parked: 'на паузе', done: 'готово' };
  var timer = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function chip(text, kind) { return el('span', 'chip ' + (kind || ''), text); }
  function sh(s) { return s ? s.slice(0, 8) : '—'; }
  function ago(sec) {
    if (sec == null) return 'неизвестно';
    if (sec < 60) return sec + ' с назад';
    if (sec < 3600) return Math.floor(sec / 60) + ' мин назад';
    if (sec < 86400) return Math.floor(sec / 3600) + ' ч ' + Math.floor(sec % 3600 / 60) + ' мин назад';
    return Math.floor(sec / 86400) + ' дн назад';
  }
  function kv(rows) {
    var dl = el('dl', 'kv');
    rows.forEach(function (r) { dl.appendChild(el('dt', null, r[0])); var dd = el('dd'); if (r[1] instanceof Node) dd.appendChild(r[1]); else dd.textContent = r[1]; dl.appendChild(dd); });
    return dl;
  }
  function steps(claim) {
    var ol = el('ol', 'steps'), ph = claim.phase, blocked = ph === 'blocked';
    var idx = blocked ? (claim.resume_phase && CUR[claim.resume_phase] != null ? CUR[claim.resume_phase] : -1) : (CUR[ph] != null ? CUR[ph] : -1);
    STAGES.forEach(function (s, i) {
      var c = '';
      if (idx >= 0) { if (i < idx || ph === 'done') c = 'done'; else if (i === idx) c = blocked ? 'fail' : 'cur'; }
      ol.appendChild(el('li', c, s));
    });
    return ol;
  }

  function nm(n, desc, fallbackTitle) {
    var t = (desc && desc.described && desc.title_ru) || fallbackTitle || (desc && desc.title_ru) || 'Задача #' + n + ' (описание не добавлено)';
    return '#' + n + ' ' + t;
  }
  function descLines(parent, desc) {
    if (!desc || !desc.described) return;
    if (desc.meaning_ru) parent.appendChild(el('div', 'mut', 'Суть: ' + desc.meaning_ru));
    if (desc.result_ru) parent.appendChild(el('div', 'mut', 'Результат: ' + desc.result_ru));
    if (desc.note_ru) parent.appendChild(el('div', 'mut', desc.note_ru));
  }

  function renderNow(d) {
    var s = clear($('now')); s.appendChild(el('h2', null, 'Сейчас выполняется'));
    if (d.slots) {
      if (d.source_mode === 'legacy') s.appendChild(el('div', 'mut', 'Публикации слотов ещё не прошли проверку; показан legacy.'));
      d.slots.forEach(function (slot) {
        var b = el('div', 'item'), c = slot.claim;
        b.appendChild(el('div', 'big', slot.slot));
        var names = { FRESH: 'публикация свежая', STALE: 'данные устарели', MISSING: 'нет публикации',
          INVALID: 'публикация отклонена', ERROR: 'ошибка чтения', OWNER_UNKNOWN: 'владелец UNKNOWN' };
        b.appendChild(chip(names[slot.status] || 'UNKNOWN', slot.status === 'FRESH' ? 'info' : 'bad'));
        b.appendChild(el('div', 'mut', slot.note || 'UNKNOWN'));
        if (c) {
          b.appendChild(el('div', 'big', nm(c.issue, c.desc)));
          descLines(b, c.desc);
          b.appendChild(chip(PHASE_RU[c.phase] || c.phase, c.phase === 'blocked' ? 'bad' : 'info'));
        } else b.appendChild(el('div', 'mut', slot.status === 'FRESH' ? 'Активной задачи в публикации нет; состояние процесса UNKNOWN.' : 'Текущая задача UNKNOWN.'));
        b.appendChild(kv([['Попытка', c && c.attempt != null ? String(c.attempt) : 'UNKNOWN'],
          ['Коммит', c && c.head_sha ? sh(c.head_sha) : 'UNKNOWN'],
          ['Исполнитель/модель', 'UNKNOWN'], ['QA', 'UNKNOWN'], ['CI', 'UNKNOWN'],
          ['Публикация', slot.published_utc || 'UNKNOWN'], ['Возраст публикации', ago(slot.age_s)]]));
        s.appendChild(b);
      });
      if (d.source_mode === 'slots') return;
    }
    var c = d.claim;
    if (!c) {
      s.appendChild(el('div', 'big', d.source_ok === false ? 'Нет данных чекпоинта' : 'Исполнитель свободен'));
      s.appendChild(el('div', 'mut', d.source_ok === false ? (d.source_error || '') : 'Активной задачи нет.'));
      return;
    }
    s.appendChild(el('div', 'big', c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || 'без названия')));
    descLines(s, c.desc);
    var kind = c.phase === 'blocked' ? 'bad' : 'info';
    s.appendChild(chip(PHASE_RU[c.phase] || c.phase, kind));
    s.appendChild(steps(c));
    var rows = [['Попытка', c.attempt != null ? c.attempt + ' из ' + (c.max_attempts || '?') : '—']];
    rows.push(['Исполнитель/модель', 'не подтверждено']);
    if (c.pr != null) rows.push(['PR', '#' + c.pr]);
    rows.push(['Коммит', sh(c.head_sha)]);
    if (c.qa && c.qa.verdict) rows.push(['QA', c.qa.verdict + (c.qa.reviewed_sha ? ' (' + sh(c.qa.reviewed_sha) + ')' : '')]);
    if (c.ci) rows.push(['CI', c.ci.total ? c.ci.passed + '/' + c.ci.total + ' ✓' + (c.ci.failed ? ', ошибок ' + c.ci.failed : '') + (c.ci.pending ? ', идут ' + c.ci.pending : '') : 'запущен, данных по задачам нет']);
    rows.push(['Замечено монитором', d.changed_utc ? ago(d.age_s != null ? Math.max(0, Math.floor((Date.parse(d.server_utc) - Date.parse(d.changed_utc)) / 1000)) : null) : 'не замечено с запуска монитора']);
    if (c.reason) rows.push(['Причина', c.reason]);
    s.appendChild(kv(rows));
  }

  var BL_KIND = { 'опубликована': 'info', 'ожидает': 'warn', 'припаркована': 'bad' };
  var BL_SHOW = 6;
  function blItem(x) {
    var b = el('div', 'item bl');
    var head = el('div', 'blhead');
    head.appendChild(el('span', 'blprio', x.priority != null ? String(x.priority) : '—'));
    var t = el('div', 'bltitle');
    t.appendChild(el('span', 'blid', x.id + (x.issue != null && x.id !== '#' + x.issue ? ' · #' + x.issue : '')));
    t.appendChild(document.createTextNode(' ' + (x.title_ru || '')));
    head.appendChild(t); b.appendChild(head);
    if (x.meaning_ru) b.appendChild(el('div', 'mut', x.meaning_ru));
    var m = el('div', 'blmeta'); m.appendChild(chip(x.status || '—', BL_KIND[x.status]));
    if (x.depends_on && x.depends_on.length) m.appendChild(el('span', 'mut', 'после: ' + x.depends_on.join(', ')));
    b.appendChild(m);
    if (x.note_ru) b.appendChild(el('div', 'mut', x.note_ru));
    return b;
  }
  function renderBacklog(d) {
    var s = clear($('backlog')), bl = d.backlog;
    if (!bl) return;
    var it = bl.items || [];
    s.appendChild(el('h2', null, 'Бэклог' + (bl.available ? ' (' + it.length + ')' : '')));
    if (!bl.available) { s.appendChild(el('div', 'mut', 'Бэклог недоступен: ' + (bl.note || 'нет данных') + '.')); return; }
    if (!it.length) { s.appendChild(el('div', 'mut', 'Запланированных задач нет.')); return; }
    s.appendChild(el('div', 'mut', 'В планах, ещё не взяты в работу. По приоритету: 1 — первой.'));
    it.slice(0, BL_SHOW).forEach(function (x) { s.appendChild(blItem(x)); });
    if (it.length > BL_SHOW) {
      var det = el('details', 'blmore'); det.appendChild(el('summary', null, 'Показать ещё ' + (it.length - BL_SHOW)));
      it.slice(BL_SHOW).forEach(function (x) { det.appendChild(blItem(x)); });
      s.appendChild(det);
    }
  }

  function renderInfra(d) {
    var s = clear($('infra')); s.appendChild(el('h2', null, 'Исполнитель и DEV'));
    var ex = d.executor || {}, dv = d.dev || {};
    var exKind = ex.running === true ? 'ok' : (ex.state === 'UNKNOWN' ? 'warn' : 'bad');
    var exTxt = ex.running === true ? 'работает' : (ex.state === 'UNKNOWN' ? 'статус неизвестен' : 'ОСТАНОВЛЕН (' + ex.state + ')');
    var rows = [['Исполнитель', chip(exTxt, exKind)]];
    if (dv.status === 'READABLE') {
      rows.push(['Принятый DEV SHA', sh(dv.source_sha) + (dv.release_id ? ' · ' + dv.release_id : '')]);
      rows.push(['Статус релиза', dv.accepted_status || '—']);
      rows.push(['Ожидает выкладки', dv.pending === true ? 'да' : (dv.pending === false ? 'нет' : '—')]);
    } else rows.push(['Квитанция DEV', 'недоступна']);
    if (d.done_count != null) rows.push([d.counts_complete === false ? 'Готово задач (из доступных публикаций)' : 'Готово задач (всего)', String(d.done_count)]);
    if (d.parked_count != null) rows.push(['Припарковано (уникальных ID)', String(d.parked_count)]);
    s.appendChild(kv(rows));
  }

  function renderPaused(d) {
    var s = clear($('paused')), items = [];
    var c = d.claim;
    if (c && c.phase === 'blocked') items.push({ n: c.issue != null ? nm(c.issue, c.desc, c.title_source === 'goal' ? c.title : null) : (c.title || ''), desc: c.desc, reason: c.reason || 'причина не указана', attempt: c.attempt, max: c.max_attempts, action: 'Нужно решение Owner/OPS: заблокированная задача держит единственный слот.', succ: 'нет — слот занят' });
    (d.parked || []).forEach(function (p) { items.push({ n: nm(p.issue, p.desc), desc: p.desc, closed: p.closed === true, reason: p.reason, attempt: p.attempt, max: 3, action: p.closed === true ? 'Решение не нужно: Issue закрыт на GitHub.' : 'Нужно решение Owner: задача снята с очереди (PARK).', succ: p.has_successor === true ? 'разрешён' : (p.has_successor === false ? 'не разрешён' : 'не указано') }); });
    if (!items.length) return;
    s.appendChild(el('h2', null, 'На паузе / заблокировано'));
    items.forEach(function (i) {
      var b = el('div', 'item'); b.appendChild(el('div', 'big', i.n));
      if (i.closed) b.appendChild(chip('закрыта', 'ok'));
      descLines(b, i.desc);
      b.appendChild(kv([['Причина', i.reason], ['Попыток', i.attempt != null ? i.attempt + ' из ' + i.max : '—'], ['Преемник', i.succ], ['Действие Owner', i.action]]));
      s.appendChild(b);
    });
  }

  function renderNext(d) {
    var s = clear($('next')); s.appendChild(el('h2', null, 'Следующие задачи'));
    var q = d.queue || {}, qi = q.items || [];
    s.appendChild(el('div', 'mut', q.note || 'ожидает взятия исполнителем'));
    qi.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x)));
      descLines(b, x); s.appendChild(b); });
    if (!qi.length) s.appendChild(el('div', 'mut', 'Полный список открытых задач монитор не читает (нет доступа к GitHub); показаны только отмеченные вручную.'));
  }

  function renderDone(d) {
    var s = clear($('done')); s.appendChild(el('h2', null, 'Недавно завершено'));
    var r = d.recent_done || [];
    if (!r.length) { s.appendChild(el('div', 'mut', 'Журнал пуст: ведётся только с момента установки монитора.')); return; }
    r.forEach(function (x) {
      var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x.desc, x.title && x.title.indexOf('Задача #') !== 0 ? x.title : null)));
      descLines(b, x.desc);
      b.appendChild(el('div', 'mut', x.evidence + (x.source_sha ? ' · ' + sh(x.source_sha) : '') + (x.release_id ? '' : ' (подтверждения релиза нет)')));
      s.appendChild(b);
    });
  }

  function renderDoneAll(d) {
    var s = clear($('doneall')), a = d.done_all || [];
    if (!a.length) return;
    s.appendChild(el('h2', null, 'Все выполненные задачи (' + a.length + ')'));
    a.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, nm(x.issue, x))); descLines(b, x); s.appendChild(b); });
  }

  function renderOutside(d) {
    var s = clear($('outside')), o = d.product_outside || [];
    if (!o.length) return;
    s.appendChild(el('h2', null, 'Вне исполнителя'));
    o.forEach(function (x) { var b = el('div', 'item'); b.appendChild(el('div', null, '#' + x.id + ' ' + x.title)); b.appendChild(chip(x.status)); s.appendChild(b); });
  }


  // gb-pipeline: textContent only; the snapshot API retains its PIN check.
  function renderPipeline(p) {
    var s = $('pipeline');
    if (!s) { s = el('section'); s.id = 'pipeline'; $('infra').parentNode.insertBefore(s, $('infra')); }
    clear(s); s.appendChild(el('h2', null, 'Конвейер'));
    if (!p || !p.available) { s.appendChild(el('div', 'mut', 'Статус конвейера недоступен.')); return; }
    if (p.stale) s.appendChild(chip('Данные устарели', 'warn'));
    var runs = p.runs || [];
    if (!runs.length) s.appendChild(el('div', 'mut', 'Активных запусков нет.'));
    function duration(v) { return v == null ? 'нет истории' : Math.round(v) + ' с'; }
    runs.forEach(function (r) {
      var b = el('div', 'item');
      b.appendChild(el('div', null, (r.kind === 'brief' ? 'Тело задачи: ' : 'Установщик: ') + r.name));
      b.appendChild(kv([['Этап', r.phase], ['Начало', r.start], ['Прошло', duration(r.elapsed_s)],
        ['ETA (медиана)', duration(r.eta_s)], ['Осталось по оценке', duration(r.remaining_s)]]));
      s.appendChild(b);
    });
  }

  function render(d) {
    renderPipeline(d.pipeline);
    var f = $('fresh'), bn = $('banner');
    var stale = d.available === false || d.stale;
    f.className = 'chip ' + (stale ? 'bad' : 'ok');
    f.textContent = d.available === false ? 'нет снимка' : (stale ? 'данные устарели: ' + ago(d.age_s) : 'данные свежие · ' + ago(d.age_s));
    if (!stale && d.source_mode === 'slots') {
      f.className = 'chip warn';
      f.textContent = d.source_ok === false ? 'публикации слотов неполны или устарели' : 'публикации свежие · процессы UNKNOWN';
    }
    bn.hidden = true; bn.className = '';
    if (d.available === false) { bn.hidden = false; bn.textContent = 'Нет свежих данных: снимок недоступен. Писатель снимка остановлен или не установлен. Ниже — только пустые блоки.'; }
    else if (stale) { bn.hidden = false; bn.textContent = 'Нет свежих данных (' + ago(d.age_s) + '). Показано последнее известное состояние, ему нельзя доверять как текущему.'; }
    else if (d.source_mode === 'slots' && d.source_ok === false) { bn.hidden = false; bn.textContent = d.source_error || 'Статусы слотов недоступны.'; }
    else if (d.executor && d.executor.running === false) { bn.hidden = false; bn.className = 'warn'; bn.textContent = 'Исполнитель остановлен.'; }
    if (d.available === false) { ['now', 'backlog', 'infra', 'paused', 'done', 'doneall', 'outside'].forEach(function (k) { clear($(k)); }); renderNext({}); return; }
    var dim = stale ? 0.55 : 1; ['now', 'backlog', 'infra', 'paused', 'next', 'done', 'doneall', 'outside'].forEach(function (k) { $(k).style.opacity = dim; });
    renderNow(d); renderBacklog(d); renderInfra(d); renderPaused(d); renderNext(d); renderDone(d); renderDoneAll(d); renderOutside(d);
    $('updated').textContent = 'обновлено ' + new Date().toLocaleTimeString('ru-RU');
  }

  function show(which) { $('login').hidden = which !== 'login'; $('app').hidden = which !== 'app'; }

  function poll() {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(poll, 5000); return; }
    fetch('api/snapshot', { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (r.status === 401) { show('login'); return null; }
      return r.json();
    }).then(function (d) { if (d) { show('app'); render(d); } timer = setTimeout(poll, 30000); })
      .catch(function () { var f = $('fresh'); f.className = 'chip bad'; f.textContent = 'нет связи'; $('banner').hidden = false; $('banner').textContent = 'Нет связи с монитором.'; show('app'); timer = setTimeout(poll, 30000); });
  }

  $('pinform').addEventListener('submit', function (e) {
    e.preventDefault(); var err = $('loginerr'); err.textContent = '';
    fetch('api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('pin').value }) })
      .then(function (r) { return r.json().then(function (j) { return [r.status, j]; }); })
      .then(function (x) {
        $('pin').value = '';
        if (x[0] === 200) poll();
        else if (x[0] === 429) err.textContent = 'Слишком много попыток. Подождите ' + Math.ceil((x[1].retry_after_s || 900) / 60) + ' мин.';
        else err.textContent = 'Неверный PIN.';
      }).catch(function () { err.textContent = 'Нет связи.'; });
  });
  $('logout').addEventListener('click', function () {
    fetch('api/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(function () { show('login'); });
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  poll();
})();
''',
}
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import stat
import sys


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def dry_run(environ):
    for name in ('DRY', 'DRY1'):
        require(name not in environ or type(environ[name]) is str and environ[name] in ('0', '1'),
                name + ' должен быть 0 или 1')
    require(not ('DRY' in environ and 'DRY1' in environ) or environ['DRY'] == environ['DRY1'],
            'DRY и DRY1 должны совпадать, если заданы одновременно')
    return environ.get('DRY', environ.get('DRY1', '0')) == '1'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def absolute(value):
    p = Path(value)
    require(p.is_absolute() and '..' not in p.parts, 'Нужен абсолютный путь без ..')
    return p


def directory(path):
    """Pin a directory descriptor, rejecting symlinks and writable ancestors."""
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        for part in path.parts[1:]:
            nxt = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = nxt
            info = os.fstat(fd)
            require(info.st_uid in (0, os.geteuid()) and not info.st_mode & 0o022,
                    'Недоверенный каталог: ' + str(path))
        return fd
    except BaseException:
        os.close(fd)
        raise


def read_at(fd, name, limit=1 << 20):
    file_fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=fd)
    try:
        info = os.fstat(file_fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid()
                and not info.st_mode & 0o022 and 0 < info.st_size <= limit,
                'Недоверенный файл: ' + name)
        data = os.read(file_fd, limit + 1)
        require(len(data) <= limit, 'Слишком большой файл: ' + name)
        return data, dict(mode=stat.S_IMODE(info.st_mode), uid=info.st_uid, gid=info.st_gid)
    finally:
        os.close(file_fd)


def new_file(fd, name, data):
    file_fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                      0o600, dir_fd=fd)
    with os.fdopen(file_fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def replace_file(fd, name, data, metadata):
    # Tempfile is created inside the pinned destination directory (same filesystem).
    for _ in range(32):
        tmp_name = '.slots-monitor-' + secrets.token_hex(12)
        try:
            file_fd = os.open(tmp_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                              0o600, dir_fd=fd)
            break
        except FileExistsError:
            continue
    else:
        raise RuntimeError('Не удалось создать временный файл')
    try:
        with os.fdopen(file_fd, 'wb') as stream:
            if os.geteuid() == 0:
                os.fchown(stream.fileno(), metadata['uid'], metadata['gid'])
            os.fchmod(stream.fileno(), metadata['mode'])
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp_name, name, src_dir_fd=fd, dst_dir_fd=fd)
        os.fsync(fd)
    finally:
        try:
            os.unlink(tmp_name, dir_fd=fd)
        except FileNotFoundError:
            pass


def interrupted(signum, frame):
    raise RuntimeError('Прервано сигналом %d' % signum)


def transaction(targets, wanted, metadata, expected=None):
    before = {name: read_at(fd, Path(name).name) for name, fd in targets.items()}
    expected = expected or {name: digest(data) for name, (data, _) in before.items()}
    for name, (data, _) in before.items():
        require(digest(data) == expected[name], 'Исходник изменился во время подготовки: ' + name)
    changed = []
    try:
        for name, fd in targets.items():
            require(digest(read_at(fd, Path(name).name)[0]) == expected[name],
                    'Исходник изменился перед заменой: ' + name)
            # Include the current file even if fsync fails after the atomic rename.
            changed.append(name)
            replace_file(fd, Path(name).name, wanted[name], metadata[name])
        for name, fd in targets.items():
            require(digest(read_at(fd, Path(name).name)[0]) == digest(wanted[name]),
                    'Ошибка проверки после замены: ' + name)
    except BaseException:
        # A second signal must not interrupt the automatic rollback.
        for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            signal.signal(sig, signal.SIG_IGN)
        failures = []
        for name in reversed(changed):
            try:
                data, meta = before[name]
                replace_file(targets[name], Path(name).name, data, meta)
            except BaseException:
                failures.append(name)
        require(not failures, 'Автооткат не завершён; используйте сохранённую резервную копию: ' + ', '.join(failures))
        print('Изменения отменены автоматически.', file=sys.stderr)
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description='Только исходники OPS monitor; без конфигурации и перезапуска служб.')
    parser.add_argument('action', choices=('install', 'rollback', 'remove'))
    parser.add_argument('--source-root', default='/usr/local/lib/gb-ops-monitor',
                        help='установленный каталог с opsmon/ и web/ (default: %(default)s)')
    parser.add_argument('--backup-dir', required=True, help='отдельный закрытый каталог резервной копии')
    args = parser.parse_args()
    dry = dry_run(os.environ)
    dry_label = 'DRY' if 'DRY' in os.environ else 'DRY1'
    root, backup = absolute(args.source_root), absolute(args.backup_dir)
    require(root != backup and root not in backup.parents and backup not in root.parents,
            'Резервная копия должна находиться вне дерева исходников')
    require(set(PAYLOADS) == set(BASELINES) == set(PAYLOAD_SHA256), 'Неверный набор payload')
    encoded = {name: value.encode('utf-8') for name, value in PAYLOADS.items()}
    for name in encoded:
        require(digest(encoded[name]) == PAYLOAD_SHA256[name], 'Повреждён встроенный payload: ' + name)
        if name.endswith('.py'):
            compile(encoded[name], name, 'exec')  # no import, no execution, no pyc
    fds = []
    try:
        root_fd = directory(root)
        fds.append(root_fd)
        fcntl.flock(root_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        targets = {}
        for name in BASELINES:
            fd = directory(root / Path(name).parent)
            fds.append(fd)
            targets[name] = fd
        current = {name: read_at(fd, Path(name).name) for name, fd in targets.items()}
        if args.action == 'install':
            for name, (data, _) in current.items():
                require(digest(data) == BASELINES[name], 'Исходный SHA256 не совпадает: ' + name)
            parent_fd = directory(backup.parent)
            fds.append(parent_fd)
            try:
                os.stat(backup.name, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise RuntimeError('Каталог резервной копии уже существует')
            if dry:
                print(dry_label + ': исходные SHA256/payload проверены; install без записей: ' + ', '.join(BASELINES))
                return
            os.mkdir(backup.name, 0o700, dir_fd=parent_fd)
            backup_fd = os.open(backup.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                                dir_fd=parent_fd)
            fds.append(backup_fd)
            manifest = dict(schema='GB_SLOTS_MONITOR_BACKUP_V1', source_root=str(root), files={})
            for n, (name, (data, meta)) in enumerate(current.items()):
                saved = '%d.source' % n
                new_file(backup_fd, saved, data)
                require(digest(read_at(backup_fd, saved)[0]) == BASELINES[name], 'Ошибка резервной копии')
                manifest['files'][name] = dict(meta, backup=saved, sha256=BASELINES[name],
                                               installed_sha256=PAYLOAD_SHA256[name])
            new_file(backup_fd, 'manifest.json', json.dumps(manifest, ensure_ascii=False, sort_keys=True).encode())
            os.fsync(backup_fd)
            os.fsync(parent_fd)
            transaction(targets, encoded, {name: meta for name, (_, meta) in current.items()}, BASELINES)
            print('Установлены только исходники: ' + ', '.join(BASELINES))
            print('Резервная копия: ' + str(backup))
        else:
            backup_fd = directory(backup)
            fds.append(backup_fd)
            manifest = json.loads(read_at(backup_fd, 'manifest.json', 16384)[0])
            require(isinstance(manifest, dict) and set(manifest) == {'schema', 'source_root', 'files'}
                    and manifest['schema'] == 'GB_SLOTS_MONITOR_BACKUP_V1'
                    and manifest['source_root'] == str(root) and isinstance(manifest['files'], dict)
                    and set(manifest['files']) == set(BASELINES), 'Неверный манифест резервной копии')
            restored, metadata = {}, {}
            for n, name in enumerate(BASELINES):
                entry = manifest['files'][name]
                require(isinstance(entry, dict)
                        and set(entry) == {'backup', 'sha256', 'installed_sha256', 'mode', 'uid', 'gid'}
                        and entry['backup'] == '%d.source' % n and entry['sha256'] == BASELINES[name]
                        and entry['installed_sha256'] == PAYLOAD_SHA256[name]
                        and type(entry['mode']) is int and 0 <= entry['mode'] <= 0o777
                        and not entry['mode'] & 0o022 and entry['uid'] == os.geteuid()
                        and type(entry['uid']) is int and type(entry['gid']) is int and entry['gid'] >= 0,
                        'Неверная запись манифеста: ' + name)
                restored[name] = read_at(backup_fd, entry['backup'])[0]
                metadata[name] = {k: entry[k] for k in ('mode', 'uid', 'gid')}
                require(digest(restored[name]) == BASELINES[name], 'Повреждена резервная копия: ' + name)
                require(digest(current[name][0]) in (PAYLOAD_SHA256[name], BASELINES[name]),
                        'Исходник изменён после установки; остановка без перезаписи: ' + name)
            if dry:
                print(dry_label + ': резервная копия/SHA256 проверены; ' + args.action + ' без записей')
                return
            transaction(targets, restored, metadata, {name: digest(data) for name, (data, _) in current.items()})
            print('Исходные файлы восстановлены; патч удалён. Резервная копия сохранена: ' + str(backup))
        print('Службы и writer не запускались. Перезапуск выполняет владелец после проверки поставки unit.')
    finally:
        for fd in reversed(fds):
            os.close(fd)


if __name__ == '__main__':
    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, interrupted)
    try:
        main()
    except Exception as exc:
        print('ОШИБКА: ' + str(exc), file=sys.stderr)
        raise SystemExit(1)

PY_SLOTS_MONITOR_V1
