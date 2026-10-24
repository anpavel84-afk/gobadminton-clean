"""#29: offline-only OAuth/catalog precharge regressions; no real credential or provider."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N


def synthetic_vendor_preflight(case):
    """Only pre-existing offline transport fixtures may simulate catalog/auth refresh.

    The real precharge fail-closed and atomic credential paths are exercised in
    this file's dedicated positive/negative tests without provider or secrets.
    """
    one=patch.object(N,'catalog_precharge',return_value=13)
    two=patch.object(N,'retain_oauth_refresh',return_value='unchanged')
    one.start();case.addCleanup(one.stop)
    two.start();case.addCleanup(two.stop)



class CatalogPrecharge(unittest.TestCase):
    def test_catalog_contains_exact_model_from_realistic_vendor_rows(self):
        output = ('Fetching available models...\n'
                  '  * gemini-3.8-flash-medium Gemini Flash\n'
                  '  * claude-sonnet-5-5-medium Claude Sonnet Medium\n'
                  '  * claude-opus-5-5-high Claude Opus\n').encode()
        process = SimpleNamespace(returncode=0,stdout=output,stderr=b'')
        env={'HOME':'/tmp/synthetic-only'}
        child=Mock()
        with patch.object(N.subprocess,'run',return_value=process) as run:
            count=N.catalog_precharge(Path('/tmp/synthetic-only'),env,child,N.MODEL)
        self.assertEqual(count,3)
        args,kwargs=run.call_args
        self.assertEqual(args[0],[N.AGY,'models'])
        self.assertEqual(kwargs['env'],env)
        self.assertIs(kwargs['preexec_fn'],child)
        self.assertEqual(kwargs['timeout'],60)
        self.assertEqual(kwargs['stdin'],N.subprocess.DEVNULL)

    def test_absent_model_auth_error_and_prose_never_admit(self):
        values=[
            SimpleNamespace(returncode=0,stdout=b'  * gemini-3.8-flash-medium Gemini\n',stderr=b''),
            SimpleNamespace(returncode=0,stdout=b'Error: model claude-sonnet-5-5-medium unavailable\n',stderr=b''),
            SimpleNamespace(returncode=1,stdout=b'  * claude-sonnet-5-5-medium\n',stderr=b'auth required'),
        ]
        for value in values:
            with self.subTest(value=value),patch.object(N.subprocess,'run',return_value=value):
                with self.assertRaises(N.ReviewError):
                    N.catalog_precharge(Path('/tmp/fake'),{'HOME':'/tmp/fake'},Mock(),N.MODEL)
        with patch.object(N.subprocess,'run',side_effect=OSError('denied')):
            with self.assertRaises(N.ReviewError):
                N.catalog_precharge(Path('/tmp/fake'),{},Mock(),N.MODEL)

    def test_wrong_model_rejected_without_starting_cli(self):
        with patch.object(N.subprocess,'run') as call:
            with self.assertRaises(N.ReviewError):
                N.catalog_precharge(Path('/tmp'),{},Mock(),'gemini-3.8-flash-medium')
            call.assert_not_called()


    def test_catalog_failure_precedes_charge_and_model_launch(self):
        # Integration negative, not just a unit test for the model-ID parser:
        # no grant may be spent until an exact account catalog passed in the
        # actual invocation's private HOME. All data are inert synthetic.
        charge=Mock()
        model_popen=Mock(side_effect=AssertionError('model must not start'))
        with tempfile.TemporaryDirectory(prefix='gb-agy-precharge-negative-') as scratch, \
             patch.object(N,'qualification',return_value={'phase':'canary','adapter_revision':'a'*40}), \
             patch.object(N.os,'geteuid',return_value=N.EXECUTOR_UID), \
             patch.object(N,'_verify_executor_boundary',return_value=None),patch.object(N,'_candidate_state',return_value=('H','')) , \
             patch.object(N,'trusted',return_value=b'{"access_token":"SYNTHETIC_ONLY"}'), \
             patch.object(N,'git',return_value=b'/tmp/gb-agy-inert-candidate/.git'), \
             patch.object(N,'catalog_precharge',
                 side_effect=N.ReviewError('AGY_PRECHECK_FAILED','preflight')), \
             patch.object(N,'retain_oauth_refresh',return_value='unchanged'):
            with self.assertRaisesRegex(N.ReviewError,'AGY_PRECHECK_FAILED'):
                N.invoke('inert analysis task',45,work=Path('/tmp/gb-agy-inert-candidate'),
                    slot='slot2',task_hash='f'*64,charge=charge,popen=model_popen,
                    evidence_dir=Path(scratch)/'evidence')
        charge.assert_not_called()
        model_popen.assert_not_called()


class AtomicSyntheticOAuth(unittest.TestCase):
    def test_changed_token_is_atomically_retained_and_unmodified_not_rewritten(self):
        # Disposable fake OAuth bytes only. The real protected credential is
        # NEVER read by this fixture and no original user files are changed.
        with tempfile.TemporaryDirectory(prefix='gb-agy-fake-auth-') as tmp:
            folder=Path(tmp)/'private';folder.mkdir(mode=0o700)
            original=folder/'antigravity-oauth-token'
            private=folder/'temporary-oauth'
            prior=json.dumps({'access_token':'FAKE-OLD','refresh_token':'FAKE-OLD'}).encode()
            newer=json.dumps({'access_token':'FAKE-NEW','refresh_token':'FAKE-NEW'}).encode()
            original.write_bytes(prior);original.chmod(0o600)
            private.write_bytes(prior);private.chmod(0o600)
            def fake_trusted(path,owner=0,limit=65536):
                p=Path(path)
                i=p.lstat()
                if not stat.S_ISREG(i.st_mode) or stat.S_IMODE(i.st_mode)!=0o600:
                    raise PermissionError('synthetic nonprivate credentials')
                return p.read_bytes()
            with patch.object(N,'AUTH',original),patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(N,'trusted',side_effect=fake_trusted):
                self.assertEqual(N.retain_oauth_refresh(private,prior),'unchanged')
                self.assertEqual(original.read_bytes(),prior)
                private.write_bytes(newer)
                self.assertEqual(N.retain_oauth_refresh(private,prior),'persisted')
                self.assertEqual(original.read_bytes(),newer)
                self.assertEqual(stat.S_IMODE(original.stat().st_mode),0o600)
                self.assertEqual(list(folder.glob('.agy-refresh-*')),[])
                with self.assertRaises(N.ReviewError):
                    N.retain_oauth_refresh(private,prior)

    def test_untrusted_transient_oauth_rejected_before_persist(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-fake-auth-') as tmp:
            p=Path(tmp)/'token';p.write_text('{}');p.chmod(0o666)
            with patch.object(N,'EXECUTOR_UID',os.getuid()):
                with self.assertRaises(N.ReviewError):
                    N.retain_oauth_refresh(p,b'{}')


    def test_symlink_and_hardlink_credentials_are_rejected_without_original_write(self):
        # Regression: never use a pathname twice between lstat and read.
        with tempfile.TemporaryDirectory(prefix='gb-agy-fake-auth-') as tmp:
            root=Path(tmp)
            original=root/'persistent';original.write_text('{"token":"FAKE"}');original.chmod(0o600)
            transient=root/'transient'
            transient.symlink_to(original)
            with patch.object(N,'EXECUTOR_UID',os.getuid()):
                with self.assertRaises(OSError):
                    N.retain_oauth_refresh(transient,b'previous')
            self.assertEqual(original.read_text(),'{"token":"FAKE"}')
            transient.unlink()
            os.link(original,transient)
            with patch.object(N,'EXECUTOR_UID',os.getuid()):
                with self.assertRaises(N.ReviewError):
                    N.retain_oauth_refresh(transient,b'previous')
            self.assertEqual(original.read_text(),'{"token":"FAKE"}')

    def test_oauth_read_uses_single_descriptor_and_fstat_not_path_reopen(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-fake-auth-') as tmp:
            token=Path(tmp)/'token';fake=b'{"token":"SYNTHETIC"}'
            token.write_bytes(fake);token.chmod(0o600)
            with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(Path,'read_bytes',side_effect=AssertionError('path reopened')), \
                 patch.object(Path,'lstat',side_effect=AssertionError('path metadata raced')):
                self.assertEqual(N.retain_oauth_refresh(token,fake),'unchanged')



class AncestorDescriptorScope(unittest.TestCase):
    """No external path can replace an ephemeral OAuth ancestor. Inert bytes."""

    def test_symlink_ancestor_rejected_before_persistent_access(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-ancestor-') as tmp:
            root=Path(tmp);outside=root/'external';outside.mkdir(mode=0o700)
            original=b'{"token":"SYNTHETIC_ORIGINAL"}'
            injected=b'{"token":"SYNTHETIC_EXTERNAL"}'
            persistent=root/'persistent';persistent.write_bytes(original);persistent.chmod(0o600)
            (outside/'antigravity-oauth-token').write_bytes(injected)
            (outside/'antigravity-oauth-token').chmod(0o600)
            redirected=root/'redirected';redirected.symlink_to(outside,target_is_directory=True)
            with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(N,'AUTH',persistent), \
                 patch.object(N,'trusted',side_effect=lambda *a,**k:persistent.read_bytes()) as read:
                with self.assertRaises(OSError):
                    N.retain_oauth_refresh(redirected/'antigravity-oauth-token',original)
                read.assert_not_called()
            self.assertEqual(persistent.read_bytes(),original)

    def test_pinned_parent_fd_survives_rename_and_external_symlink_swap(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-parent-fd-') as tmp:
            root=Path(tmp);native=root/'native';native.mkdir(mode=0o700)
            original=b'{"token":"SYNTHETIC_ORIGINAL"}'
            (native/'antigravity-oauth-token').write_bytes(original)
            (native/'antigravity-oauth-token').chmod(0o600)
            external=root/'external';external.mkdir(mode=0o700)
            (external/'antigravity-oauth-token').write_bytes(b'{"token":"EXTERNAL"}')
            (external/'antigravity-oauth-token').chmod(0o600)
            captured=[]
            real=N.private_directory
            def rename_after_open(path,create=False):
                fd=real(path,create=create)
                captured.append(fd)
                native.rename(root/'native-moved')
                native.symlink_to(external,target_is_directory=True)
                return fd
            with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(N,'private_directory',side_effect=rename_after_open), \
                 patch.object(N,'trusted',side_effect=AssertionError('persistent read not needed')):
                self.assertEqual(N.retain_oauth_refresh(
                    native/'antigravity-oauth-token',original),'unchanged')
            self.assertEqual(len(captured),1)
            with self.assertRaises(OSError):os.fstat(captured[0])
            self.assertEqual((root/'native-moved'/'antigravity-oauth-token').read_bytes(),original)

    def test_nested_private_home_preserves_valid_atomic_refresh(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-nested-home-') as tmp:
            root=Path(tmp)
            native=root/'home/.gemini/antigravity-cli';native.mkdir(parents=True,mode=0o700)
            original=b'{"token":"FAKE_OLD"}';refreshed=b'{"token":"FAKE_REFRESHED"}'
            token=native/'antigravity-oauth-token';token.write_bytes(refreshed);token.chmod(0o600)
            persistent=root/'persistent';persistent.write_bytes(original);persistent.chmod(0o600)
            with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(N,'AUTH',persistent), \
                 patch.object(N,'trusted',side_effect=lambda *a,**k:persistent.read_bytes()):
                self.assertEqual(N.retain_oauth_refresh(token,original),'persisted')
                self.assertEqual(persistent.read_bytes(),refreshed)
            self.assertEqual(stat.S_IMODE(persistent.stat().st_mode),0o600)
            self.assertEqual(list(root.glob('.agy-refresh-*')),[])

    def test_nonprivate_parent_rejected_even_if_token_mode_is_private(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-parent-negative-') as tmp:
            root=Path(tmp);native=root/'not-private';native.mkdir(mode=0o755)
            token=native/'antigravity-oauth-token';raw=b'{"token":"FAKE"}'
            token.write_bytes(raw);token.chmod(0o600)
            with patch.object(N,'EXECUTOR_UID',os.getuid()):
                with self.assertRaises(OSError):
                    N.retain_oauth_refresh(token,raw)


class NonRegularAndDescriptorSafety(unittest.TestCase):
    """R3 findings: writerless FIFO must not block; failed fdopen must not leak. Inert bytes."""

    def test_writerless_fifo_oauth_is_rejected_without_blocking(self):
        import signal
        with tempfile.TemporaryDirectory(prefix='gb-agy-fifo-') as tmp:
            folder=Path(tmp)/'private';folder.mkdir(mode=0o700)
            fifo=folder/'antigravity-oauth-token';os.mkfifo(fifo,0o600)
            def timed_out(*_):raise AssertionError('open blocked on writerless FIFO')
            old=signal.signal(signal.SIGALRM,timed_out);signal.alarm(5)
            try:
                with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                     patch.object(N,'trusted',side_effect=AssertionError('persistent read not needed')):
                    with self.assertRaises(N.ReviewError):
                        N.retain_oauth_refresh(fifo,b'{"token":"FAKE"}')
            finally:
                signal.alarm(0);signal.signal(signal.SIGALRM,old)

    def test_persistent_writer_fd_closed_when_fdopen_construction_fails(self):
        def open_fds():
            return set(os.listdir('/proc/self/fd'))
        with tempfile.TemporaryDirectory(prefix='gb-agy-fdleak-') as tmp:
            root=Path(tmp);folder=root/'private';folder.mkdir(mode=0o700)
            prior=b'{"token":"FAKE-OLD"}';newer=b'{"token":"FAKE-NEW"}'
            token=folder/'antigravity-oauth-token';token.write_bytes(newer);token.chmod(0o600)
            persistent=root/'persistent';persistent.write_bytes(prior);persistent.chmod(0o600)
            real_fdopen=os.fdopen
            def failing(fd,mode='r',*a,**k):
                if 'w' in mode:raise MemoryError('synthetic fdopen failure')
                return real_fdopen(fd,mode,*a,**k)
            before=open_fds()
            with patch.object(N,'EXECUTOR_UID',os.getuid()),patch.object(N,'AUTH',persistent), \
                 patch.object(N,'trusted',side_effect=lambda *a,**k:persistent.read_bytes()), \
                 patch.object(N.os,'fdopen',side_effect=failing):
                with self.assertRaises(MemoryError):
                    N.retain_oauth_refresh(token,prior)
            self.assertEqual(open_fds()-before,set())
            self.assertEqual(persistent.read_bytes(),prior)
            self.assertEqual(list(root.glob('.agy-refresh-*')),[])


class ChargedEvidenceRetention(unittest.TestCase):
    """Real invoke/finalizer, synthetic credential and fake CLI, zero provider calls."""

    def exercise(self, corruption='chmod', timeout=False):
        charged=Mock();launches=[]
        class Process:
            pid=99999999
            returncode=None
            def communicate(self, input, timeout):
                self._input_offset=len(input)
                if self.should_timeout:
                    raise N.subprocess.TimeoutExpired('inert-cli', timeout)
                self.returncode=0
            def wait(self):
                if self.returncode is None:self.returncode=-9
                return self.returncode
            def poll(self):return self.returncode
        Process.should_timeout=timeout
        with tempfile.TemporaryDirectory(prefix='gb-agy-charged-evidence-') as tmp:
            root=Path(tmp);evidence=root/'evidence'
            def fake_popen(argv, **kw):
                launches.append(argv)
                kw['stdout'].write(b'INERT_NATIVE_STDOUT\n')
                kw['stderr'].write(b'INERT_NATIVE_STDERR\n')
                kw['stdout'].flush();kw['stderr'].flush()
                auth=Path(kw['env']['HOME'])/'.gemini/antigravity-cli/antigravity-oauth-token'
                if corruption=='chmod':
                    auth.chmod(0o644)
                elif corruption=='missing':
                    auth.unlink()
                elif corruption=='symlink':
                    target=auth.parent/'synthetic-other';target.write_text('{"token":"FAKE_OTHER"}')
                    auth.unlink();auth.symlink_to(target)
                elif corruption=='hardlink':
                    os.link(auth,auth.parent/'synthetic-hardlink')
                elif corruption=='malformed':
                    auth.write_bytes(b'{invalid')
                elif corruption=='oversized':
                    auth.write_bytes(b'x'*65537)
                else:raise AssertionError('unknown synthetic action')
                return Process()
            with patch.object(N,'EXECUTOR_UID',os.getuid()), \
                 patch.object(N.os,'geteuid',return_value=os.getuid()), \
                 patch.object(N,'qualification',return_value={'phase':'canary','adapter_revision':'a'*40}), \
                 patch.object(N,'_verify_executor_boundary',return_value=None),patch.object(N,'_candidate_state',return_value=('H','')) , \
                 patch.object(N,'trusted',return_value=b'{"token":"FAKE_SAVED"}'), \
                 patch.object(N,'git',return_value=b'/tmp/gb-agy-inert-candidate/.git'), \
                 patch.object(N,'catalog_precharge',return_value=13), \
                 patch.object(N.os,'killpg',return_value=None):
                with self.assertRaises(N.ReviewError) as caught:
                    N.invoke('INERT TASK ONLY',45,work=Path('/tmp/gb-agy-inert-candidate'),
                        slot='slot2',task_hash='f'*64,charge=charged,popen=fake_popen,
                        evidence_dir=evidence)
            charged.assert_called_once()
            self.assertEqual(len(launches),1)
            self.assertEqual(caught.exception.code,'AGY_TIMEOUT' if timeout else 'AGY_ADAPTER_ERROR')
            self.assertEqual(caught.exception.phase,'running' if timeout else 'output')
            outputs=list(evidence.glob('*/stdout'))
            self.assertEqual(len(outputs),1)
            private=outputs[0].parent
            self.assertEqual((private/'stdout').read_bytes(),b'INERT_NATIVE_STDOUT\n')
            self.assertEqual((private/'stderr').read_bytes(),b'INERT_NATIVE_STDERR\n')
            phases=sorted(private.glob('phase-*.json'))
            self.assertTrue(phases)
            final=json.loads(phases[-1].read_text())
            self.assertEqual(final['charge_state'],'charged')
            self.assertEqual(final['error_code'],caught.exception.code)
            self.assertEqual(final['oauth_refresh'],'failed')
            self.assertEqual(final['streams']['stdout']['retained_bytes'],len(b'INERT_NATIVE_STDOUT\n'))
            self.assertEqual(final['streams']['stderr']['retained_bytes'],len(b'INERT_NATIVE_STDERR\n'))
            self.assertFalse(final.get('status')=='success')
            self.assertNotIn('FAKE_SAVED',json.dumps(final))

    def test_postcharge_oauth_failure_retains_both_streams_and_charged_unknown(self):
        for corruption in ('chmod','missing','symlink','hardlink','malformed','oversized'):
            with self.subTest(corruption=corruption):
                self.exercise(corruption)

    def test_original_timeout_remains_primary_with_secondary_refresh_failure(self):
        self.exercise('chmod',timeout=True)



if __name__ == '__main__':
    unittest.main()
