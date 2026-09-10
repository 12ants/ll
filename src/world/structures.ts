import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import type { Position } from "geojson";
import { hashString, localMeters, seeded, insidePolygon } from "./geography";
import { type WorldConfig } from "./config";
export interface StructurePart {
  position: [number, number, number];
  scale: [number, number, number];
  rotation: number;
  color: string;
}
export function collectStructures(
  map: Map,
  c: WorldConfig,
  origin: Position,
): StructurePart[] {
  const parts: StructurePart[] = [];
  if (map.getZoom() < 15 || !c.buildings || !c.facades) return parts;
  const cap =
    c.quality === "eco" ? 500 : c.quality === "balanced" ? 2600 : 6000;
  const seen = new Set<string>();
  const candidates: {
    f: MapGeoJSONFeature;
    ring: Position[];
    center: Position;
    distance: number;
  }[] = [];
  for (const f of map.queryRenderedFeatures(undefined, {
    layers: ["buildings"],
  })) {
    const ring =
      f.geometry.type === "Polygon"
        ? f.geometry.coordinates[0]
        : f.geometry.type === "MultiPolygon"
          ? f.geometry.coordinates[0][0]
          : null;
    if (!ring?.length) continue;
    const key = JSON.stringify(ring);
    if (seen.has(key)) continue;
    seen.add(key);
    const center = ring.reduce(
      (a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length],
      [0, 0],
    );
    const pos = localMeters(center, origin),
      distance = Math.hypot(pos[0], pos[2]);
    if (distance < 750) candidates.push({ f, ring, center, distance });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const pool = candidates.slice(0, 90);
  // Spread the shared cap across every visible building instead of maxing out the
  // nearest handful and leaving the rest bare.
  const perBuilding = Math.max(20, Math.floor(cap / Math.max(1, pool.length)));
  for (const { f, ring, center } of pool) {
    if (parts.length >= cap) break;
    const h = Number(f.properties.render_height) || 9,
      id = Number(f.id ?? h),
      base = Number(f.properties.render_min_height) || 0;
    const height =
      Math.max(3, h) *
      c.heightScale *
      (1 + c.variation * 0.18 * ((id % 19) / 18 - 0.5));
    const ground = c.terrain
      ? (map.queryTerrainElevation([center[0], center[1]]) ?? 0)
      : 0;
    const hash = hashString(JSON.stringify(ring)),
      tone = seeded(hash),
      lit = c.hour < 7 || c.hour >= 18;
    // Shared instanced window panes follow the original footprint; no per-building materials.
    let used = 0;
    const centerPos = localMeters(center, origin);
    for (let i = 1; i < ring.length; i++) {
      const a = localMeters(ring[i - 1], origin),
        b = localMeters(ring[i], origin),
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        len = Math.hypot(dx, dz);
      if (len < 5) continue;
      const columns = Math.max(1, Math.floor(len / 4)),
        floors = Math.max(0, Math.floor((height - base * c.heightScale) / 3.5));
      if (!floors) continue;
      const remaining = Math.min(perBuilding - used, cap - parts.length);
      if (remaining <= 0) continue;
      // Thin a regular floor/column grid down to the remaining budget, rather than
      // scattering single cells, so the result reads as window bands, not speckle.
      const step = Math.max(1, Math.ceil(Math.sqrt((columns * floors) / remaining)));
      // Outward wall normal (away from the footprint center) keeps panes from z-fighting
      // against MapLibre's coplanar fill-extrusion face.
      const nx = a[0] + dx / 2 - centerPos[0],
        nz = a[2] + dz / 2 - centerPos[2],
        nLen = Math.hypot(nx, nz) || 1;
      for (let floor = 0; floor < floors; floor += step)
        for (let col = 0; col < columns; col += step) {
          if (used >= perBuilding || parts.length >= cap) continue;
          const t = (col + 0.5) / columns;
          const paneLit = lit && seeded(hash + floor * 97 + col * 13) > 0.62;
          parts.push({
            position: [
              a[0] + dx * t + (nx / nLen) * 0.08,
              ground + base * c.heightScale + floor * 3.5 + 2.1,
              a[2] + dz * t + (nz / nLen) * 0.08,
            ],
            scale: [Math.min(2.2, (len / columns) * 0.7), 1.6, 0.1],
            rotation: -Math.atan2(dz, dx),
            color: paneLit
              ? "#f6cf8a"
              : tone > 0.65
                ? "#333f47"
                : "#3c4750",
          });
          used++;
        }
    }
    if (base === 0 && insidePolygon(center, [ring]) && parts.length < cap) {
      const pos = localMeters(center, origin);
      pos[1] = ground + height + 0.9;
      parts.push({
        position: pos,
        scale: [3.2, 1.8, 2.4],
        rotation: 0,
        color: "#a4a493",
      });
    }
  }
  return parts;
}

/** Approximate physical decks and supports from visible OSM bridge centerlines. */
export function collectBridgeParts(
  map: Map,
  c: WorldConfig,
  origin: Position,
): StructurePart[] {
  if (!c.bridges || map.getZoom() < 13.5) return [];
  const parts: StructurePart[] = [],
    seen = new Set<string>();
  for (const f of map.queryRenderedFeatures(undefined, {
    layers: ["bridges"],
  })) {
    const lines =
      f.geometry.type === "LineString"
        ? [f.geometry.coordinates]
        : f.geometry.type === "MultiLineString"
          ? f.geometry.coordinates
          : [];
    for (const line of lines)
      for (let i = 1; i < line.length; i++) {
        if (parts.length > 500) return parts;
        const key = JSON.stringify([line[i - 1], line[i]]);
        if (seen.has(key)) continue;
        seen.add(key);
        const a = localMeters(line[i - 1], origin),
          b = localMeters(line[i], origin),
          dx = b[0] - a[0],
          dz = b[2] - a[2],
          length = Math.hypot(dx, dz);
        const center: [number, number, number] = [
          (a[0] + b[0]) / 2,
          0,
          (a[2] + b[2]) / 2,
        ];
        if (
          length < 2 ||
          length > 1500 ||
          Math.hypot(center[0], center[2]) > 2200
        )
          continue;
        const ground = c.terrain
          ? (map.queryTerrainElevation([line[i][0], line[i][1]]) ?? 0)
          : 0;
        const rise = 5 + Math.max(0, Number(f.properties.layer) || 0) * 3;
        const width = ["path", "track"].includes(f.properties.class)
          ? 3
          : ["motorway", "trunk", "primary"].includes(f.properties.class)
            ? 14
            : 8;
        center[1] = ground + rise;
        const rotation = -Math.atan2(dz, dx);
        parts.push({
          position: center,
          scale: [length, 0.9, width],
          rotation,
          color: "#b0afa1",
        });
        for (const side of [-1, 1])
          parts.push({
            position: [
              center[0] - Math.sin(rotation) * width * 0.48 * side,
              center[1] + 0.75,
              center[2] + Math.cos(rotation) * width * 0.48 * side,
            ],
            scale: [length, 0.65, 0.22],
            rotation,
            color: "#92998e",
          });
        if (length > 12)
          parts.push({
            position: [center[0], ground + rise / 2, center[2]],
            scale: [1.5, rise, width * 0.7],
            rotation,
            color: "#989c91",
          });
      }
  }
  return parts;
}
