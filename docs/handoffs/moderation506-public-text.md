# Handoff · Issue #506 · MOD-V2-A public text (author pass 3 · two HIGH repair)

Source-only candidate after independent Codex Sol Medium FAIL on
`e754e499f693488813bc7fa174cea57691d04cbb`. No DONE / QA / CI / DEV / UAT claims.

## Pass-3 concrete repairs (exactly two HIGH)

1. `games.service.ts` `publish` — assertCanManage runs inside the short preflight
   transaction **before** reading/emitting version or draft-status outcomes. Snapshot
   select follows authority; transaction ends before text provider. Final
   runIdempotent actor/resource/version/content fences and stored host field names
   from pass 2 unchanged. Foreign private/unlisted targets keep privacy `404`
   `GAME_NOT_FOUND` for multiple expectedVersion/status probes.

2. `unified-publishing.service.ts` `command` start/takeover — shared receipt +
   `authorizeReplay`; `findReplay` before any text provider; accepted same-key replay
   skips provider and still reprojects ephemeral wire metadata (not durable receipt
   alone). On miss: read-only eligibility preflight (no bootstrap write / budget /
   consent / presence mutation) then text provider; locks end before provider await;
   `runIdempotent` repeats full fences.

## Regressions added

- `public-text-moderation.test.ts` — foreign organizer HTTP publish probes across
  several expectedVersion values and published status: always privacy 404;
  `fake.textCalls` unchanged by foreign probes; owner publish/stale/replay path kept.
- `radar.unified.test.ts` — revoked session (service fence) and ineligible profile
  → 0 text provider calls; allowed start works with wire metadata; same-key
  start/takeover replay → 0 additional calls.

## Author sandbox status

- Edits limited to allowed paths only.
- Full disposable DB integration / Product CI / DEV45 not run in this sandbox
  (parent owns pinned disposable DB + gates). Sandbox gate test remains for
  `RUN_DB_INTEGRATION≠1`.
- Prior pass-2 unit/HTTP/release/types/lint PASS evidence reused for unrelated
  surfaces; this repair does not re-architect M1 / Mode B/C/D / release notes /
  schema.

## Parent next

- Affected types/lint + target integration (`public-text-moderation`, unified radar delta)
- Independent delta QA for the two findings
- Then full Product CI / real DEV45

## Still not claimed

- Overall PASS/DONE from source author
- QA / CI / DEV ACCEPTED
- Mode B binding / AGY author / PROD
