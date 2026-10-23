"""Prospective PR227 routing compatibility. Offline fixtures, no provider calls."""
import copy
import hashlib
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from test_actions_train import core, S
import test_actions_train_cost_policy as C
import test_actions_train_antigravity as A
import native_antigravity as N
import cost_policy as P

class ModelProtocol(unittest.TestCase):
    def test_requested_catalog_model_reaches_argv_and_exact_init_receipt(self):
        for model in N.MODELS:
            with self.subTest(model=model):
                cmd=N.command(30,'EXACT_FINAL_PROMPT',model=model)
                self.assertEqual(cmd[cmd.index('--model')+1],model)
                self.assertEqual(cmd[-2:],['-p','EXACT_FINAL_PROMPT'])
                events=A.rows();events[0]['init']['model']=model
                result,receipt=N.parse_stream(A.wire(events),A.SHA,model=model)
                self.assertEqual(result['verdict'],'PASS')
                self.assertEqual(receipt['requested_model'],model)
                self.assertEqual(receipt['effective_model'],model)
                self.assertIsNone(receipt['effort'])
                wrong='claude-opus-5-5-high' if model==N.MODEL else N.MODEL
                events[0]['init']['model']=wrong
                with self.assertRaises(N.ReviewError):
                    N.parse_stream(A.wire(events),A.SHA,model=model)
    def test_review_threads_selected_model_into_exact_final_prompt_and_receipt(self):
        model='claude-sonnet-5-5-high';events=A.rows();events[0]['init']['model']=model
        seen=[]
        def git(work,*args,**kwargs):
            return A.SHA.encode() if args[0]=='rev-parse' else b''
        def invoke(prompt,*args,**kwargs):
            seen.append((prompt,kwargs['model']))
            return A.wire(events),{'qualification_phase':'ready'}
        with tempfile.TemporaryDirectory(prefix='gb-team-qa-evidence-') as temp, \
             patch.object(N,'git',side_effect=git),patch.object(N,'collect',return_value=('SOURCE_SENTINEL',{})), \
             patch('context_policy.inject',return_value=('TRUSTED_FINAL_ARGV_SOURCE_SENTINEL',{'stdin_sha256':'legacy'})), \
             patch.object(N,'invoke',side_effect=invoke):
            result,r=N.review(Path('/candidate'),'b'*40,A.SHA,'task',60,
                slot='slot2',task_hash='hash',charge=Mock(),model=model,accepted_rules=('rules',{}),evidence_dir=Path(temp)/'evidence')
            metadata=json.loads(sorted((Path(temp)/'evidence').glob('*/phase-*.json'))[-1].read_text())
            self.assertEqual(metadata['requested_model'],model)
            self.assertEqual(metadata['effective_model'],model)
            self.assertEqual(metadata['status'],'success')

        self.assertEqual(seen,[('TRUSTED_FINAL_ARGV_SOURCE_SENTINEL',model)])
        self.assertEqual(r['requested_model'],model)
        self.assertEqual(r['effective_model'],model)
        self.assertEqual(r['input_sha256'],hashlib.sha256(seen[0][0].encode()).hexdigest())
        self.assertEqual(r['rules_context']['delivery'],'explicit_full_argv')
        self.assertNotIn('stdin_sha256',r['rules_context'])
    def test_unknown_models_fail_before_invocation(self):
        with patch.object(N,'invoke',side_effect=AssertionError('provider called')):
            for model in ('gemini-3.8-flash-medium','claude-sonnet-5-5','auto'):
                with self.assertRaises(N.ReviewError):N.command(30,'prompt',model=model)
                with self.assertRaises(N.ReviewError):N.parse_stream(A.wire(A.rows()),A.SHA,model=model)
    def marker(self,phase='ready'):
        return dict(schema='GB_ANTIGRAVITY_QA_29_V1',phase=phase,executor_uid=978,
                    slot='slot2',canary_task_sha256='exact',
                    modules={name:hashlib.sha256(Path(N.__file__).with_name(name).read_bytes()).hexdigest()
                             for name in ('native_antigravity.py','native_guard.py')})
    def check(self,marker,model):
        def trusted(path,**kwargs):
            if path==N.MARKER:return json.dumps(marker).encode()
            if str(path)==N.AGY:return b'trusted-cli-fixture'
            return b'private-auth-fixture'
        with patch.object(N,'trusted',side_effect=trusted), \
             patch.object(N,'AGY_SHA256',hashlib.sha256(b'trusted-cli-fixture').hexdigest()):
            return N.qualification('slot2','exact',model=model)
    def test_medium_canary_never_qualifies_other_models(self):
        marker=self.marker('canary');marker['admitted_models']=list(N.MODELS)
        self.check(marker,N.MODEL)
        for model in N.MODELS-{N.MODEL}:
            with self.assertRaises(N.ReviewError):self.check(marker,model)
        self.assertEqual(N.qualification_task('a'*40,'b'*40)['model'],N.MODEL)
        self.assertEqual(N.qualification_task('a'*40,'b'*40)['max_calls'],1)
    def test_ready_medium_marker_needs_explicit_per_model_admission(self):
        marker=self.marker();self.check(marker,N.MODEL)
        for model in N.MODELS-{N.MODEL}:
            with self.assertRaises(N.ReviewError):self.check(marker,model)
            explicit=marker|dict(admitted_models=[N.MODEL,model])
            self.check(explicit,model)
        for models in (['auto'],[N.MODEL,N.MODEL],[],True):
            with self.assertRaises(N.ReviewError):
                self.check(marker|dict(admitted_models=models),N.MODEL)

class CostRoutes(unittest.TestCase):
    def setUp(self):
        self.budget=Mock(remaining=lambda *a:10,used=lambda *a:0)
    def task(self,level):
        t=C.cost_task('complex',level)
        t['routing_policy']['schema']='GB_STAGE_COST_V2'
        t['author_routes']=['cursor:auto','codex:gpt-6.1-sol:high']
        model={'standard':N.MODEL,'complex':'claude-sonnet-5-5-high','critical':'claude-opus-5-5-high'}[level]
        t['qa_routes']=['agy:'+model,'codex:gpt-6.1-sol:medium' if level=='standard' else 'codex:gpt-6.1-sol:high']
        return t
    def test_exact_agy_preference_for_standard_complex_critical_without_mutation(self):
        for level in ('standard','complex','critical'):
            t=self.task(level);before=copy.deepcopy(t)
            with patch.object(N,'available',return_value=(True,'exact qualified model')) as available:
                route=core.route(S,t,'qa','auto',self.budget,'slot2')
            model=t['qa_routes'][0].split(':')[1]
            self.assertEqual(route['effective_model'],model)
            self.assertEqual(route['requested_model'],model)
            self.assertIsNone(route['effort'])
            available.assert_called_once_with('slot2',core.digest(t),model=model)
            self.assertEqual(t,before)
    def test_complex_qualified_fallback_is_explicit_sol_high(self):
        t=self.task('complex')
        with patch.object(N,'available',return_value=(False,'model not qualified')):
            r=core.route(S,t,'qa','auto',self.budget,'slot2')
        self.assertEqual((r['provider'],r['effective_model'],r['effort']),('codex','gpt-6.1-sol','high'))
        self.assertEqual(r['requested_route'],'agy:claude-sonnet-5-5-high')
        self.assertTrue(r['fallback_reason'])
        t['qa_routes'].pop()
        with patch.object(N,'available',return_value=(False,'model not qualified')):
            with self.assertRaises(core.Refused):core.route(S,t,'qa','auto',self.budget,'slot2')
    def test_critical_never_silently_substitutes_listed_sol_or_astra(self):
        t=self.task('critical');t['qa_routes'].append('codex:gpt-6-astra:high')
        selected,why=P.selection(t,'qa')
        self.assertEqual(selected,'agy:claude-opus-5-5-high')
        self.assertEqual(why['approved_fallback_routes'],[])
        with patch.object(N,'available',return_value=(False,'Opus unavailable')), \
             patch.object(S,'adapter_status',side_effect=AssertionError('unsafe Codex QA fallback')):
            with self.assertRaises(core.Refused):core.route(S,t,'qa','auto',self.budget,'slot2')
    def test_explicit_agy_profile_never_uses_codex(self):
        with patch.object(N,'available',return_value=(False,'unavailable')):
            with self.assertRaises(core.Refused):
                core.route(S,self.task('complex'),'qa','agy',self.budget,'slot2')
    def test_ui_simple_cursor_uses_admitted_sol_medium_when_cursor_unavailable(self):
        t=C.cost_task('simple','standard');t['routing_policy']['schema']='GB_STAGE_COST_V2'
        t['author_routes']=['cursor:auto','codex:gpt-6.1-sol:medium']
        with patch('native_cursor.available',return_value=(False,'future task not qualified')):
            r=core.route(S,t,'author','auto',self.budget,'slot2')
        self.assertEqual((r['provider'],r['effective_model'],r['effort']),('codex','gpt-6.1-sol','medium'))
        self.assertEqual(r['requested_route'],'cursor:auto')
        t['author_routes']=['cursor:auto']
        with patch('native_cursor.available',return_value=(False,'unavailable')):
            with self.assertRaises(core.Refused):core.route(S,t,'author','auto',self.budget,'slot2')
    def test_v1_and_immutable_historical_preferences_are_preserved(self):
        t=C.cost_task('complex','critical')
        self.assertEqual(P.selection(t,'qa')[0],'codex:gpt-6-astra:high')
        t.pop('routing_policy')
        route=core.route(S,t,'qa','auto',self.budget,'slot2')
        self.assertEqual(route['effective_model'],'gpt-6-astra')
        self.assertEqual(route['policy'],'immutable_legacy')
    def test_research_does_not_gain_an_author_or_qa_route(self):
        t=self.task('standard');t['qa_routes']=['agy:gemini-3.8-flash-medium']
        with self.assertRaises(core.Refused):core.route(S,t,'qa','auto',self.budget,'slot2')

if __name__=='__main__':unittest.main()
