"""Hosted-only publication of an independently reviewed recovery receipt.
No SSH credentials/connection, model execution, source changes or Owner impersonation.
"""
import json
import os
from pathlib import Path
from core import API, OWNER, REPO, digest, live, loads, need
from recovery_admission import BOT, body, proposed, parse_issue, parent_unchanged, safe_task


def publish(api, document, run):
    last = document.get('last') or {}
    need(document.get('status') == 'confirmed' and last.get('stage') == 'task_review'
         and last.get('workflow_run') == run and last.get('changed') is True,
         'not the confirmed definition-review artifact of this workflow')
    r = last.get('recovery')
    need(r and r['status'] == 'publish_ready' and last.get('issue') == r['frozen']['issue'],
         'no approved publication reservation')
    api.identity()
    a, _ = live()
    payload = proposed(r)
    safe_task(a, payload['task'])
    parent_unchanged(a, api, r['frozen'])
    raw = body(r)
    need(len(raw.encode()) <= 32768, 'publication too large')
    matches = [i for i in api.pages('issues?state=all&sort=created&direction=desc')
               if i.get('body') == raw and 'pull_request' not in i]
    need(len(matches) <= 1, 'duplicate recovery Issues; no additional publication')
    if matches:
        issue = matches[0]
    else:
        parent = api(f'issues/{payload["parent"]}')
        # API deliberately does not retry writes on unknown network outcome. A rerun
        # first reconciles the exact receipt marker, never generates a fresh task/receipt.
        issue = api('issues', dict(title=(f'Восстановление #{payload["parent"]}: ' + parent['title'])[:240], body=raw))
    parse_issue(issue, r)
    return dict(schema='GB_RECOVERY_PUBLISHED_V1', source_run=run, receipt=payload['receipt'],
                parent=payload['parent'], issue=issue['number'], url=issue['html_url'],
                body_hash=digest(raw), status='published-not-yet-claimed')


def main():
    need(os.environ.get('GITHUB_REPOSITORY') == REPO and os.environ.get('GITHUB_REF') == 'refs/heads/dev'
         and int(os.environ.get('GITHUB_ACTOR_ID','0')) in (OWNER,BOT), 'untrusted hosted publisher')
    file = Path('evidence/stage.json')
    need(file.is_file() and not file.is_symlink() and file.stat().st_size <= 1048576, 'invalid same-run stage artifact')
    result = publish(API(os.environ['GH_TOKEN']), loads(file.read_bytes()), int(os.environ['GITHUB_RUN_ID']))
    Path('evidence/recovery-publication.json').write_text(json.dumps(result,ensure_ascii=False,sort_keys=True))
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))

if __name__ == '__main__': main()
