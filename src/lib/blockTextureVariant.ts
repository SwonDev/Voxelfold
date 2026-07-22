import type { BlockTexture } from "@/lib/api";

/** Variante ponderada determinista por celda, equivalente a la variedad visual del mundo. */
export function textureVariantAt(
  textures: BlockTexture[],
  x: number,
  y: number,
  z: number,
): number {
  const variants = new Map<number, number>();
  for (const texture of textures) {
    const variant = Number.isInteger(texture.variant) ? texture.variant : 0;
    if (!variants.has(variant)) variants.set(variant, Math.max(1, texture.weight));
  }
  if (variants.size <= 1) return variants.keys().next().value ?? 0;

  // Hash entero estable: una construcción conserva sus variantes entre sesiones/exportaciones.
  let hash = Math.imul(x | 0, 73_856_093) ^ Math.imul(y | 0, 19_349_663) ^ Math.imul(z | 0, 83_492_791);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  const total = Array.from(variants.values()).reduce((sum, weight) => sum + weight, 0);
  let pick = hash % total;
  for (const [variant, weight] of variants) {
    if (pick < weight) return variant;
    pick -= weight;
  }
  return variants.keys().next().value ?? 0;
}

/** Conserva juntas las caras Norte/Sur/Este/Oeste/Up/Down de la variante elegida. */
export function selectTextureVariant(textures: BlockTexture[], variant: number): BlockTexture[] {
  const selected = textures.filter(
    (texture) => (Number.isInteger(texture.variant) ? texture.variant : 0) === variant,
  );
  return selected.length ? selected : textures;
}
