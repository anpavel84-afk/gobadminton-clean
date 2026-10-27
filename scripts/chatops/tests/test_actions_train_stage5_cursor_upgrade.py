"""V3 synthetic transaction checks; no host state, services or providers."""
import ast
import copy
import json
import os
from pathlib import Path
import stat
import unittest
from unittest.mock import patch
import test_actions_train_stage5_cursor_install as legacy

U, H, core = legacy.U, legacy.H, legacy.core
REAL_QUIET_V3 = U.quiet_v3


class Fixture:
    def __init__(self):
        self.f = f = legacy.Stage5Install()
        f.setUp()
        try:
            self.build()
        except BaseException:
            f.tearDown()
            raise

    def build(self):
        f = self.f
        f.stack.enter_context(patch.object(U.os,'geteuid',return_value=os.getuid()))
        self.before = {n:('old synthetic '+n).encode() if pin else None for n,pin in U.V3_OLD.items()}
        self.after = {n:('new synthetic '+n).encode() for n in U.V3_NEW}
        self.after['context_policy.py'] = f.items[f.install/'context_policy.py'].read_bytes()
        self.after['accepted-engineering-rules.md'] = legacy.RULES
        protocol = {}
        for n in U.V3_PROTOCOL:
            p=f.install/n;p.parent.mkdir(parents=True,exist_ok=True)
            raw=('frozen synthetic '+n).encode();p.write_bytes(raw);protocol[n]=H(raw)
            src=f.bundle/U.PREFIX/n;src.parent.mkdir(parents=True,exist_ok=True);src.write_bytes(raw)
            f.items[p]=src
        for n,raw in self.before.items():
            p=f.install/n
            if raw is None: p.unlink(missing_ok=True)
            else: p.write_bytes(raw)
            if n!='accepted-engineering-rules.md':
                src=f.bundle/U.PREFIX/n;src.parent.mkdir(parents=True,exist_ok=True)
                if raw is not None: src.write_bytes(raw);f.items[p]=src
                else: src.unlink(missing_ok=True);f.items.pop(p,None)
        base_files={str(src.relative_to(f.bundle)):H(src.read_bytes()) for p,src in f.items.items()}
        f.manifest_path.write_text(json.dumps(dict(schema='GB_ACTIONS_TRAIN_INSTALL_V1',files=base_files)))
        f.git('add','.');f.git('commit','-m','Synthetic C5 closure');self.c5=f.git('rev-parse','HEAD')
        self.c5manifest=H(f.manifest_path.read_bytes())
        for n,raw in self.after.items():
            if n=='accepted-engineering-rules.md': continue
            src=f.bundle/U.PREFIX/n;src.write_bytes(raw);f.items[f.install/n]=src
        f.refresh()
        # Candidate has unrelated core/API changes. Full manifest/blob checking
        # remains mandatory, but only frozen installed protocol bytes are used.
        (f.bundle/U.PREFIX/'core.py').write_bytes(b'unrelated prospective protocol')
        f.refresh()
        policy=dict(f.oldpolicy,controller_sha=self.c5,stage_workflow_sha256=f.sh)
        f.policy.write_text(json.dumps(policy,indent=2));self.policy=f.policy.read_bytes()
        old={n:H(raw) if raw is not None else None for n,raw in self.before.items()}
        new={n:H(raw) for n,raw in self.after.items()}
        f.rules.write_bytes(self.before['accepted-engineering-rules.md'])
        self.markers={}
        self.marker_raw={}
        for key in U.V3_MARKERS:
            p=f.p/(key+'.json')
            marker=dict(schema='GB_CURSOR_AUTHOR_211_V1' if key=='cursor_marker' else 'GB_ANTIGRAVITY_QA_29_V1',
                        phase='ready' if key=='cursor_marker' else 'canary',adapter_revision=self.c5,
                        accepted_canary=dict(acceptance_basis='runtime_qualification',attestation={'guard':'old evidence'}),
                        qualification={'grant':{'ceiling':1,'used':1,'rules':'old evidence'}},
                        canary_task_sha256='f'*64,qualified_at=123,
                        modules={'native_guard.py':old['native_guard.py']})
            if key=='cursor_marker': marker['modules']['native_cursor.py']=protocol['native_cursor.py']
            else: marker['modules']['native_antigravity.py']=old['native_antigravity.py']
            raw=json.dumps(marker,indent=2).encode()+b'\n';p.write_bytes(raw)
            self.markers[key]=p;self.marker_raw[key]=raw
        self.oldfiles={str(p):p.read_bytes() for p in f.items if p.exists()}
        self.oldfiles[str(f.rules)]=f.rules.read_bytes()
        record=dict(manifest='original full install manifest',after={p:H(raw) for p,raw in self.oldfiles.items()},
                    before={'old':'history'},targets=['old install'])
        f.inventory.write_text(json.dumps(record,indent=2));self.inventory=f.inventory.read_bytes()
        observed={**{n:H(raw) for n,raw in self.marker_raw.items()},'policy':H(self.policy),'inventory':H(self.inventory)}
        for key,val in dict(C5=self.c5,C5_MANIFEST=self.c5manifest,C5_WORKFLOWS=(f.sh,f.dh),
                            V3_OLD=old,V3_NEW=new,V3_PROTOCOL=protocol,V3_MARKERS=self.markers,V3_OBSERVED=observed).items():
            f.stack.enter_context(patch.object(U,key,val))
        f.stack.enter_context(patch.object(U,'quiet_v3'))
        self.initial=self.files()

    def call(self,action):
        f=self.f
        return U.execute(action,f.bundle,f.manifest,self.c5,f.sh,f.dh,123,self.c5,f.commit,'dev',3)

    def files(self): return self.f.files()
    def close(self): self.f.tearDown()
    def restored(self,case):
        for p,raw in self.oldfiles.items(): case.assertEqual(Path(p).read_bytes(),raw,p)
        for n,raw in self.before.items():
            if raw is None: case.assertFalse((self.f.install/n).exists(),n)
        for key,p in self.markers.items(): case.assertEqual(p.read_bytes(),self.marker_raw[key])
        case.assertEqual(self.f.inventory.read_bytes(),self.inventory)
        case.assertEqual(self.f.policy.read_bytes(),self.policy)


class V3Transaction(unittest.TestCase):
    def setUp(self): self.x=Fixture();self.addCleanup(self.x.close)

    def test_dry_exact_scope_and_zero_writes_then_inverse(self):
        x=self.x;before=x.files();r=x.call('dry')
        self.assertEqual(before,x.files());self.assertEqual(r['protected_writes'],0)
        self.assertEqual(set(r['changes']),set(U.V3_OLD)|set(U.V3_MARKERS)|{'inventory'})
        snap=U.v3_preserved();r=x.call('apply')
        self.assertEqual(r['status'],'RUNTIME_INSTALLED');self.assertFalse(r['role_qualified']);self.assertFalse(r['ready'])
        self.assertEqual(U.v3_preserved(),snap)
        for n,raw in x.after.items(): self.assertEqual((x.f.install/n).read_bytes(),raw)
        for key,p in x.markers.items():
            before=json.loads(x.marker_raw[key]);after=json.loads(p.read_bytes())
            for n in after['modules']:
                if n in U.V3_NEW: before['modules'][n]=U.V3_NEW[n]
            self.assertEqual(before,after)
            span=lambda raw:raw[:raw.index(b'"modules"')]
            self.assertEqual(span(p.read_bytes()),span(x.marker_raw[key]))
        inventory=json.loads(x.inventory)
        for n in U.V3_OLD: inventory['after'][str(x.f.install/n)]=U.V3_NEW[n]
        self.assertEqual(json.loads(x.f.inventory.read_bytes()),inventory)
        after=x.files();self.assertTrue(x.call('apply')['noop']);self.assertEqual(after,x.files())
        self.assertEqual(x.call('verify')['status'],'RUNTIME_INSTALLED')
        x.call('rollback');x.restored(self)
        after=x.files();self.assertTrue(x.call('rollback')['noop']);self.assertEqual(after,x.files())

    def test_frozen_closure_and_module_cas_foreign_drift(self):
        x=self.x
        for n in ('core.py','context_exchange.py','cost_policy.py','native_cursor.py','receiver.py'):
            p=x.f.install/n;raw=p.read_bytes();p.write_bytes(b'foreign protocol');before=x.files()
            with self.subTest(n=n),self.assertRaisesRegex(core.Refused,'frozen protocol'): x.call('dry')
            self.assertEqual(before,x.files());p.write_bytes(raw)
        p=x.f.install/'native_antigravity_author.py';p.write_bytes(b'feature outside scope')
        with self.assertRaisesRegex(core.Refused,'unqualified AGY'): x.call('dry')
        p.unlink();x.call('apply');p=x.f.install/'stage.py';p.write_bytes(b'foreign CAS');before=x.files()
        for action in ('dry','apply','verify','activate','rollback'):
            with self.subTest(action=action),self.assertRaises(core.Refused): x.call(action)
            self.assertEqual(before,x.files())

    def test_both_marker_baselines_and_histories_are_bound(self):
        x=self.x
        for key,p in x.markers.items():
            raw=p.read_bytes();m=json.loads(raw);m['qualification']['grant']['ceiling']=5;p.write_text(json.dumps(m))
            with self.subTest(marker=key),self.assertRaisesRegex(core.Refused,'marker drift'): x.call('dry')
            p.write_bytes(raw)
        x.call('apply');x.f.budget.write_bytes(b'foreign budget');before=x.files()
        with self.assertRaisesRegex(core.Refused,'history/closure drift'): x.call('rollback')
        self.assertEqual(before,x.files())

    def test_candidate_dependency_pin_and_exact_journal_schema(self):
        x=self.x;src=x.f.bundle/U.PREFIX/'stage.py';src.write_bytes(b'changed target outside reviewed closure');x.f.refresh()
        with self.assertRaisesRegex(core.Refused,'dependency closure not proven'): x.call('apply')
        src.write_bytes(x.after['stage.py']);x.f.refresh();x.call('apply')
        original=x.f.journal.read_bytes()
        variants=[]
        for field,value in (('schema',U.SCHEMA),('phase','ready'),('applied',[]),('write_intent',{'action':'apply','target':'outside'})):
            j=json.loads(original);j[field]=value;variants.append(j)
        j=json.loads(original);j['changes']['outside']=j['changes']['stage.py'];variants.append(j)
        for j in variants:
            x.f.journal.write_text(json.dumps(j));before=x.files()
            with self.subTest(j=j['phase']),self.assertRaises(core.Refused): x.call('rollback')
            self.assertEqual(before,x.files())
        x.f.journal.write_bytes(original);x.call('rollback')

    def test_activation_hosted_proof_only_and_legacy_never_overwritten(self):
        x=self.x;x.f.journal.write_text('{"schema":"'+U.SCHEMA+'"}');before=x.files()
        with self.assertRaisesRegex(core.Refused,'separate reconciliation'): x.call('apply')
        self.assertEqual(before,x.files());x.f.journal.unlink();x.call('apply')
        with patch.object(U,'probe',return_value={'run':123}): r=x.call('activate')
        self.assertFalse(r['context_qualified']);self.assertFalse(r['role_qualified']);self.assertFalse(r['ready'])
        self.assertEqual(x.f.policy.read_bytes(),x.policy)
        with self.assertRaisesRegex(core.Refused,'post-proof'): x.call('rollback')

    def test_metadata_owner_modes_and_parent_cas(self):
        x=self.x;p=x.f.install/'stage.py';p.chmod(0o600)
        with self.assertRaisesRegex(core.Refused,'metadata drift'): x.call('dry')
        p.chmod(0o644);before=x.files()
        with patch.object(U,'OWNER_UID',os.getuid()+1),self.assertRaises(core.Refused): x.call('dry')
        self.assertEqual(before,x.files())
        # CAS is checked again after temp fsync, before rename.
        p=x.f.p/'cas';p.write_bytes(b'old');meta=U.read_file(p)[1]
        with self.assertRaisesRegex(core.Refused,'compare-and-swap'):
            U.atomic_bytes(p,b'new',meta,expected=dict(meta,sha256='0'*64))
        self.assertEqual(p.read_bytes(),b'old')

    def test_every_apply_and_rollback_write_boundary(self):
        # 1 journal + 8 backups + phase + 10*(intent/write/progress) + final =41.
        # Measure the actual finite boundary count instead of guessing it.
        x=self.x;calls=[];atomic=U.atomic_bytes
        def record(p,raw,meta,**kw): calls.append(str(p));return atomic(p,raw,meta,**kw)
        with patch.object(U,'atomic_bytes',side_effect=record): x.call('apply')
        apply_count=len(calls);calls.clear()
        with patch.object(U,'atomic_bytes',side_effect=record): x.call('rollback')
        rollback_count=len(calls)
        self.assertGreater(apply_count,30);self.assertGreater(rollback_count,20)
        for action,count in (('apply',apply_count),('rollback',rollback_count)):
            for boundary in range(1,count+1):
                for timing in ('before','after'):
                    with self.subTest(action=action,boundary=boundary,timing=timing):
                        f=Fixture()
                        try:
                            if action=='rollback': f.call('apply')
                            number=0
                            def crash(p,raw,meta,**kw):
                                nonlocal number
                                number+=1
                                if number==boundary and timing=='before': raise InterruptedError('synthetic write interruption')
                                result=atomic(p,raw,meta,**kw)
                                if number==boundary and timing=='after': raise InterruptedError('synthetic write interruption')
                                return result
                            with patch.object(U,'atomic_bytes',side_effect=crash),self.assertRaises(InterruptedError): f.call(action)
                            if not f.f.journal.exists(): self.assertFalse(f.f.backup.exists());f.call('apply')
                            else:
                                phase=json.loads(f.f.journal.read_bytes())['phase']
                                if phase not in ('installed-lib-only','rolled-back'):
                                    with self.assertRaises(core.Refused): f.call('apply')
                            f.call('rollback');f.restored(self)
                        finally: f.close()


if __name__=='__main__': unittest.main()
