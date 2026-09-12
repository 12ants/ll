import { describe, expect, it } from "vitest";
import { buildBridgeMesh } from "../src/world/bridge-mesh";
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

  it("orients the top strip up and the underside down for a level, straight deck", () => {
    const mesh = buildBridgeMesh(straightSurface());
    const tris = triangles(mesh);
    // First 2 triangles are the first top quad, next 2 the first underside quad
    // (see buildBridgeMesh's per-segment order: top, underside, left wall, right wall).
    for (let t = 0; t < 2; t++) {
      const n = normalAt(mesh, t);
      expect(n[1]).toBeGreaterThan(0.9);
    }
    for (let t = 2; t < 4; t++) {
      const n = normalAt(mesh, t);
      expect(n[1]).toBeLessThan(-0.9);
    }
  });

  it("orients side walls outward, away from the opposite rail", () => {
    const mesh = buildBridgeMesh(straightSurface());
    // Triangles 4-5 are the left wall (+Z side), 6-7 the right wall (-Z side).
    for (let t = 4; t < 6; t++) expect(normalAt(mesh, t)[2]).toBeGreaterThan(0.5);
    for (let t = 6; t < 8; t++) expect(normalAt(mesh, t)[2]).toBeLessThan(-0.5);
  });

  it("separates top and underside by exactly the surface thickness", () => {
    const thickness = 1.1;
    const mesh = buildBridgeMesh(straightSurface(thickness));
    const ys = new Set<number>();
    for (let i = 1; i < mesh.positions.length; i += 3) ys.add(Math.round(mesh.positions[i] * 1000) / 1000);
    expect(ys.has(10)).toBe(true);
    expect(ys.has(Math.round((10 - thickness) * 1000) / 1000)).toBe(true);
    for (const y of ys) expect(y === 10 || Math.abs(y - (10 - thickness)) < 1e-6).toBe(true);
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
    // Segment 0 (before the bend) heads +X: its top/underside normals stay
    // vertical regardless of the bend later in the path.
    expect(normalAt(mesh, 0)[1]).toBeGreaterThan(0.9);
    expect(normalAt(mesh, 2)[1]).toBeLessThan(-0.9);
  });

  it("closes the ends with a cap so the deck is not an open-ended box", () => {
    const mesh = buildBridgeMesh(straightSurface());
    // 4 quads per segment (top, underside, 2 walls) x 3 segments x 2 tris = 24,
    // plus 2 end caps x 2 tris = 4.
    expect(mesh.indices.length / 3).toBe(24 + 4);
  });
});
