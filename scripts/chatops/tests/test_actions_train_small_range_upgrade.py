"""Two-file upgrade: synthetic fake-root transactions, strict stack and source gates."""
import ast
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
REPO=Path(__file__).resolve().parents[3]
SCRIPT=REPO/'scripts/chatops/ops/agy29_small_range_upgrade.py'

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value)
    return value

I=module('small_range_upgrade',SCRIPT)
H=lambda raw:hashlib.sha256(raw).hexdigest()
SS=H(SCRIPT.read_bytes())
COMMIT='a'*40
NAME=I.ADMISSION_MODULE
QA='antigravity_qa_recovery.py'
OLD,NEW=b'old admission module',b'new admission module'
QOLD,QNEW=b'old qa module',b'new qa module'
PRE326=b'pre-326 admission module'
MATERIAL={QA:QNEW,NAME:NEW}
BASELINE={QA:QOLD,NAME:OLD}


def installed_source(path):
    # Read only local repository bytes; no Git metadata writes or network.
    return (REPO/path).read_bytes()


class Fixture:
    def __init__(self,test,pretty=False):
        self.root=Path(tempfile.mkdtemp(prefix='small-range-upgrade-',dir=os.environ.get('TMPDIR') or None))
        test.addCleanup(lambda:shutil.rmtree(self.root,True))
        self.stack=contextlib.ExitStack();test.addCleanup(self.stack.close)
        self.lib=self.root/'lib';self.lib.mkdir()
        self.state=self.root/'state';self.state.mkdir()
        autonomy=self.root/'autonomy'
        for slot in ('slot1','slot2'):(autonomy/'slots'/slot).mkdir(parents=True)
        (autonomy/'locks').mkdir()
        self.paths=dict(LIB=self.lib,STATE=self.state,AUTONOMY=autonomy,POLICY=self.root/'policy',
            MARKER=self.root/'marker',BUDGET=self.root/'budget',INVENTORY=self.state/'backup.json',
            J=self.state/'agy29-small-range-upgrade-r2.json',BK=self.state/'agy29-small-range-upgrade-r2-backup',
            PREVIOUS_J=self.state/'agy29-small-range-upgrade.json',
            PREVIOUS_BK=self.state/'agy29-small-range-upgrade-backup')
        for key,value in self.paths.items():self.patch(key,value)
        self.patch('OWNER_UID',os.getuid());self.patch('OWNER_GID',os.getgid())
        self.stack.enter_context(patch.object(I.os,'fchown'))
        self.patch('TARGETS',{name:(H(BASELINE[name]),H(raw)) for name,raw in MATERIAL.items()})
        self.patch('ADMISSION_OLD',H(PRE326))
        self.patch('RULES_INVENTORY_SHA',H(b'old rules'));self.patch('RULES_LIVE_SHA',H(b'installed rules'))
        self.pkg_pins={name:(H(('pkg old '+name).encode()),H(('pkg new '+name).encode()))
                       for name in I.PKG_TARGETS}
        self.pkg_pins[NAME]=(H(b'pkg original admission'),H(PRE326))
        self.pkg_pins[QA]=(H(('pkg old '+QA).encode()),H(QOLD))
        self.patch('PKG_TARGETS',self.pkg_pins)
        unchanged={}
        entries={}
        for name,pins in self.pkg_pins.items():
            raw=BASELINE[name] if name in BASELINE else ('pkg new '+name).encode()
            path=self.lib/name;path.write_bytes(raw);path.chmod(0o644);entries[str(path)]=H(raw)
            unchanged[path]=I.TARGETS[name][1] if name in I.TARGETS else H(raw)
        rules=self.lib/I.RULES_NAME;rules.write_bytes(b'installed rules');entries[str(rules)]=H(rules.read_bytes())
        unchanged[rules]=H(rules.read_bytes())
        for n in range(28):
            path=self.lib/('untouched'+str(n));path.write_bytes(('unchanged '+str(n)).encode())
            entries[str(path)]=H(path.read_bytes())
        self.patch('UNCHANGED',unchanged)
        self.inventory=dict(manifest=I.OLD_MANIFEST,after=entries,note='unchanged field')
        self.pretty=pretty;self.write_inventory()
        self.paths['INVENTORY'].chmod(0o600)
        self.paths['POLICY'].write_text(json.dumps(dict(mode='active',controller_sha=I.C,stage_workflow_sha256=I.STAGE_SHA)))
        for name in ('MARKER','BUDGET'):self.paths[name].write_text('{}')
        required=[self.state/'slot1.json',self.state/'slot2.json']
        for path in required:path.write_text('{"pending":null}')
        self.patch('REQUIRED_STATE',required)
        (self.state/'controller.lock').touch()
        (self.state/'planning.json').write_text('{"tick":1}')
        self.active={slot:None for slot in ('slot1','slot2')}
        self.receiver=SimpleNamespace(trusted_tree=lambda path:None,
            journal=lambda slot:json.loads((self.state/(slot+'.json')).read_bytes()),
            checkpoint=lambda slot:(dict(active=self.active[slot]),[]),no_models=Mock(),units_quiet=Mock(),
            UNITS=('synthetic-unit',))
        self.patch('R',self.receiver)
        proc_locks=self.root/'proc-locks';proc_locks.write_text('')
        self.patch('PROC_LOCKS',proc_locks)
        self.run=self.stack.enter_context(patch.object(I,'run',return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n'))
        self.smoke=self.stack.enter_context(patch.object(I,'smoke'))
        self.receipts={}
        c5_backup=self.state/I.C5_BACKUP_NAME;c5_backup.mkdir();(c5_backup/'rules').write_bytes(b'old rules')
        self.receipts['c5']=dict(schema=I.C5_SCHEMA,phase='active',controller_sha=I.C,
            manifest_sha256=I.OLD_MANIFEST,rules_sha256=I.RULES_LIVE_SHA,
            backups=dict(rules=dict(sha256=I.RULES_INVENTORY_SHA)))
        pkg_backup=self.state/I.PKG_BACKUP;pkg_backup.mkdir()
        before=copy.deepcopy(self.inventory)
        for name,pins in self.pkg_pins.items():
            before['after'][str(self.lib/name)]=pins[0]
            raw=b'pkg original admission' if name==NAME else ('pkg old '+name).encode()
            (pkg_backup/name).write_bytes(raw)
        (pkg_backup/'inventory').write_text(json.dumps(before,sort_keys=True))
        for name in ('marker','policy'):(pkg_backup/name).write_bytes(b'original '+name.encode())
        self.patch('RERECORD_NEW_SHA',H((pkg_backup/'inventory').read_bytes()))
        rr_backup=self.state/I.RERECORD_BACKUP;rr_backup.mkdir()
        stale=copy.deepcopy(before);stale['after'][str(rules)]=I.RULES_INVENTORY_SHA
        (rr_backup/'inventory').write_text(json.dumps(stale,indent=2))
        self.receipts['rr']=dict(schema=I.RERECORD_SCHEMA,phase='active',commit=I.RERECORD_COMMIT,
            new_sha256=I.RERECORD_NEW_SHA,script_sha256=I.RERECORD_SCRIPT_SHA,
            backups=dict(inventory=dict(sha256=H((rr_backup/'inventory').read_bytes()))))
        self.receipts['pkg']=dict(schema=I.PKG_SCHEMA,phase='active',commit=I.PKG_COMMIT,manifest=I.PKG_MANIFEST,
            observation_sha256=I.PKG_OBSERVATION,backups={p.name:dict(sha256=H(p.read_bytes())) for p in pkg_backup.iterdir()})
        admission_backup=self.state/I.ADMISSION_BACKUP;admission_backup.mkdir()
        pre=copy.deepcopy(self.inventory);pre['after'][str(self.lib/NAME)]=H(PRE326)
        pre_raw=json.dumps(pre,indent=2 if pretty else None,sort_keys=True).encode()
        (admission_backup/'inventory').write_bytes(pre_raw)
        (admission_backup/NAME).write_bytes(PRE326)
        target_meta=dict(sha256=H(PRE326),mode=0o644,uid=os.getuid(),gid=os.getgid())
        inventory_meta=dict(sha256=H(pre_raw),mode=0o600,uid=os.getuid(),gid=os.getgid())
        observed=dict(target=target_meta,inventory_meta=inventory_meta,inventory_sha256=H(pre_raw))
        self.receipts['admission']=dict(schema=I.ADMISSION_SCHEMA,phase='active',commit=I.ADMISSION_COMMIT,
            manifest=I.ADMISSION_MANIFEST,script_sha256=I.ADMISSION_SCRIPT_SHA,new_sha256=H(OLD),
            observation=observed,observation_sha256=I.digest(observed),
            backups={NAME:target_meta,'inventory':inventory_meta})
        for layer in self.receipts:self.write_receipt(layer)
        # Synthetic immutable first-attempt ROLLED_BACK receipt: isolated from
        # the NEW R2 journal, with exact old byte and metadata binding.
        old_items={**BASELINE,'inventory':self.paths['INVENTORY'].read_bytes()}
        self.paths['PREVIOUS_BK'].mkdir(mode=0o700)
        for name,raw in old_items.items():
            f=self.paths['PREVIOUS_BK']/name
            f.write_bytes(raw);f.chmod(0o600)
        earlier=dict(schema=I.SCHEMA,phase='rolled_back',commit=I.PREVIOUS_COMMIT,
            script_sha256=I.PREVIOUS_SCRIPT_SHA,manifest=I.MANIFEST,
            observation_sha256=I.PREVIOUS_OBSERVATION_SHA,
            backups={name:dict(sha256=H(raw),mode=0o600 if name=='inventory' else 0o644,
                               uid=os.getuid(),gid=os.getgid()) for name,raw in old_items.items()})
        receipt_raw=json.dumps(earlier,sort_keys=True).encode()
        self.paths['PREVIOUS_J'].write_bytes(receipt_raw)
        self.paths['PREVIOUS_J'].chmod(0o600)
        self.patch('PREVIOUS_RECEIPT_SHA',H(receipt_raw))
        self.patch('PREVIOUS_BACKUP_SHA',{name:H(raw) for name,raw in old_items.items()})

    def patch(self,key,value):self.stack.enter_context(patch.object(I,key,value))

    def receipt_path(self,layer):
        return self.state/{'rr':I.RERECORD_NAME,'pkg':I.PKG_NAME,'c5':I.C5_RECEIPT_NAME,'admission':I.ADMISSION_NAME}[layer]

    def write_receipt(self,layer,edit=None):
        value=copy.deepcopy(self.receipts[layer])
        if edit:edit(value)
        raw=json.dumps(value,sort_keys=True).encode();self.receipt_path(layer).write_bytes(raw)
        self.patch({'rr':'RERECORD_SHA','pkg':'PKG_SHA','c5':'C5_RECEIPT_SHA','admission':'ADMISSION_SHA'}[layer],H(raw))

    def write_inventory(self):
        self.paths['INVENTORY'].write_text(json.dumps(self.inventory,indent=2 if self.pretty else None,sort_keys=True))

    def tree(self):
        result={}
        for p in self.root.rglob('*'):
            st=p.lstat()
            result[p]=(p.read_bytes() if p.is_file() else None,stat.S_IMODE(st.st_mode),st.st_uid,st.st_gid)
        return result

    def apply(self):
        observation=I.observation()
        with contextlib.redirect_stdout(io.StringIO()),I.controller_lock():
            I.apply(MATERIAL,SS,COMMIT,I.digest(observation))
        return I.receipt_read(COMMIT)


class UpgradeTests(unittest.TestCase):
    def fixture(self,pretty=False):return Fixture(self,pretty)

    def assert_refuses_without_writes(self,f,message='.'):
        before=f.tree()
        with self.assertRaisesRegex(I.Refused,message):I.dry(SS,COMMIT)
        self.assertEqual(f.tree(),before)
        with self.assertRaisesRegex(I.Refused,message):I.apply(MATERIAL,SS,COMMIT,'0'*64)
        self.assertEqual(f.tree(),before)

    def cycle(self,pretty):
        f=self.fixture(pretty);before=f.tree();raw=I.INVENTORY.read_bytes()
        with contextlib.redirect_stdout(io.StringIO()) as output:I.dry(SS,COMMIT)
        dry=json.loads(output.getvalue())
        self.assertEqual(dry['status'],'DRY_PASS');self.assertEqual(dry['script_sha256'],SS)
        self.assertEqual((dry['model_calls'],dry['policy_writes'],dry['lib_writes']),(0,0,2))
        self.assertEqual(f.tree(),before)
        self.assertEqual(dry['change']['targets'],{name:dict(path=str(I.LIB/name),before=H(BASELINE[name]),after=H(raw)) for name,raw in MATERIAL.items()})
        protected=dry['observation']['protected']
        for path in (f.receipt_path('rr'),f.receipt_path('pkg'),f.receipt_path('c5'),f.receipt_path('admission'),f.state/'planning.json',
                     f.state/I.RERECORD_BACKUP/'inventory',f.state/I.PKG_BACKUP/NAME):
            self.assertIn(str(path),protected)
        phases=[];events=[];real=I.atomic_bytes
        def capture(path,data,*args):
            events.append(path)
            if path==I.J:phases.append(json.loads(data)['phase'])
            return real(path,data,*args)
        with patch.object(I,'atomic_bytes',side_effect=capture),contextlib.redirect_stdout(io.StringIO()),I.controller_lock():
            I.apply(MATERIAL,SS,COMMIT,dry['observation_sha256'])
        self.assertEqual(phases,['backed_up','target_installed','active'])
        self.assertLess(events.index(I.J),events.index(I.LIB/NAME))
        for name,raw_new in MATERIAL.items():self.assertEqual((I.LIB/name).read_bytes(),raw_new)
        self.assertEqual(I.INVENTORY.read_bytes(),raw.replace(H(OLD).encode(),H(NEW).encode()).replace(H(QOLD).encode(),H(QNEW).encode()))
        self.assertEqual(I.INVENTORY.stat().st_mode&0o777,0o600)
        self.assertEqual((I.LIB/NAME).stat().st_mode&0o777,0o644)
        changed={p for p in before if f.tree()[p]!=before[p]}
        self.assertEqual(changed,{I.INVENTORY,*[I.LIB/name for name in I.TARGETS]})
        added=set(f.tree())-set(before)
        self.assertEqual(added,{I.J,I.BK,*[I.BK/name for name in (*I.TARGETS,'inventory')]})
        for name in (*I.TARGETS,'inventory'):self.assertEqual((I.BK/name).stat().st_mode&0o777,0o600)
        receipt=I.receipt_read(COMMIT);I.verify(receipt)
        f.smoke.assert_called_once()
        snapshot=f.tree()
        with contextlib.redirect_stdout(io.StringIO()) as out:I.apply(MATERIAL,SS,COMMIT,'0'*64)
        self.assertIn('APPLY_NOOP',out.getvalue());self.assertEqual(f.tree(),snapshot)
        I.restore(I.receipt_read(COMMIT))
        for path,record in before.items():self.assertEqual(f.tree()[path],record)
        self.assertEqual(I.J.stat().st_mode&0o777,0o600)
        self.assertEqual(I.BK.stat().st_mode&0o777,0o700)
        self.assertEqual(I.receipt_read(COMMIT)['phase'],'rolled_back')
        snapshot=f.tree()
        with self.assertRaisesRegex(I.Refused,'already rolled back'):I.restore(I.receipt_read(COMMIT))
        with self.assertRaisesRegex(I.Refused,'existing guarded'):I.apply(MATERIAL,SS,COMMIT,'0'*64)
        self.assertEqual(f.tree(),snapshot)

    def test_retained_first_failure_is_immutable_and_refuses_foreign_bytes(self):
        f=self.fixture()
        for path in (I.PREVIOUS_J,I.PREVIOUS_BK/'inventory',I.PREVIOUS_BK/NAME):
            with self.subTest(path=str(path)):
                raw=path.read_bytes()
                path.write_bytes(raw+b' ')
                before=f.tree()
                with self.assertRaisesRegex(I.Refused,'previous C'):I.dry(SS,COMMIT)
                self.assertEqual(f.tree(),before)
                with self.assertRaisesRegex(I.Refused,'previous C'):
                    I.apply(MATERIAL,SS,COMMIT,'0'*64)
                self.assertEqual(f.tree(),before)
                path.write_bytes(raw)
        self.assertFalse(I.J.exists())
        self.assertFalse(I.BK.exists())

    def test_previous_terminal_receipt_included_in_protected_observation(self):
        f=self.fixture()
        state=I.observation()['protected']
        for p in (I.PREVIOUS_J,I.PREVIOUS_BK/'inventory',I.PREVIOUS_BK/NAME):
            self.assertIn(str(p),state)
        self.assertEqual(I.PREVIOUS_J.read_bytes(),f.paths['PREVIOUS_J'].read_bytes())

    def test_dry_apply_verify_rollback_compact(self):self.cycle(False)
    def test_dry_apply_verify_rollback_pretty(self):self.cycle(True)

    def test_observation_binding_includes_routine_state_rewrites(self):
        f=self.fixture();observed=I.observation()
        (f.state/'planning.json').write_text('{"tick":2}')
        before=f.tree()
        with self.assertRaisesRegex(I.Refused,'dry observation changed; rerun dry'):
            I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
        self.assertEqual(f.tree(),before);self.assertFalse(I.BK.exists());self.assertFalse(I.J.exists())

    def test_prestate_target_checked_before_inventory(self):
        f=self.fixture();(f.lib/NAME).write_bytes(b'third hash')
        with patch.object(I,'recorded_inventory',side_effect=AssertionError('target gate was skipped')):
            self.assert_refuses_without_writes(f,'target baseline drift')

    def test_wrong_inventory_prestate_refuses(self):
        cases={
            'target new':lambda f:f.inventory['after'].update({str(f.lib/NAME):H(NEW)}),
            'target third':lambda f:f.inventory['after'].update({str(f.lib/NAME):'f'*64}),
            'rules stale':lambda f:f.inventory['after'].update({str(f.lib/I.RULES_NAME):I.RULES_INVENTORY_SHA}),
            'rules third':lambda f:f.inventory['after'].update({str(f.lib/I.RULES_NAME):'f'*64}),
            'manifest':lambda f:f.inventory.update(manifest='0'*64),
            'extra':lambda f:f.inventory['after'].update(extra='0'*64),
            'missing':lambda f:f.inventory['after'].pop(str(f.lib/'untouched0')),
            'extra live drift':lambda f:(f.lib/'untouched0').write_bytes(b'changed'),
            'duplicate old':lambda f:f.inventory.update(note=H(OLD)),
            'new present':lambda f:f.inventory.update(note=H(NEW)),
            'native entry':lambda f:f.inventory['after'].update({str(f.lib/'native_antigravity.py'):'0'*64}),
            'qa entry':lambda f:f.inventory['after'].update({str(f.lib/'antigravity_qa_recovery.py'):'0'*64}),
            'other field':lambda f:f.inventory.update(note='foreign'),
        }
        for label,edit in cases.items():
            with self.subTest(label):
                f=self.fixture();edit(f);f.write_inventory();self.assert_refuses_without_writes(f)

    def test_target_new_is_not_an_upgrade_prestate(self):
        f=self.fixture();(f.lib/NAME).write_bytes(NEW)
        self.assert_refuses_without_writes(f,'target baseline drift')

    def test_metadata_gate(self):
        for name,mode in (('INVENTORY',0o640),(NAME,0o600),(QA,0o600)):
            with self.subTest(name):
                f=self.fixture();(I.INVENTORY if name=='INVENTORY' else f.lib/name).chmod(mode)
                self.assert_refuses_without_writes(f,'metadata drift')
        f=self.fixture()
        with patch.object(I,'OWNER_UID',os.getuid()+1):self.assert_refuses_without_writes(f,'metadata drift')
        with patch.object(I,'OWNER_GID',os.getgid()+1):self.assert_refuses_without_writes(f,'metadata drift')

    def test_strict_pkg_inventory_pair_even_if_all_live_hashes_match(self):
        f=self.fixture();path=f.lib/'untouched0';path.write_bytes(b'foreign pair')
        f.inventory['after'][str(path)]=H(path.read_bytes());f.write_inventory()
        self.assert_refuses_without_writes(f,'not the post-admission pair')

    def test_lower_receipts_missing_or_altered_refuse(self):
        for layer in ('rr','pkg','c5','admission'):
            for mutation in ('missing','altered'):
                with self.subTest(layer=layer,mutation=mutation):
                    f=self.fixture();path=f.receipt_path(layer)
                    if mutation=='missing':path.unlink()
                    else:path.write_bytes(path.read_bytes()+b' ')
                    self.assert_refuses_without_writes(f)

    def test_lower_receipt_semantics_even_with_patched_byte_pin(self):
        edits={
            'rr':{'phase':lambda r:r.update(phase='rolled_back'),'commit':lambda r:r.update(commit='0'*40),
                  'schema':lambda r:r.update(schema='foreign'),'new':lambda r:r.update(new_sha256='0'*64),
                  'script':lambda r:r.update(script_sha256='0'*64),'backups':lambda r:r['backups'].update(extra={})},
            'pkg':{'phase':lambda r:r.update(phase='target_installed'),'commit':lambda r:r.update(commit='0'*40),
                   'schema':lambda r:r.update(schema='foreign'),'manifest':lambda r:r.update(manifest='0'*64),
                   'observation':lambda r:r.update(observation_sha256='0'*64),
                   'chain':lambda r:r['backups']['inventory'].update(sha256='0'*64),
                   'target':lambda r:r['backups'][NAME].update(sha256='0'*64),
                   'missing':lambda r:r['backups'].pop('marker'),
                   'extra':lambda r:r['backups'].update(extra={})}}
        for layer,cases in edits.items():
            for label,edit in cases.items():
                with self.subTest(layer=layer,label=label):
                    f=self.fixture();f.write_receipt(layer,edit);self.assert_refuses_without_writes(f)

    def test_every_lower_backup_hash_checked(self):
        for folder,names in ((I.ADMISSION_BACKUP,(NAME,'inventory')),(I.PKG_BACKUP,(*I.PKG_TARGETS,'inventory','marker','policy')),
                             (I.RERECORD_BACKUP,('inventory',)),(I.C5_BACKUP_NAME,('rules',))):
            for name in names:
                with self.subTest(folder=folder,name=name):
                    f=self.fixture();(f.state/folder/name).write_bytes(b'tampered')
                    self.assert_refuses_without_writes(f)

    def test_extra_lower_backup_file_refuses(self):
        for directory in (I.PKG_BACKUP,I.RERECORD_BACKUP,I.ADMISSION_BACKUP):
            with self.subTest(directory):
                f=self.fixture();(f.state/directory/'extra').write_bytes(b'unrecorded')
                self.assert_refuses_without_writes(f,'lower backup membership drift')

    def test_existing_non_active_valid_transaction_refuses(self):
        for phase in ('backed_up','target_installed','rollback_failed','rolled_back'):
            with self.subTest(phase):
                f=self.fixture();receipt=f.apply();receipt['phase']=phase
                I.J.write_text(json.dumps(receipt));before=f.tree()
                with self.assertRaisesRegex(I.Refused,'existing guarded transaction'):
                    I.apply(MATERIAL,SS,COMMIT,'0'*64)
                self.assertEqual(f.tree(),before)

    def test_own_j_or_bk_preexist_refuses_before_any_write(self):
        for which in ('J','BK','both'):
            with self.subTest(which):
                f=self.fixture()
                if which in ('J','both'):I.J.write_text('{}')
                if which in ('BK','both'):I.BK.mkdir()
                self.assert_refuses_without_writes(f)

    def test_rollback_refuses_foreign_target_or_inventory(self):
        for name in (NAME,QA,'inventory'):
            with self.subTest(name):
                f=self.fixture();receipt=f.apply()
                path=I.INVENTORY if name=='inventory' else f.lib/name
                # Preserve valid JSON for the protected inventory membership walk.
                if name=='inventory':path.write_bytes(path.read_bytes()+b' ')
                else:path.write_bytes(b'foreign')
                before=f.tree()
                with self.assertRaisesRegex(I.Refused,'rollback .* drift'):I.restore(receipt)
                self.assertEqual(f.tree(),before)

    def test_smoke_and_inventory_write_failure_restore_exactly(self):
        for failure in ('smoke','inventory'):
            with self.subTest(failure):
                f=self.fixture();before=f.tree();observed=I.observation();real=I.atomic_bytes;calls=[]
                def faulty(path,raw,*args):
                    result=real(path,raw,*args)
                    if path==I.INVENTORY and not calls:calls.append(path);raise OSError('synthetic post-write error')
                    return result
                cm=(patch.object(I,'smoke',side_effect=OSError('synthetic smoke error')) if failure=='smoke'
                    else patch.object(I,'atomic_bytes',side_effect=faulty))
                with cm,self.assertRaises(OSError):I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
                for path,record in before.items():self.assertEqual(f.tree()[path],record)
                self.assertEqual(I.receipt_read(COMMIT)['phase'],'rolled_back')

    def test_restore_failure_keeps_backup_and_marks_rollback_failed(self):
        f=self.fixture();observed=I.observation()
        with patch.object(I,'smoke',side_effect=OSError()),patch.object(I,'restore',side_effect=OSError()),self.assertRaises(OSError):
            I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
        self.assertEqual(I.receipt_read(COMMIT)['phase'],'rollback_failed')
        self.assertEqual((I.BK/NAME).read_bytes(),OLD)
        I.restore(I.receipt_read(COMMIT));self.assertEqual((I.LIB/NAME).read_bytes(),OLD)

    def test_backup_phase_drift_refuses_without_installed_writes(self):
        f=self.fixture();observed=I.observation();real=I.atomic_bytes;before=f.tree()
        def drift(path,raw,*args):
            result=real(path,raw,*args)
            if path==I.BK/'inventory':(f.state/'planning.json').write_text('{"tick":3}')
            return result
        with patch.object(I,'atomic_bytes',side_effect=drift),self.assertRaisesRegex(I.Refused,'backup-phase drift'):
            I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
        self.assertFalse(I.BK.exists());self.assertFalse(I.J.exists())
        for path in (I.INVENTORY,I.LIB/NAME):self.assertEqual(f.tree()[path],before[path])

    def test_verify_and_rollback_bind_all_lower_state(self):
        for layer in ('rr','pkg','c5','admission','planning','backup'):
            with self.subTest(layer):
                f=self.fixture();receipt=f.apply()
                path=(f.state/'planning.json' if layer=='planning' else f.state/I.PKG_BACKUP/'marker'
                      if layer=='backup' else f.receipt_path(layer))
                path.write_bytes(path.read_bytes()+b' ');before=f.tree()
                with self.assertRaisesRegex(I.Refused,'protected state changed'):I.verify(receipt)
                with self.assertRaisesRegex(I.Refused,'protected state changed'):I.restore(receipt)
                self.assertEqual(f.tree(),before)

    def test_receipt_or_backup_tamper_refuses(self):
        for which in ('target','inventory','script','commit'):
            with self.subTest(which):
                f=self.fixture();f.apply()
                if which=='target':(I.BK/NAME).write_bytes(b'foreign')
                elif which=='inventory':(I.BK/'inventory').write_bytes(b'{}')
                elif which=='script':
                    r=json.loads(I.J.read_bytes());r['script_sha256']='0'*64;I.J.write_text(json.dumps(r))
                with self.assertRaises(I.Refused):I.receipt_read('b'*40 if which=='commit' else COMMIT)

    def test_verify_detects_target_and_inventory_metadata_or_bytes(self):
        for which in ('target bytes','target mode','inventory bytes','inventory mode'):
            with self.subTest(which):
                f=self.fixture();receipt=f.apply();path=f.lib/NAME if which.startswith('target') else I.INVENTORY
                if which.endswith('mode'):path.chmod(0o640)
                elif which.startswith('target'):path.write_bytes(OLD)
                else:path.write_bytes(path.read_bytes()+b' ')
                with self.assertRaises(I.Refused):I.verify(receipt)

    def test_idle_active_none_free(self):
        f=self.fixture();I.idle()
        self.assertEqual(f.receiver.no_models.call_count,2)
        f.receiver.units_quiet.assert_called_once()

    def test_idle_active_done_free(self):
        f=self.fixture();f.active.update(slot1=dict(phase='done'),slot2=dict(phase='done'))
        I.idle();f.apply()

    def test_idle_claimed_developing_qa_ci_odd_and_non_dict_occupied(self):
        for slot in ('slot1','slot2'):
            for active in ({'phase':'claimed'},{'phase':'developing'},{'phase':'qa'},{'phase':'ci'},
                           {'phase':'odd'},{},{'phase':None},False,0,'done',[],['done']):
                with self.subTest(slot=slot,active=active):
                    f=self.fixture();f.active[slot]=active;self.assert_refuses_without_writes(f,'slot occupied')

    def test_idle_pending_non_none_occupied(self):
        for active in (None,dict(phase='done')):
            for pending in ({},False,0,'operation'):
                with self.subTest(active=active,pending=pending):
                    f=self.fixture();f.active['slot2']=active
                    (f.state/'slot2.json').write_text(json.dumps(dict(pending=pending)))
                    self.assert_refuses_without_writes(f,'slot occupied')

    def test_idle_other_quiescence_guards(self):
        for guard in ('policy','units','model','worker lock','lease','integration'):
            with self.subTest(guard):
                f=self.fixture()
                if guard=='policy':I.POLICY.write_text('{"mode":"disabled"}')
                if guard=='units':f.run.return_value=b'ActiveState=active\nMainPID=1\nUnitFileState=enabled\n'
                if guard=='model':f.receiver.no_models.side_effect=I.Refused('model process')
                if guard in ('worker lock','lease'):
                    path=(I.AUTONOMY/'slots'/'slot1'/'worker.lock' if guard=='worker lock'
                          else I.AUTONOMY/'locks'/'slot1.lease')
                    path.touch();st=path.stat();locks=f.root/'proc-locks'
                    locks.write_text('1: FLOCK ADVISORY WRITE 123 %x:%x:%d 0 EOF\n'%(os.major(st.st_dev),os.minor(st.st_dev),st.st_ino))
                    f.patch('PROC_LOCKS',locks)
                if guard=='integration':(f.state/'integration.json').write_text('{}')
                self.assert_refuses_without_writes(f)

    def test_lower_unwind_still_needs_reconciliation_of_preserved_upgrade_evidence(self):
        f=self.fixture()
        P=module('small_range_lower_unwind',SCRIPT.parent/'agy29_admission_upgrade.py')
        with contextlib.ExitStack() as stack:
            for key,value in f.paths.items():
                if key not in ('J','BK','PREVIOUS_J','PREVIOUS_BK'):stack.enter_context(patch.object(P,key,value))
            stack.enter_context(patch.object(P,'J',f.state/I.ADMISSION_NAME))
            stack.enter_context(patch.object(P,'BK',f.state/I.ADMISSION_BACKUP))
            stack.enter_context(patch.object(P,'UNCHANGED',I.UNCHANGED))
            stack.enter_context(patch.object(P,'REQUIRED_STATE',I.REQUIRED_STATE))
            stack.enter_context(patch.object(P,'idle',I.idle))
            lower=dict(phase='active',observation=dict(protected=P.protected_state()))
            receipt=f.apply()
            for check in (P.verify,P.restore):
                with self.assertRaisesRegex(P.Refused,'protected state changed'):check(lower)
            I.restore(receipt)
            for name,raw in BASELINE.items():self.assertEqual((f.lib/name).read_bytes(),raw)
            for check in (P.verify,P.restore):
                with self.assertRaisesRegex(P.Refused,'protected state changed'):check(lower)

    def test_each_target_old_pin_is_required_before_inventory(self):
        for name in I.TARGETS:
            for wrong in (MATERIAL[name],b'foreign'):
                with self.subTest(name=name,wrong=wrong):
                    f=self.fixture();(f.lib/name).write_bytes(wrong)
                    with patch.object(I,'recorded_inventory',side_effect=AssertionError('old-sha gate skipped')):
                        self.assert_refuses_without_writes(f,'target baseline drift')

    def test_pre_326_state_is_never_admitted(self):
        f=self.fixture()
        (f.lib/NAME).write_bytes(PRE326)
        f.inventory['after'][str(f.lib/NAME)]=H(PRE326);f.write_inventory()
        f.receipt_path('admission').unlink();shutil.rmtree(f.state/I.ADMISSION_BACKUP)
        self.assert_refuses_without_writes(f,'target baseline drift')

    def test_admission_receipt_semantics_even_with_patched_byte_pin(self):
        edits={
            'schema':lambda r:r.update(schema='foreign'),
            'phase':lambda r:r.update(phase='rolled_back'),
            'commit':lambda r:r.update(commit='0'*40),
            'manifest':lambda r:r.update(manifest='0'*64),
            'script':lambda r:r.update(script_sha256='0'*64),
            'new':lambda r:r.update(new_sha256='0'*64),
            'observation digest':lambda r:r.update(observation_sha256='0'*64),
            'missing':lambda r:r['backups'].pop(NAME),
            'extra':lambda r:r['backups'].update(extra={}),
            'target sha':lambda r:r['backups'][NAME].update(sha256='0'*64),
            'mode':lambda r:r['backups'][NAME].update(mode=0o600),
            'uid':lambda r:r['backups'][NAME].update(uid=os.getuid()+1),
            'gid':lambda r:r['backups']['inventory'].update(gid=os.getgid()+1),
            'observation target':lambda r:r['observation'].update(target={}),
            'observation inventory':lambda r:r['observation'].update(inventory_sha256='0'*64),
        }
        for label,edit in edits.items():
            with self.subTest(label):
                f=self.fixture();f.write_receipt('admission',edit);self.assert_refuses_without_writes(f)

    def test_inventory_shape_and_duplicate_json_keys_refuse_without_writes(self):
        import core
        cases=[b'[]',b'null',b'{}',b'{"manifest":"x","after":[]}',
               b'{"after":{},"after":{}}']
        for raw in cases:
            with self.subTest(raw=raw):
                f=self.fixture();I.INVENTORY.write_bytes(raw);before=f.tree()
                for action in (lambda:I.dry(SS,COMMIT),lambda:I.apply(MATERIAL,SS,COMMIT,'0'*64)):
                    with self.assertRaises((I.Refused,core.Refused)):action()
                    self.assertEqual(f.tree(),before)

    def test_each_inventory_old_value_unique_and_new_absent(self):
        for name in (QA,NAME):
            for index in (0,1):
                with self.subTest(name=name,index=index):
                    f=self.fixture();f.inventory['note']=I.TARGETS[name][index];f.write_inventory()
                    self.assert_refuses_without_writes(f,'not unique')

    def test_exact_post_326_inventory_bytes_are_required(self):
        f=self.fixture();I.INVENTORY.write_bytes(I.INVENTORY.read_bytes()+b' ')
        self.assert_refuses_without_writes(f,'not the post-admission pair')

    def test_exact_material_membership_and_hashes_before_backups(self):
        for material in ({},NEW,{NAME:NEW},{**MATERIAL,'extra':b'x'},
                         {**MATERIAL,QA:b'foreign'},{**MATERIAL,NAME:b'foreign'}):
            with self.subTest(material=material):
                f=self.fixture();before=f.tree();observed=I.observation()
                with self.assertRaisesRegex(I.Refused,'exact two-target material required'):
                    I.apply(material,SS,COMMIT,I.digest(observed))
                self.assertEqual(f.tree(),before)

    def test_every_atomic_write_boundary_preserves_or_automatically_restores(self):
        # Apply writes: 3 backups, write-ahead receipt, 2 targets,
        # target_installed receipt, inventory, active receipt. Fail before/after each.
        for index in range(1,10):
            for when in ('before','after'):
                with self.subTest(index=index,when=when):
                    f=self.fixture();before=f.tree();observed=I.observation();real=I.atomic_bytes;calls=[]
                    def faulty(path,raw,*args):
                        calls.append(path);trigger=len(calls)==index
                        if trigger and when=='before':raise OSError('synthetic write boundary')
                        result=real(path,raw,*args)
                        if trigger and when=='after':raise OSError('synthetic write boundary')
                        return result
                    with patch.object(I,'atomic_bytes',side_effect=faulty),self.assertRaisesRegex(OSError,'synthetic write boundary'):
                        I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
                    for path,record in before.items():self.assertEqual(f.tree()[path],record)
                    if index<4 or (index==4 and when=='before'):
                        self.assertFalse(I.J.exists());self.assertFalse(I.BK.exists())
                    else:
                        phase='backed_up' if index==4 else 'rolled_back'
                        self.assertEqual(I.receipt_read(COMMIT)['phase'],phase)
                        for name,raw in BASELINE.items():self.assertEqual((I.BK/name).read_bytes(),raw)

    def test_verify_failure_at_end_of_apply_also_restores(self):
        f=self.fixture();before=f.tree();observed=I.observation()
        with patch.object(I,'verify',side_effect=I.Refused('synthetic final verify')),self.assertRaises(I.Refused):
            I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
        for path,record in before.items():self.assertEqual(f.tree()[path],record)
        self.assertEqual(I.receipt_read(COMMIT)['phase'],'rolled_back')

    def test_foreign_second_target_is_preserved_after_partial_install(self):
        f=self.fixture();observed=I.observation();real=I.atomic_bytes;done=[]
        def foreign(path,raw,*args):
            result=real(path,raw,*args)
            if path==I.LIB/QA and not done:
                done.append(path);(I.LIB/NAME).write_bytes(b'foreign')
            return result
        with patch.object(I,'atomic_bytes',side_effect=foreign),self.assertRaisesRegex(I.Refused,'pre-install drift'):
            I.apply(MATERIAL,SS,COMMIT,I.digest(observed))
        self.assertEqual((I.LIB/NAME).read_bytes(),b'foreign')
        self.assertEqual((I.LIB/QA).read_bytes(),QNEW)
        self.assertEqual(I.receipt_read(COMMIT)['phase'],'rollback_failed')

    def test_streamed_protected_state_over_pinned_read_bound(self):
        f=self.fixture();path=f.state/'large-paid-evidence'
        with path.open('wb') as out:out.truncate(67108865)
        with self.assertRaisesRegex(I.Refused,'unsafe regular file'):I.regular_bytes(path)
        self.assertEqual(I.protected_state()[str(path)]['sha256'],I.state_sha(path))
        with self.assertRaisesRegex(I.Refused,'unsafe regular file'):I.state_sha(path,limit=10)
        path.unlink();path.symlink_to(f.lib/NAME)
        with self.assertRaisesRegex(I.Refused,'symlink in protected state'):I.protected_state()

    def test_no_follow_hardlink_and_metadata_read_guards(self):
        f=self.fixture();path=f.root/'safe';path.write_bytes(b'safe');path.chmod(0o600)
        self.assertEqual(I.regular_bytes(path),b'safe')
        link=f.root/'link';link.symlink_to(path)
        with self.assertRaises(OSError):I.regular_bytes(link)
        link.unlink();os.link(path,link)
        with self.assertRaisesRegex(I.Refused,'unsafe regular file'):I.regular_bytes(path)
        link.unlink();path.chmod(0o666)
        with self.assertRaisesRegex(I.Refused,'unsafe regular file'):I.regular_bytes(path)
        with self.assertRaisesRegex(I.Refused,'unsafe regular file'):I.state_sha(path)

    def test_minimal_smoke_command_has_two_uids_no_writes_or_live_state_calls(self):
        with patch.object(I,'run',return_value=b'AGY29_SMALL_RANGE_SMOKE_PASS') as run:
            I.smoke()
        self.assertEqual(run.call_count,2)
        for uid,call in zip((1002,978),run.call_args_list):
            argv=call.args[0]
            self.assertEqual(argv[:7],['/usr/bin/unshare','-n','/usr/bin/setpriv','--reuid',str(uid),'--regid',str(uid)])
            self.assertIn('--clear-groups',argv);self.assertIn('--no-new-privs',argv)
            self.assertIn('-I',argv);self.assertIn('-B',argv);self.assertIn('-i',argv)
            self.assertEqual(call.kwargs['timeout'],60)
            self.assertEqual(argv[-1],str(I.LIB))
        self.assertNotIn('accept(',I.SMOKE_CODE)
        self.assertNotIn('STATE',I.SMOKE_CODE)
        self.assertNotIn('open(',I.SMOKE_CODE)
        self.assertIn('A.EXPECTED_PINS and callable(A.accept)',I.SMOKE_CODE)
        self.assertIn('Q.OWNER_PACKAGE_SOURCES and callable(Q.owner_package_input_pins)',I.SMOKE_CODE)
        self.assertIn('A.EXPECTED_PINS and callable(A.accept)',I.SMOKE_CODE)
        self.assertIn('callable(A.package_rules_ok)',I.SMOKE_CODE)
        self.assertNotIn('callable(Q.package_rules_ok)',I.SMOKE_CODE)
        # The previous smoke asserted a nonexistent Q symbol and forced rollback
        # on the real host. Both new exported APIs exist in the reviewed source.
        recovered=installed_source('scripts/chatops/actions_train/antigravity_qa_recovery.py')
        admission=installed_source('scripts/chatops/actions_train/owner_package_admission.py')
        self.assertIn('owner_package_input_pins',recovered.decode())
        self.assertIn('def package_rules_ok(',admission.decode())
        with patch.object(I,'run',return_value=b'wrong'),self.assertRaises(I.Refused):I.smoke()


class BundleTests(unittest.TestCase):
    def fixture(self):
        root=Path(tempfile.mkdtemp(prefix='small-range-bundle-',dir=os.environ.get('TMPDIR') or None));self.addCleanup(lambda:shutil.rmtree(root,True))
        bundle=root/'bundle';(bundle/'.git').mkdir(parents=True)
        (bundle/'.git'/'config').write_bytes(b'[core]\n bare = false\n')
        paths=[I.SCRIPT_REPO_PATH,*['scripts/chatops/actions_train/'+name for name in I.TARGETS],
               'scripts/chatops/actions_train/manifest.json','.github/workflows/train-stage.yml']
        blobs={p:installed_source(p) for p in paths}
        for p,raw in blobs.items():
            path=bundle/p;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
        self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(I,'R',SimpleNamespace(trusted_tree=lambda path:None)))
        def git(path,*args):
            if args[0]=='rev-parse':return COMMIT.encode()
            if args[0]=='remote':return b'https://github.com/anpavel84-afk/gobadminton-clean.git'
            if args[0]=='status':return b''
            if args[:3]==('show','-s','--format=%P'):return b'1'*40+b' '+b'2'*40
            if args[0]=='merge-base':return b''
            if args[0]=='show':return blobs[args[1].split(':',1)[1]]
            raise AssertionError(args)
        self.git=self.stack.enter_context(patch.object(I,'git',side_effect=git))
        return root,bundle,blobs

    def test_bundle_and_running_script_equal_reviewed_blob(self):
        root,bundle,blobs=self.fixture()
        self.assertEqual(I.source(bundle,COMMIT),(SS,{name:installed_source('scripts/chatops/actions_train/'+name) for name in I.TARGETS}))
        other=root/'other.py';other.write_bytes(SCRIPT.read_bytes()+b'\n# foreign\n')
        with patch.object(I,'__file__',str(other)),self.assertRaisesRegex(I.Refused,'running installer differs'):
            I.source(bundle,COMMIT)
        (bundle/I.SCRIPT_REPO_PATH).write_bytes(b'foreign')
        with self.assertRaisesRegex(I.Refused,'worktree/git bytes differ'):I.source(bundle,COMMIT)

    def test_bundle_manifest_and_target_mismatch_refuse(self):
        for kind in ('manifest bytes','manifest target pin','target bytes','qa manifest pin','qa bytes'):
            with self.subTest(kind):
                root,bundle,blobs=self.fixture();mp='scripts/chatops/actions_train/manifest.json'
                tp='scripts/chatops/actions_train/'+(QA if kind.startswith('qa') else NAME)
                if kind=='manifest bytes':blobs[mp]+=b' '
                elif kind in ('manifest target pin','qa manifest pin'):
                    manifest=json.loads(blobs[mp]);manifest['files'][tp]='0'*64
                    blobs[mp]=json.dumps(manifest).encode()
                    self.stack.enter_context(patch.object(I,'MANIFEST',H(blobs[mp])))
                else:blobs[tp]+=b' '
                for p,raw in blobs.items():(bundle/p).write_bytes(raw)
                with self.assertRaisesRegex(I.Refused,'bundle manifest drift'):I.source(bundle,COMMIT)

    def test_worktree_target_manifest_workflow_must_equal_git(self):
        for p in ('scripts/chatops/actions_train/'+NAME,'scripts/chatops/actions_train/'+QA,'scripts/chatops/actions_train/manifest.json',
                  '.github/workflows/train-stage.yml'):
            with self.subTest(p):
                root,bundle,blobs=self.fixture();(bundle/p).write_bytes(blobs[p]+b' ')
                with self.assertRaisesRegex(I.Refused,'worktree/git bytes differ'):I.source(bundle,COMMIT)

    def test_bundle_git_indirections_and_bad_config_refused_before_git(self):
        for name in ('commondir','gitdir','objects/info/alternates','modules','info/attributes','config','gitfile','symlink'):
            with self.subTest(name):
                root,bundle,blobs=self.fixture()
                if name in ('gitfile','symlink'):
                    (bundle/'.git').rename(root/'external')
                    if name=='gitfile':(bundle/'.git').write_text('gitdir: '+str(root/'external'))
                    else:(bundle/'.git').symlink_to(root/'external',target_is_directory=True)
                elif name=='config':(bundle/'.git'/'config').write_text('[include]\n path = foreign\n')
                else:
                    path=bundle/'.git'/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('foreign')
                with self.assertRaises(I.Refused):I.source(bundle,COMMIT)
                self.git.assert_not_called()

    def test_bundle_wrong_identity_dirty_nonmerge_and_workflow_refuse(self):
        for kind in ('head','origin','dirty','parents','ancestor','workflow'):
            with self.subTest(kind):
                root,bundle,blobs=self.fixture();original=self.git.side_effect
                def git(path,*args):
                    if kind=='head' and args[0]=='rev-parse':return b'b'*40
                    if kind=='origin' and args[0]=='remote':return b'https://github.com/anpavel84-afk/gobadminton-clean'
                    if kind=='dirty' and args[0]=='status':return b'?? untracked\n'
                    if kind=='parents' and args[:3]==('show','-s','--format=%P'):return b'b'*40
                    if kind=='ancestor' and args[0]=='merge-base':raise I.Refused('bounded OPS command failed')
                    return original(path,*args)
                self.git.side_effect=git
                if kind=='workflow':
                    p='.github/workflows/train-stage.yml';blobs[p]+=b' ';(bundle/p).write_bytes(blobs[p])
                with self.assertRaises(I.Refused):I.source(bundle,COMMIT)

    def test_git_helper_scrubs_environment_and_forbids_network(self):
        with patch.dict(os.environ,{'GIT_DIR':'/foreign','GIT_CONFIG_COUNT':'1','UNRELATED':'foreign'}), \
             patch.object(I.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=b'')) as run:
            I.git(Path('/synthetic'),'status','--porcelain=v1','--ignore-submodules=all')
        argv=run.call_args.args[0];env=run.call_args.kwargs['env']
        self.assertEqual(env,dict(PATH='/usr/bin:/bin',LC_ALL='C',HOME='/nonexistent',GIT_CONFIG_NOSYSTEM='1',
            GIT_CONFIG_GLOBAL='/dev/null',GIT_CONFIG_SYSTEM='/dev/null',GIT_TERMINAL_PROMPT='0',
            GIT_OPTIONAL_LOCKS='0',GIT_ATTR_NOSYSTEM='1'))
        for option in ('protocol.allow=never','core.hooksPath=/dev/null','core.fsmonitor=false',
                       'core.attributesFile=/dev/null','core.untrackedCache=false'):self.assertIn(option,argv)
        self.assertIn('--no-replace-objects',argv);self.assertIn('--no-optional-locks',argv)
        self.assertEqual(run.call_args.kwargs['stdin'],subprocess.DEVNULL)

    def test_trusted_tree_failure_precedes_any_git(self):
        root,bundle,blobs=self.fixture()
        with patch.object(I.R,'trusted_tree',side_effect=I.Refused('untrusted root tree')):
            with self.assertRaisesRegex(I.Refused,'untrusted root tree'):I.source(bundle,COMMIT)
        self.git.assert_not_called()

    def test_ancestor_gate_uses_actual_326_merge(self):
        root,bundle,blobs=self.fixture();I.source(bundle,COMMIT)
        self.assertIn(unittest.mock.call(bundle,'merge-base','--is-ancestor',I.ADMISSION_COMMIT,COMMIT),self.git.call_args_list)

    def test_bundle_bad_configs_and_attributes_refuse_before_git(self):
        configs=[b'[include]\npath = foreign\n',b'[core]\nfsmonitor = foreign\n',
                 b'[filter.x]\nclean = foreign\n',b'[diff "x"]\ntextconv = foreign\n',
                 b'[alias]\nx = foreign\n',b'[credential]\nhelper = foreign\n',
                 b'[protocol "file"]\nallow = always\n',b'[url "x"]\ninsteadOf = x\n',
                 b'[core]\nhooksPath = foreign\n',b'[core]\nfsmoni\\\ntor = foreign\n',
                 b'[core]\nfsmonitor\x00 = foreign\n',b'[core] fsmonitor = foreign\n']
        for config in ('config','config.worktree'):
            for raw in configs:
                with self.subTest(config=config,raw=raw):
                    root,bundle,blobs=self.fixture();(bundle/'.git'/config).write_bytes(raw)
                    with self.assertRaises(I.Refused):I.source(bundle,COMMIT)
                    self.git.assert_not_called()
        for name in ('.gitattributes','nested/.gitattributes','.gitmodules'):
            with self.subTest(name=name):
                root,bundle,blobs=self.fixture();path=bundle/name
                path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'* filter=foreign\n')
                with self.assertRaisesRegex(I.Refused,'forbidden bundle filter attribute'):I.source(bundle,COMMIT)
                self.git.assert_not_called()

    def test_old_326_and_325_installers_refuse_new_bundle_manifest_and_targets(self):
        for filename in ('agy29_admission_upgrade.py','agy29_pkg_finish_install.py'):
            with self.subTest(filename=filename):
                root,bundle,blobs=self.fixture();P=module('old_'+filename,SCRIPT.parent/filename)
                # Old scripts themselves are unchanged. Satisfy their own script
                # and Git identity checks, then expose the real NEW payload.
                if hasattr(P,'SCRIPT_REPO_PATH'):
                    blobs[P.SCRIPT_REPO_PATH]=(SCRIPT.parent/filename).read_bytes()
                    path=bundle/P.SCRIPT_REPO_PATH;path.write_bytes(blobs[P.SCRIPT_REPO_PATH])
                for name in getattr(P,'TARGETS',{NAME:None}):
                    key='scripts/chatops/actions_train/'+name
                    if key not in blobs:
                        blobs[key]=installed_source(key);(bundle/key).write_bytes(blobs[key])
                with patch.object(P,'R',I.R),patch.object(P,'git',self.git):
                    with self.assertRaisesRegex(P.Refused,'bundle manifest drift'):P.source(bundle,COMMIT)
                    # Even if its manifest pin is substituted, the old target
                    # pins still refuse the NEW bytes. This is a test-only patch.
                    with patch.object(P,'MANIFEST',I.MANIFEST):
                        with self.assertRaisesRegex(P.Refused,'bundle manifest drift|target/manifest pin drift'):
                            P.source(bundle,COMMIT)

    def test_old_324_cannot_be_reused_with_new_bundle_on_installed_stack(self):
        root,bundle,blobs=self.fixture();P=module('old_324',SCRIPT.parent/'agy29_inventory_rerecord.py')
        blobs[P.SCRIPT_REPO_PATH]=(SCRIPT.parent/'agy29_inventory_rerecord.py').read_bytes()
        path=bundle/P.SCRIPT_REPO_PATH;path.write_bytes(blobs[P.SCRIPT_REPO_PATH])
        with patch.object(P,'R',I.R),patch.object(P,'git',self.git):
            script_sha=P.source(bundle,COMMIT)
        # #324 has no bundle manifest/target gate. It refuses re-use through
        # its existing guarded transaction; do not invent a manifest rejection.
        state=root/'state';state.mkdir();(state/'controller.lock').touch()
        receipt=state/'rerecord.json';receipt.write_bytes(b'installed receipt')
        backup=state/'rerecord-backup';backup.mkdir()
        with patch.object(P,'STATE',state),patch.object(P,'J',receipt),patch.object(P,'BK',backup), \
             patch.object(P,'PROC_LOCKS',root/'locks'):
            (root/'locks').write_text('');before={p:p.read_bytes() for p in state.iterdir() if p.is_file()}
            with self.assertRaisesRegex(P.Refused,'existing guarded transaction'):P.dry(script_sha,COMMIT)
            self.assertEqual({p:p.read_bytes() for p in state.iterdir() if p.is_file()},before)

    def test_template_primitives_are_preserved_line_for_line(self):
        def functions(path):
            raw=path.read_text();lines=raw.splitlines()
            return {n.name:'\n'.join(lines[n.lineno-1:n.end_lineno]) for n in ast.parse(raw).body
                    if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))}
        old=functions(SCRIPT.parent/'agy29_admission_upgrade.py');new=functions(SCRIPT)
        for name in ('need','digest','bytes_sha','stable','directory_fd','regular_bytes','sha','state_sha',
                     'run','git','bundle_config','lock_unheld','script_sane','read_json','write_json','idle',
                     'rules_provenance','controller_lock','pinned_receipt','checked_backups','file_meta',
                     'exact_meta','assert_unchanged'):
            self.assertEqual(new[name],old[name],name)

    def test_constants_match_real_repo_and_lower_installers(self):
        A=module('small_range_admission_pins',SCRIPT.parent/'agy29_admission_upgrade.py')
        P=module('small_range_pkg_pins',SCRIPT.parent/'agy29_pkg_finish_install.py')
        for key in ('C','STAGE_SHA','OLD_MANIFEST','INVENTORY_ENTRIES','RULES_NAME','RULES_LIVE_SHA',
                    'RULES_INVENTORY_SHA','C5_RECEIPT_NAME','C5_BACKUP_NAME','C5_RECEIPT_SHA','C5_SCHEMA',
                    'REQUIRED_STATE','STATE_FILE_LIMIT','PKG_TARGETS','RERECORD_SHA','RERECORD_COMMIT',
                    'RERECORD_NEW_SHA','RERECORD_SCRIPT_SHA','PKG_SHA','PKG_COMMIT','PKG_OBSERVATION'):
            self.assertEqual(getattr(I,key),getattr(A,key),key)
        self.assertEqual(I.PKG_TARGETS,P.TARGETS)
        for path,pin in A.UNCHANGED.items():
            self.assertEqual(I.UNCHANGED[path],I.TARGETS[path.name][1] if path.name in I.TARGETS else pin)
        self.assertEqual(set(I.UNCHANGED)-set(A.UNCHANGED),{I.LIB/NAME})
        self.assertEqual(I.ADMISSION_OLD,A.OLD)
        self.assertEqual(I.TARGETS[NAME][0],A.NEW)
        self.assertEqual(I.TARGETS[QA][0],A.UNCHANGED[A.LIB/QA])
        self.assertEqual(I.ADMISSION_MANIFEST,A.MANIFEST)
        self.assertEqual(I.ADMISSION_SCRIPT_SHA,H((SCRIPT.parent/'agy29_admission_upgrade.py').read_bytes()))
        self.assertEqual(I.ADMISSION_SHA,'963575dd50a34137bf52999f73a2aa73c7b85aa36813e582af360ae9d66e54b6')
        self.assertEqual(I.ADMISSION_COMMIT,'aa9ece4d74d3e984ce75e59457304117a1438ff6')
        manifest=installed_source('scripts/chatops/actions_train/manifest.json')
        self.assertEqual(H(manifest),I.MANIFEST)
        self.assertEqual(I.MANIFEST,'3b39bb7fb810e97e4d6163dfc93356260d2a966ecbc66b4410c8b06deab0e150')
        for name,(_,new) in I.TARGETS.items():
            path='scripts/chatops/actions_train/'+name
            self.assertEqual(new,H(installed_source(path)))
            self.assertEqual(json.loads(manifest)['files'][path],new)
            self.assertEqual(I.UNCHANGED[I.LIB/name],new)
        workflow=(REPO/'.github/workflows/train-stage.yml').read_bytes()
        self.assertEqual(H(workflow),I.STAGE_SHA);self.assertIn(('ref: '+I.C).encode(),workflow)
        self.assertEqual(SCRIPT.stat().st_mode&0o777,0o644)



if __name__=='__main__':unittest.main()
