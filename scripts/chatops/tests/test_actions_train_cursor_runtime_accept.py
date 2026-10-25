"""Offline synthetic runtime acceptance: real file hashes/writes, no host state or clients."""
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core, receiver as R, S
from test_actions_train_cursor_successor import U, TASK, EXPECTED
import native_cursor as N


class RuntimeAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.state = self.base/'state'; self.state.mkdir()
        self.bundle = self.base/'bundle'; self.bundle.mkdir()
        self.install = self.base/'install'; self.install.mkdir()
        self.marker = self.base/'marker.json'
        self.journal = self.state/'upgrade.json'
        self.policy = self.base/'policy.json'
        self.task_hash = core.digest(TASK)
        self.receipt = dict(schema='GB_CURSOR_AUTHOR_RECEIPT_V1',phase='imported',issue=225,
                            task_sha256=self.task_hash,source_head='a'*40)
        author = {'binding':{'issue':225,'stage':'author'},'task_hash':self.task_hash,
                  'run':101,'finished_at':100,
                  'result':{'status':'confirmed','routing':{'provider':'cursor','effective_model':'Auto',
                            'usage':{'charged_calls':1},'native_receipt':self.receipt}}}
        qa = {'binding':{'issue':225,'stage':'qa'},'task_hash':self.task_hash,'finished_at':200,
              'result':{'status':'confirmed','checkpoint':{'qa':{'verdict':'FAIL','reason':'NaN coverage'}}}}
        self.ops = {'slot1':{},'slot2':{'author':author,'qa-fail':qa}}
        self.product = self.base/'deferred-225.json'
        self.product.write_text(json.dumps({'issue':225,'phase':'deferred','qa':{'verdict':'FAIL'},'attempt':1}))
        self.product_before = self.product.read_bytes()
        self.evidence = {}
        for key,(name,_) in U.RUNTIME_EVIDENCE.items():
            path = self.state/name; path.parent.mkdir(parents=True,exist_ok=True)
            data = json.dumps(self.receipt).encode() if key=='author_receipt' else ('synthetic '+key).encode()
            path.write_bytes(data)
            self.evidence[key] = (name,hashlib.sha256(data).hexdigest())
        for name in U.RUNTIME_MODULES:
            (self.install/name).write_bytes((ROOT/'scripts/chatops/actions_train'/name).read_bytes())
        self.proof_path = self.bundle/U.QUALIFICATION_PROOF
        self.proof_path.parent.mkdir(parents=True)
        self.proof = {'schema':'GB_CURSOR_RUNTIME_QUALIFICATION_PROOF_V1',
                      'acceptance_basis':'runtime_qualification','canary_task_sha256':self.task_hash,
                      'evidence':{k:{'path':str(self.state/name),'sha256':sha}
                                  for k,(name,sha) in self.evidence.items()}}
        self.proof_path.write_text(json.dumps(self.proof))
        self.proof_sha = hashlib.sha256(self.proof_path.read_bytes()).hexdigest()
        marker = {'schema':'GB_CURSOR_AUTHOR_211_V1','phase':'canary','slots':['slot1','slot2'],
                  'canary_task_sha256':self.task_hash,'successor':EXPECTED,'modules':dict(U.RUNTIME_MODULES)}
        self.old = copy.deepcopy(marker)
        journal = {'phase':'active-canary','controller':'c'*40,'canary_task_sha256':self.task_hash,
                   'successor':EXPECTED,'manifest':'m','stage_sha256':'s','dispatch_sha256':'d',
                   'historical_fail':{'issue':211,'attempt':1,'status':'FAIL'},
                   'changes':{str(self.marker):{'before':'historic-before','after':U.encoded_hash(marker)}}}
        for path,value in ((self.marker,marker),(self.journal,journal),
                           (self.policy,{'mode':'active','controller_sha':'c'*40})):
            R.atomic(path,value)
        self.real_atomic = R.atomic
        self.writes = []
        self.fail_at = None; self.fail_before = False
        self.bad_owner_inode = None
        real_fstat = os.fstat

        def metadata(fd):
            actual = real_fstat(fd)
            # Only ownership is virtualized: ordinary tests cannot chown to root.
            return SimpleNamespace(st_uid=999 if actual.st_ino==self.bad_owner_inode else 0,
                                   st_mode=actual.st_mode,st_nlink=actual.st_nlink)

        def read(path,*args):
            self.assertIn(path,(self.marker,self.journal,self.policy))
            return json.loads(path.read_text())

        def write(path,value,**kwargs):
            self.assertIn(path,(self.marker,self.journal))
            self.writes.append(path)
            if len(self.writes)==self.fail_at and self.fail_before: raise OSError('crash before write')
            self.real_atomic(path,value,**kwargs)
            if len(self.writes)==self.fail_at and not self.fail_before: raise OSError('crash after write')

        patches = [patch.object(U,'STATE',self.state),patch.object(U,'JOURNAL',self.journal),
                   patch.object(U,'INSTALL',self.install),patch.object(U,'MARKER',self.marker),
                   patch.object(U,'RUNTIME_EVIDENCE',self.evidence),patch.object(R,'POLICY',self.policy),
                   patch.object(R,'read',side_effect=read),patch.object(R,'atomic',side_effect=write),
                   patch.object(R,'journal',side_effect=lambda slot:{'operations':copy.deepcopy(self.ops[slot])}),
                   patch.object(R,'checkpoint',side_effect=AssertionError('product checkpoint must not be needed')),
                   patch.object(R,'publish_monitor'),patch.object(U.os,'fstat',side_effect=metadata),
                   patch.object(U.time,'time',return_value=300),
                   patch('subprocess.run',side_effect=AssertionError('no commands/network/models')),
                   patch('subprocess.Popen',side_effect=AssertionError('no model process'))]
        for p in patches:
            p.start(); self.addCleanup(p.stop)

    def call(self,**kwargs):
        return U.accept_runtime(self.bundle,proof_sha256=self.proof_sha,**kwargs)

    def change(self,path,**changes):
        value=json.loads(path.read_text()); value.update(changes); self.real_atomic(path,value)

    def snapshot(self):
        return {str(p):p.read_bytes() for p in self.base.rglob('*') if p.is_file()}

    def refused_without_write(self,regex=None):
        before=self.snapshot(); count=len(self.writes)
        with self.assertRaisesRegex(core.Refused,regex or '.'):
            self.call()
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

    def test_success_preserves_failed_product_history_and_records_exact_evidence(self):
        ops=copy.deepcopy(self.ops)
        result=self.call()
        self.assertEqual(result['phase'],'active-ready')
        m=json.loads(self.marker.read_text()); j=json.loads(self.journal.read_text())
        self.assertEqual(m['phase'],'ready'); self.assertEqual(j['phase'],'active-ready')
        self.assertEqual(m['accepted_canary']['acceptance_basis'],'runtime_qualification')
        self.assertEqual(m['accepted_canary']['qualification_proof_sha256'],self.proof_sha)
        self.assertEqual(m['accepted_canary']['evidence'],self.proof['evidence'])
        intent=j['qualification_intent']
        self.assertEqual(intent['old_marker'],self.old)
        self.assertEqual(intent['old_hash'],U.encoded_hash(self.old))
        self.assertEqual(intent['next_hash'],U.encoded_hash(m))
        self.assertEqual(intent['operations'],{'author':core.digest(ops['slot2']['author'])})
        self.assertEqual(self.writes,[self.journal,self.marker,self.journal])
        self.assertEqual(j['historical_fail'],{'issue':211,'attempt':1,'status':'FAIL'})
        self.assertEqual(self.product.read_bytes(),self.product_before); self.assertEqual(self.ops,ops)
        before=self.snapshot(); count=len(self.writes); self.call()
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

    def test_dry_run_verifies_everything_and_writes_nothing(self):
        before=self.snapshot()
        result=U.accept_runtime(self.bundle,dry_run=True)
        self.assertTrue(result['dry_run']); self.assertEqual(result['would_change']['marker_phase'],'ready')
        self.assertEqual(result['accepted_canary']['qualification_proof_sha256'],self.proof_sha)
        self.assertEqual(self.snapshot(),before); self.assertEqual(self.writes,[])
        (self.state/self.evidence['probe'][0]).write_bytes(b'changed')
        with self.assertRaisesRegex(core.Refused,'sha256 mismatch'):
            U.accept_runtime(self.bundle,dry_run=True)
        self.assertEqual(self.writes,[])

    def test_apply_requires_reviewed_dry_run_hash(self):
        with self.assertRaisesRegex(core.Refused,'requires --proof-sha256'):
            U.accept_runtime(self.bundle)
        self.assertEqual(self.writes,[])

    def test_proof_changed_between_dry_run_and_apply(self):
        result=U.accept_runtime(self.bundle,dry_run=True)
        self.proof_path.write_bytes(self.proof_path.read_bytes()+b'\n')
        self.assertEqual(result['accepted_canary']['qualification_proof_sha256'],self.proof_sha)
        self.refused_without_write('proof sha256 changed')

    def test_wrong_journal_phase(self):
        self.change(self.journal,phase='installed-disabled'); self.refused_without_write('active-canary')

    def test_marker_not_canary(self):
        self.change(self.marker,phase='ready'); self.refused_without_write('identity')

    def test_task_hash_drift(self):
        self.change(self.marker,canary_task_sha256='b'*64); self.refused_without_write('identity')

    def test_controller_or_policy_drift(self):
        self.change(self.policy,controller_sha='d'*40); self.refused_without_write('identity')
        self.change(self.policy,controller_sha='c'*40,mode='disabled'); self.refused_without_write('identity')

    def test_successor_drift(self):
        self.change(self.marker,successor={}); self.refused_without_write('identity')

    def test_module_pin_drift(self):
        (self.install/'native_guard.py').write_bytes(b'changed')
        self.refused_without_write('adapter drift')

    def test_other_installed_code_pin_drift(self):
        installed=self.install/'stage.py'; installed.write_bytes(b'changed')
        j=json.loads(self.journal.read_text())
        j['changes'][str(installed)]={'before':'old','after':'reviewed'}
        self.real_atomic(self.journal,j); self.refused_without_write('installed code drift')

    def test_missing_module_pin(self):
        self.change(self.marker,modules={}); self.refused_without_write('module pins')

    def test_missing_author(self):
        del self.ops['slot2']['author']; self.refused_without_write('one confirmed')

    def test_unconfirmed_author(self):
        self.ops['slot2']['author']['result']['status']='unknown'; self.refused_without_write('one confirmed')

    def test_two_authors_across_or_within_slots(self):
        author=copy.deepcopy(self.ops['slot2']['author'])
        for slot in ('slot1','slot2'):
            with self.subTest(slot=slot):
                self.ops[slot]['extra']=author; self.refused_without_write('one confirmed')
                del self.ops[slot]['extra']

    def test_author_charged_calls_must_be_exact_integer_one(self):
        for calls in (0,2,None,True):
            with self.subTest(calls=calls):
                self.ops['slot2']['author']['result']['routing']['usage']['charged_calls']=calls
                self.refused_without_write('executor')

    def test_author_native_receipt_not_imported(self):
        self.ops['slot2']['author']['result']['routing']['native_receipt']['phase']='validated'
        self.refused_without_write('executor')

    def test_author_provider_or_model_drift(self):
        route=self.ops['slot2']['author']['result']['routing']
        route['provider']='codex'; self.refused_without_write('executor')
        route['provider']='cursor'; route['effective_model']='other'; self.refused_without_write('executor')

    def test_author_receipt_must_match_pinned_native_file(self):
        self.ops['slot2']['author']['result']['routing']['native_receipt']['source_head']='b'*40
        self.refused_without_write('operation evidence changed')

    def test_author_must_precede_qa_dev_outcomes(self):
        self.ops['slot2']['author']['finished_at']=201; self.refused_without_write('precede')

    def test_outcome_is_required_but_not_a_pass(self):
        del self.ops['slot2']['qa-fail']; self.refused_without_write('precede')

    def test_foreign_marker_drift(self):
        self.change(self.marker,foreign=True); self.refused_without_write('foreign qualification marker')

    def test_marker_byte_drift_even_with_equal_json_is_refused(self):
        self.marker.write_bytes(self.marker.read_bytes()+b'\n')
        self.refused_without_write('foreign qualification marker')

    def test_evidence_missing(self):
        (self.state/self.evidence['probe'][0]).unlink(); self.refused_without_write('missing or unsafe')

    def test_evidence_sha_mismatch(self):
        (self.state/self.evidence['probe'][0]).write_bytes(b'changed'); self.refused_without_write('sha256 mismatch')

    def test_evidence_symlink(self):
        p=self.state/self.evidence['probe'][0]; target=self.base/'target'; target.write_bytes(p.read_bytes())
        p.unlink(); p.symlink_to(target); self.refused_without_write('missing or unsafe')

    def test_evidence_parent_symlink(self):
        parent=self.state/'cursor-qualification-20261022'; target=self.state/'moved'
        parent.rename(target); parent.symlink_to(target,target_is_directory=True)
        self.refused_without_write('missing or unsafe')

    def test_evidence_wrong_owner(self):
        self.bad_owner_inode=(self.state/self.evidence['probe'][0]).stat().st_ino
        self.refused_without_write('untrusted runtime evidence metadata')

    def test_proof_unsafe_metadata_or_symlink_refused(self):
        self.bad_owner_inode=self.proof_path.stat().st_ino
        self.refused_without_write('untrusted runtime evidence metadata')
        self.bad_owner_inode=None
        target=self.base/'proof-copy'; target.write_bytes(self.proof_path.read_bytes())
        self.proof_path.unlink(); self.proof_path.symlink_to(target)
        self.refused_without_write('missing or unsafe')

    def test_evidence_group_writable_or_hardlink_refused(self):
        p=self.state/self.evidence['probe'][0]; p.chmod(0o660)
        self.refused_without_write('untrusted runtime evidence metadata')
        p.chmod(0o600); os.link(p,self.base/'alias')
        self.refused_without_write('invalid runtime evidence file')

    def test_strict_proof_refuses_extra_missing_duplicate_or_rewritten_pins(self):
        original=copy.deepcopy(self.proof)
        for kind in ('extra','missing','pin','duplicate','task'):
            with self.subTest(kind=kind):
                proof=copy.deepcopy(original)
                if kind=='extra': proof['pass']=True
                if kind=='missing': del proof['evidence']['runtime_qa_v20_qa']
                if kind=='pin': proof['evidence']['probe']['sha256']='f'*64
                if kind=='task': proof['canary_task_sha256']='f'*64
                raw=json.dumps(proof)
                if kind=='duplicate': raw=raw[:-1]+',"schema":"duplicate"}'
                self.proof_path.write_text(raw)
                self.proof_sha=hashlib.sha256(self.proof_path.read_bytes()).hexdigest()
                self.refused_without_write()

    def test_crash_replay_before_and_after_each_write(self):
        initial=self.snapshot()
        for index in (1,2,3):
            for before in (False,True):
                with self.subTest(index=index,before=before):
                    for name,raw in initial.items(): Path(name).write_bytes(raw)
                    self.writes.clear(); self.fail_at=index; self.fail_before=before
                    with self.assertRaises(OSError): self.call()
                    if index==2 and before:
                        self.assertEqual(json.loads(self.journal.read_text())['phase'],'qualifying-ready')
                        self.assertEqual(json.loads(self.marker.read_text())['phase'],'canary')
                    self.fail_at=None; self.call()
                    self.assertEqual(json.loads(self.journal.read_text())['phase'],'active-ready')
                    self.assertEqual(json.loads(self.marker.read_text())['phase'],'ready')
                    snapshot=self.snapshot(); count=len(self.writes); self.call()
                    self.assertEqual(snapshot,self.snapshot()); self.assertEqual(count,len(self.writes))

    def interrupt_before_marker(self):
        self.fail_at=2; self.fail_before=True
        with self.assertRaises(OSError): self.call()
        self.fail_at=None

    def test_replay_refuses_changed_operation_proof_evidence_or_foreign_marker(self):
        self.interrupt_before_marker(); baseline=self.snapshot(); ops=copy.deepcopy(self.ops)
        for kind in ('operation','extra-author','proof','evidence','marker','intent'):
            with self.subTest(kind=kind):
                for name,raw in baseline.items(): Path(name).write_bytes(raw)
                self.ops=copy.deepcopy(ops)
                if kind=='operation': self.ops['slot2']['author']['run']=102
                if kind=='extra-author': self.ops['slot1']['extra']=copy.deepcopy(ops['slot2']['author'])
                if kind=='proof': self.proof_path.write_bytes(self.proof_path.read_bytes()+b'\n')
                if kind=='evidence': (self.state/self.evidence['probe'][0]).write_bytes(b'changed')
                if kind=='marker': self.change(self.marker,foreign=True)
                if kind=='intent':
                    j=json.loads(self.journal.read_text()); j['qualification_intent']['old_hash']='0'*64
                    self.real_atomic(self.journal,j)
                self.refused_without_write()

    def test_dry_run_of_pending_intent_never_completes_effects(self):
        self.interrupt_before_marker(); before=self.snapshot(); count=len(self.writes)
        self.call(dry_run=True)
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

    def test_dry_run_refuses_old_marker_after_completed_qualification(self):
        self.call(); self.real_atomic(self.marker,self.old)
        before=self.snapshot(); count=len(self.writes)
        with self.assertRaisesRegex(core.Refused,'completed qualification marker changed'):
            self.call(dry_run=True)
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

    def test_monitor_failure_after_ready_does_not_repeat_effects(self):
        with patch.object(R,'publish_monitor',side_effect=OSError('monitor unavailable')):
            with self.assertRaises(OSError): self.call()
        self.assertEqual(json.loads(self.journal.read_text())['phase'],'active-ready')
        before=self.snapshot(); count=len(self.writes); self.call()
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

    def test_execute_requires_root_and_exact_existing_bundle_identity(self):
        args=('accept-runtime',self.bundle,'m','c'*40,'s','d')
        with patch.object(U.os,'geteuid',return_value=1002),patch.object(R,'trusted_tree'):
            with self.assertRaisesRegex(core.Refused,'root integrator'): U.execute(*args,dry_run=True)
        with patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree') as tree:
            for index,value in ((2,'other-manifest'),(3,'x'*40),(4,'other-stage'),(5,'other-dispatch')):
                altered=list(args); altered[index]=value
                with self.assertRaisesRegex(core.Refused,'unreviewed acceptance'): U.execute(*altered,dry_run=True)
            result=U.execute(*args,dry_run=True)
            self.assertTrue(result['dry_run']); tree.assert_called_with(self.bundle)
        self.assertEqual(self.writes,[])

    def test_main_uses_controller_lock_and_accept_runtime_options(self):
        args=['upgrade','accept-runtime','--bundle',str(self.bundle),'--manifest','m',
              '--controller','c'*40,'--stage-hash','s','--dispatch-hash','d','--dry-run']
        lock_fd=os.open(self.base/'lock',os.O_CREAT | os.O_RDWR,0o600)
        with patch.object(U.sys,'argv',args),patch.object(R,'locked',return_value=lock_fd) as lock, \
             patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'), \
             patch('sys.stdout',new_callable=io.StringIO) as out:
            U.main(); result=json.loads(out.getvalue())
        lock.assert_called_once_with(self.state/'controller.lock'); self.assertTrue(result['dry_run'])
        self.assertEqual(self.writes,[])

    def test_rollback_replays_and_preserves_qualification_intent_and_history(self):
        self.call(); accepted=json.loads(self.journal.read_text())['qualification_intent']
        self.change(self.policy,mode='disabled')
        C=SimpleNamespace(quiet=Mock())
        self.writes.clear(); self.fail_at=2; self.fail_before=True
        with self.assertRaises(OSError): U.rollback_runtime(C)
        self.assertEqual(json.loads(self.journal.read_text())['phase'],'reverting-canary')
        self.fail_at=None; result=U.rollback_runtime(C)
        self.assertEqual(result['phase'],'active-canary'); self.assertEqual(json.loads(self.marker.read_text()),self.old)
        j=json.loads(self.journal.read_text())
        self.assertEqual(j['qualification_history'][0]['intent'],accepted)
        self.assertEqual(j['changes'][str(self.marker)]['after'],U.encoded_hash(self.old))
        self.assertEqual(self.product.read_bytes(),self.product_before)
        before=self.snapshot(); count=len(self.writes); U.rollback_runtime(C)
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)
        self.change(self.policy,mode='active'); self.call()
        self.assertEqual(len(json.loads(self.journal.read_text())['qualification_history']),1)

    def test_rollback_refuses_foreign_marker_or_active_policy(self):
        self.call(); C=SimpleNamespace(quiet=Mock())
        with self.assertRaisesRegex(core.Refused,'rollback identity'): U.rollback_runtime(C)
        self.change(self.policy,mode='disabled'); self.change(self.marker,foreign=True)
        with self.assertRaisesRegex(core.Refused,'foreign runtime rollback'): U.rollback_runtime(C)

    def test_existing_accept_still_requires_product_pass_ci_live_dev(self):
        before=self.snapshot()
        for phase in ('deferred','done'):
            with self.subTest(phase=phase):
                active={'issue':225,'phase':phase,'task':TASK,'attempt':1,'head':'a'*40,
                        'qa':{'verdict':'FAIL','reviewed_sha':'a'*40}}
                with patch.object(R,'checkpoint',return_value=({'active':active},[])):
                    with self.assertRaises(core.Refused): U.accept_canary()
                self.assertEqual(self.snapshot(),before); self.assertEqual(self.writes,[])

    def test_ready_qualifies_different_task_through_existing_core_route(self):
        task={'work_kind':'implementation','risk':'routine','author_routes':['cursor:auto'],
              'qa_routes':['codex:gpt-6.1-sol:medium'],
              'routing_policy':{'schema':'GB_STAGE_COST_V2',
                  'author':{'complexity':'standard','reason':'standard_ui','evidence':'Synthetic ordinary task'},
                  'qa':{'complexity':'standard','reason':'standard_ui','evidence':'Synthetic independent QA'}}}
        task_hash=core.digest(task); self.assertNotEqual(task_hash,self.task_hash)
        budget=SimpleNamespace(remaining=lambda *a:3,used=lambda *a:1)
        real_sha=N.hashlib.sha256
        def native_read(path,*args):
            if path==N.MARKER: return self.marker.read_bytes()
            self.assertIn(path.name,N.PIN_HASHES)
            return ('synthetic-pin:'+path.name).encode()
        def sha(data=b''):
            if data.startswith(b'synthetic-pin:'):
                return SimpleNamespace(hexdigest=lambda:N.PIN_HASHES[data.decode().split(':')[1]])
            return real_sha(data)
        with patch.object(N,'_read',side_effect=native_read),patch.object(N.hashlib,'sha256',side_effect=sha):
            with self.assertRaisesRegex(core.Refused,'restricted to reviewed'): N.qualification('slot2',task_hash)
            self.call()
            self.assertEqual(N.qualification('slot2',task_hash)['phase'],'ready')
            choice=core.route(S,task,'author','auto',budget,'slot2')
            self.assertEqual(choice['provider'],'cursor'); self.assertEqual(choice['effective_model'],'Auto')
            self.assertEqual(choice['requested_route'],'cursor:auto'); self.assertEqual(choice['policy'],'GB_STAGE_COST_V2')


class CommittedProof(unittest.TestCase):
    def test_committed_proof_has_exact_production_pins_and_closed_schema(self):
        proof=json.loads((ROOT/U.QUALIFICATION_PROOF).read_text())
        self.assertEqual(proof,{'schema':'GB_CURSOR_RUNTIME_QUALIFICATION_PROOF_V1',
            'acceptance_basis':'runtime_qualification','canary_task_sha256':core.digest(TASK),
            'evidence':{k:{'path':str(U.STATE/name),'sha256':sha} for k,(name,sha) in U.RUNTIME_EVIDENCE.items()}})
        self.assertEqual(len(proof['evidence']),12)
        for name,sha in U.RUNTIME_MODULES.items():
            self.assertEqual(hashlib.sha256((ROOT/'scripts/chatops/actions_train'/name).read_bytes()).hexdigest(),sha)


if __name__=='__main__': unittest.main()
