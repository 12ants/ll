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

## Future entries

For each entry record the date, task ID and status; the concrete change and files; exact checks and results; relevant artifact locations; unresolved cases or changed assumptions; and the next task. Preserve earlier entries so the log shows what was actually verified at each stage.
