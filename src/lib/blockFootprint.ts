import type { BlockInfo, StoredVoxel } from "@/lib/api";
import { rotationMatrix } from "@/lib/hytaleRotation";
import { parseBlockName } from "@/lib/resolveBlock";

export interface FootprintCell {
  x: number;
  y: number;
  z: number;
}

export interface OccupiedVoxelCell extends FootprintCell {
  voxel: StoredVoxel;
  /** La celda contiene el ancla real del prefab; las demás son filler reservados por Hytale. */
  base: boolean;
}

const EPSILON = 1e-5;

function infoForVoxel(voxel: Pick<StoredVoxel, "name">, catalog: Map<string, BlockInfo>) {
  const { base, state } = parseBlockName(voxel.name);
  const block = catalog.get(voxel.name) ?? catalog.get(base);
  if (!block || !state) return block;
  const stateInfo = block.states.find((candidate) => candidate.state === state);
  return stateInfo?.hitbox ? { hitbox: stateInfo.hitbox } : block;
}

/** Huella efectiva de un nombre técnico, incluido su estado oficial y su hitbox propio. */
export function footprintCellsForName(
  name: string,
  catalog: Map<string, BlockInfo>,
  rotation = 0,
): FootprintCell[] {
  return footprintCells(infoForVoxel({ name }, catalog), rotation);
}

/**
 * Huella de celdas relativa al ancla, réplica de `FillerBlockUtil.forEachFillerBlock`.
 * El hitbox se gira alrededor del centro de la celda con la matriz oficial Ry·Rx·Rz;
 * después se recorre el bounding box entero que el servidor marca como filler.
 */
export function footprintCells(
  block: Pick<BlockInfo, "hitbox"> | undefined,
  rotation = 0,
): FootprintCell[] {
  const hitbox = block?.hitbox;
  if (!hitbox) return [{ x: 0, y: 0, z: 0 }];

  const matrix = rotationMatrix(rotation);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const x of [hitbox.min[0], hitbox.max[0]]) {
    for (const y of [hitbox.min[1], hitbox.max[1]]) {
      for (const z of [hitbox.min[2], hitbox.max[2]]) {
        const source = [x - 0.5, y - 0.5, z - 0.5];
        const point = [0, 1, 2].map(
          (axis) =>
            matrix[axis][0] * source[0] +
            matrix[axis][1] * source[1] +
            matrix[axis][2] * source[2] +
            0.5,
        );
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], point[axis]);
          max[axis] = Math.max(max[axis], point[axis]);
        }
      }
    }
  }

  // El Java oficial trunca y corrige si queda fracción: equivale a floor/ceil. El
  // epsilon evita reservar una celda extra por ruido flotante en cuartos de vuelta.
  const lo = min.map((value) => Math.floor(value + EPSILON));
  const hi = max.map((value) => Math.ceil(value - EPSILON));
  const width = Math.max(hi[0] - lo[0], 1);
  const height = Math.max(hi[1] - lo[1], 1);
  const depth = Math.max(hi[2] - lo[2], 1);
  const cells: FootprintCell[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      for (let z = 0; z < depth; z++) {
        cells.push({ x: lo[0] + x, y: lo[1] + y, z: lo[2] + z });
      }
    }
  }
  return cells;
}

export function isMultiCell(block: BlockInfo | undefined, rotation = 0): boolean {
  const cells = footprintCells(block, rotation);
  return cells.length > 1 || cells[0].x !== 0 || cells[0].y !== 0 || cells[0].z !== 0;
}

/** Expande cada ancla del prefab a las celdas físicas que Hytale reserva en el mundo. */
export function occupiedVoxelCells(
  voxels: StoredVoxel[],
  catalog: Map<string, BlockInfo>,
): OccupiedVoxelCell[] {
  return voxels.flatMap((voxel) =>
    footprintCells(infoForVoxel(voxel, catalog), voxel.rotation).map((offset) => ({
      x: voxel.x + offset.x,
      y: voxel.y + offset.y,
      z: voxel.z + offset.z,
      voxel,
      base: offset.x === 0 && offset.y === 0 && offset.z === 0,
    })),
  );
}
