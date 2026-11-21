import datetime as dt, json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import autonomous_issues as A
import pm_map as P

NOW = dt.datetime(2026, 10, 19, 12, 0, tzinfo=dt.timezone.utc)
SINCE = NOW - dt.timedelta(days=3)
ISO = '2026-10-19T10:00:00Z'


def body(paths, **extra):
    t = dict(schema='GOBADMINTON_AUTONOMY_V1', target='dev', kind='source_only', goal='g',
             acceptance='a', allowed_paths=paths, max_attempts=2, **extra)
    return 'GOBADMINTON_AUTONOMY_V1\n' + json.dumps(t)


def issue(n, paths, title='t', **extra):
    return {'state': 'open', 'user': {'id': 318610566}, 'number': n, 'title': title,
            'body': body(paths, **extra), 'created_at': ISO, 'updated_at': ISO}


def build(issues, done=(), parked=(), active=None):
    return P.build(issues, done, parked, active, A.validate_issue, SINCE, NOW)


def pair(m, a, b):
    return next(p for p in m['pairs'] if (p['a'], p['b']) == (a, b))


class Schema(unittest.TestCase):
    def ok(self, **extra):
        return A.validate_issue(issue(5, ['apps/web/test/**'], **extra), SINCE, NOW)

    def bad(self, **extra):
        with self.assertRaises(A.Hold):
            self.ok(**extra)

    def test_old_format_still_valid(self):
        self.assertEqual(set(self.ok()), A.TASK_FIELDS)

    def test_valid_new_fields(self):
        t = self.ok(depends_on=[3, 4], locks=['web:games'], model='gpt-6.1-sol', effort='high')
        self.assertEqual(t['depends_on'], [3, 4])

    def test_negative(self):
        self.bad(depends_on=[5])                      # self dependency
        self.bad(depends_on=[1, 1])                   # duplicates
        self.bad(depends_on=['3'])                    # not int
        self.bad(depends_on=list(range(1, 10)))       # > 8
        self.bad(locks=[])                            # empty
        self.bad(locks=['global', 'web'])             # global not alone
        self.bad(locks=['Web Games'])                 # bad name
        self.bad(model='gpt-6.1-sol')                 # effort missing
        self.bad(effort='high')                       # model missing
        self.bad(model='gpt-9', effort='high')        # not in registry
        self.bad(model='gpt-6.1-sol', effort='xhigh')  # effort not allowed
        self.bad(unknown_field=1)                     # still closed
        self.bad(**{'depends_on': True})

    def test_missing_required_field_still_rejected(self):
        i = issue(5, ['apps/web/test/**'])
        t = json.loads(i['body'].split('\n', 1)[1]); del t['goal']
        i['body'] = 'GOBADMINTON_AUTONOMY_V1\n' + json.dumps(t)
        with self.assertRaises(A.Hold):
            A.validate_issue(i, SINCE, NOW)


class Overlap(unittest.TestCase):
    def test_cases(self):
        o = P.paths_overlap
        self.assertTrue(o('apps/web/test/**', 'apps/web/test/a.ts'))
        self.assertTrue(o('apps/web/**', 'apps/web/src/x/**'))
        self.assertFalse(o('apps/web/src/a.ts', 'apps/web/src/ab.ts'))
        self.assertFalse(o('apps/web/test/**', 'apps/web/testing/**'))  # prefix of string only
        self.assertTrue(o('apps/web/src/a.ts', 'apps/web/src/a.ts'))
        self.assertFalse(o('docs/handoffs/**', 'docs/handoffs/**'))     # per-issue files

    def test_solo(self):
        s = P.solo_reasons
        t = lambda *p, **k: dict(allowed_paths=list(p), **k)
        self.assertTrue(s(t('apps/web/a.ts')))                          # no locks => solo
        self.assertEqual(s(t('apps/web/a.ts', locks=['web:games'])), [])
        self.assertTrue(s(t('apps/api/migrations/0037_x.sql', locks=['x'])))
        self.assertTrue(s(t('packages/contracts/src/**', locks=['x'])))
        self.assertTrue(s(t('apps/api/**', locks=['x'])))               # wide glob covers migrations
        self.assertTrue(s(t('package.json', locks=['x'])))
        self.assertFalse(s(t('apps/api/src/games/a.ts', locks=['x'])))

    def test_lock_hierarchy(self):
        c = P.locks_conflict
        self.assertTrue(c(['web:games'], ['web:games:create']))
        self.assertTrue(c(['web'], ['web:games']))
        self.assertFalse(c(['web:games'], ['web:radar']))
        self.assertFalse(c(['web:games'], ['api:games']))
        self.assertTrue(c(['global'], ['api:games']))


class Map(unittest.TestCase):
    A_ = ['apps/web/src/a/**', 'apps/web/test/a.test.ts', 'docs/handoffs/**']
    B_ = ['apps/web/src/b/**', 'apps/web/test/b.test.ts', 'docs/handoffs/**']

    def test_compatible_pair_and_only_tightening(self):
        m = build([issue(1, self.A_, locks=['web:a']), issue(2, self.B_, locks=['web:b'])])
        self.assertTrue(pair(m, 1, 2)['parallel_candidate'])
        m = build([issue(1, self.A_, locks=['web:a']), issue(2, self.B_, locks=['web:a'])])
        self.assertEqual(pair(m, 1, 2)['why_not'], ['locks'])
        m = build([issue(1, self.A_, locks=['web:a']), issue(2, self.A_ + ['x'][:0], locks=['web:b'])])
        self.assertIn('paths', pair(m, 1, 2)['why_not'])  # declared disjoint locks do NOT override paths

    def test_undeclared_is_solo(self):
        m = build([issue(1, self.A_), issue(2, self.B_, locks=['web:b'])])
        self.assertFalse(pair(m, 1, 2)['parallel_candidate'])
        self.assertIn('solo', pair(m, 1, 2)['why_not'])

    def test_migration_is_solo_even_if_declared(self):
        m = build([issue(1, ['apps/api/migrations/0037_x.sql'], locks=['api:db']),
                   issue(2, self.B_, locks=['web:b'])])
        self.assertIn('solo', pair(m, 1, 2)['why_not'])

    def test_depends_and_statuses(self):
        m = build([issue(2, self.B_, locks=['web:b'], depends_on=[1, 9, 7, 8]),
                   issue(1, self.A_, locks=['web:a'])], done=[8], parked=[7])
        n2 = next(n for n in m['nodes'] if n['issue'] == 2)
        self.assertEqual({d['issue']: d['status'] for d in n2['deps']},
                         {1: 'open', 9: 'unknown', 7: 'parked', 8: 'done'})
        self.assertEqual(n2['blocked_by_deps'], [1, 9, 7])
        self.assertIn('depends', pair(m, 1, 2)['why_not'])

    def test_cycle(self):
        m = build([issue(1, self.A_, locks=['web:a'], depends_on=[2]),
                   issue(2, self.B_, locks=['web:b'], depends_on=[1])])
        self.assertTrue(m['cycles'])

    def test_skips_done_parked_and_prs_and_reports_rejected(self):
        bad = issue(4, self.A_, locks=['Bad Lock'])
        pr = issue(5, self.A_); pr['pull_request'] = {}
        other = {'state': 'open', 'user': {'id': 1}, 'number': 6, 'body': 'hello',
                 'created_at': ISO, 'updated_at': ISO}
        m = build([issue(1, self.A_), issue(2, self.B_), issue(3, self.B_), bad, pr, other],
                  done=[1], parked=[2])
        self.assertEqual([n['issue'] for n in m['nodes']], [3])
        self.assertEqual([r['issue'] for r in m['rejected']], [4])

    def test_profile_default_and_declared(self):
        m = build([issue(1, self.A_), issue(2, self.B_, model='gpt-6.1-sol', effort='medium')])
        self.assertEqual(m['nodes'][0]['profile'],
                         {'model': 'gpt-6.1-sol', 'effort': 'high', 'source': 'default'})
        self.assertEqual(m['nodes'][1]['profile']['source'], 'declared')

    def test_fingerprint_stable_and_changes(self):
        i = [issue(1, self.A_, locks=['web:a'])]
        a, b = build(i), P.build(i, [], [], None, A.validate_issue, SINCE, NOW + dt.timedelta(hours=1))
        self.assertEqual(a['fingerprint'], b['fingerprint'])
        c = build([issue(1, self.A_, locks=['web:z'])])
        self.assertNotEqual(a['fingerprint'], c['fingerprint'])

    def test_capsule_is_small_and_has_no_text(self):
        m = build([issue(1, self.A_, locks=['web:a']), issue(2, self.B_, locks=['web:b'])], active=1)
        cap = P.capsule(m, 2)
        self.assertEqual(cap['parallel_with'], [1])
        self.assertLess(len(json.dumps(cap)), 800)
        self.assertNotIn('goal', json.dumps(cap))

    def test_does_not_mutate_inputs(self):
        i = [issue(1, self.A_, locks=['web:a'])]; snap = json.dumps(i)
        build(i); self.assertEqual(snap, json.dumps(i))


class Cli(unittest.TestCase):
    def test_offline_cli_writes_only_out(self):
        import subprocess, tempfile, os
        d = tempfile.mkdtemp()
        json.dump([issue(1, Map.A_, locks=['web:a'])], open(d + '/i.json', 'w'))
        json.dump({'active': None, 'done': [7]}, open(d + '/state.json', 'w'))
        before = sorted(os.listdir(d))
        here = Path(__file__).resolve().parent
        r = subprocess.run([sys.executable, str(here / 'pm_map.py'), '--issues', d + '/i.json',
                            '--state-dir', d, '--module', str(here / 'autonomous_issues.py'),
                            '--out', d + '/m.json'], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sorted(os.listdir(d)), sorted(before + ['m.json']))  # state.json untouched
        self.assertEqual(json.load(open(d + '/state.json')), {'active': None, 'done': [7]})


if __name__ == '__main__':
    unittest.main()
