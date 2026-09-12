import { PALETTES, type WorldConfig } from "./config";

/**
 * Physical road dimensions, resolved once from normalized feature properties.
 * Camera zoom changes projection only — it never generates new widths, colors
 * or structural heights, so neither function here accepts zoom or a camera
 * position.
 */
export interface RoadDimensions {
  width: number;
  deckThickness: number;
  markingWidth: number;
  shoulderWidth: number;
}

const PATH_CLASSES = new Set(["path", "track"]);
/** Shared with style.ts so the flat-map centerline filter never re-lists these classes. */
export const MAJOR_ROAD_CLASSES = ["motorway", "trunk", "primary"] as const;
const MAJOR_CLASSES = new Set<string>(MAJOR_ROAD_CLASSES);

const MIN_WIDTH = 1;
const MAX_WIDTH = 40;
const LANE_WIDTH = 3.25;
const MARKING_WIDTH = 0.15;
const SHOULDER_WIDTH = 0.5;

/**
 * Extra clearance kept beyond the carriageway edge before scattering
 * vegetation, in meters. Distinct from the exclusion radius (half the full
 * carriageway width plus this setback) that callers derive from it.
 */
export const VEGETATION_SETBACK = 2;

export const MAJOR_SURFACE_COLOR = "#8f897c";
export const PATH_SURFACE_COLOR = "#c7b796";
export const PEDESTRIAN_SURFACE_COLOR = "#d6cfba";

function classString(cls: unknown): string {
  return typeof cls === "string" ? cls : "";
}

/** Shared class-group predicate so callers never re-list the class literals themselves. */
export function isMajorRoadClass(cls: unknown): boolean {
  return MAJOR_CLASSES.has(classString(cls));
}

function classWidth(cls: unknown): number {
  const c = classString(cls);
  if (PATH_CLASSES.has(c)) return 3;
  if (MAJOR_CLASSES.has(c)) return 14;
  return 8;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Parses a finite metric width in meters; rejects unknown units and out-of-range values. */
function parseMetricWidth(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    const match = /^(-?\d+(?:\.\d+)?)\s*(m)?$/.exec(value.trim());
    if (!match) return null;
    n = Number(match[1]);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < MIN_WIDTH || n > MAX_WIDTH) return null;
  return n;
}

/** Positive integer lanes only; the derived width is clamped, not rejected. */
function parseLaneWidth(value: unknown): number | null {
  const lanes = Number(value);
  if (!Number.isInteger(lanes) || lanes <= 0) return null;
  return clamp(lanes * LANE_WIDTH, MIN_WIDTH, MAX_WIDTH);
}

export function roadDimensions(
  properties: Record<string, unknown>,
): RoadDimensions {
  const cls = properties.class;
  const width =
    parseMetricWidth(properties.width) ??
    parseLaneWidth(properties.lanes) ??
    classWidth(cls);
  const isPath = PATH_CLASSES.has(classString(cls));
  const isMajor = MAJOR_CLASSES.has(classString(cls));
  return {
    width,
    deckThickness: isPath ? 0.5 : isMajor ? 1.1 : 0.8,
    markingWidth: MARKING_WIDTH,
    shoulderWidth: isPath ? 0 : SHOULDER_WIDTH,
  };
}

/** Same surface-color policy for both the 2D road layer and 3D bridge decks. */
export function roadColor(
  properties: Record<string, unknown>,
  palette: WorldConfig["palette"],
): string {
  const cls = classString(properties.class);
  if (cls === "motorway" || cls === "trunk") return MAJOR_SURFACE_COLOR;
  if (PATH_CLASSES.has(cls)) return PATH_SURFACE_COLOR;
  if (cls === "pedestrian" || cls === "living_street")
    return PEDESTRIAN_SURFACE_COLOR;
  return PALETTES[palette].road;
}
