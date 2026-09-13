import { describe, expect, it } from "vitest";
import { buildBridgeMesh, buildRailMesh, buildMarkingMesh } from "../src/world/bridge-mesh";
import { RAIL_CENTER_OFFSET, RAIL_THICKNESS, RAIL_COURSES } from "../src/world/bridge-boundaries";
import type { BridgeSurface, ProfileSample, Vec3 } from "../src/world/bridge-model";

function sample(distance: number, center: Vec3, halfWidth: number): ProfileSample {
  // Straight-ahead-in-X convention matching bridge-profile.ts: left is +Z.
  return {
    distance,
    center,
    left: [center[0], center[1], center[2] + halfWidth],
    right: [center[0], center[1], center[2] - halfWidth],
  };
}

function straightSurface(thickness = 0.8): BridgeSurface {
  return {
    id: "straight",
    thickness,
    openings: [],
    samples: [
      sample(0, [0, 10, 0], 7),
      sample(5, [5, 10, 0], 7),
      sample(10, [10, 10, 0], 7),
      sample(15, [15, 10, 0], 7),
    ],
  };
}

function curvedSurface(thickness = 0.8): BridgeSurface {
  // A 90-degree bend: heads +X, then turns to head +Z, with left/right
  // rotated to match at each sample (so the mesh gets a genuine twist).
  return {
    id: "curved",
    thickness,
    openings: [],
    samples: [
      sample(0, [0, 5, 0], 6),
      { distance: 5, center: [10, 5, 0], left: [10, 5, 6], right: [10, 5, -6] },
      {
        distance: 5 + Math.SQRT2 * 5,
        center: [10 + 5 / Math.SQRT2, 5, 5 / Math.SQRT2],
        left: [10 + 5 / Math.SQRT2 - 6 / Math.SQRT2, 5, 5 / Math.SQRT2 + 6 / Math.SQRT2],
        right: [10 + 5 / Math.SQRT2 + 6 / Math.SQRT2, 5, 5 / Math.SQRT2 - 6 / Math.SQRT2],
      },
      { distance: 20, center: [10, 5, 10], left: [4, 5, 10], right: [16, 5, 10] },
    ],
  };
}

function triangles(mesh: ReturnType<typeof buildBridgeMesh>): [Vec3, Vec3, Vec3][] {
  const tris: [Vec3, Vec3, Vec3][] = [];
  const at = (i: number): Vec3 => [
    mesh.positions[i * 3],
    mesh.positions[i * 3 + 1],
    mesh.positions[i * 3 + 2],
  ];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    tris.push([at(mesh.indices[i]), at(mesh.indices[i + 1]), at(mesh.indices[i + 2])]);
  }
  return tris;
}

function normalAt(mesh: ReturnType<typeof buildBridgeMesh>, triIndex: number): Vec3 {
  const vi = mesh.indices[triIndex * 3] * 3;
  return [mesh.normals[vi], mesh.normals[vi + 1], mesh.normals[vi + 2]];
}

function area(a: Vec3, b: Vec3, c: Vec3): number {
  const v1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cx = v1[1] * v2[2] - v1[2] * v2[1];
  const cy = v1[2] * v2[0] - v1[0] * v2[2];
  const cz = v1[0] * v2[1] - v1[1] * v2[0];
  return Math.hypot(cx, cy, cz) / 2;
}

describe("buildBridgeMesh", () => {
  it("returns empty geometry for fewer than two samples", () => {
    const mesh = buildBridgeMesh({ id: "x", thickness: 0.8, openings: [], samples: [straightSurface().samples[0]] });
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it("produces only non-degenerate, positive-area triangles", () => {
    const mesh = buildBridgeMesh(straightSurface());
    const tris = triangles(mesh);
    expect(tris.length).toBeGreaterThan(0);
    for (const [a, b, c] of tris) expect(area(a, b, c)).toBeGreaterThan(1e-6);
  });

  /** Every triangle's normal, as a flat list — assertions here are about what
   * the mesh contains, not about the order the loft happens to emit it in. */
  function normals(mesh: ReturnType<typeof buildBridgeMesh>): Vec3[] {
    const out: Vec3[] = [];
    for (let t = 0; t < mesh.indices.length / 3; t++) out.push(normalAt(mesh, t));
    return out;
  }

  it("orients the carriageway up and the underside down for a level, straight deck", () => {
    const ns = normals(buildBridgeMesh(straightSurface()));
    // The crowned carriageway is not perfectly level, so "up" is the dominant
    // component rather than exactly 1.
    expect(ns.some((n) => n[1] > 0.9)).toBe(true);
    expect(ns.some((n) => n[1] < -0.9)).toBe(true);
    // Nothing may point up *and* be part of the underside: the extremes are
    // the carriageway and the soffit, with no inverted faces between them.
    expect(Math.max(...ns.map((n) => n[1]))).toBeGreaterThan(0.9);
    expect(Math.min(...ns.map((n) => n[1]))).toBeLessThan(-0.9);
  });

  it("orients the fascias outward, away from the opposite edge", () => {
    // Straight deck heads +X with left at +Z, so the two fascias face +Z/-Z.
    const ns = normals(buildBridgeMesh(straightSurface()));
    expect(ns.some((n) => n[2] > 0.5)).toBe(true);
    expect(ns.some((n) => n[2] < -0.5)).toBe(true);
  });

  it("keeps every vertex between the kerb top and the soffit", () => {
    const thickness = 1.1;
    const mesh = buildBridgeMesh(straightSurface(thickness));
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    // The deck edge (== kerb top) is still the highest point, and the soffit
    // still sits exactly `thickness` below it: the profiled carriageway is
    // carved *inside* that envelope, never outside it.
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
    expect(Math.min(...ys)).toBeCloseTo(10 - thickness, 6);
  });

  it("crowns the carriageway below the kerb top so the deck is not a flat slab", () => {
    const mesh = buildBridgeMesh(straightSurface());
    const ys = new Set<number>();
    for (let i = 1; i < mesh.positions.length; i += 3)
      ys.add(Math.round(mesh.positions[i] * 1e4) / 1e4);
    // A plain box has exactly two distinct heights. A crowned deck with kerbs
    // has more: kerb top, carriageway edge, crown, soffit.
    expect(ys.size).toBeGreaterThan(2);
    const sorted = [...ys].sort((a, b) => b - a);
    expect(sorted[0]).toBeCloseTo(10, 6); // kerb top == deck edge
    expect(sorted[1]).toBeLessThan(10); // crown sits below the kerb top
    expect(sorted[1]).toBeGreaterThan(10 - 0.15); // ...but above the kerb foot
  });

  it("falls back to the plain slab section when asked for the distant profile", () => {
    const slab = buildBridgeMesh(straightSurface(1.1), "slab");
    const ys = new Set<number>();
    for (let i = 1; i < slab.positions.length; i += 3)
      ys.add(Math.round(slab.positions[i] * 1000) / 1000);
    expect(ys.size).toBe(2);
    expect(ys.has(10)).toBe(true);
    expect(ys.has(Math.round((10 - 1.1) * 1000) / 1000)).toBe(true);
  });

  it("keeps adjacent quads vertex-continuous: shared sample boundaries match exactly", () => {
    const surface = straightSurface();
    const mesh = buildBridgeMesh(surface);
    const positions: Vec3[] = [];
    for (let i = 0; i < mesh.positions.length; i += 3)
      positions.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    const hasVertex = (target: Vec3) =>
      positions.some((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]) < 1e-9);
    // Every original sample's top-left/top-right corner must appear verbatim
    // in the output (no seam gap introduced by quad-local vertex duplication).
    for (const s of surface.samples) {
      expect(hasVertex(s.left)).toBe(true);
      expect(hasVertex(s.right)).toBe(true);
    }
  });

  it("handles a curved bend without inverted top/underside normals", () => {
    const mesh = buildBridgeMesh(curvedSurface());
    const tris = triangles(mesh);
    expect(tris.length).toBeGreaterThan(0);
    for (const [a, b, c] of tris) expect(area(a, b, c)).toBeGreaterThan(1e-9);
    // The bend must not invert anything: the deck still has an up-facing
    // carriageway and a down-facing soffit.
    const ns = normals(mesh);
    expect(ns.some((n) => n[1] > 0.9)).toBe(true);
    expect(ns.some((n) => n[1] < -0.9)).toBe(true);
  });

  it("shades a curve smoothly: side-wall normals agree wherever segments meet", () => {
    // Flat per-face shading gives the two segments meeting at a sample two
    // different normals at the *same* position, which is what makes a curved
    // deck read as a chain of plates. Averaging along the run makes them
    // agree. The fixture's deck is level, so only the side walls actually
    // turn through the bend -- top/underside normals stay up/down either way
    // and would not discriminate.
    const mesh = buildBridgeMesh(curvedSurface());
    const key = (p: Vec3): string => p.map((v) => Math.round(v * 1e4)).join(",");
    // One face family only. Every edge of the cross-section is a deliberate
    // crease -- the left fascia and the left kerb face meet at the deck edge
    // with genuinely different normals -- so comparing "all near-vertical
    // faces" would compare across a crease and always disagree.
    const SECTION_FACES = 7;
    const LEFT_FASCIA = 6; // ring: left, kerbL, crown, kerbR, right, soffitR, soffitL
    const segments = curvedSurface().samples.length - 1;
    const wallNormalsByPosition = new Map<string, Vec3[]>();
    for (let seg = 0; seg < segments; seg++)
      for (let t = 0; t < 2; t++) {
        const tri = (seg * SECTION_FACES + LEFT_FASCIA) * 2 + t;
        for (let corner = 0; corner < 3; corner++) {
          const v = mesh.indices[tri * 3 + corner];
          const p: Vec3 = [
            mesh.positions[v * 3],
            mesh.positions[v * 3 + 1],
            mesh.positions[v * 3 + 2],
          ];
          const n: Vec3 = [mesh.normals[v * 3], mesh.normals[v * 3 + 1], mesh.normals[v * 3 + 2]];
          const k = key(p);
          if (!wallNormalsByPosition.has(k)) wallNormalsByPosition.set(k, []);
          wallNormalsByPosition.get(k)!.push(n);
        }
      }

    // The bend must actually turn, or agreement below would be trivially true.
    const distinct = new Set(
      [...wallNormalsByPosition.values()].flat().map((n) => key(n)),
    );
    expect(distinct.size).toBeGreaterThan(2);

    const shared = [...wallNormalsByPosition.values()].filter((ns) => ns.length > 1);
    expect(shared.length).toBeGreaterThan(0);
    for (const normals of shared)
      for (const n of normals) {
        expect(n[0]).toBeCloseTo(normals[0][0], 6);
        expect(n[1]).toBeCloseTo(normals[0][1], 6);
        expect(n[2]).toBeCloseTo(normals[0][2], 6);
      }
  });

  it("closes the ends with a cap so the deck is not an open-ended box", () => {
    const mesh = buildBridgeMesh(straightSurface());
    // 4 quads per segment (top, underside, 2 walls) x 3 segments x 2 tris = 24,
    // plus 2 end caps x 2 tris = 4.
    // 7 section faces per segment x 2 tris x 3 segments = 42, plus two end
    // caps fanned over the 7-point ring at (7 - 2) tris each = 10.
    expect(mesh.indices.length / 3).toBe(42 + 10);
    // The distant profile keeps the original, cheaper box topology.
    expect(buildBridgeMesh(straightSurface(), "slab").indices.length / 3).toBe(24 + 4);
  });
});

describe("buildMarkingMesh", () => {
  it("returns empty geometry for fewer than two samples", () => {
    const mesh = buildMarkingMesh({
      id: "x",
      thickness: 0.8,
      openings: [],
      samples: [straightSurface().samples[0]],
    });
    expect(mesh.indices.length).toBe(0);
  });

  it("paints two solid edge lines plus a dashed centreline", () => {
    const mesh = buildMarkingMesh(straightSurface());
    // Samples sit at 0/5/10/15, so segment midpoints are 2.5, 7.5 and 12.5.
    // Against a 9 m period with 4.5 m of paint, the centreline is on for the
    // first and third segments and off for the second -- that gap is the
    // difference between a dashed lane divider and a solid barrier line.
    const edgeLineQuads = 3 * 2;
    const centreQuads = 2;
    expect(mesh.indices.length / 3).toBe((edgeLineQuads + centreQuads) * 2);
  });

  it("floats the paint on the carriageway, never above the kerb or below the deck", () => {
    const mesh = buildMarkingMesh(straightSurface());
    const ys: number[] = [];
    for (let i = 1; i < mesh.positions.length; i += 3) ys.push(mesh.positions[i]);
    // Deck edge is y=10 and the kerb is 0.15 deep, so paint must sit under
    // the kerb top and above the carriageway it is painted on.
    expect(Math.max(...ys)).toBeLessThan(10);
    expect(Math.min(...ys)).toBeGreaterThan(10 - 0.15);
  });

  it("faces upward so the paint is visible from above", () => {
    const mesh = buildMarkingMesh(straightSurface());
    for (let i = 1; i < mesh.normals.length; i += 3) expect(mesh.normals[i]).toBeGreaterThan(0.9);
  });
});

describe("buildRailMesh", () => {
  it("returns empty geometry for no edges", () => {
    const mesh = buildRailMesh([]);
    expect(mesh.positions.length).toBe(0);
    expect(mesh.indices.length).toBe(0);
  });

  it("skips a degenerate (zero-length) edge instead of emitting garbage triangles", () => {
    const mesh = buildRailMesh([[[0, 2, 0], [0, 2, 0]]]);
    expect(mesh.indices.length).toBe(0);
  });

  it("produces only non-degenerate, positive-area triangles for one straight edge", () => {
    const mesh = buildRailMesh([[[0, 2, 0], [10, 2, 0]]]);
    const tris = triangles(mesh);
    expect(tris.length).toBeGreaterThan(0);
    for (const [a, b, c] of tris) expect(area(a, b, c)).toBeGreaterThan(1e-9);
  });

  it("builds every rail course at its own height above the edge, and nothing between them", () => {
    const mesh = buildRailMesh([[[0, 2, 0], [10, 2, 0]]]);
    const ys = new Set<number>();
    for (let i = 1; i < mesh.positions.length; i += 3) ys.add(Math.round(mesh.positions[i] * 1e6) / 1e6);
    const expected = new Set<number>();
    for (const { offset, thickness } of RAIL_COURSES) {
      expected.add(Math.round((2 + offset + thickness / 2) * 1e6) / 1e6);
      expected.add(Math.round((2 + offset - thickness / 2) * 1e6) / 1e6);
    }
    // A parapet is courses of rail with clear air between them: every vertex
    // belongs to some course's top or bottom face, never to the gap.
    expect(ys).toEqual(expected);
    // The handrail is still the original bar, so earlier captures stay comparable.
    expect(ys.has(Math.round((2 + RAIL_CENTER_OFFSET + RAIL_THICKNESS / 2) * 1e6) / 1e6)).toBe(true);
  });

  it("follows a sloped edge's own height rather than a flat constant", () => {
    // A ramp segment rising from y=0 to y=5 over its length — the rail must
    // rise with it (this is exactly why rails can't be yaw-only StructurePart
    // instances, per B4's own plan text).
    const mesh = buildRailMesh([[[0, 0, 0], [10, 5, 0]]]);
    const ys = mesh.positions.filter((_, i) => i % 3 === 1);
    // The lowest course's underside at the bottom of the ramp, and the
    // handrail's top face at the top of it, bound the whole parapet.
    const lowest = RAIL_COURSES.reduce((a, b) => (a.offset < b.offset ? a : b));
    const highest = RAIL_COURSES.reduce((a, b) => (a.offset > b.offset ? a : b));
    expect(Math.min(...ys)).toBeCloseTo(0 + lowest.offset - lowest.thickness / 2, 5);
    expect(Math.max(...ys)).toBeCloseTo(5 + highest.offset + highest.thickness / 2, 5);
  });

  it("builds one independent prism per edge and course, even when edges are disconnected", () => {
    const mesh = buildRailMesh([
      [[0, 2, 0], [10, 2, 0]],
      [[1000, 2, 0], [1010, 2, 0]],
    ]);
    // Per edge, per course: 4 quads (top, underside, 2 sides) x 2 tris = 8.
    expect(mesh.indices.length / 3).toBe(2 * RAIL_COURSES.length * 8);
  });
});
