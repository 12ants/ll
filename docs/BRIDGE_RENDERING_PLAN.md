# Bridge Rendering — Resolution Notes

## Original Problem Statement

Bridges could float mid-air because the 3D deck height was computed as a
fixed heuristic offset (`rise = 5 + layer * 3`) from a single terrain
sample point, re-queried per *segment* rather than per bridge line. When
`config.terrain` was `false`, ground was hardcoded to `0`.

## Why the originally-proposed "Option A" doesn't work

An earlier draft of this document recommended always sampling the DEM for
bridge elevation, regardless of the `terrain` display toggle. That's not
achievable with MapLibre's public API:

- `map.queryTerrainElevation()` returns `null` unless `map.setTerrain()`
  is currently active (confirmed in `maplibre-gl.d.ts`: "Returns null if
  terrain is not enabled").
- Passing `exaggeration: 0` to get elevation without the visual mesh
  doesn't help either — the same method multiplies its return value by
  the active exaggeration, so a `0` exaggeration always returns `0`.
- Toggling `setTerrain()` on transiently just to sample, then off again,
  would flash the 3D terrain mesh and re-trigger DEM tile loads — not
  viable per-frame.

The rest of the scene (buildings in `collectStructures`, prop placement
in `details-data.ts`) already follows the same rule: elevation is only
sampled when `config.terrain` is `true`. Bridges now follow it too,
instead of trying to special-case around it.

## What was actually wrong (beyond the doc's original diagnosis)

1. **Per-segment resampling.** `collectBridgeParts` queried ground inside
   the segment loop, so a single bridge `LineString` with several
   vertices got a different deck Y per segment — a visible staircase on
   any real multi-vertex bridge. This was more visible in practice than
   the terrain-off case the original doc focused on.
2. **`StructurePart.rotation` is yaw-only.** There is no pitch degree of
   freedom in the part schema or in `Details.tsx`'s instancing. The
   original doc's Phase 2 (sloped deck) and Phase 4 (wedge abutment
   ramps) would have required threading a new field through
   `StructurePart` and `Details.tsx` — out of scope for this pass, and
   dropped.
3. **Terrain-off "floating" was mis-diagnosed.** When terrain is off the
   whole scene is flat (buildings included), so a bridge sitting a fixed
   height above `y=0` isn't inherently wrong — it's consistent with
   everything else at ground level. The real visible artifact is the gap
   at the abutments, where the flat 2D road line (y=0) meets a deck up to
   14m up. That gap is what got fixed (see below), not "floating at sea
   level."
4. **Root cause #4 in the original doc (piers not reaching the deck) was
   not a real bug.** A cylinder at `ground + rise/2` with `scale.y =
   rise` spans `[ground, ground + rise]`, and the deck center is at
   `ground + rise` — piers already reached the deck.

## Implementation (`src/world/structures.ts`, `collectBridgeParts`)

- **Per-line deck height, not per-segment.** Ground is sampled once at
  each line's two endpoints (terrain-gated, as everywhere else). The
  whole line shares one flat `deckY`, eliminating the staircase.
- **`deckY = (terrain ? max(groundStart, groundEnd) : 0) + clearance`**,
  where `clearance` is a small, capped value (3–6m) based on road class
  and the OSM `layer` tag (a relative stacking hint, not an absolute
  height — it's now only used to nudge clearance within a tight range,
  not to set the whole rise). This replaces the old uncapped 5–14m
  heuristic and closes most of the terrain-off abutment gap.
- **Piers interpolate ground along the line** at each pier's own
  position (linear interpolation between the two endpoint samples), so
  pier length responds to slope instead of using one fixed height for
  every pier in the span. A pier is skipped if the computed height comes
  out under 0.5m, guarding against degenerate/inverted geometry.
- **Railing post spacing widened** (5m → 8m, cap 28 → 20 per side) to
  reduce how much of the shared 500-part budget (`structures.ts:174`)
  each bridge consumes — hitting that cap silently drops every
  remaining bridge in view for the frame, not just the current one, so
  cheaper bridges buy more visible bridges overall.

## Explicitly out of scope

- Sloped/tessellated decks that follow terrain along the span (needs a
  pitch field on `StructurePart` plus `Details.tsx` changes).
- Wedge-shaped abutment ramps (same blocker).
- A terrain-off elevation fallback via road-network height propagation
  (the previously-proposed "Option C"). Not pursued — it requires road
  topology traversal for a case that, per point 3 above, wasn't actually
  broken the way originally described.

## Testing

- `npm test` — unit tests (config/geography/style) pass unchanged; there
  are no dedicated bridge tests.
- Visual verification (hilly terrain, terrain on/off, zoom transition at
  z=13.5) was not captured in this pass — do this via
  `npm run test:browser` or manual inspection before relying on the
  visual result, especially at a hilly location (e.g. San Francisco).
