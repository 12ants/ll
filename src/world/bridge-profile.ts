import type { ProfileSample, RoadEdge, RoadGraph, Vec3 } from "./bridge-model";
import type { BridgeSolution, BridgeSurface } from "./bridge-model";

/**
 * Solves one continuous road-top elevation profile per bridge edge in `graph`:
 * a flat elevated span plus a cubic-Hermite (smoothstep) transition down to
 * ground on each connected approach. Camera zoom and position never enter
 * this — heights come from `sampleGround` (local meters in, elevation out)
 * and the graph's own geometry.
 *
 * Scope, named explicitly per this worktree's documentation discipline (see
 * IDEAS_WORK_LOG.md): each bridge edge is solved independently using the
 * *single* degree-2 approach chain leading away from each of its endpoints.
 * A junction reached before the transition would otherwise finish is not an
 * automatic rejection — real intersections don't require the road to already
 * be at exact grade, just close to it (see `JUNCTION_HEIGHT_TOLERANCE`). This
 * is "junction as ground-anchor" per the plan, kept deliberately narrow: the
 * walk still stops at the first junction (it does not choose a "straightest"
 * branch and continue past it — that would not change which distance the fit
 * check compares against, since the constraint is against the *nearest*
 * junction regardless of what lies beyond it), and a junction still rejects
 * the component when the height gap at that point would be visibly wrong,
 * never "junction found, therefore accept." A coupled multi-branch solve
 * ("solve shared approach junctions together" in the plan's fuller sense) is
 * still not implemented. `RoadEdge` (from B1) carries no road class, only
 * `width`, so "major road" here is approximated from width (>= 12 m) rather
 * than class, matching road-model.ts's motorway/trunk/primary fallback of
 * 14 m against the 8 m default for other classes.
 */

const SAMPLE_SPACING = 5; // meters, per plan's "no greater than 5 m" bound
const MAJOR_WIDTH_THRESHOLD = 12; // meters; see file doc comment
const MIN_TRANSITION_LENGTH = 1e-6; // meters
/**
 * Maximum height gap tolerated between the transition curve and true ground
 * at a junction the approach stops at, before that junction rejects the
 * component. A side street can physically absorb a small grade change over
 * its own first few meters; it cannot absorb meeting a ramp mid-climb.
 */
export const JUNCTION_HEIGHT_TOLERANCE = 0.5; // meters

const STRUCTURAL_CLEARANCE_MAJOR = 1.0; // meters; layer <= 0 — spans a gap/water at near-grade
const STRUCTURAL_CLEARANCE_OTHER = 0.6;
const TAGGED_BRIDGE_CLEARANCE_MAJOR = 2.0; // meters; layer === 1 — the default, ambiguous OSM bridge tag
const TAGGED_BRIDGE_CLEARANCE_OTHER = 1.2;
const GRADE_SEPARATION_CLEARANCE_MAJOR = 4.5; // meters; layer >= 2 — genuine multi-level grade separation
const GRADE_SEPARATION_CLEARANCE_OTHER = 3.5;

/**
 * Recalibrated for B2's ramped model (option 2 of three candidates named in
 * IDEAS_WORK_LOG.md's prior B3 entry). `collectBridgeParts()`'s original
 * `(major ? 4 : 3) + min(layer, 2) * 1.5` was tuned for a floating box that
 * never had to connect to ground — it assumed every bridge needs full
 * vehicle/pedestrian clearance underneath, which is a reasonable cosmetic
 * minimum for a box nobody has to actually reach, but produces an
 * implausibly long ramp for the common case (a short span over a gap or
 * canal at near grade) once a real approach has to climb to it.
 *
 * `layer` is treated as what it actually signals, not scaled continuously:
 * layer 0/1 is the default OSM bridge tag and carries no reliable elevation
 * claim on its own; layer >= 2 is a much rarer, stronger signal of genuine
 * multi-level separation (a real flyover/overpass) and keeps roughly the
 * old clearance. Layer 1 — the overwhelming majority of tagged bridges — is
 * treated as a modest, non-highway span rather than assumed to need full
 * road clearance.
 *
 * Named tradeoff, not silently accepted: a layer-1-tagged bridge that is
 * *actually* a tall crossing now gets too little clearance under this
 * heuristic. Detecting that correctly would require knowing what specific
 * feature passes underneath a bridge's span, which needs the 2D-crossing
 * geometry `road-topology.ts`'s graph construction deliberately discards
 * (`layer` is relative ordering, not elevation — see
 * BRIDGE_CONNECTIVITY_PLAN.md's "a 2D crossing is not evidence of a
 * junction"). Building that detection is future work, not done here.
 *
 * Deliberately NOT applied to `collectBridgeParts()` in `structures.ts`: its
 * inline copy of the old formula still serves the currently-shipping
 * floating-box renderer, which genuinely needs a cosmetic gap since nothing
 * connects to it. The two were never a shared-policy invariant the way Z1's
 * `roadDimensions`/`roadColor` are — this recalibration only applies where a
 * real ramp has to reach the deck.
 */
function clearanceFor(major: boolean, layer: number): number {
  if (layer <= 0) return major ? STRUCTURAL_CLEARANCE_MAJOR : STRUCTURAL_CLEARANCE_OTHER;
  if (layer === 1) return major ? TAGGED_BRIDGE_CLEARANCE_MAJOR : TAGGED_BRIDGE_CLEARANCE_OTHER;
  return major ? GRADE_SEPARATION_CLEARANCE_MAJOR : GRADE_SEPARATION_CLEARANCE_OTHER;
}

function isMajorEdge(edge: RoadEdge): boolean {
  return edge.width >= MAJOR_WIDTH_THRESHOLD;
}

function dist2D(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

interface ChainPoint {
  point: Vec3;
  distance: number; // meters from the bridge node, increasing outward
  width: number;
}

type ChainEnd = "deadend" | "junction" | "maxDistance" | "otherBridge";

interface ChainWalk {
  points: ChainPoint[]; // includes the bridge node itself at distance 0
  totalLength: number;
  endedAt: ChainEnd;
  otherBridgeEdgeId?: string;
  /** Degree of the node the walk stopped at (deadend=1, junction>=3). Diagnostic only. */
  endNodeDegree?: number;
}

/**
 * Walks outward from `startNodeId` along the single chain of degree-2,
 * non-bridge edges (the plan's ordinary ground approach), stopping at a
 * dead end, a junction (degree != 2), another bridge edge, or `maxDistance`
 * — whichever comes first. Does not re-query the map; it only ever follows
 * edges already present in `graph`.
 */
function walkApproachChain(
  graph: RoadGraph,
  startNodeId: string,
  arrivedViaEdgeId: string,
  maxDistance: number,
): ChainWalk {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
  const startNode = nodeById.get(startNodeId)!;
  const points: ChainPoint[] = [{ point: startNode.position, distance: 0, width: 0 }];

  let currentNodeId = startNodeId;
  let cameFromEdgeId = arrivedViaEdgeId;
  let cumulative = 0;
  const visitedEdges = new Set<string>([arrivedViaEdgeId]);

  for (;;) {
    const node = nodeById.get(currentNodeId)!;
    const candidates = node.edgeIds.filter((id) => id !== cameFromEdgeId);
    if (node.edgeIds.length !== 2 || candidates.length !== 1) {
      return {
        points,
        totalLength: cumulative,
        endedAt: node.edgeIds.length <= 1 ? "deadend" : "junction",
        endNodeDegree: node.edgeIds.length,
      };
    }
    const nextEdgeId = candidates[0];
    if (visitedEdges.has(nextEdgeId)) {
      return { points, totalLength: cumulative, endedAt: "junction", endNodeDegree: node.edgeIds.length }; // cycle guard
    }
    const edge = edgeById.get(nextEdgeId)!;
    if (edge.bridge) {
      return { points, totalLength: cumulative, endedAt: "otherBridge", otherBridgeEdgeId: edge.id };
    }
    visitedEdges.add(nextEdgeId);
    const forward = edge.from === currentNodeId;
    const pts = forward ? edge.points : edge.points.slice().reverse();
    for (let i = 1; i < pts.length; i++) {
      const segLen = dist2D(pts[i - 1], pts[i]);
      if (segLen <= 0) continue;
      if (cumulative + segLen >= maxDistance) {
        const remaining = maxDistance - cumulative;
        const t = remaining / segLen;
        points.push({ point: lerpVec3(pts[i - 1], pts[i], t), distance: maxDistance, width: edge.width });
        return { points, totalLength: maxDistance, endedAt: "maxDistance" };
      }
      cumulative += segLen;
      points.push({ point: pts[i], distance: cumulative, width: edge.width });
    }
    currentNodeId = forward ? edge.to : edge.from;
    cameFromEdgeId = nextEdgeId;
  }
}

/** Interpolates the exact point at `targetDistance` from the chain's start (the bridge node). */
function pointAtDistance(chain: readonly ChainPoint[], targetDistance: number): Vec3 {
  if (targetDistance <= 0) return chain[0].point;
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].distance >= targetDistance) {
      const prev = chain[i - 1];
      const span = chain[i].distance - prev.distance;
      const t = span > 0 ? (targetDistance - prev.distance) / span : 0;
      return lerpVec3(prev.point, chain[i].point, t);
    }
  }
  return chain[chain.length - 1].point;
}

/** Width of the segment covering `targetDistance`; index 0 is the node itself (no width). */
function widthAtDistance(chain: readonly ChainPoint[], targetDistance: number): number {
  for (let i = 1; i < chain.length; i++) if (chain[i].distance >= targetDistance) return chain[i].width;
  return chain[chain.length - 1]?.width ?? 0;
}

interface TransitionSide {
  chain: ChainWalk;
  groundAtAnchor: number;
  transitionLength: number;
  rise: number;
}

/**
 * Resolves one side's transition: samples ground at the farthest point the
 * chain actually reaches (bounded by `maxApproach`), sizes the smoothstep
 * transition length from the plan's flat-to-flat formula
 * (`L = 1.5 * |rise| / maxGrade`), and reports whether it fits within the
 * chain's available length. `null` return means a required ground sample
 * came back `null` (missing DEM) — the caller reports "incomplete", not
 * ground zero.
 */
function resolveSide(
  graph: RoadGraph,
  nodeId: string,
  viaEdgeId: string,
  deckHeight: number,
  sampleGround: (point: Vec3) => number | null,
  options: { terrain: boolean; maxGrade: number; maxApproach: number },
): TransitionSide | null {
  const chain = walkApproachChain(graph, nodeId, viaEdgeId, options.maxApproach);
  const anchorPoint = chain.points[chain.points.length - 1].point;
  const groundAtAnchor = options.terrain ? sampleGround(anchorPoint) : 0;
  if (groundAtAnchor === null) return null;
  const rise = deckHeight - groundAtAnchor;
  const transitionLength =
    Math.abs(rise) < MIN_TRANSITION_LENGTH ? 0 : (1.5 * Math.abs(rise)) / options.maxGrade;
  return { chain, groundAtAnchor, transitionLength, rise };
}

/**
 * Height gap between the sized transition curve and true ground at the
 * distance the chain actually stopped (a junction, dead end, `maxApproach`
 * cap, or another bridge). Zero once the chain reaches at least as far as
 * `transitionLength` — the curve has already leveled out to ground by then,
 * which is today's behavior preserved as the `residual <= tolerance` case.
 */
function residualHeightGap(side: TransitionSide): number {
  if (side.transitionLength <= 0) return 0;
  const t = 1 - side.chain.totalLength / side.transitionLength;
  return Math.abs(side.rise * smoothstep(t));
}

/**
 * A junction is a ground-anchor, not an automatic rejection: it only rejects
 * the component when meeting it would leave a visible height gap. This is a
 * strict superset of "must reach ground exactly" — never "junction found,
 * therefore accept."
 */
function checkSideFits(
  label: "start" | "end",
  bridgeEdgeId: string,
  side: TransitionSide,
): { status: "infeasible"; reason: string } | null {
  const residual = residualHeightGap(side);
  if (residual <= JUNCTION_HEIGHT_TOLERANCE) return null;
  const cause =
    side.chain.endedAt === "junction"
      ? "reaches a junction with too large a height gap to meet it at grade"
      : "is too short for the required rise within maxGrade";
  return {
    status: "infeasible",
    reason:
      `bridge edge ${bridgeEdgeId}'s ${label} approach ${cause}: ` +
      `walked=${side.chain.totalLength.toFixed(1)}m required=${side.transitionLength.toFixed(1)}m ` +
      `residual=${residual.toFixed(2)}m endedAt=${side.chain.endedAt}` +
      `${side.chain.endNodeDegree !== undefined ? ` degree=${side.chain.endNodeDegree}` : ""}`,
  };
}

interface RawSample {
  distance: number;
  center: Vec3;
  width: number;
}

function buildSideSamples(
  side: TransitionSide,
  direction: "in" | "out",
  distanceOffset: number,
): RawSample[] {
  const { chain, groundAtAnchor, transitionLength, rise } = side;
  // A tolerated junction can stop the chain short of the full transition
  // length (see JUNCTION_HEIGHT_TOLERANCE) — never generate a sample past
  // where the chain actually has geometry, or points would clamp to the
  // same XZ position while height keeps changing with the unclamped `d`.
  const effectiveLength = Math.min(transitionLength, chain.totalLength);
  const stops = new Set<number>([0, effectiveLength]);
  for (const p of chain.points) if (p.distance <= effectiveLength) stops.add(p.distance);
  for (let d = SAMPLE_SPACING; d < effectiveLength; d += SAMPLE_SPACING) stops.add(d);
  const sortedByNodeDistance = Array.from(stops).sort((a, b) => a - b);

  const samples: RawSample[] = [];
  for (const d of sortedByNodeDistance) {
    const point = pointAtDistance(chain.points, d);
    const width = widthAtDistance(chain.points, d) || chain.points[0].width;
    const t = transitionLength > 0 ? 1 - d / transitionLength : 1;
    const height = groundAtAnchor + rise * smoothstep(t);
    // "in" runs from the far anchor toward the bridge node (increasing overall
    // distance); "out" runs from the bridge node toward its own far anchor.
    const overallDistance =
      direction === "in" ? distanceOffset + (transitionLength - d) : distanceOffset + d;
    samples.push({ distance: overallDistance, center: [point[0], height, point[2]], width });
  }
  samples.sort((a, b) => a.distance - b.distance);
  return samples;
}

/** Assigns left/right at half-width from center using a locally estimated tangent. */
function withOffsets(samples: readonly RawSample[]): ProfileSample[] {
  return samples.map((s, i) => {
    const prev = samples[Math.max(0, i - 1)].center;
    const next = samples[Math.min(samples.length - 1, i + 1)].center;
    const dx = next[0] - prev[0];
    const dz = next[2] - prev[2];
    const len = Math.hypot(dx, dz);
    const nx = len > 0 ? -dz / len : 0;
    const nz = len > 0 ? dx / len : 1;
    const half = s.width / 2;
    const left: Vec3 = [s.center[0] + nx * half, s.center[1], s.center[2] + nz * half];
    const right: Vec3 = [s.center[0] - nx * half, s.center[1], s.center[2] - nz * half];
    return { distance: s.distance, center: s.center, left, right };
  });
}

function solveOneBridge(
  graph: RoadGraph,
  bridgeEdge: RoadEdge,
  sampleGround: (point: Vec3) => number | null,
  options: { terrain: boolean; maxGrade: number; maxApproach: number },
): { surface: BridgeSurface; consumedBridgeEdgeIds: string[] } | { status: "incomplete" | "infeasible"; reason: string } {
  const major = isMajorEdge(bridgeEdge);
  const clearance = clearanceFor(major, bridgeEdge.layer);

  // Deck height: the highest ground sample along the span (at <= SAMPLE_SPACING
  // resolution), plus the class/layer clearance — a constant target height for
  // the whole span, matching the existing collectBridgeParts() policy.
  const bridgePts = bridgeEdge.points;
  const bridgeStops: { distance: number; point: Vec3 }[] = [{ distance: 0, point: bridgePts[0] }];
  for (let i = 1; i < bridgePts.length; i++) {
    const segLen = dist2D(bridgePts[i - 1], bridgePts[i]);
    const steps = Math.max(1, Math.ceil(segLen / SAMPLE_SPACING));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const point = lerpVec3(bridgePts[i - 1], bridgePts[i], t);
      const distance = bridgeStops[bridgeStops.length - 1].distance + dist2D(bridgeStops[bridgeStops.length - 1].point, point);
      bridgeStops.push({ distance, point });
    }
  }
  const bridgeLength = bridgeStops[bridgeStops.length - 1].distance;

  let maxGround = 0;
  for (const stop of bridgeStops) {
    const g = options.terrain ? sampleGround(stop.point) : 0;
    if (g === null)
      return { status: "incomplete", reason: `missing ground elevation data under bridge edge ${bridgeEdge.id}` };
    maxGround = Math.max(maxGround, g);
  }
  const deckHeight = maxGround + clearance;

  const startSide = resolveSide(graph, bridgeEdge.from, bridgeEdge.id, deckHeight, sampleGround, options);
  if (startSide === null)
    return {
      status: "incomplete",
      reason: `missing ground elevation data at bridge edge ${bridgeEdge.id}'s start approach`,
    };
  const endSide = resolveSide(graph, bridgeEdge.to, bridgeEdge.id, deckHeight, sampleGround, options);
  if (endSide === null)
    return {
      status: "incomplete",
      reason: `missing ground elevation data at bridge edge ${bridgeEdge.id}'s end approach`,
    };

  const startFailure = checkSideFits("start", bridgeEdge.id, startSide);
  if (startFailure) return startFailure;
  const endFailure = checkSideFits("end", bridgeEdge.id, endSide);
  if (endFailure) return endFailure;

  const inSamplesRaw = buildSideSamples(startSide, "in", 0);
  const inLength = startSide.transitionLength;

  const bridgeSamplesRaw: RawSample[] = bridgeStops.map((stop) => ({
    distance: inLength + stop.distance,
    center: [stop.point[0], deckHeight, stop.point[2]],
    width: bridgeEdge.width,
  }));

  const outSamplesRaw = buildSideSamples(endSide, "out", inLength + bridgeLength);

  const allRaw = [...inSamplesRaw, ...bridgeSamplesRaw, ...outSamplesRaw];
  // Deduplicate near-zero-length gaps introduced where a transition boundary
  // coincides with an original chain vertex.
  const deduped: RawSample[] = [];
  for (const s of allRaw) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(s.distance - last.distance) < 1e-6) continue;
    deduped.push(s);
  }
  const samples = withOffsets(deduped);

  const thickness = major ? 1.1 : 0.8;
  const surface: BridgeSurface = {
    id: `surface-${bridgeEdge.id}`,
    samples,
    thickness,
    openings: [],
  };
  const consumedBridgeEdgeIds = [bridgeEdge.id];
  if (startSide.chain.endedAt === "otherBridge" && startSide.chain.otherBridgeEdgeId)
    consumedBridgeEdgeIds.push(startSide.chain.otherBridgeEdgeId);
  if (endSide.chain.endedAt === "otherBridge" && endSide.chain.otherBridgeEdgeId)
    consumedBridgeEdgeIds.push(endSide.chain.otherBridgeEdgeId);
  return { surface, consumedBridgeEdgeIds };
}

export function solveBridge(
  graph: RoadGraph,
  sampleGround: (point: Vec3) => number | null,
  options: { terrain: boolean; maxGrade: number; maxApproach: number },
): BridgeSolution {
  const bridgeEdges = graph.edges.filter((e) => e.bridge);
  if (bridgeEdges.length === 0) return { status: "incomplete", reason: "no bridge edges in graph" };

  const processed = new Set<string>();
  const surfaces: BridgeSurface[] = [];
  for (const edge of bridgeEdges) {
    if (processed.has(edge.id)) continue;
    const result = solveOneBridge(graph, edge, sampleGround, options);
    if ("reason" in result) return { status: result.status, reason: result.reason };
    surfaces.push(result.surface);
    for (const id of result.consumedBridgeEdgeIds) processed.add(id);
  }
  return { status: "ready", surfaces };
}

/** Plan's own stated visual limits (not civil-engineering claims): 12% for
 * narrow paths, 8% for everything else, extending an approach up to 250 m. */
export const DEFAULT_MAX_APPROACH = 250; // meters
const PATH_WIDTH_THRESHOLD = 3.5; // meters; matches Z1's path/track class fallback
export function defaultMaxGradeForEdge(edge: RoadEdge): number {
  return edge.width <= PATH_WIDTH_THRESHOLD ? 0.12 : 0.08;
}

export interface BridgeSolveResult {
  surfaces: BridgeSurface[];
  rejected: { edgeId: string; status: "incomplete" | "infeasible"; reason: string }[];
}

/**
 * Solves every bridge component in `graph` independently. Unlike
 * `solveBridge()`, one failed component never suppresses the rest: measured
 * live-data diagnostics (IDEAS_WORK_LOG.md, 2026-09-12 B3 entries) found a
 * real view can hold dozens of bridge edges where the overwhelming majority
 * fail (missing approach topology, junctions too close), so a first-failure
 * short-circuit across the whole graph would publish nothing. `solveOneBridge`
 * only ever reads the given edge's own connected approach chain — never other
 * bridges elsewhere in the graph — so calling it directly per edge here needs
 * no graph reduction to isolate one component from another (the throwaway
 * diagnostic's `reducedGraphFor` was only needed to work around
 * `solveBridge`'s own short-circuit loop, not a real dependency).
 */
export function solveBridges(
  graph: RoadGraph,
  sampleGround: (point: Vec3) => number | null,
  options: {
    terrain: boolean;
    maxGrade: number | ((edge: RoadEdge) => number);
    maxApproach: number;
  },
): BridgeSolveResult {
  const bridgeEdges = graph.edges.filter((e) => e.bridge);
  const processed = new Set<string>();
  const surfaces: BridgeSurface[] = [];
  const rejected: BridgeSolveResult["rejected"] = [];
  for (const edge of bridgeEdges) {
    if (processed.has(edge.id)) continue;
    const maxGrade =
      typeof options.maxGrade === "function" ? options.maxGrade(edge) : options.maxGrade;
    const result = solveOneBridge(graph, edge, sampleGround, {
      terrain: options.terrain,
      maxGrade,
      maxApproach: options.maxApproach,
    });
    if ("reason" in result) {
      rejected.push({ edgeId: edge.id, status: result.status, reason: result.reason });
      processed.add(edge.id);
      continue;
    }
    surfaces.push(result.surface);
    for (const id of result.consumedBridgeEdgeIds) processed.add(id);
  }
  return { surfaces, rejected };
}
