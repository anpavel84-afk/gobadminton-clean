#!/usr/bin/env python3
"""Предпубликационный линтер тел Issue GOBADMINTON_AUTONOMY_V1 (офлайн, ничего не публикует).

Использование:
  python3 lint_issue.py BODY.txt [BODY2.txt ...] [--dev-sha SHA] [--offline] [--max-files N] [--json]
Код возврата: 0 = нет FAIL, 1 = есть FAIL, 2 = ошибка запуска.
Токен GH_PUSH_TOKEN читается из окружения и нигде не печатается. Только чтение GitHub API.
"""
import argparse, json, os, re, sys, urllib.request, urllib.error, datetime as dt
from pathlib import Path

sys.path.insert(0, os.environ.get('AI_DEV_DIR', str(Path(__file__).resolve().parent / 'ai_dev_shim')))
try:
    import ai_dev
except Exception:
    ai_dev = None

REPO = 'anpavel84-afk/gobadminton-clean'
MARKER = 'GOBADMINTON_AUTONOMY_V1'
FAIL, WARN, PASS = 'FAIL', 'WARN', 'PASS'
ICON = {FAIL: '❌ FAIL', WARN: '⚠️ WARN', PASS: '✅ PASS'}

# отрицание / историческое упоминание: «NEVER run git fetch», «STEP 1 required git fetch»
NEG = re.compile(r"\b(never|do not|don't|must not|cannot|forbid\w*|forbidden|without|cancelled|canceled|"
                 r"removed|required|requires|needed|needs|because|was|were|why|banned|prohibit\w*|"
                 r"not a reason|no need)\b|нельзя|запрещ|не (запуска|остана|делай|выполня)|отмен", re.I)
STOP_NEG = re.compile(r"\b(never|do not|don't|must not|not a reason|no stop|cancelled|canceled|has no|have no)\b|"
                      r"нельзя|запрещ|не остана|отмен", re.I)
# «это не stop», «NEVER stop» — отрицание прямо перед ключевым словом (не всё «не» в клаузе: «если … не совпало — stop» остаётся FAIL)
STOP_NEG_RU_TAIL = re.compile(r"(?:^|[\s(«\"])(?:это\s+|is\s+)?(?:не|ни|never|not)\s*$", re.I)
# историческое упоминание провала: «старые тела срывались на base-stop»
STOP_HIST_RU = re.compile(r"срывал\w*|провалил\w*|старые тела|прошлые тела|ранее\s+(?:тела|задачи)", re.I)
STOP_KW = re.compile(r"stop|abort|halt|give up|bail out|BLOCKED|останов|прекрати", re.I)


def clause_before(text, pos):
    """Текст от начала предложения/пункта до pos."""
    start = max(text.rfind('. ', 0, pos), text.rfind('\n', 0, pos), text.rfind('; ', 0, pos),
                text.rfind('? ', 0, pos))
    seg = text[start + 1:pos]
    m = list(re.finditer(r"\((?:[a-z]|\d)\)\s", seg))      # метки пунктов (a) (b) (1)
    if m:
        seg = seg[m[-1].end():]
    return seg[-220:]


def snippet(text, pos, n=90):
    s = text[max(0, pos - 30): pos + n].replace('\n', ' ')
    return '…' + s + '…'


class Report:
    def __init__(self):
        self.items = []

    def add(self, level, code, msg, evidence=None):
        self.items.append({'level': level, 'code': code, 'msg': msg, 'evidence': evidence})

    def worst(self):
        lv = [i['level'] for i in self.items]
        return FAIL if FAIL in lv else WARN if WARN in lv else PASS


# ---------------------------------------------------------------- GitHub (только чтение)
def gh_get(path, token):
    req = urllib.request.Request('https://api.github.com/repos/%s/%s' % (REPO, path),
                                 headers={'Accept': 'application/vnd.github+json',
                                          'User-Agent': 'gb-issue-lint',
                                          **({'Authorization': 'Bearer ' + token} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


class Dev:
    def __init__(self, sha_override=None, offline=False):
        self.sha = sha_override
        self.files = None
        self.err = None
        self.token = os.environ.get('GH_PUSH_TOKEN')
        self.offline = offline
        if offline:
            self.err = 'режим --offline'
            return
        if not self.token:
            self.err = 'GH_PUSH_TOKEN не задан'
            return
        try:
            head = gh_get('commits/dev', self.token)
            self.sha = self.sha or head['sha']
            cache = Path('/tmp/gb_lint_tree_%s.json' % head['sha'])
            if cache.exists():
                self.files = set(json.loads(cache.read_text()))
            else:
                t = gh_get('git/trees/dev?recursive=1', self.token)
                if t.get('truncated'):
                    self.err = 'дерево репозитория усечено'
                self.files = {e['path'] for e in t['tree'] if e['type'] == 'blob'}
                cache.write_text(json.dumps(sorted(self.files)))
            self.dirs = {p.rsplit('/', 1)[0] for p in self.files if '/' in p}
            self.bases = {}
            for p in self.files:
                self.bases.setdefault(p.rsplit('/', 1)[-1], []).append(p)
        except Exception as e:  # не печатаем детали запроса (там заголовки)
            self.err = 'GitHub недоступен: %s' % type(e).__name__
            self.files = None

    def commit_exists(self, sha):
        if not self.token or self.offline:
            return None
        try:
            return gh_get('commits/' + sha, self.token) is not None
        except Exception:
            return None


# ---------------------------------------------------------------- проверки
STOP_PATTERNS = [
    (r"\bstop\s+and\s+(say|write|report|state|record)", "«stop and say…»"),
    (r"\bif\b[^.\n]{0,160}\b(not|isn't|absent|missing|differs?|mismatch\w*|stale|unverified|cannot|can't|unable|fails?)\b[^.\n]{0,160}\b(stop|abort|halt|give up)\b",
     "условный «если … не так — остановись»"),
    (r"\botherwise,?\s+(stop|abort|halt)\b", "«otherwise stop»"),
    (r"\b(abort|bail out|give up)\b", "abort/bail out"),
    (r"\b(write|deliver|leave|create|commit|file|submit|mark\w*|record\w*)\s+(only\s+)?(a\s+|an\s+|the\s+)?BLOCKED\b|\bif\b[^.\n]{0,120}\bBLOCKED\b", "лазейка «BLOCKED handoff»"),
    (r"\b(stop|halt)\b(?!\s*(?:propagation|words?|the clock))", "слово stop"),
    (r"останов(ись|итесь|и работу)|прекрати", "«остановись»"),
]
NET_PATTERNS = [
    (r"\bgit\s+(fetch|pull|clone|ls-remote|push|remote\s+update|submodule\s+update)\b", None),
    (r"\bgit\s+(checkout|switch|reset|stash|restore\s+--source|branch\s+-[dDmM]|update-ref|worktree\s+add)\b", None),
    (r"\bfetch\s+origin\b|\bfetch\s+the\s+(remote|branch)\b", None),
    (r"\borigin/[\w./-]+", None),
    (r"\b(curl|wget)\b", None),
    (r"\b(npm|pnpm|yarn)\s+(install|i|ci|add|update)\b", None),
    (r"\bgh\s+(pr|issue|api|repo)\b", None),
]
FORBID_SELFTEST = re.compile(r"\b(do not|don't|never|must not|no)\s+(run|execute|launch)\s+(any\s+|the\s+)?(web\s+|unit\s+|own\s+)?(tests?|lint|typecheck|build)\b|"
                             r"\b(no|without)\s+self-?test\w*|не\s+запуска\w+\s+тест", re.I)
REQUIRE_RUN = re.compile(r"\b(run|execute)\s+(the\s+)?(web\s+)?(unit\s+)?(tests?|lint|typecheck|build)\b|"
                         r"\bmust (pass|be run)\b|tests?\s+(are\s+)?mandatory|output quoted|command output quoted|"
                         r"(tests?|lint|typecheck|build)[^.\n]{0,30}\bpass\b", re.I)


def load_task(path, rep):
    raw = Path(path).read_text(encoding='utf-8')
    if raw.startswith('\ufeff'):
        rep.add(FAIL, 'FMT', 'Файл начинается с BOM: маркер не совпадёт точно.')
    marker, sep, rest = raw.partition('\n')
    if marker != MARKER or not sep:
        rep.add(FAIL, 'FMT', 'Первая строка должна быть ровно %s.' % MARKER)
    try:
        task = json.loads(rest)
    except Exception as e:
        rep.add(FAIL, 'FMT', 'Тело после маркера не JSON: %s' % e)
        return raw, None
    return raw, task


def validate_with_ai_dev(task_raw, rep):
    if not ai_dev:
        rep.add(WARN, 'V0', 'ai_dev.py не импортируется: пропущен validate_issue (проверьте AI_DEV_DIR).')
        return
    now = dt.datetime.now(dt.timezone.utc)
    ts = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    issue = {'state': 'open', 'user': {'id': 318610566}, 'number': 9999, 'body': task_raw,
             'created_at': ts, 'updated_at': ts}
    try:
        ai_dev.validate_issue(issue, now - dt.timedelta(hours=1), now)
        rep.add(PASS, 'V0', 'ai_dev.validate_issue: тело принимается адаптером.')
    except Exception as e:
        rep.add(FAIL, 'V0', 'ai_dev.validate_issue отклонит тело: %s' % (e,))


def chk_stop(text, rep):
    hits = []
    for rx, label in STOP_PATTERNS:
        for m in re.finditer(rx, text, re.I):
            kws = list(STOP_KW.finditer(m.group(0)))
            kpos = m.start() + (kws[-1].start() if kws else 0)
            cb = clause_before(text, kpos)
            if STOP_NEG.search(cb) or STOP_NEG_RU_TAIL.search(cb) or STOP_HIST_RU.search(cb):
                continue
            if any(abs(m.start() - h[0]) < 60 for h in hits):
                continue
            hits.append((m.start(), label, snippet(text, m.start())))
    if hits:
        for _, label, sn in hits[:6]:
            rep.add(FAIL, 'A', 'Условие остановки: %s. Автор в песочнице остановится и сдаст пустой handoff.' % label, sn)
    else:
        rep.add(PASS, 'A', 'Условий остановки нет (отрицания «NEVER stop» не считаются).')
    if not re.search(r"(never|do not|don't)\s+stop|no stop conditions|не останавливайся", text, re.I):
        rep.add(WARN, 'A', 'Нет явной фразы «NEVER stop / no stop conditions»: автор может сам придумать остановку.')


def chk_net(text, rep):
    hits = []
    for rx, _ in NET_PATTERNS:
        for m in re.finditer(rx, text, re.I):
            if NEG.search(clause_before(text, m.start())):
                continue
            if any(abs(m.start() - h[0]) < 25 for h in hits):
                continue
            hits.append((m.start(), m.group(0), snippet(text, m.start())))
    if hits:
        for _, g, sn in hits[:8]:
            rep.add(FAIL, 'B', 'Шаг требует сети или записи git-метаданных: «%s». Песочница автора это запрещает.' % g, sn)
    else:
        rep.add(PASS, 'B', 'Шагов с сетью и записью git-метаданных нет.')
    if not re.search(r"(never|do not|don't)[^.\n]{0,40}git\s+(fetch|pull)|no network|без сети", text, re.I):
        rep.add(WARN, 'B', 'Нет явного запрета «NEVER git fetch/pull…»: добавьте HARD RULES про песочницу.')


def chk_contradict(text, task, rep):
    f = FORBID_SELFTEST.search(text)
    r = REQUIRE_RUN.search(text)
    found = False
    if f and r:
        found = True
        rep.add(FAIL, 'C', 'Противоречие: запрет запускать тесты и одновременно требование их прогона/вывода.',
                snippet(text, f.start()) + '  <>  ' + snippet(text, r.start()))
    # «Do NOT touch X», а X есть в allowed_paths
    if task:
        allowed = task.get('allowed_paths') or []
        for m in re.finditer(r"\b(?:do not|never|don't)\s+(?:touch|edit|change|modify)\s+([^.\n]{3,200})", text, re.I):
            for name in re.findall(r"[A-Za-z][A-Za-z0-9_-]{4,}(?:\.[a-z]{2,4})?", m.group(1)):
                if name.lower() in ('touch', 'edit', 'change', 'modify', 'tests', 'layout', 'shell', 'back-button'):
                    continue
                if any(name in a for a in allowed):
                    found = True
                    rep.add(WARN, 'C', 'Запрещено трогать «%s», но allowed_paths его разрешает: сузьте пути.' % name,
                            snippet(text, m.start()))
                    break
        # «Start from latest dev AFTER X merged» vs «work from HEAD»
        if re.search(r"after\s+\w+\s+is\s+accepted|AFTER\s+M\w+\s+is", text) and re.search(r"work from HEAD|current HEAD", text, re.I):
            found = True
            rep.add(WARN, 'C', 'Две разные базы: «после приёмки X» и «текущий HEAD».')
    if not found:
        rep.add(PASS, 'C', 'Явных противоречий (запрет тестов vs требование тестов) не найдено.')


def chk_clauses(text, task, rep):
    acc = (task or {}).get('acceptance', '') if task else ''
    goal = (task or {}).get('goal', '') if task else ''
    if re.search(r"\btests?\b", acc, re.I):
        mand = re.search(r"mandatory|must exist|обязательн|in the diff|new test|the new test|(diff|diffs?)\s+(has|contains)|real (diff|changes)", goal + ' ' + acc, re.I)
        if mand:
            rep.add(PASS, 'D', 'Обязательные тесты указаны в acceptance и привязаны к diff.')
        else:
            rep.add(FAIL, 'D', 'Тесты упомянуты, но не объявлены обязательными (нет «MANDATORY / must exist in the diff»).')
    else:
        rep.add(FAIL, 'D', 'В acceptance нет обязательных тестов (unit/vitest/apps/web/test).')
    if 'NOT_TESTED' in text:
        rep.add(PASS, 'D', 'Есть запасной вариант NOT_TESTED.')
    else:
        rep.add(FAIL, 'D', 'Нет оговорки NOT_TESTED: если тесты не запустятся, автор остановится вместо честной пометки.')
    if re.search(r"handoff-only[^.\n]{0,40}\bFAIL\b|only a handoff[^.\n]{0,40}FAIL|only the handoff[^.\n]{0,40}FAIL", text, re.I):
        rep.add(PASS, 'D', 'Есть пункт «handoff-only diff = FAIL».')
    else:
        rep.add(FAIL, 'D', 'Нет пункта «handoff-only diff = FAIL»: пустой BLOCKED-handoff может пройти как работа.')
    if re.search(r"NOT_TESTED[^.\n]{0,160}(do not stop|not (a reason|stop)|still deliver|leave code)|do not stop[^.\n]{0,120}NOT_TESTED", text, re.I):
        rep.add(PASS, 'D', 'NOT_TESTED прямо разрешён вместо остановки.')
    elif 'NOT_TESTED' in text:
        rep.add(WARN, 'D', 'NOT_TESTED есть, но не сказано «не останавливайся, оставь код и тесты в diff».')
    if not re.search(r"real (source )?(code|change)|real changes|PRODUCE REAL CODE", text, re.I):
        rep.add(WARN, 'D', 'Нет требования «реальный код в diff» (real code / real changes).')


def pattern_prefix(p):
    return p[:-3] if p.endswith('/**') else p


def chk_paths(task, text, rep, max_files):
    paths = (task or {}).get('allowed_paths')
    if not isinstance(paths, list):
        rep.add(FAIL, 'E', 'allowed_paths отсутствует или не список.')
        return []
    n = len(paths)
    if n > 20:
        rep.add(FAIL, 'E', 'allowed_paths: %d записей (больше 20): задача слишком широка, режьте.' % n)
    elif n > max_files:
        rep.add(WARN, 'E', 'allowed_paths: %d записей (порог %d): проверьте, нужна ли такая широта.' % (n, max_files))
    else:
        rep.add(PASS, 'E', 'allowed_paths: %d записей (порог %d).' % (n, max_files))
    ok_globs = {'apps/web/test/**', 'docs/handoffs/**'}
    bad = False
    for p in paths:
        if '*' in p and not (p.endswith('/**') and '*' not in p[:-3]):
            rep.add(FAIL, 'E', 'Неподдерживаемый glob «%s» (адаптер понимает только суффикс /**).' % p); bad = True
        elif p.endswith('/**') and p not in ok_globs:
            segs = pattern_prefix(p).split('/')
            if len(segs) <= 2:
                rep.add(FAIL, 'E', 'Слишком широкий glob «%s».' % p); bad = True
            elif len(segs) == 3:
                rep.add(WARN, 'E', 'Широкий glob «%s»: перечислите файлы.' % p); bad = True
        if ai_dev:
            try:
                ai_dev.safe_path(pattern_prefix(p))
            except Exception as e:
                rep.add(FAIL, 'E', 'Путь «%s» запрещён адаптером: %s' % (p, e)); bad = True
        if re.search(r"(^|/)(package\.json|pnpm-lock\.yaml|package-lock\.json|migrations?|prisma|contracts?|\.github)(/|$)", p) \
                or p.startswith(('apps/api', 'packages/')):
            if re.search(r"web-only|additive web", text, re.I):
                rep.add(FAIL, 'E', 'Путь «%s» вне web-only (API/контракты/зависимости/миграции), а задача объявлена web-only.' % p); bad = True
            else:
                rep.add(WARN, 'E', 'Путь «%s» чувствительный (API/контракты/зависимости/миграции): одиночная область.' % p); bad = True
        if 'docs/' in p and 'handoffs' not in p:
            rep.add(WARN, 'E', 'Путь «%s» в docs вне handoffs: проверьте право.' % p); bad = True
    if not bad:
        rep.add(PASS, 'E', 'Глобы и запрещённые пути: замечаний нет.')
    if not any(p.startswith('docs/handoffs') for p in paths):
        rep.add(WARN, 'E', 'docs/handoffs/** не в allowed_paths: автору некуда писать handoff.')
    return paths


def permitted(path, allowed):
    return any(path.startswith(pattern_prefix(p) + '/') if p.endswith('/**') else path == p for p in allowed)


PATH_RX = re.compile(r"(?<![\w/.-])((?:apps|packages|docs)/[A-Za-z0-9_./\[\]-]*[A-Za-z0-9_\]])")
BARE_RX = re.compile(r"(?<![\w/.<-])([A-Za-z][A-Za-z0-9_-]*\.(?:tsx|ts|mjs|css|md))\b")


def chk_refs(text, task, paths, dev, rep):
    if dev.files is None:
        rep.add(WARN, 'F', 'Проверка существования файлов пропущена: %s.' % dev.err)
        return
    missing_fail, missing_warn, seen = [], [], set()
    sha_src = set()
    for m in re.finditer(r"git show\s+([0-9a-f]{7,40}):(\S+)", text):
        sha_src.add(m.group(2).rstrip(".,;)'\""))
    for m in PATH_RX.finditer(text):
        p = m.group(1).rstrip('.')
        if text[m.end():m.end() + 1] == '<' or p.endswith('_'):
            continue
        if p in seen or '<' in p or '*' in p:
            continue
        seen.add(p)
        if p in sha_src or any(p.endswith(s) or s.endswith(p) for s in sha_src):
            continue
        if p in dev.files or p in dev.dirs or any(f.startswith(p + '/') for f in dev.files):
            continue
        # шаблон имени handoff / новый тест внутри allowed_paths: допустимо как новый файл
        ctx = text[max(0, m.start() - 160): m.end() + 160]
        hedged = re.search(r"may not exist|might not exist|does not exist|if (it )?exists|ignore it|optional|not exist", ctx, re.I)
        near = sorted(f for f in dev.files if f.rsplit('/', 1)[-1].upper().endswith(p.rsplit('/', 1)[-1].upper()[-22:]) )[:2]
        hint = ' Похожий файл в dev: %s.' % ', '.join(near) if near else ''
        if paths and permitted(p, paths):
            missing_warn.append(p)
        elif hedged:
            missing_warn.append(p + ' (в тексте оговорено «может не существовать»)' + hint)
        else:
            missing_fail.append(p + hint)
    for p in missing_fail:
        rep.add(FAIL, 'F', 'Ссылка на несуществующий в dev файл/каталог вне allowed_paths: %s' % p)
    for p in missing_warn:
        rep.add(WARN, 'F', 'Нет в dev (внутри allowed_paths): %s. Ок только если задача его создаёт.' % p)
    bare_missing = []
    for m in BARE_RX.finditer(text):
        b = m.group(1)
        if b in seen or '<' in b:
            continue
        seen.add(b)
        if b not in dev.bases and not any(b == s.rsplit('/', 1)[-1] for s in sha_src):
            bare_missing.append(b)
    for b in bare_missing:
        rep.add(WARN, 'F', 'Файл «%s» не найден по имени ни в одном каталоге dev (новый или опечатка).' % b)
    # коммиты-источники
    for sha in sorted(set(re.findall(r"\b[0-9a-f]{40}\b", text))):
        ex = dev.commit_exists(sha)
        if ex is False:
            rep.add(WARN, 'F', 'Коммит %s не найден в GitHub: «git show» на нём в песочнице тоже может не сработать.' % sha[:8])
        elif ex:
            rep.add(PASS, 'F', 'Коммит-источник %s существует в GitHub.' % sha[:8])
    if not (missing_fail or missing_warn or bare_missing):
        rep.add(PASS, 'F', 'Все упомянутые файлы существуют в dev %s (%d проверено).' % (dev.sha[:8], len(seen)))


def chk_size(raw, task, rep):
    if not task:
        return
    g, a = len(task.get('goal', '')), len(task.get('acceptance', ''))
    b = len(raw.encode())
    for name, v, hard, soft in (('goal', g, 6000, 5000), ('acceptance', a, 6000, 3500), ('тело целиком', b, 16384, 11000)):
        if v > hard:
            rep.add(FAIL, 'G', '%s: %d > %d знаков, адаптер отклонит.' % (name, v, hard))
        elif v > soft:
            rep.add(WARN, 'G', '%s: %d знаков (мягкий порог %d): задача, вероятно, слишком большая, режьте.' % (name, v, soft))
        else:
            rep.add(PASS, 'G', '%s: %d знаков (порог %d).' % (name, v, soft))
    items = len(re.findall(r"(?<![A-Za-z0-9])[A-Z]\d{1,2}\.\s", task.get('acceptance', '')))
    if items > 9:
        rep.add(WARN, 'G', 'В acceptance %d пунктов (>9): слишком много критериев для одной попытки.' % items)
    if task.get('max_attempts') != 3 and isinstance(task.get('max_attempts'), int):
        rep.add(WARN, 'G', 'max_attempts=%s (обычно 3).' % task['max_attempts'])


def chk_base(text, dev, rep):
    succ = re.search(r"successor|follow-up|преемник", text, re.I)
    if not dev.sha:
        rep.add(WARN, 'H', 'Текущий HEAD dev неизвестен (%s): проверка базы пропущена.' % dev.err)
        return
    cur = dev.sha
    found = False
    for m in re.finditer(r"(?<![0-9a-f])([0-9a-f]{8,40})(?![0-9a-f])", text):
        s = m.group(1)
        if not re.search(r"[a-f]", s) or not re.search(r"\d", s):
            continue
        ctx = text[max(0, m.start() - 70): m.start()]
        if not re.search(r"\b(dev|DEV|HEAD|base)\b", ctx):
            continue
        if re.search(r"re-?appl|re-?us|source|candidate|bring|git show|checkout|stale|irrelevant|e\.g\.", ctx, re.I):
            continue
        found = True
        if cur.startswith(s) or s.startswith(cur[:8]):
            rep.add(PASS, 'H', 'База %s совпадает с HEAD dev %s.' % (s[:8], cur[:8]))
            continue
        historical = re.search(r"FAIL|QA|PR\s*\d+|parked|candidate|used|attempt|failed|ранее|старой", ctx, re.I)
        if historical:
            rep.add(WARN, 'H', 'Устаревший SHA %s в истории задачи; HEAD dev сейчас %s. Обновите справку.' % (s[:8], cur[:8]),
                    snippet(text, m.start()))
        else:
            rep.add(FAIL, 'H', 'Указанная база %s не равна HEAD dev %s: преемник строится на устаревшей базе.' % (s[:8], cur[:8]),
                    snippet(text, m.start()))
    if not found:
        if succ:
            rep.add(WARN, 'H', 'Преемник без явной базы: укажите «Base: dev %s».' % cur[:8])
        else:
            rep.add(PASS, 'H', 'SHA базы не указан (задача не помечена преемником).')


# Правило оунера 19.10.2026: каждый преемник обязан учесть диагностику QA прошлых попыток.
SUCC_RX = re.compile(r"\bsuccessor\b|follow-up|преемник|замен(а|яет|ить|ён|ен)\b|вместо\s+#\d+|"
                     r"припаркован\w*|\bparked\b|(predecessor|предшественник)\b|"
                     r"#\d+[^.\n]{0,80}QA\s+FAIL|QA\s+FAIL[^.\n]{0,80}(попыт|attempt)", re.I)
QA_SECTION_RX = re.compile(r"Замечания QA предыдущих попыток", re.I)
# пункт: «- #96 a3 765aebc2: <замечание> -> <как учтено>» (или «→», «=>», «учтено:»)
QA_ITEM_RX = re.compile(r"#\d+\s*a\d\b[^\n]{0,40}?[0-9a-f]{7,40}?[^\n]*?(->|→|=>|учтено|учтена|вне scope|out of scope)", re.I)
QA_ITEM_LOOSE_RX = re.compile(r"#\d+\s*a\d\b", re.I)


def chk_successor_qa(text, rep):
    if not SUCC_RX.search(text):
        rep.add(PASS, 'Q', 'Задача не помечена преемником: раздел «Замечания QA предыдущих попыток» не требуется.')
        return
    m = QA_SECTION_RX.search(text)
    if not m:
        rep.add(FAIL, 'Q', 'Преемник без раздела «Замечания QA предыдущих попыток»: перечислите каждое замечание QA '
                'прошлых попыток (#N aK sha8: замечание -> как учтено). Правило оунера 19.10.2026.')
        return
    tail = text[m.end():]
    items = QA_ITEM_RX.findall(tail)
    loose = QA_ITEM_LOOSE_RX.findall(tail)
    if not loose:
        rep.add(FAIL, 'Q', 'Раздел «Замечания QA предыдущих попыток» пуст: нет ни одного пункта вида «#N aK sha8: … -> …».',
                snippet(text, m.start()))
    elif len(items) < len(loose):
        rep.add(FAIL, 'Q', 'В разделе QA %d пункт(ов) без «-> как учтено» (всего %d). У каждого замечания нужен способ учёта '
                'или «вне scope: причина».' % (len(loose) - len(items), len(loose)), snippet(text, m.start()))
    else:
        rep.add(PASS, 'Q', 'Раздел «Замечания QA предыдущих попыток»: %d пункт(ов), у каждого указано, как учтено.' % len(items))


def lint(path, dev, max_files):
    rep = Report()
    raw, task = load_task(path, rep)
    text = raw.partition('\n')[2]
    prose = ''
    if task:
        prose = '\n'.join(str(task.get(k, '')) for k in ('goal', 'acceptance'))
    else:
        prose = text
    validate_with_ai_dev(raw, rep)
    chk_stop(prose, rep)
    chk_net(prose, rep)
    chk_contradict(prose, task, rep)
    chk_clauses(prose, task, rep)
    paths = chk_paths(task, prose, rep, max_files)
    chk_refs(prose, task, paths, dev, rep)
    chk_size(raw, task, rep)
    chk_base(prose, dev, rep)
    chk_successor_qa(prose, rep)
    return rep


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('bodies', nargs='+')
    ap.add_argument('--dev-sha')
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--max-files', type=int, default=14)
    ap.add_argument('--json', action='store_true')
    ap.add_argument('--quiet-pass', action='store_true', help='не печатать строки PASS')
    a = ap.parse_args()
    dev = Dev(a.dev_sha, a.offline)
    code = 0
    out = {}
    for b in a.bodies:
        if not Path(b).exists():
            print('Нет файла: %s' % b); code = 2; continue
        rep = lint(b, dev, a.max_files)
        w = rep.worst()
        out[b] = {'verdict': w, 'items': rep.items}
        if w == FAIL:
            code = max(code, 1)
        if a.json:
            continue
        print('=' * 78)
        print('%s  ИТОГ: %s   (dev HEAD: %s)' % (b, ICON[w], (dev.sha or '?')[:8]))
        order = {FAIL: 0, WARN: 1, PASS: 2}
        for it in sorted(rep.items, key=lambda i: order[i['level']]):
            if a.quiet_pass and it['level'] == PASS:
                continue
            print(' %s [%s] %s' % (ICON[it['level']], it['code'], it['msg']))
            if it['evidence']:
                print('        %s' % it['evidence'])
    if a.json:
        print(json.dumps(out, ensure_ascii=False, indent=1))
    sys.exit(code)


if __name__ == '__main__':
    main()
