"""Addressed lineage/reconciliation simulations, no runtime reads or model calls."""
import copy
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import core
from test_actions_train_addressed_analysis import grant
import antigravity_qa_recovery as Q
import native_antigravity as N


def descriptor(g=None):
    g=g or grant()
    return dict(issue=29,base=g['base'],head=g['head'],work=str(N.QUALIFICATION_WORK),
        adapter_revision=g['controller_revision'],qualification_grant=g,
        task_sha256=core.digest(N.qualification_task(g['base'],g['head'],adapter_revision=g['controller_revision'],qualification_grant=g)))


class Grants(unittest.TestCase):
    def test_exact_nonrenewable_closed_grant_and_old_parser_stays_closed(self):
        g=grant();Q.validate_addressed_grant(g)
        for patching in (dict(ceiling=2),dict(ceiling=True),dict(owner_comment=True),dict(lineage='other'),
                         dict(controller_revision=Q.INSTALLED_BASELINE),dict(role='author'),dict(timeout=3600),
                         dict(input_sha256='0'*64),dict(input_revision='f'*40),dict(unknown=1)):
            with self.subTest(patching=patching),self.assertRaises(core.Refused):
                Q.validate_addressed_grant(g|patching)
        with self.assertRaises(core.Refused):Q.validate_grant(g)
        self.assertEqual(Q.reservation_path(Path('/state'),descriptor()).name,
            'antigravity-29-addressed-'+descriptor()['task_sha256']+'.json')
    def test_max4_across_candidates_no_per_grant_replay_even_unknown(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);gs=[grant()|dict(head=str(i)*40,input_revision=str(i)*40) for i in range(1,5)]
            # Same exact INERT material; each candidate is separately root-reviewed.
            ledger=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,ceiling=4,used_calls=0,
                        grants={core.digest(g):dict(grant=g,operation=None) for g in gs})
            saved={root/Q.ADDRESSED_LEDGER:ledger,root/'slot2.json':{},root/Q.ADDRESSED_RECONCILIATION:
                   dict(phase='complete',third_operation_sha256=Q.THIRD_DIGEST)}
            writes=[]
            def atomic(path,v):saved[path]=copy.deepcopy(v);writes.append(path)
            api=SimpleNamespace(STATE=root,read=lambda p,*a:copy.deepcopy(saved[p]),atomic=atomic)
            with patch.object(Q,'addressed_history'):
                for n,g in enumerate(gs):
                    q=descriptor(g);Q.reserve_addressed(api,q,hex(n+1)[2:]*64)
                    self.assertEqual(saved[root/Q.ADDRESSED_LEDGER]['used_calls'],n+1)
                    with self.assertRaises(core.Refused):Q.reserve_addressed(api,q,'f'*64)
            self.assertTrue(all(p==root/Q.ADDRESSED_LEDGER for p in writes))
            extra=grant()|dict(head='f'*40,input_revision='f'*40)
            ledger=saved[root/Q.ADDRESSED_LEDGER]
            ledger['grants'][core.digest(extra)]=dict(grant=extra,operation=None)
            with self.assertRaises(core.Refused):Q.addressed_ledger(ledger)
    def test_immutable_input_hash_and_qa_receipt_source_binding(self):
        raw=Path(Q.ANALYSIS_INPUT).read_bytes();g=grant()
        with patch.object(N,'git',side_effect=[g['head'].encode(),raw]):
            self.assertEqual(Q.addressed_input('/candidate',g),raw.decode())
        with patch.object(N,'git',side_effect=[g['head'].encode(),raw+b' ']):
            with self.assertRaises(core.Refused):Q.addressed_input('/candidate',g)
        receipt=dict(schema='GB_AGY_29_QA_TEST_CONTRACT_V1',source_sha=g['head'],requirements='Exact acceptance',
                     checks=[dict(command='python3 -m unittest focused',exit_code=0,output_sha256='a'*64,source_sha=g['head'])])
        raw=json.dumps(receipt).encode()
        g=g|dict(role='independent_qa',input_path='scripts/chatops/tests/fixtures/agy-reviewed-tests.json',
                 input_revision='f'*40,input_sha256=__import__('hashlib').sha256(raw).hexdigest())
        with patch.object(N,'git',side_effect=[g['head'].encode(),raw]):Q.addressed_input('/candidate',g)
        receipt['checks'][0]['source_sha']='0'*40;raw=json.dumps(receipt).encode()
        g['input_sha256']=__import__('hashlib').sha256(raw).hexdigest()
        with patch.object(N,'git',side_effect=[g['head'].encode(),raw]):
            with self.assertRaises(core.Refused):Q.addressed_input('/candidate',g)


class SchedulingReconciliation(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.op=dict(result=dict(status='unknown',safe_release=False),immutable='fac7')
        self.j=dict(pending=Q.THIRD_OPERATION,generation=87,operations={Q.THIRD_OPERATION:self.op},last={'status':'unknown'})
        self.saved={};self.writes=[]
        def atomic(path,value):
            self.writes.append((path,copy.deepcopy(value)));self.saved[path]=copy.deepcopy(value);path.touch()
            if path==self.root/'slot2.json':self.j=copy.deepcopy(value)
        self.api=SimpleNamespace(STATE=self.root,POLICY=self.root/'policy',AUTONOMY=self.root,
            read=lambda path,*a:dict(mode='disabled') if path.name=='policy' else copy.deepcopy(self.saved[path]),
            atomic=atomic,journal=lambda slot:copy.deepcopy(self.j),checkpoint=lambda slot:({'active':None,'done':[]},[]),
            identity=Mock(return_value=None),alive=Mock(return_value=False),units_quiet=Mock(),free_lock=Mock())
        self.patches=[patch.object(Q,'addressed_history'),patch.object(Q,'executor_quiet'),
            patch.object(Q.os,'geteuid',return_value=0),patch.object(Q,'digest',side_effect=lambda v:Q.CHECKPOINT if v=={'active':None,'done':[]} else core.digest(v))]
        for p in self.patches:p.start();self.addCleanup(p.stop)
    def test_only_scheduling_pending_generation_change_and_original_unknown_preserved(self):
        before=copy.deepcopy(self.j)
        out=Q.reconcile_addressed(self.api)
        self.assertEqual(out['phase'],'complete');self.assertIsNone(self.j['pending']);self.assertEqual(self.j['generation'],88)
        self.assertEqual(self.j['operations'],before['operations']);self.assertEqual(self.j['last'],before['last'])
        self.assertEqual(self.writes[0][1]['phase'],'intent')
        count=len(self.writes);Q.reconcile_addressed(self.api);self.assertEqual(len(self.writes),count)
        self.assertTrue(all(p.name in (Q.ADDRESSED_RECONCILIATION,'slot2.json') for p,v in self.writes))
    def test_live_reused_process_generation_or_checkpoint_refuses_without_writes(self):
        for change in ('live','reused','generation','checkpoint'):
            self.j['generation']=87;self.api.identity.return_value=None;self.api.alive.return_value=False
            self.api.checkpoint=lambda slot:({'active':None,'done':[]},[])
            if change=='live':self.api.alive.return_value=True
            elif change=='reused':self.api.identity.return_value=dict(pid=Q.THIRD_PROCESS['pid'],start='other')
            elif change=='generation':self.j['generation']=88
            else:self.api.checkpoint=lambda slot:({'active':{'unknown':'writer'},'done':[]},[])
            with self.subTest(change=change),self.assertRaises(core.Refused):Q.reconcile_addressed(self.api)
            self.assertEqual(self.writes,[])
    def test_writeahead_reentry_finishes_only_exact_scheduling_effect(self):
        original=self.api.atomic
        def fail_after_intent(path,v):
            original(path,v)
            if path.name==Q.ADDRESSED_RECONCILIATION and v['phase']=='intent':raise OSError('lost after intent')
        self.api.atomic=fail_after_intent
        with self.assertRaises(OSError):Q.reconcile_addressed(self.api)
        self.assertEqual(self.j['pending'],Q.THIRD_OPERATION)
        self.api.atomic=original;Q.reconcile_addressed(self.api)
        self.assertIsNone(self.j['pending']);self.assertEqual(self.j['operations'][Q.THIRD_OPERATION],self.op)

class AddressedScopedCharge(unittest.TestCase):
    def setUp(self):
        from test_actions_train_antigravity_one_shot import ScopedCharge
        self.old=ScopedCharge();self.old.setUp();self.addCleanup(self.old.doCleanups)
        self.q=descriptor();self.req=dict(self.old.req,_qa_qualification=self.q,
            _task_hash=self.q['task_sha256'],head=self.q['head'],_qa_addressed_grant=self.q['qualification_grant'])
        self.req['_qa_grant_operation']=core.digest(core.binding({k:v for k,v in self.req.items() if not k.startswith('_')}))
    def charge(self):return Q.charge_grant(self.q,self.req,self.old.budget,self.old.root,self.old.S)
    def test_only_exact_reserved_grant_can_charge_once_with_caps_unchanged(self):
        raw=self.old.limits.read_bytes();self.charge()
        self.assertEqual(self.old.budget.used('agy','qa','slot2'),3)
        self.assertEqual(self.old.limits.read_bytes(),raw)
        with self.assertRaises(FileExistsError):self.charge()
        with self.assertRaises(self.old.S.Hold):self.old.budget.charge('slot2','agy','qa')
    def test_failure_after_intent_never_replays_or_refunds(self):
        with patch.object(self.old.S.Budget,'charge',side_effect=OSError('uncertain ledger write')):
            with self.assertRaises(OSError):self.charge()
        with self.assertRaises(FileExistsError):self.charge()
    def test_foreign_role_slot_stage_hash_certificate_rejected_before_charge(self):
        for field,value in [('slot','slot1'),('stage','qa'),('issue',230),('_qa_addressed_grant',{}),('_task_hash','f'*64)]:
            with patch.dict(self.req,{field:value}),self.subTest(field=field),self.assertRaises(core.Refused):self.charge()
        self.assertEqual(self.old.budget.used('agy','qa','slot2'),2)
