"""Stage3: additive exact two fresh grants; never reset old usage or evidence."""
import copy
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from test_actions_train import core
from test_actions_train_addressed_analysis import grant as old_grant
import antigravity_qa_recovery as Q
import native_antigravity as N
from context_policy import RULES_SHA256


def fresh(role='technical_pm_product_analyst'):
    old=old_grant()
    value=old|dict(owner_comment=Q.FRESH_OWNER_COMMENT,
       base=Q.FRESH_SOURCE_BASE,head=Q.FRESH_SOURCE_HEAD,
       controller_revision='a'*40,rules_sha256=RULES_SHA256,
       input_revision=Q.FRESH_SOURCE_HEAD)
    if role=='independent_qa':
        value.update(role=role,input_revision=Q.FRESH_QA_INPUT_REVISION,
             input_path=Q.FRESH_QA_INPUT_PATH,input_sha256=Q.FRESH_QA_INPUT_SHA256)
    return value


class FreshContract(unittest.TestCase):
    def test_new_analysis_and_exact_qa_contract(self):
        for role in ('technical_pm_product_analyst','independent_qa'):
            g=fresh(role)
            self.assertEqual(Q.validate_addressed_grant(g),g)
            task=Q.addressed_task(g['base'],g['head'],g)
            self.assertEqual(task['issue'],29)
            self.assertEqual(task['role'],role)
            self.assertEqual(task['max_calls'],1)
            self.assertEqual(task['adapter_revision'],g['controller_revision'])

    def test_wrong_rules_owner_source_or_qa_fixture_refuses(self):
        g=fresh()
        for change in (
            dict(owner_comment=6399999999),
            dict(rules_sha256=Q.LEGACY_RULES_SHA256),
            dict(base='f'*40),
            dict(head='f'*40),
            dict(ceiling=2),
            dict(role='author'),
            dict(permission_mode='request-review'),
            dict(timeout=120),
            dict(input_revision='c'*40),
        ):
            with self.subTest(change=change),self.assertRaises(core.Refused):
                Q.validate_addressed_grant(g|change)
        qa=fresh('independent_qa')
        for change in (dict(input_revision='f'*40),dict(input_path='scripts/chatops/tests/fixtures/other.json'),
                       dict(input_sha256='0'*64)):
            with self.subTest(change=change),self.assertRaises(core.Refused):
                Q.validate_addressed_grant(qa|change)

    def test_ledger_never_forgives_old_calls_or_duplicates_role(self):
        analyst=fresh()
        qa=fresh('independent_qa')
        olda=old_grant()
        oldb=olda|dict(role='independent_qa',input_path='scripts/chatops/tests/fixtures/agy-reviewed-tests.json')
        historic={'1'*64:dict(grant=olda,operation='a'*64),
                  '2'*64:dict(grant=oldb,operation='b'*64)}
        # Legacy fixture IDs still obey the old validator; canonical digests
        # are checked for all real entries, including the spent ones.
        entries={core.digest(analyst):dict(grant=analyst,operation=None),
                 core.digest(qa):dict(grant=qa,operation=None)}
        old={core.digest(v['grant']):v for v in historic.values()}
        v=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
               ceiling=4,used_calls=2,grants=old|entries)
        self.assertIs(Q.addressed_ledger(v),v)
        self.assertEqual(len(v['grants']),4)
        for change in (
            dict(used_calls=1),dict(ceiling=5),
            dict(grants=v['grants']|{'f'*64:dict(grant=analyst,operation=None)}),
        ):
            with self.subTest(change=str(change)[:55]),self.assertRaises(core.Refused):
                Q.addressed_ledger(v|change)

    def test_current_runtime_controller_required_and_qa_after_analysis_only(self):
        g=fresh('independent_qa')
        task=Q.addressed_task(g['base'],g['head'],g)
        q=dict(issue=29,base=g['base'],head=g['head'],work=str(N.QUALIFICATION_WORK),
               adapter_revision=g['controller_revision'],qualification_grant=g,
               task_sha256=core.digest(task))
        analyst=fresh()
        key=core.digest(analyst)
        opkey='3'*64
        grants={key:dict(grant=analyst,operation=opkey),
                core.digest(g):dict(grant=g,operation=None)}
        base=dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
                  used_calls=1,ceiling=4,grants=grants)
        state={'operations':{opkey:dict(result=dict(status='confirmed',analysis_complete=True,
                              analysis=dict(completion='COMPLETE')))}}
        rec=dict(phase='complete',third_operation_sha256=Q.THIRD_DIGEST)
        vals={Q.ADDRESSED_LEDGER:base,Q.ADDRESSED_RECONCILIATION:rec}
        api=SimpleNamespace(POLICY='policy',STATE=None,
              read=lambda path,*a:dict(controller_sha=g['controller_revision']) if path=='policy'
                    else copy.deepcopy(vals[path]),journal=lambda slot:copy.deepcopy(state))
        from pathlib import Path
        api.STATE=Path('/state')
        vals={Path('/state')/k:v for k,v in vals.items()}
        vals[Path('/state/slot2.json')]=state
        with patch.object(Q,'addressed_history'):
            self.assertEqual(Q.addressed_ready(api,q)['used_calls'],1)
            state['operations'][opkey]['result']['analysis_complete']=False
            with self.assertRaises(core.Refused):Q.addressed_ready(api,q)
            state['operations'][opkey]['result']['analysis_complete']=True
            api.read=lambda path,*a:dict(controller_sha='f'*40) if path=='policy' else copy.deepcopy(vals[path])
            with self.assertRaises(core.Refused):Q.addressed_ready(api,q)


if __name__=='__main__':unittest.main()
