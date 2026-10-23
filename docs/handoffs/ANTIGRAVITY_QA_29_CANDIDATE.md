# Antigravity #29: prospective QA adapter, unavailable

Base: cd53eea0ed7d5fe42bd8a5d499e225282c8cf19a. Author: Germany UID1002,
separate ops/antigravity-qa-29-20261023 worktree. Accepted rules revision1.1:
b4a746a0b9834d80b8c65ecb9a093257f989bae7, content SHA256
0755f8b5eb2cce575e58137a0f0462448109d8af0173e36d67f6551342b35ba6.
Root AGENTS pointer read from accepted rules checkout; product base has no root
AGENTS. Policy remains trusted train context injection, never candidate authority.
Old9eda398 worktree, #207 UNKNOWN and #225 state/source are untouched.

## Source result

Ported existing static review collector into existing Actions train adapter module.
Full prompt is `-p` data; timeout uses duration suffix `s`; output is stream-json.
Parser consumes actual AGY init/step_update/result envelopes and DONE states;
requires canonical result.structured_output, exact model/agent/SHA/schema,
conversation consistency, completion and no attempted tools/denial/error evidence.
Source collection includes Python absolute local imports and .js-to-.ts resolution.
Missing relative imports, unsupported JS aliases and Python syntax fail before a
provider call, even if a hypothetical response would say PASS. Legitimate tokens.ts,
auth/crypto.ts, config/env.ts and design-token modules are allowed; actual secret
paths, symlinks, binary/oversize inputs and private-key content remain refused.
Optional candidate AGENTS is source data; accepted policy arrives in injected prompt.
Receipts distinguish intended agent definition from observed model/agent/tool list,
permission mode, init/transcript hashes and provider usage; CLI version is unknown.
No receipt proves a loaded agent definition solely by hashing its intended YAML.

V2 simple/standard QA may prospectively prefer the explicitly admitted route
`agy:claude-sonnet-5-5-medium`, with admitted minimum Codex route as fallback.
Existing Actions `qa` stage consumes it in stage.measured_model. No author route,
legacy assignment, worker lock, admission or CI/DEV gate changes. Both available()
and invoke() refuse unconditionally while authority is unqualified. No enable flag
or self-issued marker bypass exists. No AGY call or budget charge occurred.

## Exact remaining authority gap

Pinned installed binary SHA256:
8af8e7a2a68f72fa7164e00bb59b8902c018fa43e528fc401ad7db8c2972583c.
Saved #29 stream advertises baseline tools despite custom tools:[finish]. This is
not evidence those tools can execute. Existing native settings deny command(*),
write_file(*), read_file(*), read_url(*), mcp(*), unsandboxed(*). Previous read/write
denials are established; command, browser/execute_url, MCP and delegation effects
are not established. Saved binary contains execute_url(*) and legacy-unsandboxed
migration text; strings are not a supported permission schema or proof of wildcard
semantics. Installed package is a stripped binary; no local parser source/schema
was available. No all-tool wildcard/server-side allowlist was established by the
bounded static inspection. No settings or credentials were changed/copied.

Existing V6 permission_config is Codex-specific. Existing Cursor namespace helper
pins Cursor executable/profile; it cannot be claimed to confine AGY. Generic
native_guard restrict() covers files/processes but does not independently confine
same-process browser/MCP/cloud delegation or separate transport credentials from
model tools. Native sandbox is retained but only claims terminal restrictions.

Minimum missing capability: a supported fail-closed all-class tool execution deny
or server-side finish-only allowlist covering browser/network, MCP, command,
subagent/delegation/message/schedule effects, including credential access through
the client. If unavailable, a reviewed equivalent confinement/role-limited
credential decision is needed. There is no safe boolean flip to READY.

## One later canary through existing train (plan only)

After independent exact-SHA source QA and mandatory Product CI, first establish
that missing supported capability. Then an OPS-reviewed change can replace the
unconditional refusal with task-hash-bound, slot-bound canary qualification and
its exact binary/adapter/policy pins. No such marker or installation is created
by this patch. Until then a real QA call is blocked, not merely NOT_TESTED.

Use one fresh independently admitted ordinary candidate's existing `qa` stage,
with immutable V2 simple/standard QA route above and finite one-call budget, in a
safe free slot via existing train-dispatch/train-stage and locks. Do not amend or
replay #225, retry its author, reset its budget, or touch original #207 UNKNOWN.
No extra workflow, queue, author task, daemon or qualification framework is needed.

One protected canary should target only remaining command/browser/MCP/delegation
and credential-tool boundaries with synthetic inert targets, and confirm exact
prompt delivery/model/permission receipt. Previously proved read/write checks and
Cursor startup are not repeated. Deliberate attempted tools must produce a
non-accepting adapter outcome even when final SUCCESS is printed; external
side-effect observations must independently remain unchanged. A denied-tool
qualification run does not become a QA PASS. Normal independent QA is only accepted
from a complete no-tool stream on exact candidate, with separate CI/DEV gates.
If the all-class control cannot be proven, retain UNAVAILABLE and admitted Codex
fallback; no live provider call is authorized by this document.

## Author validation

11 targeted AGY regressions PASS; existing14 cost-policy tests PASS. Full existing
Actions-train suite254 PASS in isolated /tmp git archive plus exact candidate files.
First checkout run exposed expected ancestor O_RDONLY ACL errors and a stale
install manifest; manifest pins were updated, no ACL/permissions weakened.
Foundation static check PASS; git diff --check PASS. These are author checks,
not independent QA, hosted Product CI, runtime qualification or deployment.

Installation, if later separately approved after exact QA/CI: existing installer
payload manifest now adds native_antigravity.py and changes core.py, stage.py and
cost_policy.py pins. No receiver/unit/native-guard/Cursor module changes. Installed
active controller pin remains untouched; candidate source is not installed.
