import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('worker', Path(__file__).with_name('dev-worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class WorkerImageTest(unittest.TestCase):
    def test_accepted_manifest_ref_is_used_even_when_image_config_id_differs(self):
        digest = 'sha256:' + 'a' * 64
        image = 'ghcr.io/anpavel84-afk/gobadminton-clean-api@' + digest
        sha = 'b' * 40
        accepted = dict(source_sha=sha, api_digest=digest, status='ACCEPTED')
        api = {'Image': 'sha256:' + 'c' * 64, 'Config': {'Image': image, 'Env': [
            'GIT_SHA=' + sha, 'APP_ENV=stage', 'PUBLIC_API_ORIGIN=https://dev.gobadminton.ru',
            'PUBLIC_WEB_ORIGIN=https://dev.gobadminton.ru', 'EMAIL_AUTH_TRANSPORT=smtp']},
            'NetworkSettings': {'Networks': {'gobadminton_dev_preview_internal': {}, 'gobadminton_dev_preview_web_api': {}}}}
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, 'RUNTIME', Path(tmp)), \
                patch.object(worker.os, 'geteuid', return_value=0), \
                patch.object(Path, 'read_text', return_value=json.dumps(accepted)), \
                patch.object(worker.subprocess, 'check_output', side_effect=lambda *_: json.dumps([api]).encode()), \
                patch.object(worker.os, 'execv') as execute:
            worker.main()
            args = execute.call_args.args[1]
            self.assertEqual(args[-3:], [image, 'node', 'dist/worker-main.js'])
            self.assertEqual(args[args.index('--network')+1], 'gobadminton_dev_preview_internal')
            self.assertEqual((Path(tmp) / 'dev-worker.env').stat().st_mode & 0o777, 0o600)
            self.assertNotIn('SMTP_PASSWORD', (Path(tmp) / 'dev-worker.env').read_bytes().decode())
            api['Config']['Image'] = 'some-other-image'
            with self.assertRaisesRegex(ValueError, 'mismatch'):
                worker.main()

if __name__ == '__main__':
    unittest.main()
