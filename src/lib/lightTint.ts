import * as THREE from "three";
import { cloneMaterialWithEffects } from "@/lib/sceneAnimation";

/**
 * Tintado de materiales por la luz VOXELIZADA horneada, para bloques NO instanciados
 * (modelos: muebles, plantas, escaleras; y vallas/muros). Los cubos ya se tiñen con
 * `instanceColor`; esto hace lo equivalente para mallas individuales: clona el material
 * y multiplica su color por el color de luz del bloque. Para no crear un material por
 * bloque, se CACHEA por color cuantizado (8 niveles/canal → muy pocos materiales reales).
 */

type Mat = THREE.Material | THREE.Material[];

/** Clave cuantizada del color (8 niveles por canal) para reutilizar materiales. */
function quantKey(rgb: [number, number, number]): string {
  return `${Math.round(rgb[0] * 8)},${Math.round(rgb[1] * 8)},${Math.round(rgb[2] * 8)}`;
}

/**
 * Devuelve una variante del material teñida con la luz `rgb` (cacheada). Si no hay luz,
 * devuelve el material base sin tocar. Conserva explícitamente los shaders inyectados:
 * Three.js no copia `onBeforeCompile` ni `customProgramCacheKey` en `Material.clone()`.
 */
export function tintMaterial(
  base: Mat,
  rgb: [number, number, number] | undefined,
  cache: Map<string, Mat>,
): Mat {
  if (!rgb) return base;
  const key = quantKey(rgb);
  const hit = cache.get(key);
  if (hit) return hit;
  const c = new THREE.Color(rgb[0], rgb[1], rgb[2]);
  const tintOne = (m: THREE.Material): THREE.Material => {
    const cl = cloneMaterialWithEffects(m);
    const sm = cl as THREE.MeshStandardMaterial & { color?: THREE.Color };
    if (sm.color) sm.color = sm.color.clone().multiply(c);
    return cl;
  };
  const out: Mat = Array.isArray(base) ? base.map(tintOne) : tintOne(base);
  cache.set(key, out);
  return out;
}

/** Libera todos los materiales clonados del caché (al desmontar/recrear). */
export function disposeTintCache(cache: Map<string, Mat>): void {
  for (const m of cache.values()) {
    if (Array.isArray(m)) m.forEach((x) => x.dispose());
    else m.dispose();
  }
  cache.clear();
}
