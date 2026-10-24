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


if __name__ == '__main__':
    unittest.main()
