# AGY #29: small-range Owner package (PR A)

This source change prepares a new, separately authenticated two-call Owner package. It installs nothing, creates no grant, consumes no call and does not reconcile or replay any UNKNOWN. Independent QA, CI and a later separately reviewed installer are still required. Existing OPS installers remain byte-identical.

The package under comment `6404499964` stopped UNKNOWN with `AGY_INPUT_LIMIT`: 466,131 input bytes exceeded 262,144. Its range `b0e4d233..12f35ac4` contains 37 changed files and a 314,931-byte raw diff. The new review covers PR #325 only: base `e6af59ea2bc6922ed12585b128d9e14b263e9f20`, head `de193c74c11e1fef33d1e3c8405abe5a40081b87`, four files and a roughly 10.4 KB raw diff. This reviews that bounded source change; it does not claim review of the entire historical range.

The immutable `OWNER_PACKAGE_SOURCES` table in `antigravity_qa_recovery.py` is keyed by head. Every entry binds the complete base/head/QA-input tuple; mixing fields across entries or using another tuple refuses. The existing `FRESH_*` constants retain their historical meanings.

| Pin | OLD — historical re-authentication | NEW — new admission default |
| --- | --- | --- |
| Base | `b0e4d233bc150f42ada86c4c0f56897c57e0d0fe` | `e6af59ea2bc6922ed12585b128d9e14b263e9f20` |
| Head | `12f35ac4430348ae811cf712d9bb24d2a19b62e6` | `de193c74c11e1fef33d1e3c8405abe5a40081b87` |
| QA input revision | `6a53099160f0ae7312f6d282b061c5230e7d2536` | `1d6c79990bef8d1e21e55360a8f8ee7e874f1315` |
| QA input path | `scripts/chatops/tests/fixtures/agy-236-independent-qa-12f35ac.json` | `scripts/chatops/tests/fixtures/agy-325-independent-qa-de193c7.json` |
| QA SHA-256 | `c1672961885bea637d1ff21ffd05accc73837fe669e853f4b911d9f7ad7dcee9` | `6b6d391f35739b5f9dc15fa1a5968bc6be00bfdfcf4b4b5707cc834db693771d` |

Both tuples retain analysis input `scripts/chatops/tests/fixtures/agy-230-inert-task-draft.json`, SHA-256 `40c79986904243c77d0e06231f1a82802018b17137242212aec2513e0258bd55`, at `input_revision == head`. The bytes at both heads are identical. Legacy fresh/supplemental grants still require OLD. Non-delegated dynamic grants and their ledgers require one whole table tuple for either role. Delegated grants retain their separate provenance-bound input validation. Already-paid Owner ledgers are re-authenticated against their own tuple; changing the new admission default never rewrites their identities, spend or UNKNOWN history.

The rules fix is a **fail-closed generalization**, keyed on the installed controller, of the existing C5 exception. It makes the already-installed pair usable by new Owner packages and does not relax any other gate:

- Controller `41e12be2d551158e97ea30eaf8e95f992f998615` always requires rules SHA-256 `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`. Every other rules hash, including document hash `8798ea76874ea5e42f708fff6d74f1ccbf526413c701e9f2349045fdc98be9d5`, refuses under C5.
- Other controllers still require the calling module's current `RULES_SHA256` / `RULES`, exactly as before. This is never an “any rules” allowance.
- Comment `6396105635` additionally remains bound to C5; another controller refuses even with the current document rules.
- Admission pins, existing-package re-authentication, package/grant validation and acceptance use that same rule. Nonhistorical addressed branches use the same pair selection; immutable original grant digests retain their exact historical identities.
- Quiescent `installed_rules_ok` is unchanged and still checks the actual installed rules file. `package_rules_ok` also requires the loaded context pin and real rules bytes to equal the package pin, and preserves the existing C5 context-file hash gate. A source-only simulation does not prove those host checks pass.

The full rules bytes, 262,144-byte limit, no-truncation behavior and full delivery profile are unchanged; `scoped_v1` is not enabled. The size regression assembles text exactly as `stage.qualify_qa`: its fixed QA text, the complete real contract and the read-only candidate-root suffix, then calls real `native_antigravity.collect(..., compact_files=True)` on an exact temporary NEW tree. Large source references still require byte-identical readable files; the entire diff remains present.

Measured with this sandbox's temporary path: stage **16,546 bytes** + installed full rules **113,203 bytes** + wrapping **574 bytes** = **130,323 bytes**, below both 140,000 and 262,144. Paths affect the exact byte count. The same regression materializes OLD and requires `AGY_INPUT_LIMIT`; its measured total was 467,457 bytes. The original checkout's Git metadata is read-only, so the test uses `git archive`, a disposable initialized Git directory and a copied local object database, preserving exact SHAs without new commits or changes to the original `.git`.

The fixture's deterministic QuiescentTests check was run once on an archive of NEW head: four output lines, SHA-256 `971acf337824e107007af2e526b3e7eaaffc0284c0748fe155b8a624ac5ac914` (Python 3.12). The fixture itself is unchanged. Author tests and this reference receipt are not independent QA.

A new Owner comment must be posted by the authenticated repository Owner in Issue #29. It must start with `GOBADMINTON_AGY_PACKAGE_V1` and a newline, followed immediately by canonical JSON (`sort_keys=True`, separators `,` and `:`, no extra whitespace). The existing closed schema remains:

- `schema`: `GB_AGY_29_OWNER_PACKAGE_V1`; `issue`: `29`; `repo_id`: `1416250340`; `owner_comment`: the actual new posted comment ID.
- `controller_sha`: `41e12be2d551158e97ea30eaf8e95f992f998615`; `rules_sha256`: `017441dec5ba197a1065b6ef90efdddb090b286ba48687241a7fbc09dd002269`.
- `source_base` / `source_head`: the complete NEW pins above; `model`: `claude-sonnet-5-5-medium`; `max_calls`: `2`.
- `calls`: exactly two entries, ordered `technical_pm_product_analyst` then `independent_qa`. Each entry contains exactly `role`, `input_revision`, `input_path`, `input_sha256`, using the analysis pin at NEW head and the NEW QA pin above respectively.

Each derived role grant remains single-use with ceiling 1, timeout 1800, output limit 4 MiB, `always-proceed` and `stream-json`. QA still requires the completed native analysis, exact admission marker, source/test contract and all existing accounting, isolation and acceptance evidence. A comment or this document alone authorizes no execution by this PR. The permitted next step is independent review of the uncommitted candidate, followed by the normal reviewed source/CI and separately reviewed installation process.
