# Independent QA: PR21 candidate a433a9c

Reviewer: separate independent QA agent; source author and author CI were not used as QA evidence.

Exact candidate independently cloned from GitHub on original Germany vmi3510488 into /tmp/gobadminton-independent-qa-a433a9c:
- SHA a433a9c09509968c6429dc5167e22aef5a05480e
- tree 24146461698d6da5cae1633d1b6eb7fb324e9baf
- parent acb7e6a3c360b08cacd4d602ed975dad9ee2715e

Verdict: original Owner event rejection repair PASS; full commissioning readiness FAIL due to concrete historical polling blocker.

Executed independently:
- 58 tests from clean Git binding, Friends DAG, protected QA identity, Git aliases, compact capsule, sandbox/control, and clean commissioning modules: PASS (0.273s).
- Live public GitHub REST fetch of comment 6148670164 matches committed fixture body exactly. Original created_at and updated_at both 2026-10-13T15:08:14Z; original Owner account matches; exact body digest 2d3cf0e888a45546512164372818d19355d1eff519b34648b35e7221d1626751. Real event accepted for four prepared Friends/Radar task IDs.
- Extra boolean ID, parent issue URL, comment URL, absent creation/update timestamps and invisible Unicode body mutation substitutions refused.
- Private disposable inbox: first exact receipt write succeeds; second identical write returns False.
- Available Germany Codex CLI 0.160.1 --version and exec --help checked read-only; --approve-for-me uses workspace-write and output-last-message is supported.

Blocking finding P1: github_owner_issue_intake.poll_once verifies every historical comment against current canonical task status before checking durable receipt idempotency. Once any of the four bootstrap task statuses changes away from queued, historical event 6148670164 raises IntakeHold("task not prepared as exact immutable DEV source") on the next poll. pending_owner_instructions turns this into RuntimeError. Thus consumed history can stop Autopilot and prevent subsequent authorized tasks starting.

Exact reproduction: original fixture + canonical queue => poll at 1000000000 creates github-issue4-comment-6148670164. Change its durable inbox status to PLANNED; change Friends canonical task status to completed. Poll same original event at 1000000600 => confirmed IntakeHold. Only temporary files changed.

Fix requirement: verify immutable event identity/account/body/timestamp and durable receipt binding for previously received events without re-admitting terminal tasks; new events must retain canonical queued/source gates. Preserve body substitution/replay refusal. Add regression covering consumed bootstrap followed by canonical completion and subsequent new authorized event in same poll.

Additional limitation: broad legacy discovery ran 224 tests, 99 failures and 13 errors, predominantly legacy fixture clean-repo source binding incompatibilities. This is not claimed as a clean full suite. Focused active clean tests above passed. No protected root independent job, real worker, Git publication or DEV delivery was executed by this reviewer, so those runtime requirements remain unverified. No service/unit/runtime/DB mutations, root evidence creation, sandbox bypass or installation attempts occurred.

## Independent re-review: 70566c0 (supersedes candidate-level blocker)

Exact replacement independently fetched from GitHub and checked out on Germany:
- SHA 70566c0d8aa779b7d35b30c75d346dd59901aa02
- tree 1d3a5f320718d377cd757ee3d6db7b12d0353b42
- parent a433a9c09509968c6429dc5167e22aef5a05480e

Final source-review verdict: PASS for PR21 original-event fix and historical event progression repair. Previous FAIL remains recorded above and was resolved by this separate exact candidate.

Independent focused suite now 59 tests PASS, 0.285s. Independent additional reproduction using live GitHub original event: initial intake persisted; inbox PLANNED and Friends canonical completed; same poll containing historical event plus new valid Avatar event accepted only new event and preserved original PLANNED receipt bytes. Corrupted existing body digest refused; edited received body refused; deleted receipt with terminal task refused as new admission. This verifies the defect was repaired without opening terminal-task re-admission or weakening original body integrity.

Runtime commissioning remains NOT VERIFIED by this source reviewer: no independent protected QA job certificate, real executor PID, publication or DEV deployment attested. Source PASS is suitable for bounded commissioning; it does not claim those operational results.
