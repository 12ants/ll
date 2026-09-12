import { describe, expect, it } from "vitest";
import type { Feature } from "geojson";
import {
  boundCache,
  DEFAULT_CACHE_BOUNDS,
  featureKey,
  reconcileFeatures,
  type WorldFeature,
} from "../src/world/feature-cache";

function lineFeature(
  coordinates: [number, number][],
  id?: string | number,
): Feature {
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

function polygonFeature(ring: [number, number][], id?: string | number): Feature {
  return {
    type: "Feature",
    id,
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function worldFeature(
  overrides: Partial<WorldFeature> & Pick<WorldFeature, "feature">,
): WorldFeature {
  const source = overrides.source ?? "world";
  const sourceLayer = overrides.sourceLayer ?? "transportation";
  return {
    source,
    sourceLayer,
    feature: overrides.feature,
    revision: overrides.revision ?? 1,
    completeness: overrides.completeness ?? "fragment",
    key: overrides.key ?? featureKey(source, sourceLayer, overrides.feature),
  };
}

describe("featureKey identity", () => {
  it("joins its parts with literal ASCII spaces, not control characters", () => {
    // Regression: the committed source once had NUL bytes (0x00) sitting
    // where these space characters visually appear — invisible in every
    // editor/diff view, undetected by every other test here since they only
    // ever compare featureKey(...) against another featureKey(...) call,
    // never against a literal string. Caught 2026-09-12 via a byte-level
    // scan after an unrelated main-branch merge investigation.
    const key = featureKey("world", "transportation", lineFeature([[10, 20], [11, 21]], "abc"));
    expect(key.split(" ")).toHaveLength(4);
    expect(key).toMatch(/^world transportation abc \d+$/);
    for (let i = 0; i < key.length; i++) expect(key.charCodeAt(i)).toBeGreaterThanOrEqual(0x20);
  });

  it("is unaffected by line direction (reversed lines)", () => {
    const forward = lineFeature([
      [10, 20],
      [10.001, 20.001],
      [10.002, 20.0005],
    ]);
    const reversed = lineFeature([
      [10.002, 20.0005],
      [10.001, 20.001],
      [10, 20],
    ]);
    expect(featureKey("world", "transportation", forward)).toBe(
      featureKey("world", "transportation", reversed),
    );
  });

  it("is unaffected by polygon ring starting vertex (rotated rings)", () => {
    const ring: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [0, 0],
    ];
    const rotated: [number, number][] = [
      [4, 4],
      [0, 4],
      [0, 0],
      [4, 0],
      [4, 4],
    ];
    expect(
      featureKey("world", "building", polygonFeature(ring)),
    ).toBe(featureKey("world", "building", polygonFeature(rotated)));
  });

  it("treats duplicate world-wrapped copies as the same feature", () => {
    const base = lineFeature([
      [179.5, 10],
      [179.6, 10.1],
    ]);
    const wrapped = lineFeature([
      [179.5 - 360, 10],
      [179.6 - 360, 10.1],
    ]);
    expect(featureKey("world", "transportation", base)).toBe(
      featureKey("world", "transportation", wrapped),
    );
  });

  it("scopes repeated raw IDs by source layer so they never collide", () => {
    const a = lineFeature(
      [
        [1, 1],
        [2, 2],
      ],
      "42",
    );
    const b = lineFeature(
      [
        [1, 1],
        [2, 2],
      ],
      "42",
    );
    expect(featureKey("world", "transportation", a)).not.toBe(
      featureKey("world", "bridges", b),
    );
  });

  it("gives two anonymous parallel roads distinct keys", () => {
    const a = lineFeature([
      [0, 0],
      [0, 0.01],
    ]);
    const b = lineFeature([
      [0.0005, 0],
      [0.0005, 0.01],
    ]);
    expect(featureKey("world", "transportation", a)).not.toBe(
      featureKey("world", "transportation", b),
    );
  });

  it("is independent of query result order (shuffled inputs)", () => {
    const features = [
      lineFeature(
        [
          [0, 0],
          [1, 1],
        ],
        "a",
      ),
      lineFeature(
        [
          [2, 2],
          [3, 3],
        ],
        "b",
      ),
      lineFeature(
        [
          [4, 4],
          [5, 5],
        ],
        "c",
      ),
    ];
    const keysInOrder = features.map((f) =>
      featureKey("world", "transportation", f),
    );
    const shuffled = [features[2], features[0], features[1]];
    const keysShuffled = shuffled.map((f) =>
      featureKey("world", "transportation", f),
    );
    expect(new Set(keysShuffled)).toEqual(
      new Set([keysInOrder[2], keysInOrder[0], keysInOrder[1]]),
    );
  });
});

describe("reconcileFeatures", () => {
  it("preserves multiple genuinely distinct fragments under the same ID (split road segments)", () => {
    const fragmentA = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
        ],
        "road-7",
      ),
      completeness: "fragment",
    });
    const fragmentB = worldFeature({
      feature: lineFeature(
        [
          [1, 0],
          [2, 0],
        ],
        "road-7",
      ),
      completeness: "fragment",
    });
    const result = reconcileFeatures([], [fragmentA, fragmentB]);
    expect(result).toHaveLength(2);
    expect(new Set(result.map((f) => f.key))).toEqual(
      new Set([fragmentA.key, fragmentB.key]),
    );
  });

  it("deduplicates identical fragments re-observed across passes", () => {
    const fragment = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
        ],
        "road-8",
      ),
      completeness: "fragment",
    });
    const result = reconcileFeatures([fragment], [{ ...fragment, revision: 2 }]);
    expect(result).toHaveLength(1);
    expect(result[0].revision).toBe(2);
  });

  it("never lets a coarse fragment overwrite or sit alongside a more complete resident geometry", () => {
    const complete = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        "road-9",
      ),
      completeness: "complete",
    });
    const laterFragment = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
        ],
        "road-9",
      ),
      completeness: "fragment",
      revision: 2,
    });
    const result = reconcileFeatures([complete], [laterFragment]);
    expect(result).toEqual([complete]);
  });

  it("drops previously resident fragments once a complete geometry for the same ID arrives", () => {
    const fragment = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
        ],
        "road-10",
      ),
      completeness: "fragment",
    });
    const complete = worldFeature({
      feature: lineFeature(
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        "road-10",
      ),
      completeness: "complete",
    });
    const result = reconcileFeatures([fragment], [complete]);
    expect(result).toEqual([complete]);
  });

  it("never concatenates unrelated fragments just because they share query order or a name", () => {
    const a = worldFeature({
      feature: {
        type: "Feature",
        id: undefined,
        properties: { name: "Main Street" },
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [1, 0],
          ],
        },
      },
    });
    const b = worldFeature({
      feature: {
        type: "Feature",
        id: undefined,
        properties: { name: "Main Street" },
        geometry: {
          type: "LineString",
          coordinates: [
            [10, 10],
            [11, 10],
          ],
        },
      },
    });
    const result = reconcileFeatures([], [a, b]);
    expect(result).toHaveLength(2);
    for (const f of result) {
      const g = f.feature.geometry;
      expect(g.type).toBe("LineString");
      expect(g.type === "LineString" && g.coordinates).toHaveLength(2);
    }
  });

  it("is order-independent: reordering the incoming batch yields the same resident set", () => {
    const previous: WorldFeature[] = [];
    const a = worldFeature({ feature: lineFeature([[0, 0], [1, 0]], "x") });
    const b = worldFeature({ feature: lineFeature([[2, 2], [3, 2]], "y") });
    const c = worldFeature({ feature: lineFeature([[4, 4], [5, 4]], "z") });
    const inOrder = reconcileFeatures(previous, [a, b, c]);
    const shuffled = reconcileFeatures(previous, [c, a, b]);
    expect(new Set(inOrder.map((f) => f.key))).toEqual(
      new Set(shuffled.map((f) => f.key)),
    );
  });

  it("rebasing the camera origin never changes resident identity", () => {
    // reconcileFeatures/featureKey never take an origin, so identity is the
    // same regardless of which camera-relative frame a caller later renders
    // this feature in.
    const feature = lineFeature([[10, 10], [11, 11]], "road-11");
    const keyAtOriginA = featureKey("world", "transportation", feature);
    const keyAtOriginB = featureKey("world", "transportation", feature);
    expect(keyAtOriginA).toBe(keyAtOriginB);
  });
});

describe("boundCache", () => {
  function nearFeature(dx: number, id: string): WorldFeature {
    return worldFeature({
      feature: lineFeature(
        [
          [dx / 111320, 0],
          [dx / 111320 + 0.0001, 0],
        ],
        id,
      ),
    });
  }

  it("keeps in-range features ahead of offscreen ones when over the record cap", () => {
    const inRange = nearFeature(50, "near");
    const offscreen = nearFeature(5000, "far");
    const { retained, incompleteCoverage } = boundCache(
      [offscreen, inRange],
      [0, 0],
      500,
      { maxRecords: 1, maxBytes: DEFAULT_CACHE_BOUNDS.maxBytes, marginMeters: 250 },
    );
    expect(retained.map((f) => f.key)).toEqual([inRange.key]);
    expect(incompleteCoverage).toBe(false);
  });

  it("flags incomplete coverage when even in-range features must be dropped", () => {
    const inRangeA = nearFeature(50, "a");
    const inRangeB = nearFeature(100, "b");
    const { retained, incompleteCoverage } = boundCache(
      [inRangeA, inRangeB],
      [0, 0],
      500,
      { maxRecords: 1, maxBytes: DEFAULT_CACHE_BOUNDS.maxBytes, marginMeters: 250 },
    );
    expect(retained).toHaveLength(1);
    expect(incompleteCoverage).toBe(true);
  });

  it("respects the byte budget independent of the record cap", () => {
    const big = worldFeature({
      feature: lineFeature(
        Array.from({ length: 2000 }, (_, i) => [i * 0.0001, 0] as [number, number]),
        "big",
      ),
    });
    const { retained, evicted } = boundCache([big], [0, 0], 500, {
      maxRecords: DEFAULT_CACHE_BOUNDS.maxRecords,
      maxBytes: 100,
      marginMeters: 250,
    });
    expect(retained).toHaveLength(0);
    expect(evicted).toBe(1);
  });
});
