# Rendering Ideas Todo List

Source: [ideas.md](ideas.md). Updated: 2026-09-11.

The requested planning deliverables are complete. The implementation checkboxes below remain open because this task requested plans, a todo list and a log.

## Planning deliverables

- [x] Inspect the current rendering, feature collection, configuration and tests.
- [x] Write [Facade Coverage Implementation Plan](FACADE_COVERAGE_PLAN.md).
- [x] Write [Zoom Stability Implementation Plan](ZOOM_STABILITY_PLAN.md).
- [x] Write [Connected Bridges Implementation Plan](BRIDGE_CONNECTIVITY_PLAN.md).
- [x] Create this execution tracker and [work log](IDEAS_WORK_LOG.md).
- [x] Check document links, task references, whitespace and alignment with the request.

## Suggested execution order

Complete Z1 and Z2 first because the road/bridge work shares dimensions and feature identity. Facade F1 can be implemented independently; F2/F3 should integrate stable identity from Z2. Finish Z3 before publishing the bridge renderer in B3. Each task contains its own validation steps; update this list only when its acceptance checks pass.

| ID | Deliverable | Depends on | Plan |
| --- | --- | --- | --- |
| Z1 | Shared physical dimensions and road appearance | — | [Zoom](ZOOM_STABILITY_PLAN.md#z1-establish-one-dimension-and-appearance-policy) |
| Z2 | Bounded, stable feature cache | Z1 | [Zoom](ZOOM_STABILITY_PLAN.md#z2-preserve-feature-identity-and-geometry-across-camera-updates) |
| F1 | Universal base facade treatment | — | [Facades](FACADE_COVERAGE_PLAN.md#f1-prove-and-integrate-base-coverage) |
| F2 | Correct ring, wall normal and height handling | F1, Z2 integration | [Facades](FACADE_COVERAGE_PLAN.md#f2-place-optional-windows-correctly-on-every-eligible-wall) |
| F3 | Fair, stable detail allocation and appearance refresh | F2 | [Facades](FACADE_COVERAGE_PLAN.md#f3-allocate-detail-fairly-and-refresh-appearance-without-reshuffling) |
| Z3 | Physical road surfaces and overview handoff | Z1, Z2 | [Zoom](ZOOM_STABILITY_PLAN.md#z3-render-consistent-physical-ground-surfaces-and-handoff) |
| B1 | Road graph and verified bridge connections | Z1, Z2 | [Bridges](BRIDGE_CONNECTIVITY_PLAN.md#b1-identify-complete-bridge-components-and-real-connections) |
| B2 | Continuous approach and bridge profiles | B1 | [Bridges](BRIDGE_CONNECTIVITY_PLAN.md#b2-solve-continuous-bridge-and-approach-heights) |
| B3 | Joined surface meshes and ground tie-ins | B2, Z3 | [Bridges](BRIDGE_CONNECTIVITY_PLAN.md#b3-render-joined-decks-ramps-and-ground-tie-ins) |
| B4 | Exposed-edge railings, supports and strict budgets | B3 | [Bridges](BRIDGE_CONNECTIVITY_PLAN.md#b4-derive-safe-railing-boundaries-and-supports) |
| B5 | Connectivity, visual and performance acceptance | F3, Z3, B4 | [Bridges](BRIDGE_CONNECTIVITY_PLAN.md#b5-verify-connectivity-and-publish-measured-evidence) |

## Implementation tracking

- [x] Z1 — Shared physical dimensions and road appearance.
- [ ] Z2 — Bounded, stable feature cache. Core module (`feature-cache.ts`: `featureKey`,
      `reconcileFeatures`, `boundCache`) landed and fully unit-tested, but it has **zero
      call sites** in `details-data.ts`/`structures.ts`/`WorldMap.tsx` — nothing in the
      live collection path is actually preserved yet. Do not treat this as done for B1/B2/B3's
      dependency purposes until it's wired in. See work log for the ruling.
- [ ] F1 — Universal base facade treatment, including prototype acceptance. **Prototyped
      and rejected**: the MapLibre `fill-extrusion-pattern` approach failed its own
      acceptance gate (roof treatment, per-building color loss — see
      [FACADE_COVERAGE_PLAN.md](FACADE_COVERAGE_PLAN.md#2026-09-11--pattern-prototype-f1-built-prototyped-and-rejected-on-the-acceptance-checks)
      and the work log). Live app wiring was reverted; only the tested, unwired
      `src/world/facade-pattern.ts` texture generator remains, reserved for a future
      custom R3F wall-only renderer. F2/F3 build on F1's decoration and cannot start
      until a working base-coverage renderer exists.
- [ ] F2 — Correct ring, wall normal and height handling.
- [ ] F3 — Fair, stable detail allocation and appearance refresh.
- [ ] Z3 — Physical road surfaces and overview handoff. Core geometry landed and
      unit-tested (`src/world/road-surfaces.ts`: `roadFootprint`), but — same pattern as
      Z2 — it has **zero call sites**: no GeoJSON source/layers, no hysteresis zoom
      handoff, no terrain-following, no triangle budget, nothing wired into
      `style.ts`/`WorldMap.tsx`/`details-data.ts`, and no browser verification. B3 lists
      "consumes the same footprint boundary rules for approaches" — that dependency is
      not satisfied until a renderer actually calls this. See work log for the measured
      reject-threshold finding a future renderer needs to know about.
- [ ] B1 — Road graph and verified bridge connections. Core landed
      (`src/world/bridge-model.ts`, `src/world/road-topology.ts`,
      `buildRoadGraph`) — 13/13 targeted tests, full suite 70/70, clean build.
      Zero call sites: `details-data.ts` is not wired to call it. Ruling: with
      no B2 solver and no B3 mesh consuming a graph yet, wiring it into the
      live collection pass would run a full graph rebuild every debounce tick
      for no visible output — deferred until B2 needs live input. See work
      log for two deviations from the plan text a future session must know
      about before building on this: the 250m/2000-edge approach traversal is
      NOT implemented (MAX_JOIN_ITERATIONS is a join-loop safety cap, not a
      distance-bounded query), and cluster layer/bridge compatibility checks
      only the first-seen member of a cluster, not all members pairwise.
- [ ] B2 — Continuous approach and bridge profiles. Core solver landed
      (`src/world/bridge-profile.ts`: `solveBridge`) — 14/14 targeted tests,
      full suite 84/84, clean build. Zero call sites: nothing calls it outside
      its own test file, same as every prior deferred module. Ruling: solves
      each bridge edge using only its *single* degree-2 approach chain per
      end — a real junction encountered before the transition completes
      (ground fork or incompatible bridge) is treated as an approach-length
      shortfall (component rejected), not the plan's coupled "solve shared
      approach junctions together." `BridgeSurface.openings` is always `[]`
      (not modeled) and a branching elevated junction on the bridge itself is
      unsupported. "Major road" (clearance/thickness) is approximated from
      edge width (>= 12 m) since B1's `RoadEdge` carries no class. See work
      log for the full ruling and what B3 must know before consuming this.
- [ ] B3 — Joined surface meshes and ground tie-ins. Mesh geometry landed
      (`src/world/bridge-mesh.ts`: `buildBridgeMesh`) — 8/8 targeted tests,
      full suite 92/92, clean build. Three real-data diagnostic rounds against
      Gamla Stan (see work log): baseline **0/76 ready**; option 1
      (`JUNCTION_HEIGHT_TOLERANCE`, junction-as-ground-anchor) implemented and
      tested (16/16) but **still 0/76** — individual sides flipped, no bridge
      cleared both ends; option 2 (clearance recalibrated for a ramped model,
      tiered by `layer`) implemented and tested (17/17, full suite 95/95) and
      **measured at 9/76 ready** — a real, precise improvement. The remaining
      67 are overwhelmingly a `walked=0.0m degree=1` dead-end population
      (37 endpoints diagnosed 2026-09-12). **Correction: the earlier
      `steps`-class-exclusion guess was wrong** — `class="path"` is in
      `ROAD_CLASSES` and is not filtered; only 2/37 even have `steps` as
      nearest neighbor. Measured breakdown instead: ~20/37 are bridge
      endpoints whose nearest neighbor is *another bridge fragment* at the
      same layer 2-13m away (stitching would only extend the bridge, not
      reach ground — likely means the 76-edge count is fragments of far
      fewer real structures, not 76 independent bridges); ~7/37 have no
      transportation feature within 15m (genuine source/tile data gap);
      ~5/37 are genuine bridge-to-ground near-misses beyond `SNAP_DISTANCE`
      (1.9-6.9m, footway/steps/cycleway); ~5/37 are layer-2 vs layer-0 jumps
      rejected by `layersCompatible`'s diff-of-1 rule, two of which (0.2m,
      0.7m) are already within `SNAP_DISTANCE`. See work log for full
      breakdown. **Both targeted fixes were then implemented, TDD'd and
      measured (2026-09-12) — the ~10/37 "addressable" estimate is corrected
      down to effectively 0 measured.** The bridge-aware wider snap
      tolerance was a **net regression** (9/76 -> 3/61 ready) — it swallowed
      short real approach stubs into their neighboring junction, and was
      reverted; a real latent B1 bug it exposed (a dangling cluster-object
      reference after a multi-cluster merge) was found, fixed, and kept with
      its own regression test, independent of the revert. The
      `layersCompatible` diff-of-2 exception (grade-separated bridge meeting
      ground with no intermediate layer) was kept — independently correct
      and measured to cause no regression — but moved the ready count by
      exactly 0 (still 9/76); its target bridges fail for a different,
      un-root-caused reason. See work log for both real-data measurements.
      **This closes the B1 parameter-tuning avenue**: 9/76 is the measured
      ceiling without a bigger design change (e.g. fragment-aware stitching
      that widens tolerance only between bridge fragments, never at an
      approach edge's own two endpoints — flagged, not attempted).
      **Reduced-scope live wiring landed 2026-09-12** (see work log): the
      plan's own dependency table lists Z3 for B3, specifically for masking
      the 2D `roads`/`bridges` style layers — Z3 remains unwired (only
      `roadFootprint` exists, zero call sites), so that masking/depth-bias
      piece was deliberately deferred, not built. What *was* built and
      browser-verified: `solveBridges()` (per-component solving, fixing a
      real gap where `solveBridge()`'s first-failure short-circuit would have
      suppressed all 9 ready bridges behind whichever of the other 67 failed
      first), live graph/solve/mesh wiring in `details-data.ts`, a new
      `BridgeMeshes.tsx` R3F renderer, and fallback ownership in
      `structures.ts` so a published bridge's old box/rails/posts/piers are
      skipped (geometry-proximity matched, not exact edge-id traceability —
      B1's graph can split/join raw lines, so there's no direct mapping).
      Measured live at Gamla Stan: **9 of 9 predicted-ready bridges actually
      publish** in the running app, with continuous ramped decks visibly
      replacing the old disconnected floating box. Not built: B4's railings
      (a published bridge currently has a bare deck, no rails — the old
      box's rails are correctly suppressed for it, so this is a visible gap,
      not a hidden one), Z3's masking (named seam risk at ramp-to-ground
      anchors, browser-checked as non-disqualifying but not eliminated), and
      B5's full verification protocol (multi-city/zoom/bearing/pitch/DPR/
      terrain matrix) — none of B5 was attempted.
- [ ] B4 — Exposed-edge railings, supports and strict budgets. **Railings and
      posts landed and browser-verified 2026-09-12** (see work log):
      `bridge-boundaries.ts`'s `exposedBridgeEdges`/`bridgeAccessories`
      (opening-clipped railing boundaries, 8m-spaced posts, 500-instance
      cap) and `bridge-mesh.ts`'s `buildRailMesh` (sloped rail-bar mesh
      strips, since a yaw-only `StructurePart` can't tilt with a ramp), wired
      into `details-data.ts`/`BridgeMeshes.tsx` with a per-quality-tier
      triangle budget (`QUALITY[...].bridgeTriangles`, Eco 10k/Balanced
      25k/High 50k) that drops a bridge's optional rail before ever touching
      its mandatory deck. All 9 previously-published Gamla Stan bridges kept
      both deck and rail (18 plain meshes measured, exactly 9x2, none
      dropped). Browser close-up confirms a continuous rail with evenly
      spaced posts on a real published bridge. **Piers landed 2026-09-12**
      (see work log): `bridge-model.ts`'s `ProfileSample` gained an optional
      `ground` field, populated in `bridge-profile.ts`'s solve for deck-only
      samples (never approach/ramp samples, which are an interpolated curve,
      not a measured height); `bridge-boundaries.ts`'s `bridgeAccessories`
      places round piers under each surface's deck span (2-9 columns per
      ~38m, gated off below 12m spans, omitted when negligible height),
      sharing one combined 500-instance cap with posts. Full suite 127/127,
      clean build. **Browser evidence weaker here than for rails/posts**: a
      non-zero pier-cylinder instance count and zero console errors were
      confirmed, but two close-up screenshot attempts did not land a clean,
      unobstructed view of an actual pier (stated directly in the work log
      rather than implied) — B5's own screenshot matrix is the natural place
      to get an unambiguous shot. **Two constraints from the plan's own B4
      text remain unimplemented, named rather than silently dropped**:
      excluding piers from lower road/path footprints, and avoiding
      navigable-looking water channels — both need polygon/water geometry
      this module has no access to. Z3's masking and B5's full verification
      protocol remain open from B3, unaffected by this task.
- [ ] B5 — Connectivity, visual and performance acceptance. **Partially run 2026-09-12** (see
      work log): `tests/bridge-acceptance.test.ts` (17 tests) covers every named fixture shape
      end-to-end through the real `collectDetails()` pipeline plus a sampled-position continuity
      walk (0.02m endpoint tolerance, per-post corridor-clearance check, exaggeration/quality-tier
      regression guards) fully offline. `tests/browser/bridges.mjs` drove Gamla Stan through 9
      real-tile checks (publish, bridges toggle, zoom-threshold sweep, tile pan, orbit, reload,
      located-bridge close-ups) plus an Amsterdam cross-city sanity pass — all passed. Full suite
      144/144, clean build. **Not done:** the full 12-zoom/4-bearing/3-pitch/2-DPR/2-terrain/
      3-city matrix (only a scoped subset ran, same reduction pattern as every prior B1-B4
      session); San Francisco/Chamonix (terrain-on) got no live-browser coverage at all; a true
      pre-B1-B4 performance baseline (no separately-bootable old build in this environment) —
      only a same-session bridges-on-vs-off comparison was measured (16 extra meshes, ~717 extra
      instances, 28,320 extra triangles, 24 extra draw calls, no steady-state memory difference).
      **A real, reproducible bug was found and left unfixed, flagged for a dedicated follow-up:**
      repeated fast travel between two cities makes Gamla Stan's published bridge-mesh count jump
      from a clean 16 to 56 starting on the second return and hold there indefinitely (not
      unbounded growth, but never self-corrects) — a single isolated round trip is completely
      clean. Root cause not confirmed; see work log for the measured pattern and the working
      (unconfirmed) MapLibre tile-cascade hypothesis.

## Tracking rules

Append an entry to the work log for each completed task or failed acceptance gate: date, task ID, changed files, commands/results, artifact paths and next action. Keep unresolved data cases visible. A written test plan is not a passed test; screenshots alone do not establish connectivity. Check off tasks only after their unit/build checks and required browser evidence pass.
