import { useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { AdaptiveDpr, OrbitControls, PerformanceMonitor } from "@react-three/drei";
import { EffectComposer, N8AO, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { type BlockInfo, type StoredModel, type StoredVoxel } from "@/lib/api";
import { useCubeTextures } from "@/lib/useCubeTextures";
import { cubeMaterial } from "@/lib/cubeMaterial";
import { useBlockModel } from "@/lib/useBlockModel";
import { resolveBlock, isMarkerName, parseBlockName } from "@/lib/resolveBlock";
import { applyWindSway, applyWaterWave } from "@/lib/sceneAnimation";
import { SceneClock } from "@/components/SceneClock";
import { SkyDome } from "@/components/SkyDome";
import { BiomeEnvironment } from "@/components/BiomeEnvironment";
import { BIOMES, biomeById, RELIEFS, type Relief } from "@/lib/biomes";
import { BlockLights } from "@/components/BlockLights";
import { lightSources } from "@/lib/lightSources";
import { makeRoofGeometry } from "@/lib/wedge";
import { makeFenceGeometry, isFenceName, isWallName, connectionMask } from "@/lib/fence";
import { disposeMaterial } from "@/lib/threeDispose";
import { selectTextureVariant, textureVariantAt } from "@/lib/blockTextureVariant";
import { VoxelInstances } from "@/components/VoxelInstances";
import { ShadowScheduler } from "@/components/RenderPerformance";
import { useVoxelRenderBake } from "@/lib/useVoxelRenderBake";
import type { BakeGroup } from "@/lib/voxelBakeProtocol";
import { SceneViewPopover } from "@/components/SceneViewPopover";

type Center = [number, number, number];
type Kind = "solid" | "highlight" | "ghost";

function centerOf(blocks: StoredVoxel[]): Center {
  if (blocks.length === 0) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of blocks) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y); minZ = Math.min(minZ, b.z);
    maxX = Math.max(maxX, b.x); maxY = Math.max(maxY, b.y); maxZ = Math.max(maxZ, b.z);
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
}

function BlockGroup({
  name,
  blocks,
  center,
  catalog,
  kind,
  lightColors,
  smoothGeometry,
  textureVariant,
}: {
  name: string;
  blocks: StoredVoxel[];
  center: Center;
  catalog: Map<string, BlockInfo>;
  kind: Kind;
  lightColors?: Map<string, [number, number, number]>;
  smoothGeometry?: THREE.BufferGeometry;
  textureVariant: number;
}) {
  const spec = useMemo(() => resolveBlock(catalog, name), [catalog, name]);
  // Los bloques con modelo (muebles, plantas, escalones/tejados con estado…) usan su
  // modelo 3D real, salvo en modo fantasma (donde basta una silueta de cubo).
  // También cargamos el modelo en fantasma: una cama, puerta o banco multicelda debe
  // conservar su silueta real en la guía, no degradarse a un cubo engañoso.
  const model = useBlockModel(spec.modelPath, spec.modelTexture, true);
  const selectedTextures = useMemo(
    () => selectTextureVariant(spec.cubeTextures, textureVariant),
    [spec.cubeTextures, textureVariant],
  );
  const faces = useCubeTextures(selectedTextures, kind !== "ghost" && !model);
  // Tejados degradados → losa de pendiente / esquina hip limpia; el resto → cubo.
  const geometry = useMemo(
    () =>
      spec.wedge && kind !== "ghost" ? makeRoofGeometry(spec.roofShape) : new THREE.BoxGeometry(1, 1, 1),
    [spec.wedge, spec.roofShape, kind],
  );

  const material = useMemo(() => {
    if (kind === "ghost") {
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color("#5fd089"),
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
        roughness: 1,
        side: THREE.DoubleSide,
      });
    }
    if (model) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
      m.map = model.texture;
      m.alphaTest = 0.5;
      m.alphaToCoverage = true; // suaviza el borde de recorte (cristal/ventanas/hojas) → sin dentado/tiriteo
      // `doubleSided` se resuelve por forma al generar la geometría; no debe aplicarse al
      // modelo entero porque deja visibles caras internas (especialmente en tejados).
      m.side = THREE.FrontSide;
      // Solo los decals finos necesitan desempatarse de una pared coplanar. El resto de modelos
      // y los tejados conservan su profundidad real, sin desplazamientos dependientes de cámara.
      const thin = spec.sway || /web|ivy|moss|banner|sign|vine/i.test(spec.block?.name ?? "");
      if (thin) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = 0;
        m.polygonOffsetUnits = -4;
      }
      if (spec.tint) m.color = new THREE.Color(spec.tint);
      if (model.emissiveTex && !spec.light) {
        // Capa _emissive de Hytale: brilla aunque el bloque esté en sombra (cristales/runas).
        m.emissiveMap = model.emissiveTex;
        m.emissive = new THREE.Color("#ffffff");
        m.emissiveIntensity = 1.4;
      }
      if (spec.light) {
        m.emissiveMap = model.texture;
        m.emissive = new THREE.Color("#ffffff");
        m.emissiveIntensity = 1.6;
      }
      if (spec.sway && kind !== "highlight") applyWindSway(m); // follaje que se mece
      if (kind === "highlight") {
        m.emissive = new THREE.Color("#3fae6b");
        m.emissiveIntensity = 0.55;
      }
      return m;
    }
    const cube = cubeMaterial(faces, {
      color: spec.color,
      highlight: kind === "highlight",
      light: spec.light,
      cutout: spec.cutout,
      translucent: spec.translucent,
    });
    // La cuña no es un volumen cerrado: doble cara para que no desaparezcan triángulos.
    if (spec.wedge && cube instanceof THREE.Material) {
      cube.side = THREE.DoubleSide;
    }
    // (kind ya no es "ghost" aquí: se devolvió antes). Cubos rectos → malla fusionada con
    // SMOOTH LIGHTING por vértice (color por vértice). Las CUÑAS (tejados) NO: mantienen su
    // forma e instanciado, con luz por bloque vía instanceColor.
    for (const mm of Array.isArray(cube) ? cube : [cube]) {
      if (!spec.wedge) mm.vertexColors = true;
      if (kind !== "highlight") {
        if (spec.sway) applyWindSway(mm);
        if (spec.fluid) applyWaterWave(mm);
      }
    }
    return cube;
  }, [faces, model, spec, kind]);

  const emissiveMat = useMemo(() => {
    if (!model?.emissive) return null;
    const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    m.map = model.texture;
    m.emissiveMap = model.texture;
    m.emissive = new THREE.Color("#ffffff");
    m.emissiveIntensity = 1.8; // partes emisivas del modelo (vidrio/gema) → brillan + bloom
    m.alphaTest = 0.5;
    m.side = THREE.FrontSide;
    return m;
  }, [model]);

  // Formas `flat`/NoShading (paja, tela, follaje): SIN iluminación, textura plana tal
  // cual (con su sombreado ya pintado). Igual que en Hytale; ni negro ni brillante.
  const flatMat = useMemo(() => {
    if (!model?.flat) return null;
    // `flat` es un contrato del asset, no una sugerencia: también el follaje `_GS` sigue
    // siendo plano y únicamente recibe su tinte base. Multiplicarlo además por luz voxel o
    // `instanceColor` oscurecía la paja oficial y dejaba ver el armazón como triángulos negros.
    const m = new THREE.MeshBasicMaterial({ map: model.texture });
    m.alphaTest = 0.5;
    m.side = THREE.FrontSide;
    if (spec.tint) m.color = new THREE.Color(spec.tint);
    if (kind === "highlight") m.color = new THREE.Color("#9fe0bb");
    if (spec.sway && kind !== "highlight") applyWindSway(m); // follaje plano se mece
    return m;
  }, [model, spec, kind]);

  const reflectiveMat = useMemo(() => {
    if (!model?.reflective) return null;
    const m = new THREE.MeshPhysicalMaterial({
      map: model.texture,
      roughness: 0.18,
      metalness: 0.35,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
    m.alphaTest = 0.5;
    m.alphaToCoverage = true;
    m.side = THREE.FrontSide;
    if (spec.tint) m.color = new THREE.Color(spec.tint);
    if (kind === "highlight") {
      m.emissive = new THREE.Color("#3fae6b");
      m.emissiveIntensity = 0.35;
    }
    return m;
  }, [model, spec, kind]);

  const smoothGeo = kind !== "ghost" && !model && !spec.wedge ? smoothGeometry ?? null : null;

  // Libera materiales/geometría propios al recrearse o desmontar (evita fuga de GPU al
  // navegar entre builds; texturas y geometrías de modelo se cachean por separado).
  useEffect(() => () => disposeMaterial(material), [material]);
  useEffect(() => () => emissiveMat?.dispose(), [emissiveMat]);
  useEffect(() => () => flatMat?.dispose(), [flatMat]);
  useEffect(() => () => reflectiveMat?.dispose(), [reflectiveMat]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  if (blocks.length === 0) return null;

  // Modelos reales: INSTANCIADOS por bucket (1 draw call por bucket, no 1 mesh por bloque).
  // Antes cada modelo (tejado/mueble/planta) era un mesh suelto → miles de draw calls con
  // builds grandes. El tinte de luz por bloque va por `instanceColor` (prop `color`); la
  // rotación 0-11 por `quaternion`, igual que el path de cubos instanciados.
  if (model && kind === "ghost") {
    const n = blocks.length;
    const geometries = [model.geometry, model.flat, model.reflective, model.emissive].filter(
      (value): value is THREE.BufferGeometry => Boolean(value?.attributes.position),
    );
    return (
      <group>
        {geometries.map((ghostGeometry, geometryIndex) => (
          <VoxelInstances
            key={geometryIndex}
            capacity={n}
            voxels={blocks}
            geometry={ghostGeometry}
            material={material}
            center={center}
            scale={spec.modelScale}
          />
        ))}
      </group>
    );
  }

  if (model) {
    const n = blocks.length;
    return (
      <group>
        {model.geometry.attributes.position && (
          <VoxelInstances
            capacity={n}
            voxels={blocks}
            geometry={model.geometry}
            material={material}
            center={center}
            scale={spec.modelScale}
            colors={lightColors}
            castShadow
            receiveShadow
          />
        )}
        {model.flat && flatMat && (
          <VoxelInstances capacity={n} voxels={blocks} geometry={model.flat} material={flatMat} center={center} scale={spec.modelScale} castShadow />
        )}
        {model.reflective && reflectiveMat && (
          <VoxelInstances
            capacity={n}
            voxels={blocks}
            geometry={model.reflective}
            material={reflectiveMat}
            center={center}
            scale={spec.modelScale}
            castShadow
            receiveShadow
          />
        )}
        {model.emissive && emissiveMat && (
          <VoxelInstances capacity={n} voxels={blocks} geometry={model.emissive} material={emissiveMat} center={center} scale={spec.modelScale} />
        )}
      </group>
    );
  }

  // Cubos sólidos: una sola malla fusionada con smooth lighting por vértice.
  if (smoothGeo) {
    return <mesh geometry={smoothGeo} material={material} castShadow receiveShadow />;
  }

  // Cuñas (tejados) e instancias fantasma: instanciado con su forma; luz por bloque salvo
  // en fantasma (translúcido).
  return (
    <VoxelInstances
      capacity={Math.max(1, blocks.length)}
      voxels={blocks}
      geometry={geometry}
      material={material}
      center={center}
      colors={kind === "ghost" ? undefined : lightColors}
      castShadow
      receiveShadow
    />
  );
}

/** Vallas/muros conectables: cada voxel se dibuja con poste + barandas hacia sus vecinos
 *  (geometría procedural), uniéndose en T y 4 vías como en Hytale. */
function FenceGroup({
  name,
  blocks,
  center,
  catalog,
  occupied,
  kind,
  lightColors,
}: {
  name: string;
  blocks: StoredVoxel[];
  center: Center;
  catalog: Map<string, BlockInfo>;
  occupied: Map<string, string>;
  kind: Kind;
  lightColors?: Map<string, [number, number, number]>;
}) {
  const spec = useMemo(() => resolveBlock(catalog, name), [catalog, name]);
  const thick = isWallName(name);
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.color ?? "#9b8f80"),
      roughness: 0.9,
      metalness: 0,
    });
    if (kind === "ghost") {
      m.transparent = true;
      m.opacity = 0.14;
      m.depthWrite = false;
    } else if (kind === "highlight") {
      m.emissive = new THREE.Color("#3fae6b");
      m.emissiveIntensity = 0.5;
    }
    return m;
  }, [spec.color, kind]);
  useEffect(() => () => material.dispose(), [material]);

  const buckets = useMemo(() => {
    const next = new Map<number, StoredVoxel[]>();
    for (const block of blocks) {
      const mask = connectionMask(block.x, block.y, block.z, (x, y, z) =>
        occupied.get(`${x},${y},${z}`),
      );
      const bucket = next.get(mask);
      if (bucket) bucket.push(block);
      else next.set(mask, [block]);
    }
    return next;
  }, [blocks, occupied]);

  return (
    <group>
      {[...buckets].map(([mask, bucket]) => (
        <VoxelInstances
          key={mask}
          voxels={bucket}
          geometry={makeFenceGeometry(mask, thick)}
          material={material}
          center={center}
          colors={kind === "ghost" ? undefined : lightColors}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

export function VoxelViewer({
  model,
  catalog,
  visibleUpToPhase,
  highlightPhase = null,
  ghost = false,
  cameraKey,
  layerY = null,
  layerMode = "all",
  focusBlock = null,
  presentation = "build",
}: {
  model: StoredModel;
  catalog: Map<string, BlockInfo>;
  visibleUpToPhase: number;
  /** Resalta los bloques de esta fase (lo que toca colocar ahora). */
  highlightPhase?: number | null;
  /** Muestra las fases futuras como bloques fantasma translúcidos. */
  ghost?: boolean;
  /** Si se indica, recuerda la cámara de esta build entre sesiones (localStorage). */
  cameraKey?: string;
  /** Altura activa para los modos de construcción por capas. */
  layerY?: number | null;
  /** `upTo`: construida hasta Y; `only`: aísla Y; `all`: sin corte vertical. */
  layerMode?: "all" | "upTo" | "only";
  /** Atenúa todo salvo este tipo base de bloque. */
  focusBlock?: string | null;
  /** `object`: encuadre cercano y fondo neutro para inspeccionar un único asset. */
  presentation?: "build" | "object";
}) {
  const isObjectPreview = presentation === "object";
  const center = useMemo(() => centerOf(model.blocks), [model]);
  const floorY = useMemo(() => {
    let minY = Infinity;
    for (const b of model.blocks) if (b.y < minY) minY = b.y;
    return (Number.isFinite(minY) ? minY : 0) - center[1] - 0.5;
  }, [model, center]);
  const [biomeId, setBiomeId] = useState(
    () => localStorage.getItem("vf_viewer_biome") || "plains",
  );
  const [relief, setRelief] = useState<Relief>(
    () => (localStorage.getItem("vf_viewer_relief") as Relief) || "hills",
  );
  const biome = biomeById(isObjectPreview ? "none" : biomeId);
  // Clasificación única para render, conexiones y luz: así una capa futura/aislada nunca
  // influye en vallas o iluminación aunque siga visible como holograma.
  const presented = useMemo(() => {
    const out: { block: StoredVoxel; kind: Kind }[] = [];
    for (const b of model.blocks) {
      if (b.name === "Empty" || isMarkerName(b.name)) continue;
      if (layerMode === "only" && layerY !== null && b.y !== layerY) continue;
      const beyondLayer = layerMode === "upTo" && layerY !== null && b.y > layerY;
      const beyondPhase = b.phase > visibleUpToPhase;
      let kind: Kind;
      if (beyondLayer || beyondPhase) {
        if (!ghost) continue;
        kind = "ghost";
      } else if (highlightPhase !== null && b.phase === highlightPhase) {
        kind = "highlight";
      } else {
        kind = "solid";
      }
      if (focusBlock && parseBlockName(b.name).base !== focusBlock) kind = "ghost";
      out.push({ block: b, kind });
    }
    return out;
  }, [model, visibleUpToPhase, highlightPhase, ghost, layerY, layerMode, focusBlock]);

  // Posiciones ocupadas → nombre (para que las vallas detecten vecinos realmente construidos).
  const occupied = useMemo(() => {
    const map = new Map<string, string>();
    for (const { block, kind } of presented) {
      if (kind !== "ghost") map.set(`${block.x},${block.y},${block.z}`, block.name);
    }
    return map;
  }, [presented]);

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; kind: Kind; textureVariant: number; blocks: StoredVoxel[] }
    >();
    const textureSets = new Map<string, BlockInfo["textures"]>();
    for (const { block: b, kind } of presented) {
      let textures = textureSets.get(b.name);
      if (!textures) {
        textures = resolveBlock(catalog, b.name).cubeTextures;
        textureSets.set(b.name, textures);
      }
      const textureVariant = textureVariantAt(textures, b.x, b.y, b.z);
      const key = `${b.name}#${kind}#${textureVariant}`;
      const g = map.get(key);
      if (g) g.blocks.push(b);
      else map.set(key, { name: b.name, kind, textureVariant, blocks: [b] });
    }
    return map;
  }, [presented]);

  const physicallyVisible = useMemo(
    () => presented.filter((entry) => entry.kind !== "ghost").map((entry) => entry.block),
    [presented],
  );

  // Fuentes de luz visibles (hasta la fase actual) → llama nativa + luces puntuales.
  const litSources = useMemo(
    () => lightSources(physicallyVisible, catalog),
    [physicallyVisible, catalog],
  );
  const bakeGroups = useMemo<BakeGroup[]>(() => {
    const next: BakeGroup[] = [];
    for (const [key, group] of groups) {
      const spec = resolveBlock(catalog, group.name);
      if (group.kind === "ghost" || isFenceName(group.name) || spec.wedge || spec.modelPath) continue;
      next.push({
        key,
        blocks: group.blocks,
        center,
        cullSelf: spec.translucent || spec.fluid,
      });
    }
    return next;
  }, [catalog, center, groups]);
  const baked = useVoxelRenderBake(physicallyVisible, catalog, bakeGroups);
  const currentBake = baked?.snapshot === physicallyVisible ? baked : null;

  const radius = Math.max(model.size[0], model.size[1], model.size[2]) || 10;
  const dist = isObjectPreview ? Math.max(2.7, radius * 2.8) : radius * 1.6 + 6;
  const sh = radius * 1.3 + 4; // mitad del volumen de sombra
  const [resetKey, setResetKey] = useState(0);
  const maxDpr = useMemo(
    () => Math.min(2, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)),
    [],
  );
  const [renderDpr, setRenderDpr] = useState(maxDpr);
  const adaptDpr = useCallback(
    ({ factor }: { factor: number }) => {
      const next = Math.round((1 + (maxDpr - 1) * factor) * 4) / 4;
      setRenderDpr((current) => (Math.abs(current - next) < 0.01 ? current : next));
    },
    [maxDpr],
  );
  const [cameraOverride, setCameraOverride] = useState<{
    pos: [number, number, number];
    target: [number, number, number];
  } | null>(null);

  // Cámara recordada por build (se relee al reiniciar la vista).
  const camStore = cameraKey ? `vf_cam_${cameraKey}` : null;
  const saved = useMemo(() => {
    if (!camStore) return null;
    try {
      const v = JSON.parse(localStorage.getItem(camStore) || "null") as
        | { pos: [number, number, number]; target: [number, number, number] }
        | null;
      // Valida que sean 3+3 números FINITOS: un valor corrupto (NaN/null) dejaría la cámara
      // en NaN → viewport negro sin recuperación salvo «Reiniciar vista».
      const ok3 = (a: unknown): a is [number, number, number] =>
        Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === "number" && Number.isFinite(n));
      return v && ok3(v.pos) && ok3(v.target) ? v : null;
    } catch {
      return null;
    }
  }, [camStore, resetKey]);
  const camPos = cameraOverride?.pos ?? saved?.pos ?? ([dist, dist * 0.75, dist] as [number, number, number]);
  const camTarget = cameraOverride?.target ?? saved?.target ?? ([0, 0, 0] as [number, number, number]);
  const onCamEnd = (e?: { target?: unknown }) => {
    const ctrl = e?.target as { object?: THREE.Camera; target?: THREE.Vector3 } | undefined;
    if (!camStore || !ctrl?.object || !ctrl.target) return;
    const p = ctrl.object.position;
    const t = ctrl.target;
    localStorage.setItem(
      camStore,
      JSON.stringify({ pos: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }),
    );
  };
  const resetView = () => {
    if (camStore) localStorage.removeItem(camStore);
    setCameraOverride(null);
    setResetKey((k) => k + 1);
  };
  const setCameraView = (preset: "iso" | "top" | "front" | "side") => {
    const target: [number, number, number] = [0, 0, 0];
    const pos: [number, number, number] =
      preset === "top"
        ? [0, dist * 1.45, 0.001]
        : preset === "front"
          ? [0, radius * 0.18, dist * 1.25]
          : preset === "side"
            ? [dist * 1.25, radius * 0.18, 0]
            : [dist, dist * 0.75, dist];
    const next = { pos, target };
    setCameraOverride(next);
    if (camStore) localStorage.setItem(camStore, JSON.stringify(next));
    setResetKey((key) => key + 1);
  };

  return (
    <div className="relative h-full w-full">
      <Canvas
        key={resetKey}
        shadows="percentage"
        camera={{
          position: camPos,
          fov: isObjectPreview ? 38 : 50,
          near: isObjectPreview ? 0.05 : 0.8,
          far: 640,
        }}
        dpr={renderDpr}
        performance={{ min: 0.72, max: 1, debounce: 350 }}
        gl={{
          preserveDrawingBuffer: true,
          toneMappingExposure: 1.12,
          antialias: true,
          powerPreference: "high-performance",
        }}
      >
        <color attach="background" args={["#0f1822"]} />
        <PerformanceMonitor
          factor={1}
          step={0.15}
          ms={500}
          iterations={6}
          threshold={0.75}
          flipflops={5}
          bounds={(refreshRate) => (refreshRate > 90 ? [72, 105] : [50, 58])}
          onChange={adaptDpr}
          onFallback={() => setRenderDpr(Math.min(maxDpr, 1.5))}
        />
        <AdaptiveDpr />
        <ShadowScheduler revision={groups} />
        <SceneClock />
        {!isObjectPreview && <SkyDome />}
        {isObjectPreview ? (
          <>
            <fog attach="fog" args={["#0f1822", dist * 2.8, dist * 6]} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, floorY - 0.012, 0]} receiveShadow>
              <planeGeometry args={[Math.max(12, radius * 5), Math.max(12, radius * 5)]} />
              <meshStandardMaterial color="#132230" roughness={1} metalness={0} />
            </mesh>
            <gridHelper
              args={[Math.max(12, radius * 5), Math.max(12, Math.ceil(radius * 5)), "#29445f", "#1b2c3d"]}
              position={[0, floorY, 0]}
            />
          </>
        ) : biome.id !== "none" ? (
          <>
            <fog attach="fog" args={[biome.fog, dist * 1.8 + 8, relief === "flat" ? dist * 4.5 + 24 : 330]} />
            <BiomeEnvironment biome={biome} relief={relief} floorY={floorY} clearRadius={radius * 0.5 + 4} catalog={catalog} />
          </>
        ) : (
          <fog attach="fog" args={["#2a3a4e", dist * 2.2, dist * 5]} />
        )}
        {/* Estilo ILUSTRACIÓN de Hytale: las texturas ya traen la luz/AO pintados, así
            que la textura manda (ambiente alto) y la luz direccional + AO son SUTILES,
            solo para dar volumen. Nada de PBR fuerte (eso oscurece y embarra todo). */}
        <hemisphereLight args={["#dbe6f2", "#5a5040", 0.62]} />
        <ambientLight intensity={1.32} />
        <directionalLight
          position={[radius * 0.9 + 12, radius * 1.6 + 22, radius * 0.6 + 10]}
          intensity={0.6}
          color="#fff4e0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.06}
          shadow-camera-near={1}
          shadow-camera-far={radius * 6 + 40}
          shadow-camera-left={-sh}
          shadow-camera-right={sh}
          shadow-camera-top={sh}
          shadow-camera-bottom={-sh}
        />
        <directionalLight position={[-18, 14, -14]} intensity={0.18} color="#cdddf0" />
        {/* Iluminación realista: llama nativa + charco de luz cálido por antorcha/farol. */}
        <BlockLights sources={litSources} />
        <group>
          {Array.from(groups.entries()).map(([key, g]) =>
            isFenceName(g.name) && g.kind !== "ghost" ? (
              <FenceGroup
                key={key}
                name={g.name}
                blocks={g.blocks}
                center={center}
                catalog={catalog}
                occupied={occupied}
                kind={g.kind}
                lightColors={currentBake?.colors}
              />
            ) : (
              <BlockGroup
                key={key}
                name={g.name}
                blocks={g.blocks}
                center={center}
                catalog={catalog}
                kind={g.kind}
                lightColors={currentBake?.colors}
                smoothGeometry={currentBake?.geometries.get(key)}
                textureVariant={g.textureVariant}
              />
            ),
          )}
        </group>
        <OrbitControls
          makeDefault
          regress
          enableDamping
          target={camTarget}
          onEnd={onCamEnd}
          minDistance={isObjectPreview ? Math.max(1.1, radius * 0.9) : undefined}
          maxDistance={isObjectPreview ? Math.max(9, radius * 7) : undefined}
          minPolarAngle={isObjectPreview ? Math.PI * 0.06 : 0}
          maxPolarAngle={isObjectPreview ? Math.PI * 0.49 : Math.PI}
        />
        {/* AO MUY sutil (el grueso de la oclusión ya va pintado en las texturas de
            Hytale); solo un toque en grietas para dar profundidad sin embarrar. */}
        <EffectComposer multisampling={4}>
          <N8AO
            aoRadius={0.6}
            distanceFalloff={1}
            intensity={0.7}
            quality="high"
            halfRes
            depthAwareUpsampling
          />
          <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.3} intensity={0.85} radius={0.7} />
        </EffectComposer>
      </Canvas>
      {(layerMode !== "all" || focusBlock) && (
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          {layerMode !== "all" && layerY !== null && (
            <span className="rounded-md border border-accent/50 bg-surface-2/90 px-2.5 py-1.5 text-xs text-accent-hi shadow backdrop-blur">
              {layerMode === "only" ? "Solo capa" : "Construido hasta"} Y {layerY}
            </span>
          )}
          {focusBlock && (
            <span className="max-w-60 truncate rounded-md border border-accent/50 bg-surface-2/90 px-2.5 py-1.5 text-xs text-accent-hi shadow backdrop-blur">
              Foco: {catalog.get(focusBlock)?.display_name ?? focusBlock}
            </span>
          )}
        </div>
      )}
      <div className="absolute right-3 top-3 z-30">
        <SceneViewPopover
          presets={([
            ["iso", "Isométrica"],
            ["top", "Superior"],
            ["front", "Frontal"],
            ["side", "Lateral"],
          ] as const).map(([preset, label]) => ({
            id: preset,
            label,
            onSelect: () => setCameraView(preset),
          }))}
          onReset={resetView}
        >
          {!isObjectPreview && (
            <section aria-labelledby="viewer-environment">
              <h3 id="viewer-environment" className="mb-2 px-2 text-xs font-semibold text-ink">
                Entorno
              </h3>
              <label className="block px-2 text-xs text-muted">
                Bioma de previsualización
                <select
                  value={biomeId}
                  onChange={(event) => {
                    setBiomeId(event.target.value);
                    try {
                      localStorage.setItem("vf_viewer_biome", event.target.value);
                    } catch {
                      /* almacenamiento no disponible */
                    }
                  }}
                  className="mt-1 min-h-10 w-full cursor-pointer rounded-md border border-line bg-surface-2 px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {BIOMES.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              {biome.id !== "none" && (
                <label className="mt-2 block px-2 text-xs text-muted">
                  Relieve
                  <select
                    value={relief}
                    onChange={(event) => {
                      setRelief(event.target.value as Relief);
                      try {
                        localStorage.setItem("vf_viewer_relief", event.target.value);
                      } catch {
                        /* almacenamiento no disponible */
                      }
                    }}
                    className="mt-1 min-h-10 w-full cursor-pointer rounded-md border border-line bg-surface-2 px-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    {RELIEFS.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          )}
        </SceneViewPopover>
      </div>
    </div>
  );
}
