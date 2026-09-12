# Facade Coverage Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Track completion in [IDEAS_TODO.md](IDEAS_TODO.md) and evidence in [IDEAS_WORK_LOG.md](IDEAS_WORK_LOG.md).

**Goal:** Decorate every rendered building wall when buildings and facades are enabled, while keeping detailed geometry within the existing quality budgets.

**Architecture:** Give the MapLibre building layer an inexpensive, repeating base facade treatment. Keep R3F geometry for nearby windows and architectural accents, allocating it across walls before adding density. Base coverage follows the same geometry and visibility as buildings, so it cannot disappear when the optional detail budget runs out.

**Tech stack:** Existing TypeScript, MapLibre GL JS, React Three Fiber, Three.js, Vitest and Playwright.

**Spec:** First request in [ideas.md](ideas.md). This document supplies the proposed design and implementation sequence; runtime changes have not been made.

## Constraints and meaning of coverage

- “Every wall” includes short walls, courtyard walls, all components of MultiPolygons, buildings beyond 750 m, and walls revealed by camera rotation. It applies whenever the `buildings` layer renders, currently from zoom 13.
- Coverage means a continuous architectural surface treatment. Individually modeled windows remain optional detail. At distant zooms the treatment can become subpixel; there must be no separate switch that leaves a visibly large wall bare.
- Preserve `buildings` and `facades` toggles, height scale, variation, palette, time of day, shared canvas and demand rendering.
- Preserve facade part ceilings: Eco 500, Balanced 2600, High 6000. Reserve roof props inside the same ceiling. Do not increase these limits to simulate universal coverage.
- Sample terrain only with `terrain: true`; missing elevations must not silently replace valid previous elevations. Terrain query results already include exaggeration.
- Keep dependencies unchanged. `AGENTS.md` says React `~19.2.0`, but the inspected manifest contains `~19.3.0`; record the discrepancy and verify compatibility before a later runtime change, without changing versions as part of this plan.

## Current causes

In `src/world/structures.ts`, `collectStructures()` exits below zoom 15, takes only the first outer ring of a Polygon or MultiPolygon, rejects buildings with centers beyond 750 m, and considers only the nearest 200 buildings. It skips walls shorter than 5 m. Within each building, earlier walls consume the shared per-building allocation before later walls run. Thus spreading a cap between buildings does not guarantee coverage between walls.

The outward offset points away from an averaged footprint center, rather than perpendicular to the wall. This can misplace windows on concave buildings. Geometry-string seeds can change when tiles split or simplify the footprint. Height calculations also differ from the style for zero or invalid properties. `WorldMap.tsx` refreshes facade geometry for many configuration changes but does not include `hour` in its collection dependencies, although pane lighting uses it.

## Approach and alternatives

Recommended: use a small repeating masonry/panel pattern on the existing extrusion as universal decoration, then correct the optional window geometry. A pattern is supported by the [MapLibre layer specification](https://maplibre.org/maplibre-style-spec/layers/#fill-extrusion-pattern). It also affects roofs and replaces the extrusion color, so encode the palette in the image and use a roof-compatible pattern rather than pictures of windows. This is a deliberate visual tradeoff.

Only redistributing window boxes cannot meet coverage when there are more walls than parts. Replacing every building with custom R3F extrusions would allow separate roof and wall shaders and precise window grids, but requires ownership of building geometry, clipping, terrain alignment and tile lifecycle. Keep that as a separately scoped alternative if the pattern prototype fails the acceptance checks; do not claim universal coverage from a capped overlay alone.

### 2026-09-11 — Pattern prototype (F1) built, prototyped, and rejected on the acceptance checks

**What was built:** `src/world/facade-pattern.ts` (`createFacadePattern`, `facadeImageId`), wired into `style.ts`'s `buildings` layer via `fill-extrusion-pattern` (no zoom expression), with image registration/`styleimagemissing` handling and paint-property clearing in `WorldMap.tsx`. Fully unit-tested (11 tests). See [IDEAS_WORK_LOG.md](IDEAS_WORK_LOG.md) for the full implementation record.

**Verified live** at Gamla Stan (zoom 13/14.99/15/16/19 × bearing 0/90/180/270, pitch 60, and a facades-on/off/on toggle pair at pitch 0) via `tests/browser/facades.mjs` and direct visual inspection of the captured screenshots in `.artifacts/facades/`. Two things worked: no missing-image blank frame at startup, and panel size scales with zoom the same way building geometry does (world-locked, not screen-locked — compare `gamla-stan-z16-b0.png` to `gamla-stan-z19-b0.png`: bricks grow roughly in step with the ~8× zoom-level scale change, not staying screen-fixed).

**Rejected on both of the plan's own named fail conditions**, confirmed by direct side-by-side comparison of `gamla-stan-facades-off.png` and `gamla-stan-facades-on-again.png` (identical camera position, only the toggle differs):

- **Roof treatment fails.** `fill-extrusion-pattern` paints the wall texture onto the roof cap as well — clearly visible on the domed building near the screenshot's top-center in `gamla-stan-facades-on-again.png`, and unmistakable in the close-up `gamla-stan-z19-b0.png`, where the foreground planes are rooftops carrying the same brick courses as walls. Real building roofs do not look like brick walls; this reads as a rendering defect, not decoration.
- **Per-building color variation is lost.** `gamla-stan-facades-off.png` shows the existing `fill-extrusion-color` interpolation (five palette tones cycling by `numericId % 5`) giving each building a distinct tone — a varied, legible mosaic. `gamla-stan-facades-on-again.png`, same camera, shows every building collapsed to one uniform tan brick texture. The plan flagged this as a "deliberate visual tradeoff," but seeing it at Gamla Stan's density, the loss reads as flattening, not decoration; the scene is worse, not just different.

**Not independently disqualifying, but recorded:** the 14.99→15 zoom pair (`gamla-stan-z14.99-b0.png` vs `gamla-stan-z15-b0.png`) showed a perceptible jump from an almost-flat-looking wall to a visibly speckled one, across a 0.01-zoom-unit (≈0.7% scale) step — too small a step for that much perceptual change to be expected from pure geometric scaling. This was not run down further once the roof/color findings already failed the gate; if the pattern approach is revisited, treat this as a lead (possible LOD/mip-level artifact in MapLibre's pattern rasterization) rather than dismiss it.

**Verdict: F1 as specified (MapLibre `fill-extrusion-pattern`) does not pass acceptance.** Per this document's own fallback clause: the next attempt at universal base coverage should use the custom R3F extrusion alternative (separate roof/wall treatment, precise window grids) rather than iterating further on the MapLibre pattern overlay — the roof/wall coupling that causes both failures here is intrinsic to `fill-extrusion-pattern`, not a parameter to tune. That is materially more work (owns building geometry, clipping, terrain alignment, tile lifecycle, as this document already notes) and should be scoped as its own task before F2/F3 proceed, since both build on "F1 decoration" being present and correct.

**What stays useful regardless of the rejected renderer choice:** `createFacadePattern`'s pure texture generation is unused now, but the surrounding wiring this session added is not wasted — `isNight()` (shared day/night boundary, now used by both pane lighting and pattern selection), the `config.palette`/`config.hour` dependency-array fixes in `WorldMap.tsx`'s collection effect, and the imperative style patcher's new "clear removed paint properties" behavior are all independently correct fixes worth keeping.

## F1: Prove and integrate base coverage

**Files:** Create `src/world/facade-pattern.ts`, `tests/facade-pattern.test.ts`, and `tests/browser/facades.mjs`; modify `src/world/style.ts`, `src/world/WorldMap.tsx`, and `tests/world.test.ts`.

**Interface:** Export `createFacadePattern(palette: WorldConfig["palette"], night: boolean): { width: number; height: number; data: Uint8Array }` from the new module, using a type-only import of `WorldConfig`. Use fixed image IDs `facade-<palette>-day` and `facade-<palette>-night`.

- [ ] Add a deterministic 64 × 64 RGBA pattern test before implementation. Assert the exact buffer length, opaque alpha, repeated output for a given input and distinct output for each palette. Use staggered panel joints and subtle vertical trim, without baking individual windows into roofs.
- [ ] Run `pnpm exec vitest run tests/facade-pattern.test.ts`; confirm failure comes from the missing implementation.
- [ ] Implement the tile generator with palette-colored panel interiors and darker joints. Its iteration contract is:

  ```ts
  const data = new Uint8Array(64 * 64 * 4);
  // For each x,y: choose panel/joint color, then write r,g,b,255.
  // Offset alternate horizontal courses by half a panel for seamless tiling.
  return { width: 64, height: 64, data };
  ```

- [ ] Register the six images with `map.addImage()` before applying the pattern property. Re-register missing images on style reload, handle `styleimagemissing`, and remove listeners on cleanup. Use `hasImage()` to avoid duplicate registrations. Initial loading must not produce a missing-image blank building frame: install the pattern only after images exist, and include this startup transition in captures.
- [ ] Extend the existing imperative style patcher to clear removed paint properties using `setPaintProperty(..., null)` when facades turn off. Merely omitting `fill-extrusion-pattern` from the next style will leave the old property active with today's patch loop.
- [ ] Select the image by palette and day/night, with no zoom expression; keep building visibility/minzoom unchanged. Verify pattern scale and phase at fractional and integer zooms using the installed renderer. The specification alone does not prove physically stable pattern mapping.
- [ ] Add style validation for facades on/off and every palette. Inspect Stockholm and a deterministic courtyard/MultiPolygon fixture at zoom 13, 14.99, 15, 16 and 19, from four bearings. Save captures to `.artifacts/facades/`.
- [ ] Run `pnpm exec vitest run tests/facade-pattern.test.ts tests/world.test.ts`, `pnpm build`, and `node tests/browser/facades.mjs` against `pnpm dev`. Record results and a focused commit. Do not pass F1 if pattern stretching, integer-zoom jumps or roof treatment makes the design unacceptable; record the evidence and revise the renderer choice in this document before F2.

## F2: Place optional windows correctly on every eligible wall

**Files:** Create `src/world/building-model.ts`, `tests/building-model.test.ts`; modify `src/world/structures.ts`, `src/world/style.ts`, and `tests/world.test.ts`.

**Interfaces:** Export `BuildingDimensions = { base: number; top: number }`, `buildingDimensions(properties: Record<string, unknown>, id: string | number | undefined, config: WorldConfig): BuildingDimensions`, and `buildingRings(geometry: Polygon | MultiPolygon): Position[][][]`. Import GeoJSON types explicitly. The style expression and the JS evaluator must implement the same finite-number fallback, minimum height, base clamp and variation rules; freeze those rules with paired fixtures before changing either implementation.

- [ ] Add fixtures for zero/missing/string IDs and heights, elevated bases, clockwise/counterclockwise rings, concavity, holes, separate MultiPolygon components and a 3 m wall. Include base greater than top as a no-exposed-wall case. Record existing style results as the height contract.
- [ ] Run `pnpm exec vitest run tests/building-model.test.ts tests/world.test.ts` and confirm the new cases fail for the intended reasons.
- [ ] Enumerate all rings and normalize winding in the local X/Z plane. For an edge `(dx,dz)`, use one of the perpendicular unit normals `(-dz,dx)/length` or its negative, chosen toward empty space: outside an exterior ring, inside a courtyard. Remove zero-length edges and avoid treating verified tile clipping seams as real walls.
- [ ] Use one consistent base/top pair for panes and roof props. Fit each pane within its wall and exposed vertical interval, shrinking or omitting an optional pane on tiny surfaces while retaining F1 decoration. Verify the wall-relative offset is perpendicular and 0.08 m, rather than toward the footprint centroid.
- [ ] Prefer stable source IDs scoped by source/layer for variation; normalize ring rotation and direction for the no-ID fallback. Do not merge distinct buildings solely because properties match. Treat fragment identity as provisional until the feature cache from Z2 can provide stronger identity.
- [ ] Run the targeted tests, `pnpm test` and `pnpm build`; record evidence and commit the placement change independently.

## F3: Allocate detail fairly and refresh appearance without reshuffling

**Files:** Create `src/world/facade-budget.ts`, `tests/facade-budget.test.ts`; modify `src/world/structures.ts`, `src/world/WorldMap.tsx`, `src/world/Details.tsx`, and `tests/browser/facades.mjs`.

**Interface:** Export `allocateFacadeParts(walls: readonly { id: string; capacity: number; priority: number }[], cap: number): Map<string, number>`. Stable wall IDs break priority ties. Roof props consume the remaining budget after windows.

- [ ] Add tests with four walls where the first can consume the whole cap, more walls than the cap, zero-capacity walls, shuffled inputs, and all three quality ceilings. The core assertion is:

  ```ts
  const walls = ["a", "b", "c", "d"].map(id => ({ id, capacity: 100, priority: 0 }));
  expect([...allocateFacadeParts(walls, 4).values()]).toEqual([1, 1, 1, 1]);
  ```

- [ ] Run `pnpm exec vitest run tests/facade-budget.test.ts` to establish failure. Allocate one part per eligible wall in stable priority order, then additional parts in rounds until capacities or the cap are reached. Do not promise one modeled window per wall if wall count exceeds the cap; F1 provides coverage in that case.
- [ ] Choose windows from a fixed meter-spaced candidate grid with stable cell IDs. A budget change selects a nested subset instead of recalculating floor/column spacing. Roof props never displace a wall's first allocated pane.
- [ ] Refresh day/night appearance on `hour` changes and palette appearance on `palette` changes. Prefer updating colors/materials without rebuilding positions; if collecting again, verify positions and instance order remain identical for an appearance-only change.
- [ ] Run targeted tests, `pnpm test`, `pnpm build`, and facade captures in all tiers. Confirm disabling facades clears both the base pattern and modeled facade details, and reenabling restores them. Record results and commit.

## Acceptance

- With facades enabled, every visible extrusion face receives the base treatment, including courtyard and MultiPolygon walls and buildings excluded by the optional detail radius or cap.
- Optional pane positions stay on their walls across bearing, zoom, palette and time changes; no panes float above short buildings or face inward on concavities.
- Pattern phase and physical feature sizes do not jump at integer zoom boundaries. Validate alongside [ZOOM_STABILITY_PLAN.md](ZOOM_STABILITY_PLAN.md).
- Part counts stay within 500/2600/6000, with no new perpetual render loop or unbounded image allocation. Compare collection time, frame time and memory with the same saved scene before and after; investigate a median frame-time regression above 10% on the same machine.
