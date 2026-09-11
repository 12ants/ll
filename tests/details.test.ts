import { expect, it } from "vitest";
import type { Map, MapGeoJSONFeature } from "maplibre-gl";
import { collectDetails } from "../src/world/details-data";
import { DEFAULT_CONFIG } from "../src/world/config";

it("keeps park amenities when tree density is zero", () => {
  const park = {
    type: "Feature",
    id: 1,
    source: "world",
    sourceLayer: "park",
    layer: { id: "parks", type: "fill", source: "world" },
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[-0.002, -0.002], [0.002, -0.002], [0.002, 0.002], [-0.002, 0.002], [-0.002, -0.002]]],
    },
  } as MapGeoJSONFeature;
  // The collector needs only visible geography and projection from MapLibre;
  // keep those boundaries deterministic so public tile changes cannot hide a regression.
  const map = {
    getCenter: () => ({ lng: 0, lat: 0 }),
    getZoom: () => 16,
    getLayer: () => park.layer,
    queryRenderedFeatures: () => [park],
    project: () => ({ x: 100, y: 100 }),
    getCanvas: () => ({ clientWidth: 200, clientHeight: 200 }),
  } as unknown as Map;
  const data = collectDetails(map, {
    ...DEFAULT_CONFIG, buildings: false, bridges: false, treeDensity: 0,
  });
  expect(data.trees).toEqual([]);
  expect(data.benches.length).toBeGreaterThan(0);
});
