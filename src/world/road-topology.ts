import type { Position } from "geojson";
import type { WorldFeature } from "./feature-cache";
import type { RoadEdge, RoadGraph, RoadNode, Vec3 } from "./bridge-model";
import { isPhysicalRoad, localMeters } from "./geography";
import { roadDimensions } from "./road-model";

const SNAP_DISTANCE = 0.5; // meters
// A bridge-aware widened variant of this was tried 2026-09-12 to catch
// observed 1.9-6.9m bridge-to-ground near-misses, then reverted: measured
// against real Gamla Stan data it was a net regression (9/76 ready -> 3/61),
// because the same wider radius also swallowed short real approach stubs
// into their neighboring junction node, deleting the very edges some
// already-ready bridges depended on. See the work log for the full
// before/after measurement. A single endpoint-clustering distance threshold
// cannot distinguish "bridge endpoint that should reach this ground point"
// from "both ends of a short approach edge that should stay independent" —
// fixing this (if ever) needs a design that isn't a bigger constant here.
const MAX_JOIN_ITERATIONS = 2000; // safety cap on degree-2 bridge-chain joining

interface RawSegment {
  points: Vec3[];
  width: number;
  layer: number;
  bridge: boolean;
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

/**
 * Same layer, or up to two layers apart where at least one side is a bridge
 * — the unambiguous bridge-to-ground endpoint transition, including a
 * grade-separated bridge (layer >= 2) meeting ground (layer 0) directly with
 * no intermediate layer-1 element. Diff-of-2 was added 2026-09-12 after real
 * Gamla Stan data showed layer=2 bridges rejected purely on this rule at
 * distances (0.2-0.7m) already within SNAP_DISTANCE. Anything beyond two
 * layers, or any interior 2D crossing (which this never even considers as a
 * candidate — see extractRawSegments/T-junction detection below), stays
 * disconnected.
 */
function layersCompatible(a: number, b: number, aBridge: boolean, bBridge: boolean): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  return diff <= 2 && (aBridge || bBridge);
}

function extractLines(geometry: WorldFeature["feature"]["geometry"]): Position[][] {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function toLocalPoints(line: Position[], origin: Position): Vec3[] {
  const points: Vec3[] = [];
  for (const p of line) {
    const [x, , z] = localMeters(p, origin);
    const point: Vec3 = [x, 0, z];
    if (points.length === 0 || dist(point, points[points.length - 1]) > 1e-6)
      points.push(point);
  }
  return points;
}

function extractRawSegments(features: readonly WorldFeature[], origin: Position): RawSegment[] {
  const segments: RawSegment[] = [];
  for (const f of features) {
    const properties = (f.feature.properties ?? {}) as Record<string, unknown>;
    if (!isPhysicalRoad(properties)) continue;
    const bridge = properties.brunnel === "bridge";
    const layer = Math.max(0, Number(properties.layer) || 0);
    const width = roadDimensions(properties).width;
    for (const line of extractLines(f.feature.geometry)) {
      const points = toLocalPoints(line, origin);
      if (points.length < 2) continue;
      segments.push({ points, width, layer, bridge });
    }
  }
  return segments;
}

/** Orientation-independent key so a reversed-duplicate query result collapses to one. */
function roundPoint(p: Vec3): string {
  return `${Math.round(p[0] * 10) / 10}:${Math.round(p[2] * 10) / 10}`;
}
function segmentKey(seg: RawSegment): string {
  const forward = seg.points.map(roundPoint).join("|");
  const reversed = seg.points.slice().reverse().map(roundPoint).join("|");
  const canonical = forward <= reversed ? forward : reversed;
  return `${seg.bridge}:${seg.layer}:${canonical}`;
}
function dedupeSegments(segments: RawSegment[]): RawSegment[] {
  const seen = new Set<string>();
  const result: RawSegment[] = [];
  for (const seg of segments) {
    const key = segmentKey(seg);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(seg);
  }
  return result;
}

interface Projection {
  point: Vec3;
  segIndex: number;
  t: number;
  distance: number;
}
function projectOntoPolyline(point: Vec3, line: readonly Vec3[]): Projection | null {
  let best: Projection | null = null;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i],
      b = line[i + 1];
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const len2 = dx * dx + dz * dz;
    if (len2 === 0) continue;
    let t = ((point[0] - a[0]) * dx + (point[2] - a[2]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const proj: Vec3 = [a[0] + dx * t, 0, a[2] + dz * t];
    const distance = dist(point, proj);
    if (!best || distance < best.distance) best = { point: proj, segIndex: i, t, distance };
  }
  return best;
}

interface SplitPoint {
  segIndex: number;
  t: number;
  point: Vec3;
}
/** Splits a segment at each recorded interior junction point, preserving its properties. */
function insertSplits(segment: RawSegment, splits: readonly SplitPoint[]): RawSegment[] {
  if (splits.length === 0) return [segment];
  const sorted = [...splits].sort((a, b) => a.segIndex - b.segIndex || a.t - b.t);
  const newPoints: Vec3[] = [segment.points[0]];
  const cutIndices: number[] = [0];
  let si = 0;
  for (const split of sorted) {
    while (si < split.segIndex) {
      newPoints.push(segment.points[si + 1]);
      si++;
    }
    const last = newPoints[newPoints.length - 1];
    if (dist(last, split.point) > 1e-3) newPoints.push(split.point);
    cutIndices.push(newPoints.length - 1);
  }
  while (si < segment.points.length - 1) {
    newPoints.push(segment.points[si + 1]);
    si++;
  }
  cutIndices.push(newPoints.length - 1);
  const uniqueCuts = Array.from(new Set(cutIndices)).sort((a, b) => a - b);
  const result: RawSegment[] = [];
  for (let k = 0; k < uniqueCuts.length - 1; k++) {
    const start = uniqueCuts[k],
      end = uniqueCuts[k + 1];
    if (end <= start) continue;
    result.push({ ...segment, points: newPoints.slice(start, end + 1) });
  }
  return result;
}

/**
 * Splits every segment at points where another segment's endpoint touches its
 * interior within SNAP_DISTANCE (a T approach) — never at a mere interior 2D
 * crossing, since only endpoints are ever compared against another line.
 */
function applyTJunctionSplits(segments: readonly RawSegment[]): RawSegment[] {
  const splitsPerSegment = new Map<number, SplitPoint[]>();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const endpoints = [s.points[0], s.points[s.points.length - 1]];
    for (const endpoint of endpoints) {
      for (let j = 0; j < segments.length; j++) {
        if (i === j) continue;
        const t = segments[j];
        const proj = projectOntoPolyline(endpoint, t.points);
        if (!proj || proj.distance > SNAP_DISTANCE) continue;
        const atStart = proj.segIndex === 0 && proj.t <= 1e-6;
        const atEnd = proj.segIndex === t.points.length - 2 && proj.t >= 1 - 1e-6;
        if (atStart || atEnd) continue; // ordinary endpoint-to-endpoint match, not a T
        if (!layersCompatible(s.layer, t.layer, s.bridge, t.bridge)) continue;
        const list = splitsPerSegment.get(j) ?? [];
        list.push({ segIndex: proj.segIndex, t: proj.t, point: proj.point });
        splitsPerSegment.set(j, list);
      }
    }
  }
  const result: RawSegment[] = [];
  for (let j = 0; j < segments.length; j++)
    result.push(...insertSplits(segments[j], splitsPerSegment.get(j) ?? []));
  return result;
}

interface Cluster {
  id: string;
  points: Vec3[];
  layer: number;
  bridge: boolean;
}
function centroid(points: readonly Vec3[]): Vec3 {
  let x = 0,
    y = 0,
    z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / points.length, y / points.length, z / points.length];
}

interface BuiltEdge {
  fromCluster: Cluster;
  toCluster: Cluster;
  points: Vec3[];
  width: number;
  layer: number;
  bridge: boolean;
}

function mergeEdgesAt(e1: BuiltEdge, e2: BuiltEdge, sharedId: string): BuiltEdge | null {
  let p1 = e1.points,
    from1 = e1.fromCluster,
    to1 = e1.toCluster;
  if (to1.id !== sharedId) {
    if (from1.id !== sharedId) return null;
    p1 = p1.slice().reverse();
    [from1, to1] = [to1, from1];
  }
  let p2 = e2.points,
    from2 = e2.fromCluster,
    to2 = e2.toCluster;
  if (from2.id !== sharedId) {
    if (to2.id !== sharedId) return null;
    p2 = p2.slice().reverse();
    [from2, to2] = [to2, from2];
  }
  return {
    fromCluster: from1,
    toCluster: to2,
    points: [...p1.slice(0, -1), ...p2],
    width: (e1.width + e2.width) / 2,
    layer: e1.layer,
    bridge: true,
  };
}

/** Joins contiguous bridge edges through degree-2 nodes; degree-3+ branches stay explicit. */
function joinBridgeChains(edges: readonly BuiltEdge[]): BuiltEdge[] {
  let current = edges.slice();
  for (let iteration = 0; iteration < MAX_JOIN_ITERATIONS; iteration++) {
    const touching = new Map<string, BuiltEdge[]>();
    for (const e of current) {
      touching.set(e.fromCluster.id, [...(touching.get(e.fromCluster.id) ?? []), e]);
      touching.set(e.toCluster.id, [...(touching.get(e.toCluster.id) ?? []), e]);
    }
    let mergedAny = false;
    for (const [clusterId, list] of touching) {
      if (list.length !== 2) continue;
      const [e1, e2] = list;
      if (e1 === e2 || !e1.bridge || !e2.bridge) continue;
      if (e1.layer !== e2.layer) continue;
      if (Math.abs(e1.width - e2.width) > 0.5) continue;
      const merged = mergeEdgesAt(e1, e2, clusterId);
      if (!merged) continue;
      current = [...current.filter((e) => e !== e1 && e !== e2), merged];
      mergedAny = true;
      break;
    }
    if (!mergedAny) break;
  }
  return current;
}

/**
 * Builds a local road/bridge graph from retained Z2 feature records. Splits
 * lines at verified shared nodes and compatible T approaches (never at a mere
 * 2D crossing — see applyTJunctionSplits), joins contiguous bridge edges
 * through degree-two nodes, and deduplicates reversed/repeated query results.
 * All returned positions are local meters relative to `origin`; convert only
 * when publishing render buffers. Takes no zoom input.
 *
 * The plan's 250m/2000-edge outward-approach bound is not implemented as a
 * live re-query mechanism here: buildRoadGraph is pure over a fixed feature
 * list, with no query API to expand into. MAX_JOIN_ITERATIONS instead caps
 * the bridge-chain join loop as a performance safeguard on large inputs.
 */
export function buildRoadGraph(
  features: readonly WorldFeature[],
  origin: Position,
): RoadGraph {
  const raw = dedupeSegments(extractRawSegments(features, origin));
  if (raw.length === 0) return { nodes: [], edges: [] };
  const segments = applyTJunctionSplits(raw);

  const clusters: Cluster[] = [];
  let nodeCounter = 0;
  function clusterFor(point: Vec3, layer: number, bridge: boolean): Cluster {
    const matches = clusters.filter(
      (c) =>
        dist(centroid(c.points), point) <= SNAP_DISTANCE &&
        layersCompatible(c.layer, layer, c.bridge, bridge),
    );
    if (matches.length === 0) {
      const created: Cluster = { id: `n${nodeCounter++}`, points: [point], layer, bridge };
      clusters.push(created);
      return created;
    }
    const [primary, ...rest] = matches;
    for (const m of rest) {
      primary.points.push(...m.points);
      clusters.splice(clusters.indexOf(m), 1);
      // A BuiltEdge created before this merge may already hold a direct
      // reference to `m`. Retarget its identity in place (rather than just
      // discarding it) so that a later `.id` read through that stale
      // reference still resolves to the surviving cluster.
      m.id = primary.id;
    }
    primary.points.push(point);
    return primary;
  }

  const builtEdges: BuiltEdge[] = [];
  for (const seg of segments) {
    const fromCluster = clusterFor(seg.points[0], seg.layer, seg.bridge);
    const toCluster = clusterFor(seg.points[seg.points.length - 1], seg.layer, seg.bridge);
    if (fromCluster === toCluster) continue; // degenerate after snapping
    builtEdges.push({
      fromCluster,
      toCluster,
      points: seg.points,
      width: seg.width,
      layer: seg.layer,
      bridge: seg.bridge,
    });
  }

  const seenEdgeKeys = new Set<string>();
  const dedupedEdges: BuiltEdge[] = [];
  for (const e of builtEdges) {
    const [a, b] = [e.fromCluster.id, e.toCluster.id].sort();
    const key = `${a}:${b}:${e.bridge}:${e.layer}`;
    if (seenEdgeKeys.has(key)) continue;
    seenEdgeKeys.add(key);
    dedupedEdges.push(e);
  }

  const finalEdges = joinBridgeChains(dedupedEdges);

  const usedClusterIds = new Set<string>();
  for (const e of finalEdges) {
    usedClusterIds.add(e.fromCluster.id);
    usedClusterIds.add(e.toCluster.id);
  }
  const nodes: RoadNode[] = clusters
    .filter((c) => usedClusterIds.has(c.id))
    .map((c) => ({ id: c.id, position: centroid(c.points), edgeIds: [] }));
  const edges: RoadEdge[] = finalEdges.map((e, i) => ({
    id: `e${i}`,
    from: e.fromCluster.id,
    to: e.toCluster.id,
    points: e.points,
    width: e.width,
    layer: e.layer,
    bridge: e.bridge,
  }));
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    nodeById.get(e.from)?.edgeIds.push(e.id);
    nodeById.get(e.to)?.edgeIds.push(e.id);
  }
  return { nodes, edges };
}
