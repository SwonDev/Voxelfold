import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { BlockInfo } from "@/lib/api";
import { parseBlockName } from "@/lib/resolveBlock";
import type {
  BakeGroup,
  BakeVoxel,
  SerializedGeometry,
  VoxelBakeRequest,
  VoxelBakeResponse,
} from "@/lib/voxelBakeProtocol";

export interface VoxelRenderBake {
  snapshot: BakeVoxel[];
  colors: Map<string, [number, number, number]>;
  geometries: Map<string, THREE.BufferGeometry>;
  durationMs: number;
}

function hydrateGeometry(source: SerializedGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(source.position, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(source.normal, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(source.uv, 2));
  geometry.setAttribute("color", new THREE.BufferAttribute(source.color, 3));
  geometry.setIndex(new THREE.BufferAttribute(source.index, 1));
  for (const group of source.groups) {
    geometry.addGroup(group.start, group.count, group.materialIndex);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function disposeGeometries(geometries: Map<string, THREE.BufferGeometry>): void {
  for (const geometry of geometries.values()) geometry.dispose();
}

function relevantCatalog(
  voxels: BakeVoxel[],
  catalog: Map<string, BlockInfo>,
): Array<[string, BlockInfo]> {
  const names = new Set<string>();
  for (const voxel of voxels) {
    names.add(voxel.name);
    names.add(parseBlockName(voxel.name).base);
  }
  const entries: Array<[string, BlockInfo]> = [];
  for (const name of names) {
    const block = catalog.get(name);
    if (block) entries.push([name, block]);
  }
  return entries;
}

/**
 * Hornea la luz voxelizada y las mallas fusionadas fuera del hilo de la interfaz.
 * Mientras trabaja, el editor conserva el último resultado terminado. Solo hay un trabajo
 * activo y un pendiente reemplazable, por lo que una pincelada rápida nunca acumula una cola de
 * horneados obsoletos. Todos los buffers GPU anteriores se liberan al reemplazarse.
 */
export function useVoxelRenderBake(
  snapshot: BakeVoxel[],
  catalog: Map<string, BlockInfo>,
  groups: BakeGroup[],
): VoxelRenderBake | null {
  const [result, setResult] = useState<VoxelRenderBake | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const latestRef = useRef<{ job: number; snapshot: BakeVoxel[] }>({ job: 0, snapshot });
  const ownedRef = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const activeJobRef = useRef<number | null>(null);
  const pendingRef = useRef<VoxelBakeRequest | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/voxelRender.worker.ts", import.meta.url), {
      type: "module",
      name: "voxelfold-voxel-bake",
    });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<VoxelBakeResponse>) => {
      const response = event.data;
      const latest = latestRef.current;
      if (response.job === latest.job) {
        const geometries = new Map(
          response.geometries.map(([key, geometry]) => [key, hydrateGeometry(geometry)]),
        );
        disposeGeometries(ownedRef.current);
        ownedRef.current = geometries;
        setResult({
          snapshot: latest.snapshot,
          colors: new Map(response.colors),
          geometries,
          durationMs: response.durationMs,
        });
      }

      activeJobRef.current = null;
      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        activeJobRef.current = pending.job;
        worker.postMessage(pending);
      }
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
      activeJobRef.current = null;
      pendingRef.current = null;
      disposeGeometries(ownedRef.current);
      ownedRef.current = new Map();
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const job = latestRef.current.job + 1;
    latestRef.current = { job, snapshot };
    const request: VoxelBakeRequest = {
      job,
      voxels: snapshot,
      catalog: relevantCatalog(snapshot, catalog),
      groups,
    };
    if (activeJobRef.current === null) {
      activeJobRef.current = job;
      worker.postMessage(request);
    } else {
      // Solo importa el snapshot más reciente; cualquier pendiente anterior aún no empezó.
      pendingRef.current = request;
    }
  }, [catalog, groups, snapshot]);

  return result;
}
