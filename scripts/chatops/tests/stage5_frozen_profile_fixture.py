"""Closed test-only V3 profile: C5 protocol + accepted PR341 library updates.

This is historical verification material, never an installer profile or runtime
qualification. Missing local Git objects fail; no network or HEAD fallback.
"""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

C5 = '41e12be2d551158e97ea30eaf8e95f992f998615'
RELEASE = '89cef7f7fe994464a81462801942dee8c945c910'
RULES = '13a8b6c54a45aaa57021e092a1bee54926d9eac4'
PREFIX = 'scripts/chatops/actions_train/'
# name: (exact commit, repo path, SHA-256, byte length). Explicitly composite:
# core/exchange/cost and five other protocol modules are C5; two prior protocol
# patches and six NEW libraries are PR341. A whole release checkout is invalid.
BLOBS = {
    'antigravity_qa_recovery.py': (RELEASE, PREFIX + 'antigravity_qa_recovery.py', '93efc05c7aa46fc7ff0d6da70f0db01a9ebda434dbc7d99066590e0459a92a2e', 57449),
    'client.py': (C5, PREFIX + 'client.py', '1c63f4a53709f749cd6d7e88ee6cf1fd479a76762b385dc3a94764f4d42bce65', 13214),
    'content_identity.py': (C5, PREFIX + 'content_identity.py', 'e2df72bcf044149bd5f87a8a9f01a64ed8116a6db72d691a0e6e2b2036cf71af', 29131),
    'context_exchange.py': (C5, PREFIX + 'context_exchange.py', 'baa4463cc6919e015ceabb1c05f398e095beb8c22a633191125442435586e132', 14404),
    'context_policy.py': (RELEASE, PREFIX + 'context_policy.py', 'b55398b64b68c83b88e2f45b53e690f4fbdab9d7e0f0333dd5a354db0c3826df', 10574),
    'core.py': (C5, PREFIX + 'core.py', '3ed9ab5503694f39011102ff34935810ef1dce67cf712c87be89b023689a15a7', 24252),
    'cost_policy.py': (C5, PREFIX + 'cost_policy.py', '18f303fae73b3edf9b73249ae9d904050f65ed4089712dac3bbb98c1c9f58fad', 5493),
    'failure_diagnosis.py': (C5, PREFIX + 'failure_diagnosis.py', 'ced74509f2f80bcd6b073607846b9283c7c7861c5d43fb52f2721ac5d589c75c', 11939),
    'installer.py': (C5, PREFIX + 'installer.py', 'efed82cd43d26abe917c76091743feda5437445630aa9aecb65af3075c2a9d26', 14366),
    'live/autonomous_issues.py': (C5, PREFIX + 'live/autonomous_issues.py', 'f3ca85b4392fa1e2ba76a09ec1140d78ebc6c708ba42397bee047184fec3ebe0', 94653),
    'live/check_foundation.py': (C5, PREFIX + 'live/check_foundation.py', 'c2975b19bd46d00acbdbc08227545b8f9c9501d7b8e8783e9b397751c612bd13', 15753),
    'live/slots.py': (C5, PREFIX + 'live/slots.py', '3c7b4ab36dd3cd8b41c3309a4d58c54ffc99027b1d7c1e5ad2235b5cd1f72a76', 50924),
    'monitor-mapping.json': (C5, PREFIX + 'monitor-mapping.json', 'f12d50165bc7bea004a4dbeb058ad6a53b8e1a896c72ed5a584f67e1c7366405', 1604),
    'monitor.py': (C5, PREFIX + 'monitor.py', '1b0cdd9895c24407294739b5092cf8ad06b8761e2672eaede15900d4fe859a6e', 7522),
    'monitor_extension.js': (C5, PREFIX + 'monitor_extension.js', '35bc34203b95f48b3988f36ac1b78476c58639422abea1bb8c1168e3adc1ef20', 1976),
    'monitor_payload/app.js': (C5, PREFIX + 'monitor_payload/app.js', 'c2d7a233ab77f10fd5795f1629814b7fee6e579d4da9968a29d982a5faf979ca', 25236),
    'monitor_payload/writer.py': (C5, PREFIX + 'monitor_payload/writer.py', 'fc89ff1f9a26b565b2214f887873f4ea661c46bf86dd41daf37fe44680212158', 43095),
    'native_antigravity.py': (RELEASE, PREFIX + 'native_antigravity.py', '9dae383ae315f02f5ed03e6c8e45424b0516e8a653e446e5600440d12b438889', 113804),
    'native_cursor.py': (C5, PREFIX + 'native_cursor.py', '02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089', 17488),
    'native_guard.py': (RELEASE, PREFIX + 'native_guard.py', '334d4c78c57ba9a7f3f5c49e6737ec8e658033e4b4fdc84f92ce168ece9019f9', 9075),
    'owner_package_admission.py': (RELEASE, PREFIX + 'owner_package_admission.py', 'bb5bf8516d26ae293f16d794c2e46f90b01d0c27b34da15febbd0bff4398c7c5', 32123),
    'qa_equivalence.py': (C5, PREFIX + 'qa_equivalence.py', 'b95d571ee22b666e329d38ac690fbba948b40b712a2f63aa566b51705143809d', 12791),
    'qa_recovery.py': (C5, PREFIX + 'qa_recovery.py', '1d8a93beb61b871e5321e5b3b9a6803731e40a9687a4d48f2ce8c52ffe1cd185', 8416),
    'queue_diagnostics.py': (C5, PREFIX + 'queue_diagnostics.py', '0ee6b2628fb4d1a65e50ceb5b33b1fbc9d5f2838d9a425882d977bf3ffabbd14', 3874),
    'receiver.py': (C5, PREFIX + 'receiver.py', '6405168b06f3902e40595528d30856c025a0311abfc31d70b59e969ed384af4e', 48026),
    'recovery.py': (C5, PREFIX + 'recovery.py', '315fb1f8349f0881073148737371ef1f519411883994ea4769db173b47e4e7c9', 26494),
    'recovery_admission.py': (C5, PREFIX + 'recovery_admission.py', 'b6eb1b4e73829f612d7603bb335fd1bdbace73235eac3d5c25c84782dc5854c7', 10751),
    'recovery_publish.py': (C5, PREFIX + 'recovery_publish.py', '51e110d5beaf1a0e46b98eaffb2691d7e4e975c36ab939575e93e87d2850a8c9', 2704),
    'recovery_upgrade.py': (C5, PREFIX + 'recovery_upgrade.py', 'ce8cc88f3cb3230b51f425d9082e826511c35332ca363d2af97bb8b18e4498f6', 10143),
    'stage.py': (RELEASE, PREFIX + 'stage.py', 'ca5ca68eb8b3f8bafbb8c097790acc91c0323f2081fed977372cf571452b97ed', 40666),
    'context_cursor_delivery.py': (RELEASE, PREFIX + 'context_cursor_delivery.py', '6352f6bd6175f447bc124a28d6a1dc67837da6514f1ede3a81c128b4623bff11', 19544),
    'admission_pm.py': (RELEASE, PREFIX + 'admission_pm.py', 'a17576fad805a736b926768d3aae7d5ed4bb6336f3c248805f8de3fac699784a', 34081),
    'accepted-engineering-rules.md': (RULES, 'docs/rules/ENGINEERING_OPERATING_MODEL.md', '8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5', 115079),
    'old-native-guard.py': (C5, PREFIX + 'native_guard.py', 'dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762', 8036),
    'v3-installer.py': (RELEASE, 'scripts/chatops/ops/stage5_cursor_context_upgrade.py', 'eb7beb3df32cf4d913201e2cbaa36aa3dd36cd8f27aeec457df0fea0bc7e6696', 60535),
}


def checked_bytes(name, raw):
    """Validate before parsing/importing, including length independently of hash."""
    _, _, digest, size = BLOBS[name]
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
        raise ValueError('immutable blob digest/size mismatch: ' + name)
    return raw


def read_blob(repo, name, record=None):
    expected = BLOBS[name]
    if record is not None and record != expected:
        raise ValueError('unsupported immutable provenance: ' + name)
    commit, path, _, _ = expected
    env = {'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent',
           'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_OPTIONAL_LOCKS': '0',
           'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_ALLOW_PROTOCOL': '', 'LC_ALL': 'C'}
    result = subprocess.run(
        ['/usr/bin/git', '--no-optional-locks', '-C', str(repo),
         'show', commit + ':' + path], env=env, stdin=subprocess.DEVNULL,
        capture_output=True, timeout=30)
    if result.returncode:
        raise ValueError('required local immutable Git blob unavailable: '
                         + commit + ':' + path + '\n' + result.stderr.decode(errors='replace'))
    return checked_bytes(name, result.stdout)


def materialize(repo, directory):
    directory = Path(directory)
    # Resolve and verify the complete set before making any source executable.
    blobs = {name: read_blob(repo, name) for name in BLOBS}
    for name, raw in blobs.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        target.chmod(0o644)


def verify_files(directory):
    for name in BLOBS:
        checked_bytes(name, (directory / name).read_bytes())


def verify_origins(directory):
    """Reject preloaded/current modules as well as mutated materialized bytes."""
    origins = {}
    forbidden = {'smart_stage', 'smart_routing', 'native_antigravity_author'}
    for name, module in tuple(sys.modules.items()):
        if name in forbidden:
            raise ValueError('current module contamination: ' + name)
        filename = getattr(module, '__file__', None)
        relative = name.replace('.', '/') + '.py'
        if relative not in BLOBS and name != 'frozen_v3_installer':
            continue
        relative = 'v3-installer.py' if name == 'frozen_v3_installer' else relative
        if filename is None or Path(filename).resolve() != (directory / relative).resolve():
            raise ValueError('current module contamination: ' + name)
        checked_bytes(relative, Path(filename).read_bytes())
        origins[name] = dict(path=str(filename), sha256=BLOBS[relative][2],
                             commit=BLOBS[relative][0])
    return origins


def function(raw, name):
    return next(n for n in ast.parse(raw).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


def assert_stage_guard(case, raw):
    tree = ast.parse(raw)
    imports = [n for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)
               and n.module == 'native_antigravity_author']
    case.assertEqual(len(imports), 1)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    parent = parents[imports[0]]
    case.assertIsInstance(parent, ast.If)
    case.assertEqual(ast.unparse(parent.test), "provider == 'agy' and (not qa)")


def assert_guard_delta(case, old, new):
    for name in ('_landlock', '_seccomp', 'restrict', 'no_new_privileges'):
        case.assertEqual(ast.dump(function(old, name)), ast.dump(function(new, name)))
    newfn = copy.deepcopy(function(new, 'cursor_namespace_argv'))
    added = [n for n in newfn.body if isinstance(n, ast.AugAssign)
             and isinstance(n.value, ast.Call) and isinstance(n.value.func, ast.Name)
             and n.value.func.id == 'cursor_rules_readonly_mounts']
    case.assertEqual(len(added), 1)
    newfn.body.remove(added[0])
    case.assertEqual(ast.dump(function(old, 'cursor_namespace_argv')), ast.dump(newfn))


def run_contract(directory, current_targets):
    """Fresh -I -B interpreter only; never stage setup/perform, live or install."""
    verify_files(directory)
    # -I discards cwd/PYTHONPATH; the sole project import directory is historical.
    sys.path.insert(0, str(directory))
    verify_origins(directory)
    import core
    import receiver
    import stage
    import context_exchange as exchange
    import context_policy
    import context_cursor_delivery as delivery
    import native_antigravity as agy
    import native_guard
    spec = importlib.util.spec_from_file_location('frozen_v3_installer', directory / 'v3-installer.py')
    installer = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = installer
    spec.loader.exec_module(installer)
    origins = verify_origins(directory)
    required = {'core', 'receiver', 'stage', 'context_exchange', 'context_policy',
                'context_cursor_delivery', 'native_antigravity', 'native_guard', 'frozen_v3_installer'}
    if not required <= origins.keys():
        raise ValueError('missing historical import origins')
    rules = (directory / 'accepted-engineering-rules.md').read_bytes()

    class FrozenContract(unittest.TestCase):
        def test_all_exact_pins_and_import_origins(self):
            self.assertEqual(installer.C5, C5)
            self.assertEqual(installer.RULES_COMMIT, RULES)
            self.assertEqual(len(rules), installer.RULES_SIZE)
            for mapping in (installer.V3_NEW, installer.V3_PROTOCOL):
                for name, pin in mapping.items():
                    self.assertEqual(BLOBS[name][2], pin, name)
            self.assertEqual(context_policy.RULES_SHA256, BLOBS['accepted-engineering-rules.md'][2])
            verify_files(directory)
            self.assertEqual(verify_origins(directory), origins)

        def test_pinned_router_author_refusal_and_qa_positive_control(self):
            calls = []
            slots = SimpleNamespace(UNKNOWN=object(), adapter_status=lambda *a: (True, 'synthetic'),
                                    MODEL_ADAPTER={})
            budget = SimpleNamespace(remaining=lambda *a: calls.append('budget') or 3, used=lambda *a: 0)
            with patch.object(agy, 'available', side_effect=AssertionError('author availability reached')):
                for model in sorted(agy.MODELS):
                    task = dict(author_routes=['agy:' + model], work_kind='implementation', risk='complex')
                    with self.subTest(model=model), self.assertRaisesRegex(
                            core.Refused, 'role/model/effort not supported'):
                        core._route_immutable(slots, task, 'author', 'auto', budget, 'slot1')
                    task = dict(qa_routes=['agy:' + model + ':high'],
                                work_kind='implementation', risk='complex')
                    with self.subTest(unsupported_effort=model), self.assertRaisesRegex(
                            core.Refused, 'role/model/effort not supported'):
                        core._route_immutable(slots, task, 'qa', 'auto', budget, 'slot1')
            self.assertEqual(calls, [])
            with patch.object(agy, 'available', return_value=(True, 'synthetic qualification')):
                task = dict(qa_routes=['agy:' + agy.MODEL], work_kind='implementation', risk='complex')
                result = core._route_immutable(slots, task, 'qa', 'auto', budget, 'slot1')
            self.assertEqual((result['role'], result['provider']), ('qa', 'agy'))
            slots_tree = ast.parse((directory / 'live/slots.py').read_bytes())
            forbidden = next(n for n in slots_tree.body if isinstance(n, ast.Assign)
                             and any(isinstance(t, ast.Name) and t.id == 'FORBIDDEN' for t in n.targets))
            self.assertIn('author', ast.literal_eval(forbidden.value)['agy'])

        def test_frozen_context_api_and_lossless_full_fallback(self):
            raw = (directory / 'context_exchange.py').read_bytes()
            funcs = {n.name: n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef)}
            self.assertEqual([a.arg for a in funcs['compile_capsule'].args.args],
                             ['full_rules', 'role', 'expected_sha256'])
            self.assertEqual([a.arg for a in funcs['encoded'].args.args], ['value'])
            self.assertTrue({'text', 'metadata', 'role', 'compact', 'full_rules_reference', 'verified_access'}
                            <= {a.arg for a in funcs['rules_prefix'].args.kwonlyargs})
            text = rules.decode()
            self.assertTrue(exchange.compile_capsule(text, 'author', installer.RULES_SHA256))
            with self.assertRaisesRegex(ValueError, 'provenance'):
                exchange.compile_capsule(text + 'x', 'author', installer.RULES_SHA256)
            metadata = dict(commit=RULES, sha256=installer.RULES_SHA256, bytes=len(rules))
            prefix, receipt = exchange.rules_prefix(text=text, metadata=metadata, role='author', compact=True)
            self.assertIn(text, prefix)
            self.assertEqual(receipt['policy_profile'], 'full')
            self.assertEqual(receipt['delivered_policy_bytes'], len(rules))
            self.assertIs(delivery.compile_capsule, exchange.compile_capsule)

        def test_stage_guard_and_security_ast_with_negative_controls(self):
            stage_raw = (directory / 'stage.py').read_bytes()
            old = (directory / 'old-native-guard.py').read_bytes()
            new = (directory / 'native_guard.py').read_bytes()
            assert_stage_guard(self, stage_raw)
            assert_guard_delta(self, old, new)
            changed = stage_raw.replace(b"provider == 'agy' and not qa", b"provider == 'agy' or not qa")
            self.assertNotEqual(changed, stage_raw)
            with self.assertRaises(AssertionError):
                assert_stage_guard(self, changed)
            tree = ast.parse(new)
            function_node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'restrict')
            function_node.body = [ast.Pass()]
            with self.assertRaises(AssertionError):
                assert_guard_delta(self, old, ast.unparse(ast.fix_missing_locations(tree)))

        def test_current_module_contamination_and_materialized_tamper_refused(self):
            for name in ('core', 'native_antigravity', 'context_policy'):
                with self.subTest(module=name), patch.dict(sys.modules, {name: SimpleNamespace(__file__=__file__)}):
                    with self.assertRaisesRegex(ValueError, 'current module contamination'):
                        verify_origins(directory)
            for name in ('smart_stage', 'smart_routing', 'native_antigravity_author'):
                with patch.dict(sys.modules, {name: SimpleNamespace()}):
                    with self.assertRaisesRegex(ValueError, 'current module contamination'):
                        verify_origins(directory)
            path = directory / 'core.py'
            raw = path.read_bytes()
            try:
                path.write_bytes(raw + b'\n')
                with self.assertRaisesRegex(ValueError, 'digest/size mismatch'):
                    verify_files(directory)
            finally:
                path.write_bytes(raw)

        def test_real_v3_guard_accepts_frozen_rejects_current_and_dependency_drift(self):
            items = {directory / n: (directory / n).read_bytes()
                     for n in installer.V3_NEW if n != 'accepted-engineering-rules.md'}

            def trusted(path):
                path = Path(path)
                self.assertTrue(path.is_relative_to(directory))
                for parent in (path, *path.parents):
                    st = parent.lstat()
                    core.need(not stat.S_ISLNK(st.st_mode) and st.st_uid in (0, os.getuid())
                              and not st.st_mode & 0o022, 'unsafe historical fixture path')

            def rules_git(bundle, *args):
                self.assertEqual(args, ('show', RULES + ':' + installer.BUNDLE_RULES))
                return checked_bytes('accepted-engineering-rules.md', rules)

            # Only fixture UID/path and hash-verified rules transport are synthetic.
            # All target/protocol hash, mode, nlink and unqualified-module gates run.
            with patch.object(installer, 'INSTALL', directory), \
                 patch.object(installer, 'OWNER_UID', os.getuid()), \
                 patch.object(installer, 'OWNER_GID', os.getgid()), \
                 patch.object(receiver, 'trusted_tree', side_effect=trusted), \
                 patch.object(installer, 'git', side_effect=rules_git):
                self.assertEqual(set(installer.v3_material(items, directory)), set(installer.V3_NEW))
                for name in ('stage.py', 'context_policy.py'):
                    raw = (current_targets / name).read_bytes()
                    self.assertNotEqual(hashlib.sha256(raw).hexdigest(), installer.V3_NEW[name])
                    changed = dict(items)
                    changed[directory / name] = raw
                    with self.subTest(current_target=name), self.assertRaisesRegex(
                            core.Refused, 'dependency closure not proven for target ' + name):
                        installer.v3_material(changed, directory)
                for name in installer.V3_PROTOCOL:
                    path = directory / name
                    raw = path.read_bytes()
                    try:
                        path.write_bytes(raw + b'\n# tamper\n')
                        with self.subTest(protocol=name), self.assertRaisesRegex(
                                core.Refused, 'frozen protocol dependency HOLD: ' + name):
                            installer.v3_material(items, directory)
                    finally:
                        path.write_bytes(raw)
                path = directory / 'native_antigravity_author.py'
                try:
                    path.write_bytes(b'never imported')
                    with self.assertRaisesRegex(core.Refused, 'unqualified AGY author'):
                        installer.v3_material(items, directory)
                finally:
                    path.unlink()
            verify_files(directory)

    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(FrozenContract))
    print(json.dumps(dict(tests=result.testsRun, success=result.wasSuccessful(),
                          module_origins=origins), sort_keys=True))
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(run_contract(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()))
