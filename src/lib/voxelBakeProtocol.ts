import type { BlockInfo } from "@/lib/api";

export interface BakeVoxel {
  x: number;
  y: number;
  z: number;
  name: string;
  rotation: number;
}

export interface BakeGroup {
  key: string;
  blocks: Array<Pick<BakeVoxel, "x" | "y" | "z" | "rotation">>;
  center: [number, number, number];
  cullSelf: boolean;
}

export interface SerializedGeometry {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  color: Float32Array;
  index: Uint32Array;
  groups: Array<{ start: number; count: number; materialIndex: number }>;
}

export interface VoxelBakeRequest {
  job: number;
  voxels: BakeVoxel[];
  catalog: Array<[string, BlockInfo]>;
  groups: BakeGroup[];
}

export interface VoxelBakeResponse {
  job: number;
  colors: Array<[string, [number, number, number]]>;
  geometries: Array<[string, SerializedGeometry]>;
  durationMs: number;
}
