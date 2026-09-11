# Game Mechanics Design — Terrene World Studio

**Date:** 2026-09-11
**Status:** Draft — awaiting review

## 1. Goal

Add a walking-sim / collect-a-thon game mode on top of the existing 3D geographic viewer. The player walks the real-world map, finds collectibles, completes proximity-based objectives, and builds score — without changing the viewer's existing behavior when the game is inactive.

Success criteria:
- Game mode activates/deactivates without reloading the map.
- Player position updates smoothly using the existing camera + terrain elevation.
- Collectibles and NPCs render via the existing instanced-detail pipeline.
- Objectives trigger by proximity, with visible HUD feedback.
- All game state lives alongside `WorldConfig` in the same Zustand store.
- No new heavy dependencies for v1.

---

## 2. Current-state recap

The app is an event-driven viewer:
- MapLibre renders vector tiles (buildings, roads, water, terrain).
- React Three Fiber renders instanced geometry (trees, benches, facades, bridges) in the same WebGL context via `react-three-map`.
- `collectDetails(map, config)` runs after tile load / camera stop (debounced 250 ms) and produces `WorldDetails` consumed by `Details.tsx`.
- Zustand store (`useWorld`) holds `config` only, with `update`, `replace`, and `save`.
- `localMeters(lngLat, origin)` converts geographic coordinates to camera-relative meters. Y is always `0` when terrain is off; `queryTerrainElevation` is called only when `terrain` is enabled.
- `Details.tsx` renders six instanced-mesh kinds: `canopy`, `trunk`, `seat`, `legs`, `bin`, plus two structure groups (`box`, `cylinder`).
- R3F `frameloop` is `"demand"` by default, switching to `"always"` when the profiler is active.

---

## 3. Proposed architecture

### 3.1 Store: additive `game` slice

Extend `useWorld` with a `game` field. No breaking change to existing `config` reads/writes.

```ts
// src/world/config.ts additions

interface Entity {
  id: string;
  kind: "collectible" | "npc" | "info";
  lng: number;
  lat: number;
  elevation: number;
  /** Instancing parameters */
  scale: number;
  rotation: number;
  tone: number;
  /** Objective linkage */
  objectiveId?: string;
}

interface Objective {
  id: string;
  label: string;
  type: "collect" | "reach" | "trigger";
  /** For "collect": entity ids. For "reach": [lng, lat]. For "trigger": region polygon. */
  target: string | [number, number] | Position[][];
  radius: number; // meters
  completed: boolean;
}

interface GameState {
  active: boolean;
  player: { lng: number; lat: number; elevation: number } | null;
  entities: Entity[];
  objectives: Objective[];
  score: number;
  collected: Set<string>;
}

interface WorldStore {
  config: WorldConfig;
  game: GameState;
  startGame: () => void;
  stopGame: () => void;
  collectEntity: (id: string) => void;
  completeObjective: (id: string) => void;
  updatePlayer: (pos: { lng: number; lat: number; elevation: number }) => void;
  // existing fields unchanged
}
```

`GameState` is **not** persisted to `localStorage` in v1. The existing `save()` continues to serialize `config` only. Game state resets on reload.

### 3.2 New `src/game/` modules

| File | Responsibility |
|---|---|
| `src/game/entities.ts` | `Entity` + `spawnEntities(map, config, origin): Entity[]`. Deterministic placement using `hashString(featureId) + config.seed` and the same `seeded()` PRNG as trees/benches. Collectibles are placed in parks and along roads; NPCs along footways; info points at building centroids. Respects `QUALITY[config.quality].trees` as an upper bound for total entity count. |
| `src/game/objectives.ts` | `Objective` + `checkProximity(player, entities, objectives): { completed: Objective[]; collected: string[] }`. Runs every game-loop tick. Returns state transitions; caller dispatches to store. |
| `src/game/player.ts` | `PlayerController` — reads keyboard input (WASD / arrow keys), converts to lng/lat delta via `localMeters` inverse, grounds via `queryTerrainElevation` when `config.terrain` is true. Produces `{ lng, lat, elevation }` updates. |
| `src/game/loop.ts` | `useGameLoop(map, config, game, dispatch)` — `requestAnimationFrame` tick. Active only when `game.active` is true. Sequence per frame: read input → update player → `checkProximity` → dispatch → `invalidate()`. Switches R3F `frameloop` to `"always"` while running. |
| `src/game/hud.tsx` | DOM overlay: minimap, objectives checklist, score, active-controls hint. Pure React, positioned over the canvas via the existing CSS chrome system. |

### 3.3 WorldMap.tsx changes

Add a `gameActive` prop.

```ts
interface Props {
  config: WorldConfig;
  profile: boolean;
  orbit: boolean;
  gameActive: boolean;
  onReady: (map: MapLibreMap) => void;
  onStatus: (status: MapStatus) => void;
}
```

New effect, parallel to the existing detail-refresh effect:

```ts
useEffect(() => {
  if (!ready || !gameActive) return;
  const map = ref.current!.getMap();
  return useGameLoop(map, config, game, dispatch);
}, [ready, gameActive, /* config fields that affect player speed or terrain gating */]);
```

When `gameActive` is true, pass `frameloop="always"` to `<Canvas>`.

All existing effects remain unchanged. When `gameActive` is false, the new effects are no-ops and `frameloop` reverts to `"demand"`.

### 3.4 Details.tsx changes

Add two new `Instances` calls inside the existing fragment, reusing the same pattern:

```tsx
<Instances data={data.structures.filter(p => p.kind === "box")} geometry="box" />
<Instances data={data.structures.filter(p => p.kind === "cylinder")} geometry="cylinder" />
{game.active && (
  <>
    <Instances data={game.entities.filter(e => e.kind === "collectible")} kind="collectible" />
    <Instances data={game.entities.filter(e => e.kind === "npc")} kind="pedestrian" />
    <PlayerMesh position={game.player} />
  </>
)}
```

New `kind` branches in `Instances`:
- `"collectible"` → `sphereGeometry(1, 12, 8)`, colored by `tone` mapped to a warm gold-to-cyan range.
- `"pedestrian"` → capsule-like group: cylinder body + sphere head, colored in desaturated palette mid-tones.

`PlayerMesh` is a single non-instanced mesh (a simple capsule) placed at `game.player` position, updated each frame via `useLayoutEffect` when `game.player` changes.

### 3.5 App.tsx changes

1. Add a "Start game" / "End game" button in the bottom controls or topbar.
2. On start:
   - Call `useWorld.startGame()` which sets `game.active = true` and calls `spawnEntities(map, config, origin)`.
   - Close the inspector if open (optional; keeps the view unobstructed).
3. Render `<HUD />` when `game.active` is true.
4. Extend the keyboard handler: when `game.active`, WASD / arrows move the player; `E` interacts with nearby collectibles; `Esc` ends the game.
5. Existing keyboard shortcuts (`H`, `O`, `P`) remain active — they are additive.

---

## 4. Data flow

```
User clicks "Start game"
  → useWorld.startGame()
    → spawnEntities(map, config, origin)
      → queryRenderedFeatures for parks, roads, footways, building footprints
      → hashString(feature.id) + seeded(hash + config.seed) → deterministic placement
      → returns Entity[] with collectibles, npcs, info points
    → set game.active = true, game.entities = [...]
    → set game.player = map.getCenter() + queryTerrainElevation

Every frame (game loop, active only when game.active):
  → PlayerController.readInput() → velocity vector in local meters
  → newLngLat = invertLocalMeters(player.position + velocity * dt)
  → elevation = config.terrain ? queryTerrainElevation(newLngLat) ?? 0 : 0
  → updatePlayer({ lng: newLngLat[0], lat: newLngLat[1], elevation })
  → checkProximity(player, entities, objectives)
      → for each objective:
          if type === "collect": is player within radius of any uncollected entity with objectiveId?
          if type === "reach": is player within radius of target lng/lat?
          if type === "trigger": is player inside target polygon?
      → returns { completed: Objective[], collected: string[] }
  → dispatch(completeObjective / collectEntity)
  → invalidate() → Details.tsx rebuilds player + entity matrices

Rendering:
  → Details.tsx: player capsule + collectible spheres + NPC capsules
  → HUD.tsx: objectives, score, minimap
  → MapLibre: base map continues underneath, unaffected
```

---

## 5. Key mechanics

### 5.1 Player movement

- Speed: configurable via `WorldConfig` (e.g. `playerSpeed: number`, default 5 m/s). In v1, hardcode 5 m/s.
- Grounding: when `config.terrain` is true, call `queryTerrainElevation` on the new position each frame. When false, `elevation = 0`.
- Boundaries: soft boundary using `insidePolygon` against water/buildings queried from `queryRenderedFeatures`. If the player steps into an obstacle, push them back to the last valid position. This reuses the existing `insidePolygon` from `geography.ts`.
- Camera: the MapLibre camera follows the player. Each frame, `map.easeTo({ center: [player.lng, player.lat], duration: 0 })` keeps the map centered. Pitch and bearing are preserved from the last manual camera position.

### 5.2 Collectibles

- Placed deterministically: for each park polygon, call `scatterPolygon(rings, count, seed)` with `count = Math.min(20, parkArea / 200)`. Hash each point to decide if it becomes a collectible.
- Types: `"token"` (gold sphere, +10 score), `"badge"` (larger icosahedron, +50 score, rarer).
- Proximity trigger: 8 m radius. On collection, the entity is removed from `game.entities` and `game.score` increases.
- Objective linkage: a `"collect"` objective targets a set of entity IDs. Completing all entities in the set marks the objective complete and triggers the next.

### 5.3 NPCs / pedestrians

- Placed along `highway` features with `class` in `["footway", "pedestrian", "path"]`.
- Movement: each NPC has a `path: [lngLat, ...]` array derived from the line geometry. They interpolate along the path using `seeded(npcHash + frame * 0.001)` so they move at varied speeds without a physics engine.
- Proximity: when the player is within 5 m of an NPC, a speech-bubble-style tooltip appears in the HUD with a lore string seeded from the NPC's hash.

### 5.4 Objectives

Three types:
- **Collect** — "Find 3 golden tokens in Central Park". Targets are entity IDs.
- **Reach** — "Walk to the bridge at [lng, lat]". Target is a coordinate; radius 15 m.
- **Trigger** — "Enter the Old Town district". Target is a polygon (from a `landuse` or `park` feature); player `insidePolygon` check.

Objectives are pre-defined per `PLACES` entry. Each place has an `objectives` array:

```ts
// In config.ts, inside each PLACES entry:
{
  id: "stockholm",
  objectives: [
    { id: "o1", label: "Cross the bridge", type: "reach", target: [18.0686, 59.3251], radius: 20 },
    { id: "o2", label: "Find 3 tokens", type: "collect", target: ["e1", "e2", "e3"], radius: 8 },
  ]
}
```

When all objectives for a place are complete, the player sees a "World complete" toast and can end the game.

### 5.5 HUD

Minimap: a 160×160 px `<canvas>` element in the corner. Draws:
- A dot for the player (center).
- Filled circles for nearby collectibles (gold) and uncompleted objectives (blue).
- A faint ring for the current objective radius.

The minimap reads `game.entities`, `game.objectives`, and `game.player` from the store. It does not read MapLibre state directly; it uses `localMeters` to project entity positions relative to the player.

Objectives panel: a 200 px wide sidebar listing active objectives with checkmarks for completed ones. Collapses on mobile.

Score: top-right, large number, animates with a CSS transition when it changes.

---

## 6. File changes

### New files

| Path | Purpose |
|---|---|
| `src/game/entities.ts` | Entity type + `spawnEntities` |
| `src/game/objectives.ts` | Objective type + `checkProximity` |
| `src/game/player.ts` | `PlayerController` input → movement |
| `src/game/loop.ts` | `useGameLoop` rAF tick |
| `src/game/hud.tsx` | HUD overlay components |
| `docs/superpowers/specs/2026-09-11-game-mechanics-design.md` | This document |

### Modified files

| Path | Change |
|---|---|
| `src/world/config.ts` | Add `Entity`, `Objective`, `GameState` types; extend `WorldStore` with `game` slice + action methods; add `objectives` to `PLACES` entries; add optional `playerSpeed` to `WorldConfig`. |
| `src/world/WorldMap.tsx` | Add `gameActive` prop; new `useGameLoop` effect; pass `frameloop` based on `gameActive \|\| profile`. |
| `src/world/Details.tsx` | Add `game` prop; render `PlayerMesh` + entity `Instances` when `game.active`. Extend `Instances` with `"collectible"` and `"pedestrian"` geometry branches. |
| `src/App.tsx` | Add game start/stop button; render `<HUD>`; extend keyboard handler for WASD + E + Esc when game is active. |
| `tests/world.test.ts` | Add unit tests for `spawnEntities`, `checkProximity`, and `PlayerController` with a fake map. |
| `tests/browser/world.mjs` | Add Playwright test: start game → verify player mesh exists → move with WASD → collect a token → score increments → end game. |

### Unchanged files

`src/world/geography.ts`, `src/world/style.ts`, `src/world/details-data.ts`, `src/world/structures.ts` — untouched. Game entities are separate from tile-driven detail collection.

---

## 7. Testing plan

### Unit tests (`tests/world.test.ts` additions)

1. **`spawnEntities` respects quality caps** — mock `queryRenderedFeatures` with 100 park features; assert `entities.length <= QUALITY[config.quality].trees`.
2. **`spawnEntities` is deterministic** — same `map` mock + same `config.seed` produces identical `Entity[]`.
3. **`checkProximity` collects within radius** — player at origin, entity at `[8, 0]` m, radius 10 → collected.
4. **`checkProximity` completes reach objectives** — player within 15 m of target coordinate → objective completed.
5. **`checkProximity` completes trigger objectives** — player inside polygon → objective completed.
6. **`PlayerController` grounds on terrain** — mock `queryTerrainElevation` returns 3.2; new player elevation is 3.2.
7. **`PlayerController` respects terrain gating** — when `config.terrain` is false, elevation stays `0`.

### Browser tests (`tests/browser/world.mjs` additions)

1. Start game → verify `game.active` is true and player mesh exists in R3F scene.
2. Move player via keyboard → verify `game.player.lng/lat` updates.
3. Walk near a collectible → verify it disappears and `game.score` increments.
4. Complete all objectives → verify "World complete" toast appears.
5. End game → verify `game.active` is false, entities cleared, HUD removed.
6. Restart game → verify deterministic placement matches first run.

---

## 8. Performance and budget constraints

| Resource | Existing cap | Game-mode cap |
|---|---|---|
| Total instanced instances (all kinds) | `QUALITY.trees` + 60 benches + facade cap + 500 bridge | Add `QUALITY.trees * 0.3` for collectibles + `QUALITY.trees * 0.1` for NPCs |
| Draw calls | 6 InstancedMesh + 2 structure groups | +2 InstancedMesh (collectibles, NPCs) + 1 player mesh = 9 total |
| Game-loop JS | 0 ms/frame (demand mode) | < 2 ms/frame at 60 fps — pure distance checks, no allocations inside the tick |
| Memory | Per-detail arrays rebuilt on tile load | Entity array rebuilt on game start only; not per-frame |

The game loop runs at 60 fps only while active. When the game ends, `frameloop` reverts to `"demand"` and the rAF loop is cancelled. This matches the existing `profile` prop pattern exactly.

---

## 9. Dependencies

No new runtime dependencies for v1.

Optional future additions (deferred):
- `howler` or native Web Audio API for sound effects
- `cannon-es` for physics/character controller
- `zustand/middleware` for game-state devtools

---

## 10. Risks and mitigations

| Risk | Mitigation |
|---|---|
| `localMeters` equirectangular distortion (high latitudes) | Gate game activation to latitudes where `cos(lat) > 0.3` (roughly ±72°), or fix `localMeters` first (flagged in `IMPROVEMENT_SUGGESTIONS.md`). |
| `queryTerrainElevation` returns null when terrain is off | Player controller uses `0` fallback; no crash. |
| Entity placement intersects buildings/water | Reuse `insidePolygon` obstacle check from `details-data.ts` during `spawnEntities`. |
| Game loop allocates per frame | Use refs for mutable counters; avoid `new` inside the rAF tick. `checkProximity` iterates over typed arrays only. |
| HUD blocks map interaction on mobile | HUD uses `pointer-events: none` on the container, `pointer-events: auto` on buttons. Existing chrome pattern in `styles.css` already does this. |

---

## 11. Open questions for review

1. Should game state persist across reloads (separate from config save), or reset each session? Recommendation: reset in v1; add persistence in v2.
2. Should the player character be first-person (no visible avatar) or third-person capsule? Recommendation: third-person capsule for visual feedback; first-person is a toggle later.
3. Should collectibles respawn after collection, or are they permanent once collected per session? Recommendation: permanent per session; respawn on new game.
4. Should objectives be pre-defined per `PLACES` entry, or dynamically generated from map features? Recommendation: pre-defined for v1; dynamic generation is a natural v2 extension using the same `hashString` pattern.
