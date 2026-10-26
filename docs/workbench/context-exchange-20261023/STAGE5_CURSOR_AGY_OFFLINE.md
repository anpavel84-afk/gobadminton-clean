# Stage 5 Cursor / AGY — repair round 1, source + offline evidence

**WORKING DRAFT — NOT APPROVED — NOT CANONICAL.** Cursor scoped delivery: **IMPLEMENTED / OFFLINE_VERIFIED, DORMANT, ENABLED=false in practice, NOT RUNTIME_VERIFIED**. The marker-pinned guard still mounts the entire work tree read-write. Actual Cursor delivery therefore uses the exact legacy full inline fallback with `RECIPIENT_RULES_NOT_READONLY`, even when the workspace canon matches the accepted pin. This is author verification, not independent QA or runtime admission. AGY scoped stays disabled (`SCOPED_QUALIFIED=False`); AGY author remains NOT_QUALIFIED until #312. Codex scoped_v1 and AGY delivery are unchanged.

## Preflight and scope

| Field | Exact input / boundary |
|---|---|
| Repository / role | `anpavel84-afk/gobadminton-clean`; AUTHOR repair round 1, sole writer in this assigned scope, not mutating PMA |
| Source / PR | #316 head `f06999ebd686c50c83f5ae053674e9aea03cd459`; base dev `bdd912a82a2f0087f4cfc9c6820edc8c49ee6527` |
| Accepted rules | EOM 1.4 commit `13a8b6c54a45aaa57021e092a1bee54926d9eac4`, SHA-256 `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, 115079 UTF-8 bytes; §10.3 requires read-only actual-recipient materialization |
| Assignment / admission | Direct bounded source/offline repair of the supplied independent QA FAIL; no runtime admission created |
| Writable scope | Only the 11 paths already changed by this PR (including manifest); no additional files, architecture, permissions, budgets, installation or protected-state effects |
| Frozen inputs | `native_cursor.py`, `native_guard.py`, native AGY, Codex scoped_v1, context policy/compiler and the two out-of-scope entrypoint/release test fixtures |
| Requested / effective | Cursor author `scoped_v1` / `full` with the real pinned guard; provider calls = 0 in this author session |
| Candidate | Uncommitted repair diff on the exact source head; commit/push/network unavailable and not attempted |

## QA finding and repaired boundary

Independent QA of `f06999e` reported FAIL, one P2 and no P1: the mutable bridge probe preceded actual export and stdin; the late gate stopped import but could not prevent an under-contextualized call. Whole-work write permission also allowed modify/read/restore of canon bytes while leaving a clean net diff. This report records the supplied finding; it does not assert new independent QA.

`recipient_rules_readonly()` runs the **same namespace builder bytecode referenced by native_cursor.invoke**, with private synthetic filesystem/UID/helper metadata in a copied globals dictionary. It does not read `/tmp`, installed binaries, credentials or markers, execute bwrap, patch the real builder globals, or change runtime qualification. It inspects constructed argv, not a source-text guess. The real pinned builder completes construction but lacks a read-only canon mount, so the capability is False. Any exception or unknown mount option fails closed. Synthetic metadata proves argv construction only, not installed identity/helper readiness.

The ordered mount check requires the rw self-bind of `<base>/work`, followed by a self `--ro-bind` / `--ro-bind-try` of `work/docs/rules/ENGINEERING_OPERATING_MODEL.md` or an enclosing path, with no later overlapping writable/replacement mount. A different source path, earlier ro mount hidden by rw work, unknown option or changed chdir is insufficient. The tracked, readable, single-link, regular, size/hash-exact workspace probe remains necessary as well.

Only for a scoped expectation does stage wrap the injected Popen callback. After native export, **before delegating to real Popen**, it reads the actual `--chdir` work dir, requires matching cwd and actual read-only mount argv, computes the full exported manifest using native `source_name` exclusions and MAX_FILE/MAX_TREE/10000-file limits, and compares canon size/hash and manifest hash with the trusted expectation. Reads traverse file descriptors with O_NOFOLLOW and bounded regular/single-link/owner checks. Refusal raises core.Refused: no process spawned, no stdin sent, no source imported. Native accounting charges before this callback; a refused charged invocation remains failed_no_automatic_replay and is not silently replayed or refunded.

The receipt's `recipient_materialization` starts with `readonly_enforced=false`, `export_verified_before_stdin=false` and empty observed hashes. It separately records the synthetic `readonly_capability`. Successful pre-spawn verification updates the shared trusted expectation/receipt with actual enforcement, export verification, rules SHA/size and export SHA. The proof checks both required booleans and the observed hashes. Missing materialization evidence yields NOT_PROVEN even if transcript and net diff match. The post-call check is now named **rules_net_unchanged**: it proves only the final net diff, never temporal immutability. VERIFIED still does not prove comprehension or independent QA.

The existing stream/prefix/capsule/reference check before import and post-call transcript/export checks remain. Canon changes are refused on every permitted callback. A successful simulated read-only guard path is covered offline; no kernel-level read-only claim is made from fake Popen tests.

## Fallback matrix

| Condition | Effective profile / stable reason |
|---|---|
| Real current guard, readable exact canon | full / `RECIPIENT_RULES_NOT_READONLY` |
| Read-only capability False, exception or unknown namespace option | full / `RECIPIENT_RULES_NOT_READONLY` |
| Simulated reviewed ro bind + exact readable tracked canon | scoped_v1, pending actual-export pre-spawn verification |
| Capability proven, but wrong pin / missing / unreadable / linked / untracked canon | full / `RECIPIENT_RULES_ACCESS_UNVERIFIED` (or preflight error when export itself fails) |
| Role/preflight/scoped compilation error | full / `CURSOR_SCOPED_PREFLIGHT_ERROR` |
| Recovery, budget retry or non-author stage | unchanged legacy full path; no scoped Popen wrapper |
| Actual export drifts or actual argv loses ro enforcement after selection | Refused before Popen/stdin, failed_no_automatic_replay; no import |

Full fallback stdin is byte-identical to legacy `context_policy.inject`; full canon is never truncated. Installed pin mismatch is an additional fallback condition. Owner-provided installed pin facts (not inspected here): 113203 bytes, commit `bc8bad0c38a861f8e72296d0a323e2941b9322e0`, SHA-256 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`. Source pin is the accepted 115079-byte canon above. No pin or marker changed.

## Deterministic offline comparison

`python3 -B docs/workbench/context-exchange-20261023/stage5_offline_compare.py` regenerates `STAGE5_CURSOR_AGY_COMPARE.json`. A fresh measurement must equal the committed JSON. Status now explicitly says Cursor author is dormant; `cursor_author_enabled=false`, fallback `RECIPIENT_RULES_NOT_READONLY`. Package byte measurements and hashes are unchanged by the repair.

Inputs: `offline_replay.saved_stage_inputs()` (synthetic task, failure/findings, excerpt, three prior receipts). Encoded diagnosis DATA is **26345** bytes, SHA-256 `dffbca8a4f86816f101a26e0f3bf3feeac0e8ab01d5febb3a6d017aaf72415d4`; findings/evidence remain exact. Package formula: UTF-8 rules_prefix + newline SAVED_STAGE_DATA newline + canonical diagnosis JSON. Scoped sizes use synthetic reference equality, not a recipient capability; `scoped_selected_for_delivery=false` throughout.

| Provider | Роль | Full canon | Full prefix | Scoped capsule | Scoped prefix | DATA | Full package | Scoped package | Δ bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| cursor | author | 115079 | 115306 | 4120 | 4571 | 26345 | 141669 | 30934 | 110735 |
| cursor | analyst | 115079 | 115307 | 4219 | 4671 | 26345 | 141670 | 31034 | 110636 |
| cursor | independent_qa | 115079 | 115302 | 4238 | 4685 | 26345 | 141665 | 31048 | 110617 |
| agy | author | 115079 | 115306 | 4120 | 4571 | 26345 | 141669 | 30934 | 110735 |
| agy | analyst | 115079 | 115307 | 4219 | 4671 | 26345 | 141670 | 31034 | 110636 |
| agy | independent_qa | 115079 | 115302 | 4238 | 4685 | 26345 | 141665 | 31048 | 110617 |


Provider packages for the same role remain byte-identical: VERIFIED. author → author capsule, independent_qa → qa, analyst → planner (technical_pm_product_analyst); research is not substituted. Cursor analyst/QA rows measure sizes only, not admitted runtime roles.

AGY QA limit is 262144 bytes. Full rules overhead / remaining stage budget: **115653 / 146491** bytes. Hypothetical scoped QA: **4713 / 257431** bytes, HYPOTHETICAL_NOT_QUALIFIED. The native AGY path is unchanged.

Tokens/tokenizer are **not_exposed**; generic BPE and bytes/4 are not used. New usage, latency, cost, cache hit, missed findings and actual-recipient runtime reads remain NOT_MEASURED. Owner-provided historical #313 full Cursor facts: stdin 122326 bytes; input 74745, output 6140, cacheRead 216576, cacheWrite 0; 7 model call ids, 13 tool events, 82.6 s API duration. Stage size reference 8545 bytes is not an input here. Codex scoped QA #313: 4238 policy bytes, tokens NOT_MEASURED. These facts were not replayed or independently inspected.

## Verification and handoff

Exact repair-round commands/results:

```text
python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train*.py'
Ran 970 tests in 724.332s
FAILED (errors=24, skipped=1)
R4 seeded fuzz: seed=3070405 cases=23868 accepted_ignored=1521

python3 -B -m unittest discover -s scripts/chatops/tests -p 'test_actions_train_context_cursor*.py'
Ran 41 tests in 1.028s
OK

python3 -B docs/workbench/context-exchange-20261023/stage5_offline_compare.py
provider_calls=0, rows=6, tokens=not_exposed; exit 0
```

Full suite exit 1 consists exclusively of the two explicitly excluded sandbox fixtures: 23 errors in `test_actions_train_antigravity_entrypoint_patch.py` (17 marker PermissionErrors and 6 secondary missing journals), one socket PermissionError in `test_actions_train_release_equivalence.py`. There are no assertion failures or errors in other modules; the existing skip is not a PASS. The interruption fixture expects OSError and catches the marker PermissionError as that OSError before its journal can be written; its subsequent rollback then reads a missing journal. Source inspection at fixture lines 86–88 and upgrade lines 282 / 557 supports this classification; no protected read was retried or fixture altered.

Exact distinct error text (the six random fixture paths are intentionally preserved):

```text
PermissionError: [Errno 13] Permission denied: '/etc/gobadminton-slots/cursor-author.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmp5scik0ar/state/patch.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmpcfxf0win/state/patch.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmp3dyh2hb1/state/patch.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmp6fy1b1oe/state/patch.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmp212rzyxa/state/patch.json'
FileNotFoundError: [Errno 2] No such file or directory: '/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/tmpupota6d0/state/patch.json'
PermissionError: [Errno 1] Operation not permitted
```

Full traceback evidence: `/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/stage5-repair-r1-unittest.log`. Manifest validation: **34/34 hashes match**; only changed installed module entries (`context_cursor_delivery.py`, `stage.py`) were regenerated. The manifest remains an install manifest: docs/tests are not added to its payload. Allowed-path audit and frozen-fixture audit PASS. `git diff --check`: exit 0. Repair changes 9 of the original 11 PR paths.

Frozen module SHA-256:

```text
native_cursor.py       02d26f8be9766bbeb1e92dd8514dfc496c1b3e1b0fc8035c1c65cc9aba6b6089
native_guard.py        dd2e0a0c6c0dea0d353b7dc5f16c1a5d4c4c21f022947ceaa640470c59fb0762
native_antigravity.py  01d4816e881765da6361af07a15765528aef274dad0eb780b1afab6b0e5e0f72
```

 Logs live in `/home/agentagency-dev/author-evidence-stage5-cursor-r1-20261025/`; TMPDIR is that allowed evidence root. Synthetic native fixtures redirect jobs into their disposable TMPDIR and use fake Popen/stream helpers. No real /tmp job, marker, model, network or installation is used by the new checks.

Historical author evidence for the previous candidate (superseded by the QA FAIL for delivery correctness): 963 tests, OK (skipped=1), source `f06999e`/earlier author source `00197e5feb15e048cd55416d57ca69924fab4af2`. Earlier fixture/environment failures and fixes remain in Git history; those numbers are not repair-round validation. This repair does not alter `test_actions_train_antigravity_entrypoint_patch.py` or `test_actions_train_release_equivalence.py`.

NOT_TESTED: independent QA of the repaired exact candidate, CI, actual bwrap enforcement and provider invocation, installation/marker rebind, real socket transport, role canary, DEV/PROD. No candidate commit exists because commit/push are unavailable. Next authorized step is independent QA of this exact resulting diff, then ordinary CI.

## Required outside this PR to enable scoped Cursor

A separate marker-reviewed native_guard change must append, **after the rw work bind and before --chdir / command**, the minimal mount:

```python
canon = base/'work'/'docs/rules/ENGINEERING_OPERATING_MODEL.md'
argv += ['--ro-bind', str(canon), str(canon)]
```

No later overlapping rw mount may override it. The whole-client namespace must retain this mount for all descendants; real recipient tools must be unable to overwrite, unlink/replace, or modify/read/restore the canon. This makes recipient_rules_readonly() True, but does not alone enable installation: review/CI, exact module hash marker rebind through the existing authorized process, matching accepted rules pin/artifact, and a separately admitted real role canary proving recipient read access and denied writes are required. Keep full fallback until those gates pass. This PR deliberately leaves native_guard/native_cursor and their pins byte-identical. No active grant, FAIL/UNKNOWN history or budget is rewritten.
