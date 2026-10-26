"""AGY29 inventory re-record installer: single-entry byte-exact write, gate, idempotence, rollback. Synthetic state only."""
import contextlib
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
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
SCRIPT=Path(__file__).resolve().parents[1]/'ops'/'agy29_inventory_rerecord.py'
spec=importlib.util.spec_from_file_location('inventory_rerecord',SCRIPT)
I=importlib.util.module_from_spec(spec);spec.loader.exec_module(I)

SS=hashlib.sha256(SCRIPT.read_bytes()).hexdigest()
OLD,NEW=b'eom 1.3 rules',b'eom 1.4 rules'
H=lambda raw:hashlib.sha256(raw).hexdigest()


class Fixture:
    """Synthetic root: 32-entry inventory whose rules entry is the stale C5 value."""
    def __init__(self,test,layout):
        self.test=test;self.layout=layout;self._patched={}
        self.root=Path(tempfile.mkdtemp());test.addCleanup(lambda:__import__('shutil').rmtree(self.root,True))
        self.stack=contextlib.ExitStack();test.addCleanup(self.stack.close)
        root=self.root;self.lib=root/'lib';self.lib.mkdir();self.state=root/'state';self.state.mkdir()
        autonomy=root/'autonomy'
        for slot in ('slot1','slot2'):(autonomy/'slots'/slot).mkdir(parents=True)
        (autonomy/'locks').mkdir()
        self.paths=dict(LIB=self.lib,STATE=self.state,AUTONOMY=autonomy,POLICY=root/'policy',MARKER=root/'marker',
            BUDGET=root/'budget',INVENTORY=self.state/'backup.json',BK=self.state/'rerecord-backup',J=self.state/'rerecord.json')
        for key,value in self.paths.items():self.stack.enter_context(patch.object(I,key,value))
        for key in ('POLICY','MARKER','BUDGET'):self.paths[key].write_text('{}')
        required=[self.state/'slot1.json',self.state/'slot2.json']
        for path in required:path.write_text('{"pending":null}')
        self.stack.enter_context(patch.object(I,'REQUIRED_STATE',required))
        self.stack.enter_context(patch.object(I,'UNCHANGED',{}))
        self.stack.enter_context(patch.object(I,'idle'))
        self.stack.enter_context(patch.object(I,'R',SimpleNamespace(trusted_tree=lambda p:None)))
        self.stack.enter_context(patch.object(I.os,'fchown'))  # synthetic identity; production ownership gate stays mandatory
        self.stack.enter_context(patch.object(I,'INVENTORY_ENTRIES',32));self.stack.enter_context(patch.object(I,'OWNER_UID',os.getuid()))
        (self.lib/I.RULES_NAME).write_bytes(NEW)
        entries={str(self.lib/I.RULES_NAME):H(OLD)}
        for n in range(31):
            path=self.lib/('file%d'%n);path.write_bytes(('content %d'%n).encode());entries[str(path)]=H(path.read_bytes())
        self.inventory=dict(manifest=I.OLD_MANIFEST,after=entries)
        (self.state/I.C5_BACKUP_NAME).mkdir();(self.state/I.C5_BACKUP_NAME/'rules').write_bytes(OLD)
        self.receipt=dict(schema=I.C5_SCHEMA,phase='active',controller_sha=I.C,manifest_sha256=I.OLD_MANIFEST,
            rules_sha256=H(NEW),backups=dict(rules=dict(mode=420,sha256=H(OLD))))
        self.write_receipt()
        self.write_inventory()

    def write_receipt(self,edit=None):
        receipt=json.loads(json.dumps(self.receipt))
        if edit:edit(receipt)
        raw=json.dumps(receipt,sort_keys=True).encode()
        (self.state/I.C5_RECEIPT_NAME).write_bytes(raw)
        for key,value in (('RULES_INVENTORY_SHA',H(OLD)),('RULES_LIVE_SHA',H(NEW)),('C5_RECEIPT_SHA',H(raw))):
            if key in self._patched:self._patched[key].stop()
            patcher=patch.object(I,key,value);patcher.start();self.test.addCleanup(patcher.stop)
            self._patched[key]=patcher

    def write_inventory(self):
        text=json.dumps(self.inventory,indent=2) if self.layout=='pretty' else json.dumps(self.inventory,sort_keys=True)
        self.paths['INVENTORY'].write_text(text)

    def tree(self):
        return {p:p.read_bytes() for p in self.root.rglob('*') if p.is_file()}


class RerecordTests(unittest.TestCase):
    def fixture(self,layout='compact'):return Fixture(self,layout)

    def test_edit_is_a_single_byte_exact_value_for_every_layout(self):
        for layout in ('compact','pretty'):
            with self.subTest(layout=layout):
                f=self.fixture(layout);raw=f.paths['INVENTORY'].read_bytes();new=I.rerecorded_bytes(raw)
                self.assertEqual(len(new),len(raw))
                diff=[i for i,(a,b) in enumerate(zip(raw,new)) if a!=b]
                self.assertTrue(diff and diff[-1]-diff[0]<64)
                self.assertEqual(new,raw.replace(H(OLD).encode(),H(NEW).encode()))
                self.assertEqual(json.loads(new)['after'][str(f.lib/I.RULES_NAME)],H(NEW))
                self.assertEqual(json.loads(new)['manifest'],I.OLD_MANIFEST)

    def test_edit_refuses_unexpected_shapes(self):
        f=self.fixture();rules=str(f.lib/I.RULES_NAME)
        def refuses(message,mutate):
            inventory=json.loads(json.dumps(f.inventory));mutate(inventory)
            with self.assertRaisesRegex(I.Refused,message):I.rerecorded_bytes(json.dumps(inventory,sort_keys=True).encode())
        refuses('manifest/membership',lambda i:i.update(manifest='0'*64))
        refuses('manifest/membership',lambda i:i['after'].pop(next(k for k in i['after'] if k!=rules)))
        refuses('manifest/membership',lambda i:i['after'].update(extra='1'*64))
        refuses('no rules entry',lambda i:(i['after'].pop(rules),i['after'].update(other='1'*64)))
        refuses('not the stale',lambda i:i['after'].update({rules:'a'*64}))
        refuses('not the stale',lambda i:i['after'].update({rules:H(NEW)}))   # already re-recorded
        refuses('not unique',lambda i:(i['after'].pop(next(k for k in i['after'] if k!=rules)),i['after'].update(dup=H(OLD))))        # stale value appears twice
        refuses('not unique',lambda i:i.update(note=H(NEW)))                  # new value already present

    def test_observation_gate(self):
        f=self.fixture();observed=I.observation()
        self.assertEqual(observed['change'],dict(path=str(f.lib/I.RULES_NAME),before=H(OLD),after=H(NEW)))
        self.assertEqual(observed['rules_provenance']['c5_receipt_sha256'],I.C5_RECEIPT_SHA)
        def refuses(message,mutate,restore):
            mutate()
            try:
                with self.assertRaisesRegex(I.Refused,message):I.observation()
            finally:restore()
        other=f.lib/'file3';raw=other.read_bytes()
        refuses('live inventory byte drift',lambda:other.write_bytes(b'x'),lambda:other.write_bytes(raw))
        rules=f.lib/I.RULES_NAME
        refuses('C5 receipt chain|live rules are not',lambda:rules.write_bytes(b'third'),lambda:rules.write_bytes(NEW))
        receipt=f.state/I.C5_RECEIPT_NAME;rraw=receipt.read_bytes()
        refuses('C5 receipt bytes drift',lambda:receipt.write_bytes(rraw+b' '),lambda:receipt.write_bytes(rraw))
        refuses('C5 receipt unreadable',receipt.unlink,lambda:receipt.write_bytes(rraw))
        backup=f.state/I.C5_BACKUP_NAME/'rules'
        refuses('C5 rules backup drift',lambda:backup.write_bytes(b'o'),lambda:backup.write_bytes(OLD))
        refuses('C5 rules backup unreadable',backup.unlink,lambda:backup.write_bytes(OLD))
        I.observation()

    def test_observation_refuses_receipt_chain_mismatch_even_when_hash_pinned(self):
        edits={'phase':lambda r:r.update(phase='rolled_back'),'schema':lambda r:r.update(schema='OTHER'),
               'controller':lambda r:r.update(controller_sha='0'*40),'manifest':lambda r:r.update(manifest_sha256='0'*64),
               'rules':lambda r:r.update(rules_sha256='0'*64),'backup':lambda r:r['backups']['rules'].update(sha256='0'*64),
               'nobackups':lambda r:r.pop('backups')}
        for label,edit in edits.items():
            with self.subTest(label):
                f=self.fixture();f.write_receipt(edit)
                with self.assertRaisesRegex(I.Refused,'C5 receipt chain mismatch'):I.observation()

    def test_other_inventory_entries_must_equal_live_whether_targets_are_old_or_new(self):
        f=self.fixture()
        # A lib file installed by another reviewed installer is fine only if its record was updated too.
        path=f.lib/'file5';path.write_bytes(b'newer')  # drift: recorded != live
        with self.assertRaisesRegex(I.Refused,'live inventory byte drift'):I.observation()
        f.inventory['after'][str(path)]=H(b'newer');f.write_inventory()
        I.observation()

    def test_dry_writes_nothing_and_apply_binds_the_observation(self):
        f=self.fixture();before=f.tree();observed=I.observation()
        with contextlib.redirect_stdout(io.StringIO()) as out:I.dry(SS,'a'*40)
        result=json.loads(out.getvalue());self.assertEqual(result['status'],'DRY_PASS')
        self.assertEqual(result['observation_sha256'],I.digest(observed))
        self.assertEqual((result['policy_writes'],result['lib_writes'],result['model_calls']),(0,0,0))
        self.assertEqual(f.tree(),before)
        with self.assertRaisesRegex(I.Refused,'observation changed'):I.apply(SS,'a'*40,'0'*64)
        self.assertEqual(f.tree(),before)
        (f.state/'slot1.json').write_text('{"pending":null,"x":1}')   # state drift after dry
        with self.assertRaisesRegex(I.Refused,'observation changed'):I.apply(SS,'a'*40,I.digest(observed))

    def cycle(self,layout):
        f=self.fixture(layout);before=f.tree();raw=before[f.paths['INVENTORY']]
        f.paths['INVENTORY'].chmod(0o640);mode=stat.S_IMODE(f.paths['INVENTORY'].stat().st_mode)
        observed=I.observation()
        with contextlib.redirect_stdout(io.StringIO()):I.apply(SS,'a'*40,I.digest(observed))
        after=f.tree()
        changed=[p for p in after if after[p]!=before.get(p)]
        self.assertEqual(sorted(changed),sorted([f.paths['INVENTORY'],f.paths['J'],f.paths['BK']/'inventory']))
        self.assertEqual(after[f.paths['INVENTORY']],I.rerecorded_bytes(raw))
        self.assertEqual(after[f.paths['BK']/'inventory'],raw)
        self.assertEqual(stat.S_IMODE(f.paths['INVENTORY'].stat().st_mode),mode)
        receipt=I.receipt_read('a'*40);self.assertEqual(receipt['phase'],'active')
        I.verify(receipt)
        # Idempotent: a second apply is a verified no-op without any write.
        snapshot=f.tree()
        with contextlib.redirect_stdout(io.StringIO()) as out:I.apply(SS,'a'*40,'0'*64)
        self.assertIn('APPLY_NOOP',out.getvalue());self.assertEqual(f.tree(),snapshot)
        # Verify detects tamper of the inventory and of protected state.
        tampered=f.paths['INVENTORY'].read_bytes()
        f.paths['INVENTORY'].write_bytes(tampered.replace(H(NEW).encode(),H(OLD).encode()))
        with self.assertRaises(I.Refused):I.verify(I.receipt_read('a'*40))
        f.paths['INVENTORY'].write_bytes(tampered)
        (f.state/'slot2.json').write_text('{"pending":null,"x":2}')
        with self.assertRaisesRegex(I.Refused,'protected state changed'):I.verify(I.receipt_read('a'*40))
        (f.state/'slot2.json').write_bytes(before[f.state/'slot2.json'])
        I.verify(I.receipt_read('a'*40))
        I.restore(I.receipt_read('a'*40))
        for path,data in before.items():self.assertEqual(path.read_bytes(),data)
        self.assertEqual(json.loads(f.paths['J'].read_bytes())['phase'],'rolled_back')
        self.assertEqual(stat.S_IMODE(f.paths['INVENTORY'].stat().st_mode),mode)
        # After rollback no new apply runs on the same transaction files.
        with self.assertRaisesRegex(I.Refused,'existing guarded transaction'):I.apply(SS,'a'*40,I.digest(observed))

    def test_fake_root_apply_verify_rollback_byte_exact_compact(self):self.cycle('compact')
    def test_fake_root_apply_verify_rollback_byte_exact_pretty(self):self.cycle('pretty')

    def test_wrong_commit_or_foreign_transaction_refused(self):
        f=self.fixture();observed=I.observation()
        with contextlib.redirect_stdout(io.StringIO()):I.apply(SS,'a'*40,I.digest(observed))
        with self.assertRaisesRegex(I.Refused,'foreign rerecord transaction'):I.receipt_read('b'*40)

    def test_failed_write_restores_the_exact_original_bytes(self):
        f=self.fixture();before=f.tree();observed=I.observation()
        real=I.atomic_bytes;calls=[]
        def flaky(path,raw,*args):
            calls.append(path)
            if path==f.paths['INVENTORY'] and len([c for c in calls if c==path])==1:
                real(path,raw,*args);raise OSError('synthetic crash after the inventory write')
            return real(path,raw,*args)
        with patch.object(I,'atomic_bytes',side_effect=flaky),self.assertRaises(OSError):
            I.apply(SS,'a'*40,I.digest(observed))
        self.assertEqual(f.paths['INVENTORY'].read_bytes(),before[f.paths['INVENTORY']])
        self.assertEqual(json.loads(f.paths['J'].read_bytes())['phase'],'rolled_back')
        for path,data in before.items():self.assertEqual(path.read_bytes(),data)

    def test_rollback_after_interrupted_backup_phase_is_safe(self):
        f=self.fixture();before=f.tree();observed=I.observation()
        # Interrupt right after the receipt (phase backed_up) with the inventory untouched.
        real=I.atomic_bytes
        def killer(path,raw,*args):
            if path==f.paths['INVENTORY']:raise KeyboardInterrupt()
            return real(path,raw,*args)
        with patch.object(I,'atomic_bytes',side_effect=killer),self.assertRaises(KeyboardInterrupt):
            I.apply(SS,'a'*40,I.digest(observed))
        for path,data in before.items():self.assertEqual(path.read_bytes(),data)

    def test_failure_before_the_receipt_leaves_no_transaction_files(self):
        f=self.fixture();before=f.tree();observed=I.observation()
        with patch.object(I,'write_json',side_effect=OSError('synthetic')),self.assertRaises(OSError):
            I.apply(SS,'a'*40,I.digest(observed))
        self.assertEqual(f.tree(),before);self.assertFalse(f.paths['BK'].exists())
        with contextlib.redirect_stdout(io.StringIO()):I.apply(SS,'a'*40,I.digest(observed))   # retry is possible

    def test_rollback_refuses_foreign_inventory_bytes(self):
        f=self.fixture();observed=I.observation()
        with contextlib.redirect_stdout(io.StringIO()):I.apply(SS,'a'*40,I.digest(observed))
        receipt=I.receipt_read('a'*40)
        f.paths['INVENTORY'].write_text(json.dumps(dict(foreign=True)))
        with self.assertRaisesRegex(I.Refused,'inventory manifest/membership drift'):I.restore(receipt)
        self.assertEqual(json.loads(f.paths['INVENTORY'].read_bytes()),dict(foreign=True))

    def test_backup_tamper_refused(self):
        f=self.fixture();observed=I.observation()
        with contextlib.redirect_stdout(io.StringIO()):I.apply(SS,'a'*40,I.digest(observed))
        (f.paths['BK']/'inventory').write_bytes(b'{}')
        with self.assertRaisesRegex(I.Refused,'backup bytes/metadata drift'):I.receipt_read('a'*40)

    def test_script_must_equal_the_reviewed_merge_commit_blob(self):
        with tempfile.TemporaryDirectory() as directory,contextlib.ExitStack() as stack:
            bundle=Path(directory)/'bundle';(bundle/'.git').mkdir(parents=True)
            (bundle/'.git'/'config').write_bytes(b'[core]\n\trepositoryformatversion = 0\n\tbare = false\n')
            env=dict(PATH='/usr/bin:/bin',HOME='/nonexistent',LC_ALL='C',GIT_CONFIG_NOSYSTEM='1',
                GIT_CONFIG_SYSTEM='/dev/null',GIT_CONFIG_GLOBAL='/dev/null',GIT_AUTHOR_NAME='S',
                GIT_AUTHOR_EMAIL='s@example.invalid',GIT_COMMITTER_NAME='S',GIT_COMMITTER_EMAIL='s@example.invalid')
            def g(*args,input=None):
                return subprocess.run(['/usr/bin/git','-C',str(bundle),*args],input=input,env=env,
                    stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip().decode()
            g('init','--template=');g('remote','add','origin','https://github.com/anpavel84-afk/gobadminton-clean.git')
            target=bundle/I.SCRIPT_REPO_PATH;target.parent.mkdir(parents=True);target.write_bytes(SCRIPT.read_bytes())
            g('add','.');tree=g('write-tree');base=g('commit-tree',tree,input=b'b\n')
            a=g('commit-tree',tree,'-p',base,input=b'a\n');b=g('commit-tree',tree,'-p',base,input=b'b2\n')
            merge=g('commit-tree',tree,'-p',a,'-p',b,input=b'm\n');g('update-ref','HEAD',merge)
            real=I.git
            def git(path,*args):
                if args[0]=='merge-base':args=('merge-base','--is-ancestor',base,merge)
                return real(path,*args)
            trusted=lambda p:None
            stack.enter_context(patch.object(I,'git',side_effect=git))
            stack.enter_context(patch.object(I,'R',SimpleNamespace(trusted_tree=trusted)))
            self.assertEqual(I.source(bundle,merge),H(SCRIPT.read_bytes()))
            other=Path(directory)/'other.py';other.write_bytes(SCRIPT.read_bytes()+b'\n# changed\n')
            with patch.object(I,'__file__',str(other)):
                with self.assertRaisesRegex(I.Refused,'running installer differs'):I.source(bundle,merge)
            with self.assertRaisesRegex(I.Refused,'bundle HEAD differs'):I.source(bundle,'c'*40)

    def test_pins_match_the_package_finish_installer(self):
        spec2=importlib.util.spec_from_file_location('pkg',SCRIPT.parent/'agy29_pkg_finish_install.py')
        P=importlib.util.module_from_spec(spec2);spec2.loader.exec_module(P)
        for key in ('C','STAGE_SHA','OLD_MANIFEST','RULES_INVENTORY_SHA','RULES_LIVE_SHA','C5_RECEIPT_SHA','C5_SCHEMA',
                    'C5_RECEIPT_NAME','C5_BACKUP_NAME','UNCHANGED','REQUIRED_STATE','POLICY','MARKER','BUDGET','INVENTORY','STATE','LIB'):
            self.assertEqual(getattr(I,key),getattr(P,key),key)
        self.assertEqual(I.RULES_INVENTORY_SHA[:8],'38c34012');self.assertEqual(I.RULES_LIVE_SHA[:8],'017441de')
        self.assertEqual(I.C5_RECEIPT_SHA[:8],'04106cc1')


if __name__=='__main__':unittest.main()
