import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { PALETTES, daylight, mixHex, type WorldConfig } from "./config";
import { ROAD_CLASSES } from "./geography";
export const VECTOR_URL =
  import.meta.env.VITE_VECTOR_TILEJSON ||
  "https://tiles.openfreemap.org/planet";
export const DEM_URL =
  import.meta.env.VITE_DEM_TILEJSON ||
  "https://tiles.mapterhorn.com/tilejson.json";
export const SURFACE_FILTER: ExpressionSpecification = [
  "all",
  ["in", ["get", "class"], ["literal", ROAD_CLASSES]],
  ["!=", ["get", "brunnel"], "tunnel"],
  [">=", ["to-number", ["get", "layer"], 0], 0],
  ["!=", ["get", "indoor"], 1],
];
const numericId: ExpressionSpecification = [
  "to-number",
  ["id"],
  ["get", "render_height"],
  12,
];
export function buildingHeight(c: WorldConfig): ExpressionSpecification {
  return [
    "*",
    c.heightScale,
    ["max", 3, ["to-number", ["get", "render_height"], 9]],
    [
      "+",
      1,
      ["*", c.variation, 0.18, ["-", ["/", ["%", numericId, 19], 18], 0.5]],
    ],
  ];
}
export function createWorldStyle(c: WorldConfig): StyleSpecification {
  const p = PALETTES[c.palette];
  const d = daylight(c.hour);
  // Blend a touch of the active palette into fixed landcover tones, so foliage
  // reads differently across palettes instead of staying one hardcoded green.
  const woodColor = mixHex("#879c73", p.park, 0.28);
  const visible = (v: boolean) => ({
    visibility: v ? ("visible" as const) : ("none" as const),
  });
  const groundRoad: FilterSpecification = [
    "all",
    SURFACE_FILTER,
    ["!=", ["get", "brunnel"], "bridge"],
  ];
  const bridge: FilterSpecification = [
    "all",
    SURFACE_FILTER,
    ["==", ["get", "brunnel"], "bridge"],
  ];
  const majorClasses = ["motorway", "trunk", "primary"];
  // Class-based surface tone: asphalt for major roads, dirt for trails, pavers for pedestrian ways.
  const roadSurface: ExpressionSpecification = [
    "match",
    ["get", "class"],
    ["motorway", "trunk"],
    "#8f897c",
    ["path", "track"],
    "#c7b796",
    ["pedestrian", "living_street"],
    "#d6cfba",
    p.road,
  ];
  const width: ExpressionSpecification = [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    5,
    0.25,
    12,
    [
      "match",
      ["get", "class"],
      ["motorway", "trunk"],
      3,
      ["primary", "secondary"],
      2,
      1,
    ],
    16,
    [
      "match",
      ["get", "class"],
      ["motorway", "trunk"],
      18,
      ["primary", "secondary"],
      12,
      ["path", "track"],
      2,
      7,
    ],
    19,
    [
      "match",
      ["get", "class"],
      ["motorway", "trunk"],
      100,
      ["primary", "secondary"],
      80,
      ["path", "track"],
      12,
      46,
    ],
  ];
  const road = (
    id: string,
    filter: FilterSpecification,
    color: string | ExpressionSpecification,
    extra: number,
    on: boolean,
  ): LayerSpecification => ({
    id,
    type: "line",
    source: "world",
    "source-layer": "transportation",
    filter,
    layout: { ...visible(on), "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": color,
      "line-width": extra
        ? (width.map((item, i) =>
            i >= 4 && i % 2 === 0 ? ["+", item, extra] : item,
          ) as ExpressionSpecification)
        : width,
    },
  });
  const layers: LayerSpecification[] = [
    {
      id: "earth",
      type: "background",
      paint: { "background-color": p.ground },
    },
    {
      id: "landcover",
      type: "fill",
      source: "world",
      "source-layer": "landcover",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "wood",
          woodColor,
          "grass",
          p.park,
          "sand",
          "#e0d1b0",
          "ice",
          "#eeeee7",
          p.ground,
        ],
        "fill-opacity": 0.8,
      },
    },
    {
      id: "landuse",
      type: "fill",
      source: "world",
      "source-layer": "landuse",
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          ["cemetery", "grass", "recreation_ground", "village_green"],
          p.park,
          "hospital",
          "#cdc6b7",
          "industrial",
          "#c6c5b9",
          p.ground,
        ],
        "fill-opacity": 0.6,
      },
    },
    {
      id: "parks",
      type: "fill",
      source: "world",
      "source-layer": "park",
      layout: visible(c.parks),
      paint: { "fill-color": p.park, "fill-opacity": 0.85 },
    },
    {
      id: "relief",
      type: "hillshade",
      source: "elevation",
      layout: visible(c.terrain),
      paint: {
        "hillshade-shadow-color": d.hillShadow,
        "hillshade-highlight-color": d.hillHigh,
        "hillshade-exaggeration": 0.3,
      },
    },
    {
      id: "water",
      type: "fill",
      source: "world",
      "source-layer": "water",
      paint: { "fill-color": c.waterColor },
    },
    {
      id: "streams",
      type: "line",
      source: "world",
      "source-layer": "waterway",
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      paint: {
        "line-color": c.waterColor,
        "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 16, 4],
      },
    },
    road("road-edges", groundRoad, "#dcd8ca", 2, c.roads),
    road("roads", groundRoad, roadSurface, 0, c.roads),
    {
      id: "road-centerline",
      type: "line",
      source: "world",
      "source-layer": "transportation",
      minzoom: 15,
      filter: [
        "all",
        groundRoad,
        ["in", ["get", "class"], ["literal", majorClasses]],
      ],
      layout: { ...visible(c.roads), "line-cap": "butt", "line-join": "round" },
      paint: {
        "line-color": "#f1ecd9",
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0, 16, 1, 19, 3],
        "line-dasharray": [3, 3],
        "line-opacity": 0.55,
      },
    },
    road("bridge-edges", bridge, "#7c8179", 3, c.bridges),
    road("bridges", bridge, roadSurface, 0, c.bridges),
    {
      id: "buildings",
      type: "fill-extrusion",
      source: "world",
      "source-layer": "building",
      minzoom: 13,
      layout: visible(c.buildings),
      filter: [
        "all",
        ["!=", ["get", "hide_3d"], true],
        [">=", ["to-number", ["get", "render_height"], 0], 0],
      ],
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["%", numericId, 5],
          0,
          p.colors[0],
          1,
          p.colors[1],
          2,
          p.colors[2],
          3,
          p.colors[3],
          4,
          p.colors[4],
        ],
        "fill-extrusion-height": buildingHeight(c),
        "fill-extrusion-base": [
          "*",
          c.heightScale,
          ["max", 0, ["to-number", ["get", "render_min_height"], 0]],
        ],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
  ];
  return {
    version: 8,
    name: "Terrene physical world",
    sources: {
      world: { type: "vector", url: VECTOR_URL },
      elevation: {
        type: "raster-dem",
        url: DEM_URL,
        encoding: "terrarium",
        tileSize: 512,
        maxzoom: 12,
        attribution:
          '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
      },
    },
    layers,
    light: {
      anchor: "map",
      color: d.sunColor,
      intensity: d.mapLight,
      position: [
        1.5,
        90 + (c.hour - 12) * 15,
        Math.max(15, 75 - Math.abs(12 - c.hour) * 7),
      ],
    },
    sky: {
      "sky-color": d.sky,
      "horizon-color": d.horizon,
      "fog-color": d.fog,
      "sky-horizon-blend": 0.85,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.65,
    },
    ...(c.terrain
      ? { terrain: { source: "elevation", exaggeration: c.exaggeration } }
      : {}),
  };
}
