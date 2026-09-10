import type { Position } from "geojson";
export const ROAD_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "track",
  "path",
  "pedestrian",
  "living_street",
];
export function isPhysicalRoad(p: Record<string, unknown>) {
  return (
    ROAD_CLASSES.includes(String(p.class)) &&
    p.brunnel !== "tunnel" &&
    p.tunnel !== "yes" &&
    p.indoor !== 1 &&
    Number(p.layer ?? 0) >= 0
  );
}
export function seeded(seed: number) {
  let n = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
export function hashString(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function insideRing(point: Position, ring: Position[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function insidePolygon(point: Position, rings: Position[][]) {
  return (
    !!rings.length &&
    insideRing(point, rings[0]) &&
    !rings.slice(1).some((r) => insideRing(point, r))
  );
}
export function scatterPolygon(
  rings: Position[][],
  count: number,
  seed: number,
): Position[] {
  if (!rings[0]?.length) return [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of rings[0]) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  const points: Position[] = [];
  const cap = Math.min(4000, Math.max(0, Math.floor(count)));
  for (let i = 0; i < cap * 14 && points.length < cap; i++) {
    const point = [
      minX + seeded(seed + i * 2) * (maxX - minX),
      minY + seeded(seed + i * 2 + 1) * (maxY - minY),
    ];
    if (insidePolygon(point, rings)) points.push(point);
  }
  return points;
}
export function localMeters(
  point: Position,
  origin: Position,
): [number, number, number] {
  return [
    (point[0] - origin[0]) * 111320 * Math.cos((origin[1] * Math.PI) / 180),
    0,
    -(point[1] - origin[1]) * 111320,
  ];
}

export function wrapLongitude(longitude:number) { return ((longitude+180)%360+360)%360-180 }
