import { useLayoutEffect, useMemo, useRef } from "react";
import { type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { orientationQuat } from "@/lib/orientation";

interface InstanceVoxel {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

type Scale = number | [number, number, number];
type PointerHandler<T> = (event: ThreeEvent<PointerEvent>, voxel: T) => void;
const ZERO_CENTER: [number, number, number] = [0, 0, 0];

export function VoxelInstances<T extends InstanceVoxel>({
  voxels,
  geometry,
  material,
  capacity = Math.max(1, voxels.length),
  center = ZERO_CENTER,
  scale = 1,
  colors,
  layer = 0,
  castShadow = false,
  receiveShadow = false,
  interactive = false,
  onPointerDown,
  onPointerUp,
  onPointerMove,
}: {
  voxels: T[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  capacity?: number;
  center?: [number, number, number];
  scale?: Scale;
  colors?: Map<string, [number, number, number]>;
  layer?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  interactive?: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: PointerHandler<T>;
  onPointerMove?: PointerHandler<T>;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);
  const scaleVector = useMemo<[number, number, number]>(
    () => (typeof scale === "number" ? [scale, scale, scale] : scale),
    [scale],
  );

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.layers.set(layer);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let index = 0; index < voxels.length; index++) {
      const voxel = voxels[index];
      dummy.position.set(
        voxel.x - center[0],
        voxel.y - center[1],
        voxel.z - center[2],
      );
      dummy.quaternion.fromArray(orientationQuat(voxel.rotation));
      dummy.scale.set(scaleVector[0], scaleVector[1], scaleVector[2]);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      if (colors) {
        const value = colors.get(`${voxel.x},${voxel.y},${voxel.z}`);
        color.setRGB(value?.[0] ?? 1, value?.[1] ?? 1, value?.[2] ?? 1);
        mesh.setColorAt(index, color);
      }
    }
    mesh.count = voxels.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [center, colors, dummy, layer, scaleVector, voxels, color]);

  const voxelAt = (event: ThreeEvent<PointerEvent>): T | null => {
    const id = event.instanceId;
    return id === undefined ? null : voxels[id] ?? null;
  };

  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[geometry, material, capacity]}
      castShadow={castShadow}
      receiveShadow={receiveShadow}
      frustumCulled
      raycast={interactive ? undefined : () => null}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerUp={
        interactive && onPointerUp
          ? (event) => {
              const voxel = voxelAt(event);
              if (voxel) onPointerUp(event, voxel);
            }
          : undefined
      }
      onPointerMove={
        interactive && onPointerMove
          ? (event) => {
              const voxel = voxelAt(event);
              if (voxel) onPointerMove(event, voxel);
            }
          : undefined
      }
    />
  );
}
