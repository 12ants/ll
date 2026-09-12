# Rendering Ideas Work Log

## 2026-09-11 — Planning completed

**Request:** Carry out [ideas.md](ideas.md): write plans for facade coverage, stable dimensions during zoom, and connected bridges with unobstructed railings; save them under `docs/` with a todo list and work log.

**Inspected:** `AGENTS.md`, the referenced RTK guidance found at `/home/aa/.codex/RTK.md`, `src/world/{structures,details-data,style,geography,config}.ts`, `src/world/{WorldMap,Details}.tsx`, existing unit/browser tests, `package.json`, the installed MapLibre terrain API/style specification, and the historical bridge notes. Consulted official MapLibre style/query documentation and upstream OpenMapTiles transportation schema; links are beside the claims in the plans.

**Findings:** Facade coverage is restricted by zoom, distance, building count, ring selection, short-wall rejection and allocation order. Roads use zoom-dependent pixel widths while bridge decks use different meter-based defaults. Bridge generation lacks neighboring road topology and ramps, its diagonal railing normal needs correction, and part insertion does not consistently enforce the stated cap. Tile fragments and geometry-based identity need deliberate handling before claiming stable zoom behavior.

**Decisions:** Plan a universal MapLibre facade pattern with bounded modeled details; a shared physical road model and retained feature identities; and bridge graph/profile/mesh/boundary stages. Make pattern mapping and roof appearance an explicit prototype acceptance gate. Treat incomplete bridge topology as a visible fallback count, not a successful reconstruction. Preserve terrain gating and shared rendering.

**Files created:**

- [FACADE_COVERAGE_PLAN.md](FACADE_COVERAGE_PLAN.md)
- [ZOOM_STABILITY_PLAN.md](ZOOM_STABILITY_PLAN.md)
- [BRIDGE_CONNECTIVITY_PLAN.md](BRIDGE_CONNECTIVITY_PLAN.md)
- [IDEAS_TODO.md](IDEAS_TODO.md)
- This log.

**Existing workspace state:** The root `ideas.md` was already deleted and `docs/ideas.md` was already untracked when work began. These changes were preserved. The existing `docs/BRIDGE_RENDERING_PLAN.md` was preserved as historical notes.

**Compatibility discrepancy:** Project instructions specify React `~19.2.0`; the manifest currently specifies `~19.3.0`. No dependency changes were made. Future runtime work must establish compatibility rather than copying either version assertion without checking.

**Validation:** Documentation link/anchor checks and `git diff --check` passed. Reviewed all three idea requests against the task IDs and execution dependencies. No runtime code was changed, so unit tests, build and browser rendering were not run for this documentation task. Commands and acceptance criteria in the plans describe future work, not completed verification.

**Next action:** Begin Z1 from the [todo list](IDEAS_TODO.md), then Z2. Implementation has not started.

## 2026-09-11 — Z1 complete: shared physical dimensions and road appearance

**Task:** [Z1](ZOOM_STABILITY_PLAN.md#z1-establish-one-dimension-and-appearance-policy) from the [todo list](IDEAS_TODO.md).

**Changed files:** created `src/world/road-model.ts` and `tests/road-model.test.ts`;
modified `src/world/structures.ts`, `src/world/details-data.ts`, `src/world/style.ts`,
`src/world/WorldMap.tsx`, `tests/world.test.ts`.

**Change:** `road-model.ts` exports `RoadDimensions`, `roadDimensions(properties)`,
`roadColor(properties, palette)`, `isMajorRoadClass`, `MAJOR_ROAD_CLASSES` and
`VEGETATION_SETBACK`; neither dimension/color function accepts zoom or camera position.
Width resolves from a strict metric parse (finite numbers or `"<n>"`/`"<n> m"` strings,
range 1–40 m; unknown units and out-of-range values are rejected, not clamped) then
positive-integer `lanes × 3.25 m` (clamped to the same range), then class fallback
(path/track 3 m, motorway/trunk/primary 14 m, other classes 8 m). Structural dimensions
are fixed by class group: deck thickness 0.5/1.1/0.8 m, markings 0.15 m, shoulders 0.5 m
(0 on paths/tracks).

`collectBridgeParts()` (`structures.ts`) now calls `roadDimensions`/`roadColor` instead of
its own duplicate width/thickness/color literals — this changes bridge deck color for
non-path/major classes from a fixed `#b0afa1` to the active palette's road tone, and for
major classes from `#a19c8d` to `#8f897c` (matching the flat map exactly, which was the
point). `style.ts`'s `roadSurface` match expression now sources its literal colors from
the same `road-model.ts` constants, and its major-class filter list from
`MAJOR_ROAD_CLASSES`, so the 2D layer and the 3D deck are provably the same policy
(locked by a new regression test in `tests/world.test.ts`).

`details-data.ts`'s tree-exclusion pass previously used the *full* road width as if it
were an exclusion radius (a pre-existing bug — comparing perpendicular distance against
full width, not half). Z1 fixes this: the stored per-segment value is now `radius = width
/ 2 + VEGETATION_SETBACK` (2 m), explicitly distinct from the carriageway width, per the
plan's requirement. **Visible behavior change:** secondary-road tree exclusion shrinks
from a 10 m threshold to 6 m (8/2 + 2); path/track grows from 3 m to 3.5 m (3/2 + 2).
This is a deliberate fix of the pre-existing radius/width confusion, not a regression —
but it will visibly move trees closer to secondary roads than before.

Fixed a related staleness bug found in review: `WorldMap.tsx`'s detail-collection
`useEffect` dependency array was missing `config.palette`, so switching palette would
recolor the 2D `roads` layer instantly (via `setPaintProperty`) but leave 3D bridge decks
on the old palette-dependent tone until the next `moveend`/`sourcedata` fired. Added
`config.palette` to the dependency array.

**Commands/results:** `pnpm exec vitest run tests/road-model.test.ts` — 0 passed before
(module missing, confirmed TDD failure), then 11 passed after implementation.
`pnpm test` (full vitest) — 21 passed (21). `pnpm build` (`tsc -b && vite build`) — clean,
no type errors.

**Browser evidence:** `pnpm test:browser` was not run (no dev server / internet in this
environment). Read `tests/browser/world.mjs` directly instead: its only instance-count
assertions (`instances.some(n => n > 0)` and `instances.length === 4` at zero tree
density) check instanced-mesh *group* counts, not per-tree/road pixel or color values, so
Z1's width/color changes do not invalidate them. This was a read-only check, not a run —
still unverified end-to-end in a real browser.

**Unresolved:** the commit for this work is pending a human action. The repo's global
`rtk` PreToolUse hook unconditionally refuses any Bash command containing `git` while a
session is isolated in a worktree (confirmed even for a bare `git status`); the documented
fix, `scripts/toggle-rtk-hook.sh`, can only be run by a human in a real terminal. The user
chose to keep working uncommitted rather than pause for this. Also carried into this
worktree in this same working state (previously untracked in the main checkout, "fresh"
worktrees do not include uncommitted/untracked files): the four other plan docs, this
log, the todo list, `docs/ideas.md`, and the deletion of the stale root `ideas.md` stub.

**Next action:** Z2 — bounded, stable feature cache (`src/world/feature-cache.ts`,
`reconcileFeatures`). Per an advisor review, splitting Z2: implement and fully unit-test
the pure cache/reconciliation module and the cheap `WorldMap.tsx` versioning/cleanup
pieces now; the `querySourceFeatures` topology switch (querying hidden transportation
features) is deferred to B1, since the plan's own text concedes it doesn't build a
complete network on its own and it is not independently verifiable without live tiles in
a browser — doing it now would just be unreviewable risk pulled forward from B1.

## 2026-09-11 — Z2 partial: bounded, stable feature cache (core module, not yet wired in)

**Status correction:** the todo list intentionally leaves Z2 unchecked. `feature-cache.ts`
is fully unit-tested but has **zero call sites** outside its own test file — nothing in
`details-data.ts`, `structures.ts` or `WorldMap.tsx` imports `featureKey`,
`reconcileFeatures` or `boundCache`. At runtime today, nothing is actually preserved
across camera updates; the module is a tested, ready dependency, not a live behavior
change. B1/B2/B3 list Z2 in their `Depends on` column — treat that dependency as met only
once a future task actually feeds `queryRenderedFeatures` output through
`featureKey`/`reconcileFeatures` in the collection path (this does not require the
`querySourceFeatures` switch below — that's a separate, independently deferred piece).

**Task:** [Z2](ZOOM_STABILITY_PLAN.md#z2-preserve-feature-identity-and-geometry-across-camera-updates)
from the [todo list](IDEAS_TODO.md).

**Ruling (scope split, made after an advisor review of the Z1 diff and this task before
starting):** Z2's plan text lists two very different halves under one task. Implemented
now: the pure `feature-cache.ts` module (`WorldFeature`, `reconcileFeatures`, the
canonicalization/identity helper `featureKey`, and the bounded-cache helper `boundCache`)
— zero runtime surface, fully unit-testable, and the module B1/B2/Z3 will actually consume.
Deferred to B1: switching `details-data.ts`/`structures.ts` from
`queryRenderedFeatures`-only to also querying `querySourceFeatures` for transportation
topology even when roads are hidden. Reason: the plan's own text concedes
`querySourceFeatures` alone "does not load missing neighbors or create a complete
network" — it's a road-graph prerequisite (B1's actual subject), not a Z2 stability win —
and it changes what data reaches the running scene in a way that can't be validated
without live tiles in a browser, which is not available in this environment. Ruling it
into B1 keeps this diff reviewable and avoids landing an unverified behavior change to
the production collection path. Consequence if wrong: B1 has to redo this decision and
actually wire `structures.ts`/`details-data.ts` to the cache — no code from this task is
wasted either way, since `feature-cache.ts` is the dependency B1 needs regardless.

**Changed files:** created `src/world/feature-cache.ts` and `tests/feature-cache.test.ts`;
modified `src/world/WorldMap.tsx` (verification only, see below — the actual code change,
adding `config.palette` to the detail-collection effect's dependency array, was made and
logged under Z1, since it was a Z1 correctness bug the review found, not new Z2 work).

**Design:** `featureKey(source, sourceLayer, feature)` builds identity from
canonicalized geometry (coordinates rounded to 1e-6 degrees, longitude wrapped before
rounding, line direction and polygon ring start normalized to a canonical form, Multi*
parts sorted into a canonical order) hashed alongside the feature's real ID when present
(scoped by source/layer so the same raw ID in a different layer never collides) or `"anon"`
when absent. This makes identity independent of query order, camera origin, line
direction, ring rotation and world-wrap duplication, matching every fixture in the plan
(reversed lines, rotated rings, duplicate world wraps, repeated IDs in different layers,
shuffled results, two anonymous parallel roads, split road segments — the last two of
which get *distinct* keys by design: anonymous features have no identity beyond their own
geometry, and per-tile fragments of one real ID differ geometrically, so they're preserved
side by side rather than merged).

`reconcileFeatures(previous, incoming)` merges by key (identical key ⇒ same geometry ⇒
automatically deduplicated) and enforces one precedence rule: once a "complete" geometry is
known for a real feature ID, any "fragment" for that same ID — incoming or already
resident — is dropped. This never *stitches* fragments into a synthetic whole; it only
ever adds, replaces-on-identical-key, or drops. Anonymous features have no cross-fragment
precedence (no ID to key it on), which is the "best-effort" limitation the plan
anticipates for no-ID matching.

`boundCache(features, origin, visibleRadiusMeters, bounds)` is a separate function (the
plan pins `reconcileFeatures`'s signature to exactly two parameters, so bounding — which
needs camera state — cannot live inside it). Default bounds match the plan exactly
(10,000 records / 16 MiB). It prioritizes in-range features (within
`visibleRadiusMeters + marginMeters`, default margin 250 m) over offscreen ones, and
reports `incompleteCoverage: true` when even an in-range feature had to be dropped.
**Documented simplification:** true LRU needs a per-feature last-access timestamp, which
this cache's flat `WorldFeature[]` shape doesn't carry — as a proxy, offscreen features are
evicted farthest-first (nearest-to-view kept longest). This is noted in the function's
doc comment, not left implicit.

**Canonical-coordinate seeding — verified, not changed:** the plan also asks that
"length, width and random seeds" derive from canonical coordinates, never a camera-rebased
frame. Read `structures.ts`: building facade tone (`hashString(JSON.stringify(ring))`)
and bridge segment dedup keys (`JSON.stringify([line[i-1], line[i]])`) both already hash
the raw lng/lat GeoJSON coordinates, not `localMeters()` output — `localMeters()` is only
used there to compute physical positions/lengths for rendering. This already satisfies
the constraint; no change was needed or made.

**WorldMap.tsx generation-versioning — verified, no change needed:** the plan asks to
"version pending collections by source/config generation" and "ignore stale results
after terrain/source/config changes." `collectDetails()` is called synchronously inside
the existing debounce callback (`WorldMap.tsx`'s `refresh`), so there is no pending async
result that could resolve after a newer config supersedes it — the callback always reads
`configRef.current` at the moment it actually runs. The effect already clears its timer
and unregisters `moveend`/`sourcedata`/`idle` listeners on unmount (the pre-existing
`disposed` flag + cleanup function). A generation-version guard would be speculative code
for a race that cannot occur while collection stays synchronous; it becomes necessary
only if/when B1 makes collection asynchronous (e.g. awaiting `querySourceFeatures` across
tiles), at which point it belongs with that change.

**Commands/results:** `pnpm exec vitest run tests/feature-cache.test.ts` — 0 passed before
(module missing, confirmed TDD failure), then 16 passed after implementation. `pnpm test`
(full vitest) — 37 passed (37). `pnpm build` (`tsc -b && vite build`) — clean, no type
errors.

**Browser evidence:** none run or required — Z2's acceptance line only calls for targeted
tests, `pnpm test` and `pnpm build`; browser protocol is Z3's.

**Unresolved / no-ID matching limitations (per the plan's own request to document these):**
anonymous-feature identity is geometry-hash-only, so (a) an anonymous feature that is
edited upstream (its geometry changes between passes) is indistinguishable from a
different feature appearing and the old one disappearing — there is no way to know it's
"the same road, moved"; (b) two anonymous fragments of one real-world feature (no shared
ID) can never be recognized as the same entity by this module, only by geometry, so they
will accumulate as separate resident records indefinitely rather than being superseded by
a later complete view, unlike the ID-based case. Both are inherent to having no ID, not
implementation gaps — the plan calls this "best effort" and a "stronger guarantee
requires a source adapter with stable IDs and complete geometry," which is unchanged
here. The commit for this work remains pending the same human git-hook action logged
under Z1.

**Next action:** F1 (universal base facade treatment) is independent and can start next;
B1 (road graph and verified bridge connections) is the natural home for the deferred
`querySourceFeatures` integration and now has `feature-cache.ts` available to build on.

**Addendum, same day, before starting F1:** confirmed this environment actually has
internet and a working Playwright/Chromium install, so ran `node tests/browser/world.mjs`
against `pnpm dev` as a sanity check (on the Z1+Z2 code, before any F1 changes). 5 of 6
checks up to that point passed (shared renderer, quality caps/DPR, profiler toggles,
save/export/import, wrapped-camera/orbit/focus). It then hit a pre-existing failure at
`tests/browser/world.mjs:117` — `expect(instances.length).toBe(4)` got `5` — which is
exactly the staleness [ZOOM_STABILITY_PLAN.md](ZOOM_STABILITY_PLAN.md#z3-render-consistent-physical-ground-surfaces-and-handoff)
already names for Z3 ("Its exact instance-count assertion currently assumes the old
structure groups; update it to assert amenities semantically..."). Not caused by Z1/Z2 —
neither touched mesh grouping/kind, only width/color/thickness values and merge/cache
logic. Left unfixed here; Z3 owns it per the plan. This does confirm the harness itself
works in this environment, which de-risks F1's required browser acceptance step.

## 2026-09-11 — F1 attempted and rejected: universal base facade treatment

**Task:** [F1](FACADE_COVERAGE_PLAN.md#f1-prove-and-integrate-base-coverage) from the
[todo list](IDEAS_TODO.md).

**Built and unit-tested:** `src/world/facade-pattern.ts` — `createFacadePattern(palette,
night)` (deterministic 64×64 RGBA staggered panel/joint texture, palette-colored,
hashString-seeded per-panel jitter, no `Math.random`) and `facadeImageId(palette, night)`
(`facade-<palette>-day`/`-night`). 11 tests in `tests/facade-pattern.test.ts`: exact
buffer length, opaque alpha, deterministic repeat, distinct per palette, distinct
day/night, staggered courses, unique IDs.

**Wired in, then reverted after the acceptance check failed** (see below): `style.ts`'s
`buildings` layer paint gained a conditional `fill-extrusion-pattern` selecting
`facadeImageId(c.palette, isNight(c.hour))`, no zoom expression. `WorldMap.tsx` gained
image registration for all six palette/day-night images (on `onLoad`, defensively
re-registered in a `[ready]` effect), a `styleimagemissing` handler, and — since the
imperative style patcher only ever *sets* paint properties present in the next style,
never clears ones dropped from it — a new loop clearing paint properties present in the
previous style but absent from the next via `setPaintProperty(..., null)` (cast needed:
the MapLibre type declarations don't include `null` despite it being documented,
default-resetting behavior).

**Browser-verified at Gamla Stan** via `tests/browser/facades.mjs` (now removed, see
below): zoom 13/14.99/15/16/19 × bearing 0/90/180/270 at pitch 60, plus a facades
on→off→on toggle sequence and a night-hour check, all against the real running app
(`pnpm dev`, real OpenFreeMap tiles — confirmed this environment has working internet and
a working Playwright/Chromium install). Screenshots in `.artifacts/facades/`.

**Result: rejected.** Direct visual inspection (not just the passing paint-property
assertions, which only proved the plumbing worked) found both of the plan's own named
fail conditions, confirmed by an identical-camera-position before/after comparison
(`gamla-stan-facades-off.png` vs `gamla-stan-facades-on-again.png`):

- **Roof treatment fails** — `fill-extrusion-pattern` paints the wall brick texture onto
  roof caps too (unmistakable in the close-up `gamla-stan-z19-b0.png`, and visible on the
  domed building in the top-down comparison pair). Real roofs don't look like brick walls.
- **Per-building color variation is lost** — the existing `fill-extrusion-color`
  interpolation (5 palette tones by `numericId % 5`) gives a varied, legible mosaic with
  facades off; with the pattern on, every building becomes one uniform tan texture.

One non-blocking lead recorded for a future attempt: the z14.99→z15 screenshot pair
showed a perceptible flat-to-speckled jump across only a 0.01-zoom-unit step, more change
than pure geometric scaling would predict — not run down further since the roof/color
findings already failed the gate on their own; noted in
[FACADE_COVERAGE_PLAN.md](FACADE_COVERAGE_PLAN.md#2026-09-11--pattern-prototype-f1-built-prototyped-and-rejected-on-the-acceptance-checks)
as a possible MapLibre pattern-rasterization LOD artifact, worth checking if this
renderer choice is ever revisited.

**Full detail, including the evidence and the fallback recommendation (custom R3F
wall-only extrusions, per the plan's own pre-named alternative), is in
[FACADE_COVERAGE_PLAN.md](FACADE_COVERAGE_PLAN.md#2026-09-11--pattern-prototype-f1-built-prototyped-and-rejected-on-the-acceptance-checks)**,
not duplicated here.

**Reverted, since the default config has `facades: true`** and shipping this would have
put the roof/color regression in front of every user by default: removed
`fill-extrusion-pattern` from `style.ts`'s buildings paint (and its now-unused
`facadeImageId`/`isNight` imports there), removed the image-registration effect,
`styleimagemissing` handler and `onLoad` registration call from `WorldMap.tsx`, removed
the now-dead "clear removed paint properties" loop (nothing else in `style.ts`
conditionally adds/removes a layer paint property, so it had no remaining caller — it was
purely in service of this feature), removed the "universal base facade coverage" describe
block from `tests/world.test.ts`, and deleted `tests/browser/facades.mjs` (it tested the
now-unwired feature; keeping it would mean a permanently-failing or dead test file).
Verified the revert visually: re-ran the app, confirmed varied per-building colors are
back and no console errors (`.artifacts` screenshot not retained — ad hoc sanity check,
not part of the plan's evidence set).

**Kept, as independently correct regardless of the rejected renderer choice:**
- `isNight(hour)` in `geography.ts` — shared day/night boundary; `structures.ts`'s pane
  `lit` color now uses it too (was a private inline `c.hour < 7 || c.hour >= 18`).
- `config.hour` added to `WorldMap.tsx`'s detail-collection effect's dependency array —
  a real pre-existing bug this plan's "Current causes" section named directly (pane
  lighting reads `c.hour` but the collection effect didn't depend on it, so it wouldn't
  refresh on a time-of-day change). Unrelated to the pattern rejection.
- `src/world/facade-pattern.ts` and its test — unused now, but complete, tested, and
  explicitly reserved in `FACADE_COVERAGE_PLAN.md` for the custom R3F alternative (the
  texture generation itself isn't what failed; MapLibre's single whole-extrusion
  `fill-extrusion-pattern` painting both walls and roof together is).

**Commands/results:** `pnpm exec vitest run tests/facade-pattern.test.ts` — 0 before
(module missing), 9 after. Full `pnpm test` after wiring — 50 passed; after revert — 46
passed (the 4 removed were the reverted feature's own `world.test.ts` assertions).
`pnpm build` clean throughout. `node tests/browser/facades.mjs` — all 8 of its assertions
passed (image registration, no missing-image frame, toggle clears/restores the paint
property, night selection) — **passing assertions are not the same as passing the
plan's visual acceptance gate**, which only the screenshots settle, and did not pass.

**Not started:** F2 and F3 depend on "F1 decoration" being present and correct; neither
was started, since F1 itself needs a renderer choice before they have anything to build
on.

**Next action:** Scope a new task for the custom R3F wall-only extrusion alternative
(separate roof/wall materials, precise per-wall window grids) before resuming F2/F3 — see
the fallback clause `FACADE_COVERAGE_PLAN.md` already carried before this session, now
backed by concrete rejection evidence for the alternative it was hedging against.

## 2026-09-11 — Z3 partial: road footprint geometry (core only, unwired)

**Task:** [Z3](ZOOM_STABILITY_PLAN.md#z3-render-consistent-physical-ground-surfaces-and-handoff)
from the [todo list](IDEAS_TODO.md).

**Ruling (scope split, same shape as Z2):** Z3's plan text covers a full rendering
subsystem: the `roadFootprint` polygon-offset geometry, a dedicated GeoJSON source and
fill layers for ground roads/shoulders/markings, dual-source fallback splitting so
replaced and unreplaced intervals never both draw, a hysteresis zoom handoff (enter 13.1,
leave 12.9) with a 150ms opacity transition, terrain-following elevation, an explicit
triangle/memory budget, and a browser acceptance matrix (12 zoom values × 4 bearings × 3
pitches × 2 DPR × 2 terrain states, across Stockholm/Amsterdam/San Francisco). That
matrix alone is larger than everything else done this session combined. Implemented now:
`roadFootprint`, the pure, fully-tested polygon-offset function — the dependency every
later piece (including B3's bridge approaches) needs. Deferred: everything that renders
it. Reason: same as F1/Z2 — this environment has no way to validate a live rendering
change of this size except by building the whole thing and running the full matrix, and
F1 just demonstrated the cost of landing live wiring without that protocol behind it.

**Built and unit-tested:** `src/world/road-surfaces.ts` — `roadFootprint(line, width,
origin)`. Offsets each segment by half-width using its unit normal in a local meter
frame (`localMeters`/new `metersToPosition` — the latter's inverse, added to
`geography.ts`); miters interior joints via line-line intersection, bevels (uses the two
raw segment-offset points instead) when the miter would exceed twice the half-width;
butt-caps line endpoints (no round-cap overshoot); dedupes consecutive duplicate
vertices; detects self-intersection in the resulting ring and returns `null` rather than
emit broken geometry. Takes no zoom or camera parameter. 11 tests in
`tests/road-surfaces.test.ts`: reject-under-2-points, 100m-straight width within 1%,
right-angle bend, duplicate vertex, U-turn, latitude 0/60 width accuracy, shared-width
entrance edge alignment, a moderate-bend bounded-miter check, and the acute-bend
rejection case below.

**Measured finding — the acute-bend fixture legitimately rejects, and the plan
anticipates this:** the fixture's first attempt (a 135° heading change) returned `null`.
Investigated empirically with an angle sweep (not fixed by tuning the miter threshold —
swept the fixture instead, since the miter/bevel bound is a correctness property, not a
free parameter) before accepting the result: the reject boundary sits at **~110–120° of
heading change**, and did **not move** when width was swept 8→2 or segment length
40→100. That width-independence rules out "road too wide for this turn" as the cause —
it's a structural limitation of per-side offsetting with a miter/bevel join (this module
builds one boundary polygon via line intersections) versus a true polygon union (e.g. a
Clipper-style buffer-and-union offsetter, which this module does not implement). The
plan's own text anticipates exactly this: "split/reject self-intersecting offsets with an
explicit fallback diagnostic." **This is the single most useful fact for whoever builds
Z3's renderer next:** the fallback-to-original-line path will fire on real road data at
hairpins and tight slip-road turns (not an edge case that never occurs), and the fix is a
different offsetting algorithm, not a threshold tweak. The final test asserts this
rejection directly rather than papering over it.

**Not started:** the GeoJSON source/layers, fallback-source splitting, hysteresis
handoff, terrain-following, triangle budget, and `tests/browser/zoom-stability.mjs` — all
of Z3's actual rendering behavior. `style.ts`, `WorldMap.tsx` and `details-data.ts` were
not touched for Z3 (only `geography.ts` gained `metersToPosition`).

**Honesty check — unused-export status, stated plainly:** this session now has **three**
shelved-but-tested modules with no production call sites: `src/world/feature-cache.ts`
(Z2), `src/world/facade-pattern.ts` (F1, explicitly rejected), and
`src/world/road-surfaces.ts` (Z3, this entry). All three are real, correct,
independently-tested building blocks — not dead code in the sense of being wrong or
unfinished — but none of them changes what the running app actually does yet. Do not
read three green checkmarks in `pnpm test` as three shipped features.

**Commands/results:** `pnpm exec vitest run tests/road-surfaces.test.ts` — 0 before
(module missing), 11 after. Full `pnpm test` — 57 passed (57). `pnpm build` clean.

**Next action:** Z3's renderer (GeoJSON layers, handoff, budget, browser matrix) needs
its own dedicated task, ideally after evaluating a polygon-union offsetting approach
given the acute-bend finding above. B1 (road graph) remains the next task with no
unresolved prerequisite gap.

## 2026-09-11 — B1: road graph topology built and tested; live wiring deferred

**Task/Ruling:** B1 asks for a graph of nodes (snapped endpoints/junctions) and edges
(polylines between them) built from queried road/bridge features, with correct
T-junction splitting, degree-2 bridge-chain joining across tile splits, and
layer/bridge-compatible connectivity (no false joins across overpasses or separate
carriageways). Same scope-split ruling as Z2/Z3/F1: land the pure, fully-tested graph
builder; defer wiring it into the live collection path. Reason this time is sharper than
"can't verify a live change safely" — there is no B2 solver and no B3 mesh yet to consume
a graph, so calling `buildRoadGraph` from `details-data.ts` today would rebuild a full
graph on every 250ms debounce tick for zero visible output. Wiring belongs with B2, when
something downstream actually needs live graphs.

**Built and unit-tested:** `src/world/bridge-model.ts` — verbatim shared types (`Vec3`,
`RoadNode`, `RoadEdge`, `RoadGraph`, `ProfileSample`, `BridgeSurface`, `BridgeSolution`,
`BridgeMeshData`) for B1-B4. `src/world/road-topology.ts` — `buildRoadGraph(features,
origin)`. Pipeline: extract raw segments (physical-road filter, tunnels excluded,
`localMeters` conversion, width/layer/bridge extraction) → orientation-independent
dedup (drops reversed-duplicate query results) → T-junction detection and splitting
(projects other lines' endpoints onto a line's interior at 0.5m snap distance, gated by
layer compatibility — never splits at a mere 2D crossing where neither line has an
endpoint there, which is what correctly keeps overpasses and different-level crossings
disconnected) → greedy endpoint clustering into nodes (0.5m snap, layer/bridge-compatible)
→ edge construction and dedup → degree-2 bridge-chain joining (so tile-split bridge
fragments become one continuous edge) → final `RoadNode[]`/`RoadEdge[]` assembly.
`tests/fixtures/bridge-network.ts` — fixture builder (`ORIGIN`, `metersLine`,
`roadFeature`) producing `WorldFeature` values compatible with Z2's cache model.
`tests/road-topology.test.ts` — 13 tests, confirmed failing first ("Cannot find module")
before implementation: straight bridge with ground approaches, curved bridge interior
bend stays one edge, reversed-duplicate dedup, tile-split bridge fragments join, T-approach
split (degree 3), Y-split (degree 3), separate parallel carriageways never merge,
overpass at a different level never connects, tunnels excluded, lonely dangling bridge
component, parallel roads 2m apart (beyond snap distance) stay separate, interior crossing
at a different level makes no connection, empty input and non-road-class filtering. All
13 passed on the first real run, after hand-tracing the expected node/edge count for every
fixture before writing the implementation (same discipline as Z2/Z3 — paid off again).

**Deviations from the plan text a future session must know before building on this:**
1. The plan describes an outward approach traversal bounded to "250m / 2000 edges" from
   each bridge. This is **not implemented as a bounded traversal or re-query** —
   `buildRoadGraph` is pure over a fixed input feature list with no query API to expand
   into. `MAX_JOIN_ITERATIONS` (2000) in the bridge-chain join loop is a performance
   safety cap on that loop, not the plan's distance/edge-count bound. Whatever wires this
   into `details-data.ts` for B2 needs to supply the 250m outward query itself.
2. Cluster layer/bridge compatibility checks a candidate point against the cluster's
   *first-seen* member only, not all members pairwise. Correct for every fixture here,
   including the overpass and parallel-carriageway cases, but an exotic
   bridge→ground→bridge junction (three-way, mixed layer/bridge membership) could in
   principle mis-merge under this rule. Flagging it now rather than letting it surface
   as a confusing B2/B3 bug later.
3. Both the T-junction pass and the clustering pass are O(n²) over input segments — same
   complexity class as Z3's self-intersection check. Fine at fixture scale; unmeasured
   against a real tile's worth of roads.

**Not started:** `details-data.ts` was not touched — the plan lists it as in-scope
("modify `src/world/details-data.ts` to consume Z2 records") but nothing calls
`buildRoadGraph` outside its own test file yet, matching Z2's own feature-cache module
(also unwired). The `querySourceFeatures` switch deferred from Z2 to B1 is still not
implemented. B2's continuous approach/bridge-profile solver and B3's mesh generation are
untouched.

**Honesty check — unused-export status, now four modules:** `src/world/feature-cache.ts`
(Z2), `src/world/facade-pattern.ts` (F1, explicitly rejected), `src/world/road-surfaces.ts`
(Z3), and now `src/world/bridge-model.ts` + `src/world/road-topology.ts` (B1). All are
real, independently-tested, correct building blocks with zero production call sites. Do
not read a green `pnpm test` as confirmation any of B1-B3's road-graph/bridge-mesh feature
is live in the running app.

**Commands/results:** `npx vitest run tests/road-topology.test.ts` — confirmed failing
("Cannot find module") before implementation, 13/13 passed after. Full `pnpm test` (via
`npx vitest run`) — 70/70 passed across 7 test files. `pnpm build` — clean, no errors.

**Next action:** B2 (continuous approach and bridge profiles) is the next task with no
unresolved prerequisite gap, but its dispatcher should decide at that point whether to
also wire `buildRoadGraph` into `details-data.ts` (implementing the deferred
`querySourceFeatures` switch and the 250m outward-query bound noted above) since B2 is the
first task that actually needs a live graph as input.

## 2026-09-12 — B2: continuous bridge/approach profile solver built and tested; live wiring deferred

**Task/Ruling:** [B2](BRIDGE_CONNECTIVITY_PLAN.md#b2-solve-continuous-bridge-and-approach-heights)
from the [todo list](IDEAS_TODO.md). Same scope-split discipline as Z2/Z3/F1/B1: land the
pure, fully-tested solver; defer wiring it into the live collection path (there is still no
B3 mesh consumer, so wiring now would compute unused profiles on every debounce tick).

**Built and unit-tested:** `src/world/bridge-profile.ts` — `solveBridge(graph,
sampleGround, options)`. For each `bridge: true` edge in the graph: samples ground every
<= 5 m along the span (never just the two endpoints — this is the fix for the "crossing
clearance" gap named in the plan's Current Causes) and sets a constant deck height at
`max(sampled ground) + clearance`, reusing `collectBridgeParts()`'s exact clearance formula
`(major ? 4 : 3) + min(layer, 2) * 1.5`. Each end then walks outward along the *single*
chain of degree-2, non-bridge edges already present in the graph (no live requery — B1
already established the graph is pure over a fixed feature list), sizes a smoothstep
transition from the plan's own flat-to-flat formula (`L = 1.5 * |rise| / maxGrade`) between
that chain's farthest reached point and the deck, and rejects the component (`infeasible`)
if the available chain length can't fit it. A `null` required `sampleGround` result (missing
DEM) is `incomplete`, never silently treated as ground zero. `terrain: false` never calls
`sampleGround` at all (verified with a mock that throws if invoked) — matches the "terrain-off
world stays at ground zero" constraint exactly, including for supposedly-elevated bridges.
14 tests in `tests/bridge-profile.test.ts`: level ground (also asserting `left`/`right` sit at
exactly half-width from center and share its height, per the plan's "assert seam positions in
all three axes" line), different endpoint heights (with an exact-value check that samples
match the mocked ground at each anchor), a curved/bent bridge, a mid-span ground bump
(clearance uses the max under the span, not the endpoints), wavy ground (finite-output smoke
test), missing DEM under the span, missing DEM at an approach anchor, an approach too short
for the required rise, a junction too close to the bridge to let the transition complete
(rejected) and a symmetric junction far enough away to succeed, a dangling bridge with no
approach at all, a graph with no bridge edges, the terrain-off never-sample guarantee, and
`maxApproach` actually capping the walked distance (a sloping-ground fixture where the
transition-zone-boundary sample's height reveals whether the anchor landed at the capped
250 m point or the uncapped 400 m edge end — the only fixture that exercises
`walkApproachChain`'s mid-segment interpolation branch). All 14 written and hand-reasoned
about before the first real run; found and fixed three of my own bugs before landing (see
below) rather than loosening the assertions to match wrong output — plus a fourth caught by
an advisor review after the first green run: the initial `maxApproach` fixture asserted the
wrong thing (the far anchor's *position*, which the design deliberately excludes from
`BridgeSurface.samples`) rather than its effect on the *deck height calculation*, and was
rewritten once the mistake was understood, not patched to pass.

**Ruling — scope narrower than the plan's own B2 text, named explicitly:** the plan asks to
"solve shared approach junctions together: connected branches meet the same node height and
seam cross-section." This implementation does not do that coupled solve. Instead, when a
walk from a bridge endpoint reaches a junction (a ground-road fork, *or* another bridge edge
that B1 didn't merge — e.g. differing width/layer) before its required transition length is
covered, the whole bridge component is rejected as `infeasible`. This satisfies the plan's
fallback intent ("if a branch cannot meet it within the limits, reject the component") for
the case actually tested, but never *attempts* the harder case where the junction is close
but a shared multi-branch solution might still exist. `BridgeSurface.openings` is always
returned as `[]` — mid-span junction openings (an on/off-ramp joining an elevated highway)
are not modeled; if two `bridge: true` edges meet at a node B1 didn't join (a real elevated
junction), this solver treats it as a same-position dead-end and virtually always rejects it
as infeasible (documented, not silently wrong — a false negative that shows as a fallback,
never a fabricated ramp).

**Class-approximation limitation:** `RoadEdge` (B1's own type) carries `width`, `layer`,
`bridge` — no road class. "Major" (clearance +1 m, deck thickness 1.1 vs 0.8) is approximated
as `width >= 12`, splitting the gap between Z1's 8 m (other classes) and 14 m (motorway/
trunk/primary) fallbacks. This is correct whenever width comes from Z1's class fallback, but
a road with an explicit OSM `width` tag placed on the "wrong" side of 12 m (e.g. a real
`secondary` tagged 13 m wide) would be misclassified. Whoever wires B1 into the live
collection path should consider carrying class through `RoadEdge` if this proves visible.

**Bugs found and fixed during targeted-test authoring, not left implicit:**
1. First draft returned a single `"infeasible"` status for every failure, including missing
   ground samples — collapsing the plan's explicit `incomplete` (data problem) vs
   `infeasible` (geometry/grade problem) distinction. Caught by the missing-DEM tests;
   `solveOneBridge` now carries its own `status` alongside `reason`.
2. A ground-bump test's approach length was sized for the *old*, smaller rise before the bump
   was added to the deck-height calc, so the fixture itself made the transition legitimately
   too short — not a solver bug, but it would have looked like one without checking the
   arithmetic by hand first.
3. A missing-DEM-at-anchor fixture used `point[0] < 0` while the anchor landed exactly at
   `x = 0`, so the "missing" sample was never actually queried — an off-by-one in the test,
   caught by an unexpected `"ready"` result rather than assumed correct.

**Commands/results:** `pnpm exec vitest run tests/bridge-profile.test.ts` — 14/14 passed
after the fixes above (not run failing-first against a missing module, since the interface
was implemented directly from the plan's own explicit signature rather than TDD'd — a
deviation from this worktree's usual TDD-first pattern, noted plainly rather than claimed
otherwise). Full `pnpm test` (`vitest run`, all files) — 84/84 passed. `pnpm build`
(`tsc -b && vite build`) — clean, no type errors, no new warnings beyond the pre-existing
chunk-size notice.

**Browser evidence:** none run or required — B2's own acceptance line only calls for
targeted tests, `pnpm test` and `pnpm build`; the module has no rendering surface yet.

**Honesty check — unused-export status, now six modules:** `src/world/feature-cache.ts`
(Z2), `src/world/facade-pattern.ts` (F1, explicitly rejected), `src/world/road-surfaces.ts`
(Z3), `src/world/bridge-model.ts` + `src/world/road-topology.ts` (B1), and now
`src/world/bridge-profile.ts` (B2). All are real, independently-tested, correct building
blocks with zero production call sites. A green `pnpm test` here confirms the solver is
correct in isolation, not that any bridge in the running app is actually rendered by it.

**Unresolved — commit still pending human action, five sessions in a row now:** same
rtk/git-worktree-isolation block as every prior entry (`scripts/toggle-rtk-hook.sh`'s own
comment: "no per-command bypass... can only be run by a human, in a real terminal"). Per an
advisor consultation this session, continuing uncommitted was confirmed as the user's already
-made choice (see the Z1 entry), not something to re-ask. For whoever next has terminal
access, the exact sequence to make this durable:

```bash
scripts/toggle-rtk-hook.sh off
cd .claude/worktrees/zoom-stability-z1
git add -A
git commit -m "Land Z1-Z3/B1-B3 pure modules: road dimensions, feature cache, road footprints, bridge graph/profile/mesh

Zoom Stability Z1 (shared road-model.ts dimensions/colors, wired into
structures.ts/style.ts/details-data.ts) and Z2/Z3 core modules
(feature-cache.ts, road-surfaces.ts) are tested but not yet wired into the
live render path. Bridge Connectivity B1 (bridge-model.ts, road-topology.ts),
B2 (bridge-profile.ts) and B3 (bridge-mesh.ts) build a road graph, solve a
continuous bridge/approach elevation profile and generate the deck mesh
geometry, all tested but unwired. A read-only diagnostic against real Gamla
Stan data measured 0/76 bridges solving as ready under B2's approach-chain
model. Two fixes were measured in turn: option 1 (junction-as-ground-anchor
with a height-gap tolerance, JUNCTION_HEIGHT_TOLERANCE) still gave 0/76 --
individual approach sides flipped to accept but no bridge cleared the bar on
both ends. Option 2 (clearance recalibrated for a ramped model instead of
the inherited floating-box constant, tiered by OSM `layer`) measured 9/76
ready -- a real improvement. The remaining 67 are overwhelmingly a
walked=0.0m/degree=1 dead-end population (missing road-graph topology, not a
B2 parameter) that neither fix touches. B3's live render wiring was
deliberately not attempted, since most bridges would still publish nothing.
F1's
MapLibre fill-extrusion-pattern facade prototype was built,
browser-verified, and reverted after failing its own acceptance gate (roof
texture bleed, lost per-building color) -- facade-pattern.ts is kept unused
for a future custom R3F renderer. See docs/IDEAS_WORK_LOG.md for the full
rationale, every scope-split ruling, the diagnostic's numbers, and what each
subsequent task needs to know before building on this.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
scripts/toggle-rtk-hook.sh on
```

**Next action:** B3 (joined decks, ramps and ground tie-ins) is next, but it's the first task
in this whole sequence where deferring live wiring stops being an option — it explicitly
needs `WorldDetails`/`Details.tsx`/`style.ts` plumbing to render anything, and B3's own text
says it "consumes" Z3's `roadFootprint` boundary rules and masks the *existing* box-bridge
generation. Whoever picks up B3 should decide up front (ideally via advisor consultation
before writing code, per this session's pattern) how much of the Z2/Z3/B1 wiring backlog to
absorb at once, since B3 is where all of it converges.

## 2026-09-12 — B3 mesh geometry built and tested; live wiring blocked on a measured B2 gap, not started

**Task:** [B3](BRIDGE_CONNECTIVITY_PLAN.md#b3-render-joined-decks-ramps-and-ground-tie-ins)
from the [todo list](IDEAS_TODO.md), requested directly this session ("continue with B3").

**Built and unit-tested:** `src/world/bridge-mesh.ts` — `buildBridgeMesh(surface):
BridgeMeshData`. For each adjacent sample pair, emits four quads (top, underside, left
wall, right wall) plus two end caps, using a `quad(a,b,c,d,outward)` helper that *computes*
the correct winding from a desired outward direction rather than hand-deriving one winding
per strip and hoping the sign is right — this is why all 8 tests passed on the first real
run instead of the usual per-strip sign-flip debugging. 8 tests in `tests/bridge-mesh.test.ts`:
empty geometry for < 2 samples, only positive-area triangles, top-up/underside-down normals,
side walls oriented outward, exact `thickness` separation between top and underside Y,
vertex continuity at sample boundaries (every original sample's `left`/`right` corner
appears verbatim in the output), a curved bend without inverted normals, and the end-cap
triangle count.

**Named deviations from the plan's own B3 bullet, stated plainly:** "share vertices at
internal seams instead of overlapping capped boxes" is satisfied in spirit (one continuous
strip, not disconnected boxes) but not literally — every triangle gets its own 3 vertices
and a flat per-triangle face normal; there is no shared-index smooth-shaded geometry. There
is no self-intersection detection or corner beveling for a sharp bend within one surface
(unlike `road-surfaces.ts`'s 2D offset-boundary approach, which this does not port to 3D);
B2 already prevents multi-branch junctions from reaching this function at all, so "acute
junctions" here means bends within one surface, not junctions between surfaces. End caps
were added beyond the plan's explicit bullet list, so an unreplaced ground tie-in isn't a
visibly open-ended box before B3's tie-in patch exists.

**Commands/results:** `pnpm exec vitest run tests/bridge-mesh.test.ts` — 8/8 passed (written
directly from the plan's own explicit vertex/triangle-order spec, not TDD'd against a
missing-module failure — same deviation from this worktree's usual TDD-first pattern as B2,
noted rather than claimed otherwise). Full `pnpm test` — 92/92 passed. `pnpm build`
(`tsc -b && vite build`) — clean.

**Decision point reached before writing `BridgeMeshes.tsx`/wiring `details-data.ts`: measured
first, per an advisor consultation, rather than assumed.** B3 is the first task in this
sequence where deferring live wiring stops being a scope-split choice — rendering anything
requires simultaneously wiring Z2's feature retention, B1's graph, B2's solver and B3's mesh
into `details-data.ts`/`Details.tsx`/`style.ts` at once. Given F1's cost (a *smaller* live
change still failed its acceptance gate and had to be reverted), the question worth settling
first was cheap and answerable without touching any of that: **would B2 actually publish any
real bridges if wired in right now?**

**Diagnostic (read-only, no `WorldDetails`/rendering change, deleted after use — reproducible
from this transcript if a future session needs it again):**

```ts
// tests/browser/bridge-diagnostic.test.ts — throwaway, run via
// `pnpm exec vitest run tests/browser/bridge-diagnostic.test.ts --testTimeout=180000`
// against an already-running `pnpm dev` (Gamla Stan is the default preset, so no place
// selection is needed). Two non-obvious gotchas found by trial: (1) the R3F-root lookup's
// `await import(url)` must be built as a STRING passed to `page.evaluate`, not written as a
// real `import()` call site in this file — Vitest's own SSR transform rewrites literal
// import() in the test file's AST, which breaks the callback once Playwright serializes it
// to run in-browser; wrapping it in a template-string literal sidesteps the transform.
// (2) Gamla Stan is already the default preset on load, so clicking a place-selector option
// for it hits a strict-mode "resolved to 2 elements" ambiguity (the trigger button's own
// label also matches) — skip selection entirely when the desired preset is already active.
import { describe, it } from "vitest";
import { chromium } from "@playwright/test";
import { buildRoadGraph } from "../../src/world/road-topology";
import { solveBridge } from "../../src/world/bridge-profile";
import type { RoadGraph } from "../../src/world/bridge-model";
import type { WorldFeature } from "../../src/world/feature-cache";
import type { Position } from "geojson";

function reducedGraphFor(full: RoadGraph, bridgeEdgeId: string): RoadGraph {
  // solveBridge short-circuits on the FIRST failed bridge edge across the whole
  // graph (a real limitation for live use, noted below) — to tally every
  // bridge independently, reduce to one bridge edge (plus all ground edges)
  // per call instead of calling solveBridge once on the full graph.
  const edges = full.edges.filter((e) => !e.bridge || e.id === bridgeEdgeId);
  const nodeIds = new Set(edges.flatMap((e) => [e.from, e.to]));
  const nodes = full.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => ({
      ...n,
      edgeIds: edges.filter((e) => e.from === n.id || e.to === n.id).map((e) => e.id),
    }));
  return { nodes, edges };
}

describe("bridge diagnostic (throwaway)", () => {
  it(
    "measures solveBridge's ready/infeasible/incomplete split on real Gamla Stan data",
    async () => {
      const browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
      });
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      page.setDefaultTimeout(60000);
      try {
        await page.goto("http://localhost:5173");
        await page.locator(".statusbar").filter({ hasText: "World is live" }).waitFor({ timeout: 120000 });
        await page.evaluate(`(async () => {
          const url = performance.getEntriesByType("resource").map((x) => x.name)
            .find((x) => x.includes("/@react-three_fiber.js"));
          const { _roots } = await import(url);
          window.verificationRoot = _roots.get(document.querySelector(".maplibregl-canvas"));
        })()`);
        // Gamla Stan is already the default preset — no need to select it.
        await page.waitForTimeout(4000); // let camera settle and tiles/sources load

        const raw = await page.evaluate(() => {
          const s = (window as any).verificationRoot.store.getState();
          const map = s.r3m.map;
          const center = map.getCenter();
          const features = map.queryRenderedFeatures(undefined, { layers: ["roads", "bridges"] });
          return {
            zoom: map.getZoom(),
            origin: [center.lng, center.lat],
            features: features.map((f: any) => ({
              id: f.id, layerId: f.layer.id, properties: f.properties, geometry: f.geometry,
            })),
          };
        });
        console.log(`zoom=${raw.zoom} origin=${JSON.stringify(raw.origin)} rawFeatureCount=${raw.features.length}`);

        const worldFeatures: WorldFeature[] = raw.features.map((f: any, i: number) => ({
          key: `browser ${f.layerId} ${f.id ?? "anon"} ${i}`,
          source: "browser", sourceLayer: f.layerId,
          feature: { type: "Feature", id: f.id, properties: f.properties, geometry: f.geometry },
          revision: 1, completeness: "fragment",
        }));

        const origin = raw.origin as Position;
        const graph = buildRoadGraph(worldFeatures, origin);
        const bridgeEdges = graph.edges.filter((e) => e.bridge);
        console.log(`graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${bridgeEdges.length} bridge edges`);

        const tally: Record<string, number> = { ready: 0, infeasible: 0, incomplete: 0 };
        const reasons: string[] = [];
        for (const edge of bridgeEdges) {
          const reduced = reducedGraphFor(graph, edge.id);
          // Per the plan: 12% for paths (width 3), 8% for everything else.
          const maxGrade = edge.width <= 3.5 ? 0.12 : 0.08;
          const result = solveBridge(reduced, () => 0, { terrain: false, maxGrade, maxApproach: 250 });
          tally[result.status] = (tally[result.status] ?? 0) + 1;
          if (result.status !== "ready")
            reasons.push(`${edge.id} (width=${edge.width}, grade=${maxGrade}): ${result.reason}`);
        }
        console.log(`TALLY: ${JSON.stringify(tally)}`);
        for (const r of reasons) console.log(`  REJECTED ${r}`);
      } finally {
        await browser.close();
      }
    },
    180000,
  );
});
```

**Result, run 1 (`maxGrade: 0.08` for every edge — a confound caught before trusting the
number): 0/76 ready.** Zoom 15.6 at Gamla Stan (the default preset), 1148 raw
`queryRenderedFeatures` results → `buildRoadGraph` produced 4475 nodes, 5059 edges, 76 of
them `bridge: true`. All 76 were `infeasible`, none `incomplete`.

**Result, run 2 (per-class grade fixed — 0.12 for `width <= 3.5` paths, 0.08 otherwise, per
the plan's own stated visual limits, plus enriched failure reasons carrying the actual
numbers): still 0/76 ready.** The grade confound was real (many rejections in run 1 used the
wrong 8% for path-class bridges that should get 12%) but did not change the outcome. Two
roughly-equal failure populations, by the now-numeric reasons:

- **Real dense-junction rejections** — `endedAt=junction degree=3..6`, walked 1-80m against
  a required 56-103m (major/path clearance-driven transition lengths). This is the plan's own
  named tradeoff: "if a branch cannot meet it within the limits, reject the component" —
  working as designed, just far more often than a suburban/highway mental model predicts,
  because Gamla Stan's real intersection spacing (many under 20m) is nowhere near the
  56-103m these transition lengths need.
- **Genuine dead ends** — `endedAt=deadend degree=1 walked=0.0m`: the bridge's own endpoint
  node has *only* the bridge edge, no ground approach at all in the graph. Traced to
  `src/world/style.ts:23`'s `ROAD_CLASSES` filter (`geography.ts`), which is pre-existing
  and app-wide, not introduced by this plan's work: `steps` and similar pedestrian-only
  classes are excluded from the rendered `roads` layer everywhere in this app, always have
  been. Where a Gamla Stan footbridge's real-world connection is a staircase, there is no
  edge for `buildRoadGraph` to find — a genuine source-topology gap, exactly what the plan
  calls "a source limitation to resolve, not permission to describe disconnected geometry as
  finished," not a graph-construction bug.

**Explicit caveat, stated rather than buried: this is one measured location, not a survey.**
Gamla Stan is a dense pedestrian old-town core — plausibly one of the more adversarial
locations for this feature (short passages, staircases, tight junction spacing), not a
representative sample of "a bridge over a highway with an ordinary road on each end." A
better number from a different city would not change what needs to be decided next; it would
only relocate the same open question. Per an advisor consultation, testing a second location
to look for a better number was deliberately not done.

**Also discovered and fixed while building the diagnostic, kept as a real improvement:**
`solveBridge` reasons were previously text-only ("hits a junction before the required
transition completes") with no numbers attached, making exactly this kind of measurement
impossible without instrumenting the source. `walkApproachChain`'s `ChainWalk` now carries
`endNodeDegree`, and the `infeasible` reason strings in `solveOneBridge` include
`walked=`/`required=`/`endedAt=`/`degree=` — diagnosable failures instead of opaque ones,
independent of whatever B3 or B2 does next. Re-ran `tests/bridge-profile.test.ts` after this
change (the `.toMatch(/junction/)`/`.toMatch(/too short/)` assertions still match the longer
strings) — 14/14 still pass, full suite 92/92, `tsc -b` clean.

**Also worth carrying forward, not acted on:** `solveBridge` returns on the *first* failed
bridge edge across the entire input graph — with 76 bridge edges in one view, a single
unsolvable one would suppress every other bridge, including any that would have published.
The diagnostic's `reducedGraphFor` workaround (call `solveBridge` once per bridge edge on a
graph reduced to just that edge plus all ground edges) is a preview of what real wiring
needs: a per-component call, not one call across a whole tile's worth of bridges.

**Not built:** `WorldDetails.bridges`, `BridgeMeshes.tsx`, and every `details-data.ts`/
`Details.tsx`/`style.ts` wiring bullet in B3's list — matting the terminal vertices to Z3's
(still-unwired) `roadFootprint`, the terrain-following tie-in patch, and masking the old
`collectBridgeParts()` boxes for published intervals. None of these were attempted; building
them now, before the finding above is addressed, would very likely produce a feature that
compiles, passes its own unit tests, and renders zero bridges in the running app — exactly
the outcome this diagnostic was run to avoid discovering only after writing the render code.

**Next action — a decision for whoever picks this up next, not a plan already chosen:** B3's
render wiring is blocked on B2's approach model, not on anything in B3 itself. Three
candidate directions, not mutually exclusive:

1. Treat a junction as a ground-anchor (its own sampled/assumed elevation) instead of an
   automatic rejection, *while keeping the fit check* — a junction can anchor a transition
   only when the transition still fits before it, never "junction found, therefore accept."
2. Re-derive the clearance constant for a *ramped* model instead of inheriting
   `collectBridgeParts()`'s value, which was calibrated for a flat floating box that never
   had to climb anywhere. A real short urban bridge sitting near grade shouldn't need a
   56-103m ramp to clear a few meters of clearance that only exists because the constant
   says so.
3. Accept a low real-world publish rate as correct, and build the fallback path the plan
   already specifies for unresolved components (visible fallback count, prior valid model
   retained, or ground/overview rendering) — B5's completion criteria explicitly requires
   reporting both passing reconstructions *and* fallback/unresolved components, so a low
   number is not itself a failure if the fallback path exists and is honest about it.

This needs the user's input on which direction (or mix) to pursue, not another diagnostic
round — the measurement question is settled.

## 2026-09-12 — B2 revisited: junction-as-anchor tolerance (option 1), measured — insufficient alone

**Task:** the user's explicit choice among B3's three candidate directions: "go with option 1:
junction-as-anchor, keep the fit check." Per an advisor consultation on the exact mechanics
before writing code (see below — the first proposed shape was a no-op; a second pass
produced the actual fix), implemented and re-measured against the same real Gamla Stan data
as the prior B3 entry.

**False start, caught before coding:** the initial framing of "junction as anchor" was
"stop the walk at the junction, but don't auto-reject — recompute using the junction's own
position." Checking the existing code showed this is what `resolveSide` **already did** —
`groundAtAnchor` was already sampled at wherever the walk stopped, junction or not. A second
framing ("continue walking past a junction along the straightest edge, using a much longer
distance for the fit check") was also checked by hand and found to be a no-op: the fit check
compares against the *nearest* junction's distance either way, and that distance doesn't
change whether the walk stops there or keeps going past it. Neither of these would have
changed a single one of the 76 measured rejections. Caught via advisor consultation before
writing either version.

**The actual fix:** the plan's implicit requirement was "the transition must be **fully**
complete before any junction, or reject" — physically stronger than necessary, since a real
side street can absorb a small height mismatch over its own first few meters; it cannot
absorb meeting a ramp mid-climb. Replaced the exact-fit check with a tolerance on the
**height gap** at the junction, not the distance: `residualHeightGap(side)` evaluates the
already-existing smoothstep formula at the junction's actual distance
(`t = 1 - walked/transitionLength`) and compares `|rise × smoothstep(t)|` against a new
exported `JUNCTION_HEIGHT_TOLERANCE` (0.5 m, chosen as "small enough for a side street to
absorb over its own first few meters," not derived from source data). This is a strict
superset of the old behavior: once `walked >= transitionLength`, `smoothstep` clamps to 0 and
the residual is exactly 0, matching every previously-passing case unchanged. The walk itself
(`walkApproachChain`) is untouched — it still stops at the first junction; no "pick the
straightest continuation and keep walking" logic was built, since the analysis above showed
it wouldn't change the outcome.

**Fixed a real geometry bug this tolerance introduces:** allowing `residual > 0` means the
chain can now stop *short* of the full `transitionLength` and still be accepted. The old
`buildSideSamples` generated sample stops across the full `[0, transitionLength]` range
regardless of how far the chain's actual geometry reached; `pointAtDistance` clamps to the
last real point past that range, so several samples would land at the *same* (x, z) with
*different* heights (the height formula doesn't clamp) — a vertical stack, not a continuous
profile. Fixed by clamping the stop-generation range to
`effectiveLength = min(transitionLength, chain.totalLength)` while keeping the *original*
`transitionLength` in the height formula, so the accepted residual gap shows up correctly at
the true end of the walked geometry instead of being smeared across phantom stacked points.

**Tests added to `tests/bridge-profile.test.ts`** (16 total now, up from 14): a junction at
~0.85× the required length (47 m of 55 m, hand-computed residual ≈0.32 m) now passes where it
previously would not have (there was no prior test at this exact ratio, so this isn't a
changed assertion, it's new coverage of the new behavior); and — the explicit "never
junction-found-therefore-accept" guard the user asked to keep — a junction at 42 m of the
same 55 m requirement (hand-computed residual ≈0.78 m) still correctly rejects, closer to the
requirement than the fixture that has always rejected but still over tolerance. Both hand
computations matched the actual test output exactly on the first run. The two pre-existing
junction fixtures (20 m/rejects, 150 m/accepts) were re-verified by hand against the new
formula and required no changes — 20 m gives residual ≈3.85 m (still rejects), 150 m gives
residual 0 (`walked > transitionLength` clamps `smoothstep`'s argument to 0, unchanged).

**Commands/results:** `pnpm exec vitest run tests/bridge-profile.test.ts` — 16/16 passed.
Full `pnpm test` — 94/94 passed. `pnpm build` — clean, no type errors.

**Measured against real Gamla Stan data again (same reproduction steps as the prior B3
entry's diagnostic — recreated, run, deleted, per the established throwaway-diagnostic
pattern): still 0/76 ready.** This is a real, precise finding, not a restatement of the
prior one — the diagnostic's per-edge output shows several **individual sides** did flip
from reject to accept under the new tolerance (e.g., bridge `e30`'s *start* approach, which
previously failed at `walked=71.5m required=84.4m`, now passes silently — the reported
rejection reason shifted to its *end* approach instead, which has its own, much closer,
junction). But **zero bridges had both ends pass simultaneously** in this sample. An advisor
estimate before this measurement predicted "roughly 3-5 of 76" would flip to fully ready;
the actual number is 0 — worth stating precisely rather than rounding the estimate up to
match, since the estimate was reasoning from partial data (a handful of promising-looking
ratios in the logged output) that turned out not to survive requiring *both* ends to clear
the bar at once.

**Why the gap is this large, stated plainly:** required transition lengths in this dataset
run 37.5-112.5 m (driven by the clearance constant + `maxGrade`, unchanged by this task).
Real Gamla Stan block/junction spacing is very often under 20 m. A 0.5 m height-gap
tolerance only rescues a junction sitting at roughly 85%+ of the required distance already —
it cannot bridge a junction at 10-50% of that distance, which is the overwhelming majority
of this measured sample. Option 1 is implemented correctly and is a real, defensible
improvement (it removes a needlessly strict exact-match requirement, correctly named and
tested), but it is **not sufficient on its own** to make real dense-urban bridges publish.
The dominant lever remains option 2 (the clearance/grade requirement itself, inherited from
a flat non-ramped renderer) — this session's own earlier finding, unchanged by today's work.

**Not built:** the "continue past a junction" walk redesign (deliberately — shown to be a
no-op before writing it), any change to `walkApproachChain`'s stopping behavior, and no
further changes to the clearance constant (`clearanceFor`) or B3's live wiring — this task
was scoped to option 1 alone, as the user specified.

**Next action — still a decision for the user, now with a precise number attached:** option 1
is landed and verified; it is real but small. Option 2 (recalibrate clearance for a ramped
model rather than a floating flat box) or option 3 (accept a low publish rate and build the
plan's own specified fallback path) remain the candidates that would actually move the
measured number. Recommend deciding between them, or combining both, before resuming B3's
live wiring.

## 2026-09-12 — B2 revisited again: clearance recalibrated for a ramped model (option 2), measured — real improvement, still mostly blocked by missing topology

**Task:** the user's explicit choice among the remaining B3 candidates: "go with option 2:
recalibrate clearance for a ramped model." Per an advisor consultation on the exact
calibration before writing code (see below — a first draft collapsed a tier too far), then
re-measured against the same real Gamla Stan data as both prior B3/B2 entries.

**The recalibration:** `clearanceFor(major, layer)` in `bridge-profile.ts` — previously an
exact copy of `collectBridgeParts()`'s `(major ? 4 : 3) + min(layer, 2) * 1.5`, tuned for a
floating box that never had to connect to ground — is now tiered by what `layer` actually
signals rather than scaled continuously: `layer <= 0` (spans a gap/water at near-grade) gets
a small structural minimum (1.0m major / 0.6m other); `layer === 1` (the default, ambiguous
OSM bridge tag — the overwhelming majority of real tagged bridges) gets a modest, non-highway
value (2.0m major / 1.2m other); `layer >= 2` (a much rarer, stronger signal of genuine
multi-level grade separation) keeps roughly the old value (4.5m major / 3.5m other). A first
draft collapsed `layer <= 1` into one tier at the smallest value — caught before writing any
tests: at major/layer-1 that gives 1.0m of clearance for what could be a 14m-wide trunk-road
deck, which reads as a kerb, not a bridge, and would have overshot in a way indistinguishable
from "option 2 works" in the diagnostic tally alone. The three-tier version keeps the
real-overpass case intact instead of discarding it.

**Deliberately not applied to `collectBridgeParts()` in `structures.ts`:** its inline copy of
the old formula still serves the currently-shipping floating-box renderer, which genuinely
needs a cosmetic gap since nothing connects to it — recalibrating it would change today's
shipping visual for no reason tied to this task. The two clearance formulas were never a
shared-policy invariant the way Z1's `roadDimensions`/`roadColor` are, so this divergence is
intentional, not an inconsistency to fix.

**Named tradeoff, stated rather than hidden:** a layer-1-tagged bridge that is *actually* a
tall crossing now gets too little clearance under this heuristic. Correctly distinguishing
that case would require knowing what specific feature passes underneath a bridge's span —
which needs the 2D-crossing geometry `road-topology.ts`'s graph construction deliberately
discards (`layer` is relative ordering, not elevation; see BRIDGE_CONNECTIVITY_PLAN.md's "a
2D crossing is not evidence of a junction"). Building that detection is future work, not
attempted here.

**Test-fixture churn, all recomputed by hand before running (matched actual output every
time, same discipline as prior sessions):** every numeric fixture tied to the old 5.5m
major/layer-1 clearance in `tests/bridge-profile.test.ts` needed updating, since
`READY_MAX_GRADE = 0.15` now sizes the required transition at exactly 20m (was 55m). Recomputed
and updated: the ready-profile deck-height assertion (5.5 → 2), the "too short" fixture's
approach length (previously 20m, now exactly at the new boundary — shortened to 5m to stay
clearly infeasible), both endpoint-height/ground-bump deck-height assertions (+5.5 → +2), and
all four junction-distance fixtures (a 20m junction is now past the new 20m requirement, so
moved to 5m to keep rejecting; the two option-1 tolerance fixtures moved from 47m/42m to
18m/12m to sit at the same ~0.9L/~0.6L ratios against the new, shorter L). Added one new test
pinning the `layer >= 2` tier (a bridge whose approach is also layer 1, since B1's
`layersCompatible` only connects a bridge to a layer differing by exactly 1 — a layer-2
bridge can never be reachable from a layer-0 approach in this graph) — asserts deck height
stays at 4.5m, confirming the grade-separation tier wasn't accidentally collapsed too.

**Commands/results:** `pnpm exec vitest run tests/bridge-profile.test.ts` — 17/17 passed (16
recalibrated + 1 new). Full `pnpm test` — 95/95 passed. `pnpm build` — clean.

**Prediction, written down before running the diagnostic:** per an advisor consultation using
the new required lengths (major/layer-1: 103.1 → 37.5m; other/layer-1: 84.4 → 22.5m at
`maxGrade` 0.08; path/layer-1: 56.3 → 15m at 0.12) against the walked distances already
logged from the prior two diagnostic runs, roughly 6 individual approach *sides* looked likely
to clear the new bar (e47 82.5m, e30-start 71.5m, e5045 80.3m, e3 49.1m, e31 41.5m, e4/e5
35.0m) — translating to a rough estimate of 10-20 of 76 *bridges* fully ready, given each
needs both ends to clear, and the ~30-edge `walked=0.0m degree=1` dead-end population
(pre-existing, topology-missing, unrelated to clearance) would not move at all.

**Measured: 9 of 76 ready** (`{"ready":9,"infeasible":67,"incomplete":0}`) — a real, precise
jump from 0/76 across both prior attempts, landing at the low end of the predicted range
rather than inside it, which is worth stating exactly rather than rounding the estimate to
fit. `e0`, `e3`, `e8`, `e9`, `e30`, `e31`, `e37`, `e38`, `e41` published. The dead-end
population (`walked=0.0m degree=1`) is entirely unaffected, exactly as predicted — no
clearance value fixes a missing edge. Several near-misses now sit just barely over the 0.5m
tolerance (`e5048` residual 0.51m, `e5056` residual 0.52m, `e5054` residual 0.69m) — evidence
the two option-1/option-2 changes are compounding as intended, not fully independent, though
no further tuning of either constant was done here since neither was asked for beyond what
the user specified.

**Also confirmed working as designed, not just by construction:** four bridges in this sample
(`e42`-`e45`) are genuinely tagged `layer=2` in real OSM data — their required lengths came
out at 65.6m/43.8m (the grade-separation tier), not 22.5m/15m, confirming the tier selection
is reading real data correctly, not just satisfying the unit test's synthetic fixture. All
four still failed (dead ends), unrelated to the tier logic itself.

**Not built:** any further tuning of `JUNCTION_HEIGHT_TOLERANCE` or the clearance constants
to chase a higher number, 2D-crossing detection for genuinely distinguishing a tall layer-1
crossing from a low one, and no B3 live wiring — the render-nothing risk that started this
whole measurement thread is smaller now (9/76 would publish something) but the majority
(67/76, mostly the dead-end population) still would not.

**Next action — for the user:** two candidates from the original three remain live: continue
narrowing the gap (the dead-end population is the largest remaining bucket and is a data/
topology problem — `steps`-class exclusion and possible graph fragmentation — not a B2
parameter problem, so neither option 1 nor option 2 touches it), or accept the current
publish rate and build B3's live wiring now with the plan's own fallback path for the
majority that won't publish (retain prior model, or ground/overview rendering, per B5's
completion criteria requiring both counts reported). A third option not yet named: investigate
the dead-end population directly (is it really all stairs, or is some of it graph
fragmentation from tile clipping that Z2's `reconcileFeatures` — still unwired — would fix?)
before deciding between the other two.

## 2026-09-12 — B3 dead-end population investigated (no code change)

**Task:** the user asked to investigate the `walked=0.0m degree=1` dead-end population (the
largest remaining bucket after option 2's 9/76 measurement) before deciding whether to pursue
a further fix or move to B3 live wiring. This is an investigation, not a fix: no production
file changed.

**Correction to the 2026-09-11 (option-2) entry and to IDEAS_TODO.md's B3 line:** both state
the dead-end cause as "e.g. `steps`-class exclusion or possible tile-fragmentation." The
`steps`-class-exclusion half of that guess is **wrong** and should not be relied on. `class:
"path"` is in `ROAD_CLASSES` (`src/world/geography.ts`) and is not excluded; `steps` and
`footway` both arrive from the live vector tiles as `class="path"` with a `subclass` of
`"steps"`/`"footway"`, so they are not filtered out by `isPhysicalRoad`/`ROAD_CLASSES` at all.
Measured directly below: only 2 of 37 dead-end endpoints have `steps` as the nearest raw
feature. The real causes are graph-topology gaps, detailed below.

**What was built (throwaway):** `tests/browser/deadend-diagnostic.test.ts`, deleted after use
per this worktree's established discipline. For every bridge-edge endpoint that landed as a
degree-1 node in the built graph (a dead end), it re-queried MapLibre's rendered features
directly (bypassing `buildRoadGraph`'s snapping) and searched a 15m radius around that
endpoint's position for the closest raw point from any other feature, reporting its OSM
`class`/`subclass`/`layer`/`brunnel` and whether `layersCompatible` would accept it. Full
script as run:

```ts
// THROWAWAY DIAGNOSTIC — not part of the permanent suite, deleted after use.
// Investigates the walked=0.0m/degree=1 dead-end population found in the B3
// diagnostics: for each bridge endpoint with no connecting ground edge in the
// built graph, scan ALL raw queried features (not just the ones that made it
// into the graph) within a radius and categorize what's actually there.
import { describe, it } from "vitest";
import { chromium } from "@playwright/test";
import { buildRoadGraph } from "../../src/world/road-topology";
import { localMeters } from "../../src/world/geography";
import type { RoadGraph, Vec3 } from "../../src/world/bridge-model";
import type { WorldFeature } from "../../src/world/feature-cache";
import type { Position } from "geojson";

const SEARCH_RADIUS = 15; // meters

function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

describe("dead-end diagnostic (throwaway)", () => {
  it("categorizes what's near each dead-end bridge endpoint", async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(60000);
    try {
      await page.goto("http://localhost:5173");
      await page.locator(".statusbar").filter({ hasText: "World is live" }).waitFor({ timeout: 120000 });
      await page.evaluate(`(async () => {
        const url = performance.getEntriesByType("resource").map((x) => x.name)
          .find((x) => x.includes("/@react-three_fiber.js"));
        const { _roots } = await import(url);
        window.verificationRoot = _roots.get(document.querySelector(".maplibregl-canvas"));
      })()`);
      await page.waitForTimeout(4000);

      const raw = await page.evaluate(() => {
        const s = (window as any).verificationRoot.store.getState();
        const map = s.r3m.map;
        const center = map.getCenter();
        const layers = ["roads", "bridges"].filter((id: string) => map.getLayer(id));
        const features = map.queryRenderedFeatures(undefined, { layers });
        return {
          origin: [center.lng, center.lat],
          features: features.map((f: any) => ({
            id: f.id, layerId: f.layer.id, properties: f.properties, geometry: f.geometry,
          })),
        };
      });
      console.log(`rawFeatureCount=${raw.features.length}`);

      const origin = raw.origin as Position;
      const worldFeatures: WorldFeature[] = raw.features.map((f: any, i: number) => ({
        key: `browser ${f.layerId} ${f.id ?? "anon"} ${i}`,
        source: "browser", sourceLayer: f.layerId,
        feature: { type: "Feature", id: f.id, properties: f.properties, geometry: f.geometry },
        revision: 1, completeness: "fragment",
      }));

      const graph: RoadGraph = buildRoadGraph(worldFeatures, origin);
      const bridgeEdges = graph.edges.filter((e) => e.bridge);
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

      type RawPoint = { point: Vec3; properties: Record<string, unknown> };
      const rawPoints: RawPoint[] = [];
      for (const f of raw.features as any[]) {
        const lines =
          f.geometry.type === "LineString" ? [f.geometry.coordinates]
          : f.geometry.type === "MultiLineString" ? f.geometry.coordinates
          : [];
        for (const line of lines)
          for (const p of line) rawPoints.push({ point: localMeters(p, origin), properties: f.properties });
      }

function layersCompatible(a: number, b: number, aBridge: boolean, bBridge: boolean): boolean {
  if (a === b) return true;
  return Math.abs(a - b) === 1 && (aBridge || bBridge);
}

      let deadEndCount = 0;
      const bucket = { snapMiss: 0, layerIncompatible: 0, nothing: 0 };
      for (const edge of bridgeEdges) {
        for (const nodeId of [edge.from, edge.to]) {
          const node = nodeById.get(nodeId);
          if (!node || node.edgeIds.length !== 1) continue; // not a dead end
          deadEndCount++;
          const nearby = rawPoints
            .map((rp) => ({ ...rp, distance: dist2D(rp.point, node.position) }))
            .filter((rp) => rp.distance > 0.01 && rp.distance <= SEARCH_RADIUS)
            .sort((a, b) => a.distance - b.distance);

          if (nearby.length === 0) {
            bucket.nothing++;
            console.log(`  edge=${edge.id} node=${nodeId} (layer=${edge.layer}): NOTHING within ${SEARCH_RADIUS}m`);
            continue;
          }
          const closest = nearby[0];
          const otherLayer = Math.max(0, Number(closest.properties.layer) || 0);
          const otherBridge = closest.properties.brunnel === "bridge";
          const compatible = layersCompatible(edge.layer, otherLayer, true, otherBridge);
          const cls = String(closest.properties.class ?? "?");
          const subclass = closest.properties.subclass ? String(closest.properties.subclass) : undefined;
          const reason = !compatible ? "LAYER-INCOMPATIBLE" : "snap-distance-miss";
          if (!compatible) bucket.layerIncompatible++;
          else bucket.snapMiss++;
          console.log(
            `  edge=${edge.id} node=${nodeId} (edgeLayer=${edge.layer}): ${reason} — closest class="${cls}"` +
              `${subclass ? `/subclass="${subclass}"` : ""} at ${closest.distance.toFixed(1)}m ` +
              `(otherLayer=${otherLayer}, otherBridge=${otherBridge})`,
          );
        }
      }
      console.log(`TOTAL dead-end endpoints: ${deadEndCount}`);
      console.log(`BUCKETS: ${JSON.stringify(bucket, null, 2)}`);
    } finally {
      await browser.close();
    }
  }, 180000);
});
```

**Commands/results:**
```
pnpm exec vitest run tests/browser/deadend-diagnostic.test.ts --testTimeout=180000
```
Against the same Gamla Stan view used for all three prior diagnostics: 37 dead-end endpoints
total, bucketed by the script's naive `layersCompatible` distance check as `snapMiss: 25`,
`layerIncompatible: 5`, `nothing: 7`. That headline bucketing is misleading on its own — see
below for the breakdown that actually explains what's fixable.

**What the 25 "snap-miss" endpoints actually are, split by the neighbor's own tags:**
- **~5 are bridge-to-*ground*** near-misses: the nearest raw point is `layer=0`,
  non-bridge, `class="path"` with `subclass="steps"` or `"footway"`, 1.9-6.9m away (plus one
  `subclass="cycleway"` at 2.8m). These are genuinely just outside `SNAP_DISTANCE` (0.5m) and
  are the only part of this bucket a snap-tolerance change could plausibly help.
- **~20 are bridge-to-*bridge*** near-misses: the nearest raw point is itself
  `brunnel="bridge"` at the same layer, 2-13m away. Connecting these would not produce a
  ground approach — it would only stitch two bridge fragments into a longer bridge, which
  would still dead-end at both new ends with nothing to ramp down to. **Widening
  `SNAP_DISTANCE` for this group fixes zero bridges by itself.** This is the more useful
  finding: it means a large share of the 76 `bridge`-tagged edges measured in the option-2
  diagnostic are not 76 independent structures but fragments of a smaller number of real
  footbridges, split at tile or digitization boundaries. That reframes the B1 "76 bridge
  edges" count from a prior entry — it was never fully resolved and this data explains a good
  part of it.

**What the 5 "layer-incompatible" endpoints are:** all four `layer=2` bridges from the
option-2 entry (`e42`-`e45`), rejected against `layer=0` ground neighbors under
`layersCompatible`'s diff-of-1 rule. Two of these (`e44` at 0.7m, `e45` at 0.2m) are already
**within or at `SNAP_DISTANCE`** — they are rejected purely on the layer-diff-of-2 rule, not
distance. This is a smaller, more targeted candidate than a snap-distance change: allowing
`layersCompatible` to accept a diff of 2 when one side is a bridge would connect these two
with **no change to `SNAP_DISTANCE` at all**, so it would not interact with the parallel-roads
guard test at all. It only reaches 2 (at most 4, if the other two also turn out ready after
reconnecting) of the 76 bridges, not more.

**What the 7 "nothing within 15m" endpoints are:** a genuine absence of any transportation
feature nearby in the currently-rendered tile data — a real source/tile data gap, not fixable
by any graph parameter.

**Tension identified, not resolved:** the ~5 genuine bridge-to-ground snap-misses sit in the
2-6.9m range. `tests/road-topology.test.ts` has an existing, deliberately-designed test
("does not merge parallel roads 2m apart") guarding against exactly a blanket
`SNAP_DISTANCE` increase into that range, because divided carriageways and street/sidewalk
pairs elsewhere in real data sit at the same scale. A blanket increase would fix ~5 dead ends
here while risking false merges elsewhere in the graph. A bridge-aware version (larger
tolerance only when at least one candidate endpoint belongs to a `brunnel=bridge` edge) was
considered as a narrower alternative but not designed or coded — it wasn't asked for and
needs its own test coverage against the parallel-roads case before being trusted.

**Honest addressable ceiling from this bucket, stated plainly:** of 37 dead-end endpoints,
**~27 (20 bridge-to-bridge fragments + 7 genuine gaps) are not reachable by any snap- or
layer-parameter change** — they need either real topology stitching across bridge fragments
(out of scope for B1's current design) or are missing from the source data entirely. **~5**
are genuine bridge-to-ground near-misses a bridge-aware snap tolerance could plausibly fix.
**~5** are layer-2/layer-0 jumps, of which 2 sit within existing `SNAP_DISTANCE` and could be
connected by relaxing `layersCompatible`'s diff-of-1 rule for bridges specifically, with no
snap-distance change at all. Neither change was implemented this entry.

**Not built:** any change to `SNAP_DISTANCE`, `layersCompatible`, or any other production
code — this was scoped as investigation only, per the user's request.

**Next action — for the user:** three options now stand, more precisely characterized than
before: (a) implement the two small, targeted, low-risk changes identified above (bridge-aware
diff-of-2 `layersCompatible` exception, and/or a bridge-aware wider snap tolerance with new
test coverage against the parallel-roads guard) for a realistic gain of roughly 5-9 more ready
bridges combined — worth doing only if the user wants to keep chasing this number before B3
wiring; (b) accept the current 9/76 rate, correct as a genuine data/topology ceiling for most
of the remainder (bridge-fragment stitching is out of scope, 7 are missing source data), and
proceed to B3 live wiring now with the plan's required fallback path for bridges that don't
solve; (c) treat the ~20 bridge-to-bridge fragmentation finding as its own investigation (how
many *distinct* real structures does Gamla Stan actually have once fragments are merged?)
before deciding anything else, since it recolors what "76 bridges" has meant in every
diagnostic so far.

## 2026-09-12 — B1 targeted dead-end fixes implemented, measured, one reverted on evidence

**Task:** following the dead-end investigation above, implement the two small, targeted
candidates it identified: a bridge-aware wider endpoint-snap tolerance, and a
`layersCompatible` diff-of-2 exception for bridges. TDD throughout (`superpowers:test-driven-development`).

**What was built:**
1. `layersCompatible(a, b, aBridge, bBridge)` in `src/world/road-topology.ts` now accepts a
   layer difference of 2 (was capped at 1) when at least one side is a bridge, so a
   grade-separated (`layer >= 2`) bridge can connect directly to `layer 0` ground with no
   intermediate layer-1 element. New tests: "connects a grade-separated bridge directly to
   ground two layers below at a shared endpoint" and "still refuses a three-layer jump even
   when one side is a bridge" (pins the boundary).
2. A bridge-aware `BRIDGE_SNAP_DISTANCE` (7m, derived from the diagnostic's observed 1.9-6.9m
   bridge-to-ground near-miss range) widening `clusterFor`'s endpoint-clustering radius only
   when at least one candidate cluster/point was a bridge. New tests for the connect/gate/
   reject boundaries were written and passed in isolation.

**Bug found and fixed along the way (kept, independent of either candidate above):**
implementing #2 immediately crashed an *existing* test (`bridge-profile.test.ts`'s "too short"
case) with `TypeError: Cannot read properties of undefined (reading 'edgeIds')`. Root cause:
in `clusterFor`, when a new point matches more than one existing cluster at once, all but one
(`primary`) are merged into it and spliced out of the live `clusters` list — but any
`BuiltEdge` already constructed before that merge still holds a *direct object reference* to
the now-removed cluster, and that object's own `.id` was never updated. The final `nodes`
list is built only from what remains in `clusters`, so an edge referencing the stale id points
at a node that was never created — exactly the `nodeById.get(...)` crash. This is a genuine
latent defect in B1, not something introduced by either candidate; the widened radius just
made colliding matches far more likely to occur. **Fix:** when merging, reassign the absorbed
cluster's own `id` field to the primary's (`m.id = primary.id`) so any stale reference resolves
correctly. Regression test added: "never produces an edge endpoint id with no matching node,
even when one new point matches two previously-separate clusters at once" — reproduced under
the *ordinary* 0.5m `SNAP_DISTANCE` alone (three collinear-ish segments arranged so a third
point lands within 0.5m of two already-separate clusters 0.98m apart), so it stays a permanent
regression guard independent of either candidate's fate below.

**Commands/results (unit level):** `pnpm exec vitest run tests/road-topology.test.ts` — 19/19
passed. Full `pnpm test` — 101/101. `pnpm exec tsc -b` — clean.

**Real-data measurement, round 1 (both candidates active):** re-ran the same
`bridge-diagnostic.test.ts` methodology used for options 1/2, against the same live Gamla Stan
view. Result: **76 -> 61 bridge edges** (confirms the dead-end investigation's bridge-
fragmentation finding — many of the original 76 were fragments of fewer real structures, now
correctly joined by the wider tolerance via the existing `joinBridgeChains`), but **ready
dropped from 9 to 3** — a regression, not an improvement. Rejection reasons showed the
mechanism directly: dozens of edges failed with `walked=0.0m` and `residual` equal to *exactly*
the full clearance value (e.g. `1.20m` for every width-3 path bridge) — the unmistakable
signature of the same defect the regression test above targets: the widened radius was
swallowing both endpoints of short (sub-7m) real approach stubs into the neighboring junction
node, deleting the very edges some already-`ready` bridges' approach chains depended on.

**Correction, consulted via advisor before tuning further:** the constant itself is not the
problem — 3m, 5m, or any other single value would just delete a different arbitrary set of
real short approach stubs, because one endpoint-clustering distance threshold cannot
distinguish "a bridge endpoint that should reach nearby ground" from "both ends of a short
approach edge that must stay independent." **`BRIDGE_SNAP_DISTANCE` was reverted entirely** —
see the comment left in its place in `road-topology.ts` for a future session. The
dangling-reference fix and its regression test were kept (general correctness, independent of
any threshold), and the `bridge-profile.test.ts` fixture length that had been bumped from 5m to
10m to dodge the collapse was reverted back to 5m once the widening was gone.

**Real-data measurement, round 2 (diff-of-2 layer exception only, snap widening reverted):**
same methodology. Result: **76 bridge edges** (confirms the revert restored the original
count) and **ready = 9, unchanged**. Prediction written down before this run (per advisor): 9
(no change) to 13, depending on whether the two `layer=2` bridges near existing `SNAP_DISTANCE`
(`e44`, `e45`) also had a working far end. Measured result landed at the low end of that range
— a **clean negative result**, not a bug: `e44`/`e45` still show `endedAt=deadend degree=1`
(and `e42`/`e43` still fail at a junction) for their start approach, meaning whatever actually
blocks them is not resolved merely by permitting the diff-of-2 layer jump. This was not
root-caused further (diminishing return relative to the question actually being asked), but
the diff-of-2 rule itself is independently correct — pinned by its own unit tests — and
measured to cause no regression (bridge count and ready count both unchanged from the
pre-existing 9/76 baseline), so it was kept rather than reverted.

**Conclusion: no B1 parameter change available today moves the 9/76 number.** The dead-end
investigation's ~10/37 "addressable" estimate from the prior entry is **corrected down to
effectively 0 measured** — the wider-snap-tolerance candidate is a net regression and was
reverted, and the diff-of-2 layer candidate, while kept for its own correctness, measured no
change. The 9/76 publish rate is the real ceiling this worktree has found without a design
change bigger than a parameter tweak (e.g., true bridge-fragment stitching that doesn't also
touch short approach edges, which was flagged but not attempted).

**Not built:** any further threshold tuning (ruled out above), fragment-aware stitching that
distinguishes "bridge fragment endpoint" from "approach-edge endpoint" before applying a wider
radius, and no B3 live wiring.

**Next action — for the user:** the investigation-and-fix cycle on B1 parameters is now
closed with a clear, measured answer. Two paths remain: accept 9/76 as the real ceiling and
build B3's live wiring now with the plan's required fallback path for the rest (this is now
the better-supported option, since the "quick win" alternative was tried and didn't pan out);
or take on the larger, undesigned effort of fragment-aware bridge stitching (distinguish a
bridge-fragment-to-bridge-fragment join, which should get a wider radius, from an
approach-edge's own two endpoints, which must not) as its own scoped task before touching B3.

## 2026-09-12 — Data-corruption bug found and fixed: NUL bytes standing in for spaces

**Task:** none directly — found while investigating why `origin/main` looked broken after a
local merge of PR #6 (see the two entries below). Recorded separately since it's a real,
pre-existing source bug independent of the merge.

**What was found:** `src/world/feature-cache.ts` (`featureKey`, `entityIdentity`) and
`tests/fixtures/bridge-network.ts` (`roadFeature`'s `key` field) each build a composite string
key with a template literal that visually reads `` `${a} ${b} ${c}` `` in every editor, diff
view, and this session's own prior `Read` tool calls — but a byte-level scan (`python3` reading
the file in binary mode; ordinary `grep`/bash `$'\x00'` patterns are unreliable here since bash
strips NUL from its own argument vectors) showed the separator was an actual `0x00` byte in the
committed file, not `0x20` (space), in all 5 occurrences in the first file and all 3 in the
second. This is invisible to every tool that renders or diffs text normally, and invisible to
every existing test, since `tests/feature-cache.test.ts` only ever compares
`featureKey(...)` against another `featureKey(...)` call — never against a literal string
containing the separator. The corruption predates this session (confirmed present in the very
first commit made from this worktree, `ff55b1e`, meaning it was already on disk when
`feature-cache.ts` was authored in an earlier session) and did not previously cause a visible
failure because Z2 (which would consume `featureKey`) has zero call sites — it has never run
against real data.

**Fix:** replaced the NUL bytes with literal space characters (`0x20`) in both files, matching
what the source visibly reads as and evidently was always intended to be. Added a regression
test to `tests/feature-cache.test.ts` ("joins its parts with literal ASCII spaces, not control
characters") asserting the key splits into exactly 4 space-separated parts and every character
code is >= `0x20`, so this exact invisible-corruption class can't reappear undetected.

**Commands/results:** `pnpm exec vitest run` — 99/99 passed (98 + 1 new). `pnpm exec tsc -b` —
clean.

**Not investigated further:** how the corruption was introduced (a prior session's tool
pipeline, an editor, or a copy/paste step) — worth a mental note for future sessions writing
files with composite string keys, but not reproduced or root-caused here.

## 2026-09-12 — `origin/main` found with unresolved merge-conflict markers after local merge

**Context:** after PR #6 was merged and pushed, `origin/main` advanced further with two more
commits made directly by the user, outside this session: `0e510ba` ("aaaa", adding an earlier/
stale draft of the same docs files this session's PR also touched) and `3b026ce`, a merge
commit reconciling `0e510ba` with this session's PR (`4dcb661`). That merge was not actually
finished: it left literal, uncommitted-looking but **actually committed**
`<<<<<<<`/`=======`/`>>>>>>>` conflict markers directly in three tracked files, plus five
leftover merge-tool backup files.

**Found via `git grep -n -E '^(<{7}|={7}|>{7})( |$)' origin/main` (the same pattern the repo's
own `scripts/check-merge-markers.sh` uses, run directly against the remote tree since the
local worktree here is on a different branch):**
- `docs/FACADE_COVERAGE_PLAN.md` (lines 34-53) and its own conflicted duplicate,
  `docs/FACADE_COVERAGE_PLAN.md.orig`
- `docs/IDEAS_TODO.md` (lines 36-140) and its own conflicted duplicate,
  `docs/IDEAS_TODO_BACKUP_59239.md`
- `docs/IDEAS_WORK_LOG.md` (lines 29-1363)
- Additional stray artifact files with no markers of their own but no reason to exist in
  history: `docs/IDEAS_TODO_BASE_59239.md` (empty), `docs/IDEAS_TODO_LOCAL_59239.md`,
  `docs/IDEAS_TODO_REMOTE_59239.md`

**Inspected each conflict by hand before resolving anything** (`git show origin/main:<path>`):
in every case, the `HEAD` side (`0e510ba`) is a stale, less-detailed skeleton draft of the exact
same section this session's PR (`4dcb661`, the `=======`-to-`>>>>>>>` side) already wrote in
full, measured detail — e.g. `IDEAS_TODO.md`'s `HEAD` side is nine one-line unchecked
checkboxes with no detail, while the PR side is the fully-annotated version with every
measured B1/B2/B3 finding this worktree's sessions produced. No case required merging content
from both sides; the PR side is a strict superset. Resolution: keep the PR side entirely,
delete the `HEAD` side and all five stray artifact files.

**Also found, unrelated to the conflict markers but in the same investigation:** `git diff` on
`src/world/feature-cache.ts` between the merge's two parents reported `Binary files differ`.
This turned out to be the pre-existing NUL-byte corruption above (already present in `4dcb661`,
predating the merge) — git's binary-file heuristic tripped on the embedded NUL bytes. Not a
merge-introduced problem; see the entry above for the actual fix, applied on this worktree's
branch and included in the cleanup PR below so `main` picks it up too.

**Fix:** prepared on a new branch off `origin/main` (not on `worktree-zoom-stability-z1`, and
not pushed to `main` directly — this session cannot push to `main`, by design). Resolved the
three conflicted files by taking the PR side verbatim, deleted the five stray artifact files,
applied the same NUL-byte fix as above, ran `scripts/check-merge-markers.sh`, the full test
suite and `tsc -b`, then opened a PR for the user to review and merge themselves.

**Next action — for the user:** merge the cleanup PR before trusting `main`'s docs or building
anything else on top of it. This session's own B3-live-wiring work (next up) will build on
`worktree-zoom-stability-z1` / this cleanup branch's corrected state, not on the currently
broken `origin/main`.

## 2026-09-12 — B3 reduced-scope live wiring landed and browser-verified: 9/9 solvable bridges publish

**Task:** continue from the prior session's decision point ("accept 9/76 and build B3's live
wiring now with the plan's required fallback path" vs. "scope fragment-aware stitching
first"). Per the user, worked directly on `main` (no worktree) for this session — though the
harness's own background-isolation guard still routed edits into
`.claude/worktrees/b3-bridge-mesh-wiring` regardless; see the commit/push note at the end of
this entry for what that means for `main` in practice.

**Ruling made before writing any code — B3 depends on Z3, and Z3 is unwired:** re-checked
`docs/IDEAS_TODO.md`'s dependency table (`B3 | Depends on: B2, Z3`) and B3's own plan text
(masking `bridges`/`bridge-edges`/road surfaces "using Z3 fallback source ownership"). Z3 has
**zero call sites** — only the pure `roadFootprint` function exists (see the 2026-09-11 Z3
entry). Building Z3's full GeoJSON-source/hysteresis-handoff/terrain-following renderer just to
satisfy B3's masking bullet is its own multi-stage task, not attempted here. **Scoped B3 down
accordingly, named explicitly rather than silently skipped:**

- Built: the mesh renderer, live graph/solver wiring, and fallback ownership (never publish a
  box and a mesh for the same bridge).
- Deferred to a future Z3 + B3-finishing task: the plan's "controlled depth bias" and 2D-layer
  masking, and the terrain-following ground-tie-in patch as its own dedicated component (the
  mesh's own approach-ramp samples already reach ground — see below for why this is a smaller
  gap than it sounds).
- Reasoning checked before accepting the risk, not assumed: the *currently shipping*
  box-bridge deck already floats above ground with a hard, gapped jump and no ramp at all, and
  it already coexists with the always-on 2D `bridges`/`roads` line layers underneath with no
  masking — so the new ramped mesh (which actually reaches ground) is a strict visual
  improvement on the status quo, with one narrow, named risk: right at a ramp's ground anchor,
  where mesh height approaches the 2D line's flat ground plane, a few pixels of depth-buffer
  z-fighting are possible. Browser-verified below to not be visually disqualifying.

**A real, separate gap fixed first, because live wiring needed it:** `solveBridge()` returns on
the *first* failed bridge edge across the whole input graph (already flagged as a live-wiring
blocker in the 2026-09-12 B3 diagnostic entry: "a single unsolvable one would suppress every
other bridge"). Added `solveBridges()` (`src/world/bridge-profile.ts`) — solves every bridge
component independently by calling the module-private `solveOneBridge` directly per edge
instead of going through `solveBridge`'s short-circuit loop. Checked before building it that
this needs no graph reduction (unlike the throwaway diagnostic's `reducedGraphFor` workaround):
`solveOneBridge` only ever reads the given edge's own connected approach chain, never other
bridges elsewhere in the graph, so the diagnostic's reduction was only ever working around
`solveBridge`'s own loop, not a real dependency. Also added `defaultMaxGradeForEdge` (12% for
width <= 3.5m paths, 8% otherwise, per the plan's own stated visual limits) and
`DEFAULT_MAX_APPROACH = 250`, both previously only inline constants in the throwaway
diagnostic script, now real exported policy. 3 new targeted tests in
`tests/bridge-profile.test.ts` (20/20 in that file): a two-component graph where the failing
half no longer suppresses the solvable half; a per-edge `maxGrade` function actually applied
per edge, not once for the whole call; and the no-bridge-edges empty case.

**Live wiring built:**
- `src/world/details-data.ts`: new `collectReadyBridgeSurfaces()` — queries the same
  `roads`/`bridges` rendered features already used elsewhere in this file, adapts them to
  `WorldFeature[]` (inline, not reusing Z2's `reconcileFeatures`/`boundCache` — this pass
  recomputes fresh every collection tick same as every other detail type here, so Z2's
  cross-tick retention isn't needed yet), builds the graph via B1's `buildRoadGraph`, and
  solves via the new `solveBridges`. `sampleGround` checks `c.terrain` and returns `0`
  *before* ever calling `queryTerrainElevation`, matching the plan's "adapter returns zero
  without touching the map API" line literally, not just relying on `solveBridges`'s own
  internal terrain-off guard. `WorldDetails` gained `bridges: BridgeMeshEntry[]`
  (`{ mesh: BridgeMeshData; color: string }` — `BridgeMeshData` itself is pure geometry with no
  material info, and `BridgeSurface` carries no road class, so color is resolved once here
  using the same two-tier major/other approximation `bridge-profile.ts` already uses for
  clearance/thickness: `thickness > 0.9` (major) gets the flat map's major-road tone, else the
  active palette's road tone — collapsing path/track bridges into the same tone as other minor
  roads rather than a distinct dirt/paver tint, a named consequence of reusing that existing
  two-tier simplification rather than a new one).
- `src/world/bridge-mesh.ts` (existing, unchanged) — `buildBridgeMesh` is called per ready
  surface exactly as B3's interface specified.
- `src/world/BridgeMeshes.tsx` (new) — one R3F `<mesh>` per published bridge (not merged into
  one buffer), matching the plan's "keep bridge IDs with publication metadata so fallback
  ownership can be updated atomically": a bridge that stops solving just disappears from the
  array next render and React/R3F disposes that mesh's geometry alone.
- `src/world/Details.tsx` — renders `<BridgeMeshes entries={data.bridges} />` alongside the
  existing `<Structures>` instances, inside the same shared Canvas.
- `src/world/structures.ts` — `collectBridgeParts()` gained a `publishedSurfaces` parameter
  (default `[]`, so every existing call site not passing it is unaffected). For each raw
  bridge-tagged segment, if its midpoint lands within 2.5m of any published surface's sample
  centers, the box/rails/posts/piers for that segment are skipped entirely (fallback ownership
  is all-or-nothing per segment, never half-boxed). **Named as an approximation, not exact
  traceability:** there is no direct raw-line-to-graph-edge-id mapping to check instead (B1's
  graph can split/join raw lines at junctions and tile boundaries), so this matches by geometry
  proximity against the same source coordinates B2 resampled at <= 5m spacing — verified
  correct end-to-end by the browser check and the new integration tests below, not just
  asserted.

**New tests:**
- `tests/bridge-profile.test.ts` — 3 new `solveBridges` tests (above), file now 20/20.
- `tests/bridge-live-wiring.test.ts` (new) — end-to-end `collectDetails()` checks with a mocked
  `Map`: a solvable bridge (45m approaches against a ~37.5m requirement) publishes exactly one
  mesh in `data.bridges` *and* produces zero `data.structures` for that span (fallback
  ownership actually prevents double-rendering, not just in theory); a bridge with a
  deliberately too-short 3m approach publishes no mesh and falls back to the existing box
  generator exactly as before. Both passed on the first real run after implementation.

**Commands/results:** `pnpm exec vitest run` — 104/104 passed (99 pre-existing + 3 + 2 new).
`pnpm exec tsc -b` — clean. `pnpm build` — clean, no new warnings beyond the pre-existing
chunk-size notice.

**Browser evidence (real, not skipped):** confirmed this sandboxed environment has internet
and a working Playwright/Chromium install (same check prior sessions made). Ran `pnpm dev`
and a throwaway diagnostic (`tests/browser/bridge-mesh-check.mjs`, built and deleted after use,
same discipline as this worktree's prior throwaway diagnostics) against the default Gamla Stan
preset: **9 published bridge meshes** in the live R3F scene — exactly matching the previously
measured 9/76 `solveBridges`-ready count from the 2026-09-12 option-2 diagnostic, confirming
the live count matches the offline prediction exactly, not just "some number greater than
zero." Zero console/page errors. Screenshots (`.artifacts/bridge-mesh-check/`, gitignored, not
committed) show continuous ramped decks connecting smoothly to the road on each bank at the
bridges crossing the water channel — a clear, visible improvement over the previously-shipping
disconnected floating box with a hard, gapped jump. No doubled/overlapping bridge geometry and
no obvious z-fighting artifact was visible at the inspected zoom/pitch. This is a static
screenshot check, not B5's full acceptance matrix (12 zooms x 4 bearings x 3 pitches x 2 DPR x
2 terrain states x 3 cities) — that remains unattempted and is explicitly still open.

**Not built, named explicitly (scope boundary, not oversight):**
- Z3's actual masking/depth-bias machinery for the 2D `roads`/`bridges` style layers under a
  published deck — deferred per the ruling above. The seam risk this creates is browser-checked
  as non-disqualifying here, not eliminated.
- B4 (railings/posts/piers on the new mesh, saturation budgets) — the published bridges
  currently render as a bare deck with no railings of their own; the *old* box generator's
  railings/posts/piers are correctly suppressed for published spans (by the same
  fallback-ownership check), so a published bridge today has a deck but no railing at all,
  which is a real, visible gap for B4 to close next, not silently hidden.
- B5's full verification protocol (deterministic local fixtures, sampled-position walk with
  0.02m continuity assertions, multi-city/zoom/bearing/pitch/DPR/terrain screenshot matrix,
  performance-regression comparison) — none of this was attempted; today's browser check is a
  targeted sanity check on this session's own change, not a substitute.
- Any change to the 9/76 ceiling itself (fragment-aware bridge stitching, the dead-end
  population) — out of scope for this task, unchanged from the prior session's measurements.

**Commit/push, stated plainly:** the background-job harness enforced worktree isolation for any
file edit regardless of the "work on main, no worktree" instruction (a hard technical guard,
distinct from the RTK/git-hook blocker earlier sessions hit in a different harness) — this
session's changes live on branch `worktree-b3-bridge-mesh-wiring`, committed there, not on
`main`. Per this session's own standing instructions, a background session does not push to
`main`/master under any circumstance. **Next action for the user:** review and merge (or
fast-forward `main` onto) `worktree-b3-bridge-mesh-wiring` before building anything else on top
of this; the commit is ready and fully tested but not yet on `main`.

**Next action — for whoever continues this:** B4 (railings/supports/budgets on the new mesh) is
the next task with no unresolved prerequisite gap for the 9 bridges that already publish, and
is also what would make a published bridge visually complete (currently a bare deck). A
dedicated Z3 masking task remains open separately and would remove today's named seam risk
without touching B4. Neither the 9/76 ceiling nor B5's full verification protocol were
addressed and remain exactly where the prior session left them.

## 2026-09-12 — B4: exposed-edge railings and support posts landed and browser-verified

**Task:** [B4](BRIDGE_CONNECTIVITY_PLAN.md#b4-derive-safe-railing-boundaries-and-supports) from
the [todo list](IDEAS_TODO.md), requested directly ("start B4: railings and supports for the
published bridges"), continuing on `worktree-b3-bridge-mesh-wiring` (same branch as the open
B3 PR, since B4 only has anything to render once B3's meshes exist).

**Built and unit-tested:**
- `src/world/bridge-boundaries.ts` — `exposedBridgeEdges(surfaces): [Vec3, Vec3][]` and
  `bridgeAccessories(edges, surfaces, cap): StructurePart[]`, matching the plan's own literal
  signatures. `exposedBridgeEdges` filters each surface's already-computed `left`/`right`
  sample chain, clipping the "opening" at each end — the plan's "subtract opening intervals
  including half the connected road width plus a 0.5m shoulder allowance." The opening
  half-width is read directly from each anchor sample's own width (`|left - right|`) rather
  than needing separate connected-road data, because B2 already sizes that sample's width from
  the real connected road it walked to meet (`widthAtDistance` in bridge-profile.ts) — a short
  span where both openings would overlap returns no edges for that side rather than a bogus
  single-point railing. `bridgeAccessories` places vertical posts at 8m arc-length intervals,
  carrying leftover distance ("phase") across consecutive edges that share an endpoint
  (detected by point-adjacency, since the flat `[Vec3,Vec3][]` interface carries no explicit
  chain-grouping structure) and resetting phase to 0 at a genuine chain break, checking the cap
  before every insertion. 11 tests in `tests/bridge-boundaries.test.ts`: exact opening-clipping
  arithmetic, whole-span-consumed-by-openings, a diagonal bridge (perpendicular-offset dot
  product asserted ~0, per the plan's own acceptance line), a curved bend's chain staying
  unbroken, two B1-joined bridge edges' seam producing no spurious break, post spacing exact
  math, phase continuity through a bend, phase *not* leaking across a genuine chain break,
  cap enforcement, and posts never landing inside an opening.
- `src/world/bridge-mesh.ts` gained `buildRailMesh(edges): BridgeMeshData` — a thin rail-bar
  mesh strip per edge segment, since a sloped approach ramp's rail has to tilt with it, which a
  yaw-only `StructurePart` box instance cannot represent (the plan's own text: "if sloped rails
  use mesh strips, keep them in BridgeMeshData"). 6 new tests in `tests/bridge-mesh.test.ts`:
  empty/degenerate-edge handling, positive-area triangles, exact `RAIL_CENTER_OFFSET`/
  `RAIL_THICKNESS` positioning, following a sloped edge's own height (not a flat constant), and
  independent prisms per disconnected edge.
- `src/world/config.ts`'s `QUALITY` tiers gained `bridgeTriangles` (Eco 10k / Balanced 25k /
  High 50k), matching the plan's stated ceiling exactly. No separate 8 MiB byte check was
  added: at these triangle counts (positions+normals+indices), the buffer size stays well
  under 8 MiB regardless, so the triangle cap is already the binding constraint — reasoned
  through explicitly rather than silently dropped.
- `src/world/details-data.ts`: "allocate complete mandatory deck/ramp meshes first" — every
  ready surface's deck (`buildBridgeMesh`) is built unconditionally; only the *optional* rail
  (`buildRailMesh`) is subject to the running triangle total against the tier's
  `bridgeTriangles` ceiling, dropped per-bridge (never the deck) once it would exceed the
  budget (`BridgeMeshEntry.rail: BridgeMeshData | null`). Support posts use a separate,
  deterministic 500-instance cap (matching the pre-existing box-bridge convention already in
  `structures.ts`), computed once across every ready surface's edges together (not per surface)
  so `bridgeAccessories`' arc-length phase carries correctly through each side's own contiguous
  chain, then appended to `result.structures`.
- `src/world/BridgeMeshes.tsx` — the single `BridgeMesh` component was generalized to
  `MeshBuffer` (same position/normal/index buffer wiring, now shared by both the deck and the
  optional rail), rendering an extra `<mesh>` per bridge for its rail (using the fixed
  `ACCESSORY_COLOR` re-exported from `bridge-boundaries.ts`, not the deck's road-class color)
  when one was built.
- `tests/bridge-live-wiring.test.ts`'s solvable-bridge case updated: it previously asserted
  `data.structures` is empty for a published bridge (true before B4); now asserts every
  `data.structures` entry is a small (< 1m) box — B4's own accessory posts, never the old
  large box-bridge deck/rail/post geometry — and that at least one exists, plus that the
  bridge's `rail` field is non-null.

**Named scope reduction, stated plainly (not silently skipped):** piers ("place optional piers
below the deck underside, with terrain samples at each support location") were **not built**.
`BridgeSurface` retains only the finished road-top height at each sample, not the raw ground
height B2 measured while solving (it only ever needed the *maximum* ground under the span to
size the deck's constant clearance) — and `bridgeAccessories`' own plan-specified signature
`(edges, surfaces, cap)` has no `sampleGround` callback to query it live either. Building real
piers needs one of: retaining ground height per sample during B2's solve (a small, surgical
follow-up — the data already flows through `solveOneBridge`, just isn't kept), or threading a
live terrain callback through `bridgeAccessories` (a signature change the plan doesn't call
for). Flagged for a focused follow-up, not attempted here — a published bridge today has decks,
rails and posts, but no piers underneath, same honest gap style as B3's own "not built" list.

**Test-fixture scope note:** the plan's own B4 bullet also asks for T/Y-entrance,
bridge-to-bridge-junction and crossing-road-underneath fixtures. Checked directly against this
codebase's B2 before writing tests: none of those states ever reach a published `BridgeSurface`
— a junction encountered before an approach's transition completes rejects the whole component,
and `BridgeSurface.openings` is always `[]` (mid-span branch openings are not modeled at all,
per bridge-profile.ts's own doc comment). Building fixtures for unreachable states would be
either untestable no-ops or fictions about behavior that doesn't exist, so they were not added;
the one adjacent, genuinely reachable case — two bridge edges B1 joins end-to-end through a
shared node, published as one continuous surface — is covered instead (see above).

**Commands/results:** `pnpm exec vitest run tests/bridge-boundaries.test.ts` — 11/11 (all
passed on the first real run, after hand-reasoning the expected arithmetic before writing the
implementation, same discipline as prior B1/B2/B3 sessions). `pnpm exec vitest run
tests/bridge-mesh.test.ts` — 14/14 (8 pre-existing `buildBridgeMesh` + 6 new `buildRailMesh`,
also first-run green). Full `pnpm exec vitest run` — **121/121** passed (99 baseline + 5 B3 +
17 B4). `pnpm exec tsc -b` — clean. `pnpm build` — clean, no new warnings beyond the
pre-existing chunk-size notice.

**Browser evidence (real, not skipped):** same environment/discipline as the B3 entry above —
`pnpm dev`, two throwaway diagnostics (`tests/browser/bridge-accessories-check.mjs` and
`-zoom.mjs`, built and deleted after use) against the live Gamla Stan preset. Plain (non-
instanced) mesh count went from **9 (B3 only) to 18** — exactly 9 decks + 9 rails, confirming
**every** published bridge's rail fit within the Balanced-tier 25k-triangle budget (none
dropped). Zero console/page errors. A close-up screenshot (zoom 19, pitch 55, bearing 20,
camera aimed at a bridge crossing identified from the overview shot) shows a continuous top
rail with clearly visible, evenly-spaced vertical posts along both edges of a real published
bridge deck — matches the intended design exactly, not merely "some geometry rendered."
Screenshots saved under `.artifacts/bridge-accessories-check/` (gitignored, not committed).

**Not built (named, not silently skipped):**
- Piers (see above — needs retained ground-height data or a live sampleGround callback, neither
  of which exists at this layer yet).
- Z3's 2D-layer masking (still open from the B3 entry, unaffected by B4).
- B5's full verification protocol (multi-city/zoom/bearing/pitch/DPR/terrain matrix,
  0.02m-continuity sampled-position walk, performance-regression comparison) — untouched.
- Any change to the 9/76 solve-rate ceiling — out of scope for this task.

**Next action:** piers are the one clearly-scoped remaining B4 bullet; recommend retaining
per-sample ground height in B2's solve as the smaller, more natural fix over adding a live
terrain callback to `bridgeAccessories`. After that, B5 (full connectivity/visual/performance
verification) is the next task with no unresolved prerequisite gap for the bridges that already
publish — though it remains a large, separate undertaking (the multi-city screenshot/sampling
matrix alone), not something to fold into a future task's scope by default.

## 2026-09-12 — B4 piers: ground height retained in B2, piers landed; screenshot evidence weaker than prior entries

**Task:** the one remaining B4 bullet flagged as "not built" in the entry above — piers — picked
up directly ("continue"), following that entry's own recommendation to retain per-sample ground
height in B2's solve rather than add a live terrain callback to `bridgeAccessories`.

**Built and unit-tested:**
- `src/world/bridge-model.ts`: `ProfileSample` gained an optional `ground?: number` field,
  documented as set only for samples under the deck's own span (approach/ramp samples are an
  interpolated smoothstep curve, never a measured height, so it stays `undefined` there).
- `src/world/bridge-profile.ts`: `solveOneBridge`'s existing per-stop ground scan under the deck
  (previously used only to compute `maxGround` for the deck-height formula, then discarded) now
  retains each stop's own `ground` value and carries it through `RawSample` and `withOffsets`
  into the final `ProfileSample`s. No behavior change to the deck-height/clearance formula
  itself — purely additive. 1 new test in `tests/bridge-profile.test.ts` (now 21/21): confirms
  deck samples carry the real measured ground value and approach samples do not.
- `src/world/bridge-boundaries.ts`: `bridgeAccessories` now also places round piers
  (`piersForSurface`, cylinder-kind `StructurePart`s) under each surface's deck-only samples
  (`ground !== undefined`), spaced like `structures.ts`'s existing box-bridge piers (2-9
  columns, ~one per 38m of span, gated off entirely below a 12m span), each snapped to its
  nearest deck sample (ground is only known at sample points, never interpolated between them),
  omitted when height would be negligible (< 0.5m) — matching the plan's own "omit supports
  when ground is unknown or height is negligible" line for both cases. Posts and piers now
  share **one combined cap** (read literally from the plan's "allocate optional supports/posts
  deterministically within 500 instances" grouping them together), checked before every
  insertion exactly like posts already were. 5 new tests in `tests/bridge-boundaries.test.ts`
  (now 16/16): exact pier height/position math from a real ground/deck gap, the 12m span gate,
  the negligible-height omission, no piers when ground was never retained, and the shared cap
  actually splitting its budget between posts and piers rather than starving one.
- `tests/bridge-live-wiring.test.ts`'s solvable-bridge assertion updated again: now also expects
  at least one `kind: "cylinder"` entry (a pier) alongside the `kind: "box"` posts, both still
  far smaller than the old box-bridge's tens-of-meters deck.

**Not implemented, named per the plan's own text rather than silently dropped:** "exclude piers
from lower road/path footprints plus 0.5m clearance" and "avoid blocking navigable-looking water
channels by default" both need polygon/water geometry this module has no access to —
`BridgeSurface` carries none, and threading it in would mean a real signature/data-flow change,
not a parameter tweak. A pier can in principle land inside a lower road's own footprint or in a
boat channel today; this is a known, stated gap, not an oversight.

**Commands/results:** `pnpm exec vitest run tests/bridge-profile.test.ts` — 21/21. `pnpm exec
vitest run tests/bridge-boundaries.test.ts` — 16/16. Full `pnpm exec vitest run` — **127/127**
(122 baseline + 1 B2 + 5 B4-pier tests, with 1 pre-existing B3 integration assertion updated in
place rather than counted as new). `pnpm exec tsc -b` — clean. `pnpm build` — clean, no new
warnings.

**Browser evidence — weaker than the B3/B4-rails entries above, stated plainly rather than
rounded up:** same `pnpm dev` + throwaway-diagnostic discipline. A scene-graph check found a
non-zero cylinder-`InstancedMesh` count (94, alongside the separate tree-trunk and bench-bin
cylinder groups already expected at this preset) and zero console/page errors — consistent with
piers existing in the live scene, but not visually confirmed the way B3's ramp screenshot or
B4's rail/post close-up were: two close-up camera attempts at different pitch/bearing combinations
around the same bridge used for those earlier screenshots did not land a clean, unobstructed view
of a pier (the first was too far back to resolve anything at pier scale; the second's chosen
bearing put a building directly in the foreground). Rather than keep spending browser-check
cycles hunting for a better angle, this entry relies on the precise unit-level arithmetic
(exact height/position/threshold assertions above) plus the non-zero instance count and clean
console as its evidence, and says so directly instead of implying a screenshot confirmed
something it didn't.

**Not built:** the two named-but-unimplemented pier constraints above; Z3's masking and B5's
full verification protocol remain open from prior entries, unaffected by this task.

**Next action:** B4's plan text is now fully covered (railings, posts, piers, budgets) with the
two explicitly named polygon-data gaps left open. B5 (full connectivity/visual/performance
verification) is the next task with no unresolved prerequisite gap for the bridges that already
publish, and would also be the natural place to get a real, unambiguous pier screenshot as part
of its own required multi-city/zoom/bearing screenshot matrix rather than as an ad hoc diagnostic.

## 2026-09-12 — B5: acceptance suite built and run; a real cross-city mesh-retention bug found, not fixed

**Task:** [B5](BRIDGE_CONNECTIVITY_PLAN.md#b5-verify-connectivity-and-publish-measured-evidence) from
the [todo list](IDEAS_TODO.md) — the last item in the Bridge Connectivity sequence, picked up
directly ("continue work") since B4's own last entry named it as the next task with no
unresolved prerequisite gap.

**Scope decision, stated up front (same discipline as every B1-B4 session):** the plan's own B5
text describes a full acceptance matrix (12 zoom values x 4 bearings x 3 pitches x 2 DPR x 2
terrain states x 3 cities, plus a deterministic fixture suite covering 8+ named shapes). That
matrix alone is larger than any single prior session's scope in this log. What was actually run:
every fully-automatable, offline piece of the plan (deterministic fixtures, the sampled-position
continuity walk, `pnpm test`/`pnpm build`), plus a *targeted* real-browser pass (one city driven
through several real interaction checks, a second city as a cross-city sanity pass only) rather
than the full grid. This mirrors the reduction Z3/B1-B4 each made and named explicitly.

**Built and run — `tests/bridge-acceptance.test.ts` (new, 17 tests), fully offline:**
- Full-pipeline fixtures through `collectDetails()` (the actual production entry point, not a
  reimplementation) for every shape the plan names: straight, curved (interior bend), diagonal
  (non-axis-aligned), short deck (below the 12m pier gate — publishes with posts, no piers), short
  approach (infeasible, box-generator fallback), a Y-branch junction far enough past the deck end
  to be accepted, tile-split fragments (two features sharing an interior endpoint, re-joined by B1
  before B2 ever sees them), a ground road crossing underneath with no shared endpoint ("stacked"
  grade separation — never connects, never perturbs the bridge), missing DEM under the span
  (`terrain: true` + a `queryTerrainElevation` that returns `null` — reports incomplete, not
  ground-zero), and budget saturation (40 simultaneous ready bridges under the Eco tier's
  10k-triangle cap — every deck publishes, some rails drop, none exceed the 500-instance
  post+pier cap).
- Sampled-position continuity walk, directly against `solveBridge`'s own `ProfileSample`s (not a
  black-box mesh inspection): for straight/curved/diagonal/short-deck fixtures, asserts every
  sample-to-sample height step respects the configured max grade, and both approach endpoints
  settle within 0.02m of true ground — the plan's own literal tolerance. A pure per-post check
  confirms every railing post (kind `"box"`) sits at or outside the deck's own half-width, i.e.
  never inside the travel corridor; piers (kind `"cylinder"`) are excluded from that specific
  check by design, since they're centerline supports *under* the deck, not on the travel surface
  — an initial version of this test wrongly applied the edge-clearance check to piers too and
  failed on two genuine, correct pier placements before this was caught and fixed.
- A dedicated unequal-endpoint-height fixture (ground ramping 0m to 5m under the span): confirms
  each side sizes its own independent transition and both settle within 0.02m of real ground.
- The plan's own "terrain off/on and exaggeration 1/1.2/2" line, addressed honestly rather than
  literally: `BRIDGE_RENDERING_PLAN.md` already established that `queryTerrainElevation()` bakes
  MapLibre's active exaggeration into its return value before any of this codebase's own code
  sees it — there is no exaggeration constant inside `bridge-profile.ts` to vary offline. What
  *is* tested: feeding `sampleGround` a value pre-scaled by 1x/1.2x/2x (simulating what a
  different exaggeration would hand our code) and confirming the solved deck height tracks it
  linearly with no double-application — a regression guard against a future contributor adding a
  second, redundant scale factor inside this codebase.
- A quality-tier fixture confirming Eco/Balanced/High never change the *deck* geometry itself
  (byte-identical positions/indices across tiers) — only the rail/post/pier budget differs, per
  the plan's own "budgets, not geometry" intent.

**Commands/results:** `pnpm exec vitest run tests/bridge-acceptance.test.ts` — 17/17 (one real bug
in the test itself, not the app, was caught and fixed before this: the corridor-clearance
assertion above). Full `pnpm exec vitest run` — **144/144** (127 baseline + 17 new). `pnpm exec
tsc -b` — clean. `pnpm build` — clean, no new warnings.

**Built and run — `tests/browser/bridges.mjs` (new), against real OpenFreeMap/Mapterhorn tiles via
`pnpm dev`:** Gamla Stan (default preset, terrain off, the only city with a previously-measured
9/76 ready count) driven through: initial publish check, the Bridges on/off/on toggle (no stale
elevated mesh survives hiding, clean republish on restore), a continuous zoom sweep crossing the
13.5 live/hidden threshold seven times, a tile-boundary pan and back, an orbit start/stop, a full
page reload, and close-up screenshots of a *located* real published bridge (found by its own mesh
geometry — nearest published deck to the camera center, converted back to lng/lat via
`geography.ts`'s exact local-meters formula — never a guessed coordinate) from the top and three
bearings. Amsterdam was loaded as a second terrain-off preset for cross-city sanity only (bridge
presence not asserted, stated as such in the script's own output) — 4 bridge meshes happened to
publish there too. All 9 checks passed. Screenshots in `.artifacts/bridges/` (gitignored):
`gamla-stan-overview.png`, `gamla-stan-bridge-top.png`, `gamla-stan-bridge-bearing{20,110,200,290}.png`,
`amsterdam-overview.png`. The bearing-290 shot is an unambiguous, unobstructed side view of a
published bridge with continuous ramps, visible piers and evenly-spaced rail posts over water —
the clean pier shot the B4-piers entry above explicitly said it never got.

**Timing lesson worth keeping, not just fixed silently:** the first two full runs of this script
failed on fixed `waitForTimeout` assertions after the bridges-toggle recheck and the zoom sweep.
Root-caused with a throwaway diagnostic (deleted after use, per this project's convention): both
are real debounce-settling delays, not app bugs — rapid successive `moveend`/`sourcedata` events
(from a zoom sweep, or from whatever residual camera motion followed the orbit step immediately
before the original toggle placement) each reset the 250ms collection debounce, so settling can
legitimately take up to ~3s under churn. Fixed by switching every such assertion to
`expect.poll(...)` with real margin (15-30s) instead of a fixed wait, and by relocating the
toggle check to right after the initial overview (a state already known to settle quickly) rather
than right after orbit. This is a test-robustness fix, not a product fix — named here because the
next person extending this script should keep using polling, not fixed waits, for anything that
depends on the collection debounce.

**Performance comparison (`BRIDGE_CONNECTIVITY_PLAN.md`'s B5 bullet), scope explained:** there is
no separately-bootable pre-B1..B4 build in this environment to diff against live (that would mean
checking out an old commit into a second working tree and running a second dev server). What was
measured instead, with a throwaway diagnostic (built, run, deleted after use): Gamla Stan with
bridges on vs off, in the same running session — bridges cost **16 extra plain meshes, ~717 extra
instances (posts/piers), 28,320 extra triangles, 24 extra draw calls**, no extra `gl.info.memory`
geometry/texture handles at steady state, and no measurable JS heap difference. This is a real,
directly-comparable cost figure for what B1-B4 add to a scene that already had bridges rendered
via the old box generator; it is not a diff against the pre-existing box-bridge renderer's own
cost, which was not separately measured here.

**A real bug found and reproduced, explicitly NOT fixed in this task — flagged for a dedicated
follow-up:** the plan's own "budget overflow or memory growth after five travel/return cycles"
check surfaced a genuine anomaly. Measured with a throwaway diagnostic that drives the camera
directly between Gamla Stan and Manhattan (`map.jumpTo`, bypassing the place-switcher UI, which
proved too flaky to drive repeatedly headless in this session — a separate, minor test-tooling
gap, not the finding itself) and reads `scene.children` directly each time:
- A single isolated travel cycle (Gamla Stan -> Manhattan -> Gamla Stan) is completely clean:
  plain mesh count returns to exactly the baseline 16, no stale geometry, nothing farther than
  3000m from the current camera origin (which would indicate a leftover mesh still positioned in
  the *other* city's now-stale local-meters frame).
- Across repeated cycles, Gamla Stan's own plain-mesh count jumps from 16 to **56** starting on
  the *second* return, and then holds steady at exactly 56 for every subsequent cycle (measured
  through 6 full cycles) — it does not keep growing without bound, but it never corrects back
  down to 16 either, even after several more clean round trips. Manhattan's own count stayed at a
  constant 16 throughout, which is itself suspicious (Manhattan's real bridge topology has no
  reason to coincidentally match Gamla Stan's count) and is flagged as possibly a stale/delayed
  read rather than Manhattan's true settled state — not confirmed either way.
- Working hypothesis, explicitly unconfirmed: MapLibre's own placeholder/parent-tile rendering
  during a fast re-visit to a previously-cached area can transiently render two tile generations
  at once, which `queryRenderedFeatures` would report as more (partially duplicate) features than
  the settled view has — inflating `buildRoadGraph`'s node/edge count and hence the solved bridge
  count for exactly one collection pass. What does *not* fit this hypothesis cleanly: the elevated
  count persists indefinitely afterward rather than a later, clean pass correcting it back down,
  which `setData(collectDetails(...))` (a full state replace, confirmed by reading
  `WorldMap.tsx` directly, not assumed) should otherwise guarantee. The actual mechanism holding
  the stale/inflated set alive is not identified.
- **Not fixed here.** Root-causing this properly needs either instrumenting `collectReadyBridgeSurfaces`'s
  `queryRenderedFeatures` call to log raw feature counts/ids across a reproducing cycle, or
  reproducing it under a controlled/mocked map (this project's existing fixture style) rather than
  live tiles, whose tile-cache timing is exactly the suspected variable and is not
  deterministically controllable from a test. Flagging precisely rather than guessing at a fix:
  the completion criteria explicitly call for reporting "fallback/unresolved components," and an
  unresolved product bug found while verifying is the same category of honesty this log has
  applied to every prior B1-B4 gap.

**Not built/run, named explicitly:**
- The full 12-zoom x 4-bearing x 3-pitch x 2-DPR x 2-terrain x 3-city screenshot matrix — only a
  handful of zoom/bearing points at one primary city were actually exercised.
- San Francisco and Chamonix (the two `terrain: true` presets) were not driven through the browser
  script at all — terrain-on bridge behavior has zero live-browser coverage from this session
  (the offline fixtures cover the code path with a mocked `sampleGround`, but never against a real
  DEM).
- The place-switcher UI's own click flow was not exercised repeatedly (worked once in
  `bridges.mjs`'s single Amsterdam switch, but proved unreliable when driven in a tight loop in
  the performance diagnostic — worked around with direct `map.jumpTo`, which is *not* equivalent
  to whatever the place-switcher does to React `config` state on top of the camera move; if that
  extra state change is itself implicated in the mesh-retention bug above, this method would miss
  it).
- A true pre-B1..B4 performance baseline (no separately-bootable old build in this environment).
- Fixing the mesh-retention bug itself (see above).

**Docs updated:** `docs/BRIDGE_CONNECTIVITY_PLAN.md`'s B5 checklist items are now exercised (not
all checked off in `IDEAS_TODO.md` below, since the full matrix and the found bug remain open).

**Commit status:** this worktree's changes (`tests/bridge-acceptance.test.ts`,
`tests/browser/bridges.mjs`, this log entry, the `IDEAS_TODO.md` update below) are **not yet
committed**. This session hit the same global `rtk` PreToolUse hook block `scripts/toggle-rtk-hook.sh`
documents (confirmed again here: even a bare `git status` is refused while isolated in this
worktree) — the fix requires a human running `scripts/toggle-rtk-hook.sh off` in a real terminal,
which this session cannot do itself. See the end of this session's report for the exact commands.

**Next action:** two independent follow-ups, neither blocking the other: (1) root-cause and fix
the cross-city mesh-retention bug above — the more valuable of the two since it's a real,
user-visible correctness issue (a scene showing more bridge geometry than the current view
actually contains); (2) if/when B5's full matrix is ever wanted, it needs its own dedicated
session given the scale, ideally starting from a controlled/mocked-tile harness for the
zoom/bearing/pitch grid rather than live tiles, to make it fast and deterministic enough to
actually run at that size.

## 2026-09-12 — B5 follow-up: the cross-city "mesh retention bug" was a measurement artifact

**Status:** resolved — no product bug. The previous entry's flagged follow-up ("root-cause and fix
the cross-city mesh-retention bug") is closed by re-measurement, not by a code fix, because the
re-measurement shows there is nothing in the product to fix.

**What the previous session reported:** repeated fast travel between Gamla Stan and Manhattan made
Gamla Stan's published plain-mesh count jump from 16 to 56 starting on the second return and hold
there indefinitely, while Manhattan's own count stayed at a constant 16. That entry already flagged
the Manhattan number as "itself suspicious" — Manhattan's real bridge topology has no reason to
coincidentally match Gamla Stan's count. That suspicion was correct, and it was the whole finding.

**What was actually measured this session.** `collectReadyBridgeSurfaces` and `WorldMap.tsx`'s
debounced refresh were temporarily instrumented (pass counter, raw `queryRenderedFeatures` count,
graph edge/bridge-edge counts, solved surface count, plus a log on the `isMoving()`/`isStyleLoaded()`
bail), and the cross-city cycle driven live. Instrumentation removed after use, per this project's
throwaway-diagnostic convention; `git checkout` of both files confirmed clean.

Settling properly before each read (poll until the mesh count stops changing, rather than a fixed
wait) gives a completely stable, deterministic result across four full cycles:

```
pass#1  raw=1148 edges=5045 bridgeEdges=76 surfaces=8    Gamla Stan   -> 16 plain meshes
pass#3  raw=944  edges=7117 bridgeEdges=70 surfaces=33   Manhattan    -> 66 plain meshes
pass#4  raw=1148 edges=5045 bridgeEdges=76 surfaces=8    Gamla Stan   -> 16 plain meshes
...identical for every subsequent cycle, 10 passes total
```

Manhattan legitimately publishes ~33 surfaces (66 meshes = 33 decks + 33 rails); Gamla Stan
publishes 8 (16 meshes). Neither city ever retained the other's geometry, and neither grew.

**The artifact, reproduced deliberately.** Re-running the same cycle with the original methodology —
`jumpTo()` followed by a *fixed* short wait, then an immediate `scene.children` read — reproduces
the reported signature exactly, and inverted:

```
[fixed 1500ms] cycle 1 Manhattan:  plainMeshes=16     <- Gamla Stan's count
[fixed 1500ms] cycle 1 Gamla Stan: plainMeshes=66     <- Manhattan's count
...identical for cycles 2-4
```

The 250 ms collection debounce plus tile loading for a new city exceeds the fixed wait, so every
read lands one collection behind and reports the *previous* city's settled count. That produces all
four reported symptoms at once: a big jump on return, a value that never corrects (it is always
exactly one destination stale), no unbounded growth, and Manhattan implausibly pinned at Gamla
Stan's exact number. The previous session's 56 vs this session's 66 is just live OSM data drift in
Manhattan's bridge count between the two runs. The earlier "clean isolated round trip" observation
fits too — an isolated trip's final read had time to settle.

This is the same class of mistake the previous entry's own "timing lesson" called out (fixed
`waitForTimeout` vs `expect.poll` for anything behind the collection debounce); it was fixed in the
assertions of `bridges.mjs` but not in the throwaway performance/travel diagnostic, which is where
the false finding came from.

**Changed files:**
- `tests/browser/bridges.mjs` — added a repeated cross-city travel/return check (4 full
  Stockholm<->Manhattan cycles) that settles until the mesh count stops changing and then asserts
  each city returns to *its own* first-visit count. Absolute counts are deliberately not asserted,
  since they track live OSM data. This is B5's own "budget overflow or memory growth after five
  travel/return cycles" item, finally exercised with a methodology that can actually distinguish
  retention from a stale read. Also added `PW_CHROMIUM`/`PW_PROXY` env overrides to the browser
  launch (both unset locally, where the defaults already work) so the script is runnable in a
  sandboxed container.

**Commands/results:** full browser suite `node tests/browser/bridges.mjs` against real
OpenFreeMap tiles — all 12 checks pass, including the new one
(`travel baseline: {"Gamla Stan":14,"Manhattan":62}`, held exactly across four cycles; the
baseline differs from the diagnostic run above because live OSM data and which tiles had loaded
differ between runs — precisely why the check compares each city to itself rather than to a
constant).

**One real latent gap found while instrumenting, named and NOT fixed** (it is not the mechanism
behind the reported bug, and fixing it was not needed to close this): `WorldMap.tsx`'s debounced
refresh bails with `if (disposed || !map.isStyleLoaded() || map.isMoving()) return;` and never
reschedules, and the `idle` handler only flips `loading` without ever triggering a collection. A
`bail reason=style` was observed once per run in practice, always followed by another `sourcedata`
event that collected successfully — so no stale state was ever observed to survive. Named here
rather than silently fixed, so a future session that does see a stuck collection knows where to
look.

**Environment note for future remote/sandboxed sessions** (not committed to the repo, recorded
here because it cost real time): headless Chromium cannot complete a TLS handshake through this
container's egress proxy even with the CA trusted, so tile requests fail with
`ERR_CONNECTION_RESET` while `curl` to the same hosts succeeds. The workaround that unblocked all
live-tile browser verification above: a throwaway local plain-HTTP relay that fetches upstream via
`curl` and rewrites the TileJSON `tiles` array to point back at itself, with the app pointed at it
through its own documented `.env.local` `VITE_VECTOR_TILEJSON`/`VITE_DEM_TILEJSON` overrides.

**Next action:** B5's remaining open items are unchanged and unaffected — the full
zoom/bearing/pitch/DPR/terrain/city matrix, and terrain-on (San Francisco/Chamonix) live-browser
coverage, which still has none.

## Future entries

For each entry record the date, task ID and status; the concrete change and files; exact checks and results; relevant artifact locations; unresolved cases or changed assumptions; and the next task. Preserve earlier entries so the log shows what was actually verified at each stage.
