# Issue 94 — marker follow-up prerequisite stop

From: source author. To: PM. Date: 2026-10-19.
Status: BLOCKED / UNVERIFIED prerequisite; no implementation or acceptance claimed.

## Assignment and base

Bounded assignment: GOBADMINTON_AUTONOMY_V1, dev, source_only, Issue 94. Only marker visuals, selection lifecycle and deterministic coincident-marker separation, after M1c is merged and accepted on DEV. No commit, push, Git metadata mutation, deployment, services, secrets, automation or independent QA authorized.

Repository: `anpavel84-afk/gobadminton-clean`. Branch: `automation/issue-94`.
Exact base: `0c61960868b85cf40b761d953c7ea1b7565ecda9`; initial working tree clean.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/0c61960868b85cf40b761d953c7ea1b7565ecda9

## Prerequisite evidence and stop

Read-only local checks:

```text
git rev-parse origin/dev
ce399529b0c7d137a917f45cd4e999234d5a2908

git merge-base --is-ancestor dc1d1b9fe9460ed6fd734c95ac3e2a9a19220c90 origin/dev
exit 1

git merge-base --is-ancestor 0c61960868b85cf40b761d953c7ea1b7565ecda9 origin/dev
exit 1

git rev-parse automation/issue-88
0ce158e062d4509e8528abbbf33b520a21210ecf
```

FACT: locally available dev history contains neither Issue 90's final candidate nor the Issue 92 successor candidate. The base's `docs/handoffs/ISSUE_92_M1E.md` calls Issue 90 / PR 91 parked and Issue 92 READY_FOR_REVIEW, with execution evidence NOT_TESTED and no acceptance or deployment claimed.

Remote freshness and current DEV acceptance are UNVERIFIED. No fetch was performed because changing Git metadata is prohibited. Local evidence cannot establish that this is latest dev after accepted M1c. The assignment explicitly requires stopping if M1c is not merged into dev; implementation therefore stops at this prerequisite rather than assuming acceptance from source presence.

## Changes, checks and reuse

Only this handoff was added. No marker parts were reused or merged by hand. The local source branch tip equals the requested exact SHA, but this is not a remote-tip verification. No checkout or index write occurred.

NOT_TESTED: web unit tests, lint, typecheck and build; not run because implementation stopped before source changes at the mandatory prerequisite. No PASS claimed. NOT_TESTED: browser rendering, 390/430 widths, horizontal overflow, computed styles, physical iOS, selection and zoom lifecycle. No independent QA performed.

GamesMapBackButton, GamesMapView, GamesDiscoveryPage, layout scripts, tests, styles and dependencies are unchanged.

## STYLE_GUIDE_PARITY

Read the binding `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`. Referenced operations guide is absent in this checkout. No visual changes, new patterns, STYLE_GUIDE_GAP or OWNER_VISUAL_OVERRIDE introduced; no new frozen Make inspection claimed.

## Continuity and next bounded action

PM must establish the exact latest dev base containing accepted M1c (or its explicitly accepted successor) and supply durable merge/DEV acceptance evidence before reassigning this marker slice. Do not treat Issue 92 source presence as DEV acceptance.

Rollback: remove only this newly added handoff if needed, preserving later edits. No application rollback required.

This source-only handoff is unpublished because commit/push are prohibited. PM must publish it through the authorized record route; no result commit permalink exists yet.

## Source-author follow-up after independent QA FAIL (2026-10-19)

From: source author. To: PM / assignment owner. Status: BLOCKED, implementation absent.
Follow-up exact base: `d5789f2b53eb6a7e598e879b65792706b025bbb9`;
branch `automation/issue-94`, initially clean worktree.
Base: https://github.com/anpavel84-afk/gobadminton-clean/tree/d5789f2b53eb6a7e598e879b65792706b025bbb9

The supplied independent QA verdict is FAIL against this base: D1–D3 implementation
and tests are absent; D5 checks remain unverified. Those findings are acknowledged,
not resolved by this documentation update. No READY_FOR_REVIEW or PASS is claimed.

Repeated read-only commands and results:

```text
git rev-parse origin/dev
ce399529b0c7d137a917f45cd4e999234d5a2908

git merge-base --is-ancestor dc1d1b9fe9460ed6fd734c95ac3e2a9a19220c90 origin/dev
exit 1 (no stdout)

git rev-parse automation/issue-88
0ce158e062d4509e8528abbbf33b520a21210ecf
```

The local source branch tip matches the required reuse SHA. Read-only `git show`
and `git diff` inspected its marker helper, component, CSS and tests; nothing was
copied or merged. Its helper also moves nearby distinct points and uses a distance
argument rather than the task's zoom argument, so it would require adaptation,
not unconditional reuse. No checkout/index mutation was performed.

The immutable task explicitly says: “if M1c is not merged into dev, stop and say
so in the handoff.” Available local dev history still lacks M1c; current remote
merge and DEV acceptance remain UNVERIFIED. Issue 92's existing handoff records
its successor as READY_FOR_REVIEW with no acceptance/deployment claim. Prior QA
criticism does not supply merge evidence or repeal that explicit stop condition.
No fetch/network action, source edits, commit, push, services or self-QA performed.
Only this allowed handoff changed. All protected source, layout and test files
remain unchanged.

NOT_TESTED in this follow-up: web unit tests, lint, typecheck, build, lifecycle,
computed styles, browser widths 390/430 and physical iOS. No command output for
unexecuted checks is asserted. The direct source-author instruction prohibits
self-QA; the prerequisite also stops implementation before checks.

STYLE_GUIDE_PARITY: binding Owner decision read; operations guide absent. No
visual change, new pattern, gap or override introduced. No new frozen Make
inspection claimed.

Next bounded action: PM supplies a base containing merged M1c (or explicitly
accepted successor), with durable DEV acceptance evidence, or explicitly revises
the prerequisite. Then assign the same marker-only implementation slice; D1–D6
remain outstanding. Rollback this follow-up by removing this appended section
only, preserving the prior handoff and other work. Publication remains the
responsibility of the authorized delivery actor because commit/push are forbidden;
there is no new result permalink.

## Source-author follow-up against d91d79b (2026-10-19)

From: source author. To: PM / assignment owner. Status: BLOCKED / UNVERIFIED.
Exact starting HEAD: `d91d79bd06fc8d745fa2edc855864b1ab2f00231`, branch
`automation/issue-94`; `git status --short` initially returned no entries.
Base permalink: https://github.com/anpavel84-afk/gobadminton-clean/tree/d91d79bd06fc8d745fa2edc855864b1ab2f00231

The supplied independent QA FAIL against this HEAD is acknowledged. D1–D6 remain
outstanding; this record does not resolve the missing implementation or checks.
The immutable assignment still requires starting after M1c acceptance on DEV and
explicitly stopping if M1c is not merged into dev. No revised prerequisite or
durable acceptance evidence was supplied with the QA findings.

Current read-only command output:

```text
git rev-parse origin/dev
ce399529b0c7d137a917f45cd4e999234d5a2908

git merge-base --is-ancestor dc1d1b9fe9460ed6fd734c95ac3e2a9a19220c90 origin/dev
exit 1 (no stdout)

git rev-parse automation/issue-88
0ce158e062d4509e8528abbbf33b520a21210ecf
```

FACT: the locally available dev history still lacks the specified M1c candidate.
Current remote state and DEV acceptance are UNVERIFIED; no fetch or Git metadata
change was performed. `ISSUE_92_M1E.md` still describes the successor as
READY_FOR_REVIEW, with no acceptance or deployment claimed. The local reuse tip
matches the required SHA. Nothing was reused or merged by hand because the
prerequisite stop applies before implementation.

Only this allowed handoff is edited. Application code, marker tests, return
capsule, focus behavior, layout scripts, dependencies and all other files remain
unchanged. NOT_TESTED in this follow-up: unit tests, lint, typecheck, build,
browser/computed styles, 390/430 widths, zoom/selection lifecycle and physical
iOS. No author PASS, independent QA, deployment or acceptance is claimed.

STYLE_GUIDE_PARITY: binding Owner decision read; referenced operations guide is
absent. No visual changes, reused patterns, new gap or override, or fresh Make
inspection claimed.

Next bounded action: PM supplies the accepted M1c/successor dev base and durable
merge/DEV acceptance evidence, or explicitly revises the prerequisite, before
reassigning this same marker slice. Rollback: remove only this appended section.
Commit/push remain prohibited; publication and a result permalink must be supplied
by the authorized delivery actor, not fabricated by the source author.
