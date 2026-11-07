# #406 Venue loader skeleton + desktop gallery arrows

- From: source author (Cursor Auto), integrated test/notes pass 9 with #506
- To: independent delta QA (Codex Sol Medium by default); parent host for
  affected tests/types/lint/browser, then CI → guarded DEV after combined
  alpha.45 candidate
- Date: 2026-11-07
- Status: WORKING_DRAFT / READY_FOR_INDEPENDENT_DELTA_QA. Not ACCEPTED,
  not independent QA PASS, not CI, not DEV release, not Owner UAT.
- Assignment: `OWNER506_406_INTEGRATED_ALPHA45_TEST_AND_RELEASE_NOTES_ONLY`,
  attempt 9, integrated HEAD `0a568b129abe45f06eede3d8a62843b3e098764c`
  (#406 UI `789f3a8d…` already merged; this pass = remaining 2 test findings
  + shared alpha.45 notes only)
- Git writes / live runtime / DB / provider / credentials / deploy / installs:
  not performed (forbidden in this source slice)
- Combined with #506 public-text gates into one alpha.45; no second release
  number. No #507 / Mode B / future availability claim.

## Independent QA inputs actually read

- Delta QA `final.txt` (FAIL @ `789f3a8d…`): (1) browser static preflight
  `/racket|ellipse…/` forbids legitimate `racket-v1.webp` before Playwright;
  (2) venue-sheet.test.tsx:126 still expects legacy `data-cover="default"`.
- Parent actual-component browser receipt @ `789f3a8d…`: PASS native mouse,
  nested SVG prev, keyboard, 390 tap, static skeleton, zero-gallery, no
  overflow — on loopback candidate React app only (not installed DEV/UAT).

## Exact repairs (this pass — tests + notes only)

1. `venue-loader-navigation.browser.mjs` — narrow static preflight to reject
   inline equipment SVG / `ellipse cx="78"` (and `<svg>…racket|ellipse`);
   assert published `/discovery/venue-illustrations/racket-v1.webp` allowed.
   Keep native Playwright mouse/SVG/key/touch/skeleton/empty on real
   VenueGallery (not copied DOM/handlers); no skipBrowser.
2. `venue-sheet.test.tsx` — no-media sheet asserts neutral
   «Фотографии площадки пока нет» + `data-state="empty"`; retain dialog /
   focus / overflow / ESC. Drop legacy `data-cover="default"`.
3. Shared `CURRENT_NAMED_RELEASE` alpha.45 title/fixes mention gallery
   loading/error/empty + desktop arrows beside public-text addition.
   Same 0.1.0-alpha.45 / API 0.37.0; `source_sha` null; UAT NOT_TESTED.
4. Handoffs: combined #506+#406 delivery; remaining CI/DEV/UAT with parent.

## Checks

| Check | Result |
| --- | --- |
| Independent QA final + browser receipt read | DONE |
| Targeted edits in allowed_paths only | DONE |
| No production UI/API/business source in this pass | DONE |
| Host vitest/types/lint/browser / Product CI / DEV | NOT_TESTED here — parent |
| Independent delta QA | PENDING |
| DEV release / Owner UAT | NOT_TESTED — do not claim PASS |

## NOT_TESTED / limits

- Parent rerun of venue-sheet + browser script against loopback 18984.
- Installed DEV / Owner UAT / authenticated picker: NOT_TESTED.
- Mode B binding / AGY READY: not claimed.
- Prior source attempts, CI FAIL `42388403418`, and UNKNOWN retained.
