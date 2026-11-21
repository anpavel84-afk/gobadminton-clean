#!/usr/bin/env python3
"""sync_state.py — собирает ops/grok-toolkit/LIVE_STATE_RU.md (живое состояние для резервного PM).

Источники (всё только чтение):
  * VPS через SSH как <ops-user>: `sudo -n -u <executor-user> /usr/local/bin/gb-grok-status` и
    /var/lib/gb-ops-monitor/snapshot.json (нужен paramiko и переменные GB_*; без них раздел = UNKNOWN);
  * GitHub REST: HEAD dev, открытые Issue и PR (токен из GH_PUSH_TOKEN или GH_READ_TOKEN, не печатается);
  * DEV: https://dev.gobadminton.ru/v1/meta;
  * backlog_ru.json (локальная копия OPS);
  * grok_streams.json (рабочие потоки, вопросы и решения Owner, активный оператор).

Запись: только файл LIVE_STATE_RU.md в клоне ветки ops/takeover-runbook-v1. Коммит и push делаются ТОЛЬКО если
содержимое изменилось (строка «Обновлено» не считается), только в эту ветку, без force. В dev не пушит никогда.
Перед push: секрет-скан результата (fail-closed) и проверка правила одного оператора: если в удалённом
LIVE_STATE активен не Grok, sync отказывается (код 3), пока резервный PM не вернёт управление или не передан
--take-back (только по слову Owner).

Пример:
  GB_VPS_HOST=... GB_OPS_USER=... GB_EXEC_USER=... GB_OPS_SSH_KEY=... GB_KNOWN_HOSTS=... \
  ~/sshvenv/bin/python ops/grok-toolkit/sync_state.py --repo /workspace/tkr \
      --streams /workspace/outputs/grok_streams.json --backlog /workspace/outputs/backlog/backlog_ru.json [--push]
Без --push только пишет файл и печатает, изменилось ли содержимое (dry-run).
"""
import argparse, base64, datetime as dt, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = 'anpavel84-afk/gobadminton-clean'
BRANCH = 'ops/takeover-runbook-v1'          # единственная ветка, куда разрешён push
FORBIDDEN_BRANCHES = {'dev', 'main'}
REL = 'ops/grok-toolkit/LIVE_STATE_RU.md'
DEV_META = 'https://dev.gobadminton.ru/v1/meta'
TZ = dt.timezone(dt.timedelta(hours=-3))    # America/Sao_Paulo (сейчас UTC-3)
STAMP_PREFIX = '**Обновлено:**'
OP_PREFIX = '**Активный оператор:**'
SECRET_RX = [re.compile(p) for p in (
    r'gh[pousr]_[A-Za-z0-9]{20,}', r'github_pat_[A-Za-z0-9_]{20,}', r'\bsk-[A-Za-z0-9_-]{16,}',
    r'-----BEGIN [A-Z ]*PRIVATE KEY-----', r'xox[abpr]-[A-Za-z0-9-]{10,}', r'AKIA[0-9A-Z]{16}',
    r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.')]
IPV4 = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')


def now_local():
    return dt.datetime.now(TZ)


def fmt_ts(ts):
    if ts in (None, ''):
        return 'UNKNOWN'
    try:
        if isinstance(ts, (int, float)):
            d = dt.datetime.fromtimestamp(ts, dt.timezone.utc)
        else:
            d = dt.datetime.fromisoformat(str(ts).replace('Z', '+00:00'))
        return d.astimezone(TZ).strftime('%d.%m.%Y %H:%M') + ' (Сан-Паулу)'
    except Exception:
        return str(ts)


# ---------------------------------------------------------------- sources
def token():
    return os.environ.get('GH_READ_TOKEN') or os.environ.get('GH_PUSH_TOKEN')


def gh(path):
    h = {'Accept': 'application/vnd.github+json', 'User-Agent': 'gb-sync-state'}
    t = token()
    if t:
        h['Authorization'] = 'Bearer ' + t
    req = urllib.request.Request('https://api.github.com/repos/%s/%s' % (REPO, path), headers=h)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def github_state():
    out = {'ok': False}
    try:
        out['dev_sha'] = gh('branches/dev')['commit']['sha']
        items = gh('issues?state=open&per_page=100')
        out['issues'] = [i for i in items if 'pull_request' not in i]
        out['prs'] = gh('pulls?state=open&per_page=50')
        out['ok'] = True
    except Exception as e:  # noqa
        out['error'] = type(e).__name__
    return out


def dev_meta():
    try:
        req = urllib.request.Request(DEV_META, headers={'User-Agent': 'gb-sync-state'})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception as e:
        return {'error': type(e).__name__}


def vps_state():
    need = ['GB_VPS_HOST', 'GB_OPS_USER', 'GB_EXEC_USER', 'GB_OPS_SSH_KEY', 'GB_KNOWN_HOSTS']
    if not all(os.environ.get(k) for k in need):
        return {'error': 'GB_* не заданы (SSH не настроен)'}
    try:
        import paramiko
    except ImportError:
        return {'error': 'нет paramiko'}
    exp = lambda p: os.path.expanduser(p if '/' in p else '~/.ssh/' + p)
    try:
        c = paramiko.SSHClient()
        c.load_host_keys(exp(os.environ['GB_KNOWN_HOSTS']))
        c.set_missing_host_key_policy(paramiko.RejectPolicy())
        c.connect(os.environ['GB_VPS_HOST'], username=os.environ['GB_OPS_USER'],
                  key_filename=exp(os.environ['GB_OPS_SSH_KEY']), timeout=20, allow_agent=False, look_for_keys=False)
        res = {}
        for key, cmd in (('status', 'sudo -n -u %s /usr/local/bin/gb-grok-status' % os.environ['GB_EXEC_USER']),
                         ('snapshot', 'cat /var/lib/gb-ops-monitor/snapshot.json')):
            _, o, _e = c.exec_command(cmd, timeout=60)
            txt = o.read().decode(errors='replace')
            try:
                res[key] = json.loads(txt)
            except Exception:
                res[key] = None
        c.close()
        return res
    except Exception as e:
        return {'error': 'SSH: ' + type(e).__name__}


# ---------------------------------------------------------------- render
def issue_title(n, titles, ghs):
    v = titles.get(str(n))
    if isinstance(v, dict) and v.get('title_ru'):
        return v['title_ru']
    if isinstance(v, str) and v:
        return v
    for i in ghs.get('issues', []) if ghs.get('ok') else []:
        if i['number'] == n:
            return i['title']
    return ''


def md_escape(s):
    return str(s).replace('|', '\\|').replace('\n', ' ')


def render(vps, ghs, meta, backlog, streams, titles, operator_line):
    L = []
    st = (vps or {}).get('status') or {}
    claim = st.get('claim') or {}
    rec = st.get('dev_receipt') or {}
    worker = st.get('worker') or {}
    L += ['# GoBadminton · LIVE STATE (живое состояние для резервного PM)', '',
          STAMP_PREFIX + ' ' + now_local().strftime('%d.%m.%Y %H:%M') + ' (Сан-Паулу, UTC-3), генератор `ops/grok-toolkit/sync_state.py`',
          operator_line, '',
          '> Генерируется автоматически. Руками правится только строка «Активный оператор» (протокол передачи: '
          '`docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md` §9). Секретов здесь нет. UNKNOWN ≠ 0.', '']
    # 1 pipeline
    L += ['## 1. Конвейер (исполнитель)', '']
    if vps.get('error') and not st:
        L += ['- Статус с VPS: **UNKNOWN** (%s).' % vps['error']]
    else:
        L += ['- Исполнитель: `%s/%s`, MainPID %s (время проверки — в строке «Обновлено»).' % (
                  worker.get('state', '?'), worker.get('substate', '?'), worker.get('main_pid', '?')),
              '- Выполнено задач (`done_count`): **%s**.' % claim.get('done_count', 'UNKNOWN')]
        if claim.get('issue'):
            qa = claim.get('qa') or {}
            L += ['- Активная задача: **#%s** %s — фаза `%s`, попытка %s, head `%s`, PR %s, QA %s на `%s`%s.' % (
                claim['issue'], md_escape(issue_title(claim['issue'], titles, ghs)),
                claim.get('phase'), claim.get('attempt'), (claim.get('head_sha') or '—')[:8],
                ('#%s' % claim['pr']) if claim.get('pr') else '—', qa.get('verdict', '—'), (qa.get('reviewed_sha') or '—')[:8],
                (', причина: %s, resume_phase: %s' % (claim.get('reason'), claim.get('resume_phase'))) if claim.get('reason') else '')]
        L += ['- Последняя выкатка DEV: `%s`, %s, pending=%s, source `%s`, завершена %s.' % (
            rec.get('release_id', 'UNKNOWN'), rec.get('accepted_status', 'UNKNOWN'), rec.get('pending'),
            (rec.get('source_sha') or '?')[:8], fmt_ts(rec.get('finished_at')))]
    L += ['- DEV `/v1/meta`: gitSha `%s`, apiVersion `%s`.' % ((meta.get('gitSha') or 'UNKNOWN')[:8], meta.get('apiVersion', 'UNKNOWN'))
          if 'error' not in meta else '- DEV `/v1/meta`: **UNKNOWN** (%s).' % meta['error']]
    L += ['- GitHub `dev` HEAD: `%s`.' % (ghs.get('dev_sha', 'UNKNOWN')[:8] if ghs.get('ok') else 'UNKNOWN')]
    if ghs.get('ok') and 'error' not in meta and st:
        same = (meta.get('gitSha') or '')[:8] == ghs['dev_sha'][:8] == (rec.get('source_sha') or '')[:8]
        L += ['- Сверка dev HEAD = DEV gitSha = квитанция: **%s**.' % ('совпадает' if same else 'НЕ совпадает, разобрать')]
    L += ['']
    # 2 next tasks / backlog
    items = sorted([i for i in (backlog or {}).get('items', []) if i.get('status') not in ('выполнено', 'done')],
                   key=lambda i: (i.get('priority') is None, i.get('priority') or 0))
    L += ['## 2. Следующие задачи и бэклог (топ-10, `backlog_ru.json`)', '',
          '| # | id | Issue | Задача | Статус | Зависит от | Заметка |', '|---|---|---|---|---|---|---|']
    for n, i in enumerate(items[:10], 1):
        L.append('| %d | %s | %s | %s | %s | %s | %s |' % (
            n, md_escape(i.get('id')), ('#%s' % i['issue']) if i.get('issue') else '—', md_escape(i.get('title_ru', '')),
            md_escape(i.get('status', '')), md_escape(', '.join(i.get('depends_on') or []) or '—'), md_escape(i.get('note_ru', '') or '')))
    L += ['', 'Всего в бэклоге не выполнено: %d.' % len(items), '']
    # 3 github
    L += ['## 3. Открытые PR и Issue (GitHub)', '']
    if ghs.get('ok'):
        L += ['**PR:**']
        for p in ghs['prs']:
            # своя ветка: head SHA меняется от каждого sync — не печатаем, иначе файл меняется бесконечно
            sha = 'эта ветка' if p['head']['ref'] == BRANCH else p['head']['sha'][:8]
            L.append('- #%s `%s` → `%s` @ `%s`: %s' % (p['number'], p['head']['ref'], p['base']['ref'], sha, md_escape(p['title'])))
        L += ['', '**Issue (открытые, номера ≥ 60):**']
        for i in ghs['issues']:
            if i['number'] >= 60:
                L.append('- #%s: %s' % (i['number'], md_escape(i['title'])))
        old = [str(i['number']) for i in ghs['issues'] if i['number'] < 60]
        if old:
            L.append('- Старые открытые (< 60, нужен разбор Owner): ' + ', '.join('#' + x for x in old))
    else:
        L += ['- GitHub: **UNKNOWN** (%s).' % ghs.get('error')]
    L += ['']
    # 4 streams
    L += ['## 4. Рабочие потоки Grok (что в работе и где лежит)', '', '| Поток | Состояние | Пути | Дальше |', '|---|---|---|---|']
    for s in streams.get('streams', []):
        L.append('| %s | %s | %s | %s |' % (md_escape(s.get('title_ru')), md_escape(s.get('state_ru')),
                                            md_escape('; '.join('`%s`' % p for p in s.get('paths', []))), md_escape(s.get('next_ru', ''))))
    L += ['', 'Пути с префиксом `box:` лежат на рабочем компьютере Grok, а не в репозитории. Резервному PM они недоступны: '
          'опирайтесь на копии в `ops/grok-toolkit/`.', '']
    L += ['## 5. Открытые вопросы к Owner', ''] + ['- ' + q for q in streams.get('open_owner_questions', [])] + ['']
    L += ['## 6. Последние решения Owner', ''] + ['- ' + q for q in streams.get('recent_owner_decisions', [])] + ['']
    L += ['## 7. Ссылки', '',
          '- Runbook: [OPS_TAKEOVER_RUNBOOK_V001.md](../../docs/workbench/OPS_TAKEOVER_RUNBOOK_V001.md)',
          '- Учения и протокол передачи: [OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md](../../docs/workbench/OPS_BACKUP_PM_TAKEOVER_DRILL_V001.md)',
          '- Инструменты: [README_RU.md](README_RU.md)',
          '- Заметки резервного PM (если были): [BACKUP_NOTES_RU.md](BACKUP_NOTES_RU.md)', '']
    return '\n'.join(L)


# ---------------------------------------------------------------- safety
def scrub(text):
    """Заменяет известные приватные значения из окружения плейсхолдерами; затем fail-closed скан."""
    for k in ('GB_VPS_HOST', 'GB_VPS_HOSTNAME', 'GB_OPS_USER', 'GB_EXEC_USER', 'GB_MON_USER', 'GB_OPS_SSH_KEY', 'GB_KNOWN_HOSTS'):
        v = os.environ.get(k)
        if v and len(v) >= 4:
            text = text.replace(v, '<%s>' % k[3:].lower().replace('_', '-'))
    pin_file = os.environ.get('GB_PIN_FILE')
    problems = []
    if pin_file and os.path.isfile(pin_file):
        pin = open(pin_file).read().strip()
        if pin and re.search(r'(?<!\d)%s(?!\d)' % re.escape(pin), text):
            problems.append('PIN')
    for rx in SECRET_RX:
        if rx.search(text):
            problems.append(rx.pattern[:12])
    for m in IPV4.finditer(text):
        if not m.group(0).startswith(('127.', '0.')):
            problems.append('ipv4')
    t = token()
    if t and t in text:
        problems.append('token')
    return text, problems


def strip_stamp(text):
    return '\n'.join(l for l in text.splitlines() if not l.startswith(STAMP_PREFIX))


def git(repo, *args, check=True, env=None):
    return subprocess.run(['git', '-C', str(repo)] + list(args), check=check, capture_output=True, text=True, env=env)


def git_env():
    env = dict(os.environ)
    # Токен передаётся credential-хелперу через окружение: не попадает ни в argv, ни в .git/config, ни в вывод.
    env['GIT_TERMINAL_PROMPT'] = '0'
    return env


CRED = '!f() { echo username=x-access-token; echo "password=${GH_PUSH_TOKEN}"; }; f'


def remote_operator(repo):
    r = git(repo, 'show', 'origin/%s:%s' % (BRANCH, REL), check=False)
    if r.returncode != 0:
        return None
    for l in r.stdout.splitlines():
        if l.startswith(OP_PREFIX):
            return l
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--repo', default='/workspace/tkr', help='клон репозитория на ветке %s' % BRANCH)
    ap.add_argument('--streams', default='/workspace/outputs/grok_streams.json')
    ap.add_argument('--backlog', default='/workspace/outputs/backlog/backlog_ru.json')
    ap.add_argument('--titles', default='/workspace/outputs/ops_monitor_standalone/opsmon/titles_ru.json')
    ap.add_argument('--push', action='store_true', help='закоммитить и запушить, если содержимое изменилось')
    ap.add_argument('--take-back', metavar='OWNER_WORDS', help='вернуть роль Grok, даже если активен другой оператор (только по слову Owner; текст сохраняется)')
    a = ap.parse_args()
    repo = Path(a.repo)
    cur = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.strip()
    if cur != BRANCH or cur in FORBIDDEN_BRANCHES:
        sys.exit('отказ: клон на ветке %r, нужна %s' % (cur, BRANCH))
    env = git_env()
    git(repo, '-c', 'credential.helper=', '-c', 'credential.helper=' + CRED, 'fetch', '-q', 'origin', BRANCH, env=env)
    if git(repo, 'status', '--porcelain', '--', REL).stdout.strip():
        sys.exit('отказ: в клоне есть незакоммиченные правки %s' % REL)
    git(repo, 'merge', '--ff-only', '-q', 'origin/%s' % BRANCH)

    streams = json.load(open(a.streams, encoding='utf-8'))
    backlog = json.load(open(a.backlog, encoding='utf-8')) if os.path.isfile(a.backlog) else {}
    titles = json.load(open(a.titles, encoding='utf-8')) if os.path.isfile(a.titles) else {}

    remote_op = remote_operator(repo)
    if remote_op and not remote_op[len(OP_PREFIX):].strip().startswith('Grok'):
        if not a.take_back:
            print('ВНИМАНИЕ: активен другой оператор: %s' % remote_op)
            print('Правило одного оператора: Grok не обновляет LIVE_STATE и не ведёт работу, пока роль не возвращена.')
            sys.exit(3)
        operator_line = '%s Grok (Go Bad) с %s — роль возвращена по слову Owner: «%s» (было: %s)' % (
            OP_PREFIX, now_local().strftime('%d.%m.%Y %H:%M'), a.take_back.replace('\n', ' ')[:200], remote_op[len(OP_PREFIX):].strip())
    elif remote_op:
        operator_line = remote_op
    else:
        ao = streams.get('active_operator', {})
        operator_line = '%s %s с %s' % (OP_PREFIX, ao.get('who', 'Grok (Go Bad)'), ao.get('since', now_local().strftime('%d.%m.%Y %H:%M')))

    text = render(vps_state(), github_state(), dev_meta(), backlog, streams, titles, operator_line) + '\n'
    text, problems = scrub(text)
    if problems:
        sys.exit('отказ: секрет-скан нашёл %s — файл не записан' % sorted(set(problems)))
    path = repo / REL
    old = path.read_text(encoding='utf-8') if path.exists() else ''
    changed = strip_stamp(old) != strip_stamp(text)
    if not changed:
        print('без изменений (кроме времени): ничего не пишу и не пушу')
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')
    print('LIVE_STATE изменился: %s' % path)
    if not a.push:
        print('dry-run: без --push коммит и push не делаются')
        return 0
    if not os.environ.get('GH_PUSH_TOKEN'):
        sys.exit('нет GH_PUSH_TOKEN: push невозможен')
    git(repo, 'add', '--', REL)
    git(repo, '-c', 'user.name=anpavel84-afk', '-c', 'user.email=318610566+anpavel84-afk@users.noreply.github.com',
        'commit', '-q', '-m', 'ops(state): LIVE_STATE_RU sync %s [skip ci]' % now_local().strftime('%Y-%m-%d %H:%M'), '--', REL)
    r = git(repo, '-c', 'credential.helper=', '-c', 'credential.helper=' + CRED, 'push', '-q', 'origin',
            'HEAD:refs/heads/%s' % BRANCH, env=env, check=False)
    if r.returncode != 0:
        sys.exit('push не прошёл (без force, ничего не переписано): %s' % (r.stderr.replace(os.environ.get('GH_PUSH_TOKEN', '') or '\0', '***')[-300:]))
    print('запушено в %s: %s' % (BRANCH, git(repo, 'rev-parse', 'HEAD').stdout.strip()))
    return 0


if __name__ == '__main__':
    sys.exit(main())
