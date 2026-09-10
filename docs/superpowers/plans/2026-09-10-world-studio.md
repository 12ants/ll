# Terrene implementation plan

**Goal:** A working customizable geographic 3D world studio.
**Architecture:** MapLibre owns streamed physical surfaces and the camera. R3F shares the depth buffer and draws bounded instanced natural and amenity details. Zustand connects the DOM inspector to declarative world configuration.
**Tech Stack:** React 19, TypeScript, Vite, MapLibre 5, R3F 9, Drei, react-three-map, r3f-perf, Zustand.
**Spec:** docs/superpowers/specs/2026-09-10-world-studio-design.md

## Constraints
No world labels, borders, tunnels, ferry routes or nonphysical symbols. Geographic data and attribution stay accurate; decorative additions are documented. Demand rendering and hard geometry budgets are defaults. Imports must validate finite ranges and enums.

## Tasks
- [ ] Geography/configuration: create src/world/config.ts, style.ts, geography.ts and tests/world.test.ts. Test malformed imports, filter tunnel/ferry exclusions, seeded scatter boundedness and polygon holes; implement; run npm test.
- [ ] Rendering: create src/world/WorldMap.tsx and Details.tsx. Stream terrain and vector layers; anchor R3F objects in meters; cap object count; render on demand; handle data errors. Validate with npm run build and a live browser.
- [ ] Editor: create src/components/Inspector.tsx, src/App.tsx and src/styles.css. Bind all displayed controls to world/camera state; add presets, coordinate navigation, save/import/export, screenshot, orbit, focus and keyboard actions. Inspect desktop/mobile in browser.
- [ ] Verification/documentation: test real rendered data, terrain, options, import recovery and screenshots; record commands/results and architecture limitations in README.md. Run npm test and npm run build.
