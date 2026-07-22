import * as THREE from "three";
import type { BlockInfo } from "@/lib/api";
import { isMarkerName, isLightName, parseBlockName, resolveBlock } from "@/lib/resolveBlock";

/**
 * Iluminación VOXELIZADA estilo Hytale/Minecraft, horneada en CPU (barata, sin luces
 * dinámicas que atraviesen paredes). Dos campos que se propagan celda a celda y los frenan
 * los bloques OPACOS:
 *  - CIELO: baja recto sin pérdida hasta toparse con un bloque (exterior iluminado) y se
 *    filtra con caída por los huecos hacia los interiores → las salas cerradas quedan oscuras.
 *  - ANTORCHAS: cada fuente irradia y decae con la distancia, respetando muros.
 * El resultado se hornea como COLOR por bloque (se aplica como `instanceColor`, que multiplica
 * la textura): interiores en penumbra fría, exteriores a plena luz, cálido junto a las llamas.
 */

const MAXL = 14; // nivel máximo de luz (como Minecraft)

interface LiteVoxel {
  x: number;
  y: number;
  z: number;
  name: string;
}

const INDOOR = new THREE.Color("#6c7891"); // penumbra interior (azulada y fría, NO negra)
const DAY = new THREE.Color("#f4f6ff"); // luz de día (blanca con un punto frío de cielo)
const TORCH = new THREE.Color("#ffb45a"); // tinte cálido de antorcha

/**
 * Color horneado (rgb 0..1, puede pasar de 1 para brillar) a partir de los niveles de luz
 * y la oclusión ambiental `ao` (1 = sin ocluir, <1 = recoveco en sombra).
 */
function bake(sky: number, torch: number, ao: number): [number, number, number] {
  const c = INDOOR.clone().lerp(DAY, Math.min(1, sky)); // cielo: penumbra fría → día
  c.lerp(TORCH, 0.72 * torch); // tinte cálido junto a antorchas
  c.multiplyScalar((1 + 0.5 * torch) * ao); // brillo extra de antorcha · oclusión de contacto
  return [c.r, c.g, c.b];
}

// Vecinos para la OCLUSIÓN AMBIENTAL: 6 caras (peso alto) + 12 aristas (peso medio).
const AO_FACE = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;
const AO_EDGE = [
  [1, 1, 0], [1, -1, 0], [-1, 1, 0], [-1, -1, 0],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1],
] as const;

/**
 * Resultado del cálculo de luz voxelizada.
 *  - `block`: color horneado POR BLOQUE (con AO) → `instanceColor` en cubos y tinte de
 *    modelos/vallas (editor y visor).
 *  - `lightAt` / `isOpen` / `isSolid`: muestreadores por CELDA para el smooth lighting por
 *    vértice del visor (color de luz crudo de una celda, si deja pasar luz, si está ocupada).
 */
export interface VoxelLight {
  block: Map<string, [number, number, number]>;
  lightAt: (x: number, y: number, z: number) => [number, number, number];
  isOpen: (x: number, y: number, z: number) => boolean;
  isSolid: (x: number, y: number, z: number) => boolean;
  /** ¿La celda contiene un CUBO MACIZO OPACO COMPLETO que tapa la cara vecina? (face culling).
   *  Estricto: excluye losas/escaleras/cuñas/tejados/plantas/cristal/agua (no llenan la celda). */
  coversFace: (x: number, y: number, z: number) => boolean;
}

/** Calcula la luz voxelizada (cielo + antorchas, AO de contacto) de una escena. */
export function computeBlockLight(
  voxels: LiteVoxel[],
  catalog: Map<string, BlockInfo>,
): VoxelLight {
  const out = new Map<string, [number, number, number]>();
  const INDOOR_RGB: [number, number, number] = [INDOOR.r, INDOOR.g, INDOOR.b];
  const empty: VoxelLight = {
    block: out,
    lightAt: () => INDOOR_RGB,
    isOpen: () => true,
    isSolid: () => false,
    coversFace: () => false,
  };
  if (voxels.length === 0) return empty;

  const opaque = new Set<string>();
  const occupied = new Set<string>(); // todos los bloques (para la oclusión ambiental)
  const fullCube = new Set<string>(); // cubos macizos opacos COMPLETOS (para el face culling)
  const sources: [number, number, number][] = [];
  const cache = new Map<string, { opaque: boolean; light: boolean; cover: boolean }>();
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const real: LiteVoxel[] = [];

  for (const v of voxels) {
    if (isMarkerName(v.name)) continue;
    real.push(v);
    if (v.x < minX) minX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x;
    if (v.y > maxY) maxY = v.y;
    if (v.z > maxZ) maxZ = v.z;
    let info = cache.get(v.name);
    if (!info) {
      const b = catalog.get(v.name) ?? catalog.get(parseBlockName(v.name).base);
      const op = b?.opacity ?? null;
      const light = (b?.light ?? false) || isLightName(v.name) || !!b?.flame_color;
      // Frena la luz solo el cubo macizo opaco: NO modelos (antorchas/plantas/vallas),
      // NI transparente/semitransparente/cutout, NI fuentes de luz.
      const opaqueBlock = (op === null || op === "Solid") && !b?.model && !light;
      // Cubo macizo opaco COMPLETO para el FACE CULLING: solo si resolveBlock NO lo convierte
      // en modelo/cuña ni es translúcido/cutout/fluido. Así las losas/escaleras/tejados/plantas
      // (que NO llenan la celda) NO tapan la cara del vecino → no se cullea → sin huecos.
      const spec = resolveBlock(catalog, v.name);
      const cover =
        opaqueBlock &&
        !spec.modelPath &&
        !spec.wedge &&
        !spec.translucent &&
        !spec.cutout &&
        !spec.fluid;
      info = { opaque: opaqueBlock, light, cover };
      cache.set(v.name, info);
    }
    const key = `${v.x},${v.y},${v.z}`;
    occupied.add(key);
    if (info.opaque) opaque.add(key);
    if (info.cover) fullCube.add(key);
    if (info.light) sources.push([v.x, v.y, v.z]);
  }
  if (real.length === 0) return empty;

  // Región acotada (bbox + margen) para limitar el coste de la propagación.
  const x0 = minX - 1, x1 = maxX + 1, y0 = minY - 1, y1 = maxY + 1, z0 = minZ - 1, z1 = maxZ + 1;
  const inRegion = (x: number, y: number, z: number) =>
    x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  const DIRS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ] as const;

  const flood = (seeds: [number, number, number, number][]): Map<string, number> => {
    const field = new Map<string, number>();
    const q: [number, number, number, number][] = [];
    for (const [x, y, z, l] of seeds) {
      const k = `${x},${y},${z}`;
      if ((field.get(k) ?? -1) >= l) continue;
      field.set(k, l);
      q.push([x, y, z, l]);
    }
    let head = 0;
    while (head < q.length) {
      const [x, y, z, l] = q[head++];
      if (l <= 1) continue;
      for (const [dx, dy, dz] of DIRS) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (!inRegion(nx, ny, nz)) continue;
        const nk = `${nx},${ny},${nz}`;
        if (opaque.has(nk)) continue; // los muros frenan la luz
        const nl = l - 1;
        if ((field.get(nk) ?? 0) >= nl) continue;
        field.set(nk, nl);
        q.push([nx, ny, nz, nl]);
      }
    }
    return field;
  };

  // CIELO: por cada columna, las celdas por encima del primer bloque opaco reciben luz
  // plena (sin pérdida); esas son las semillas que luego se filtran de lado/hacia abajo.
  const skySeeds: [number, number, number, number][] = [];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y1; y >= y0; y--) {
        if (opaque.has(`${x},${y},${z}`)) break; // sombra por debajo
        skySeeds.push([x, y, z, MAXL]);
      }
    }
  }
  const skyField = flood(skySeeds);
  const torchField = flood(sources.map(([x, y, z]) => [x, y, z, MAXL] as [number, number, number, number]));

  // Luz de cada bloque = mezcla del MÁXIMO (mantiene el brillo junto a la fuente) y la
  // MEDIA de las celdas abiertas vecinas (suaviza el degradado, evita el escalonado duro).
  // Las caras de un bloque se iluminan por el aire contiguo, de ahí mirar a los vecinos.
  for (const v of real) {
    let skyMax = skyField.get(`${v.x},${v.y},${v.z}`) ?? 0;
    let torchMax = torchField.get(`${v.x},${v.y},${v.z}`) ?? 0;
    let skySum = skyMax, torchSum = torchMax, n = 1;
    for (const [dx, dy, dz] of DIRS) {
      const nk = `${v.x + dx},${v.y + dy},${v.z + dz}`;
      const s = skyField.get(nk);
      const t = torchField.get(nk);
      if (s !== undefined || t !== undefined) {
        const sv = s ?? 0, tv = t ?? 0;
        if (sv > skyMax) skyMax = sv;
        if (tv > torchMax) torchMax = tv;
        skySum += sv;
        torchSum += tv;
        n++;
      }
    }
    const sky = 0.55 * skyMax + 0.45 * (skySum / n);
    const torch = 0.55 * torchMax + 0.45 * (torchSum / n);
    // Oclusión ambiental de contacto: cuantos más bloques rodean a este, más en sombra
    // (recovecos/esquinas internas). Caras pesan más que aristas.
    let occ = 0;
    for (const [dx, dy, dz] of AO_FACE)
      if (occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)) occ += 1;
    for (const [dx, dy, dz] of AO_EDGE)
      if (occupied.has(`${v.x + dx},${v.y + dy},${v.z + dz}`)) occ += 0.4;
    const ao = Math.max(0.62, 1 - 0.05 * occ); // hasta ~38% en recovecos muy cerrados
    out.set(`${v.x},${v.y},${v.z}`, bake(sky / MAXL, torch / MAXL, ao));
  }

  // Muestreadores por celda para el smooth lighting por vértice (visor): color de luz CRUDO
  // de una celda (la media por vértice ya suaviza), si deja pasar luz, y si está ocupada (AO).
  return {
    block: out,
    lightAt: (x, y, z) =>
      bake((skyField.get(`${x},${y},${z}`) ?? 0) / MAXL, (torchField.get(`${x},${y},${z}`) ?? 0) / MAXL, 1),
    isOpen: (x, y, z) => !opaque.has(`${x},${y},${z}`),
    isSolid: (x, y, z) => occupied.has(`${x},${y},${z}`),
    coversFace: (x, y, z) => fullCube.has(`${x},${y},${z}`),
  };
}
