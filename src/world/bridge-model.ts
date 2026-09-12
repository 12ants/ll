/**
 * Shared bridge/road-graph model contracts (B1-B4). All coordinates are meters
 * in a fixed local origin per connected component; convert to the current
 * render origin only when publishing buffers.
 */
export type Vec3 = [number, number, number];

export interface RoadNode {
  id: string;
  position: Vec3;
  edgeIds: string[];
}

export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  points: Vec3[];
  width: number;
  layer: number;
  bridge: boolean;
}

export interface RoadGraph {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface ProfileSample {
  distance: number;
  center: Vec3; // Y is the finished roadway top, never deck center.
  left: Vec3;
  right: Vec3;
}

export interface BridgeSurface {
  id: string;
  samples: ProfileSample[];
  thickness: number;
  openings: { from: Vec3; to: Vec3 }[];
}

export type BridgeSolution =
  | { status: "ready"; surfaces: BridgeSurface[] }
  | { status: "incomplete" | "infeasible"; reason: string };

export interface BridgeMeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}
