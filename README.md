# Terrene · World Studio

A customizable 3D geographic world editor built with React Three Fiber and MapLibre GL JS. Warm, subdued materials, actual building footprints, physical road surfaces and global elevation — with no world labels, administrative boundaries, transit symbols, underground roads or ferry route lines.

## Run

Requires Node.js 22.12+ (developed with Node 26).

```bash
npm install
npm run dev
```

Open http://localhost:5173. No API key is required for the default data sources. Internet access and WebGL2 are required.

```bash
npm test          # geography, configuration and style checks
npm run build    # strict TypeScript check and production bundle
npm run preview  # serve the built application
```

## Editor

- **Locations:** Central Park, Chamonix, San Francisco and Amsterdam, or enter latitude and longitude for any location.
- **Architecture:** building visibility, facade/roof details, height scale, subtle height variation and three material palettes.
- **Landscape:** vegetation, density, park surfaces, water color, real terrain and elevation exaggeration.
- **Infrastructure:** surface roads and paths, bridges with approximate physical decks and supports, park benches and bins.
- **Atmosphere:** sun direction, intensity and warm afternoon lighting.
- **Rendering:** Eco, Balanced and High budgets, plus a lazy-loaded `r3f-perf` monitor.
- **Save world:** stores the current configuration and camera in this browser. Export/import JSON to move a world between devices. Invalid imports leave the current world intact.
- **Camera:** drag to pan, right-drag / Ctrl-drag to orbit and tilt, scroll to zoom. `O` toggles automatic orbit, `H` toggles focus mode, `P` exports an image, `Esc` exits focus and stops orbit.
- **Image capture:** exports the geographic canvas as PNG. Keep source attribution with images that you publish; the application keeps attribution in the DOM instead of placing text inside the world.

## Rendering architecture

`src/world/WorldMap.tsx` owns the MapLibre camera, streamed vector tiles, elevation and map lifecycle. A custom style in `style.ts` draws only allowed physical surfaces. Building heights come from `render_height`, with a 9 m fallback when absent. Variation is deterministic and bounded; it does not change on every frame.

`react-three-map` integrates R3F into **the same canvas and depth buffer**, so buildings can occlude vegetation and props. `Details.tsx` renders batched instances for tree canopies, trunks, benches, bins, windows, rooftop equipment and bridge segments. `details-data.ts` collects visible geography after tile loading and camera movement; placements avoid polygon holes, water, building footprints and road corridors. The world origin follows the camera for local meter coordinates.

`config.ts` defines the public `WorldConfig`, presets, quality budgets, validation and Zustand store. React owns editor state; no animation runs through React state every frame. `Inspector.tsx` renders the settings as accessible DOM controls.

Ready-made modules in use:

- **@react-three/fiber:** declarative scene graph and GPU resource lifecycle.
- **@react-three/drei:** `useDetectGPU` device classification, available to the map status interface for application extensions.
- **react-three-map:** geographic coordinates, camera synchronization and shared rendering context.
- **react-map-gl:** declarative React wrapper around MapLibre.
- **r3f-perf:** optional runtime profiling, imported only when opened.
- **Zustand:** small configuration store, independent of camera animation.

The profiler's older Drei dependency is overridden to the app's Drei 10 version. React is pinned to the 19.2 minor series to match R3F's supported peer range. MapLibre 6's worker is bundled explicitly with Vite `?worker&url`; do not replace this with a plain `?url` asset import, which loses the worker's shared module in a production build.

## Performance budgets

| Setting | Eco | Balanced | High |
| --- | ---: | ---: | ---: |
| Maximum pixel ratio | 1 | 1.5 | 2 |
| Maximum trees, before density multiplier | 500 | 1,800 | 3,600 |
| Vegetation radius | 850 m | 1,250 m | 1,800 m |
| Facade / rooftop parts | 500 | 2,600 | 6,000 |
| Tile cache target | 80 | 140 | 220 |

Vegetation begins at zoom 13.5 and facade detail at zoom 15. Props use shared geometries/materials and bounded instanced draw calls. Bridge parts and candidate-scatter attempts have independent hard limits. Detail generation is debounced by 250 ms and does not run during camera movement. Changing density adjusts the tree cap; visible counts depend on actual park coverage.

The default frame loop renders on demand. Automatic orbit and the performance monitor intentionally enable continuous rendering. Terrain adds DEM decoding and surface tessellation cost. Turn it off or choose Eco on slower devices. The profiler measures R3F work and does not represent MapLibre's entire rendering cost. No fixed FPS guarantee is made.

The map and Three.js engine chunks are comparatively large because both are complete rendering engines. They are separated for caching; the profiler is a separate lazy chunk.

## Geographic data and source customization

Defaults:

- [OpenFreeMap](https://openfreemap.org/quick_start/), with OpenMapTiles schema and OpenStreetMap contributors: vector tiles and real geography.
- [Mapterhorn](https://mapterhorn.com/attribution): global Terrarium elevation data.

Optional `.env.local` overrides:

```dotenv
VITE_VECTOR_TILEJSON=https://your-host.example/planet
VITE_DEM_TILEJSON=https://your-host.example/terrain/tilejson.json
```

The vector endpoint must expose the **OpenMapTiles schema**, including `building`, `transportation`, `landcover`, `landuse`, `park`, `water` and `waterway`. The DEM must be **Terrarium-encoded**, 512 px tiles, with an appropriate maximum zoom (the default configuration uses 12). To use a different schema/DEM encoding or add a source, edit `src/world/style.ts`. Providers must support CORS and have licenses appropriate for your application. TileJSON attribution is displayed by MapLibre; adjust DEM attribution if replacing that source.

## Scope and limitations

This is geographic visualization and an extensible world-rendering project, not photogrammetry or a game simulation. Buildings use real footprints and available source heights; facades, rooftop equipment, trees and park amenities are procedural decoration, not surveyed object positions. Facade details prioritize nearby buildings and have a strict geometry budget. Building color and small height variations are seeded from available feature data. OSM coverage and height accuracy vary by location.

Bridge decks, rails and piers are approximate geometry generated from mapped centerlines; source tiles do not include full engineering dimensions. There are no suspension cables or collision meshes. Roads follow the map surface. Terrain uses a global DEM, so terrain/building alignment is limited by its resolution. No physics, vehicles, interiors, dynamic water simulation, photoreal shadows or mesh-world export are included. JSON export saves settings and camera, not downloaded tiles or 3D geometry.

Public tile services require connectivity; loading/data errors provide a retry action. WebGL2 requires browser hardware support. Focus mode removes editor chrome but retains the required attribution control.

## References

- [R3F introduction](https://r3f.docs.pmnd.rs/getting-started/introduction)
- [R3F performance guidance](https://r3f.docs.pmnd.rs/advanced/scaling-performance)
- [React Three Map API](https://github.com/RodrigoHamuy/react-three-map)
- [MapLibre installation and worker setup](https://maplibre.org/maplibre-gl-js/docs/)
- [MapLibre terrain example](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/)
