"""Hermetic UNKNOWN116 author checks. Facts are a checked-in observation subset, never live/evidence-dir reads.
Fake-root pattern follows test_actions_train_inventory_rerecord.py; all scratch files require TMPDIR.
"""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / 'actions_train'))
from core import digest, need, Refused
SCRIPT = Path(os.environ.get('UNKNOWN116_TEST_SCRIPT', str(BASE / 'ops/agy29_unknown116_reconcile.py')))
# No installed/live receiver import; module loading itself touches no protected path.
bootstrap = SimpleNamespace(STATE=Path('/synthetic/state'), AUTONOMY=Path('/synthetic/autonomy'),
                            POLICY=Path('/synthetic/policy'), BUDGET=Path('/synthetic/budgets.json'))
spec = importlib.util.spec_from_file_location('unknown116_under_test', SCRIPT)
I = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, receiver=bootstrap):
    spec.loader.exec_module(I)

FACTS = json.loads(r'''
{
  "op_value": {
    "after": "6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb",
    "before": "6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb",
    "binding": {
      "action": "train",
      "attempt": 0,
      "generation": 115,
      "head": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
      "issue": 29,
      "phase": "idle",
      "profile": "agy",
      "slot": "slot2",
      "stage": "qa_qualification"
    },
    "checkpoint_before": {
      "active": null,
      "done": [
        152,
        205,
        216
      ]
    },
    "finished_at": 1793014827,
    "process": {
      "boot": "447e18ce-024d-4230-b88f-bd8ca81e2a9e",
      "pid": 427156,
      "start": "66868215"
    },
    "qa_qualification": {
      "adapter_revision": "41e12be2d551158e97ea30eaf8e95f992f998615",
      "base": "b0e4d233bc150f42ada86c4c0f56897c57e0d0fe",
      "head": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
      "issue": 29,
      "qualification_grant": {
        "base": "b0e4d233bc150f42ada86c4c0f56897c57e0d0fe",
        "ceiling": 1,
        "cli_sha256": "8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c",
        "controller_revision": "41e12be2d551158e97ea30eaf8e95f992f998615",
        "head": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
        "input_path": "scripts/chatops/tests/fixtures/agy-236-independent-qa-12f35ac.json",
        "input_revision": "6a53099160f0ae7312f6d282b061c5230e7d2536",
        "input_sha256": "c1672961885bea637d1ff21ffd05accc73837fe669e853f4b911d9f7ad7dcee9",
        "input_transport": "stream-json",
        "lineage": "owner-6362661117-agy29-218",
        "max_output_bytes": 4194304,
        "owner_comment": 6404499964,
        "permission_mode": "always-proceed",
        "role": "independent_qa",
        "rules_sha256": "017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269",
        "schema": "GB_AGY_29_ADDRESSED_CALL_V1",
        "timeout": 1800
      },
      "task_sha256": "67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c",
      "work": "/srv/gb-slots/slot2/worktrees/antigravity-qa-29-canary"
    },
    "result": {
      "adapter_error": {
        "code": "AGY_INPUT_LIMIT",
        "detail": "QA input 466131 bytes exceeds 262144 byte limit after rules inject; refusing before model call; no charge; not truncated; whole-file boundary scripts/chatops/ops/antigravity_addressed_upgrade.py; files=37; diff_bytes=314931",
        "evidence_id": "103b4acb54f64becb4c1e12c02f8aa38",
        "phase": "source"
      },
      "checkpoint": null,
      "reason": "AGY_INPUT_LIMIT",
      "safe_release": false,
      "status": "unknown"
    },
    "run": 40316758633,
    "run_attempt": 1,
    "started_at": 1793014818,
    "task_hash": "67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c"
  },
  "pending": "36aec3485a221a0c61fe84941877b15d57c8a07efbc8e081e20c478e61dcc210",
  "generation": 115,
  "journal_sha": "8cf51b070574c5acd5c829031561ecd3149eabf7bfb575539d4a025348078e47",
  "journal_stat": [
    "0o100600",
    0,
    0
  ],
  "journal_keys": [
    "confirmed",
    "deferred",
    "generation",
    "last",
    "operations",
    "pending",
    "profiles",
    "stage_counts"
  ],
  "slot_state": {
    "active": null,
    "done": [
      152,
      205,
      216
    ]
  },
  "ophash": "4a5ec86f26263346b407757d3603428f788b6b1fdab210f505a4c7704da8663e",
  "checkpoint_digest": "6b5c9fab7fe8c73a9164d2fe7a1731232bfeb80cbf78746ab09a9b5e57e6b4eb",
  "policy": {
    "meta": [
      "0o644",
      0,
      0,
      1
    ],
    "sha": "52250df8b6391b46fe4b80f6805c27e89d06a1c493ca27002b187b1f1f7567d4",
    "value": {
      "codex": {
        "slot1": "/home/agentagency-dev/.local/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex",
        "slot2": "/opt/gb-slots/runtime/codex"
      },
      "controller_sha": "41e12be2d551158e97ea30eaf8e95f992f998615",
      "mode": "active",
      "owned": {
        "slot1": "4356548381f4fee524829e7d300eee41a448915f6d2be6ffae2c9b03cfa0fab0",
        "slot2": "8b97f155e05212f0301afed9243b7b9e8b6f6d17e917d2a1b901656f4d43af8b"
      },
      "recovery": {
        "active_successors": {
          "149": 177,
          "170": 178
        },
        "base_sha": "705db4860f3378253fe33652569ecd4664294de1",
        "delegation_issue": 185,
        "deployment": "owner185-20261022-v1",
        "enabled": true,
        "enrolled": {
          "177": "451e227617eebad86bc8f544f2546b90a746212953b9a5fe97bb7c0e01680f0d"
        },
        "excluded": [
          149,
          170,
          156
        ],
        "future_deferrals": true,
        "lineages": {
          "177": [
            149,
            177
          ],
          "178": [
            170,
            178
          ]
        },
        "schema": "GB_RECOVERY_185_V1",
        "source_sha": "41e12be2d551158e97ea30eaf8e95f992f998615"
      },
      "schema": "GB_ACTIONS_TRAIN_POLICY_V1",
      "stage_workflow_sha256": "b9703ca27b7bb3f494f379f8e259e62a6a48bc8f5ff50c6923e1712d8899d68d"
    }
  },
  "phases": {
    "phase-01.json": {
      "adapter_sha256": "01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72",
      "base_sha": "b0e4d233bc150f42ada86c4c0f56897c57e0d0fe",
      "charge_state": "not_charged",
      "evidence_id": "103b4acb54f64becb4c1e12c02f8aa38",
      "exit_code": null,
      "input_sha256": null,
      "phase": "preflight",
      "rules_sha256": null,
      "schema": "GB_AGY_PRIVATE_EVIDENCE_V1",
      "source_sha": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
      "task_sha256": "67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c",
      "terminal": false,
      "timeout": false
    },
    "phase-02.json": {
      "adapter_sha256": "01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72",
      "base_sha": "b0e4d233bc150f42ada86c4c0f56897c57e0d0fe",
      "charge_state": "not_charged",
      "evidence_id": "103b4acb54f64becb4c1e12c02f8aa38",
      "exit_code": null,
      "input_sha256": null,
      "phase": "preflight",
      "requested_model": "claude-sonnet-5-5-medium",
      "rules_sha256": null,
      "schema": "GB_AGY_PRIVATE_EVIDENCE_V1",
      "source_sha": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
      "task_sha256": "67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c",
      "terminal": false,
      "timeout": false
    },
    "phase-03.json": {
      "adapter_sha256": "01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72",
      "base_sha": "b0e4d233bc150f42ada86c4c0f56897c57e0d0fe",
      "charge_state": "not_charged",
      "error_code": "AGY_INPUT_LIMIT",
      "evidence_id": "103b4acb54f64becb4c1e12c02f8aa38",
      "exit_code": null,
      "input_sha256": null,
      "phase": "source",
      "refusal": "QA input 466131 bytes exceeds 262144 byte limit after rules inject; refusing before model call; no charge; not truncated; whole-file boundary scripts/chatops/ops/antigravity_addressed_upgrade.py; files=37; diff_bytes=314931",
      "requested_model": "claude-sonnet-5-5-medium",
      "rules_sha256": null,
      "schema": "GB_AGY_PRIVATE_EVIDENCE_V1",
      "source_sha": "12f35ac4430348ae811cf712d9bb24d2a19b62e6",
      "status": "unknown",
      "task_sha256": "67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c",
      "terminal": true,
      "timeout": false
    }
  },
  "evidence": {
    "phase-01.json": "ef56bedb5d58b4ff433f76833b8d50ced614a774fa1066516180ad035dbb36fc",
    "phase-02.json": "07248ba10f8dbaad330d7875a7ac16b771f91a675331f7a6bbcce48022fcc69d",
    "phase-03.json": "642033e982c8b8835354de9cc666058f4083eee479ac37bcc87b8562717bb973"
  },
  "reservation": {
    "antigravity-29-addressed-67459c812560ba072cede2b6a8b4ad22cfa2a6190a1b7ee55b9567ef40d3138c.json": "ac3aa10366882cd9b8d25edebc9b1f30f316de9dd16fb44d9128f6ef568016f7"
  },
  "charges_mentioning": {
    "antigravity-29-addressed-charge-ae8d648efeee945f60cb25e0ea2bc646ca0cfdf4405379f8af3032f79d9e8ac6.json": "699660fdfd3fcf3337fdaa1018e3e6a841af800dd4986251eed70ea8cd4bbba8"
  },
  "ledger": {
    "antigravity-29-addressed-ledger.json": "6b49d7a03bdb96182eae23ab18b4b8afa645aa35baf84ae90b6ff9b567e9c8a2",
    "antigravity-29-owner-package-6396105635.json": "17609a229f800615682a33e4c406007d605b961c87d01a7e9179f1d67d6258ab",
    "antigravity-29-owner-package-6404499964.json": "00295ddd34be9b71562d4fde670896b66bb68017ac1ae464e0c466317b396d60"
  },
  "marker": "2da2d8c7078f5c4e40d8aebe78487353965adaa57c4c91079508b54baf0bab8c",
  "one_shot_charge": "10cdf0844bb5eb4c71cd576a95cb7aa576c76c513ccc94231773e242f2244241",
  "admissions": {
    "antigravity-29-owner-package-6404499964.json": "00295ddd34be9b71562d4fde670896b66bb68017ac1ae464e0c466317b396d60",
    "antigravity-29-owner-package-admission-6404499964-qa.json": "0a91d666549d391eb820eba6b1c8728bea6804d526f25946af89907bf7978a2e",
    "antigravity-29-owner-package-admission-6404499964.json": "8d63c339646bfa24409f787d0a08dc0b8dd5b1e9e64bde7c7afb5762fecb5d00"
  },
  "budget": "8f6752295c2ee65924b5a95ddc42bb9774f8f73ce146481e52aaf200e142ed8d"
}
''' )


def canonical(obj):
    return json.dumps(obj, sort_keys=True).encode()


class Fixture:
    def __init__(self, test):
        self.root = Path(tempfile.mkdtemp(dir=os.environ.get('TMPDIR') or None))  # CI runners leave TMPDIR unset
        test.addCleanup(lambda: shutil.rmtree(self.root))
        self.stack = contextlib.ExitStack()
        test.addCleanup(self.stack.close)
        self.state = self.root / 'state'
        self.autonomy = self.root / 'autonomy'
        self.state.mkdir()
        self.policy = self.root / 'policy'
        self.budget = self.root / 'budget'
        self.marker = self.root / 'marker'
        self.evid = self.autonomy / 'slots/slot2/antigravity-evidence' / I.EVIDENCE_ID
        self.evid.mkdir(parents=True)
        (self.autonomy / 'slots/slot1').mkdir()
        (self.autonomy / 'locks').mkdir()
        self.proc = self.root / 'proc'
        self.proc.mkdir()
        (self.proc / 'locks').write_text('')
        self.journal = dict(confirmed={'kept': 'confirmed'}, deferred=[{'kept': 'deferred'}],
                            generation=115, last={'status': 'unknown', 'kept': 'last'},
                            operations={I.OP: copy.deepcopy(FACTS['op_value']), 'earlier': {'status': 'unknown'}},
                            pending=FACTS['pending'], profiles={'kept': 'profiles'}, stage_counts={'29': 6})
        self.write(self.state / 'slot2.json', canonical(self.journal), 0o600)
        self.write(self.state / 'slot1.json', canonical(dict(generation=81, pending=None)), 0o600)
        self.write(self.policy, canonical(FACTS['policy']['value']), 0o644)
        for slot in ('slot1', 'slot2'):
            self.write(self.autonomy / 'slots' / slot / 'state.json', canonical(FACTS['slot_state']), 0o600)
        self.write(self.state / 'controller.lock', b'', 0o600)
        self.write(self.marker, b'marker fixture', 0o644)
        self.write(self.budget, b'budget fixture', 0o600)
        self.write(self.state / 'attempts.json', b'untouched attempts', 0o600)
        self.write(self.state / 'planning.json', b'dynamic planning', 0o600)
        self.write(self.autonomy / 'slots/slot2/charged.json', b'consumed charge', 0o600)
        for name, value in FACTS['phases'].items():
            self.write(self.evid / name, canonical(value), 0o600)
        self.receiver = SimpleNamespace(STATE=self.state, AUTONOMY=self.autonomy, POLICY=self.policy,
            BUDGET=self.budget, UNITS=('synthetic-worker',), trusted_tree=lambda p: None,
            read=lambda p, *a: json.loads(I.regular_bytes(p)),
            journal=lambda slot: json.loads(I.regular_bytes(self.state / (slot + '.json'))),
            checkpoint=lambda slot: (json.loads(I.regular_bytes(self.autonomy / 'slots' / slot / 'state.json')), []),
            alive=lambda process: False, free_lock=lambda p: None,
            units_quiet=lambda units: None, no_models=lambda uid, slot: None)
        self.p('R', self.receiver)
        for key, value in dict(F_JOURNAL=self.state / 'slot2.json', F_POLICY=self.policy, MARKER=self.marker,
                J=self.state / 'receipt.json', BK=self.state / 'backup', MANIFEST_FILE=self.state / 'backup/state-manifest.json',
                EVID=self.evid, PROC=self.proc, PROC_LOCKS=self.proc / 'locks', TELEMETRY=set()).items():
            self.p(key, value)
        self.p('REQUIRED', [self.state / 'slot1.json', self.state / 'slot2.json', self.marker, self.budget] +
               [self.autonomy / 'slots' / s / 'state.json' for s in ('slot1', 'slot2')])
        self.files = {name: (path, 0, 0, mode, I.sha(path)) for name, path, mode in
                      [('journal', I.F_JOURNAL, 0o600), ('policy', self.policy, 0o644)]}
        self.p('FILES', self.files)
        self.p('EXPECTED', {self.evid / name: I.sha(self.evid / name) for name in FACTS['phases']})
        # Explicit metadata emulation for nonroot tests; OS path/hash/replace/fsync logic remains real.
        actual_meta = I.meta
        self.p('meta', lambda path: dict(actual_meta(path), uid=0, gid=0))
        self.stack.enter_context(patch.object(I.os, 'fchown'))
        self.p('run', lambda argv, **kw: b'ActiveState=inactive\nMainPID=0\nUnitFileState=masked\n')
        self.p('git', lambda *args: I.HEAD + '\n' if args == ('rev-parse', 'HEAD') else '')
        self.stack.enter_context(patch.object(subprocess, 'run', side_effect=AssertionError('no subprocess in hermetic fixture')))
        self.stack.enter_context(patch.object(socket, 'socket', side_effect=AssertionError('no network')))
        # Exercise the unmodified admission-wrapper path with a fake installed admission module.
        def admission(controller):
            need(controller == I.C, 'wrong controller')
            for slot, _ in I.SLOTS:
                need(self.receiver.journal(slot)['pending'] is None, 'slot occupied')
                self.receiver.free_lock(self.autonomy / 'slots' / slot / 'worker.lock')
        self.stack.enter_context(patch.dict(sys.modules, owner_package_admission=SimpleNamespace(quiescent=admission)))

    def p(self, name, value):
        self.stack.enter_context(patch.object(I, name, value))

    @staticmethod
    def write(path, raw, mode):
        path.write_bytes(raw)
        path.chmod(mode)

    def tree(self):
        return {str(p.relative_to(self.root)): (p.read_bytes(), stat.S_IMODE(p.stat().st_mode))
                for p in self.root.rglob('*') if p.is_file()}

    def snapshots(self, journal=None, policy=None):
        live = I.read_live()
        if journal is not None:
            live['journal'].update(raw=canonical(journal), sha256=I.bytes_sha(canonical(journal)))
        if policy is not None:
            live['policy'].update(raw=canonical(policy), sha256=I.bytes_sha(canonical(policy)))
        return live

    def allow_synthetic_hashes(self, live):
        # Reach semantic gates independently of the strong real byte pin.
        for name in self.files:
            self.files[name] = (*self.files[name][:4], live[name]['sha256'])


class ReconcileTests(unittest.TestCase):
    def fixture(self):
        return Fixture(self)

    def quiet_call(self, fn):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return fn()

    def test_observed_constants_and_all_immutable_pins(self):
        op = FACTS['op_value']
        for actual, expected in [(I.OP, FACTS['pending']), (I.OPHASH, FACTS['ophash']),
                (I.PROCESS, op['process']), (I.RUN, op['run']), (I.ATTEMPT, op['run_attempt']),
                (I.TASK, op['task_hash']), (I.HEAD, op['binding']['head']),
                (I.BASE, op['qa_qualification']['base']), (I.BINDING, op['binding']),
                (I.RESULT, op['result']), (I.EVIDENCE_ID, op['result']['adapter_error']['evidence_id']),
                (I.CHECKPOINT, FACTS['slot_state']), (I.CHECKD, FACTS['checkpoint_digest']),
                (I.C, FACTS['policy']['value']['controller_sha'])]:
            self.assertEqual(actual, expected)
        self.assertEqual(digest(op), I.OPHASH)
        self.assertEqual(I.bytes_sha(canonical(FACTS['policy']['value'])), FACTS['policy']['sha'])
        for name, value in FACTS['phases'].items():
            self.assertEqual(I.bytes_sha(canonical(value)), FACTS['evidence'][name])
        self.assertEqual(digest(I.CHECKPOINT), I.CHECKD)
        self.assertEqual(I.GENERATION, {'slot2': FACTS['generation']})
        self.assertEqual(I.AFTER_GENERATION, {'slot2': 116})
        self.assertEqual(I.FILES['journal'][1:], (0, 0, 0o600, FACTS['journal_sha']))
        self.assertEqual(I.FILES['policy'][1:], (0, 0, 0o644, FACTS['policy']['sha']))
        expected = {}
        for group in ('evidence', 'reservation', 'charges_mentioning', 'ledger', 'admissions'):
            expected.update(FACTS[group])
        expected.update({'budgets.json': FACTS['budget'], 'antigravity-qa.json': FACTS['marker'],
                         'antigravity-29-one-shot-charge.json': FACTS['one_shot_charge']})
        self.assertEqual({p.name: h for p, h in I.EXPECTED.items()}, expected)
        self.assertIn(I.FINGERPRINT, next(iter(FACTS['charges_mentioning'])))
        self.assertEqual(I.SCRIPT, Path('/root/gb-agy29-unknown116-scheduling-reconcile-20261026.py'))
        self.assertEqual(I.SCHEMA, 'GB_AGY29_UNKNOWN116_RECONCILE_V1')
        self.assertEqual(I.J.name, 'agy29-unknown116-scheduling-reconciliation.json')
        self.assertEqual(I.BK.name, 'agy29-unknown116-scheduling-backup')
        self.assertNotIn('112', SCRIPT.read_text())

    def test_plan_is_pure_and_changes_only_occupancy(self):
        f = self.fixture()
        live = f.snapshots()
        old = copy.deepcopy(live)
        tree = f.tree()
        with patch.object(I, 'proof', side_effect=AssertionError('plan must be pure')), \
                patch.object(I, 'regular_bytes', side_effect=AssertionError('plan must be pure')), \
                patch.object(I.R, 'checkpoint', side_effect=AssertionError('plan must be pure')):
            planned = I.plan(live, FACTS['slot_state'])
        after = planned['new']['journal']
        self.assertEqual(after, dict(f.journal, generation=116, pending=None))
        self.assertEqual(json.loads(planned['after']['journal']), after)
        self.assertEqual(live, old)
        self.assertEqual(f.tree(), tree)
        self.assertEqual(after['operations'], f.journal['operations'])
        self.assertEqual(after['operations'][I.OP]['result']['status'], 'unknown')
        self.assertIs(after['operations'][I.OP]['result']['safe_release'], False)

    def test_wrong_pins_and_metadata_refused(self):
        f = self.fixture()
        live = f.snapshots()
        for name in ('journal', 'policy'):
            for field, bad in [('sha256', '0' * 64), ('mode', 0o666), ('uid', 9), ('gid', 9)]:
                with self.subTest(name=name, field=field):
                    changed = copy.deepcopy(live)
                    changed[name][field] = bad
                    with self.assertRaises(I.Refused):
                        I.plan(changed, FACTS['slot_state'])
        with patch.object(I, 'OPHASH', '0' * 64), self.assertRaisesRegex(I.Refused, 'forged'):
            I.plan(live, FACTS['slot_state'])
        with patch.object(I, 'CHECKD', '0' * 64), self.assertRaises(I.Refused):
            I.plan(live, FACTS['slot_state'])
        with self.assertRaisesRegex(I.Refused, 'checkpoint'):
            I.plan(live, {'active': None, 'done': []})

    def test_semantic_gates_cannot_hide_behind_byte_pins(self):
        f = self.fixture()
        edits = [lambda j: j.update(pending=None), lambda j: j.update(pending='foreign'),
                 lambda j: j.update(generation=114), lambda j: j.update(extra=True),
                 lambda j: j['operations'][I.OP]['result'].update(status='confirmed'),
                 lambda j: j['operations'][I.OP]['result'].update(safe_release=True),
                 lambda j: j['operations'][I.OP]['binding'].update(issue=30),
                 lambda j: j['operations'][I.OP]['process'].update(pid=1),
                 lambda j: j['operations'][I.OP].update(before='0' * 64)]
        for n, edit in enumerate(edits):
            with self.subTest(edit=n):
                j = copy.deepcopy(f.journal)
                edit(j)
                live = f.snapshots(journal=j)
                f.allow_synthetic_hashes(live)
                with self.assertRaises(I.Refused):
                    I.plan(live, FACTS['slot_state'])
        # OP must still be checked even when journal and op byte digests have been matched.
        j = copy.deepcopy(f.journal)
        j['pending'] = 'foreign'
        live = f.snapshots(journal=j)
        f.allow_synthetic_hashes(live)
        with self.assertRaisesRegex(I.Refused, 'exact UNKNOWN occupancy'):
            I.plan(live, FACTS['slot_state'])
        for key, value in [('mode', 'disabled'), ('controller_sha', 'f' * 40)]:
            policy = dict(FACTS['policy']['value'], **{key: value})
            live = f.snapshots(policy=policy)
            f.allow_synthetic_hashes(live)
            with self.assertRaisesRegex(I.Refused, 'ACTIVE and exact'):
                I.plan(live, FACTS['slot_state'])
        # Independently exercise RESULT and checkpoint guards after a synthetic op digest is matched.
        for field, value in [('result', dict(I.RESULT, status='confirmed')), ('checkpoint_before', {'active': None, 'done': []})]:
            j = copy.deepcopy(f.journal)
            j['operations'][I.OP][field] = value
            live = f.snapshots(journal=j)
            f.allow_synthetic_hashes(live)
            with patch.object(I, 'OPHASH', digest(j['operations'][I.OP])), self.assertRaises(I.Refused):
                I.plan(live, FACTS['slot_state'])

    def test_proof_pass_and_changed_phase_hashes_refused(self):
        f = self.fixture()
        before = f.tree()
        self.assertEqual(I.proof()['charge_state'], 'not_charged')
        self.assertEqual(f.tree(), before)
        for name in FACTS['phases']:
            with self.subTest(name=name):
                path = f.evid / name
                old = path.read_bytes()
                path.write_bytes(old + b' ')
                with self.assertRaisesRegex(I.Refused, 'immutable evidence'):
                    I.proof()
                path.write_bytes(old)

    def test_proof_content_and_absent_streams(self):
        f = self.fixture()
        for name, edits in [('phase-01.json', {'phase': 'source'}),
                ('phase-02.json', {'requested_model': 'other'}),
                ('phase-03.json', {'charge_state': 'charged'}), ('phase-03.json', {'terminal': False}),
                ('phase-03.json', {'status': 'confirmed'}), ('phase-03.json', {'exit_code': 0}),
                ('phase-03.json', {'input_sha256': '0' * 64}), ('phase-03.json', {'task_sha256': '0' * 64}),
                ('phase-03.json', {'source_sha': '0' * 40}), ('phase-03.json', {'base_sha': '0' * 40}),
                ('phase-03.json', {'refusal': 'truncated'}), ('phase-03.json', {'error_code': 'other'})]:
            with self.subTest(name=name, edits=edits):
                path = f.evid / name
                path.write_bytes(canonical(dict(FACTS['phases'][name], **edits)))
                pins = dict(I.EXPECTED, **{})
                pins[path] = I.sha(path)
                with patch.object(I, 'EXPECTED', pins), self.assertRaisesRegex(I.Refused, 'phase content'):
                    I.proof()
                path.write_bytes(canonical(FACTS['phases'][name]))
        for name in ('stdout', 'stderr', 'phase-04.json'):
            path = f.evid / name
            path.write_bytes(b'')
            with self.assertRaisesRegex(I.Refused, 'unexpected evidence'):
                I.proof()
            path.unlink()

    def test_proof_alive_process_dirty_and_moved_worktree(self):
        self.fixture()
        with patch.object(I.R, 'alive', return_value=True), self.assertRaisesRegex(I.Refused, 'still alive'):
            I.proof()
        with patch.object(I, 'git', return_value='other-head'), self.assertRaisesRegex(I.Refused, 'later separately reviewed'):
            I.proof()
        with patch.object(I, 'git', side_effect=[I.HEAD, ' M tracked-file']), self.assertRaisesRegex(I.Refused, 'dirty'):
            I.proof()

    def test_git_helper_is_scrubbed_read_only_runuser(self):
        # Inspect the actual helper, not the fixture replacement; no command executes.
        with patch.object(I.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'clean\n')) as run:
            self.assertEqual(I.git('status', '--porcelain=v1'), 'clean\n')
        args, kw = run.call_args
        self.assertEqual(args[0], ['/usr/sbin/runuser', '-u', 'gb-slot2', '--', '/usr/bin/git', '-C', I.WORK,
                                   'status', '--porcelain=v1'])
        self.assertEqual(kw['env']['GIT_OPTIONAL_LOCKS'], '0')
        self.assertEqual(kw['env']['HOME'], '/nonexistent')
        self.assertEqual(kw['env']['GIT_CONFIG_SYSTEM'], '/dev/null')
        self.assertEqual(kw['env']['GIT_CONFIG_GLOBAL'], '/dev/null')
        self.assertEqual(kw['stdin'], subprocess.DEVNULL)

    def test_dry_and_verify_write_nothing_cycle_and_idempotent_rollback(self):
        f = self.fixture()
        before = f.tree()
        self.quiet_call(I.dry)
        self.assertEqual(f.tree(), before)
        self.quiet_call(I.apply)
        changed = {k for k in before if f.tree()[k] != before[k]}
        self.assertEqual(changed, {'state/slot2.json'})
        self.assertEqual(json.loads(I.F_JOURNAL.read_bytes()), dict(f.journal, generation=116, pending=None))
        applied = f.tree()
        self.quiet_call(I.verify)
        self.assertEqual(f.tree(), applied)
        self.quiet_call(I.rollback)
        for key, value in before.items():
            self.assertEqual(f.tree()[key], value)
        rolled = f.tree()
        self.quiet_call(I.rollback)
        self.assertEqual(f.tree(), rolled)
        self.assertEqual(json.loads(I.J.read_bytes())['phase'], 'rolled_back')
        with self.assertRaisesRegex(I.Refused, 'existing guarded'):
            I.apply()

    def test_manifest_guard_detects_dynamic_state_changes(self):
        f = self.fixture()
        before = I.state_manifest()
        after_hash = I.bytes_sha(I.plan(f.snapshots(), FACTS['slot_state'])['after']['journal'])
        expected = I.expected_manifest(before, {'journal': after_hash})
        self.assertEqual({k for k in before if before[k] != expected[k]}, {'state/slot2.json'})
        self.quiet_call(I.apply)
        self.assertEqual(I.state_manifest(), expected)
        for name in ('planning.json', 'attempts.json'):
            path = f.state / name
            old = path.read_bytes()
            path.write_bytes(b'foreign')
            changed = f.tree()
            with self.assertRaisesRegex(I.Refused, 'manifest drift'):
                I.verify()
            with self.assertRaisesRegex(I.Refused, 'manifest drift'):
                I.rollback()
            self.assertEqual(f.tree(), changed)
            path.write_bytes(old)

    def test_rollback_refuses_foreign_journal_policy_and_receipt_bytes(self):
        f = self.fixture()
        self.quiet_call(I.apply)
        for path, raw in [(I.F_JOURNAL, canonical(dict(f.journal, pending=None, generation=117))),
                          (f.policy, canonical(dict(FACTS['policy']['value'], mode='foreign'))),
                          (I.J, canonical(dict(json.loads(I.J.read_bytes()), operation='foreign')))]:
            old = path.read_bytes()
            path.write_bytes(raw)
            snapshot = f.tree()
            with self.assertRaises(I.Refused):
                I.rollback()
            self.assertEqual(f.tree(), snapshot)
            path.write_bytes(old)
        receipt = json.loads(I.J.read_bytes())
        receipt['after']['journal'] = 'f' * 64
        I.J.write_bytes(canonical(receipt))
        with self.assertRaisesRegex(I.Refused, 'postimage drift'):
            I.rollback()

    def test_apply_failure_restores_exactly_at_each_write_stage(self):
        # A fresh fake-root transaction for each failure, including failure after policy restore.
        for target in ('journal', 'disabled_receipt', 'postconditions', 'policy_restore', 'applied_receipt'):
            with self.subTest(target=target):
                f = self.fixture()
                before = f.tree()
                put = I.put_raw
                tripped = []
                def fail(path, raw, *args):
                    result = put(path, raw, *args)
                    hit = ((target == 'journal' and path == I.F_JOURNAL) or
                           (target == 'disabled_receipt' and path == I.J and json.loads(raw)['phase'] == 'disabled') or
                           (target == 'policy_restore' and path == f.policy and raw == before['policy'][0]) or
                           (target == 'applied_receipt' and path == I.J and json.loads(raw)['phase'] == 'applied'))
                    if hit and not tripped:
                        tripped.append(True)
                        raise OSError('synthetic interruption after ' + target)
                    return result
                with patch.object(I, 'put_raw', side_effect=fail):
                    if target == 'postconditions':
                        with patch.object(I, 'postconditions', side_effect=OSError('synthetic postcondition failure')):
                            with self.assertRaises(OSError):
                                self.quiet_call(I.apply)
                    else:
                        with self.assertRaises(OSError):
                            self.quiet_call(I.apply)
                for key, value in before.items():
                    self.assertEqual(f.tree()[key], value)
                self.assertEqual(json.loads(I.J.read_bytes())['phase'], 'rolled_back')

    def test_unprovable_restore_keeps_policy_disabled_and_hint(self):
        f = self.fixture()
        real = I.postconditions
        def drift(*args, **kwargs):
            (f.state / 'attempts.json').write_bytes(b'foreign external drift')
            return real(*args, **kwargs)
        err = io.StringIO()
        with patch.object(I, 'postconditions', side_effect=drift), contextlib.redirect_stderr(err), \
                self.assertRaises(I.Refused):
            I.apply()
        self.assertEqual(json.loads(f.policy.read_bytes())['mode'], 'disabled')
        self.assertIn(I.MANUAL, err.getvalue())
        self.assertEqual(json.loads(I.J.read_bytes())['phase'], 'restore_failed')
        self.assertEqual(json.loads(I.F_JOURNAL.read_bytes()), f.journal)

    def test_write_ahead_receipt_backups_and_controller_lock(self):
        f = self.fixture()
        put = I.put_raw
        seen = []
        def watch(path, raw, *args):
            if path == I.F_JOURNAL:
                receipt = json.loads(I.J.read_bytes())
                self.assertEqual(receipt['phase'], 'disabled')
                self.assertEqual(I.sha(I.BK / 'journal'), I.FILES['journal'][4])
                self.assertEqual(I.sha(I.BK / 'policy'), I.FILES['policy'][4])
                # Opening the same lock separately must fail while apply holds it.
                with self.assertRaises(BlockingIOError):
                    with I.controller_lock():
                        self.fail('controller lock was not held')
                seen.append(path)
            return put(path, raw, *args)
        with patch.object(I, 'put_raw', side_effect=watch):
            self.quiet_call(I.apply)
        self.assertEqual(seen, [I.F_JOURNAL])

    def test_original_quiescent_wrapper_predicted_journal_and_restoration(self):
        f = self.fixture()
        before = f.tree()
        free, journal = I.R.free_lock, I.R.journal
        with self.assertRaisesRegex(I.Refused, 'occupied'):
            I.quiescent()
        self.assertIs(I.R.free_lock, free)
        self.assertIs(I.R.journal, journal)
        I.quiescent(I.plan(f.snapshots(), FACTS['slot_state'])['new']['journal'])
        self.assertEqual(f.tree(), before)
        self.assertIs(I.R.journal, journal)


    def test_idle_masked_no_models_no_integration_and_lock_gates(self):
        f = self.fixture()
        I.preflight_slots()
        journal = f.state / 'slot1.json'
        raw = journal.read_bytes()
        journal.write_bytes(canonical(dict(generation=81, pending='foreign')))
        with self.assertRaisesRegex(I.Refused, 'pending slot1'):
            I.preflight_slots()
        journal.write_bytes(raw)
        with patch.object(I, 'run', return_value=b'ActiveState=inactive\nMainPID=0\nUnitFileState=enabled\n'), \
                self.assertRaisesRegex(I.Refused, 'masked'):
            I.quiet()
        with patch.object(I.R, 'no_models', side_effect=I.Refused('synthetic model present')), \
                self.assertRaisesRegex(I.Refused, 'model present'):
            I.quiet()
        (f.state / 'integration.json').write_bytes(b'{}')
        with self.assertRaisesRegex(I.Refused, 'active integration'):
            I.preflight_slots()
        (f.state / 'integration.json').unlink()
        lock = f.autonomy / 'slots/slot2/worker.lock'
        lock.write_bytes(b'')
        info = lock.stat()
        (f.proc / 'locks').write_text('1: FLOCK ADVISORY WRITE 1 %x:%x:%d 0 EOF\n' %
                                    (os.major(info.st_dev), os.minor(info.st_dev), info.st_ino))
        with self.assertRaisesRegex(I.Refused, 'lock inode held'):
            I.preflight_slots()

    def test_no_model_process_gate(self):
        f = self.fixture()
        class Entry:
            name = '1234'
            def __init__(self, uid, cmd):
                self.uid, self.cmd = uid, cmd
            def stat(self):
                return SimpleNamespace(st_uid=self.uid)
            def __truediv__(self, name):
                return SimpleNamespace(read_bytes=lambda: self.cmd)
        for uid, cmd in [(978, b'plain executor'), (1002, b'cursor-agent'),
                         (1002, b'/srv/gb-slots/worker'), (1002, b'antigravity')]:
            with self.subTest(uid=uid, cmd=cmd), \
                    patch.object(I, 'PROC', SimpleNamespace(iterdir=lambda: [Entry(uid, cmd)])), \
                    self.assertRaises(I.Refused):
                I.model_procs()
        with patch.object(I, 'PROC', SimpleNamespace(iterdir=lambda: [Entry(1002, b'unrelated service')])):
            self.assertEqual(I.model_procs(), 1)

    def test_exact_writer_and_unsafe_files(self):
        f = self.fixture()
        target = f.root / 'exact'
        with patch.object(I.os, 'fchown') as chown:
            I.put_raw(target, b'exact bytes', 0, 0, 0o640)
        self.assertEqual(target.read_bytes(), b'exact bytes')
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o640)
        chown.assert_called_once()
        self.assertEqual(chown.call_args.args[1:], (0, 0))
        alias = f.root / 'alias'
        alias.symlink_to(target)
        with self.assertRaises((I.Refused, OSError)):
            I.regular_bytes(alias)
        alias.unlink()
        os.link(target, alias)
        with self.assertRaisesRegex(I.Refused, 'unsafe regular'):
            I.regular_bytes(target)

    def test_foreign_policy_during_failed_apply_is_disabled(self):
        f = self.fixture()
        def foreign(*args, **kw):
            f.policy.write_bytes(canonical(dict(FACTS['policy']['value'], mode='foreign')))
            raise I.Refused('synthetic foreign policy race')
        err = io.StringIO()
        with patch.object(I, 'postconditions', side_effect=foreign), contextlib.redirect_stderr(err), \
                self.assertRaisesRegex(I.Refused, 'foreign policy race'):
            I.apply()
        self.assertEqual(json.loads(f.policy.read_bytes())['mode'], 'disabled')
        self.assertEqual(json.loads(I.J.read_bytes())['phase'], 'restore_failed')
        self.assertIn(I.MANUAL, err.getvalue())


if __name__ == '__main__':
    unittest.main()
