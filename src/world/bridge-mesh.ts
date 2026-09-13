import type { BridgeMeshData, BridgeSurface, ProfileSample, Vec3 } from "./bridge-model";
import { RAIL_COURSES } from "./bridge-boundaries";

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
    const n = faceNormal(a, b, c);
    this.pushTriangleShaded(a, b, c, n, n, n);
  }

  /**
   * Same triangle, but each corner carries its own normal. Vertices are still
   * not shared between triangles (see the file doc comment); smooth shading
   * comes from adjacent triangles agreeing on the normal *at a shared
   * position*, which is all the interpolator needs, and costs no change to
   * triangle count or ordering.
   */
  private pushTriangleShaded(a: Vec3, b: Vec3, c: Vec3, na: Vec3, nb: Vec3, nc: Vec3): void {
    if (triangleArea(a, b, c) < DEGENERATE_AREA) return;
    const base = this.positions.length / 3;
    this.positions.push(...a, ...b, ...c);
    this.normals.push(...na, ...nb, ...nc);
    this.indices.push(base, base + 1, base + 2);
  }

  /**
   * A quad whose four corners carry their own normals, wound outward by the
   * same computed rule as `quad`. `na..nd` correspond to `a..d`.
   */
  quadShaded(
    a: Vec3,
    b: Vec3,
    c: Vec3,
    d: Vec3,
    na: Vec3,
    nb: Vec3,
    nc: Vec3,
    nd: Vec3,
    outward: Vec3,
  ): void {
    const n = faceNormal(a, b, c);
    if (dot(n, outward) >= 0) {
      this.pushTriangleShaded(a, b, c, na, nb, nc);
      this.pushTriangleShaded(a, c, d, na, nc, nd);
    } else {
      this.pushTriangleShaded(a, c, b, na, nc, nb);
      this.pushTriangleShaded(a, d, c, na, nd, nc);
    }
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

  /**
   * Triangle fan closing an arbitrary cross-section ring, flat-shaded. Used
   * for the end caps, whose ring is no longer a quad once the deck carries a
   * kerb and crown.
   */
  fan(ring: readonly Vec3[], outward: Vec3): void {
    for (let k = 1; k + 1 < ring.length; k++) {
      const a = ring[0],
        b = ring[k],
        c = ring[k + 1];
      const n = faceNormal(a, b, c);
      if (dot(n, outward) >= 0) this.pushTriangle(a, b, c);
      else this.pushTriangle(a, c, b);
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

/** Face normal flipped, if needed, to agree with the face's outward direction. */
function orientedNormal(a: Vec3, b: Vec3, c: Vec3, outward: Vec3): Vec3 {
  const n = faceNormal(a, b, c);
  return dot(n, outward) >= 0 ? n : [-n[0], -n[1], -n[2]];
}

function averageNormals(a: Vec3, b: Vec3): Vec3 {
  const sum: Vec3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return length(sum) > 0 ? normalize(sum) : a;
}

/**
 * Deck cross-section.
 *
 * A plain box reads as a slab, not as something a vehicle uses. A real road
 * deck is crowned so water sheds to the edges, and is bounded by a raised
 * kerb that the railing stands on. Both are generated *inward and below*
 * `ProfileSample.left`/`right`, which keep meaning the outer deck edge — so
 * `bridge-profile.ts` is untouched and `bridge-boundaries.ts` keeps placing
 * railings on exactly that line, which is where a kerb-mounted railing goes.
 */
const KERB_HEIGHT = 0.15; // meters of upstand above the carriageway
const KERB_WIDTH_FRACTION = 0.08; // of full deck width
const MAX_KERB_WIDTH = 0.45; // meters; a wide motorway deck still gets a kerb, not a verge
const CROSSFALL = 0.02; // 2%, the usual highway crown

/** An ordered, closed cross-section ring. Face k spans ring[k] -> ring[k+1]. */
type Ring = Vec3[];

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function raise(p: Vec3, dy: number): Vec3 {
  return [p[0], p[1] + dy, p[2]];
}

/** Four faces: the original plain box, kept for distant decks. */
function slabRing(s: ProfileSample, thickness: number): Ring {
  return [s.left, s.right, lower(s.right, thickness), lower(s.left, thickness)];
}

/** Seven faces: kerb tops, crowned carriageway, fascias and underside. */
function profiledRing(s: ProfileSample, thickness: number): Ring {
  const width = Math.hypot(s.left[0] - s.right[0], s.left[2] - s.right[2]);
  const kerbWidth = Math.min(MAX_KERB_WIDTH, width * KERB_WIDTH_FRACTION);
  const inset = width > 0 ? kerbWidth / width : 0;
  const carriagewayLeft = raise(lerp3(s.left, s.right, inset), -KERB_HEIGHT);
  const carriagewayRight = raise(lerp3(s.right, s.left, inset), -KERB_HEIGHT);
  // The crown rises back toward the kerb top by the crossfall over half the
  // width, so the carriageway sheds outward rather than sitting dead flat.
  const crown = raise(lerp3(s.left, s.right, 0.5), -KERB_HEIGHT + (width / 2) * CROSSFALL);
  return [
    s.left, // left kerb top == outer deck edge
    carriagewayLeft, // foot of the left kerb
    crown, // crowned centre of the carriageway
    carriagewayRight, // foot of the right kerb
    s.right, // right kerb top
    lower(s.right, thickness),
    lower(s.left, thickness),
  ];
}

/** Outward direction of face k: away from the ring's own centroid. */
function faceOutward(ring: Ring, k: number): Vec3 {
  const a = ring[k],
    b = ring[(k + 1) % ring.length];
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const p of ring) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  const n = ring.length;
  const d: Vec3 = [
    (a[0] + b[0]) / 2 - cx / n,
    (a[1] + b[1]) / 2 - cy / n,
    (a[2] + b[2]) / 2 - cz / n,
  ];
  return length(d) > 0 ? normalize(d) : [0, 1, 0];
}

/**
 * Level of detail for the deck cross-section. `"full"` is the profiled
 * carriageway; `"slab"` is the original four-face box, for decks far enough
 * away that a 15 cm kerb is well under a pixel. Chosen by the caller, which
 * knows the camera — this module stays pure geometry.
 */
export type DeckProfile = "full" | "slab";

export function buildBridgeMesh(
  surface: BridgeSurface,
  profile: DeckProfile = "full",
): BridgeMeshData {
  const builder = new MeshBuilder();
  const samples = surface.samples;
  if (samples.length < 2) return builder.toMeshData();

  const makeRing = profile === "full" ? profiledRing : slabRing;
  const rings = samples.map((s) => makeRing(s, surface.thickness));
  const faceCount = rings[0].length;
  const segmentCount = samples.length - 1;

  // Pass 1: the outward normal of each face on each segment. A curved deck's
  // faces turn segment to segment; a flat per-face normal is what makes that
  // read as a chain of plates rather than a curve.
  const segmentNormals: Vec3[][] = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = rings[i],
      b = rings[i + 1];
    const faces: Vec3[] = new Array(faceCount);
    for (let k = 0; k < faceCount; k++) {
      const k1 = (k + 1) % faceCount;
      faces[k] = orientedNormal(a[k], b[k], b[k1], faceOutward(a, k));
    }
    segmentNormals.push(faces);
  }

  // Pass 2: at each sample, a face's normal is the mean of the segments
  // meeting there, so shading runs continuously along the deck. Normals are
  // averaged only along the run, never across the section — every edge of the
  // cross-section (kerb, crown, fascia) stays a hard crease instead of
  // smearing the carriageway into the side of the deck.
  const sampleNormals: Vec3[][] = [];
  for (let i = 0; i < samples.length; i++) {
    const before = segmentNormals[Math.max(0, Math.min(i - 1, segmentCount - 1))];
    const after = segmentNormals[Math.max(0, Math.min(i, segmentCount - 1))];
    const faces: Vec3[] = new Array(faceCount);
    for (let f = 0; f < faceCount; f++) faces[f] = averageNormals(before[f], after[f]);
    sampleNormals.push(faces);
  }

  // Pass 3: loft. Outward is computed per face from the ring's own centroid
  // rather than assumed, so a locally reversed left/right (a hairpin) still
  // orients correctly instead of silently inverting.
  for (let i = 0; i < segmentCount; i++) {
    const a = rings[i],
      b = rings[i + 1];
    const n0 = sampleNormals[i],
      n1 = sampleNormals[i + 1];
    for (let k = 0; k < faceCount; k++) {
      const k1 = (k + 1) % faceCount;
      builder.quadShaded(a[k], b[k], b[k1], a[k1], n0[k], n1[k], n1[k], n0[k], faceOutward(a, k));
    }
  }

  // End caps, so an unreplaced ground tie-in never looks through an open box.
  const firstTangent = tangentAt(samples, 0);
  builder.fan(rings[0], [-firstTangent[0], -firstTangent[1], -firstTangent[2]]);
  builder.fan(rings[rings.length - 1], tangentAt(samples, samples.length - 1));

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
/**
 * Paint sits only millimetres proud of the carriageway. It has to: on a wide
 * deck the 2% crown rises almost exactly the kerb's own height (0.14 m over
 * a 7 m half-width, against a 0.15 m upstand), so a centre line lifted much
 * further would float above the kerb it is supposed to sit between.
 */
const MARKING_LIFT = 0.006;
const MARKING_WIDTH = 0.14; // painted line width
const EDGE_LINE_INSET = 0.1; // fraction of the carriageway in from each kerb foot
const DASH_PERIOD = 9; // meters of dash + gap
const DASH_ON = 4.5; // meters of paint within each period

/**
 * A point on the crowned carriageway at lateral fraction `u` (0 at the left
 * kerb foot, 1 at the right), lifted clear of the surface.
 *
 * Mirrors `profiledRing`'s section exactly: the carriageway runs from the
 * kerb foot up to the crown and back down, so height falls off linearly with
 * distance from the centre.
 */
function carriagewayPoint(s: ProfileSample, u: number): Vec3 {
  const width = Math.hypot(s.left[0] - s.right[0], s.left[2] - s.right[2]);
  const kerbWidth = Math.min(MAX_KERB_WIDTH, width * KERB_WIDTH_FRACTION);
  const inset = width > 0 ? kerbWidth / width : 0;
  const p = lerp3(s.left, s.right, inset + u * (1 - 2 * inset));
  const crownRise = (width / 2) * CROSSFALL * (1 - Math.abs(2 * u - 1));
  return [p[0], p[1] - KERB_HEIGHT + crownRise + MARKING_LIFT, p[2]];
}

/**
 * Painted lane markings on the carriageway: a dashed centreline and a solid
 * edge line inside each kerb.
 *
 * Geometry alone reads as a raised structure; the paint is what says *road*.
 * Emitted as its own buffer rather than as part of the deck because it needs
 * a different material colour, and because it is optional — `details-data.ts`
 * drops it under triangle pressure the same way it drops rails, before ever
 * touching the mandatory deck.
 */
export function buildMarkingMesh(surface: BridgeSurface): BridgeMeshData {
  const builder = new MeshBuilder();
  const samples = surface.samples;
  if (samples.length < 2) return builder.toMeshData();

  const up: Vec3 = [0, 1, 0];
  const halfWidthFraction = (s: ProfileSample): number => {
    const width = Math.hypot(s.left[0] - s.right[0], s.left[2] - s.right[2]);
    return width > 0 ? MARKING_WIDTH / 2 / width : 0;
  };

  for (let i = 0; i < samples.length - 1; i++) {
    const s0 = samples[i],
      s1 = samples[i + 1];
    const mid = (s0.distance + s1.distance) / 2;
    const centreIsPainted = mid % DASH_PERIOD < DASH_ON;
    const lines: number[] = [EDGE_LINE_INSET, 1 - EDGE_LINE_INSET];
    if (centreIsPainted) lines.push(0.5);

    for (const u of lines) {
      const h0 = halfWidthFraction(s0),
        h1 = halfWidthFraction(s1);
      builder.quad(
        carriagewayPoint(s0, u - h0),
        carriagewayPoint(s1, u - h1),
        carriagewayPoint(s1, u + h1),
        carriagewayPoint(s0, u + h0),
        up,
      );
    }
  }
  return builder.toMeshData();
}

export function buildRailMesh(edges: readonly [Vec3, Vec3][]): BridgeMeshData {
  const builder = new MeshBuilder();
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
    // One prism per rail course. A single bar at hand height reads as a
    // floating line; a parapet is recognisable because it has a handrail and
    // at least one rail below it, with the posts (bridgeAccessories) tying
    // them to the kerb.
    for (const { offset, thickness } of RAIL_COURSES) {
      const half = thickness / 2;
      const top = offset + half;
      const bottom = offset - half;
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
  }
  return builder.toMeshData();
}
