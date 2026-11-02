# Handoff — #394 GAME+VENUE public comments (pass 1)

**Assignment:** `OWNER_20261102_COMMENTS394_GAME_VENUE_FIRST_SLICE`
**Author:** cursor:auto · attempt 1
**Base / prepared revision:** `8113359533e5a4cfb85c4520a7af1fff1571c9e4` (accepted alpha14)
**Publication branch (trusted process only):** `owner/comments394-public-20261102`
**QA route:** codex_sol_medium (independent) · Product CI / DEV by trusted integrator
**Author does not claim QA / CI / DEV PASS.**

## Materials read (confirmed)

| Kind | Delivered path | sha256 |
|---|---|---|
| text | `…/STYLE_GUIDE_COMMENTS.md` | `1cbcd536aceb21749c639aaefd89645439624226dc7a2c2239b30069866d238e` |
| text | `…/DESIGN.md` | `3d2b2bc94a7fcf0ee9a1033db5cf5fec7762b0eaeb93a6449349ecca5f4cf16c` |
| image | `…/game-normal-desktop.png` (opened as image) | `7a0dd9a497605761588ca3f1f45132f55b0ab4dc4fc2a5d11c1ac585787584f4` |
| image | `…/venue-normal-mobile.png` (opened as image) | `aeaf93058ad6f5650cbb499c5b139de852ae6f55efe5e55bf6a8015df911fa13` |
| text | `…/alpha14-history-seed-for-alpha15.json` | `a3024f805b5bab1d307ec2dfbe932cffa943e57a3eaecf7f14db421818869d02` |

Gallery DRAFT/PENDING phrases treated as historical visual provenance; Owner visual implementation approval (#372 comment 6555581830) governs.

## Exact behavior delivered

See `docs/product/COMMENTS_CONTRACT.md`. OpenAPI bumped to `0.25.0`. Prospective app `0.1.0-alpha.15` with `source_sha: null`. Exact alpha14 seed inserted into trusted history (SHA/date/receipt/digests preserved). Parent #394 PARTIAL; UAT NOT_TESTED.

## Author verification commands / results

```bash
pnpm --filter @gobadminton/api exec vitest run test/unit/comments.test.ts
# → 6 passed

pnpm --filter @gobadminton/web exec vitest run \
  test/comments-api.test.ts test/comments.test.tsx \
  test/releases.test.tsx test/releases-server.test.ts
# → 24 passed (4 files)

pnpm --filter @gobadminton/contracts run check
# → CONTRACT CHECK: PASS (179 paths, OpenAPI 3.1.1, info 0.25.0)

pnpm --filter @gobadminton/api exec tsc -p tsconfig.json --noEmit   # exit 0
pnpm --filter @gobadminton/web exec tsc -p tsconfig.json --noEmit   # exit 0

# Scoped eslint on changed TS/TSX: clean
```

Disposable PostGIS compound: `apps/api/test/integration/comments.disposable.test.ts`
Guard: `DATABASE_URL` → `/gobadminton_comments_disposable` + `RUN_DB_INTEGRATION=1`.
**DB status for this author pass:** NOT_RUN (no disposable PostGIS attached in author environment). Trusted PMA may run after import.

Migration smoke expects `0051_entity_comments` + physical `entity_comments` / `entity_comment_revisions` (smoke itself NOT_RUN here — needs disposable DB).

## Unresolved / out of scope

- Player-profile comments (pending Owner audience/opt-out).
- Independent Codex QA, Product CI, DEV ACCEPTED, Owner UAT.
- #464 cover/authorization (not reproduced on live alpha14; not part of this slice).
- No Git publication / merge / deploy by author.

## Allowed path diff (expected)

Migrations 0051 (+rollback), `apps/api/src/comments/*`, `app.module.ts`, API unit+integration+migration smoke, web CommentsSection + GameDetailPage + VenuePage, `comments-api/types`, `comments.css`, web tests, `releases.ts` (+tests), `COMMENTS_CONTRACT.md`, `COMMENTS_STYLE_GUIDE.md` (approval note already present), handoff, `CHANGELOG.md`, `packages/contracts/openapi.json`.
