"""V3 safety/protocol evidence on synthetic dirs and immutable Git objects only."""
import ast
import copy
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
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
        # Compare immutable V3 evidence blobs — live tree may be a V4 candidate.
        try:
            raw=blob('core.py')
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            print('NOT_TESTED: frozen V3 core blob (no Git history)')
            return
        self.assertEqual(H(raw),U.V3_PROTOCOL['core.py'])
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
        try:
            slots=blob('live/slots.py')
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            print('NOT_TESTED: frozen V3 live/slots blob (no Git history)')
            return
        self.assertEqual(H(slots),U.V3_PROTOCOL['live/slots.py'])
        assignment=next(n for n in ast.parse(slots).body if isinstance(n,ast.Assign)
                        and any(isinstance(t,ast.Name) and t.id=='FORBIDDEN' for t in n.targets))
        self.assertIn('author',ast.literal_eval(assignment.value)['agy'])

    def test_frozen_context_api_and_exact_reviewed_stage_guard_delta(self):
        try:
            raw=blob('context_exchange.py')
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            print('NOT_TESTED: frozen V3 context_exchange blob (no Git history)')
            return
        self.assertEqual(H(raw),U.V3_PROTOCOL['context_exchange.py'])
        funcs={n.name:n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef)}
        self.assertEqual([a.arg for a in funcs['compile_capsule'].args.args],['full_rules','role','expected_sha256'])
        self.assertEqual([a.arg for a in funcs['encoded'].args.args],['value'])
        self.assertTrue({'text','metadata','role','compact','full_rules_reference','verified_access'}<=
                        {a.arg for a in funcs['rules_prefix'].args.kwonlyargs})
        # Live tree may carry V4 candidate pins; only assert V3_NEW for modules
        # outside the V4 OLD→NEW closure (immutable V3 evidence, not weakened pins).
        v4_changed=set(getattr(U,'V4_OLD',{}))|{ 'native_guard.py','live/slots.py'}
        for n in U.V3_NEW:
            if n in ('accepted-engineering-rules.md', 'stage.py') or n in v4_changed: continue
            self.assertEqual(H((ROOT/U.PREFIX/n).read_bytes()),U.V3_NEW[n])
        # Historical stage pin: immutable V3 blob only (live tree may add quota binding).
        # ca5ca68e… == 89cef7f7fe994464a81462801942dee8c945c910:scripts/chatops/actions_train/stage.py
        frozen_stage_sha='ca5ca68eb8b3f8bafbb8c097790acc91c0323f2081fed977372cf571452b97ed'
        env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','GIT_CONFIG_NOSYSTEM':'1',
             'GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_NO_REPLACE_OBJECTS':'1'}
        try:
            stage=subprocess.run(
                ['/usr/bin/git','--no-optional-locks','-C',str(ROOT),'show',
                 '89cef7f7fe994464a81462801942dee8c945c910:scripts/chatops/actions_train/stage.py'],
                capture_output=True,check=True,env=env).stdout
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            stage=None
        if stage is None:
            # Local export lacks Git history; do not fake PASS on the frozen pin.
            print('NOT_TESTED: frozen V3 stage blob 89cef7f7… (no Git history)')
        else:
            self.assertEqual(H(stage),frozen_stage_sha)
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
        try:
            old_raw=blob('native_guard.py')
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            print('NOT_TESTED: frozen V3 native_guard blob (no Git history)')
            return
        old=ast.parse(old_raw);new=ast.parse((ROOT/U.PREFIX/'native_guard.py').read_bytes())
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


class ProductQaV4Contract(unittest.TestCase):
    def test_v4_distinct_from_v3_and_preserves_pending_contract(self):
        self.assertEqual(U.V4_SCHEMA,'GB_STAGE5_PRODUCT_QA_ADMISSION_V4')
        self.assertNotEqual(U.V4_SCHEMA,U.V3_SCHEMA)
        self.assertEqual(set(U.V4_OLD),set(U.V4_NEW))
        self.assertTrue(all(U.V4_OLD[n]!=U.V4_NEW[n] for n in U.V4_OLD))
        # Frozen V3 still refuses pending; V4 quiet documents preserved UNKNOWN.
        import inspect
        self.assertIn("j['pending'] is None", inspect.getsource(U.quiet_v3))
        self.assertIn('pending UNKNOWN may remain', U.quiet_v4.__doc__)
        quiet_src=inspect.getsource(U.quiet_v4)
        # Gap A: body must not invoke quiet()/safe_checkpoint (pending=none / terminal ACCEPTED).
        import ast
        body=ast.parse(quiet_src).body[0]
        called={n.func.id for n in ast.walk(body) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name)}
        self.assertNotIn('quiet', called)
        self.assertNotIn('safe_checkpoint', called)
        self.assertIn("live checkpoint active HOLD", quiet_src)
        # Resource quiescence must NOT re-check all OLD pins each apply loop.
        self.assertNotIn('installed OLD pin/metadata HOLD', quiet_src)
        self.assertIn('_v4_historical_checkpoint_ok', quiet_src)
        plan_src=inspect.getsource(U._v4_plan)
        self.assertIn('installed OLD pin mismatch HOLD', plan_src)
        self.assertIn('_v4_current', inspect.getsource(U.execute_v4))
        # Closure includes native_guard + live/slots + PR341 context/admission/rules.
        self.assertIn('native_guard.py', U.V4_OLD)
        self.assertIn('live/slots.py', U.V4_OLD)
        self.assertIn('context_policy.py', U.V4_OLD)
        self.assertIn('context_cursor_delivery.py', U.V4_OLD)
        self.assertIsNone(U.V4_OLD['context_cursor_delivery.py'])
        self.assertIsNone(U.V4_OLD['admission_pm.py'])
        self.assertEqual(U.V4_OLD['accepted-engineering-rules.md'],
                         '017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269')
        self.assertEqual(U.V4_NEW['accepted-engineering-rules.md'], U.RULES_SHA256)
        # Controller protocol: policy/cursor_marker/budget + disabled→shadow→activation.
        src=inspect.getsource(U.execute_v4)
        self.assertIn("action=='verify'", src)
        self.assertIn("installed-disabled", src)
        self.assertIn("proof-recorded", src)
        self.assertIn("action=='apply'", src)
        self.assertIn('require existing journal', src)
        self.assertIn('v4_reviewed_budget_config5', plan_src)
        self.assertIn("'policy'", plan_src)
        self.assertIn('cursor_marker', plan_src)
        self.assertIn("'budget'", plan_src)
        self.assertIn('_v4_workflow_gates', src)
        self.assertIn('version=4', src)
        save_src=inspect.getsource(U._v4_save)
        self.assertIn('expected=current(V4_JOURNAL)', save_src)
        self.assertNotIn('expected=None)', save_src)

    def test_v4_old_pins_match_installed_v3_baseline(self):
        # Regression: V4 OLD = actual installed V3_OLD/V3_PROTOCOL, not assumed PR340/PR341.
        self.assertEqual(U.V4_OLD['native_antigravity.py'],
                         U.V3_OLD['native_antigravity.py'])
        self.assertEqual(U.V4_OLD['native_guard.py'],
                         U.V3_OLD['native_guard.py'])
        self.assertEqual(U.V4_OLD['core.py'], U.V3_PROTOCOL['core.py'])
        self.assertEqual(U.V4_OLD['receiver.py'], U.V3_PROTOCOL['receiver.py'])
        self.assertEqual(U.V4_OLD['context_policy.py'], U.V3_OLD['context_policy.py'])
        self.assertEqual(U.V4_NEW['context_policy.py'], U.V3_NEW['context_policy.py'])
        self.assertEqual(U.V4_NEW['context_cursor_delivery.py'],
                         U.V3_NEW['context_cursor_delivery.py'])
        self.assertEqual(U.V4_NEW['admission_pm.py'], U.V3_NEW['admission_pm.py'])
        self.assertEqual(U.V4_NEW['native_guard.py'],
                         U.V3_NEW['native_guard.py'])
        self.assertEqual(U.V4_FROZEN['native_cursor.py'], U.V3_PROTOCOL['native_cursor.py'])
        self.assertEqual(U.V4_FROZEN['context_exchange.py'], U.V3_PROTOCOL['context_exchange.py'])

    def test_quiet_v4_allows_historical_pending_denies_live(self):
        # Historical pending UNKNOWN accepted; live process / unmatched CP denied.
        import native_antigravity as N
        import pwd
        hist_key=U.V4_HISTORICAL_SLOT1_PENDING
        hist_op={'status':'unknown','result':{'status':'unknown','safe_release':False},
                 'binding':{'slot':'slot1','issue':U.V4_HISTORICAL_SLOT1_ISSUE,
                            'head':U.V4_HISTORICAL_SLOT1_HEAD},
                 'process':{'pid':123,'start':'old','boot':'old'}}
        j={'generation':113,'pending':hist_key,'operations':{
            hist_key:hist_op,
            'history':{'status':'unknown','process':{'pid':456,'start':'old','boot':'old'}}}}
        accounts={'agentagency-dev':SimpleNamespace(pw_uid=1002),
                  'gb-slot2':SimpleNamespace(pw_uid=978)}
        dead={'pid':999,'start':'reused','boot':'old'}
        ops=type('P',(),{'exists':staticmethod(lambda:False)})()
        hist_cp={'active':{'phase':'pr_wait','issue':U.V4_HISTORICAL_SLOT1_ISSUE,
                           'head':U.V4_HISTORICAL_SLOT1_HEAD},'done':[]}
        idle_cp={'active':None,'done':[]}
        def checkpoint(slot):
            return (hist_cp if slot=='slot1' else idle_cp),[]
        slot2_j={'pending':U.V4_HISTORICAL_SLOT2_PENDING,'operations':{
            U.V4_HISTORICAL_SLOT2_PENDING:{'status':'unknown',
                'result':{'status':'unknown','safe_release':False},
                'process':{'pid':789,'start':'old','boot':'old'}}}}
        def journal(slot):
            return j if slot=='slot1' else slot2_j
        with patch.object(pwd,'getpwnam',side_effect=lambda n:accounts[n]), \
             patch.object(U,'run',return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n'), \
             patch.object(U.receiver,'units_quiet'), \
             patch.object(U.receiver,'journal',side_effect=journal), \
             patch.object(U.receiver,'checkpoint',side_effect=checkpoint), \
             patch.object(U.receiver,'identity',return_value=dead), \
             patch.object(U.receiver,'no_models'), \
             patch.object(U,'lock_unheld'), \
             patch.object(U.receiver,'free_lock'), \
             patch.object(U.receiver,'recovery_journal',return_value={'receipts':{}}), \
             patch.object(U.os.path,'lexists',return_value=False), \
             patch.object(U,'V4_PRODUCT_OPS',ops):
            U.quiet_v4()
            with patch.object(U.receiver,'identity',return_value=hist_op['process']):
                with self.assertRaisesRegex(core.Refused,'still alive HOLD'):
                    U.quiet_v4()
            with patch.object(U.receiver,'checkpoint',
                              return_value=({'active':{'phase':'author','issue':1},'done':[]},[])):
                with self.assertRaisesRegex(core.Refused,'live checkpoint active HOLD'):
                    U.quiet_v4()
            with patch.object(U.receiver,'checkpoint',side_effect=lambda slot: (
                    ({'active':{'phase':'pr_wait','issue':99,'head':'b'*40},'done':[]},[])
                    if slot=='slot1' else (idle_cp,[]))):
                with self.assertRaisesRegex(core.Refused,'live checkpoint active HOLD'):
                    U.quiet_v4()

    def test_budget_config5_unlimited_qa_per_issue_no_global_cap(self):
        before={'schema':1,'providers':{'codex':{'qa':3},'agy':{'qa':2,'author':'unlimited'}},
                'slots':{'slot2':{'agy':{'qa':2}}}}
        after=U.v4_reviewed_budget_config5(before)
        self.assertEqual(after['providers']['agy']['qa'],'unlimited')
        self.assertEqual(after['providers']['agy']['per_issue_daily'],5)
        self.assertEqual(after['providers']['agy']['author'],'unlimited')
        self.assertEqual(after['providers']['codex'],{'qa':3})
        self.assertEqual(after['slots']['slot1']['agy']['qa'],'unlimited')
        self.assertEqual(after['slots']['slot2']['agy']['qa'],'unlimited')
        self.assertEqual(before['providers']['agy']['qa'],2)
        with self.assertRaises(core.Refused):
            U.v4_reviewed_budget_config5({'schema':1,'global_cap':9,'providers':{},'slots':{}})

    def test_v4_save_second_write_uses_expected_metadata(self):
        # expected=None on every save makes the second CAS fail once the journal exists.
        with tempfile.TemporaryDirectory(prefix='.gb-v4-save-') as tmp:
            root=Path(tmp);journal=root/'journal.json'
            meta=dict(mode=0o600,uid=os.getuid(),gid=os.getgid())
            with patch.object(U,'V4_JOURNAL',journal), \
                 patch.object(U,'OWNER_UID',os.getuid()), \
                 patch.object(U,'OWNER_GID',os.getgid()), \
                 patch.object(U.receiver,'trusted_tree'):
                U._v4_save({'phase':'preparing','n':1})
                U._v4_save({'phase':'applying','n':2})
                self.assertEqual(json.loads(journal.read_bytes())['phase'],'applying')


class V4Fixture:
    """Synthetic OPS V4 fixture reused from Stage5Install; Root UID → test UID."""

    def __init__(self):
        self.f=f=v3.legacy.Stage5Install();f.setUp()
        try: self.build()
        except BaseException:
            f.tearDown();raise

    def build(self):
        f=self.f
        f.stack.enter_context(patch.object(U.os,'geteuid',return_value=os.getuid()))
        self.v4_journal=f.state/'stage5-product-qa-admission.json'
        self.v4_backup=f.state/'stage5-product-qa-admission-backup'
        f.stack.enter_context(patch.object(U,'V4_JOURNAL',self.v4_journal))
        f.stack.enter_context(patch.object(U,'V4_BACKUP',self.v4_backup))
        f.stack.enter_context(patch.object(U,'quiet_v4'))
        self.baseline=U.C5
        self.controller='c'*40
        rules=v3.legacy.RULES
        # OLD present pins / NEW bytes; None-preimage modules start absent.
        self.before={n:(('old '+n).encode() if pin else None) for n,pin in U.V4_OLD.items()}
        self.before['accepted-engineering-rules.md']=b'old accepted rules artifact\n'
        self.after={n:('new '+n).encode() for n in U.V4_NEW}
        self.after['accepted-engineering-rules.md']=rules
        self.after['context_policy.py']=(
            ("RULES_SHA256 = '%s'\nRULES_SIZE = %d\nRULES_COMMIT = '%s'\n"
             %(H(rules),len(rules),f.rules_commit)).encode())
        frozen_raw={n:('frozen '+n).encode() for n in U.V4_FROZEN}
        frozen={n:H(raw) for n,raw in frozen_raw.items()}
        for n,raw in frozen_raw.items():
            p=f.install/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(raw)
            src=f.bundle/U.PREFIX/n;src.parent.mkdir(parents=True,exist_ok=True);src.write_bytes(raw)
            f.items[p]=src
        # Clear leftover Stage5Install targets that are not part of V4 OLD presence.
        for n,raw in self.before.items():
            p=f.install/n;p.parent.mkdir(parents=True,exist_ok=True)
            if raw is None: p.unlink(missing_ok=True)
            else: p.write_bytes(raw)
            if n=='accepted-engineering-rules.md': continue
            src=f.bundle/U.PREFIX/n;src.parent.mkdir(parents=True,exist_ok=True)
            # Candidate (NEW) bytes in bundle; installed stays OLD/absent.
            src.write_bytes(self.after[n]);f.items[f.install/n]=src
        # Workflows must bind the new controller for V4 gates.
        wf=f.bundle/'.github/workflows'
        for name in ('train-stage.yml','train-dispatch.yml'):
            (wf/name).write_text(('ref: '+self.controller+'\n')*2)
        f.sh=H((wf/'train-stage.yml').read_bytes());f.dh=H((wf/'train-dispatch.yml').read_bytes())
        # Canon blob already committed in Stage5Install; keep RULES_* patches below.
        f.refresh()
        policy=dict(mode='active',controller_sha=self.baseline,stage_workflow_sha256=f.sh,
                    recovery={'source_sha':self.baseline})
        f.policy.write_text(json.dumps(policy,indent=2));self.policy=f.policy.read_bytes()
        f.budget.write_text(json.dumps({'schema':1,'providers':{'agy':{'qa':2}},
                                        'slots':{'slot2':{'agy':{'qa':2}}}}))
        f.rules.write_bytes(self.before['accepted-engineering-rules.md'])
        old={n:H(raw) if raw is not None else None for n,raw in self.before.items()}
        new={n:H(raw) for n,raw in self.after.items()}
        self.markers={};self.marker_raw={}
        for key in ('cursor_marker','agy_marker'):
            p=f.p/(key+'.json')
            marker=dict(schema='GB_CURSOR_AUTHOR_211_V1' if key=='cursor_marker' else 'GB_ANTIGRAVITY_QA_29_V1',
                        phase='ready' if key=='cursor_marker' else 'canary',
                        adapter_revision=self.baseline,
                        accepted_canary=dict(acceptance_basis='runtime_qualification',
                                             attestation={'guard':'old evidence'}),
                        qualification={'grant':{'ceiling':1,'used':1,'rules':'old evidence'}},
                        canary_task_sha256='f'*64,qualified_at=123,
                        modules={'native_guard.py':old['native_guard.py']})
            if key=='cursor_marker': marker['modules']['native_cursor.py']=frozen['native_cursor.py']
            else: marker['modules']['native_antigravity.py']=old['native_antigravity.py']
            raw=json.dumps(marker,indent=2).encode()+b'\n';p.write_bytes(raw)
            self.markers[key]=p;self.marker_raw[key]=raw
        # Inventory lists only currently installed paths (None-preimage absent).
        present={}
        for n,raw in self.before.items():
            if raw is not None: present[str(f.install/n)]=raw
        for n,raw in frozen_raw.items(): present[str(f.install/n)]=raw
        # Retain other Stage5Install helper payload if still present.
        helper=f.p/'helper'
        if helper.exists(): present[str(helper)]=helper.read_bytes()
        record=dict(manifest='original full install manifest',
                    after={p:H(raw) for p,raw in present.items()},
                    before={'old':'history'},targets=['old install'])
        f.inventory.write_text(json.dumps(record,indent=2));f.inventory.chmod(0o600)
        self.inventory=f.inventory.read_bytes()
        self.oldfiles=dict(present)
        v3_old={**U.V3_OLD,'native_guard.py':old['native_guard.py'],
                'native_antigravity.py':old['native_antigravity.py']}
        v3_protocol={**U.V3_PROTOCOL,'native_cursor.py':frozen['native_cursor.py'],
                     'context_exchange.py':frozen['context_exchange.py']}
        for key,val in dict(C5=self.baseline,V4_OLD=old,V4_NEW=new,V4_FROZEN=frozen,
                            V3_OLD=v3_old,V3_PROTOCOL=v3_protocol,V3_MARKERS=self.markers,
                            RULES_SHA256=H(rules),RULES_SIZE=len(rules),
                            RULES_COMMIT=f.rules_commit).items():
            f.stack.enter_context(patch.object(U,key,val))

    def call(self,action):
        f=self.f
        return U.execute(action,f.bundle,f.manifest,self.controller,f.sh,f.dh,123,
                         self.baseline,f.commit,'dev',4)

    def close(self): self.f.tearDown()

    def restored(self,case):
        for p,raw in self.oldfiles.items(): case.assertEqual(Path(p).read_bytes(),raw,p)
        for n,raw in self.before.items():
            if raw is None: case.assertFalse((self.f.install/n).exists(),n)
            else: case.assertEqual((self.f.install/n).read_bytes(),raw,n)
        for key,p in self.markers.items(): case.assertEqual(p.read_bytes(),self.marker_raw[key])
        case.assertEqual(self.f.inventory.read_bytes(),self.inventory)
        case.assertEqual(self.f.policy.read_bytes(),self.policy)


class ProductQaV4Transaction(unittest.TestCase):
    def setUp(self):
        self.x=V4Fixture();self.addCleanup(self.x.close)

    def test_dry_apply_verify_rollback_roundtrip(self):
        x=self.x;before={str(p):p.read_bytes() for p in x.f.p.rglob('*') if p.is_file()}
        r=x.call('dry')
        self.assertTrue(r['dry']);self.assertEqual(r['status'],'PLANNED_PRODUCT_QA_UPGRADE')
        self.assertEqual(before,{str(p):p.read_bytes() for p in x.f.p.rglob('*') if p.is_file()})
        self.assertIn('admission_pm.py',r['changes'])
        self.assertIsNone(r['changes']['admission_pm.py']['before'])
        r=x.call('apply')
        self.assertEqual(r['phase'],'installed-disabled')
        for n,raw in x.after.items():
            self.assertEqual((x.f.install/n).read_bytes(),raw,n)
        self.assertEqual(json.loads(x.f.policy.read_bytes())['mode'],'disabled')
        self.assertEqual(x.call('verify')['verified'],True)
        x.call('rollback');x.restored(self)

    def test_midwrite_interruption_rollback_restores_intent(self):
        x=self.x;atomic=U.atomic_bytes;fired=False
        def crash(p,raw,meta,**kw):
            nonlocal fired
            # Interrupt after first lib write lands, before durable applied append.
            if (not fired and p==x.f.install/'admission_pm.py'):
                fired=True;atomic(p,raw,meta,**kw);raise InterruptedError('midwrite')
            return atomic(p,raw,meta,**kw)
        with patch.object(U,'atomic_bytes',side_effect=crash),self.assertRaises(InterruptedError):
            x.call('apply')
        j=json.loads(x.v4_journal.read_bytes())
        self.assertEqual(j['phase'],'applying')
        self.assertEqual(j['write_intent'],{'action':'apply','target':'admission_pm.py'})
        self.assertTrue((x.f.install/'admission_pm.py').exists())
        x.call('rollback');x.restored(self)
        self.assertFalse((x.f.install/'admission_pm.py').exists())

    def test_stale_live_unknown_checkpoint_refused(self):
        # quiet_v4 resource gate: unmatched live/nonterminal CP fails closed.
        with patch.object(U,'quiet_v4',side_effect=core.Refused('live checkpoint active HOLD: slot1')):
            with self.assertRaisesRegex(core.Refused,'live checkpoint active HOLD'):
                self.x.call('dry')


class ProductQaFinishEvidence(unittest.TestCase):
    def test_parse_stream_exposes_finish_done_not_tool_name(self):
        import sys
        sys.path.insert(0,str(ROOT/'scripts/chatops/actions_train'))
        import native_antigravity as N
        import copy,json,hashlib
        sha='a'*40;cid='synthetic-finish'
        events=[
            {'event':'init','conversation_id':cid,'init':{
                'model':N.MODEL,'agent':N.AGENT,
                'tools':['finish','view_file','run_command'],
                'permission_mode':N.PERMISSION_MODE,'json_schema':copy.deepcopy(N.SCHEMA)}},
            {'event':'step_update','step_update':{'conversation_id':cid,'step_index':0,
                'step_type':'user_input','state':'DONE'}},
            {'event':'step_update','step_update':{'conversation_id':cid,'step_index':1,
                'tool_name':'view_file','step_type':'tool','state':'DONE'}},
            {'event':'step_update','step_update':{'conversation_id':cid,'step_index':2,
                'tool_name':'run_command','step_type':'tool','state':'DONE'}},
            {'event':'step_update','step_update':{'conversation_id':cid,'step_index':3,
                'step_type':'agent_response','state':'DONE'}},
            {'event':'step_update','step_update':{'conversation_id':cid,'step_index':4,
                'step_type':'finish','state':'DONE'}},
            {'event':'result','result':{'conversation_id':cid,'status':'SUCCESS',
                'structured_output':{'verdict':'PASS','findings':[],'reviewed_sha':sha}}}]
        raw=b'\n'.join(json.dumps(e).encode() for e in events)+b'\n'
        result,receipt=N.parse_stream(raw,sha)
        self.assertEqual(result['verdict'],'PASS')
        self.assertEqual(set(receipt['tool_names']),{'view_file','run_command'})
        self.assertNotIn('finish',receipt['tool_names'])
        self.assertTrue(receipt['finish_done'])
        # stage.run_product_qa predicate: tools + finish_done, not finish tool name.
        import inspect
        src=inspect.getsource(__import__('stage',fromlist=['*']).run_product_qa)
        self.assertIn("receipt.get('finish_done') is True",src)
        self.assertNotIn("'finish' in tools",src)


if __name__=='__main__': unittest.main()
