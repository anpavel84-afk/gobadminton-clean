"""Fail-closed source contract for the installed DEV exact-job/step protocol.

Inspect the deliberately fixed workflow indentation with stdlib only; unknown
control syntax fails assertions rather than silently interpreting Actions YAML.
"""
import re
import unittest
from pathlib import Path


class DevWorkflow(unittest.TestCase):
    def test_exact_jobs_and_mandatory_checks_before_build(self):
        source = Path('.github/workflows/dev-deploy.yml').read_text()
        jobs = dict(re.findall(r'^  ([a-z]+):\n(.*?)(?=^  [a-z]+:|\Z)',
                               source.split('\njobs:\n', 1)[1], re.M | re.S))
        self.assertEqual(set(jobs), {'checks', 'images', 'deploy'})
        checks = jobs['checks']
        self.assertNotRegex(checks, r'^\s*(?:if|continue-on-error|needs):')
        self.assertNotIn('continue-on-error:', source)
        self.assertNotIn('if:', checks)
        self.assertIn('with: {ref: "${{ github.sha }}", fetch-depth: 0, persist-credentials: false}', checks)
        setup = checks.index('- uses: ./.github/actions/ci-setup')
        logging = checks.index('- name: Real API logging regression')
        fast = checks.index('- run: bash scripts/chatops/ci.sh fast\n')
        receiver = checks.index('- name: Isolated receiver, Ops, autonomy, client and path regressions')
        self.assertLess(setup, logging)
        self.assertLess(logging, fast)
        self.assertLess(fast, receiver)
        self.assertIn('run: pnpm --filter @gobadminton/api exec vitest run --project unit test/unit/api-logger.test.ts', checks)
        block = checks[receiver:]
        commands = [line.strip() for line in block.splitlines()[2:]]
        self.assertEqual(commands, [
            'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
            "find scripts/chatops -name '*.sh' -exec bash -n {} +",
            'node --check scripts/chatops/smoke.mjs',
            'python3 -B scripts/chatops/tests/test_dev_workflow.py',
            'python3 -B scripts/chatops/tests/test_autonomous_issues.py',
            'python3 -B scripts/chatops/tests/test_admin_deploy.py',
            'python3 -B scripts/chatops/tests/test_admin_path.py',
            'sudo python3 -B scripts/chatops/tests/test_helper.py',
        ])
        # The installed bridge requires the default Actions step display name:
        # "Run bash scripts/chatops/ci.sh fast" (no explicit name override).
        self.assertEqual(re.findall(r'^    needs: (.+)$', jobs['images'], re.M), ['checks'])
        self.assertEqual(re.findall(r'^    needs: (.+)$', jobs['deploy'], re.M), ['images'])
        self.assertNotRegex(jobs['images'], re.compile(r'^    if:', re.M))
        self.assertNotIn('always()', jobs['images'])


if __name__ == '__main__':
    unittest.main()
