"""Author regressions: actual sanitized NON-PROD metadata, local Git copies only."""
import copy
import base64
import hashlib
import json
import multiprocessing
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from contextlib import ExitStack
from unittest.mock import patch

import runner
import legacy_qa
import backlog_sync
import test_parallel_integration_pma_v001 as atomic

SOURCE = Path(__file__).resolve().parents[3]
WORKBENCH = SOURCE / 'docs/workbench/implementation/pma-legacy-qa-compat-repair-01-v001'
SNAPSHOT = WORKBENCH / 'snapshot'
MAIN = 'f82b910b7f30fa6bf4ffac5622cd8de87164f36d'


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True,
                                   stderr=subprocess.PIPE).strip()


class ActualLegacyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.repo = Path(cls.tmp.name) / 'git'
        subprocess.run(['git', 'clone', '--quiet', '--shared', '--no-checkout',
                        str(SOURCE), str(cls.repo)], check=True, capture_output=True)
        git(cls.repo, 'config', 'user.name', 'Author fixture')
        git(cls.repo, 'config', 'user.email', 'fixture@example.invalid')
        git(cls.repo, 'config', 'core.hooksPath', '/dev/null')
        git(cls.repo, 'config', 'gc.auto', '0')
        git(cls.repo, 'checkout', '--quiet', '--detach', MAIN)
        cls.snapshot = json.loads((SNAPSHOT / 'metadata.json').read_bytes())
        cls.manifest = json.loads((SOURCE / legacy_qa.MANIFEST_PATH).read_bytes())
        cls.q = cls.snapshot['backlog']
        path = cls.repo / legacy_qa.MANIFEST_PATH
        path.write_bytes((SOURCE / legacy_qa.MANIFEST_PATH).read_bytes())
        canonical = cls.repo / backlog_sync.CANONICAL_PATH
        canonical.write_text(json.dumps(cls.q) + '\n')
        git(cls.repo, 'add', legacy_qa.MANIFEST_PATH, backlog_sync.CANONICAL_PATH)
        git(cls.repo, 'commit', '--quiet', '-m', 'Offline proposed manifest fixture')
        cls.manifest_commit = git(cls.repo, 'rev-parse', 'HEAD')
        cls.review_path = 'docs/workbench/bootstrap-fixture.json'
        cls.review = {'kind': 'legacy_qa_bootstrap_review', 'project': 'GoBadminton',
            'prod_authorized': False, 'task_id': 'qa-offline-bootstrap-fixture',
            'producer_task_id': 'offline-bootstrap-fixture', 'candidate_sha': cls.manifest_commit,
            'candidate_tree': git(cls.repo, 'rev-parse', 'HEAD^{tree}'),
            'manifest_sha256': legacy_qa.MANIFEST_SHA256, 'verdict': 'PASS',
            'blocking_findings': [], 'merge_recommendation': 'MERGE_RECOMMENDED',
            'status': 'APPROVED_BOOTSTRAP_NONPROD'}
        (cls.repo / cls.review_path).write_text(json.dumps(cls.review) + '\n')
        git(cls.repo, 'add', cls.review_path)
        git(cls.repo, 'commit', '--quiet', '-m', 'Synthetic separate bootstrap review; not real authority')
        cls.review_commit = git(cls.repo, 'rev-parse', 'HEAD')
        git(cls.repo, 'update-ref', 'refs/remotes/origin/main', cls.review_commit)
        cls.canonical_blob = git(cls.repo, 'rev-parse', 'HEAD:' + backlog_sync.CANONICAL_PATH)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.runtime = Path(tempfile.mkdtemp(dir=self.tmp.name))
        self.addCleanup(shutil.rmtree, self.runtime)
        shutil.copytree(SNAPSHOT / 'receipts', self.runtime / 'receipts')
        for tid, filename in self.snapshot.get('encoded_raw_receipts', {}).items():
            raw = base64.b64decode((SNAPSHOT / 'receipts' / filename).read_bytes(), validate=True)
            (self.runtime / 'receipts' / (tid + '.json')).write_bytes(raw)
        self.q = copy.deepcopy(self.__class__.q)
        self.st = copy.deepcopy(self.snapshot['state'])
        self.lookup = runner._v2_task_map(self.q)
        self.bootstrap = {'version': 1, 'project': 'GoBadminton', 'prod_authorized': False,
            'manifest_sha256': legacy_qa.MANIFEST_SHA256, 'manifest_commit': self.manifest_commit,
            'review_commit': self.review_commit, 'review_path': self.review_path}
        trust = {'canonical_commit': self.review_commit, 'canonical_blob': self.canonical_blob}
        self.write('backlog-sync-trust.json', trust)
        self.write('backlog-sync-state.json', dict(trust, status='IN_SYNC', runtime_blob=self.canonical_blob))
        self.write('legacy-qa-bootstrap.json', self.bootstrap)
        self.write('config.json', {'project': 'GoBadminton', 'prod_authorized': False, 'workspace': str(self.repo)})
        self.write('backlog.json', self.q)
        self.write('state.json', self.st)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for key, value in {'BACKLOG_PATH': self.runtime / 'backlog.json',
                           'RECEIPTS_DIR': self.runtime / 'receipts'}.items():
            self.stack.enter_context(patch.object(runner, key, value))

    def write(self, name, data):
        (self.runtime / name).write_text(json.dumps(data) + '\n')

    def edge(self, tid):
        consumer_id = next(iter(self.manifest['records'][tid]['consumers']))
        return self.lookup[consumer_id]

    def accepted(self, tid='qa-fb01-city-visual-v001', consumer=None):
        return runner._v2_dependency_accepted(self.q, self.st, tid, consumer=consumer or self.edge(tid))

    def test_actual_18_mismatches_before_after_and_no_bytes_changed(self):
        self.assertEqual(len(self.snapshot['accepted_dependency_ids']), 27)
        self.assertEqual(len(self.snapshot['legacy_ids']), 18)
        self.assertEqual(set(self.snapshot['legacy_ids']), legacy_qa.LEGACY_TASK_IDS)
        before = {p.name: p.read_bytes() for p in (self.runtime / 'receipts').iterdir()}
        before['state.json'] = (self.runtime / 'state.json').read_bytes()
        decisions = {}
        for tid in self.snapshot['legacy_ids']:
            with self.subTest(task=tid):
                self.assertFalse(runner._v2_strict_dependency_accepted(self.q, self.st, tid))
                expected = self.manifest['records'][tid]['decision'] == 'ATTESTED_DEPENDENCY_ONLY'
                self.assertEqual(self.accepted(tid), expected)
                decisions[tid] = expected
        self.assertEqual(sum(decisions.values()), 7)
        for p in (self.runtime / 'receipts').iterdir():
            self.assertEqual(before[p.name], p.read_bytes())
        self.assertEqual(before['state.json'], (self.runtime / 'state.json').read_bytes())

    def test_five_impacted_pending_paths_preserve_unproved_and_release_holds(self):
        for task_id, dep in [('fb01-feature-media-v001', 'qa-fb01-review-media-v001'),
                             ('fb01-feature-city-v001', 'qa-fb01-review-city-v001'),
                             ('fb01-feature-game-v001', 'qa-fb01-review-game-v001'),
                             ('fb01-feature-design-v001', 'qa-fb01-review-design-v001'),
                             ('preview-rv3-players-map-v001', 'qa-rv3-players-map-frontend-v001')]:
            with self.subTest(task=task_id):
                task = self.lookup[task_id]
                self.assertFalse(runner._v2_strict_dependency_accepted(self.q, self.st, dep))
                self.assertEqual(self.accepted(dep, task), task_id.startswith('preview-'))
                ready, reason = runner.dependencies_ready(task, self.q, self.st)
                self.assertFalse(ready)
                self.assertIn('waiting', reason)

    def test_unbootstrapped_or_malformed_trust_never_accepts(self):
        for name in ['legacy-qa-bootstrap.json', 'backlog-sync-trust.json', 'backlog-sync-state.json']:
            path = self.runtime / name
            original = path.read_bytes()
            for raw in [None, b'{', b'[]', b'null', b'{}']:
                if raw is None:
                    path.unlink()
                else:
                    path.write_bytes(raw)
                self.assertFalse(self.accepted(), (name, raw))
                path.write_bytes(original)
        for field, value in [('prod_authorized', True), ('manifest_commit', MAIN),
                             ('review_commit', MAIN), ('manifest_sha256', 'f' * 64),
                             ('review_path', '../config.json')]:
            self.write('legacy-qa-bootstrap.json', dict(self.bootstrap, **{field: value}))
            self.assertFalse(self.accepted(), field)

    def test_receipt_mutation_candidate_identity_verdict_and_fields_rejected(self):
        for tid in ['qa-fb01-city-visual-v001', 'fb01-city-visual-v001']:
            path = self.runtime / 'receipts' / (tid + '.json')
            raw = path.read_bytes()
            data = json.loads(raw)
            for field, value in [('candidate_sha', MAIN), ('candidate_tree', MAIN), ('ok', False),
                                 ('project', 'Other'), ('task_id', 'other'), ('verdict', 'FAIL'),
                                 ('verdict', 'BLOCKED'), ('blocking_findings', []),
                                 ('blocking_findings', None), ('blocking_findings', 0),
                                 ('recommendation', 'MERGE_RECOMMENDED')]:
                path.write_text(json.dumps(dict(data, **{field: value})))
                self.assertFalse(self.accepted(), (tid, field, value))
            path.unlink()
            self.assertFalse(self.accepted())
            path.write_bytes(raw)

    def test_terminal_qa_cannot_be_promoted_or_relabelled(self):
        tid = 'qa-fb01-city-visual-v001'
        for status in ['qa_failed', 'qa_blocked']:
            self.st['history'].append({'id': tid, 'status': status})
            self.assertFalse(self.accepted())
            self.st['history'].append({'id': tid, 'status': 'completed'})
            self.assertFalse(self.accepted())
            self.st['history'] = copy.deepcopy(self.snapshot['state']['history'])
        candidate = self.manifest['records'][tid]['candidate_sha']
        self.st['history'].append({'id': 'qa-new-terminal', 'status': 'qa_failed'})
        self.write('receipts/qa-new-terminal.json', {'project': 'GoBadminton', 'task_id': 'qa-new-terminal',
                   'ok': False, 'verdict': 'FAIL', 'candidate_sha': candidate})
        self.assertFalse(self.accepted())

    def test_changed_scope_producer_consumer_and_unknown_edge_rejected(self):
        for tid in ['qa-fb01-city-visual-v001', 'fb01-city-visual-v001', self.edge('qa-fb01-city-visual-v001')['id']]:
            task = self.lookup[tid]
            for field, value in [('scope', 'widened'), ('source', 'https://example.invalid'),
                                 ('locks', ['global']), ('recovery_from', {'attempt': 6})]:
                original = copy.deepcopy(task)
                task[field] = value
                self.assertFalse(self.accepted(), (tid, field))
                task.clear()
                task.update(original)
        unknown = dict(self.edge('qa-fb01-city-visual-v001'), id='unreviewed-consumer')
        self.assertFalse(self.accepted(consumer=unknown))
        self.assertFalse(runner._v2_dependency_accepted(self.q, self.st, 'qa-fb01-city-visual-v001'))

    def test_missing_moved_git_provenance_and_candidate_tree_fail_closed(self):
        real = runner._v2_git_evidence
        for verb in ['rev-parse', 'show', 'merge-base']:
            with patch.object(runner, '_v2_git_evidence', side_effect=lambda args: None if args[0] == verb else real(args)):
                self.assertFalse(self.accepted(), verb)
        git(self.repo, 'update-ref', 'refs/remotes/origin/main', MAIN)
        try:
            self.assertFalse(self.accepted())
        finally:
            git(self.repo, 'update-ref', 'refs/remotes/origin/main', self.review_commit)

    def test_transitive_terminal_guard_remains(self):
        task = self.edge('qa-fb01-city-visual-v001')
        dependency = {'id': 'qa-terminal-fixture', 'status': 'qa_failed'}
        # Test the preserved closure guard with an accepted dependency stub.
        task['depends_on_completed'] = ['qa-terminal-fixture']
        self.q['tasks'].append(dependency)
        self.st['history'].extend([{'id': dependency['id'], 'status': 'qa_failed'},
                                   {'id': dependency['id'], 'status': 'completed'}])
        with patch.object(runner, '_v2_dependency_accepted', return_value=True):
            ready, reason = runner.dependencies_ready(task, self.q, self.st)
        self.assertFalse(ready)
        self.assertIn('terminal QA', reason)

    def test_receipt_or_trust_changed_during_proof_is_rejected(self):
        validator = backlog_sync.validate_immutable_sources
        for name in ['receipts/fb01-city-visual-v001.json', 'legacy-qa-bootstrap.json']:
            path = self.runtime / name
            original = path.read_bytes()
            def change_during_check(repo, items):
                validator(repo, items)
                path.write_bytes(original + b'\n')
            with patch.object(backlog_sync, 'validate_immutable_sources', side_effect=change_during_check):
                self.assertFalse(self.accepted())
            path.write_bytes(original)

    def test_legacy_cannot_escape_attestation_by_rewriting_as_current_schema(self):
        tid = 'qa-fb01-game-api-backend-20261008-v001'
        path = self.runtime / 'receipts' / (tid + '.json')
        original = path.read_bytes()
        data = json.loads(original)
        data.update(blocking_findings=[], merge_recommendation='MERGE_RECOMMENDED')
        path.write_text(json.dumps(data))
        with patch.object(runner, '_v2_strict_dependency_accepted', return_value=True) as strict:
            self.assertFalse(self.accepted(tid))
            self.assertFalse(runner._v2_dependency_accepted(self.q, self.st, tid))
            strict.assert_not_called()
        path.write_bytes(original)

    def test_new_strict_id_cannot_reopen_terminal_history(self):
        tid = 'qa-new-strict-fixture'
        self.q['tasks'].append({'id': tid})
        for failed in ['qa_failed', 'qa_blocked']:
            self.st['history'].extend([{'id': tid, 'status': failed}, {'id': tid, 'status': 'completed'}])
            with patch.object(runner, '_v2_strict_dependency_accepted', return_value=True) as strict:
                self.assertFalse(runner._v2_dependency_accepted(self.q, self.st, tid))
                strict.assert_not_called()


def claim_contender(item, output):
    for tick in range(100):
        try:
            runner.claim_task(item)
            output.put((item['id'], True))
            return
        except RuntimeError as exc:
            if 'critical section busy; retry next tick' in str(exc):
                time.sleep(0.02)
                continue
            output.put((item['id'], False, str(exc)))
            return
    output.put((item['id'], False, 'fixture busy retry bound exhausted'))


class ForkedClaimTests(atomic.ParallelIntegrationTests):
    def race(self, items):
        ctx = multiprocessing.get_context('fork')
        out = ctx.Queue()
        processes = [ctx.Process(target=claim_contender, args=(item, out)) for item in items]
        for proc in processes:
            proc.start()
        for proc in processes:
            proc.join(30)
            self.assertFalse(proc.is_alive())
            self.assertEqual(proc.exitcode, 0)
        return [out.get(timeout=5) for _ in items]

    def test_atomic_four_slots_and_duplicate_process_claim(self):
        items = [self.item('fork-' + str(i), ['domain-' + str(i)], i) for i in range(7)]
        self.prepare(items)
        result = self.race(items)
        self.assertEqual(sum(row[1] for row in result), 4, result)
        self.assertEqual(len(self.state()['active']), 4)

    def test_duplicate_claim_processes_only_one_wins(self):
        item = self.item('duplicate', ['independent'], 0)
        self.prepare([item])
        result = self.race([item] * 4)
        self.assertEqual(sum(row[1] for row in result), 1, result)
        self.assertEqual(list(self.state()['active']), ['duplicate'])

    def test_remaining_fourth_slot_race_allows_one(self):
        items = [self.item('last-slot-' + str(i), ['independent-' + str(i)], i) for i in range(9)]
        self.prepare(items)
        for item in items[:3]:
            runner.claim_task(item)
        result = self.race(items[3:])
        self.assertEqual(sum(row[1] for row in result), 1, result)
        self.assertEqual(len(self.state()['active']), 4)

    def test_invalid_config_and_paused_claim_preserve_state(self):
        item = self.item('config-pause', ['independent'], 0)
        self.prepare([item])
        state_path = self.runtime / 'state.json'
        original = state_path.read_bytes()
        cfg_path = self.runtime / 'config.json'
        cfg_raw = cfg_path.read_bytes()
        for invalid in [b'{', b'[]']:
            cfg_path.write_bytes(invalid)
            with self.assertRaises((RuntimeError, ValueError)):
                runner.claim_task(item)
            self.assertEqual(state_path.read_bytes(), original)
        cfg_path.write_bytes(cfg_raw)
        state = self.state()
        state['paused'] = True
        state_path.write_text(json.dumps(state))
        paused_raw = state_path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'paused'):
            runner.claim_task(item)
        self.assertEqual(state_path.read_bytes(), paused_raw)


if __name__ == '__main__':
    unittest.main()
