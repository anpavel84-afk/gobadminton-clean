# ADR: isolate GoBadminton reverse-XHTTP traffic, retain verified mTLS

Decision: **selected architecture; source candidate, NOT deployed or independently QA-accepted**.
Owner request: implement the transport decision using the PM evidence, without restarting
Runner, losing historical work, moving the backend, or touching the personal VPN.
Work item: https://github.com/anpavel84-afk/gobadminton-clean/issues/1
Source baseline: `71aaabd97cf81f387ccc1f50258a81d54289b3b2`.

## Evidence and choice

Direct international HTTPS previously failed with a synthetic 384-KiB avatar body;
small requests reached the application. Increasing buffering/timeouts did not fix it:
https://github.com/anpavel84-afk/gobadminton/issues/86#issuecomment-6047362812
The 228.6-MB Range transfer was a different artifact-hub path, not an XHTTP benchmark:
https://github.com/anpavel84-afk/gobadminton/issues/86#issuecomment-6047545618
The current reverse path has measured inner TLS handshake timeouts and retransmissions,
but neither a universal 16-KiB cutoff nor Gate exhaustion is proved:
https://github.com/anpavel84-afk/gobadminton/pull/195#issuecomment-6132558046

Retain **Germany-initiated TCP/443, TLS + VLESS reverse + XHTTP packet-up**. Do not
replace it with unproved direct HTTPS, UDP, a new VPN, an SSH tunnel, or a custom relay.
Reuse the transport/security model from legacy PR92, exact source
`fb0a4e5a6da9b11754726a426e3b0f3c7773b099`; its old QA does not approve this new code.

## Implemented candidate

Three separately running Xray process pairs, independent credentials, paths and pools:

| Lane | Moscow registration / API ingress | Purpose |
|---|---|---|
| rpc-a | 18541 / 18542, loopback only | Ordinary API |
| rpc-b | 18551 / 18552, loopback only | Ordinary API, separate carrier |
| media | 18561 / 18562, loopback only | Existing exact `/v1/me/avatar`, including PUT |

Moscow public TLS nginx routes each `/_gb-link/v2/<lane>/` to its local registration
port. Only the existing German IP is allowed; VLESS credentials are still required.
Germany has no new public listener. Each bridge can reach only the new loopback mTLS
Gate `18543`, which forwards to the existing API `18080`. Existing `18441/18442/18443`
and the v1 carrier are retained until the new candidate is accepted and can be rolled back.
No production API container, database, schema, data, OAuth registration or flag changes.

A named nginx pool reuses authenticated TLS connections: API 16 idle per worker,
media 2. Active limits are 32 per API lane and 4 for media, shared across edge workers
using upstream zones. Keepalive is not itself an active-connection limit. The dedicated
candidate Gate uses one worker/1024 connections, local API keepalive and max_conns=96.
This is headroom, NOT a claim that the old Gate limit caused the incident.

XHTTP `xmux.maxConcurrency=1` prevents multiple reverse tunnel connections sharing one
XHTTP HTTP/2 carrier. It does **not** disable native VLESS reverse MUX or provide one TCP
socket per application request. Explicit lifetime/request settings retain bounded reuse;
separate processes guarantee API and media cannot accidentally share a client pool.

Edge connect timeout is 6s rather than the recorded 3s. This is an initial conservative
candidate value, not a measured optimum or the primary repair. Existing 15s avatar
send/read and browser timeout behavior is preserved. These are per-phase/idle timeouts,
not a strict whole-request deadline. No proxy retries, including mutations. A lost
response after a write remains an ambiguous result; the proxy must not duplicate it.
New requests can use another API lane; no seamless in-flight recovery is promised.

Cookie, Origin, Authorization and CSRF headers are preserved. The legacy Gate's
`X-Forwarded-Host` stripping and fixed HTTPS forwarding semantics remain. Admin and
nonconsumer routes remain denied. TLS certificate verification is not relaxed.
No new upload protocol, arbitrary forwarding target, client-side routing or UI change.
Only the known avatar endpoint is classified as media; any future bulk route needs an
explicit classification. Build images, maps and QA media stay on the protected artifact
hub, not this interactive API channel.

## Actual source and tests

`infra/transport_v2/transport.py` renders six private Xray JSON files, a separate Gate,
a narrowly patched Moscow vhost, an exact rollback copy and a SHA256 manifest. It has
**no install, SSH, systemd, firewall or network operation**. Input snapshot/hash mismatch,
unknown upstream/timeouts, missing TLS guards, duplicate routes or whole-host config
fail closed. New files never overwrite the source snapshot. Generated credentials and
snapshots must remain outside Git, mode 0600 in a 0700 private directory.

Run the local suite from repository root:

```sh
python3 -m unittest discover -s infra/transport_v2 -v
```

Python 3.13.5, nginx 1.26.3 and OpenSSL were used. **28/28 author-side local tests PASS**,
including actual nginx and mTLS, 100 sequential 384/512-KiB uploads with SHA256,
4/8/16/24/32/64/384/512-KiB upload and download matrices, persistent TLS connections,
a blocked upload concurrent with API reads, media-lane loss, no duplicate mutation,
header preservation, admin rejection, missing-client-cert rejection, wrong-CA rejection,
body limit, full patched nginx syntax and exact rollback bundle hashes.

**Important:** the local lane fault tests use transparent TCP relay fixtures, NOT Xray.
They prove nginx/mTLS behavior and traffic-class separation in that fixture. The Xray
binary was unavailable in the local runtime; source config invariants were checked,
but new Xray syntax/runtime and actual Moscow-Germany transport were NOT tested.
R1's author-test FAIL (test CA missing keyUsage under Python strict verification) is
retained in the evidence manifest; the test certificate was fixed, verification was
not disabled. There is no independent QA PASS or authenticated application smoke.

## Release and rollback boundary

One bounded authorized original-host release is required, not a sequence of Owner
micro-GOs. The candidate is not an authorized replacement for a previously denied
ChatGPT remote-shell action. No new executor, wrapper, SSH or machine may evade that denial.
The legitimate existing host administrator must resolve commissioning through the
normal approved path; this source package does not grant OS authority or create a job.

Before any traffic switch: compare actual loaded configs to the private snapshots;
check port collisions, CA/cert identity, host resource budget, all six config syntax
checks with the exact installed Xray binary, and separate-process launch. Provision
scoped service identities/units and CPU/RAM/FD ceilings through that approved operator.
Those original-host service bindings are not invented by this renderer and are still
uncommissioned. Start the additive candidate with no public `/v1/` cutover, then validate
real TLS/h2 carrier paths, large bodies, concurrent API, reconnects and failed media.
Observe a real 30-minute representative-load window with timestamped error/latency/
retransmission/Gate capacity deltas. Use synthetic fixtures, not production user writes.
Then use one reviewed nginx switch, with authenticated Profile/Games/Messages/avatar
acceptance and old runtime fingerprints. Neither short health tests nor this local
suite substitute for these checks. No forced-loss experiments on the production path.

Rollback restores the exact saved vhost bytes after verifying the current candidate
hash, validates nginx and gracefully reloads it. It uses the still-running old XHTTP
path, **not** the historically unreliable direct HTTPS path. Any snapshot/config drift
stops rollback for operator reconciliation, rather than overwriting another live edit.
Stop only the new candidate processes after traffic is restored. Do not stop shared
nginx, the existing transport, personal VPN or application containers.

Shared provider/path/host failures can affect all lanes; this design is not geographic
HA and cannot cure packet loss or censorship affecting every connection. Stable
production remains an acceptance requirement, not a property inferred from architecture.
`OPERATOR_PAUSED` and Radar OFF remain. Issue #1 must stay open until live acceptance.

## Primary technical references

XHTTP XMUX semantics (maxConcurrency is not inner-MUX concurrency):
https://github.com/XTLS/Xray-core/discussions/4113
Nginx persistent upstream connections and active limits:
https://nginx.org/en/docs/http/ngx_http_upstream_module.html
Proxy TLS, headers and retry semantics:
https://nginx.org/en/docs/http/ngx_http_proxy_module.html
Cloudflare report is contextual evidence about its affected paths, not proof about
our exact VPS pair:
https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/
