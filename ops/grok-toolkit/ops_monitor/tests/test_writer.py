import datetime, json, os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from opsmon import writer
import fixtures as F
NOW = datetime.datetime(2026, 10, 18, 15, 0, tzinfo=datetime.timezone.utc)
RUN = lambda: {'ActiveState': 'active', 'SubState': 'running'}
def build(sd, rc=None, j=None, show=RUN, now=NOW):
    return writer.build(sd, rc or F.receipt(), j or {}, now, show, checkpoint_owner=os.geteuid(), receipt_owner=os.geteuid())

TIT = {82: {'title_ru': 'Контакты', 'meaning_ru': 'Суть', 'result_ru': 'на DEV abc', 'closed': False, 'queued': False},
       70: {'title_ru': 'Старая', 'closed': True, 'queued': False},
       99: {'title_ru': 'Ждёт', 'meaning_ru': 'x', 'closed': False, 'queued': True}}

class T(unittest.TestCase):
    def test_titles_merge(self):
        sd = F.make_state('qa', done=(1, 2, 70), parked=[{'issue': 70, 'reason': 'x'}, {'issue': 71, 'reason': 'y'}])
        s, _ = writer.build(sd, F.receipt(), {}, NOW, RUN, checkpoint_owner=os.geteuid(), receipt_owner=os.geteuid(), titles=TIT)
        self.assertEqual(s['claim']['desc']['title_ru'], 'Контакты'); self.assertEqual(s['claim']['desc']['result_ru'], 'на DEV abc')
        self.assertTrue(s['parked'][0]['closed']); self.assertFalse(s['parked'][1]['closed'])
        self.assertEqual(s['parked'][1]['desc']['title_ru'], 'Задача #71 (описание не добавлено)')
        self.assertFalse(s['parked'][1]['desc']['described'])
        self.assertEqual([x['issue'] for x in s['done_all']], [70, 2, 1])
        self.assertEqual(s['done_all'][0]['title_ru'], 'Старая')
        self.assertEqual([x['issue'] for x in s['queue']['items']], [99])
        self.assertNotIn('недоступна', s['queue']['note'])

    def test_queue_note_idle_and_no_titles(self):
        s, _ = build(F.make_state(None)); self.assertEqual(s['queue']['note'], 'ожидает взятия исполнителем')
        self.assertEqual(s['claim'], None)
        s, _ = build(F.make_state('qa')); self.assertEqual(s['claim']['desc']['title_ru'], 'Задача #82 (описание не добавлено)')

    def test_load_titles_safe(self):
        import tempfile
        d = tempfile.mkdtemp(); p = os.path.join(d, 't.json')
        self.assertEqual(writer.load_titles(p), {})
        open(p, 'w').write('{"5": {"title_ru": "A\\u0000b  c", "closed": true}, "x": {}, "6": 3}')
        t = writer.load_titles(p); self.assertEqual(list(t), [5]); self.assertEqual(t[5]['title_ru'], 'Ab c'); self.assertTrue(t[5]['closed'])
        t = writer.load_titles(os.path.join(os.path.dirname(writer.__file__), 'titles_ru.json'))
        for n in (66, 68, 76, 78, 80, 82, 84, 86, 88, 90, 92, 94): self.assertIn(n, t)
        for n in (68, 76, 80, 86, 88, 90): self.assertTrue(t[n]['closed'])

    def test_external_titles_strict(self):
        import tempfile, json as J
        d = tempfile.mkdtemp(); p = os.path.join(d, 't.json'); me = {os.geteuid()}
        def w(obj, raw=None):
            open(p, 'w').write(raw if raw is not None else J.dumps(obj, ensure_ascii=False)); os.chmod(p, 0o644)
        self.assertIsNone(writer.load_titles_strict(os.path.join(d, 'none.json'), me))
        w({'_readme': 'x', '5': {'title_ru': 'A\u0000b  c', 'closed': True, 'note_ru': 'token abc'}})
        t = writer.load_titles_strict(p, me); self.assertEqual(t[5]['title_ru'], 'Ab c'); self.assertNotIn('note_ru', t[5]); self.assertTrue(t[5]['closed'])
        w({'5': {'title_ru': 'x' * 900}}); self.assertEqual(len(writer.load_titles_strict(p, me)[5]['title_ru']), 300)
        for bad in ({'x': {}}, {'5': {'evil': 'a'}}, {'5': {'title_ru': 3}}, {'5': {'closed': 'yes'}}, {'5': 'str'}, [1], {'_readme': 5}, {'12345678901': {}}):
            w(bad); self.assertIsNone(writer.load_titles_strict(p, me), bad)
        w(None, raw='not json'); self.assertIsNone(writer.load_titles_strict(p, me))
        w(None, raw='{"5": {"title_ru": "' + 'a' * 70000 + '"}}'); self.assertIsNone(writer.load_titles_strict(p, me))
        w({str(i): {} for i in range(400)}); self.assertIsNone(writer.load_titles_strict(p, me))
        w({'5': {'title_ru': 'ok'}}); self.assertIsNone(writer.load_titles_strict(p, {os.geteuid() + 1}))   # foreign owner
        os.chmod(p, 0o666); self.assertIsNone(writer.load_titles_strict(p, me))                              # world-writable
        os.chmod(p, 0o644); l = os.path.join(d, 'l.json'); os.symlink(p, l); self.assertIsNone(writer.load_titles_strict(l, me))  # symlink

    def test_pick_titles_fallback(self):
        import tempfile
        b = os.path.join(os.path.dirname(writer.__file__), 'titles_ru.json'); d = tempfile.mkdtemp(); p = os.path.join(d, 't.json')
        t, src = writer.pick_titles(p, b); self.assertEqual(src, 'bundled'); self.assertIn(92, t)
        open(p, 'w').write('{"5": {"title_ru": "zzz"}}'); os.chmod(p, 0o644)
        t, src = writer.pick_titles(p, b); self.assertEqual(src, 'bundled')   # owner is not __OPS_USER__/root (test user) -> rejected
        t, src = writer.pick_titles(None, b); self.assertEqual(src, 'bundled')

    def test_all_phases(self):
        for ph in F.PHASES:
            extra = {'reason': 'ci failed on head', 'resume_phase': 'ci'} if ph == 'blocked' else {}
            s, _ = build(F.make_state(ph, **extra))
            c = s['claim']
            self.assertEqual(c['phase'], ph); self.assertEqual(c['issue'], 82)
            self.assertEqual(c['title'], 'Контакты площадок и закрытое чтение игры'); self.assertEqual(c['task_id'], 'T0a-1')
            self.assertEqual(c['attempt'], 2); self.assertFalse(c['assignee']['confirmed'])
            self.assertEqual(c['ci']['passed'], 1); self.assertEqual(c['ci']['pending'], 1)
            self.assertFalse(s['model']['confirmed']); self.assertFalse(s['queue']['available'])
            self.assertEqual(s['dev']['release_id'], 'r12-a3')

    def test_no_secrets_or_goal_leak(self):
        s, _ = build(F.make_state('qa', reason='bad token=abc', qa={'verdict': 'PASS', 'reviewed_sha': F.SHA('d')}))
        raw = json.dumps(s, ensure_ascii=False)
        for bad in ('secret-token', 'allowed_paths', 'GOBADMINTON_AUTONOMY', 'https://x', 'token=abc'):
            self.assertNotIn(bad, raw)
        self.assertEqual(s['claim']['reason'], 'WITHHELD')
        self.assertEqual(s['claim']['qa']['verdict'], 'PASS')
        self.assertLess(len(raw), 131072)

    def test_idle_and_title_fallback(self):
        s, _ = build(F.make_state(None)); self.assertIsNone(s['claim']); self.assertEqual(s['done_count'], 3)
        s, _ = build(F.make_state('qa', task={'goal': 'no marker'}))
        self.assertEqual(s['claim']['title'], 'Задача #82')

    def test_parked(self):
        s, _ = build(F.make_state(None, parked={'parked': [{'issue': 70, 'attempt': 3, 'reason': 'zero diff', 'head': F.SHA('e'), 'allow_successors': True, 'snapshot': {'x': 1}}]}))
        self.assertEqual(s['parked'][0]['issue'], 70); self.assertTrue(s['parked'][0]['has_successor'])
        self.assertNotIn('snapshot', s['parked'][0])
        s, _ = build(F.make_state(None, parked=[{'issue': 71, 'reason': 'x'}])); self.assertEqual(s['parked'][0]['issue'], 71)

    def test_executor_stopped_and_unknown(self):
        s, _ = build(F.make_state('qa'), show=lambda: {'ActiveState': 'inactive', 'SubState': 'dead'})
        self.assertFalse(s['executor']['running'])
        def boom(): raise RuntimeError()
        s, _ = build(F.make_state('qa'), show=boom); self.assertEqual(s['executor']['state'], 'UNKNOWN')

    def test_missing_checkpoint_marks_source_bad(self):
        s, _ = build('/nonexistent'); self.assertFalse(s['source_ok']); self.assertIsNone(s['claim'])

    def test_missing_receipt(self):
        s, _ = build(F.make_state('qa'), rc='/nonexistent'); self.assertEqual(s['dev']['status'], 'UNAVAILABLE')

    def test_journal_done_transition(self):
        sd = F.make_state('dev_wait'); s, j = build(sd)
        self.assertEqual(s['recent_done'], [])
        sd2 = F.make_state(None, done=(1, 2, 3, 82)); s2, j = build(sd2, j=j, now=NOW + datetime.timedelta(seconds=30))
        self.assertEqual(s2['recent_done'][0]['issue'], 82)
        self.assertEqual(s2['recent_done'][0]['evidence'], 'release r12-a3')
        self.assertEqual(s2['recent_done'][0]['title'], 'Контакты площадок и закрытое чтение игры')
        s3, j = build(sd2, j=j); self.assertEqual(len(s3['recent_done']), 1)  # idempotent

    def test_not_done_when_task_blocked_then_gone(self):
        s, j = build(F.make_state('blocked', reason='r'))
        s2, j = build(F.make_state(None, done=(1, 2, 3)), j=j)
        self.assertEqual(s2['recent_done'], [])  # never counted as done without the done list

    def test_bad_files_rejected(self):
        d = F.make_state('qa'); p = os.path.join(d, 'state.json'); os.unlink(p); os.symlink('/etc/passwd', p)
        s, _ = build(d); self.assertFalse(s['source_ok'])

    def test_main_writes_atomically(self):
        out = F.tempfile.mkdtemp()
        sd = F.make_state('ci'); rc = F.receipt()
        writer.main(['--state-dir', sd, '--receipt', rc, '--out-dir', out, '--no-systemd', '--receipt-owner', str(os.geteuid())])
        d = json.load(open(os.path.join(out, 'snapshot.json')))
        self.assertEqual(d['claim']['phase'], 'ci')
        self.assertEqual(oct(os.stat(os.path.join(out, 'snapshot.json')).st_mode & 0o777), '0o644')
        self.assertEqual(oct(os.stat(os.path.join(out, 'journal.json')).st_mode & 0o777), '0o600')
        self.assertEqual([f for f in os.listdir(out) if f.startswith('.tmp')], [])

    def test_writer_never_writes_state_dir(self):
        sd = F.make_state('qa'); before = sorted((f, os.stat(os.path.join(sd, f)).st_mtime_ns) for f in os.listdir(sd))
        build(sd); self.assertEqual(before, sorted((f, os.stat(os.path.join(sd, f)).st_mtime_ns) for f in os.listdir(sd)))

    def test_static_no_forbidden_calls(self):
        src = open(writer.__file__).read()
        for bad in ('urllib', 'socket', 'requests', 'autonomous_issues', 'import http', "'start'", "'restart'", "'stop'"):
            self.assertNotIn(bad, src)

if __name__ == '__main__': unittest.main()
