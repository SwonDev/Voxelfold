import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  AdaptiveDpr,
  GizmoHelper,
  GizmoViewport,
  Grid,
  Html,
  Instance,
  Instances,
  OrbitControls,
  PerformanceMonitor,
} from "@react-three/drei";
import { EffectComposer, N8AO, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { type BlockInfo } from "@/lib/api";
import { useCubeTextures } from "@/lib/useCubeTextures";
import { cubeMaterial } from "@/lib/cubeMaterial";
import { useBlockModel } from "@/lib/useBlockModel";
import { resolveBlock } from "@/lib/resolveBlock";
import { applyWindSway, applyWaterWave, cloneMaterialWithEffects } from "@/lib/sceneAnimation";
import { SceneClock } from "@/components/SceneClock";
import { SkyDome } from "@/components/SkyDome";
import { BiomeEnvironment } from "@/components/BiomeEnvironment";
import { BIOMES, biomeById, RELIEFS, type Relief } from "@/lib/biomes";
import { BlockLights } from "@/components/BlockLights";
import { lightSources } from "@/lib/lightSources";
import { orientationQuat } from "@/lib/orientation";
import { isOrientableName, suggestRotation } from "@/lib/autoOrient";
import { makeRoofGeometry } from "@/lib/wedge";
import { makeFenceGeometry, isFenceName, isWallName, connectionMask } from "@/lib/fence";
import { brushCells, fillCells, lineCells, rectCells, type Cell } from "@/lib/editorOps";
import { type Clipboard, type SelBox } from "@/lib/selectionOps";
import { disposeMaterial } from "@/lib/threeDispose";
import { selectTextureVariant, textureVariantAt } from "@/lib/blockTextureVariant";
import { useVoxelRenderBake } from "@/lib/useVoxelRenderBake";
import type { BakeGroup } from "@/lib/voxelBakeProtocol";
import { VoxelInstances } from "@/components/VoxelInstances";
import { RenderStats, ShadowScheduler } from "@/components/RenderPerformance";
import { SceneViewPopover, SceneViewToggle } from "@/components/SceneViewPopover";
import { toast } from "@/lib/toast";

export interface EditorVoxel {
  x: number;
  y: number;
  z: number;
  name: string;
  phase: number;
  /** Orientación Hytale codificada (0-63: rotación, eje vertical y volteo). */
  rotation: number;
}

/** Herramienta activa del editor (modos de colocación nativos estilo Hytale). */
export type EditorTool =
  | "place"
  | "eraser"
  | "replace"
  | "eyedrop"
  | "paint"
  | "line"
  | "rect"
  | "fill"
  | "brush"
  | "select"
  | "paste";

/** Herramientas de arrastre (definen inicio→fin sobre el plano). */
const DRAG_TOOLS = new Set<EditorTool>(["paint", "line", "rect", "select"]);

/** Opciones de las herramientas de forma. */
export interface OpOptions {
  rectFilled: boolean;
  /** Caja hueca (cáscara: paredes + suelo + techo) cuando no es maciza — como `//hollow`. */
  rectHollow: boolean;
  height: number;
  brushShape: "cube" | "sphere" | "cylinder";
  brushSize: number;
  /** Brocha solo cáscara (grosor de pared 1) — Shape Brush hueco. */
  brushHollow: boolean;
}

const WORLD_LIMIT = 80; // límite de coordenadas para evitar colocaciones absurdas
const PREVIEW_CELL_LIMIT = 4097;
const EDIT_CELL_LIMIT = 100_000;
const DIM_COLOR = new THREE.Color("#58646f");

// Material INVISIBLE para los "pickers" instanciados del editor: no se ven (la malla
// fusionada con smooth lighting es la visual), pero siguen captando clics/hover por voxel
// → la lógica de selección/colocación queda intacta.
const PICKER_MAT = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  colorWrite: false,
});

function centroid(voxels: EditorVoxel[]): [number, number, number] {
  if (voxels.length === 0) return [0, 0, 0];
  let sx = 0, sy = 0, sz = 0;
  for (const v of voxels) {
    sx += v.x; sy += v.y; sz += v.z;
  }
  const n = voxels.length;
  return [sx / n, sy / n, sz / n];
}

interface EditorRenderGroup {
  name: string;
  phase: number;
  textureVariant: number;
  voxels: EditorVoxel[];
}

function groupEditorVoxels(
  voxels: EditorVoxel[],
  catalog: Map<string, BlockInfo>,
): Map<string, EditorRenderGroup> {
  const map = new Map<string, EditorRenderGroup>();
  const textureSets = new Map<string, BlockInfo["textures"]>();
  for (const voxel of voxels) {
    let textures = textureSets.get(voxel.name);
    if (!textures) {
      textures = resolveBlock(catalog, voxel.name).cubeTextures;
      textureSets.set(voxel.name, textures);
    }
    const textureVariant = textureVariantAt(textures, voxel.x, voxel.y, voxel.z);
    const key = `${voxel.name}#${voxel.phase}#${textureVariant}`;
    const group = map.get(key);
    if (group) group.voxels.push(voxel);
    else map.set(key, {
      name: voxel.name,
      phase: voxel.phase,
      textureVariant,
      voxels: [voxel],
    });
  }
  return map;
}

type PlaceFn = (x: number, y: number, z: number, rot?: number) => void;

function EditorBlocks({
  name,
  voxels,
  geometry,
  catalog,
  dimmed,
  models,
  occupied,
  lightColors,
  smoothGeometry,
  textureVariant,
  onDown,
  onUpVoxel,
  onMoveVoxel,
}: {
  name: string;
  voxels: EditorVoxel[];
  geometry: THREE.BoxGeometry;
  catalog: Map<string, BlockInfo>;
  dimmed: boolean;
  models: boolean;
  occupied: Map<string, string>;
  lightColors?: Map<string, [number, number, number]>;
  /** Malla fusionada ya horneada en el Web Worker para este bucket. */
  smoothGeometry?: THREE.BufferGeometry;
  /** Entrada ponderada de `Textures` elegida de forma estable para estas celdas. */
  textureVariant: number;
  onDown: (e: ThreeEvent<PointerEvent>) => void;
  onUpVoxel: (e: ThreeEvent<PointerEvent>, v: EditorVoxel) => void;
  onMoveVoxel: (e: ThreeEvent<PointerEvent>, v: EditorVoxel) => void;
}) {
  const spec = useMemo(() => resolveBlock(catalog, name), [catalog, name]);
  // Capacidad MONÓTONA del búfer de instancias (debe declararse aquí arriba, antes de cualquier
  // return temprano: es un hook). Crece a saltos grandes con holgura → casi nunca remonta.
  const capRef = useRef(0);
  const fence = isFenceName(name);
  const fenceMat = useMemo(() => {
    if (!fence) return null;
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(spec.color ?? "#9b8f80"),
      roughness: 0.9,
      metalness: 0,
    });
    if (dimmed) {
      // Atenuado OPACO: evita los cambios de orden de las miles de caras transparentes
      // que causaban parpadeo al orbitar, manteniendo legible el contexto de otras fases.
      m.color.multiply(DIM_COLOR);
    }
    return m;
  }, [fence, spec.color, dimmed]);
  const model = useBlockModel(spec.modelPath, spec.modelTexture, models);
  const selectedTextures = useMemo(
    () => selectTextureVariant(spec.cubeTextures, textureVariant),
    [spec.cubeTextures, textureVariant],
  );
  const faces = useCubeTextures(selectedTextures, !model);

  const material = useMemo(() => {
    // Render NATIVO (sin teñir por fase): los bloques se ven como en Hytale. La fase
    // se distingue con el selector "Fase activa" y "Atenuar otras" (que atenúa el resto).
    if (model) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      m.map = model.texture;
      m.alphaTest = 0.5;
      m.alphaToCoverage = true; // suaviza el borde de recorte (cristal/hojas/ventanas) → sin dentado/tiriteo
      // Los `.blockymodel` codifican `doubleSided` por forma. El cargador duplica solo esas
      // caras; el resto debe conservar el culling frontal de Hytale para ocultar interiores.
      m.side = THREE.FrontSide;
      // Solo los decals planos necesitan ganar a una pared coplanar. Tejados, muebles y demás
      // modelos son geometría real y no deben desplazarse artificialmente en profundidad.
      const thin = spec.sway || /web|ivy|moss|banner|sign|vine/i.test(spec.block?.name ?? "");
      if (thin) {
        m.polygonOffset = true;
        m.polygonOffsetFactor = 0;
        m.polygonOffsetUnits = -4;
      }
      if (spec.tint) m.color = new THREE.Color(spec.tint);
      if (model.emissiveTex && !spec.light) {
        // Capa _emissive de Hytale: brilla aunque esté en sombra (cristales/runas).
        m.emissiveMap = model.emissiveTex;
        m.emissive = new THREE.Color("#ffffff");
        m.emissiveIntensity = 1.4;
      }
      if (spec.light) {
        m.emissiveMap = model.texture;
        m.emissive = new THREE.Color("#ffffff");
        m.emissiveIntensity = 1.6;
      }
      if (spec.sway) applyWindSway(m); // follaje que se mece
      if (dimmed) {
        m.color.multiply(DIM_COLOR);
        m.emissiveIntensity *= 0.22;
      }
      return m;
    }
    const cube = cubeMaterial(faces, {
      color: spec.color,
      multiply: dimmed ? "#58646f" : undefined,
      light: spec.light,
      cutout: spec.cutout,
      translucent: spec.translucent,
    });
    if (spec.wedge && cube instanceof THREE.Material) {
      cube.side = THREE.DoubleSide;
    }
    // Material INSTANCIADO (rápido, color por bloque via instanceColor): se usa durante la
    // edición y para cuñas. NO lleva vertexColors (eso es del material smooth, ver abajo).
    for (const mm of Array.isArray(cube) ? cube : [cube]) {
      if (spec.sway) applyWindSway(mm);
      if (spec.fluid) applyWaterWave(mm);
    }
    return cube;
  }, [faces, model, spec, dimmed]);

  // Material SMOOTH (clon con vertexColors): para la malla fusionada con smooth lighting
  // (solo cubos rectos). Comparte texturas y los shaders inyectados (sway/flicker/agua).
  const smoothMat = useMemo(() => {
    if (model || spec.wedge) return null;
    const tint = (m: THREE.Material) => {
      const c = cloneMaterialWithEffects(m);
      (c as THREE.MeshStandardMaterial).vertexColors = true;
      return c;
    };
    return Array.isArray(material) ? material.map(tint) : tint(material);
  }, [material, model, spec.wedge]);

  // Tejados degradados → losa de pendiente / esquina hip limpia; el resto → cubo / modelo.
  const wedgeGeo = useMemo(
    () => (spec.wedge ? makeRoofGeometry(spec.roofShape) : null),
    [spec.wedge, spec.roofShape],
  );
  const geom = model ? model.geometry : wedgeGeo ?? geometry;
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
  // Formas `flat`/NoShading: el asset exige textura plana sin luz. Las texturas `_GS`
  // únicamente reciben el tinte base; nunca luz voxel ni `instanceColor` adicional.
  const flatMat = useMemo(() => {
    if (!model?.flat) return null;
    const m = new THREE.MeshBasicMaterial({ map: model.texture });
    m.alphaTest = 0.5;
    m.side = THREE.FrontSide;
    if (spec.tint) m.color = new THREE.Color(spec.tint);
    if (spec.sway) applyWindSway(m); // follaje plano (hierba alta, helechos…) se mece
    if (dimmed) {
      m.color.multiply(DIM_COLOR);
    }
    return m;
  }, [model, spec, dimmed]);
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
    if (dimmed) m.color.multiply(DIM_COLOR);
    return m;
  }, [model, spec, dimmed]);

  // La malla smooth llega ya horneada desde un Web Worker. Conservamos siempre el último
  // resultado válido mientras se prepara el siguiente: sustituir toda la escena por el render
  // instanciado al hacer clic cambiaba bruscamente el material, la luz y el AO durante unos
  // milisegundos. Los pickers invisibles siguen usando los voxels en vivo, por lo que la
  // interacción no espera al horneado.
  const smoothGeo = !model && !spec.wedge ? smoothGeometry ?? null : null;
  useEffect(
    () => () => {
      if (smoothMat) (Array.isArray(smoothMat) ? smoothMat : [smoothMat]).forEach((m) => m.dispose());
    },
    [smoothMat],
  );

  // Libera materiales/geometría propios al recrearse o desmontar (evita fuga de GPU
  // al alternar fase/atenuado o editar; las texturas y geometrías de modelo se cachean aparte).
  useEffect(() => () => disposeMaterial(material), [material]);
  useEffect(() => () => fenceMat?.dispose(), [fenceMat]);
  useEffect(() => () => emissiveMat?.dispose(), [emissiveMat]);
  useEffect(() => () => flatMat?.dispose(), [flatMat]);
  useEffect(() => () => reflectiveMat?.dispose(), [reflectiveMat]);
  useEffect(() => () => wedgeGeo?.dispose(), [wedgeGeo]);
  // Vallas/muros: como máximo 16 instancias estáticas (una por máscara de conexión), en vez
  // de un mesh y un draw call por bloque.
  if (fence && fenceMat) {
    const buckets = new Map<number, EditorVoxel[]>();
    for (const voxel of voxels) {
      const mask = connectionMask(voxel.x, voxel.y, voxel.z, (x, y, z) =>
        occupied.get(`${x},${y},${z}`),
      );
      const bucket = buckets.get(mask);
      if (bucket) bucket.push(voxel);
      else buckets.set(mask, [voxel]);
    }
    return (
      <>
        {[...buckets].map(([mask, bucket]) => (
          <VoxelInstances
            key={mask}
            voxels={bucket}
            geometry={makeFenceGeometry(mask, isWallName(name))}
            material={fenceMat}
            colors={lightColors}
            castShadow
            receiveShadow
            interactive
            onPointerDown={onDown}
            onPointerUp={onUpVoxel}
            onPointerMove={onMoveVoxel}
          />
        ))}
      </>
    );
  }

  // Modelos 3D reales (muebles, plantas, tejados, escaleras, losas…): INSTANCIADOS por bucket
  // (std/flat/emissive), igual que los cubos → 1 draw call por bucket en vez de un mesh por
  // bloque. Eran la mayor fuente de draw calls en builds grandes (miles de meshes sueltos). El
  // bucket std capta los clics por instancia (picking intacto); flat/emissive no llevan handlers.
  if (model) {
    if (voxels.length > capRef.current) {
      capRef.current = (Math.floor(voxels.length / 1024) + 2) * 1024;
    }
    const cap = capRef.current;
    return (
      <>
        <VoxelInstances
          key={cap}
          capacity={cap}
          voxels={voxels}
          geometry={geom}
          material={material}
          scale={spec.modelScale}
          colors={lightColors}
          castShadow
          receiveShadow
          interactive
          onPointerDown={onDown}
          onPointerUp={onUpVoxel}
          onPointerMove={onMoveVoxel}
        />
        {model.flat && flatMat && (
          <VoxelInstances key={`f${cap}`} capacity={cap} voxels={voxels} geometry={model.flat} material={flatMat} scale={spec.modelScale} castShadow />
        )}
        {model.reflective && reflectiveMat && (
          <VoxelInstances
            key={`r${cap}`}
            capacity={cap}
            voxels={voxels}
            geometry={model.reflective}
            material={reflectiveMat}
            scale={spec.modelScale}
            castShadow
            receiveShadow
          />
        )}
        {model.emissive && emissiveMat && (
          <VoxelInstances key={`e${cap}`} capacity={cap} voxels={voxels} geometry={model.emissive} material={emissiveMat} scale={spec.modelScale} />
        )}
      </>
    );
  }

  // Cubos / cuñas (la inmensa mayoría) → INSTANCING: un solo draw call por grupo
  // nombre#fase en vez de un mesh por bloque. Permite miles de bloques con sombras/AO.
  // `limit` se reserva en bloques de 256 con holgura: así al COLOCAR (crece voxels) el
  // buffer nunca se queda corto (evita el error glDrawElementsInstanced) y casi no se recrea.
  // Capacidad del búfer de instancias. Cambiar `cap` REMONTA el <Instances> (parpadeo), así que
  // crece SOLO al alza y en saltos grandes con holgura amplia (≈1024-2048): durante un arrastre
  // largo y rápido no se cruza ningún límite → sin parpadeo. Antes saltaba cada 256 → remontaba y
  // parpadeaba al colocar deprisa. Monótono: no encoge al borrar (sobra-reservar es inocuo).
  if (voxels.length > capRef.current) {
    capRef.current = (Math.floor(voxels.length / 1024) + 2) * 1024;
  }
  const cap = capRef.current;
  // Las instancias captan los clics/hover por voxel (selección/colocación intacta). Si hay
  // malla smooth (cubos rectos), las instancias van INVISIBLES (PICKER_MAT) y la malla
  // fusionada es la visual; si no (cuñas), las instancias se ven con color por bloque.
  return (
    <>
      {smoothGeo && (
        <mesh
          geometry={smoothGeo}
          material={smoothMat ?? material}
          castShadow
          receiveShadow
          raycast={() => null}
        />
      )}
      <VoxelInstances
        key={cap}
        capacity={cap}
        voxels={voxels}
        geometry={geom}
        material={smoothGeo ? PICKER_MAT : material}
        colors={smoothGeo ? undefined : lightColors}
        layer={smoothGeo ? 1 : 0}
        castShadow={!smoothGeo}
        receiveShadow={!smoothGeo}
        interactive
        onPointerDown={onDown}
        onPointerUp={onUpVoxel}
        onPointerMove={onMoveVoxel}
      />
    </>
  );
}

/** Previsualización del bloque REAL que se va a colocar (translúcido, en la celda). */
function HoverPreview({
  name,
  position,
  rotation,
  catalog,
  models,
}: {
  name: string;
  position: [number, number, number];
  rotation: number;
  catalog: Map<string, BlockInfo>;
  models: boolean;
}) {
  const spec = useMemo(() => resolveBlock(catalog, name), [catalog, name]);
  const model = useBlockModel(spec.modelPath, spec.modelTexture, models);
  const textureVariant = textureVariantAt(spec.cubeTextures, position[0], position[1], position[2]);
  const selectedTextures = useMemo(
    () => selectTextureVariant(spec.cubeTextures, textureVariant),
    [spec.cubeTextures, textureVariant],
  );
  const faces = useCubeTextures(selectedTextures, !model);
  const fallbackGeo = useMemo(
    () => (spec.wedge ? makeRoofGeometry(spec.roofShape) : new THREE.BoxGeometry(1, 1, 1)),
    [spec.wedge, spec.roofShape],
  );
  const material = useMemo(() => {
    if (model) {
      const m = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      m.map = model.texture;
      m.transparent = true;
      m.opacity = 0.6;
      m.depthWrite = false;
      m.alphaTest = 0.5;
      m.side = THREE.FrontSide;
      m.emissive = new THREE.Color("#3fae6b");
      m.emissiveIntensity = 0.2;
      return m;
    }
    const cube = cubeMaterial(faces, { color: spec.color, multiply: "#bfe8cf", opacity: 0.6 });
    if (spec.wedge && cube instanceof THREE.Material) {
      cube.side = THREE.DoubleSide;
    }
    return cube;
  }, [model, faces, spec]);
  useEffect(() => () => disposeMaterial(material), [material]);
  useEffect(() => () => fallbackGeo.dispose(), [fallbackGeo]);
  return (
    <group
      position={position}
      quaternion={orientationQuat(rotation)}
      scale={model ? spec.modelScale : 1}
    >
      {model ? (
        // Dibuja los TRES buckets del modelo (standard + flat + emissive). Antorchas,
        // velas y faroles tienen su geometría visible en flat/emissive (el bucket standard
        // está vacío) → si solo se dibujara model.geometry la preview sería invisible.
        <>
          <mesh geometry={model.geometry} material={material} raycast={() => null} />
          {model.flat && <mesh geometry={model.flat} material={material} raycast={() => null} />}
          {model.reflective && (
            <mesh geometry={model.reflective} material={material} raycast={() => null} />
          )}
          {model.emissive && (
            <mesh geometry={model.emissive} material={material} raycast={() => null} />
          )}
        </>
      ) : (
        <mesh geometry={fallbackGeo} material={material} raycast={() => null} />
      )}
    </group>
  );
}

// Vectores reutilizables para la navegación con teclado (evita asignar en cada frame).
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Celda adyacente a la CARA apuntada. La normal de la cara llega en espacio LOCAL de la
// geometría; la giramos por la orientación REAL del voxel (rotation 0-63) para obtener la
// dirección en mundo. Así el snap es correcto aunque el bloque esté rotado/acostado, y
// funciona igual con meshes individuales o con instancing (donde matrixWorld no sirve).
const _nVec = new THREE.Vector3();
const _qRot = new THREE.Quaternion();
function adjacentCell(e: ThreeEvent<PointerEvent>, v: EditorVoxel): Cell | null {
  const n = e.face?.normal;
  if (!n) return null;
  const [qx, qy, qz, qw] = orientationQuat(v.rotation);
  _qRot.set(qx, qy, qz, qw);
  _nVec.copy(n).applyQuaternion(_qRot);
  return { x: v.x + Math.round(_nVec.x), y: v.y + Math.round(_nVec.y), z: v.z + Math.round(_nVec.z) };
}

/**
 * Gestor de arrastre para herramientas de forma (línea/caja/pincel libre). Calcula la
 * celda bajo el cursor por intersección con un plano matemático a la altura `groundY`
 * (robusto aunque el cursor pase sobre bloques), muestra la previsualización y, al
 * soltar, confirma en lote. El botón izquierdo pinta; el derecho gira la cámara.
 */
function DragController({
  tool,
  groundY,
  ops,
  onPaint,
  onSelectBox,
  setPreview,
}: {
  tool: EditorTool;
  groundY: number;
  ops: OpOptions;
  onPaint?: (cells: Cell[], erase: boolean) => void;
  onSelectBox?: (a: Cell, b: Cell) => void;
  setPreview: (p: { cells: Cell[]; kind: "place" | "erase" | "select" } | null) => void;
}) {
  const { camera, gl, raycaster } = useThree();
  const start = useRef<Cell | null>(null);
  const accum = useRef<Map<string, Cell>>(new Map());

  useEffect(() => {
    const el = gl.domElement;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
    const ndc = new THREE.Vector2();
    const pt = new THREE.Vector3();
    let moveFrame = 0;
    let pendingMove: { x: number; y: number; erase: boolean } | null = null;
    let lastPreview = "";
    const cellAt = (cx: number, cy: number): Cell | null => {
      const r = el.getBoundingClientRect();
      ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (!raycaster.ray.intersectPlane(plane, pt)) return null;
      return { x: Math.round(pt.x), y: groundY, z: Math.round(pt.z) };
    };
    const compute = (a: Cell, b: Cell, limit = PREVIEW_CELL_LIMIT): Cell[] => {
      const clampAxis = (value: number) => Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, value));
      const from = { x: clampAxis(a.x), y: clampAxis(a.y), z: clampAxis(a.z) };
      const to = { x: clampAxis(b.x), y: clampAxis(b.y), z: clampAxis(b.z) };
      const height = Math.max(1, Math.min(ops.height, WORLD_LIMIT - from.y + 1));
      if (tool === "select") return rectCells(from, to, true, 1, false, limit); // huella para previsualizar
      if (tool === "line") {
        const base = lineCells(from, to);
        if (height <= 1) return base.slice(0, limit);
        const out: Cell[] = []; // línea con altura = muro
        for (let dy = 0; dy < height; dy++) {
          for (const c of base) {
            out.push({ x: c.x, y: c.y + dy, z: c.z });
            if (out.length >= limit) return out;
          }
        }
        return out;
      }
      if (tool === "rect") return rectCells(from, to, ops.rectFilled, height, ops.rectHollow, limit);
      return [...accum.current.values()].slice(0, limit); // paint (a mano alzada)
    };
    const kindOf = (e: PointerEvent) => (tool === "select" ? "select" : e.shiftKey ? "erase" : "place");
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      start.current = c;
      accum.current = new Map([[`${c.x},${c.z}`, c]]);
      lastPreview = `${c.x},${c.z},${kindOf(e)}`;
      setPreview({ cells: compute(c, c), kind: kindOf(e) });
    };
    const flushMove = () => {
      moveFrame = 0;
      const pending = pendingMove;
      pendingMove = null;
      if (!pending || !start.current) return;
      const c = cellAt(pending.x, pending.y);
      if (!c) return;
      const kind = tool === "select" ? "select" : pending.erase ? "erase" : "place";
      const previewKey = `${c.x},${c.z},${kind}`;
      if (previewKey === lastPreview) return;
      lastPreview = previewKey;
      if (tool === "paint") accum.current.set(`${c.x},${c.z}`, c);
      setPreview({ cells: compute(start.current, c), kind });
    };
    const onMove = (e: PointerEvent) => {
      if (!start.current) return;
      pendingMove = { x: e.clientX, y: e.clientY, erase: e.shiftKey };
      if (!moveFrame) moveFrame = requestAnimationFrame(flushMove);
    };
    const onUp = (e: PointerEvent) => {
      if (!start.current) return;
      if (moveFrame) cancelAnimationFrame(moveFrame);
      moveFrame = 0;
      pendingMove = null;
      const c = cellAt(e.clientX, e.clientY) ?? start.current;
      const a = start.current;
      start.current = null;
      setPreview(null);
      if (tool === "select") {
        onSelectBox?.(a, c);
        return;
      }
      if (tool === "paint") accum.current.set(`${c.x},${c.z}`, c);
      // Recorta al límite del mundo: línea/caja/mano alzada pueden extenderse fuera de ±WORLD_LIMIT.
      const cells = compute(a, c, EDIT_CELL_LIMIT + 1).filter(
        (p) => Math.abs(p.x) <= WORLD_LIMIT && Math.abs(p.y) <= WORLD_LIMIT && Math.abs(p.z) <= WORLD_LIMIT,
      );
      if (cells.length > EDIT_CELL_LIMIT) {
        toast(
          `La operación supera ${EDIT_CELL_LIMIT.toLocaleString("es")} celdas. Reduce el área o la altura para mantener el editor fluido.`,
          "error",
        );
        return;
      }
      if (cells.length) onPaint?.(cells, e.shiftKey);
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moveFrame) cancelAnimationFrame(moveFrame);
      setPreview(null);
    };
  }, [tool, groundY, ops.rectFilled, ops.rectHollow, ops.height, onPaint, onSelectBox, setPreview, camera, gl, raycaster]);

  return null;
}

/** Navegación de cámara con teclado: WASD desplaza (pan horizontal), Q/E baja/sube.
 *  Velocidad proporcional a la distancia. Ignora cuando se escribe en inputs. */
function CameraNav() {
  const { camera, controls, gl, performance: renderPerformance } = useThree();
  const keys = useRef<Set<string>>(new Set());
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if ("wasdqe".includes(k) && k.length === 1) keys.current.add(k);
    };
    const onUp = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const clear = () => keys.current.clear();
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", clear);
    };
  }, [gl]);
  useFrame((_, dt) => {
    const ctl = controls as unknown as { target?: THREE.Vector3 } | null;
    if (!ctl?.target || keys.current.size === 0) return;
    const k = keys.current;
    const speed = Math.max(4, camera.position.distanceTo(ctl.target)) * Math.min(dt, 0.05) * 0.9;
    camera.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _move.set(0, 0, 0);
    if (k.has("w")) _move.add(_fwd);
    if (k.has("s")) _move.sub(_fwd);
    if (k.has("d")) _move.add(_right);
    if (k.has("a")) _move.sub(_right);
    if (k.has("e")) _move.y += 1;
    if (k.has("q")) _move.y -= 1;
    if (_move.lengthSq() > 0) {
      renderPerformance.regress();
      _move.normalize().multiplyScalar(speed);
      camera.position.add(_move);
      ctl.target.add(_move);
    }
  });
  return null;
}

/**
 * Cotas/medidas flotantes del modelo (estilo blueprint): caja de medida + etiquetas
 * Ancho×Fondo×Alto que siguen a la cámara y se actualizan EN VIVO al construir.
 */
function MeasureOverlay({ voxels }: { voxels: EditorVoxel[] }) {
  const dims = useMemo(() => {
    if (!voxels.length) return null;
    let minX = voxels[0].x, maxX = minX, minY = voxels[0].y, maxY = minY, minZ = voxels[0].z, maxZ = minZ;
    for (const v of voxels) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    return { minX, maxX, minY, maxY, minZ, maxZ, w: maxX - minX + 1, h: maxY - minY + 1, d: maxZ - minZ + 1 };
  }, [voxels]);
  const edges = useMemo(() => {
    if (!dims) return null;
    const box = new THREE.BoxGeometry(dims.w, dims.h, dims.d);
    const outline = new THREE.EdgesGeometry(box);
    box.dispose();
    return outline;
  }, [dims?.w, dims?.h, dims?.d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => edges?.dispose(), [edges]);
  if (!dims || !edges) return null;
  const x0 = dims.minX - 0.5, x1 = dims.maxX + 0.5;
  const y0 = dims.minY - 0.5, y1 = dims.maxY + 0.5;
  const z0 = dims.minZ - 0.5, z1 = dims.maxZ + 0.5;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const tag = (n: number, axis: string) => (
    <span className="select-none whitespace-nowrap rounded border border-accent/60 bg-surface-2/90 px-1.5 py-0.5 font-mono text-[11px] text-accent-hi shadow-md shadow-black/40 backdrop-blur">
      {n}
      <span className="ml-0.5 text-[9px] text-muted">{axis}</span>
    </span>
  );
  const Label = ({ pos, n, axis }: { pos: [number, number, number]; n: number; axis: string }) => (
    <Html position={pos} center zIndexRange={[40, 0]} style={{ pointerEvents: "none" }}>
      {tag(n, axis)}
    </Html>
  );
  return (
    <group>
      <lineSegments position={[cx, cy, cz]} geometry={edges} raycast={() => null}>
        <lineBasicMaterial color="#7197c4" transparent opacity={0.8} depthTest={false} />
      </lineSegments>
      <Label pos={[cx, y0 - 0.2, z1 + 0.2]} n={dims.w} axis="ancho" />
      <Label pos={[x1 + 0.2, y0 - 0.2, cz]} n={dims.d} axis="fondo" />
      <Label pos={[x1 + 0.2, cy, z1 + 0.2]} n={dims.h} axis="alto" />
    </group>
  );
}

export function VoxelEditor({
  voxels,
  catalog,
  currentPhase,
  currentBlock,
  currentRotation = 0,
  models = true,
  tool = "place",
  freePlace = false,
  freeHeight = 0,
  autoOrient = false,
  ops = { rectFilled: false, rectHollow: false, height: 1, brushShape: "cube", brushSize: 3, brushHollow: false },
  selBox = null,
  clipboard = null,
  symmetry = null,
  onPlace,
  onRemove,
  onReplace,
  onEyedrop,
  onPaint,
  onSelectBox,
  onPaste,
}: {
  voxels: EditorVoxel[];
  catalog: Map<string, BlockInfo>;
  /** Fase activa: las demás se atenúan para construir con foco. null = todas iguales. */
  currentPhase: number | null;
  /** Bloque actualmente seleccionado (para la previsualización de colocación). */
  currentBlock?: string | null;
  /** Orientación actual seleccionada (0-63), para orientar la previsualización. */
  currentRotation?: number;
  /** Render de modelos 3D reales (muebles/plantas). Si false, cubos. */
  models?: boolean;
  /** Herramienta activa (colocar / borrar / reemplazar / cuentagotas). */
  tool?: EditorTool;
  /** Free Place: colocar flotando sobre un plano a altura `freeHeight` (sin apoyo). */
  freePlace?: boolean;
  freeHeight?: number;
  /** Colocación inteligente: orienta los bloques direccionales hacia la cámara al colocar. */
  autoOrient?: boolean;
  /** Opciones de las herramientas de forma (relleno/contorno, altura, brocha). */
  ops?: OpOptions;
  /** Caja de selección activa (para resaltarla). */
  selBox?: SelBox | null;
  /** Portapapeles (para previsualizar el pegado bajo el cursor). */
  clipboard?: Clipboard | null;
  /** Planos de simetría activos (para dibujarlos como ayuda visual). */
  symmetry?: { x: boolean; z: boolean; cx: number; cz: number } | null;
  onPlace: PlaceFn;
  onRemove: PlaceFn;
  /** Reemplaza el bloque apuntado por el bloque actual (mantiene la celda). */
  onReplace?: PlaceFn;
  /** Cuentagotas: toma el bloque apuntado como bloque actual. */
  onEyedrop?: (v: EditorVoxel) => void;
  /** Colocación/borrado en lote (línea, caja, relleno, brocha). */
  onPaint?: (cells: Cell[], erase: boolean) => void;
  /** Define la caja de selección (dos esquinas en el plano). */
  onSelectBox?: (a: Cell, b: Cell) => void;
  /** Pega el portapapeles con su esquina mínima en la celda dada. */
  onPaste?: (at: Cell) => void;
}) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const target = useMemo(() => centroid(voxels), [voxels.length === 0]); // recalcula solo al pasar de vacío a no-vacío
  const [resetKey, setResetKey] = useState(0);
  // Accesibilidad/rendimiento: respeta "reducir movimiento" y permite apagar el AO.
  const reduceMotion = useMemo(
    () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const [ao, setAo] = useState(true);
  const [measure, setMeasure] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showGizmo, setShowGizmo] = useState(true);
  const maxDpr = useMemo(
    () => Math.min(2, Math.max(1, typeof window === "undefined" ? 1 : window.devicePixelRatio || 1)),
    [],
  );
  const [renderDpr, setRenderDpr] = useState(maxDpr);
  // Diagnóstico efímero: nunca debe reaparecer en la siguiente sesión ni convertir
  // una prueba de rendimiento en chrome permanente para el usuario.
  const [showStats, setShowStats] = useState(false);
  const renderStatsTarget = useRef<HTMLDivElement>(null);
  const adaptDpr = useCallback(
    ({ factor }: { factor: number }) => {
      const next = Math.round((1 + (maxDpr - 1) * factor) * 4) / 4;
      setRenderDpr((current) => (Math.abs(current - next) < 0.01 ? current : next));
    },
    [maxDpr],
  );
  // Pan con barra ESPACIADORA: mantener Espacio + arrastrar mueve la vista.
  const [spacePan, setSpacePan] = useState(false);
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.code === "Space" && tag !== "INPUT" && tag !== "TEXTAREA") {
        setSpacePan(true);
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpacePan(false);
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);
  type HoverMode = "place" | "remove" | "pick";
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    z: number;
    mode: HoverMode;
    rot?: number; // rotación auto-orientada para que la previsualización coincida con lo que se coloca
  } | null>(null);
  const updateHover = useCallback((next: typeof hover) => {
    setHover((previous) => {
      if (previous === next) return previous;
      if (!previous || !next) return next;
      return previous.x === next.x
        && previous.y === next.y
        && previous.z === next.z
        && previous.mode === next.mode
        && previous.rot === next.rot
        ? previous
        : next;
    });
  }, []);
  const down = useRef<{ x: number; y: number } | null>(null);
  // Celdas ya tocadas en el trazo actual (arrastre continuo de Colocar/Borrador) → no repetir.
  const stroke = useRef<Set<string>>(new Set());
  // El puntero está pulsado (para colocar/borrar de forma continua al arrastrar).
  const pressed = useRef(false);

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return;
    down.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    pressed.current = true;
    stroke.current.clear();
  };
  const isClick = (e: ThreeEvent<PointerEvent>) => {
    const d = down.current;
    down.current = null;
    if (!d) return false;
    return Math.hypot(e.nativeEvent.clientX - d.x, e.nativeEvent.clientY - d.y) <= 6;
  };
  const within = (n: number) => Math.abs(n) <= WORLD_LIMIT;
  // Recorta un lote de celdas al límite del mundo: las herramientas que EXPANDEN (brocha,
  // formas) podían escribir fuera de ±WORLD_LIMIT cerca del borde aunque el ancla fuera válida.
  const clampCells = <T extends Cell>(cells: T[]): T[] =>
    cells.filter((c) => within(c.x) && within(c.y) && within(c.z));
  // Colocación inteligente: rotación que mira a la cámara para bloques direccionales; `undefined`
  // = usar la rotación manual. La cámara sale del propio evento r3f (no necesita useThree aquí).
  const placeRot = (cam: THREE.Camera, x: number, z: number): number | undefined =>
    autoOrient && currentBlock && isOrientableName(currentBlock)
      ? suggestRotation(currentBlock, cam.position.x, cam.position.z, x, z, currentRotation)
      : undefined;
  // ⇧ siempre borra (atajo rápido), pase lo que pase la herramienta activa.
  const eraseMode = (e: ThreeEvent<PointerEvent>) => tool === "eraser" || e.nativeEvent.shiftKey;
  const groundY = freePlace ? Math.round(freeHeight) : 0;
  const isDrag = DRAG_TOOLS.has(tool);
  // PRECISIÓN: tanto Colocar como Borrar actúan SOLO al hacer clic (un clic = un bloque),
  // nunca al arrastrar → sin lag ni acciones erráticas, y el arrastre izquierdo SIEMPRE orbita
  // la cámara. Para actuar en serie/zona están Pintar/Línea/Caja/Brocha (con Mayús borran),
  // que previsualizan y aplican en una sola pasada (eficiente).
  const isPaintLike = false;
  // Coloca/borra una celda una sola vez por trazo (dedup).
  const strokeCell = (x: number, y: number, z: number, erase: boolean, rot?: number) => {
    if (!(within(x) && within(y) && within(z))) return;
    const k = `${x},${y},${z}`;
    if (stroke.current.has(k)) return;
    stroke.current.add(k);
    if (erase) onRemove(x, y, z);
    else onPlace(x, y, z, rot);
  };
  // Suelta global: termina el trazo aunque se suelte fuera del lienzo.
  useEffect(() => {
    const up = () => {
      pressed.current = false;
      down.current = null;
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);
  const [preview, setPreview] = useState<{ cells: Cell[]; kind: "place" | "erase" | "select" } | null>(null);

  // Relleno por inundación en el plano (acotado al volumen del build + margen).
  const commitFill = (start: Cell) => {
    if (!onPaint) return;
    const occ = new Set<string>();
    // Caja límite a partir SOLO de los bloques de ESTA capa (no de todo el volumen ni
    // del punto de clic): así el relleno no se desborda ni recorre celdas vacías de más.
    let minX = start.x, maxX = start.x, minZ = start.z, maxZ = start.z, any = false;
    for (const v of voxels) {
      if (v.y !== start.y) continue;
      occ.add(`${v.x},${v.z}`);
      if (!any) { minX = maxX = v.x; minZ = maxZ = v.z; any = true; }
      else {
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
    }
    const bounds = { minX: minX - 1, maxX: maxX + 1, minZ: minZ - 1, maxZ: maxZ + 1 };
    const cells = fillCells(start, (x, z) => occ.has(`${x},${z}`), bounds);
    if (cells.length) onPaint(cells, false);
  };

  // Clic sobre un voxel existente: según la herramienta activa. (El ARRASTRE continuo de
  // colocar/borrar lo gestiona onMoveVoxel; aquí solo el clic simple.)
  const onUpVoxel = (e: ThreeEvent<PointerEvent>, v: EditorVoxel) => {
    if (isDrag) return; // las herramientas de arrastre las gestiona DragController
    if (e.nativeEvent.button !== 0 || !isClick(e)) return;
    e.stopPropagation();
    if (eraseMode(e)) {
      strokeCell(v.x, v.y, v.z, true);
      return;
    }
    if (tool === "eyedrop") {
      onEyedrop?.(v);
      return;
    }
    if (tool === "replace") {
      onReplace?.(v.x, v.y, v.z);
      return;
    }
    // Celda adyacente a la cara apuntada (snap por normal en espacio mundo).
    const c = adjacentCell(e, v);
    if (!c || !(within(c.x) && within(c.y) && within(c.z))) return;
    if (tool === "brush") onPaint?.(clampCells(brushCells(c, ops.brushShape, ops.brushSize, ops.brushHollow)), false);
    else if (tool === "fill") commitFill(c);
    else if (tool === "paste") onPaste?.(c);
    else strokeCell(c.x, c.y, c.z, false, placeRot(e.camera, c.x, c.z));
  };

  // Clic sobre el plano de construcción: coloca/rellena a la altura activa.
  const onUpGround = (e: ThreeEvent<PointerEvent>) => {
    if (isDrag) return; // gestionado por DragController
    if (e.nativeEvent.button !== 0 || !isClick(e)) return;
    e.stopPropagation();
    const x = Math.round(e.point.x);
    const z = Math.round(e.point.z);
    if (!(within(x) && within(z))) return;
    if (tool === "place") strokeCell(x, groundY, z, false, placeRot(e.camera, x, z));
    else if (tool === "fill") commitFill({ x, y: groundY, z });
    else if (tool === "brush") onPaint?.(clampCells(brushCells({ x, y: groundY, z }, ops.brushShape, ops.brushSize, ops.brushHollow)), false);
    else if (tool === "paste") onPaste?.({ x, y: groundY, z });
    // borrar/reemplazar/cuentagotas no actúan sobre el vacío
  };

  // Previsualización + colocación/borrado CONTINUO al arrastrar (snap a la cara apuntada).
  const onMoveVoxel = (e: ThreeEvent<PointerEvent>, v: EditorVoxel) => {
    if (isDrag) return;
    e.stopPropagation();
    if (eraseMode(e)) {
      // Solo previsualiza (recuadro rojo); borra en onUpVoxel (clic). Borrar = precisión.
      updateHover({ x: v.x, y: v.y, z: v.z, mode: "remove" });
      return;
    }
    if (tool === "eyedrop" || tool === "replace") {
      updateHover({ x: v.x, y: v.y, z: v.z, mode: "pick" });
      return;
    }
    const c = adjacentCell(e, v);
    if (!c) return;
    // Solo previsualiza (no coloca al arrastrar): Colocar es de precisión, coloca en onUpVoxel.
    updateHover({ x: c.x, y: c.y, z: c.z, mode: "place", rot: placeRot(e.camera, c.x, c.z) });
  };
  const onMoveGround = (e: ThreeEvent<PointerEvent>) => {
    // Arrastre (shapes), o herramientas que solo actúan sobre bloques → sin hover en el suelo.
    if (isDrag || tool === "eraser" || tool === "replace" || tool === "eyedrop") {
      updateHover(null);
      return;
    }
    const x = Math.round(e.point.x);
    const z = Math.round(e.point.z);
    // Solo previsualiza: Colocar es de precisión (coloca en onUpGround, un clic = un bloque).
    updateHover({ x, y: groundY, z, mode: "place", rot: placeRot(e.camera, x, z) });
  };

  const groups = useMemo(() => groupEditorVoxels(voxels, catalog), [catalog, voxels]);

  // Posiciones ocupadas → nombre (para que las vallas conecten solo a vallas/muros/sólidos).
  const occupied = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of voxels) m.set(`${v.x},${v.y},${v.z}`, v.name);
    return m;
  }, [voxels]);

  // Fuentes de luz → llama nativa + luces puntuales cálidas (charcos de luz realistas).
  const litSources = useMemo(() => lightSources(voxels, catalog), [voxels, catalog]);
  // Snapshot "asentado" del modelo: un debounce corto agrupa ráfagas de pintura sin introducir
  // una cola de horneados. Durante ese intervalo se conserva el último resultado smooth y su
  // iluminación, de modo que un clic nunca cambia el aspecto global de la escena.
  const [committed, setCommitted] = useState(voxels);
  const commitTimer = useRef<number>(0);
  useEffect(() => {
    clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => setCommitted(voxels), 60);
    return () => clearTimeout(commitTimer.current);
  }, [voxels]);
  const committedGroups = useMemo(
    () => groupEditorVoxels(committed, catalog),
    [catalog, committed],
  );
  const bakeGroups = useMemo<BakeGroup[]>(() => {
    const next: BakeGroup[] = [];
    for (const [key, group] of committedGroups) {
      const spec = resolveBlock(catalog, group.name);
      if (isFenceName(group.name) || spec.wedge || (models && spec.modelPath)) continue;
      next.push({
        key,
        blocks: group.voxels,
        center: [0, 0, 0],
        cullSelf: spec.translucent || spec.fluid,
      });
    }
    return next;
  }, [catalog, committedGroups, models]);
  const baked = useVoxelRenderBake(committed, catalog, bakeGroups);
  // El hook conserva el último horneado terminado mientras procesa el nuevo snapshot. Su
  // geometría sigue siendo coherente para cada bucket existente y evita un remonte visual de
  // toda la construcción; los cambios aparecen en cuanto el worker entrega el siguiente bake.
  const currentBake = baked;

  // Límites EN VIVO del modelo: centro + radio (para encuadrar vistas/sombra al volumen real,
  // aunque construyas lejos del centro inicial). Vacío → centro en el origen.
  const [biomeId, setBiomeId] = useState(
    () => localStorage.getItem("vf_editor_biome") || "none",
  );
  const [vegetation, setVegetation] = useState(
    () => localStorage.getItem("vf_editor_vegetation") === "true",
  );
  const [relief, setRelief] = useState<Relief>(
    () => (localStorage.getItem("vf_editor_relief") as Relief) || "hills",
  );
  const bounds = useMemo(() => {
    if (voxels.length === 0) return { cx: 0, cy: 0, cz: 0, r: 8, floorY: -0.5 };
    let minX = voxels[0].x, maxX = minX, minY = voxels[0].y, maxY = minY, minZ = voxels[0].z, maxZ = minZ;
    for (const v of voxels) {
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
    return {
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      r: Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 2,
      floorY: minY - 0.5,
    };
  }, [voxels]);
  const dist = Math.max(16, bounds.r * 1.35 + 4);
  const shadowR = Math.max(8, bounds.r) + 6;
  const biome = biomeById(biomeId);

  // HUD de cursor/regla (como la regla y las coordenadas del modo Creativo de Hytale):
  // al arrastrar una forma, sus medidas (ancho × fondo × alto) y el nº de bloques; en
  // reposo, las coordenadas de la celda bajo el puntero. Solo lectura del estado vivo.
  const cursorHud = useMemo<string | null>(() => {
    if (preview && preview.cells.length > 0) {
      let nx = Infinity, ny = Infinity, nz = Infinity, mx = -Infinity, my = -Infinity, mz = -Infinity;
      for (const c of preview.cells) {
        if (c.x < nx) nx = c.x;
        if (c.x > mx) mx = c.x;
        if (c.y < ny) ny = c.y;
        if (c.y > my) my = c.y;
        if (c.z < nz) nz = c.z;
        if (c.z > mz) mz = c.z;
      }
      const w = mx - nx + 1, d = mz - nz + 1, h = my - ny + 1;
      return `${w} × ${d} × ${h} · ${preview.cells.length.toLocaleString("es")} bloques`;
    }
    if (hover) return `X ${hover.x} · Y ${hover.y} · Z ${hover.z}`;
    return null;
  }, [preview, hover]);

  // Presets de cámara (navegación): isométrica / cenital / frontal. Encuadran el modelo en vivo.
  const controlsRef = useRef<{ object: THREE.Camera; target: THREE.Vector3; update: () => void } | null>(null);
  const setView = (preset: "iso" | "top" | "front") => {
    const c = controlsRef.current;
    if (!c) return;
    const d = bounds.r * 3 + 8;
    const { cx, cy, cz } = bounds;
    const p =
      preset === "top"
        ? [cx + 0.001, cy + d * 1.5, cz + 0.001]
        : preset === "front"
          ? [cx, cy + d * 0.35, cz + d * 1.3]
          : [cx + d, cy + d * 0.8, cz + d];
    c.object.position.set(p[0], p[1], p[2]);
    c.target.set(cx, cy, cz);
    c.update();
  };

  return (
    <div className="relative h-full w-full" onPointerLeave={() => updateHover(null)}>
      <Canvas
        key={resetKey}
        shadows="percentage"
        camera={{ position: [target[0] + dist, target[1] + dist * 0.8, target[2] + dist], fov: 50, near: 0.8, far: 640 }}
        dpr={renderDpr}
        performance={{ min: 0.72, max: 1, debounce: 350 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ raycaster }) => raycaster.layers.enable(1)}
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
        <ShadowScheduler revision={currentBake} />
        <RenderStats visible={showStats} bakeMs={currentBake?.durationMs} targetRef={renderStatsTarget} />
        <SceneClock />
        <SkyDome />
        {/* Entorno de previsualización: el prefab "plantado" en un paisaje de bioma de Hytale
            (claro plano central + relieve/montañas y vegetación alrededor), fundido con el
            horizonte por la niebla. El bioma "none" lo desactiva. */}
        {biome.id !== "none" && (
          <>
            <fog
              attach="fog"
              args={[biome.fog, bounds.r * 3 + 24, relief === "flat" ? bounds.r * 10 + 80 : 330]}
            />
            <BiomeEnvironment
              biome={biome}
              relief={relief}
              floorY={bounds.floorY}
              clearRadius={bounds.r}
              catalog={catalog}
              vegetation={vegetation}
            />
          </>
        )}
        {/* Estilo ilustración (igual que el visor): textura manda, luz/AO sutiles. */}
        <hemisphereLight args={["#dbe6f2", "#5a5040", 0.62]} />
        <ambientLight intensity={1.32} />
        <directionalLight
          position={[bounds.cx + shadowR, bounds.cy + shadowR * 1.6 + 20, bounds.cz + shadowR * 0.7]}
          intensity={0.6}
          color="#fff4e0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0003}
          shadow-normalBias={0.06}
          shadow-camera-near={1}
          shadow-camera-far={shadowR * 6 + 60}
          shadow-camera-left={-shadowR}
          shadow-camera-right={shadowR}
          shadow-camera-top={shadowR}
          shadow-camera-bottom={-shadowR}
        />
        <directionalLight position={[-18, 14, -14]} intensity={0.18} color="#cdddf0" />
        {/* Iluminación realista: llama nativa + charco de luz cálido por antorcha/farol. */}
        <BlockLights sources={litSources} />

        {/* Plano de construcción: clic para colocar a la altura activa. Con Free Place sube
            a `groundY` para colocar bloques flotando sin apoyo. */}
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[0, groundY - 0.52, 0]}
          receiveShadow={showGrid && !freePlace}
          onPointerDown={onDown}
          onPointerUp={onUpGround}
          onPointerMove={onMoveGround}
        >
          <planeGeometry args={[WORLD_LIMIT * 2, WORLD_LIMIT * 2]} />
          <meshStandardMaterial
            color={freePlace ? "#1d3346" : "#16212d"}
            transparent
            opacity={showGrid ? (freePlace ? 0.4 : 0.55) : 0}
            depthWrite={false}
          />
        </mesh>
        {showGrid && (
          <Grid
            position={[0, groundY - 0.51, 0]}
            args={[WORLD_LIMIT * 2, WORLD_LIMIT * 2]}
            cellSize={1}
            cellColor={freePlace ? "#3a6a8a" : "#2a3a4b"}
            sectionSize={8}
            sectionColor={freePlace ? "#4f86ad" : "#3a5572"}
            fadeDistance={60}
            infiniteGrid={false}
          />
        )}

        {/* Cotas/medidas flotantes (ancho×fondo×alto) en tiempo real. */}
        {measure && <MeasureOverlay voxels={voxels} />}

        {/* Planos de simetría (ayuda visual): X = espejo Este↔Oeste, Z = Norte↔Sur. */}
        {symmetry?.x && (
          <mesh
            raycast={() => null}
            position={[symmetry.cx, groundY + 18, target[2]]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[WORLD_LIMIT, 40]} />
            <meshBasicMaterial color="#e0653a" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        {symmetry?.z && (
          <mesh raycast={() => null} position={[target[0], groundY + 18, symmetry.cz]}>
            <planeGeometry args={[WORLD_LIMIT, 40]} />
            <meshBasicMaterial color="#5fb0e8" transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}

        {Array.from(groups.entries()).map(([key, g]) => (
          <EditorBlocks
            key={key}
            name={g.name}
            voxels={g.voxels}
            geometry={geometry}
            catalog={catalog}
            dimmed={currentPhase !== null && g.phase !== currentPhase}
            models={models}
            occupied={occupied}
            lightColors={currentBake?.colors}
            smoothGeometry={currentBake?.geometries.get(key)}
            textureVariant={g.textureVariant}
            onDown={onDown}
            onUpVoxel={onUpVoxel}
            onMoveVoxel={onMoveVoxel}
          />
        ))}

        {/* Previsualización: colocar → bloque REAL translúcido (verde); borrar → recuadro
            rojo; cuentagotas/reemplazar → recuadro azul sobre el bloque apuntado. */}
        {hover && hover.mode === "place" && currentBlock && tool !== "paste" && (
          <HoverPreview
            name={currentBlock}
            position={[hover.x, hover.y, hover.z]}
            rotation={hover.rot ?? currentRotation}
            catalog={catalog}
            models={models}
          />
        )}
        {hover && tool !== "paste" && (hover.mode !== "place" || !currentBlock) && (
          <mesh position={[hover.x, hover.y, hover.z]} raycast={() => null}>
            <boxGeometry args={[1.06, 1.06, 1.06]} />
            <meshBasicMaterial
              color={
                hover.mode === "remove" ? "#e85f5f" : hover.mode === "pick" ? "#5fb0e8" : "#5fd089"
              }
              transparent
              opacity={0.35}
              depthWrite={false}
            />
          </mesh>
        )}

        {/* Preview de la operación de arrastre (verde=colocar, rojo=borrar, azul=seleccionar). */}
        {preview && preview.cells.length > 0 && (
          <Instances
            limit={4096}
            range={Math.min(preview.cells.length, 4096)}
            geometry={geometry}
            raycast={() => null}
            frustumCulled={false}
          >
            <meshBasicMaterial
              color={preview.kind === "erase" ? "#e85f5f" : preview.kind === "select" ? "#5fb0e8" : "#5fd089"}
              transparent
              opacity={0.4}
              depthWrite={false}
            />
            {preview.cells.slice(0, 4096).map((c, i) => (
              <Instance key={i} position={[c.x, c.y, c.z]} />
            ))}
          </Instances>
        )}

        {/* Caja de selección activa. */}
        {selBox && (
          <mesh
            raycast={() => null}
            position={[
              (selBox.minX + selBox.maxX) / 2,
              (selBox.minY + selBox.maxY) / 2,
              (selBox.minZ + selBox.maxZ) / 2,
            ]}
          >
            <boxGeometry
              args={[
                selBox.maxX - selBox.minX + 1.04,
                selBox.maxY - selBox.minY + 1.04,
                selBox.maxZ - selBox.minZ + 1.04,
              ]}
            />
            <meshBasicMaterial color="#5fb0e8" transparent opacity={0.16} depthWrite={false} />
          </mesh>
        )}

        {/* Preview de pegado: el portapapeles translúcido bajo el cursor. */}
        {tool === "paste" && clipboard && hover && clipboard.cells.length > 0 && (
          <Instances
            limit={4096}
            range={Math.min(clipboard.cells.length, 4096)}
            geometry={geometry}
            raycast={() => null}
            frustumCulled={false}
          >
            <meshBasicMaterial color="#7fd0a0" transparent opacity={0.45} depthWrite={false} />
            {clipboard.cells.slice(0, 4096).map((c, i) => (
              <Instance key={i} position={[hover.x + c.x, hover.y + c.y, hover.z + c.z]} />
            ))}
          </Instances>
        )}

        {isDrag && (
          <DragController
            tool={tool}
            groundY={groundY}
            ops={ops}
            onPaint={onPaint}
            onSelectBox={onSelectBox}
            setPreview={setPreview}
          />
        )}

        <CameraNav />
        <OrbitControls
          ref={controlsRef as never}
          makeDefault
          regress
          enableDamping={!reduceMotion}
          enablePan
          zoomToCursor
          screenSpacePanning
          target={target}
          mouseButtons={{
            // Izquierdo = construir (colocar/borrar/formas), arrastrando coloca en serie.
            // Para orbitar: botón DERECHO (siempre) o Espacio+arrastrar = mover (pan).
            LEFT: spacePan ? THREE.MOUSE.PAN : isDrag || isPaintLike ? undefined : THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
        />
        {showGizmo && (
          <GizmoHelper alignment="bottom-right" margin={[48, 48]}>
            <GizmoViewport axisColors={["#e0653a", "#6fd089", "#5fb0e8"]} labelColor="#fff" />
          </GizmoHelper>
        )}
        {ao && (
          <EffectComposer multisampling={4}>
            <N8AO
              aoRadius={0.6}
              distanceFalloff={1}
              intensity={0.7}
              quality="high"
              halfRes
              depthAwareUpsampling
            />
            {/* Halo en los bloques que emiten luz (antorchas, lámparas, lava…). */}
            <Bloom mipmapBlur luminanceThreshold={0.62} luminanceSmoothing={0.3} intensity={0.85} radius={0.7} />
          </EffectComposer>
        )}
      </Canvas>
      {/* Contexto vivo: ocupa solo el espacio entre el rail y el control Vista. */}
      <div className="pointer-events-none absolute left-20 right-24 top-3 z-20 flex min-w-0 flex-wrap items-start gap-1.5">
        {(cursorHud || freePlace) && (
          <div className="flex max-w-full flex-wrap items-center gap-1.5">
            {cursorHud && (
              <div className="max-w-full truncate rounded-md border border-line bg-surface-2/95 px-2.5 py-1 font-mono text-[11px] tabular-nums text-ink shadow-sm">
                {cursorHud}
              </div>
            )}
            {freePlace && (
              <div className="max-w-full truncate rounded-md border border-accent/40 bg-surface-2/95 px-2.5 py-1 text-[11px] text-accent-hi shadow-sm">
                Flotante · Y {groundY} · [ ] ajusta
              </div>
            )}
          </div>
        )}
      </div>
      <div className="absolute right-3 top-3 z-30">
        <SceneViewPopover
          presets={[
            { id: "iso", label: "Isométrica", onSelect: () => setView("iso") },
            { id: "top", label: "Superior", onSelect: () => setView("top") },
            { id: "front", label: "Frontal", onSelect: () => setView("front") },
          ]}
          onReset={() => setResetKey((key) => key + 1)}
        >
          <section aria-label="Ayudas de escena" className="space-y-0.5">
            <h3 className="mb-1 px-2 text-xs font-semibold text-ink">Ayudas de escena</h3>
            <SceneViewToggle checked={showGrid} onChange={setShowGrid} label="Cuadrícula" />
            <SceneViewToggle checked={showGizmo} onChange={setShowGizmo} label="Ejes de orientación" />
            <SceneViewToggle checked={measure} onChange={setMeasure} label="Medidas del modelo" />
          </section>

          <section aria-label="Calidad visual" className="mt-3 border-t border-line pt-3">
            <h3 className="mb-1 px-2 text-xs font-semibold text-ink">Calidad visual</h3>
            <SceneViewToggle checked={ao} onChange={setAo} label="Oclusión ambiental y bloom" />
          </section>

          <section aria-labelledby="editor-environment" className="mt-3 border-t border-line pt-3">
            <h3 id="editor-environment" className="mb-2 px-2 text-xs font-semibold text-ink">
              Entorno
            </h3>
            <label className="block px-2 text-xs text-muted">
              Bioma de previsualización
              <select
                value={biomeId}
                onChange={(event) => {
                  setBiomeId(event.target.value);
                  try {
                    localStorage.setItem("vf_editor_biome", event.target.value);
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
              <>
                <label className="mt-2 block px-2 text-xs text-muted">
                  Relieve
                  <select
                    value={relief}
                    onChange={(event) => {
                      setRelief(event.target.value as Relief);
                      try {
                        localStorage.setItem("vf_editor_relief", event.target.value);
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
                <div className="mt-1">
                  <SceneViewToggle
                    checked={vegetation}
                    onChange={(next) => {
                      setVegetation(next);
                      try {
                        localStorage.setItem("vf_editor_vegetation", String(next));
                      } catch {
                        /* almacenamiento no disponible */
                      }
                    }}
                    label="Vegetación alrededor"
                    description="Ocúltala si tapa la construcción"
                  />
                </div>
              </>
            )}
          </section>

          <section aria-label="Diagnóstico" className="mt-3 border-t border-line pt-3">
            <SceneViewToggle
              checked={showStats}
              onChange={setShowStats}
              label="Diagnóstico de rendimiento"
              description="Solo durante esta sesión"
            />
          </section>
        </SceneViewPopover>
      </div>
      {/* Aviso cuando la previsualización de arrastre supera el tope de instancias. */}
      {preview && preview.cells.length > 4096 && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md border border-gold/40 bg-surface-2/90 px-3 py-1.5 text-xs text-gold backdrop-blur">
          Previsualización simplificada · suelta para validar y aplicar la operación completa
        </div>
      )}
      {showStats && (
        <div
          ref={renderStatsTarget}
          className="pointer-events-none absolute bottom-3 left-20 z-30 max-w-[calc(100%-10rem)] truncate rounded-md border border-line bg-surface-2/95 px-2.5 py-1.5 font-mono text-[10px] tabular-nums text-ink shadow-sm"
        >
          Midiendo el render…
        </div>
      )}
    </div>
  );
}
