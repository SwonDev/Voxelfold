/**
 * Operaciones de selección/portapapeles del editor (puras): normalizar una selección a
 * coordenadas relativas y transformarla (rotar 90° en Y, espejo X/Z), ajustando también
 * la orientación oficial 0-63 de cada bloque. Todo en rejilla entera.
 */
import {
  mirrorRotationX,
  mirrorRotationZ,
  rotateRotationY,
} from "@/lib/hytaleRotation";

export interface ClipVox {
  x: number;
  y: number;
  z: number;
  name: string;
  rotation: number;
  phase: number;
}

export interface Clipboard {
  cells: ClipVox[]; // relativos a (0,0,0) = esquina mínima
  w: number;
  d: number;
  h: number;
}

/** Caja de selección (incl.) en coordenadas de mundo. */
export interface SelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

/** Voxeles dentro de una caja (inclusiva). */
export function voxelsInBox<T extends { x: number; y: number; z: number }>(voxels: T[], box: SelBox): T[] {
  return voxels.filter(
    (v) =>
      v.x >= box.minX && v.x <= box.maxX &&
      v.y >= box.minY && v.y <= box.maxY &&
      v.z >= box.minZ && v.z <= box.maxZ,
  );
}

/** Crea un portapapeles relativo a la esquina mínima de la selección. */
export function toClipboard(voxels: ClipVox[]): Clipboard {
  if (!voxels.length) return { cells: [], w: 0, d: 0, h: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of voxels) {
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
  }
  return {
    cells: voxels.map((v) => ({ ...v, x: v.x - minX, y: v.y - minY, z: v.z - minZ })),
    w: maxX - minX + 1,
    d: maxZ - minZ + 1,
    h: maxY - minY + 1,
  };
}

/** Rota el portapapeles 90° en Y (sentido horario visto desde arriba). */
export function rotateClipboard(clip: Clipboard): Clipboard {
  // (x,z) → (z, (w-1)-x): rota la huella y mantiene esquina mínima en 0.
  const w = clip.w;
  const cells = clip.cells.map((c) => ({
    ...c,
    x: c.z,
    z: w - 1 - c.x,
    rotation: rotateRotationY(c.rotation),
  }));
  return { cells, w: clip.d, d: clip.w, h: clip.h };
}

/** Espejo en X (izquierda↔derecha). */
export function mirrorClipboardX(clip: Clipboard): Clipboard {
  const w = clip.w;
  const cells = clip.cells.map((c) => ({ ...c, x: w - 1 - c.x, rotation: mirrorRotationX(c.rotation) }));
  return { ...clip, cells };
}

/** Espejo en Z (delante↔detrás). */
export function mirrorClipboardZ(clip: Clipboard): Clipboard {
  const d = clip.d;
  const cells = clip.cells.map((c) => ({ ...c, z: d - 1 - c.z, rotation: mirrorRotationZ(c.rotation) }));
  return { ...clip, cells };
}

/**
 * Revolve (array radial): coloca `count` copias del portapapeles rotadas 90°·k alrededor
 * del punto `at` (centro), en coordenadas absolutas. count=1 → solo la copia base; 4 →
 * cuatro copias en cruz (torres/estructuras circulares, como el Revolve Tool de Hytale).
 */
export function revolveCells(clip: Clipboard, at: { x: number; y: number; z: number }, count: number): ClipVox[] {
  const out: ClipVox[] = [];
  const base = clip.cells.map((c) => ({ ...c, x: at.x + c.x, y: at.y + c.y, z: at.z + c.z }));
  const n = Math.max(1, Math.floor(count));
  for (let k = 0; k < n; k++) {
    for (const c of base) {
      let x = c.x, z = c.z, rot = c.rotation;
      for (let i = 0; i < k; i++) {
        const nx = at.x + (z - at.z);
        const nz = at.z - (x - at.x);
        x = nx; z = nz;
        rot = rotateRotationY(rot);
      }
      out.push({ ...c, x, y: c.y, z, rotation: rot });
    }
  }
  return out;
}

/**
 * Apilar/Array LINEAL: `count` copias contiguas del portapapeles en una dirección (como el
 * `//stack` de WorldEdit o el Array de Effortless). El paso entre copias = el tamaño del clip
 * en ese eje (quedan pegadas, sin huecos ni solapes). `at` = posición de la copia base.
 */
export function stackCells(
  clip: Clipboard,
  at: { x: number; y: number; z: number },
  dir: "x+" | "x-" | "y+" | "y-" | "z+" | "z-",
  count: number,
): ClipVox[] {
  const out: ClipVox[] = [];
  const axis = dir[0] as "x" | "y" | "z";
  const sign = dir[1] === "+" ? 1 : -1;
  const step = (axis === "x" ? clip.w : axis === "y" ? clip.h : clip.d) * sign;
  const n = Math.max(1, Math.floor(count));
  for (let k = 0; k < n; k++) {
    const off = step * k;
    for (const c of clip.cells) {
      out.push({
        ...c,
        x: at.x + c.x + (axis === "x" ? off : 0),
        y: at.y + c.y + (axis === "y" ? off : 0),
        z: at.z + c.z + (axis === "z" ? off : 0),
      });
    }
  }
  return out;
}

// Las transformaciones de orientación viven en `orientation.ts`: componen/reflejan la
// matriz oficial Ry·Rx·Rz y vuelven a canonicalizarla como `RotationTuple`.
export { mirrorRotationX, mirrorRotationZ };
