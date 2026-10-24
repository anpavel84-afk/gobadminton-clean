"""#29: Google Antigravity custom-agent tool exposure (no model/providercall).

Contract: https://antigravity.google/docs/subagents?tab=cli
The custom-agent 'tools' YAML property defaults to [], not to init.tools.
"""
import inspect
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'actions_train'))
import native_antigravity as N


def metadata(definition):
    """Parse only the bounded portion relevant to this custom-agent contract."""
    blocks=definition.split('---',2)
    if len(blocks)!=3 or blocks[0]!='':
        raise AssertionError('missing valid leading YAML frontmatter')
    front=blocks[1]
    agent=re.search(r'^name: ([a-z0-9-]+)$',front,re.M)
    toolblock=re.search(r'^tools:\n((?:  - [a-z_]+\n)+)',front,re.M)
    if not agent or not toolblock:
        raise AssertionError('no explicit agent identity or tool permissions')
    return agent.group(1),re.findall(r'^  - ([a-z_]+)$',toolblock.group(1),re.M),blocks[2]


class NativeAgentExposure(unittest.TestCase):
    def test_both_roles_have_exact_two_native_tools(self):
        for name,definition in (('qa',N.AGENT_DEF),('analysis',N.ANALYSIS_AGENT_DEF)):
            with self.subTest(role=name):
                agent,tools,body=metadata(definition)
                self.assertEqual(agent,N.AGENT)
                self.assertEqual(tools,['view_file','run_command'])
                self.assertEqual(len(tools),len(set(tools)))
                self.assertNotIn('replace_file_content',tools)
                self.assertNotIn('write_to_file',tools)
                self.assertIn('mainAgent: true',definition.split('---',2)[1])
                self.assertIn('subagent: false',definition.split('---',2)[1])
                self.assertIn('inheritCustomizations: false',definition.split('---',2)[1])
                self.assertIn('mcpServers: []',definition.split('---',2)[1])
                self.assertNotIn('tools:',body)

    def test_cli_routes_to_that_main_agent_not_generic_tools(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-tool-metadata-') as tmp:
            source=pathlib.Path(tmp)
            opts=N.command(60,analysis=True,source_root=str(source))
            self.assertEqual(opts[opts.index('--agent')+1],N.AGENT)
            self.assertEqual(opts[opts.index('--add-dir')+1],str(source))
            self.assertIn('--sandbox',opts)
            self.assertEqual(opts[opts.index('--input-format')+1],'stream-json')

    def test_review_gate_and_mandatory_apparmor_are_not_weakened(self):
        self.assertEqual(N.READ_TOOLS,frozenset({'view_file','run_command'}))
        code=inspect.getsource(N.analysis_source_gate)
        self.assertIn('READ_TOOLS <= set(evidence[',code)
        self.assertIn("downgraded=dict(result,completion='INCOMPLETE')",code)
        source=inspect.getsource(N.invoke)
        self.assertIn('_arm_apparmor_onexec()',source)
        self.assertIn('no_new_privileges()',source)
        self.assertNotIn('_landlock(readonly,writable,executables)',source)
        self.assertIn('ANALYSIS_AGENT_DEF if analysis else AGENT_DEF',source)
        self.assertIn("writable_roots=['invocation_private_root','/dev/null']",source)

    def test_exact_agent_definition_is_written_before_native_exec(self):
        """Fake Popen: inspect the actual private .agents/agents path; 0 provider calls."""
        with tempfile.TemporaryDirectory(prefix='gb-agy-agent-emission-') as tmp:
            work=pathlib.Path(tmp)/'candidate';work.mkdir()
            subprocess.run(['/usr/bin/git','init','-q',str(work)],check=True)
            seen=[];charged=[]
            def popen(_argv,**kwargs):
                self.assertEqual(charged,['test_seam'])
                path=pathlib.Path(kwargs['cwd'])/'.agents/agents'/(N.AGENT+'.md')
                agent,tools,body=metadata(path.read_text())
                seen.append((agent,tools,body))
                return subprocess.Popen(['/usr/bin/python3','-I','-c',
                    'import sys;sys.stdin.buffer.read();print("{}")'],**kwargs)
            with patch.object(N,'qualification',return_value={'phase':'canary'}),\
                 patch.object(N.os,'geteuid',return_value=978),\
                 patch.object(N,'trusted',return_value=b'synthetic-token'),\
                 patch.object(N,'AGY','/usr/bin/python3'):
                raw,receipt=N.invoke('test inert no-model',45,
                    work=work,slot='slot2',task_hash='0'*64,
                    charge=lambda:charged.append('test_seam'),
                    popen=popen,analysis=True,
                    evidence_dir=pathlib.Path(tmp)/'evidence')
            self.assertEqual(raw.strip(),b'{}')
            self.assertEqual(len(seen),1)
            self.assertEqual(seen[0][0],N.AGENT)
            self.assertEqual(seen[0][1],['view_file','run_command'])
            self.assertEqual(charged,['test_seam'])
            self.assertEqual(receipt['candidate_access'],'read_only')

if __name__=='__main__':
    unittest.main()
