import { describe, expect, it } from "vitest";
import { PALETTES } from "../src/world/config";
import {
  isMajorRoadClass,
  MAJOR_ROAD_CLASSES,
  roadColor,
  roadDimensions,
  VEGETATION_SETBACK,
} from "../src/world/road-model";

describe("roadDimensions", () => {
  it("locks out camera coupling (plan regression shape)", () => {
    const properties = { class: "primary", width: "12" };
    expect(roadDimensions(properties).width).toBe(12);
    expect(roadDimensions({ class: "path" }).width).toBe(3);
    expect(roadDimensions({ class: "primary", width: -1 }).width).toBe(14);
  });

  it("resolves class fallback widths", () => {
    expect(roadDimensions({ class: "track" }).width).toBe(3);
    expect(roadDimensions({ class: "motorway" }).width).toBe(14);
    expect(roadDimensions({ class: "trunk" }).width).toBe(14);
    expect(roadDimensions({ class: "residential" }).width).toBe(8);
    expect(roadDimensions({ class: "some-unknown-class" }).width).toBe(8);
    expect(roadDimensions({}).width).toBe(8);
  });

  it("accepts a finite positive metric width from an alternate source", () => {
    expect(roadDimensions({ class: "secondary", width: 9.5 }).width).toBe(9.5);
    expect(roadDimensions({ class: "secondary", width: "9.5m" }).width).toBe(9.5);
    expect(roadDimensions({ class: "secondary", width: "9.5 m" }).width).toBe(
      9.5,
    );
  });

  it("rejects malformed, unit-mismatched or out-of-range widths and falls back to class", () => {
    expect(roadDimensions({ class: "secondary", width: "12ft" }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", width: "twelve" }).width).toBe(
      8,
    );
    expect(roadDimensions({ class: "secondary", width: NaN }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", width: Infinity }).width).toBe(
      8,
    );
    expect(roadDimensions({ class: "secondary", width: 0 }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", width: 41 }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", width: {} }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", width: null }).width).toBe(8);
  });

  it("derives width from positive integer lanes when width is absent or invalid", () => {
    expect(roadDimensions({ class: "secondary", lanes: 2 }).width).toBeCloseTo(
      6.5,
    );
    expect(roadDimensions({ class: "secondary", lanes: 0 }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", lanes: -1 }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", lanes: 1.5 }).width).toBe(8);
    expect(roadDimensions({ class: "secondary", lanes: 20 }).width).toBe(40);
    expect(
      roadDimensions({ class: "secondary", width: "bogus", lanes: 2 }).width,
    ).toBeCloseTo(6.5);
  });

  it("fixes structural dimensions by class group, independent of width source", () => {
    expect(roadDimensions({ class: "path" })).toMatchObject({
      deckThickness: 0.5,
      markingWidth: 0.15,
      shoulderWidth: 0,
    });
    expect(roadDimensions({ class: "track", width: 6 })).toMatchObject({
      deckThickness: 0.5,
      markingWidth: 0.15,
      shoulderWidth: 0,
    });
    expect(roadDimensions({ class: "motorway" })).toMatchObject({
      deckThickness: 1.1,
      markingWidth: 0.15,
      shoulderWidth: 0.5,
    });
    expect(roadDimensions({ class: "residential" })).toMatchObject({
      deckThickness: 0.8,
      markingWidth: 0.15,
      shoulderWidth: 0.5,
    });
  });

  it("never accepts zoom or camera position as input", () => {
    expect(roadDimensions.length).toBe(1);
    expect(roadColor.length).toBe(2);
  });
});

describe("roadColor", () => {
  it("returns the same surface tone for a fixed class regardless of palette", () => {
    expect(roadColor({ class: "motorway" }, "limestone")).toBe(
      roadColor({ class: "motorway" }, "earth"),
    );
    expect(roadColor({ class: "path" }, "limestone")).toBe(
      roadColor({ class: "path" }, "mineral"),
    );
  });

  it("falls back to the active palette's road tone for unmatched classes", () => {
    expect(roadColor({ class: "residential" }, "limestone")).toBe(
      PALETTES.limestone.road,
    );
    expect(roadColor({ class: "secondary" }, "earth")).toBe(
      PALETTES.earth.road,
    );
  });
});

it("shares one major-road-class list between the predicate and the exported constant", () => {
  for (const cls of MAJOR_ROAD_CLASSES) expect(isMajorRoadClass(cls)).toBe(true);
  expect(isMajorRoadClass("secondary")).toBe(false);
  expect(isMajorRoadClass(undefined)).toBe(false);
});

it("names the vegetation setback distinct from full carriageway width", () => {
  expect(VEGETATION_SETBACK).toBeGreaterThan(0);
  expect(VEGETATION_SETBACK).toBeLessThan(roadDimensions({ class: "path" }).width);
});
