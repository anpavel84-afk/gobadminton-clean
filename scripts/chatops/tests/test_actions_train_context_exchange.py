"""Focused offline context invariants. No provider, network or installed state."""
import copy
import hashlib
import json
from pathlib import Path
import unittest

from test_actions_train import ROOT
import context_exchange as E

BASE='a'*40
HEAD='b'*40
TASK={'goal':'Проверить обработчик', 'acceptance':'Не терять критерии', 'allowed_paths':['apps/a.py'], 'max_attempts':3}
BIND={'repository':'anpavel84-afk/gobadminton-clean', 'base_sha':BASE, 'candidate_sha':HEAD}


def fixture_rules():
    blocks=[]
    for r in ('common',*sorted(E.ROLES)):
        blocks.append('<!-- GB_CONTEXT_V1:'+r+':BEGIN -->\n'+r+' exact policy\n<!-- GB_CONTEXT_V1:'+r+':END -->')
    return '\n'.join(blocks)+'\nHuman reference '+'x'*10000


def metadata(t):
    return {'commit':BASE,'sha256':hashlib.sha256(t.encode()).hexdigest(),'bytes':len(t.encode())}


class ContextExchange(unittest.TestCase):
    def test_canonical_capsules_all_roles_verbatim_and_hash_bound(self):
        text=(ROOT/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()
        for role in E.ROLES:
            capsule=E.compile_capsule(text,role,metadata(text)['sha256'])
            self.assertIn('anpavel84-afk/gobadminton-clean',capsule)
            self.assertLess(len(capsule.encode()),12000)
        with self.assertRaisesRegex(ValueError,'provenance'):
            E.compile_capsule(text,'qa','0'*64)

    def test_capsule_missing_duplicate_or_nested_refused(self):
        t=fixture_rules()
        with self.assertRaises(ValueError):E.compile_capsule(t,'unknown',metadata(t)['sha256'])
        for bad in (t.replace('qa:END','qa:STOP'),t+t):
            with self.assertRaises(ValueError):E.compile_capsule(bad,'qa',metadata(bad)['sha256'])

    def test_compact_requires_actual_recipient_access_else_full_fallback(self):
        t=fixture_rules();m=metadata(t);ref={'path':'context/rules.md','revision':BASE,'sha256':m['sha256'],'bytes':m['bytes']}
        full,m1=E.rules_prefix(text=t,metadata=m,role='qa',compact=True,full_rules_reference=ref)
        self.assertIn(t,full);self.assertEqual(m1['policy_profile'],'full')
        seen=[]
        compact,m2=E.rules_prefix(text=t,metadata=m,role='qa',compact=True,full_rules_reference=ref,
            verified_access=lambda r:seen.append(r) or True)
        self.assertEqual(seen,[ref]);self.assertEqual(m2['policy_profile'],'scoped_v1')
        self.assertNotIn('Human reference',compact);self.assertIn('FULL_RULES_REFERENCE',compact)
        self.assertLess(m2['prefix_bytes'],m1['prefix_bytes'])

    def test_prefix_stable_but_separated_by_role(self):
        t=fixture_rules();m=metadata(t)
        a,_=E.rules_prefix(text=t,metadata=m,role='author')
        b,_=E.rules_prefix(text=t,metadata=m,role='author')
        q,_=E.rules_prefix(text=t,metadata=m,role='qa')
        self.assertEqual(a,b);self.assertNotEqual(a,q)

    def test_task_acceptance_not_compressed_and_inputs_unchanged(self):
        before=copy.deepcopy((TASK,BIND));p,m=E.build_packet(role='qa',task=TASK,binding=BIND)
        self.assertEqual(p['task'],TASK);self.assertEqual(p['task_sha256'],E.digest(TASK))
        self.assertEqual((TASK,BIND),before);self.assertIsNone(m['input_tokens'])

    def test_duplicate_blob_once_but_both_path_aliases_remain(self):
        refs=[E.Artifact('one','apps/a.py',HEAD,'same'*200),E.Artifact('two','apps/b.py',HEAD,'same'*200)]
        p,m=E.build_packet(role='qa',task=TASK,binding=BIND,artifacts=refs)
        self.assertEqual(len(p['content']),1);self.assertEqual(len(p['artifacts']),2)
        self.assertEqual(m['deduplicated_bytes'],800)

    def test_large_source_reference_only_after_verified_exact_access(self):
        a=E.Artifact('one','apps/a.py',HEAD,'x'*20000)
        p,m=E.build_packet(role='qa',task=TASK,binding=BIND,artifacts=[a],verified_access=lambda r:True)
        self.assertFalse(p['content']);self.assertEqual(m['reference_bytes'],20000)
        p,m=E.build_packet(role='qa',task=TASK,binding=BIND,artifacts=[a],verified_access=lambda r:False)
        self.assertEqual(next(iter(p['content'].values())),a.text)
        self.assertEqual(m['warnings'][0]['code'],'REFERENCE_UNAVAILABLE_INLINE_FALLBACK')

    def test_essential_artifact_always_inline_and_soft_limit_never_truncates(self):
        a=E.Artifact('criteria','docs/spec.md',HEAD,'я'*20000,kind='contract',essential=True)
        p,m=E.build_packet(role='pma',task=TASK,binding=BIND,artifacts=[a],verified_access=lambda r:True)
        self.assertEqual(next(iter(p['content'].values())),a.text)
        self.assertTrue(any(x['code']=='SOFT_CONTEXT_TARGET_EXCEEDED' for x in m['warnings']))

    def test_bad_identity_path_or_duplicate_id_rejected_without_side_effect(self):
        for path in ('../x','/root/a','apps/../x','apps//x'):
            with self.assertRaises(ValueError):E.Artifact('a',path,HEAD,'x').reference()
        a=E.Artifact('a','apps/a.py',HEAD,'x')
        with self.assertRaises(ValueError):E.build_packet(role='qa',task=TASK,binding=BIND,artifacts=[a,a])
        with self.assertRaises(ValueError):E.build_packet(role='qa',task=TASK,binding={**BIND,'candidate_sha':'dev'})

    def test_diagnosis_projects_receipts_not_nested_inputs_and_preserves_briefs(self):
        current={'head':HEAD,'failure':{'findings':['real current failure']},'evidence':[{'assertion':'expected != actual'}],
                 'history':[{'head':BASE,'qa':{'verdict':'FAIL','findings':['old failure']},'failure_diagnosis':{'large':'x'*20000}}]}
        cache={'receipts':{'1'*64:{'status':'ready','inputs':copy.deepcopy(current),'brief_hash':'2'*64,'brief':{'diagnosis':'actual earlier cause'}}}}
        original=copy.deepcopy((current,cache,TASK))
        view=E.diagnosis_view({'task':TASK},current,cache)
        self.assertEqual(view['inputs']['failure'],current['failure'])
        self.assertEqual(view['inputs']['evidence'],current['evidence'])
        self.assertEqual(view['inputs']['history'],current['history'])
        self.assertEqual(view['previous'][0]['brief'],cache['receipts']['1'*64]['brief'])
        self.assertNotIn('inputs',view['previous'][0])
        self.assertEqual(view['previous'][0]['evidence_delivered_at'],'inputs.evidence')
        self.assertIn('large',E.encoded(view).decode())
        self.assertEqual((current,cache,TASK),original)
        self.assertEqual(view['omitted_duplicate_history'],[])

    def test_unique_history_and_prior_evidence_are_model_readable(self):
        historic={'head':BASE,'failure_diagnosis':{'unique_unknown':'pending grant'},
                  'routing_receipts':[{'route':'unique route'}],
                  'provider_receipts':[{'usage':'unique provider usage'}],
                  'unrecognized_field':{'old_assertion':'HISTORY_FAIL'}}
        current={'head':HEAD,'failure':{'findings':['CURRENT_FAIL']},
                 'evidence':[{'assertion':'CURRENT_CI_ASSERTION'}],
                 'history':[historic,{'task':copy.deepcopy(TASK)}]}
        prior={'head':BASE,'attempt':1,'failure':{'kind':'CI_FAIL'},
               'evidence':[{'assertion':'UNIQUE_PRIOR_CI_ASSERTION'}]}
        cache={'receipts':{'1'*64:{'status':'ready','inputs':prior,
                    'brief':{'diagnosis':'UNIQUE_PRIOR_BRIEF'},'brief_hash':'2'*64},
                           '2'*64:{'status':'unknown','inputs':copy.deepcopy(current),
                    'brief':None,'brief_hash':None}}}
        original=copy.deepcopy((current,cache,TASK))
        view=E.diagnosis_view({'task':TASK},current,cache)
        self.assertEqual(view['inputs']['history'][0],historic)
        self.assertNotIn('task',view['inputs']['history'][1])
        self.assertEqual(view['omitted_duplicate_history'][0]['delivered_at'],'task')
        self.assertEqual(view['previous'][0]['evidence'],prior['evidence'])
        self.assertEqual(view['previous'][0]['brief']['diagnosis'],'UNIQUE_PRIOR_BRIEF')
        self.assertEqual(view['previous'][1]['status'],'unknown')
        self.assertEqual(view['previous'][1]['evidence_delivered_at'],'inputs.evidence')
        self.assertEqual(view['previous'][1]['failure_delivered_at'],'inputs.failure')
        self.assertNotIn('inputs',view['previous'][0])
        serialized=E.encoded(view).decode()
        for marker in ('UNIQUE_PRIOR_CI_ASSERTION','HISTORY_FAIL','unique_unknown','unique route','unique provider usage','CURRENT_CI_ASSERTION'):
            self.assertIn(marker,serialized)
        self.assertEqual((current,cache,TASK),original)

    def test_changed_historical_task_is_not_discarded_as_duplicate(self):
        old={**TASK, 'goal':'previous approved goal'}
        value={'head':HEAD,'history':[{'task':old},{'task':copy.deepcopy(TASK)}]}
        result=E.diagnosis_view({'task':TASK},value,{'receipts':{}})
        self.assertEqual(result['inputs']['history'][0]['task'],old)
        self.assertNotIn('task',result['inputs']['history'][1])
        self.assertEqual(len(result['omitted_duplicate_history']),1)

    def test_inject_opt_in_keeps_default_full_and_proves_exact_scoped_delivery(self):
        import context_policy as C
        text=(ROOT/'docs/rules/ENGINEERING_OPERATING_MODEL.md').read_text()
        m={'commit':C.RULES_COMMIT,'sha256':C.RULES_SHA256,'bytes':C.RULES_SIZE,
           'delivery':'explicit_full_stdin'}
        full,full_receipt=C.inject('exact task',True,ROOT,(text,m))
        self.assertIn(text,full)
        self.assertEqual(full_receipt['context_metrics']['policy_profile'],'full')
        ref={'path':'context/accepted-rules.md','revision':C.RULES_COMMIT,
             'sha256':C.RULES_SHA256,'bytes':C.RULES_SIZE}
        scoped,receipt=C.inject('exact task',True,ROOT,(text,m),context_profile='scoped_v1',
            full_rules_reference=ref,verified_access=lambda r:True)
        self.assertEqual(receipt['delivery'],'explicit_scoped_stdin')
        self.assertIn(E.compile_capsule(text,'qa',C.RULES_SHA256),scoped)
        self.assertEqual(receipt['stdin_sha256'],hashlib.sha256(scoped.encode()).hexdigest())
        self.assertTrue(scoped.endswith('exact task'))
        self.assertLess(len(scoped),len(full))
        fallback,receipt=C.inject('exact task',True,ROOT,(text,m),context_profile='scoped_v1',
            full_rules_reference=ref,verified_access=lambda r:False)
        self.assertIn(text,fallback)
        self.assertEqual(receipt['delivery'],'explicit_full_stdin')
        self.assertEqual(fallback,full)
        self.assertEqual(receipt['stdin_sha256'],full_receipt['stdin_sha256'])
        self.assertIn('Role: qa.',fallback)

    def test_unknown_prior_status_is_not_erased_by_context_projection(self):
        c={'receipts':{'a'*64:{'status':'pending','inputs':{'head':HEAD},'brief':None},
                       'b'*64:{'status':'unknown','inputs':{'head':BASE},'brief':None}}}
        v=E.diagnosis_view({'task':TASK},{'head':HEAD,'history':[]},c)
        self.assertEqual({x['status'] for x in v['previous']},{'pending','unknown'})

    def test_tool_excerpt_requires_saved_accessible_artifact_and_never_claims_PASS(self):
        text='начало\n'+'x'*10000+'\nERROR end'
        ref={'path':'evidence/test.txt','sha256':hashlib.sha256(text.encode()).hexdigest(),
             'bytes':len(text.encode()),'available':True}
        original=copy.deepcopy(ref)
        seen=[]
        def verified(v):
            seen.append(copy.deepcopy(v))
            self.assertEqual(v,ref)
            return True
        v=E.tool_excerpt(text,exit_code=1,full_artifact=ref,limit=1024,verified_access=verified)
        self.assertTrue(v['truncated']);self.assertEqual(v['exit_code'],1)
        self.assertIn('ERROR end',v['excerpt']);self.assertEqual(v['verdict'],'NOT_INFERRED_FROM_EXCERPT')
        self.assertEqual(seen,[ref])
        self.assertEqual(ref,original)
        for bad in ({**ref,'available':False},{**ref,'sha256':'0'*64},
                    {**ref,'path':'../not-authorized'}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                E.tool_excerpt(text,exit_code=1,full_artifact=bad,verified_access=verified)

    def test_tool_excerpt_unverified_access_falls_back_full_without_losing_middle_assertions(self):
        text='start\n'+'a'*5000+'\nMIDDLE_ASSERTION_MUST_SURVIVE\n'+'z'*5000+'\nend'
        ref={'path':'evidence/full-result.log','sha256':hashlib.sha256(text.encode()).hexdigest(),
             'bytes':len(text.encode()),'available':True}
        def fail(kind):
            def inner(_):
                raise kind('no actual recipient access')
            return inner
        for probe in (None,lambda _:False,lambda _:'truthy but not boolean',
                      fail(OSError),fail(ValueError),fail(RuntimeError),fail(TypeError),
                      fail(KeyError),fail(AttributeError),fail(AssertionError),fail(Exception)):
            with self.subTest(probe=repr(probe)):
                v=E.tool_excerpt(text,exit_code=1,full_artifact=ref,limit=512,verified_access=probe)
                self.assertEqual(v['excerpt'],text)
                self.assertFalse(v['truncated'])
                self.assertIn('MIDDLE_ASSERTION_MUST_SURVIVE',v['excerpt'])
                self.assertEqual(v['verdict'],'NOT_INFERRED_FROM_EXCERPT')
                self.assertEqual(v['exit_code'],1)
        short=E.tool_excerpt('short',exit_code=0,full_artifact={
            'path':'evidence/short','sha256':hashlib.sha256(b'short').hexdigest(),
            'bytes':5,'available':True},verified_access=lambda _:True)
        self.assertEqual(short['excerpt'],'short')
        self.assertFalse(short['truncated'])


    def test_all_access_probe_exceptions_fall_back_to_lossless_input(self):
        text=fixture_rules(); m=metadata(text)
        ref={'path':'context/rules.md','revision':BASE,'sha256':m['sha256'],'bytes':m['bytes']}
        art=E.Artifact('source','apps/a.py',HEAD,'FIRST_ASSERTION\n'+'x'*9000+'\nLAST_ASSERTION')
        for exc in (TypeError, KeyError, AssertionError, AttributeError, Exception):
            def probe(_r, error=exc):
                raise error('recipient read failed')
            with self.subTest(error=exc.__name__):
                packet,metrics=E.build_packet(role='qa',task=TASK,binding=BIND,artifacts=[art],
                                              verified_access=probe,inline_threshold=1024)
                self.assertEqual(next(iter(packet['content'].values())),art.text)
                self.assertEqual(packet['artifacts'][0]['delivery'],'inline')
                self.assertEqual(metrics['reference_bytes'],0)
                prefix,detail=E.rules_prefix(text=text,metadata=m,role='qa',compact=True,
                                             full_rules_reference=ref,verified_access=probe)
                self.assertEqual(detail['policy_profile'],'full')
                self.assertIn(text,prefix)

    def test_prior_receipt_unique_nested_history_and_opaque_input_are_not_lost(self):
        current={'head':HEAD,'history':[],'failure':{'kind':'source_defect'},
                 'evidence':[{'assertion':'CURRENT_ASSERTION'}]}
        prior={'head':BASE,'attempt':1,'history':[
            {'qa':{'verdict':'FAIL','findings':['UNIQUE_PRIOR_HISTORY_ASSERTION']}}],
            'misc_diagnostic':{'nested':'EXTRA_PRIOR_SIGNAL'},
            'failure':{'kind':'different_prior_failure'}}
        cache={'receipts':{'1'*64:{'status':'unknown','inputs':copy.deepcopy(prior),
                                   'brief':None,'brief_hash':None},
                           '2'*64:{'status':'pending','inputs':copy.deepcopy(current),
                                   'brief':None,'brief_hash':None}}}
        original=copy.deepcopy((current,cache,TASK))
        view=E.diagnosis_view({'task':TASK},current,cache)
        extra=view['previous'][0]['additional_inputs']
        self.assertEqual(extra['history'],prior['history'])
        self.assertEqual(extra['misc_diagnostic'],prior['misc_diagnostic'])
        self.assertEqual(view['previous'][0]['status'],'unknown')
        self.assertEqual(view['previous'][1]['equal_inputs_delivered_at']['history'],'inputs.history')
        self.assertEqual(view['previous'][1]['evidence_delivered_at'],'inputs.evidence')
        blob=E.encoded(view).decode('utf-8')
        self.assertIn('UNIQUE_PRIOR_HISTORY_ASSERTION',blob)
        self.assertIn('EXTRA_PRIOR_SIGNAL',blob)
        self.assertIn('CURRENT_ASSERTION',blob)
        self.assertEqual((current,cache,TASK),original)


    def test_json_type_distinctions_prevent_false_historical_dedup(self):
        current={'head':HEAD,'history':[],'misc_diagnostic':{'assertion':True},
                 'failure':{'code':True},'evidence':[{'flag':True}]}
        prior={'head':BASE,'attempt':1,'history':[],
               'misc_diagnostic':{'assertion':1},
               'failure':{'code':1},'evidence':[{'flag':1}]}
        cache={'receipts':{'b'*64:{'status':'unknown','inputs':copy.deepcopy(prior),
                                   'brief':None,'brief_hash':None}}}
        result=E.diagnosis_view({'task':TASK},current,cache)
        item=result['previous'][0]
        self.assertIs(type(item['additional_inputs']['misc_diagnostic']['assertion']),int)
        self.assertEqual(item['additional_inputs']['misc_diagnostic']['assertion'],1)
        self.assertIs(type(item['failure']['code']),int)
        self.assertIs(type(item['evidence'][0]['flag']),int)
        self.assertNotIn('failure_delivered_at',item)
        self.assertNotIn('evidence_delivered_at',item)
        self.assertTrue(E.exact_json_equal({'a':1},{'a':1}))
        self.assertFalse(E.exact_json_equal({'a':1},{'a':True}))
        self.assertFalse(E.exact_json_equal([0],[False]))


if __name__=='__main__':unittest.main()
