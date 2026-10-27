"""Finite Stage 5 source checks: real synthetic Git/files, no services/network/install."""
import base64
import contextlib
import copy
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from test_actions_train import receiver,ROOT,core

spec=importlib.util.spec_from_file_location('stage5_upgrade',ROOT/'scripts/chatops/ops/stage5_cursor_context_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
H=lambda raw:hashlib.sha256(raw).hexdigest()
RULES=b'accepted synthetic rules\n'


class Stage5Install(unittest.TestCase):
    def git(self,*args):
        env={'PATH':'/usr/bin:/bin','HOME':str(self.p),'GIT_CONFIG_NOSYSTEM':'1',
             'GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_SYSTEM':'/dev/null','LC_ALL':'C'}
        return subprocess.run(['/usr/bin/git','-C',str(self.bundle),'-c','user.name=Fixture',
            '-c','user.email=fixture@example.invalid','-c','gc.auto=0',
            '-c','maintenance.auto=false',*args],env=env,stdin=subprocess.DEVNULL,
            capture_output=True,check=True).stdout.decode().strip()

    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='.gb-stage5-fixture-', dir=Path(os.environ.get('GB_QA_SCRATCH_DIR', ROOT.parent)));self.p=Path(self.tmp.name)
        self.install=self.p/'install';self.state=self.p/'state';self.bundle=self.p/'bundle';self.autonomy=self.p/'autonomy'
        for path in (self.install,self.state,self.bundle,self.autonomy): path.mkdir()
        self.policy=self.p/'policy.json';self.journal=self.state/'stage5-cursor-context.json'
        self.backup=self.state/'stage5-cursor-context-backup';self.inventory=self.state/'backup.json'
        self.baseline='b'*40;self.controller='a'*40
        self.oldpolicy=dict(mode='active',controller_sha=self.baseline,stage_workflow_sha256='c'*64,
                            recovery={'source_sha':self.baseline})
        self.policy.write_text(json.dumps(self.oldpolicy,indent=2))
        self.git('init','-b','dev');self.git('remote','add','origin','https://github.com/anpavel84-afk/gobadminton-clean.git')
        canon=self.bundle/U.BUNDLE_RULES;canon.parent.mkdir(parents=True);canon.write_bytes(RULES)
        self.git('add','.');self.git('commit','-m','Synthetic accepted canon');self.rules_commit=self.git('rev-parse','HEAD')
        policy_src=("RULES_SHA256 = '%s'\nRULES_SIZE = %d\nRULES_COMMIT = '%s'\n"%(H(RULES),len(RULES),self.rules_commit))
        self.items={};self.oldfiles={}
        for name in (*sorted(U.TARGETS),'core.py','context_policy.py','native_cursor.py','native_guard.py','receiver.py'):
            target=self.install/name;source=self.bundle/U.PREFIX/name;source.parent.mkdir(parents=True,exist_ok=True)
            raw=policy_src.encode() if name=='context_policy.py' else ('same '+name).encode()
            if name in U.TARGETS:
                source.write_bytes(('after '+name).encode())
                if name=='stage.py': target.write_bytes(b'before stage.py')
            else: source.write_bytes(raw);target.write_bytes(raw)
            self.items[target]=source
        helper=self.bundle/'scripts/chatops/server/gb-deploy-helper.sh';helper.parent.mkdir(parents=True)
        helper.write_bytes(b'synthetic helper');target=self.p/'helper';target.write_bytes(helper.read_bytes());self.items[target]=helper
        self.rules=self.install/'accepted-engineering-rules.md';self.rules.write_bytes(RULES)
        for path in (*self.items,self.rules):
            if path.exists(): self.oldfiles[str(path)]=path.read_bytes()
        record=dict(manifest='original full install manifest',after={k:H(raw) for k,raw in self.oldfiles.items()},
                    before={'historical':'unchanged'},targets=['historical original backup paths'])
        self.inventory.write_text(json.dumps(record,indent=2));self.inventory.chmod(0o600)
        for name in ('slot1.json','slot2.json','recovery.json'): (self.state/name).write_text('{"history":"immutable"}')
        for path in (self.autonomy/'slots/slot1',self.autonomy/'outbox/slot1',self.state/'history/slot1'):
            path.mkdir(parents=True);(path/'evidence').write_bytes(b'UNKNOWN and paid receipt retained')
        self.budget=self.p/'budget.json';self.budget.write_text('{"existing":"budget"}')
        wf=self.bundle/'.github/workflows';wf.mkdir(parents=True)
        for name in ('train-stage.yml','train-dispatch.yml'): (wf/name).write_text(('ref: '+self.controller+'\n')*2)
        self.sh=H((wf/'train-stage.yml').read_bytes());self.dh=H((wf/'train-dispatch.yml').read_bytes())
        self.manifest_path=self.bundle/U.MANIFEST_PATH
        self.manifest_path.write_text(json.dumps(dict(schema='GB_ACTIONS_TRAIN_INSTALL_V1',
            files={str(path.relative_to(self.bundle)):H(path.read_bytes()) for path in self.items.values()})))
        script=self.bundle/U.SCRIPT_REPO_PATH;script.parent.mkdir(parents=True,exist_ok=True)
        script.write_bytes(Path(U.__file__).read_bytes())
        self.git('add','.');self.git('commit','-m','Synthetic exact reviewed source');self.commit=self.git('rev-parse','HEAD')
        self.manifest=H(self.manifest_path.read_bytes())
        self.pins={name:H(('same '+name).encode()) for name in U.FROZEN}
        self.stack=contextlib.ExitStack()
        for obj,key,value in ((U,'INSTALL',self.install),(U,'STATE',self.state),(U,'JOURNAL',self.journal),
            (U,'BACKUP',self.backup),(U,'INSTALLED_RULES',self.rules),(U,'FROZEN',self.pins),
            (U,'RULES_SHA256',H(RULES)),(U,'RULES_SIZE',len(RULES)),(U,'RULES_COMMIT',self.rules_commit),
            (U,'OWNER_UID',os.getuid()),(U,'OWNER_GID',os.getgid()),(receiver,'POLICY',self.policy),
            (receiver,'BUDGET',self.budget),(receiver,'AUTONOMY',self.autonomy)):
            self.stack.enter_context(patch.object(obj,key,value))
        self.quiet=self.stack.enter_context(patch.object(U,'quiet'))
        self.stack.enter_context(patch.object(U.os,'geteuid',return_value=0))
        # Retain no-link/mode/ownership checks; substitute only fixture UID for root.
        def trusted(path):
            for item in (Path(path),*Path(path).parents):
                info=item.lstat()
                U.need(not stat.S_ISLNK(info.st_mode) and info.st_uid in (0,os.getuid())
                       and not info.st_mode & 0o022,'unsafe fixture path')
        self.stack.enter_context(patch.object(receiver,'trusted_tree',side_effect=trusted))
        mapping=U.payload_target
        self.stack.enter_context(patch.object(U,'payload_target',side_effect=lambda path:
            self.p/'helper' if path=='scripts/chatops/server/gb-deploy-helper.sh' else mapping(path)))
        self.stack.enter_context(patch.object(U.urllib.request,'urlopen',side_effect=AssertionError('network forbidden')))
        self.initial=self.files()

    def tearDown(self):
        self.stack.close();self.tmp.cleanup()

    def call(self,action,baseline=None):
        return U.execute(action,self.bundle,self.manifest,self.controller,self.sh,self.dh,123,
                         baseline or self.baseline,self.commit,'dev')

    def files(self):
        return {str(path.relative_to(self.p)):path.read_bytes() for path in self.p.rglob('*') if path.is_file()}

    def refresh(self,update_manifest=True):
        if update_manifest:
            manifest=json.loads(self.manifest_path.read_bytes())
            manifest['files']={str(path.relative_to(self.bundle)):H(path.read_bytes()) for path in self.items.values()}
            self.manifest_path.write_text(json.dumps(manifest))
        self.git('add','.');self.git('commit','-m','Changed synthetic reviewed input')
        self.commit=self.git('rev-parse','HEAD');self.manifest=H(self.manifest_path.read_bytes())

    def test_dry_zero_effects_apply_rollback_restore_exact_bytes(self):
        before=self.files();result=self.call('dry');self.assertTrue(result['dry'])
        self.assertEqual(set(result['changes']),U.TARGETS);self.assertEqual(before,self.files())
        snapshot=U.preserved();oldinventory=self.inventory.read_bytes();oldpolicy=self.policy.read_bytes()
        result=self.call('apply');self.assertEqual(result['phase'],'installed-lib-only')
        self.assertFalse(result['ready']);self.assertFalse(result['cursor_scoped_v1'])
        self.assertEqual((self.install/'stage.py').read_bytes(),b'after stage.py')
        self.assertEqual(self.policy.read_bytes(),oldpolicy);self.assertEqual(snapshot,U.preserved())
        record=json.loads(oldinventory);new=json.loads(self.inventory.read_bytes())
        for name in U.TARGETS: record['after'][str(self.install/name)]=H(self.items[self.install/name].read_bytes())
        self.assertEqual(record,new)  # original full manifest and all other fields preserved
        self.assertEqual(self.call('rollback')['phase'],'rolled-back')
        self.assertEqual(self.inventory.read_bytes(),oldinventory)
        for path,raw in self.oldfiles.items(): self.assertEqual(Path(path).read_bytes(),raw)
        self.assertFalse((self.install/'context_cursor_delivery.py').exists());self.assertEqual(snapshot,U.preserved())
        self.assertEqual(self.policy.read_bytes(),oldpolicy)
        with self.assertRaises(core.Refused): self.call('apply')

    def test_full_snapshot_survives_git_auto_gc_threshold(self):
        # Git samples objects/17 for automatic GC. Reach its default threshold
        # with real tracked blobs, then commit during a full filesystem snapshot.
        # Automatic maintenance must not race the fixture's snapshot/cleanup.
        picked=[]
        for number in range(20000):
            raw=('snapshot regression blob %d\n'%number).encode()
            oid=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            if oid.startswith('17'):
                (self.bundle/('gc-probe-'+str(number))).write_bytes(raw)
                picked.append(oid)
                if len(picked)==28: break
        self.assertEqual(len(picked),28)
        self.git('add','.')
        target=self.bundle/'.git/objects'/picked[0][:2]/picked[0][2:]
        self.assertTrue(target.is_file())
        original_read=Path.read_bytes;committed=False
        def interleave(path):
            nonlocal committed
            if path==target and not committed:
                committed=True
                # Make an accidental GC synchronous, so the unprotected helper
                # deterministically loses the loose object before this read.
                self.git('-c','gc.autoDetach=false','-c','maintenance.autoDetach=false',
                         'commit','-m','Snapshot regression GC threshold')
            return original_read(path)
        with patch.object(Path,'read_bytes',interleave): self.files()
        self.assertTrue(committed)
        # Confirm every seeded object is still loose and captured. Skipping .git
        # or swallowing vanished-file errors cannot satisfy this regression.
        snapshot=self.files()
        self.assertEqual(snapshot,self.files())
        for oid in picked:
            object_path=self.bundle/'.git/objects'/oid[:2]/oid[2:]
            self.assertIn(str(object_path.relative_to(self.p)),snapshot)
        self.assertFalse(list((self.bundle/'.git/objects/pack').glob('*.pack')))
        for path in (self.bundle/'.git/config',self.policy,self.inventory,
                     self.install/'stage.py',self.state/'slot1.json'):
            with self.subTest(path=str(path.relative_to(self.p))):
                raw=path.read_bytes()
                try:
                    path.write_bytes(raw+b'\nregression drift')
                    self.assertNotEqual(snapshot,self.files())
                finally: path.write_bytes(raw)
                self.assertEqual(snapshot,self.files())

    def test_stale_installed_rules_pin_refused_before_effects(self):
        self.rules.write_bytes(b'old rules')
        record=json.loads(self.inventory.read_bytes());record['after'][str(self.rules)]=H(b'old rules')
        self.inventory.write_text(json.dumps(record));before=self.files()
        with self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual(before,self.files())

    def test_extra_pending_bump_or_marker_module_drift_refused(self):
        target=self.install/'core.py';self.items[target].write_bytes(b'different core')
        self.refresh()
        with self.assertRaisesRegex(core.Refused,'unexpected changed target'): self.call('dry')
        self.items[target].write_bytes(b'same core.py');self.refresh()
        for name in U.FROZEN:
            with self.subTest(name=name):
                self.items[self.install/name].write_bytes(b'changed');(self.install/name).write_bytes(b'changed')
                self.refresh()
                with self.assertRaisesRegex(core.Refused,'marker module not byte-identical'): self.call('dry')
                self.items[self.install/name].write_bytes(('same '+name).encode());(self.install/name).write_bytes(('same '+name).encode())
                self.refresh()

    def test_wrong_baseline_and_bundle_canon_drift_refused(self):
        with self.assertRaises(core.Refused): self.call('dry','c'*40)
        (self.bundle/U.BUNDLE_RULES).write_bytes(b'other');self.refresh()
        with self.assertRaises(core.Refused): self.call('dry')

    def test_checked_material_survives_source_swap(self):
        original=U.atomic_bytes;source=self.items[self.install/'stage.py'];verified=source.read_bytes();swapped=False
        def swap(path,raw,meta):
            nonlocal swapped
            if path.parent==self.backup and not swapped:
                source.write_bytes(b'unreviewed replacement');swapped=True
            return original(path,raw,meta)
        with patch.object(U,'atomic_bytes',side_effect=swap): self.call('apply')
        self.assertTrue(swapped);self.assertEqual((self.install/'stage.py').read_bytes(),verified)
        source.write_bytes(verified)
        self.call('rollback');self.assertEqual((self.install/'stage.py').read_bytes(),b'before stage.py')

    def test_backup_integrity_all_checked_before_effects_and_restore(self):
        original=U.atomic_bytes
        def corrupt(path,raw,meta):
            original(path,raw,meta)
            if path==self.backup/'inventory': (self.backup/'stage.py').write_bytes(b'corrupt')
        with patch.object(U,'atomic_bytes',side_effect=corrupt),self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual((self.install/'stage.py').read_bytes(),b'before stage.py')
        self.assertFalse((self.install/'context_cursor_delivery.py').exists())
        # No restoration from corrupt backups, including a preparing transaction.
        with self.assertRaises(core.Refused): self.call('rollback')

    def test_after_activation_no_rollback_and_state_drift_blocks_activation(self):
        self.call('apply');path=self.state/'slot1.json';path.write_bytes(b'{"new":"real state"}')
        with patch.object(U,'probe',return_value={'run':1}) as probe:
            with self.assertRaises(core.Refused): self.call('activate')
            probe.assert_not_called()
        with self.assertRaises(core.Refused): self.call('rollback')
        self.assertEqual(path.read_bytes(),b'{"new":"real state"}')

    def test_activation_proof_only_then_rollback_refused(self):
        self.call('apply');old=self.policy.read_bytes();snapshot=U.preserved()
        def proof(*args):
            self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'activating-proof')
            return {'run':1}
        with patch.object(U,'probe',side_effect=proof): result=self.call('activate')
        self.assertEqual(result['phase'],'proof-recorded');self.assertFalse(result['ready'])
        self.assertFalse(result['cursor_scoped_v1']);self.assertEqual(self.policy.read_bytes(),old)
        self.assertEqual(snapshot,U.preserved())
        with self.assertRaises(core.Refused): self.call('rollback')

    def test_failed_probe_is_recoverable_without_policy_write(self):
        self.call('apply');old=self.policy.read_bytes()
        with patch.object(U,'probe',side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError): self.call('activate')
        self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'activating-proof')
        self.assertEqual(self.policy.read_bytes(),old)
        with patch.object(U,'probe',return_value={'run':1}): self.call('activate')
        self.assertEqual(self.policy.read_bytes(),old)

    def test_failed_probe_can_rollback_before_proof_receipt(self):
        self.call('apply')
        with patch.object(U,'probe',side_effect=RuntimeError('offline')):
            with self.assertRaises(RuntimeError): self.call('activate')
        self.call('rollback')
        for path,raw in self.oldfiles.items(): self.assertEqual(Path(path).read_bytes(),raw)
        self.assertFalse((self.install/'context_cursor_delivery.py').exists())

    def test_activation_receipt_interruption_reconciles_intent(self):
        self.call('apply');original=U.atomic_bytes;counter=0
        def interrupt(path,raw,meta):
            nonlocal counter
            counter+=1
            if counter==2: raise RuntimeError('before proof receipt rename')
            return original(path,raw,meta)
        with patch.object(U,'atomic_bytes',side_effect=interrupt),patch.object(U,'probe',return_value={'run':1}):
            with self.assertRaises(RuntimeError): self.call('activate')
        self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'activating-proof')
        with patch.object(U,'probe',return_value={'run':1}): self.call('activate')
        self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'proof-recorded')
        self.assertEqual(json.loads(self.policy.read_bytes()),self.oldpolicy)

    def test_transaction_schema_identity_membership_and_backup_validation(self):
        self.call('apply');original=self.journal.read_bytes();outside=self.p/'outside';outside.write_bytes(b'never touched')
        variants=[]
        for key,value in (('schema','foreign'),('phase','active'),('installed_at',True)):
            j=json.loads(original);j[key]=value;variants.append(j)
        for key in ('controller','baseline','stage_sha256','dispatch_sha256','bundle_commit','manifest','bundle_branch','script_sha256'):
            j=json.loads(original);j['identity'][key]='foreign';j['identity_sha256']=U.digest(j['identity']);variants.append(j)
        j=json.loads(original);j['changes'][str(outside)]={'before':None,'after':{'sha256':'a'*64}};variants.append(j)
        j=json.loads(original);j['changes'].pop('stage.py');variants.append(j)
        for key,value in (('sha256','bad'),('mode',0o666),('uid',os.getuid()+1),('gid',-1)):
            j=json.loads(original);j['changes']['stage.py']['before'][key]=value;variants.append(j)
        for j in variants:
            with self.subTest(variant=j):
                self.journal.write_text(json.dumps(j));before=self.files()
                for action in ('activate','rollback'):
                    with self.assertRaises(core.Refused): self.call(action)
                    self.assertEqual(before,self.files())
        self.journal.write_bytes(original)
        (self.backup/'stage.py').write_bytes(b'wrong');before=self.files()
        with self.assertRaises(core.Refused): self.call('rollback')
        self.assertEqual(before,self.files());self.assertEqual(outside.read_bytes(),b'never touched')

    def test_policy_controller_and_workflow_drift_blocks_both_actions(self):
        self.call('apply');raw=self.policy.read_bytes()
        for key in ('controller_sha','stage_workflow_sha256'):
            p=json.loads(raw);p[key]='f'*len(p[key]);self.policy.write_text(json.dumps(p));before=self.files()
            for action in ('activate','rollback'):
                with self.assertRaises(core.Refused): self.call(action)
                self.assertEqual(before,self.files())
        self.policy.write_bytes(raw)

    def test_rules_ast_unique_literal_commit_and_hidden_overrides(self):
        raw=self.items[self.install/'context_policy.py'].read_bytes();U.rules_pin(raw)
        cases=[raw+b"RULES_SHA256 = '"+H(RULES).encode()+b"'\n",raw+b'RULES_SIZE = (\n1\n)\n',
               b'"""\n'+raw+b'"""\n',raw.replace(self.rules_commit.encode(),b'a'*40),
               b'\n'.join(line for line in raw.splitlines() if not line.startswith(b'RULES_COMMIT')),
               raw+b'def f():\n global RULES_SIZE\n RULES_SIZE = 1\n',
               raw+b'import os as RULES_COMMIT\n',raw+b'RULES_SIZE += 0\n',
               raw+b'if True:\n RULES_SIZE = 1\n',raw+b'del RULES_COMMIT\n',raw+b'try:\n pass\nexcept Exception as RULES_SIZE:\n pass\n',
               raw+b'match 1:\n case RULES_SIZE:\n  pass\n']
        for bad in cases:
            with self.subTest(raw=bad),self.assertRaises(core.Refused): U.rules_pin(bad)
        source=self.items[self.install/'context_policy.py'];source.write_bytes(cases[0]);self.refresh();before=self.files()
        with self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual(before,self.files())

    def test_git_identity_cleanliness_and_full_blob_equality(self):
        before=self.files();self.call('dry');self.assertEqual(before,self.files())
        self.git('remote','set-url','origin','https://example.invalid/foreign')
        with self.assertRaises(core.Refused): self.call('dry')
        self.git('remote','set-url','origin','https://github.com/anpavel84-afk/gobadminton-clean.git')
        self.git('branch','-m','foreign')
        with self.assertRaises(core.Refused): self.call('dry')
        self.git('branch','-m','dev');(self.bundle/'untracked').write_bytes(b'dirty')
        with self.assertRaises(core.Refused): self.call('dry')
        (self.bundle/'untracked').unlink()
        # assume-unchanged hides drift from Git status; full blob equality must catch it.
        name=U.PREFIX+'core.py';self.git('update-index','--assume-unchanged',name)
        (self.bundle/name).write_bytes(b'worktree not blob')
        self.assertFalse(self.git('status','--porcelain'))
        with self.assertRaises(core.Refused): self.call('dry')
        (self.bundle/name).write_bytes(b'same core.py');self.git('update-index','--no-assume-unchanged',name)
        with self.assertRaises(core.Refused):
            U.source(self.bundle,'d'*40,'dev',self.manifest,self.controller,self.sh,self.dh)
        other=self.p/'nongit';other.mkdir()
        with self.assertRaises(OSError): U.source(other,self.commit,'dev',self.manifest,self.controller,self.sh,self.dh)

    def test_manifest_completeness_and_inventory_scope(self):
        raw=self.manifest_path.read_bytes();m=json.loads(raw);m['files'].pop(U.PREFIX+'core.py')
        self.manifest_path.write_text(json.dumps(m));self.refresh(update_manifest=False);before=self.files()
        with self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual(before,self.files())
        self.manifest_path.write_bytes(raw);self.refresh()
        original=self.inventory.read_bytes();record=json.loads(original)
        record['after'][str(self.p/'outside')]='f'*64;self.inventory.write_text(json.dumps(record));before=self.files()
        with self.assertRaises(core.Refused): self.call('dry')
        self.assertEqual(before,self.files())

    def test_untrusted_git_config_refused_before_subprocess(self):
        config=self.bundle/'.git/config';raw=config.read_bytes()
        cases=[b'[core]\n fsmonitor = execute-me\n',b'[filter "bad"]\n clean = execute-me\n',
               b'[include]\n path = outside\n',b'[core]\n hooksPath = outside\n',
               b'[diff "x"]\n textconv = execute-me\n',b'[core]\n editor = execute-me\n',
               b'[core]\n filemode = true\\\n fsmonitor = execute-me\n',
               b'[extensions]\n worktreeConfig = true\n',b'[alias]\n x = !execute-me\n']
        for extra in cases:
            with self.subTest(config=extra):
                config.write_bytes(raw+extra)
                with patch.object(U,'git',side_effect=AssertionError('must reject before Git')) as git:
                    with self.assertRaises(core.Refused): self.call('dry')
                    git.assert_not_called()
        config.write_bytes(raw)

    def test_bounded_nofollow_reader_rejects_fifo_hardlink_symlink_device_oversize(self):
        target=self.p/'input';target.write_bytes(b'valid')
        self.assertEqual(U.regular_bytes(target),b'valid')
        link=self.p/'link';os.link(target,link)
        with self.assertRaises(core.Refused): U.regular_bytes(target)
        link.unlink();target.unlink();target.symlink_to(self.rules)
        with self.assertRaises((core.Refused,OSError)): U.regular_bytes(target)
        target.unlink();os.mkfifo(target)
        with self.assertRaises(core.Refused): U.regular_bytes(target)
        target.unlink();target.write_bytes(b'x'*129)
        with self.assertRaises(core.Refused): U.read_file(target,limit=128)
        target.chmod(0o666)
        with self.assertRaises(core.Refused): U.regular_bytes(target)
        with self.assertRaises(core.Refused): U.read_file(Path('/dev/null'),trusted=False)
        folder=self.p/'parent';folder.symlink_to(self.install,target_is_directory=True)
        with self.assertRaises(OSError): U.regular_bytes(folder/'stage.py')

    def test_reader_rejects_replacement_during_read(self):
        path=self.p/'race';path.write_bytes(b'old');original=U.os.fstat;calls=0
        def racing(fd):
            nonlocal calls
            result=original(fd);calls+=1
            if calls==1:
                temp=self.p/'new';temp.write_bytes(b'new');temp.replace(path)
            return result
        with patch.object(U.os,'fstat',side_effect=racing),self.assertRaises(core.Refused): U.regular_bytes(path)

    def test_bundle_fifo_is_nonblocking_and_refused(self):
        canon=self.bundle/U.BUNDLE_RULES;canon.unlink();os.mkfifo(canon);before=(self.install/'stage.py').read_bytes()
        with self.assertRaises(core.Refused): self.call('dry')
        self.assertEqual((self.install/'stage.py').read_bytes(),before)
        canon.unlink();canon.write_bytes(RULES)

    def test_cli_dry_requires_existing_lock_and_has_zero_effects(self):
        args=['stage5','dry','--bundle',str(self.bundle),'--manifest',self.manifest,
              '--baseline-controller',self.baseline,'--controller',self.controller,'--stage-hash',self.sh,
              '--dispatch-hash',self.dh,'--bundle-commit',self.commit]
        before=self.files()
        with patch.object(sys,'argv',args),self.assertRaises(FileNotFoundError): U.main()
        self.assertEqual(before,self.files());lock=self.state/'controller.lock';lock.write_bytes(b'');lock.chmod(0o600)
        before=self.files()
        with patch.object(sys,'argv',args),contextlib.redirect_stdout(io.StringIO()) as out: U.main()
        self.assertTrue(json.loads(out.getvalue())['dry']);self.assertEqual(before,self.files())
        with lock.open('rb') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(sys,'argv',args),self.assertRaises(BlockingIOError): U.main()
        self.assertEqual(before,self.files())

    def test_quiet_requires_idle_no_pending_and_all_gates(self):
        # Call the real definition captured from a second import; no live functions.
        spec=importlib.util.spec_from_file_location('stage5_quiet_only',U.__file__)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        state={'active':None};journal={'pending':None};recovery={'receipts':{}}
        with patch.object(module,'STATE',self.state),patch.object(module,'run',return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n'), \
             patch.object(module,'lock_unheld') as locks,patch.object(receiver,'units_quiet') as units, \
             patch.object(receiver,'journal',side_effect=lambda slot:journal),patch.object(receiver,'checkpoint',side_effect=lambda slot:(state,None)), \
             patch.object(receiver,'no_models') as models,patch.object(receiver,'recovery_journal',side_effect=lambda:recovery), \
             patch('pwd.getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid())):
            module.quiet();self.assertEqual(models.call_count,2);self.assertEqual(locks.call_count,4);units.assert_called_once()
            state['active']={'phase':'done'};module.quiet()
            for phase in ('candidate','pr_wait','qa','ci','author','integrating','unknown'):
                state['active']={'phase':phase}
                with self.subTest(phase=phase),self.assertRaises(core.Refused): module.quiet()
            state['active']=None
            for pending in ({'safe':'but unfinished'},{}):
                journal['pending']=pending
                with self.assertRaises(core.Refused): module.quiet()
            journal['pending']=None
            for gate in (units,models,locks):
                gate.side_effect=core.Refused('busy')
                with self.assertRaises(core.Refused): module.quiet()
                gate.side_effect=None
            (self.state/'integration.json').write_bytes(b'{}')
            with self.assertRaises(core.Refused): module.quiet()
            (self.state/'integration.json').unlink();recovery['receipts']={'x':{'status':'analysis_pending'}}
            with self.assertRaises(core.Refused): module.quiet()
            recovery['receipts']={}
            with patch.object(module,'run',return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=disabled\n'):
                with self.assertRaises(core.Refused): module.quiet()

    def test_kernel_slot_lock_observation(self):
        path=self.p/'slot.lock';path.write_bytes(b'');before=self.files()
        U.lock_unheld(path,os.getuid())
        with path.open('rb') as held:
            fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(core.Refused): U.lock_unheld(path,os.getuid())
        self.assertEqual(before,self.files())

    def test_finite_apply_atomic_boundaries_recover_without_unproven_restore(self):
        # Only changed transaction boundaries, not the original adversarial suite.
        for boundary in range(1,10):
            for timing in ('before','after'):
                with self.subTest(boundary=boundary,timing=timing):
                    fixture=Stage5Install();fixture.setUp()
                    try:
                        atomic=U.atomic_bytes;counter=0
                        def interrupted(path,raw,meta):
                            nonlocal counter
                            counter+=1
                            if counter==boundary and timing=='before': raise RuntimeError('atomic boundary')
                            result=atomic(path,raw,meta)
                            if counter==boundary and timing=='after': raise RuntimeError('atomic boundary')
                            return result
                        with patch.object(U,'atomic_bytes',side_effect=interrupted):
                            try: fixture.call('apply')
                            except RuntimeError: pass
                        if fixture.journal.exists():
                            phase=json.loads(fixture.journal.read_bytes())['phase']
                            self.assertIn(phase,('preparing','applying','installed-lib-only'))
                            fixture.call('rollback')
                        else:
                            self.assertFalse(fixture.backup.exists());fixture.call('apply');fixture.call('rollback')
                        for path,raw in fixture.oldfiles.items(): self.assertEqual(Path(path).read_bytes(),raw)
                        self.assertFalse((fixture.install/'context_cursor_delivery.py').exists())
                        self.assertEqual(json.loads(fixture.journal.read_bytes())['phase'],'rolled-back')
                    finally: fixture.tearDown()

    def test_real_probe_contract_with_synthetic_responses(self):
        self.call('apply');j=json.loads(self.journal.read_bytes());j['dispatch_sha256']=self.dh
        workflow=(self.bundle/'.github/workflows/train-dispatch.yml').read_bytes()
        run=dict(path='.github/workflows/train-dispatch.yml',head_branch='dev',event='workflow_dispatch',
                 status='completed',conclusion='success',repository={'id':1416250340},
                 head_repository={'id':1416250340},actor={'id':318610566},created_at='2099-01-01T00:00:00Z',
                 run_attempt=1,head_sha=self.commit)
        jobs={'jobs':[{'name':name,'conclusion':'success'} for name in ('reconcile','publish_phase_drafts')]}
        content=dict(encoding='base64',content=base64.b64encode(workflow).decode())
        def probe(responses):
            with patch.object(U.urllib.request,'urlopen',side_effect=[io.BytesIO(json.dumps(v).encode()) for v in responses]):
                return U.probe(123,j)
        self.assertEqual(probe([run,jobs,content])['head'],self.commit)
        for key,value in (('repository',{'id':1}),('head_repository',{'id':1}),('actor',{'id':1}),
                          ('head_branch','foreign'),('path','foreign'),('conclusion','failure'),
                          ('event','push'),('status','in_progress'),('created_at','2000-01-01T00:00:00Z')):
            with self.subTest(key=key),self.assertRaises(core.Refused): probe([dict(run,**{key:value}),jobs,content])
        with self.assertRaises(core.Refused): probe([run,{'jobs':[]},content])
        with self.assertRaises(core.Refused): probe([run,jobs,dict(content,content=base64.b64encode(b'foreign').decode())])
        with self.assertRaises(core.Refused): probe([run,jobs,dict(content,encoding='plain')])

    def test_workflow_manifest_baseline_and_installed_drift_gates(self):
        with self.assertRaises(core.Refused):
            U.execute('dry',self.bundle,'0'*64,self.controller,self.sh,self.dh,123,self.baseline,self.commit,'dev')
        with self.assertRaises(core.Refused):
            U.execute('dry',self.bundle,self.manifest,self.controller,'0'*64,self.dh,123,self.baseline,self.commit,'dev')
        target=self.install/'core.py';raw=target.read_bytes();target.write_bytes(b'foreign live code')
        with self.assertRaises(core.Refused): self.call('apply')
        target.write_bytes(raw);self.call('apply');target=self.install/'stage.py';target.write_bytes(b'foreign installed candidate')
        before=self.files()
        for action in ('activate','rollback'):
            with self.assertRaises(core.Refused): self.call(action)
            self.assertEqual(before,self.files())

    def test_crash_temporary_residues_are_recovered_at_fixed_paths(self):
        self.call('apply')
        # Reconstruct an interruption during atomic replacement: old journal is
        # durable, while target/inventory/journal temps may contain partial bytes.
        for path in (self.install/'context_cursor_delivery.py',self.install/'stage.py',self.inventory,self.journal):
            temp=path.with_name(U.temp_name(path));temp.write_bytes(b'partial');temp.chmod(0o600)
        self.call('rollback')
        for path in (self.install/'context_cursor_delivery.py',self.install/'stage.py',self.inventory,self.journal):
            self.assertFalse(path.with_name(U.temp_name(path)).exists())
        for path,raw in self.oldfiles.items(): self.assertEqual(Path(path).read_bytes(),raw)
        self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'rolled-back')

    def test_rollback_interruption_and_unlink_directory_fsync(self):
        self.call('apply');original=U.atomic_bytes;fired=False
        def interrupt(path,raw,meta):
            nonlocal fired
            result=original(path,raw,meta)
            if path==self.install/'stage.py' and not fired: fired=True;raise RuntimeError('rollback interrupted')
            return result
        with patch.object(U,'atomic_bytes',side_effect=interrupt),self.assertRaises(RuntimeError): self.call('rollback')
        self.assertEqual(json.loads(self.journal.read_bytes())['phase'],'rolling-back')
        self.call('rollback')
        for path,raw in self.oldfiles.items(): self.assertEqual(Path(path).read_bytes(),raw)
        path=self.p/'unlink';path.write_bytes(b'x')
        with patch.object(U.os,'fsync',wraps=os.fsync) as sync: U.unlink_durable(path)
        self.assertEqual(sync.call_count,1);self.assertFalse(path.exists())


if __name__=='__main__': unittest.main()
