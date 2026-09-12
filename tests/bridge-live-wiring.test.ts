import { describe, expect, it } from "vitest";
import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import type { Position } from "geojson";
import { collectDetails } from "../src/world/details-data";
import { DEFAULT_CONFIG } from "../src/world/config";
import { metersToPosition } from "../src/world/geography";

/**
 * End-to-end check of the reduced-scope B3 live wiring added in
 * details-data.ts/structures.ts (see IDEAS_WORK_LOG.md): a solvable bridge
 * component should (a) publish a mesh in `data.bridges` and (b) make
 * `collectBridgeParts()` skip generating its own floating-box deck for the
 * same span, so the two renderers never both draw the same bridge.
 */

const ORIGIN: Position = [10, 45];

function line(a: [number, number], b: [number, number]): Position[] {
  return [metersToPosition(a, ORIGIN), metersToPosition(b, ORIGIN)];
}

function roadLayerFeature(
  id: string,
  coordinates: Position[],
  extra: Record<string, unknown> = {},
): MapGeoJSONFeature {
  const isBridge = extra.brunnel === "bridge";
  return {
    type: "Feature",
    id,
    source: "world",
    sourceLayer: "transportation",
    layer: { id: isBridge ? "bridges" : "roads", type: "line", source: "world" },
    properties: { class: "primary", ...extra },
    geometry: { type: "LineString", coordinates },
  } as unknown as MapGeoJSONFeature;
}

function buildMap(features: MapGeoJSONFeature[]): Map {
  return {
    getCenter: () => ({ lng: ORIGIN[0], lat: ORIGIN[1] }),
    getZoom: () => 15,
    getLayer: (id: string) => features.find((f) => f.layer.id === id)?.layer,
    queryRenderedFeatures: (_geom: unknown, opts: { layers: string[] }) =>
      features.filter((f) => opts.layers.includes(f.layer.id)),
    queryTerrainElevation: () => 0,
  } as unknown as Map;
}

describe("B3 live wiring: bridge mesh publication and fallback ownership", () => {
  it("publishes a mesh and skips the fallback box for a solvable bridge", () => {
    // Major-class (primary) fallback width 14m -> clearance 2m (layer 1,
    // tagged-bridge tier) -> required transition ~37.5m at the 8% grade cap;
    // 45m approaches on each side comfortably clear it.
    const west = roadLayerFeature("west", line([-45, 0], [0, 0]));
    const bridge = roadLayerFeature("bridge", line([0, 0], [50, 0]), { brunnel: "bridge", layer: 1 });
    const east = roadLayerFeature("east", line([50, 0], [95, 0]));
    const map = buildMap([west, bridge, east]);

    const data = collectDetails(map, {
      ...DEFAULT_CONFIG,
      trees: false,
      amenities: false,
      buildings: false,
      terrain: false,
    });

    expect(data.bridges).toHaveLength(1);
    expect(data.bridges[0].mesh.indices.length).toBeGreaterThan(0);
    // The old box generator must not also draw this same span.
    expect(data.structures).toHaveLength(0);
  });

  it("still falls back to the box generator for a bridge that cannot solve", () => {
    // 3m of approach on each side is nowhere near the ~37.5m required rise —
    // solveBridges() rejects it as infeasible, so the old box path must own it.
    const west = roadLayerFeature("west", line([-3, 0], [0, 0]));
    const bridge = roadLayerFeature("bridge", line([0, 0], [50, 0]), { brunnel: "bridge", layer: 1 });
    const east = roadLayerFeature("east", line([50, 0], [53, 0]));
    const map = buildMap([west, bridge, east]);

    const data = collectDetails(map, {
      ...DEFAULT_CONFIG,
      trees: false,
      amenities: false,
      buildings: false,
      terrain: false,
    });

    expect(data.bridges).toHaveLength(0);
    expect(data.structures.length).toBeGreaterThan(0);
    expect(data.structures.some((p) => p.kind === "box")).toBe(true);
  });
});
