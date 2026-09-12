import { describe, expect, it } from "vitest";
import {
  solveBridge,
  solveBridges,
  defaultMaxGradeForEdge,
  DEFAULT_MAX_APPROACH,
} from "../src/world/bridge-profile";
import { buildRoadGraph } from "../src/world/road-topology";
import type { ProfileSample, RoadGraph, Vec3 } from "../src/world/bridge-model";
import { ORIGIN, metersLine, roadFeature } from "./fixtures/bridge-network";

const READY_MAX_GRADE = 0.15; // generous; sizes the transition to exactly 20m at clearance 2.0m (major/layer1)
const NEVER_SAMPLE = (): number => {
  throw new Error("sampleGround must not be called when terrain is off");
};

function flatGraph(bridgeLength: [number, number], approachLength: number): RoadGraph {
  const bridge = roadFeature({
    coordinates: metersLine([[100, 0], [100 + (bridgeLength[1] - bridgeLength[0]), 0]]),
    layer: 1,
    brunnel: "bridge",
    id: "bridge",
  });
  const west = roadFeature({
    coordinates: metersLine([[100 - approachLength, 0], [100, 0]]),
    id: "west",
  });
  const east = roadFeature({
    coordinates: metersLine([
      [100 + (bridgeLength[1] - bridgeLength[0]), 0],
      [100 + (bridgeLength[1] - bridgeLength[0]) + approachLength, 0],
    ]),
    id: "east",
  });
  return buildRoadGraph([west, bridge, east], ORIGIN);
}

function maxGrade(samples: readonly ProfileSample[]): number {
  let worst = 0;
  for (let i = 1; i < samples.length; i++) {
    const dz = samples[i].distance - samples[i - 1].distance;
    if (dz <= 0) continue;
    const dh = Math.abs(samples[i].center[1] - samples[i - 1].center[1]);
    worst = Math.max(worst, dh / dz);
  }
  return worst;
}

describe("solveBridge", () => {
  it("solves a ready profile on level ground with ample approaches", () => {
    const graph = flatGraph([100, 200], 100);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    expect(solution.surfaces).toHaveLength(1);
    const samples = solution.surfaces[0].samples;
    expect(samples.length).toBeGreaterThan(2);
    // Strictly increasing, deduplicated distances.
    for (let i = 1; i < samples.length; i++) expect(samples[i].distance).toBeGreaterThan(samples[i - 1].distance);
    // Deck (flat span) sits at clearance above ground zero.
    const deckHeight = Math.max(...samples.map((s) => s.center[1]));
    expect(deckHeight).toBeCloseTo(2, 5); // TAGGED_BRIDGE_CLEARANCE_MAJOR (layer 1)
    // Both ends settle back to ground.
    expect(samples[0].center[1]).toBeCloseTo(0, 5);
    expect(samples[samples.length - 1].center[1]).toBeCloseTo(0, 5);
    // Visual grade limit respected (generous tolerance for discretization).
    expect(maxGrade(samples)).toBeLessThan(READY_MAX_GRADE * 1.2);
    // Seam positions in all three axes, not merely the centerline's height.
    for (const s of samples) {
      expect(Math.hypot(s.left[0] - s.center[0], s.left[2] - s.center[2])).toBeCloseTo(7, 3); // width 14 / 2
      expect(Math.hypot(s.right[0] - s.center[0], s.right[2] - s.center[2])).toBeCloseTo(7, 3);
      expect(s.left[1]).toBeCloseTo(s.center[1], 6);
      expect(s.right[1]).toBeCloseTo(s.center[1], 6);
    }
  });

  it("caps the walked approach at maxApproach, truncating mid-segment", () => {
    // Ground rises steadily away from the bridge (0 under the span, 3 at x=-150
    // where the 250m cap should land, 6 at x=-300 where the uncapped 400m edge
    // would end) — the capped anchor's ground value is directly observable as
    // the height of the transition-zone's outermost included sample.
    const slopingGround = (point: Vec3): number => (point[0] < 0 ? -point[0] / 50 : 0);
    const graph = flatGraph([100, 200], 400); // approach edges longer than maxApproach
    const solution = solveBridge(graph, slopingGround, {
      terrain: true,
      maxGrade: READY_MAX_GRADE, // requires ~10m here (negative rise vs. anchor ground of 3), comfortably inside the 250m cap
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const samples = solution.surfaces[0].samples;
    // samples[0] is the transition zone's outer edge, where height == groundAtAnchor.
    expect(samples[0].center[1]).toBeCloseTo(3, 3); // ground at x=-150 (the capped anchor)
    expect(samples[0].center[1]).not.toBeCloseTo(6, 3); // would be x=-300 if uncapped
  });

  it("never calls sampleGround when terrain is off", () => {
    const graph = flatGraph([100, 200], 100);
    expect(() =>
      solveBridge(graph, NEVER_SAMPLE, { terrain: false, maxGrade: READY_MAX_GRADE, maxApproach: 250 }),
    ).not.toThrow();
  });

  it("reports incomplete when there are no bridge edges", () => {
    const road = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), id: "plain" });
    const graph = buildRoadGraph([road], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, { terrain: false, maxGrade: 0.15, maxApproach: 250 });
    expect(solution).toEqual({ status: "incomplete", reason: "no bridge edges in graph" });
  });

  it("rejects a bridge with no connected approach (dangling component)", () => {
    const bridge = roadFeature({
      coordinates: metersLine([[500, 500], [600, 500]]),
      layer: 1,
      brunnel: "bridge",
      id: "lonely",
    });
    const graph = buildRoadGraph([bridge], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, { terrain: false, maxGrade: READY_MAX_GRADE, maxApproach: 250 });
    expect(solution.status).toBe("infeasible");
  });

  it("marks the approach infeasible when it is too short for the required rise", () => {
    const graph = flatGraph([100, 200], 5); // needs ~20m, only 5m available (dead end, no junction)
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("infeasible");
    if (solution.status === "infeasible") expect(solution.reason).toMatch(/too short/);
  });

  it("solves different endpoint heights and matches the sampled ground at each anchor", () => {
    const westHeight = 10;
    const eastHeight = 0;
    const groundStep = (point: Vec3): number => (point[0] < 150 ? westHeight : eastHeight);
    const graph = flatGraph([100, 200], 200);
    const solution = solveBridge(graph, groundStep, {
      terrain: true,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const samples = solution.surfaces[0].samples;
    expect(samples[0].center[1]).toBeCloseTo(westHeight, 5);
    expect(samples[samples.length - 1].center[1]).toBeCloseTo(eastHeight, 5);
    const deckHeight = Math.max(...samples.map((s) => s.center[1]));
    expect(deckHeight).toBeCloseTo(westHeight + 2, 5); // max ground under span is the west value
  });

  it("keeps a curved bridge's interior bend in the profile with a continuous grade", () => {
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [150, 20], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "curved",
    });
    const west = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), id: "west" });
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "east" });
    const graph = buildRoadGraph([west, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const samples = solution.surfaces[0].samples;
    // The bend's extra length over the straight distance must show up in the samples.
    const xs = samples.map((s) => s.center[0]);
    expect(Math.max(...xs)).toBeGreaterThan(150);
    expect(maxGrade(samples)).toBeLessThan(READY_MAX_GRADE * 1.2);
  });

  it("clears a ground bump under the middle of the span, not just the endpoints", () => {
    const bumpHeight = 8;
    const groundBump = (point: Vec3): number => (point[0] > 140 && point[0] < 160 ? bumpHeight : 0);
    const graph = flatGraph([100, 200], 200); // longer approach: rise now includes the bump's clearance
    const solution = solveBridge(graph, groundBump, { terrain: true, maxGrade: READY_MAX_GRADE, maxApproach: 250 });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const deckHeight = Math.max(...solution.surfaces[0].samples.map((s) => s.center[1]));
    expect(deckHeight).toBeCloseTo(bumpHeight + 2, 5);
  });

  it("stays finite over wavy ground (terrain bumps) without producing NaN/Infinity", () => {
    const wavyGround = (point: Vec3): number => 2 * Math.sin(point[0] / 15);
    const graph = flatGraph([100, 200], 150);
    const solution = solveBridge(graph, wavyGround, { terrain: true, maxGrade: READY_MAX_GRADE, maxApproach: 250 });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    for (const s of solution.surfaces[0].samples) {
      expect(Number.isFinite(s.center[1])).toBe(true);
      expect(Number.isFinite(s.left[1])).toBe(true);
      expect(Number.isFinite(s.right[1])).toBe(true);
    }
  });

  it("reports incomplete when a required ground sample under the span is missing", () => {
    const missingUnderBridge = (point: Vec3): number | null => (point[0] > 140 && point[0] < 160 ? null : 0);
    const graph = flatGraph([100, 200], 100);
    const solution = solveBridge(graph, missingUnderBridge, {
      terrain: true,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("incomplete");
    if (solution.status === "incomplete") expect(solution.reason).toMatch(/missing ground/);
  });

  it("reports incomplete when a required approach-anchor ground sample is missing", () => {
    const missingAtWestAnchor = (point: Vec3): number | null => (point[0] <= 0 ? null : 0);
    const graph = flatGraph([100, 200], 100);
    const solution = solveBridge(graph, missingAtWestAnchor, {
      terrain: true,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("incomplete");
  });

  it("rejects a junction reached inside the approach, before the transition completes", () => {
    // West approach: bridge(100,0) -- 5m -- junction(95,0) -- 205m -- (-200,0), plus a side road at (95,0)->(95,50).
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[-200, 0], [100, 0]]), id: "west" });
    const side = roadFeature({ coordinates: metersLine([[95, 0], [95, 50]]), id: "side" });
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "east" });
    const graph = buildRoadGraph([west, side, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE, // requires ~20m; junction sits 5m from the bridge (residual ~1.7m)
      maxApproach: 250,
    });
    expect(solution.status).toBe("infeasible");
    if (solution.status === "infeasible") expect(solution.reason).toMatch(/junction/);
  });

  it("accepts a junction far enough from the bridge for the transition to complete first", () => {
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge",
    });
    // Junction 150m from the bridge node; required transition is ~20m, well inside that.
    const west = roadFeature({ coordinates: metersLine([[-200, 0], [100, 0]]), id: "west" });
    const side = roadFeature({ coordinates: metersLine([[-50, 0], [-50, 50]]), id: "side" });
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "east" });
    const graph = buildRoadGraph([west, side, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
  });

  it("accepts a junction close enough to the required transition length to meet it within tolerance", () => {
    // required transition = 1.5*2/0.15 = 20m; junction at 18m (0.9L) leaves
    // a residual height gap of ~0.056m, under JUNCTION_HEIGHT_TOLERANCE (0.5m).
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[-200, 0], [100, 0]]), id: "west" });
    const side = roadFeature({ coordinates: metersLine([[82, 0], [82, 50]]), id: "side" }); // 18m from the bridge node
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "east" });
    const graph = buildRoadGraph([west, side, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
  });

  it("still rejects a junction whose height gap exceeds the tolerance, even though it's closer to the required length than the first fixture", () => {
    // Junction at 12m leaves a residual of ~0.70m — over JUNCTION_HEIGHT_TOLERANCE,
    // despite being closer to the 20m requirement than the first rejection fixture
    // (5m). This is the "never junction-found-therefore-accept" guard.
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[-200, 0], [100, 0]]), id: "west" });
    const side = roadFeature({ coordinates: metersLine([[88, 0], [88, 50]]), id: "side" }); // 12m from the bridge node
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "east" });
    const graph = buildRoadGraph([west, side, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("infeasible");
    if (solution.status === "infeasible") expect(solution.reason).toMatch(/junction/);
  });

  it("keeps full grade-separation clearance for an explicitly multi-level (layer >= 2) bridge", () => {
    // layer 2 keeps roughly the old clearance (4.5m major) instead of the
    // recalibrated layer-1 value (2m) — a genuine flyover still gets real headroom.
    // Approaches must be layer 1 (not 0): B1's layersCompatible only connects a
    // bridge to a same-or-adjacent (diff === 1) layer, so a layer-2 bridge can
    // only be reachable from a layer-1 approach in this graph, never layer 0.
    const bridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 2,
      brunnel: "bridge",
      id: "bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), layer: 1, id: "west" });
    const east = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), layer: 1, id: "east" });
    const graph = buildRoadGraph([west, bridge, east], ORIGIN);
    const solution = solveBridge(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const deckHeight = Math.max(...solution.surfaces[0].samples.map((s) => s.center[1]));
    expect(deckHeight).toBeCloseTo(4.5, 5); // GRADE_SEPARATION_CLEARANCE_MAJOR
  });
});

describe("solveBridges", () => {
  // Two independent, geographically separate bridge components in one graph:
  // one with ample approaches (would solve alone), one whose approach is too
  // short (would fail alone). solveBridge()'s own short-circuit loop would
  // return only the first-hit failure and discard the other component's
  // result entirely — this is exactly the live-wiring gap solveBridges()
  // exists to fix (see IDEAS_WORK_LOG.md's B3 diagnostic entries).
  function twoComponentGraph() {
    const readyBridge = roadFeature({
      coordinates: metersLine([[100, 0], [200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "ready-bridge",
    });
    const readyWest = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), id: "ready-west" });
    const readyEast = roadFeature({ coordinates: metersLine([[200, 0], [300, 0]]), id: "ready-east" });

    const failingBridge = roadFeature({
      coordinates: metersLine([[5100, 0], [5200, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "failing-bridge",
    });
    // Only 5m of approach on each side — nowhere near the ~20m required rise.
    const failingWest = roadFeature({ coordinates: metersLine([[5095, 0], [5100, 0]]), id: "failing-west" });
    const failingEast = roadFeature({ coordinates: metersLine([[5200, 0], [5205, 0]]), id: "failing-east" });

    return buildRoadGraph(
      [readyWest, readyBridge, readyEast, failingWest, failingBridge, failingEast],
      ORIGIN,
    );
  }

  it("publishes the solvable component instead of letting the failing one suppress it", () => {
    const graph = twoComponentGraph();
    const result = solveBridges(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(result.surfaces).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].status).toBe("infeasible");
    expect(result.rejected[0].reason).toMatch(/too short/);
    expect(typeof result.rejected[0].edgeId).toBe("string");
  });

  it("resolves a per-edge maxGrade function instead of one shared constant", () => {
    // A width-3 (path-class fallback) bridge gets the 12% path grade; a
    // width-14 (major-class fallback) bridge gets the 8% motor-road grade —
    // both from the same defaultMaxGradeForEdge selector in one call.
    const pathBridge = roadFeature({
      coordinates: metersLine([[100, 0], [110, 0]]),
      layer: 1,
      brunnel: "bridge",
      class: "path",
      width: 3,
      id: "path-bridge",
    });
    const pathWest = roadFeature({ coordinates: metersLine([[85, 0], [100, 0]]), width: 3, id: "path-west" });
    const pathEast = roadFeature({ coordinates: metersLine([[110, 0], [125, 0]]), width: 3, id: "path-east" });
    const graph = buildRoadGraph([pathWest, pathBridge, pathEast], ORIGIN);
    const result = solveBridges(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: defaultMaxGradeForEdge,
      maxApproach: DEFAULT_MAX_APPROACH,
    });
    expect(result.surfaces).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("returns an empty result for a graph with no bridge edges", () => {
    const road = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), id: "plain" });
    const graph = buildRoadGraph([road], ORIGIN);
    const result = solveBridges(graph, NEVER_SAMPLE, {
      terrain: false,
      maxGrade: READY_MAX_GRADE,
      maxApproach: 250,
    });
    expect(result).toEqual({ surfaces: [], rejected: [] });
  });
});
