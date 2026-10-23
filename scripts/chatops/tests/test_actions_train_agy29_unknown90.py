"""No-model test of one exact protected UNKNOWN occupancy transition.

Synthetic root files only. Production state/credentials/locks are never touched.
"""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve()
OPS=HERE.parents[1]/'ops'/'reconcile_agy29_unknown90.py'
if not OPS.is_file():  # Standalone offline fixture before publishing the PR.
    OPS=HERE.with_name('reconcile_agy29_unknown90.py')
S=importlib.util.spec_from_file_location('agy29_reconcile_unknown90',str(OPS))
U=importlib.util.module_from_spec(S);S.loader.exec_module(U)


class Receiver:
    def __init__(self, root, checkpoint, *, crash_at=None):
        self.root=root
        self.POLICY=root/'policy.json'
        self.checkpoint_value=checkpoint
        self.calls=[]
        self.crash_at=crash_at
    def read(self, path, owner=0, limit=2097152):
        return json.loads(Path(path).read_text())
    def checkpoint(self, slot):
        assert slot=='slot2'
        return copy.deepcopy(self.checkpoint_value), []
    def alive(self, proc):return False
    def identity(self,pid):return None
    def no_models(self,uid,slot):self.calls.append(('no_models',uid,slot))
    def units_quiet(self, names):self.calls.append(('units_quiet', tuple(names)))
    def free_lock(self,path):self.calls.append(('free_lock',str(path)))
    def trusted_tree(self,path):self.calls.append(('trusted_tree',str(path)))
    def atomic(self,path, obj, mode=0o600):
        path=Path(path);self.calls.append(('atomic',path.name))
        if self.crash_at==path.name or (isinstance(self.crash_at, tuple)
                and self.crash_at==(path.name, obj.get('phase'))):
            self.crash_at=None
            raise OSError('synthetic crash before atomic')
        # Test only writes into its own tempfile; no host/application runtime paths.
        assert str(path).startswith(str(self.root))
        path.write_text(json.dumps(obj,sort_keys=True))


class OneExactUnknown(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='agy-reconcile-unit-')
        self.addCleanup(self.tmp.cleanup)
        root=Path(self.tmp.name);self.root=root
        self.ck={'active':None,'done':[152,205,216]}
        self.e=dict(U.EXPECTED)
        self.e.update(operation='a'*64,operation_sha256='b'*64,
                      task_sha256='c'*64,controller='d'*40,
                      head='e'*40,pid=999999999,pid_start='55',boot='boot-test',
                      slot_before_sha256='0'*64,checkpoint_sha256=U.digest(self.ck))
        self.binding=dict(action='train',attempt=0,generation=90,head=self.e['head'],
                          issue=29,phase='idle',profile='agy',slot='slot2',stage='qa_qualification')
        self.op=dict(binding=self.binding,process=dict(pid=self.e['pid'],start=self.e['pid_start'],
                     boot=self.e['boot']),run=self.e['run'],run_attempt=1,
                     task_hash=self.e['task_sha256'], before=self.e['checkpoint_sha256'],
                     after=self.e['checkpoint_sha256'], checkpoint_before=self.ck,
                     result=dict(status='unknown',safe_release=False,reason='AGY_PRECHECK_FAILED',
                                 adapter_error=dict(code='AGY_PRECHECK_FAILED',
                                     evidence_id=self.e['evidence_id'],phase='preflight')))
        self.j=dict(pending=self.e['operation'],generation=90,operations={self.e['operation']:self.op},
                    done=[152,205,216],stage_counts={'qa':19})
        self.e['operation_sha256']=U.digest(self.op)
        self.raw=U.encoded(self.j)
        self.e['slot_before_sha256']=U.sha(self.raw)
        self.ledger={'schema':'one','ceiling':4,'used_calls':2,
                     'grants':{'f'*64:{'grant':{'role':'independent_qa','head':self.e['head']},
                                      'operation':self.e['operation']}}}
        self.lraw=U.encoded(self.ledger);self.e['ledger_sha256']=U.sha(self.lraw)
        self.reservation={'operation':self.e['operation'],'task_hash':self.e['task_sha256'],
                          'result':{'status':'unknown','safe_release':False}}
        self.rraw=U.encoded(self.reservation);self.e['reservation_sha256']=U.sha(self.rraw)
        self.phase=dict(phase='preflight',error_code='AGY_PRECHECK_FAILED',
                        status='unknown',charge_state='not_charged',input_sha256=None)
        self.e['terminal_evidence_sha256']=U.sha(U.encoded(self.phase))
        self.marker=dict(phase='canary',schema='GB_ANTIGRAVITY_QA_29_V1')
        self.policy=dict(controller_sha=self.e['controller'],mode='active')
        self.r=Receiver(root,self.ck)
        self.patchers=[
            patch.object(U,'EXPECTED',self.e),
            patch.object(U,'STATE',root),
            patch.object(U,'BEFORE',root/'slot2.json'),
            patch.object(U,'LEDGER',root/'ledger.json'),
            patch.object(U,'RESERVATION',root/'reservation.json'),
            patch.object(U,'PHASE',root/'phase.json'),
            patch.object(U,'MARKER',root/'marker.json'),
            patch.object(U,'RECEIPT',root/'reconcile.json'),
            patch.object(U,'AUTONOMY',root/'fake_autonomy'),
            patch.object(U,'executor_quiet',lambda:None),
            patch.object(U.os,'geteuid',return_value=0),
        ]
        for p in self.patchers:p.start();self.addCleanup(p.stop)
        (root/'controller.lock').touch()
        self.putfiles()
    def putfiles(self):
        paths=[(U.BEFORE,self.j),(U.LEDGER,self.ledger),(U.RESERVATION,self.reservation),
               (U.PHASE,self.phase),(U.MARKER,self.marker),(self.r.POLICY,self.policy)]
        for p,value in paths:p.write_bytes(U.encoded(value))
    def valid(self,**overrides):
        data=dict(raw=U.BEFORE.read_bytes(),j=self.j,checkpoint=self.ck,ledger=self.ledger,
                  ledger_raw=U.LEDGER.read_bytes(),reservation=self.reservation,
                  reservation_raw=U.RESERVATION.read_bytes(),terminal=self.phase,
                  terminal_raw=U.PHASE.read_bytes(),
                  marker=self.marker,policy=self.policy,process_exists=False,process_alive=False)
        data.update(overrides)
        return U.validate_preflight(**data)

    def test_closed_preflight_changes_only_occupancy(self):
        after=self.valid()
        self.assertIsNone(after['pending']);self.assertEqual(after['generation'],91)
        self.assertEqual(after['operations'],self.j['operations'])
        self.assertEqual(after['stage_counts'],self.j['stage_counts'])
        self.assertEqual(self.j['pending'],self.e['operation'])

    def test_false_proofs_rejected_not_rewritten(self):
        changes=[
          ('wrong slot hash',{'raw':b'garbage'}),
          ('wrong operation',{'j':{**self.j,'operations':{self.e['operation']:{**self.op,'run':0}}}}),
          ('changed checkpoint',{'checkpoint':{'active':{'issue':29},'done':[]}}),
          ('process still alive',{'process_exists':True}),
          ('provider started',{'terminal':{**self.phase,'charge_state':'charged'}}),
          ('evidence tampered',{'terminal_raw':b'{}'}),
          ('input delivered',{'terminal':{**self.phase,'input_sha256':'f'*64}}),
          ('budget changed',{'ledger':{**self.ledger,'used_calls':1}}),
          ('marker not canary',{'marker':{'phase':'ready','schema':self.marker['schema']}}),
          ('controller changed',{'policy':{**self.policy,'controller_sha':'x'*40}}),
          ('historical safety verdict',{'j':{**self.j,'pending':None}}),
        ]
        for name,delta in changes:
            with self.subTest(name=name),self.assertRaises(Exception):
                self.valid(**delta)
        self.assertEqual(json.loads(U.BEFORE.read_text()),self.j)
        self.assertFalse(U.RECEIPT.exists())

    def test_apply_needs_pre_disabled_policy(self):
        with self.assertRaises(Exception):U.execute('apply',self.r)
        self.assertEqual(self.r.read(U.BEFORE),self.j)
        self.assertFalse(U.RECEIPT.exists())

    def test_dry_run_no_writes_even_if_active(self):
        result=U.execute('dry-run',self.r)
        self.assertEqual(result['status'],'READY_FOR_DISABLED_BOUNDARY')
        self.assertEqual(result['write_performed'],False)
        self.assertEqual(self.r.read(U.BEFORE),self.j)
        self.assertFalse(U.RECEIPT.exists())

    def test_success_is_exact_and_idempotent(self):
        self.policy['mode']='disabled';self.putfiles()
        result=U.execute('apply',self.r)
        self.assertEqual(result['status'],'COMPLETE')
        new=self.r.read(U.BEFORE)
        self.assertEqual(new,U.change_only_occupancy(self.j))
        self.assertEqual(self.r.read(U.LEDGER),self.ledger)
        self.assertEqual(self.r.read(U.RESERVATION),self.reservation)
        self.assertEqual(new['operations'],self.j['operations'])
        self.assertEqual(self.r.read(U.RECEIPT)['phase'],'complete')
        before=U.BEFORE.read_bytes()
        result=U.execute('apply',self.r)
        self.assertEqual(result['status'],'ALREADY_COMPLETE')
        self.assertEqual(U.BEFORE.read_bytes(),before)

    def test_crash_after_intent_recovers_same_operation(self):
        self.policy['mode']='disabled';self.putfiles()
        self.r.crash_at='slot2.json'
        with self.assertRaises(OSError):U.execute('apply',self.r)
        self.assertEqual(self.r.read(U.BEFORE),self.j)
        self.assertEqual(self.r.read(U.RECEIPT)['phase'],'intent')
        result=U.execute('apply',self.r)
        self.assertEqual(result['status'],'COMPLETE')
        self.assertEqual(self.r.read(U.BEFORE),U.change_only_occupancy(self.j))

    def test_crash_after_slot_before_complete_receipt_is_recoverable(self):
        self.policy['mode']='disabled';self.putfiles()
        self.r.crash_at=('reconcile.json','complete')
        with self.assertRaises(OSError):U.execute('apply',self.r)
        self.assertEqual(self.r.read(U.BEFORE),U.change_only_occupancy(self.j))
        self.assertEqual(self.r.read(U.RECEIPT)['phase'],'intent')
        result=U.execute('apply',self.r)
        self.assertEqual(result['status'],'COMPLETE')
        self.assertEqual(self.r.read(U.RECEIPT)['phase'],'complete')
        self.assertEqual(self.r.read(U.LEDGER),self.ledger)
        self.assertEqual(self.r.read(U.RESERVATION),self.reservation)

    def test_pending_receipt_does_not_recover_if_checkpoint_changed(self):
        self.policy['mode']='disabled';self.putfiles()
        self.r.crash_at=('reconcile.json','complete')
        with self.assertRaises(OSError):U.execute('apply',self.r)
        self.r.checkpoint_value={'active':{'issue':999},'done':[]}
        with self.assertRaises(Exception):U.execute('apply',self.r)
        self.assertEqual(self.r.read(U.RECEIPT)['phase'],'intent')

    def test_reused_process_or_busy_lock_refuses(self):
        self.policy['mode']='disabled';self.putfiles()
        self.r.identity=lambda pid:{'pid':pid,'start':'reused','boot':'different'}
        with self.assertRaises(Exception):U.execute('apply',self.r)
        self.assertFalse(U.RECEIPT.exists())


if __name__=='__main__':unittest.main()

[executed on device: vmi3510488 (1a468667-a6be-443b-80d7-8c20ff9228ff)]