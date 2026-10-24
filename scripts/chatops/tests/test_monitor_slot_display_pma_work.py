"""Display-only monitor fix: stale slot checkpoint is not shown as running work; data-only
"Работа вне слотов" feed with age/staleness protection. Offline; node is used for the DOM render."""
import datetime, importlib.util, json, os, shutil, subprocess, tempfile, unittest
from pathlib import Path

PAYLOAD = Path(__file__).resolve().parents[1] / 'actions_train' / 'monitor_payload'
spec = importlib.util.spec_from_file_location('gb_writer_display', PAYLOAD / 'writer.py')
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)

NOW = datetime.datetime(2026, 10, 24, 20, 45, tzinfo=datetime.timezone.utc).timestamp()
REPO = 'https://github.com/anpavel84-afk/gobadminton-clean/'


def iso(age_s):
    return datetime.datetime.fromtimestamp(NOW - age_s, datetime.timezone.utc).isoformat(timespec='seconds')


def item(**kw):
    base = {'id': 'pma-1', 'title_ru': 'Установка', 'kind': 'установка', 'status': 'идёт', 'updated_utc': iso(60)}
    base.update(kw)
    return base


class PmaWorkFeed(unittest.TestCase):
    def load(self, doc, raw=None):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'pma_work_ru.json')
            Path(p).write_text(raw if raw is not None else json.dumps(doc))
            return writer.load_pma_work_strict(p, {os.geteuid()})

    def view(self, items, **extra):
        return writer.pma_work_view(self.load(dict({'items': items}, **extra)), NOW)

    def test_valid_item_roundtrip_and_link(self):
        v = self.view([item(link=REPO + 'issues/273', stage_ru='код готов', waiting_for_ru='Разрешить установку.',
                            status='ждёт Pavel')])
        x = v['items'][0]
        self.assertTrue(v['available'])
        self.assertEqual((x['status'], x['link'], x['age_s'], x['fresh']), ('ждёт Pavel', REPO + 'issues/273', 60, True))
        self.assertEqual(x['waiting_for_ru'], 'Разрешить установку.')

    def test_missing_or_invalid_file_is_honest(self):
        for raw in (None, '{', '[]', json.dumps({'items': {}}), json.dumps({'items': [], 'x': 1})):
            with tempfile.TemporaryDirectory() as d:
                p = os.path.join(d, 'f.json')
                if raw is not None:
                    Path(p).write_text(raw)
                data = writer.load_pma_work_strict(p, {os.geteuid()})
            self.assertIsNone(data)
            view = writer.pma_work_view(data, NOW)
            self.assertEqual((view['available'], view['items']), (False, []))

    def test_rejects_unsafe_or_unknown_input(self):
        bad = [item(link='https://evil.example/' + 'x'), item(link=REPO + 'issues/1?x=1'), item(link='javascript:alert(1)'),
               item(link='http://github.com/anpavel84-afk/gobadminton-clean/issues/1'),
               item(kind='что-то'), item(status='unknown'), item(updated_utc='вчера'), item(updated_utc='2026-10-24T10:00:00'),
               item(fresh_hours=0), item(fresh_hours=True), item(extra='x'), item(id='bad id'), {'id': 'x'},
               item(title_ru=5)]
        for b in bad:
            self.assertIsNone(self.load({'items': [b]}), b)
        self.assertIsNone(self.load({'items': [item(), item()]}))                     # duplicate id
        self.assertIsNone(self.load({'items': [item(id='a%d' % n) for n in range(31)]}))
        self.assertIsNone(self.load({'items': [], 'updated_utc': 'x'}))

    def test_secret_looking_text_is_dropped_not_shown(self):
        x = self.view([item(waiting_for_ru='token=abc', stage_ru='см. https://x.example')])['items'][0]
        self.assertNotIn('waiting_for_ru', x)
        self.assertNotIn('stage_ru', x)
        self.assertIsNone(self.load({'items': [item(title_ru='password')]}))          # no title -> invalid

    def test_staleness_age_hiding_and_done_expiry(self):
        h = 3600
        v = self.view([item(id='run', updated_utc=iso(5 * h)),                         # running, >4 h: stale
                       item(id='wait', status='ждёт Pavel', updated_utc=iso(5 * h)),   # waiting, <24 h: fresh
                       item(id='old', updated_utc=iso(80 * h)),                        # unconfirmed >72 h: hidden
                       item(id='done', status='готово', updated_utc=iso(2 * h)),
                       item(id='gone', status='готово', updated_utc=iso(30 * h)),      # finished >24 h: dropped
                       item(id='custom', updated_utc=iso(5 * h), fresh_hours=8),
                       item(id='future', updated_utc=iso(-2 * h))])
        got = {x['id']: x for x in v['items']}
        self.assertFalse(got['run']['fresh'])
        self.assertTrue(got['wait']['fresh'])
        self.assertTrue(got['done']['fresh'])
        self.assertTrue(got['custom']['fresh'])
        self.assertFalse(got['future']['fresh'])
        self.assertTrue(got['future']['future_time'])
        self.assertNotIn('old', got)
        self.assertNotIn('gone', got)
        self.assertEqual(v['hidden_stale'], 1)

    def test_order_waiting_for_pavel_first_and_file_staleness(self):
        v = self.view([item(id='a', updated_utc=iso(10)), item(id='b', status='ждёт Pavel', updated_utc=iso(500)),
                       item(id='c', status='готово', updated_utc=iso(5))], updated_utc=iso(2 * 86400))
        self.assertEqual([x['id'] for x in v['items']], ['b', 'a', 'c'])
        self.assertTrue(v['file_stale'])
        self.assertEqual(v['file_age_s'], 2 * 86400)
        self.assertFalse(self.view([item()])['file_stale'])

    def test_snapshot_stays_small(self):
        big = [item(id='i%d' % n, title_ru='я' * 160, stage_ru='я' * 120, waiting_for_ru='я' * 300,
                    link=REPO + 'issues/1') for n in range(30)]
        self.assertLess(len(json.dumps(self.view(big), ensure_ascii=False)), 24000)


HARNESS = r'''
const fs = require('fs'), assert = require('node:assert/strict');
const snap = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
class Node {}
function mk(tag) {
  const e = new Node();
  Object.assign(e, {tag, className: '', textContent: '', children: [], style: {}, hidden: false, parentNode: null, id: ''});
  Object.defineProperty(e, 'innerHTML', {set() { throw Error('innerHTML forbidden'); }});
  e.appendChild = c => { c.parentNode = e; e.children.push(c); return c; };
  e.removeChild = c => { e.children = e.children.filter(x => x !== c); return c; };
  e.insertBefore = (c, ref) => { c.parentNode = e; const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, c); return c; };
  Object.defineProperty(e, 'firstChild', {get() { return e.children[0] || null; }});
  e.addEventListener = () => {};
  return e;
}
const ids = {}, root = mk('main');
global.Node = Node;
global.window = {};
global.document = { hidden: false, createElement: mk, createTextNode: t => { const e = mk('#text'); e.textContent = t; return e; },
  addEventListener() {}, getElementById(id) { if (!ids[id]) { ids[id] = mk('section'); ids[id].id = id; root.appendChild(ids[id]); } return ids[id]; } };
global.setTimeout = () => 0; global.clearTimeout = () => {};
global.fetch = () => Promise.resolve({status: 200, json: () => Promise.resolve(snap)});
eval(fs.readFileSync(process.argv[3], 'utf8'));
function text(e) { return [e.textContent].concat(e.children.flatMap(text)); }
function find(e, f) { return [e].concat(e.children.flatMap(c => find(c, f))).filter(f); }
setImmediate(() => setImmediate(() => {
  const now = text(ids.now).join('\n'), pma = ids['pma-work'];
  const out = {now, pma: pma ? text(pma).join('\n') : null,
    links: pma ? find(pma, e => e.tag === 'a').map(a => [a.href, a.rel]) : [], opacity: pma ? find(pma, e => e.style.opacity === 0.6).length : 0,
    steps: find(ids.now, e => e.className === 'steps').map(o => o.children.map(li => li.className))};
  console.log(JSON.stringify(out));
}));
'''


def run_dom(snapshot):
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / 'h.js').write_text(HARNESS)
        (Path(d) / 's.json').write_text(json.dumps(snapshot))
        r = subprocess.run([shutil.which('node'), str(Path(d) / 'h.js'), str(Path(d) / 's.json'), str(PAYLOAD / 'app.js')],
                           capture_output=True, text=True, timeout=30)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def slot1(**kw):
    s = {'slot': 'slot1', 'status': 'FRESH', 'note': None, 'age_s': 20, 'published_utc': 'X', 'checkpoint_age_s': 30993,
         'process': {'active': 'inactive', 'sub': 'dead', 'pid': 0},
         'claim': {'issue': 271, 'phase': 'developing', 'attempt': 2, 'head_sha': '9783a62d' + '0' * 32, 'pr': 272,
                   'qa': {'verdict': 'FAIL', 'reviewed_sha': '9783a62d' + '0' * 32}, 'ci': None,
                   'desc': {'title_ru': 'x', 'described': False, 'closed': False}},
         'actions_train': {'status': 'stale', 'operation': 'author', 'wait_reason': 'zero diff', 'last_confirmed_event': int(NOW - 31000), 'model': {}}}
    s.update(kw)
    return s


def snapshot(*slots, pma=None):
    return {'available': True, 'stale': False, 'age_s': 5, 'server_utc': datetime.datetime.fromtimestamp(NOW, datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'source_ok': True, 'source_mode': 'slots', 'claim': None, 'parked': [], 'recent_done': [], 'done_all': [], 'backlog': {'available': True, 'items': []},
            'executor': {}, 'dev': {}, 'queue': {'items': []}, 'product_outside': [], 'pipeline': {'available': True, 'runs': []},
            'external_runs': {'available': False}, 'slots': list(slots), 'pma_work': pma}


@unittest.skipUnless(shutil.which('node'), 'node is unavailable')
class SlotDisplay(unittest.TestCase):
    def test_dead_service_old_checkpoint_is_not_shown_as_running_work(self):
        out = run_dom(snapshot(slot1()))
        self.assertNotIn('идёт разработка кода' + '\n', out['now'].replace('Последняя запись контроллера: идёт разработка кода', ''))
        self.assertIn('нет подтверждённой активности', out['now'])
        self.assertIn('Это последняя запись, а не текущая работа', out['now'])
        self.assertIn('8 ч 36 мин', out['now'])
        self.assertIn('PR #272', out['now'])
        self.assertEqual(out['steps'], [['', '', '', '', '', '', '']])           # nothing highlighted as "current"
        self.assertNotIn('UNKNOWN', out['now'])
        self.assertNotIn('описание не добавлено)', out['now'])

    def test_running_evidence_keeps_the_normal_view(self):
        for override in ({'process': {'active': 'active', 'sub': 'running', 'pid': 7}},
                         {'checkpoint_age_s': 120},
                         {'actions_train': {'status': 'running', 'last_confirmed_event': None, 'model': {}}},
                         {'actions_train': {'status': 'stale', 'last_confirmed_event': int(NOW - 60), 'model': {}}}):
            out = run_dom(snapshot(slot1(**override)))
            self.assertIn('идёт разработка кода', out['now'], override)
            self.assertNotIn('нет подтверждённой активности', out['now'], override)
            self.assertEqual(out['steps'][0][1], 'cur')

    def test_blocked_done_and_not_fresh_slots_are_unchanged(self):
        blocked = slot1(); blocked['claim'] = dict(blocked['claim'], phase='blocked')
        self.assertNotIn('нет подтверждённой активности', run_dom(snapshot(blocked))['now'])
        self.assertIn('данные устарели', run_dom(snapshot(slot1(status='STALE')))['now'])

    def test_slot_without_task_says_so_in_plain_russian(self):
        s2 = slot1(claim=None, checkpoint_age_s=149611,
                   actions_train={'status': 'stale', 'operation': 'qa_qualification', 'model': {},
                                  'wait_reason': 'Нет допущенных готовых задач: без допуска 3.'})
        out = run_dom(snapshot(s2))['now']
        self.assertIn('нет задачи', out)
        self.assertIn('Нет задачи. Нет допущенных готовых задач', out)
        for noise in ('UNKNOWN', 'not recorded', 'not_applicable', 'Failure loop', 'Wait reason'):
            self.assertNotIn(noise, out)
        self.assertIn('Технические подробности', out)

    def test_technical_rows_are_inside_the_collapsed_block_with_russian_labels(self):
        out = run_dom(snapshot(slot1()))['now']
        head, tech = out.split('Технические подробности', 1)
        self.assertNotIn('Служба:', head)
        self.assertIn('Этап в Actions', tech)
        self.assertIn('контроллер публикует этап только при событиях конвейера', tech)
        self.assertNotIn('Actions stage', out)


@unittest.skipUnless(shutil.which('node'), 'node is unavailable')
class PmaBlock(unittest.TestCase):
    def test_block_text_age_stale_and_link_rules(self):
        items = [item(id='a', status='ждёт Pavel', stage_ru='код готов', waiting_for_ru='Разрешить установку.',
                      link=REPO + 'issues/273', updated_utc=iso(2400)),
                 item(id='b', title_ru='Разбор', kind='разбор', updated_utc=iso(9 * 3600))]
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, 'w.json')
            Path(p).write_text(json.dumps({'items': items}))
            view = writer.pma_work_view(writer.load_pma_work_strict(p, {os.geteuid()}), NOW)
        out = run_dom(snapshot(pma=view))
        pma = out['pma']
        self.assertIn('Работа вне слотов', pma)
        self.assertIn('Ждут решения Pavel: 1.', pma)
        self.assertIn('Что нужно: Разрешить установку.', pma)
        self.assertIn('обновлено 40 мин назад', pma)
        self.assertIn('не подтверждено вовремя', pma)
        self.assertIn('может быть уже другим', pma)
        self.assertEqual(out['links'], [[REPO + 'issues/273', 'noopener noreferrer']])
        self.assertEqual(out['opacity'], 1)   # only the stale item is dimmed

    def test_foreign_link_in_snapshot_is_never_rendered_as_link(self):
        view = {'available': True, 'items': [dict(id='x', title_ru='t', kind='разбор', status='идёт', fresh=True, age_s=5,
                                                  link='https://evil.example/a', updated_utc='z')], 'hidden_stale': 0}
        self.assertEqual(run_dom(snapshot(pma=view))['links'], [])

    def test_unavailable_empty_file_stale_and_hidden_notes(self):
        self.assertIn('Список недоступен: нет данных', run_dom(snapshot(pma=None))['pma'])
        self.assertIn('файл «Работа вне слотов» отсутствует', run_dom(snapshot(pma=writer.pma_work_view(None, NOW)))['pma'])
        out = run_dom(snapshot(pma={'available': True, 'items': [], 'hidden_stale': 2, 'file_stale': True, 'file_age_s': 172800}))['pma']
        self.assertIn('Записей нет.', out)
        self.assertIn('список не обновлялся 2 дн назад', out)
        self.assertIn('Скрыто давно не подтверждавшихся записей: 2.', out)

    def test_no_new_polling_or_html_injection_in_app(self):
        app = (PAYLOAD / 'app.js').read_text()
        self.assertEqual(app.count('setTimeout(poll, 30000)'), 2)
        self.assertEqual(app.count("fetch('api/snapshot'"), 1)
        self.assertNotIn('innerHTML', app)


if __name__ == '__main__':
    unittest.main()
