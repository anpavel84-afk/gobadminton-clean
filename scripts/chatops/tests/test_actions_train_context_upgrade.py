"""#216 upgrade simulations: interruption rollback, no history/recovery replay, settings scope."""
import copy,hashlib,importlib.util,json,os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch,Mock
from test_actions_train import ROOT,core,receiver,installer
import context_policy as C
spec=importlib.util.spec_from_file_location('context_upgrade_test',ROOT/'scripts/chatops/ops/context_stability_upgrade.py')
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)

class Upgrade216(unittest.TestCase):
    def test_trust_trim_preserves_unrelated_settings_and_rejects_unknown_layout(self):
        raw=b'# keep\n[projects."/srv/gobadminton-dev/repo"]\ntrust_level="trusted"\n[projects."/srv/another/repo"]\ntrust_level="trusted"\n[other]\nvalue=3\n'
        result,removed=U.trim_config(raw,C.LEGACY_TRUST_PREFIXES)
        self.assertEqual(removed,['/srv/gobadminton-dev/repo'])
        self.assertIn(b'[other]\nvalue=3',result);self.assertIn(b'/srv/another/repo',result)
        self.assertNotIn(b'gobadminton-dev',result)
        with self.assertRaises(core.Refused):
            U.trim_config(b"[projects.'/srv/gobadminton-dev/repo']\ntrust_level='trusted'\n",C.LEGACY_TRUST_PREFIXES)
    def test_stopped_unknown_preserved_but_live_or_effectful_unknown_rejected(self):
        op={'before':'x','after':'x','finished_at':1,'process':None,
            'binding':{'stage':'author'},'result':{'status':'unknown','reason':'no bounded exact CI assertion/log evidence'}}
        journal={'pending':'key','operations':{'key':op}}
        r=SimpleNamespace(read=lambda *_:{'mode':'disabled'},POLICY=Path('/fixture/policy'),UNITS=(),
            units_quiet=Mock(),journal=lambda _:journal,checkpoint=lambda _:({'active':{}},[]),
            alive=lambda _:False,need=core.need,recovery_journal=lambda :{'receipts':{}})
        with tempfile.TemporaryDirectory() as td,patch.object(U,'STATE',Path(td)),patch.object(U,'r',r),patch.object(U.i,'safe_state') as safe:
            original=copy.deepcopy(journal);U.quiet();self.assertEqual(journal,original);self.assertEqual(safe.call_count,2)
            op['after']='changed'
            with self.assertRaises(core.Refused):U.quiet()
            op['after']='x';r.alive=lambda _:True
            with self.assertRaises(core.Refused):U.quiet()
    def test_wrong_manifest_rejected_before_import(self):
        with tempfile.TemporaryDirectory() as td:
            bundle=Path(td);f=bundle/'scripts/chatops/actions_train/manifest.json';f.parent.mkdir(parents=True);f.write_text('{}')
            with patch.object(U.os,'geteuid',return_value=0),patch.object(U.r,'trusted_tree'),patch.object(U,'load') as imported:
                with self.assertRaises(core.Refused):U.execute('dry',bundle,'0'*64,'a'*40,'x','y')
                imported.assert_not_called()
    def test_fd_user_config_atomic_write_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            parent=Path(td);path=parent/'config.toml';path.write_bytes(b'original');path.chmod(0o600)
            real_fstat=os.fstat
            def owned(fd):
                s=real_fstat(fd)
                return os.stat_result((s.st_mode,s.st_ino,s.st_dev,s.st_nlink,1002,1002,s.st_size,s.st_atime,s.st_mtime,s.st_ctime))
            with patch.object(U,'CONFIG',path),patch.object(U,'config_parent',side_effect=lambda :os.open(parent,os.O_RDONLY|os.O_DIRECTORY)), \
                 patch.object(U.os,'fstat',side_effect=owned),patch.object(U.os,'fchown'):
                old,info=U.config_read();U.config_write(b'revised',info['sha256'],info)
                self.assertEqual(path.read_bytes(),b'revised')
                with self.assertRaises(core.Refused):U.config_write(b'overwrite',info['sha256'],info)
                other=parent/'other';path.rename(other);path.symlink_to(other)
                with self.assertRaises(OSError):U.config_read()
                self.assertEqual(other.read_bytes(),b'revised')
    def test_apply_interrupt_then_rollback_restores_own_files_never_history_or_restart(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);state=root/'state';state.mkdir();backup=root/'backups';system=root/'system';system.mkdir()
            bundle=root/'bundle';bundle.mkdir();journal=state/'install.json';config=root/'config.toml'
            config.write_text('[projects."/srv/gobadminton-dev/repo"]\ntrust_level="trusted"\n[projects."/srv/other"]\ntrust_level="trusted"\n')
            unit=system/'legacy.service';unit.write_text('old unit')
            installed=root/'runtime.py';installed.write_text('old code');source=bundle/'runtime.py';source.write_text('new code')
            helper=bundle/'scripts/chatops/ops/cost_policy_upgrade.py';helper.parent.mkdir(parents=True);helper.write_text('fixture helper')
            context=bundle/'scripts/chatops/actions_train/context_policy.py';context.parent.mkdir(parents=True);context.write_text('fixture context')
            manifest_path=context.parent/'manifest.json';manifest_path.write_text(json.dumps({'files':{'scripts/chatops/actions_train/context_policy.py':installer.sha(context)}}))
            manifest=installer.sha(manifest_path)
            rule=bundle/'docs/rules/ENGINEERING_OPERATING_MODEL.md';rule.parent.mkdir(parents=True);rule.write_text('trusted rule fixture')
            rules_target=root/'accepted.md'
            controller='a'*40
            for name in ('train-stage.yml','train-dispatch.yml'):
                f=bundle/'.github/workflows'/name;f.parent.mkdir(parents=True,exist_ok=True);f.write_text(('ref: '+controller+'\n')*2)
            policy=state/'policy.json';policy.write_text(json.dumps({'mode':'disabled','controller_sha':U.OLD,'recovery':{'source_sha':U.OLD}}))
            (state/'backup.json').write_text(json.dumps({'after':{str(installed):installer.sha(installed)}}))
            history=state/'history.json';history.write_text('immutable attempts #177 #181 UNKNOWN')
            c=SimpleNamespace(LEGACY_UNITS=('legacy.service',),LEGACY_TRUST_PREFIXES=C.LEGACY_TRUST_PREFIXES,
               RULES_PATH=rules_target,RULES_SHA256=installer.sha(rule),RULES_SIZE=rule.stat().st_size,preflight=Mock())
            # Actual root installer copy primitive is replaced by a fixture-only atomic copy.
            def put(src,dst,mode):
                dst.write_bytes(src.read_bytes());dst.chmod(mode)
            def read(path,*_):return json.loads(path.read_text())
            def atomic(path,value,mode=0o600):path.write_text(json.dumps(value));path.chmod(mode)
            rr=SimpleNamespace(need=core.need,trusted_tree=Mock(),read=read,atomic=atomic,POLICY=policy)
            record_before=(state/'backup.json').read_bytes();policy_before=policy.read_bytes();config_before=config.read_bytes()
            u=SimpleNamespace(probe=Mock(),BUDGET=root/'budget')
            def modules(name,_):return c if name=='_context216' else u
            states={'legacy.service':{'ActiveState':'inactive','MainPID':'0'}}
            with patch.multiple(U,STATE=state,JOURNAL=journal,BACKUP=backup,SYSTEM=system,CONFIG=config,
                    TARGETS={installed},r=rr,COST_HELPER_SHA256=installer.sha(helper)),patch.object(U,'load',side_effect=modules),patch.object(U,'quiet'), \
                 patch.object(U,'preserved',side_effect=lambda _:{str(history):installer.sha(history)}), \
                 patch.object(U,'config_read',side_effect=lambda :(config.read_bytes(),{'sha256':installer.sha(config),'uid':1002,'gid':1002,'mode':0o600})), \
                 patch.object(U,'units',return_value=states),patch.object(U,'pipeline_empty'), \
                 patch.object(U,'run',side_effect=RuntimeError('interrupted before stop')), \
                 patch.object(U.os,'geteuid',return_value=0),patch.object(U.os,'chown'), \
                 patch.object(U.i,'payload',return_value={installed:source}),patch.object(U.i,'put',side_effect=put), \
                 patch.object(Path,'stat',autospec=True) as unused:
                # stat remains real, except config ownership is simulated separately below.
                unused.side_effect=lambda path,**kw:os.stat(path,**kw)
                original_stat=os.stat
                def fixture_stat(path,*args,**kw):
                    st=original_stat(path,*args,**kw)
                    if str(path)==str(unit):
                        return os.stat_result((st.st_mode,st.st_ino,st.st_dev,st.st_nlink,0,0,st.st_size,st.st_atime,st.st_mtime,st.st_ctime))
                    if str(path)==str(config):
                        return os.stat_result((st.st_mode,st.st_ino,st.st_dev,st.st_nlink,1002,st.st_gid,st.st_size,st.st_atime,st.st_mtime,st.st_ctime))
                    return st
                with patch.object(os,'stat',side_effect=fixture_stat):
                    with self.assertRaisesRegex(RuntimeError,'interrupted'):
                        U.execute('apply',bundle,manifest,controller,installer.sha(bundle/'.github/workflows/train-stage.yml'),installer.sha(bundle/'.github/workflows/train-dispatch.yml'))
                    self.assertEqual(read(journal)['phase'],'applying')
                    self.assertTrue(any(backup.glob('code-*')));self.assertTrue((backup/'codex-config').exists())
                    with patch.object(U,'run',return_value='') as command:
                        result=U.execute('rollback',bundle,manifest,controller,'unused','unused')
                        self.assertEqual(result['phase'],'rolled-back-disabled')
                        self.assertEqual(command.call_args.args,('/usr/bin/systemctl','daemon-reload'))
                self.assertEqual(installed.read_text(),'old code');self.assertFalse(rules_target.exists())
                self.assertEqual(config.read_bytes(),config_before);self.assertEqual(unit.read_text(),'old unit')
                self.assertEqual(json.loads((state/'backup.json').read_text()),json.loads(record_before))
                self.assertEqual(json.loads(policy.read_text()),json.loads(policy_before))
                self.assertEqual(history.read_text(),'immutable attempts #177 #181 UNKNOWN')
if __name__=='__main__':unittest.main()
