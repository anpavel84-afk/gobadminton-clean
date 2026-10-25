"""Offline controlled source-matrix expansion, not actual Actions evidence.

Other jobs use the existing gate-fixture pattern; source steps come from ci.yml.
Unknown source-step syntax fails closed. No installed executor is invoked/edited.
"""
import copy
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('gate', ROOT / 'scripts/chatops/autonomous_issues.py')
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)
SHA = 'a' * 40


class ProductWorkflow(unittest.TestCase):
    def setUp(self):
        self.source = (ROOT / '.github/workflows/ci.yml').read_text()
        jobs = dict(re.findall(r'^  ([a-z]+):\n(.*?)(?=^  [a-z]+:|\Z)',
                               self.source.split('\njobs:\n', 1)[1], re.M | re.S))
        self.assertEqual(set(jobs), {'foundation', 'source', 'database', 'receiver'})
        matrix = re.search(r'^        package: \[(.*)\]$', jobs['source'], re.M)
        self.packages = matrix[1].split(', ')
        self.assertEqual(self.packages, ['api', 'web', 'admin', 'contracts'])
        raw = jobs['source'].split('    steps:\n', 1)[1]
        self.steps = []
        for block in re.split(r'^      - ', raw, flags=re.M)[1:]:
            lines = block.splitlines()
            step = {}
            for i, line in enumerate(lines):
                if i:
                    self.assertTrue(line.startswith('        '))
                    line = line[8:]
                key, value = line.split(': ', 1)
                self.assertIn(key, {'name', 'uses', 'run', 'if', 'with'})
                self.assertNotIn(key, step)
                if value == '|':
                    self.assertEqual(key, 'run')
                    step[key] = '\n'.join(x[10:] for x in lines[i+1:]) + '\n'
                    break
                step[key] = value
            self.steps.append(step)
        self.assertEqual(len(self.steps), 6)
        self.assertEqual(self.steps[0]['uses'],
                         'actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683')
        self.assertEqual(self.steps[1], {'uses': './.github/actions/ci-setup'})
        for step, command in zip(self.steps[2:5], ('typecheck', 'lint', 'test:unit')):
            expected = {'run': 'pnpm --filter @gobadminton/${{ matrix.package }} run ' + command}
            if command != 'typecheck':
                expected['if'] = 'success() || failure()'
            self.assertEqual(step, expected)
        self.addon = self.steps[-1]
        self.assertEqual(set(self.addon), {'name', 'run'})
        self.assertTrue(self.addon['name'].startswith('Admin-only extra '))
        self.assertNotIn('continue-on-error', self.source)

    def expanded(self):
        jobs = [dict(name=n, status='completed', conclusion='success', steps=[
            dict(name=s, status='completed', conclusion='success')
            for s in gate.REQUIRED_STEPS[n]])
            for n in sorted(gate.CI_JOBS) if not n.startswith('source (')]
        for package in self.packages:
            steps = []
            for step in self.steps:
                self.assertIn(step.get('if'), (None, 'success() || failure()'))
                name = step.get('name') or 'Run ' + step.get('run', step.get('uses')).splitlines()[0]
                name = name.replace('${{ matrix.package }}', package)
                steps.append(dict(name=name, status='completed', conclusion='success'))
            name = f'source ({package})'
            self.assertTrue(gate.REQUIRED_STEPS[name] <= {s['name'] for s in steps})
            jobs.append(dict(name=name, status='completed', conclusion='success', steps=steps))
        return jobs

    def test_real_gate_accepts_expansion_and_rejects_previous_skips(self):
        jobs = self.expanded()
        run = dict(head_sha=SHA, event='push', status='completed', conclusion='success')
        self.assertTrue(gate.successful(run, jobs, SHA, gate.CI_JOBS))
        for package in self.packages:
            job = next(j for j in jobs if j['name'] == f'source ({package})')
            for required in gate.REQUIRED_STEPS[job['name']]:
                bad = copy.deepcopy(jobs)
                target = next(j for j in bad if j['name'] == job['name'])
                next(s for s in target['steps'] if s['name'] == required)['conclusion'] = 'skipped'
                with self.subTest(package=package, required=required), self.assertRaises(gate.Hold):
                    gate.successful(run, bad, SHA, gate.CI_JOBS)
            if package == 'admin':
                continue
            bad = copy.deepcopy(jobs)
            target = next(j for j in bad if j['name'] == job['name'])
            target['steps'][-1:] = [dict(name=name, status='completed', conclusion='skipped') for name in (
                'Execute dependency-free Admin path regression on pinned Node',
                'Build Admin standalone images at root and /admin (no push)')]
            with self.subTest(previous_yaml_if=package), self.assertRaisesRegex(gate.Hold, 'unexpected skipped step'):
                gate.successful(run, bad, SHA, gate.CI_JOBS)

    def test_receiver_has_full_history_for_immutable_controller_provenance(self):
        receiver = self.source.split('\n  receiver:\n', 1)[1]
        self.assertIn(
            '      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n'
            '        with: {fetch-depth: 0, persist-credentials: false}\n', receiver)

    def test_actual_addon_shell_dispatch_and_fail_closed(self):
        expected = [
            'python3 -B scripts/chatops/tests/test_admin_path.py',
            'docker build --network=default -f apps/admin/Dockerfile -t admin-ci-root .',
            'docker build --network=default --build-arg ADMIN_DEV_PATH_BUILD=1 -f apps/admin/Dockerfile -t admin-ci-path .',
            'python3 -B scripts/chatops/tests/admin-standalone-http.py',
        ]
        # Functions replace only external commands in this disposable shell;
        # execute the actual workflow block, including its fail-fast semantics.
        stubs = '''
python3() { echo "python3 $*"; case "$*" in *admin-standalone-http.py*) [ "$FAIL_AT" != http ];; *) [ "$FAIL_AT" != path ];; esac; }
docker() { echo "docker $*"; case "$*" in *admin-ci-root*) [ "$FAIL_AT" != root ];; *admin-ci-path*) [ "$FAIL_AT" != pathbuild ];; *) return 99;; esac; }
'''
        for package in self.packages:
            for fail in ('none', 'path', 'root', 'pathbuild', 'http'):
                script = stubs + self.addon['run'].replace('${{ matrix.package }}', package)
                result = subprocess.run(['bash', '--noprofile', '--norc', '-c', script],
                                        env=dict(os.environ, FAIL_AT=fail), text=True, capture_output=True)
                count = {'none': 4, 'path': 1, 'root': 2, 'pathbuild': 3, 'http': 4}[fail] if package == 'admin' else 0
                with self.subTest(package=package, fail=fail):
                    self.assertEqual(result.stdout.splitlines(), expected[:count])
                    self.assertEqual(result.returncode == 0, package != 'admin' or fail == 'none', result.stderr)


if __name__ == '__main__':
    unittest.main()
