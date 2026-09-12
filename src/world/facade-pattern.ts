import { PALETTES, type WorldConfig } from "./config";
import { hashString } from "./geography";

export interface FacadePattern {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIZE = 64;
const PANEL = 16;
const JOINT = 2;
const TRIM_PERIOD = 2;

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function scale(rgb: Rgb, factor: number): Rgb {
  return [clamp255(rgb[0] * factor), clamp255(rgb[1] * factor), clamp255(rgb[2] * factor)];
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    clamp255(a[0] + (b[0] - a[0]) * t),
    clamp255(a[1] + (b[1] - a[1]) * t),
    clamp255(a[2] + (b[2] - a[2]) * t),
  ];
}

/**
 * Deterministic repeating panel/joint texture used as universal base facade
 * coverage (every extruded wall, not just the optional modeled windows).
 * Alternate horizontal courses offset by half a panel for a staggered,
 * masonry-like joint pattern that also tiles seamlessly.
 */
export function createFacadePattern(
  palette: WorldConfig["palette"],
  night: boolean,
): FacadePattern {
  const colors = PALETTES[palette].colors;
  const base = hexToRgb(colors[0]);
  const accent = hexToRgb(colors[2 % colors.length]);
  const dim = night ? 0.55 : 1;
  const panelColor = scale(mix(base, accent, 0.35), dim);
  const jointColor = scale(panelColor, night ? 0.6 : 0.72);
  const trimColor = scale(mix(panelColor, [255, 255, 255], 0.22), night ? 0.75 : 1);

  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const course = Math.floor(y / PANEL);
    const stagger = course % 2 === 1 ? PANEL / 2 : 0;
    const withinPanelY = y % PANEL;
    for (let x = 0; x < SIZE; x++) {
      const sx = (x + stagger) % SIZE;
      const withinPanelX = sx % PANEL;
      const columnIndex = Math.floor(sx / PANEL);
      const onJoint = withinPanelX < JOINT || withinPanelY < JOINT;
      const onTrim =
        !onJoint && columnIndex % TRIM_PERIOD === 0 && withinPanelX < JOINT + 1;
      const [pr, pg, pb] = onJoint ? jointColor : onTrim ? trimColor : panelColor;
      // Small deterministic per-panel variance so repeated panels don't look flat.
      const jitter = (hashString(`${palette}:${night}:${course}:${columnIndex}`) % 13) - 6;
      const i = (y * SIZE + x) * 4;
      data[i] = clamp255(pr + jitter);
      data[i + 1] = clamp255(pg + jitter);
      data[i + 2] = clamp255(pb + jitter);
      data[i + 3] = 255;
    }
  }
  return { width: SIZE, height: SIZE, data };
}

/** Fixed image ID used for both `map.addImage()` registration and paint-property selection. */
export function facadeImageId(palette: WorldConfig["palette"], night: boolean): string {
  return `facade-${palette}-${night ? "night" : "day"}`;
}
