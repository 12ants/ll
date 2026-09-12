# Zoom Stability Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Track completion in [IDEAS_TODO.md](IDEAS_TODO.md) and evidence in [IDEAS_WORK_LOG.md](IDEAS_WORK_LOG.md).

**Goal:** Keep road, bridge and decoration dimensions and identity fixed in world space as the camera zooms.

**Architecture:** Resolve physical dimensions once from normalized feature data, render nearby transportation as meter-based surfaces, and retain stable feature geometry across tile updates. Camera zoom changes projection and optional detail visibility; it does not generate new widths, colors or structural heights.

**Tech stack:** Existing MapLibre GL JS, Three.js/R3F, TypeScript, Vitest and Playwright.

**Spec:** Second request in [ideas.md](ideas.md). The bridge plan consumes the dimensions and feature identity defined here.

## Constraints and scope

- A road occupies more pixels when zoomed in; this is normal perspective. Success means its width in meters, alignment with buildings and approaches, material and geometry remain stable.
- Preserve quality DPR/tree/radius/cache limits, event-driven collection, terrain opt-in and the single WebGL context. Do not use zoom to alter physical widths, facade spacing, post spacing, clearance or object seeds.
- Preserve public TileJSON sources and environment overrides. Do not require a new API key or fetch whole cities on each camera move.
- Keep dependencies unchanged. Resolve the React version discrepancy recorded in [FACADE_COVERAGE_PLAN.md](FACADE_COVERAGE_PLAN.md) before any dependency work.
- The physical inspection range is zoom 13–19. Below it, retain a cartographic overview; document this distinction and make its handoff align in dimensions. Do not claim small roads absent from low-zoom source tiles can be recovered by styling.

## Current causes

`src/world/style.ts` sets road width with zoom stops at 5/12/16/19 and adds fixed pixel casing offsets of 2 or 3. Centerline width has a separate zoom expression; streams also use one. Meanwhile, `collectBridgeParts()` creates decks 3/8/14 meters wide, using a different class grouping than roads and the tree exclusion code in `details-data.ts`. These surfaces cannot consistently meet.

Bridge geometry switches on at 13.5, facade geometry at 15, and rendered feature queries return a changing set of tile geometries. Raw coordinate strings seed facade appearance and deduplicate bridge segments. Nearby detail can be redistributed when the pool changes. Camera-relative `localMeters()` also uses the origin latitude in its scale, so a camera rebase must not be treated as a reason to recompute intrinsic dimensions.

The [MapLibre style specification](https://maplibre.org/maplibre-style-spec/layers/#line-width) defines line width in pixels. Simply deleting zoom stops would make roads fixed-width on screen and increasingly narrow in world space.

## Approach and alternatives

Recommended: shared dimensions plus actual geographic road ribbons in the physical view. MapLibre fill polygons can represent ground road footprints and drape with terrain; use Three geometry for elevated surfaces. Construct both from the same centerline and width. This avoids depending on a screen-space line's perspective behavior to match a 3D deck.

A meters-to-pixels line expression is a smaller interim correction for overview styling, but latitude and pitched-view agreement need testing. Keeping existing expressions and freezing only the bridge width leaves the main mismatch unresolved.

## Z1: Establish one dimension and appearance policy

**Files:** Create `src/world/road-model.ts`, `tests/road-model.test.ts`; modify `src/world/structures.ts`, `src/world/details-data.ts`, `src/world/style.ts`, and `tests/world.test.ts`.

**Interface:** Export `RoadDimensions = { width: number; deckThickness: number; markingWidth: number; shoulderWidth: number }` and `roadDimensions(properties: Record<string, unknown>): RoadDimensions`. Export `roadColor(properties: Record<string, unknown>, palette: WorldConfig["palette"]): string` for both surface renderers. Neither function accepts zoom or camera position.

- [ ] Add expected fallback widths: path/track 3 m, motorway/trunk/primary 14 m, other supported classes 8 m. These preserve the present deck policy while explicitly resolving today's secondary-road mismatch. Test finite positive metric width when supplied by an alternate source, malformed/negative values and unknown classes.
- [ ] Run `pnpm exec vitest run tests/road-model.test.ts` and confirm failure. Implement defaults and strict parsing; accept only finite numeric values or metric strings, range 1–40 m. Reject unknown units. If width is absent, use positive integer lanes × 3.25 m, clamped to the same range, then class fallback. Do not assume default tiles supply width or lanes: the upstream [transportation schema](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.yaml) is a schema reference, not proof of fields in the configured provider.
- [ ] Fix structural dimensions at 0.5/1.1/0.8 m deck thickness for paths/major/other, 0.15 m markings and 0.5 m shoulders on motor roads (0 on paths). Use the same surface-color policy and palette in 2D roads and 3D decks.
- [ ] Replace duplicate class-width logic. Tree exclusion uses half the full carriageway width plus a named vegetation setback, initially 2 m; explicitly distinguish radius from full width.
- [ ] Use this regression shape to lock out camera coupling:

  ```ts
  const properties = { class: "primary", width: "12" };
  expect(roadDimensions(properties).width).toBe(12);
  expect(roadDimensions({ class: "path" }).width).toBe(3);
  expect(roadDimensions({ class: "primary", width: -1 }).width).toBe(14);
  ```

- [ ] Run targeted tests, `pnpm test` and `pnpm build`; record and commit the shared policy.

## Z2: Preserve feature identity and geometry across camera updates

**Files:** Create `src/world/feature-cache.ts`, `tests/feature-cache.test.ts`; modify `src/world/details-data.ts`, `src/world/WorldMap.tsx`, `src/world/structures.ts`.

**Interfaces:** Export `WorldFeature = { key: string; source: string; sourceLayer: string; feature: Feature; revision: number; completeness: "fragment" | "complete" }` and `reconcileFeatures(previous: readonly WorldFeature[], incoming: readonly WorldFeature[]): WorldFeature[]`. `Feature` is the GeoJSON type. A revision describes a source-data update, never a zoom value. Input adapters must supply source metadata and must default to `fragment` unless completeness is established.

- [ ] Add fixtures with reversed lines, rotated polygon rings, duplicate world wraps, split road segments, shuffled results, repeated source IDs in different layers and two anonymous parallel roads. Verify reordering/rebasing never changes identity and coarse fragments do not overwrite a more complete resident geometry.
- [ ] Run `pnpm exec vitest run tests/feature-cache.test.ts` and confirm failure. Normalize coordinates for identity independently of camera origin. Prefer IDs scoped by source/layer; preserve multiple fragments under the same ID and deduplicate identical fragments. Only stitch compatible endpoints/overlaps; never concatenate by query order or name alone.
- [ ] Query transportation source features for topology even if roads are hidden; retain rendered queries for visibility. MapLibre queries cover loaded tiles and can return split or duplicate geometries, so switching to `querySourceFeatures` alone does not load missing neighbors or create a complete network. See the [Map query API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#querysourcefeatures).
- [ ] Bound the cache initially to 10,000 feature records or 16 MiB of estimated geometry/property storage, whichever comes first, within the visible area plus a 250 m margin. Evict offscreen least-recently-used records first. At capacity, retain coherent visible snapshots and expose incomplete coverage in development metrics; do not silently splice partial replacements.
- [ ] Rebase cached world coordinates only when producing render buffers. Derive length, width and random seeds from canonical coordinates in a fixed local frame for each feature group. Test panning north/south with unchanged feature geometry.
- [ ] Version pending collections by source/config generation. Ignore stale results after terrain/source/config changes, and clean up listeners/timers on unmount. Update on source data or movement completion, retaining the existing 250 ms debounce and orbit policy.
- [ ] Run targeted tests, `pnpm test` and `pnpm build`; commit with a log entry explaining no-ID matching limitations. Cross-session identity for anonymous features is best effort; stronger guarantees require a source adapter with stable IDs and complete geometry.

## Z3: Render consistent physical ground surfaces and handoff

**Files:** Create `src/world/road-surfaces.ts`, `tests/road-surfaces.test.ts`; modify `src/world/style.ts`, `src/world/WorldMap.tsx`, `src/world/details-data.ts`; create `tests/browser/zoom-stability.mjs`.

**Interface:** Export `roadFootprint(line: Position[], width: number, origin: Position): Polygon | null`, using GeoJSON longitude/latitude input/output and a local meter frame internally. Reject fewer than two distinct positions. Bridge B3 will consume the same footprint boundary rules for approaches.

- [ ] Add a 100 m straight fixture, right-angle bend, acute bend, duplicate vertex, U-turn, latitude 0/60 degrees and shared-width bridge entrance. Assert perpendicular width within 1%, finite coordinates, no self-intersection, and identical output across zoom inputs supplied only to the harness.
- [ ] Run `pnpm exec vitest run tests/road-surfaces.test.ts` and confirm failure. Offset each segment by half-width using its unit normal; intersect neighboring offset lines and bevel joins whose miter exceeds twice the half-width. Split/reject self-intersecting offsets with an explicit fallback diagnostic. Use butt endpoints at connected junctions and construct a shared junction footprint; do not leave round caps protruding through entrances.
- [ ] Add a dedicated GeoJSON source and fill layers for physical ground roads, shoulders and meter-spaced markings. Keep query/source access to the original transportation data. Batch `setData()` only on geometry changes. Supply GeoJSON polygons in longitude/latitude, never camera-local meters.
- [ ] Ground fills follow MapLibre terrain; terrain-off geometry remains at zero. For the bridge approach tie-in, B2/B3 own elevated geometry and a local ground patch. Do not assume a single centerline terrain sample gives the road's cross-slope edge elevations.
- [ ] Draw original lines as overview/fallback only where replacement data is unavailable. Avoid duplicate surfaces by splitting out replaced intervals into a separate fallback source; a source-wide opacity toggle cannot handle partial replacement. Z2 keys identify replacement ownership.
- [ ] Make the handoff at zoom 13 with hysteresis (enter physical view at 13.1, leave below 12.9) and a 150 ms opacity transition only after replacement buffers are ready. At the transition, use a meter-derived overview width calibrated to latitude. Verify alignment at pitch 0/60/75; if a fade visibly changes width, extend footprint rendering downward rather than accepting a morph.
- [ ] Keep `zoom` out of physical geometry/material builders. Treat streams as a separate width policy using the same footprint builder if they show the same artifact; record their chosen class fallback widths before migration (initial stream width 2 m). Tree size, bench size and bridge rail spacing remain meter-based. Decorative LOD may remove distant detail but must not resize surviving objects.
- [ ] Budget new road geometry explicitly: initial resident ceilings Eco 40k, Balanced 100k, High 200k triangles and 16 MiB for generated buffers. Simplify bends with a maximum lateral error of 0.1 m before dropping coverage. Use coherent fallback when limits are reached; never change width to fit a budget.
- [ ] Run targeted tests, `pnpm test`, `pnpm build` and `node tests/browser/zoom-stability.mjs` against `pnpm dev`. Record and commit the renderer handoff.

## Acceptance and browser protocol

Use deterministic local GeoJSON fixtures for measurements, then live Stockholm, Amsterdam and San Francisco scenes for integration. Record coordinates/config, viewport, DPR, versions, terrain readiness and hardware with captures in `.artifacts/zoom-stability/`.

Sweep zoom 12.8, 12.99, 13, 13.1, 13.49, 13.5, 14.99, 15, 16, 17, 18 and 19, in both directions at fixed center. Repeat at bearings 0/90/180/270, pitch 0/60/75, DPR 1/2 and terrain off/on. Include high latitude, a tile boundary and a pan-and-return sequence. Wait for source readiness and completed detail collection, while also recording a continuous zoom transition to catch transient jumps.

Assert width/top height/spacing equality in the world model, no identity/color change for retained features, less than 1% measured width drift, and no discontinuity above one device pixel at settled renderer handoffs. Pixel sizes themselves should grow with zoom. Test true data revisions separately from camera movement. Compare collection time, frame time, draw calls and memory to the same baseline; investigate median frame-time regression above 10% and any memory growth after five round trips.

Run `pnpm test:browser` for existing integration coverage. Its exact instance-count assertion currently assumes the old structure groups; update it to assert amenities semantically when new geometry groups are introduced, preserving the zero-tree-density behavior check.
