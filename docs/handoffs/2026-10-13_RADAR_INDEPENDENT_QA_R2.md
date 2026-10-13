# Independent bounded Radar source QA — BLOCKED

Candidate: PR #19 SHA 6aae8460b5cf132fbc0344c7cb914f130ceb9d57. Git tree edd585bcb5f18f453a357d3be4884f61946c07ad.
Germany host vmi3510488. Isolated anonymous fetch /tmp/gobadminton-radar-independent-qa. No shared source edits, deployment, service activation, Git writes or QA-root evidence writes.

Executed independently under Node 24.21.0, dependencies reused from existing GoBadminton task worktree:
- Web Vitest: 54 files, 421 tests PASS. unit-node24.log SHA256 c926d36a71db3baa0ec237f28146568425845f57e7b234abf24fc481fe413da2.
- Web typecheck and lint completed with empty output, SHA256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 each.
- Four independent privacy assertions: all FAILED. independent-probes.log SHA256 00b94a0ca388bf5cf3c1538fd5019e23560c159bfcf5f3078298b41c8d27b8b2. Repro source in isolated apps/web/test/independent-privacy-probes.test.ts.

Defects in apps/web/src/lib/unified-directory.ts:
1. tick() only expires list snapshot deadline; map() ignores earlier map-response deadline. Private pins survive expired map lease.
2. map() accepts expired individual radar.validUntil.
3. map() accepts empty resultRef and obsolete policyVersion.
4. map() accepts synthetic_demo continuation of live list.
These checks are defense in depth and do not demonstrate current backend disclosure, but prevent independent source approval for active-consent-only private pins. Retaining potentially revoked data is material.

DEV exact-host/Moscow admission and PROD fail-closed tests pass. GeographicRadarMap validates style SHA256 before instantiation, permits selected pinned resource prefix, loads public venue metadata with city/bounds filter, and uses locally bundled maplibre-gl-worker.mjs (present in dependencies). Runtime map paint, HTTP206 PMTiles, attribution/glyph/sprite and mobile/desktop rendering remain unexecuted. No PMTiles download performed.

Existing manual-radar-20261013 worktree HEAD f3b08bedfd68b4782a231a6f16410d74810bb994, dirty 9 tracked files plus RadarViewNavigation.tsx and draft handoff. These unpublished changes include deadline/proof/policy/exposure protections and UI refinements. They are not candidate SHA and were left intact. Authorized writer should publish targeted corrections, after which independently rerun tests against exact new SHA. Existing author's PASS/handoff remains separate evidence.

This is bounded independent source QA, not Runner queued independent job completion, protected operational attestation, deployment QA or commissioning success. Earlier accidental Node20 test invocation is excluded from verdict; final executed full suite uses verified Node24.

Corrected non-vacuous wire probes rerun: authenticated_live + snapshot policyVersion and row consentPolicyVersion; initial admitted snapshot asserted, map TTL case initial pin asserted. Five separate tests all FAIL on exact PR19 SHA. Final preferred evidence independent-probes-correct-wire.log SHA256 79a88cc39987b8f161de6c0d22441ce03b5d4eefcfb51212316a22e14d55e82b. Repro test SHA256 cf60913618ec5aeb0f978cfe89a3ca4101a81e14e6b09683954011350903f0d9. Local work/radar-regression.test.ts is ready for discovered test-path publication. This supersedes original four-probe draft evidence.

Prepared repair verification in isolated clone only: copied the three existing dirty files unified-directory.ts, unified-directory.test.ts, unified-legacy-compat.test.ts; independent corrected 5 probes included. Full Web 55 files / 428 tests PASS. Log prepared-source-tests.log SHA256 68e0aedee9334324b0ae327fedd2149acb7071319ec1cd9e7c264c75860fdd8b. This is preliminary evidence of addressed defects, not immutable published SHA QA. Exact candidate must be published and verified anew.

# Published repair — independent exact-SHA source verdict PASS

Fresh independent anonymous fetch into /tmp/gobadminton-radar-independent-qa-ed1ad372 on Germany, detached at ed1ad372751b25f1d4bddae1f13e1b3876ef5bec. Tree 7f4a9949a96d676925b740f425f99cad32889a8c, parent 6aae8460b5cf132fbc0344c7cb914f130ceb9d57. Executed PID3110342 with Node24.21.0; tracked source/test diff to HEAD empty; only four intended repair paths differ from parent.

- Full independently executed Web: 55 test files / 428 tests PASS. unit.log SHA256 da094eaafeb7fe06bb4c7e5b4503812760f86fb6a6f6f78e5dedff82dce21c4e.
- Targeted rerun PID3112300: correct-wire privacy 5 tests + unchanged exact Germany DEV/PROD map gates 2 tests: 7 PASS, exit0. privacy-map.log SHA256 6b90a9378f0e0c5389b7e1625db9bfb5b5556fe96ecb3764d0fc30612745f5d8.
- Typecheck and lint independently rerun PID3114338, exits recorded in exit-codes.log. Both empty output hashes e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
- Published regression file SHA256 4664f79127d4d0bf64f5842edd1df9bc1b85aefa02f060f07c1e5b8f8b52638d.
- Map host/resource allowlist source and tests unchanged from initial tested candidate; PROD fail-closed and exact dev.gobadminton.ru/Moscow admission retain PASS. No PMTiles re-download.

The initial five correct-wire FAIL results remain above and are not overwritten. Their targeted fixes now pass on exact published SHA. This independent PASS applies ONLY to bounded source QA. Real browser map paint/public venue resources/mobile rendering, protected independent queued QA job, service commissioning and release/rollback are not attested or executed by this review.
