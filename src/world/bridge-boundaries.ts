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
 * connected road.
 *
 * Piers use `ProfileSample.ground`, retained only for samples under the
 * deck's own span (B2 already measures ground there to size the deck's
 * clearance — see bridge-profile.ts's `solveOneBridge` — approach/ramp
 * samples are an interpolated smoothstep curve, not a measured height, so
 * `ground` stays `undefined` there and never grows a pier). Two constraints
 * from the plan's own text are **not** implemented, for the same reason:
 * "exclude piers from lower road/path footprints plus 0.5m clearance" and
 * "avoid blocking navigable-looking water channels" both need polygon/
 * water data this module has no access to (`BridgeSurface` carries none).
 * Named here rather than silently skipped.
 */

// Matches structures.ts's existing box-bridge rail geometry, so a published
// mesh bridge's rails read as the same physical object as an unpublished
// (fallback) box bridge's rails, not a visually distinct redesign.
export const RAIL_CENTER_OFFSET = 0.95; // meters above the finished roadway top
export const RAIL_THICKNESS = 0.14;
/**
 * The rail courses a parapet is built from, as (centre height, thickness)
 * above the deck edge. The handrail keeps the original offset and thickness
 * so existing callers and screenshots stay comparable; the lower course is
 * what makes the run read as a railing rather than a single floating bar,
 * and sits roughly halfway down to the kerb it stands on.
 */
export const RAIL_COURSES: readonly { offset: number; thickness: number }[] = [
  { offset: RAIL_CENTER_OFFSET, thickness: RAIL_THICKNESS },
  { offset: 0.52, thickness: 0.09 },
];
const POST_SIZE = 0.14;
const POST_HEIGHT = 0.75;
const POST_CENTER_OFFSET = 0.6; // top of the post overlaps the rail slightly, same as structures.ts's box bridge
export const ACCESSORY_COLOR = "#7c8179";
/** Lane paint. Warm off-white so it reads as paint under the scene's light
 * rather than as a glowing strip. */
export const MARKING_COLOR = "#d9d5c4";

// Pier constants match structures.ts's existing collectBridgeParts() pier
// policy exactly, so a published mesh bridge's piers read as the same
// physical object as an unpublished (fallback) box bridge's piers.
const PIER_MIN_SPAN = 12; // meters; below this, no piers at all
const PIER_MIN_HEIGHT = 0.5; // meters; "omit supports when height is negligible"
const PIER_RADIUS_MAJOR = 1.5;
const PIER_RADIUS_OTHER = 1.15;
export const PIER_COLOR = "#989c91";

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

function nearestByDistance(samples: readonly ProfileSample[], target: number): ProfileSample {
  let best = samples[0],
    bestDiff = Math.abs(samples[0].distance - target);
  for (const s of samples) {
    const diff = Math.abs(s.distance - target);
    if (diff < bestDiff) {
      best = s;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Round support columns under one surface's deck, spaced like
 * structures.ts's existing box-bridge piers (2-9 columns, roughly one per
 * 38m of span). Ground is only ever known at deck-only sample points (see
 * the file doc comment), so each pier snaps to its nearest such sample
 * rather than interpolating a ground value between them.
 */
function piersForSurface(surface: BridgeSurface): StructurePart[] {
  const deckSamples = surface.samples.filter((s) => s.ground !== undefined);
  if (deckSamples.length < 2) return [];
  const span = deckSamples[deckSamples.length - 1].distance - deckSamples[0].distance;
  if (span <= PIER_MIN_SPAN) return [];
  const pierCount = Math.max(2, Math.min(9, Math.round(span / 38) + 1));
  const major = surface.thickness > 0.9; // same two-tier approximation used in details-data.ts
  const radius = major ? PIER_RADIUS_MAJOR : PIER_RADIUS_OTHER;
  const parts: StructurePart[] = [];
  for (let i = 0; i < pierCount; i++) {
    const t = pierCount === 1 ? 0.5 : i / (pierCount - 1);
    const sample = nearestByDistance(deckSamples, deckSamples[0].distance + t * span);
    const ground = sample.ground;
    if (ground === undefined) continue; // omit supports when ground is unknown
    const pierHeight = sample.center[1] - ground;
    if (pierHeight < PIER_MIN_HEIGHT) continue; // omit supports when height is negligible
    parts.push({
      position: [sample.center[0], ground + pierHeight / 2, sample.center[2]],
      scale: [radius, pierHeight, radius],
      rotation: 0,
      color: PIER_COLOR,
      kind: "cylinder",
    });
  }
  return parts;
}

/**
 * Vertical support posts along `edges`, spaced at a stable arc-length
 * interval, plus round piers under each of `surfaces`'s own deck spans
 * (see `piersForSurface`). `cap` is a single combined instance budget for
 * both — checked before every insertion — dropping later accessories,
 * never any already-published deck, once the budget is spent.
 */
export function bridgeAccessories(
  edges: readonly [Vec3, Vec3][],
  surfaces: readonly BridgeSurface[],
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
  for (const surface of surfaces) {
    if (parts.length >= cap) break;
    for (const pier of piersForSurface(surface)) {
      if (parts.length >= cap) break;
      parts.push(pier);
    }
  }
  return parts;
}
