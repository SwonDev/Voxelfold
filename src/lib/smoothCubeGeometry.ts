import * as THREE from "three";
import type { VoxelLight } from "@/lib/voxelLight";

/**
 * Construye UNA geometría fusionada para un grupo de cubos con SMOOTH LIGHTING por vértice
 * (estilo Minecraft/Hytale): cada esquina de cada cara recibe la MEDIA de la luz de las
 * celdas de aire que la tocan + oclusión ambiental por vértice (esquinas cóncavas más
 * oscuras). El color va en el atributo `color` (lo multiplica el material con `vertexColors`).
 * Conserva los 6 grupos de material de la caja (caras laterales/arriba/abajo) → texturas OK.
 *
 * FACE CULLING (técnica de los modders de voxel): NO se emiten las caras que dan a otro cubo
 * OPACO (caras internas entre bloques pegados, que nunca se ven). En una construcción maciza
 * eso elimina la gran mayoría de triángulos → las pasadas de color, sombra y normales (AO)
 * procesan muchísima menos geometría. Las caras que dan a aire, cristal o modelos se mantienen.
 */

const BOX = new THREE.BoxGeometry(1, 1, 1);
const BPOS = BOX.attributes.position.array as ArrayLike<number>;
const BNOR = BOX.attributes.normal.array as ArrayLike<number>;
const BUV = BOX.attributes.uv.array as ArrayLike<number>;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
// Multiplicador de AO por nº de oclusores (0..3): 2 lados sólidos = el más oscuro. Suavizado
// (antes 0.6 mín) para que el contraste no marque tanto el "seam" diagonal de la triangulación.
const AO_MUL = [0.74, 0.84, 0.92, 1.0];
// Patrones de triangulación de una cara (4 vértices locales 0=BL,1=BR,2=TL,3=TR de BoxGeometry):
// KEEP = diagonal BR-TL (patrón nativo); FLIP = diagonal BL-TR. Se elige el que NO cruce el
// gradiente de AO (corrige el "seam"/línea diagonal de la oclusión ambiental).
const TRI_KEEP = [0, 2, 1, 2, 3, 1];
const TRI_FLIP = [0, 2, 3, 0, 3, 1];

interface CubeVox {
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export function buildSmoothCubeGeometry(
  blocks: CubeVox[],
  center: [number, number, number],
  L: VoxelLight,
  quatFor: (rotation: number) => [number, number, number, number],
  cullSelf = false,
): THREE.BufferGeometry {
  // `cullSelf`: para grupos TRANSLÚCIDOS homogéneos (agua, cristal) → cullear también la cara
  // que da a OTRA celda del MISMO grupo, para no dibujar 2 caras coplanares translúcidas (doble
  // mezcla alfa + parpadeo entre celdas de agua/cristal adyacentes). Solo la cáscara exterior.
  const own = cullSelf ? new Set(blocks.map((b) => `${b.x},${b.y},${b.z}`)) : null;
  // Arrays dinámicos: con face culling el nº de caras emitidas es variable (no n*24 fijo).
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idxByFace: number[][] = [[], [], [], [], [], []];
  const sgn = (v: number) => (v >= 0 ? 1 : -1);
  let vCount = 0; // vértices emitidos hasta ahora

  for (const b of blocks) {
    const [qx, qy, qz, qw] = quatFor(b.rotation);
    _q.set(qx, qy, qz, qw);
    const ox = b.x - center[0], oy = b.y - center[1], oz = b.z - center[2];

    for (let f = 0; f < 6; f++) {
      const fv0 = f * 4; // primer vértice de la cara en la BoxGeometry
      // Normal de la cara (rotada) → dirección de mundo y celda vecina a la que da.
      _n.set(BNOR[fv0 * 3], BNOR[fv0 * 3 + 1], BNOR[fv0 * 3 + 2]).applyQuaternion(_q);
      const nx = Math.round(_n.x), ny = Math.round(_n.y), nz = Math.round(_n.z);
      const cbx = b.x + nx, cby = b.y + ny, cbz = b.z + nz;

      // FACE CULLING: omitir la cara SOLO si la celda vecina es un CUBO MACIZO OPACO COMPLETO
      // que la tapa de verdad (`coversFace`, criterio ESTRICTO que excluye losas/escaleras/
      // cuñas/tejados/plantas/cristal/agua — todo lo que NO llena la celda). Con criterios más
      // laxos (`isSolid`=todos, o `!isOpen`=incluye losas/escaleras opacas) salían HUECOS.
      if (L.coversFace(cbx, cby, cbz)) continue;
      // Translúcido junto al MISMO translúcido (agua-agua, cristal-cristal): cara interna oculta.
      if (own && own.has(`${cbx},${cby},${cbz}`)) continue;

      const v0 = vCount; // índice global del primer vértice de esta cara
      const ao4: number[] = []; // AO de las 4 esquinas (para orientar la diagonal)
      for (let k = 0; k < 4; k++) {
        const vi = fv0 + k;
        _v.set(BPOS[vi * 3], BPOS[vi * 3 + 1], BPOS[vi * 3 + 2]).applyQuaternion(_q);
        pos.push(_v.x + ox, _v.y + oy, _v.z + oz);
        const offx = _v.x, offy = _v.y, offz = _v.z; // esquina rotada (±0.5 en ejes de mundo)
        nor.push(_n.x, _n.y, _n.z);
        uv.push(BUV[vi * 2], BUV[vi * 2 + 1]);

        // Dos tangentes (ejes ≠ normal) con el signo de la esquina.
        let t1x = 0, t1y = 0, t1z = 0, t2x = 0, t2y = 0, t2z = 0;
        if (nx !== 0) { t1y = sgn(offy); t2z = sgn(offz); }
        else if (ny !== 0) { t1x = sgn(offx); t2z = sgn(offz); }
        else { t1x = sgn(offx); t2y = sgn(offy); }

        // Luz suavizada = media del color de luz de las celdas ABIERTAS que tocan la esquina.
        let r = 0, g = 0, bb = 0, cnt = 0;
        const acc = (cx: number, cy: number, cz: number) => {
          if (L.isOpen(cx, cy, cz)) {
            const c = L.lightAt(cx, cy, cz);
            r += c[0]; g += c[1]; bb += c[2]; cnt++;
          }
        };
        acc(cbx, cby, cbz);
        acc(cbx + t1x, cby + t1y, cbz + t1z);
        acc(cbx + t2x, cby + t2y, cbz + t2z);
        acc(cbx + t1x + t2x, cby + t1y + t2y, cbz + t1z + t2z);
        if (cnt === 0) {
          const c = L.lightAt(cbx, cby, cbz);
          r = c[0]; g = c[1]; bb = c[2]; cnt = 1;
        }
        r /= cnt; g /= cnt; bb /= cnt;

        // AO por vértice: oclusores = los dos lados + la esquina (por fuera de la cara).
        const s1 = L.isSolid(cbx + t1x, cby + t1y, cbz + t1z) ? 1 : 0;
        const s2 = L.isSolid(cbx + t2x, cby + t2y, cbz + t2z) ? 1 : 0;
        const sc = L.isSolid(cbx + t1x + t2x, cby + t1y + t2y, cbz + t1z + t2z) ? 1 : 0;
        const level = s1 && s2 ? 0 : 3 - (s1 + s2 + sc);
        const ao = AO_MUL[level];
        ao4.push(ao);
        col.push(r * ao, g * ao, bb * ao);
      }
      // Triangulación ANTI-SEAM: orienta la diagonal por el AO de las esquinas. Si la diagonal
      // BR-TL (nativa) cruza el gradiente fuerte de oclusión, se usa la BL-TR → sin la línea
      // diagonal visible de la oclusión ambiental en la cara.
      const tri = ao4[0] + ao4[3] > ao4[1] + ao4[2] ? TRI_FLIP : TRI_KEEP;
      for (let k = 0; k < 6; k++) idxByFace[f].push(v0 + tri[k]);
      vCount += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const index: number[] = [];
  let start = 0;
  for (let f = 0; f < 6; f++) {
    for (const idx of idxByFace[f]) index.push(idx);
    if (idxByFace[f].length > 0) geo.addGroup(start, idxByFace[f].length, f);
    start += idxByFace[f].length;
  }
  geo.setIndex(index);
  return geo;
}
