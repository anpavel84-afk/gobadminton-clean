"""Closed Owner-authenticated #29 grants: negative and compatibility regressions."""
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'actions_train'))
import antigravity_qa_recovery as Q
import native_antigravity as N
import owner_package_admission as A
from core import digest

COMMENT=6381122334
CONTROLLER='e02436862e606b61e4d2e2187bf25a205586426f'

def grant(role,comment=COMMENT):
    revision,path,sha=A.EXPECTED_PINS[role]
    return dict(schema=Q.ADDRESSED_SCHEMA,lineage=Q.ADDRESSED_LINEAGE,
                owner_comment=comment,role=role,controller_revision=CONTROLLER,
                cli_sha256=N.AGY_SHA256,rules_sha256=A.RULES,
                base=A.SOURCE_BASE,head=A.SOURCE_HEAD,input_revision=revision,
                input_path=path,input_sha256=sha,timeout=1800,
                max_output_bytes=N.MAX_OUT,permission_mode=N.PERMISSION_MODE,
                input_transport='stream-json',ceiling=1)

def ledger():
    gs=[grant('technical_pm_product_analyst'),grant('independent_qa')]
    return dict(schema=Q.OWNER_PACKAGE_SCHEMA,owner_comment=COMMENT,
                owner_id=318610566,issue=29,controller_sha=CONTROLLER,
                rules_sha256=A.RULES,source_base=A.SOURCE_BASE,
                source_head=A.SOURCE_HEAD,body_sha256='f'*64,ceiling=2,
                used_calls=0,grants={digest(g):dict(grant=g,operation=None) for g in gs},
                previous_addressed_sha256=A.HIST,
                previous_supplement_sha256=A.SUP)

class Response:
    status=200
    def __init__(self,data):self.data=json.dumps(data).encode()
    def __enter__(self):return self
    def __exit__(self,*_):return False
    def read(self,_):return self.data

class OwnerPackageTests(unittest.TestCase):
    def test_dynamic_package_enrollment_pins(self):
        for role in A.EXPECTED_PINS: self.assertEqual(Q.validate_addressed_grant(grant(role),enrollment=True),grant(role))
        self.assertFalse(Q.owner_package(grant('independent_qa',Q.SUPPLEMENT_OWNER_COMMENT)))

    def test_closed_two_roles_no_overruns(self):
        l=ledger();self.assertEqual(Q.owner_package_ledger(l),l)
        for mutation in (
          lambda x:x.update(ceiling=3),
          lambda x:x.update(used_calls=1),
          lambda x:x.update(previous_addressed_sha256='0'*64),
          lambda x:x['grants'].pop(next(iter(x['grants']))),
          lambda x:x.update(controller_sha='0'*40),
          lambda x:x.update(owner_id=1),
        ):
            y=json.loads(json.dumps(l));mutation(y)
            with self.assertRaises(Exception):Q.owner_package_ledger(y)

    def test_single_spend_requires_exact_row_and_counter(self):
        l=ledger();first=next(k for k,r in l['grants'].items()
             if r['grant']['role']=='technical_pm_product_analyst')
        l['grants'][first]['operation']='a'*64;l['used_calls']=1
        self.assertIs(Q.owner_package_ledger(l),l)
        l['grants'][first]['operation']='b'*64;l['used_calls']=0
        with self.assertRaises(Exception):Q.owner_package_ledger(l)

    def test_owner_comment_must_be_real_owner_and_issue(self):
        v=dict(schema=A.Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,
               controller_sha=CONTROLLER,rules_sha256=A.RULES,
               source_base=A.SOURCE_BASE,source_head=A.SOURCE_HEAD,model=N.MODEL,
               max_calls=2,owner_comment=COMMENT,
               calls=[dict(role=r,input_revision=t[0],input_path=t[1],input_sha256=t[2])
                      for r,t in A.EXPECTED_PINS.items()])
        body=A.PREFIX+json.dumps(v,sort_keys=True,separators=(',',':'))
        data=dict(id=COMMENT,issue_url=A.ISSUE_URL,
                  user=dict(id=318610566,login='anpavel84-afk'),
                  author_association='OWNER',body=body)
        with patch.object(A.urllib.request,'urlopen',return_value=Response(data)):
            b,x=A.owner_comment(COMMENT);self.assertEqual(x,v)
        for field,value in [('id',COMMENT+1),('issue_url',A.ISSUE_URL+'1'),
                            ('author_association','NONE')]:
            altered=dict(data);altered[field]=value
            with patch.object(A.urllib.request,'urlopen',return_value=Response(altered)):
                with self.assertRaises(Exception):A.owner_comment(COMMENT)
        altered=dict(data,user=dict(id=12345,login='anpavel84-afk'))
        with patch.object(A.urllib.request,'urlopen',return_value=Response(altered)):
            with self.assertRaises(Exception):A.owner_comment(COMMENT)

    def test_authorize_cannot_weaken_controller_role_or_hash(self):
        v=dict(schema=Q.OWNER_PACKAGE_SCHEMA,issue=29,repo_id=A.REPO_ID,
               controller_sha=CONTROLLER,rules_sha256=A.RULES,
               source_base=A.SOURCE_BASE,source_head=A.SOURCE_HEAD,model=N.MODEL,
               max_calls=2,owner_comment=COMMENT,
               calls=[dict(role=r,input_revision=t[0],input_path=t[1],input_sha256=t[2])
                      for r,t in A.EXPECTED_PINS.items()])
        with patch.object(A,'owner_comment',return_value=('trusted',v)),patch.object(Q,'addressed_input',return_value='inert'):
            self.assertEqual(A.authorize(COMMENT,CONTROLLER)['used_calls'],0)
            for change in (
                {'max_calls':3},{'controller_sha':'0'*40},
                {'source_head':'0'*40},{'model':'unknown'},
                {'owner_comment':COMMENT+1}
            ):
                u=dict(v,**change)
                with patch.object(A,'owner_comment',return_value=('trusted',u)):
                    with self.assertRaises(Exception):A.authorize(COMMENT,CONTROLLER)
            u=dict(v,calls=[dict(v['calls'][0]),dict(v['calls'][0])])
            with patch.object(A,'owner_comment',return_value=('trusted',u)):
                with self.assertRaises(Exception):A.authorize(COMMENT,CONTROLLER)

if __name__=='__main__':unittest.main()
