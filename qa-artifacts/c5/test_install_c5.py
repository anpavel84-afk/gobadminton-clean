"""Essential offline tests for install_c5.py (draft). Needs the a_c5/c5work clone containing C5 (merge #294+#297) and R5 (local branches c5-merge-preview / c5r5-preview).
Run: python3 -B test_install_c5.py   (env GB_REPO, GB_C5, GB_R5 override the preview values; the draft is filled into a temp file first)."""
import hashlib, importlib.util, json, os, pathlib, shutil, stat, subprocess, sys, tempfile, unittest
HERE = pathlib.Path(__file__).resolve().parent
sys.dont_write_bytecode = True
REPO = pathlib.Path(os.environ.get('GB_REPO', str(HERE / 'c5work')))
C5 = os.environ.get('GB_C5', '41e12be2d551158e97ea30eaf8e95f992f998615')
R5 = os.environ.get('GB_R5', '05f06a7ab1197c81f795f35df2ab41f9625501a8')
BASE = 'scripts/chatops/actions_train/'
TMP = pathlib.Path(tempfile.mkdtemp(prefix='c5test-', dir=str(HERE)))
def git(*a): return subprocess.check_output(['git', '-C', str(REPO), *a])
def H(b): return hashlib.sha256(b).hexdigest()
def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
# C5 modules (receiver/installer/core) from the immutable commit, not from a mutable worktree
MODS = TMP / 'mods'; MODS.mkdir()
for line in git('ls-tree', '--name-only', C5, BASE).decode().split():
    if line.endswith('.py'): (MODS / pathlib.Path(line).name).write_bytes(git('show', C5 + ':' + line))
sys.path.insert(0, str(MODS))
F = load(HERE / 'fill_c5.py', 'fill_c5')
DRAFT = HERE / 'install_c5.py'
FILLED = TMP / 'install_c5_filled.py'
F.fill(REPO, C5, R5, DRAFT, FILLED)
M = load(FILLED, 'install_c5')
def tearDownModule(): shutil.rmtree(TMP, ignore_errors=True)

class Draft(unittest.TestCase):
    def test_placeholders_refuse_every_verb(self):
        text = DRAFT.read_text()
        for key in ('@@C5@@', '@@R5@@', '@@MANIFEST@@', '@@NATIVE@@', '@@CONTEXT@@', '@@ADMISSION@@', '@@STAGE@@'): self.assertIn(key, text)
        self.assertIn("'placeholders not filled", text)
        d = load(DRAFT, 'install_c5_draft')           # draft imports (placeholders are inert strings) ...
        with self.assertRaises(Exception): d.main()   # ... but main() refuses before anything else (even without root/argv)
    def test_shape_and_scope(self):
        text = FILLED.read_text()
        self.assertIn('INSTALL294_REFUSED', text)
        for bad in ('GH_PUSH_TOKEN', 'systemctl start', 'systemctl enable', 'systemctl unmask', 'apparmor_parser', 'SOURCE_POLICY', 'api.anthropic', 'curl '):
            self.assertNotIn(bad, text)
        for verb in ('dry', 'apply', 'verify', 'verify-merged', 'rollback'): self.assertIn("'" + verb + "'", text)
        self.assertEqual(set(M.BACKUP_PATHS), {'native', 'context', 'admission', 'rules', 'policy', 'inventory'})
        self.assertEqual({p.name for p in M.TARGETS}, {'native_antigravity.py', 'context_policy.py', 'owner_package_admission.py'})
        self.assertEqual(M.RESTORE_ORDER, ('native', 'context', 'admission', 'rules', 'inventory'))
        self.assertEqual((M.RULES_SHA, M.RULES_SIZE, M.RULES_COMMIT, M.RULES_REVISION, M.REGISTRY_GROUP),
                         ('017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269', 113203, 'bc8bad0c38a861f8e72296d0a323e2941b9322e0', '1.4', 65042))
        self.assertEqual((M.RULES_OLD_SHA, M.RULES_OLD_SIZE), ('38c34012f10974496a7d7cbc74ecacb62bf7847278e295edfeb107d69a5d1c1c', 100818))
        # no policy weakening: the policy only gets the same field rewrites as install292 (controller/stage/recovery pins)
        for weak in ("mode='shadow'", "'mode': 'shadow'", 'SOURCE_POLICY', 'trusted_uids=(0, ', 'setgroups', 'os.setuid'): self.assertNotIn(weak, text)
        self.assertEqual(M.OLD, '7d3d6ca0b06275e7f4c3d35700cbdf14061a4e55')

class Release(unittest.TestCase):
    def test_commits_and_release_shape(self):
        self.assertEqual(M.C, C5); self.assertEqual(M.RELEASE, R5)
        self.assertEqual(git('show', '-s', '--format=%P', R5).decode().split(), [C5])
        self.assertEqual(set(git('diff-tree', '--no-commit-id', '--name-only', '-r', R5).decode().split()),
                         {M.WORKFLOW, '.github/workflows/train-dispatch.yml'})
    def test_manifest_delta_is_exactly_three_files(self):
        raw = git('show', C5 + ':' + BASE + 'manifest.json')
        self.assertEqual(H(raw), M.MANIFEST); self.assertEqual(raw, git('show', R5 + ':' + BASE + 'manifest.json'))
        new = json.loads(raw)['files']; old = json.loads(git('show', M.OLD + ':' + BASE + 'manifest.json'))['files']
        self.assertEqual(H(git('show', M.OLD + ':' + BASE + 'manifest.json')), M.MANIFEST_OLD)
        changed = {k for k in new if new[k] != old.get(k)} | (set(old) - set(new))
        self.assertEqual(changed, {BASE + 'native_antigravity.py', BASE + 'context_policy.py', BASE + 'owner_package_admission.py'})
        for t_, (o, n) in M.TARGETS.items(): self.assertEqual((old[BASE + t_.name], new[BASE + t_.name]), (o, n))
        self.assertEqual(M.TARGETS[M.NATIVE][1], '99e70d960b1db2567c32dea10a7341487b3aeb511a1aa5a51b85be86cded2d42')
        # rules file is NOT manifest payload (the manifest installer would not copy it)
        self.assertFalse([k for k in new if 'rules' in k.lower() and k.endswith('.md')])
        self.assertEqual(H(git('show', C5 + ':' + M.RULES_SOURCE_PATH)), M.RULES_SHA)
        for t, v in M.UNCHANGED.items(): self.assertEqual(new[BASE + t.name], v)
        for name, (o2, n2) in M.MONITOR.items(): self.assertEqual(new[BASE + 'monitor_payload/' + pathlib.Path(name).name], n2)
    def test_workflow_prediction_and_fail_closed(self):
        stage = git('show', R5 + ':' + M.WORKFLOW); cur = git('show', C5 + ':' + M.WORKFLOW)
        self.assertEqual(H(stage), M.STAGE_SHA); self.assertEqual(H(cur), M.DEV_SHA)   # dev workflow today == C5 workflow == policy pin
        self.assertEqual(M.predicted_merge(dict(stage_workflow_sha256=M.DEV_SHA), cur, stage), M.STAGE_SHA)
        with self.assertRaises(Exception): M.predicted_merge(dict(stage_workflow_sha256=M.DEV_SHA), stage, stage)   # already merged
        with self.assertRaises(Exception): M.predicted_merge(dict(stage_workflow_sha256=M.DEV_SHA), cur + b'x', stage)
    def test_pr_removes_profile_source_only(self):
        files = set(git('diff', '--name-only', '2446bcc5', C5).decode().split())
        self.assertIn('scripts/chatops/ops/gb_agy_runtime.apparmor', files)
        self.assertEqual({f for f in files if f.startswith(BASE)},
                         {BASE + 'native_antigravity.py', BASE + 'manifest.json', BASE + 'context_policy.py', BASE + 'owner_package_admission.py'})
    def test_c5_contains_both_qa_heads_and_tree_is_their_union(self):
        heads = ('c9b67f9e9aaa6ee029d3695eb2ce7db5f7ed7ca4', '0d160f6722e404745e065176fea9221a48a37232')
        for h in heads: git('merge-base', '--is-ancestor', h, C5)
        self.assertEqual(git('show', '-s', '--format=%P', C5).decode().split(), list(heads))
        for path in (BASE + 'native_antigravity.py',): self.assertEqual(git('show', C5 + ':' + path), git('show', heads[0] + ':' + path))
        for path in (BASE + 'context_policy.py', BASE + 'owner_package_admission.py'): self.assertEqual(git('show', C5 + ':' + path), git('show', heads[1] + ':' + path))
        # merged manifest = #294 manifest entries for native + #297 entries for context/admission, nothing else
        m5, m294, m297 = (json.loads(git('show', x + ':' + BASE + 'manifest.json'))['files'] for x in (C5, heads[0], heads[1]))
        for k, v in m5.items(): self.assertIn(v, (m294.get(k), m297.get(k)), k)
    def test_installer_pins_equal_rules_bytes_in_payload(self):
        # rules_pins() must accept the C5 payload and refuse an EOM 1.3 payload
        items = {M.CONTEXT: TMP / 'ctx.py', M.ADMISSION: TMP / 'adm.py'}
        for t_, f in items.items(): f.write_bytes(git('show', C5 + ':' + BASE + t_.name))
        orig = M.regular_bytes
        M.regular_bytes = lambda p: pathlib.Path(p).read_bytes()
        try:
            M.rules_pins(items)
            items[M.CONTEXT].write_bytes(git('show', M.OLD + ':' + BASE + 'context_policy.py'))
            with self.assertRaises(Exception): M.rules_pins(items)
        finally: M.regular_bytes = orig

class Smoke(unittest.TestCase):
    def run_smoke(self, mod, expect):
        w = TMP / 'w'; w.mkdir(exist_ok=True)
        return subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', M.SMOKE_CODE, str(mod), str(w), expect],
                              env=dict(PATH='/usr/bin:/bin', HOME='/nonexistent', LANG='C.UTF-8'), capture_output=True, timeout=60)
    def test_c5_passes_c4_fails(self):
        out = self.run_smoke(MODS, M.TARGETS[M.NATIVE][1])
        self.assertIn(b'SMOKE294_PASS', out.stdout, out.stderr.decode()[-800:])
        self.assertNotIn(b'SMOKE294_PASS', self.run_smoke(MODS, 'f' * 64).stdout)
        old = TMP / 'c4mod'; shutil.copytree(MODS, old)
        (old / 'native_antigravity.py').write_bytes(git('show', M.OLD + ':' + BASE + 'native_antigravity.py'))   # AppArmor-dependent C4 adapter
        self.assertNotIn(b'SMOKE294_PASS', self.run_smoke(old, M.TARGETS[M.NATIVE][0]).stdout)

    def test_rules_probe_accepts_eom14_refuses_eom13_and_tamper(self):
        good = TMP / 'rules' / 'ENGINEERING_OPERATING_MODEL.md'; good.parent.mkdir(exist_ok=True)
        def probe(path, sha=None):
            return subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', M.RULES_CODE, str(MODS), str(path), sha or M.RULES_SHA, str(M.RULES_SIZE),
                                   M.RULES_COMMIT, M.RULES_REVISION, '0,' + str(os.getuid())], capture_output=True, timeout=60)
        good.write_bytes(git('show', M.RULES_COMMIT + ':' + M.RULES_SOURCE_PATH)); os.chmod(good, 0o644)
        self.assertIn(b'RULES294_PASS', probe(good).stdout, probe(good).stderr.decode()[-600:])
        old = TMP / 'rules' / 'old.md'; old.write_bytes(git('show', M.RULES_OLD_COMMIT + ':' + M.RULES_SOURCE_PATH)); os.chmod(old, 0o644)
        self.assertNotIn(b'RULES294_PASS', probe(old).stdout)                       # EOM 1.3 bytes are refused by the 1.4 pin
        bad = TMP / 'rules' / 'bad.md'; bad.write_bytes(good.read_bytes()[:-1] + b'x'); os.chmod(bad, 0o644)
        self.assertNotIn(b'RULES294_PASS', probe(bad).stdout)                       # same size, one byte changed
        os.chmod(good, 0o664); self.assertNotIn(b'RULES294_PASS', probe(good).stdout)   # group-writable file is refused
        os.chmod(good, 0o644); self.assertNotIn(b'RULES294_PASS', probe(good, 'f' * 64).stdout)
    def test_contour_and_registry_note_code_shape(self):
        compile(M.CONTOUR_CODE, 'contour', 'exec'); compile(M.RULES_CODE, 'rules', 'exec')
        self.assertIn("os.getgroups() == [65042]", M.CONTOUR_CODE); self.assertIn("os.getgroups() == []", M.CONTOUR_CODE)
        self.assertIn("'does not name gid 65042' in N.REGISTRY_GROUP_NOTE", M.SMOKE_CODE)
        note = subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', 'import sys; sys.path.insert(0, sys.argv[1]); import native_antigravity as N; print(N.REGISTRY_GROUP, N.REGISTRY_GROUP_NOTE)', str(MODS)], capture_output=True).stdout.decode()
        self.assertIn('65042', note); self.assertIn('does not name gid 65042', note); self.assertIn('CAP_SETGID', note)

class Sim(unittest.TestCase):
    """Temp-tree install/rollback: backups, next_values/old_values, byte-exact restore, foreign-bytes refusal."""
    def setUp(self):
        self.t = pathlib.Path(tempfile.mkdtemp(dir=str(TMP))); t = self.t; L = t / 'lib'; L.mkdir(); (t / 'state').mkdir()
        self.old, self.new = b'c4 native', b'c5 native'
        self.olds = {'native_antigravity.py': b'c4 native', 'context_policy.py': b'c4 ctx', 'owner_package_admission.py': b'c4 adm'}
        self.news = {'native_antigravity.py': b'c5 native', 'context_policy.py': b'c5 ctx', 'owner_package_admission.py': b'c5 adm'}
        self.rules_old, self.rules_new = b'EOM 1.3 bytes', b'EOM 1.4 bytes!'
        for n, b in self.olds.items(): (L / n).write_bytes(b)
        (L / 'accepted-engineering-rules.md').write_bytes(self.rules_old); os.chmod(L / 'accepted-engineering-rules.md', 0o644)
        names = ('content_identity.py', 'stage.py', 'monitor-mapping.json', 'native_guard.py')
        for n in names: (L / n).write_bytes(b'same ' + n.encode())
        (t / 'rulessrc').mkdir(); self.src = {}
        for n, b in self.news.items(): (t / 'rulessrc' / n).write_bytes(b); self.src[L / n] = t / 'rulessrc' / n
        (t / 'rulessrc' / 'rules.md').write_bytes(self.rules_new)
        pol = dict(mode='active', controller_sha=M.OLD, stage_workflow_sha256=M.DEV_SHA, recovery=dict(source_sha=M.OLD))
        (t / 'policy.json').write_text(json.dumps(pol, sort_keys=True)); os.chmod(t / 'policy.json', 0o644); self.pol = pol
        ST = {L / n: (H(self.olds[n]), H(self.news[n])) for n in self.olds}
        self.inv = dict(manifest=M.MANIFEST_OLD, after={str(p): v[0] for p, v in ST.items()}, before={}, targets=[], units=[])
        (t / 'state' / 'backup.json').write_text(json.dumps(self.inv, sort_keys=True)); os.chmod(t / 'state' / 'backup.json', 0o600)
        saved = {}
        def patch(obj, **kw):
            for k, v in kw.items(): saved[(obj, k)] = getattr(obj, k); setattr(obj, k, v)
        self.L = L
        patch(M, TARGETS=ST, NATIVE=L / 'native_antigravity.py', CONTENT=L / 'content_identity.py', RULES=L / 'accepted-engineering-rules.md',
              STAGE=L / 'stage.py', CONTEXT=L / 'context_policy.py', ADMISSION=L / 'owner_package_admission.py', MAPPING=L / 'monitor-mapping.json', GUARD=L / 'native_guard.py',
              J=t / 'state' / 'J.json', BK=t / 'state' / 'BK', MONITOR={}, CI_CUR=H(b'same content_identity.py'),
              RULES_OLD_SHA=H(self.rules_old), RULES_OLD_SIZE=len(self.rules_old), RULES_SHA=H(self.rules_new), RULES_SIZE=len(self.rules_new),
              TARGET_BACKUP={'native': L / 'native_antigravity.py', 'context': L / 'context_policy.py', 'admission': L / 'owner_package_admission.py'},
              UNCHANGED={L / n: H(b'same ' + n.encode()) for n in ('stage.py', 'monitor-mapping.json', 'native_guard.py')})
        patch(M, MANIFEST_FILE=M.BK / 'state-manifest.json',
              BACKUP_PATHS={'native': L / 'native_antigravity.py', 'context': L / 'context_policy.py', 'admission': L / 'owner_package_admission.py',
                            'rules': L / 'accepted-engineering-rules.md', 'policy': t / 'policy.json', 'inventory': t / 'state' / 'backup.json'},
              live_slots=lambda: {'slot1': {'generation': 1}}, assert_manifest=lambda r: None, trusted_target=lambda p: None, profile_label=lambda: None)
        patch(M.R, trusted_tree=lambda p: None, POLICY=t / 'policy.json', STATE=t / 'state',
              read=lambda p, owner=None, limit=2097152: json.loads(pathlib.Path(p).read_text()), atomic=lambda p, v, mode=0o600: self._atomic(p, v, mode))
        patch(M.I, put=lambda src, dst, mode: (shutil.copyfile(src, dst), os.chmod(dst, mode)))
        def undo():
            for (o, k), v in saved.items(): setattr(o, k, v)
        self.addCleanup(undo)
    def _atomic(self, p, v, mode):
        p = pathlib.Path(p); tmp = p.with_name('.' + p.name + '.x'); tmp.write_text(json.dumps(v, sort_keys=True)); os.chmod(tmp, mode); os.replace(tmp, p)
    def receipt(self, saved, phase):
        return dict(schema=M.SCHEMA, phase=phase, source_sha=M.C, release_sha=M.RELEASE, manifest_sha256=M.MANIFEST,
                    state_manifest_sha256='x', slots={'slot1': {'generation': 1}}, backups=saved)
    def install(self):
        saved = M.backups(); M.atomic(M.MANIFEST_FILE, {'m': 1})
        receipt = dict(schema=M.SCHEMA, phase='active', source_sha=M.C, release_sha=M.RELEASE, manifest_sha256=M.MANIFEST,
                       state_manifest_sha256='x', slots={'slot1': {'generation': 1}}, backups=saved)
        for tgt, src in self.src.items(): M.I.put(src, tgt, 0o644)
        M.I.put(self.t / 'rulessrc' / 'rules.md', M.RULES, saved['rules']['mode'])
        M.rules_new_state()
        npol, ninv = M.next_values(self.pol, self.inv); M.atomic(M.R.POLICY, npol, mode=0o644); M.atomic(M.R.STATE / 'backup.json', ninv)
        return receipt
    def test_next_values(self):
        p, i = M.next_values(self.pol, self.inv)
        self.assertEqual((p['controller_sha'], p['stage_workflow_sha256'], p['recovery']['source_sha']), (M.C, M.STAGE_SHA, M.C))
        self.assertEqual(i['manifest'], M.MANIFEST)
    def test_restore_exact(self):
        pb = (self.t / 'policy.json').read_bytes(); ib = (self.t / 'state' / 'backup.json').read_bytes()
        receipt = self.install(); M.restore(receipt)
        for n, b in self.olds.items(): self.assertEqual((self.L / n).read_bytes(), b)
        self.assertEqual(M.RULES.read_bytes(), self.rules_old); self.assertEqual(stat.S_IMODE(M.RULES.stat().st_mode), 0o644)
        self.assertEqual((self.t / 'policy.json').read_bytes(), pb)
        self.assertEqual((self.t / 'state' / 'backup.json').read_bytes(), ib); self.assertEqual(receipt['phase'], 'rolled_back')
    def test_rollback_refuses_foreign_native_and_keeps_policy_disabled(self):
        receipt = self.install(); M.atomic(M.J, receipt); (self.t / 'state' / 'controller.lock').write_bytes(b'')
        M.NATIVE.write_bytes(b'someone else')
        with self.assertRaises(Exception): M.rollback()
        self.assertEqual(json.loads((self.t / 'policy.json').read_text())['mode'], 'disabled'); self.assertEqual(M.NATIVE.read_bytes(), b'someone else')
    def test_rollback_refuses_foreign_rules_and_keeps_policy_disabled(self):
        receipt = self.install(); M.atomic(M.J, receipt); (self.t / 'state' / 'controller.lock').write_bytes(b'')
        M.RULES.write_bytes(b'EOM 1.5 someone else')
        with self.assertRaises(Exception): M.rollback()
        self.assertEqual(json.loads((self.t / 'policy.json').read_text())['mode'], 'disabled'); self.assertEqual(M.RULES.read_bytes(), b'EOM 1.5 someone else')
    def test_rules_state_checks_fail_closed(self):
        M.rules_old_state()
        with self.assertRaises(Exception): M.rules_new_state()            # still EOM 1.3
        os.chmod(M.RULES, 0o664)
        with self.assertRaises(Exception): M.rules_old_state()            # group-writable
        os.chmod(M.RULES, 0o644); M.RULES.write_bytes(b'EOM 1.3 bytes!')   # same size class, different bytes
        with self.assertRaises(Exception): M.rules_old_state()
    def test_old_values_refuses_wrong_rules_backup(self):
        saved = M.backups(); M.atomic(M.MANIFEST_FILE, {'m': 1}); r = self.receipt(saved, 'active')
        M.old_values(r); (M.BK / 'rules').write_bytes(b'tampered')
        with self.assertRaises(Exception): M.old_values(r)
    def test_restore_rewrites_rules_after_partial_install(self):
        # crash after the manifest targets but BEFORE the rules copy: rules still EOM 1.3, restore must still be exact
        saved = M.backups(); M.atomic(M.MANIFEST_FILE, {'m': 1}); receipt = self.receipt(saved, 'content_installed')
        for tgt, src in self.src.items(): M.I.put(src, tgt, 0o644)
        M.restore(receipt)
        for n, b in self.olds.items(): self.assertEqual((self.L / n).read_bytes(), b)
        self.assertEqual(M.RULES.read_bytes(), self.rules_old)

if __name__ == '__main__':
    unittest.main(verbosity=2)
