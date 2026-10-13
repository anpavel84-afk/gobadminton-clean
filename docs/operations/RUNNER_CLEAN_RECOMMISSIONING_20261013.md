# Runner clean-root recommissioning · original-host execution receipt · 2026-10-13

**Owner:** approved restoration of the established Runner + QA + Implementation + fast Germany DEV delivery; no rearchitecture, no 551-task import. **State:** SOURCE_PORTED_AND_LOCAL_TESTED / LIVE_AUTOMATION_NOT_STARTED.

## Source

- Legacy accepted Runner PR229: `56c910846549acfc96e3f33eac261d1465efb110`, independent changed-scope R2 9/9 source PASS.
- Legacy accepted DAG PR230: `89629741709fb12e7ff31f98459469c7bd6125b6`, independent 22/22 source R2 PASS (initial R1 FAIL retained).
- Initial clean-root import: clean SHA `46a5f6438fc3fe6cddaa12fb62c8e78f0f2e110c` with 12 **exact Git blob** matches against accepted legacy SHA. Preserved accepted G5 `writer_bridge`, root `test_job_contract` and recovery path. No old state, SQLite, backlog or personal material copied.
- Scoped clean-root adaptations: retarget `backlog_sync.py` immutable refs to only `anpavel84-afk/gobadminton-clean`; retarget Autopilot exact SSH remote `git@github-gobadminton-clean:anpavel84-afk/gobadminton-clean.git`; isolate clean runtime paths under `/srv/gobadminton-clean/{repo,runner,worktrees}`, root QA evidence under `/var/lib/gobadminton-clean-trusted-qa-evidence`, and root bridge policy under `/etc/gobadminton-clean-control-plane/`. The old URL and old runtime paths are denied, not silently accepted.
- Additional path segment check rejects `.`/`..` traversal in immutable source/admission GitHub URLs; this was caught by new clean-root regression and fixed before final staging.
- A new `_automation/gobadminton-runner/backlog.json` has **zero** tasks, `prod_authorized=false`, no old project history and no live Owner enqueues. The eight-task Friends fixture is **test-only**, links to historical PR198 in provenance, and is **not** a signed or runnable Owner task in the clean Git tree.

## Original Germany host evidence

On `vmi3510488`, isolated root-private staging `/root/gb-runner-clean-qa-20261013/` was built from exact new GitHub source file bytes. Legacy Runner directory `/srv/gobadminton-dev/runner` was not modified. Real installed legacy `runner.py` / `backlog_sync.py` / `control_agent.py` match the old preimage Git blobs documented by accepted original install manifest; `test_job_contract.py` is absent there. Old `gobadminton-runner.service` inactive/disabled, Control Agent inactive/disabled, Autopilot masked. The paused separate publisher/shadow have not been started.

Testing in staging, using actual original-host Linux and protected disposable verifier fixture:
- Initial exact port: Python compile PASS, DAG 9/9 and protected-root verifier 8/8 PASS.
- After clean Git/path rebind: **25/25 PASS**, comprising clean-ref/path negative and positive checks 8/8, DAG 9/9, protected root identity/replay/recovery verifier 8/8; exit0. Actual execution log SHA256 `dc62897a7a6928ab46413bc4818b03e9648f8748a626605843ba115fc2f10282`. This is local author/operator test execution; **do not label it independent QA on the new clean commit**.
- `runner.py status` with isolated clean empty backlog/state returned `paused=true`, `runner_alive=false`, `pending=[]`, `runnable_now=[]`, `max_parallel=2`, exit0. No executor launches/claims.
- Resource usage at inspection ~41 GiB available RAM and ~246 GiB disk free; Germany production and Moscow website untouched.

## Actual external blockers and least-privilege installation

- Existing original-host `agentagency-dev` SSH identity returns `Repository not found` for new private `gobadminton-clean` and still has `git@github-gobadminton:anpavel84-afk/gobadminton.git` as active legacy remote. Never reuse old deploy key on new repo and never retarget the historical archive in place.
- Prepared **two separate original-host ED25519 keys**; private halves remain only in original Linux users' `.ssh` (mode600), no private key material exported. Read-only DEV/source executor public fingerprint `SHA256:E9EAb9HahJ8lxue2TRnIrj2nva1e2z1XSrPNv2pg4TA` (owner: `agentagency-dev`). Publisher-writer public fingerprint `SHA256:jS1YilJC5ZrLHtgF67T5pMKFEAdUXKhH7QTJaHWBjHg` (owner: `gobadminton-v3-publisher`). **Public keys are not yet registered with the new repo, neither credential can access clean Git.**
- Repo settings: `https://github.com/anpavel84-afk/gobadminton-clean/settings/keys`. Register source reader as deploy key **without write access**; publisher as a separate deploy key **with write access**; no broader GitHub rights. Maintain distinct SSH host aliases and identity isolation. GitHub workflow-authorized main writer / independent CI requires correct GitHub permission, missing in current connector grant.
- Root-protected clean QA evidence/policy and Publisher authorization must be freshly pinned to clean commit/tree/job; historical source QA records and signed root evidence cannot be transplanted as trusted claims. Do not use a local unsigned JSON as Owner identity or independent QA.
- Only after reader/writer authenticates and independent clean SHA QA PASS: clone new canonical repo into separate clean worktree, inspect exact source diff/backup, commission guarded isolated runner, and run first **one** admitted DEV-only task with QA and a real website smoke. Expand parallelism only after proof. No unrelated PROD or VPN writes.

**Live status:** no actual clean Runner installation, autonomous claim, CI job, or background DEV auto-deploy has happened yet. This receipt cannot be treated as a launch or permission grant.
