import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { assetUrl, getAssetGeneration, type BlockInfo, type BlockTexture } from "@/lib/api";
import { resolveBlock } from "@/lib/resolveBlock";
import { loadBlockModel } from "@/lib/blockModel";
import { loadPixelTexture } from "@/lib/pixelTexture";

/**
 * Carga un PREFAB REAL de árbol/planta de Hytale (Server/Prefabs/**.prefab.json) y lo convierte
 * en geometría instanciable con las TEXTURAS REALES de sus bloques. El prefab es la forma nativa
 * exacta del árbol (lista de bloques x,y,z,name). Agrupa por tipo de bloque (tronco, hojas…) → un
 * sub-mesh por material; las hojas/follaje usan alphaTest (recorte) para verse como follaje real.
 * Centrado en XZ y asentado en y=0 (la base toca el suelo). Cacheado por ruta.
 */
export interface TreeModel {
  parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[];
}

interface PrefabBlock {
  x: number;
  y: number;
  z: number;
  name: string;
}

function loadTex(url: string): THREE.Texture {
  return loadPixelTexture(url) as THREE.Texture;
}

function pickPath(textures: BlockTexture[], faces: string[]): string | null {
  for (const f of faces) {
    const t = textures.find((x) => x.face === f);
    if (t) return t.path;
  }
  return textures[0]?.path ?? null;
}

const cache = new Map<string, Promise<TreeModel | null>>();

export function loadTree(path: string, catalog: Map<string, BlockInfo>): Promise<TreeModel | null> {
  const key = `${getAssetGeneration()}|${path}`;
  let p = cache.get(key);
  if (!p) {
    p = build(path, catalog).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function build(path: string, catalog: Map<string, BlockInfo>): Promise<TreeModel | null> {
  const res = await fetch(assetUrl(path));
  if (!res.ok) return null;
  const doc = (await res.json()) as { blocks?: PrefabBlock[] };
  const blocks = doc.blocks ?? [];
  if (!blocks.length) return null;

  // Centrar en XZ y asentar la base en y=0.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
  for (const b of blocks) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
    if (b.y < minY) minY = b.y;
  }
  const cx = Math.round((minX + maxX) / 2);
  const cz = Math.round((minZ + maxZ) / 2);

  // Agrupar por tipo de bloque base (sin estado/asterisco).
  const byName = new Map<string, PrefabBlock[]>();
  for (const b of blocks) {
    const base = (b.name.startsWith("*") ? b.name.slice(1) : b.name).replace(/_State_Definitions_.*/, "");
    let arr = byName.get(base);
    if (!arr) byName.set(base, (arr = []));
    arr.push(b);
  }

  const parts: TreeModel["parts"] = [];
  for (const [name, bs] of byName) {
    const spec = resolveBlock(catalog, name);

    if (spec.modelPath) {
      // Bloque-MODELO (hojas de pino, follaje, arbustos, flores, hierba…): usar su FORMA REAL
      // (.blockymodel) replicada en cada posición, no un cubo. Así las plantas finas se ven como
      // en Hytale (cross/pino) en vez de matojos cúbicos.
      const model = await loadBlockModel(spec.modelPath, spec.modelTexture);
      if (!model) continue;
      const bases = [model.geometry, model.flat, model.reflective].filter(
        (g): g is THREE.BufferGeometry => !!g && (g.attributes.position?.count ?? 0) > 0,
      );
      if (!bases.length) continue;
      const base = bases.length === 1 ? bases[0] : mergeGeometries(bases, false);
      if (!base) continue;
      const copies = bs.map((b) => {
        const g = base.clone();
        g.scale(spec.modelScale, spec.modelScale, spec.modelScale);
        g.translate(b.x - cx, b.y - minY + 0.5, b.z - cz);
        return g;
      });
      const geometry = mergeGeometries(copies, false);
      copies.forEach((g) => g.dispose());
      if (bases.length > 1) base.dispose();
      if (!geometry) continue;
      const mat = new THREE.MeshStandardMaterial({ map: model.texture, roughness: 1, metalness: 0 });
      mat.alphaTest = 0.5;
      mat.alphaToCoverage = true; // suaviza el recorte de las hojas/follaje (anti-shimmer)
      mat.side = THREE.FrontSide;
      if (spec.tint) mat.color = new THREE.Color(spec.tint);
      parts.push({ geometry, material: mat });
      continue;
    }

    // Bloque CUBO (troncos, sólidos): cubos con su textura real.
    const texPath = pickPath(spec.cubeTextures, ["Sides", "Side", "All", "Up", "UpDown"]);
    if (!texPath) continue;
    const tex = loadTex(assetUrl(`Common/${texPath}`));
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 });
    if (spec.tint) mat.color = new THREE.Color(spec.tint);
    if (spec.cutout) {
      mat.alphaTest = 0.5;
      mat.alphaToCoverage = true;
      mat.side = THREE.DoubleSide;
    }
    const boxes = bs.map((b) => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      g.translate(b.x - cx, b.y - minY + 0.5, b.z - cz);
      return g;
    });
    const geometry = mergeGeometries(boxes, false);
    boxes.forEach((g) => g.dispose());
    if (!geometry) continue;
    geometry.computeVertexNormals();
    parts.push({ geometry, material: mat });
  }
  return parts.length ? { parts } : null;
}
