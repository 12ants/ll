import { describe, expect, it } from "vitest";
import type { Position } from "geojson";
import { roadFootprint } from "../src/world/road-surfaces";
import { localMeters, metersToPosition } from "../src/world/geography";

const ORIGIN: Position = [10, 45];

function metersLine(points: readonly (readonly [number, number])[], origin: Position): Position[] {
  return points.map((p) => metersToPosition(p, origin));
}

function toLocal(ring: readonly Position[], origin: Position): [number, number][] {
  return ring.map((p) => {
    const [x, , z] = localMeters(p, origin);
    return [x, z] as [number, number];
  });
}

function orientation(a: [number, number], b: [number, number], c: [number, number]): number {
  const val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(val) < 1e-9) return 0;
  return val > 0 ? 1 : 2;
}
function onSegment(a: [number, number], b: [number, number], c: [number, number]): boolean {
  return (
    Math.min(a[0], b[0]) - 1e-9 <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) + 1e-9 &&
    Math.min(a[1], b[1]) - 1e-9 <= c[1] &&
    c[1] <= Math.max(a[1], b[1]) + 1e-9
  );
}
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number],
): boolean {
  const o1 = orientation(p1, p2, p3),
    o2 = orientation(p1, p2, p4),
    o3 = orientation(p3, p4, p1),
    o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, p3)) return true;
  if (o2 === 0 && onSegment(p1, p2, p4)) return true;
  if (o3 === 0 && onSegment(p3, p4, p1)) return true;
  if (o4 === 0 && onSegment(p3, p4, p2)) return true;
  return false;
}
function isSimplePolygon(ring: [number, number][]): boolean {
  const n = ring.length - 1; // last point duplicates the first (closed ring)
  if (n < 3) return false;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const adjacent = Math.abs(i - j) <= 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  return true;
}
function allFinite(ring: [number, number][]): boolean {
  return ring.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z));
}

describe("roadFootprint", () => {
  it("rejects fewer than two distinct positions", () => {
    expect(roadFootprint([], 8, ORIGIN)).toBeNull();
    expect(roadFootprint([[10, 45]], 8, ORIGIN)).toBeNull();
    expect(roadFootprint([[10, 45], [10, 45]], 8, ORIGIN)).toBeNull();
  });

  it("produces a rectangle within 1% of the requested width on a 100m straight fixture", () => {
    const line = metersLine([[0, 0], [100, 0]], ORIGIN);
    const result = roadFootprint(line, 8, ORIGIN);
    expect(result).not.toBeNull();
    const ring = toLocal(result!.coordinates[0], ORIGIN);
    expect(allFinite(ring)).toBe(true);
    expect(isSimplePolygon(ring)).toBe(true);
    const xs = ring.map(([x]) => x),
      zs = ring.map(([, z]) => z);
    const width = Math.max(...zs) - Math.min(...zs);
    expect(width).toBeGreaterThan(8 * 0.99);
    expect(width).toBeLessThan(8 * 1.01);
    // Butt caps: no vertex should overshoot the line's own extent.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100.1);
  });

  it("identical output regardless of any zoom value supplied only to the harness", () => {
    // roadFootprint's signature takes no zoom parameter at all, so this is
    // true by construction — assert the interface shape directly.
    expect(roadFootprint.length).toBe(3);
    const line = metersLine([[0, 0], [100, 0]], ORIGIN);
    const a = roadFootprint(line, 8, ORIGIN);
    const b = roadFootprint(line, 8, ORIGIN);
    expect(a).toEqual(b);
  });

  // A bounded miter/bevel means every ring vertex sits near *some* original line
  // vertex (its own endpoint's butt cap, or the joint it was offset from) — a
  // runaway miter spike would produce a ring vertex far from all of them.
  function maxDistanceToNearestLineVertex(
    ring: [number, number][],
    lineVertices: [number, number][],
  ): number {
    return Math.max(
      ...ring.map((p) =>
        Math.min(...lineVertices.map((v) => Math.hypot(p[0] - v[0], p[1] - v[1]))),
      ),
    );
  }

  it("handles a right-angle bend without self-intersection or a runaway miter", () => {
    const localVertices: [number, number][] = [[0, 0], [50, 0], [50, 50]];
    const line = metersLine(localVertices, ORIGIN);
    const result = roadFootprint(line, 8, ORIGIN);
    expect(result).not.toBeNull();
    const ring = toLocal(result!.coordinates[0], ORIGIN);
    expect(allFinite(ring)).toBe(true);
    expect(isSimplePolygon(ring)).toBe(true);
    expect(maxDistanceToNearestLineVertex(ring, localVertices)).toBeLessThan(3 * 4);
  });

  it("bevels a moderate bend (bounded miter, no spike) rather than mitering to a far point", () => {
    // A 90 deg heading change with a wide road relative to the segment: bevel
    // and plain miter overlap in this range, but the bound must hold either way.
    const localVertices: [number, number][] = [[0, 0], [50, 0], [50, 50]];
    const line = metersLine(localVertices, ORIGIN);
    const result = roadFootprint(line, 30, ORIGIN);
    expect(result).not.toBeNull();
    const ring = toLocal(result!.coordinates[0], ORIGIN);
    expect(allFinite(ring)).toBe(true);
    expect(isSimplePolygon(ring)).toBe(true);
    expect(maxDistanceToNearestLineVertex(ring, localVertices)).toBeLessThan(3 * 15);
  });

  it("rejects (returns null) an acute bend whose offset would self-intersect, rather than repairing it", () => {
    // Naive per-side offsetting with a miter/bevel join — as opposed to a full
    // polygon union, which this module does not implement — cannot always
    // produce a simple polygon for a sharp-enough direction change; the plan
    // explicitly calls for detecting and rejecting that case rather than
    // emitting broken geometry. A 135 deg heading change is sharp enough to
    // hit this: verified empirically to self-intersect at this width/length.
    const localVertices: [number, number][] = [[0, 0], [50, 0], [21.72, 28.28]];
    const line = metersLine(localVertices, ORIGIN);
    const result = roadFootprint(line, 8, ORIGIN);
    expect(result).toBeNull();
  });

  it("silently drops a duplicate vertex and matches the deduplicated line's footprint", () => {
    const withDup = metersLine([[0, 0], [50, 0], [50, 0], [100, 0]], ORIGIN);
    const withoutDup = metersLine([[0, 0], [50, 0], [100, 0]], ORIGIN);
    const a = roadFootprint(withDup, 8, ORIGIN);
    const b = roadFootprint(withoutDup, 8, ORIGIN);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("never produces self-intersecting or non-finite geometry on an extreme U-turn", () => {
    const line = metersLine([[0, 0], [50, 0], [50, 1], [0, 1]], ORIGIN);
    const result = roadFootprint(line, 8, ORIGIN);
    if (result) {
      const ring = toLocal(result.coordinates[0], ORIGIN);
      expect(allFinite(ring)).toBe(true);
      expect(isSimplePolygon(ring)).toBe(true);
    }
  });

  it.each([0, 60])(
    "keeps perpendicular width within 1%% of 8m at latitude %d",
    (lat) => {
      const origin: Position = [0, lat];
      const line = metersLine([[0, 0], [100, 0]], origin);
      const result = roadFootprint(line, 8, origin);
      expect(result).not.toBeNull();
      const ring = toLocal(result!.coordinates[0], origin);
      const zs = ring.map(([, z]) => z);
      const width = Math.max(...zs) - Math.min(...zs);
      expect(width).toBeGreaterThan(8 * 0.99);
      expect(width).toBeLessThan(8 * 1.01);
    },
  );

  it("aligns footprint edges exactly at a shared-width bridge entrance point", () => {
    const shared: [number, number] = [50, 0];
    const road = roadFootprint(metersLine([[0, 0], shared], ORIGIN), 8, ORIGIN);
    const bridge = roadFootprint(metersLine([shared, [100, 0]], ORIGIN), 8, ORIGIN);
    expect(road).not.toBeNull();
    expect(bridge).not.toBeNull();
    const roadRing = toLocal(road!.coordinates[0], ORIGIN);
    const bridgeRing = toLocal(bridge!.coordinates[0], ORIGIN);
    const edgeZs = (ring: [number, number][]) =>
      ring
        .filter(([x]) => Math.abs(x - 50) < 0.01)
        .map(([, z]) => z)
        .sort((a, b) => a - b);
    const roadEdge = edgeZs(roadRing),
      bridgeEdge = edgeZs(bridgeRing);
    expect(roadEdge.length).toBeGreaterThanOrEqual(2);
    expect(bridgeEdge.length).toBeGreaterThanOrEqual(2);
    expect(roadEdge[0]).toBeCloseTo(bridgeEdge[0], 1);
    expect(roadEdge[roadEdge.length - 1]).toBeCloseTo(
      bridgeEdge[bridgeEdge.length - 1],
      1,
    );
  });
});
