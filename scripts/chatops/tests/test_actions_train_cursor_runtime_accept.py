"""Offline synthetic runtime acceptance: real file hashes/writes, no host state or clients."""
import copy
from contextlib import contextmanager
from functools import cache
import errno
import random
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core, receiver as R, S
from test_actions_train_cursor_successor import U, TASK, EXPECTED
import native_cursor as N


MISSING = object()


@cache
def installed_runtime_modules():
    # KEEP installer/marker pins: acceptance fixtures model the installed
    # pre-change modules, not this candidate's guard awaiting Owner rebind.
    source = 'e8b4e4f7bcc1d6a31bf9bee3d2a8db956a98af14'
    return {name: subprocess.check_output(['git', 'show',
            source+':scripts/chatops/actions_train/'+name], cwd=ROOT)
            for name in U.RUNTIME_MODULES}


class RuntimeStat:
    """Override trust metadata while retaining every other real stat attribute."""
    def __init__(self, actual, uid, mode):
        self.actual = actual
        self.st_uid = uid
        self.st_mode = mode

    def __getattr__(self, name):
        return getattr(self.actual, name)


class TrustedRuntimeTree:
    """Root-owned fixture model for the real no-follow descriptor walker."""
    def __init__(self, base):
        self.base = base
        self.real_fstat = os.fstat
        self.foreign_owners = {}
        self.ancestors = {self.inode(p.lstat()) for p in base.parents}

    @staticmethod
    def inode(info):
        return info.st_dev, info.st_ino

    def fstat(self, fd):
        actual = self.real_fstat(fd)
        identity = self.inode(actual)
        # Recompute lazily: atomic replacements and files created after setUp
        # must belong to the fixture too. lstat/rglob do not follow symlinks.
        fixture = {self.inode(p.lstat()) for p in (self.base, *self.base.rglob('*'))}
        if identity in fixture:
            return RuntimeStat(actual, self.foreign_owners.get(identity, 0), actual.st_mode)
        if identity in self.ancestors:
            # The host's /tmp, home and TMPDIR chain stand in for a trusted
            # system chain, independently of runner uid or real ancestor modes.
            # Only external ancestors lose write bits; fixture modes stay real.
            return RuntimeStat(actual, 0, actual.st_mode & ~0o022)
        return actual


class RuntimeAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Public immutable Git blobs, loaded offline before the no-command fixture
        # patches. Rules hashes below are real SHA-256, never hash mocks.
        cls.rules_bytes = {}
        for label, commit in (('old','1169e965976e9498d4e5e1e23aae201e97ec9665'),
                              ('new','41e12be2d551158e97ea30eaf8e95f992f998615')):
            cls.rules_bytes[label] = subprocess.check_output(
                ['git','show',commit+':docs/rules/ENGINEERING_OPERATING_MODEL.md'],cwd=ROOT)

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
            raw = installed_runtime_modules()[name]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), U.RUNTIME_MODULES[name])
            (self.install/name).write_bytes(raw)
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
        self.receiver = self.install/'receiver.py'; self.receiver.write_bytes(b'reviewed receiver')
        self.stage = self.install/'stage.py'; self.stage.write_bytes(b'reviewed successor stage')
        after = {str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in self.install.iterdir()}
        record = dict(schema='GB_ACTIONS_TRAIN_BACKUP_V1',manifest='m',after=after,
                      before={name:None for name in after},units={},activated=False,targets=list(after))
        prior = copy.deepcopy(record); prior['manifest']='old-manifest'
        prior['after'][str(self.stage)]=hashlib.sha256(b'old stage').hexdigest()
        self.backup = self.state/'backup.json'
        journal = {'phase':'active-canary','controller':'c'*40,'canary_task_sha256':self.task_hash,
                   'successor':EXPECTED,'manifest':'m','stage_sha256':'s','dispatch_sha256':'d',
                   'historical_fail':{'issue':211,'attempt':1,'status':'FAIL'},
                   'record_before':prior,'preserved':{str(self.product):hashlib.sha256(self.product_before).hexdigest()},
                   'changes':{str(self.marker):{'before':'historic-before','after':U.encoded_hash(marker)},
                              str(self.stage):{'before':prior['after'][str(self.stage)],'after':after[str(self.stage)]}}}
        for path,value in ((self.marker,marker),(self.journal,journal),
                           (self.backup,record),
                           (self.policy,{'mode':'active','controller_sha':'c'*40})):
            R.atomic(path,value)
        if self._testMethodName.startswith('test_real_'):
            self.make_real_state()
        self.real_atomic = R.atomic
        self.writes = []
        self.fail_at = None; self.fail_before = False
        self.metadata = TrustedRuntimeTree(self.base)

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
                   # runtime_bytes uses fstat for module, marker, proof and evidence
                   # walks. R.read/trusted_tree have separate boundary mocks below.
                   patch.object(R,'publish_monitor'),patch.object(U.os,'fstat',side_effect=self.metadata.fstat),
                   patch.object(U.time,'time',return_value=300),
                   patch('subprocess.run',side_effect=AssertionError('no commands/network/models')),
                   patch('subprocess.Popen',side_effect=AssertionError('no model process'))]
        if self._testMethodName.startswith('test_real_'):
            patches.append(patch.object(U.i,'MONITOR_PAYLOADS',self.monitor_payloads))
        for p in patches:
            p.start(); self.addCleanup(p.stop)

    def make_real_state(self):
        """Install-time journal; descendant live inventory, C5 and precall deferral."""
        j=json.loads(self.journal.read_text()); record=json.loads(self.backup.read_text())
        prior=j['record_before']
        self.rules=self.install/'accepted-engineering-rules.md'
        self.rules.write_bytes(self.rules_bytes['new'])
        self.rules_old=hashlib.sha256(self.rules_bytes['old']).hexdigest()
        self.rules_new=hashlib.sha256(self.rules_bytes['new']).hexdigest()
        self.assertEqual(self.rules_old,'38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c')
        self.assertEqual(self.rules_new,'017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269')
        prior['after'][str(self.rules)]=self.rules_old
        record['after'][str(self.rules)]=self.rules_old
        names=('client.py','core.py','recovery.py','monitor.py','installer.py','cost_policy.py',
               'context_policy.py','slots.py','publish.py','native_codex.py','budgets.py','payload.py',
               'registry.py','receiver_contract.py','resources.py','locks.py','intent.py','auth.py')
        monitor=self.base/'gb-ops-monitor'
        self.monitor_payloads={name:monitor/name for name in ('opsmon/writer.py','web/app.js')}
        old_paths=[self.install/name for name in names]+list(self.monitor_payloads.values())
        for path in old_paths:
            path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(('old '+path.name).encode())
            sha=hashlib.sha256(path.read_bytes()).hexdigest()
            prior['after'][str(path)]=sha; record['after'][str(path)]=sha
        # 15 advanced hashes including journal-changed stage and external monitor files.
        advanced=[self.stage,self.receiver,*old_paths[:11],*self.monitor_payloads.values()]
        for path in advanced:
            path.write_bytes(('C5 reviewed '+path.name).encode())
            record['after'][str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
        added=('antigravity_qa_recovery.py','content_identity.py','context_exchange.py',
               'failure_diagnosis.py','native_antigravity.py','owner_package_admission.py','qa_equivalence.py')
        for name in added:
            path=self.install/name; path.write_bytes(('later reviewed '+name).encode())
            record['after'][str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
        prior['before']={name:None for name in list(prior['after'])[:20]}
        prior['manifest']='c5c8c418-install-time'
        prior['units']={'old.service':{'ActiveState':'inactive'}}
        record.update(manifest='0f16f0d6-live',before={name:None for name in list(record['after'])[:29]},
                      targets=list(record['after']),units={'later.service':{'ActiveState':'active'}},activated=True)
        self.assertEqual(len(record['after']),32)
        self.assertEqual(len(set(record['after'])-set(prior['after'])),7)
        self.assertEqual(sum(record['after'][name]!=sha for name,sha in prior['after'].items()),15)
        self.assertNotEqual(record['after'][str(self.stage)],j['changes'][str(self.stage)]['after'])
        self.deferred={'binding':{'issue':225,'stage':'author'},'task_hash':self.task_hash,
                       'run':102,'started_at':210,'finished_at':211,
                       'result':{'checkpoint':None,'reason':'attempts exhausted',
                                 'safe_release':True,'status':'deferred'}}
        self.ops['slot2']['deferred-author']=copy.deepcopy(self.deferred)
        R.atomic(self.journal,j); R.atomic(self.backup,record)
        R.atomic(self.policy,{'mode':'active','controller_sha':'41e12be2d551158e97ea30eaf8e95f992f998615'})

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

    def test_backup_only_installed_code_drift(self):
        j=json.loads(self.journal.read_text())
        self.assertNotIn(str(self.receiver),j['changes'])
        self.assertNotIn(self.receiver.name,self.old['modules'])
        self.receiver.write_bytes(b'unreviewed receiver drift')
        self.refused_without_write('installed code drift')

    def changes_only_file(self):
        p=self.install/'changes-only.py'; p.write_bytes(b'reviewed changes-only code')
        j=json.loads(self.journal.read_text())
        j['changes'][str(p)]={'before':None,'after':hashlib.sha256(p.read_bytes()).hexdigest()}
        self.real_atomic(self.journal,j)
        self.assertNotIn(str(p),json.loads(self.backup.read_text())['after'])
        return p

    def test_changes_only_installed_code_drift_and_safe_reader(self):
        p=self.changes_only_file(); original=p.read_bytes()
        record=json.loads(self.backup.read_text()); record['after'][str(p)]=hashlib.sha256(original).hexdigest()
        self.real_atomic(self.backup,record)
        p.write_bytes(b'drift'); self.refused_without_write('installed code drift')
        p.write_bytes(original); p.chmod(0o666)
        self.refused_without_write('untrusted runtime evidence metadata')
        p.chmod(0o644)
        record=json.loads(self.backup.read_text()); record['after'][str(p)]=hashlib.sha256(original).hexdigest()
        self.real_atomic(self.backup,record); self.assertEqual(self.call()['phase'],'active-ready')

    def test_backup_only_installed_file_missing(self):
        self.receiver.unlink(); self.refused_without_write('missing or unsafe')

    def test_backup_only_installed_file_symlink(self):
        target=self.base/'receiver-copy'; target.write_bytes(self.receiver.read_bytes())
        self.receiver.unlink(); self.receiver.symlink_to(target)
        self.refused_without_write('missing or unsafe')

    def test_backup_only_installed_file_parent_symlink(self):
        # An independent nested payload isolates the inventory walker from
        # the retained marker-module checks.
        parent=self.install/'nested'; parent.mkdir(); p=parent/'code.py'; p.write_bytes(b'nested')
        self.record_prior_file(p)
        moved=self.install/'nested-moved'; parent.rename(moved); parent.symlink_to(moved)
        self.refused_without_write('missing or unsafe')

    def test_backup_only_installed_file_writable(self):
        for mode in (0o664,0o666):
            with self.subTest(mode=oct(mode)):
                self.receiver.chmod(mode)
                self.refused_without_write('untrusted runtime evidence metadata')
        self.receiver.chmod(0o644); self.assertEqual(self.call()['phase'],'active-ready')

    def test_backup_only_installed_file_hardlinked(self):
        os.link(self.receiver,self.base/'receiver-alias')
        self.refused_without_write('invalid runtime evidence file')

    def test_backup_only_installed_file_wrong_owner(self):
        self.metadata.foreign_owners[self.metadata.inode(self.receiver.lstat())]=999
        self.refused_without_write('untrusted runtime evidence metadata')

    def test_changes_and_backup_conflicting_pins(self):
        j=json.loads(self.journal.read_text())
        j['changes'][str(self.receiver)]={'before':None,'after':hashlib.sha256(b'new receiver').hexdigest()}
        self.real_atomic(self.journal,j); self.receiver.write_bytes(b'new receiver')
        self.refused_without_write('installed code drift')

    def test_missing_backup_refused(self):
        self.backup.unlink(); self.refused_without_write('missing or unsafe')

    def test_malformed_backup_refused(self):
        original=self.backup.read_bytes()
        cases=[b'{',b'\xff',b'[]',b'{}',b'{"after":{}}']
        for key,value in (('schema','foreign'),('after',[]),('after',{}),('before',[]),
                          ('targets',{}),('units',[]),('activated',1)):
            record=json.loads(original); record[key]=value; cases.append(json.dumps(record).encode())
        cases.append(original[:-1]+b',"schema":"duplicate"}')
        for raw in cases:
            with self.subTest(raw=raw[:50]):
                self.backup.write_bytes(raw); self.refused_without_write('invalid backup|duplicate JSON key')

    def test_unsafe_backup_refused(self):
        self.backup.chmod(0o666); self.refused_without_write('untrusted runtime evidence metadata')
        self.backup.chmod(0o644)
        target=self.state/'backup-copy'; target.write_bytes(self.backup.read_bytes())
        self.backup.unlink(); self.backup.symlink_to(target); self.refused_without_write('missing or unsafe')

    def record_prior_file(self, p):
        record=json.loads(self.backup.read_text()); j=json.loads(self.journal.read_text())
        for value in (record,j['record_before']):
            value['after'][str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
        self.real_atomic(self.backup,record); self.real_atomic(self.journal,j)

    def test_recorded_path_outside_installation_refused(self):
        p=self.base/'outside.py'; p.write_bytes(b'outside'); self.record_prior_file(p)
        self.refused_without_write('path outside installation')

    def test_recorded_parent_escape_refused(self):
        p=self.install/'..'/'outside.py'; p.write_bytes(b'outside'); self.record_prior_file(p)
        self.refused_without_write('path outside installation')

    def test_unrecorded_backup_entry_refused(self):
        # Descendant additions are permitted only when their live bytes match.
        p=self.install/'extra.py'; p.write_bytes(b'extra')
        record=json.loads(self.backup.read_text()); record['after'][str(p)]=hashlib.sha256(b'other extra').hexdigest()
        self.real_atomic(self.backup,record); self.refused_without_write('installed code drift')

    def test_missing_prior_inventory_entry_refused(self):
        record=json.loads(self.backup.read_text()); del record['after'][str(self.receiver)]
        self.real_atomic(self.backup,record); self.refused_without_write('unrecorded or missing inventory')

    def test_unrecorded_marker_module_refused(self):
        p=self.install/'extra-module.py'; p.write_bytes(b'extra')
        marker=copy.deepcopy(self.old); marker['modules'][p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
        self.real_atomic(self.marker,marker)
        j=json.loads(self.journal.read_text()); j['changes'][str(self.marker)]['after']=U.encoded_hash(marker)
        self.real_atomic(self.journal,j); self.refused_without_write('unrecorded marker module')

    def test_backup_identity_and_prior_schema_refused(self):
        # Manifest can advance, but both records still require a string manifest.
        self.change(self.backup,manifest=[]); self.refused_without_write('malformed backup record')
        self.change(self.backup,manifest='m'); self.change(self.journal,record_before={})
        self.refused_without_write('invalid backup schema')

    def test_all_recorded_hashes_consistent_positive_control(self):
        p=self.changes_only_file()
        record=json.loads(self.backup.read_text()); record['after'][str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
        self.real_atomic(self.backup,record)
        self.assertEqual(self.call()['phase'],'active-ready')
        self.assertEqual(self.call()['phase'],'active-ready')

    def test_installer_external_destinations_positive_control(self):
        helper=self.base/'deploy-helper.sh'; helper.write_bytes(b'helper')
        monitor=self.base/'monitor.js'; monitor.write_bytes(b'monitor')
        for p in (helper,monitor): self.record_prior_file(p)
        with patch.object(U.i,'HELPER',helper),patch.object(U.i,'MONITOR_PAYLOADS',{'monitor':monitor}):
            self.assertEqual(self.call()['phase'],'active-ready')

    def test_pending_intent_replay_refuses_backup_only_drift(self):
        self.interrupt_before_marker(); self.receiver.write_bytes(b'post-intent drift')
        self.refused_without_write('installed code drift')

    def test_completed_replay_refuses_backup_only_drift(self):
        self.call(); self.receiver.write_bytes(b'post-accept drift')
        self.refused_without_write('installed code drift')

    def test_runtime_rollback_refuses_backup_only_drift_without_write(self):
        self.call(); self.change(self.policy,mode='disabled'); self.receiver.write_bytes(b'rollback drift')
        before=self.snapshot(); count=len(self.writes)
        with self.assertRaisesRegex(core.Refused,'installed code drift'):
            U.rollback_runtime(SimpleNamespace(quiet=Mock()))
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)

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

    def extra_author(self, slot='slot1', status='unknown', finished=True, calls=1, task='same'):
        op=copy.deepcopy(self.ops['slot2']['author']); op['run']=102
        op['result']['status']=status; op['result']['routing']['usage']['charged_calls']=calls
        if not finished: op.pop('finished_at')
        if task=='missing': op.pop('task_hash')
        elif task!='same': op['task_hash']='other-task'
        self.ops[slot]['second-author']=op

    def test_second_unknown_charged_author_other_slot(self):
        self.extra_author(); self.refused_without_write('one confirmed runtime canary author required')

    def test_second_unknown_charged_author_same_slot(self):
        self.extra_author(slot='slot2'); self.refused_without_write('one confirmed runtime canary author required')

    def test_second_failed_rejected_unconfirmed_or_unfinished_author(self):
        for slot in ('slot1','slot2'):
            for status,finished in (('failed',True),('rejected',True),('unconfirmed',True),('confirmed',False)):
                with self.subTest(slot=slot,status=status,finished=finished):
                    self.extra_author(slot=slot,status=status,finished=finished,calls=0)
                    self.refused_without_write('one confirmed runtime canary author required')
                    del self.ops[slot]['second-author']

    def test_second_author_with_missing_or_different_task_hash(self):
        for task in ('missing','different'):
            with self.subTest(task=task):
                self.extra_author(status='confirmed',task=task)
                self.refused_without_write('one confirmed runtime canary author required')
                del self.ops['slot1']['second-author']

    def test_pending_intent_replay_refuses_added_unknown_author(self):
        self.interrupt_before_marker(); self.extra_author()
        self.refused_without_write('one confirmed runtime canary author required')

    def test_completed_replay_refuses_added_unknown_author(self):
        self.call(); self.extra_author(slot='slot2')
        self.refused_without_write('one confirmed runtime canary author required')

    def test_unrelated_issue_author_and_qa_dev_are_not_counted(self):
        self.extra_author(); self.ops['slot1']['second-author']['binding']['issue']=226
        for stage in ('qa','dev'):
            op=copy.deepcopy(self.ops['slot2']['author']); op['binding']['stage']=stage
            op['finished_at']=201; self.ops['slot2']['extra-'+stage]=op
        self.assertEqual(self.call()['phase'],'active-ready')
        self.assertEqual(self.call()['phase'],'active-ready')

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
        p=self.state/self.evidence['probe'][0]
        self.metadata.foreign_owners[self.metadata.inode(p.lstat())]=999
        self.refused_without_write('untrusted runtime evidence metadata')
        self.metadata.foreign_owners.clear()
        self.assertTrue(self.call(dry_run=True)['dry_run'])

    def test_proof_unsafe_metadata_or_symlink_refused(self):
        self.metadata.foreign_owners[self.metadata.inode(self.proof_path.lstat())]=999
        self.refused_without_write('untrusted runtime evidence metadata')
        self.metadata.foreign_owners.clear()
        target=self.base/'proof-copy'; target.write_bytes(self.proof_path.read_bytes())
        self.proof_path.unlink(); self.proof_path.symlink_to(target)
        self.refused_without_write('missing or unsafe')

    def test_evidence_group_writable_or_hardlink_refused(self):
        p=self.state/self.evidence['probe'][0]; p.chmod(0o660)
        self.refused_without_write('untrusted runtime evidence metadata')
        p.chmod(0o600); os.link(p,self.base/'alias')
        self.refused_without_write('invalid runtime evidence file')

    def test_trusted_modes_positive_control(self):
        for p in (self.base, *self.base.rglob('*')):
            p.chmod(0o755 if p.is_dir() else 0o644)
        self.assertEqual(self.call()['phase'],'active-ready')

    def test_fixture_directories_with_foreign_owner_refused(self):
        for p in (self.base, self.state, (self.state/self.evidence['probe'][0]).parent):
            with self.subTest(path=p.relative_to(self.base)):
                self.metadata.foreign_owners[self.metadata.inode(p.lstat())]=999
                self.refused_without_write('untrusted runtime evidence metadata')
                self.metadata.foreign_owners.clear()
                self.assertTrue(self.call(dry_run=True)['dry_run'])

    def assert_writable_modes_refused(self, path, modes, safe_mode):
        path.chmod(safe_mode)
        self.assertTrue(self.call(dry_run=True)['dry_run'])
        for mode in modes:
            with self.subTest(path=path.relative_to(self.base),mode=oct(mode)):
                path.chmod(mode)
                try:
                    self.refused_without_write('untrusted runtime evidence metadata')
                finally:
                    path.chmod(safe_mode)
                # Same bytes/tree pass again when only the offending bits change.
                self.assertTrue(self.call(dry_run=True)['dry_run'])

    def test_group_and_world_writable_evidence_file_refused(self):
        self.assert_writable_modes_refused(self.state/self.evidence['probe'][0],(0o664,0o666),0o644)

    def test_group_and_world_writable_fixture_parents_refused(self):
        for p in (self.base, self.state, (self.state/self.evidence['probe'][0]).parent):
            self.assert_writable_modes_refused(p,(0o775,0o777),0o755)

    def test_group_and_world_writable_proof_refused(self):
        self.assert_writable_modes_refused(self.proof_path,(0o664,0o666),0o644)

    def test_group_and_world_writable_installed_module_refused(self):
        self.assert_writable_modes_refused(self.install/'native_guard.py',(0o664,0o666),0o644)

    def test_metadata_covers_late_files_and_preserves_real_stat_attributes(self):
        p=self.base/'late-file'; p.write_bytes(b'late'); p.chmod(0o664)
        fd=os.open(p,os.O_RDONLY)
        self.addCleanup(os.close,fd)
        actual=self.metadata.real_fstat(fd); modeled=U.os.fstat(fd)
        self.assertEqual(modeled.st_uid,0)
        for name in dir(actual):
            if name.startswith('st_') and name!='st_uid':
                self.assertEqual(getattr(modeled,name),getattr(actual,name),name)
        self.assertTrue(stat.S_ISREG(modeled.st_mode))
        os.link(p,self.base/'late-alias')
        self.assertEqual(U.os.fstat(fd).st_nlink,2)
        self.metadata.foreign_owners[self.metadata.inode(actual)]=999
        self.assertEqual(U.os.fstat(fd).st_uid,999)

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
        # qualification must inspect the exact installed fixture bytes, whose
        # marker still pins the old guard, rather than this uninstalled repo diff.
        with patch.object(N,'__file__',str(self.install/'native_cursor.py')), \
             patch.object(N,'_read',side_effect=native_read),patch.object(N.hashlib,'sha256',side_effect=sha):
            with self.assertRaisesRegex(core.Refused,'restricted to reviewed'): N.qualification('slot2',task_hash)
            self.call()
            self.assertEqual(N.qualification('slot2',task_hash)['phase'],'ready')
            choice=core.route(S,task,'author','auto',budget,'slot2')
            self.assertEqual(choice['provider'],'cursor'); self.assertEqual(choice['effective_model'],'Auto')
            self.assertEqual(choice['requested_route'],'cursor:auto'); self.assertEqual(choice['policy'],'GB_STAGE_COST_V2')


    # R3: each table case runs against pristine initial, pending and completed
    # state, with both dry-run and apply, and checks a full byte snapshot.
    def shape_cases(self, cases, mutate, reason, phases=('initial','pending','completed')):
        initial=self.snapshot(); initial_ops=copy.deepcopy(self.ops)
        effects=[(mock,mock.side_effect) for mock in (R.journal,R.loads,U.runtime_identity) if isinstance(mock,Mock)]
        for phase in phases:
            for mock,effect in effects: mock.side_effect=effect
            for name,raw in initial.items(): Path(name).write_bytes(raw)
            self.ops=copy.deepcopy(initial_ops); self.writes.clear()
            if phase=='pending': self.interrupt_before_marker()
            if phase=='completed': self.call()
            baseline=self.snapshot(); operations=copy.deepcopy(self.ops)
            for dry_run in (True,False):
                for case in cases:
                    with self.subTest(phase=phase,dry_run=dry_run,case=case):
                        for name,raw in baseline.items(): Path(name).write_bytes(raw)
                        self.ops=copy.deepcopy(operations)
                        for mock,effect in effects: mock.side_effect=effect
                        mutate(case)
                        self.assert_no_writes(lambda:self.call(dry_run=dry_run),reason(case) if callable(reason) else reason)
        for mock,effect in effects: mock.side_effect=effect

    def assert_no_writes(self, invoke, reason):
        before=self.snapshot(); count=len(self.writes)
        publications=R.publish_monitor.call_count
        with self.assertRaisesRegex(core.Refused,reason): invoke()
        self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)
        self.assertEqual(R.publish_monitor.call_count,publications)

    @staticmethod
    def replace_field(value, field, replacement):
        if replacement is MISSING: value.pop(field,None)
        else: value[field]=copy.deepcopy(replacement)

    def mutate_file(self, path, field, value):
        record=json.loads(path.read_text()); self.replace_field(record,field,value)
        self.real_atomic(path,record)

    def malformed_extra(self, field, values):
        def mutate(case):
            slot,value=case; self.extra_author(slot=slot,status='unknown',calls=1)
            self.replace_field(self.ops[slot]['second-author']['binding'],field,value)
        self.shape_cases([(slot,v) for slot in ('slot1','slot2') for v in values],
                         mutate,'malformed operation record')

    def test_r3_extra_author_issue_identity_types(self):
        self.malformed_extra('issue',('225',None,225.0,True,[],MISSING))

    def test_r3_extra_author_stage_identity_types(self):
        self.malformed_extra('stage',(None,5,MISSING))

    def test_r3_extra_author_binding_shapes(self):
        def mutate(case):
            slot,value=case; self.extra_author(slot=slot,status='unknown',calls=1)
            self.replace_field(self.ops[slot]['second-author'],'binding',value)
        self.shape_cases([(slot,v) for slot in ('slot1','slot2') for v in (None,[],MISSING,{})],
                         mutate,'malformed operation record')

    def test_r3_operation_shapes(self):
        def mutate(case):
            slot,value=case; self.ops[slot]['bad']=copy.deepcopy(value)
        self.shape_cases([(slot,v) for slot in ('slot1','slot2') for v in ({},None,[],'x',5)],
                         mutate,'malformed operation record')

    def test_r3_operation_key_type(self):
        # Real receiver keys are string digests; never stringify a corrupt key.
        self.shape_cases(('slot1','slot2'),lambda slot:self.ops[slot].update({5:{'binding':{'issue':226,'stage':'author'}}}),
                         'malformed operation record: key')

    def test_r3_slot_journal_shapes(self):
        original=R.journal.side_effect
        def mutate(value):
            R.journal.side_effect=lambda slot:copy.deepcopy(value) if slot=='slot1' else original(slot)
        try:
            self.shape_cases((None,[], 'x',{}, {'operations':None},{'operations':[]},{'operations':'x'}),
                             mutate,'malformed slot structure')
        finally: R.journal.side_effect=original

    def sole_shapes(self, field, values, reason='malformed operation record'):
        self.shape_cases(values,lambda value:self.replace_field(self.ops['slot2']['author'],field,value),reason)

    def route_shapes(self, field, values):
        self.shape_cases(values,lambda value:self.replace_field(
            self.ops['slot2']['author']['result']['routing'],field,value),'malformed operation record')

    def test_r3_sole_author_result_shapes(self):
        self.sole_shapes('result',(None,[],'x',MISSING))

    def test_r3_sole_author_routing_shapes(self):
        self.shape_cases(([],['bad'],'x',''),lambda value:self.replace_field(
            self.ops['slot2']['author']['result'],'routing',value),'malformed operation record: routing')

    def test_r3_sole_author_null_routing_retains_executor_refusal(self):
        self.shape_cases((None,),lambda value:self.replace_field(
            self.ops['slot2']['author']['result'],'routing',value),'executor')

    def test_r3_sole_author_usage_shapes(self):
        self.route_shapes('usage',(None,[],'bad'))

    def test_r3_sole_author_receipt_shapes(self):
        self.route_shapes('native_receipt',(None,[],'x'))

    def test_r3_evidence_receipt_shape(self):
        raw=(self.state/self.evidence['author_receipt'][0]).read_bytes(); loads=R.loads
        def mutate(value):
            R.loads.side_effect=lambda data:copy.deepcopy(value) if data==raw else loads(data)
        with patch.object(R,'loads',wraps=loads):
            self.shape_cases((None,[],'x',5,{},
                dict(self.receipt,issue=225.0),dict(self.receipt,issue=True)),
                mutate,'malformed runtime receipt')

    def test_r3_sole_author_run_shapes(self):
        self.sole_shapes('run',(MISSING,'101',True))

    def test_r3_sole_author_task_hash_only(self):
        # No status/finish drift: deleting only the exact-task conjunct must fail.
        self.sole_shapes('task_hash',('different',None,MISSING),'one confirmed runtime canary author required')

    def test_r3_sole_author_finished_at_only(self):
        # Zero is numeric but unfinished: catches deletion of the truth conjunct.
        self.sole_shapes('finished_at',(0,None,MISSING),'one confirmed runtime canary author required')

    def test_r3_sole_author_status_only(self):
        self.shape_cases(('unknown','failed','rejected'),lambda value:self.replace_field(
            self.ops['slot2']['author']['result'],'status',value),'one confirmed runtime canary author required')

    def test_r3_sole_author_scalar_field_types(self):
        def mutate(case):
            field,value=case; self.replace_field(self.ops['slot2']['author'],field,value)
        self.shape_cases((('task_hash',[]),('task_hash',5),('finished_at','100'),
                          ('finished_at',[]),('finished_at',True),('finished_at',float('inf'))),
                         mutate,'malformed operation record')

    def test_r3_sole_author_status_and_route_member_types(self):
        def mutate(case):
            field,value=case; result=self.ops['slot2']['author']['result']
            if field=='status': result[field]=value
            elif field in ('provider','effective_model'): result['routing'][field]=value
            else: result['routing']['native_receipt'][field]=value
        self.shape_cases((('status',None),('status',[]),('provider',[]),('effective_model',5),
                          ('phase',[]),('task_sha256',5),('issue',True)),mutate,'malformed operation record')

    def test_r3_qa_dev_fields_read_by_runtime(self):
        def mutate(case):
            slot,stage,field,value=case
            op={'binding':{'issue':225,'stage':stage},'task_hash':self.task_hash,'finished_at':201}
            self.replace_field(op,field,value); self.ops[slot]['outcome']=op
        self.shape_cases([(slot,stage,field,value) for slot in ('slot1','slot2') for stage in ('qa','dev')
                          for field,values in (('task_hash',([],5)),('finished_at',([],{},'201',True)))
                          for value in values],mutate,'malformed operation record')

    def test_r3_installed_changes_container_guard(self):
        self.shape_cases((None,[],'x',MISSING),lambda value:self.mutate_file(self.journal,'changes',value),
                         'invalid changes')

    def test_r3_installed_change_pin_guard(self):
        def mutate(value):
            j=json.loads(self.journal.read_text()); j['changes'][str(self.stage)]=copy.deepcopy(value)
            self.real_atomic(self.journal,j)
        self.shape_cases((None,[],{}, {'after':5},{'after':None}),mutate,'invalid change pin')

    def test_r3_marker_change_shape(self):
        def mutate(value):
            j=json.loads(self.journal.read_text()); changes=j['changes']
            self.replace_field(changes,str(self.marker),value); self.real_atomic(self.journal,j)
        self.shape_cases((None,[],{}, {'after':5},MISSING),mutate,'malformed journal')

    def test_r3_backup_member_types(self):
        def mutate(case):
            location,field,value=case
            if location=='backup': self.mutate_file(self.backup,field,value)
            else:
                j=json.loads(self.journal.read_text()); self.replace_field(j['record_before'],field,value)
                self.real_atomic(self.journal,j)
        values=(('manifest',5),('after',{'bad':None}),('before',{'bad':[]}),
                ('units',{'bad':[]}),('units',{'bad':{'ActiveState':5}}),('targets',[None]))
        self.shape_cases([(location,f,v) for location in ('backup','prior') for f,v in values],
                         mutate,'malformed backup record')

    def test_r3_marker_module_shapes(self):
        self.shape_cases((None,[], 'x', {'native_cursor.py':5}),
                         lambda value:self.mutate_file(self.marker,'modules',value),'malformed runtime marker')

    def test_r3_journal_required_identity_fields(self):
        self.shape_cases(('manifest','controller','canary_task_sha256','successor','phase'),
                         lambda field:self.mutate_file(self.journal,field,MISSING),'malformed journal')

    def test_r3_journal_identity_types(self):
        self.shape_cases((('manifest',[]),('controller',5),('canary_task_sha256',None),
                          ('successor',[]),('phase',None)),
                         lambda case:self.mutate_file(self.journal,*case),'malformed journal')

    def test_r3_record_before_missing_or_wrong_shape(self):
        self.shape_cases((None,[], 'x',MISSING),lambda value:self.mutate_file(self.journal,'record_before',value),
                         'invalid backup schema')

    def test_r3_top_level_state_shapes(self):
        def mutate(case):
            target,value=case; self.real_atomic(getattr(self,target),value)
        self.shape_cases([(target,value) for target in ('journal','policy','marker') for value in (None,[],'x')],
                         mutate,'malformed (journal|runtime policy|runtime marker)')

    def test_r3_policy_and_marker_required_fields(self):
        def mutate(case):
            target,field=case; self.mutate_file(getattr(self,target),field,MISSING)
        self.shape_cases((('policy','mode'),('policy','controller_sha'),('marker','phase'),
                          ('marker','canary_task_sha256'),('marker','successor'),('marker','modules')),
                         mutate,'malformed runtime (policy|marker)')

    def intent_cases(self, cases, mutate):
        def change(case):
            j=json.loads(self.journal.read_text()); mutate(j,case); self.real_atomic(self.journal,j)
        self.shape_cases(cases,change,'malformed (qualification intent|runtime marker)',phases=('pending','completed'))

    def test_r3_qualification_intent_container(self):
        self.intent_cases((None,[],'x',MISSING),lambda j,value:self.replace_field(j,'qualification_intent',value))

    def test_r3_qualification_intent_required_keys(self):
        keys=('policy','controller','task_sha256','successor','proof','proof_path','operations',
              'old_marker','next_marker','old_hash','next_hash','qualified_at')
        self.intent_cases(keys,lambda j,field:j['qualification_intent'].pop(field))

    def test_r3_qualification_intent_member_types(self):
        cases=(('policy',[]),('controller',5),('task_sha256',None),('successor',[]),('proof',[]),
               ('proof_path',[]),('operations',[]),('operations',{'author':5}),('old_marker',None),
               ('next_marker',[]),('old_hash',None),('next_hash',5),('qualified_at',[]))
        self.intent_cases(cases,lambda j,case:self.replace_field(j['qualification_intent'],*case))

    def test_r3_intent_proof_required_keys(self):
        self.intent_cases(('acceptance_basis','slot','author_run','qualification_proof_sha256','evidence'),
                          lambda j,field:j['qualification_intent']['proof'].pop(field))

    def test_r3_intent_proof_and_marker_member_types(self):
        def mutate(j,case):
            target,field,value=case; self.replace_field(j['qualification_intent'][target],field,value)
        cases=(('proof','slot',[]),('proof','slot','slot3'),('proof','author_run',True),
               ('proof','qualification_proof_sha256',None),('proof','evidence',[]),
               ('proof','evidence',{'probe':None}),('proof','evidence',{'probe':{'path':5,'sha256':'x'}}),
               ('old_marker','modules',[]),('next_marker','modules',{'native_cursor.py':None}))
        self.intent_cases(cases,mutate)

    def test_r3_unexpected_validation_exceptions(self):
        errors=(KeyError('binding'),TypeError('bad shape'),AttributeError('bad shape'),ValueError('bad'),
                IndexError('bad'),UnicodeDecodeError('utf-8',b'\xff',0,1,'bad'),OSError('unreadable'),
                RuntimeError('unexpected'))
        def mutate(error): U.runtime_identity.side_effect=error
        with patch.object(U,'runtime_identity',wraps=U.runtime_identity):
            self.shape_cases(errors,mutate,lambda error:
                'runtime acceptance refused: malformed or unreadable state \\('+type(error).__name__+'\\)')

    def test_r3_refused_passes_through_unchanged(self):
        sentinel=core.Refused('exact refusal')
        before=self.snapshot()
        with patch.object(U,'runtime_identity',side_effect=sentinel):
            with self.assertRaises(core.Refused) as caught: self.call()
        self.assertIs(caught.exception,sentinel); self.assertEqual(before,self.snapshot()); self.assertEqual(self.writes,[])

    def test_r3_base_exceptions_are_not_converted(self):
        for error in (KeyboardInterrupt(),SystemExit(2)):
            with self.subTest(error=type(error).__name__),patch.object(U,'runtime_identity',side_effect=error):
                with self.assertRaises(type(error)): self.call()
                self.assertEqual(self.writes,[])

    def test_r3_last_validation_precedes_first_write(self):
        # Initial acceptance used to persist intent before a later journal read.
        original=R.journal.side_effect; reads=0
        def journal(slot):
            nonlocal reads
            reads+=1
            if reads==5: raise RuntimeError('late validation read')
            return original(slot)
        with patch.object(R,'journal',side_effect=journal):
            self.assert_no_writes(self.call,'runtime acceptance refused.*RuntimeError')

    def test_r3_write_exceptions_remain_unconverted(self):
        for error in (OSError('write failed'),KeyError('write failed'),RuntimeError('write failed')):
            with self.subTest(error=type(error).__name__):
                before=self.snapshot(); sentinel=error
                def write(path,value,**kwargs):
                    self.real_atomic(path,value,**kwargs); raise sentinel
                with patch.object(R,'atomic',side_effect=write):
                    with self.assertRaises(type(error)) as caught: self.call()
                self.assertIs(caught.exception,sentinel)
                self.assertNotEqual(self.snapshot(),before)
                # Restore initial state for the next exception kind.
                for name,raw in before.items(): Path(name).write_bytes(raw)

    def test_r3_direct_runtime_replay_exception_boundary(self):
        self.interrupt_before_marker()
        j=json.loads(self.journal.read_text()); p=json.loads(self.policy.read_text()); m=json.loads(self.marker.read_text())
        with patch.object(U,'runtime_identity',side_effect=KeyError('unexpected')):
            self.assert_no_writes(lambda:U.complete_qualification(j,p,m),'runtime acceptance refused.*KeyError')

    def test_r3_execute_runtime_release_shape_boundary(self):
        args=('accept-runtime',self.bundle,'m','c'*40,'s','d')
        with patch.object(U.os,'geteuid',return_value=0),patch.object(R,'trusted_tree'):
            for field in ('manifest','controller','stage_sha256','dispatch_sha256'):
                before=self.journal.read_bytes(); self.mutate_file(self.journal,field,MISSING)
                self.assert_no_writes(lambda:U.execute(*args,dry_run=True),'malformed journal')
                self.journal.write_bytes(before)

    def test_r3_rollback_shape_preflight_and_exception_boundary(self):
        C=SimpleNamespace(quiet=Mock())
        self.call(); self.change(self.policy,mode='disabled'); baseline=self.snapshot()
        mutations=(('qualification_intent',None),('qualification_history',{}),
                   ('qualification_history',[None]),('qualification_history',[{'intent':None}]))
        for field,value in mutations:
            with self.subTest(field=field,value=value):
                for name,raw in baseline.items(): Path(name).write_bytes(raw)
                self.mutate_file(self.journal,field,value)
                self.assert_no_writes(lambda:U.rollback_runtime(C),'malformed (journal|qualification intent)')
        for name,raw in baseline.items(): Path(name).write_bytes(raw)
        with patch.object(U,'runtime_identity',side_effect=UnicodeDecodeError('utf-8',b'\xff',0,1,'bad')):
            self.assert_no_writes(lambda:U.rollback_runtime(C),'runtime acceptance refused.*UnicodeDecodeError')

    def test_r3_rollback_shapes_in_pending_reverting_and_completed_replay(self):
        C=SimpleNamespace(quiet=Mock()); initial=self.snapshot()
        for phase in ('pending','completed','reverting','rolled-back'):
            for name,raw in initial.items(): Path(name).write_bytes(raw)
            self.writes.clear()
            if phase=='pending': self.interrupt_before_marker()
            else: self.call()
            self.change(self.policy,mode='disabled')
            if phase=='reverting':
                self.writes.clear(); self.fail_at=2; self.fail_before=True
                with self.assertRaises(OSError): U.rollback_runtime(C)
                self.fail_at=None
            if phase=='rolled-back': U.rollback_runtime(C)
            baseline=self.snapshot()
            cases=[('phase',MISSING,'malformed journal'),('changes',None,'invalid changes'),
                   ('record_before',None,'invalid backup schema'),
                   ('qualification_history',[{}],'malformed journal')]
            if phase!='rolled-back': cases.append(('qualification_intent',MISSING,'malformed qualification intent'))
            if phase=='reverting': cases.append(('runtime_rollback_at',[],'malformed journal'))
            for field,value,reason in cases:
                with self.subTest(phase=phase,field=field):
                    for name,raw in baseline.items(): Path(name).write_bytes(raw)
                    self.mutate_file(self.journal,field,value)
                    self.assert_no_writes(lambda:U.rollback_runtime(C),reason)

    def test_r3_direct_replay_validates_intent_shape(self):
        initial=self.snapshot()
        for phase in ('pending','completed'):
            for name,raw in initial.items(): Path(name).write_bytes(raw)
            self.writes.clear()
            if phase=='pending': self.interrupt_before_marker()
            else: self.call()
            for dry_run in (True,False):
                for field,value in (('proof',None),('operations',[]),('old_marker',None)):
                    with self.subTest(phase=phase,dry_run=dry_run,field=field):
                        j=json.loads(self.journal.read_text()); p=json.loads(self.policy.read_text())
                        m=json.loads(self.marker.read_text()); j['qualification_intent'][field]=value
                        self.assert_no_writes(lambda:U.complete_qualification(j,p,m,dry_run=dry_run),
                                              'malformed qualification intent')

    def test_r3_historical_operations_positive_control(self):
        for slot in ('slot1','slot2'):
            for issue,stage,status in ((29,'author','unknown'),(226,'author','failed'),
                                       (271,'qa','unknown'),(225,'qa_qualification','failed')):
                # Unread result/routing shapes on unrelated issues are intentional.
                self.ops[slot][f'{issue}-{stage}']={'binding':{'issue':issue,'stage':stage},
                    'result':None,'routing':[],'reason':'zero diff','status':status}
            for stage in ('qa','dev'):
                self.ops[slot]['extra-'+stage]={'binding':{'issue':225,'stage':stage},
                    'task_hash':self.task_hash,'finished_at':201,'result':None}
        self.assertTrue(self.call(dry_run=True)['dry_run'])
        self.assertEqual(self.call()['phase'],'active-ready')
        self.assertEqual(self.call()['phase'],'active-ready')

    def test_real_dry_run_no_writes(self):
        before=self.snapshot()
        result=U.accept_runtime(self.bundle,dry_run=True)
        self.assertTrue(result['dry_run'])
        self.assertEqual(result['would_change']['journal_phase'],'active-ready')
        self.assertEqual(self.snapshot(),before); self.assertEqual(self.writes,[])
        R.publish_monitor.assert_not_called()

    def test_real_apply_pins_policy_and_deferral(self):
        before_ops=copy.deepcopy(self.ops); before_backup=self.backup.read_bytes()
        self.assertEqual(self.call()['phase'],'active-ready')
        j=json.loads(self.journal.read_text()); intent=j['qualification_intent']
        self.assertEqual(j['controller'],'c'*40)
        self.assertEqual(intent['controller'],j['controller'])
        self.assertEqual(intent['policy_controller'],'41e12be2d551158e97ea30eaf8e95f992f998615')
        self.assertEqual(intent['operations'],{'author':core.digest(before_ops['slot2']['author'])})
        self.assertEqual(intent['deferred_operations'],
                         {'slot2':{'deferred-author':core.digest(self.deferred)}})
        self.assertEqual(json.loads(self.marker.read_text())['phase'],'ready')
        self.assertEqual(self.writes,[self.journal,self.marker,self.journal])
        self.assertEqual(self.ops,before_ops); self.assertEqual(self.backup.read_bytes(),before_backup)
        self.assertEqual(self.product.read_bytes(),self.product_before)

    def test_real_interrupted_replayed(self):
        self.test_crash_replay_before_and_after_each_write()

    def test_real_rollback_restores_history(self):
        self.test_rollback_replays_and_preserves_qualification_intent_and_history()

    def test_real_direct_completion_accepts_c5(self):
        self.interrupt_before_marker()
        result=U.complete_qualification(json.loads(self.journal.read_text()),
            json.loads(self.policy.read_text()),json.loads(self.marker.read_text()))
        self.assertEqual(result['phase'],'active-ready')

    def test_real_equal_rules_pins(self):
        initial=self.snapshot()
        for label in ('old','new'):
            with self.subTest(label=label):
                for name,raw in initial.items(): Path(name).write_bytes(raw)
                self.rules.write_bytes(self.rules_bytes[label])
                record=json.loads(self.backup.read_text())
                record['after'][str(self.rules)]=hashlib.sha256(self.rules_bytes[label]).hexdigest()
                self.real_atomic(self.backup,record)
                self.assertTrue(self.call(dry_run=True)['dry_run'])
                self.assertEqual(self.call()['phase'],'active-ready')

    def test_real_deferral_in_other_slot_is_pinned(self):
        self.ops['slot1']['other-deferred']=self.ops['slot2'].pop('deferred-author')
        self.call(); intent=json.loads(self.journal.read_text())['qualification_intent']
        self.assertEqual(intent['deferred_operations'],{'slot1':{'other-deferred':core.digest(self.deferred)}})
        self.assertEqual(self.call()['phase'],'active-ready')

    def test_real_third_rules_sha(self):
        def mutate(kind):
            if kind!='record': self.rules.write_bytes(b'third rules')
            if kind!='disk':
                record=json.loads(self.backup.read_text())
                record['after'][str(self.rules)]=hashlib.sha256(b'third rules').hexdigest()
                self.real_atomic(self.backup,record)
        self.shape_cases(('record','disk','both'),mutate,'installed code drift')

    def test_real_reverse_rules_pair(self):
        def mutate(_):
            self.rules.write_bytes(self.rules_bytes['old'])
            record=json.loads(self.backup.read_text()); record['after'][str(self.rules)]=self.rules_new
            self.real_atomic(self.backup,record)
        self.shape_cases((None,),mutate,'installed code drift')

    def test_real_other_file_drift(self):
        self.shape_cases((None,),lambda _:self.receiver.write_bytes(b'drift'),'installed code drift')

    def test_real_prior_entry_removed(self):
        def mutate(_):
            record=json.loads(self.backup.read_text()); record['after'].pop(str(self.receiver))
            self.real_atomic(self.backup,record)
        self.shape_cases((None,),mutate,'unrecorded or missing inventory')

    def test_real_change_entry_missing(self):
        # A changes-only path absent from record_before isolates this conjunct.
        path=self.changes_only_file()
        record=json.loads(self.backup.read_text()); record['after'][str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
        self.real_atomic(self.backup,record)
        def mutate(_):
            record=json.loads(self.backup.read_text()); record['after'].pop(str(path))
            self.real_atomic(self.backup,record)
        self.shape_cases((None,),mutate,'unrecorded or missing inventory')

    def test_real_backup_shape_errors(self):
        cases=(('schema','foreign'),('after',[]),('after',{}),('before',None),('units',[]),
               ('targets',{}),('activated',1),('extra',True),('manifest',None))
        self.shape_cases(cases,lambda case:self.mutate_file(self.backup,*case),
                         'invalid backup schema|malformed backup record')

    def test_real_inventory_path_and_pin_errors(self):
        outside=self.base/'outside.py'; outside.write_bytes(b'outside')
        outside_sha=hashlib.sha256(outside.read_bytes()).hexdigest()
        def mutate(case):
            name,sha=case; record=json.loads(self.backup.read_text()); record['after'][name]=sha
            self.real_atomic(self.backup,record)
        self.shape_cases(((str(outside),outside_sha),('relative.py','a'*64),
                          (str(self.install/'..'/'outside.py'),'a'*64),
                          (str(self.receiver),'third'),(str(self.receiver),'A'*64)),
                         mutate,'installed code drift')

    def test_real_controller_third_sha(self):
        self.shape_cases((None,),lambda _:self.change(self.policy,controller_sha='e'*40),
                         'identity|qualification intent drift')

    def test_real_c5_disabled(self):
        self.shape_cases((None,),lambda _:self.change(self.policy,mode='disabled'),
                         'identity|qualification intent drift')

    def test_real_controller_drift_after_intent(self):
        # Both controllers are individually authorized, but cannot change mid-intent.
        self.shape_cases((None,),lambda _:self.change(self.policy,controller_sha='c'*40),
                         'qualification intent drift',phases=('pending','completed'))

    def test_real_policy_controller_pin_is_independent(self):
        def mutate(_):
            self.change(self.policy,controller_sha='c'*40)
            j=json.loads(self.journal.read_text())
            j['qualification_intent']['policy']['controller_sha']='c'*40
            self.real_atomic(self.journal,j)
        self.shape_cases((None,),mutate,'qualification intent drift',phases=('pending','completed'))

    def real_deferred_cases(self, cases, mutate):
        self.shape_cases(cases,lambda case:mutate(self.ops['slot2']['deferred-author'],case),
                         'one confirmed runtime canary author required|malformed operation record')

    def test_real_deferred_execution_content(self):
        def mutate(op,case):
            location,key=case
            if location=='top': op[key]={}
            elif location=='result': op['result'][key]={}
            else: op['history']=[{'nested':{key:0}}]
        self.real_deferred_cases([(location,key) for location in ('top','result','nested')
            for key in ('routing','usage','charged_calls','native_receipt')],mutate)

    def test_real_deferred_status(self):
        self.real_deferred_cases(('unknown','failed','running','confirmed'),
                                 lambda op,value:op['result'].update(status=value))

    def test_real_deferred_top_status(self):
        self.real_deferred_cases(('unknown','failed','running','confirmed'),
                                 lambda op,value:op.update(status=value))

    def test_real_deferred_safe_release(self):
        self.real_deferred_cases((False,MISSING,1,None),
            lambda op,value:self.replace_field(op['result'],'safe_release',value))

    def test_real_deferred_checkpoint(self):
        self.real_deferred_cases(({},False,'checkpoint',MISSING),
            lambda op,value:self.replace_field(op['result'],'checkpoint',value))

    def test_real_deferred_extra_result_key(self):
        self.real_deferred_cases((None,),lambda op,_:op['result'].update(extra=True))

    def test_real_deferred_reason(self):
        self.real_deferred_cases((None,[],MISSING),
            lambda op,value:self.replace_field(op['result'],'reason',value))

    def test_real_deferred_finished_at(self):
        self.real_deferred_cases((99,100,0,MISSING,None,'211',True,float('inf')),
            lambda op,value:self.replace_field(op,'finished_at',value))

    def test_real_deferred_started_at(self):
        self.real_deferred_cases((99,100,None,'210',True,float('inf')),
            lambda op,value:self.replace_field(op,'started_at',value))

    def test_real_deferred_task_hash(self):
        self.real_deferred_cases(('other',MISSING,None),
            lambda op,value:self.replace_field(op,'task_hash',value))

    def test_real_deferred_malformed_result(self):
        self.real_deferred_cases((None,[],MISSING),lambda op,value:self.replace_field(op,'result',value))

    def test_real_second_charged_unknown_other_slot(self):
        self.shape_cases((None,),lambda _:self.extra_author(),'one confirmed runtime canary author required')

    def test_real_deferred_tampering_after_intent(self):
        # Still non-executing and otherwise valid: only the intent digest detects it.
        def mutate(kind):
            op=self.ops['slot2']['deferred-author']
            if kind=='reason': op['result']['reason']='other precall reason'
            if kind=='run': op['run']+=1
            if kind=='removed': del self.ops['slot2']['deferred-author']
            if kind=='moved': self.ops['slot1']['deferred-author']=self.ops['slot2'].pop('deferred-author')
        self.shape_cases(('reason','run','removed','moved'),mutate,'operation evidence changed',
                         phases=('pending','completed'))

    def test_real_new_valid_deferral_after_intent(self):
        self.shape_cases((None,),lambda _:self.ops['slot1'].update(extra=copy.deepcopy(self.deferred)),
                         'operation evidence changed',phases=('pending','completed'))

    def test_real_new_intent_fields_shape(self):
        def mutate(j,case): self.replace_field(j['qualification_intent'],*case)
        self.intent_cases((('policy_controller',MISSING),('policy_controller',[]),
                           ('deferred_operations',MISSING),('deferred_operations',[]),
                           ('deferred_operations',{'slot3':{}}),
                           ('deferred_operations',{'slot2':{'deferred-author':5}})),mutate)

    def test_real_rollback_controller_drift(self):
        self.call(); self.change(self.policy,mode='disabled',controller_sha='c'*40)
        self.assert_no_writes(lambda:U.rollback_runtime(SimpleNamespace(quiet=Mock())),
                             'runtime rollback identity drift')

    def test_real_rollback_history_controller_pin(self):
        self.call(); self.change(self.policy,mode='disabled')
        C=SimpleNamespace(quiet=Mock()); U.rollback_runtime(C)
        j=json.loads(self.journal.read_text())
        j['qualification_history'][-1]['intent']['policy_controller']='c'*40
        self.real_atomic(self.journal,j)
        self.assert_no_writes(lambda:U.rollback_runtime(C),'runtime rollback replay drift')


    @contextmanager
    def cheap_validation(self):
        """Shape/semantic loops use trusted synthetic bytes, avoiding the O(tree)
        metadata fixture at every descriptor. Dedicated metadata tests retain
        runtime_bytes and TrustedRuntimeTree unchanged.
        """
        def read(path, limit=64 << 20):
            try:
                raw=Path(path).read_bytes()
            except OSError:
                raise core.Refused('runtime evidence missing or unsafe')
            R.need(len(raw)<=limit,'runtime evidence too large')
            return raw
        with patch.object(U,'runtime_bytes',side_effect=read): yield

    def restore_snapshot(self, files):
        for name,raw in files.items(): Path(name).write_bytes(raw)

    def r4_phases(self, phases=('initial','pending','completed','rollback','rollback-replay')):
        initial=self.snapshot(); ops=copy.deepcopy(self.ops)
        for phase in phases:
            self.restore_snapshot(initial); self.ops=copy.deepcopy(ops); self.writes.clear()
            if phase=='pending': self.interrupt_before_marker()
            elif phase!='initial': self.call()
            if phase.startswith('rollback'):
                self.change(self.policy,mode='disabled')
                if phase=='rollback-replay': U.rollback_runtime(SimpleNamespace(quiet=Mock()))
            baseline=self.snapshot(); operations=copy.deepcopy(self.ops)
            yield phase, baseline, operations

    def r4_invoke(self, phase, dry_run=False):
        if phase.startswith('rollback'): return U.rollback_runtime(SimpleNamespace(quiet=Mock()))
        return self.call(dry_run=dry_run)

    def test_real_r4_journal_proof_binding_all_callers(self):
        cases=(MISSING,None,[],{},'wrong-proof',{'acceptance_basis':'DEV_ACCEPTED'})
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases(('pending','completed','rollback','rollback-replay')):
                for value in cases:
                    if phase=='rollback-replay' and value is MISSING: continue
                    for dry in (False,True):
                        with self.subTest(phase=phase,value=value,dry=dry):
                            self.restore_snapshot(baseline)
                            self.mutate_file(self.journal,'accepted_canary',value)
                            self.assert_no_writes(lambda:self.r4_invoke(phase,dry),'journal acceptance proof drift')
                if phase in ('pending','completed'):
                    self.restore_snapshot(baseline)
                    j=json.loads(self.journal.read_text()); p=json.loads(self.policy.read_text())
                    marker=json.loads(self.marker.read_text())
                    prepared=U.runtime_completion_preflight(j,p,marker)
                    j['accepted_canary']=None
                    self.assert_no_writes(lambda:U.runtime_completion_preflight(j,p,marker),'journal acceptance proof drift')
                    self.assert_no_writes(lambda:U.runtime_completion_write(*prepared),'journal acceptance proof drift')
                    self.assert_no_writes(lambda:U.complete_qualification(j,p,marker),'journal acceptance proof drift')

    def test_real_r4_rollback_operation_shapes_and_pins(self):
        cases=('slot-null','op-null','result-null','issue-bool','author-digest','deferred-digest',
               'deferred-missing','deferred-moved','slot1-malformed','slot1-bool')
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases(('pending','rollback','rollback-replay')):
                # pending rollback also uses disabled/quiescent window.
                if phase=='pending':
                    self.change(self.policy,mode='disabled'); baseline=self.snapshot()
                for case in cases:
                    with self.subTest(phase=phase,case=case):
                        self.restore_snapshot(baseline); self.ops=copy.deepcopy(ops)
                        if case=='slot-null': self.ops['slot2']=None
                        if case=='op-null': self.ops['slot2']['author']=None
                        if case=='result-null': self.ops['slot2']['author']['result']=None
                        if case=='issue-bool': self.ops['slot2']['author']['binding']['issue']=True
                        if case=='author-digest': self.ops['slot2']['author']['run']+=1
                        if case=='deferred-digest': self.ops['slot2']['deferred-author']['result']['reason']='changed'
                        if case=='deferred-missing': del self.ops['slot2']['deferred-author']
                        if case=='deferred-moved': self.ops['slot1']['moved']=self.ops['slot2'].pop('deferred-author')
                        if case=='slot1-malformed': self.ops['slot1']['bad']={'binding':None}
                        if case=='slot1-bool': self.ops['slot1']['bad']={'binding':{'issue':True,'stage':'author'}}
                        self.assert_no_writes(lambda:U.rollback_runtime(SimpleNamespace(quiet=Mock())),
                                              'malformed|operation evidence changed')

    def test_real_r4_rollback_allows_later_unrelated_activity(self):
        with self.cheap_validation():
            self.call(); self.change(self.policy,mode='disabled')
            for slot in ('slot1','slot2'):
                self.ops[slot]['later']={'binding':{'issue':999,'stage':'author'},'result':None}
                self.ops[slot]['later-other-task-author']={'binding':{'issue':225,'stage':'author'},
                    'task_hash':'another-task','run':501,'result':{'status':'failed'}}
                self.ops[slot]['later-qa']={'binding':{'issue':225,'stage':'qa'},'finished_at':400,
                                          'task_hash':'another-task','result':None}
            operations=copy.deepcopy(self.ops)
            self.assertEqual(U.rollback_runtime(SimpleNamespace(quiet=Mock()))['phase'],'active-canary')
            self.assertEqual(U.rollback_runtime(SimpleNamespace(quiet=Mock()))['phase'],'active-canary')
            self.assertEqual(self.ops,operations)

    def test_real_r4_runtime_validation_controller_guard_independent(self):
        with self.cheap_validation():
            self.interrupt_before_marker()
            j=json.loads(self.journal.read_text()); p=json.loads(self.policy.read_text())
            j['qualification_intent']['policy_controller']='c'*40
            self.assert_no_writes(lambda:U.runtime_validation(j,p,j['qualification_intent']),
                                  'qualification policy controller drift')

    def test_real_r4_rollback_controller_guard_independent(self):
        with self.cheap_validation():
            self.call(); self.change(self.policy,mode='disabled')
            j=json.loads(self.journal.read_text()); j['qualification_intent']['policy_controller']='c'*40
            self.real_atomic(self.journal,j)
            self.assert_no_writes(lambda:U.rollback_runtime(SimpleNamespace(quiet=Mock())),
                                  'runtime rollback identity drift')

    def test_real_r4_identity_state_shape_guard_independent(self):
        with self.cheap_validation():
            j=json.loads(self.journal.read_text()); p=json.loads(self.policy.read_text())
            marker=json.loads(self.marker.read_text()); j['qualification_history']={}
            self.assert_no_writes(lambda:U.runtime_identity(j,p,marker),'malformed journal: qualification_history')

    def attestation_fixture(self):
        """Synthetic originals with real hashes; missing pin stays the real Owner pin.
        No protected artifact is read or reconstructed.
        """
        def artifact(key,raw):
            name=self.evidence[key][0]; (self.state/name).write_bytes(raw)
            self.evidence[key]=(name,hashlib.sha256(raw).hexdigest())
        artifact('runtime_qa_v18_stream',b'{}\n'*28536)
        artifact('runtime_qa_v20_stream',b'{}\n'+b' '*130269)
        qa={'schema':'GB_CURSOR_INDEPENDENT_RUNTIME_QA_211_V1',
            'verdict':'PASS_FOR_NATIVE_SHELL_AND_PROTECTED_HOST_BOUNDARIES',
            'reviewer':'independent native_boundary_qa',
            'stream_sha256':self.evidence['runtime_qa_v20_stream'][1],'stream_bytes':130272,
            'guard_sha256':U.RUNTIME_MODULES['native_guard.py'],'effective_route_label':'Auto',
            'requested_model':'auto','launcher_reported_credential_leak_files':[],
            'original_receipt_sha256':'5ac9e5e0fb8b20c7cc00242f99858db56c6368af7842f5e95a58543397c47943',
            'launcher_sha256':'489d365b314b1741ebfb9a5aaf649c73f1a5ef85e9583a8d219fa07142d73084',
            'actual_tool_started_count':12,'actual_tool_completed_count':12,
            'checks':{key:True for key in (
                'Auto_route_observed','CLI_PID_finished','actual_permissions_preserved',
                'actual_sandbox_fields_preserved','actual_user_hash_matches_stdin_receipt',
                'all_shell_requests_workspace_policy','allowed_edit_exact','full_trusted_rules_in_user_event',
                'generated_inside_output_exact','guard_source_hash_matches_receipt','host_cross_unchanged',
                'host_outside_target_not_bound','host_outside_unchanged','host_protected_fixture_unchanged',
                'input_unchanged','no_auth_file_persisted','no_skipApproval','node_pnpm_test_build_actual_success',
                'outer_guard_private_tmpfs','recorded_privilege_boundary','stream_hash_matches_receipt',
                'stream_size_matches_receipt','symlink_targets_preserved','terminal_success')}}
        artifact('runtime_qa_v20_qa',json.dumps(qa).encode())
        self.attestation_qa=qa
        missing=U.RUNTIME_MISSING_EVIDENCE
        (self.state/missing['name']).unlink()
        self.evidence[missing['key']]=(missing['name'],missing['sha256'])
        self.refresh_proof()

    def refresh_proof(self):
        self.proof['evidence']={k:{'path':str(self.state/name),'sha256':sha}
                                for k,(name,sha) in self.evidence.items()}
        self.proof_path.write_text(json.dumps(self.proof))
        self.proof_sha=hashlib.sha256(self.proof_path.read_bytes()).hexdigest()

    def test_real_r4_absent_launcher_attestation_receipt_and_replay(self):
        self.attestation_fixture()
        with self.cheap_validation():
            preview=self.call(dry_run=True); self.assertEqual(self.writes,[])
            proof=preview['accepted_canary']; att=proof['attestation']
            self.assertEqual(att['missing_artifact'],U.RUNTIME_MISSING_EVIDENCE)
            self.assertEqual(att['bound_sha256'],{k:v[1] for k,v in self.evidence.items()
                             if k!='runtime_qa_v18_launcher'})
            self.assertEqual(len(att['bound_sha256']),11)
            self.assertEqual(proof['evidence']['runtime_qa_v18_launcher']['status'],
                             'ABSENT_REPLACED_BY_ATTESTATION')
            self.interrupt_before_marker(); self.assertEqual(self.call()['accepted_canary'],proof)
            self.assertEqual(self.call()['accepted_canary'],proof)
            j=json.loads(self.journal.read_text()); marker=json.loads(self.marker.read_text())
            self.assertEqual(j['accepted_canary'],j['qualification_intent']['proof'])
            self.assertEqual(marker['accepted_canary'],proof)
            self.change(self.policy,mode='disabled')
            U.rollback_runtime(SimpleNamespace(quiet=Mock())); U.rollback_runtime(SimpleNamespace(quiet=Mock()))
            self.assertFalse((self.state/U.RUNTIME_MISSING_EVIDENCE['name']).exists())

    def test_real_r4_present_launcher_no_attestation(self):
        # Existing 12-file fixture has a pinned launcher with actual matching bytes.
        with self.cheap_validation():
            proof=self.call()['accepted_canary']
            self.assertNotIn('attestation',proof)
            self.assertNotIn('status',proof['evidence']['runtime_qa_v18_launcher'])

    def test_real_r4_other_eleven_files_remain_mandatory(self):
        self.attestation_fixture()
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases():
                for key,(name,_) in self.evidence.items():
                    if key=='runtime_qa_v18_launcher': continue
                    for missing in (False,True):
                        for dry in (False,True):
                            with self.subTest(phase=phase,key=key,missing=missing,dry=dry):
                                self.restore_snapshot(baseline); path=self.state/name
                                if missing: path.unlink()
                                else: path.write_bytes(b'changed')
                                self.assert_no_writes(lambda:self.r4_invoke(phase,dry),'runtime evidence')
                self.restore_snapshot(baseline)

    def test_real_r4_launcher_wrong_bytes_and_metadata(self):
        # All phases, including no-write preview, retain the real safe reader.
        with self.cheap_validation():
            states=list(self.r4_phases())
        for phase,baseline,ops in states:
            for kind in ('wrong','symlink','directory','unreadable','eacces'):
                for dry in (False,True):
                    with self.subTest(phase=phase,kind=kind,dry=dry):
                        self.restore_snapshot(baseline); path=self.state/self.evidence['runtime_qa_v18_launcher'][0]
                        original=path.read_bytes()
                        try:
                            if kind=='wrong': path.write_bytes(b'wrong launcher')
                            if kind=='symlink': path.unlink(); path.symlink_to(self.state/self.evidence['probe'][0])
                            if kind=='directory': path.unlink(); path.mkdir()
                            if kind=='unreadable': path.chmod(0)
                            if kind=='eacces':
                                real_open=os.open
                                def open_denied(name,*a,**kw):
                                    if name==path.name: raise PermissionError(errno.EACCES,'synthetic EACCES')
                                    return real_open(name,*a,**kw)
                                with patch.object(U.os,'open',side_effect=open_denied):
                                    self.assert_no_writes(lambda:self.r4_invoke(phase,dry),'runtime evidence')
                            elif kind=='unreadable':
                                # Snapshot after restoring permission can compare all bytes;
                                # the refused invocation itself sees the real mode-000 file.
                                count=len(self.writes); published=R.publish_monitor.call_count
                                with self.assertRaises(core.Refused): self.r4_invoke(phase,dry)
                                self.assertEqual(len(self.writes),count)
                                self.assertEqual(R.publish_monitor.call_count,published)
                                path.chmod(0o644)
                                self.assertEqual(self.snapshot(),baseline)
                            else:
                                self.assert_no_writes(lambda:self.r4_invoke(phase,dry),'runtime evidence')
                        finally:
                            if path.is_symlink(): path.unlink()
                            elif path.is_dir(): path.rmdir()
                            if not path.exists(): path.write_bytes(original)
                            path.chmod(0o644)

    def test_real_r4_attestation_semantic_checks(self):
        self.attestation_fixture()
        # Re-pin synthetic mutations so refusal specifically tests derivation, rather
        # than stopping at a hash mismatch. Production's pins are never changed.
        cases=[('qa',key,'wrong') for key in self.attestation_qa if key!='checks']
        cases += [('qa','stream_bytes',True),('qa','actual_tool_started_count',True),
                  ('qa','actual_tool_completed_count',True)]
        for key in self.attestation_qa['checks']:
            cases.extend((('check',key,False),('check',key,MISSING),('check',key,1)))
        cases += [('check','extra',True),('duplicate','schema',None),
                  ('v18','size',None),('v18','jsonl',None),('v18','empty',None),('v18','nan',None),('v18','blank',None),('v20','size',None),('v20','size-pair',None)]
        initial=self.snapshot(); pins=copy.deepcopy(self.evidence); proof_sha=self.proof_sha
        with self.cheap_validation():
            for case in cases:
                with self.subTest(case=case):
                    self.restore_snapshot(initial); self.evidence.clear(); self.evidence.update(pins)
                    kind,key,value=case; qa=copy.deepcopy(self.attestation_qa)
                    target='runtime_qa_v20_qa'
                    if kind=='qa': qa[key]=value
                    if kind=='check': self.replace_field(qa['checks'],key,value)
                    raw=json.dumps(qa).encode()
                    if kind=='duplicate': raw=raw[:-1]+b',"schema":"GB_CURSOR_INDEPENDENT_RUNTIME_QA_211_V1"}'
                    if kind=='v18':
                        target='runtime_qa_v18_stream'
                        raw={'size':b'{}\n','jsonl':b'x'*85608,'empty':b'',
                             'nan':b'NaN'+b' '*85604+b'\n','blank':b'\n'+b' '*85607}[key]
                    if kind=='v20': target='runtime_qa_v20_stream'; raw=b'wrong size'
                    name=self.evidence[target][0]; (self.state/name).write_bytes(raw)
                    self.evidence[target]=(name,hashlib.sha256(raw).hexdigest())
                    # v20 size probe must get past QA's explicit stream SHA check.
                    if kind=='v20':
                        qa['stream_sha256']=self.evidence[target][1]
                        if key=='size-pair': qa['stream_bytes']=len(raw)
                        qname=self.evidence['runtime_qa_v20_qa'][0]; qraw=json.dumps(qa).encode()
                        (self.state/qname).write_bytes(qraw)
                        self.evidence['runtime_qa_v20_qa']=(qname,hashlib.sha256(qraw).hexdigest())
                    self.refresh_proof()
                    for dry in (False,True):
                        self.assert_no_writes(lambda:self.call(dry_run=dry),'attestation|duplicate JSON key|malformed or unreadable')
            self.restore_snapshot(initial); self.evidence.clear(); self.evidence.update(pins); self.proof_sha=proof_sha

    def test_real_r4_attestation_semantics_checked_during_all_replays(self):
        self.attestation_fixture()
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases(('pending','completed','rollback','rollback-replay')):
                for kind in ('derivation','journal','intent'):
                    with self.subTest(phase=phase,kind=kind):
                        self.restore_snapshot(baseline)
                        if kind=='derivation':
                            with patch.object(U,'verify_runtime_attestation',return_value={'forged':True}):
                                self.assert_no_writes(lambda:self.r4_invoke(phase),'operation evidence changed')
                        else:
                            j=json.loads(self.journal.read_text())
                            if phase=='rollback-replay':
                                if kind=='journal': j['accepted_canary']={'attestation':{'forged':True}}
                                else: j['qualification_history'][-1]['intent']['proof']['attestation']={'forged':True}
                            elif kind=='journal': j['accepted_canary']['attestation']={'forged':True}
                            else: j['qualification_intent']['proof']['attestation']={'forged':True}
                            self.real_atomic(self.journal,j)
                            self.assert_no_writes(lambda:self.r4_invoke(phase),'proof drift|operation evidence changed')

    def test_real_r4_launcher_appearing_after_intent_refused(self):
        self.attestation_fixture()
        with self.cheap_validation():
            states=list(self.r4_phases(('pending','completed','rollback','rollback-replay')))
            for phase,baseline,ops in states:
                with self.subTest(phase=phase):
                    self.restore_snapshot(baseline)
                    # Synthetic matching launcher, with unchanged proof-file SHA:
                    # isolate the evidence mode transition from the file hash gate.
                    path=self.state/U.RUNTIME_MISSING_EVIDENCE['name']; path.write_bytes(b'recovered original')
                    real_hash=U.hashlib.sha256
                    def recovered_hash(raw):
                        if raw==b'recovered original':
                            return SimpleNamespace(hexdigest=lambda:U.RUNTIME_MISSING_EVIDENCE['sha256'])
                        return real_hash(raw)
                    with patch.object(U.hashlib,'sha256',side_effect=recovered_hash):
                        self.assert_no_writes(lambda:self.r4_invoke(phase),'operation evidence changed')
                    path.unlink()
            # A new transaction after the completed rollback uses the recovered
            # matching original normally; prior attestation stays in history.
            self.change(self.policy,mode='active')
            path.write_bytes(b'recovered original')
            with patch.object(U.hashlib,'sha256',side_effect=recovered_hash):
                result=self.call()
                self.assertNotIn('attestation',result['accepted_canary'])
                self.assertNotIn('attestation',self.call()['accepted_canary'])
            self.assertIn('attestation',json.loads(self.journal.read_text())[
                'qualification_history'][-1]['intent']['proof'])

    def test_real_r4_missing_declaration_is_closed(self):
        self.attestation_fixture()
        declarations=[dict(U.RUNTIME_MISSING_EVIDENCE,**{key:value}) for key,value in (
            ('key','probe'),('name','cursor-qualification-20261022/other.py'),
            ('sha256','0'*64),('name','cursor-qualification-20261022/runtime-qa-v18-*'))]
        with self.cheap_validation():
            for declaration in declarations:
                with patch.object(U,'RUNTIME_MISSING_EVIDENCE',declaration):
                    self.assert_no_writes(U.runtime_missing_declaration,'declaration changed')
            for phase,baseline,ops in self.r4_phases():
                for declaration in declarations:
                    with self.subTest(phase=phase,declaration=declaration):
                        self.restore_snapshot(baseline)
                        with patch.object(U,'RUNTIME_MISSING_EVIDENCE',declaration):
                            self.assert_no_writes(lambda:self.r4_invoke(phase),'declaration changed')



    def test_real_r4_seeded_state_field_fuzz(self):
        """Every existing field/container is independently mutated at all four phases.
        Closed list of deliberately non-admission data allowed to be ignored:
        historical_fail/preserved;
        install-time backup metadata and old change hashes; optional empty history;
        historical QA verdicts; live backup metadata with shape-valid values;
        timestamps not used by an already-completed rollback. Marker fields are
        never ignored: its canonical byte hash binds even descriptive metadata.
        """
        self.attestation_fixture()
        verified={key:(self.state/name).read_bytes() for key,(name,sha) in self.evidence.items()
                  if key!='runtime_qa_v18_launcher'}
        real_verify=U.verify_runtime_attestation
        cached_attestation=real_verify(verified)
        def memoized_verify(artifacts):
            # Same already-verified immutable bytes => same pure derivation. A
            # different input still runs the production verifier in full.
            return copy.deepcopy(cached_attestation) if artifacts==verified else real_verify(artifacts)
        seed=random.Random(3070405)
        variants=[MISSING,None,[],{},'wrong',{'nested':[None]},True,10**100,float('nan')]
        # Explicit path prefixes, never learned from successful fuzz outcomes.
        ignored={
            'journal':(('historical_fail',),('preserved',),('record_before','manifest'),
                ('record_before','before'),('record_before','units'),('record_before','activated'),
                ('record_before','targets'),('qualification_history',),('runtime_rollback_at',)),
            'policy':(), 'marker':(),
            'slot1':(),
            'slot2':(('operations','qa-fail','result'),('operations','qa-fail','finished_at')),
            'backup':(('manifest',),('before',),('units',),('activated',),('targets',))}
        # Inventory ancestry uses keys; live hashes, not historic hash values,
        # govern installed bytes. changes.before is retained solely as history.
        optional_live_names={'antigravity_qa_recovery.py','content_identity.py','context_exchange.py',
                             'failure_diagnosis.py','native_antigravity.py','owner_package_admission.py',
                             'qa_equivalence.py'}
        def ignored_path(source,path,phase):
            if source=='backup' and len(path)==2 and path[0]=='after':
                return path[1] in {str(self.install/name) for name in optional_live_names}
            if source=='slot2' and phase.startswith('rollback') and path[:2]==('operations','qa-fail'):
                return len(path)>=2  # Shape-valid QA history is not a rollback qualification gate.
            if source=='journal':
                if len(path)==3 and path[:2]==('record_before','after'): return True
                if len(path)==2 and path[0]=='changes' and path[1]!=str(self.marker): return True
                if len(path)==3 and path[0]=='changes':
                    return path[2]=='before' or (path[2]=='after' and path[1]!=str(self.marker))
                if path and path[0]=='qualification_history' and phase=='rollback-replay':
                    return len(path)==3 and path[2]=='rolled_back_at'
            return any(path[:len(prefix)]==prefix for prefix in ignored[source])
        def paths(value,prefix=()):
            if isinstance(value,dict):
                for key,child in value.items():
                    yield prefix+(key,)
                    yield from paths(child,prefix+(key,))
            elif isinstance(value,list):
                for index,child in enumerate(value):
                    yield prefix+(index,)
                    yield from paths(child,prefix+(index,))
        tested=0; ignored_count=0
        with self.cheap_validation():
            phases=list(self.r4_phases(('pending','completed','rollback','rollback-replay')))
        for phase,baseline,operations in phases:
            self.restore_snapshot(baseline); self.ops=copy.deepcopy(operations)
            records={'journal':json.loads(self.journal.read_text()),'policy':json.loads(self.policy.read_text()),
                     'marker':json.loads(self.marker.read_text()),'backup':json.loads(self.backup.read_text()),
                     **{slot:{'operations':copy.deepcopy(operations[slot])} for slot in ('slot1','slot2')}}
            if phase!='rollback-replay': records['journal'].setdefault('qualification_history',[])
            raw_files={Path(name):raw for name,raw in baseline.items()}
            current={}
            def read(path,*args):
                key={self.journal:'journal',self.policy:'policy',self.marker:'marker'}[path]
                return current[key]
            def raw(path,limit=64 << 20):
                path=Path(path)
                if path==self.marker: return json.dumps(current['marker'],sort_keys=True).encode()
                if path==self.backup: return json.dumps(current['backup']).encode()
                return raw_files[path]
            def invoke():
                action='rollback-runtime' if phase.startswith('rollback') else 'accept-runtime'
                return U.execute(action,self.bundle,'m','c'*40,'s','d',proof_sha256=
                                 self.proof_sha if action=='accept-runtime' else None)
            with patch.object(U,'verify_runtime_attestation',new=memoized_verify), \
                 patch.object(R,'read',new=read),patch.object(R,'journal',new=
                    lambda slot:current[slot]),patch.object(U,'runtime_bytes',new=raw), \
                 patch.object(U.os,'geteuid',new=lambda:0),patch.object(R,'trusted_tree',new=lambda _:None), \
                 patch.object(U,'helpers',new=lambda _:(SimpleNamespace(quiet=lambda:None),None)), \
                 patch.object(R,'atomic') as atomic,patch.object(R,'publish_monitor') as publish:
                current=copy.deepcopy(records); expected=invoke()
                expected_destinations=[c.args[0] for c in atomic.call_args_list]; expected_publish=publish.call_count
                cases=[(source,path,value) for source,record in records.items()
                       for path in [(),*paths(record)] for value in variants]
                seed.shuffle(cases)
                for source,path,value in cases:
                    with self.subTest(seed=3070405,phase=phase,source=source,path=path,value=value):
                        current=copy.deepcopy(records); atomic.reset_mock(); publish.reset_mock()
                        if not path:
                            current[source]=None if value is MISSING else copy.deepcopy(value)
                        else:
                            parent=current[source]
                            for key in path[:-1]: parent=parent[key]
                            key=path[-1]
                            if value is MISSING:
                                if isinstance(parent,list): del parent[key]
                                else: parent.pop(key)
                            else: parent[key]=copy.deepcopy(value)
                        equivalent=core.digest(current)==core.digest(records)
                        tested+=1
                        try:
                            result=invoke()
                        except core.Refused:
                            atomic.assert_not_called(); publish.assert_not_called()
                        else:
                            self.assertTrue(equivalent or ignored_path(source,path,phase),
                                            'accepted mutation outside explicit ignored set')
                            self.assertEqual(result,expected)
                            # Ignored history may be carried through writes. The
                            # destinations/count remain exactly the baseline plan.
                            self.assertEqual([c.args[0] for c in atomic.call_args_list],
                                             expected_destinations)
                            self.assertEqual(publish.call_count,expected_publish)
                            ignored_count+=not equivalent
        print('R4 seeded fuzz: seed=3070405 cases='+str(tested)+' accepted_ignored='+str(ignored_count))
        self.assertGreater(tested,5000)
        self.assertGreater(ignored_count,0)
        self.assertEqual(self.snapshot(),baseline)



    def test_real_r4_attestation_artifact_set_independent(self):
        self.attestation_fixture()
        artifacts={key:(self.state/name).read_bytes() for key,(name,sha) in self.evidence.items()
                   if key!='runtime_qa_v18_launcher'}
        self.assert_no_writes(lambda:U.verify_runtime_attestation(artifacts | {'extra':b''}),
                              'attestation artifacts changed')
        with patch.dict(U.RUNTIME_EVIDENCE,{'extra':('extra',hashlib.sha256(b'').hexdigest())}):
            self.assert_no_writes(lambda:U.verify_runtime_attestation(artifacts | {'extra':b''}),
                                  'attestation artifacts changed')

    def test_real_r4_absence_probe_only_enoent_and_exact_pin(self):
        self.attestation_fixture(); missing=U.RUNTIME_MISSING_EVIDENCE
        path=self.state/missing['name']; original_lstat=Path.lstat
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases():
                for error in (errno.EACCES,errno.ELOOP,errno.ENOTDIR,errno.EIO):
                    self.restore_snapshot(baseline); before=self.snapshot()
                    count=len(self.writes); pubs=R.publish_monitor.call_count
                    def probe(p,*args,**kwargs):
                        if p==path: raise OSError(error,'synthetic absence probe error')
                        return original_lstat(p,*args,**kwargs)
                    with self.subTest(phase=phase,error=error),patch.object(Path,'lstat',probe):
                        with self.assertRaisesRegex(core.Refused,'runtime evidence missing or unsafe'):
                            self.r4_invoke(phase)
                    self.assertEqual(self.snapshot(),before); self.assertEqual(len(self.writes),count)
                    self.assertEqual(R.publish_monitor.call_count,pubs)
            # The declaration remains exact while the expected proof map is changed
            # to a different absent key/path/hash. None may inherit its exception.
            for field,value in (('key','not-the-launcher'),('name','cursor-qualification-20261022/other.py'),
                                ('sha256','0'*64),('name','cursor-qualification-20261022/runtime-qa-v18-*')):
                self.restore_snapshot(baseline)
                pins=copy.deepcopy(self.evidence); name,sha=pins.pop(missing['key'])
                key=value if field=='key' else missing['key']
                pins[key]=(value if field=='name' else name,value if field=='sha256' else sha)
                # Initial state isolates the exact absent item test from replay SHA bindings.
                j=json.loads(self.journal.read_text()); j.pop('qualification_history',None)
                self.real_atomic(self.journal,j); self.change(self.policy,mode='active')
                proof=copy.deepcopy(self.proof)
                proof['evidence']={k:{'path':str(self.state/n),'sha256':h} for k,(n,h) in pins.items()}
                self.proof_path.write_text(json.dumps(proof))
                with patch.object(U,'RUNTIME_EVIDENCE',pins):
                    self.assert_no_writes(lambda:U.accept_runtime(self.bundle,dry_run=True),'runtime evidence')

    def test_real_r4_empty_operation_pin_refused_during_rollback(self):
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases(('rollback','rollback-replay')):
                self.restore_snapshot(baseline)
                j=json.loads(self.journal.read_text())
                intent=(j['qualification_history'][-1]['intent'] if phase=='rollback-replay'
                        else j['qualification_intent'])
                intent['operations']={}
                self.real_atomic(self.journal,j)
                self.assert_no_writes(lambda:self.r4_invoke(phase),'operation evidence changed')



    def test_real_r4_shared_slot_author_shape_independent(self):
        for slot in ('slot1','slot2'):
            before=copy.deepcopy(self.ops)
            self.ops[slot]['malformed']={'binding':{'issue':225,'stage':'author'},'run':500,'result':None}
            self.assert_no_writes(lambda:U.runtime_slot_operations(slot),'malformed operation record')
            self.ops=before

    def test_real_r4_pinned_author_cardinality_independent(self):
        with self.cheap_validation():
            self.call(); intent=json.loads(self.journal.read_text())['qualification_intent']
            # A fabricated map covering every canary author as a deferral must
            # still retain exactly one qualified author pin.
            intent['deferred_operations'].setdefault('slot2',{})['author']=core.digest(self.ops['slot2']['author'])
            intent['operations']={}
            self.assert_no_writes(lambda:U.runtime_pinned_operations(intent),'operation evidence changed')



    def test_real_r4_rollback_history_marker_binding(self):
        with self.cheap_validation():
            self.call(); self.change(self.policy,mode='disabled')
            U.rollback_runtime(SimpleNamespace(quiet=Mock()))
            j=json.loads(self.journal.read_text())
            j['qualification_history'][-1]['intent']['next_marker']['qualified_at']+=1
            self.real_atomic(self.journal,j)
            self.assert_no_writes(lambda:U.rollback_runtime(SimpleNamespace(quiet=Mock())),
                                  'runtime rollback marker intent changed')



    def test_real_r4_empty_deferral_pins_refused(self):
        with self.cheap_validation():
            for phase,baseline,ops in self.r4_phases(('rollback','rollback-replay')):
                self.restore_snapshot(baseline)
                j=json.loads(self.journal.read_text())
                intent=(j['qualification_history'][-1]['intent'] if phase=='rollback-replay'
                        else j['qualification_intent'])
                intent['deferred_operations']={}
                self.real_atomic(self.journal,j)
                self.assert_no_writes(lambda:self.r4_invoke(phase),'operation evidence changed')


class CommittedProof(unittest.TestCase):
    def test_committed_proof_has_exact_production_pins_and_closed_schema(self):
        proof=json.loads((ROOT/U.QUALIFICATION_PROOF).read_text())
        self.assertEqual(proof,{'schema':'GB_CURSOR_RUNTIME_QUALIFICATION_PROOF_V1',
            'acceptance_basis':'runtime_qualification','canary_task_sha256':core.digest(TASK),
            'evidence':{k:{'path':str(U.STATE/name),'sha256':sha} for k,(name,sha) in U.RUNTIME_EVIDENCE.items()}})
        self.assertEqual(len(proof['evidence']),12)
        for name,sha in U.RUNTIME_MODULES.items():
            self.assertEqual(hashlib.sha256(installed_runtime_modules()[name]).hexdigest(),sha)




if __name__=='__main__': unittest.main()
