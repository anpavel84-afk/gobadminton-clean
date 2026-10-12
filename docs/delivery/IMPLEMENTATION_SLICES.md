# План реализации по вертикальным срезам

Статус: **TECH_SELECTED sequence / PROPOSED_PRODUCT scope**.

| Срез | Результат | Gate | Приёмка |
|---|---|---|---|
| F-00 | Architecture Foundation | Owner assignment | Docs/contracts/static check |
| F-01 | Executable foundation + split MVP runtime | F-00; OD-008/OD-010 | Code/build/tests/CI; API+DB Germany; web Moscow; inter-host proxy smoke |
| F-02 | Identity + minimal account | F-01; provider apps for live tests | VK/Yandex sessions/link/logout contracts |
| F-03 | Organizer/Venue/Game + discovery | F-01 | Publish/discovery/card/capacity |
| F-04 | Request → decision → cancel | F-02 + F-03 | Transactional participation loop |
| F-05 | Pilot ops/trust | F-04 + legal/ops gates | Admin/support/privacy/restore |
| F-06 | Mobile vertical slice | stable F-04 API | iOS/Android dev builds |
| F-07 | Public release readiness | QA/legal/release gates | Stage/release evidence |

F-02 and bounded F-03 may later run in parallel with non-overlapping ownership.

## F-01 current continuation

Do **not** rewrite F-01. Existing code is preserved in PR #4 / branch `impl/f01-pushable`.

Current continuation:
1. reconcile branch with current project rules/docs;
2. keep existing toolchain/API/web/DB foundation;
3. redeploy API+PostgreSQL on Germany;
4. deploy web runtime on Moscow;
5. configure Moscow same-origin `/v1` proxy to German API;
6. run split-host smoke and resource checks;
7. update handoff/PR evidence.

Moscow is resource-constrained; heavy build work should happen on PLAN/CI or stronger build host rather than during live runtime.

No automatic F-02/F-03 execution until F-01 is accepted.
