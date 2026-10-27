"""V3 safety/protocol evidence on synthetic dirs and immutable Git objects only."""
import ast
import copy
import json
import os
from pathlib import Path
import stat
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import test_actions_train_stage5_cursor_upgrade as v3

U, core, H = v3.U, v3.core, v3.H
ROOT=v3.legacy.ROOT


def blob(path):
    env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1',
         'GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'}
    return subprocess.run(['/usr/bin/git','--no-optional-locks','-C',str(ROOT),
        'show',U.C5+':'+U.PREFIX+path],capture_output=True,check=True,env=env).stdout


def function(raw,name):
    return next(n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef) and n.name==name)


class ProtocolEvidence(unittest.TestCase):
    def test_exact_frozen_router_refuses_all_agy_author_routes(self):
        # Execute only the pure immutable router function against inert fake
        # availability/budget. No module import, client invocation or live().
        raw=blob('core.py');self.assertEqual(H(raw),U.V3_PROTOCOL['core.py'])
        tree=ast.Module(body=[function(raw,'_route_immutable')],type_ignores=[])
        def need(ok,why):
            if not ok: raise core.Refused(why)
        fake=SimpleNamespace(UNKNOWN=object(),adapter_status=lambda *a:(True,'fake'),MODEL_ADAPTER={})
        budget=SimpleNamespace(remaining=lambda *a:3,used=lambda *a:0)
        namespace=dict(need=need,json=json,digest=lambda x:'f'*64)
        exec(compile(tree,'immutable pure router','exec'),namespace)
        import native_antigravity
        with patch.dict('sys.modules',native_antigravity=native_antigravity):
            for model in native_antigravity.MODELS:
                task=dict(author_routes=['agy:'+model],work_kind='implementation',risk='complex')
                with self.subTest(model=model),self.assertRaisesRegex(core.Refused,'role/model/effort not supported'):
                    namespace['_route_immutable'](fake,task,'author','auto',budget,'slot1')
        slots=blob('live/slots.py');self.assertEqual(H(slots),U.V3_PROTOCOL['live/slots.py'])
        assignment=next(n for n in ast.parse(slots).body if isinstance(n,ast.Assign)
                        and any(isinstance(t,ast.Name) and t.id=='FORBIDDEN' for t in n.targets))
        self.assertIn('author',ast.literal_eval(assignment.value)['agy'])

    def test_frozen_context_api_and_exact_reviewed_stage_guard_delta(self):
        raw=blob('context_exchange.py');self.assertEqual(H(raw),U.V3_PROTOCOL['context_exchange.py'])
        funcs={n.name:n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)}
        self.assertEqual([a.arg for a in funcs['compile_capsule'].args.args],['full_rules','role','expected_sha256'])
        self.assertEqual([a.arg for a in funcs['encoded'].args.args],['value'])
        self.assertTrue({'text','metadata','role','compact','full_rules_reference','verified_access'}<=
                        {a.arg for a in funcs['rules_prefix'].args.kwonlyargs})
        for n in U.V3_NEW:
            if n=='accepted-engineering-rules.md': continue
            self.assertEqual(H((ROOT/U.PREFIX/n).read_bytes()),U.V3_NEW[n])
        stage=(ROOT/U.PREFIX/'stage.py').read_bytes()
        tree=ast.parse(stage)
        imports=[n for n in ast.walk(tree) if isinstance(n,ast.ImportFrom) and n.module=='native_antigravity_author']
        self.assertEqual(len(imports),1)
        parents={child:node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        parent=parents[imports[0]]
        self.assertIsInstance(parent,ast.If)
        self.assertEqual(ast.unparse(parent.test),"provider == 'agy' and (not qa)")
        # Only the RO canon addition is accepted for the shared guard. All AGY
        # restriction functions and namespace construction before the new mount
        # must remain exact AST equivalents of the old guard.
        old=ast.parse(blob('native_guard.py'));new=ast.parse((ROOT/U.PREFIX/'native_guard.py').read_bytes())
        for name in ('_landlock','_seccomp','restrict','no_new_privileges'):
            self.assertEqual(ast.dump(function(ast.unparse(old),name)),ast.dump(function(ast.unparse(new),name)))
        oldfn=function(ast.unparse(old),'cursor_namespace_argv')
        newfn=copy.deepcopy(function(ast.unparse(new),'cursor_namespace_argv'))
        added=[n for n in newfn.body if isinstance(n,ast.AugAssign) and isinstance(n.value,ast.Call)
               and isinstance(n.value.func,ast.Name) and n.value.func.id=='cursor_rules_readonly_mounts']
        self.assertEqual(len(added),1);newfn.body.remove(added[0]);self.assertEqual(ast.dump(oldfn),ast.dump(newfn))


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
