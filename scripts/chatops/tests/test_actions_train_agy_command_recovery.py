"""Issue #29: no-model guard for actual native run_command attempt."""
import inspect
import sys
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N

class CommandRecovery(unittest.TestCase):
    def test_analysis_agent_requires_first_real_command_event(self):
        a=N.ANALYSIS_AGENT_DEF
        self.assertIn('Before any analysis or view_file, ATTEMPT one actual native run_command',a)
        self.assertIn('only report unavailability after an actual native tool call',a)
        self.assertIn('report INCOMPLETE',a)
        self.assertIn('Never substitute a shell command typed into the final response',a)
        self.assertNotIn('BEFORE_CLAIM_COMPLETE_NO_TOOL',a)

    def test_addressed_prompt_explicit_first_invocation(self):
        source=inspect.getsource(N.review)
        self.assertIn('FIRST make an actual native run_command tool call',source)
        self.assertIn('Do not merely describe the command',source)
        self.assertIn('Then inspect relevant dependencies',source)

    def test_strict_gate_not_weakened(self):
        self.assertEqual(N.READ_TOOLS, frozenset(('view_file','run_command')))
        source=inspect.getsource(N.analysis_source_gate)
        self.assertIn('READ_TOOLS <= set(evidence[',source)
        self.assertIn("downgraded=dict(result,completion='INCOMPLETE')",source)

if __name__=='__main__':unittest.main()
