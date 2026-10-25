"""Repair brief #218 regressions, including actual source protocol behavior."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock,patch
from test_actions_train import core,A,S,stage,HEAD,BASE,TASK,req,ROOT
from test_actions_train_team_upgrade import U,proof
import test_actions_train_cost_policy as C
import failure_diagnosis as F


class FailureClassification(unittest.TestCase):
    def active(self,phase='qa'):
        return dict(issue=230,task=TASK|dict(failure_diagnosis=dict(schema=F.SCHEMA,route=F.ROUTE,max_calls=3)),
            phase=phase,attempt=1,base=BASE,head=HEAD,qa=dict(verdict='FAIL',reviewed_sha=HEAD,
            findings=['AssertionError: timeout cleanup fails to release product reservation; network.error path']))
    def test_qa_timeout_network_defect_reaches_astra_not_source_repair(self):
        a=self.active();self.assertEqual(F.inputs(a,Mock())['failure']['kind'],'qa')
        with self.assertRaises(core.Refused):F.repair(a,Mock())
        for kind in ('environment','insufficient'):
            from test_actions_train_failure_diagnosis import brief
            value=F.inputs(a,Mock());b=brief()|dict(kind=kind)
            c=F.cache(a);key=core.digest(value)
            c['receipts'][key]=dict(status='blocked',input_hash=key,inputs=value,brief=b,brief_hash=core.digest(b))
            a[F.FIELD]=c
            with self.assertRaises(core.Refused):F.repair(a,Mock())
    def test_ci_source_assertion_with_infra_words_wrongsha_and_missing_logs(self):
        a=self.active('ci');a['ci_failure']=dict(head=HEAD)
        evidence=[dict(head=HEAD,log=dict(excerpt='network.error earlier; AssertionError: timeout cleanup fails'))]
        with patch('recovery.ci_evidence',return_value=evidence):self.assertEqual(F.inputs(a,Mock())['evidence'],evidence)
        for value in ([],[dict(head='f'*40,log={'excerpt':'AssertionError'})],
                      [dict(head=HEAD,log={'excerpt':'authentication quota exhausted'})]):
            with patch('recovery.ci_evidence',return_value=value),self.assertRaises(core.Refused):F.inputs(a,Mock())


class StageRoutes(unittest.TestCase):
    def test_task_review_codex_preflight_matches_invocation_ordinary_qa_still_agy(self):
        t=C.cost_task('complex','complex');t['routing_policy']['schema']='GB_STAGE_COST_V2'
        t['qa_routes']=['agy:claude-sonnet-5-5-high','codex:gpt-6.1-sol:high']
        b=Mock(remaining=lambda *a:10,used=lambda *a:0)
        with patch('native_antigravity.available',return_value=(True,'qualified')):
            self.assertEqual(core.route(S,t,'qa','auto',b,'slot2')['provider'],'agy')
            choice=core.task_review_route(S,t,b,'slot2')
        self.assertEqual(choice['provider'],'codex');self.assertEqual(choice['stage_role'],'task_review')
        self.assertEqual(choice['effective_model'],'gpt-6.1-sol')
        t['qa_routes']=t['qa_routes'][:1]
        with self.assertRaises(core.Refused):core.task_review_route(S,t,b,'slot2')
    def test_both_call_sites_share_stage_selector(self):
        # Structural contract plus selector behavior above; wrapper execution below.
        import inspect,receiver
        self.assertIn('task_review_route(',inspect.getsource(receiver.recovery_request))
        self.assertIn('task_review_route(',inspect.getsource(stage.setup))
    def test_four_hashes_remain_mandatory(self):
        import recovery as R
        r=dict(frozen={'task':'exact'},proposal={'new':'task'},diagnosis={'evidence':['bound'],'result':{'kind':'source_defect'}})
        value=dict(verdict='PASS',findings=[],receipt_hash=core.digest(r['frozen']),
            proposed_task_hash=core.digest(r['proposal']),evidence_hash=core.digest(r['diagnosis']['evidence']),
            diagnosis_hash=core.digest(r['diagnosis']['result']))
        R.review_result(r,value)
        for key in ('receipt_hash','proposed_task_hash','evidence_hash','diagnosis_hash'):
            with self.assertRaises(core.Refused):R.review_result(r,value|{key:'0'*64})
        with self.assertRaises(core.Refused):R.review_result(r,dict(verdict='PASS',findings=[],reviewed_sha=HEAD))


class PinnedPayload(unittest.TestCase):
    def test_actual_payload_behavior_under_offline_probe(self):
        task=json.loads((ROOT/'scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json').read_text())
        result=U.protocol_probe(ROOT,task)
        self.assertEqual(result,dict(admission=True,request=True,qa_fail=True,ci_fail=True,plan=True))
    def test_provenance_reads_all_manifest_blobs_and_rejects_old_payload_or_ref_only(self):
        import native_antigravity as N
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);wfdir=root/'.github/workflows';wfdir.mkdir(parents=True)
            src=root/'scripts/chatops/actions_train';src.mkdir(parents=True)
            (src/'core.py').write_text('actual reviewed implementation')
            manifest=dict(schema='GB_ACTIONS_TRAIN_INSTALL_V1',files={
                'scripts/chatops/actions_train/core.py':hashlib.sha256((src/'core.py').read_bytes()).hexdigest()})
            (src/'manifest.json').write_text(json.dumps(manifest))
            p=proof();p['manifest_sha256']=U.i.sha(src/'manifest.json')
            for name,key in [('train-stage.yml','stage_workflow_sha256'),('train-dispatch.yml','dispatch_workflow_sha256')]:
                text=('      - uses: actions/checkout@'+'f'*40+'\n        with:\n          ref: '+p['controller']+'\n')*2
                (wfdir/name).write_text(text);p[key]=U.i.sha(wfdir/name)
            seen=[];overrides={}
            def git(work,*args,**kw):
                seen.append(args)
                if args[0]=='rev-parse':return p['release_revision'].encode()
                if args[0]=='diff':return b'.github/workflows/train-stage.yml\n.github/workflows/train-dispatch.yml\n'
                revision,name=args[1].split(':',1)
                return overrides.get(name,(root/name).read_bytes())
            with patch.object(N,'git',side_effect=git):
                self.assertTrue(U.verify_release(root,p))
                self.assertIn(('show',p['controller']+':scripts/chatops/actions_train/core.py'),seen)
                overrides['scripts/chatops/actions_train/core.py']=b'old controller without #218'
                with self.assertRaisesRegex(core.Refused,'provenance'):U.verify_release(root,p)
                overrides.clear()
                (wfdir/'train-stage.yml').write_text('ref: '+p['controller']+'\nref: '+p['controller']+'\n')
                p['stage_workflow_sha256']=U.i.sha(wfdir/'train-stage.yml')
                with self.assertRaisesRegex(core.Refused,'four hosted'):U.verify_release(root,p)

class ActualTaskReviewWrapper(unittest.TestCase):
    def test_codex_only_wrapper_returns_review_contract_without_source_qa_parser(self):
        from types import SimpleNamespace
        import context_policy as Context
        import test_actions_train_context as CF
        task=C.cost_task('complex','complex');task['routing_policy']['schema']='GB_STAGE_COST_V2'
        task['qa_routes']=['agy:claude-sonnet-5-5-high','codex:gpt-6.1-sol:high']
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d);calls=[0];store=SimpleNamespace(data={'active':dict(task=task,head=HEAD,attempt=3)})
            layout=SimpleNamespace(repo=folder,state_dir=folder,worktrees=folder,outbox=folder)
            budget=SimpleNamespace(used=lambda *a:calls[0],remaining=lambda *a:10)
            rt=SimpleNamespace(user='test',legacy=True,home=folder,key=folder/'key',layout=layout,
                check_paths=Mock(),continuity=lambda:True,lease=Mock(),budget=budget)
            a=SimpleNamespace(RUNTIME_READS=(),Store=lambda *a:store,atomic=Mock(),subprocess=SimpleNamespace(Popen=Mock()))
            result=dict(verdict='PASS',findings=[],receipt_hash='a'*64,proposed_task_hash='b'*64,
                        evidence_hash='c'*64,diagnosis_hash='d'*64)
            def bridge(c,st):
                def model(prompt,qa=False):
                    self.assertTrue(qa);self.assertEqual((c.model,c.effort),('gpt-6.1-sol','high'))
                    self.assertIn('Role: qa.',prompt);calls[0]+=1;return result
                return SimpleNamespace(c=c,store=st,work=folder,git=Mock(),unchanged_issue=Mock(),model=model)
            a.Bridge=bridge
            s=SimpleNamespace(Runtime=lambda *a,**kw:rt,uid_of=lambda u:1002,Hold=RuntimeError,
                read_json=lambda *a,**kw:dict(mode='active',owned={'slot1':'existing'}),
                MODEL_ADAPTER=S.MODEL_ADAPTER,adapter_status=lambda *a:(True,'qualified'))
            with patch.object(stage,'live',return_value=(a,s)),patch.object(stage.os,'getuid',return_value=1002), \
                 patch.object(stage.os,'getgid',return_value=1002),patch.object(stage,'API',return_value=Mock()), \
                 patch.object(Context,'load',return_value=CF.accepted()),patch('receiver.units_quiet'), \
                 patch('native_antigravity.review',side_effect=AssertionError('source-QA wrapper forbidden')):
                b=stage.setup(req('task_review','qa'),{'codex':{'slot1':'/fake-codex'}})[-1]
                self.assertEqual(b.model('Task definition review; return four hashes',qa=True),result)
            self.assertEqual(b.routing_receipts[0]['provider'],'codex')
            self.assertEqual(b.routing_receipts[0]['stage_role'],'task_review')

class OldPayloadProbe(unittest.TestCase):
    def test_pins_alone_cannot_make_old_protocol_compatible(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/'scripts/chatops/actions_train';folder.mkdir(parents=True)
            (folder/'core.py').write_text('def live():\n    raise RuntimeError("old controller has no failure_diagnosis")\n')
            with self.assertRaisesRegex(core.Refused,'protocol probe failed'):U.protocol_probe(root,{})
