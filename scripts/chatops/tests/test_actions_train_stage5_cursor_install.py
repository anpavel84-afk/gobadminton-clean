"""Stage 5 Cursor context install: fixed targets, ordering gates, rollback; never live writes."""
import copy,hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from test_actions_train import receiver,installer,ROOT,core
spec=importlib.util.spec_from_file_location("stage5_upgrade",ROOT/"scripts/chatops/ops/stage5_cursor_context_upgrade.py")
U=importlib.util.module_from_spec(spec);spec.loader.exec_module(U)
H=lambda b:hashlib.sha256(b).hexdigest()
RULES=b"accepted rules\n"
class Stage5Install(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)
        self.install=self.p/"install";self.state=self.p/"state";self.bundle=self.p/"bundle"
        for d in (self.install,self.state,self.bundle):d.mkdir()
        self.policy=self.state/"policy.json";self.journal=self.state/"stage5-cursor-context.json";self.backup=self.state/"stage5-cursor-context-backup"
        self.baseline="b"*40;self.controller="a"*40
        self.oldpolicy={"mode":"active","controller_sha":self.baseline,"recovery":{"source_sha":self.baseline}}
        self.policy.write_text(json.dumps(self.oldpolicy))
        self.items={};self.oldfiles={}
        policy_src=("RULES_SHA256 = '%s'\nRULES_SIZE = %d\n"%(H(RULES),len(RULES)))
        names={"stage.py","context_cursor_delivery.py","core.py","context_policy.py","native_cursor.py","native_guard.py"}
        for n in names:
            t=self.install/n;s=self.bundle/"scripts/chatops/actions_train"/n;s.parent.mkdir(parents=True,exist_ok=True)
            if n in U.TARGETS:
                s.write_text("after "+n)
                if n=="stage.py":t.write_text("before "+n)
            elif n=="context_policy.py":t.write_text(policy_src);s.write_text(policy_src)
            else:t.write_text("same "+n);s.write_text("same "+n)
            self.items[t]=s
            if t.exists():self.oldfiles[str(t)]=t.read_bytes()
        (self.install/"accepted-engineering-rules.md").write_bytes(RULES);self.oldfiles[str(self.install/"accepted-engineering-rules.md")]=RULES
        canon=self.bundle/U.BUNDLE_RULES;canon.parent.mkdir(parents=True);canon.write_bytes(RULES)
        record={"manifest":"old","after":{k:H(v) for k,v in self.oldfiles.items()}}
        (self.state/"backup.json").write_text(json.dumps(record))
        for f in ("slot1.json","slot2.json","recovery.json"):(self.state/f).write_text('{"history":"immutable"}')
        self.snapshot={str(self.state/f):installer.sha(self.state/f) for f in ("slot1.json","slot2.json","recovery.json")}
        wf=self.bundle/".github/workflows";wf.mkdir(parents=True)
        for f in ("train-stage.yml","train-dispatch.yml"):(wf/f).write_text(("ref: "+self.controller+"\n")*2)
        self.sh=installer.sha(wf/"train-stage.yml");self.dh=installer.sha(wf/"train-dispatch.yml")
        read=lambda path,*a:json.loads(Path(path).read_text())
        def put(source,target,mode):
            target=Path(target)
            if not target.is_relative_to(self.backup):
                self.assertTrue(self.journal.exists());self.assertEqual(read(self.policy)["mode"],"disabled")
            target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(Path(source).read_bytes());target.chmod(mode)
        self.put=put
        self.pins={n:H(("same "+n).encode()) for n in U.FROZEN}
        self.patches=[patch.object(U,"INSTALL",self.install),patch.object(U,"INSTALLED_RULES",self.install/"accepted-engineering-rules.md"),
            patch.object(U,"STATE",self.state),patch.object(U,"JOURNAL",self.journal),patch.object(U,"BACKUP",self.backup),
            patch.object(U,"FROZEN",self.pins),patch.object(U,"quiet"),
            patch.object(U,"preserved",side_effect=lambda:{k:installer.sha(Path(k)) for k in self.snapshot}),patch.object(U.os,"geteuid",return_value=0),
            patch.object(receiver,"POLICY",self.policy),patch.object(receiver,"read",side_effect=read),patch.object(receiver,"trusted_tree"),
            patch.object(receiver,"publish_monitor"),patch.object(installer,"payload",return_value=self.items),patch.object(installer,"put",side_effect=put)]
        for q in self.patches:q.start()
    def tearDown(self):
        for q in reversed(self.patches):q.stop()
        self.tmp.cleanup()
    def call(self,action,baseline=None):
        return U.execute(action,self.bundle,"reviewed",self.controller,self.sh,self.dh,123,baseline or self.baseline)
    def files(self):return {str(q):q.read_bytes() for q in self.p.rglob("*") if q.is_file()}
    def test_dry_zero_effects_apply_rollback_restore_exact_bytes(self):
        before=self.files();r=self.call("dry");self.assertTrue(r["dry"])
        self.assertEqual(set(r["changes"]),{str(self.install/n) for n in U.TARGETS});self.assertEqual(before,self.files())
        self.assertEqual(self.call("apply")["phase"],"installed-disabled")
        self.assertEqual((self.install/"stage.py").read_text(),"after stage.py")
        self.assertEqual(json.loads(self.policy.read_text())["controller_sha"],self.controller)
        self.assertEqual(self.call("rollback")["phase"],"rolled-back")
        for path,raw in self.oldfiles.items():self.assertEqual(Path(path).read_bytes(),raw)
        self.assertFalse((self.install/"context_cursor_delivery.py").exists())
        self.assertEqual({k:installer.sha(Path(k)) for k in self.snapshot},self.snapshot)
        self.assertEqual(json.loads(self.policy.read_text()),self.oldpolicy)
    def test_stale_installed_rules_pin_refused_before_effects(self):  # rules/#304 bump must come first
        (self.install/"accepted-engineering-rules.md").write_bytes(b"old rules")
        (self.state/"backup.json").write_text(json.dumps({"manifest":"old","after":{k:H(Path(k).read_bytes()) for k in self.oldfiles}}))
        before=self.files()
        with self.assertRaises(core.Refused):self.call("apply")
        self.assertEqual(before,self.files())
    def test_extra_pending_bump_or_marker_module_drift_refused(self):
        self.items[self.install/"core.py"].write_text("different core")
        with self.assertRaises(core.Refused):self.call("dry")
        self.items[self.install/"core.py"].write_text("same core.py")
        for n in U.FROZEN:
            self.items[self.install/n].write_text("changed")
            (self.install/n).write_text("changed")
            with self.assertRaises(core.Refused):self.call("dry")
            self.items[self.install/n].write_text("same "+n);(self.install/n).write_text("same "+n)
    def test_wrong_baseline_and_bundle_canon_drift_refused(self):
        with self.assertRaises(core.Refused):self.call("dry","c"*40)
        (self.bundle/U.BUNDLE_RULES).write_bytes(b"other")
        with self.assertRaises(core.Refused):self.call("dry")
    def test_interruption_leaves_disabled_and_rollback_exact(self):
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
    def test_after_activation_no_rollback_and_state_drift_blocks_activation(self):
        self.call("apply")
        q=Path(next(iter(self.snapshot)));q.write_text('{"new":"real state"}')
        with patch.object(U,"probe",return_value={"run":1}):
            with self.assertRaises(core.Refused):self.call("activate")
        with self.assertRaises(core.Refused):self.call("rollback")
        self.assertEqual(q.read_text(),'{"new":"real state"}')
    def test_activation_then_rollback_refused(self):
        self.call("apply")
        with patch.object(U,"probe",return_value={"run":1}):self.assertEqual(self.call("activate")["phase"],"active")
        with self.assertRaises(core.Refused):self.call("rollback")
if __name__=="__main__":unittest.main()
