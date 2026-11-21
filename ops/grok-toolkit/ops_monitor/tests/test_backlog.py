import json, os, sys, tempfile, unittest, datetime
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from opsmon import writer, server
import fixtures as F
NOW = datetime.datetime(2026, 10, 19, 12, 0, tzinfo=datetime.timezone.utc)
RUN = lambda: {'ActiveState': 'active', 'SubState': 'running'}
ME = {os.geteuid()}
REAL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..', 'backlog', 'backlog_ru.json')

def item(i, **kw):
    e = {'id': i, 'issue': None, 'title_ru': 'Задача ' + i, 'status': 'в планах', 'priority': None, 'depends_on': []}
    e.update(kw); return e

class B(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); self.p = os.path.join(self.d, 'backlog_ru.json')
    def w(self, obj, raw=None, mode=0o644):
        open(self.p, 'w').write(raw if raw is not None else json.dumps(obj, ensure_ascii=False)); os.chmod(self.p, mode)
    def load(self, uids=ME):
        return writer.load_backlog_strict(self.p, uids)

    def test_valid_and_cleaned(self):
        self.w({'_readme': 'x', 'items': [item('M0d', priority=2, meaning_ru='a\u0000b   c', note_ru='token xyz', depends_on=['M0c']),
                                          item('#69', issue=69, status='ожидает')]})
        b = self.load(); self.assertEqual(len(b), 2)
        self.assertEqual(b[0]['meaning_ru'], 'ab c'); self.assertNotIn('note_ru', b[0])     # secret-looking text dropped
        self.assertEqual(b[1]['issue'], 69); self.assertEqual(b[0]['depends_on'], ['M0c'])

    def test_rejects_any_invalid(self):
        bad = [[1], {'items': {}}, {'items': [], 'x': 1}, {'_readme': 5, 'items': []},
               {'items': [item('A', evil=1)]}, {'items': [{'id': 'A', 'status': 'в планах'}]},           # unknown key; missing title
               {'items': [item('A'), item('A')]}, {'items': [item('a b')]}, {'items': [item('x' * 30)]},  # dup id; bad id
               {'items': [item('A', status='готово')]}, {'items': [item('A', priority='1')]}, {'items': [item('A', priority=True)]},
               {'items': [item('A', priority=-1)]}, {'items': [item('A', issue=0)]}, {'items': [item('A', issue='98')]},
               {'items': [item('A', depends_on='B')]}, {'items': [item('A', depends_on=['B c'])]}, {'items': [item('A', depends_on=['B'] * 9)]},
               {'items': [item('A', title_ru=5)]}, {'items': [item('A', title_ru='   ')]}, {'items': [item('A', title_ru='см. https://x')]},
               {'items': [item('A%d' % i) for i in range(81)]}]
        for obj in bad:
            self.w(obj); self.assertIsNone(self.load(), obj)
        self.w(None, raw='not json'); self.assertIsNone(self.load())
        self.w(None, raw=json.dumps({'items': [item('A', title_ru='я' * 40000)]})); self.assertIsNone(self.load())   # > 64 KB
        self.assertIsNone(writer.load_backlog_strict(os.path.join(self.d, 'none.json'), ME))

    def test_file_safety(self):
        self.w({'items': [item('A')]}); self.assertIsNotNone(self.load())
        self.assertIsNone(self.load({os.geteuid() + 1}))                         # foreign owner
        os.chmod(self.p, 0o664); self.assertIsNone(self.load())                  # group-writable
        os.chmod(self.p, 0o644); l = os.path.join(self.d, 'l.json'); os.symlink(self.p, l)
        self.assertIsNone(writer.load_backlog_strict(l, ME))                     # symlink

    def test_sort_nulls_last_and_filters(self):
        items = [item('Z'), item('B', priority=2), item('D', priority=None, issue=70), item('A', priority=1, issue=98),
                 item('C', priority=2, issue=3), item('E', priority=5, issue=71)]
        v = writer.backlog_view(items, done=[3], active_issue=98, parked=[70])
        self.assertEqual([x['id'] for x in v['items']], ['B', 'E', 'Z', 'D'])  # 98 active, 3 done hidden; stable for nulls
        self.assertEqual(v['items'][3]['status'], 'припаркована')
        self.assertEqual(items[2]['status'], 'в планах')                          # input not mutated
        self.assertFalse(writer.backlog_view(None)['available'])

    def test_snapshot_integration(self):
        sd = F.make_state('qa', done=(1, 2, 3), parked={'parked': [{'issue': 70, 'reason': 'x'}]})   # active issue 82
        b = [item('X82', issue=82, priority=1), item('X3', issue=3, priority=2), item('P', priority=3), item('X70', issue=70, priority=4)]
        s, _ = writer.build(sd, F.receipt(), {}, NOW, RUN, checkpoint_owner=os.geteuid(), receipt_owner=os.geteuid(), backlog=b)
        self.assertEqual([x['id'] for x in s['backlog']['items']], ['P', 'X70'])
        self.assertEqual(s['backlog']['items'][1]['status'], 'припаркована')
        s, _ = writer.build('/nonexistent', F.receipt(), {}, NOW, RUN, checkpoint_owner=os.geteuid(), backlog=b)
        self.assertFalse(s['source_ok']); self.assertEqual(len(s['backlog']['items']), 4)   # no checkpoint: show unfiltered
        s, _ = writer.build(sd, F.receipt(), {}, NOW, RUN, checkpoint_owner=os.geteuid(), receipt_owner=os.geteuid())
        self.assertFalse(s['backlog']['available'])

    def test_main_with_external_backlog(self):
        out = tempfile.mkdtemp(); self.w({'items': [item('M0d', priority=2), item('M1f1', priority=1)]})
        import pwd; old = writer.EXT_TITLES_USER; writer.EXT_TITLES_USER = pwd.getpwuid(os.geteuid()).pw_name   # stands in for __OPS_USER__
        self.addCleanup(setattr, writer, 'EXT_TITLES_USER', old)
        writer.main(['--state-dir', F.make_state(None), '--receipt', F.receipt(), '--out-dir', out, '--no-systemd',
                     '--receipt-owner', str(os.geteuid()), '--backlog-external', self.p])
        d = json.load(open(os.path.join(out, 'snapshot.json')))
        self.assertEqual([x['id'] for x in d['backlog']['items']], ['M1f1', 'M0d'])
        writer.main(['--state-dir', F.make_state(None), '--receipt', F.receipt(), '--out-dir', out, '--no-systemd'])   # v3 args still work
        self.assertFalse(json.load(open(os.path.join(out, 'snapshot.json')))['backlog']['available'])
        writer.EXT_TITLES_USER = 'nobody-such-user-x'                            # owner not trusted => rejected
        writer.main(['--state-dir', F.make_state(None), '--receipt', F.receipt(), '--out-dir', out, '--no-systemd', '--backlog-external', self.p])
        self.assertFalse(json.load(open(os.path.join(out, 'snapshot.json')))['backlog']['available'])

    def test_server_passes_backlog(self):
        self.assertIn('backlog', server.KNOWN['top'])

    def test_real_backlog_file_valid(self):
        if not os.path.exists(REAL): self.skipTest('no real file')
        raw = json.load(open(REAL)); b = writer.load_backlog_strict(REAL, ME)
        self.assertIsNotNone(b); self.assertEqual(len(b), len(raw['items']))
        for r, e in zip(raw['items'], b):
            for f in ('title_ru', 'meaning_ru', 'note_ru'):
                self.assertEqual(f in r, f in e, (r['id'], f))     # nothing silently dropped
        ids = {e['id'] for e in b}
        for e in b:
            for dep in e['depends_on']: self.assertIn(dep, ids, e['id'])

if __name__ == '__main__': unittest.main()
