import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Biome, Relief, TerrainLayer, WaterConfig } from "@/lib/biomes";
import { fbm, mulberry32 } from "@/lib/terrainNoise";
import { resolveBlock } from "@/lib/resolveBlock";
import { loadTree, type TreeModel } from "@/lib/treePrefab";
import { loadGroundCover, type GroundModel } from "@/lib/groundCover";
import { assetUrl, type BlockInfo, type BlockTexture } from "@/lib/api";
import { configurePixelTexture } from "@/lib/pixelTexture";

/**
 * Entorno de previsualización VOXEL fiel a Hytale: planta el prefab en un trozo de mapa real
 * generado con BLOQUES cúbicos. Un CLARO central plano sostiene el prefab; alrededor crece relieve
 * (colinas/montañas) con escalones rectos. La PILA DE MATERIALES (superficie→subsuelo→piedra), los
 * TINTES, el AGUA (ríos/lagos/océano) y la VEGETACIÓN vienen del generador de mundo REAL de Hytale
 * por bioma (ver biomes.ts). Cada capa usa su BLOQUE REAL del catálogo. Vegetación = PREFABS REALES
 * + cobertura de suelo (hierba/flores/helechos) con su modelo cross nativo. Determinista por semilla.
 * Mesher de CARAS EXPUESTAS → un puñado de mallas; `frustumCulled={false}` en lo disperso.
 */

const RADIUS = 78; // semianchura del terreno en BLOQUES (se funde con la niebla del horizonte)
const reliefAmp: Record<Relief, number> = { flat: 2, hills: 13, mountains: 40 };

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Altura ENTERA base del terreno (≥0): claro plano central, relieve creciente hacia el horizonte. */
function baseHeight(x: number, z: number, amp: number, clear: number, seed: number): number {
  const d = Math.hypot(x, z);
  const ramp = THREE.MathUtils.clamp((d - clear) / 12, 0, 1); // 0 en el claro, 1 fuera
  if (ramp <= 0) return 0;
  const far = THREE.MathUtils.smoothstep(d, clear, RADIUS * 0.7); // montañas plenas a media distancia
  const n = fbm(x * 0.03, z * 0.03, seed, 4);
  const h = Math.pow(n, 1.5) * amp * (0.4 + far * 1.5) * ramp;
  return Math.round(h);
}

/** Altura del terreno con AGUA: talla cuencas de río/lago bajo el nivel del mar, u océano (isla). */
function terrainHeight(x: number, z: number, amp: number, clear: number, seed: number, water?: WaterConfig): number {
  const h = baseHeight(x, z, amp, clear, seed);
  if (!water) return h;
  const d = Math.hypot(x, z);
  if (d <= clear) return h; // el claro/isla siempre queda seco y plano
  if (water.ocean) {
    // Océano: fuera del claro, el lecho marino desciende bajo el nivel del mar → isla central.
    const ramp = THREE.MathUtils.clamp((d - clear) / 6, 0, 1);
    const bed = water.sea - 2 - Math.round(fbm(x * 0.05, z * 0.05, seed ^ 0x77, 2) * 5);
    return Math.round(THREE.MathUtils.lerp(0, bed, ramp));
  }
  // Ríos/lagos: canales de baja frecuencia tallados bajo el nivel del mar.
  const river = fbm(x * 0.012 + 50, z * 0.012 + 50, seed ^ 0x9e37, 2);
  if (river < 0.32) {
    const t = (0.32 - river) / 0.32; // 0 (borde) … 1 (centro del cauce)
    return Math.min(h, water.sea - 1 - Math.round(t * 5));
  }
  return h;
}

/** Acumulador de quads por bucket de material. UV 0-1 por cara → cada cara = una textura de bloque. */
class Quads {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  add(p0: number[], p1: number[], p2: number[], p3: number[]) {
    const b = this.pos.length / 3;
    this.pos.push(...p0, ...p1, ...p2, ...p3);
    this.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Claves de bucket especiales (las capas intermedias se etiquetan por nombre de bloque).
const K_SURFACE = "__surface";
const K_STONE = "__stone";

interface ResolvedTerrain {
  layers: TerrainLayer[];
  stone: string;
}

/** Valida la pila de materiales del bioma contra el catálogo real (con respaldos de seguridad). */
function resolveTerrain(catalog: Map<string, BlockInfo>, biome: Biome): ResolvedTerrain {
  const ok = (name: string): boolean => {
    const b = catalog.get(name);
    return !!b && !b.model && (b.textures?.length ?? 0) > 0;
  };
  const firstOk = (...names: string[]): string | null => {
    for (const n of names) if (n && ok(n)) return n;
    return null;
  };
  const layers: TerrainLayer[] = [];
  for (const L of biome.layers) {
    const b = firstOk(L.block) ?? firstOk("Soil_Grass", "Soil_Dirt", "Rock_Stone");
    if (b) layers.push({ block: b, depth: Math.max(1, L.depth), tint: !!L.tint });
  }
  if (!layers.length) {
    layers.push({ block: firstOk("Soil_Grass", "Soil_Dirt", "Rock_Stone") ?? "Rock_Stone", depth: 1, tint: true });
  }
  const stone = firstOk(biome.stone, "Rock_Stone", "Rock_Marble") ?? layers[layers.length - 1].block;
  return { layers, stone };
}

/** Devuelve la clave de bucket para una cara lateral a profundidad `d` (0 = justo bajo la superficie). */
function bucketAtDepth(layers: TerrainLayer[], d: number): string {
  let acc = 0;
  for (let i = 0; i < layers.length; i++) {
    acc += layers[i].depth;
    if (d < acc) return i === 0 ? K_SURFACE : layers[i].block;
  }
  return K_STONE;
}

// --- Carga imperativa de texturas de bloque (cacheada por URL, como useCubeTextures) ---
const terrainTexCache = new Map<string, THREE.Texture>();
function loadTerrainTex(url: string): THREE.Texture {
  let t = terrainTexCache.get(url);
  if (t) return t;
  t = new THREE.TextureLoader().load(url, undefined, undefined, () => {
    if (terrainTexCache.get(url) === t) terrainTexCache.delete(url);
  });
  configurePixelTexture(t);
  terrainTexCache.set(url, t);
  return t;
}
function pickFace(textures: BlockTexture[], faces: string[]): string | null {
  for (const f of faces) {
    const t = textures.find((x) => x.face === f);
    if (t) return t.path;
  }
  return textures[0]?.path ?? null;
}

interface TerrainMaterials {
  top: THREE.Material;
  sides: Map<string, THREE.Material>;
  water: THREE.Material | null;
  dispose: () => void;
}

/** Construye los materiales de cada bucket de terreno + el agua, leyendo texturas REALES del catálogo. */
function buildTerrainMaterials(catalog: Map<string, BlockInfo>, biome: Biome, t: ResolvedTerrain): TerrainMaterials {
  const made: THREE.Material[] = [];
  const tex = (path: string | null): THREE.Texture | null => {
    if (!path) return null;
    const url = assetUrl(`Common/${path}`);
    return loadTerrainTex(url);
  };
  const mkMat = (block: string, faces: string[], tint: boolean): THREE.Material => {
    const spec = resolveBlock(catalog, block);
    const m = new THREE.MeshStandardMaterial({
      map: tex(pickFace(spec.cubeTextures, faces)),
      roughness: 1,
      metalness: 0,
    });
    if (tint) m.color = new THREE.Color(biome.tint);
    else if (spec.tint) m.color = new THREE.Color(spec.tint);
    made.push(m);
    return m;
  };

  const surf = t.layers[0];
  const top = mkMat(surf.block, ["Up", "UpDown", "Top", "All", "Sides", "Side"], !!surf.tint);
  const sides = new Map<string, THREE.Material>();
  sides.set(K_SURFACE, mkMat(surf.block, ["Sides", "Side", "All", "Up", "UpDown"], !!surf.tint));
  for (let i = 1; i < t.layers.length; i++) {
    const b = t.layers[i].block;
    if (!sides.has(b)) sides.set(b, mkMat(b, ["Sides", "Side", "All", "Up", "UpDown"], false));
  }
  if (!sides.has(K_STONE)) sides.set(K_STONE, mkMat(t.stone, ["Sides", "Side", "All", "Up", "UpDown"], false));

  // Agua: superficie semitransparente con la textura REAL de Fluid_Water (tileada), tinte azulado.
  let water: THREE.Material | null = null;
  if (biome.water) {
    const wspec = resolveBlock(catalog, "Fluid_Water");
    const wtex = tex(pickFace(wspec.cubeTextures, ["All", "Sides", "Side", "Up"]));
    if (wtex) {
      wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping;
      wtex.repeat.set(RADIUS / 3, RADIUS / 3);
    }
    water = new THREE.MeshStandardMaterial({
      map: wtex,
      color: new THREE.Color(wtex ? "#7fb4cc" : "#2f6f8f"),
      transparent: true,
      opacity: 0.8,
      roughness: 0.25,
      metalness: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Solo un sesgo constante: el factor dependiente de la pendiente hacía titilar la orilla.
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -1,
    });
    made.push(water);
  }

  return { top, sides, water, dispose: () => made.forEach((m) => m.dispose()) };
}

/** Materiales de terreno + re-render cuando las texturas async terminan de cargar. */
function useTerrain(catalog: Map<string, BlockInfo>, biome: Biome) {
  const resolved = useMemo(() => resolveTerrain(catalog, biome), [catalog, biome]);
  const mats = useMemo(() => buildTerrainMaterials(catalog, biome, resolved), [catalog, biome, resolved]);
  useEffect(() => () => mats.dispose(), [mats]);
  return { resolved, mats };
}

/** Plano de AGUA animado: desplaza lentamente la textura para simular corriente/oleaje de Hytale. */
function WaterPlane({ material, sea }: { material: THREE.Material; sea: number }) {
  useFrame((_, dt) => {
    const m = material as THREE.MeshStandardMaterial;
    if (m.map) {
      m.map.offset.x = (m.map.offset.x + dt * 0.012) % 1;
      m.map.offset.y = (m.map.offset.y + dt * 0.006) % 1;
    }
  });
  return (
    <mesh position={[0, sea + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} material={material} frustumCulled={false} renderOrder={3}>
      <planeGeometry args={[(RADIUS + 2) * 2, (RADIUS + 2) * 2]} />
    </mesh>
  );
}

export function BiomeEnvironment({
  biome,
  relief,
  floorY,
  clearRadius,
  catalog,
  vegetation = true,
}: {
  biome: Biome;
  relief: Relief;
  floorY: number;
  clearRadius: number;
  catalog: Map<string, BlockInfo>;
  /** En el editor puede ocultarse para que ningún árbol tape la construcción. */
  vegetation?: boolean;
}) {
  const seed = hashStr(biome.id) ^ 0x5eed;
  const clear = Math.max(14, Math.ceil(clearRadius / 8) * 8 + 6);
  const amp = reliefAmp[relief];
  const water = biome.water;
  const isOcean = !!water?.ocean;

  const { resolved, mats } = useTerrain(catalog, biome);
  const layers = resolved.layers;

  // --- Mesher voxel: cara superior (superficie) + un bucket por material lateral (capas/piedra) ---
  const geos = useMemo(() => {
    const top = new Quads();
    const sideBuckets = new Map<string, Quads>();
    const getSide = (k: string): Quads => {
      let q = sideBuckets.get(k);
      if (!q) sideBuckets.set(k, (q = new Quads()));
      return q;
    };
    const H = (x: number, z: number) => terrainHeight(x, z, amp, clear, seed, water);
    const edgeFloor = water ? water.sea - 16 : -4;
    for (let x = -RADIUS; x <= RADIUS; x++) {
      for (let z = -RADIUS; z <= RADIUS; z++) {
        const h = H(x, z);
        top.add([x - 0.5, h, z - 0.5], [x - 0.5, h, z + 0.5], [x + 0.5, h, z + 0.5], [x + 0.5, h, z - 0.5]);
        const nb: [number, number, number[][]][] = [
          [x + 1, z, [[x + 0.5, 0, z + 0.5], [x + 0.5, 0, z - 0.5]]],
          [x - 1, z, [[x - 0.5, 0, z - 0.5], [x - 0.5, 0, z + 0.5]]],
          [x, z + 1, [[x - 0.5, 0, z + 0.5], [x + 0.5, 0, z + 0.5]]],
          [x, z - 1, [[x + 0.5, 0, z - 0.5], [x - 0.5, 0, z - 0.5]]],
        ];
        for (const [nx, nz, edge] of nb) {
          const nh = Math.abs(nx) > RADIUS || Math.abs(nz) > RADIUS ? edgeFloor : H(nx, nz);
          for (let y = h - 1; y >= nh; y--) {
            const d = h - 1 - y;
            const [a, b] = edge;
            getSide(bucketAtDepth(layers, d)).add(
              [a[0], y, a[2]], [b[0], y, b[2]], [b[0], y + 1, b[2]], [a[0], y + 1, a[2]],
            );
          }
        }
      }
    }
    const sides: [string, THREE.BufferGeometry][] = [];
    for (const [k, q] of sideBuckets) {
      const g = q.geometry();
      if (g) sides.push([k, g]);
    }
    return { top: top.geometry(), sides };
  }, [amp, clear, seed, layers, water]);

  useEffect(
    () => () => {
      geos.top?.dispose();
      geos.sides.forEach(([, g]) => g.dispose());
    },
    [geos],
  );

  // --- Vegetación: PREFABS REALES de árbol/planta + cobertura de suelo (hierba/flores) de Hytale ---
  const [veg, setVeg] = useState<{ trees: TreeModel[]; plants: TreeModel[]; ground: GroundModel[]; props: TreeModel[] }>({
    trees: [],
    plants: [],
    ground: [],
    props: [],
  });
  useEffect(() => {
    if (!vegetation || (biome.flora === "none" && !biome.ground.length)) {
      setVeg({ trees: [], plants: [], ground: [], props: [] });
      return;
    }
    let alive = true;
    Promise.all([
      Promise.all(biome.trees.map((p) => loadTree(p, catalog))),
      Promise.all(biome.plants.map((p) => loadTree(p, catalog))),
      Promise.all(biome.ground.map((n) => loadGroundCover(n, catalog, biome.tint))),
      Promise.all((biome.props ?? []).map((p) => loadTree(p, catalog))),
    ]).then(([trees, plants, ground, props]) => {
      if (alive)
        setVeg({
          trees: trees.filter((t): t is TreeModel => !!t),
          plants: plants.filter((t): t is TreeModel => !!t),
          ground: ground.filter((g): g is GroundModel => !!g),
          props: props.filter((t): t is TreeModel => !!t),
        });
    });
    return () => {
      alive = false;
    };
  }, [catalog, biome, vegetation]);

  // Esparcido determinista en el anillo [innerR, outerR]: matriz + índice de tipo. Salta cimas y
  // (opcional) lo sumergido. Devuelve instancias por tipo.
  const useScatter = (
    count: number, types: number, salt: number,
    innerR: number, outerR: number, skipPeaks: number, smin: number, smax: number,
  ) =>
    useMemo(() => {
      if (!types || outerR <= innerR) return [] as { m: THREE.Matrix4; t: number }[];
      const rnd = mulberry32(seed ^ salt);
      const out: { m: THREE.Matrix4; t: number }[] = [];
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      let tries = 0;
      while (out.length < count && tries++ < count * 10) {
        const ang = rnd() * Math.PI * 2;
        const r = innerR + rnd() * (outerR - innerR);
        const x = Math.round(Math.cos(ang) * r), z = Math.round(Math.sin(ang) * r);
        const h = terrainHeight(x, z, amp, clear, seed, water);
        if (water && h <= water.sea) continue; // no plantar bajo el agua
        if (h / Math.max(1, amp) > skipPeaks) continue;
        const s = smin + rnd() * (smax - smin);
        q.setFromAxisAngle(up, Math.floor(rnd() * 4) * (Math.PI / 2));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, h, z), q, new THREE.Vector3(s, s, s));
        out.push({ m, t: Math.floor(rnd() * types) });
      }
      return out;
    }, [types, relief, clear, seed, amp, innerR, outerR]);

  // En el océano la vegetación va SOLO en la isla (dentro del claro); en el resto, fuera del claro.
  const treeInner = isOcean ? clearRadius + 2 : clear + 9;
  const treeOuter = isOcean ? clear - 1 : RADIUS;
  const plantInner = isOcean ? clearRadius + 2 : clear + 2;
  const groundOuter = isOcean ? clear - 1 : RADIUS;

  // El océano es una isla PEQUEÑA → poca vegetación; el resto, densidad por relieve.
  const treeCount = isOcean ? 10 : relief === "flat" ? 28 : relief === "hills" ? 55 : 80;
  const plantCount = isOcean ? 16 : relief === "flat" ? 100 : 150;
  const groundCount = isOcean ? 70 : relief === "flat" ? 280 : 360;
  const treeInst = useScatter(treeCount, veg.trees.length, 0xb00, treeInner, treeOuter, 0.72, 0.7, 1.0);
  const plantInst = useScatter(plantCount, veg.plants.length, 0x5a17, plantInner, groundOuter, 0.82, 0.7, 1.1);
  // Cobertura de suelo (hierba/flores): densa pero BAJA (escala ≤1) para no formar muro de cerca.
  const groundInst = useScatter(groundCount, veg.ground.length, 0x6d05, clearRadius + 2, groundOuter, 0.9, 0.55, 1.0);
  // Props (peñascos/rocas): pocos, dispersos a media distancia, tamaño variado.
  const propInst = useScatter(isOcean ? 6 : relief === "flat" ? 12 : 22, veg.props.length, 0x9b07, isOcean ? clearRadius + 3 : clear + 5, groundOuter, 0.7, 0.6, 1.2);

  // Un InstancedMesh por (tipo × sub-mesh). Geometrías/materiales del cache → NO se liberan aquí.
  const renderInst = (
    parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[][],
    inst: { m: THREE.Matrix4; t: number }[],
    kp: string,
  ) =>
    parts.flatMap((modelParts, ti) => {
      const ms = inst.filter((o) => o.t === ti).map((o) => o.m);
      if (!ms.length) return [];
      return modelParts.map((part, pi) => (
        <instancedMesh
          key={`${kp}-${ti}-${pi}`}
          args={[part.geometry, part.material, ms.length]}
          castShadow
          receiveShadow
          frustumCulled
          ref={(im) => {
            if (!im) return;
            ms.forEach((m, i) => im.setMatrixAt(i, m));
            im.instanceMatrix.needsUpdate = true;
            im.computeBoundingBox();
            im.computeBoundingSphere();
          }}
        />
      ));
    });

  return (
    <group position={[0, floorY, 0]}>
      {geos.top && <mesh geometry={geos.top} material={mats.top} receiveShadow frustumCulled={false} />}
      {geos.sides.map(([k, g]) => {
        const m = mats.sides.get(k);
        return m ? <mesh key={k} geometry={g} material={m} receiveShadow frustumCulled={false} /> : null;
      })}
      {water && mats.water && <WaterPlane material={mats.water} sea={water.sea} />}
      {renderInst(veg.trees.map((t) => t.parts), treeInst, "t")}
      {renderInst(veg.plants.map((p) => p.parts), plantInst, "p")}
      {renderInst(veg.props.map((p) => p.parts), propInst, "r")}
      {renderInst(veg.ground.map((g) => [g]), groundInst, "g")}
    </group>
  );
}
