import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import type { Position } from "geojson";
import { hashString, localMeters, seeded, insidePolygon } from "./geography";
import { type WorldConfig } from "./config";
export interface StructurePart {
  position: [number, number, number];
  scale: [number, number, number];
  rotation: number;
  color: string;
  /** Instancing group; omit for the default box. */
  kind?: "box" | "cylinder";
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
  for (const { f, ring, center } of candidates.slice(0, 90)) {
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
      tone = seeded(hash);
    // Shared instanced window strips follow the original footprint; no per-building materials.
    let used = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = localMeters(ring[i - 1], origin),
        b = localMeters(ring[i], origin),
        dx = b[0] - a[0],
        dz = b[2] - a[2],
        len = Math.hypot(dx, dz);
      if (len < 5 || len > 130) continue;
      const columns = Math.max(1, Math.floor(len / 4)),
        floors = Math.floor((height - base * c.heightScale) / 3.5);
      const stride = Math.max(1, Math.ceil((columns * floors) / 180));
      for (let floor = 0; floor < floors; floor++)
        for (let col = 0; col < columns; col++) {
          if (
            (floor * columns + col) % stride ||
            used >= 240 ||
            parts.length >= cap
          )
            continue;
          const t = (col + 0.5) / columns,
            ground_floor = floor === 0 && base === 0,
            lit = seeded(hash + floor * 131 + col * 7 + 17) > 0.84;
          parts.push({
            position: [
              a[0] + dx * t,
              ground + base * c.heightScale + floor * 3.5 + 2.1,
              a[2] + dz * t,
            ],
            scale: [
              Math.min(2.0, (len / columns) * 0.6),
              ground_floor ? 2.1 : 1.5,
              ground_floor ? 0.16 : 0.12,
            ],
            rotation: -Math.atan2(dz, dx),
            color: ground_floor
              ? "#5f6a5e"
              : lit
                ? "#d9cf9c"
                : tone > 0.65
                  ? "#8e9894"
                  : "#93988b",
          });
          used++;
        }
    }
    if (base === 0 && insidePolygon(center, [ring]) && parts.length < cap) {
      const pos = localMeters(center, origin),
        roll = seeded(hash + 4242);
      if (roll < 0.4)
        parts.push({
          position: [pos[0], ground + height + 0.9, pos[2]],
          scale: [3.2, 1.8, 2.4],
          rotation: 0,
          color: "#a4a493",
          kind: "box",
        });
      else if (roll < 0.68)
        parts.push({
          position: [pos[0], ground + height + 2.1, pos[2]],
          scale: [1.7, 2.8, 1.7],
          rotation: 0,
          color: "#8b7a5e",
          kind: "cylinder",
        });
      else if (roll < 0.85)
        parts.push({
          position: [pos[0], ground + height + 0.35, pos[2]],
          scale: [4.5, 0.7, 4.5],
          rotation: 0,
          color: "#9a9686",
          kind: "box",
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
        const major = ["motorway", "trunk", "primary"].includes(
          f.properties.class,
        );
        const width = ["path", "track"].includes(f.properties.class)
          ? 3
          : major
            ? 14
            : 8;
        const deckThickness = ["path", "track"].includes(f.properties.class)
          ? 0.5
          : major
            ? 1.1
            : 0.8;
        // Echo the flat map's class-based road-surface tone on the deck for continuity.
        const deckColor = ["path", "track"].includes(f.properties.class)
          ? "#c7b796"
          : major
            ? "#a19c8d"
            : "#b0afa1";
        center[1] = ground + rise;
        const rotation = -Math.atan2(dz, dx);
        parts.push({
          position: center,
          scale: [length, deckThickness, width],
          rotation,
          color: deckColor,
          kind: "box",
        });
        if (major)
          parts.push({
            position: [center[0], center[1] - 0.65, center[2]],
            scale: [length, 0.5, width * 0.85],
            rotation,
            color: "#7f8479",
            kind: "box",
          });
        // Railings: a slim top rail plus evenly spaced vertical posts, in place of a solid slab.
        for (const side of [-1, 1]) {
          const offX = -Math.sin(rotation) * width * 0.48 * side,
            offZ = Math.cos(rotation) * width * 0.48 * side;
          parts.push({
            position: [center[0] + offX, center[1] + 0.95, center[2] + offZ],
            scale: [length, 0.14, 0.14],
            rotation,
            color: "#7c8179",
            kind: "box",
          });
          const postCount = Math.max(2, Math.min(28, Math.round(length / 5)));
          for (let pi = 0; pi <= postCount; pi++) {
            if (parts.length >= 500) break;
            const t = pi / postCount;
            parts.push({
              position: [
                a[0] + dx * t + offX,
                center[1] + 0.6,
                a[2] + dz * t + offZ,
              ],
              scale: [0.14, 0.75, 0.14],
              rotation,
              color: "#7c8179",
              kind: "box",
            });
          }
        }
        // Piers: evenly spaced round columns along the span, instead of one central slab.
        if (length > 12) {
          const pierCount = Math.max(
            2,
            Math.min(9, Math.round(length / 38) + 1),
          );
          const pierRadius = major ? 1.5 : 1.15;
          for (let pi = 0; pi < pierCount; pi++) {
            if (parts.length >= 500) break;
            const t = pierCount === 1 ? 0.5 : pi / (pierCount - 1);
            parts.push({
              position: [a[0] + dx * t, ground + rise / 2, a[2] + dz * t],
              scale: [pierRadius, rise, pierRadius],
              rotation: 0,
              color: "#989c91",
              kind: "cylinder",
            });
          }
        }
      }
  }
  return parts;
}
