# OWNER DECISION — XHTTP-first operational cutover for GoBadminton consumer API v003

Status: **OWNER_CONFIRMED — BINDING EXECUTION PRIORITY AND TRANSPORT SELECTION**
Date: 2026-10-07
Authority: Owner's direct instruction in project chat
Scope: Germany API ↔ current GoBadminton Moscow frontend via dedicated Xray path

## Supersession

This decision **supersedes** the unresolved WSS-vs-XHTTP selection and the extended comparative/acceptance requirements in:
- `docs/decisions/OWNER_DECISION_INTERSERVER_SECURE_TRANSPORT_V002.md`;
- `docs/handoffs/2026-10-07_pm_owner-xray-consumer-api-transport-v002.md`;
- any conflicting "mode neutral" language in draft Architect PR #85 or Implementation PR #92;
- the N0/N2 process **only to the extent that it mandates exploratory mode competitions, 100 sequential cross-border transfers in multiple periods, or repeated long observation cycles as prerequisites before any bounded XHTTP pilot**.

The following safeguards from v001/v002 **remain fully binding**:
- another project's existing Xray/VPN is absolutely inviolate;
- no shared VPN process/key/port/listener/route/firewall/NAT changes or resource starvation;
- no unrestricted IP VPN, default-route hijack or exposed internal service;
- scoped independent GoBadminton credentials/service units/listeners;
- verifiable TLS/mTLS peer identity;
- config snapshot and rollback;
- no silently bypassed authentication/CSRF;
- no production traffic cutover before bounded real-host integrity/security smoke;
- no proof of performance or deployment claimed from loopback-only tests.

## Owner-selected transport

**Select Xray modern VLESS reverse + XHTTP/TLS over permitted TCP/443 as the single implementation target.**

The word "XHTML" in conversational dictation refers to **XHTTP**, the Xray transport mode, not HTML/XHTML markup.

Do **not** spend more cycles comparing WSS/XHTTP as equal candidates, re-running mode-selection research, or demanding abstract infrastructure redesign.

The existing N1 source candidate **Draft PR #92** (`infra/interserver/**`) is the starting asset. Adapt its XHTTP server ingress, public Moscow SNI/ALPN/HTTP compatibility and isolated service configuration for actual Germany↔Moscow deployment. Do not simply change a WSS config flag on its public nginx template and claim it works.

If a specific technically unavoidable XHTTP incompatibility arises, report **the exact failing compatibility fact + smallest actionable fix + ETA/owner input**, and stop just that blocked operational slice. Do not silently switch back to WSS or introduce full site-to-site VPN.

## Scope: route as much GoBadminton application traffic as this scoped channel safely supports

After bounded acceptance, route through XHTTP:
- **all consumer API** requests via Moscow nginx `/v1/*`, including identity/auth, Games, profiles, player directory, Radar, messages/Game Chat, invitations, notifications, and future consumer API capabilities;
- all **HTTP request/response bodies** in those paths, including avatar upload, avatar retrieval and other current file/media uploads/downloads;
- exact `/v1/me/avatar` nginx location **as well as** general `/v1/`, preserving max body sizes and request timeouts except explicit, reviewed bug fixes;
- HTTP streaming/SSE/long-poll support if currently required, without inventing new real-time features.

Excluded and NOT to be rerouted:
- PostgreSQL/PostGIS, DB replication or raw SQL sockets;
- SSH/forced-command deployment, Docker, internal Admin/control endpoints, system updates;
- other projects, old VPN, or all-host default Internet routing;
- user-facing public HTTPS browser connection;
- static public `maps.gobadminton.ru` / PMTiles/range/style/metro/glyph requests, which stay on Moscow nginx.

**Project map artifact delivery** remains a separate bounded, checksum-verified publication path; it may use a *separately permissioned GoBadminton-only transfer endpoint/stream on the new transport only if it adds no privileged broad proxy and passes the same integrity test*. Do not block API cutover on bulk artifact improvements already solved by resumable HTTPS chunks. Do not push public user map tile reads over the tunnel.

## Speed and tests: smallest credible go/no-go, one execution campaign

Owner wants implementation, not indefinite validation.

**Replace prior pre-cutover test sprawl with one bounded, auditable real Germany↔Moscow smoke gate:**

1. Read-only snapshot: original API upstream, existing VPN process/resource identity and continuity (from authorized Germany-side observation), target nginx vhost/location fingerprints; ensure no live-writer collision.
2. Start isolated project-only XHTTP candidate on real hosts, without changing shared routes or running VPN. Verify independent process identity and nginx TLS/SNI/ALPN ingress.
3. Test **a small fixed sample** of end-to-end complete bodies (e.g. 10 × 384 KiB and 10 × 512 KiB, sha-verified or equivalent bounded synthetic payload), not 100× repeated period sweeps. No 408/504/partial response. These synthetic sizes validate the transport; actual avatar API limits/format remain authoritative.
4. One authorized end-to-end avatar upload using a synthetic/test account through actual `/v1/me/avatar` with existing cookie/CSRF/session rules, then read-back; one standard identity check, one Games read, one Messages path and one Radar non-mutating permitted read using test context.
5. One short disconnect/reconnect test and clear behavior under tunnel down (bounded 503), no unsupervised non-idempotent POST retry; verify trusted TLS/mTLS and rejected invalid peer/cert/access to Admin/DB/SSH.
6. Observe existing unrelated VPN **before/after**, including no process restart/config change and no obvious resource starvation; no access to unrelated Moscow VPS is implied. If safety cannot be established without touching shared components, STOP.
7. Verify reviewed direct HTTPS rollback works from saved config with peer certificate verification; then controlled switch of both nginx consumer locations and a concise post-cutover smoke/error review.

This is **not permission to skip decisive validation** or to fabricate a pass. Failed upload/integrity, missing genuine certificate validation, conflicting host writer, inability to protect the old VPN, loss of rollback, or unexpected exposure = **NO_GO / rollback**.

Do not gate N2 on multiple half-hour/100-transfer batches just because an old checklist demanded them. One bounded follow-up independent QA of exactly this cutover is required; avoid separate large QA trains for every previously defined N-step.

## Operations and control plane

- Owner explicitly approves **planning and execution of one bounded XHTTP-first implementation/cutover campaign** with limited host effect, conditioned on the above short pre-switch smoke, accurate access scope, protected shared-service noninterference, and prepared rollback.
- PM should consolidate N0/N1/N2/N3/N4/N5 into **the fewest actual tasks that preserve distinct writer and independent QA authority**, rather than keeping each as an additional blocking project.
- PM must not commandeer an overlapping outside-Runner Implementation session. Obtain a concise "active writer/host ownership" confirmation once, then proceed when free.
- Source/release code from PR #92 can be reused after focused review. Its WSS-only public nginx template must be explicitly replaced/augmented with a valid XHTTP ingress; protect real host certificate/key material.
- Do not edit or activate another project's VPN/Xray or global networking to meet a deadline.
- Restrict live edits to GoBadminton-only services, nginx vhost/location segments, dedicated credentials and named API upstream. Keep exact config backups and an atomic reversal.
- Project record must capture before/after architecture, selected XHTTP mode, QA result, rollout/rollback and monitored transport errors.

## Expected result

A working, supervised, separately authenticated XHTTP reverse channel from Germany to the GoBadminton Moscow frontend that Moscow nginx uses for **all eligible consumer `/v1` API traffic**, including the avatar special route, with logs/metrics and a documented recovery path.

If the public-ingress technical blocker is real, return a specific operator-actionable blocker rather than an unbounded research backlog.

This decision does not assert that XHTTP can never be blocked or will always be faster than direct HTTPS. It is the selected implementation direction with a bounded acceptance condition.
