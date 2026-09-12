import { describe, expect, it } from "vitest";
import {
  exposedBridgeEdges,
  bridgeAccessories,
  RAIL_CENTER_OFFSET,
} from "../src/world/bridge-boundaries";
import { solveBridge } from "../src/world/bridge-profile";
import { buildRoadGraph } from "../src/world/road-topology";
import type { BridgeSurface, ProfileSample, Vec3 } from "../src/world/bridge-model";
import { ORIGIN, metersLine, roadFeature } from "./fixtures/bridge-network";

/**
 * Scope note, stated rather than silently narrowed (see IDEAS_WORK_LOG.md):
 * the plan's own B4 bullet asks for T/Y-entrance, bridge-to-bridge-junction
 * and crossing-road-underneath fixtures. Under this codebase's current B2
 * (bridge-profile.ts), none of those states ever reach a published
 * `BridgeSurface`: a junction encountered before an approach's transition
 * completes rejects the whole component, and `BridgeSurface.openings` is
 * always `[]` (mid-span branch openings are not modeled — see
 * bridge-profile.ts's own doc comment). There is nothing to build those
 * fixtures against yet; they would either be untestable no-ops or fictions
 * about behavior that does not exist. The one adjacent, genuinely reachable
 * case — two bridge edges B1 joins end-to-end through a shared node (a real
 * "bridge-to-bridge" join, published as one continuous surface, not a
 * junction) — is covered below instead.
 */

function straightSurface(length: number, width: number, height = 2): BridgeSurface {
  const distances: number[] = [];
  for (let d = 0; d < length; d += 5) distances.push(d);
  distances.push(length);
  const samples: ProfileSample[] = distances.map((d) => ({
    distance: d,
    center: [d, height, 0],
    left: [d, height, width / 2],
    right: [d, height, -width / 2],
  }));
  return { id: "straight", samples, thickness: 0.8, openings: [] };
}

function pointsMatch(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9;
}

function chainConnected(edges: readonly [Vec3, Vec3][]): boolean {
  for (let i = 1; i < edges.length; i++) {
    if (!pointsMatch(edges[i - 1][1], edges[i][0])) return false;
  }
  return true;
}

describe("exposedBridgeEdges", () => {
  it("clips both openings using each anchor's own width before generating any edge", () => {
    // width 8 -> opening = 8/2 + 0.5m shoulder = 4.5m at each end.
    const surface = straightSurface(40, 8);
    const edges = exposedBridgeEdges([surface]);
    const leftChain = edges.filter((e) => e[0][2] > 0 && e[1][2] > 0);
    expect(leftChain[0][0][0]).toBeCloseTo(5, 5); // nearest sample >= 4.5
    expect(leftChain[leftChain.length - 1][1][0]).toBeCloseTo(35, 5); // nearest sample <= 35.5
  });

  it("returns no edges for a side once its two openings consume the whole span", () => {
    const surface = straightSurface(5, 8); // 4.5m opening each end on a 5m span
    expect(exposedBridgeEdges([surface])).toEqual([]);
  });

  it("keeps every returned point perpendicular-offset from its own sample's centerline tangent", () => {
    // Diagonal bridge (45 degrees) with ample approaches, solved through the
    // real B1/B2 pipeline rather than a hand-built fixture.
    const bridge = roadFeature({
      coordinates: metersLine([[100, 100], [150, 150]]),
      layer: 1,
      brunnel: "bridge",
      id: "diag-bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[30, 30], [100, 100]]), id: "diag-west" });
    const east = roadFeature({ coordinates: metersLine([[150, 150], [220, 220]]), id: "diag-east" });
    const graph = buildRoadGraph([west, bridge, east], ORIGIN);
    const solution = solveBridge(graph, () => {
      throw new Error("terrain is off");
    }, { terrain: false, maxGrade: 0.15, maxApproach: 250 });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const surface = solution.surfaces[0];

    // exposedBridgeEdges must only filter/pass through existing sample
    // points, never recompute them — so every returned point must be
    // value-identical to some sample's own left or right point.
    const known = new Set(surface.samples.flatMap((s) => [s.left, s.right].map((p) => p.join(","))));
    for (const [a, b] of exposedBridgeEdges([surface])) {
      expect(known.has(a.join(","))).toBe(true);
      expect(known.has(b.join(","))).toBe(true);
    }

    // And the underlying offsets are genuinely perpendicular to the local
    // centerline tangent, per the plan's own acceptance line.
    for (let i = 1; i < surface.samples.length; i++) {
      const prev = surface.samples[i - 1].center,
        next = surface.samples[i].center;
      const tangent: Vec3 = [next[0] - prev[0], 0, next[2] - prev[2]];
      const offset: Vec3 = [
        surface.samples[i].left[0] - surface.samples[i].center[0],
        0,
        surface.samples[i].left[2] - surface.samples[i].center[2],
      ];
      const dot = tangent[0] * offset[0] + tangent[2] * offset[2];
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    }
  });

  it("keeps a curved bridge's interior bend as one unbroken chain per side", () => {
    const bentBridge = roadFeature({
      coordinates: metersLine([[100, 0], [150, 0], [150, 50]]),
      layer: 1,
      brunnel: "bridge",
      id: "bent-bridge",
    });
    const west = roadFeature({ coordinates: metersLine([[30, 0], [100, 0]]), id: "bent-west" });
    const east = roadFeature({ coordinates: metersLine([[150, 50], [150, 120]]), id: "bent-east" });
    const graph = buildRoadGraph([west, bentBridge, east], ORIGIN);
    const solution = solveBridge(graph, () => {
      throw new Error("terrain is off");
    }, { terrain: false, maxGrade: 0.15, maxApproach: 250 });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    const edges = exposedBridgeEdges(solution.surfaces);
    expect(edges.length).toBeGreaterThan(2);
    // Each side's own chain (emitted contiguously) must connect end-to-start.
    const bySide = { left: [] as typeof edges, right: [] as typeof edges };
    // Left/right are emitted as two contiguous runs in order; split at the
    // one point where end-to-start continuity breaks.
    let splitAt = edges.length;
    for (let i = 1; i < edges.length; i++) {
      if (!chainConnected([edges[i - 1], edges[i]])) {
        splitAt = i;
        break;
      }
    }
    bySide.left = edges.slice(0, splitAt);
    bySide.right = edges.slice(splitAt);
    expect(chainConnected(bySide.left)).toBe(true);
    expect(chainConnected(bySide.right)).toBe(true);
  });

  it("treats two B1-joined bridge edges (through a shared node) as one continuous surface's edges, not a junction", () => {
    // A bridge split into two tile-fragment-like edges sharing a node — B1's
    // joinBridgeChains merges these into one edge before B2 ever sees them,
    // so from here it is indistinguishable from a single long bridge.
    const bridgeA = roadFeature({
      coordinates: metersLine([[100, 0], [140, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "joined-a",
    });
    const bridgeB = roadFeature({
      coordinates: metersLine([[140, 0], [180, 0]]),
      layer: 1,
      brunnel: "bridge",
      id: "joined-b",
    });
    const west = roadFeature({ coordinates: metersLine([[30, 0], [100, 0]]), id: "joined-west" });
    const east = roadFeature({ coordinates: metersLine([[180, 0], [250, 0]]), id: "joined-east" });
    const graph = buildRoadGraph([west, bridgeA, bridgeB, east], ORIGIN);
    const solution = solveBridge(graph, () => {
      throw new Error("terrain is off");
    }, { terrain: false, maxGrade: 0.15, maxApproach: 250 });
    expect(solution.status).toBe("ready");
    if (solution.status !== "ready") return;
    expect(solution.surfaces).toHaveLength(1); // joined into one surface, not two
    const edges = exposedBridgeEdges(solution.surfaces);
    expect(edges.length).toBeGreaterThan(0);
    // No gap at the former joined-a/joined-b seam: every point at x=140
    // (if present) must still connect to its neighbors — checked indirectly
    // by confirming the whole edge list splits into exactly two connected
    // chains (left, right), never three or more from a broken seam.
    let breaks = 0;
    for (let i = 1; i < edges.length; i++) if (!chainConnected([edges[i - 1], edges[i]])) breaks++;
    expect(breaks).toBe(1); // exactly one break: the left-chain-to-right-chain boundary
  });
});

describe("bridgeAccessories", () => {
  it("spaces posts at exactly 8m arc-length intervals along one straight edge", () => {
    const edges: [Vec3, Vec3][] = [[[0, 2, 0], [40, 2, 0]]];
    const posts = bridgeAccessories(edges, [], 100);
    expect(posts).toHaveLength(5); // at 8, 16, 24, 32, 40
    expect(posts[0].position[0]).toBeCloseTo(8, 5);
    expect(posts[4].position[0]).toBeCloseTo(40, 5);
    for (const p of posts) expect(p.kind).toBe("box");
  });

  it("carries spacing phase through a bend (two connected segments), never resetting mid-chain", () => {
    // 5m then 10m, connected end-to-start: total 15m -> one post at 8m,
    // landing 3m into the second segment.
    const edges: [Vec3, Vec3][] = [
      [[0, 2, 0], [5, 2, 0]],
      [[5, 2, 0], [5, 2, 10]],
    ];
    const posts = bridgeAccessories(edges, [], 100);
    expect(posts).toHaveLength(1);
    expect(posts[0].position[0]).toBeCloseTo(5, 5);
    expect(posts[0].position[2]).toBeCloseTo(3, 5);
  });

  it("resets phase at a genuine chain break instead of leaking distance across unrelated edges", () => {
    // Two disconnected 5m edges, spacing 8m: naive phase-carry (not resetting
    // on a non-adjacent edge) would place a post 3m into the second edge;
    // correct behavior places none, since neither edge alone reaches 8m.
    const edges: [Vec3, Vec3][] = [
      [[0, 2, 0], [5, 2, 0]],
      [[1000, 2, 0], [1005, 2, 0]], // far away, does not share an endpoint
    ];
    const posts = bridgeAccessories(edges, [], 100);
    expect(posts).toHaveLength(0);
  });

  it("never exceeds the requested cap, even when more posts would otherwise be placed", () => {
    const edges: [Vec3, Vec3][] = [[[0, 2, 0], [4008, 2, 0]]]; // room for 501 posts at 8m spacing
    expect(bridgeAccessories(edges, [], 499)).toHaveLength(499);
    expect(bridgeAccessories(edges, [], 500)).toHaveLength(500);
    expect(bridgeAccessories(edges, [], 501)).toHaveLength(501);
    expect(bridgeAccessories(edges, [], 500).length).toBeLessThanOrEqual(500);
  });

  it("places every post above the deck's own finished-roadway height at that point (rail sits above them)", () => {
    const edges: [Vec3, Vec3][] = [[[0, 2, 0], [40, 2, 0]]];
    const posts = bridgeAccessories(edges, [], 100);
    for (const p of posts) {
      expect(p.position[1]).toBeGreaterThan(2); // above the deck top (y=2)
      expect(p.position[1]).toBeLessThan(2 + RAIL_CENTER_OFFSET + 0.2); // does not float past the rail
    }
  });

  it("never places a post inside either opening, once fed only already-clipped edges", () => {
    const surface = straightSurface(40, 8); // openings 4.5m at each end
    const edges = exposedBridgeEdges([surface]);
    const posts = bridgeAccessories(edges, [surface], 100);
    for (const p of posts) {
      expect(p.position[0]).toBeGreaterThanOrEqual(4.5);
      expect(p.position[0]).toBeLessThanOrEqual(40 - 4.5);
    }
  });
});
