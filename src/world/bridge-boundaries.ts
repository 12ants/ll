import type { BridgeSurface, ProfileSample, Vec3 } from "./bridge-model";
import type { StructurePart } from "./structures";

/**
 * B4: derives railing boundaries and support posts for published B3 bridge
 * surfaces (see bridge-mesh.ts for the deck itself). Every distance/height
 * value here comes straight from `BridgeSurface.samples`, already solved by
 * B2 (bridge-profile.ts) — no zoom, camera or terrain query happens in this
 * module.
 *
 * Scope, named explicitly (see IDEAS_WORK_LOG.md): B2 never publishes a
 * mid-span branch junction — a junction encountered before an approach's
 * transition completes rejects the whole component (see
 * bridge-profile.ts's own doc comment) — so `BridgeSurface.openings` is
 * always `[]` and is not consulted here. Every published surface has
 * exactly two openings: its two tie-in anchors, where the ramp meets a real
 * connected road. Piers are not built here: they need ground height sampled
 * *under* the deck at each support location, which today's `BridgeSurface`
 * does not retain (B2 keeps only the finished road-top height, not the raw
 * ground it measured while solving) and `bridgeAccessories`'s own signature
 * has no sampleGround callback to add one live. Flagged for a future,
 * narrow follow-up (retain ground height per sample in B2's solve), not
 * attempted here.
 */

// Matches structures.ts's existing box-bridge rail geometry, so a published
// mesh bridge's rails read as the same physical object as an unpublished
// (fallback) box bridge's rails, not a visually distinct redesign.
export const RAIL_CENTER_OFFSET = 0.95; // meters above the finished roadway top
export const RAIL_THICKNESS = 0.14;
const POST_SIZE = 0.14;
const POST_HEIGHT = 0.75;
const POST_CENTER_OFFSET = 0.6; // top of the post overlaps the rail slightly, same as structures.ts's box bridge
export const ACCESSORY_COLOR = "#7c8179";

/** Plan's own "8 m arc-length intervals," carried through bends and tile
 * joins by walking edge segments in emitted order rather than restarting
 * phase at every segment. */
const POST_SPACING = 8; // meters

const EPSILON = 1e-6;

function sampleWidth(s: ProfileSample): number {
  return Math.hypot(s.left[0] - s.right[0], s.left[2] - s.right[2]);
}

/**
 * The boundary-side chain (all `left` or all `right` sample points, in
 * order), clipped so neither end extends into the opening where this
 * surface ties into a real connected road — "never add a cross-road end
 * cap as a railing." The opening's half-width is read directly from that
 * end's own anchor sample width, because B2 already sizes it from the real
 * connected road it walked to meet (see bridge-profile.ts's
 * `widthAtDistance`), so there is no separate connected-road width to look
 * up. Clipping snaps to the nearest sample rather than interpolating an
 * exact cut point — sample spacing is <= 5 m (`SAMPLE_SPACING` in
 * bridge-profile.ts), a documented approximation adequate at railing scale.
 */
function clippedChain(samples: readonly ProfileSample[], side: "left" | "right"): Vec3[] {
  const shoulderAllowance = 0.5; // meters; matches road-model.ts's SHOULDER_WIDTH
  const startOpen = sampleWidth(samples[0]) / 2 + shoulderAllowance;
  const endOpen = sampleWidth(samples[samples.length - 1]) / 2 + shoulderAllowance;
  const startAt = samples[0].distance + startOpen;
  const endAt = samples[samples.length - 1].distance - endOpen;
  if (startAt >= endAt) return []; // the two openings consume the whole span
  return samples
    .filter((s) => s.distance >= startAt && s.distance <= endAt)
    .map((s) => (side === "left" ? s.left : s.right));
}

/**
 * Every railing-eligible boundary segment across `surfaces`: each surface's
 * left- then right-side chain, opening regions already clipped off. Emitted
 * in a stable order (surface by surface, left then right, each chain
 * front-to-back) so `bridgeAccessories` can detect a contiguous run by
 * point-adjacency between consecutive entries, without a separate
 * chain-grouping structure.
 */
export function exposedBridgeEdges(surfaces: readonly BridgeSurface[]): [Vec3, Vec3][] {
  const edges: [Vec3, Vec3][] = [];
  for (const surface of surfaces) {
    if (surface.samples.length < 2) continue;
    for (const side of ["left", "right"] as const) {
      const chain = clippedChain(surface.samples, side);
      for (let i = 0; i < chain.length - 1; i++) edges.push([chain[i], chain[i + 1]]);
    }
  }
  return edges;
}

function sameVec3(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < EPSILON;
}

/**
 * Vertical support posts along `edges`, spaced at a stable arc-length
 * interval. `surfaces` is accepted per the plan's interface for future pier
 * placement (see the file doc comment) but posts alone don't need it.
 * `cap` is checked before every insertion — dropping later posts, never any
 * already-published deck, once the budget is spent.
 */
export function bridgeAccessories(
  edges: readonly [Vec3, Vec3][],
  _surfaces: readonly BridgeSurface[],
  cap: number,
): StructurePart[] {
  const parts: StructurePart[] = [];
  let phase = 0; // meters walked since the last placed post, carried across one contiguous chain
  let prevEnd: Vec3 | null = null;
  for (const [a, b] of edges) {
    if (parts.length >= cap) break;
    if (!prevEnd || !sameVec3(prevEnd, a)) phase = 0; // a new chain starts fresh, never mid-phase
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const segLen = Math.hypot(dx, dy, dz);
    if (segLen < EPSILON) {
      prevEnd = b;
      continue;
    }
    const rotation = -Math.atan2(dz, dx);
    let d = POST_SPACING - phase;
    while (d <= segLen && parts.length < cap) {
      const t = d / segLen;
      parts.push({
        position: [a[0] + dx * t, a[1] + dy * t + POST_CENTER_OFFSET, a[2] + dz * t],
        scale: [POST_SIZE, POST_HEIGHT, POST_SIZE],
        rotation,
        color: ACCESSORY_COLOR,
        kind: "box",
      });
      d += POST_SPACING;
    }
    phase = segLen - (d - POST_SPACING);
    prevEnd = b;
  }
  return parts;
}
