"""#29: Google Antigravity custom-agent tool exposure (no model/providercall).

Contract: https://antigravity.google/docs/subagents?tab=cli
The custom-agent 'tools' YAML property defaults to [], not to init.tools.
"""
import inspect
import hashlib
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
    def setUp(self):
        from test_actions_train_agy_oauth_precharge import synthetic_vendor_preflight
        synthetic_vendor_preflight(self)
    def test_roles_have_exact_native_tools_and_qa_only_completion(self):
        for name,definition in (('qa',N.AGENT_DEF),('analysis',N.ANALYSIS_AGENT_DEF)):
            with self.subTest(role=name):
                agent,tools,body=metadata(definition)
                self.assertEqual(agent,N.AGENT)
                self.assertEqual(tools,['view_file','run_command'] + (['finish'] if name=='qa' else []))
                self.assertEqual(len(tools),len(set(tools)))
                self.assertNotIn('replace_file_content',tools)
                self.assertNotIn('write_to_file',tools)
                self.assertIn('mainAgent: true',definition.split('---',2)[1])
                self.assertIn('subagent: false',definition.split('---',2)[1])
                self.assertIn('inheritCustomizations: false',definition.split('---',2)[1])
                self.assertIn('mcpServers: []',definition.split('---',2)[1])
                self.assertNotIn('tools:',body)
        # Hash of the derived ANALYSIS_AGENT_DEF bytes at exact source base
        # acf27157cf39199f302929f7796e4e89d50a3381, not a regenerated expectation.
        self.assertEqual(hashlib.sha256(N.ANALYSIS_AGENT_DEF.encode()).hexdigest(),
            '8093a7faf36f7bf317ed31117722d3325fef77810aa3774ff7cc3749c9644e6d')
        self.assertIn('call native finish exactly once',metadata(N.AGENT_DEF)[2])
        self.assertIn('{verdict, findings, reviewed_sha}',metadata(N.AGENT_DEF)[2])
        self.assertIn('Do not merely print JSON',metadata(N.AGENT_DEF)[2])
        self.assertNotIn('finish',N.ANALYSIS_AGENT_DEF)

    def test_cli_routes_to_that_main_agent_not_generic_tools(self):
        with tempfile.TemporaryDirectory(prefix='gb-agy-tool-metadata-') as tmp:
            source=pathlib.Path(tmp)
            opts=N.command(60,analysis=True,source_root=str(source))
            self.assertEqual(opts[opts.index('--agent')+1],N.AGENT)
            self.assertEqual(opts[opts.index('--add-dir')+1],str(source))
            self.assertNotIn('--sandbox',opts)
            self.assertEqual(opts[opts.index('--input-format')+1],'stream-json')

    def test_argv_keeps_native_schema_and_os_boundary(self):
        qa=N.command(45)
        self.assertNotIn('--sandbox',qa)
        self.assertIn('--json-schema',qa)
        with tempfile.TemporaryDirectory(prefix='gb-agy-nosandbox-') as tmp:
            root=str(pathlib.Path(tmp).resolve())
            analysis=N.command(45,analysis=True,source_root=root)
        self.assertNotIn('--sandbox',analysis)
        self.assertNotIn('--json-schema',analysis)
        self.assertEqual(analysis[analysis.index('--add-dir')+1],root)
        for definition in (N.AGENT_DEF,N.ANALYSIS_AGENT_DEF):
            _agent,tools,body=metadata(definition)
            self.assertEqual(tools,['view_file','run_command'] + (['finish'] if definition==N.AGENT_DEF else []))
            self.assertIn('tools:\n  - view_file\n  - run_command\n',definition)
            self.assertNotIn('tools:',body)

    def test_review_gate_and_executor_boundary_are_not_weakened(self):
        self.assertEqual(N.READ_TOOLS,frozenset({'view_file','run_command'}))
        code=inspect.getsource(N.analysis_source_gate)
        self.assertIn('READ_TOOLS <= set(evidence[',code)
        self.assertIn("downgraded=dict(result,completion='INCOMPLETE')",code)
        source=inspect.getsource(N.invoke)
        self.assertNotIn('apparmor',source.lower())
        self.assertIn('_verify_executor_boundary()',source)
        self.assertIn('no_new_privileges()',source)
        self.assertNotIn('_landlock(readonly,writable,executables)',source)
        self.assertIn('ANALYSIS_AGENT_DEF if analysis else AGENT_DEF',source)
        self.assertNotIn('writable_roots',source)
        self.assertNotIn('readonly_roots',source)
        self.assertIn('owner_waiver=OWNER_WAIVER',source)
        self.assertIn('not verified safety',N.OWNER_WAIVER)

    def test_exact_agent_definition_is_written_before_native_exec(self):
        """Fake Popen: inspect the actual private .agents/agents path; 0 provider calls."""
        with tempfile.TemporaryDirectory(prefix='gb-agy-agent-emission-') as tmp:
            work=pathlib.Path(tmp)/'candidate';work.mkdir()
            seen=[];charged=[]
            def popen(_argv,**kwargs):
                self.assertEqual(charged,['test_seam'])
                path=pathlib.Path(kwargs['cwd'])/'.agents/agents'/(N.AGENT+'.md')
                definition=path.read_text()
                agent,tools,body=metadata(definition)
                seen.append((agent,tools,body,definition))
                return subprocess.Popen(['/usr/bin/python3','-I','-c',
                    'import sys;sys.stdin.buffer.read();print("{}")'],**kwargs)
            with patch.object(N,'qualification',return_value={'phase':'canary'}),\
                 patch.object(N.os,'geteuid',return_value=978),\
                 patch.object(N,'trusted',return_value=b'synthetic-token'),\
                 patch.object(N,'AGY','/usr/bin/python3'),\
                 patch.object(N,'git',return_value=str(work/'.git').encode()),\
                 patch.object(N,'filesystem_roots',return_value=([],[],[])),\
                 patch.object(N,'_prepare_invocation_cgroup',return_value=None),\
                 patch.object(N,'_observe_cgroup_membership',return_value=False),\
                 patch.object(N,'_executor_reap_state',return_value='synthetic-no-host-check'),\
                 patch('native_guard.no_new_privileges',return_value=None),patch.object(N,'_verify_executor_boundary',return_value=None),patch.object(N,'_candidate_state',return_value=('H','')) :
                # This fake-Popen test validates agent-file emission only; the
                # executor-boundary preflight is tested separately.
                for analysis in (False,True):
                    charged.clear()
                    raw,receipt=N.invoke('test inert no-model',45,
                        work=work,slot='slot2',task_hash='0'*64,
                        charge=lambda:charged.append('test_seam'),
                        popen=popen,analysis=analysis,
                        evidence_dir=pathlib.Path(tmp)/'evidence')
                    self.assertEqual(raw.strip(),b'{}')
                    self.assertEqual(charged,['test_seam'])
            self.assertEqual(len(seen),2)
            for emitted,expected in zip(seen,(N.AGENT_DEF,N.ANALYSIS_AGENT_DEF)):
                self.assertEqual(emitted[0],N.AGENT)
                self.assertEqual(emitted[3].encode(),expected.encode())
            self.assertEqual(seen[0][1],['view_file','run_command','finish'])
            self.assertEqual(seen[1][1],['view_file','run_command'])
            self.assertEqual(receipt['candidate_integrity'],'detected_accidental_modification_only')
            self.assertEqual(receipt['filesystem_boundary'],'uid978_unix_permissions_nnp')
            self.assertIn('malicious same-uid',receipt['residual_risk'])
            self.assertNotIn('candidate_access',receipt)

if __name__=='__main__':
    unittest.main()
