<<<<<<< HEAD
# Bridge Rendering Plan

## Problem Statement

Bridges currently float mid-air because the 3D deck height is computed as a fixed heuristic offset (`rise = 5 + layer * 3`) from a single terrain sample point, with no relation to the actual road surface elevation. When terrain is disabled, `ground = 0` (sea level), making every bridge hover at a fixed height regardless of the underlying landscape.

---

## Root Causes

1. **Terrain-off fallback is zero** (`structures.ts:194-196`)
   When `config.terrain` is `false`, `ground` is hardcoded to `0`. The deck sits at `ground + rise` (5–14 m above sea level), which is almost always wrong.

2. **Single-point elevation sampling** (`structures.ts:195`)
   Terrain is queried only at `line[i]` (the segment endpoint). The entire deck uses one `ground` value, ignoring slope along the span.

3. **`rise` is decoupled from road height** (`structures.ts:197`)
   The OpenMapTiles `layer` tag is a relative ordering hint, not an absolute height. There is no connection between `rise` and the actual elevation of the road being bridged.

4. **Pier height uses the same single ground value** (`structures.ts:273`)
   Piers extend from `ground` to `ground + rise/2`. If terrain varies, piers miss the deck or clip through it.

5. **No abutment transition** 
   The 2D MapLibre road line sits on the terrain surface; the 3D deck sits at `ground + rise`. There is no geometric continuity at the bridge ends.

---

## Solution Approach

### Option A — Always-On Terrain Sampling (Recommended)

Query the DEM for both segment endpoints on every frame, regardless of the `terrain` display toggle. Use the sampled ground height to compute a deck elevation that follows the terrain. Add a small, deterministic clearance above the highest ground point along the span.

**Pros:** Bridges look correct in all terrain modes. No new data dependencies. Works with existing `queryTerrainElevation`.

**Cons:** Slight performance cost from extra DEM queries. On very steep spans the deck angle may look odd because it is flat rather than following the slope.

### Option B — Road-Surface Following

Sample the DEM at multiple points along the segment (start, end, and midpoints). Tilt the deck so its surface follows the terrain between abutments, rather than remaining flat. Place piers at interpolated ground heights.

**Pros:** Most physically accurate. Bridges hug the terrain naturally.

**Cons:** Requires changing deck geometry from a flat box to a sloped or tessellated shape. More complex math and more DEM queries per segment. Pier caps need custom geometry to match deck angle.

### Option C — Road Network Height Propagation

When terrain is off, approximate ground height by querying the DEM once at the current camera origin and propagating that height through connected road segments. Use the highest connected road elevation as the bridge abutment height.

**Pros:** Bridges look grounded even without terrain enabled. Minimal extra queries.

**Cons:** Requires road-network topology traversal. Approximate — does not account for local valleys or hills within the span.

---

## Recommended Implementation Plan (Option A + Elements of B)

### Phase 1 — Dual-Endpoint Ground Sampling

**File:** `src/world/structures.ts`

Change the ground elevation query from a single point to both endpoints of the segment:

```typescript
// Before
const ground = c.terrain
  ? (map.queryTerrainElevation([line[i][0], line[i][1]]) ?? 0)
  : 0;

// After
const groundA = map.queryTerrainElevation(line[i - 1]) ?? 0;
const groundB = map.queryTerrainElevation(line[i]) ?? 0;
```

Use `groundA` and `groundB` for abutment height. The deck height at each end becomes `max(groundA, groundB) + clearance`.

### Phase 2 — Span-Aware Deck Placement

Replace the single `ground + rise` deck Y with a span-aware height:

```typescript
const minGround = Math.min(groundA, groundB);
const maxGround = Math.max(groundA, groundB);
const clearance = 4 + (f.properties.layer ? Number(f.properties.layer) * 1.5 : 0);
const deckY = maxGround + clearance;
```

Place the deck at `deckY`. Railings and under-slab follow the same Y.

### Phase 3 — Interpolated Pier Heights

For each pier position `t` along the span (0 to 1), interpolate ground height:

```typescript
const groundAtT = groundA + (groundB - groundA) * t;
const pierTop = deckY;
const pierBottom = Math.min(groundA, groundB, groundAtT);
```

Piers extend from `pierBottom` to `pierTop`. This prevents piers from floating above valleys or clipping through the deck.

### Phase 4 — Abutment Ramps (Optional, Low Cost)

Add short transition segments at each end of the bridge that slope from the road surface (`groundA` / `groundB`) up to the deck height (`deckY`). These can be simple wedge boxes at each abutment:

```typescript
// Ramp length: 3–6 m depending on road class
const rampLength = major ? 6 : 3;
// Ramp at start
parts.push({
  position: [a[0] + dx * (rampLength / length / 2), (groundA + deckY) / 2, a[2] + dz * (rampLength / length / 2)],
  scale: [rampLength, Math.abs(deckY - groundA), width],
  rotation,
  color: deckColor,
  kind: "box",
});
```

This visually closes the gap between the 2D road line and the 3D deck.

### Phase 5 — Terrain Display Consistency

When `config.terrain` is `true`, the terrain mesh already exists. The bridge deck should sit slightly above the terrain mesh (clearance 3–5 m) rather than at `terrain + heuristic rise`. This prevents the deck from intersecting the terrain mesh at span midpoints.

---

## Performance Considerations

| Change | Extra DEM queries per segment | Extra parts per segment |
|---|---|---|
| Phase 1 (dual endpoints) | +1 | 0 |
| Phase 3 (pier interpolation) | 0 (uses Phase 1 data) | 0 (same count, different Y) |
| Phase 4 (abutment ramps) | 0 | +2 (one per end) |
| Phase 5 (clearance tuning) | 0 | 0 |

The hard cap of 500 parts (`structures.ts:174`) already protects against blow-up. Each segment currently generates ~30–60 parts; adding 2 ramps stays well within budget.

---

## Alternative: Option C (Fallback When Terrain Is Off)

If avoiding extra DEM queries is critical, implement a lazy terrain cache:

1. On first bridge collection after terrain toggle-off, cache the terrain height at the current camera origin.
2. When sampling `ground` at a far-away bridge, use the cached origin height as a baseline and adjust by the known `layer` heuristic.
3. Mark the cache dirty on camera move or terrain toggle.

This gives acceptable results for flat terrain and avoids per-segment DEM queries, but will still float in hilly areas.

---

## Testing

- Verify at locations with known elevation change: San Francisco (hilly), Amsterdam (flat), Chamonix (mountain).
- Check `terrain: false` mode: bridges should not float above the land surface.
- Check `terrain: true` mode: deck should clear the terrain mesh; piers should reach ground without clipping.
- Check zoom transition at z=13.5: bridges should appear/disappear without popping.
- Run existing tests: `npm test` for geography and style checks.

---

## Files to Modify

| File | Lines | Change |
|---|---|---|
| `src/world/structures.ts` | 154–284 | Rewrite `collectBridgeParts()` ground sampling, deck Y, pier Y, add abutment ramps |
| `src/world/config.ts` | — | No changes needed |
| `src/world/Details.tsx` | — | No changes needed |
| `src/world/style.ts` | — | No changes needed |
=======
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
>>>>>>> a622b0307e92d4075c3df32f295cd35474627186
