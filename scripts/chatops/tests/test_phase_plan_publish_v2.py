"""Host Issue-comment stage-plan publisher: exact Owner proof and no admission."""
import json
import sys
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
for path in ("scripts/chatops/planning","scripts/chatops/actions_train"):
    sys.path.insert(0,str(ROOT/path))
import phase_task_plan_v2 as P
import phase_plan_publish_v2 as V


def issue():
    return dict(number=210,title="Owner plan",body="Historical approval",
        created_at="2026-10-22T09:00:00Z",
        updated_at="2026-10-22T10:00:00Z",
        user={"id":P.OWNER_ID},state="open")


def comment(thing):
    payload=dict(schema=P.PARENT_MARKER,goal="Implement a safe public venue profile",
                 acceptance="Privacy scoped read + exact DEV smoke",
                 risk="critical",max_attempts=3,approved_product_scope=True,
                 allowed_paths=["docs/api/VENUE_PROFILE_V2.md",
                                "apps/api/src/venues/venue.controller.ts"])
    return dict(id=1,user={"id":P.OWNER_ID},
                created_at="2026-10-22T09:02:00Z",
                updated_at="2026-10-22T09:02:00Z",
                issue_url="https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/210",
                body=P.PARENT_MARKER+"\n"+json.dumps(payload,ensure_ascii=False))


class API:
    def __init__(self, old=None, corrupt=False):
        self.the_issue=issue()
        self.comments=[comment(self.the_issue)]
        if old:self.comments.append(old)
        self.writes=[]
        self.corrupt=corrupt

    def __call__(self, path, data=None):
        if path=="issues/210":
            return self.the_issue
        if path=="issues/210/comments" and data:
            self.writes.append(data)
            new=dict(id=123456,body=data["body"],user={"id":41898282,
                     "login":"github-actions[bot]","type":"Bot"},
                     created_at="2026-10-22T14:00:00Z",updated_at="2026-10-22T14:00:00Z",
                     html_url="https://github.com/anpavel84-afk/gobadminton-clean/issues/210#issuecomment-123456")
            self.comments.append(new)
            return new
        raise RuntimeError("Unexpected GitHub access "+str(path))

    def pages(self,path):
        assert path=="issues/210/comments"
        return list(self.comments)


class StageDraftPublishing(unittest.TestCase):
    def test_publishes_exact_owner_plan_once_without_minting_approval(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        r=V.publish(api,{"schema":"GB_PHASE_PREVIEW_V2",
                         "can_start_execution":False,
                         "results":[stage]})
        self.assertEqual(r["results"][0]["status"],"published-draft-not-admitted")
        self.assertEqual(len(api.writes),1)
        self.assertTrue(api.writes[0]["body"].startswith(V.DRAFT_MARKER+"\n"))
        self.assertNotIn("GOBADMINTON_AUTONOMY_V1",api.writes[0]["body"])
        self.assertFalse(json.loads(api.writes[0]["body"].split("\n",1)[1])["can_start_execution"])
        same=V.publish(api,{"schema":"GB_PHASE_PREVIEW_V2",
                            "can_start_execution":False,"results":[stage]})
        self.assertEqual(same["results"][0]["status"],"already-published")
        self.assertEqual(len(api.writes),1)

    def test_changed_owner_scope_or_artifact_refuses_write(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        stage["children"][0]["goal"]="invented new capability"
        with self.assertRaisesRegex(V.Refused,"no longer match"):
            V.publish(api,{"schema":"GB_PHASE_PREVIEW_V2",
                           "can_start_execution":False,"results":[stage]})
        self.assertEqual(api.writes,[])

    def test_forged_execution_permission_rejected(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        stage["can_start_execution"]=True
        with self.assertRaises(V.Refused):
            V.publish_one(api,stage)
        self.assertEqual(api.writes,[])

    def test_rejects_duplicate_published_plan_receipts(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        raw=V.exact_published_body(stage)
        api.comments.extend([dict(id=i,body=raw) for i in (81,82)])
        with self.assertRaisesRegex(V.Refused,"duplicate"):
            V.publish_one(api,stage)
        self.assertFalse(api.writes)

    def test_untrusted_matching_comment_is_not_idempotence_proof(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        api.comments.append(dict(id=55,body=V.exact_published_body(stage),
                                 user={"id":700,"login":"other","type":"User"},
                                 created_at="2026-10-22T14:00:00Z",
                                 updated_at="2026-10-22T14:00:00Z",
                                 html_url="https://github.com/anpavel84-afk/gobadminton-clean/issues/210#issuecomment-55"))
        with self.assertRaisesRegex(V.Refused,"untrusted/duplicate"):
            V.publish_one(api,stage)
        self.assertEqual(api.writes,[])

    def test_modified_bot_comment_is_not_immutable_proof(self):
        api=API()
        stage=P.proposal(api.the_issue,api.comments)
        api.comments.append(dict(id=56,body=V.exact_published_body(stage),
                                 user={"id":41898282,"login":"github-actions[bot]","type":"Bot"},
                                 created_at="2026-10-22T14:00:00Z",
                                 updated_at="2026-10-22T14:01:00Z",
                                 html_url="https://github.com/anpavel84-afk/gobadminton-clean/issues/210#issuecomment-56"))
        with self.assertRaisesRegex(V.Refused,"untrusted/duplicate"):
            V.publish_one(api,stage)
        self.assertEqual(api.writes,[])

    def test_incomplete_owner_scope_is_not_autopublished(self):
        api=API()
        api.comments=[]
        report=P.preview_for_issues([api.the_issue],{210:[]})
        result=V.publish(api,report)
        self.assertEqual(result["results"],[])
        self.assertFalse(api.writes)


if __name__=="__main__":
    unittest.main()
