"""Independent-of-network contract simulations for the explicit Issue185 delegation."""
import copy
import json
import unittest
from unittest.mock import Mock, patch
from test_actions_train_recovery import R, config, terminal, diagnosis, core, A, S, req, card, issue, STAMP
import recovery_admission as D
import recovery_publish as P


def reviewed():
    c=config();j=R.empty();key=R.enroll(j,terminal(),'slot1',c)
    R.reserve(j,req('diagnose','qa')|dict(issue=177,attempt=3),c)
    r=R.finish(j,key,'diagnose',dict(status='confirmed',outcome=diagnosis(),evidence=[]),c)
    R.reserve(j,req('task_review','qa')|dict(issue=177,attempt=3),c)
    value=dict(verdict='PASS',findings=[],receipt_hash=core.digest(r['frozen']),proposed_task_hash=core.digest(r['proposal']),
               evidence_hash=core.digest(r['diagnosis']['evidence']),diagnosis_hash=core.digest(r['diagnosis']['result']))
    r=R.finish(j,key,'task_review',dict(status='confirmed',outcome=value),c)
    return c,j,key,r


def child(r,number=777):
    i=issue(number)
    i.update(body=D.body(r),user=dict(id=D.BOT,login='github-actions[bot]',type='Bot'),
             html_url=f'https://github.com/{core.REPO}/issues/{number}')
    return i


class Delegation(unittest.TestCase):
    def setUp(self):self.c,self.j,self.key,self.r=reviewed();self.i=child(self.r)
    def test_passing_review_produces_one_bounded_successor_without_rewriting_original_owner_task(self):
        self.assertEqual(self.r['status'],'publish_ready')
        p=D.proposed(self.r)
        self.assertEqual(p['task']['max_attempts'],2)
        self.assertEqual(p['task']['allowed_paths'],self.r['frozen']['snapshot']['task']['allowed_paths'])
        self.assertEqual(p['task']['acceptance'],self.r['frozen']['snapshot']['task']['acceptance'])
        self.assertEqual(self.r['frozen']['snapshot']['attempt'],3)
        self.assertEqual(p['lineage'],[149,177])
        self.assertEqual(D.candidates(A,{'recovery':self.j},[self.i]),[(777,p['task'])])
        # Original Owner-only admission does not silently start accepting arbitrary bots.
        self.assertEqual(S.admitted(A,[self.i],[],__import__('datetime').datetime.fromisoformat(STAMP)),[])
    def test_forged_owner_bot_body_scope_or_independent_review_refused(self):
        for change in ({'user':{'id':core.OWNER,'login':'github-actions[bot]','type':'Bot'}},
                       {'user':{'id':D.BOT,'login':'not-the-bot','type':'Bot'}},
                       {'body':self.i['body']+' '},{'state':'closed'},{'html_url':'https://evil/777'}):
            with self.assertRaises(core.Refused):D.parse_issue(self.i|change,self.r)
        for mutate in (lambda r:r['review'].update(verdict='FAIL'), lambda r:r['counts'].update(successor=0),
                       lambda r:r['proposal']['allowed_paths'].append('scripts/chatops/stage.py'),
                       lambda r:r['proposal'].update(acceptance='Skip QA'),lambda r:r['review'].update(proposed_task_hash='f'*64)):
            r=copy.deepcopy(self.r);mutate(r)
            with self.assertRaises(core.Refused):D.proposed(r)
    def test_root_binds_true_bot_identity_to_exact_receipt_once(self):
        api=Mock();api.pages.return_value=[self.i]
        with patch.object(D,'parent_unchanged'):
            c=D.root_admission(A,api,self.j,self.i,self.c)
            self.assertEqual(c['issue'],777);self.assertEqual(c['frozen']['attempt'],3)
            self.assertEqual(self.j['receipts'][self.key]['status'],'successor_bound')
            self.assertEqual(D.root_admission(A,api,self.j,self.i,self.c),c)
            with self.assertRaises(core.Refused):D.root_admission(A,api,self.j,child(self.r,778),self.c)
        self.assertEqual(self.j['receipts'][self.key]['counts']['successor'],1)
    def test_unknown_receipt_duplicate_publication_and_revoked_policy_do_not_admit(self):
        api=Mock();api.pages.return_value=[self.i,child(self.r,778)]
        with patch.object(D,'parent_unchanged'):
            with self.assertRaises(core.Refused):D.root_admission(A,api,self.j,self.i,self.c)
        bad=copy.deepcopy(self.c);bad['recovery']['enabled']=False
        with self.assertRaises(core.Refused):D.root_admission(A,api,self.j,self.i,bad)
        self.assertEqual(D.candidates(A,{'recovery':R.empty()},[self.i]),[])
        self.assertEqual(D.candidates(A,{'recovery':self.j},[self.i,child(self.r,778)]),[])
    def test_new_source_claim_retains_parent_candidate_but_has_own_zero_attempt_counter(self):
        api=Mock(return_value=self.i);api.pages.return_value=[self.i]
        with patch.object(D,'parent_unchanged'):
            cert=D.root_admission(A,api,self.j,self.i,self.c)
            store=Mock(data=dict(active=None,done=[156]))
            x=D.claim(A,api,store,cert,self.c)
            self.assertEqual(x['issue'],777);self.assertEqual(x['attempt'],0)
            self.assertEqual(x['head'],self.r['frozen']['head']);self.assertEqual(x['base'],self.r['frozen']['base'])
            self.assertEqual(x['recovery_receipt'],self.key);store.save.assert_called_once()
            api.return_value=self.i|{'body':self.i['body']+'edited'}
            with self.assertRaises(core.Refused):D.assert_certificate(A,api,x,cert,self.c)
    def test_successor_exhaustion_cannot_create_another_iteration(self):
        api=Mock();api.pages.return_value=[self.i]
        with patch.object(D,'parent_unchanged'):D.root_admission(A,api,self.j,self.i,self.c)
        e=terminal(777);e['snapshot']['attempt']=e['snapshot']['task']['max_attempts']=2
        self.assertIsNone(R.enroll(self.j,e,'slot2',self.c,future=True))
        self.assertEqual(self.j['receipts'][self.key]['status'],'needs-owner')
        self.assertEqual(len(self.j['receipts']),1)


class HostedPublisher(unittest.TestCase):
    def setUp(self):
        self.c,self.j,self.key,self.r=reviewed();self.i=child(self.r)
        self.doc={'status':'confirmed','last':{'stage':'task_review','workflow_run':901,'changed':True,'issue':177,'recovery':self.r}}
    def test_publication_is_idempotent_and_never_posts_a_second_identical_child(self):
        api=Mock();api.pages.return_value=[]
        api.side_effect=lambda path,data=None: {'title':'Радар'} if path=='issues/177' else self.i
        with patch.object(P,'parent_unchanged'),patch.object(P,'live',return_value=(A,S)):
            first=P.publish(api,self.doc,901)
            self.assertEqual(first['issue'],777)
            writes=[x for x in api.call_args_list if x.args[0]=='issues'];self.assertEqual(len(writes),1)
            api.pages.return_value=[self.i];api.reset_mock()
            again=P.publish(api,self.doc,901);self.assertEqual(again,first)
            self.assertFalse(any(x.args[0]=='issues' for x in api.call_args_list))
    def test_foreign_artifact_run_or_failed_review_does_not_write(self):
        api=Mock()
        with self.assertRaises(core.Refused):P.publish(api,self.doc,999)
        doc=copy.deepcopy(self.doc);doc['last']['recovery']['review']['verdict']='FAIL'
        with self.assertRaises(core.Refused):P.publish(api,doc,901)
        self.assertFalse(any(x.args[0]=='issues' for x in api.call_args_list))
    def test_publisher_has_no_ssh_secret_and_execute_has_no_issue_write(self):
        from pathlib import Path
        from test_actions_train import ROOT
        y=(ROOT/'.github/workflows/train-stage.yml').read_text()
        exe=y.split('  execute:',1)[1].split('  publish_recovery:',1)[0]
        pub=y.split('  publish_recovery:',1)[1].split('  continue:',1)[0]
        self.assertIn('issues: read',exe);self.assertNotIn('issues: write',exe)
        self.assertIn('issues: write',pub);self.assertNotIn('DEPLOY_SSH_KEY',pub);self.assertNotIn('environment:',pub)
    def test_publication_job_retry_cap_never_reruns_model_stage(self):
        r=copy.deepcopy(self.r);r['publication_run']={'run':901,'attempt':1}
        api=Mock(return_value=dict(id=901,path='.github/workflows/train-stage.yml',event='workflow_dispatch',head_branch='dev',
                                  repository={'full_name':core.REPO},status='completed',run_attempt=2))
        api.pages.return_value=[dict(id=902,name='publish_recovery',status='completed',conclusion='failure'),
                               dict(id=903,name='execute',status='completed',conclusion='success')]
        result=D.retry_publications(api,{'recovery':{'receipts':{self.key:r}}})
        self.assertEqual(result[0]['rerun_job'],902)
        self.assertTrue(any(x.args[0]=='actions/jobs/902/rerun' for x in api.call_args_list))
        api.reset_mock();api.return_value['run_attempt']=3
        D.retry_publications(api,{'recovery':{'receipts':{self.key:r}}})
        self.assertFalse(any('/rerun' in x.args[0] for x in api.call_args_list))

if __name__=='__main__':unittest.main()
