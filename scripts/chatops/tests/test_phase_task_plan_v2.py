"""Independent pure planning checks. No GitHub calls, issue publication or process spawn."""
import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/"scripts/chatops/planning"))
import phase_task_plan_v2 as P


def scope(*,risk="routine",paths=None):
    return dict(schema=P.PARENT_MARKER,goal="Public venues with permissions",
                acceptance="Strict viewer scope and exact DEV proof",
                allowed_paths=paths or ["apps/web/src/components/consumer/games/VenueSheet.tsx"],
                risk=risk,max_attempts=3,approved_product_scope=True)


def owned_issue(number=200, value=None):
    return dict(number=number,user={"id":P.OWNER_ID},state="open",
                title="Real Owner feature",created_at="2026-10-22T11:00:00Z",
                updated_at="2026-10-22T12:00:00Z",
                body="Owner approved product objective; not executable")


def comment(issue, value=None):
    return dict(id=1,user={"id":P.OWNER_ID},
                issue_url="https://api.github.com/repos/anpavel84-afk/gobadminton-clean/issues/"+str(issue["number"]),
                created_at="2026-10-22T11:01:00Z",
                updated_at="2026-10-22T11:01:00Z",
                body=P.PARENT_MARKER+"\n"+json.dumps(value or scope(),ensure_ascii=False))


class StagePlanner(unittest.TestCase):
    def test_routine_web_parent_becomes_one_cursor_first_draft(self):
        issue=owned_issue()
        result=P.proposal(issue,[comment(issue)])
        self.assertEqual(result["status"],"PLAN_PROPOSED_NOT_ADMITTED")
        self.assertFalse(result["can_start_execution"])
        self.assertEqual(len(result["children"]),1)
        child=result["children"][0]
        self.assertEqual(child["key"],"web")
        self.assertEqual(child["author_routes"][0],"cursor:auto")
        self.assertEqual(child["author_routes"][1],"codex:gpt-6.1-sol:medium")
        self.assertEqual(child["qa_routes"][0],"agy:claude-sonnet-5-5-high")
        self.assertFalse(child["can_start_execution"])

    def test_critical_api_and_web_go_through_astra_first(self):
        issue=owned_issue()
        raw=scope(risk="critical",paths=[
            "docs/api/VENUE_CONTRACT.md",
            "packages/contracts/openapi.json",
            "apps/api/src/venues/venues.controller.ts",
            "apps/web/src/components/consumer/games/VenueSheet.tsx"])
        x=P.proposal(issue,[comment(issue,raw)])
        children={c["key"]:c for c in x["children"]}
        self.assertEqual(set(children),{"architecture","api","web"})
        self.assertEqual(children["architecture"]["author_routes"][0],"codex:gpt-6-astra:high")
        self.assertEqual(children["api"]["depends_on_keys"],["architecture"])
        self.assertEqual(children["web"]["depends_on_keys"],["api"])
        self.assertEqual(children["api"]["qa_routes"][0],"agy:claude-opus-5-5-high")
        self.assertFalse(x["can_start_execution"])

    def test_critical_undocumented_scope_cannot_fake_architecture_permission(self):
        issue=owned_issue()
        result=P.proposal(issue,[comment(issue,scope(risk="critical"))])
        self.assertEqual(result["status"],"BLOCKED_NEEDS_ARCHITECTURE_PATH")
        self.assertEqual(result["children"],[])

    def test_owner_signature_is_exact_numeric_and_unedited(self):
        issue=owned_issue()
        good=comment(issue)
        for bad in ({**good,"user":{"id":999}},
                    {**good,"updated_at":"2026-10-22T11:05:00Z"},
                    {**good,"issue_url":good["issue_url"]+"/other"},
                    {**good,"body":good["body"].replace(P.PARENT_MARKER,"DIFFERENT",1)}):
            with self.subTest(bad=bad),self.assertRaises(P.InvalidPlan):
                P.proposal(issue,[bad])
        with self.assertRaises(P.InvalidPlan):
            P.proposal(issue,[good,copy.deepcopy(good)])
        with self.assertRaises(P.InvalidPlan):
            P.proposal({**issue,"user":{"id":4}},[good])

    def test_paths_cannot_mutate_operations_or_escape_scope(self):
        issue=owned_issue()
        for path in ("docs/operations/SUPERVISOR.md","docs/rules/README.md",
                     "../secret","/root/.ssh/id","apps//api.ts"):
            with self.subTest(path=path),self.assertRaises(P.InvalidPlan):
                P.proposal(issue,[comment(issue,scope(paths=[path]))])

    def test_parent_model_never_expands_relative_path_scope(self):
        issue=owned_issue()
        draft=P.proposal(issue,[comment(issue,scope(paths=[
            "apps/api/src/games/games.service.ts",
            "apps/admin/src/venues/Venues.tsx",
            "apps/web/src/components/consumer/pages/GamesPage.tsx"]) )])
        assigned=[p for c in draft["children"] for p in c["allowed_paths"]]
        self.assertEqual(len(assigned),3)
        self.assertEqual(len(set(assigned)),3)
        self.assertEqual(draft["children"][0]["key"],"api")

    def test_draft_revision_computes_delta_without_granting_scope(self):
        issue=owned_issue()
        original=P.proposal(issue,[comment(issue)])
        modified=P.proposal(issue,[comment(issue,scope(paths=[
            "apps/web/src/components/consumer/games/VenueSheet.tsx",
            "apps/admin/src/venues/Venues.tsx"]))])
        delta=P.revise(original,modified)
        self.assertEqual(delta["new"],["admin"])
        self.assertEqual(delta["changed"],[])
        self.assertTrue(delta["scope_changed"])
        self.assertFalse(delta["can_start_execution"])

    def test_preview_only_refuses_ordinary_backlog_without_parent_envelope(self):
        issue=owned_issue()
        out=P.preview_for_issues([issue],{})
        self.assertEqual(out["results"][0]["status"],P.BLOCKED)
        self.assertFalse(out["can_start_execution"])

    def test_parent_scope_is_a_draft_not_machine_admission(self):
        issue=owned_issue()
        out=P.preview_for_issues([issue],{issue["number"]:[comment(issue)]})
        self.assertTrue(all(child["can_start_execution"] is False
                            for child in out["results"][0]["children"]))
        self.assertEqual(out["results"][0]["review_gates"][-1],"provider sandbox qualified")

    def test_edited_or_ambiguous_parent_cannot_publish_children(self):
        issue=owned_issue()
        data=scope()
        bad = scope()
        bad["risk"]="complex"
        with self.assertRaises(P.InvalidPlan):
            P.proposal(issue,[comment(issue,data),comment(issue,bad)])


if __name__=="__main__":unittest.main()
