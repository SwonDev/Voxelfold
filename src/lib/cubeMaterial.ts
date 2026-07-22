import * as THREE from "three";
import type { CubeFaces } from "@/lib/useCubeTextures";

const FALLBACK = "#7a6a4a";

export interface CubeOpts {
  /** Color de fallback si el bloque no tiene textura. */
  color?: string | null;
  /** Resaltado (fase actual en la guía): emisivo verde. */
  highlight?: boolean;
  /** Color que multiplica la textura (matiz de fase en el editor). */
  multiply?: string | null;
  /** Opacidad <1 para atenuar (editor, otras fases). */
  opacity?: number;
  /** El bloque emite luz: render emisivo (brilla). */
  light?: boolean;
  /** Cutout (hojas/follaje con huecos): recorte por alpha. */
  cutout?: boolean;
  /** Cristal/hielo/agua: mezcla alfa semitransparente + brillo. */
  translucent?: boolean;
}

/**
 * Material de un cubo de Hytale con textura POR CARA (lados/arriba/abajo distintos,
 * como en el juego: troncos, hierba…). Devuelve un array de 6 materiales mapeado a
 * los grupos de `BoxGeometry` (+x,-x,+y,-y,+z,-z) o un único material si no hay textura.
 */
export function cubeMaterial(faces: CubeFaces, opts: CubeOpts = {}): THREE.Material | THREE.Material[] {
  const make = (tex: THREE.Texture | null) => {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
    if (tex) {
      m.map = tex;
      if (opts.multiply) m.color = new THREE.Color(opts.multiply);
    } else if (opts.multiply) {
      m.color = new THREE.Color(opts.color ?? FALLBACK).lerp(new THREE.Color(opts.multiply), 0.4);
    } else {
      m.color = new THREE.Color(opts.color ?? FALLBACK);
    }
    if (opts.light && tex) {
      m.emissiveMap = tex;
      m.emissive = new THREE.Color("#ffffff");
      m.emissiveIntensity = 1.8; // alto para que el Bloom genere halo (emite luz)
    }
    if (opts.cutout) {
      m.alphaTest = 0.5;
      m.alphaToCoverage = true;
      m.side = THREE.DoubleSide;
    }
    if (opts.translucent) {
      m.transparent = true;
      m.opacity = 0.72;
      m.roughness = 0.25; // brillo tipo cristal/agua
      m.metalness = 0.1;
      m.depthWrite = false;
    }
    // NB: los cubos opacos NO llevan polygonOffset. El `factor` (escalado por la pendiente de la
    // cara) hacía que el sesgo cambiara con el ÁNGULO → al mover la cámara TODAS las caras
    // competían y parpadeaban. La separación con los modelos se hace solo con `units` (constante,
    // independiente del ángulo) en el material de modelo (ver VoxelEditor/VoxelViewer).
    if (opts.highlight) {
      m.emissive = new THREE.Color("#3fae6b");
      m.emissiveIntensity = 0.55;
    }
    if (opts.opacity != null && opts.opacity < 1) {
      m.transparent = true;
      m.opacity = opts.opacity;
      m.depthWrite = false;
    }
    return m;
  };

  if (
    !faces.side &&
    !faces.east &&
    !faces.west &&
    !faces.south &&
    !faces.north &&
    !faces.top &&
    !faces.bottom
  ) return make(null);
  const byTexture = new Map<THREE.Texture | null, THREE.Material>();
  const materialFor = (texture: THREE.Texture | null) => {
    const existing = byTexture.get(texture);
    if (existing) return existing;
    const material = make(texture);
    byTexture.set(texture, material);
    return material;
  };
  // Grupos nativos de BoxGeometry: +X, −X, +Y, −Y, +Z, −Z.
  return [
    materialFor(faces.east ?? faces.side),
    materialFor(faces.west ?? faces.side),
    materialFor(faces.top ?? faces.side),
    materialFor(faces.bottom ?? faces.side),
    materialFor(faces.south ?? faces.side),
    materialFor(faces.north ?? faces.side),
  ];
}
