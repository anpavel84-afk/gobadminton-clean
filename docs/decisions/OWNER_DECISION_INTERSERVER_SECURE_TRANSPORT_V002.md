# OWNER DECISION — GoBadminton interserver consumer API transport v002

**Status: OWNER TARGET DIRECTION CONFIRMED / Xray PREFERRED / TRANSPORT MODE NOT YET SELECTED / NO LIVE ACTIVITY AUTHORIZED**

Date: 2026-10-07  
Supersedes the technology-priority and evaluation-order sections of [v001](OWNER_DECISION_INTERSERVER_SECURE_TRANSPORT_V001.md). All v001 security protections and operational prohibitions remain fully in force.
Scope: the **actual** Moscow frontend `gobadminton.ru` ↔ Germany GoBadminton API, not another Moscow VPS.

## 1. Binding target architecture, with separate acceptance gate

**Xray, modern VLESS service-scoped reverse, is the preferred permanent transport for all GoBadminton consumer API traffic, subject to measured real-host acceptance.** It is *not* a whole-host IP VPN and must not create new private network routes or unrestricted proxies.

Public browser/PWA → Moscow nginx `/v1/*` → **dedicated Moscow loopback verified TLS/mTLS client** → isolated GoBadminton Xray reverse channel over Germany-initiated outbound Moscow **TCP/443** → **separate Germany GoBadminton-only loopback TLS/mTLS API gate** → Germany NestJS API `127.0.0.1:18080`. All application auth, identity, cookie, CSRF, session, idempotency, and authorization semantics remain unchanged.

The consumer API path includes identity/login, Games, Players, Messages, Radar API, and **both uploaded avatar requests and other `/v1` requests**. The special exact avatar nginx location must be handled explicitly at cutover, not forgotten under the general location. All public static PMTiles and map/style/glyph/sprite/metro resources stay served from the Moscow static origin. PostgreSQL, SSH, deployments, OS updates, other projects, nginx Admin and backend-control ports **do not use the consumer API tunnel**.

If the Germany backend moves to Russia later, changing the Moscow upstream must not require browser/UI, API contract or database-schema rewrites. This topology alone does **not** create geographic high availability.

**Selection is conditional**. The current production direct HTTPS is retained until independent cross-border performance/security and VPN non-interference QA passes and a separate Owner/PM release gate explicitly authorizes a cutover.

## 2. Absolutely protected existing other-project VPN

An already working VPN/Xray installation connects **another Moscow VPS** to the same German host. It is outside this project's writer authority and is **absolutely inviolate**. Neither GoBadminton Implementation nor Runner may modify/restart/rekey/reuse/replace its systemd unit/process/configuration, listeners, interfaces, keys, credentials, routes, NAT, firewall, policy routing, other Moscow VPS, or related project data.

Use distinct GoBadminton processes/identities/key material/certificates/loopback ports and scoped resource ceilings. Even a separate new process must pass **authorized independent** before/during/after continuity checks and resource-usage baselines for the other-project VPN. Shared-host resource starvation is a regression. Inability to prove non-interference is a STOP condition; it is not permission to improvise or to use the existing VPN.

The external in-progress Xray/file-transfer experiment retains exclusive operational ownership over any overlapping VPS surface until its redacted handoff and handover. No competing on-host test writer.

## 3. WSS vs XHTTP is an evidence-based mode choice, not a brand preference

The intended protocol family is Xray modern VLESS reverse. **WSS/TLS/443 and XHTTP/TLS/443 are both candidates**; none is selected as final simply because it is named in a draft. Compare exact source-pinned implementation, installed nginx version/ALPN/h2 support, real Germany→Moscow public SNI/certificate/port 443, reconnect behavior, security and complete API bodies under the same workload.

Project [Draft PR #92](https://github.com/anpavel84-afk/gobadminton/pull/92) contains an isolated N1 source candidate with both modes, with local two-process reverse and synthetic 384/512 KiB digest tests passing. Its WSS public nginx template must **not** be used with XHTTP by simply switching the mode flag. XHTTP requires a separately verified compatible public HTTP ingress/gateway and independent security/QA. WSS's upstream deprecation warning merits consideration but does not prove WSS unusable on the target path.

The original [Architect Draft PR #85](https://github.com/anpavel84-afk/gobadminton/pull/85) remains a proposal pending revision/QA: replace its WSS-first fixed ADR language with mode-neutral evidence selection, and reconcile its suggested gate software with the actual nginx mTLS implementation in PR #92. These are source/document harmonization tasks, **not** authorization to merge production snippets or activate infrastructure.

## 4. Existing direct-HTTPS failure baseline, not Xray proof

[N0 Issue #86](https://github.com/anpavel84-afk/gobadminton/issues/86) contains observed existing-host avatar PUT failures: 16 Moscow HTTP 504, 14 Germany 408; a synthetic unauthorized 384 KiB body failed even as tiny requests could reach the API. A temporary nginx buffering/timeout diagnostic did not repair the failure and was reverted. This supports a *cross-border body-transfer failure* diagnosis; it does **not** establish the low-level cause (filtering, packet loss, TCP stalls, HTTP framing or application upstream handling) or prove a tunnel will fix it. Do not infer a meaningful failure percentage without a reliable count of all attempts.

The independent map-artifact transfer via 13,955 bounded ~16-KiB HTTPS Range requests with SHA-256 success demonstrates a **separate** resumable artifact technique. It is neither Xray perf evidence nor a reason to route static maps through the consumer API tunnel.

## 5. N0/N2 real-host comparative test: acceptance proposal

N0 must reconcile the outside-Runner experiment report and authorized non-interference baseline before any new operational writer. N1 source candidate exists (Draft PR #92), but public two-host activation is **N2 NOT ADMITTED**.

After independent permission to run an isolated N2 canary, benchmark the same request matrix against **current direct verified HTTPS** and each mode that has proven public ingress compatibility:
- at least **100 consecutive** synthetic **384–512 KiB** body transfers, complete length and SHA-256 checks, no 408/504, no truncated/partial bodies; repeat under **different load periods** (not only one favorable minute). Compare both success and timing, not only `/health`;
- a controlled, authorized **authenticated avatar upload** through the complete API/CSRF/session path, using a test identity and test media, with full expected response and state readback; exclude real-user payloads without separate authority;
- health, small JSON GET/PUT/POST, login/session, Games, Messages, Radar eligibility, concurrent requests and idle connection reuse; confirm non-idempotent POST is never replayed unexpectedly;
- direct vs tunneled **p50/p95/p99**, total 408/499/502/503/504, body integrity, resource CPU/RAM, long-running stability (initially >=30 minutes), process crash and auto-recovery, slow/stalled tunnel; recognize the client-side avatar deadline **20 seconds**, demanding a measured meaningful margin, not just a `19.99s` pass;
- explicit certificate/hostname/SNI and mTLS positive/negative tests, admin/internal-port denial, header/Origin/cookie/CSRF behavior, 503 bounded tunnel failure, no cross-project leaks, and independent unrelated VPN before/during/after measurements.

Thresholds beyond the Owner's proposed 100 error-free transfers and 20-second deadline must be specified in an exact PM/QA test plan **before** execution; no retroactive lowering of acceptance or fabricated PASS. Repeated local-only N1 tests do not satisfy the real Germany↔Moscow gate.

## 6. TLS verification, failure and controlled fallback

For **both** current/direct fallback and new inner HTTPS:
- enforce `proxy_ssl_verify on`, correct `proxy_ssl_trusted_certificate`, `proxy_ssl_name`/SNI and expected identity, plus mTLS client identity for the private gate;
- do not infer the live nginx config is secure from source alone; baseline audit and bounded config change/reload require their own approved host lock and rollback;
- honor the exact nginx `location = /v1/me/avatar` and generic `location /v1/` (including method/body limits, timeout, URI rewriting, Host, cookies and CSRF);
- tunnel down/invalid TLS/failed peer verification: **bounded 503**, no automatic fallback to direct HTTPS and no automatic POST/upload retry;
- **manual** rollback to a previously reviewed direct HTTPS configuration only after authorized release procedure. This fallback may still have degraded upload reliability; it is a security-safe *operational rollback*, not guaranteed service HA.

The REST/API/database/frontend application interfaces do not change for the transport migration.

## 7. Bulk files and operations stay separate

Do not broaden the Xray API tunnel into a general SSH/SFTP/DB/publishing VPN. Task artifacts and large map files use separately scoped authenticated resumable HTTPS/443 (or an already authorized restricted SSH delivery gate), with bounded chunks, retries, per-chunk/full SHA-256, staging and atomic immutable promotion. PMTiles viewer requests remain local in Moscow. This preserves failure isolation and minimizes privileges.

Never widen the existing restricted `gobadminton-moscow-deploy` key as a generic root SSH tunnel, or reuse the other-project VPN.

## 8. Control-plane sequence and current state

- **Current:** direct public API HTTPS, with observed long-body failures. Old VPN remains protected. Draft Architect PR #85, N0 Issue #86, Draft Implementation source PR #92.
- **N0:** collect external experiment + independent VPN continuity and port/resource evidence. No service mutation.
- **N1:** existing source-only Xray WSS/XHTTP + private nginx mTLS candidate receives independent source security review; architecture harmonizes mode choice and actual gate.
- **N2:** separately approved isolated real-host Germany→Moscow TCP/443 canary, **no browser API cutover**; select transport mode only by repeatable measurements.
- **N3:** independent QA validates chosen mode, authentic body transfer, revocation, network bounds, VPN non-interference, controlled failure and rollback.
- **N4/N5:** explicit Owner/PM release, captured fallback, nginx atomic switch of **both** avatar and general `/v1` upstream, canary and postdeployment QA; rollback if SLO violated.
- **After cutover:** ordinary checks/monitoring, alert on API 408/504/503 and stale-but-connected reverse sessions; periodic reviewed key/cert rotation.

No automatic N2, N3 or N4/N5 admission from this document. Any open security/non-interference or body-transfer gate returns **NO_GO / retain direct HTTPS**. Unrelated backend/web/docs source tasks may continue under non-overlapping locks while the operations lane is held.

**Owner decision is a TARGET PRODUCT/INFRA DIRECTION, not implementation acceptance, QA PASS or production release approval.**
