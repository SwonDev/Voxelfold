import { useMemo } from "react";
import type * as THREE from "three";
import { assetUrl, type BlockTexture } from "@/lib/api";
import { loadPixelTexture } from "@/lib/pixelTexture";

export interface CubeFaces {
  side: THREE.Texture | null;
  east: THREE.Texture | null;
  west: THREE.Texture | null;
  south: THREE.Texture | null;
  north: THREE.Texture | null;
  top: THREE.Texture | null;
  bottom: THREE.Texture | null;
}

function findFace(textures: BlockTexture[], faces: string[]): string | null {
  for (const f of faces) {
    const t = textures.find((x) => x.face === f);
    if (t) return t.path;
  }
  return null;
}

/**
 * Texturas por cara de un bloque cubo de Hytale: lados (`Sides`) y arriba/abajo
 * (`UpDown`) — como en el juego (troncos, hierba, etc.). Devuelve texturas ya
 * cargadas (cacheadas por URL) para construir un material de 6 caras.
 */
export function useCubeTextures(textures: BlockTexture[], enabled: boolean): CubeFaces {
  const urls = useMemo(() => {
    if (!enabled || !textures.length) {
      return { side: null, east: null, west: null, south: null, north: null, top: null, bottom: null };
    }
    // Hytale también admite seis caras independientes. En Three: +X=Este, −X=Oeste,
    // +Z=Sur y −Z=Norte; al rotar el voxel las caras giran con su geometría.
    const fallback = textures[0]?.path ?? null;
    const side =
      findFace(textures, ["All", "Sides", "Side"]) ??
      findFace(textures, ["North", "East", "South", "West"]) ??
      findFace(textures, ["Up", "UpDown", "Down"]) ??
      fallback;
    const east = findFace(textures, ["East"]) ?? side;
    const west = findFace(textures, ["West"]) ?? side;
    const south = findFace(textures, ["South"]) ?? side;
    const north = findFace(textures, ["North"]) ?? side;
    const top = findFace(textures, ["Up", "UpDown", "Top", "All", "Sides", "Side"]) ?? side;
    const bottom = findFace(textures, ["Down", "Bottom", "UpDown", "All", "Sides", "Side"]) ?? side;
    const url = (path: string | null) => (path ? assetUrl(`Common/${path}`) : null);
    return {
      side: url(side),
      east: url(east),
      west: url(west),
      south: url(south),
      north: url(north),
      top: url(top),
      bottom: url(bottom),
    };
  }, [textures, enabled]);

  return useMemo(
    () => ({
      side: loadPixelTexture(urls.side),
      east: loadPixelTexture(urls.east),
      west: loadPixelTexture(urls.west),
      south: loadPixelTexture(urls.south),
      north: loadPixelTexture(urls.north),
      top: loadPixelTexture(urls.top),
      bottom: loadPixelTexture(urls.bottom),
    }),
    [urls.side, urls.east, urls.west, urls.south, urls.north, urls.top, urls.bottom],
  );
}
