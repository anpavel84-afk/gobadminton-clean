"""Root upgrade subset in isolated temp roots; no real OPS/system access."""
from contextlib import ExitStack
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from test_actions_train import ROOT, core

spec = importlib.util.spec_from_file_location('agy_author_upgrade_fixture',ROOT/'scripts/chatops/ops/antigravity_author_upgrade.py')
U = importlib.util.module_from_spec(spec); spec.loader.exec_module(U)


class Upgrade(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='agy-upgrade-fixture-'); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.install = self.root/'installed'; self.config = self.root/'config'; self.state = self.root/'state'
        self.autonomy = self.root/'autonomy'; self.bundle = self.root/'bundle'
        source = self.bundle/'scripts/chatops/actions_train'; source.mkdir(parents=True)
        for p in (self.install,self.config,self.state,self.autonomy/'slots',self.autonomy/'outbox'): p.mkdir(parents=True)
        self.baseline = 'c'*40; self.task_hash = 'a'*64
        for name in set(U.FILES)|set(U.PINS):
            (source/name).write_bytes((ROOT/'scripts/chatops/actions_train'/name).read_bytes())
            if name != 'native_antigravity_author.py':
                (self.install/name).write_bytes((source/name).read_bytes() if name in U.PINS else ('baseline '+name).encode())
        manifest = dict(schema='GB_ACTIONS_TRAIN_INSTALL_V1',files={
            'scripts/chatops/actions_train/'+p.name:U.sha(p.read_bytes()) for p in source.iterdir()})
        self.manifest_path = source/'manifest.json'; self.manifest_path.write_bytes(U.encoded(manifest))
        self.manifest = U.sha(self.manifest_path.read_bytes())
        self.policy = self.config/'policy.json'
        self.policy.write_text(json.dumps(dict(mode='disabled',controller_sha=self.baseline),indent=3)+'\n')
        (self.config/'antigravity-qa.json').write_text(json.dumps(dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase='canary',
            modules={n:U.sha((self.install/n).read_bytes()) for n in ('native_antigravity.py','native_guard.py')}),indent=2)+'\n')
        (self.config/'cursor-author.json').write_bytes(b'{"unchanged": "cursor marker"}\n')
        self.budget = b'{\n "schema":1, "providers":{"agy":{ "qa":2 }, "codex":{"author":null}},\n "slots":{"slot1":{"codex":{"qa":null}},"slot2":{"agy":{"qa":2}}}\n}\n'
        (self.config/'budgets.json').write_bytes(self.budget)
        (self.state/'backup.json').write_text(json.dumps(dict(after={str(self.install/n):U.sha((self.install/n).read_bytes())
            for n in U.FILES if n != 'native_antigravity_author.py'})))
        (self.state/'slot2.json').write_bytes(b'{"operations":{"old":{"status":"unknown"}}}\n')
        for slot in ('slot1','slot2'):
            p = self.autonomy/'outbox'/slot; p.mkdir()
            (p/'ledger.json').write_bytes(b'{ "old-day": {"agy": {"qa":1}} }\n')
        self.initial = self.files()
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        def trust(path): self.assertTrue(path.is_relative_to(self.root),str(path))
        def read(path,*a,**k): trust(path); return json.loads(path.read_bytes())
        self.stack.enter_context(patch.multiple(U,INSTALL=self.install,CONFIG=self.config,STATE=self.state,
            JOURNAL=self.state/'upgrade.json',BACKUP=self.state/'upgrade-backup'))
        self.stack.enter_context(patch.object(U.r,'POLICY',self.policy))
        self.stack.enter_context(patch.object(U.r,'AUTONOMY',self.autonomy))
        self.stack.enter_context(patch.object(U.r,'trusted_tree',side_effect=trust))
        self.stack.enter_context(patch.object(U.r,'read',side_effect=read))
        self.stack.enter_context(patch.object(U.os,'geteuid',return_value=0))
        self.stack.enter_context(patch.object(U.r,'units_quiet'))
        self.journal = self.stack.enter_context(patch.object(U.r,'journal',return_value={'pending':None,'operations':{}}))
        self.checkpoint = self.stack.enter_context(patch.object(U.r,'checkpoint',return_value=({'active':None},[])))
        self.stack.enter_context(patch.object(U.i,'safe_state'))
        self.stack.enter_context(patch.object(U.r,'recovery_journal',return_value={'receipts':{}}))

    def files(self):
        return {str(p.relative_to(self.root)):p.read_bytes() for p in self.root.rglob('*') if p.is_file()}

    def call(self,action='dry',**kw):
        return U.execute(action,self.bundle,self.manifest,kw.get('base',self.baseline),self.task_hash,kw.get('calls',1))

    def test_dry_writes_nothing(self):
        result = self.call(); self.assertTrue(result['dry']); self.assertEqual(result['qa_pins'],'match')
        self.assertEqual(self.files(),self.initial)

    def test_apply_verify_rollback_restores_exact_bytes(self):
        result = self.call('apply'); self.assertEqual(result['phase'],'installed-canary-disabled')
        self.assertTrue(self.call('verify')['verified'])
        marker = json.loads((self.config/'antigravity-author.json').read_bytes())
        self.assertEqual(marker['phase'],'canary'); self.assertEqual(marker['executor_uid'],978)
        self.assertEqual(marker['canary_task_sha256'],self.task_hash)
        for n,h in marker['modules'].items(): self.assertEqual(h,U.sha((self.install/n).read_bytes()))
        budget = (self.config/'budgets.json').read_bytes()
        # Removing ONLY the insertions restores every original byte.
        self.assertEqual(budget.replace(b',"author":1',b''),self.budget)
        parsed = json.loads(budget)
        self.assertEqual(parsed['providers']['agy'],{'qa':2,'author':1})
        self.assertEqual(parsed['slots']['slot2']['agy'],{'qa':2,'author':1})
        self.assertNotIn('agy',parsed['slots']['slot1'])
        self.assertIsNone(parsed['providers']['codex']['author'])
        for name,raw in self.initial.items():
            if name.startswith('autonomy/') or name.startswith('state/') or name in ('config/policy.json','config/antigravity-qa.json','config/cursor-author.json'):
                self.assertEqual((self.root/name).read_bytes(),raw,name)
        self.assertEqual(self.call('rollback')['phase'],'rolled-back-disabled')
        for name,raw in self.initial.items(): self.assertEqual((self.root/name).read_bytes(),raw,name)
        self.assertFalse((self.install/'native_antigravity_author.py').exists())
        self.assertFalse((self.config/'antigravity-author.json').exists())

    def test_budget_absent_slot2_agy_adds_only_new_author(self):
        raw = b'{"schema":1,"providers":{"agy":{"qa":2}},"slots":{"slot1":{},"slot2":{}}}'
        result = U.budget_extension(raw,3)
        parsed = json.loads(result)
        self.assertEqual(parsed['slots']['slot2'],{'agy':{'author':3}})
        self.assertEqual(parsed['slots']['slot1'],{})
        self.assertNotIn('qa',parsed['slots']['slot2']['agy'])

    def test_unknown_and_existing_budget_or_invalid_calls_not_rewritten(self):
        for calls in (None,True,0,-1,10001):
            with self.subTest(calls=calls),self.assertRaises(core.Refused): U.budget_extension(self.budget,calls)
        for raw in (self.budget.replace(b'"qa":2',b'"qa":null',1),
                    self.budget.replace(b'"qa":2',b'"qa":2,"author":null',1)):
            with self.assertRaises(core.Refused): U.budget_extension(raw,1)
        self.assertEqual((self.config/'budgets.json').read_bytes(),self.budget)

    def test_active_pending_unknown_or_checkpoint_refused(self):
        for journal in ({'pending':'x','operations':{}},{'pending':None,'operations':{'x':{'finished_at':None}}}):
            self.journal.return_value = journal
            with self.assertRaises(core.Refused): self.call('apply')
        self.journal.return_value = {'pending':None,'operations':{}}
        self.checkpoint.return_value = ({'active':{'phase':'candidate'}},[])
        with self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual(self.files(),self.initial)

    def test_stale_qa_pins_are_reported_not_rewritten(self):
        path = self.config/'antigravity-qa.json'; marker = json.loads(path.read_bytes())
        marker['modules']['native_antigravity.py'] = 'stale'; path.write_bytes(U.encoded(marker))
        original = self.files()
        with self.assertRaisesRegex(core.Refused,'QA marker pins stale'): self.call('apply')
        self.assertEqual(self.files(),original)

    def test_manifest_and_installed_base_drift_refused(self):
        path = self.bundle/'scripts/chatops/actions_train/core.py'; path.write_bytes(b'drift')
        with self.assertRaisesRegex(core.Refused,'manifest hash drift'): self.call('apply')
        self.assertFalse(U.JOURNAL.exists())
        path.write_bytes((ROOT/'scripts/chatops/actions_train/core.py').read_bytes())
        (self.install/'core.py').write_bytes(b'foreign base')
        with self.assertRaisesRegex(core.Refused,'base controller file drift'): self.call('apply')
        self.assertFalse(U.JOURNAL.exists())

    def test_wrong_base_or_root_identity_refused(self):
        with self.assertRaises(core.Refused): self.call('apply',base='f'*40)
        with patch.object(U.os,'geteuid',return_value=978), self.assertRaises(core.Refused): self.call('apply')
        self.assertEqual(self.files(),self.initial)

    def test_rollback_never_rewinds_changed_history_or_foreign_code(self):
        self.call('apply')
        ledger = self.autonomy/'outbox/slot2/ledger.json'; ledger.write_bytes(b'new history')
        with self.assertRaisesRegex(core.Refused,'history changed'): self.call('rollback')
        ledger.write_bytes(self.initial['autonomy/outbox/slot2/ledger.json'])
        (self.install/'core.py').write_bytes(b'foreign code')
        with self.assertRaisesRegex(core.Refused,'foreign target drift'): self.call('rollback')
        self.assertEqual((self.install/'core.py').read_bytes(),b'foreign code')

    def test_write_allowlist_has_no_policy_qa_cursor_ledger_or_prod_path(self):
        for path in (self.policy,self.config/'antigravity-qa.json',self.config/'cursor-author.json',
                     self.autonomy/'outbox/slot2/ledger.json',self.root/'prod'):
            with self.assertRaises(core.Refused): U.put(path,b'unwanted')
        self.assertEqual(self.files(),self.initial)


if __name__ == '__main__': unittest.main()
