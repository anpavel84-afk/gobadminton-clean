"""Fresh author adversaries: isolated Git transport, processes and runtime only."""
import copy
import json
import multiprocessing
import subprocess
import unittest
from contextlib import contextmanager
from unittest import mock

import autopilot
import backlog_sync
import publication_guard as guard
import queue_recovery as recovery
import runner
from test_queue_recovery_v001 import RecoveryTests
from test_backlog_sync_v001 import git, task


def competing_push_gate(work, runtime, baseline, target, receipt, event, pipe,
                        locked=None, release=None, publish=False):
    original = backlog_sync.claim_sync_section
    @contextmanager
    def scheduled_section(root):
        # Schedule only after acquiring the real process lock. Neither the
        # proof nor the lock/refusal/reservation is substituted by the fixture.
        with original(root):
            locked.set()
            if not release.wait(15):
                raise RuntimeError('fixture lock-release deadline expired')
            yield
    try:
        if not event.wait(15):
            raise RuntimeError('fixture start deadline expired')
        if publish:
            guard.publish_main(work, runtime, {'baseline': baseline}, receipt)
        elif locked is None:
            guard.pre_push(work, runtime, {'baseline': baseline}, receipt, baseline, target)
        else:
            with mock.patch.object(backlog_sync, 'claim_sync_section', scheduled_section):
                guard.pre_push(work, runtime, {'baseline': baseline}, receipt, baseline, target)
        pipe.send('PUBLISHED' if publish else 'RESERVED')
    except RuntimeError as exc:
        pipe.send('BLOCKED: ' + str(exc))
    finally:
        pipe.close()


class Repair01Checks(RecoveryTests):
    def hook_env(self, active=False):
        with mock.patch.object(autopilot, 'WORKTREE', self.work):
            return autopilot.planner_publication_environment(active)

    def actual_push(self, env):
        return subprocess.run(['git', '-C', str(self.work), 'push', 'origin', 'HEAD:main'],
                              env=env, capture_output=True, text=True, timeout=30)

    def accepted_candidate(self):
        self.fixture()
        with mock.patch.object(autopilot, 'launch_planner', side_effect=self.planner):
            self.tick()
        producer, qa = copy.deepcopy(self.pair)
        self.assertIn('Execution effect ceiling: SOURCE_ONLY',
            runner.build_launch_prompt(producer, str(self.work/'synthetic.md'), self.runtime/'receipt.json'))
        baseline = git(self.work, 'rev-parse', 'HEAD')
        before = self.q()
        git(self.work, 'checkout', '-qb', 'impl/guard-accepted')
        (self.work / 'guard-source.txt').write_text('new independently accepted synthetic source\n')
        git(self.work, 'add', 'guard-source.txt')
        git(self.work, 'commit', '-qm', 'distinct repair source')
        candidate = git(self.work, 'rev-parse', 'HEAD')
        tree = git(self.work, 'rev-parse', candidate + '^{tree}')
        git(self.work, 'push', '-q', 'origin', 'impl/guard-accepted')
        git(self.work, 'checkout', '-q', 'main')
        pp = self.runtime / 'receipts' / (producer['id'] + '.json')
        qp = self.runtime / 'receipts' / (qa['id'] + '.json')
        pp.write_text(json.dumps({'project': 'GoBadminton', 'ok': True, 'task_id': producer['id'],
            'candidate_sha': candidate, 'candidate_tree': tree, 'branch': 'impl/guard-accepted'}))
        qp.write_text(json.dumps({'project': 'GoBadminton', 'ok': True, 'task_id': qa['id'],
            'producer_task_id': producer['id'], 'candidate_sha': candidate, 'candidate_tree': tree,
            'branch': 'impl/guard-accepted', 'verdict': 'PASS', 'blocking_findings': [],
            'blocking_gap_count': 0, 'merge_recommendation': 'MERGE_RECOMMENDED'}))
        runner.mark_completed(producer['id'], 'synthetic producer completed')
        runner.mark_completed(qa['id'], 'synthetic independent-role acceptance')
        git(self.work, 'merge', '--no-ff', '-qm', 'exact accepted synthetic source merge', candidate)
        target = git(self.work, 'rev-parse', 'HEAD')
        receipt = {'project': 'GoBadminton', 'ok': True, 'action': 'merged', 'result_commit': target,
                   'accepted_qa_task_id': qa['id'], 'merged_candidate_sha': candidate}
        (self.runtime / 'autopilot-receipt.json').write_text(json.dumps(receipt))
        return baseline, before, target, receipt, pp, qp

    def fresh_real_pre_push_rejects_failed_code_and_remote_stays_unchanged(self):
        self.fixture()
        baseline = git(self.remote, 'rev-parse', 'main')
        env = self.hook_env()
        git(self.work, 'merge', '--no-ff', '-qm', 'rejected code must not publish', self.failed['candidate_sha'])
        receipt = {'project': 'GoBadminton', 'ok': True, 'action': 'merged',
                   'result_commit': git(self.work, 'rev-parse', 'HEAD'),
                   'accepted_qa_task_id': self.qa['id'], 'merged_candidate_sha': self.failed['candidate_sha']}
        (self.runtime / 'autopilot-receipt.json').write_text(json.dumps(receipt))
        state = (self.runtime / 'state.json').read_bytes()
        result = self.actual_push(env)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn('publication refused', result.stderr)
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), baseline)
        self.assertEqual((self.runtime / 'state.json').read_bytes(), state)

    def fresh_real_pre_push_accepts_exact_qa_and_reserves_until_restart_verification(self):
        baseline, before, target, receipt, _, _ = self.accepted_candidate()
        result = self.actual_push(self.hook_env())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), target)
        self.assertEqual(json.loads((self.runtime / 'source-merge-reservation.json').read_text())['status'], 'RESERVED')
        self.assertEqual(guard.reconcile_reservation(self.work, self.runtime)['status'], 'VERIFIED')
        self.sync()
        self.assertTrue(runner._v2_dependency_accepted(self.q(), self.state(), receipt['accepted_qa_task_id']))

    def fresh_merge_identity_matrix_and_no_unrelated_source(self):
        baseline, before, target, receipt, pp, qp = self.accepted_candidate()
        own = json.loads(pp.read_text()); qa = json.loads(qp.read_text())
        variants = [('task_id', 'qa-wrong'), ('project', 'Other'), ('candidate_tree', 'f'*40),
            ('candidate_sha', self.failed['candidate_sha']), ('blocking_findings', ['hard defect']),
            ('blocking_gap_count', True), ('blocking_gap_count', 1), ('verdict', 'FAIL'),
            ('verdict', 'BLOCKED'), ('merge_recommendation', 'MERGE_NOT_RECOMMENDED'),
            ('producer_task_id', 'different-producer'), ('branch', 'wrong-branch')]
        for field, value in variants:
            with self.subTest(field=field, value=value):
                qp.write_text(json.dumps({**qa, field: value}))
                with self.assertRaises(backlog_sync.SyncBlocked):
                    guard.accepted_merge_proof(self.work, self.runtime, before, self.state(), receipt, baseline, target)
        qp.write_text(json.dumps(qa))
        for field, value in [('task_id', 'wrong'), ('candidate_sha', self.failed['candidate_sha']),
                             ('candidate_tree', 'a'*40), ('branch', 'absent')]:
            pp.write_text(json.dumps({**own, field: value}))
            with self.assertRaises(backlog_sync.SyncBlocked):
                guard.accepted_merge_proof(self.work, self.runtime, before, self.state(), receipt, baseline, target)
        pp.write_text(json.dumps(own))
        (self.work / 'smuggled-runtime.py').write_text('unauthorized = True\n')
        git(self.work, 'add', 'smuggled-runtime.py'); git(self.work, 'commit', '-qm', 'source outside accepted candidate')
        target = git(self.work, 'rev-parse', 'HEAD')
        with self.assertRaisesRegex(backlog_sync.SyncBlocked, 'outside exact accepted'):
            guard.accepted_merge_proof(self.work, self.runtime, before, self.state(),
                                       {**receipt, 'result_commit': target}, baseline, target)

    def fresh_two_process_merge_gate_single_reservation_and_abort_keeps_lane_open(self):
        self.merge_gate_race('race')

    def fresh_two_process_claim_lock_refusal_and_retry(self):
        self.merge_gate_race('claim_busy')

    def fresh_two_process_reserved_refusal_and_retry(self):
        self.merge_gate_race('reserved')

    def fresh_two_process_atomic_publish_has_one_remote_update(self):
        baseline, _, target, receipt, pp, qp = self.accepted_candidate()
        (self.work / 'docs' / 'second-publication.md').write_text('competing durable note\n')
        git(self.work, 'add', 'docs/second-publication.md'); git(self.work, 'commit', '-qm', 'competing result')
        second = git(self.work, 'rev-parse', 'HEAD')
        protected = {path: path.read_bytes() for path in
                     [self.runtime / 'state.json', self.runtime / 'backlog.json', self.failed_path, pp, qp]}
        hook = self.remote / 'hooks' / 'post-receive'
        hook.write_text('#!/bin/sh\ncat >> publication-events\n'); hook.chmod(0o700)
        ctx = multiprocessing.get_context('fork'); event = ctx.Event(); processes = []; pipes = []
        for index, sha in enumerate([target, second]):
            work = self.root / ('atomic-planner-' + str(index))
            subprocess.run(['git', 'clone', '-q', '--no-hardlinks', str(self.work), str(work)], check=True)
            git(work, 'remote', 'set-url', 'origin', str(self.remote))
            parent, child = ctx.Pipe(duplex=False)
            process = ctx.Process(target=competing_push_gate, args=(work, self.runtime, baseline, sha,
                {**receipt, 'result_commit': sha}, event, child, None, None, True))
            process.start(); child.close(); processes.append(process); pipes.append(parent)
            self.addCleanup(lambda p=process: p.is_alive() and p.terminate())
        event.set(); results = []
        for pipe in pipes:
            self.assertTrue(pipe.poll(25), 'actual publisher result deadline')
            results.append(pipe.recv()); pipe.close()
        for process in processes:
            process.join(10); self.assertEqual(process.exitcode, 0)
        self.assertEqual(results.count('PUBLISHED'), 1, results)
        loser = next(r for r in results if r != 'PUBLISHED')
        self.assertTrue(loser == 'BLOCKED: another atomic Git publication writer is active'
                        or loser == 'BLOCKED: STALE_MAIN: expected main SHA changed; fresh replan required', results)
        winner = [target, second][results.index('PUBLISHED')]
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), winner)
        self.assertEqual((self.remote / 'publication-events').read_text().splitlines(),
                         [baseline + ' ' + winner + ' refs/heads/main'])
        self.assertEqual(json.loads((self.runtime / 'source-merge-reservation.json').read_text())['result_commit'], winner)
        for path, raw in protected.items(): self.assertEqual(path.read_bytes(), raw)
        (self.runtime / 'autopilot-receipt.json').write_text(json.dumps({**receipt, 'result_commit': winner}))
        self.assertEqual(guard.reconcile_reservation(self.work, self.runtime)['status'], 'VERIFIED')
        for path, raw in protected.items(): self.assertEqual(path.read_bytes(), raw)

    def merge_gate_race(self, schedule):
        baseline, before, target, receipt, pp, qp = self.accepted_candidate()
        (self.work / 'docs' / 'different-publication.md').write_text('alternative durable merge note\n')
        git(self.work, 'add', 'docs/different-publication.md'); git(self.work, 'commit', '-qm', 'alternative result')
        second = git(self.work, 'rev-parse', 'HEAD')
        state = (self.runtime / 'state.json').read_bytes()
        backlog = (self.runtime / 'backlog.json').read_bytes()
        protected = {path: path.read_bytes() for path in [pp, qp, self.failed_path]}
        ctx = multiprocessing.get_context('fork'); event = ctx.Event(); processes = []; pipes = []
        locked = ctx.Event(); release = ctx.Event(); starts = [ctx.Event(), ctx.Event()]
        for index, sha in enumerate([target, second]):
            # Each competing planner owns its Git index/FETCH_HEAD while the
            # disposable remote and runtime reservation remain shared.
            work = self.root / ('competing-planner-' + str(index))
            subprocess.run(['git', 'clone', '-q', '--no-hardlinks', str(self.work), str(work)], check=True)
            git(work, 'remote', 'set-url', 'origin', str(self.remote))
            parent, child = ctx.Pipe(duplex=False)
            process = ctx.Process(target=competing_push_gate, args=(work, self.runtime,
                baseline, sha, {**receipt, 'result_commit': sha},
                event if schedule == 'race' else starts[index], child,
                locked if schedule == 'claim_busy' and index == 0 else None,
                release if schedule == 'claim_busy' and index == 0 else None))
            process.start(); child.close(); processes.append(process); pipes.append(parent)
            self.addCleanup(lambda p=process: p.is_alive() and p.terminate())
        def receive(index):
            self.assertTrue(pipes[index].poll(20), 'child process result deadline')
            return pipes[index].recv()
        try:
            if schedule == 'claim_busy':
                starts[0].set(); self.assertTrue(locked.wait(20), 'real claim lock acquired')
                starts[1].set(); loser = receive(1); release.set()
                results = [receive(0), loser]
            elif schedule == 'reserved':
                starts[0].set(); winner = receive(0)
                starts[1].set(); results = [winner, receive(1)]
            else:
                event.set(); results = [receive(0), receive(1)]
        finally:
            release.set()
            for pipe in pipes: pipe.close()
        for process in processes:
            process.join(10); self.assertEqual(process.exitcode, 0)
        self.assertEqual(results.count('RESERVED'), 1, results)
        self.assertEqual(sum(r.startswith('BLOCKED:') for r in results), 1, results)
        valid_refusals = {
            'claim_busy': 'BLOCKED: claim/backlog replacement critical section busy; retry next tick',
            'reserved': 'BLOCKED: another serialized source publication is reserved',
        }
        loser = next(r for r in results if r.startswith('BLOCKED:'))
        if schedule == 'race':
            self.assertIn(loser, valid_refusals.values(), results)
        else:
            self.assertEqual(loser, valid_refusals[schedule], results)
        winner_index = results.index('RESERVED'); winner = [target, second][winner_index]
        loser_target = [target, second][1 - winner_index]
        reservation_path = self.runtime / 'source-merge-reservation.json'
        reservation = json.loads(reservation_path.read_text())
        self.assertEqual(reservation, {'status': 'RESERVED', 'result_commit': winner,
            'baseline': baseline, 'accepted_qa_task_id': receipt['accepted_qa_task_id']})
        # Once the short lock is free, the earlier loser must encounter the
        # reservation fence on its next tick; it cannot overwrite the winner.
        raw_reservation = reservation_path.read_bytes()
        with self.assertRaisesRegex(backlog_sync.SyncBlocked, 'another serialized source publication is reserved'):
            guard.pre_push(self.work, self.runtime, {'baseline': baseline},
                {**receipt, 'result_commit': loser_target}, baseline, loser_target)
        self.assertEqual(reservation_path.read_bytes(), raw_reservation)
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), baseline)
        self.assertEqual((self.runtime / 'state.json').read_bytes(), state)
        self.assertEqual((self.runtime / 'backlog.json').read_bytes(), backlog)
        for path, raw in protected.items(): self.assertEqual(path.read_bytes(), raw)
        with self.assertRaisesRegex(RuntimeError, 'serialized source publication'):
            runner.claim_task(self.down)
        self.assertEqual(guard.reconcile_reservation(self.work, self.runtime)['status'], 'ABORTED')
        # A retry after a proven no-push abort obtains a fresh reservation.
        guard.pre_push(self.work, self.runtime, {'baseline': baseline},
            {**receipt, 'result_commit': loser_target}, baseline, loser_target)
        self.assertEqual(json.loads(reservation_path.read_text())['result_commit'], loser_target)
        self.assertEqual(guard.reconcile_reservation(self.work, self.runtime)['status'], 'ABORTED')
        # Exactly the winning candidate publishes to the real disposable bare
        # main. The loser remains stale after the atomic expected-SHA transport.
        (self.runtime / 'autopilot-receipt.json').write_text(json.dumps({**receipt, 'result_commit': winner}))
        guard.publish_main(self.work, self.runtime, {'baseline': baseline},
            {**receipt, 'result_commit': winner})
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), winner)
        with self.assertRaisesRegex(backlog_sync.SyncBlocked, 'STALE_MAIN'):
            guard.publish_main(self.work, self.runtime, {'baseline': baseline},
                {**receipt, 'result_commit': loser_target})
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), winner)
        self.assertEqual(guard.reconcile_reservation(self.work, self.runtime)['status'], 'VERIFIED')
        self.assertEqual((self.runtime / 'state.json').read_bytes(), state)
        self.assertEqual((self.runtime / 'backlog.json').read_bytes(), backlog)
        for path, raw in protected.items(): self.assertEqual(path.read_bytes(), raw)
        git(self.work, 'checkout', '-q', '-B', 'main', winner)
        q = self.q(); q['tasks'][0]['enabled'] = True
        self.update_canonical(q['tasks']); self.sync()
        runner.claim_task(self.q()['tasks'][0])
        self.assertIn(self.web['id'], self.state()['active'])
        self.assertEqual(self.state()['history'], json.loads(state)['history'])

    def fresh_pre_push_stale_remote_or_context_mismatch_preserves_bytes(self):
        baseline, _, target, receipt, pp, qp = self.accepted_candidate()
        protected = {path: path.read_bytes() for path in
            [self.runtime/'state.json', self.runtime/'backlog.json', self.failed_path, pp, qp]}
        for context in [{}, {'baseline': target}]:
            with self.subTest(context=context), self.assertRaisesRegex(backlog_sync.SyncBlocked, 'STALE_MAIN'):
                guard.pre_push(self.work, self.runtime, context, receipt, baseline, target)
            self.assertEqual(git(self.remote, 'rev-parse', 'main'), baseline)
            self.assertFalse((self.runtime/'source-merge-reservation.json').exists())
        # Advance only the disposable remote to model a competing publisher.
        git(self.work, 'push', '-q', 'origin', target+':refs/heads/main')
        with self.assertRaisesRegex(backlog_sync.SyncBlocked, 'STALE_MAIN'):
            guard.pre_push(self.work, self.runtime, {'baseline': baseline}, receipt, baseline, target)
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), target)
        self.assertFalse((self.runtime/'source-merge-reservation.json').exists())
        for path, raw in protected.items():self.assertEqual(path.read_bytes(), raw)

    def fresh_interrupted_push_with_mutated_qa_is_quarantined_other_lane_claims(self):
        baseline, before, target, receipt, _, qp = self.accepted_candidate()
        self.assertEqual(self.actual_push(self.hook_env()).returncode, 0)
        qa = json.loads(qp.read_text()); qp.write_text(json.dumps({**qa, 'verdict': 'FAIL'}))
        result = guard.reconcile_reservation(self.work, self.runtime)
        self.assertEqual(result['status'], 'QUARANTINED')
        self.assertTrue(json.loads((self.runtime / 'source-publication-quarantine.json').read_text())['manual_remediation_required'])
        q = self.q(); q['tasks'][0]['enabled'] = True
        self.update_canonical(q['tasks']); self.sync()
        runner.claim_task(self.q()['tasks'][0])
        self.assertFalse(runner._v2_dependency_accepted(self.q(), self.state(), receipt['accepted_qa_task_id']))

    def fresh_full_existing_definition_and_policy_matrix(self):
        self.fixture(); entry, notice = self.prepare(); entry = recovery.reserve(self.runtime, entry['key'])
        before = self.q(); self.planner(self.cfg, [notice], True)
        after = json.loads(self.backlog.read_text()); receipt = json.loads((self.runtime / 'autopilot-receipt.json').read_text())
        fields = {'requires_pr_merged': 555, 'requires_owner_release': True, 'base_sha': 'a'*40,
            'locks': ['deploy-runtime'], 'lane': 'release', 'permission': 'live',
            'notes': 'requires_owner_release=approval.', 'executor': 'cursor', 'source': self.qa['source'] + '-different'}
        for field, value in fields.items():
            with self.subTest(field=field):
                altered = copy.deepcopy(after); altered['tasks'][3][field] = value
                with self.assertRaises(recovery.RecoveryHold):
                    recovery.validate_pair(entry, before, altered, receipt, self.state())
        for field in ['policy', 'prod_authorized']:
            altered = copy.deepcopy(after); altered[field] = True
            with self.assertRaises(recovery.RecoveryHold):
                recovery.validate_pair(entry, before, altered, receipt, self.state())

    def fresh_surplus_disabled_task_and_missing_pair_lineage_rejected(self):
        self.fixture(); entry, notice = self.prepare(); entry = recovery.reserve(self.runtime, entry['key'])
        before = self.q(); self.planner(self.cfg, [notice], True)
        after = json.loads(self.backlog.read_text())
        after['tasks'].append(task('secret-future-release', enabled=False, locks=['deploy-runtime'], ref=self.ref))
        with self.assertRaises(backlog_sync.SyncBlocked):
            backlog_sync.validate_recovery_transition(self.runtime, before, after, self.state())
        after['tasks'].pop()
        for t in after['tasks'][-2:]: t.pop('recovery_from')
        with self.assertRaises(backlog_sync.SyncBlocked):
            backlog_sync.validate_recovery_transition(self.runtime, before, after, self.state())

    def fresh_legacy_transitive_drop_and_completed_intermediary_never_claim(self):
        self.fixture()
        grandchild = task('legacy-grandchild', ref=self.ref)
        grandchild['notes'] = 'Keep Owner release. depends_on_completed=admin-a0b-source.'
        self.tasks.append(grandchild); self.update_canonical(self.tasks); self.sync()
        state = self.state()
        state['history'].append({'id': self.down['id'], 'status': 'completed'})
        self.assertFalse(runner.dependencies_ready(grandchild, self.q(), state)[0])
        original = (self.runtime / 'backlog.json').read_bytes()
        changed = copy.deepcopy(self.tasks); changed[-1]['notes'] = 'Keep Owner release.'
        self.update_canonical(changed)
        self.assertEqual(backlog_sync.sync_once(self.work, self.runtime)['status'], 'BLOCKED')
        self.assertEqual((self.runtime / 'backlog.json').read_bytes(), original)
        with self.assertRaises(RuntimeError): runner.claim_task(grandchild)
        self.assertNotIn(grandchild['id'], self.state()['active'])

    def fresh_gate_direct_claim_and_unknown_requires_fail_closed(self):
        self.fixture(); q = self.q(); q['tasks'][0].update(enabled=True, requires_pr_merged=555)
        self.update_canonical(q['tasks']); self.sync()
        with self.assertRaisesRegex(RuntimeError, 'PR-number API gate'):
            runner.claim_task(self.q()['tasks'][0])
        self.assertFalse(runner.task_gate({'requires_owner_release': True}, self.cfg)[0])
        q = self.q(); q['tasks'][0].pop('requires_pr_merged')
        self.update_canonical(q['tasks']); self.sync()
        state = self.state(); state['global_gates'] = ['Owner release missing']
        (self.runtime / 'state.json').write_text(json.dumps(state))
        self.assertEqual(runner.select_runnable_tasks(self.q(), state, self.cfg)[0], [])
        with self.assertRaisesRegex(RuntimeError, 'project-global blocked'):
            runner.claim_task(self.q()['tasks'][0])

    def fresh_backup_boundary_terminal_history_race_keeps_protected_bytes(self):
        self.fixture(); grandchild = task('race-grandchild', deps=[self.down['id']], ref=self.ref)
        self.tasks.append(grandchild); self.update_canonical(self.tasks); self.sync()
        original = (self.runtime / 'backlog.json').read_bytes()
        # An unrelated safe addition cannot consume a history view corrupted
        # or changed by a competing noncooperating writer after proof collection.
        self.update_canonical(self.tasks + [task('independent-docs', locks=['docs'], ref=self.ref)])
        original_write = backlog_sync.atomic_write
        def write(path, raw, *args, **kwargs):
            if path.parent.name == 'backlog-backups':
                state = self.state(); state['history'].append({'id': 'another-qa', 'status': 'qa_failed'})
                (self.runtime / 'state.json').write_text(json.dumps(state))
            return original_write(path, raw, *args, **kwargs)
        with mock.patch.object(backlog_sync, 'atomic_write', side_effect=write):
            result = backlog_sync.sync_once(self.work, self.runtime)
        self.assertEqual(result['status'], 'BLOCKED')
        self.assertEqual((self.runtime / 'backlog.json').read_bytes(), original)
        self.assertEqual(self.state()['history'][-1]['id'], 'another-qa')

    def fresh_real_pre_push_recovery_extra_blocks_before_publication(self):
        self.fixture(); entry, notice = self.prepare()
        before = self.q(); before['_canonical_commit'] = git(self.work, 'rev-parse', 'HEAD')
        recovery.reserve(self.runtime, entry['key'], baseline=before)
        # The fixture publishes a valid pair; rewind only its disposable origin
        # before exercising actual transport of the malicious surplus commit.
        self.planner(self.cfg, [notice], True)
        git(self.remote, 'update-ref', 'refs/heads/main', before['_canonical_commit'])
        git(self.work, 'fetch', '-q', 'origin', 'main')
        env = self.hook_env(active=True)
        tasks = json.loads(self.backlog.read_text())['tasks']
        tasks.append(task('unauthorized-release', locks=['deploy-runtime'], ref=self.ref))
        self.backlog.write_text(json.dumps({'project': 'GoBadminton', 'prod_authorized': False, 'tasks': tasks}))
        git(self.work, 'add', backlog_sync.CANONICAL_PATH); git(self.work, 'commit', '-qm', 'surplus recovery task')
        receipt = json.loads((self.runtime / 'autopilot-receipt.json').read_text())
        receipt['result_commit'] = git(self.work, 'rev-parse', 'HEAD')
        (self.runtime / 'autopilot-receipt.json').write_text(json.dumps(receipt))
        result = self.actual_push(env)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), before['_canonical_commit'])

    def fresh_source_admission_survives_independent_claim_at_publication_boundary(self):
        self.fixture(); q = self.q(); q['tasks'][0]['enabled'] = True
        self.update_canonical(q['tasks']); self.sync()
        before = self.q(); baseline = git(self.work, 'rev-parse', 'HEAD')
        entry, notice = self.prepare()
        recovery.reserve(self.runtime, entry['key'], baseline=before)
        self.planner(self.cfg, [notice], True, publish=False)
        receipt = json.loads((self.runtime / 'autopilot-receipt.json').read_text())
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), baseline)
        state = self.state(); backlog = (self.runtime/'backlog.json').read_bytes()
        failed = self.failed_path.read_bytes()
        original = backlog_sync.verify_dependency_rebindings
        def rebindings(*args):
            proofs = original(*args)
            runner.claim_task(before['tasks'][0])
            return proofs
        with mock.patch.object(backlog_sync, 'verify_dependency_rebindings', side_effect=rebindings):
            guard.publish_main(self.work, self.runtime,
                {'baseline': baseline, 'active_admission_only': True}, receipt)
        self.assertIn(self.web['id'], self.state()['active'])
        self.assertEqual(self.state()['active'][self.web['id']]['source'], self.web['source'])
        self.assertFalse((self.runtime / 'source-merge-reservation.json').exists())
        self.assertEqual(git(self.remote, 'rev-parse', 'main'), receipt['result_commit'])
        self.assertEqual(self.state()['history'], state['history'])
        self.assertEqual((self.runtime/'backlog.json').read_bytes(), backlog)
        self.assertEqual(self.failed_path.read_bytes(), failed)
        self.sync()
        self.assertEqual(recovery.validate_pair(self.entry(), before, self.q(), receipt, self.state()), receipt['task_ids'])
        self.assert_failed_downstream_held()


if __name__ == '__main__':
    suite = unittest.TestSuite(Repair01Checks(n) for n in dir(Repair01Checks) if n.startswith('fresh_'))
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
