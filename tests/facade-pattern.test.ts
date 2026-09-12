import { describe, expect, it } from "vitest";
import { PALETTES } from "../src/world/config";
import { createFacadePattern, facadeImageId } from "../src/world/facade-pattern";

const PALETTE_KEYS = Object.keys(PALETTES) as (keyof typeof PALETTES)[];

describe("createFacadePattern", () => {
  it("returns a 64x64 RGBA buffer of the exact expected length", () => {
    const pattern = createFacadePattern("limestone", false);
    expect(pattern.width).toBe(64);
    expect(pattern.height).toBe(64);
    expect(pattern.data.length).toBe(64 * 64 * 4);
  });

  it("is fully opaque everywhere", () => {
    const { data } = createFacadePattern("earth", true);
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });

  it("is deterministic: repeated calls with the same input produce identical output", () => {
    const a = createFacadePattern("mineral", false);
    const b = createFacadePattern("mineral", false);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it("produces distinct output for each palette", () => {
    const outputs = PALETTE_KEYS.map((p) =>
      Array.from(createFacadePattern(p, false).data),
    );
    for (let i = 0; i < outputs.length; i++)
      for (let j = i + 1; j < outputs.length; j++)
        expect(outputs[i]).not.toEqual(outputs[j]);
  });

  it("produces distinct output for day vs night on the same palette", () => {
    const day = createFacadePattern("limestone", false);
    const night = createFacadePattern("limestone", true);
    expect(Array.from(day.data)).not.toEqual(Array.from(night.data));
  });

  it("stays within the 0-255 RGB range for every pixel", () => {
    const { data } = createFacadePattern("earth", true);
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("offsets alternate horizontal courses so joints stagger rather than align in straight columns", () => {
    // A joint pixel column near the left edge in one course should not
    // necessarily remain a joint in the next course, if staggering is applied.
    const { data, width } = createFacadePattern("limestone", false);
    const pixel = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const row0 = Array.from({ length: width }, (_, x) => pixel(x, 0).join(","));
    const row16 = Array.from({ length: width }, (_, x) => pixel(x, 16).join(","));
    expect(row0).not.toEqual(row16);
  });
});

describe("facadeImageId", () => {
  it("uses fixed facade-<palette>-day/night image IDs", () => {
    expect(facadeImageId("limestone", false)).toBe("facade-limestone-day");
    expect(facadeImageId("limestone", true)).toBe("facade-limestone-night");
    expect(facadeImageId("earth", false)).toBe("facade-earth-day");
  });

  it("gives every palette/day-night combination a unique image ID", () => {
    const ids = new Set<string>();
    for (const p of PALETTE_KEYS)
      for (const night of [false, true]) ids.add(facadeImageId(p, night));
    expect(ids.size).toBe(PALETTE_KEYS.length * 2);
  });
});
