import type * as THREE from "three";

/** Libera un material (o array de materiales) de la GPU. Compartido por el editor y el visor.
 *  Deduplica: `cubeMaterial` reutiliza el mismo material en varias caras (`[side,side,top,…]`),
 *  así que se libera CADA material una sola vez (evita dispose repetido sobre el mismo objeto). */
export function disposeMaterial(m: THREE.Material | THREE.Material[] | null | undefined) {
  if (!m) return;
  if (Array.isArray(m)) new Set(m).forEach((x) => x.dispose());
  else m.dispose();
}
