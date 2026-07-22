import * as THREE from "three";

/**
 * Geometría PROCEDURAL de valla/muro conectable: un poste central + barandas hacia los
 * lados conectados (vecino valla o bloque sólido), como las vallas nativas de Hytale que
 * se unen en T y 4 vías. La forma se decide por una máscara de vecinos (bits): 1=+X, 2=−X,
 * 4=+Z, 8=−Z. Es un proxy de esquema (color sólido); el detalle real va en el icono nativo.
 */

const BITS = { px: 1, nx: 2, pz: 4, nz: 8 } as const;

/** Añade una caja (min→max) como 12 triángulos con normales planas. */
function pushBox(pos: number[], nrm: number[], min: number[], max: number[]) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  // 8 esquinas
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], // z0
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], // z1
  ];
  const face = (a: number, b: number, c: number, d: number, n: number[]) => {
    for (const i of [a, b, c, a, c, d]) {
      pos.push(v[i][0], v[i][1], v[i][2]);
      nrm.push(n[0], n[1], n[2]);
    }
  };
  face(4, 5, 6, 7, [0, 0, 1]); // +Z
  face(1, 0, 3, 2, [0, 0, -1]); // −Z
  face(1, 5, 4, 0, [0, -1, 0]); // −Y
  face(3, 7, 6, 2, [0, 1, 0]); // +Y
  face(5, 1, 2, 6, [1, 0, 0]); // +X
  face(0, 4, 7, 3, [-1, 0, 0]); // −X
}

const cache = new Map<number, THREE.BufferGeometry>();

/** Geometría de valla/muro para una máscara de conexiones (0..15). `thick`=muro (más
 *  grueso). Cacheada por máscara+grosor. */
export function makeFenceGeometry(mask: number, thick = false): THREE.BufferGeometry {
  const key = mask * 2 + (thick ? 1 : 0);
  const cached = cache.get(key);
  if (cached) return cached;

  const pos: number[] = [];
  const nrm: number[] = [];
  const P = thick ? 0.22 : 0.14; // medio grosor del poste
  const R = thick ? 0.14 : 0.075; // medio grosor de la baranda
  // Poste central (toda la altura de la celda).
  pushBox(pos, nrm, [-P, -0.5, -P], [P, 0.5, P]);
  // Barandas (dos alturas) hacia cada lado conectado.
  const bands: [number, number][] = [[0.1, 0.1 + 2 * R], [-0.28, -0.28 + 2 * R]];
  const rail = (dir: keyof typeof BITS) => {
    for (const [yb, yt] of bands) {
      if (dir === "px") pushBox(pos, nrm, [P, yb, -R], [0.5, yt, R]);
      else if (dir === "nx") pushBox(pos, nrm, [-0.5, yb, -R], [-P, yt, R]);
      else if (dir === "pz") pushBox(pos, nrm, [-R, yb, P], [R, yt, 0.5]);
      else pushBox(pos, nrm, [-R, yb, -0.5], [R, yt, -P]);
    }
  };
  if (mask & BITS.px) rail("px");
  if (mask & BITS.nx) rail("nx");
  if (mask & BITS.pz) rail("pz");
  if (mask & BITS.nz) rail("nz");

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  cache.set(key, g);
  return g;
}

// Bloques NO sólidos (decoración/luz/follaje): ni son valla ni conectan con una.
// Evita falsos positivos como `Plant_Moss_Wall_Green` (una planta, no un muro).
const NON_SOLID = /torch|lamp|light|plant|crop|flower|grass|sapling|vine|ivy|leaf|leaves|moss|candle|sign|button|lever|rope|banner|web|bedroll|door|window|fluid|water|lava/i;

/** ¿El nombre de bloque es una valla/muro conectable (forma valla/muro, no decoración)? */
export function isFenceName(name: string): boolean {
  return (/fence/i.test(name) || /wall/i.test(name)) && !NON_SOLID.test(name);
}

/** ¿Es un muro (más grueso) en vez de una valla fina? */
export function isWallName(name: string): boolean {
  return /wall/i.test(name) && !NON_SOLID.test(name);
}

/** ¿Una valla/muro debe conectar con este vecino? (otra valla/muro o bloque sólido). */
export function connectsTo(name: string | undefined): boolean {
  if (!name || name === "Empty") return false;
  if (isFenceName(name)) return true;
  return !NON_SOLID.test(name);
}

/** Máscara de conexión (bits 1=+X, 2=−X, 4=+Z, 8=−Z) consultando vecinos por nombre. */
export function connectionMask(
  x: number,
  y: number,
  z: number,
  at: (x: number, y: number, z: number) => string | undefined,
): number {
  let m = 0;
  if (connectsTo(at(x + 1, y, z))) m |= 1;
  if (connectsTo(at(x - 1, y, z))) m |= 2;
  if (connectsTo(at(x, y, z + 1))) m |= 4;
  if (connectsTo(at(x, y, z - 1))) m |= 8;
  return m;
}
