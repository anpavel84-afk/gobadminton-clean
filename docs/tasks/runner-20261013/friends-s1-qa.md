# Independent QA · Friends S1 foundation
Owner scope #12. Review the **exact published producer SHA/tree/branch**, not a code summary or an old legacy R2. This is a different review session from the producer, with explicitly read-only filesystem sandbox.

Check DB schema 0032 on **disposable** PostGIS against current 31 migrations and rollback; auth spoof, cross-user request operations, duplicate/concurrent accept, replay and deleted accounts, block/visibility privacy, no geographic leak, contract consistency and existing Games profile flows. Examine changed-scope tests/logs and independently reproduce critical negative cases. FAIL/BLOCKED on missing source branch, unpublished SHA, no reproducible test, missing protected QA job/policy, or any security gap.

Final response must be exact JSON completion receipt containing project GoBadminton, task_id, ok, verdict PASS|FAIL|BLOCKED, exact producer_task_id, candidate_sha, candidate_tree, branch, verified test evidence, blocking_findings, no invented root trusted_job. QA source PASS does not grant database migration or DEV deployment by itself.
