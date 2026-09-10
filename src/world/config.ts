import { create } from "zustand";

export const PALETTES = {
  limestone: {
    name: "Warm limestone",
    colors: ["#d1c6b0", "#beb7a7", "#d9cfbd", "#b6b9b0", "#c5baa9"],
    ground: "#d8d3c3",
    road: "#b8b5a8",
    park: "#96ad7d",
  },
  earth: {
    name: "Earth & brick",
    colors: ["#b99a85", "#c5ad96", "#ab8e7c", "#c0b39d", "#b4a68e"],
    ground: "#d2c7b3",
    road: "#aaa69b",
    park: "#8fa273",
  },
  mineral: {
    name: "Cool mineral",
    colors: ["#bdc5c1", "#acb9b7", "#cdd0c8", "#a1afac", "#d2d3c9"],
    ground: "#d5d8cf",
    road: "#abb4af",
    park: "#8ca591",
  },
} as const;
export const PLACES = [
  {
    id: "manhattan",
    name: "Central Park",
    region: "New York, United States",
    type: "Urban landscape",
    longitude: -73.9768,
    latitude: 40.7685,
    zoom: 15.4,
    bearing: -28,
    pitch: 61,
    terrain: false,
    icon: "city",
  },
  {
    id: "alpine",
    name: "Chamonix",
    region: "French Alps, France",
    type: "Alpine valley",
    longitude: 6.869,
    latitude: 45.921,
    zoom: 12.8,
    bearing: 140,
    pitch: 70,
    terrain: true,
    icon: "mountain",
  },
  {
    id: "coast",
    name: "San Francisco",
    region: "California, United States",
    type: "Coastal city",
    longitude: -122.4784,
    latitude: 37.8078,
    zoom: 13.8,
    bearing: -25,
    pitch: 64,
    terrain: true,
    icon: "coast",
  },
  {
    id: "canals",
    name: "Amsterdam",
    region: "North Holland, Netherlands",
    type: "Canal district",
    longitude: 4.884,
    latitude: 52.369,
    zoom: 16,
    bearing: 25,
    pitch: 58,
    terrain: false,
    icon: "water",
  },
] as const;
export interface WorldConfig {
  version: 1;
  place: string;
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
  buildings: boolean;
  facades: boolean;
  heightScale: number;
  variation: number;
  palette: keyof typeof PALETTES;
  parks: boolean;
  trees: boolean;
  treeDensity: number;
  roads: boolean;
  bridges: boolean;
  amenities: boolean;
  terrain: boolean;
  exaggeration: number;
  waterColor: string;
  hour: number;
  quality: "eco" | "balanced" | "high";
  seed: number;
}
export const DEFAULT_CONFIG: WorldConfig = {
  version: 1,
  place: "manhattan",
  longitude: PLACES[0].longitude,
  latitude: PLACES[0].latitude,
  zoom: PLACES[0].zoom,
  pitch: PLACES[0].pitch,
  bearing: PLACES[0].bearing,
  buildings: true,
  facades: true,
  heightScale: 1,
  variation: 0.28,
  palette: "limestone",
  parks: true,
  trees: true,
  treeDensity: 0.65,
  roads: true,
  bridges: true,
  amenities: true,
  terrain: false,
  exaggeration: 1.2,
  waterColor: "#86a9a5",
  hour: 16,
  quality: "balanced",
  seed: 42,
};
export const QUALITY = {
  eco: { dpr: 1, trees: 500, radius: 850, cache: 80 },
  balanced: { dpr: 1.5, trees: 1800, radius: 1250, cache: 140 },
  high: { dpr: 2, trees: 3600, radius: 1800, cache: 220 },
} as const;
export function parseConfig(raw: string): WorldConfig {
  const v = JSON.parse(raw);
  if (!v || typeof v !== "object" || v.version !== 1)
    throw new Error("This is not a Terrene world file (version 1).");
  const result = {} as WorldConfig;
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof WorldConfig)[]) {
    if (typeof v[key] !== typeof DEFAULT_CONFIG[key])
      throw new Error(`Invalid or missing ${key}.`);
    Object.assign(result, { [key]: v[key] });
  }
  const ranges = {
    longitude: [-180, 180],
    latitude: [-85, 85],
    zoom: [2, 19],
    pitch: [0, 75],
    bearing: [-360, 360],
    heightScale: [0.2, 2.5],
    variation: [0, 1],
    treeDensity: [0, 1],
    exaggeration: [0, 3],
    hour: [6, 20],
    seed: [0, 999999],
  };
  for (const [key, [min, max]] of Object.entries(ranges))
    if (!Number.isFinite(v[key]) || v[key] < min || v[key] > max)
      throw new Error(`${key} must be between ${min} and ${max}.`);
  if (
    !Object.hasOwn(PALETTES, v.palette) ||
    !Object.hasOwn(QUALITY, v.quality) ||
    !/^#[0-9a-f]{6}$/i.test(v.waterColor) ||
    v.place.length > 100
  )
    throw new Error("Invalid material, quality, color or place.");
  return result;
}
const STORAGE_KEY = "terrene.world.v1";
function restore() {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseConfig(raw) : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}
interface WorldStore {
  config: WorldConfig;
  update: (patch: Partial<WorldConfig>) => void;
  replace: (config: WorldConfig) => void;
  save: () => void;
}
export const useWorld = create<WorldStore>((set, get) => ({
  config: restore(),
  update: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  replace: (config) => set({ config }),
  save: () => localStorage.setItem(STORAGE_KEY, JSON.stringify(get().config)),
}));
