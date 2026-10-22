"""Host-only, idempotent publication of a DRAFT stage plan to its parent Issue.

This bot comment is NOT a GOBADMINTON_AUTONOMY_V1 admission and cannot claim any
source slot. Recomputes original Owner scope and every child before Issue writes.
No SSH, VPS secrets, model tokens, git writes or task promotion.
"""
import importlib.util
import json
import os
from pathlib import Path

from core import API, OWNER, REPO, Refused, loads, need

DRAFT_MARKER = 'GOBADMINTON_PHASE_PLAN_V2_DRAFT'
PLANNER = Path(__file__).resolve().parent.parent / 'planning' / 'phase_task_plan_v2.py'


def planner():
    need(PLANNER.is_file() and not PLANNER.is_symlink(), 'trusted GitHub checkout planner absent')
    spec = importlib.util.spec_from_file_location('gb_phase_plan_v2', PLANNER)
    need(spec is not None and spec.loader is not None, 'invalid planner module')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exact_published_body(plan):
    need(plan.get('schema') == 'GOBADMINTON_PHASE_PLAN_V2_DRAFT'
         and plan.get('status') == 'PLAN_PROPOSED_NOT_ADMITTED'
         and plan.get('can_start_execution') is False
         and all(c.get('can_start_execution') is False for c in plan.get('children', [])),
         'unapproved phase plan cannot be published as accepted')
    return DRAFT_MARKER + '\n' + json.dumps(plan, sort_keys=True,
                                              ensure_ascii=False, separators=(',', ':'))


def publish_one(api, plan, engine=None):
    """Compare plan JSON with live canonical owner scope before any write."""
    engine = engine or planner()
    number = plan.get('parent_issue')
    need(type(number) is int and 0 < number < 10**9, 'invalid parent Issue number')
    issue = api(f'issues/{number}')
    comments = api.pages(f'issues/{number}/comments')
    refreshed = engine.proposal(issue, comments)
    need(refreshed == plan, 'plan/source bytes no longer match Owner scope')
    body = exact_published_body(plan)
    need(len(body.encode()) <= 65536, 'plan too large to publish')
    existing = [v for v in comments if v.get('body') == body]
    need(len(existing) <= 1, 'duplicate immutable phase plan publication')
    if existing:
        return dict(status='already-published', parent_issue=number,
                    url=existing[0].get('html_url'), comment_id=existing[0].get('id'))
    record = api(f'issues/{number}/comments', dict(body=body))
    need(record.get('body') == body
         and record.get('user', {}).get('id') in (41898282, OWNER),
         'untrusted publication receipt')
    return dict(status='published-draft-not-admitted', parent_issue=number,
                comment_id=record.get('id'), url=record.get('html_url'))


def publish(api, snapshot):
    need(snapshot.get('schema') == 'GB_PHASE_PREVIEW_V2'
         and snapshot.get('can_start_execution') is False
         and type(snapshot.get('results')) is list, 'invalid read-only plan artifact')
    result=[]
    # Never turn an ordinary backlog record or an oversized selection into bot writes.
    eligible=[x for x in snapshot['results']
              if x.get('status') == 'PLAN_PROPOSED_NOT_ADMITTED']
    need(len(eligible) <= 12, 'publication candidate cap exceeded')
    for plan in eligible:
        result.append(publish_one(api,plan))
    return dict(schema='GB_PHASE_PUBLICATION_V2', results=result,
                can_start_execution=False)


def main():
    need(os.environ.get('GITHUB_REPOSITORY') == REPO
         and os.environ.get('GITHUB_REF') == 'refs/heads/dev'
         and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
         and os.environ.get('GITHUB_ACTOR') in ('github-actions[bot]','anpavel84-afk'),
         'untrusted hosted plan publisher')
    path=Path('evidence/phase-plan-preview-v2.json')
    need(path.is_file() and not path.is_symlink()
         and path.stat().st_size <= 262144, 'bad bounded same-run plan evidence')
    api=API(os.environ['GH_TOKEN'])
    api.identity()
    result=publish(api,loads(path.read_bytes()))
    Path('evidence/phase-plan-publication-v2.json').write_text(
        json.dumps(result,sort_keys=True,ensure_ascii=False))
    print(json.dumps(result,sort_keys=True,ensure_ascii=False))


if __name__=='__main__':
    main()
