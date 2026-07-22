import { useMemo } from "react";
import * as THREE from "three";
import { assetUrl, type BlockTexture } from "@/lib/api";
import { loadPixelTexture } from "@/lib/pixelTexture";

/**
 * Carga la textura REAL de un bloque de Hytale (servida por voxelfold-asset://),
 * con filtrado nearest para el look voxel. Devuelve null si no hay textura o falla.
 * Compartido por el visor 3D y el editor de voxels. Prefiere caras representativas.
 */
export function useBlockTexture(
  textures: BlockTexture[],
  enabled: boolean,
): THREE.Texture | null {
  const url = useMemo(() => {
    if (!enabled || !textures.length) return null;
    const pick =
      textures.find((t) => t.face === "All") ??
      textures.find((t) => t.face === "Sides") ??
      textures.find((t) => t.face === "Side") ??
      textures[0];
    return pick ? assetUrl(`Common/${pick.path}`) : null;
  }, [textures, enabled]);

  return useMemo(() => loadPixelTexture(url), [url]);
}
