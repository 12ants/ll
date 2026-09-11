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
