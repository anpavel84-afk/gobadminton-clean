# Pilot readiness · #461 · 5 November 2026

This is an internal DEV readiness assessment, not authorization for customers, public launch or PROD. Technical acceptance, user acceptance and legal/operational decisions are separate.

## Current evidence

- Accepted DEV alpha.28 / API0.34: `9bd1ad648fd74123da7ede7377471813ce8fe17d`, `r41950962808-a1`, 2026-11-05T02:00:50Z; [PR483](https://github.com/anpavel84-afk/gobadminton-clean/pull/483), independent QA PASS, Product CI41949930612 7/7, installed browser6/6 at1440/390. This assessment's help-copy change still needs its own QA/CI/DEV receipt.
- [#480](https://github.com/anpavel84-afk/gobadminton-clean/issues/480): separate restricted `pilot_viewer` login and real PilotMetrics GET/render PASS. No superadmin or consumer-management authority. Independent Go Bad/Owner UAT remains separate.
- Existing [#372](https://github.com/anpavel84-afk/gobadminton-clean/issues/372) PG1–PG4 and [#394](https://github.com/anpavel84-afk/gobadminton-clean/issues/394) private peer Safety / public organizer, trainer and venue reviews are developed. Do not rebuild them. Historical missing attribution remains a write limitation; no fabricated attendance or human approval.
- [#386](https://github.com/anpavel84-afk/gobadminton-clean/issues/386) contacts, help and manual booking status are technically delivered. [#456](https://github.com/anpavel84-afk/gobadminton-clean/issues/456)–[#460](https://github.com/anpavel84-afk/gobadminton-clean/issues/460) are already DEV ACCEPTED.

## Scenario acceptance still required

| Scenario | Technical evidence reused / current result | Real-user acceptance |
| --- | --- | --- |
| Email / OAuth | Existing email transport and OAuth code delivered | NOT_TESTED: actual authorized mailbox receipt and provider session |
| Game create, apply, confirm, cancel | Existing lifecycle and role-scoped API tests | NOT_TESTED: organizer and participant sessions with committed readback |
| Personal messages / game chat | Immediate DM with recipient preferences, blocks and restrictions; obsolete help prerequisite corrected in this slice | NOT_TESTED: two real QA-user sessions; game chat permission/lifetime unchanged |
| Radar privacy | Existing explicit consent/stop and bounded visibility rules | NOT_TESTED: genuine consented consumer session; private API404 can be expected |
| Postgame / reviews / Safety | Independent source QA and disposable tests; public venue anonymous installed read PASS | NOT_TESTED: real participant, organizer and assigned independent human reviewer; pilot_viewer cannot substitute |
| Court agreement | Existing contacts/help/manual status; actual public venue surfaces checked | NOT_TESTED: authorized organizer status update; no real booking or external message sent |
| Push / reminders / level help | Existing accepted456/457/458 checks; no repeat implementation | NOT_TESTED: physical iPhone installed PWA and consented push; current organizer reminder and actual explicit level save |
| SPb map / analytics | Actual anonymous SPb390 map17markers/assets PASS; real restricted PilotMetrics readback PASS | Physical Safari/Radar and independent human UAT NOT_TESTED |
| User rights / support | Profile preferences, session revocation, unlink and scoped report/Cases primitives exist | Full deletion NOT_READY; actual support-to-human resolution NOT_TESTED |

## Factual obstacles before a real-user pilot

1. `/legal/privacy`, `/legal/terms`, `/legal/rules` render **Не опубликовано**; operator/contact are absent. Owner/privacy specialist must provide actual approved texts, entity, effective dates, minors and consent/withdrawal decisions (O-01). No wording or consent is invented here.
2. Data flow/storage/transfer, retention, backups/logs/media/OAuth/push and restoration after deletion need actual review (O-02). Proposed14/30/90day values in historical documents are not operative policy. Internal DEV hosting is not launch clearance.
3. `/help` has no published operational support contact. Owner must identify responsible contact, response expectations and incident/complaint escalation (O-06). Scoped abuse/Cases endpoints do not constitute a general help desk.
4. Full account deletion remains gated `C-DEL`: settings offers a disabled action; provider unlink/logout/session revoke do not delete an account. Ownership of future games, historical disputes, media and backups needs an approved procedure and implementation/readback before claiming completion.
5. Genuine consumer/human-reviewer UAT and physical iPhone Push remain NOT_TESTED where sessions/device are absent. No fake approvals, harvested cookies or widened roles were used.

The accepted internal-MVP deferral of O-01/O-02 permits internal development and this assessment; it does not authorize public launch. Keep relevant Issues open for real acceptance/Owner decisions, with source, QA, CI, DEV and UAT distinguished. After this bounded #461 delivery the authorized completion train stops; no new product direction or PROD rollout follows automatically.
