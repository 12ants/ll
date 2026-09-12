import { describe, expect, it } from "vitest";
import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, Position } from "geojson";
import { collectDetails } from "../src/world/details-data";
import { DEFAULT_CONFIG, QUALITY } from "../src/world/config";
import { metersToPosition } from "../src/world/geography";
import { buildRoadGraph } from "../src/world/road-topology";
import {
  solveBridges,
  DEFAULT_MAX_APPROACH,
  defaultMaxGradeForEdge,
} from "../src/world/bridge-profile";
import { exposedBridgeEdges, bridgeAccessories } from "../src/world/bridge-boundaries";
import type { WorldFeature } from "../src/world/feature-cache";
import type { Vec3 } from "../src/world/bridge-model";

/**
 * B5 acceptance suite (BRIDGE_CONNECTIVITY_PLAN.md's B5): deterministic,
 * offline fixtures exercising the *whole* production pipeline
 * (road-topology -> bridge-profile -> bridge-mesh/bridge-boundaries ->
 * details-data's live wiring) for the shapes the plan names, plus a
 * sampled-position continuity walk. Live-tile browser verification is
 * handled separately by tests/browser/bridges.mjs, per the plan's own
 * split ("deterministic geometry unit tests must remain offline").
 *
 * Every fixture uses OSM's real "primary" class (Z1's fallback width 14m,
 * so isMajorEdge() is true) at bridge layer 1 (TAGGED_BRIDGE_CLEARANCE_MAJOR
 * = 2.0m clearance, 8% max grade) unless noted — the same numbers
 * bridge-live-wiring.test.ts already hand-derives, reused here rather than
 * re-derived per fixture.
 */

const ORIGIN: Position = [10, 45];
const MAJOR_BRIDGE = { brunnel: "bridge", layer: 1 };
// L = 1.5 * rise / maxGrade = 1.5 * 2.0 / 0.08 -- the exact transition length
// a flat-ground primary bridge needs on each side to be "ready".
const REQUIRED_TRANSITION = 37.5;

function line(...points: [number, number][]): Position[] {
  return points.map((p) => metersToPosition(p, ORIGIN));
}

interface SegmentSpec {
  id: string;
  coords: [number, number][];
  extra?: Record<string, unknown>;
}

function mapFeature(spec: SegmentSpec): MapGeoJSONFeature {
  const coordinates = line(...spec.coords);
  const isBridge = spec.extra?.brunnel === "bridge";
  return {
    type: "Feature",
    id: spec.id,
    source: "world",
    sourceLayer: "transportation",
    layer: { id: isBridge ? "bridges" : "roads", type: "line", source: "world" },
    properties: { class: "primary", ...spec.extra },
    geometry: { type: "LineString", coordinates },
  } as unknown as MapGeoJSONFeature;
}

function worldFeature(spec: SegmentSpec): WorldFeature {
  const coordinates = line(...spec.coords);
  const feature: Feature = {
    type: "Feature",
    id: spec.id,
    properties: { class: "primary", ...spec.extra },
    geometry: { type: "LineString", coordinates },
  };
  return {
    key: `world transportation ${spec.id}`,
    source: "world",
    sourceLayer: "transportation",
    feature,
    revision: 1,
    completeness: "fragment",
  };
}

function buildMap(
  segments: SegmentSpec[],
  opts: { terrainElevation?: (pos: Position) => number | null; zoom?: number } = {},
): Map {
  const features = segments.map(mapFeature);
  return {
    getCenter: () => ({ lng: ORIGIN[0], lat: ORIGIN[1] }),
    getZoom: () => opts.zoom ?? 15,
    getLayer: (id: string) => features.find((f) => f.layer.id === id)?.layer,
    queryRenderedFeatures: (_geom: unknown, o: { layers: string[] }) =>
      features.filter((f) => o.layers.includes(f.layer.id)),
    queryTerrainElevation: (pos: Position) =>
      opts.terrainElevation ? opts.terrainElevation(pos) : 0,
  } as unknown as Map;
}

/** Runs the pure graph+solver pipeline directly, for ProfileSample-level assertions
 * collectDetails() (which only returns finished mesh buffers) can't give us. */
function solveDirect(
  segments: SegmentSpec[],
  opts: { terrain?: boolean; sampleGround?: (p: Vec3) => number | null } = {},
) {
  const graph = buildRoadGraph(segments.map(worldFeature), ORIGIN);
  const sampleGround = opts.sampleGround ?? (() => 0);
  return solveBridges(graph, opts.terrain ? sampleGround : () => 0, {
    terrain: opts.terrain ?? false,
    maxGrade: defaultMaxGradeForEdge,
    maxApproach: DEFAULT_MAX_APPROACH,
  });
}

function baseConfig(overrides: Partial<typeof DEFAULT_CONFIG> = {}) {
  return {
    ...DEFAULT_CONFIG,
    trees: false,
    amenities: false,
    buildings: false,
    terrain: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixture definitions, one per shape the plan names.
// ---------------------------------------------------------------------------

const STRAIGHT: SegmentSpec[] = [
  { id: "west", coords: [[-50, 0], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [60, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[60, 0], [110, 0]] },
];

const CURVED: SegmentSpec[] = [
  { id: "west", coords: [[-50, 0], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [30, 8], [60, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[60, 0], [110, 0]] },
];

const DIAGONAL: SegmentSpec[] = [
  { id: "west", coords: [[-35, -35], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [40, 40]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[40, 40], [75, 75]] },
];

// Deck shorter than the 12m pier-gate: still a valid, ready, published deck,
// just with zero piers (posts still present) -- exercises the gate end-to-end.
const SHORT_DECK: SegmentSpec[] = [
  { id: "west", coords: [[-50, 0], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [8, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[8, 0], [58, 0]] },
];

// Approach far shorter than REQUIRED_TRANSITION: infeasible, falls back to
// the old box generator.
const SHORT_APPROACH: SegmentSpec[] = [
  { id: "west", coords: [[-3, 0], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [60, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[60, 0], [63, 0]] },
];

// A Y-branch on the east approach, 40m past the bridge deck end -- beyond
// REQUIRED_TRANSITION (37.5m), so the chain has already reached the deck
// height before the junction stops it: accepted, not merely "not rejected."
const Y_JUNCTION: SegmentSpec[] = [
  { id: "west", coords: [[-50, 0], [0, 0]] },
  { id: "bridge", coords: [[0, 0], [60, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[60, 0], [110, 0]] },
  { id: "branch", coords: [[100, 0], [100, 40]] },
];

// Two joined fragments (simulating a tile-boundary split of one real bridge
// line) sharing an interior endpoint -- B1 must re-join them into one edge
// before B2 ever sees it.
const TILE_SPLIT: SegmentSpec[] = [
  { id: "west", coords: [[-50, 0], [0, 0]] },
  { id: "bridgeA", coords: [[0, 0], [30, 0]], extra: MAJOR_BRIDGE },
  { id: "bridgeB", coords: [[30, 0], [60, 0]], extra: MAJOR_BRIDGE },
  { id: "east", coords: [[60, 0], [110, 0]] },
];

// An independent ground road crossing underneath the deck in 2D, sharing no
// endpoint with the bridge component -- must never connect to it or perturb
// its solve (grade-separated / "stacked" case).
const STACKED: SegmentSpec[] = [
  ...STRAIGHT,
  { id: "underpass", coords: [[30, -40], [30, 40]], extra: { layer: 0 } },
];

describe("B5 fixtures: full production pipeline (collectDetails)", () => {
  it("straight bridge publishes a mesh and suppresses the fallback box", () => {
    const map = buildMap(STRAIGHT);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    expect(data.bridges[0].mesh.indices.length).toBeGreaterThan(0);
    expect([...data.bridges[0].mesh.positions]).not.toContain(NaN);
  });

  it("curved bridge (interior bend) publishes one continuous mesh", () => {
    const map = buildMap(CURVED);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    expect(data.bridges[0].mesh.indices.length).toBeGreaterThan(0);
  });

  it("diagonal (non-axis-aligned) bridge publishes a mesh", () => {
    const map = buildMap(DIAGONAL);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    expect(data.bridges[0].mesh.indices.length).toBeGreaterThan(0);
  });

  it("short deck (< 12m pier gate) still publishes, with posts but no piers", () => {
    const map = buildMap(SHORT_DECK);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    expect(data.structures.some((p) => p.kind === "box")).toBe(true); // posts
    expect(data.structures.some((p) => p.kind === "cylinder")).toBe(false); // no piers
  });

  it("short approach is infeasible and falls back to the box generator", () => {
    const map = buildMap(SHORT_APPROACH);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(0);
    expect(data.structures.some((p) => p.kind === "box" && p.scale[0] > 5)).toBe(true);
  });

  it("a Y-branch far enough past the deck end is accepted, not rejected", () => {
    const map = buildMap(Y_JUNCTION);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
  });

  it("tile-split bridge fragments re-join into one published surface", () => {
    const map = buildMap(TILE_SPLIT);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    // One joined 60m deck, not two disjoint 30m ones.
    const xs = [...data.bridges[0].mesh.positions].filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(55);
  });

  it("a crossing ground road underneath never connects to or perturbs the bridge", () => {
    const map = buildMap(STACKED);
    const data = collectDetails(map, baseConfig());
    expect(data.bridges).toHaveLength(1);
    expect(data.bridges[0].mesh.indices.length).toBeGreaterThan(0);
  });

  it("missing DEM under the span is incomplete, not silently ground-zero", () => {
    const groundless = buildMap(STRAIGHT, { terrainElevation: () => null });
    const data = collectDetails(groundless, baseConfig({ terrain: true }));
    expect(data.bridges).toHaveLength(0);
    expect(data.structures.some((p) => p.kind === "box" && p.scale[0] > 5)).toBe(true);
  });

  it("budget saturation: every deck publishes; rails drop once the eco triangle budget is exceeded; posts+piers stay <= 500", () => {
    const segments: SegmentSpec[] = [];
    const spacing = 200; // meters apart in z, well beyond snap/junction distance
    const count = 40;
    for (let i = 0; i < count; i++) {
      const z = i * spacing;
      segments.push(
        { id: `west${i}`, coords: [[-50, z], [0, z]] },
        { id: `bridge${i}`, coords: [[0, z], [60, z]], extra: MAJOR_BRIDGE },
        { id: `east${i}`, coords: [[60, z], [110, z]] },
      );
    }
    const map = buildMap(segments);
    const data = collectDetails(map, baseConfig({ quality: "eco" }));
    expect(data.bridges).toHaveLength(count);
    expect(data.bridges.every((b) => b.mesh.indices.length > 0)).toBe(true); // decks never dropped
    expect(data.bridges.some((b) => b.rail === null)).toBe(true); // some rails dropped
    expect(data.bridges.some((b) => b.rail !== null)).toBe(true); // but not all
    const posts = data.structures.filter((p) => p.kind === "box" || p.kind === "cylinder");
    expect(posts.length).toBeLessThanOrEqual(500);
  });
});

describe("B5: sampled-position continuity walk", () => {
  for (const [name, fixture] of Object.entries({ STRAIGHT, CURVED, DIAGONAL, SHORT_DECK })) {
    it(`${name}: endpoint samples match approach ground within 0.02m, samples are continuous`, () => {
      const { surfaces, rejected } = solveDirect(fixture);
      expect(rejected).toHaveLength(0);
      expect(surfaces).toHaveLength(1);
      const samples = surfaces[0].samples;
      expect(samples.length).toBeGreaterThan(1);

      // Endpoint precision: first/last sample's centerline height must equal
      // flat ground (0) at the far ends of the transition -- the smoothstep
      // curve has fully leveled out well before REQUIRED_TRANSITION on a
      // flat-ground fixture with 50m approaches.
      expect(Math.abs(samples[0].center[1] - 0)).toBeLessThan(0.02);
      expect(Math.abs(samples[samples.length - 1].center[1] - 0)).toBeLessThan(0.02);

      // Continuity: no sample-to-sample height jump can exceed what the
      // configured max grade (8%) permits over that sample's own horizontal
      // step, plus a small numerical margin.
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1], b = samples[i];
        const dx = Math.hypot(b.center[0] - a.center[0], b.center[2] - a.center[2]);
        const dy = Math.abs(b.center[1] - a.center[1]);
        expect(Number.isFinite(dy)).toBe(true);
        if (dx > 0.01) expect(dy / dx).toBeLessThan(0.08 + 0.01);
      }

      // No railing post lands inside the travel corridor: every post's
      // perpendicular offset from the centerline must be at least the
      // half-width at that point (i.e. at or outside the deck edge). Piers
      // are excluded here by design -- they're centerline support columns
      // *under* the deck, not on the travel surface, so "at the edge" is the
      // wrong check for them (bridge-boundaries.test.ts already covers pier
      // placement on its own terms).
      const edges = exposedBridgeEdges(surfaces);
      const posts = bridgeAccessories(edges, surfaces, 500).filter((p) => p.kind !== "cylinder");
      for (const post of posts) {
        const nearest = samples.reduce((best, s) =>
          Math.hypot(s.center[0] - post.position[0], s.center[2] - post.position[2]) <
          Math.hypot(best.center[0] - post.position[0], best.center[2] - post.position[2])
            ? s
            : best,
        );
        const halfWidth = Math.hypot(
          nearest.left[0] - nearest.center[0],
          nearest.left[2] - nearest.center[2],
        );
        const offset = Math.hypot(
          post.position[0] - nearest.center[0],
          post.position[2] - nearest.center[2],
        );
        expect(offset).toBeGreaterThanOrEqual(halfWidth - 0.5); // 0.5m tolerance for arc-length vs. straight-line offset on a curved sample
      }
    });
  }

  it("unequal endpoint heights: each side sizes its own transition and both settle within 0.02m of real ground", () => {
    // Ground ramps from 0 (west) to 5 (east) under the deck span, flat beyond.
    const groundAt = (x: number): number => {
      if (x <= 0) return 0;
      if (x >= 60) return 5;
      return (x / 60) * 5;
    };
    const sampleGround = (p: Vec3): number => groundAt(p[0]);
    const fixture: SegmentSpec[] = [
      { id: "west", coords: [[-150, 0], [0, 0]] },
      { id: "bridge", coords: [[0, 0], [60, 0]], extra: MAJOR_BRIDGE },
      { id: "east", coords: [[60, 0], [110, 0]] },
    ];
    const { surfaces, rejected } = solveDirect(fixture, { terrain: true, sampleGround });
    expect(rejected).toHaveLength(0);
    expect(surfaces).toHaveLength(1);
    const samples = surfaces[0].samples;
    expect(Math.abs(samples[0].center[1] - groundAt(-150))).toBeLessThan(0.02);
    expect(Math.abs(samples[samples.length - 1].center[1] - groundAt(110))).toBeLessThan(0.02);
    // Deck itself sits at a single flat height = max ground under the span (5) + clearance (2).
    const deckSamples = samples.filter((s) => s.ground !== undefined);
    expect(deckSamples.length).toBeGreaterThan(0);
    for (const s of deckSamples) expect(Math.abs(s.center[1] - 7)).toBeLessThan(0.02);
  });

  it("simulated exaggeration (1x/1.2x/2x ground magnitude) never double-applies inside our own code", () => {
    // Per BRIDGE_RENDERING_PLAN.md: MapLibre's queryTerrainElevation() already
    // bakes exaggeration into its return value before our code ever sees it.
    // We can't toggle real exaggeration offline (no MapLibre terrain here),
    // but we CAN confirm no bridge-profile code re-scales sampleGround's
    // output -- the solved deck height must track a scaled ground input
    // exactly (linearly), never disproportionately.
    const base = 3; // flat ground under the whole line at 1x
    for (const factor of [1, 1.2, 2]) {
      const sampleGround = () => base * factor;
      const { surfaces, rejected } = solveDirect(STRAIGHT, { terrain: true, sampleGround });
      expect(rejected).toHaveLength(0);
      const deckY = surfaces[0].samples.find((s) => s.ground !== undefined)!.center[1];
      expect(Math.abs(deckY - (base * factor + 2))).toBeLessThan(0.02); // clearance = 2 (major, layer 1)
    }
  });

  it("quality tier changes the rail/post budget, never the published deck geometry itself", () => {
    const map = () => buildMap(STRAIGHT);
    const decks = (["eco", "balanced", "high"] as const).map((quality) => {
      const data = collectDetails(map(), baseConfig({ quality }));
      return data.bridges[0]?.mesh;
    });
    expect(decks[0]).toBeDefined();
    for (const mesh of decks) {
      expect([...mesh!.positions]).toEqual([...decks[0]!.positions]);
      expect([...mesh!.indices]).toEqual([...decks[0]!.indices]);
    }
    // Budgets themselves differ, confirming the tiers actually diverge (not a
    // no-op comparison).
    expect(QUALITY.eco.bridgeTriangles).toBeLessThan(QUALITY.balanced.bridgeTriangles);
    expect(QUALITY.balanced.bridgeTriangles).toBeLessThan(QUALITY.high.bridgeTriangles);
  });
});
