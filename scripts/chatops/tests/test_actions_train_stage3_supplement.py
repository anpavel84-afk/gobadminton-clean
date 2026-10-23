"""New Stage3 one-analysis/one-QA supplement; no provider or root state writes."""
import copy
import hashlib
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from test_actions_train import core
from test_actions_train_addressed_analysis import grant as old_grant
import antigravity_qa_recovery as Q
import native_antigravity as N
from context_policy import RULES_SHA256

SOURCE_A='apps/web/src/lib/consumer-types.ts'
SOURCE_B='apps/web/src/components/consumer/pages/GameDetailPage.tsx'
CONTROLLER='c'*40


def grant(role='technical_pm_product_analyst'):
    g=old_grant() | dict(owner_comment=Q.SUPPLEMENT_OWNER_COMMENT,
        controller_revision=CONTROLLER,base=Q.FRESH_SOURCE_BASE,
        head=Q.FRESH_SOURCE_HEAD,input_revision=Q.FRESH_SOURCE_HEAD,
        rules_sha256=RULES_SHA256)
    if role=='independent_qa':
        g.update(role=role,input_revision=Q.FRESH_QA_INPUT_REVISION,
            input_path=Q.FRESH_QA_INPUT_PATH,input_sha256=Q.FRESH_QA_INPUT_SHA256)
    return g


def supplement(spent=0):
    a,b=grant(),grant('independent_qa')
    return dict(schema=Q.SUPPLEMENT_SCHEMA,owner_comment=Q.SUPPLEMENT_OWNER_COMMENT,
        ceiling=2,legacy_used_calls=3,used_calls=spent,
        grants={core.digest(a):dict(grant=a,operation='a'*64 if spent>=1 else None),
                core.digest(b):dict(grant=b,operation='b'*64 if spent>=2 else None)})


def analysis():
    return dict(role=N.ANALYSIS_ROLE,input_fingerprint='a'*64,
        completion='COMPLETE',analysis='Inspected actual source via native tool.',
        evidence=['view_file and run_command source evidence'],limitations=[],
        source_reads=[
            dict(path=SOURCE_A,sha256=hashlib.sha256(b'// Inspected TypeScript game detail types\n').hexdigest(),
                 observation='Inspected TypeScript game detail types'),
            dict(path=SOURCE_B,sha256=hashlib.sha256(b'// Inspected GameDetailPage data access\n').hexdigest(),
                 observation='Inspected GameDetailPage data access')])
        

class SupplementalLedger(unittest.TestCase):
    def test_exact_two_new_roles_without_changing_old_ledger(self):
        a,b=grant(),grant('independent_qa')
        self.assertEqual(Q.validate_addressed_grant(a),a)
        self.assertEqual(Q.validate_addressed_grant(b),b)
        for spent in (0,1,2):
            l=supplement(spent)
            self.assertIs(Q.supplemental_ledger(l),l)
            self.assertEqual(l['legacy_used_calls'],3)
            self.assertEqual(l['ceiling'],2)
        old=old_grant()
        self.assertEqual(old['owner_comment'],6362661117)
        for change in ({'owner_comment':1},{'ceiling':4},{'legacy_used_calls':0},
                       {'used_calls':3},{'schema':'foreign'}):
            with self.subTest(change=change),self.assertRaises(core.Refused):
                Q.supplemental_ledger(supplement()|change)
        for change in ({'owner_comment':6370661776},{'rules_sha256':'0'*64},
                       {'base':'a'*40},{'role':'author'},{'timeout':10}):
            with self.subTest(change=change),self.assertRaises(core.Refused):
                Q.validate_addressed_grant(a|change)
    def test_reservation_is_single_use_and_separate_from_original_three(self):
        g=grant()
        q=dict(qualification_grant=g)
        old={'old_three_entries':'immutable'}
        l=supplement()
        stored=[]
        api=SimpleNamespace(STATE=Path('/tmp/state'),
            atomic=lambda path,val:stored.append((path,copy.deepcopy(val))))
        with patch.object(Q,'addressed_ready',return_value=l):
            Q.reserve_addressed(api,q,'c'*64)
        self.assertEqual(len(stored),1)
        self.assertEqual(stored[0][0],api.STATE/Q.SUPPLEMENT_LEDGER)
        self.assertEqual(stored[0][1]['used_calls'],1)
        self.assertEqual(old,{'old_three_entries':'immutable'})
        self.assertIsNone(l['grants'][core.digest(g)]['operation'])
        self.assertEqual(Q.supplemental_ledger(stored[0][1]),stored[0][1])
        bad=supplement()
        second=grant('independent_qa')
        bad['grants'][core.digest(second)]['grant']=g
        with self.assertRaises(core.Refused):Q.supplemental_ledger(bad)


class NativeReadEvidence(unittest.TestCase):
    def test_model_cannot_claim_complete_without_two_native_tools(self):
        good=analysis()
        binding=dict(role=N.ANALYSIS_ROLE,input_fingerprint='a'*64)
        self.assertEqual(N.analysis_canonical(good,binding,strict_source_evidence=True),good)
        for wrong in (dict(source_reads=[]),dict(source_reads=good['source_reads'][:1]),
                      dict(source_reads=[good['source_reads'][0],good['source_reads'][0]])):
            g=good|wrong
            if not g['source_reads']:
                # Complete with no proof fails in the deterministic gate.
                self.assertEqual(N.analysis_source_gate(g,dict(tool_names=[]),'/work','f'*40)['completion'],'INCOMPLETE')
            else:
                with patch.object(N,'git',return_value=b'different'):
                    self.assertEqual(N.analysis_source_gate(g,dict(tool_names=['view_file','run_command']),'/work','f'*40)['completion'],'INCOMPLETE')
        with patch.object(N,'git',return_value=b'first'):
            downgraded=N.analysis_source_gate(good,dict(tool_names=['view_file']),'/work','f'*40)
            self.assertEqual(downgraded['completion'],'INCOMPLETE')
            self.assertTrue(downgraded['limitations'])
        def source(_w,command,path):
            self.assertEqual(command,'show')
            return (b'// Inspected TypeScript game detail types\n' if path.endswith(SOURCE_A)
                    else b'// Inspected GameDetailPage data access\n')
        with patch.object(N,'git',side_effect=source) as read:
            complete=N.analysis_source_gate(good,dict(tool_names=['view_file','run_command']),'/work','f'*40)
        self.assertEqual(complete['completion'],'COMPLETE')
        self.assertEqual(read.call_count,2)

    def test_exact_source_evidence_schema_and_legacy_inert_result(self):
        binding=dict(role=N.ANALYSIS_ROLE,input_fingerprint='a'*64)
        good=analysis()
        for row in (dict(path='../.env',sha256='a'*64,observation='Bad directory'),
                    dict(path=SOURCE_A,sha256='a'*64,observation='x'),
                    dict(path=SOURCE_B,sha256='n'*64,observation='Inspected source')):
            with self.subTest(row=row),self.assertRaises(core.Refused):
                N.analysis_canonical(good|dict(source_reads=[row]),binding,strict_source_evidence=True)
        with self.assertRaises(core.Refused):
            N.analysis_canonical(good,binding)
        old={k:v for k,v in good.items() if k!='source_reads'}
        self.assertEqual(N.analysis_canonical(old,binding),old)
        with self.assertRaises(core.Refused):
            N.analysis_canonical(old,binding,strict_source_evidence=True)

if __name__=='__main__':
    unittest.main()
