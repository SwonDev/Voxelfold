/// <reference lib="webworker" />

import * as THREE from "three";
import { buildSmoothCubeGeometry } from "@/lib/smoothCubeGeometry";
import { computeBlockLight } from "@/lib/voxelLight";
import { orientationQuat } from "@/lib/orientation";
import type {
  SerializedGeometry,
  VoxelBakeRequest,
  VoxelBakeResponse,
} from "@/lib/voxelBakeProtocol";

function copyAttribute(geometry: THREE.BufferGeometry, name: string): Float32Array {
  const attribute = geometry.getAttribute(name);
  if (!attribute) return new Float32Array();
  return new Float32Array(attribute.array as ArrayLike<number>);
}

function serializeGeometry(geometry: THREE.BufferGeometry): SerializedGeometry {
  const sourceIndex = geometry.getIndex()?.array;
  return {
    position: copyAttribute(geometry, "position"),
    normal: copyAttribute(geometry, "normal"),
    uv: copyAttribute(geometry, "uv"),
    color: copyAttribute(geometry, "color"),
    index: sourceIndex ? new Uint32Array(sourceIndex as ArrayLike<number>) : new Uint32Array(),
    groups: geometry.groups.map(({ start, count, materialIndex = 0 }) => ({
      start,
      count,
      materialIndex,
    })),
  };
}

self.onmessage = (event: MessageEvent<VoxelBakeRequest>) => {
  const started = performance.now();
  const { job, voxels, catalog: catalogEntries, groups } = event.data;
  const catalog = new Map(catalogEntries);
  const light = computeBlockLight(voxels, catalog);
  const geometries: VoxelBakeResponse["geometries"] = [];
  const transfers: Transferable[] = [];

  for (const group of groups) {
    const geometry = buildSmoothCubeGeometry(
      group.blocks,
      group.center,
      light,
      orientationQuat,
      group.cullSelf,
    );
    const serialized = serializeGeometry(geometry);
    geometry.dispose();
    geometries.push([group.key, serialized]);
    transfers.push(
      serialized.position.buffer as ArrayBuffer,
      serialized.normal.buffer as ArrayBuffer,
      serialized.uv.buffer as ArrayBuffer,
      serialized.color.buffer as ArrayBuffer,
      serialized.index.buffer as ArrayBuffer,
    );
  }

  const response: VoxelBakeResponse = {
    job,
    colors: [...light.block],
    geometries,
    durationMs: performance.now() - started,
  };
  self.postMessage(response, { transfer: transfers });
};

export {};
