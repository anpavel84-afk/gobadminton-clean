#!/usr/bin/env python3
"""Офлайн-тесты successor_loop.py (без сети, без VPS, ничего не публикуют)."""
import json, os, sys, tempfile, unittest
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ['SL_RUNS'] = tempfile.mkdtemp(prefix='sl-runs-')
import importlib
import successor_loop as S
importlib.reload(S)
FX = HERE / 'fixtures'
EV = json.loads((FX / 'evidence96.json').read_text())
B98 = (FX / 'issue98.body.txt').read_text()


def body_with(goal_prefix='', **kw):
    t = S.parse_body(B98)
    t['goal'] = goal_prefix + t['goal']
    t.update(kw)
    return S.dump_body(t)


GOOD_QA = ('Преемник #96. Замечания QA предыдущих попыток:\n'
           '- #96 a1 224ebbe3: refresh-тест мокает next/dynamic, CI TS2339 -> A3 continuity на реальных компонентах; VenueMarkerEntry.\n'
           '- #96 a2 fe5a9ec8: CI TS2339 presentation/position -> учтено: один именованный тип VenueMarkerEntry.\n'
           '- #96 a3 765aebc2: regex координат в debug-модуле -> вне scope: debug-модуль не входит.\n')


def review_text(v1, v2='MOZHNO', body=None):
    s = 'ВЕРДИКТ: %s\nПункты...\nВЕРДИКТ ДЛЯ ИСПРАВЛЕННОГО ТЕЛА: %s\n' % (v1, v2)
    if body:
        s += 'REVISED_BODY_BEGIN\n%s\nREVISED_BODY_END\n' % body
    return s


class FakeReviewer(S.Reviewer):
    family = 'fake'

    def __init__(self, outs):
        self.outs, self.calls = list(outs), []

    def review(self, body_text, ev, repo_sha, tag):
        self.calls.append((tag, body_text))
        return self.outs.pop(0), 'fake'


def setup_run():
    d = S.rundir(96)
    (d / 'evidence.json').write_text(json.dumps(EV, ensure_ascii=False))
    return d


class T(unittest.TestCase):
    def test_required_items_96(self):
        r = S.required_items(EV)
        self.assertEqual([(x['attempt'], x['sha8']) for x in r], [(1, '224ebbe3'), (2, 'fe5a9ec8'), (3, '765aebc2')])
        self.assertIn('CI FAIL', r[1]['why'])

    def test_coverage_98_misses_all(self):
        c = S.coverage(B98, EV)
        self.assertFalse(c['section'])
        self.assertEqual(len(c['missing']), 3)

    def test_coverage_good(self):
        c = S.coverage(body_with(GOOD_QA), EV)
        self.assertTrue(c['section']); self.assertEqual(c['missing'], [])

    def test_coverage_partial_and_todo(self):
        part = GOOD_QA.replace('- #96 a2 fe5a9ec8: CI TS2339 presentation/position -> учтено: один именованный тип VenueMarkerEntry.\n', '')
        self.assertEqual([m['attempt'] for m in S.coverage(body_with(part), EV)['missing']], [2])
        todo = GOOD_QA.replace('-> вне scope: debug-модуль не входит.', '-> TODO_PM')
        self.assertEqual([m['attempt'] for m in S.coverage(body_with(todo), EV)['missing']], [3])

    def test_hard_checks(self):
        self.assertEqual(S.hard_checks(body_with(GOOD_QA)), [])
        t = S.parse_body(B98)
        bad = dict(t, allowed_paths=t['allowed_paths'] + ['.github/workflows/ci.yml', 'docs/decisions/x.md',
                                                          'eslint.config.mjs', 'apps/web/src/app/[city]/page.tsx'],
                   max_attempts=4)
        e = S.hard_checks(S.dump_body(bad))
        self.assertEqual(sum('запрещённый путь' in x for x in e), 4)
        self.assertTrue(any('max_attempts' in x for x in e))
        self.assertTrue(any('goal' in x for x in S.hard_checks(body_with('x' * 6001))))
        self.assertTrue(any('сетевой' in x for x in S.hard_checks(body_with('Сначала выполни git fetch origin dev. '))))
        self.assertEqual(S.hard_checks(body_with('NEVER run git fetch or pnpm install. ')), [])
        self.assertTrue(any('байт' in x for x in S.hard_checks(body_with('я' * 5000))))
        self.assertTrue(any('ключи' in x for x in S.hard_checks(S.dump_body(dict(t, extra=1)))))
        self.assertTrue(any('TODO_PM' in x for x in S.hard_checks(body_with('-> TODO_PM '))))

    def test_extract_revised_and_verdicts(self):
        b = body_with(GOOD_QA)
        out = review_text('NELZYA', 'MOZHNO', '```\n' + b + '\n```')
        self.assertEqual(S.extract_revised(out), b)
        self.assertEqual(S.verdicts(out), ('NELZYA', 'MOZHNO'))
        self.assertIsNone(S.extract_revised('ВЕРДИКТ: MOZHNO\n'))
        self.assertIsNone(S.extract_revised('REVISED_BODY_BEGIN\nnot a body\nREVISED_BODY_END'))

    def test_skeleton_and_pm_request(self):
        sk = S.draft_skeleton(EV)
        self.assertTrue(sk.startswith(S.MARKER + '\n'))
        self.assertIn(S.QA_HEADER, sk); self.assertEqual(sk.count('TODO_PM'), 3)
        r = S.pm_request(EV)
        self.assertTrue(r.startswith('PM_SUCCESSOR_REQUEST'))
        self.assertLess(len(r.encode()), 65536)
        for k in ('224ebbe3', 'fe5a9ec8', '765aebc2', 'TS2339' if 'TS2339' in r else 'presentation', 'games-map-debug.ts:21'):
            self.assertIn(k, r)
        self.assertNotIn('GOBADMINTON_RESUME_V1\n', r.split('=== ФАКТЫ')[0])

    def test_pm_with_fake_runner(self):
        d = setup_run()
        good = body_with(GOOD_QA)
        S.pm(96, runner=lambda text: (review_text('NELZYA', 'MOZHNO', good), 'fake'))
        self.assertEqual((d / 'draft.body.txt').read_text(), good)
        self.assertTrue((d / 'pm_request.txt').read_text().startswith('PM_SUCCESSOR_REQUEST'))
        with self.assertRaises(SystemExit):
            S.pm(96, runner=lambda text: ('ВЕРДИКТ: NELZYA\n', 'fake'))

    def test_review_mozhno_first(self):
        d = setup_run(); (d / 'draft.body.txt').write_text(body_with(GOOD_QA))
        for f in ('final.body.txt',):
            (d / f).unlink(missing_ok=True)
        fr = FakeReviewer([review_text('MOZHNO')])
        r = S.review(96, reviewer=fr)
        self.assertEqual(r['final_verdict'], 'MOZHNO'); self.assertEqual(len(fr.calls), 1)

    def test_review_nelzya_then_revised_mozhno(self):
        d = setup_run(); (d / 'draft.body.txt').write_text(B98)
        rev = body_with(GOOD_QA)
        fr = FakeReviewer([review_text('NELZYA', 'MOZHNO', rev), review_text('MOZHNO')])
        r = S.review(96, reviewer=fr)
        self.assertEqual(r['final_verdict'], 'MOZHNO'); self.assertEqual(len(fr.calls), 2)
        self.assertEqual(fr.calls[1][1], rev)
        self.assertEqual((d / 'final.body.txt').read_text(), rev)

    def test_review_max_one_rereview(self):
        d = setup_run(); (d / 'draft.body.txt').write_text(B98)
        fr = FakeReviewer([review_text('NELZYA', 'NELZYA', B98), review_text('NELZYA', 'NELZYA', B98), review_text('MOZHNO')])
        r = S.review(96, reviewer=fr)
        self.assertEqual(r['final_verdict'], 'NELZYA'); self.assertEqual(len(fr.calls), 2)

    def test_review_nelzya_without_revised(self):
        d = setup_run(); (d / 'draft.body.txt').write_text(B98)
        fr = FakeReviewer([review_text('NELZYA', 'NELZYA')])
        self.assertEqual(S.review(96, reviewer=fr)['final_verdict'], 'NELZYA'); self.assertEqual(len(fr.calls), 1)

    def test_cmd_reviewer_contract(self):
        setup_run()
        with tempfile.NamedTemporaryFile('w', suffix='.sh', delete=False) as f:
            f.write('#!/bin/bash\n[ -z "${GH_PUSH_TOKEN:-}" ] || { echo token-leaked >&2; exit 9; }\n'
                    '[ -f "$1" ] && grep -q "Обязательные попытки" "$2" && grep -q 765aebc2 "$2" || exit 8\n'
                    'echo "ВЕРДИКТ: MOZHNO"; echo "ВЕРДИКТ ДЛЯ ИСПРАВЛЕННОГО ТЕЛА: MOZHNO"; echo "sha=$SL_REPO_SHA issue=$SL_ISSUE"\n')
        os.chmod(f.name, 0o755)
        os.environ['GH_PUSH_TOKEN'] = 'ghp_' + 'x' * 30
        try:
            rv = S.make_reviewer('cmd:' + f.name)
            self.assertIsInstance(rv, S.CmdReviewer)
            out, src = rv.review(B98, EV, EV['dev_head'], 'review1')
            self.assertIn('ВЕРДИКТ: MOZHNO', out); self.assertIn('issue=96', out)
            tpl = S.make_reviewer('cmd:' + str(HERE.parent / 'reviewers' / 'external_reviewer_template.sh'))
            with self.assertRaises(RuntimeError):
                tpl.review(B98, EV, EV['dev_head'], 'review1')
        finally:
            del os.environ['GH_PUSH_TOKEN']
        self.assertIsInstance(S.make_reviewer('codex'), S.CodexReviewer)
        self.assertIsInstance(S.make_reviewer(None), S.CodexReviewer)
        for spec in ('agy', 'agy-only'):
            with self.assertRaises(SystemExit):   # agy отключён до provider-specific tests + Owner GO
                S.make_reviewer(spec)
        with self.assertRaises(SystemExit):
            S.make_reviewer('gemini')

    def test_publish_guards(self):
        d = setup_run()
        (d / 'review.json').write_text(json.dumps({'final_verdict': 'NELZYA', 'rounds': []}))
        with self.assertRaises(SystemExit):
            S.publish(96, 't', 't', 'm', do_publish=True)
        good = body_with(GOOD_QA); (d / 'final.body.txt').write_text(good)
        (d / 'review.json').write_text(json.dumps({'final_verdict': 'MOZHNO', 'final_body': str(d / 'final.body.txt'),
                                                   'final_sha256': S.sha256(good + 'x')}))
        with self.assertRaises(SystemExit):   # тело изменено после ревью
            S.publish(96, 't', 't', 'm', do_publish=True)

        class FakeGH:
            posts = []
            def get(self, p): return {'commit': {'sha': 'f' * 40}}
            def req(self, p, m='GET', data=None): self.posts.append(p); return {}
        (d / 'review.json').write_text(json.dumps({'final_verdict': 'MOZHNO', 'final_body': str(d / 'final.body.txt'),
                                                   'final_sha256': S.sha256(good)}))
        g = FakeGH()
        with self.assertRaises(SystemExit):   # dev ушёл вперёд
            S.publish(96, 't', 't', 'm', do_publish=True, gh=g)
        self.assertEqual(g.posts, [])

    def test_agy_disabled(self):
        with self.assertRaises(RuntimeError):
            S.AgyReviewer().review(B98, EV, EV['dev_head'], 'review1')
        self.assertIn('Owner GO', S.AGY_DISABLED_MSG)

    def test_pending_reviewer_state_resume(self):
        """Интерфейс двухфазного внешнего ревьюера (AgyPending) сохраняет раунд и продолжает."""
        d = setup_run(); (d / 'draft.body.txt').write_text(B98)
        rev = body_with(GOOD_QA)

        class Two(S.Reviewer):
            family = 'ext'
            def __init__(s): s.ready = {}
            def review(s, body, ev, sha, tag):
                if tag not in s.ready:
                    raise S.AgyPending(json.dumps({'tag': tag}))
                return s.ready[tag], 'ext'
        r2 = Two()
        self.assertEqual(S.review(96, reviewer=r2, fresh=True)['final_verdict'], 'PENDING_AGY')
        r2.ready['review1'] = review_text('NELZYA', 'MOZHNO', rev)
        res = S.review(96, reviewer=r2)
        self.assertEqual((res['final_verdict'], res['round']), ('PENDING_AGY', 2))
        r2.ready['review2'] = review_text('MOZHNO')
        res = S.review(96, reviewer=r2)
        self.assertEqual(res['final_verdict'], 'MOZHNO'); self.assertEqual((d / 'final.body.txt').read_text(), rev)

    def test_redact(self):
        os.environ['GH_PUSH_TOKEN'] = 'abcSECRET123'
        try:
            self.assertNotIn('abcSECRET123', S.redact('x abcSECRET123 y'))
        finally:
            del os.environ['GH_PUSH_TOKEN']
        self.assertNotIn('ghp_', S.redact('ghp_' + 'a' * 36))


if __name__ == '__main__':
    unittest.main(verbosity=1)
