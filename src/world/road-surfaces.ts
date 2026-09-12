import type { Polygon, Position } from "geojson";
import { localMeters, metersToPosition } from "./geography";

type Vec2 = [number, number];

const DEDUP_EPSILON = 1e-6; // meters
const PARALLEL_EPSILON = 1e-9;

function sub(a: Vec2, b: Vec2): Vec2 {
  return [a[0] - b[0], a[1] - b[1]];
}
function add(a: Vec2, b: Vec2): Vec2 {
  return [a[0] + b[0], a[1] + b[1]];
}
function scale(v: Vec2, s: number): Vec2 {
  return [v[0] * s, v[1] * s];
}
function length(v: Vec2): number {
  return Math.hypot(v[0], v[1]);
}
function dist(a: Vec2, b: Vec2): number {
  return length(sub(a, b));
}

/** Intersection of two infinite lines (point + direction); null if parallel. */
function lineIntersect(p1: Vec2, d1: Vec2, p2: Vec2, d2: Vec2): Vec2 | null {
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < PARALLEL_EPSILON) return null;
  const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / denom;
  return add(p1, scale(d1, t));
}

/**
 * One side's offset boundary (start to end), butt-capped at both line ends.
 * Interior joints are mitered unless the miter exceeds twice the half-width,
 * in which case the joint is beveled (the two raw segment-offset points
 * instead of their far intersection).
 */
function offsetBoundary(
  points: readonly Vec2[],
  dirs: readonly Vec2[],
  sign: 1 | -1,
  halfWidth: number,
): Vec2[] {
  const n = points.length;
  const normal = (d: Vec2): Vec2 => [-d[1] * sign, d[0] * sign];
  const boundary: Vec2[] = [add(points[0], scale(normal(dirs[0]), halfWidth))];
  for (let j = 1; j < n - 1; j++) {
    const prevOffset = add(points[j], scale(normal(dirs[j - 1]), halfWidth));
    const curOffset = add(points[j], scale(normal(dirs[j]), halfWidth));
    const intersection = lineIntersect(prevOffset, dirs[j - 1], curOffset, dirs[j]);
    if (!intersection) {
      // Collinear/parallel segments: either offset point already lies on the shared line.
      boundary.push(curOffset);
      continue;
    }
    if (dist(intersection, points[j]) > 2 * halfWidth) {
      boundary.push(prevOffset, curOffset);
    } else {
      boundary.push(intersection);
    }
  }
  boundary.push(add(points[n - 1], scale(normal(dirs[n - 2]), halfWidth)));
  return boundary;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  const val = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(val) < PARALLEL_EPSILON) return 0;
  return val > 0 ? 1 : 2;
}
function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    Math.min(a[0], b[0]) - PARALLEL_EPSILON <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) + PARALLEL_EPSILON &&
    Math.min(a[1], b[1]) - PARALLEL_EPSILON <= c[1] &&
    c[1] <= Math.max(a[1], b[1]) + PARALLEL_EPSILON
  );
}
function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
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
/** Non-adjacent-edge self-intersection check on a closed ring (first === last point). */
function isSimplePolygon(ring: readonly Vec2[]): boolean {
  const n = ring.length - 1;
  if (n < 3) return false;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  return true;
}

/**
 * A road's ground footprint as a GeoJSON polygon, offset by half `width` on
 * each side of `line`. Works entirely in a local meter frame relative to
 * `origin` (never zoom or camera position — see road-model.ts's
 * `roadDimensions`/`roadColor`, which supply the same-policy width this
 * consumes) and converts back to longitude/latitude for output. Rejects
 * fewer than two distinct positions and any offset that would self-intersect
 * (an explicit fallback signal — the caller should fall back to drawing the
 * original line, not attempt to repair the geometry).
 */
export function roadFootprint(
  line: readonly Position[],
  width: number,
  origin: Position,
): Polygon | null {
  if (!Number.isFinite(width) || width <= 0) return null;
  const raw = line.map((p) => {
    const [x, , z] = localMeters(p, origin);
    return [x, z] as Vec2;
  });
  const points: Vec2[] = [];
  for (const p of raw) {
    if (points.length === 0 || dist(p, points[points.length - 1]) > DEDUP_EPSILON)
      points.push(p);
  }
  if (points.length < 2) return null;

  const halfWidth = width / 2;
  const dirs: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = sub(points[i + 1], points[i]);
    const len = length(d);
    dirs.push(len > 0 ? [d[0] / len, d[1] / len] : [1, 0]);
  }

  const left = offsetBoundary(points, dirs, 1, halfWidth);
  const right = offsetBoundary(points, dirs, -1, halfWidth);
  const localRing: Vec2[] = [...left, ...right.slice().reverse()];
  localRing.push(localRing[0]);

  if (!isSimplePolygon(localRing)) return null;

  const ring: Position[] = localRing.map((p) => metersToPosition(p, origin));
  return { type: "Polygon", coordinates: [ring] };
}
