import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseConfig } from "../src/world/config";
import {
  isPhysicalRoad,
  seeded,
  insidePolygon,
  scatterPolygon,
} from "../src/world/geography";
import { createWorldStyle } from "../src/world/style";
import { roadColor } from "../src/world/road-model";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

describe("world configuration boundary", () => {
  it("round-trips a complete saved world", () =>
    expect(parseConfig(JSON.stringify(DEFAULT_CONFIG))).toEqual(
      DEFAULT_CONFIG,
    ));
  it("rejects out-of-range and non-finite geometry settings", () => {
    for (const v of [-1, 10000, "large", null])
      expect(() =>
        parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, heightScale: v })),
      ).toThrow();
  });
  it("rejects invalid enums, missing settings and bad coordinates", () => {
    expect(() => parseConfig('{"quality":"ultra"}')).toThrow();
    expect(() =>
      parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, longitude: 200 })),
    ).toThrow();
    expect(() =>
      parseConfig(JSON.stringify({ ...DEFAULT_CONFIG, palette: "missing" })),
    ).toThrow();
  });
});
describe("physical world geography", () => {
  it("keeps bridges and surface paths while excluding tunnels and ferry routes", () => {
    expect(isPhysicalRoad({ class: "primary", brunnel: "bridge" })).toBe(true);
    expect(isPhysicalRoad({ class: "path" })).toBe(true);
    for (const properties of [
      { class: "ferry" },
      { class: "primary", brunnel: "tunnel" },
      { class: "rail" },
      { class: "primary", layer: -1 },
      { class: "path", tunnel: "yes" },
    ])
      expect(isPhysicalRoad(properties)).toBe(false);
  });
  it("generates repeatable variations", () => {
    expect(Array.from({ length: 10 }, (_, i) => seeded(i + 42))).toEqual(
      Array.from({ length: 10 }, (_, i) => seeded(i + 42)),
    );
    expect(new Set(Array.from({ length: 10 }, (_, i) => seeded(i))).size).toBe(
      10,
    );
  });
  const polygon = [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ],
    [
      [4, 4],
      [6, 4],
      [6, 6],
      [4, 6],
      [4, 4],
    ],
  ];
  it("respects polygon holes", () => {
    expect(insidePolygon([2, 2], polygon)).toBe(true);
    expect(insidePolygon([5, 5], polygon)).toBe(false);
    expect(insidePolygon([11, 2], polygon)).toBe(false);
  });
  it("caps scatter and never places details outside the polygon or inside holes", () => {
    const points = scatterPolygon(polygon, 30, 9);
    expect(points.length).toBe(30);
    expect(points.every((p) => insidePolygon(p, polygon))).toBe(true);
    expect(points).toEqual(scatterPolygon(polygon, 30, 9));
    expect(scatterPolygon([], 30, 9)).toEqual([]);
  });
});
it("produces a valid style containing no symbol or route layers", () => {
  const style = createWorldStyle(DEFAULT_CONFIG);
  expect(validateStyleMin(style)).toEqual([]);
  expect(style.layers.some((l) => l.type === "symbol")).toBe(false);
  expect(
    style.layers.some((l) => /label|ferry|tunnel|boundary/.test(l.id)),
  ).toBe(false);
  expect(style.layers.some((l) => l.type === "fill-extrusion")).toBe(true);
});
it("shares the road-model surface-color policy between the flat road layer and 3D decks", () => {
  const style = createWorldStyle(DEFAULT_CONFIG);
  const roads = style.layers.find((l) => l.id === "roads");
  const lineColor = (roads as { paint: { "line-color": unknown[] } }).paint[
    "line-color"
  ];
  expect(lineColor).toContain(
    roadColor({ class: "motorway" }, DEFAULT_CONFIG.palette),
  );
  expect(lineColor).toContain(
    roadColor({ class: "path" }, DEFAULT_CONFIG.palette),
  );
  expect(lineColor).toContain(
    roadColor({ class: "pedestrian" }, DEFAULT_CONFIG.palette),
  );
  expect(lineColor[lineColor.length - 1]).toBe(
    roadColor({ class: "residential" }, DEFAULT_CONFIG.palette),
  );
});
