import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getAssetGeneration, type BlockInfo } from "@/lib/api";
import { resolveBlock } from "@/lib/resolveBlock";
import { loadBlockModel } from "@/lib/blockModel";

/**
 * Carga un bloque de COBERTURA DE SUELO de Hytale (hierba alta, flores, helechos, juncos…) por su
 * nombre y devuelve geometría + material listos para instanciar. Estos bloques usan su modelo CROSS
 * nativo (planos cruzados con recorte alfa), no un cubo — así la hierba/flores se ven como en el
 * juego. La base queda en y=0 (se asienta sobre la superficie del terreno al instanciar). Cacheado.
 */
export interface GroundModel {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

const cache = new Map<string, Promise<GroundModel | null>>();

/**
 * @param tint Color de bioma (BiomeTint de Hytale). La hierba/helechos usan texturas GRAYSCALE
 * (`*_GS`) que el juego tiñe con el color del bioma → sin tinte saldrían blancas. Las FLORES llevan
 * su propio color en la textura, así que NO se tiñen.
 */
export function loadGroundCover(
  name: string,
  catalog: Map<string, BlockInfo>,
  tint?: string,
): Promise<GroundModel | null> {
  const key = `${getAssetGeneration()}|${name}|${tint ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = build(name, catalog, tint).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function build(
  name: string,
  catalog: Map<string, BlockInfo>,
  tint?: string,
): Promise<GroundModel | null> {
  const spec = resolveBlock(catalog, name);
  if (!spec.modelPath) return null; // sin modelo cross → no es planta fina, se ignora
  const model = await loadBlockModel(spec.modelPath, spec.modelTexture);
  if (!model) return null;
  const bases = [model.geometry, model.flat, model.reflective].filter(
    (g): g is THREE.BufferGeometry => !!g && (g.attributes.position?.count ?? 0) > 0,
  );
  if (!bases.length) return null;
  // Clonar (no mutar las geometrías cacheadas de loadBlockModel) y asentar la base en y=0
  // (los modelos vienen centrados en el bloque: −0.5..0.5 → +0.5 para que la base toque el suelo).
  const copies = bases.map((g) => g.clone());
  const geometry = copies.length === 1 ? copies[0] : mergeGeometries(copies, false);
  if (!geometry) return null;
  if (copies.length > 1) copies.forEach((g) => g.dispose());
  geometry.scale(spec.modelScale, spec.modelScale, spec.modelScale);
  geometry.translate(0, 0.5, 0);
  const material = new THREE.MeshStandardMaterial({ map: model.texture, roughness: 1, metalness: 0 });
  material.alphaTest = 0.5;
  material.alphaToCoverage = true; // suaviza el borde recortado (anti-shimmer, requiere MSAA)
  material.side = THREE.FrontSide;
  // Hierba/helechos/juncos (textura grayscale) → tinte de bioma; flores → su color propio.
  const isFlower = /flower/i.test(name);
  if (!isFlower && tint) material.color = new THREE.Color(tint);
  else if (spec.tint) material.color = new THREE.Color(spec.tint);
  return { geometry, material };
}
