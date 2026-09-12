import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import type { Position } from "geojson";
import {
  collectStructures,
  collectBridgeParts,
  type StructurePart,
} from "./structures";
import {
  insidePolygon,
  seeded,
  hashString,
  scatterPolygon,
  localMeters,
} from "./geography";
import { QUALITY, type WorldConfig } from "./config";
import { roadDimensions, VEGETATION_SETBACK } from "./road-model";
export interface Detail {
  position: [number, number, number];
  scale: number;
  rotation: number;
  tone: number;
}
export interface WorldDetails {
  origin: [number, number];
  trees: Detail[];
  benches: Detail[];
  structures: StructurePart[];
}
export const EMPTY_DETAILS: WorldDetails = {
  origin: [0, 0],
  trees: [],
  benches: [],
  structures: [],
};
function polygons(f: MapGeoJSONFeature): Position[][][] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates]
    : f.geometry.type === "MultiPolygon"
      ? f.geometry.coordinates
      : [];
}

/** A bounded enrichment pass, run after tile loading/movement, never per frame. */
export function collectDetails(map: MapLibreMap, c: WorldConfig): WorldDetails {
  const center = map.getCenter(),
    origin: [number, number] = [center.lng, center.lat];
  const result: WorldDetails = {
    origin,
    trees: [],
    benches: [],
    structures: [],
  };
  result.structures = [
    ...collectStructures(map, c, origin),
    ...collectBridgeParts(map, c, origin),
  ];
  if (map.getZoom() < 13.5 || (!c.trees && !c.amenities)) return result;
  const budget = QUALITY[c.quality],
    cap = Math.floor(budget.trees * c.treeDensity);
  const all = map.queryRenderedFeatures(undefined, {
    layers: [
      "parks",
      "landcover",
      "water",
      "buildings",
      "roads",
      "bridges",
    ].filter((id) => !!map.getLayer(id)),
  });
  const obstacles = all
    .filter((f) => ["water", "buildings"].includes(f.layer.id))
    .flatMap(polygons)
    .map((rings) => ({
      rings,
      minX: Math.min(...rings[0].map((p) => p[0])),
      maxX: Math.max(...rings[0].map((p) => p[0])),
      minY: Math.min(...rings[0].map((p) => p[1])),
      maxY: Math.max(...rings[0].map((p) => p[1])),
    }));
  const roads = all
    .filter((f) => ["roads", "bridges"].includes(f.layer.id))
    .flatMap((f) => {
      const lines =
        f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiLineString"
            ? f.geometry.coordinates
            : [];
      // Exclusion radius, not full carriageway width: half the road plus a
      // vegetation setback beyond its edge.
      const radius = roadDimensions(f.properties).width / 2 + VEGETATION_SETBACK;
      return lines.flatMap((line) =>
        line
          .slice(1)
          .map((p, i) => ({
            a: localMeters(line[i], origin),
            b: localMeters(p, origin),
            radius,
          })),
      );
    });
  let attempts = 0;
  const parks = all.filter(
    (f) =>
      f.layer.id === "parks" ||
      (f.layer.id === "landcover" &&
        ["wood", "grass"].includes(f.properties.class)),
  );
  const seen = new Set<string>(),
    occupied = new Set<string>();
  parkLoop: for (const f of parks)
    for (const rings of polygons(f)) {
      if (
        attempts > 12000 ||
        (result.trees.length >= cap &&
          (!c.amenities || result.benches.length >= 60))
      )
        break parkLoop;
      const key = JSON.stringify(rings[0]);
      if (seen.has(key)) continue;
      seen.add(key);
      const seed = hashString(key) + c.seed;
      const corners = rings[0].map((p) => localMeters(p, origin));
      const xs = corners.map((p) => p[0]),
        zs = corners.map((p) => p[2]);
      const area =
        (Math.max(...xs) - Math.min(...xs)) *
        (Math.max(...zs) - Math.min(...zs));
      const points = scatterPolygon(
        rings,
        Math.min(4000, Math.ceil((area / 160) * Math.max(c.treeDensity,c.amenities?0.3:0))),
        seed,
      );
      for (let i = 0; i < points.length; i++) {
        if (result.trees.length >= cap && result.benches.length >= 20) break;
        if (++attempts > 12000) break parkLoop;
        const point = points[i],
          pos = localMeters(point, origin);
        if (
          Math.hypot(pos[0], pos[2]) > budget.radius ||
          obstacles.some(
            (p) =>
              point[0] >= p.minX &&
              point[0] <= p.maxX &&
              point[1] >= p.minY &&
              point[1] <= p.maxY &&
              insidePolygon(point, p.rings),
          )
        )
          continue;
        const cell = `${Math.round(point[0] * 100000)}:${Math.round(point[1] * 100000)}`;
        if (occupied.has(cell)) continue;
        const screen = map.project([point[0], point[1]]);
        if (
          screen.x < 0 ||
          screen.y < 0 ||
          screen.x > map.getCanvas().clientWidth ||
          screen.y > map.getCanvas().clientHeight
        )
          continue;
        if (
          roads.some(({ a, b, radius }) => {
            if (
              pos[0] < Math.min(a[0], b[0]) - radius ||
              pos[0] > Math.max(a[0], b[0]) + radius ||
              pos[2] < Math.min(a[2], b[2]) - radius ||
              pos[2] > Math.max(a[2], b[2]) + radius
            )
              return false;
            const dx = b[0] - a[0],
              dz = b[2] - a[2],
              length = dx * dx + dz * dz;
            const t = length
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    ((pos[0] - a[0]) * dx + (pos[2] - a[2]) * dz) / length,
                  ),
                )
              : 0;
            return (
              Math.hypot(pos[0] - a[0] - t * dx, pos[2] - a[2] - t * dz) <
              radius
            );
          })
        )
          continue;
        occupied.add(cell);
        pos[1] = c.terrain
          ? (map.queryTerrainElevation([point[0], point[1]]) ?? 0)
          : 0;
        const detail = {
          position: pos,
          scale: 0.75 + seeded(seed + i + 600) * 0.65,
          rotation: seeded(seed + i + 900) * Math.PI * 2,
          tone: seeded(seed + i + 1200),
        };
        if (c.trees && result.trees.length < cap) result.trees.push(detail);
        if (c.amenities && i % 31 === 0 && result.benches.length < 60)
          result.benches.push({
            ...detail,
            position: [pos[0] + 5, pos[1], pos[2]],
            scale: 1,
          });
      }
    }
  return result;
}
