# World Depth Plan — making the scene feel inhabited

Goal: more depth and life in the rendered world, while keeping it smooth.
This plan is ordered by *visual return per millisecond*, and every item is
grounded in what the code does today rather than in generic advice.

## The honest constraint: collection cost is already the bottleneck

Measured this session, timing the real `collectDetails` in the browser
against the committed fixtures:

| view | published bridges | collection |
| --- | --- | --- |
| Gamla Stan z15 | 11 | ~4.8 s |
| Amsterdam z15 | 64 | ~19 s |
| Amsterdam z14 | 250 | ~131 s |

`collectDetails` runs on the main thread, debounced 250 ms after tile load
or camera stop (`details-data.ts`). At Amsterdam z14 it is a multi-second —
in the worst case multi-minute — stall. **Adding detail before addressing
this will make the app feel worse, not richer.** So item 1 is not a feature.

## 1. Make collection affordable (prerequisite)

Three independent strands, in order of expected payoff:

**a. Profile it properly.** One hoist has already been tried and did not
move the number (a per-call `Map` rebuild in `walkApproachChain`, now
cached). That failure is informative: the cost is elsewhere. Instrument
`collectDetails` into phases — `queryRenderedFeatures`, `buildRoadGraph`,
`solveBridges`, scatter, facades — and publish the split before optimising
anything further.

**b. Budget by time, not only by count.** Every budget today is a count cap
(trees, facade panes, bridge triangles). None of them bound *duration*. A
time-sliced collector that yields after a few milliseconds and resumes on
the next frame would turn a 131 s stall into progressive fill-in, which
also looks better than a freeze followed by a pop.

**c. Move it off the main thread.** The geometry stages are pure functions
over plain data (`bridge-profile`, `bridge-mesh`, `geography`), which is the
hard prerequisite for a worker and is already satisfied. The map-touching
parts (`queryRenderedFeatures`, `queryTerrainElevation`) are not, so the
split would be: gather on the main thread, solve in a worker, publish
buffers back.

## 2. Shadows from buildings

The single largest readability win, and it has its own plan:
`LIGHTING_AND_SHADOW_PLAN.md`. Buildings are MapLibre `fill-extrusion`
(`style.ts:252`) and therefore absent from the three.js shadow pass — so
today nothing in the city casts a shadow on anything else.

## 3. Facades everywhere instead of on the nearest 200 buildings

See `FACADE_TEXTURE_OPTIMIZATION_PLAN.md`. Windows are currently individual
boxes against a hard cap (500/2,600/6,000), so most of the city has bare
walls. Moving to texture removes the scarcity that currently shapes the
look.

## 4. Ground-level life

Ranked by cost:

- **Street furniture density and variety.** Benches and bins exist
  (`Details.tsx:219-221`). Lamp posts along road centrelines would read
  strongly at dusk and reuse the existing instanced-box path and the road
  graph that `road-topology.ts` already builds.
- **Road markings on ordinary roads.** Bridges now carry a dashed centreline
  and edge lines (`bridge-mesh.ts`, `buildMarkingMesh`). The same generator
  could run along `roadFootprint` for surface roads, which would do more for
  "this is a place with traffic" than any amount of prop scatter.
- **Vegetation variety.** Trees are one canopy plus one trunk instance
  (`Details.tsx:217-218`). Two or three canopy silhouettes with per-instance
  scale jitter would break the repetition at almost no cost.
- **Parked vehicles** along road edges, instanced, tied to road class. High
  life-likeness per triangle; needs a rule to avoid placing them on bridges
  and junctions.

## 5. Material depth

Everything currently uses `meshStandardMaterial` with a flat colour and
roughness (e.g. `BridgeMeshes.tsx:30`). Cheap improvements:

- **Roughness/colour variation per instance** so a row of identical boxes
  stops reading as a row of identical boxes.
- **A subtle normal or roughness map** on large flat surfaces (road decks,
  water, plazas) to catch the sun at grazing angles.
- **Water treatment.** Water is a flat fill today. Even a slow-scrolling
  normal map would add more perceived depth than most geometry work.

## 6. Atmosphere

- **Distance fog** keyed to the existing `daylight(config.hour)` palette
  gives depth cheaply and hides the LOD transition where detail stops.
- **Sun elevation that actually goes low.** `Details.tsx:180-187` walks a
  semicircle; genuinely low sun angles produce long shadows, which is the
  strongest single cue that a scene is three-dimensional — but only once
  item 2 makes shadows exist.

## Sequencing

1. **Item 1** — profile and time-budget collection. Nothing else is safe
   until a dense view is not a stall.
2. **Item 2** — building shadows. Largest visual return once affordable.
3. **Item 3** — facade texturing, which *reduces* cost while increasing
   coverage, so it pays for later items.
4. **Items 4–6** — incremental, each independently shippable and each
   guarded by the existing quality tiers.

## Measurement discipline

Every item above should be accepted the same way the bridge work was: a
measured before/after at a fixed camera, quoted inline in
`IDEAS_WORK_LOG.md`, not a screenshot alone. The harnesses already exist —
`tests/browser/bridge-matrix.mjs` for camera sweeps, and the collection
timing probe pattern used for the numbers at the top of this document.
Note that `.artifacts/` is gitignored, so numbers must be written into the
log rather than pointed at.
