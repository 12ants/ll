import type { Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import type { Feature, Position } from "geojson";
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
  metersToPosition,
} from "./geography";
import { PALETTES, QUALITY, type WorldConfig } from "./config";
import { MAJOR_SURFACE_COLOR, roadDimensions, VEGETATION_SETBACK } from "./road-model";
import { featureKey, type WorldFeature } from "./feature-cache";
import { buildRoadGraph } from "./road-topology";
import {
  solveBridges,
  DEFAULT_MAX_APPROACH,
  defaultMaxGradeForEdge,
} from "./bridge-profile";
import { buildBridgeMesh } from "./bridge-mesh";
import type { BridgeMeshData, BridgeSurface, Vec3 } from "./bridge-model";
export interface Detail {
  position: [number, number, number];
  scale: number;
  rotation: number;
  tone: number;
}
/** A published B3 bridge mesh plus the surface color it should render with —
 * BridgeMeshData itself carries no material info (bridge-mesh.ts is pure
 * geometry), and BridgeSurface carries no road class (see bridge-profile.ts's
 * own major-width approximation), so color is resolved once here. */
export interface BridgeMeshEntry {
  mesh: BridgeMeshData;
  color: string;
}
export interface WorldDetails {
  origin: [number, number];
  trees: Detail[];
  benches: Detail[];
  structures: StructurePart[];
  bridges: BridgeMeshEntry[];
}
export const EMPTY_DETAILS: WorldDetails = {
  origin: [0, 0],
  trees: [],
  benches: [],
  structures: [],
  bridges: [],
};
function polygons(f: MapGeoJSONFeature): Position[][][] {
  return f.geometry.type === "Polygon"
    ? [f.geometry.coordinates]
    : f.geometry.type === "MultiPolygon"
      ? f.geometry.coordinates
      : [];
}

/**
 * Builds every B2-ready bridge surface visible in the current view, using B1's
 * road graph over the same "roads"/"bridges" features already rendered.
 *
 * Reduced-scope B3, named explicitly (see IDEAS_WORK_LOG.md): the plan's B3
 * lists Z3 (physical ground road surfaces) as a dependency, specifically for
 * masking the 2D "roads"/"bridges" style layers under a published deck/ramp.
 * Z3 itself has zero call sites — only its pure `roadFootprint` function
 * exists. Building Z3's full GeoJSON-source/hysteresis-handoff renderer just
 * to unblock this is its own multi-stage task, not attempted here. Instead:
 * the published mesh is added *without* masking the 2D line layers beneath
 * it. This is a net visual improvement over the status quo regardless (the
 * existing box-bridge deck already floats with no ramp at all — an abrupt
 * jump with a visible gap; the new ramp is continuous ground-to-ground), with
 * one known, narrow, documented risk: right at a ramp's ground anchor, where
 * the new mesh's height approaches the 2D line's flat ground plane, a few
 * pixels of depth-buffer z-fighting are possible. See the work log for the
 * before/after browser check. A future Z3 task should add the plan's
 * "controlled depth bias" and fallback-source masking to remove this
 * seam entirely.
 */
function collectReadyBridgeSurfaces(
  map: MapLibreMap,
  c: WorldConfig,
  origin: Position,
): BridgeSurface[] {
  if (!c.bridges || map.getZoom() < 13.5) return [];
  const raw = map.queryRenderedFeatures(undefined, {
    layers: ["roads", "bridges"].filter((id) => !!map.getLayer(id)),
  });
  const features: WorldFeature[] = raw.map((f, i) => {
    const feature: Feature = {
      type: "Feature",
      id: f.id,
      properties: f.properties,
      geometry: f.geometry,
    };
    return {
      key: `${featureKey("world", f.layer.id, feature)} ${i}`,
      source: "world",
      sourceLayer: f.layer.id,
      feature,
      revision: 1,
      completeness: "fragment",
    };
  });
  const graph = buildRoadGraph(features, origin);
  if (!graph.edges.some((e) => e.bridge)) return [];
  // "the adapter returns zero without touching the map API" when terrain is
  // off (B2's plan text) — checked before ever calling queryTerrainElevation,
  // not merely relying on solveBridges' own internal terrain-off guard.
  const sampleGround = (point: Vec3): number | null => {
    if (!c.terrain) return 0;
    const [lng, lat] = metersToPosition([point[0], point[2]], origin);
    return map.queryTerrainElevation([lng, lat]) ?? null;
  };
  const { surfaces } = solveBridges(graph, sampleGround, {
    terrain: c.terrain,
    maxGrade: defaultMaxGradeForEdge,
    maxApproach: DEFAULT_MAX_APPROACH,
  });
  return surfaces;
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
    bridges: [],
  };
  const readySurfaces = collectReadyBridgeSurfaces(map, c, origin);
  // Same two-tier major/other approximation bridge-profile.ts already uses
  // for clearance/thickness (RoadEdge carries no road class) — a bridge with
  // thickness 1.1 was solved as "major" there, so it gets the flat map's
  // major-road tone; everything else gets the active palette's road tone.
  // Collapses OSM path/track bridges into the same tone as other minor
  // roads rather than a distinct dirt/paver tint, matching bridge-profile.ts's
  // own two-tier (not three-tier) simplification.
  result.bridges = readySurfaces.map((surface) => ({
    mesh: buildBridgeMesh(surface),
    color: surface.thickness > 0.9 ? MAJOR_SURFACE_COLOR : PALETTES[c.palette].road,
  }));
  result.structures = [
    ...collectStructures(map, c, origin),
    ...collectBridgeParts(map, c, origin, readySurfaces),
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
