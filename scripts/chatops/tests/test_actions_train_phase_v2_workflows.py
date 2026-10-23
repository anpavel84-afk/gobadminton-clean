"""Fail-closed GitHub Actions phase V2 immutable checkout and draft isolation tests."""
import pathlib
import hashlib
import importlib.util
import json
import os
import subprocess
import tempfile
import sys
import re
import unittest
from unittest.mock import patch

ROOT=pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/chatops/actions_train'))
WORKFLOWS=('.github/workflows/train-dispatch.yml','.github/workflows/train-stage.yml')
REF=rb'(uses: actions/checkout@[^\n]+\n[ \t]+with:\n[ \t]+ref: )([a-f0-9]{40})([ \t]*\n)'


def git(*args,check=True):
    result=subprocess.run(['/usr/bin/git','--no-pager',*args],cwd=ROOT,
        env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8',
             'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0'},
        capture_output=True,timeout=60)
    if check and result.returncode:raise AssertionError(result.stderr.decode())
    return result.stdout if check else result


class HostedPhaseV2(unittest.TestCase):
    def pinned_payload(self):
        """Require real C, its ref-only release child R, and unchanged OPS at HEAD."""
        refs=[]
        for name in WORKFLOWS:
            text=(ROOT/name).read_bytes()
            matches=re.findall(REF,text)
            self.assertEqual(len(matches),2)
            refs.extend(m[1].decode() for m in matches)
            self.assertEqual(len(re.findall(rb'^\s+ref: [a-f0-9]{40}$',text,re.M)),2)
        self.assertEqual(len(set(refs)),1,'all four real checkout steps must pin identical C')
        pin=refs[0]
        self.assertEqual(git('cat-file','-e',pin+'^{commit}',check=False).returncode,0,
                         'actual pinned C object required; receiver needs full history')
        self.assertEqual(git('merge-base','--is-ancestor',pin,'HEAD',check=False).returncode,0,
                         'pinned C must be in HEAD history; full history required')
        def blob(path):return git('show',pin+':'+path)
        # R is the actual single-parent release child of C, even after product
        # descendants. Compare C -> R, never the entire C -> current HEAD diff.
        children=[row.split()[0] for row in
                  git('rev-list','--parents','--ancestry-path',pin+'..HEAD').decode().splitlines()
                  if row.split()[1:]==[pin]]
        releases=[]
        for child in children:
            changed=set(git('diff','--name-only',pin,child).decode().splitlines())
            if changed!=set(WORKFLOWS):continue
            if git('diff','--summary',pin,child):continue  # no mode changes
            for name in WORKFLOWS:
                expected,count=re.subn(REF,lambda m:m[1]+pin.encode()+m[3],blob(name))
                self.assertEqual(count,2)
                if expected!=git('show',child+':'+name):break
            else:
                releases.append(child)
        self.assertTrue(releases,'actual C -> R must change only the four checkout refs')
        manifest_path='scripts/chatops/actions_train/manifest.json'
        raw=blob(manifest_path);manifest=json.loads(raw)
        self.assertEqual(manifest['schema'],'GB_ACTIONS_TRAIN_INSTALL_V1')
        # R payload is checked against immutable C, with hashes AND real protocol.
        self.assertEqual(raw,git('show','HEAD:'+manifest_path))
        for name,sha in manifest['files'].items():
            self.assertTrue(name.startswith('scripts/chatops/'));self.assertNotIn('..',name.split('/'))
            payload=blob(name)
            self.assertEqual(hashlib.sha256(payload).hexdigest(),sha)
            self.assertEqual(payload,git('show','HEAD:'+name))
        return pin,manifest

    def test_every_hosted_checkout_exact_same_reviewed_controller(self):
        pin,manifest=self.pinned_payload()
        def blob(path):return git('show',pin+':'+path)
        with tempfile.TemporaryDirectory(dir=os.environ.get('JOB')) as temp:
            bundle=pathlib.Path(temp)
            for name in manifest['files']:
                path=bundle/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(blob(name))
            helper='scripts/chatops/ops/team_runtime_upgrade.py'
            self.assertEqual(blob(helper),(ROOT/helper).read_bytes())
            spec=importlib.util.spec_from_file_location('phase_provenance_probe',ROOT/helper)
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            task=json.loads(blob('scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json'))
            result=subprocess.run(['/usr/bin/python3','-I','-B','-c',module.PROTOCOL_PROBE,str(bundle),json.dumps(task)],
                cwd=bundle,env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8'},
                capture_output=True,timeout=30)
            self.assertEqual(result.returncode,0,result.stderr.decode())
            self.assertEqual(json.loads(result.stdout),dict(admission=True,request=True,qa_fail=True,ci_fail=True,plan=True))

    def test_c_r_product_descendant_and_forgery_with_disposable_git(self):
        """Small real history, independent of source Git objects and commit metadata."""
        with tempfile.TemporaryDirectory(dir=os.environ.get('JOB')) as temp:
            repo=pathlib.Path(temp)
            env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8',
                 'GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_TERMINAL_PROMPT':'0',
                 'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid',
                 'GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid'}
            def command(*args):
                r=subprocess.run(['/usr/bin/git',*args],cwd=repo,env=env,capture_output=True,timeout=30)
                self.assertEqual(r.returncode,0,r.stderr.decode());return r.stdout.decode().strip()
            def write(name,raw):
                path=repo/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
            def commit(message):
                command('add','.');command('commit','-qm',message)
                return command('rev-parse','HEAD')
            originals={name:(ROOT/name).read_bytes() for name in WORKFLOWS}
            payload='scripts/chatops/fixture.py'
            command('init','-q')
            for name,raw in originals.items():write(name,raw)
            write(payload,b'inert payload\n')
            write('scripts/chatops/actions_train/manifest.json',json.dumps(dict(
                schema='GB_ACTIONS_TRAIN_INSTALL_V1',
                files={payload:hashlib.sha256(b'inert payload\n').hexdigest()})).encode())
            c=commit('Implementation')
            def refs(pin):
                for name,raw in originals.items():
                    raw,count=re.subn(REF,lambda m:m[1]+pin.encode()+m[3],raw)
                    self.assertEqual(count,2);write(name,raw)
            refs(c);r=commit('Release four refs')
            with patch.dict(globals(),ROOT=repo):
                self.pinned_payload()  # C -> R
                write('apps/product.txt',b'later product change\n');commit('Product descendant')
                self.pinned_payload()  # C -> R -> product
                for forged in ('1'*40,r):
                    refs(forged)
                    with self.subTest(forged=forged),self.assertRaises(AssertionError):self.pinned_payload()
                refs(c)
                write(WORKFLOWS[0],(repo/WORKFLOWS[0]).read_bytes().replace(c.encode(),r.encode(),1))
                with self.assertRaises(AssertionError):self.pinned_payload()
                refs(c)
                write(payload,b'forged payload\n');commit('Forged descendant payload')
                with self.assertRaises(AssertionError):self.pinned_payload()
                write(payload,b'inert payload\n');commit('Restore payload')
                self.pinned_payload()
                # Make a real, existing C whose manifest lies about its blob.
                refs(c);write(payload,b'forged pinned payload\n')
                bad_c=commit('Invalid implementation payload')
                refs(bad_c);commit('Release invalid payload')
                with self.assertRaises(AssertionError):self.pinned_payload()
                # No shallow/reconstruction fallback when the required C is absent.
                (repo/'.git/objects'/bad_c[:2]/bad_c[2:]).unlink()
                with self.assertRaisesRegex(AssertionError,'actual pinned C object required'):
                    self.pinned_payload()

    def test_planning_writer_is_after_serialized_read_only_reconciliation(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        self.assertIn('group: gobadminton-train-dispatch',text)
        self.assertIn('cancel-in-progress: false',text)
        self.assertIn('queue: single',text)
        self.assertEqual(text.count('  publish_phase_drafts:'),1)
        publish=text.split('  publish_phase_drafts:')[1]
        self.assertIn('needs: reconcile',publish)
        self.assertIn("needs.reconcile.result == 'success'",publish)
        self.assertIn("github.ref == 'refs/heads/dev'",publish)
        self.assertIn("github.event_name == 'workflow_dispatch'",publish)
        self.assertIn('permissions:\n      contents: read\n      issues: write\n      actions: read',publish)
        self.assertIn('python3 -B scripts/chatops/planning/phase_plan_publish_v2.py',publish)
        self.assertIn('name: train-reconcile',publish)
        self.assertIn('name: phase-plan-publication',publish)
        self.assertIn('name: train-reconcile, path: evidence/',text)

    def test_writer_has_no_model_or_vps_credential(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        writer=text.split('  publish_phase_drafts:')[1]
        for banned in ('DEPLOY_HOST','DEPLOY_PORT','DEPLOY_SSH_KEY',
                       'DEPLOY_KNOWN_HOSTS','CURSOR_API_KEY',
                       'CODEX_HOME','AGY_TOKEN','environment: dev',
                       'actions: write','contents: write','pull-requests: write'):
            with self.subTest(banned=banned):
                self.assertNotIn(banned,writer)
        self.assertIn('persist-credentials: false',writer)
        self.assertNotIn('issues: write',text.split('  reconcile:')[1].split('  publish_phase_drafts:')[0])

    def test_no_second_scheduler_or_untrusted_webhook(self):
        text=(ROOT/'.github/workflows/train-dispatch.yml').read_text()
        self.assertEqual(text.count('  reconcile:'),1)
        self.assertIn("github.actor_id == '318610566'",text)
        self.assertIn("github.repository_id == '1416250340'",text)
        self.assertNotIn('issue_comment:',text)
        self.assertNotIn('schedule:',text)


if __name__=='__main__':
    unittest.main()
