import * as THREE from "three";
import { assetUrl, getAssetGeneration, readTextAsset } from "@/lib/api";
import { configurePixelTexture } from "@/lib/pixelTexture";
import { ModelFaceCollector, type ModelFaceBucket } from "@/lib/modelFaceCollector";

/**
 * Carga un modelo `.blockymodel` real de Hytale y lo convierte en una geometría
 * three.js fusionada (cuboides + quads) con UV mapeadas al atlas de textura.
 *
 * Formato: árbol de `nodes` con `position`, `orientation` (cuaternión) y `shape`
 * (`box` con `settings.size` + `textureLayout` por cara, o `quad`). Escala 1 bloque
 * = 32 unidades; el origen del modelo (y=0) se ancla a la base de la celda (y=-0.5).
 */

const UNIT = 32; // unidades del modelo por bloque
const HALF = 0.5;

export interface LoadedModel {
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  /** Geometría de las formas `fullbright` (farolillos, ventanas iluminadas…) que
   *  deben renderizarse emisivas/brillantes, como en el juego. */
  emissive: THREE.BufferGeometry | null;
  /** Geometría de las formas `flat`/"NoShading" (paja, tela, follaje…) que se
   *  renderizan SIN iluminación (textura plana tal cual, con su sombreado ya pintado).
   *  Sin esto la paja sale negra (sombreado normal + oclusión) o brillante (emisivo). */
  flat: THREE.BufferGeometry | null;
  /** Geometría `reflective`: metal, cristal pulido y superficies con reflejo especular. */
  reflective: THREE.BufferGeometry | null;
  /** Textura `_emissive.png` (Hytale): capa que BRILLA aunque el bloque esté en sombra
   *  (cristales, runas, hongos luminosos). null si el bloque no tiene capa emisiva. */
  emissiveTex: THREE.Texture | null;
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const cache = new Map<string, Promise<LoadedModel | null>>();

/** Carga (con caché) un modelo de bloque. Devuelve null si falla. */
export function loadBlockModel(modelPath: string, texturePath: string | null): Promise<LoadedModel | null> {
  const key = `${getAssetGeneration()}|${modelPath}|${texturePath ?? ""}`;
  let p = cache.get(key);
  if (!p) {
    p = build(modelPath, texturePath).catch(() => null);
    cache.set(key, p);
  }
  return p;
}

async function build(modelPath: string, texturePath: string | null): Promise<LoadedModel | null> {
  const doc = JSON.parse(await readTextAsset(`Common/${modelPath}`));
  const nodes = doc?.nodes;
  if (!Array.isArray(nodes)) return null;

  const texture = await loadTexture(texturePath);
  const img = texture.image as { width?: number; height?: number } | undefined;
  const texW = img?.width ?? 64;
  const texH = img?.height ?? 64;

  // Capa emisiva nativa de Hytale (`<tex>_emissive.png`): brilla aunque esté en sombra
  // (cristales, runas, hongos luminosos). loadTexture devuelve una textura vacía si no existe
  // (404) → se descarta comprobando que tenga imagen. Coste: 1 request por modelo (cacheada).
  const emRaw = texturePath
    ? await loadTexture(texturePath.replace(/\.png$/i, "_emissive.png"))
    : null;
  const emissiveTex =
    emRaw && (emRaw.image as { width?: number } | undefined)?.width ? emRaw : null;

  const ctx: Ctx = {
    texW,
    texH,
    faces: new ModelFaceCollector(),
  };
  const zero = new THREE.Vector3(0, 0, 0);
  const identity = new THREE.Quaternion();
  for (const n of nodes) walkNode(n, zero, identity, ctx);

  const buffers = ctx.faces.build();
  if (
    buffers.std.positions.length === 0
    && buffers.em.positions.length === 0
    && buffers.flat.positions.length === 0
    && buffers.reflective.positions.length === 0
  ) {
    return null;
  }

  const mkGeo = (pos: number[], nrm: number[], uv: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.scale(1 / UNIT, 1 / UNIT, 1 / UNIT);
    g.translate(0, -HALF, 0);
    g.computeBoundingSphere();
    return g;
  };

  const geometry = buffers.std.positions.length
    ? mkGeo(buffers.std.positions, buffers.std.normals, buffers.std.uvs)
    : new THREE.BufferGeometry();
  const emissive = buffers.em.positions.length
    ? mkGeo(buffers.em.positions, buffers.em.normals, buffers.em.uvs)
    : null;
  const flat = buffers.flat.positions.length
    ? mkGeo(buffers.flat.positions, buffers.flat.normals, buffers.flat.uvs)
    : null;
  const reflective = buffers.reflective.positions.length
    ? mkGeo(buffers.reflective.positions, buffers.reflective.normals, buffers.reflective.uvs)
    : null;

  return { geometry, texture, emissive, flat, reflective, emissiveTex };
}

const textureCache = new Map<string, Promise<THREE.Texture>>();

function loadTexture(path: string | null): Promise<THREE.Texture> {
  if (!path) return Promise.resolve(new THREE.Texture());
  const url = assetUrl(`Common/${path}`);
  const cached = textureCache.get(url);
  if (cached) return cached;
  const pending = new Promise<THREE.Texture>((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (t) => {
        resolve(configurePixelTexture(t));
      },
      undefined,
      () => {
        textureCache.delete(url);
        resolve(new THREE.Texture());
      },
    );
  });
  textureCache.set(url, pending);
  return pending;
}

/** Categoría de sombreado: normal (lit), emisivo (fullbright), plano (flat/NoShading). */
type Bucket = ModelFaceBucket;

interface Ctx {
  texW: number;
  texH: number;
  faces: ModelFaceCollector;
}

function v3(o: Partial<Vec3> | undefined): Vec3 {
  return { x: o?.x ?? 0, y: o?.y ?? 0, z: o?.z ?? 0 };
}

/**
 * Recorre el árbol con la transformación nativa de Hytale. Es el port literal de
 * `BlockyModelBoundsParser.accumulateNodeBounds`, que a su vez refleja
 * `ComputeLocalBounds / ComputeNodeBounds` del cliente:
 *
 *   localPosition = orientation · offset + position
 *   worldPosition = parentOrientation · localPosition + parentPosition
 *   worldOrientation = parentOrientation · orientation
 *
 * El importador de Blockbench reconstruye pivotes de edición y NO sirve como contrato de
 * render; para visualizar los assets finales se usa la composición del motor.
 */
function walkNode(
  node: Record<string, unknown>,
  parentPosition: THREE.Vector3,
  parentOrientation: THREE.Quaternion,
  ctx: Ctx,
) {
  const shape = node.shape as Record<string, unknown> | undefined;
  // El cliente descarta también el subárbol de un nodo invisible.
  if (shape?.visible === false) return;

  const pos = v3(node.position as Vec3);
  const q = node.orientation as { x?: number; y?: number; z?: number; w?: number } | undefined;
  const quat = new THREE.Quaternion(q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1).normalize();
  const offset = v3(shape?.offset as Vec3);
  const worldPosition = new THREE.Vector3(offset.x, offset.y, offset.z)
    .applyQuaternion(quat)
    .add(new THREE.Vector3(pos.x, pos.y, pos.z))
    .applyQuaternion(parentOrientation)
    .add(parentPosition);
  const worldOrientation = parentOrientation.clone().multiply(quat).normalize();

  if (shape) {
    const type = shape.type;
    // shadingMode (plugin oficial Blockbench): standard=luz normal · fullbright=emisivo
    // (luces/ventanas) · flat=SIN iluminación (textura plana, sombreado ya pintado:
    // paja, tela, follaje). El nombre "NoShading" del nodo también marca piezas flat.
    const sm = shape.shadingMode;
    const name = typeof node.name === "string" ? node.name : "";
    const bucket: Bucket = sm === "fullbright"
      ? "em"
      : sm === "reflective"
        ? "reflective"
        : sm === "flat" || name.includes("NoShading")
          ? "flat"
          : "std";
    if (type === "box") emitBox(shape, worldPosition, worldOrientation, ctx, bucket);
    else if (type === "quad") emitQuad(shape, worldPosition, worldOrientation, ctx, bucket);
  }

  const children = node.children;
  if (Array.isArray(children)) {
    for (const c of children) {
      walkNode(c as Record<string, unknown>, worldPosition, worldOrientation, ctx);
    }
  }
}

type FaceLayout = { offset?: { x: number; y: number }; mirror?: { x?: boolean; y?: boolean }; angle?: number };

// Las 6 caras del cubo replicando EXACTAMENTE Blockbench (`THREE.BufferGeometry.setShape`
// en three_custom.js + `Canvas.face_order`). Cada cara:
//  - `hy`: clave de la cara en el `textureLayout` de Hytale (front=south, back=north,
//    left=west, right=east, top=up, bottom=down).
//  - `proj`: ejes de `settings.size` que dan (ancho, alto) de la UV de la cara.
//  - `c`: las 4 esquinas en el orden de vértices de Blockbench [v0,v1,v2,v3] = [TL,TR,BL,BR]
//    de la UV; cada esquina = [selX, selY, selZ] con 1 = `to` (centro+semilado) y 0 = `from`.
const FACES: { hy: string; proj: ["x" | "y" | "z", "x" | "y" | "z"]; c: [number, number, number][] }[] = [
  { hy: "right", proj: ["z", "y"], c: [[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0]] }, // east  +X
  { hy: "left", proj: ["z", "y"], c: [[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1]] }, // west  -X
  { hy: "top", proj: ["x", "z"], c: [[0, 1, 0], [1, 1, 0], [0, 1, 1], [1, 1, 1]] }, // up    +Y
  { hy: "bottom", proj: ["x", "z"], c: [[0, 0, 1], [1, 0, 1], [0, 0, 0], [1, 0, 0]] }, // down  -Y
  { hy: "front", proj: ["x", "y"], c: [[0, 1, 1], [1, 1, 1], [0, 0, 1], [1, 0, 1]] }, // south +Z
  { hy: "back", proj: ["x", "y"], c: [[1, 1, 0], [0, 1, 0], [1, 0, 0], [0, 0, 0]] }, // north -Z
];

/**
 * `textureLayout.<cara>` → rectángulo UV de Blockbench `[u1,v1,u2,v2]` (en píxeles, origen
 * arriba-izquierda; el espejado queda codificado como u2<u1 / v2<v1). Port LITERAL del codec
 * oficial de Hytale (JannisX11 `blockymodel.ts`, función `parse`): en `angle` 90/270 se
 * INTERCAMBIAN ancho/alto del rect y se acopla el mirror a la rotación (negar un componente).
 */
function plugUV(
  offset: { x: number; y: number },
  sw0: number,
  sh0: number,
  mirror: { x?: boolean; y?: boolean },
  angle: number,
): [number, number, number, number] {
  const size = [sw0, sh0];
  const mir = [mirror?.x ? -1 : 1, mirror?.y ? -1 : 1];
  const ox = offset.x;
  const oy = offset.y;
  const ang = (((Math.round((angle || 0) / 90) % 4) + 4) % 4) * 90;
  if (ang === 90) {
    [size[0], size[1]] = [size[1], size[0]];
    [mir[0], mir[1]] = [mir[1], mir[0]];
    mir[0] *= -1;
    return [ox, oy + size[1] * mir[1], ox + size[0] * mir[0], oy];
  }
  if (ang === 180) {
    mir[0] *= -1;
    mir[1] *= -1;
    return [ox + size[0] * mir[0], oy + size[1] * mir[1], ox, oy];
  }
  if (ang === 270) {
    [size[0], size[1]] = [size[1], size[0]];
    [mir[0], mir[1]] = [mir[1], mir[0]];
    mir[1] *= -1;
    return [ox + size[0] * mir[0], oy, ox, oy + size[1] * mir[1]];
  }
  return [ox, oy, ox + size[0] * mir[0], oy + size[1] * mir[1]];
}

/**
 * Rectángulo UV de Blockbench `[u1,v1,u2,v2]` + `rotation` → UV normalizadas (0..1, V en
 * convención three.js) de los 4 vértices [v0,v1,v2,v3]. Port LITERAL de `Canvas.updateUV`
 * (Blockbench core `cube.js`): arr=[TL,TR,BL,BR], V=`1 - y/texH`, y giro HORARIO de esquinas
 * (rot -= 90: arr[0]=arr[2]; arr[2]=arr[3]; arr[3]=arr[1]; arr[1]=antiguo arr[0]).
 */
function cornerUVs(
  uv: [number, number, number, number],
  angle: number,
  texW: number,
  texH: number,
): number[][] {
  const [u1, v1, u2, v2] = uv;
  let arr = [
    [u1 / texW, 1 - v1 / texH], // v0 = TL
    [u2 / texW, 1 - v1 / texH], // v1 = TR
    [u1 / texW, 1 - v2 / texH], // v2 = BL
    [u2 / texW, 1 - v2 / texH], // v3 = BR
  ];
  let rot = (((Math.round((angle || 0) / 90) % 4) + 4) % 4) * 90;
  while (rot > 0) {
    const a = arr[0];
    arr = [arr[2], a, arr[3], arr[1]];
    rot -= 90;
  }
  return arr;
}

function emitBox(
  shape: Record<string, unknown>,
  worldPosition: THREE.Vector3,
  worldOrientation: THREE.Quaternion,
  ctx: Ctx,
  bucket: Bucket,
) {
  const settings = shape.settings as { size?: Vec3; normal?: string } | undefined;
  const size = v3(settings?.size);
  const stretch = v3(shape.stretch as Vec3);
  // `stretch` escala la geometría alrededor del centro (NO toca la UV; el codec oficial lo
  // confirma). Se conserva el SIGNO: un stretch negativo voltea la caja sobre ese eje, que es
  // el espejado intencionado del autor. Las normales se recalculan por geometría (abajo), así
  // que la iluminación sale bien aunque el winding se invierta.
  const sx = (size.x * (stretch.x || 1)) / 2;
  const sy = (size.y * (stretch.y || 1)) / 2;
  const sz = (size.z * (stretch.z || 1)) / 2;
  const dims: Record<string, number> = { x: size.x, y: size.y, z: size.z };
  const layout = (shape.textureLayout as Record<string, FaceLayout>) || {};

  for (const face of FACES) {
    const fl = layout[face.hy];
    // Blockbench: una cara SIN entrada en textureLayout no tiene textura → NO se dibuja
    // (p. ej. las caras internas ocultas de los tejados). Dibujarlas causaba solapes/z-fight.
    if (!fl) continue;
    const sw = dims[face.proj[0]];
    const sh = dims[face.proj[1]];
    const rect = plugUV(fl.offset ?? { x: 0, y: 0 }, sw, sh, fl.mirror ?? {}, fl.angle ?? 0);
    const uv = cornerUVs(rect, fl.angle ?? 0, ctx.texW, ctx.texH);
    const pts = face.c.map(([xs, ys, zs]) =>
      new THREE.Vector3(
        xs ? sx : -sx,
        ys ? sy : -sy,
        zs ? sz : -sz,
      ).applyQuaternion(worldOrientation).add(worldPosition),
    );
    // Normal geométrica (triángulo 0,2,1) orientada hacia fuera respecto al centro de la caja.
    // Un `stretch` negativo invierte el winding; `pushFace` lo corrige antes de emitir los
    // triángulos para que el culling del cliente de Hytale siga funcionando correctamente.
    const n = new THREE.Vector3()
      .subVectors(pts[2], pts[0])
      .cross(new THREE.Vector3().subVectors(pts[1], pts[0]))
      .normalize();
    const faceC = new THREE.Vector3().addVectors(pts[0], pts[3]).multiplyScalar(0.5);
    if (n.dot(new THREE.Vector3().subVectors(faceC, worldPosition)) < 0) n.negate();
    pushFace(ctx, pts, uv, n, bucket, shape.doubleSided === true);
  }
}

/** Vuelca una cara (4 vértices [v0,v1,v2,v3]) con la triangulación de Blockbench (0,2,1 · 2,3,1). */
function pushFace(
  ctx: Ctx,
  pts: THREE.Vector3[],
  uv: number[][],
  n: THREE.Vector3,
  bucket: Bucket,
  doubleSided: boolean,
) {
  ctx.faces.add({
    points: pts.map((point) => [point.x, point.y, point.z]),
    uvs: uv,
    normal: [n.x, n.y, n.z],
    bucket,
    doubleSided,
    triangulation: "box",
  });
}

function emitQuad(
  shape: Record<string, unknown>,
  worldPosition: THREE.Vector3,
  worldOrientation: THREE.Quaternion,
  ctx: Ctx,
  bucket: Bucket,
) {
  const settings = shape.settings as { size?: Vec3; normal?: string } | undefined;
  const size = v3(settings?.size);
  const stretch = v3(shape.stretch as Vec3);
  const w = ((size.x || 16) * (stretch.x || 1)) / 2;
  const h = ((size.y || 16) * (stretch.y || 1)) / 2;
  const layout = (shape.textureLayout as Record<string, FaceLayout>) || {};
  const fl = layout.front ?? Object.values(layout)[0];
  if (!fl) return;
  const rect = plugUV(fl.offset ?? { x: 0, y: 0 }, size.x || 16, size.y || 16, fl.mirror ?? {}, fl.angle ?? 0);
  const faceUV = cornerUVs(rect, fl.angle ?? 0, ctx.texW, ctx.texH);

  const normal = typeof settings?.normal === "string" ? settings.normal : "+Z";
  const sign = normal.startsWith("-") ? -1 : 1;
  const axis = normal.slice(-1);
  let local: THREE.Vector3[];
  let localNormal: THREE.Vector3;
  if (axis === "X") {
    local = [
      new THREE.Vector3(0, h, -w),
      new THREE.Vector3(0, h, w),
      new THREE.Vector3(0, -h, -w),
      new THREE.Vector3(0, -h, w),
    ];
    localNormal = new THREE.Vector3(sign, 0, 0);
  } else if (axis === "Y") {
    local = [
      new THREE.Vector3(-w, 0, h),
      new THREE.Vector3(w, 0, h),
      new THREE.Vector3(-w, 0, -h),
      new THREE.Vector3(w, 0, -h),
    ];
    localNormal = new THREE.Vector3(0, sign, 0);
  } else {
    local = [
      new THREE.Vector3(-w, h, 0),
      new THREE.Vector3(w, h, 0),
      new THREE.Vector3(-w, -h, 0),
      new THREE.Vector3(w, -h, 0),
    ];
    localNormal = new THREE.Vector3(0, 0, sign);
  }
  // Las caras negativas conservan la orientación visual de la textura vista desde fuera.
  if (sign < 0) {
    [local[0], local[1]] = [local[1], local[0]];
    [local[2], local[3]] = [local[3], local[2]];
  }
  const pts = local.map((point) => point.applyQuaternion(worldOrientation).add(worldPosition));
  const nrm = localNormal.applyQuaternion(worldOrientation).normalize();
  // `doubleSided` pertenece a cada forma, no al material completo. Las quads de vegetación y
  // flecos suelen activarlo; las cajas estructurales de tejados no. Emitir aquí la cara trasera
  // solo cuando corresponde permite usar FrontSide y evita enseñar interiores del modelo.
  pushQuad(ctx, pts, nrm, faceUV, bucket, shape.doubleSided === true);
}

function pushQuad(
  ctx: Ctx,
  pts: THREE.Vector3[],
  n: THREE.Vector3,
  uv: number[][],
  bucket: Bucket,
  doubleSided: boolean,
) {
  ctx.faces.add({
    points: pts.map((point) => [point.x, point.y, point.z]),
    uvs: uv,
    normal: [n.x, n.y, n.z],
    bucket,
    doubleSided,
    triangulation: "quad",
  });
}
