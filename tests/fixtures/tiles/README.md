# Committed map tile fixtures

Vector tiles captured from [OpenFreeMap](https://openfreemap.org)'s public
`planet` source, so the browser suite runs offline, fast and deterministically
instead of against live tiles whose content drifts between runs.

Served by `tests/browser/tile-server.mjs`; the app is pointed at it through its
own `VITE_VECTOR_TILEJSON` / `VITE_DEM_TILEJSON` overrides — see
`pnpm dev:offline`. No application code knows these exist.

## What is here

| Path | Contents |
| --- | --- |
| `planet.tilejson.json` | OpenFreeMap's TileJSON, verbatim. The server rewrites its `tiles` array to point at itself; the file keeps the upstream URLs so a re-capture never bakes in a localhost address. |
| `planet/{z}/{x}/{y}.pbf` | z11–z14, ~20 MB. Exactly the tiles `tests/browser/bridges.mjs` requests for Stockholm, Manhattan and Amsterdam. |
| `dem.tilejson.json` | Mapterhorn's TileJSON, metadata only. MapLibre loads a source's TileJSON even when terrain is off, so this is needed for the suite to run offline; no DEM *tile* is requested at `terrain: false`. |

OpenFreeMap's `planet` source has maxzoom 14 — z15+ cameras are overzoomed from
z14, which is why there are no deeper directories. World-overview levels (z10
and below) are deliberately **not** committed: MapLibre requests them
opportunistically, no assertion depends on them, and a single level costs more
than 3 MB. The tile server answers those 404 silently, which MapLibre treats as
an empty tile exactly as upstream does.

## Re-capturing

Needed only when the suite's camera path changes and `tile-server.mjs` starts
reporting misses *inside* the covered zoom range (misses below it are expected
and stay silent):

```bash
node tests/browser/capture-tiles.mjs   # terminal 1 — records into this directory
pnpm dev:offline                       # terminal 2
node tests/browser/bridges.mjs         # terminal 3
```

Then commit whatever appeared here.

## Coverage, measured

`tests/browser/bridges.mjs` passes all 9 checks offline against this set.
`tests/browser/world.mjs` passes its first 7 and then fails at the Chamonix
step: that check asserts a real elevation above 500 m, and no DEM tiles are
committed. Terrain-on presets (San Francisco, Chamonix) therefore still need
live tiles. Extending the fixture to terrain would mean committing DEM tiles
and the vector tiles for one terrain-on city.

The z10-and-below exclusion relies on MapLibre answering a 404 tile as empty
without raising a page error — which is what the browser suites collect
(`pageerror`). If a future check also asserts on *console* messages, those
silent 404s would start showing up there.

## Attribution and licence

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, ODbL 1.0. Tiles by OpenFreeMap. These files are redistributed
here solely as test fixtures; the app itself renders the same attribution at
runtime (`src/world/style.ts`).
