# Terrene World Studio — Improvement Suggestions

## 1. Enforce code formatting with Prettier + ESLint

**Problem:** Inconsistent spacing and brace style across files makes diffs noisy and slows review. Examples:
- `geography.ts:93` — `function wrapLongitude(longitude:number)` missing space before type
- `WorldMap.tsx` — multiple compressed one-liners (`if(JSON.stringify(...))continue;`, `const ratio=Math.min(...)`, `timer=undefined;`)

**Fix:** Add `prettier` + `@typescript-eslint` + `eslint-config-prettier`. Add a `format` script and a pre-commit hook (e.g. `lint-staged`). Enforce the same style across the whole codebase.

---

## 2. Replace `JSON.stringify` equality checks and Set keys

**Problem:** `JSON.stringify` is used in three fragile/expensive ways:

| Location | Usage | Issue |
|---|---|---|
| `WorldMap.tsx:56,66,67` | Paint/light/terrain diffing | O(n) stringify on every config change; false positives if property order differs |
| `details-data.ts:122` | Deduplication key | Semantically identical polygons with reordered vertices get different keys |
| `structures.ts:47,228` | Deduplication key | Same issue; also allocates strings per feature |

**Fix:**
- For style diffing: track a `Set<string>` of dirty layer/property names, or compare expression objects by reference if MapLibre preserves identity.
- For deduplication: use a spatial hash or stable canonical serialization (e.g. sort vertices, then stringify).

---

## 3. Centralize magic numbers

**Problem:** Hardcoded values are scattered with no single source of truth:

| File | Value | Meaning |
|---|---|---|
| `structures.ts:202` | `major ? 4 : 3` + `layer * 1.5` | Bridge clearance |
| `structures.ts:116` | `floor * 3.5 + 2.1` | Facade window Y |
| `Details.tsx:33-41` | `7.5 * s`, `2.5 * s` | Canopy/trunk scale |
| `Details.tsx:191-195` | `400/600/800` | Shadow camera extents |
| `geography.ts:73` | `cap * 14` | Rejection sampling multiplier |
| `details-data.ts:118-139` | `12000`, `4000`, `160` | Attempt/area budget constants |

**Fix:** Move these into `config.ts` as named constants (or a `Constants` object) so they are discoverable, tunable, and testable in one place.

---

## 4. Tighten `parseConfig` validation

**Problem:** `config.ts:275-278` iterates `Object.keys(DEFAULT_CONFIG)` and copies values. Two issues:
1. Unknown keys in imported JSON are silently ignored — a corrupted or future-format file won't warn the user.
2. If `DEFAULT_CONFIG` and `WorldConfig` drift (e.g. a new optional field), validation silently breaks.

**Fix:** After the known-key loop, check `Object.keys(v).length === Object.keys(DEFAULT_CONFIG).length` (or use a whitelist). Consider adding a `_unknown` catch or at minimum a warning. Use `zod` or a runtime schema library for stricter validation if the config surface keeps growing.

---

## 5. Reduce `queryRenderedFeatures(undefined, ...)` fan-out

**Problem:** `details-data.ts:59-68` and `structures.ts:37-39,171` call `queryRenderedFeatures(undefined, { layers: [...] })`. Passing `undefined` for the first argument queries *all* rendered features in the viewport and then filters in JS. With many layers (water, roads, buildings, landcover, parks, bridges), this is expensive on every tile load.

**Fix:** If MapLibre supports bounding-box filtering for these calls, pass a bbox derived from the current view. Alternatively, call `queryRenderedFeatures` per layer and union the results — this lets MapLibre skip layers that have no visible features.

---

## 6. Fix `useEffect` dependency drift in `WorldMap.tsx`

**Problem:** `WorldMap.tsx:106-122` lists ~15 individual config fields as effect dependencies. Every time a new toggle or slider is added that affects detail generation, it must be manually appended here. Missing one causes stale data.

**Fix:** Use a single memoized selector or a version counter from the store. For example, add `detailVersion` to the Zustand store that increments whenever any detail-relevant field changes, and depend on that single value. The refresh handler already reads `configRef.current`, so the selector only needs to trigger the effect.

---

## 7. Improve `localMeters` projection accuracy

**Problem:** `geography.ts:82-91` uses an equirectangular approximation:
```ts
(point[0] - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180)
```
This is only correct at the equator. At 60° latitude the X scale is off by ~50%. For a tool that aims to place geometry accurately relative to the camera, this causes noticeable stretching away from the equator.

**Fix:** Use a proper projected coordinate system. The simplest drop-in is the Web Mercator auxiliary sphere (EPSG:3857) — convert lng/lat to meters with the standard formula:
```ts
const R = 6378137;
const x = R * lng * Math.PI / 180;
const y = R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
```
Then subtract the origin projected point. This keeps Y flatness consistent at all latitudes and matches what MapLibre uses internally.

---

## 8. Make `hashString` collision-resistant

**Problem:** `geography.ts:29-34` uses 32-bit FNV-1a. For polygon deduplication and seeding, collisions between very different strings are unlikely but not impossible. As the dataset grows (more features, more zoom levels), the chance of two distinct ring fingerprints colliding increases.

**Fix:** Upgrade to a 64-bit hash (e.g. MurmurHash3 or xxHash) if performance permits, or at minimum use a cryptographic hash like SHA-256 truncated to 64 bits. Given the low throughput (called once per feature per collection pass), a stronger hash has negligible performance cost.

---

## 9. Decouple browser test from `react-three-map` internals

**Problem:** `tests/browser/world.mjs:22-32` accesses `window.verificationRoot.store.getState()` and `s.r3m.map`, which are `react-three-map` internal APIs. Any minor version bump of that library will break the E2E test.

**Fix:** Expose a test-only hook or a small public API on `WorldMap` that reports status (e.g. `data.trees.length`, DPR sync) without reaching into R3F internals. Alternatively, use DOM-visible assertions (e.g. count rendered instanced meshes via Three.js scene graph exposed through a test channel).

---

## 10. Add `zod` (or equivalent) for config schema

**Problem:** `parseConfig` does ad-hoc type checking and range validation inline. Adding a new config field requires updating `DEFAULT_CONFIG`, `WorldConfig`, the `ranges` object, and the enum checks — all in different places.

**Fix:** Define the `WorldConfig` schema once with `zod`. Derive `DEFAULT_CONFIG`, the TypeScript type, and the validator from the same source. This eliminates drift and makes `parseConfig` a one-liner (`WorldConfigSchema.parse(raw)`).

---

## 11. Handle missing layers gracefully in collectors

**Problem:** `details-data.ts:67` filters `layers` with `!!map.getLayer(id)`, which is good. But `structures.ts:37-39` and `structures.ts:171` call `queryRenderedFeatures` on `"buildings"` and `"bridges"` without checking if those layers exist. If a tile source is misconfigured or a layer is missing, `queryRenderedFeatures` returns an empty array — no crash, but it's implicit. More importantly, `geography.ts:88-93` road width logic is duplicated in both `details-data.ts` and `structures.ts`.

**Fix:** Extract road-width logic into `geography.ts` (e.g. `roadWidth(class)`) and add explicit guards with early returns and optional console warnings when expected layers are absent.

---

## 12. Avoid `any` / `unknown` casts where possible

**Problem:** `WorldMap.tsx:59` casts to `Parameters<MapLibreMap["setPaintProperty"]>[1]` to satisfy TypeScript. This is safe but noisy.

**Fix:** Define a `type PaintValue = MapLibreMap extends { setPaintProperty: (...args: infer A) => any } ? A[2] : never;` helper, or simply use `unknown` → `MapLibreMap["setPaintProperty"]` overload if MapLibre's types are precise enough. Alternatively, store typed style diffs rather than raw `Record<string, unknown>`.

---

## 13. `wrapLongitude` edge case

**Problem:** `geography.ts:93`:
```ts
export function wrapLongitude(longitude:number) { return ((longitude+180)%360+360)%360-180 }
```
This is correct, but the compressed one-liner is hard to read and debug. If `longitude` is `NaN` or `Infinity`, it silently returns a wrong value.

**Fix:** Expand to a named function with an early guard:
```ts
export function wrapLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) throw new RangeError("longitude must be finite");
  let l = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Math.abs(l - 180) < 1e-10 ? 180 : l;
}
```

---

## 14. Add integration test for `collectDetails` / `collectStructures`

**Problem:** `details.test.ts` has one unit test that mocks MapLibre. The collectors are the most complex and performance-sensitive code in the project, but there are no tests verifying:
- Budget caps are respected under load
- Obstacle avoidance doesn't place trees inside water/buildings
- Bridge part count stays ≤ 500
- Facade generation doesn't exceed per-building or global caps

**Fix:** Add a test suite that builds a minimal fake `MapLibreMap` with `queryRenderedFeatures`, `getZoom`, `getCenter`, and `queryTerrainElevation` stubs. Feed in synthetic GeoJSON features and assert on the output arrays.

---

## 15. Consider extracting `styles.css` into CSS modules or Tailwind

**Problem:** `src/styles.css` is ~1364 lines of global class selectors. There is no scoping strategy, so adding new components risks class name collisions. The specificity is also hard to manage.

**Fix:** For a project of this size, migrating to CSS modules (`*.module.css`) or a utility-first approach (Tailwind) would scope styles and reduce the global CSS surface. If staying with plain CSS, at minimum group styles by component with clear comment headers and consider BEM naming.

---

## Priority summary

| Priority | Item |
|---|---|
| **High** | Enforce formatting (Prettier + ESLint) |
| **High** | Replace `JSON.stringify` equality checks with proper diffing |
| **High** | Fix `localMeters` projection (Web Mercator) |
| **Medium** | Centralize magic numbers |
| **Medium** | Tighten `parseConfig` with a schema library |
| **Medium** | Decouple browser tests from library internals |
| **Medium** | Reduce `queryRenderedFeatures(undefined)` fan-out |
| **Medium** | Add collector integration tests |
| **Low** | Upgrade `hashString` to 64-bit |
| **Low** | Migrate `styles.css` to scoped strategy |
| **Low** | Add `wrapLongitude` guard + readability |
| **Low** | Extract road-width logic into `geography.ts` |
