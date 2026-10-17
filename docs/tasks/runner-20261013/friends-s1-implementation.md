# Owner S1 · Friends foundation API (source-only)
**GitHub Owner scope:** [#12](https://github.com/anpavel84-afk/gobadminton-clean/issues/12); parent [#5](https://github.com/anpavel84-afk/gobadminton-clean/issues/5).

Implement the existing GoBadminton Friends S1 foundation on the **current** clean Git history. Inspect existing `apps/api` and `packages/contracts` first. Historical [legacy PR198](https://github.com/anpavel84-afk/gobadminton/pull/198) has additive `0032_friendship_core.sql`, controller, service, contract and regression source; selectively port compatible source only. DEV database has 31 migrations and 20 synthetic accounts; production must remain untouched.

Required: account-bound request, accept, decline, cancel, unfriend, status/list, replay safety, concurrent duplicates, private/not-discoverable checks, blocking and account revoke where existing model supports them. No logged-in subject spoof, unilateral friend acceptance, raw phone data or private geolocation exposure. Test with disposable PostGIS 0032 and targeted security/integration cases; preserve existing Games/Players/Radar invariants.

Generate a new `friends/dev-s1-...` source branch from the latest clean main. Commit code/tests only, provide exact candidate commit SHA, tree, branch, changed paths, tests counts and immutable GitHub handoff. Do not merge, start real user flags, change PROD or forge an independent QA PASS. Require an independent QA companion before DEV release. Write ordinary JSON completion receipt for this exact task; negative results must identify true blocker.
