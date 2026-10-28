# Existing train watchdog continuity correction

Bounded Owner-directed source correction, separate from frozen AGY PR229.
Base5e07efc; branch ops/train-watchdog-continuity-20261023; Germany UID1002.
No installation, restart, model/provider call, credential change or task-state
mutation. #207 UNKNOWN and #225 exhausted/deferred history remain untouched.

## Current mechanisms and exact observed gap

Installed controller f377bb1e393de93d6faf211886ae1b8c36c4a45b is active.
Authoritative current main has train-events.yml, blob
bef2a3cc715b45239b1d0780efc68a87fa196082: Owner marked Issues/comments,
Product CI/DEV deploy/Autonomy PR completion, and rescue schedule
7,22,37,52 * * * * wake the existing dev dispatcher. train-attention.yml,
blob37d90554beab63c3866a3d0c40e0b3814fc6a6ef, alerts the existing #158 thread
on exact completed Train-stage failures/unknown/deferred outcomes with artifact
hash validation and per-run dedupe. This correction adds no wake, schedule,
workflow, watchdog service, queue or controller. The earlier product-dev-only
no-rescue inference was incorrect; main's existing rescue is authoritative.

Existing user gobadminton-train-watchdog.timer is enabled/active, OnBootSec90,
OnUnitActiveSec120, AccuracySec10; UID1002 Linger=yes. It executes
/home/agentagency-dev/.local/libexec/gobadminton-train-watchdog.py. Installed
SHA256 b557ad3743ec41464d000a7a4b49627ebabcd4121f29cc588bd17acf8e179811
matches the pre-correction CLEAN source. Recent executions exited0/healthy.
Main only collected idle-ready episodes; legacy stopped/blocked classifiers
were not called. A roughly35-minute-old Actions projection with slot1 UNKNOWN
therefore still produced incident=null. Healthy exit was not notification proof.

Existing monitor writer and per-slot telemetry timers run every30s; they observe,
not dispatch authors. Existing system gb-deploy-watchdog@dev.timer runs every60s
with Persistent=true and handles pending-release expiry/rollback only. It does
not recover train tasks. Legacy gobadminton-autonomy.service is disabled/failed;
this correction does not restart it.

## Corrected observer

The existing main collect_idle path now includes Actions UNKNOWN, deferred/error,
stale global projection, stale queue-planning evidence and operation-deadline
observations. UNKNOWN remains an unresolved observation as its projection ages;
it is never silently declared healthy just to rearm the same email each timer.
Existing incident fingerprint, second-observation confirmation, SMTP dedupe and
bounded transport backoff remain in use. Events continue to be logged when SMTP
is unavailable. No function starts/restarts/kills a worker, clears UNKNOWN,
changes attempts/budgets/leases or calls a provider.

Global/planning staleness is over1800s, allowing two existing15-minute rescue
windows; one ordinary idle interval is not a stall or proof of eligible work.
Existing per-slot dispatch_pending evidence, generation tracking,3-minute idle
log events and15-minute idle notification threshold remain intact. A global
ready count still cannot admit a task.

Running-operation checks read only the exact projected supervisor PID's
stat/start/boot and uptime, never cmdline/environ or a process-wide scan. PID reuse,
boot mismatch, disappearance or uninspectable identity produce UNKNOWN, not an
author replay. A live exact process is called stalled only beyond2400s, covering
the existing2200s receiver deadline plus observation grace. Old checkpoint age,
quota waits or ordinary CI waits alone do not establish a stalled process.
Raw findings/reasons are not emailed; events use fixed reason codes and sanitized
Issue/SHA/stage fields. Higher-priority deadline/blocked incidents can surface
ahead of a standing UNKNOWN; all classified events remain in ordinary logs.

## SMTP external blocker

The sole configured watchdog transport path is
/home/agentagency-dev/.config/gobadminton/train-watchdog.json, mode0600.
Metadata only: file present, enabled=false, host/from/auth absent, recipient field
present, TLS-mode field valid. Installed --status reports smtp=not_configured.
The existing service has no EnvironmentFile or SMTP environment reference; the
watchdog code consumes only that known configuration. No supported existing SMTP
channel was established. No values, addresses, passwords or tokens were printed.

Actual email delivery requires a real project-approved SMTP endpoint/sender/auth
configuration and the existing explicit commissioning test. Until then this patch
provides accurate local events/private delivery-pending state, while main's
existing GitHub attention channel remains available. No SMTP delivery claim is
made. Primary owns any later approved configuration or commissioning.

## Author checks and install delta

23 watchdog tests PASS (15 existing,8 new), plus8 existing Actions idle-ready
regressions PASS. New tests cover main-path UNKNOWN, aging/dedupe, rescue-aware
staleness, exact process deadline/identity, deferred/exhausted status without raw
reason leakage and disabled-SMTP backoff. No real SMTP send was performed.

Later reviewed installation needs only replace the existing user watchdog script
from the exact accepted source, preserving config, timer/unit, idle-ready state,
delivery ledger and all task/operation history. This author did not install it.
