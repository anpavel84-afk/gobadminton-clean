"""#248 R2: actual disposable Git and protected receipt chain; no network/model calls."""
import copy
import hashlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from test_actions_train_release_equivalence import GitFixture
from test_actions_train import A, S, TASK, core, stage, receiver, req, card
from test_actions_train_stages import Store
from test_actions_train_recovery import config, terminal
from test_actions_train_recovery_admission import child
from test_actions_train_failure_diagnosis import POLICY, brief
import content_identity as identity
import qa_equivalence as Q
import recovery as R
import recovery_admission as D
import failure_diagnosis as F

TEST = 'scripts/chatops/tests/test_example.py'
SOURCE = 'apps/api/src/sample.py'
WEBTEST = 'apps/web/test/example.test.ts'


class BoundedRepair(GitFixture):
    def setUp(self):
        super().setUp()
        self.write(TEST, 'VALUE = 1\n')
        self.write(SOURCE, 'VALUE = 0\n')
        self.base = self.commit('base')
        self.serial = 0

    def reviewed(self, files=None):
        self.git('reset', '--hard', self.base)
        for p, value in (files or {}).items(): self.write(p, value)
        self.write('docs/handoffs/origin.md', 'implementation evidence\n')
        self.original = self.commit('reviewed implementation')
        self.serial += 1
        self.state = self.root / f'protected-{self.serial}'
        self.state.mkdir(mode=0o700)
        works = self.root / f'worktrees-{self.serial}'; works.mkdir()
        task = copy.deepcopy(TASK)
        task.update(allowed_paths=[SOURCE, WEBTEST], failure_diagnosis=copy.deepcopy(POLICY))
        self.active = dict(issue=248, task=task, fingerprint='immutable-admission',
            comment={'id': 1, 'fingerprint': 'unchanged-comment'}, approved_since='fixed',
            head=self.original, base=self.base, phase='qa', attempt=1, qa=None, ci=None)
        self.store = Store(self.active)
        self.bridge = A.Bridge(SimpleNamespace(repo=self.repo, state_dir=self.state,
            worktrees_root=works), self.store)
        self.bridge.work = self.repo
        (works/'issue-248').symlink_to(self.repo, target_is_directory=True)
        self.bridge.model = Mock(return_value=dict(verdict='PASS', findings=[], reviewed_sha=self.original))
        self.bridge.review(self.active)
        self.origin = Q.name(self.active)
        self.original_raw = (self.state / self.origin).read_bytes()
        self.bridge.model.reset_mock()
        return self.original

    def candidate(self, path=TEST, value='VALUE = 2\n', attempt=3):
        self.write(path, value)
        head = self.commit('candidate')
        self.active.update(head=head, phase='pr_wait', attempt=attempt, integration=1,
            qa=None, qa_origin=self.origin, qa_equivalence=None, ci=None)
        self.bridge.model.return_value = dict(verdict='PASS', findings=[], reviewed_sha=head)
        return head

    def trusted(self, active, slot):
        core.need(slot == 'slot1', 'wrong protected fixture slot')
        receiver.protected_qa_inputs(active, self.state, os.getuid())
        return Q.verify(self.bridge, active)

    def defer(self):
        self.reviewed({WEBTEST:'export const VALUE=1;\n'})
        self.candidate(WEBTEST, 'export const VALUE=2;\n')
        self.assertTrue(self.bridge.try_reuse_qa(self.active))
        self.active.update(phase='ci', ci_failure=dict(head=self.active['head'], run=900,
            run_attempt=1, failed=[dict(job='source', steps=['unit'])]),
            history=[dict(attempt=i, head=self.original, base=self.base,
                qa=dict(verdict='FAIL', findings=['previous failure'], reviewed_sha=self.original)) for i in (1, 2)])
        self.before = copy.deepcopy(self.active)
        self.snapshot_raw = json.dumps(self.before, sort_keys=True).encode()
        self.context = (A, S, SimpleNamespace(release_lease=Mock()), Mock(), self.store, self.bridge)
        self.bridge.stopped_writer = Mock()
        self.bridge.routing_receipts = []
        request = req('author', 'ci') | dict(issue=248, head=self.active['head'], attempt=3)
        with patch.object(stage, 'setup', return_value=self.context), patch.object(
                stage, 'perform', side_effect=core.Refused('attempts exhausted')):
            result = stage.entry(request, {})
        self.assertTrue(result['safe_release'])
        self.assertIsNone(self.store.data['active'])
        self.entry = core.loads((self.state / 'actions-deferred.json').read_bytes())['entries'][-1]
        self.c = config(self.entry)
        return result

    def enroll(self, entry=None, slot='slot1', verification=True):
        j = R.empty(); entry = self.entry if entry is None else entry
        key = receiver.enroll_deferral(j, entry, slot, {'active': entry['snapshot']}, 248,
            self.c, verification=self.trusted if verification else None)
        return j, key

    def test_loader_reference_aliases_require_addressed_review(self):
        loaders = (
            'reader = open\nVALUE = reader("'+TEST+'").read()\n',
            'from runpy import run_path as load\nVALUE=load("'+TEST+'")["VALUE"]\n',
            'import runpy as rp\nload=rp.run_path\nVALUE=load("'+TEST+'")["VALUE"]\n',
            'from pathlib import Path\nreader=Path("'+TEST+'").read_text\nVALUE=reader()\n',
            'from io import open as reader\nVALUE=reader("'+TEST+'").read()\n',
            'from os import system as reader\nreader("python '+TEST+'")\n',
            'import helper\nVALUE=helper.compute()\n',
            'import external_bootstrap\nVALUE=0\n',
            '@loader\ndef value(): return 0\n',
            'reader=__builtins__["open"]\nVALUE=reader("'+TEST+'").read()\n',
        )
        for text in loaders:
            with self.subTest(text=text):
                self.reviewed({SOURCE:text});self.candidate(attempt=2)
                projection=identity.equivalence(self.repo,self.original,self.active['head'])
                self.assertFalse(projection['reusable'])
                self.assertFalse(self.bridge.try_reuse_qa(self.active))
                self.bridge.model.assert_not_called()
                self.assertEqual((self.state/self.origin).read_bytes(),self.original_raw)

    def test_non_object_proof_is_local_blocked_recovery_not_uncaught_exception(self):
        self.defer()
        path=self.state/self.entry['snapshot']['qa_equivalence'];original=path.read_bytes()
        try:
            for value in ([],None,True,1,'foreign',{},dict(schema='GB_QA_EQUIVALENCE_V1',origin=[])):
                with self.subTest(value=value):
                    path.write_text(json.dumps(value))
                    cache,key=self.enroll()
                    self.assertIsNone(key)
                    self.assertIn(core.digest(self.entry),cache['blocked'])
                    self.assertEqual(cache['receipts'],{})
                    self.assertEqual(self.entry['snapshot'],self.before)
        finally:path.write_bytes(original)
        cache,key=self.enroll();self.assertIsNotNone(key)

    def test_real_imported_VALUE_refuses_reuse_and_calls_addressed_bridge_QA(self):
        self.reviewed({SOURCE: 'from scripts.chatops.tests.test_example import VALUE\n'})
        self.candidate(attempt=2)
        projection = identity.equivalence(self.repo, self.original, self.active['head'])
        self.assertFalse(projection['reusable']); self.assertIn(TEST, projection['reason'])
        self.assertFalse(self.bridge.try_reuse_qa(self.active))
        self.bridge.model.assert_not_called()
        self.bridge.unchanged_issue = Mock(); self.bridge.candidate_identity = Mock()
        head = self.active['head']
        api = SimpleNamespace(pages=lambda *_: [dict(number=248,
            head=dict(sha=head, repo={'id': core.REPO_ID}), base=dict(repo={'id':core.REPO_ID}, ref='dev'))])
        rt = SimpleNamespace(lease=Mock(), publish=Mock(), budget=Mock())
        request = req('qa', 'pr_wait') | dict(issue=248, head=head, attempt=2)
        with patch.object(stage, 'run_result', return_value={'sha':head}), patch.object(
                stage, 'route', return_value={'provider':'codex'}):
            result=stage.perform(request, {}, (A,S,rt,api,self.store,self.bridge))
        self.assertIn(TEST,result['qa_reuse_refusal'])
        self.bridge.model.assert_called_once()
        self.assertIn('Independent QA in a NEW session', self.bridge.model.call_args.args[0])
        self.assertNotIn('TEST DELTA QA', self.bridge.model.call_args.args[0])
        self.assertEqual(self.active['qa']['reviewed_sha'], head)
        self.assertEqual((self.state/self.origin).read_bytes(), self.original_raw)

    def test_python_alias_relative_package_transitive_and_dynamic_negatives(self):
        cases = [
            {SOURCE: 'import scripts.chatops.tests.test_example as alias\nVALUE=alias.VALUE\n'},
            {SOURCE: 'from scripts.chatops.tests.test_example import VALUE as alias\n'},
            {SOURCE: 'from scripts.chatops.tests import VALUE\n',
                'scripts/chatops/tests/__init__.py': 'from .test_example import VALUE\n'},
            {SOURCE: 'from scripts.chatops.tests.test_helper import VALUE\n',
                'scripts/chatops/tests/test_helper.py': 'from .test_example import VALUE\n'},
            {SOURCE: 'import importlib\nVALUE=importlib.import_module("scripts.chatops.tests.test_example").VALUE\n'},
            {SOURCE: 'from importlib import import_module as load\nVALUE=load("scripts.chatops.tests.test_example").VALUE\n'},
            {SOURCE: 'import importlib as i\nload=i.import_module\nVALUE=load(target).VALUE\n'},
            {SOURCE: 'VALUE=__import__(target).VALUE\n'},
            {SOURCE: 'from importlib.util import spec_from_file_location as s\ns("x", "'+TEST+'")\n'},
            {SOURCE: 'from importlib.machinery import SourceFileLoader as L\nL("x", "'+TEST+'")\n'},
            {SOURCE: 'import sys\nsys.path.insert(0, root)\nimport test_example\n'},
        ]
        for files in cases:
            with self.subTest(source=files[SOURCE]):
                self.reviewed(files); self.candidate()
                proof = identity.equivalence(self.repo, self.original, self.active['head'])
                self.assertFalse(proof['reusable']); self.assertTrue(proof['reason'])
                self.assertFalse(self.bridge.try_reuse_qa(self.active))
                self.bridge.model.assert_not_called()

    def test_js_alias_dynamic_package_and_build_negatives(self):
        test = 'apps/web/test/example.test.ts'
        cases = [
            {'apps/web/main.ts': "import {VALUE} from './test/example.test';\n"},
            {'apps/web/main.ts': "export {VALUE} from './helper';\n",
                'apps/web/helper.ts': "export * from './test/example.test';\n"},
            {'apps/web/main.ts': "const a=require('./test/example.test');\n"},
            {'apps/web/main.ts': "import('./test/example.test');\n"},
            {'apps/web/main.ts': 'import(target);\n'},
            {'apps/web/main.ts': "import {VALUE} from '@/test/example.test';\n",
                'apps/web/tsconfig.json': json.dumps({'compilerOptions': {'baseUrl':'.','paths':{'@/*':['*']}}})},
            {'apps/web/main.ts': "import {VALUE} from '#unknown';\n"},
            {'apps/web/main.ts': "import {VALUE} from 'local-package';\n",
                'apps/web/package.json': json.dumps({'name':'local-package', 'exports': './test/example.test.ts'})},
            {'package.json': json.dumps({'scripts': {'build':'esbuild apps/web/test/*.ts'}})},
            {'build.json': json.dumps({'entryPoints':[test]})},
            {'start.sh': 'python scripts/chatops/tests/test_helper.py\n',
                'scripts/chatops/tests/test_helper.py': 'from .test_example import VALUE\n'},
            {'package.json':json.dumps({'scripts':{'latest-build':'esbuild apps/web/test/*.ts'}})},
        ]
        for files in cases:
            with self.subTest(files=files):
                self.reviewed(files | {test:'export const VALUE=1;\n'})
                self.candidate(test, 'export const VALUE=2;\n')
                proof = identity.equivalence(self.repo, self.original, self.active['head'])
                self.assertFalse(proof['reusable']); self.assertTrue(proof['reason'])
                self.assertFalse(self.bridge.try_reuse_qa(self.active))

    def test_isolated_test_and_noemit_discovery_positive_batch_and_equal_revert(self):
        self.reviewed({'pyproject.toml':'[tool.pytest.ini_options]\ntestpaths=["scripts/chatops/tests"]\n',
            'package.json': json.dumps({'scripts':{'test':'pytest scripts/chatops/tests/test_*.py',
            'typecheck':'tsc --noEmit'}}), 'apps/web/tsconfig.json':json.dumps(
                {'compilerOptions':{'noEmit':True}, 'include':['test/**/*.ts']})})
        self.candidate()
        with patch.object(identity, 'git', wraps=identity.git) as git:
            proof = identity.equivalence(self.repo, self.original, self.active['head'])
        self.assertTrue(proof['reusable'], proof['reason'])
        self.assertEqual(sum(c.args[1] == 'cat-file' for c in git.call_args_list), 2)
        self.assertTrue(self.bridge.try_reuse_qa(self.active))
        self.assertEqual(self.bridge.saved_qa(self.active)['status'], 'VERIFIED')
        self.assertEqual(self.active['qa']['reviewed_sha'], self.original)
        self.assertIn('TEST DELTA QA', self.bridge.model.call_args.args[0])
        self.write(SOURCE, 'import importlib\nimportlib.import_module(target)\n'); self.commit('runtime changed')
        self.write(SOURCE, 'VALUE = 0\n'); self.write(TEST, 'VALUE = 1\n'); head=self.commit('endpoint restored')
        with patch.object(identity, 'independence', side_effect=AssertionError('equal endpoint needs no scan')):
            self.assertTrue(identity.equivalence(self.repo, self.original, head)['reusable'])
        self.assertFalse(identity.classify(identity.tree(self.repo,self.original),
            identity.tree(self.repo,self.active['head']))['reusable'])

    def test_parse_binary_oversize_uncertainty_declines_locally(self):
        for data in ('invalid Python (', 'VALUE=1\0', '#' * 262145):
            with self.subTest(data=data[:20]):
                self.reviewed({SOURCE:data}); self.candidate()
                proof=identity.equivalence(self.repo,self.original,self.active['head'])
                self.assertFalse(proof['reusable']);self.assertTrue(proof['reason'])

    def test_full_pass_reuse_terminal_deferral_enrollment_diagnosis_successor_chain(self):
        self.defer()
        self.assertEqual(json.dumps(self.entry['snapshot'],sort_keys=True).encode(), self.snapshot_raw)
        self.assertEqual((self.state/self.origin).read_bytes(),self.original_raw)
        self.assertEqual(self.entry['snapshot']['qa']['reviewed_sha'],self.original)
        j,key=self.enroll();self.assertIsNotNone(key)
        f=j['receipts'][key]['frozen']
        self.assertEqual(f['snapshot'],self.before)
        self.assertEqual(f['qa_evidence'],self.entry['qa_evidence'])
        self.assertEqual(f['attempt'],3)
        evidence=[dict(head=f['head'],run=900,run_attempt=1,job=42,
            log=dict(sha256='a'*64,excerpt='AssertionError Expected: 2 Received: 0'))]
        request=req('diagnose','ci')|dict(issue=248,head=f['head'],attempt=3)
        self.bridge.unchanged_issue=Mock();self.bridge.clean=Mock()
        self.bridge.model.return_value=brief()|dict(paths=[SOURCE],evidence=['ci:0'])
        api=Mock();self.context=(A,S,self.context[2],api,self.store,self.bridge)
        # Stage's fixed-layout worktree selection points at the actual disposable repo.
        with patch.object(R,'ci_evidence',return_value=evidence):
            _,reserved=R.reserve(j,request,self.c,verification=self.trusted)
            self.assertIn('qa_evidence',next(iter(reserved['failure_diagnosis']['receipts'].values()))['inputs'])
            with self.assertRaises(core.Refused):R.reserve(j,request,self.c,verification=self.trusted)
            value=R.perform(request|{'_recovery_data':reserved},self.c,self.context)
            self.assertEqual(self.bridge.model.call_count,2)  # test delta + one diagnosis
            r=R.finish(j,key,'diagnose',value,self.c)
        self.assertEqual(r['status'],'task_review_ready')
        R.reserve(j,request|{'stage':'task_review'},self.c,verification=self.trusted)
        review=dict(verdict='PASS',findings=[],receipt_hash=core.digest(f),
            proposed_task_hash=core.digest(r['proposal']),evidence_hash=core.digest(r['diagnosis']['evidence']),
            diagnosis_hash=core.digest(r['diagnosis']['result']))
        r=R.finish(j,key,'task_review',dict(status='confirmed',outcome=review),self.c)
        self.assertEqual(r['counts'],dict(diagnose=1,task_review=1,successor=1))
        i=child(r);api.return_value=i;api.pages.return_value=[i]
        with patch.object(D,'parent_unchanged'):
            cert=D.root_admission(A,api,j,i,self.c,verification=self.trusted)
            successor=D.claim(A,api,self.store,cert,self.c)
        self.assertIsNone(successor['qa'])
        self.assertNotIn('qa_origin',successor);self.assertNotIn('qa_equivalence',successor)
        self.assertEqual(successor['parent_qa_provenance'],dict(receipt=key,evidence=f['qa_evidence']))
        self.assertEqual(successor['attempt'],0);self.assertEqual(f['snapshot']['attempt'],3)
        self.assertEqual(f['snapshot']['history'],self.before['history'])
        self.assertEqual((self.state/self.origin).read_bytes(),self.original_raw)

    def test_enrollment_requires_callback_current_terminal_CI_and_unchanged_snapshot(self):
        self.defer()
        j,key=self.enroll(verification=False);self.assertIsNone(key);self.assertTrue(j['blocked'])
        j,key=self.enroll(slot='slot2');self.assertIsNone(key)
        for mutate in (lambda a:a['qa'].update(verdict='FAIL',findings=['source defect']),
                       lambda a:a['qa'].update(findings=['PASS findings forbidden']),
                       lambda a:a['ci_failure'].update(head=self.original),
                       lambda a:a.update(ci_failure=None), lambda a:a.update(phase='qa'),
                       lambda a:a.update(attempt=2)):
            entry=copy.deepcopy(self.entry);mutate(entry['snapshot'])
            j,key=self.enroll(entry);self.assertIsNone(key)
        for fake in (True, {'verified':True}):
            j=R.empty()
            self.assertIsNone(R.enroll(j,self.entry,'slot1',self.c,future=True,verification=fake))
        with self.assertRaises(core.Refused):receiver.enroll_deferral(R.empty(),self.entry,'slot1',
            {'active':dict(self.before,attempt=2)},248,self.c,verification=self.trusted)

    def test_tampered_missing_wrong_task_base_rules_and_delta_proofs_rejected(self):
        self.defer();proofpath=self.state/self.before['qa_equivalence'];good=proofpath.read_bytes()
        proof=json.loads(good)
        for mutate in (lambda p:p['origin']['binding'].update(issue=99),
                       lambda p:p['origin']['binding']['task'].update(goal='forged'),
                       lambda p:p['origin']['binding']['admission'].update(fingerprint='forged'),
                       lambda p:p['origin']['binding'].update(rules_sha256='f'*64),
                       lambda p:p['projection']['base_projection'].update(candidate=self.original),
                       lambda p:p['projection'].update(candidate=self.original),
                       lambda p:p.update(delta=None)):
            forged=copy.deepcopy(proof);mutate(forged);proofpath.write_text(json.dumps(forged))
            j,key=self.enroll();self.assertIsNone(key)
        proofpath.write_bytes(good)
        for filename in ('other.json','../'+proofpath.name,'qa-248-a3-i2.json.equivalence.json'):
            bad=copy.deepcopy(self.entry);bad['snapshot']['qa_equivalence']=filename
            j,key=self.enroll(bad);self.assertIsNone(key)
        proofpath.unlink();j,key=self.enroll();self.assertIsNone(key)
        proofpath.symlink_to(self.state/self.origin);j,key=self.enroll();self.assertIsNone(key)
        proofpath.unlink();proofpath.write_bytes(good)
        delta=self.state/proof['delta']['receipt'];raw=delta.read_bytes()
        for value in (dict(verdict='FAIL',findings=['weakened test'],reviewed_sha=self.before['head']),
                      dict(verdict='PASS',findings=[],reviewed_sha=self.original)):
            delta.write_text(json.dumps(value));j,key=self.enroll();self.assertIsNone(key)
        delta.unlink();j,key=self.enroll();self.assertIsNone(key);delta.write_bytes(raw)
        origin=self.state/self.origin;origin.write_text('{}')
        j,key=self.enroll();self.assertIsNone(key);origin.write_bytes(self.original_raw)
        oid=self.git('rev-parse',self.original+':'+SOURCE)
        (self.repo/'.git/objects'/oid[:2]/oid[2:]).unlink()
        j,key=self.enroll();self.assertIsNone(key)

    def test_drift_after_enrollment_refuses_reserve_and_other_root_proceeds(self):
        self.defer();j,key=self.enroll()
        proof=self.state/self.before['qa_equivalence'];proof.write_text('{}')
        request=req('diagnose','ci')|dict(issue=248,head=self.before['head'],attempt=3)
        with self.assertRaises((core.Refused,KeyError)):R.reserve(j,request,self.c,verification=self.trusted)
        self.assertEqual(j['receipts'][key]['counts']['diagnose'],0)
        other=terminal(178)
        otherkey=R.enroll(j,other,'slot2',self.c,future=True)
        self.assertIsNotNone(otherkey)
        R.reserve(j,req('diagnose','qa')|dict(slot='slot2',issue=178,attempt=3),self.c)
        self.assertEqual(j['receipts'][otherkey]['counts']['diagnose'],1)

    def test_proof_drift_before_and_during_model_and_cached_brief_binding(self):
        self.defer(); j,key=self.enroll();f=j['receipts'][key]['frozen']
        request=req('diagnose','ci')|dict(issue=248,head=f['head'],attempt=3)
        evidence=[dict(head=f['head'],log=dict(excerpt='AssertionError Expected: 2 Received: 0'))]
        self.bridge.unchanged_issue=Mock();self.bridge.clean=Mock();self.bridge.model.reset_mock()
        proofpath=self.state/self.before['qa_equivalence'];good=proofpath.read_bytes()
        with patch.object(R,'ci_evidence',return_value=evidence):
            _,reserved=R.reserve(j,request,self.c,verification=self.trusted)
            proofpath.write_bytes(good+b' ')
            with self.assertRaises(core.Refused):
                R.perform(request|{'_recovery_data':reserved},self.c,self.context)
            self.bridge.model.assert_not_called()
            self.assertEqual(j['receipts'][key]['counts']['diagnose'],1)
            self.assertEqual(j['receipts'][key]['status'],'diagnose_pending')
            proofpath.write_bytes(good)
            def drift(*args,**kwargs):
                proofpath.write_bytes(good+b' ')
                return brief()|dict(paths=[SOURCE],evidence=['ci:0'])
            self.bridge.model.side_effect=drift
            with self.assertRaises(core.Refused):
                R.perform(request|{'_recovery_data':reserved},self.c,self.context)
            self.bridge.model.assert_called_once()
            with self.assertRaises(core.Refused):R.reserve(j,request,self.c,verification=self.trusted)
            proofpath.write_bytes(good)
            active=copy.deepcopy(self.before); active['attempt']=2
            # The proof filename must track this ordinary (nonterminal) attempt.
            old=active['qa_equivalence'];active['qa_equivalence']=Q.name(active)+'.equivalence.json'
            proofpath=self.state/active['qa_equivalence']
            proof=json.loads(good)
            delta=proof['delta'];newdelta=Q.name(active)+'.delta.json'
            (self.state/newdelta).write_bytes((self.state/delta['receipt']).read_bytes())
            proof['delta']['receipt']=newdelta
            proofpath.write_text(json.dumps(proof));ordinary=proofpath.read_bytes()
            qa=Q.verify(self.bridge,active);value=F.inputs(active,Mock(),qa_evidence=qa)
            outcome=brief()|dict(paths=[SOURCE],evidence=['ci:0'])
            cache,cached=F.reservation(active,value)
            cache['receipts'][core.digest(value)].update(status='ready',brief=outcome,brief_hash=core.digest(outcome))
            active['failure_diagnosis']=cache
            self.assertEqual(F.repair(active,Mock(),qa_evidence=Q.verify(self.bridge,active))['failure_fingerprint'],core.digest(value))
            proofpath.write_bytes(ordinary+b' ')
            with self.assertRaises(core.Refused):F.repair(active,Mock(),qa_evidence=Q.verify(self.bridge,active))
            self.assertNotEqual(value,F.inputs(active,Mock(),qa_evidence=Q.verify(self.bridge,active)))

    def test_runtime_import_cannot_be_authorized_by_forged_serialized_projection(self):
        self.reviewed({SOURCE:'from scripts.chatops.tests.test_example import VALUE\n'})
        self.candidate()
        # Forge only DATA: real verify must recompute dependencies and refuse.
        a=self.active;projection=dict(original=self.original,candidate=a['head'],reusable=True,tests=[])
        meta=core.loads((self.state/(self.origin+'.origin.json')).read_bytes())
        path=self.state/(Q.name(a)+'.equivalence.json')
        path.write_text(json.dumps(dict(schema='GB_QA_EQUIVALENCE_V1',origin=meta,
            projection=projection,delta=None,obligations=['exact_candidate_CI','integration','DEV_acceptance'])))
        a.update(qa=dict(verdict='PASS',findings=[],reviewed_sha=self.original),qa_equivalence=path.name)
        with self.assertRaises(core.Refused):self.bridge.saved_qa(a)



class LegacyIdentity(unittest.TestCase):
    def test_legacy_exact_frozen_serialization_unchanged(self):
        for verdict in ('FAIL','PASS'):
            entry=terminal();a=entry['snapshot']
            if verdict=='PASS':a.update(phase='ci',qa=dict(verdict='PASS',findings=[],reviewed_sha=a['head']),
                ci_failure=dict(head=a['head'],run=1,run_attempt=1))
            c=config(entry);p=c['recovery']
            expected=dict(schema=R.SCHEMA,deployment=p['deployment'],slot='slot1',issue=a['issue'],
                lineage=[149,177],root=149,task_hash=core.digest(a['task']),head=a['head'],base=a['base'],
                attempt=3,source_sha=p['source_sha'],source_base=p['base_sha'],archive_hash=core.digest(entry),
                snapshot=copy.deepcopy(a))
            actual=R.frozen(entry,'slot1',c)
            self.assertEqual(actual,expected);self.assertEqual(core.digest(actual),core.digest(expected))
            self.assertNotIn('qa_evidence',actual)
            if verdict == 'PASS':
                a['ci_failure']['head']='f'*40
                with self.assertRaises(core.Refused):R.frozen(entry,'slot1',c)
