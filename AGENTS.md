# AGENTS.md — Terrene World Studio

## Commands

- `pnpm dev` — Vite dev server on `localhost:5173`, binds `0.0.0.0`.
- `pnpm test` — Vitest (`tests/**/*.test.ts`). Fast unit tests for config, geography, style.
- `pnpm build` — **Runs `tsc -b` first, then `vite build`.** A type error fails the build before bundling.
- `pnpm preview` — serve production bundle.
- `pnpm test:browser` — Playwright against the dev server. Install Chromium once with `pnpm exec playwright install chromium`. Needs `pnpm dev` in another terminal. Slow; uses real public tiles and software WebGL. Writes captures to `.artifacts/`.

## Architecture (what an agent will miss from filenames alone)

- **Single package, no monorepo.** All source is under `src/`, tests under `tests/`.
- **Two renderers share one canvas.** MapLibre GL JS draws the map; React Three Fiber draws 3D geometry in the *same* WebGL context via `react-three-map`. Occlusion works across both.
- **World origin is the camera.** `localMeters()` in `src/world/geography.ts` converts lng/lat to meters relative to the current camera center. Y is always `0` for ground-level geometry; terrain height is queried separately.
- **Detail collection is event-driven, not per-frame.** `src/world/details-data.ts` runs after tile load / camera stop, debounced 250 ms. It produces `WorldDetails` (trees, benches, bridge parts) consumed by `src/world/Details.tsx` instanced meshes.
- **Bridge geometry is approximate** (`src/world/structures.ts:154-284`). Decks, railings, and piers are generated from OSM bridge centerlines. Hard cap: 500 parts. Deck height is one flat value per line (sampled from both line endpoints, not per segment, so multi-vertex bridges don't staircase) plus a small class-based clearance (3-6m); piers interpolate ground along the line and are skipped if the resulting height is negligible. See `docs/BRIDGE_RENDERING_PLAN.md` for the full rationale, including why "always sample the DEM regardless of the terrain toggle" doesn't work with MapLibre's API.

## Key constraints and gotchas

- **TypeScript strict mode.** `tsconfig.json`: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`. Imports must use `type` keyword for type-only imports.
- **React pinned to `~19.2.0`.** R3F v9’s supported peer range requires this exact minor series. Do not upgrade React without checking R3F compatibility.
- **Drei override for `r3f-perf`.** `pnpm-workspace.yaml` `overrides` forces `r3f-perf` to use the project’s `@react-three/drei` v10. Do not remove this or the profiler chunk will pull an incompatible Drei version.
- **MapLibre 6 worker bundling.** In `vite.config.ts`, the worker is imported with `?worker&url`. Replacing it with plain `?url` drops the worker’s shared module and breaks production builds.
- **MapLibre style must pass spec validation.** `src/world/style.ts` is validated in tests via `@maplibre/maplibre-gl-style-spec`. Style edits must remain spec-compliant.
- **Terrain is opt-in.** Default is `terrain: false`. When off, the whole scene (buildings included) sits at `ground = 0`; bridges match this by design rather than sampling elevation, so deck Y is `0 + clearance` (3–6 m) — see `docs/BRIDGE_RENDERING_PLAN.md`.
- **`queryTerrainElevation` is only called when `terrain` is true.** Adding terrain sampling to bridge code requires guarding against the MapLibre method being unavailable or expensive when terrain is disabled.
- **Performance budgets are enforced in code, not just docs.** Quality tiers (Eco / Balanced / High) cap pixel ratio, tree count, facade parts, and scatter radius. Changes to detail generation must respect these caps.
- **No API key required.** Default tile sources (`OpenFreeMap` + `Mapterhorn`) are public. Override via `.env.local` with `VITE_VECTOR_TILEJSON` and `VITE_DEM_TILEJSON` if needed.
- **Browser tests require internet.** They load real vector tiles and DEM. They will fail or timeout offline.

## File ownership (avoid guessing entrypoints)

- `src/world/WorldMap.tsx` — MapLibre camera, tile lifecycle, terrain toggle, config dependencies.
- `src/world/Details.tsx` — R3F instanced meshes for all props.
- `src/world/details-data.ts` — geometry collection orchestration.
- `src/world/structures.ts` — bridge and building part generation.
- `src/world/style.ts` — MapLibre style spec, layer definitions, surface filters.
- `src/world/config.ts` — `WorldConfig` type, defaults, validation, Zustand store.
- `src/world/geography.ts` — coordinate math, road filtering, polygon scatter.
