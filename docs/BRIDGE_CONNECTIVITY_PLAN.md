# Connected Bridges Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Track completion in [IDEAS_TODO.md](IDEAS_TODO.md) and evidence in [IDEAS_WORK_LOG.md](IDEAS_WORK_LOG.md).

**Goal:** Generate continuous road-to-ramp-to-deck surfaces, with railings only on exposed edges and never across a connected travel corridor.

**Architecture:** Build a local transportation graph from retained source features, solve bridge and approach elevation as one connected surface, then derive railings from its exposed boundary. Render decks and ramps as indexed meshes with shared seam vertices; retain instancing for optional posts and piers.

**Tech stack:** Existing TypeScript, GeoJSON, MapLibre GL JS, Three.js/R3F, Vitest and Playwright.

**Spec:** Third request in [ideas.md](ideas.md). Requires Z1–Z2 from [ZOOM_STABILITY_PLAN.md](ZOOM_STABILITY_PLAN.md); B3 integrates with Z3. Read [BRIDGE_RENDERING_PLAN.md](BRIDGE_RENDERING_PLAN.md) as historical resolution notes, not a ramp implementation.

## Constraints and guarantees

- Preserve the terrain-off world at ground zero. Sample terrain only when enabled and the method exists. Returned elevations already include the configured exaggeration; do not multiply again or toggle terrain temporarily to sample it.
- `layer` indicates relative ordering, not an elevation in meters. A 2D crossing is not evidence of a junction.
- Use Z1 road widths/colors consistently for decks, approaches and adjoining roads. Preserve the roads and bridges toggles independently; hidden roads can still provide topology.
- Replace the approximate 500-part enforcement with a true maximum of 500 optional bridge instances and a separate explicit mesh budget. This is a representation change, not permission to move unlimited work out of the old cap.
- Keep the shared canvas, worker URL bundling, demand rendering and event-driven collection. Do not upgrade dependencies.
- Every **published elevated bridge** must have complete approaches to verified road connections. Where source data is incomplete or contradictory, retain the previous valid connected model or show the ground/overview fallback without generated railings. A fallback is not a successfully reconstructed elevated bridge and must be counted separately in validation.
- Full reconstruction everywhere requires source geometry and connectivity that public display tiles may not contain. Record unresolved sites; do not invent a ramp across water or attach it to the nearest unrelated road to claim coverage.

## Current causes

`collectBridgeParts()` in `src/world/structures.ts` reads only the rendered `bridges` layer. It has no adjacent road graph, attaches railings to every segment independently, and places a flat deck at the maximum endpoint ground plus a class/layer clearance. The approach road remains on the ground. Lower clearance reduces the gap but cannot close it.

The `StructurePart` schema and `Details.tsx` support yaw only, so adding a height interpolation to existing boxes cannot create a properly sloped continuous surface. Segment boxes also leave corner seams on bends. With `rotation = -atan2(dz, dx)`, the current railing offset uses `[-sin(rotation), cos(rotation)]`; in X/Z this is generally not perpendicular to the centerline `[dx,dz]`. A diagonal fixture should expose this before a fix is attempted.

Deduplication uses ordered coordinate pairs, so reversed duplicates survive. Budget checks mix `> 500` and `>= 500`, while deck/rail insertion is sometimes unconditional; the cap can be exceeded and a later bridge can be cut off midway. Piers use endpoint-interpolated ground and do not test road/water crossing occupancy.

## Approach and alternatives

Recommended: graph, shared surface and exposed boundary. This handles bends, multi-part bridges, ramps and junction openings with one consistent model.

Adding pitched boxes with short straight ramps is a useful isolated geometry experiment, but it cannot establish the correct originating road or remove internal rails at junctions. Importing complete engineered bridge models would improve particular landmarks, but cannot serve as the default keyless world pipeline.

## Shared model contracts

Create `src/world/bridge-model.ts` for the types below. All coordinates are meters in a fixed local origin per connected component; convert to the current render origin only when publishing buffers.

```ts
export type Vec3 = [number, number, number];
export interface RoadNode {
  id: string;
  position: Vec3;
  edgeIds: string[];
}
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  points: Vec3[];
  width: number;
  layer: number;
  bridge: boolean;
}
export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}
export interface ProfileSample {
  distance: number;
  center: Vec3; // Y is the finished roadway top, never deck center.
  left: Vec3;
  right: Vec3;
}
export interface BridgeSurface {
  id: string;
  samples: ProfileSample[];
  thickness: number;
  openings: { from: Vec3; to: Vec3 }[];
}
export type BridgeSolution =
  | { status: "ready"; surfaces: BridgeSurface[] }
  | { status: "incomplete" | "infeasible"; reason: string };
export interface BridgeMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
```

## B1: Identify complete bridge components and real connections

**Files:** Create `src/world/bridge-model.ts`, `src/world/road-topology.ts`, `tests/road-topology.test.ts`, and `tests/fixtures/bridge-network.ts`; modify `src/world/details-data.ts` to consume Z2 records.

**Interface:** Export `buildRoadGraph(features: readonly WorldFeature[], origin: Position): RoadGraph` from `road-topology.ts`. Use Z1 dimensions and Z2 scoped identities; all positions returned are local meters.

- [ ] Add fixtures for straight and curved bridges, reversed duplicates, tile-split lines, a T approach, a Y split, separate carriageways, an overpass, tunnels, absent neighbors and parallel roads 2 m apart. Confirm no graph connection at an interior crossing with a different level.
- [ ] Run `pnpm exec vitest run tests/road-topology.test.ts` and confirm the missing graph behavior fails.
- [ ] Split lines at verified shared nodes and compatible endpoint-to-interior junctions. Snap within 0.5 m only when geometry and metadata support connection; proximity alone is insufficient. For an unambiguous bridge-to-ground endpoint, allow a `brunnel`/layer transition without joining an unrelated crossing. Preserve ambiguity as unresolved.
- [ ] Join contiguous bridge edges through degree-two compatible nodes. Keep degree-three branches explicit. Deduplicate reversed segments with an orientation-independent key, while preserving direction metadata for future use. Never identify a tile cut as an abutment solely because a queried LineString ends there.
- [ ] Traverse outward along connected non-bridge roads to find approach space, initially bounded to 250 m per end and 2,000 graph edges per component. Stop at unresolved geometry, incompatible levels or a junction requiring a shared profile. Classify unresolved components for fallback instead of stretching ramps to arbitrary endpoints.
- [ ] Record endpoint completeness and unresolved reason alongside the graph component used by B2. Data arriving later triggers a replacement attempt through Z2, not a per-frame network traversal.
- [ ] Run targeted tests, `pnpm test` and `pnpm build`; record and commit the topology layer.

## B2: Solve continuous bridge and approach heights

**Files:** Create `src/world/bridge-profile.ts`, `tests/bridge-profile.test.ts`; modify `src/world/bridge-model.ts` if additional explicit solver metadata is needed.

**Interface:** Export `solveBridge(graph: RoadGraph, sampleGround: (point: Vec3) => number | null, options: { terrain: boolean; maxGrade: number; maxApproach: number }): BridgeSolution`. The adapter converts local coordinates to longitude/latitude before querying terrain. A `null` required sample produces `incomplete`, not ground zero; when terrain is off the adapter returns zero without touching the map API.

- [ ] Add fixtures with level ground, different endpoint heights, a bend, terrain bumps, missing DEM, an approach too short for the required rise, crossing clearance and a junction inside an approach. Assert seam positions in all three axes, not merely the centerline's height.
- [ ] Run `pnpm exec vitest run tests/bridge-profile.test.ts` and establish the failures.
- [ ] Start from the current class clearance heuristic, capped as an explicit design parameter, and solve a finished road-top elevation that also clears known lower surfaces. Compute clearance from deck underside (`top - thickness`) to the lower road top. Use layer for ordering; when ordering and available grade cannot both hold, return `infeasible` with a reason.
- [ ] Parameterize each route by cumulative horizontal distance. Choose initial max grades of 8% for motor roads and 12% for paths as visual design limits, not civil-engineering claims. Extend the approach along the actual connected road until a continuous profile fits or the 250 m bound is reached.
- [ ] Use a cubic Hermite transition between ground and span, matching endpoint heights and slopes. For a flat-to-flat rise using smoothstep, choose `L >= 1.5 * abs(rise) / maxGrade`, because its maximum derivative is 1.5. Test the resulting sampled grade, including the ground slope; do not clamp individual heights after solving because that breaks continuity.
- [ ] Sample center and both road edges at spacing no greater than 5 m, refining near bends and grade changes. Cache samples per terrain generation; missing data preserves the prior valid solution only when its terrain/config generation still matches. Recompute on terrain/exaggeration changes and DEM completion.
- [ ] Solve shared approach junctions together: connected branches meet the same node height and seam cross-section. If a branch cannot meet it within the limits, reject the component for fallback. Do not put a lifted main road through a flat side road.
- [ ] Add a terrain-off mock whose query method throws, ensuring it is never invoked. Assert endpoint gaps below 0.02 m, finite geometry, grade within the selected limit and continuous profile through multi-segment spans.
- [ ] Run targeted tests, `pnpm test` and `pnpm build`; record and commit the solver.

## B3: Render joined decks, ramps and ground tie-ins

**Files:** Create `src/world/bridge-mesh.ts`, `src/world/BridgeMeshes.tsx`, `tests/bridge-mesh.test.ts`; modify `src/world/details-data.ts`, `src/world/Details.tsx`, `src/world/WorldMap.tsx`, `src/world/style.ts`, and `src/world/structures.ts`.

**Interface:** Export `buildBridgeMesh(surface: BridgeSurface): BridgeMeshData`. Add `bridges: BridgeMeshData[]` to `WorldDetails` and its empty value. `BridgeMeshes` receives these buffers; optional posts/piers remain `StructurePart` instances. Keep bridge IDs with publication metadata so fallback ownership can be updated atomically.

- [ ] Add tests for vertex continuity, triangle winding/normals, nonzero triangle area, deck thickness and curved/acute junctions. For each adjacent pair of cross-sections, the top strip is:

  ```text
  vertices: left[i], right[i], left[i+1], right[i+1]
  triangles: (left[i], left[i+1], right[i]),
             (right[i], left[i+1], right[i+1])
  ```

  Verify orientation against the chosen X/Y/Z convention and reverse indices if needed; share vertices at internal seams instead of overlapping capped boxes.
- [ ] Run `pnpm exec vitest run tests/bridge-mesh.test.ts` to confirm failure, then build indexed top/side/underside strips. Define top Y separately from thickness. Use shared junction patches, bevel acute corners and reject self-intersecting offsets rather than creating crossing triangles.
- [ ] Match the terminal left/right vertices to the Z3 ground road footprint. Add a short terrain-following tie-in patch with the same sampled edge heights; render with a controlled depth bias and mask the replaced ground interval. Tune this against the actual MapLibre terrain mesh in the browser, since DEM samples alone cannot prove pixel-perfect draping.
- [ ] Render via R3F `BufferGeometry` and shared materials in the existing `Canvas`. Dispose replaced buffers, invalidate demand rendering after changes, and retain one coherent model until its complete replacement is ready.
- [ ] Mask original `bridges`, `bridge-edges`, approach road surfaces, casing and centerlines only for successfully published replacement intervals, using Z3 fallback source ownership. Remove the old box bridge generation for those intervals. Avoid a flat duplicate bridge shadow on water below the deck.
- [ ] Run targeted tests, `pnpm test` and `pnpm build`. Inspect terrain-off and terrain-on tie-ins before committing; any visible seam requires correction rather than merely increasing ramp length.

## B4: Derive safe railing boundaries and supports

**Files:** Create `src/world/bridge-boundaries.ts`, `tests/bridge-boundaries.test.ts`; modify `src/world/bridge-mesh.ts`, `src/world/structures.ts`, `src/world/details-data.ts`.

**Interfaces:** Export `exposedBridgeEdges(surfaces: readonly BridgeSurface[]): [Vec3, Vec3][]` and `bridgeAccessories(edges: readonly [Vec3, Vec3][], surfaces: readonly BridgeSurface[], cap: number): StructurePart[]`. Import `StructurePart` as a type. If sloped rails use mesh strips, keep them in `BridgeMeshData`; do not force them into yaw-only instances.

- [ ] Add fixtures for a diagonal bridge, sharp bend, T/Y entrance, bridge-to-bridge junction, terminal approach and crossing road underneath. Assert edge offset dot centerline tangent is zero within numerical tolerance, and no barrier triangle/post intersects a connected traversable corridor at the same elevation.
- [ ] Run `pnpm exec vitest run tests/bridge-boundaries.test.ts` and establish failure. Derive candidate edges from the joined surface boundary, remove shared internal edges and subtract opening intervals including half the connected road width plus a 0.5 m shoulder allowance.
- [ ] Never add a cross-road end cap as a railing. Clip side barriers around same-level junction mouths. At different levels, use vertical clearance when testing intersections so an underpass does not incorrectly remove an upper bridge's edge railing.
- [ ] Use the correct perpendicular in local X/Z (`[-dz, dx] / length`). Build top rails as sloped mesh strips along exposed edges; space vertical posts at stable 8 m arc-length intervals, carrying phase through bends and tile joins. Endpoint posts must not occupy an opening.
- [ ] Place optional piers below the deck underside, with terrain samples at each support location. Exclude piers from lower road/path footprints plus 0.5 m clearance. Omit supports when ground is unknown or height is negligible. Do not claim engineered span design; avoid blocking navigable-looking water channels by default when no placement evidence is available.
- [ ] Allocate complete mandatory deck/ramp meshes first. Initial bridge mesh ceilings are Eco 10k, Balanced 25k, High 50k triangles, with 8 MiB total generated bridge buffers. Allocate optional supports/posts deterministically within 500 instances, checking before every insertion. Drop optional details before falling back an entire component; never publish half a bridge.
- [ ] Add saturation tests for 499/500/501 requested accessories and many small bridges, shuffled input and two adjacent components. Assert actual counts never exceed caps and each published bridge has both tie-ins and unobstructed openings.
- [ ] Run targeted tests, `pnpm test` and `pnpm build`; record and commit boundary/accessory generation.

## B5: Verify connectivity and publish measured evidence

**Files:** Create `tests/browser/bridges.mjs`; update `tests/browser/world.mjs`, this document, and the shared work log. Preserve the historical bridge resolution notes; append a successor link only when the new implementation actually lands.

- [ ] Use deterministic local fixtures for straight, curved, diagonal, short, unequal-height, T/Y, stacked and tile-split bridges, plus missing-data and budget-saturation cases. Intercept vector/DEM fixtures for repeatability; keep live-tile integration separate.
- [ ] Walk sampled positions across each route from originating road through ramp and deck to the destination road. Assert continuous surface height/width, endpoint error below 0.02 m and no railing/post corridor intersection. Repeat terrain off/on and exaggeration 1/1.2/2, with all quality tiers.
- [ ] Run `pnpm test`, `pnpm build`, `pnpm test:browser`, `node tests/browser/bridges.mjs` and the zoom stability script against `pnpm dev`. Install Chromium if absent. Existing browser tests require internet; deterministic geometry unit tests must remain offline.
- [ ] Capture both ends, top and side views of verified live bridges near Stockholm, Amsterdam and San Francisco, locating the actual bridge features before selecting the final camera coordinates. Save config, source identity, completeness/fallback counts and screenshots to `.artifacts/bridges/`. Suggested cities are test search areas, not claims that their presets frame every case.
- [ ] Check continuous zoom over 13.5, tile boundaries, orbit, source reload and roads/bridges toggles. Confirm no stale elevated mesh appears after terrain is disabled and no crossing barrier survives a source update.
- [ ] Compare frame time, collection time, mesh/instance counts and memory against the same baseline. Investigate median frame-time regression above 10%, budget overflow or memory growth after five travel/return cycles. Record limitations and a focused verification commit.

## Completion criteria

A bridge component passes only when its published surface connects to verified originating and destination roads, all same-level branches have openings, no railing or support obstructs a travel corridor, and geometry remains continuous during view changes. The report must list both passing reconstructions and fallback/unresolved components. Missing topology is a source limitation to resolve, not permission to describe disconnected geometry as finished.
