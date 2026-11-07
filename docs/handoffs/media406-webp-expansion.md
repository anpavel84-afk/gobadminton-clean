# #406 controlled media PNG→WebP + #501 denied-hint · release 44 (pass 6)

From: Cursor Auto (source writer). To: independent QA (Codex Sol Medium default) / trusted integrator / Owner UAT.
Date: 2026-11-07. Assignment: `OWNER_MEDIA_WEBP_ALL_SURFACES_AND_CONFIRMED_501_DENIED_FIX_RELEASE44` · attempt 6.
Status: SOURCE_COMPLETE / NOT_TESTED (author self-check ≠ independent QA PASS; no Product CI / DEV ACCEPTED / PROD claim).
Exact base: `83ddeb3e1bda95f1d5003d089cadcf2e501c0aba`.
Canonical Owner admission: combined bounded #406 Owner PNG GO + confirmed #501 UI correction.

## Current scope (this pass)

| Fact | Value |
| --- | --- |
| Goal | Ship alpha.**44** metadata for already-accepted media WebP surfaces + fix #501 denied pre-consent visibility |
| API / controllers / helpers | **No edits this pass** — keep pass-5 evidence (17 media+venue tests PASS / API type+lint PASS; header audit 67 PNG keys; alpha0/partial/full + gray-alpha preflight) |
| Web UI | Remove only `capability !== "denied"` from `showMasterOffHints`; preserve master/feature gates, disabled enable button, consent handler, fences |
| Disk originals | Unchanged; no rewrite / new service / cache / rights |
| Independent 44 QA | **Not started** |

## Preserved history (do not erase)

- Pass-5 native media implementation + costs / receipts retained.
- Prior venue-path FAIL history (2) retained.
- Installed **alpha.43** server ACCEPTED (PR #504 / SHA `4614a000` / `r42372648654-a1` / `2026-11-07T12:33:39Z`) is **not** product UI PASS: browser FAIL (denied → missing game/iPhone hints) retained; corrective 44 pending.
- No current-43 task replay; no second author.

## Metadata 44

- Append exact trusted 43 server seed → deployments **51→52**; assert `accepted_at` `2026-11-07T12:33:39Z` literally.
- Published 43 notes unchanged in seed; failure kept in handoff, not rewritten as all-PASS.
- Current 44: `source_sha` / date **null**, Owner UAT **NOT_TESTED**, API **0.37.0** unchanged.
- Russian notes: compact WebP for uploaded avatars / player-page covers / game covers after existing access checks; transparency+dimensions kept; originals for audit; venue WebP stays. Fix #501: game/postgame+iPhone info visible when browser notifications blocked; no direct opt-in/permission change. Limitations: time/venue push DEFERRED; 3 PWA + 26 map-sprite PNG technical compatibility; no mass disk rename/shrink or new JPEG conversions; private session/iPhone/provider/GoBad UAT NT until real.

## Checks (author lane only)

- Targeted web-push + releases literals (this pass).
- Reuse unchanged API 17 media/venue evidence from pass 5.
- UAT: NOT_TESTED. Root: actual HTTP / private unknown keys / public media / alpha / GUI hints readback after DEV.44 (390/1280, permission denied, writes 0).
- Next: independent Codex QA on exact combined candidate → full CI → DEV.44.

## Out of path

ONE source writer on allowed files only. No Git/network/deps/providers/runtime/PROD. No trailing whitespace. No new framework.
