"""Closed addressed analysis contract, synthetic sanitized streams; no provider/Git writes."""
import copy
import hashlib
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock,patch
from test_actions_train import core,stage,HEAD,BASE,req
from test_actions_train_antigravity import rows,wire,CID
import native_antigravity as N
import antigravity_qa_recovery as Q


def grant(role=N.ANALYSIS_ROLE):
    return dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,owner_comment=6362661117,
        role=role,controller_revision='c'*40,cli_sha256=N.AGY_SHA256,
        rules_sha256=__import__('context_policy').RULES_SHA256,base=BASE,head=HEAD,input_revision=HEAD,
        input_path=Q.ANALYSIS_INPUT,input_sha256=Q.ANALYSIS_INPUT_SHA256,timeout=1800,
        max_output_bytes=N.MAX_OUT,permission_mode=N.PERMISSION_MODE,input_transport='stream-json',ceiling=1)


def binding():return dict(role=N.ANALYSIS_ROLE,input_fingerprint=core.digest(grant()))


def answer():return dict(**binding(),completion='COMPLETE',analysis='Requirements and staged plan',
                         evidence=['Exact INERT task goal and acceptance'],limitations=[])


def stream():
    e=rows();e=[x for x in e if x.get('step_update',{}).get('step_type')!='finish']
    e[0]['init'].pop('json_schema');e[0]['init']['tools']=['view_file','manage_task']
    e[-1]['result'].pop('structured_output');e[-1]['result']['response']=json.dumps(answer())
    return e


class AnalysisProtocol(unittest.TestCase):
    def test_complete_without_finish_shell_or_schema_is_analysis_only(self):
        value,receipt=N.parse_stream(wire(stream()),HEAD,analysis_binding=binding())
        self.assertEqual(value,answer());self.assertNotIn('verdict',value)
        self.assertEqual(receipt['tool_names'],[])
        self.assertNotIn('--json-schema',N.command(30,analysis=True))
        self.assertIn('--json-schema',N.command(30))
        self.assertIn('--sandbox',N.command(30,analysis=True))
        self.assertEqual(N.input_payload('full stdin')[1]['input_transport'],'stream-json')
        for completion in ('COMPLETE','INCOMPLETE'):
            value=answer()|{'completion':completion}
            self.assertEqual(N.analysis_canonical(value,binding()),value)
    def test_entire_response_duplicate_keys_multiple_objects_trailing_text(self):
        good=json.dumps(answer())
        for text in (good+' prose',good+good,'before '+good,
                     good[:-1]+',"completion":"COMPLETE"}', '[%s]'%good,
                     '{"role":"technical_pm_product_analyst","x":NaN}',good[:20]):
            e=stream();e[-1]['result']['response']=text
            with self.subTest(text=text[:60]),self.assertRaises(N.ReviewError):
                N.parse_stream(wire(e),HEAD,analysis_binding=binding())
    def test_schema_role_fingerprint_and_model_binding_rejection(self):
        for change in ({'role':'independent_qa'},{'input_fingerprint':'0'*64},
                       {'verdict':'PASS'},{'completion':'PASS'},{'analysis':''},
                       {'completion':'COMPLETE','evidence':[]}):
            e=stream();e[-1]['result']['response']=json.dumps(answer()|change)
            with self.subTest(change=change),self.assertRaises(N.ReviewError):
                N.parse_stream(wire(e),HEAD,analysis_binding=binding())
        for field,value in (('model','other'),('agent','other'),('permission_mode','request-review')):
            e=stream();e[0]['init'][field]=value
            with self.assertRaises(N.ReviewError):N.parse_stream(wire(e),HEAD,analysis_binding=binding())
    def test_bad_full_stream_and_tool_lifecycle_rejected(self):
        bad=[]
        e=stream();e.insert(1,copy.deepcopy(e[0]));bad.append(e)
        e=stream();e.append(copy.deepcopy(e[-1]));bad.append(e)
        bad.extend([stream()[:-1],stream()[1:]])
        for place in (0,-1):
            e=stream();e[place]['permissionDenied']=True;bad.append(e)
        for change in ({'conversation_id':'other'},{'model':'other'},{'status':'ERROR'}):
            e=stream();e[-1]['result'].update(change);bad.append(e)
        for state,extra in [('ACTIVE',{}),('ERROR',{}),('DONE',{'tool_info':{'error':'denied'}})]:
            e=stream();e.insert(2,dict(event='step_update',step_update=dict(
                conversation_id=CID,step_type='tool',step_index=7,tool_name='view_file',state=state,**extra)))
            bad.append(e)
        e=stream();tool=dict(conversation_id=CID,step_type='tool',step_index=7,tool_name='view_file',state='DONE')
        e[2:2]=[dict(event='step_update',step_update=tool),
                dict(event='step_update',step_update=tool|{'state':'ACTIVE'})];bad.append(e)
        for e in bad:
            with self.subTest(events=e),self.assertRaises(N.ReviewError):
                N.parse_stream(wire(e),HEAD,analysis_binding=binding())
        with self.assertRaises(N.ReviewError):N.parse_stream(wire(stream())[:-9],HEAD,analysis_binding=binding())
    def test_historical_bad_contract_stays_negative_for_both_roles(self):
        # Synthetic reproduction of supplied PROVEN findings; no private stream copied.
        # JOB/historical-native-stream.jsonl is absent from this author snapshot.
        e=stream();e[-1]['result']['response']='{"verdict":"FAIL"}\nintermediate text\n{"verdict":"FAIL"}'
        with self.assertRaises(N.ReviewError):N.parse_stream(wire(e),HEAD)
        with self.assertRaises(N.ReviewError):N.parse_stream(wire(e),HEAD,analysis_binding=binding())
        e.insert(-1,rows()[3])  # Added finish still cannot supply missing structured_output.
        e[0]['init']['json_schema']=N.SCHEMA;e[0]['init']['tools'].append('finish')
        with self.assertRaises(N.ReviewError):N.parse_stream(wire(e),HEAD)
    def test_strict_old_qa_and_canonical_are_unchanged(self):
        self.assertEqual(N.parse_stream(wire(rows()),HEAD)[0]['verdict'],'PASS')
        with self.assertRaises(N.ReviewError):N.canonical(answer(),HEAD)


class AnalysisStage(unittest.TestCase):
    def test_analysis_complete_cannot_qualify_or_write_product_checkpoint(self):
        g=grant();q=dict(issue=29,base=BASE,head=HEAD,work=str(N.QUALIFICATION_WORK),
            adapter_revision=g['controller_revision'],qualification_grant=g,
            task_sha256=core.digest(N.qualification_task(BASE,HEAD,adapter_revision=g['controller_revision'],qualification_grant=g)))
        counts=iter([3,4]);store=SimpleNamespace(data={'active':None,'done':[152,205,216]})
        rt=SimpleNamespace(budget=SimpleNamespace(used=lambda *a:next(counts)))
        b=SimpleNamespace(c=SimpleNamespace(state_dir=Path('/not-written')))
        context=(SimpleNamespace(subprocess=SimpleNamespace(Popen=Mock())),Mock(),rt,Mock(),store,b)
        request=req('qa_qualification','idle')|dict(slot='slot2',issue=29,attempt=0,_qa_qualification=q)
        marker=dict(qualification=q)
        with patch.object(N,'qualification',return_value=marker),patch.object(N,'qualification_descriptor',return_value=q), \
             patch('context_policy.load',return_value=('trusted',{})),patch.object(Q,'addressed_input',return_value='INERT'), \
             patch.object(N,'review',return_value=(answer(),{'tool_names':[]})) as review, \
             patch.object(N,'save_receipt',return_value='receipt.json'):
            before=copy.deepcopy(store.data)
            out=stage.qualify_qa(request,{},context)
        self.assertEqual(store.data,before);self.assertTrue(out['analysis_complete'])
        self.assertFalse(out['qualification_passed']);self.assertNotIn('qa',out)
        self.assertEqual(review.call_args.kwargs['analysis_grant'],g)
        self.assertFalse(Q.acceptance_match(dict(task_hash=q['task_sha256']),q))
    def test_review_records_exact_full_context_and_analysis_receipt(self):
        g=grant();captured={}
        with tempfile.TemporaryDirectory() as d:
            def git(work,*args,**kw):return HEAD.encode() if args[0]=='rev-parse' else b''
            def invoke(text,*args,**kw):
                captured.update(text=text,kwargs=kw)
                return wire(stream()),{'input_delivery':'written'}
            with patch.object(N,'git',side_effect=git),patch.object(Q,'addressed_input',return_value='EXACT_INERT_INPUT'), \
                 patch('context_policy.inject',side_effect=lambda text,*a:('TRUSTED_RULES\nEND TRUSTED OPERATING RULES.\nRole: qa.\n'+text,{'sha256':'f'*64})), \
                 patch.object(N,'invoke',side_effect=invoke):
                value,receipt=N.review(Path('/candidate'),BASE,HEAD,'ignored QA text',1800,
                    slot='slot2',task_hash='f'*64,charge=Mock(),analysis_grant=g,evidence_dir=Path(d)/'evidence')
            self.assertIn('EXACT_INERT_INPUT',captured['text']);self.assertIn(core.digest(g),captured['text'])
            self.assertTrue(captured['kwargs']['analysis']);self.assertNotIn('verdict',receipt)
            self.assertEqual(receipt['review_kind'],'native_issue230_analysis')
            self.assertEqual(receipt['input_sha256'],hashlib.sha256(captured['text'].encode()).hexdigest())
            self.assertEqual(receipt['input_delivery'],'written')
            self.assertEqual(receipt['analysis_completion'],'COMPLETE')

class NativeAnalysisTransport(unittest.TestCase):
    def test_full_stdin_eof_private_agent_and_unchanged_boundary_without_schema(self):
        import subprocess
        with tempfile.TemporaryDirectory() as d:
            captured={};charge=Mock()
            candidate=Path(d)/'synthetic-candidate'
            candidate.mkdir()
            (candidate/'.git').mkdir()
            class Process:
                pid=99999999;returncode=0
                def communicate(self,input,timeout):captured['stdin']=input;self._input_offset=len(input)
                def wait(self):return 0
                def poll(self):return 0
            def popen(argv,**kwargs):
                charge.assert_called_once();captured['argv']=argv
                self.assertEqual(kwargs['stdin'],subprocess.PIPE)
                self.assertTrue(callable(kwargs['preexec_fn']))
                agent=(Path(kwargs['cwd'])/'.agents/agents'/ (N.AGENT+'.md')).read_text()
                self.assertEqual(agent,N.ANALYSIS_AGENT_DEF)
                kwargs['stdout'].write(wire(stream()));kwargs['stdout'].flush()
                return Process()
            with patch.object(N,'qualification',return_value={'phase':'canary'}),patch.object(N.os,'geteuid',return_value=978), \
                 patch.object(N,'trusted',return_value=b'synthetic-auth-not-a-credential'), \
                 patch.object(N,'git',return_value=str(candidate/'.git').encode()), \
                 patch.object(N,'filesystem_roots',return_value=([],[],[])) as roots,patch.object(N.os,'killpg'):
                raw,receipt=N.invoke('EXACT INPUT 漢字',1800,work=candidate,slot='slot2',task_hash='f'*64,
                    charge=charge,popen=popen,analysis=True,evidence_dir=Path(d)/'evidence')
            self.assertEqual(json.loads(captured['stdin'])['message']['content'],'EXACT INPUT 漢字')
            self.assertTrue(captured['stdin'].endswith(b'\n'));self.assertNotIn('--json-schema',captured['argv'])
            self.assertIn('--sandbox',captured['argv']);self.assertIn('--dangerously-skip-permissions',captured['argv'])
            self.assertIn('--add-dir',captured['argv'])
            self.assertEqual(captured['argv'][captured['argv'].index('--add-dir')+1],str(candidate.resolve()))
            self.assertEqual(receipt['input_delivery'],'written');self.assertEqual(receipt['filesystem_boundary'],'uid978_apparmor_enforce_and_native_cli_sandbox')
            roots.assert_called_once()
            meta=json.loads(sorted((Path(d)/'evidence').glob('*/phase-*.json'))[-1].read_text())
            self.assertEqual(meta['exit_code'],0);self.assertTrue(meta['terminal'])
            self.assertEqual(meta['streams']['stdout']['retained_bytes'],len(raw))
