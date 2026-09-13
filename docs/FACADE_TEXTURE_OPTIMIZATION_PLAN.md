# Facade Optimization Plan — windows as texture, not geometry

Goal: draw windows as a material on the wall rather than as thousands of
small boxes floating in front of it, so facades can cover *every* visible
building instead of the nearest few hundred, at a fraction of the cost.

## Measured starting point

`collectStructures` in `src/world/structures.ts:24-130`:

- Every window pane is its own `StructurePart` — a box with position, scale,
  rotation and colour (`structures.ts:7-14`), pushed one per pane
  (`structures.ts:115`).
- Panes are pushed **0.08 m off the wall** along the outward footprint
  normal (`structures.ts:104-108`) specifically to avoid z-fighting with
  MapLibre's coplanar extrusion face.
- The total pane budget is a hard cap: **500 (Eco) / 2,600 (Balanced) /
  6,000 (High)** (`structures.ts:30-31`).
- Only buildings within **750 m** are candidates, capped to the nearest
  **200** (`structures.ts:56-61`), and only at zoom ≥ 15
  (`structures.ts:29`).
- Because the cap is shared, the code deliberately thins a regular grid
  (`step`, `structures.ts:103`) and enforces a low per-building floor
  (`perBuilding`, `structures.ts:66`) so the budget is not exhausted by the
  first few dozen buildings.

That last point is the tell: **the current design is dominated by managing
scarcity.** The pane budget is the constraint shaping the visual result.

## Why texturing is the right change

A pane carries a full transform (position, scale, rotation, colour) and
occupies instance slots. A facade *texture* carries the same visual
information in one draw over a surface that is already being drawn. The
window grid is regular — exactly what a repeating texture represents well.

Expected effect: the per-building pane count stops mattering, so facades can
apply to every visible building rather than the nearest 200, and the
`perBuilding`/`step`/`cap` thinning machinery disappears.

## Options

### A. Textured proxy walls (recommended)

For each visible building, emit one thin quad per footprint edge, at the
wall plane, with a repeating window texture whose UV repeat is derived from
the wall's real length and height (columns every ~4 m, floors every 3.5 m —
the same numbers `structures.ts:96-97` already uses).

- One mesh per building (or one merged mesh per tile) instead of N panes.
- Keep the existing 0.08 m outward offset for the same z-fighting reason.
- Ground floor and lit-window variation move from per-pane colour into the
  texture plus a per-building tint, preserving what `FACADE_TONES`
  (`structures.ts:16-22`) already achieves.

Night lighting: today `paneLit` randomises per pane (`structures.ts:114`).
In a texture world, use a second emissive texture channel with a per-
building random offset so lit windows differ building to building without
needing per-pane state.

### B. Texture MapLibre's extrusion directly

MapLibre's `fill-extrusion` supports a pattern. This would be the cheapest
option of all — no extra geometry whatsoever — but it applies per layer, not
per building, so per-building tone variation and the lit/unlit night split
become hard. Worth a spike to confirm the limits before committing.

### C. Hybrid

Texture at distance, real pane geometry for the nearest handful of buildings
where parallax actually reads. This preserves close-up depth while removing
the cost everywhere else. Adds a second code path — only take it if A alone
looks too flat close up.

## Sequencing

1. Spike B (half a day) — if per-building variation is achievable with
   MapLibre patterns, it dominates on cost.
2. Otherwise implement A, deleting the `cap`/`perBuilding`/`step` thinning.
3. Measure. Only add C if near-field facades read as flat stickers.

## Acceptance criteria

- Facades appear on **every** building in view at zoom ≥ 15, not the nearest
  200.
- Collection time and frame time both improve at a fixed camera; measure at
  Gamla Stan z16 and Amsterdam z15, which are the cameras already used for
  bridge timing.
- Night still shows scattered lit windows, varying between buildings.
- No z-fighting against MapLibre's extrusion face at any zoom or pitch —
  the 0.08 m offset exists for this and must be re-verified, since a texture
  plane is coplanar in a way a box is not.

## Risks

- **Texture memory** replaces instance count as the budget. One shared atlas,
  not a texture per building.
- **Anisotropy**: at grazing angles a window texture smears. Set
  `anisotropy` from the device tier, the same way `dpr` already is
  (`config.ts:270-272`).
- **Losing silhouette**: panes currently stand 8 cm proud, which reads at
  close range. A flat texture will lose that. This is the main reason to
  keep option C available.
