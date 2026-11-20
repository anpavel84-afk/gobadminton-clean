# OPS continuity repair — #155

WORKING DRAFT — NOT APPROVED — NOT CANONICAL

From: PM/integrator. To: OPS author → independent review → installer → live verification.
Date: 2026-10-21. No installed continuity fix claimed by this checkpoint.

Owner requested automatic handling of normal DEV advancement / recoverable CI failure, isolation of terminal task failures and continuation of independent admitted backlog. Existing slot1 #151 blocked on CI TypeScript; manual RESUME refused new DEV. Slot2 #152 is DONE, QA PASS, CI7/7, DEV ACCEPTED 4977074ee7b45ea612dde592b88b354d99839aea (r39642935622-a1).

Existing integration path already merges new DEV AFTER green CI. Missing path is CI repair when DEV moved, and safe continuation after bounded failures. No force push, counter reset, fake done, relaxed QA/CI/PROD gates, second writers, PLAN or VPN changes.

Assignment: ../.. / prompts/slots-continuity-v1.md (see repository docs/prompts directly), GitHub Issue155. Active isolated OPS author PID1236004, no duplicate author. Required real Git fixtures, restart/fault/rollback tests and exact installer independent review before installation.

Next product assignments: #156 popup covers/contacts/embedded creation; #157 shared close button. Both draft NOT ADMITTED at this checkpoint. #156 v4 independent prompt review running; #157 v2 awaits review. Files intersect and must serialize; draft backlog prose is never an executable assignment.

Reference operational guide restored verbatim from archive commit50f5a4473f8ed4ca133eac1d406d6745f589383a, SHA256d0339e1505047a4080d3eb7e7b95c23a034cfc8333623c550bb55c035d689fb9; root-owned read-only copy under /opt/gobadminton-clean-qa/style-guide/refs for offline reviewer. No guide text/authority changed; historical host paths confer no execution authority. Prior prompt review reports preserved verbatim here; not application QA PASS.

Concrete review risks already found before author completion: bootstrap origin is /srv/gb-slots/base.git in BOTH own repos; new origin checks must accept this exact trusted local source. Preserve public-status V1 schema or update monitor in same reviewed package. New integration phase needs compatible telemetry. Rollback cannot restore a runtime unable to parse deferred-policy records. Keep supervisor public API calls bounded while all slots busy. Author and QA need the existing public frozen reference in their read-only sandbox.

Next action: finish source review/fix these findings, run meaningful regression tests, independent installer review, DRY and apply with rollback, then verify actual #151 progress and admit reviewed #156/#157. Preparation is not installation.

## 19:55Z checkpoint

V1 CLI author completed: 138 core tests + 2 installer tests PASS; this is author self-check only, NOT INSTALLED. Source candidate committed for continuity. Known commissioning defects are enumerated in docs/prompts/slots-continuity-v2.md; second CLI author PID1427819 is correcting them in isolated source. Do not install V1.

#156 prompt v5 exact SHA256 21b0bbc2ecdf9a695e076118378523d9e0114f987b1c0bf18543c56576c2713e received independent MOZHNO on DEV4977074e; report SHA256 4e1fcf5d19cb03566503bae910db747c77cdc1e49fa9634301a0f35730fce922. This is task definition review, not code/installation/admission. Admission waits for runtime compatibility fix. #157 prompt v3 independent review PID1444011.

## 2026-10-21T20:09:12.147185+00:00 checkpoint

V2 final source candidate fixes the enumerated commissioning issues. CLI self-check: 151 executor/installer tests and 8 monitor tests PASS. Installer SHA256 dc4e3d52a86f7b06d1fc6145c787cfe34292c6c11ccee3cd9772ebf9cca3ab6b is undergoing independent security review PID1552692; NOT INSTALLED. Separate literal metadata-pin helper SHA25657400728a9fdccdae9957a8097bca156db6a9d74a31473d10321a2c6edeef5be review PID1560587; no gate/instruction changes.

#157 final prompt v4 SHA256 cc6ed0d9227c3052d19e90863427b422659f0c4a28c66f24d14e998a9bd7e30b has MOZHNO (report83ddcca807e5ebbe457f94361912949019bd786dedbb985b068946a985ff3dcc). Both #156 and #157 await runtime installation before immutable admission comments. Pending visual gates remain separate from source QA.

## 2026-10-21T20:16:45.879031+00:00 — V2 INSTALLER REJECTED

Independent review found Rule7 rollback defect: System.status rejects failed service startup state before restoration, leaving new files and partial service state. Exact V2 installer dc4e3d52… is NOT APPROVED and NOT INSTALLED. V3 narrow CLI correction running PID1586806, run.N8Qu9Y. Executor/slots/monitor payload hashes must remain unchanged; only installer recovery, tests, docs and generated shell may change.

Metadata helper exact57400728… independently PASS and gb-run DRY rc0 (20261021-221500-inst-slot-review-continuity-meta-1604121.log). It is NOT INSTALLED; apply only after main runtime passes review/DRY and installs. Initial metadata rejection came from authorization-record mode0600; loader requires0644. Corrected mode only, reran independent review; no instruction/gate alteration.

Monitor now reports #156/#157 definitions independently reviewed but not started. No immutable admission comments yet. Live #151 blocked, #152 done; source slots fresh and backlog available.

## 2026-10-21T20:28:31.850401+00:00 — V3 exact candidate

CLI correction complete: known failed/failed PID0 empty-cgroup recovery supported, initial unhealthy install still refused, unsafe live writers/deferrals stay excluded. 160 core/installer tests and 8 commissioning tests PASS (author self-check); five runtime payloads unchanged. New installer SHA2566e909fbf0abc0c7292e39444cf83ae289895d8a1e9b7fb893795c2fcb1b213cb. Independent security review PID1694070, log /var/lib/gb-ops-stage/files/slots-continuity-review2.log. NOT INSTALLED until exact PASS and root DRY. #156/#157 issue descriptions updated with final exact reviewed artifact links before any claim; immutable admission comments remain absent.

## 2026-10-21T20:46:10.839757+00:00 — V3 REJECTED, V4 active

Do NOT install6e909fbf…: independent review3 identified frozen --remove rejection and a startup race (first worker can author before second service startup succeeds, preventing safe rollback). No runtime installation took place. V4 CLI correction PID1815915 adds a small persistent root-managed startup barrier in existing slots.Runtime/supervisor + controlled installer commit, with frozen recovery. Exact brief in docs/prompts/slots-continuity-v4.md. All real Rule7 findings must be fixed, not waived. Existing browser PIN login suffix was verified byte-identical1613565f…; normal-auth scope was recorded separately, no secret values accessed.

V4 changes slots.py hash, so metadata helper57400728… and its approval are obsolete for V4 and MUST NOT be applied. Regenerate literal pin helper after final exact code review; fresh independent security review required. No task admission comments posted. Live system remains original #151 blocked/#152 done, DEV4977074e. Last GitHub check #156/#157 both0 comments.

## Handoff to new Chat PMA

Owner requested migration to a new ordinary Chat. Full standalone continuation record: ../../handoffs/2026-10-21_TWO_SLOT_CONTINUITY_PMA_BOOTSTRAP.md. Runtime remains NOT INSTALLED; train NOT resumed. Author4 PID1815915 was still active at handoff check; isolated self-checks 170 core +8 commissioning tests OK are not independent review. Check its finalized output before any duplicate author/review. Old metadata helper approval does not cover V4. Product156/157 NOT admitted.
