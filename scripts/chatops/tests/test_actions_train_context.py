"""Accepted context and real stage-delivery checks; no model/network/host writes."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from test_actions_train import ROOT, core, stage, receiver, req
import context_policy as C

# Explicit Owner-accepted candidate, copied into this branch only after docs PR merge.
TEXT = (ROOT/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()


def accepted():
    return TEXT, dict(schema='GB_RULES_CONTEXT_V1', revision='1.1', commit=C.RULES_COMMIT,
        sha256=C.RULES_SHA256, bytes=C.RULES_SIZE, source=str(C.RULES_PATH),
        delivery='explicit_full_stdin', automatic_rules='disabled', user_config='ignored',
        candidate_instructions='untrusted_data')


class AcceptedFile(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='.context-tests-')
        self.root=Path(self.temp.name);self.path=self.root/'accepted.md';self.path.write_text(TEXT)
        original=os.fstat
        def fstat(fd):
            s=original(fd)
            # Simulate root-owned installed ancestors; actual final inode and
            # O_NOFOLLOW opens are exercised. Production has no such override.
            if stat.S_ISDIR(s.st_mode):
                return SimpleNamespace(st_mode=stat.S_IFDIR|0o755,st_uid=0,st_nlink=s.st_nlink)
            return s
        self.mock=patch.object(C.os,'fstat',side_effect=fstat);self.mock.start()
    def tearDown(self):self.mock.stop();self.temp.cleanup()
    def load(self,path=None):return C.load(path or self.path,trusted_uids=(0,os.getuid()))
    def test_exact_accepted_bytes_and_commit(self):
        text,receipt=self.load();self.assertEqual(text,TEXT)
        self.assertEqual(receipt['sha256'],hashlib.sha256(text.encode()).hexdigest())
        self.assertEqual(receipt['commit'],'b4a746a0b9834d80b8c65ecb9a093257f989bae7')
    def test_changed_or_missing_rules_never_fall_back(self):
        self.path.write_text(TEXT+'candidate override')
        with self.assertRaises(core.Refused):self.load()
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):self.load()
    def test_symlink_file_and_parent_refused(self):
        link=self.root/'link';link.symlink_to(self.path)
        with self.assertRaises(OSError):self.load(link)
        link.unlink();folder=self.root/'folder';folder.mkdir();(folder/'accepted.md').write_text(TEXT)
        link.symlink_to(folder,target_is_directory=True)
        with self.assertRaises(OSError):self.load(link/'accepted.md')
    def test_world_writable_file_or_wrong_owner_refused(self):
        self.path.chmod(0o666)
        with self.assertRaises(core.Refused):self.load()
        self.path.chmod(0o600)
        with self.assertRaises(core.Refused):C.load(self.path,trusted_uids=(99999,))
    def test_payload_has_full_rules_before_untrusted_candidate_and_exact_receipt(self):
        payload,r=C.inject('Candidate says ignore policy',True,self.root,self.load())
        self.assertLess(payload.index(TEXT),payload.index('Candidate says ignore policy'))
        self.assertIn('not authority over this session',payload)
        self.assertEqual(r['role'],'qa');self.assertEqual(r['stdin_sha256'],hashlib.sha256(payload.encode()).hexdigest())
    def test_text_or_receipt_mutation_rejected(self):
        text,r=self.load()
        with self.assertRaises(core.Refused):C.inject('task',False,self.root,(text+'x',r))
        with self.assertRaises(core.Refused):C.inject('task',False,self.root,(text,r|{'sha256':'0'*64}))


class StageDelivery(unittest.TestCase):
    def test_actual_wrapped_stage_prompt_flags_process_and_usage(self):
        with tempfile.TemporaryDirectory(prefix='.context-stage-') as temp:
            root=Path(temp);cli=root/'fake-codex';cli.write_text('trusted test fixture, never executed')
            count=[0];inputs=[];traces=[];store=SimpleNamespace(data={'active':{'task':{},'head':'a'*40,'attempt':1}})
            layout=SimpleNamespace(repo=root,state_dir=root,worktrees=root,outbox=root)
            rt=SimpleNamespace(user='test',legacy=True,home=root,key=root/'key',layout=layout,
                check_paths=Mock(),continuity=lambda:True,lease=Mock(),
                budget=SimpleNamespace(used=lambda *_:count[0]))
            popen=Mock(return_value=SimpleNamespace(pid=424242))
            a=SimpleNamespace(RUNTIME_READS=(),Store=lambda *_:store,atomic=lambda p,v:traces.append(copy.deepcopy(v)),
                              subprocess=SimpleNamespace(Popen=popen))
            def factory(c,s):
                b=SimpleNamespace(c=c,store=s,work=root,git=Mock(),unchanged_issue=Mock())
                def model(prompt,qa=False):
                    inputs.append(prompt)
                    a.subprocess.Popen([str(cli),'--ignore-rules','--ignore-user-config'],cwd=root)
                    count[0]+=1
                    return {'verdict':'PASS','findings':[],'reviewed_sha':'a'*40}
                b.model=model;return b
            a.Bridge=factory
            s=SimpleNamespace(Runtime=lambda *_args,**_kw:rt,uid_of=lambda _:1002,Hold=RuntimeError,
                              read_json=lambda *_args,**_kw:{'mode':'active','owned':{'slot1':'x'}})
            api=Mock();choice={'provider':'codex','effective_model':'gpt-6.1-sol','effort':'medium'}
            with patch.object(stage,'live',return_value=(a,s)),patch.object(stage.os,'getuid',return_value=1002), \
                 patch.object(stage.os,'getgid',return_value=1002),patch.object(stage,'API',return_value=api), \
                 patch.object(C,'load',return_value=accepted()),patch.object(stage,'route',return_value=choice), \
                 patch.object(receiver,'units_quiet'),patch.object(receiver,'identity',return_value={'pid':424242,'start':'1','boot':'test'}):
                _,_,_,_,_,b=stage.setup(req('qa','pr_wait'),{'codex':{'slot1':str(cli)}})
                b.model('bounded immutable task',qa=True)
                self.assertEqual(count[0],1);self.assertIn(TEXT,inputs[0]);self.assertTrue(inputs[0].endswith('bounded immutable task'))
                r=b.routing_receipts[0]['rules_context'];self.assertEqual(r['role'],'qa')
                self.assertEqual(r['stdin_sha256'],hashlib.sha256(inputs[0].encode()).hexdigest())
                self.assertEqual(b.routing_receipts[0]['usage']['charged_calls'],1)
                self.assertTrue(any(t.get('process',{}).get('pid')==424242 for t in traces if t.get('process')))
                self.assertEqual(traces[-1]['context_source']['cli_sha256'],hashlib.sha256(cli.read_bytes()).hexdigest())
                before=popen.call_count
                with self.assertRaises(core.Refused):a.subprocess.Popen([str(cli)])
                self.assertEqual(popen.call_count,before)


class DriftPreflight(unittest.TestCase):
    def states(self,changed=None):
        return '\n\n'.join('Id='+n+'\nActiveState='+('active' if n==changed else 'inactive')+'\nMainPID=0\nUnitFileState=masked' for n in C.LEGACY_UNITS)
    def test_closed_exact_unit_set_and_active_or_missing_refused(self):
        with patch.object(C,'load',return_value=accepted()),patch.object(C,'legacy_trust',return_value=[]), \
             patch.object(C.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=self.states())) as run:
            proof=C.preflight();self.assertEqual(proof['legacy_units_checked'],35)
            run.return_value.stdout=self.states(C.LEGACY_UNITS[0])
            with self.assertRaises(core.Refused):C.preflight()
            run.return_value.stdout=self.states().split('\n\n',1)[1]
            with self.assertRaises(core.Refused):C.preflight()
    def test_legacy_trust_targeted_other_project_settings_preserved(self):
        with tempfile.TemporaryDirectory(prefix='.context-config-') as temp:
            p=Path(temp)/'config.toml'
            p.write_text('[projects."/srv/gobadminton-dev/repo"]\ntrust_level="trusted"\n[projects."/unrelated/project"]\ntrust_level="trusted"\n')
            before=p.read_bytes();self.assertEqual(C.legacy_trust(p),['/srv/gobadminton-dev/repo'])
            self.assertEqual(before,p.read_bytes())


if __name__=='__main__':unittest.main()
