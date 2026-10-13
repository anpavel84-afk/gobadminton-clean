# Independent QA · Radar geographic map

ID qa-radar-dev-map-ui-20261013-v001; depends on producer radar-dev-map-ui-20261013-v001; suite radar-map-germany-dev-privacy-v001. Read-only and nonauthor.

Verify exact candidate source SHA/tree/branch and protected QA root-binding. Inspect desktop/mobile image of actual MapLibre style on Germany DEV, 200 style/glyph/sprites, 206 PMTiles range, OSM/Protomaps attribution. Verify pointer/keyboard map button, fallback to list, city restriction and venue markers sourced from public venue API.

Adversarial privacy tests: no-conset / stopped / expired Radar session / blocked and suspended user / hidden profile / wrong city; no exact location or inferred person marker. Synthetic demo cannot masquerade as consented production people. No disabled source-only candidate implicitly promoted to real user product.

Check no network calls to old Moscow map host from DEV page and no changes to PROD service. Return PASS/FAIL/BLOCKED with path-scoped factual evidence; never self-issue root QA authorization.
