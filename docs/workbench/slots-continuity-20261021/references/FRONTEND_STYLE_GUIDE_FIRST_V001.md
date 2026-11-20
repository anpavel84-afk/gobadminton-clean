# GoBadminton Frontend Style Guide First — Engineering Policy v001

Status: **CANONICAL ENGINEERING POLICY**
Owner authority: `docs/decisions/OWNER_DECISION_FRONTEND_STYLE_GUIDE_FIRST_V001.md`
Frozen Design Spec: `487a8379ff31c88a95d0f0f130dad7c78f7af6f2`

## Sources

Primary visual/composition source:
- https://nougat-wise-76949869.figma.site/#guide
- https://nougat-wise-76949869.figma.site/#construction-kit

Frozen local source:
`C:\Users\PLAN\Documents\gobadminton\GoBadminton Web App Design`

Germany execution reference (must exist and hash-match before FR implementation):
`/srv/gobadminton-dev/runner/reference/figma-make-frozen-v001`

Expected:
- 68 original files excluding generated `node_modules/**` and `dist/**`;
- `src/App.tsx` SHA-256 `04187d4d7d70c8c61e9ca2f08b6b6325a98539a3ec90c711c48ab771f675b61c`;
- `src/index.css` SHA-256 `f660e31973a6142784308f22728c751d7bb7432fb2ac0136bac032dbc6b1db2a`.

The public Figma site is a navigation/visual aid, not the only executable source. If it is unavailable to the execution host, use the verified frozen runtime reference.

## Mandatory workflow for apps/web

For every changed surface:

1. Read the exact assignment and current backend contracts.
2. Inspect the corresponding frozen screen in `src/App.tsx`.
3. Inspect `StyleGuide` and `ConstructionKit` before creating components.
4. Record a small mapping:
   `UI need → frozen screen component → Style Guide family → production component`.
5. Reuse/compose canonical patterns.
6. Do not copy Make demo business semantics that conflict with Product/API.
7. Do not use legacy production markup/CSS as visual authority.
8. Capture rendered evidence at required widths.
9. Include `STYLE_GUIDE_PARITY` in handoff.

## New visual pattern rule

A new visual pattern requires one of:
- `STYLE_GUIDE_GAP`: no suitable existing family;
- `OWNER_VISUAL_OVERRIDE`: Owner explicitly rejects the suitable existing family.

Without one of those, an ad-hoc visual pattern is out of scope.

## Consumer copy

Never render internal engineering language such as:
`authority`, `MVP`, API paths, `GET /v1/*`, `live authority`, `not-map`, QA notes, implementation notes or contract commentary.

Translate technical state into ordinary consumer copy.

## Visual QA

Rendered evidence is a hard merge gate for canonical FR slices.
Source/unit tests alone cannot close visual fidelity.
