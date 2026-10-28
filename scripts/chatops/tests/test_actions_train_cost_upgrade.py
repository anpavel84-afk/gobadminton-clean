"""OPS211 fixed-target install/rollback/interruption fixtures; never live writes."""
import copy,hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
from test_actions_train import receiver,installer,ROOT,core
spec=importlib.util.spec_from_file_location("cost_upgrade",ROOT/"scripts/chatops/ops/cost_policy_upgrade.py")
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
class Upgrade(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)
        self.install=self.p/"install";self.state=self.p/"state";self.bundle=self.p/"bundle";self.budget=self.p/"budgets.json";self.app=self.p/"app.js"
        self.state.mkdir();self.install.mkdir();self.bundle.mkdir()
        self.policy=self.state/"policy.json";self.journal=self.state/"cost-policy-211.json";self.backup=self.state/"cost-policy-211-backup"
        self.oldpolicy={"mode":"active","controller_sha":U.OLD_CONTROLLER,"recovery":{"source_sha":U.OLD_CONTROLLER}}
        self.policy.write_text(json.dumps(self.oldpolicy));self.budget.write_text('{"old":30}')
        self.items={};self.oldfiles={}
        for suffix in U.ALLOWED:
            target=self.install/suffix;target.parent.mkdir(parents=True,exist_ok=True)
            if suffix!="cost_policy.py":target.write_text("before "+suffix);self.oldfiles[str(target)]=target.read_bytes()
            source=self.bundle/suffix;source.parent.mkdir(parents=True,exist_ok=True);source.write_text("after "+suffix);self.items[target]=source
        self.app.write_text("before app");s=self.bundle/"app.js";s.write_text("after app");self.items[self.app]=s;self.oldfiles[str(self.app)]=self.app.read_bytes()
        self.oldfiles[str(self.budget)]=self.budget.read_bytes()
        record={"manifest":"oldmanifest","after":{k:hashlib.sha256(v).hexdigest() for k,v in self.oldfiles.items() if k!=str(self.budget)}}
        (self.state/"backup.json").write_text(json.dumps(record))
        for f in ("slot1.json","slot2.json","recovery.json"):(self.state/f).write_text('{"history":"immutable"}')
        self.snapshot={str(self.state/f):installer.sha(self.state/f) for f in ("slot1.json","slot2.json","recovery.json")}
        budgetsource=self.bundle/"scripts/chatops/ops/budgets-unlimited.json";budgetsource.parent.mkdir(parents=True)
        budgetsource.write_text(json.dumps({"schema":1,"providers":{"codex":{"author":"unlimited","qa":"unlimited"}},"slots":{s:{"codex":{"author":"unlimited","qa":"unlimited"}} for s in ("slot1","slot2")}}))
        wf=self.bundle/".github/workflows";wf.mkdir(parents=True)
        self.controller="a"*40
        for f in ("train-stage.yml","train-dispatch.yml"):(wf/f).write_text(("ref: "+self.controller+"\n")*2)
        self.stagehash=installer.sha(wf/"train-stage.yml");self.dispatchhash=installer.sha(wf/"train-dispatch.yml")
        def read(path,*args):return json.loads(Path(path).read_text())
        def put(source,target,mode):
            target=Path(target)
            if not target.is_relative_to(self.backup):
                self.assertTrue(self.journal.exists())
                self.assertEqual(read(self.policy)["mode"],"disabled")
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(source).read_bytes());target.chmod(mode)
        self.put=put
        self.patches=[patch.object(U,"INSTALL",self.install),patch.object(U,"STATE",self.state),patch.object(U,"JOURNAL",self.journal),patch.object(U,"BACKUP",self.backup),patch.object(U,"BUDGET",self.budget),patch.object(U,"APP",self.app),
            patch.object(U,"OLD_BUDGET",installer.sha(self.budget)),patch.object(U,"quiet"),patch.object(U,"preserved",side_effect=lambda:{k:installer.sha(Path(k)) for k in self.snapshot}),patch.object(U.os,"geteuid",return_value=0),
            patch.object(receiver,"POLICY",self.policy),patch.object(receiver,"read",side_effect=read),patch.object(receiver,"trusted_tree"),patch.object(receiver,"publish_monitor"),patch.object(installer,"payload",return_value=self.items),patch.object(installer,"put",side_effect=put)]
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.tmp.cleanup()
    def call(self,action):return U.execute(action,self.bundle,"reviewed",self.controller,self.stagehash,self.dispatchhash,123)
    def test_dry_has_zero_effects_apply_and_rollback_keep_all_authoritative_bytes(self):
        before={str(p):p.read_bytes() for p in self.p.rglob("*") if p.is_file()}
        self.assertTrue(self.call("dry")["dry"])
        self.assertEqual(before,{str(p):p.read_bytes() for p in self.p.rglob("*") if p.is_file()})
        self.assertEqual(self.call("apply")["phase"],"installed-disabled")
        self.assertEqual(json.loads(self.budget.read_text())["providers"]["codex"]["qa"],"unlimited")
        self.assertEqual({k:installer.sha(Path(k)) for k in self.snapshot},self.snapshot)
        self.assertEqual(self.call("rollback")["phase"],"rolled-back")
        for path,raw in self.oldfiles.items():self.assertEqual(Path(path).read_bytes(),raw)
        self.assertFalse((self.install/"cost_policy.py").exists())
    def test_interruption_leaves_disabled_and_exact_backups_allow_rollback(self):
        n=[0]
        def stopped(source,target,mode):
            if not Path(target).is_relative_to(self.backup):
                n[0]+=1
                if n[0]==2:raise RuntimeError("simulated power loss")
            self.put(source,target,mode)
        with patch.object(installer,"put",side_effect=stopped):
            with self.assertRaises(RuntimeError):self.call("apply")
        self.assertEqual(json.loads(self.policy.read_text())["mode"],"disabled")
        self.assertEqual(json.loads(self.journal.read_text())["phase"],"applying")
        self.call("rollback")
        for path,raw in self.oldfiles.items():self.assertEqual(Path(path).read_bytes(),raw)
    def test_after_activation_no_rollback_or_state_rewind(self):
        self.call("apply")
        with patch.object(U,"probe",return_value={"run":123}):self.assertEqual(self.call("activate")["phase"],"active")
        with self.assertRaises(core.Refused):self.call("rollback")
    def test_state_drift_blocks_activation_never_overwrites_checkpoint(self):
        self.call("apply");p=Path(next(iter(self.snapshot)));p.write_text('{"new":"real state"}')
        with patch.object(U,"probe",return_value={"run":123}):
            with self.assertRaises(core.Refused):self.call("activate")
        with self.assertRaises(core.Refused):self.call("rollback")
        self.assertEqual(p.read_text(),'{"new":"real state"}')
    def test_foreign_code_or_workflow_drift_refused_before_disable(self):
        (self.install/"core.py").write_text("foreign")
        with self.assertRaises(core.Refused):self.call("dry")
        self.assertFalse(self.journal.exists());self.assertEqual(json.loads(self.policy.read_text())["mode"],"active")
if __name__=="__main__":unittest.main()
