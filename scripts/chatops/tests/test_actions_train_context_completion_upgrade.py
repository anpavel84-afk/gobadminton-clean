"""V3 safety/protocol evidence on synthetic dirs and immutable Git objects only."""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import test_actions_train_stage5_cursor_upgrade as v3
import stage5_frozen_profile_fixture as frozen

U, core, H = v3.U, v3.core, v3.H
ROOT = v3.legacy.ROOT


class ProtocolEvidence(unittest.TestCase):
    def test_frozen_context_api_and_exact_reviewed_stage_guard_delta(self):
        # The installer contract is unchanged; current routing is deliberately
        # NOT a V3 target. Never repin V3 to the current source to satisfy CI.
        self.assertEqual(H(Path(U.__file__).read_bytes()), frozen.BLOBS['v3-installer.py'][2])
        self.assertEqual(U.C5, frozen.C5)
        for mapping in (U.V3_NEW, U.V3_PROTOCOL):
            for name, pin in mapping.items():
                self.assertEqual(frozen.BLOBS[name][2], pin, name)
        with tempfile.TemporaryDirectory(prefix='gb-frozen-v3-') as tmp:
            scratch = Path(tmp)
            profile = scratch / 'profile'
            frozen.materialize(ROOT, profile)
            targets = scratch / 'current-targets'
            targets.mkdir()
            # Current bytes are data for negative controls, never imports in the
            # historical interpreter. Production source is not modified.
            for name in ('stage.py', 'context_policy.py'):
                (targets / name).write_bytes((ROOT / U.PREFIX / name).read_bytes())
            poison = scratch / 'poison'
            poison.mkdir()
            for name in ('core', 'native_antigravity', 'context_policy'):
                (poison / (name + '.py')).write_text("raise AssertionError('PYTHONPATH contamination')\n")
            result = subprocess.run(
                [sys.executable, '-I', '-B', str(Path(frozen.__file__).resolve()),
                 str(profile), str(targets)], cwd=scratch,
                env=dict(os.environ, PYTHONPATH=str(poison), PYTHONDONTWRITEBYTECODE='1'),
                capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            receipt = json.loads(result.stdout)
            self.assertTrue(receipt['success'])
            self.assertEqual(receipt['tests'], 6)
            self.assertIn('test_pinned_router_author_refusal_and_qa_positive_control', result.stderr)
            self.assertEqual(receipt['module_origins']['core']['commit'], U.C5)
            for row in receipt['module_origins'].values():
                self.assertTrue(Path(row['path']).is_relative_to(profile))
            frozen.verify_files(profile)

    def test_closed_provenance_rejects_wrong_commit_path_hash_and_length(self):
        name = 'core.py'
        commit, path, digest, size = frozen.BLOBS[name]
        raw = frozen.read_blob(ROOT, name)
        self.assertEqual(len(raw), size)
        for record in (('0' * 40, path, digest, size),
                       (commit, path + '.foreign', digest, size),
                       (frozen.RELEASE, path, digest, size),
                       (commit, path, '0' * 64, size),
                       (commit, path, digest, size + 1)):
            with self.subTest(record=record), self.assertRaisesRegex(ValueError, 'unsupported immutable provenance'):
                frozen.read_blob(ROOT, name, record)
        for changed in (raw + b'x', raw[:-1], bytes([raw[0] ^ 1]) + raw[1:]):
            with self.assertRaisesRegex(ValueError, 'digest/size mismatch'):
                frozen.checked_bytes(name, changed)

    def test_missing_immutable_object_fails_without_current_file_fallback(self):
        with tempfile.TemporaryDirectory(prefix='gb-missing-v3-') as tmp:
            repo = Path(tmp)
            result = subprocess.run(['/usr/bin/git', 'init', '--bare', str(repo)],
                                    capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            # Even with current bytes available at the requested working path,
            # an absent exact object must fail, not fetch, skip or read HEAD.
            current = repo / U.PREFIX / 'core.py'
            current.parent.mkdir(parents=True)
            current.write_bytes((ROOT / U.PREFIX / 'core.py').read_bytes())
            with self.assertRaisesRegex(ValueError, 'required local immutable Git blob unavailable'):
                frozen.read_blob(repo, 'core.py')
            self.assertFalse((repo / 'FETCH_HEAD').exists())


class CompletionSafety(unittest.TestCase):
    def setUp(self): self.x=v3.Fixture();self.addCleanup(self.x.close)

    def test_source_symlink_hardlink_config_manifest_and_script_drift(self):
        x=self.x;f=x.f;p=f.bundle/U.PREFIX/'stage.py';raw=p.read_bytes()
        hard=f.p/'hard';os.link(p,hard)
        with self.assertRaises(core.Refused): x.call('dry')
        hard.unlink();p.unlink();p.symlink_to(f.install/'stage.py')
        with self.assertRaises((core.Refused,OSError)): x.call('dry')
        p.unlink();p.write_bytes(raw)
        config=f.bundle/'.git/config';original=config.read_bytes()
        for extra in (b'[include]\npath = outside\n',b'[filter "x"]\nclean = execute\n',
                      b'[core]\nfsmonitor = execute\n',b'[extensions]\nworktreeConfig = true\n'):
            config.write_bytes(original+extra)
            with patch.object(U,'git',side_effect=AssertionError('Git must not execute')):
                with self.assertRaises(core.Refused): x.call('dry')
        config.write_bytes(original)
        indirection=f.bundle/'.git/objects/info/alternates';indirection.write_bytes(b'/not-allowed')
        with self.assertRaises(core.Refused): x.call('dry')
        indirection.unlink()
        script=f.bundle/U.SCRIPT_REPO_PATH;original=script.read_bytes();script.write_bytes(b'foreign installer');f.refresh()
        with self.assertRaisesRegex(core.Refused,'running installer differs'): x.call('dry')
        script.write_bytes(original);f.refresh()
        manifest=json.loads(f.manifest_path.read_bytes());manifest['files'].pop(U.PREFIX+'core.py')
        f.manifest_path.write_text(json.dumps(manifest));f.refresh(update_manifest=False)
        with self.assertRaisesRegex(core.Refused,'incomplete manifest'): x.call('dry')

    def test_parent_replacement_and_synthetic_controller_lock(self):
        x=self.x;f=x.f
        # Swap the parent after its fd is opened. The write must not reach either
        # old or replacement target; this tests the added pre-rename parent gate.
        parent=f.p/'raceparent';parent.mkdir();p=parent/'file';p.write_bytes(b'old')
        meta=U.read_file(p)[1];atomic_open=U.os.open;fired=False
        def swapped(path,*a,**kw):
            nonlocal fired
            fd=atomic_open(path,*a,**kw)
            if path==U.temp_name(p) and not fired:
                fired=True;parent.rename(f.p/'oldparent');parent.mkdir();(parent/'file').write_bytes(b'foreign')
            return fd
        with patch.object(U.os,'open',side_effect=swapped),self.assertRaisesRegex(core.Refused,'parent replaced'):
            U.atomic_bytes(p,b'new',meta,expected=meta)
        self.assertEqual((f.p/'oldparent/file').read_bytes(),b'old');self.assertEqual(p.read_bytes(),b'foreign')
        # Existing main() serializes V3 using the same existing controller.lock.
        import contextlib,io,sys,fcntl
        lock=f.state/'controller.lock';lock.write_bytes(b'');lock.chmod(0o600)
        args=['stage5','dry','--version','3','--bundle',str(f.bundle),'--manifest',f.manifest,
              '--baseline-controller',x.c5,'--controller',x.c5,'--stage-hash',f.sh,'--dispatch-hash',f.dh,
              '--bundle-commit',f.commit]
        with patch.object(sys,'argv',args),contextlib.redirect_stdout(io.StringIO()) as output: U.main()
        self.assertEqual(json.loads(output.getvalue())['protected_writes'],0)
        with lock.open('rb') as fd:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with patch.object(sys,'argv',args),self.assertRaises(BlockingIOError): U.main()

    def test_terminal_checkpoint_exact_evidence_and_unknown(self):
        U.safe_checkpoint({'active':None,'done':[]})
        head='a'*40
        active=dict(issue=313,phase='done',attempt=1,head=head,release_id='r42-a1',
                    qa={'verdict':'PASS','reviewed_sha':head},ci={'sha':head},run={'id':42,'attempt':1,'sha':head},
                    live={'gitSha':head},server=dict(schema=1,environment='dev',pending=False,observed_at=20,
                    accepted=dict(status='ACCEPTED',release_id='r42-a1',source_sha=head,finished_at=10,
                    api_digest='sha256:'+'b'*64,web_digest='sha256:'+'c'*64)))
        state={'active':active,'done':[313]};U.safe_checkpoint(state)
        for changed in ({'done':[]},{'done':[True]},{'active':{'phase':'done'}},
                        {'active':dict(active,phase='unknown')},{'active':dict(active,release_id='foreign')},
                        {'active':dict(active,server={'accepted':{'status':'ACCEPTED'}})}):
            with self.subTest(changed=changed),self.assertRaises(core.Refused): U.safe_checkpoint(dict(state,**changed))
        j={'pending':None,'operations':{'history':{'status':'unknown','process':{'pid':123,'start':'old','boot':'old'}}}}
        with patch.object(U,'quiet'),patch.object(U.receiver,'checkpoint',return_value=({'active':None,'done':[]},[])), \
             patch.object(U.receiver,'journal',return_value=j),patch.object(U.receiver,'identity',return_value={'pid':123,'start':'reused','boot':'old'}):
            v3.REAL_QUIET_V3()
            j['pending']={'unknown':True}
            with self.assertRaisesRegex(core.Refused,'pending/UNKNOWN'): v3.REAL_QUIET_V3()
            j['pending']=None
            with patch.object(U.receiver,'identity',return_value=j['operations']['history']['process']):
                with self.assertRaisesRegex(core.Refused,'still alive'): v3.REAL_QUIET_V3()

    def test_incomplete_backup_and_temp_recovery_rejects_foreign_preimages(self):
        x=self.x;atomic=U.atomic_bytes
        def interrupt(p,raw,meta,**kw):
            if p==x.f.backup/'native_guard.py': raise InterruptedError('partial backup')
            return atomic(p,raw,meta,**kw)
        with patch.object(U,'atomic_bytes',side_effect=interrupt),self.assertRaises(InterruptedError): x.call('apply')
        self.assertEqual(json.loads(x.f.journal.read_bytes())['phase'],'preparing')
        p=x.f.backup/'admission_pm.py';self.assertFalse(p.exists())
        p=x.f.backup/'agy_marker';raw=p.read_bytes();p.write_bytes(b'foreign preimage')
        with self.assertRaisesRegex(core.Refused,'backup preimage drift'): x.call('rollback')
        p.write_bytes(raw);x.call('rollback');x.restored(self)

    def test_cursor_ready_requires_exact_runtime_history_contract(self):
        x=self.x;raw=x.marker_raw['cursor_marker'];m=json.loads(raw)
        for change in ({'phase':'canary'},{'accepted_canary':{}},{'modules':{}}):
            with self.subTest(change=change),self.assertRaisesRegex(core.Refused,'bound pilot marker'):
                U.module_pins_only(json.dumps(dict(m,**change)).encode(),'cursor_marker',{'native_guard.py':U.V3_NEW['native_guard.py']})
        # Source checkout modes and source canonical hashes are unchanged by this work.
        for p in (Path(U.__file__),Path(__file__),Path(v3.__file__)):
            self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o644)


if __name__=='__main__': unittest.main()
