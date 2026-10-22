"""Read-only runtime failure is not a source verdict or permission to rerun an author."""
import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock
from test_actions_train import core, A, ROOT, HEAD, BASE, active, req
from test_actions_train_stages import Store, Bridge
import qa_recovery as Q

class Recovery(unittest.TestCase):
    def test_only_stopped_completed_unknown_qa_with_unchanged_checkpoint_is_safe(self):
        a=active('qa');s={'active':a,'done':[]}
        b=req('qa','pr_wait');b.update(issue=a['issue'],attempt=a['attempt'],head=a['head'])
        op={'binding':b,'result':{'status':'unknown'},'finished_at':123,'process':{'pid':123},'after':core.digest(s)}
        j={'pending':'key','operations':{'key':op}}
        self.assertTrue(Q.safe_pending(j,s,lambda _:False))
        self.assertFalse(Q.safe_pending(j,s,lambda _:True))
        for mutate in (lambda x:x['operations']['key']['binding'].update(stage='author'),
                       lambda x:x['operations']['key'].update(after='f'*64),
                       lambda x:x['operations']['key']['result'].update(status='running'),
                       lambda x:x['operations']['key'].update(finished_at=None)):
            v=copy.deepcopy(j);mutate(v);self.assertFalse(Q.safe_pending(v,s,lambda _:False))
    def test_exact_saved_verdict_reconciles_without_second_model_or_author(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as tmp:
            p=Path(tmp);a=active('qa');store=Store(a);b=Bridge(store,p);b.model=Mock()
            result={'verdict':'PASS','findings':[],'reviewed_sha':HEAD}
            (p/f'qa-issue-{a["issue"]}-a{a["attempt"]}').mkdir()
            b.git=Mock(side_effect=lambda *args,**kwargs:HEAD if args[0]=='rev-parse' else '')
            (p/f'qa-{a["issue"]}-a{a["attempt"]}.json').write_text(json.dumps(result))
            x=Q.reconcile(A,b,Mock(),store,req('qa','pr_wait')|{'issue':a['issue'],'attempt':a['attempt'],'head':HEAD})
            self.assertTrue(x['recovered']);self.assertEqual(store.data['active']['qa'],result)
            b.model.assert_not_called();self.assertEqual(a['attempt'],1)
    def test_saved_pass_from_dirty_or_wrong_head_review_is_not_reused(self):
        for bad_head, dirty in ((False,True),(True,False)):
            with self.subTest(bad_head=bad_head,dirty=dirty),tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as tmp:
                p=Path(tmp);a=active('qa');store=Store(a);b=Bridge(store,p)
                old={'verdict':'PASS','findings':[],'reviewed_sha':HEAD}
                main=p/f'qa-{a["issue"]}-a{a["attempt"]}.json';main.write_text(json.dumps(old))
                original=p/f'qa-issue-{a["issue"]}-a{a["attempt"]}';original.mkdir()
                actual={'verdict':'FAIL','findings':['independent new review finds real defect'],'reviewed_sha':HEAD}
                b.model=Mock(return_value=actual)
                def git(*args,**kw):
                    previous=kw.get('cwd')==original
                    if args[0]=='rev-parse':return BASE if previous and bad_head else HEAD
                    if args[0]=='status':return ' M source.py' if previous and dirty else ''
                    return ''
                b.git=Mock(side_effect=git)
                x=Q.reconcile(A,b,Mock(),store,req('qa','pr_wait')|{'issue':a['issue'],'attempt':a['attempt'],'head':HEAD})
                self.assertEqual(x['qa'],actual);b.model.assert_called_once()
                self.assertEqual(store.data['active']['attempt'],1)
    def test_old_sha_verdict_never_promoted_and_one_new_read_only_qa_keeps_it_in_history(self):
        with tempfile.TemporaryDirectory(dir=ROOT,prefix='.train-tests-') as tmp:
            p=Path(tmp);a=active('qa');store=Store(a);b=Bridge(store,p)
            old={'verdict':'PASS','findings':[],'reviewed_sha':BASE}
            main=p/f'qa-{a["issue"]}-a{a["attempt"]}.json';main.write_text(json.dumps(old))
            result={'verdict':'FAIL','findings':['real source defect'],'reviewed_sha':HEAD}
            b.model=Mock(return_value=result)
            b.git=Mock(side_effect=lambda *args,**kwargs:HEAD if args[0]=='rev-parse' else '')
            x=Q.reconcile(A,b,Mock(),store,req('qa','pr_wait')|{'issue':a['issue'],'attempt':a['attempt'],'head':HEAD})
            self.assertEqual(x['qa'],result);self.assertEqual(store.data['active']['attempt'],1)
            b.model.assert_called_once();self.assertTrue(b.model.call_args.kwargs['qa'])
            self.assertEqual(json.loads(main.read_text()),result)
            prior=list(p.glob('qa-prior-*.json'));self.assertEqual(len(prior),1);self.assertEqual(json.loads(prior[0].read_text()),old)
            self.assertNotIn('author',b.calls)

if __name__=='__main__':unittest.main()
