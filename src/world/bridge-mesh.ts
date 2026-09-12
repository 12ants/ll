import type { BridgeMeshData, BridgeSurface, ProfileSample, Vec3 } from "./bridge-model";
import { RAIL_CENTER_OFFSET, RAIL_THICKNESS } from "./bridge-boundaries";

/**
 * Builds one indexed deck mesh (top, underside and both side walls) from a
 * solved `BridgeSurface`. Pure geometry: takes no zoom, camera or map
 * reference. `thickness` extends straight down from each sample's finished
 * roadway top (`ProfileSample.center`/`left`/`right`, per bridge-model.ts's
 * own doc comment — Y there is always the top, never a deck-center height).
 *
 * Scope, named explicitly (see IDEAS_WORK_LOG.md): each triangle gets its own
 * three vertices and a flat face normal — vertices are not shared across
 * triangles or strips (no smooth-shaded index reuse). This still produces one
 * continuous, gap-free surface (the old collectBridgeParts()'s "overlapping
 * capped boxes" seam problem this replaces), just without the vertex-count
 * optimization the plan's bullet suggests. Bend handling relies entirely on
 * B2's <= 5 m resampling; there is no self-intersection detection or corner
 * beveling for a sharp bend within one surface (road-surfaces.ts's
 * offset-boundary approach does this for 2D road footprints, but porting it
 * to a 3D deck strip was out of scope here). Acute *junctions* between
 * separate bridges are not a case B3 needs to handle: B2 already resolves
 * junction conflicts by rejecting the component, so one call here only ever
 * sees a single unbranched surface.
 */

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function length(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len > 0 ? [a[0] / len, a[1] / len, a[2] / len] : [0, 1, 0];
}
function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  return normalize(cross(sub(b, a), sub(c, a)));
}
function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length(cross(sub(b, a), sub(c, a))) / 2;
}

const DEGENERATE_AREA = 1e-9; // m^2; skips zero-length-segment quads (duplicate samples)

class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];

  private pushTriangle(a: Vec3, b: Vec3, c: Vec3): void {
    if (triangleArea(a, b, c) < DEGENERATE_AREA) return;
    const n = faceNormal(a, b, c);
    const base = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...n, ...n, ...n);
    this.indices.push(base, base + 1, base + 2);
  }

  /**
   * One quad (a,b,c,d in boundary order) oriented so its normal points
   * roughly toward `outward` — computed, not hand-derived per strip, so a
   * sign mistake in one strip can't silently flip only that strip's faces.
   */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, outward: Vec3): void {
    const n = faceNormal(a, b, c);
    if (dot(n, outward) >= 0) {
      this.pushTriangle(a, b, c);
      this.pushTriangle(a, c, d);
    } else {
      this.pushTriangle(a, c, b);
      this.pushTriangle(a, d, c);
    }
  }

  toMeshData(): BridgeMeshData {
    return {
      positions: new Float32Array(this.positions),
      normals: new Float32Array(this.normals),
      indices: new Uint32Array(this.indices),
    };
  }
}

function lower(p: Vec3, thickness: number): Vec3 {
  return [p[0], p[1] - thickness, p[2]];
}

/** Local forward tangent at sample i, used only to orient side-wall/cap quads outward. */
function tangentAt(samples: readonly ProfileSample[], i: number): Vec3 {
  const prev = samples[Math.max(0, i - 1)].center;
  const next = samples[Math.min(samples.length - 1, i + 1)].center;
  return normalize(sub(next, prev));
}

export function buildBridgeMesh(surface: BridgeSurface): BridgeMeshData {
  const builder = new MeshBuilder();
  const samples = surface.samples;
  if (samples.length < 2) return builder.toMeshData();

  const up: Vec3 = [0, 1, 0];
  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i],
      s1 = samples[i + 1];
    const leftTop0 = s0.left,
      rightTop0 = s0.right,
      leftTop1 = s1.left,
      rightTop1 = s1.right;
    const leftBottom0 = lower(leftTop0, surface.thickness),
      rightBottom0 = lower(rightTop0, surface.thickness),
      leftBottom1 = lower(leftTop1, surface.thickness),
      rightBottom1 = lower(rightTop1, surface.thickness);

    // Top: left[i], right[i], left[i+1], right[i+1] per the plan's own strip
    // pattern, oriented up.
    builder.quad(leftTop0, leftTop1, rightTop1, rightTop0, up);
    // Underside, oriented down.
    builder.quad(leftBottom0, leftBottom1, rightBottom1, rightBottom0, [0, -1, 0]);

    // Side walls: outward is "away from the opposite rail," computed per
    // quad rather than assumed, so a locally reversed left/right (a hairpin)
    // still orients correctly instead of silently inverting.
    const leftOutward = normalize(sub(leftTop0, rightTop0));
    builder.quad(leftTop0, leftTop1, leftBottom1, leftBottom0, leftOutward);
    const rightOutward = normalize(sub(rightTop0, leftTop0));
    builder.quad(rightTop0, rightBottom0, rightBottom1, rightTop1, rightOutward);
  }

  // End caps, so an unreplaced ground tie-in never looks through an open box.
  const first = samples[0];
  const firstOutward: Vec3 = (() => {
    const t = tangentAt(samples, 0);
    return [-t[0], -t[1], -t[2]];
  })();
  builder.quad(
    first.left,
    first.right,
    lower(first.right, surface.thickness),
    lower(first.left, surface.thickness),
    firstOutward,
  );
  const last = samples[samples.length - 1];
  const lastOutward = tangentAt(samples, samples.length - 1);
  builder.quad(
    last.right,
    last.left,
    lower(last.left, surface.thickness),
    lower(last.right, surface.thickness),
    lastOutward,
  );

  return builder.toMeshData();
}

const DEGENERATE_LENGTH = 1e-6; // meters; skips zero-length edge segments

/**
 * B4: a thin rail-bar mesh strip along each exposed railing edge (see
 * bridge-boundaries.ts's `exposedBridgeEdges`), following that edge's own
 * height exactly — a sloped approach ramp's rail has to tilt with it, which
 * a yaw-only `StructurePart` box instance cannot represent (see B4's own
 * plan text: "if sloped rails use mesh strips, keep them in
 * BridgeMeshData"). Each segment becomes its own small rectangular prism
 * (top, underside, both outward side faces); no end caps and no shared
 * vertices across segments — same documented scope choice as
 * `buildBridgeMesh` (a continuous surface, not smooth-shaded or
 * vertex-deduplicated), and a rail this thin has no visible open end except
 * at the two extreme, cosmetically negligible tips of the whole run.
 */
export function buildRailMesh(edges: readonly [Vec3, Vec3][]): BridgeMeshData {
  const builder = new MeshBuilder();
  const half = RAIL_THICKNESS / 2;
  const top = RAIL_CENTER_OFFSET + half;
  const bottom = RAIL_CENTER_OFFSET - half;
  for (const [a, b] of edges) {
    const dx = b[0] - a[0],
      dz = b[2] - a[2];
    const len = Math.hypot(dx, dz);
    if (len < DEGENERATE_LENGTH) continue;
    const nx = -dz / len,
      nz = dx / len;
    const raised = (p: Vec3, offsetX: number, offsetZ: number, y: number): Vec3 => [
      p[0] + offsetX,
      p[1] + y,
      p[2] + offsetZ,
    ];
    const topA0 = raised(a, nx * half, nz * half, top);
    const topA1 = raised(a, -nx * half, -nz * half, top);
    const topB0 = raised(b, nx * half, nz * half, top);
    const topB1 = raised(b, -nx * half, -nz * half, top);
    const botA0 = raised(a, nx * half, nz * half, bottom);
    const botA1 = raised(a, -nx * half, -nz * half, bottom);
    const botB0 = raised(b, nx * half, nz * half, bottom);
    const botB1 = raised(b, -nx * half, -nz * half, bottom);
    builder.quad(topA0, topB0, topB1, topA1, [0, 1, 0]);
    builder.quad(botA1, botB1, botB0, botA0, [0, -1, 0]);
    builder.quad(topA0, topA1, botA1, botA0, [nx, 0, nz]);
    builder.quad(topB1, topB0, botB0, botB1, [-nx, 0, -nz]);
  }
  return builder.toMeshData();
}
