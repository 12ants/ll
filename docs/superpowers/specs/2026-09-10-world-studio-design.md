# Terrene world studio

Build a browser world editor using React, TypeScript, Vite, MapLibre and React Three Fiber. The canvas occupies the screen; a warm ivory inspector and compact floating controls keep the real geography prominent. Natural realism is the default visual direction.

MapLibre streams OpenFreeMap/OpenMapTiles vector data. A purpose-built style contains only physical surfaces: landcover, parks, water, surface roads, paths, bridges, buildings. No symbols, borders, tunnel or ferry route layers. Buildings use real heights when available and deterministic fallback heights and color variation. Raster DEM from Mapterhorn provides optional terrain and hillshade. MapLibre renders building extrusions; R3F shares its canvas/depth via react-three-map and adds instanced vegetation and physical amenity details in loaded park areas. Scatter is deterministic, geographically anchored, bounded, and avoids polygon holes and obstacles. Vegetation is decorative, not a survey of actual trees.

Controls: place presets and coordinate navigation; building height/variation/materials; parks/trees/density; surface roads/bridges/amenities; elevation exaggeration; daylight; quality presets and pixel ratio; optional r3f-perf; orbit and camera controls; JSON import/export and browser persistence; screenshot export. Data attribution remains in DOM outside the game world.

Performance: demand rendering by default, bounded instances and geographic radius, capped pixel ratio and tile cache, debounced enrichment after map movement, opt-in continuous animation/profiling, lazy performance module. No per-frame React updates. Error and loading states explain failed data or WebGL context. Validate configuration at import/storage boundaries.

Validation: unit tests for forbidden-feature filters, stable variation, polygon holes and bounded scatter, config validation and style specification; TypeScript and production build; browser WebGL checks including controls, different locations, terrain, save/import, screenshots and responsive UI. External tiles require internet; no measured frame-rate promises or photogrammetry claims.
