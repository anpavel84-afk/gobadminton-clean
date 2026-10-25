#!/usr/bin/env python3
"""Builds the exact Issue #29 Owner package comment body (does NOT post anything).
usage: make_owner_comment.py <controller_sha> [owner_comment_id]
owner_comment is self-referential: post once with 0 (placeholder), then EDIT the same comment with its real id
(this is how #6379127824 / #6379442541 were done: created_at != updated_at).
Output has NO trailing newline (required by the admission canonical-JSON check); paste it verbatim, do not add one."""
import json,sys
ctrl=sys.argv[1]; cid=int(sys.argv[2]) if len(sys.argv)>2 else 0
body={"schema":"GB_AGY_29_OWNER_PACKAGE_V1","issue":29,"repo_id":1416250340,"controller_sha":ctrl,
 "rules_sha256":"017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269",
 "source_base":"b0e4d233bc150f42ada86c4c0f56897c57e0d0fe","source_head":"12f35ac4430348ae811cf712d9bb24d2a19b62e6",
 "model":"claude-sonnet-5-5-medium","max_calls":2,"owner_comment":cid,
 "calls":[{"role":"technical_pm_product_analyst","input_revision":"12f35ac4430348ae811cf712d9bb24d2a19b62e6",
  "input_path":"scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json","input_sha256":"40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55"},
 {"role":"independent_qa","input_revision":"6a53099160f0ae7312f6d282b061c5230e7d2536",
  "input_path":"scripts/chatops/tests/fixtures/agy-236-independent-qa-12f35ac.json","input_sha256":"c1672961885bea637d1ff21ffd05accc73837fe669e853f4b911d9f7ad7dcee9"}]}
# owner_package_admission.owner_comment(): body == PREFIX + content and json.dumps(json.loads(content), sort_keys=True, separators=(',',':')) == content.
# So emit exactly the prefix + the canonical JSON and NOTHING else: no trailing newline (print() would add one and admission would refuse).
sys.stdout.write("GOBADMINTON_AGY_PACKAGE_V1\n"+json.dumps(body,sort_keys=True,separators=(',',':')))
