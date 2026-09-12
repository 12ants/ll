import { describe, expect, it } from "vitest";
import { buildRoadGraph } from "../src/world/road-topology";
import type { RoadGraph, RoadNode } from "../src/world/bridge-model";
import { ORIGIN, metersLine, roadFeature } from "./fixtures/bridge-network";

function nodeAt(graph: RoadGraph, local: [number, number]): RoadNode | undefined {
  return graph.nodes.find(
    (n) => Math.hypot(n.position[0] - local[0], n.position[2] - local[1]) < 0.6,
  );
}
function degree(node: RoadNode): number {
  return node.edgeIds.length;
}
function edgesTouching(graph: RoadGraph, nodeId: string) {
  return graph.edges.filter((e) => e.from === nodeId || e.to === nodeId);
}

describe("buildRoadGraph", () => {
  it("connects a straight bridge to its ground approaches at shared endpoints", () => {
    const approachA = roadFeature({
      coordinates: metersLine([[0, 0], [50, 0]]),
      layer: 0,
      id: "approach-a",
    });
    const bridge = roadFeature({
      coordinates: metersLine([[50, 0], [150, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge-1",
    });
    const approachB = roadFeature({
      coordinates: metersLine([[150, 0], [200, 0]]),
      layer: 0,
      id: "approach-b",
    });
    const graph = buildRoadGraph([approachA, bridge, approachB], ORIGIN);
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes).toHaveLength(4);
    const junctionStart = nodeAt(graph, [50, 0]);
    const junctionEnd = nodeAt(graph, [150, 0]);
    expect(junctionStart).toBeDefined();
    expect(junctionEnd).toBeDefined();
    expect(degree(junctionStart!)).toBe(2);
    expect(degree(junctionEnd!)).toBe(2);
    const bridgeEdge = graph.edges.find((e) => e.bridge);
    expect(bridgeEdge).toBeDefined();
    expect([bridgeEdge!.from, bridgeEdge!.to]).toContain(junctionStart!.id);
    expect([bridgeEdge!.from, bridgeEdge!.to]).toContain(junctionEnd!.id);
  });

  it("keeps a curved bridge's interior bend as part of one edge, not a node", () => {
    const bridge = roadFeature({
      coordinates: metersLine([[50, 0], [100, 20], [150, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "curved",
    });
    const graph = buildRoadGraph([bridge], ORIGIN);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].points).toHaveLength(3);
    expect(graph.nodes).toHaveLength(2);
  });

  it("deduplicates a reversed-duplicate query result to a single edge", () => {
    const forward = roadFeature({
      coordinates: metersLine([[0, 0], [100, 0]]),
      id: "dup",
    });
    const reversed = roadFeature({
      coordinates: metersLine([[100, 0], [0, 0]]),
      id: "dup",
    });
    const graph = buildRoadGraph([forward, reversed], ORIGIN);
    expect(graph.edges).toHaveLength(1);
  });

  it("joins tile-split bridge fragments sharing an endpoint into one continuous edge", () => {
    const fragmentA = roadFeature({
      coordinates: metersLine([[50, 0], [100, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge-2",
      completeness: "fragment",
    });
    const fragmentB = roadFeature({
      coordinates: metersLine([[100, 0], [150, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "bridge-2",
      completeness: "fragment",
    });
    const graph = buildRoadGraph([fragmentA, fragmentB], ORIGIN);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].bridge).toBe(true);
    // Joined edge should span the full combined length.
    const pts = graph.edges[0].points;
    expect(pts[0][0]).toBeCloseTo(50, 0);
    expect(pts[pts.length - 1][0]).toBeCloseTo(150, 0);
  });

  it("splits a through road at a T approach and gives the junction degree 3", () => {
    const through = roadFeature({
      coordinates: metersLine([[0, 0], [100, 0]]),
      id: "through",
    });
    const side = roadFeature({
      coordinates: metersLine([[50, 0], [50, 50]]),
      id: "side",
    });
    const graph = buildRoadGraph([through, side], ORIGIN);
    const junction = nodeAt(graph, [50, 0]);
    expect(junction).toBeDefined();
    expect(degree(junction!)).toBe(3);
    expect(graph.edges).toHaveLength(3); // through road split in two, plus the side road
    expect(graph.nodes).toHaveLength(4);
  });

  it("keeps a Y split's shared origin as one degree-3 node", () => {
    const trunk = roadFeature({
      coordinates: metersLine([[0, 0], [50, 0]]),
      id: "trunk",
    });
    const branchA = roadFeature({
      coordinates: metersLine([[50, 0], [100, 20]]),
      id: "branch-a",
    });
    const branchB = roadFeature({
      coordinates: metersLine([[50, 0], [100, -20]]),
      id: "branch-b",
    });
    const graph = buildRoadGraph([trunk, branchA, branchB], ORIGIN);
    const junction = nodeAt(graph, [50, 0]);
    expect(junction).toBeDefined();
    expect(degree(junction!)).toBe(3);
    expect(graph.edges).toHaveLength(3);
    expect(graph.nodes).toHaveLength(4);
  });

  it("never connects separate carriageways that merely run parallel", () => {
    const north = roadFeature({
      coordinates: metersLine([[0, 5], [100, 5]]),
      id: "carriageway-north",
    });
    const south = roadFeature({
      coordinates: metersLine([[0, -5], [100, -5]]),
      id: "carriageway-south",
    });
    const graph = buildRoadGraph([north, south], ORIGIN);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes).toHaveLength(4);
  });

  it("never connects an overpass crossing another road in 2D at a different level", () => {
    const lower = roadFeature({
      coordinates: metersLine([[-50, 0], [50, 0]]),
      layer: 0,
      id: "lower",
    });
    const upper = roadFeature({
      coordinates: metersLine([[0, -50], [0, 50]]),
      layer: 2, // difference of 2, not a bridge-transition-compatible pair
      brunnel: "bridge",
      id: "upper",
    });
    const graph = buildRoadGraph([lower, upper], ORIGIN);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((e) => e.points.length === 2)).toBe(true); // no split at the crossing
    expect(graph.nodes).toHaveLength(4); // just each line's own two endpoints
  });

  it("excludes tunnels entirely", () => {
    const road = roadFeature({
      coordinates: metersLine([[0, 0], [100, 0]]),
      id: "road",
    });
    const tunnel = roadFeature({
      coordinates: metersLine([[0, 10], [100, 10]]),
      brunnel: "tunnel",
      id: "tunnel",
    });
    const graph = buildRoadGraph([road, tunnel], ORIGIN);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes).toHaveLength(2);
  });

  it("leaves a bridge with no nearby neighbors as its own dangling component", () => {
    const bridge = roadFeature({
      coordinates: metersLine([[500, 500], [600, 500]]),
      layer: 1,
      brunnel: "bridge",
      id: "lonely",
    });
    const graph = buildRoadGraph([bridge], ORIGIN);
    expect(graph.edges).toHaveLength(1);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.every((n) => degree(n) === 1)).toBe(true);
  });

  it("does not merge parallel roads 2m apart (beyond the 0.5m snap distance)", () => {
    const a = roadFeature({
      coordinates: metersLine([[0, 1], [50, 1]]),
      id: "a",
    });
    const b = roadFeature({
      coordinates: metersLine([[0, -1], [50, -1]]),
      id: "b",
    });
    const graph = buildRoadGraph([a, b], ORIGIN);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes).toHaveLength(4);
  });

  it("confirms no graph connection at an interior crossing with a different level", () => {
    // Both lines cross through the exact same coordinate, but at their
    // interiors (not endpoints), and at incompatible levels.
    const a = roadFeature({
      coordinates: metersLine([[-20, 0], [0, 0], [20, 0]]),
      layer: 0,
      id: "crossing-a",
    });
    const b = roadFeature({
      coordinates: metersLine([[0, -20], [0, 0], [0, 20]]),
      layer: 2,
      id: "crossing-b",
    });
    const graph = buildRoadGraph([a, b], ORIGIN);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((e) => e.points.length === 3)).toBe(true);
    expect(graph.nodes).toHaveLength(4);
  });

  it("connects a grade-separated bridge directly to ground two layers below at a shared endpoint", () => {
    // Real Gamla Stan data found layer=2 bridges whose nearest ground
    // neighbor was layer=0, 0.2-0.7m away — already within SNAP_DISTANCE but
    // rejected purely by the old diff-of-1 layersCompatible rule.
    const approach = roadFeature({
      coordinates: metersLine([[0, 0], [50, 0]]),
      layer: 0,
      id: "grade-approach",
    });
    const bridge = roadFeature({
      coordinates: metersLine([[50, 0], [150, 0]]),
      layer: 2,
      brunnel: "bridge",
      id: "grade-bridge",
    });
    const graph = buildRoadGraph([approach, bridge], ORIGIN);
    const junction = nodeAt(graph, [50, 0]);
    expect(junction).toBeDefined();
    expect(degree(junction!)).toBe(2);
    expect(graph.edges).toHaveLength(2);
  });

  it("still refuses a three-layer jump even when one side is a bridge", () => {
    const approach = roadFeature({
      coordinates: metersLine([[0, 0], [50, 0]]),
      layer: 0,
      id: "jump-approach",
    });
    const bridge = roadFeature({
      coordinates: metersLine([[50, 0], [150, 0]]),
      layer: 3,
      brunnel: "bridge",
      id: "jump-bridge",
    });
    const graph = buildRoadGraph([approach, bridge], ORIGIN);
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes).toHaveLength(4);
  });

  it("never produces an edge endpoint id with no matching node, even when one new point matches two previously-separate clusters at once", () => {
    // Regression, reproducible under the ordinary 0.5m SNAP_DISTANCE alone
    // (no bridge involved): segment A's far endpoint (100,0) and segment B's
    // near endpoint (100,0.98) start out as two distinct clusters, 0.98m
    // apart — correctly not merged when each was created. Segment C's near
    // endpoint (100,0.49) then lands within 0.5m of BOTH of their centroids
    // at once (0.49m to each), so clusterFor's `matches` array holds both.
    // The two matched clusters get merged into one `primary`, but the
    // *earlier* BuiltEdge for segment B still holds a direct reference to
    // the now-absorbed cluster object — before the id-retargeting fix, that
    // object's `.id` was left stale, producing an edge whose endpoint id had
    // no corresponding node in the final graph.
    const a = roadFeature({ coordinates: metersLine([[0, 0], [100, 0]]), id: "seg-a" });
    const b = roadFeature({ coordinates: metersLine([[100, 0.98], [200, 0.98]]), id: "seg-b" });
    const c = roadFeature({ coordinates: metersLine([[100, 0.49], [300, 0.49]]), id: "seg-c" });
    const graph = buildRoadGraph([a, b, c], ORIGIN);
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const e of graph.edges) {
      expect(nodeIds.has(e.from)).toBe(true);
      expect(nodeIds.has(e.to)).toBe(true);
    }
  });

  it("returns an empty graph for no input and ignores non-road features", () => {
    expect(buildRoadGraph([], ORIGIN)).toEqual({ nodes: [], edges: [] });
    const ferry = roadFeature({
      coordinates: metersLine([[0, 0], [100, 0]]),
      class: "ferry",
      id: "ferry",
    });
    expect(buildRoadGraph([ferry], ORIGIN)).toEqual({ nodes: [], edges: [] });
  });
});
