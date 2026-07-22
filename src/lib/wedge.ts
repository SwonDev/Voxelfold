import * as THREE from "three";

/**
 * Geometría de LOSA DE PENDIENTE (paralelepípedo inclinado) unitaria para tejados,
 * centrada en la celda. Cara superior = pendiente (de la esquina alta -Z,+Y a la baja
 * +Z,-Y, como el default de `Slope.blockymodel`); cara inferior paralela, desplazada
 * hacia dentro un grosor `t`. `orientationQuat(rotation)` la orienta como el juego.
 *
 * A diferencia de un triángulo macizo, la cara inferior también es un plano inclinado:
 * losas consecutivas (escalonadas en diagonal) tejan compartiendo arista arriba Y abajo,
 * así que el tejado se ve LIMPIO desde cualquier ángulo (no escalera por debajo).
 * Es un proxy de esquema; el detalle real se ve en el icono nativo del bloque.
 */
export function makeWedgeGeometry(): THREE.BufferGeometry {
  const t = 0.5; // grosor de la losa
  const o = t / Math.SQRT2; // desplazamiento perpendicular (normal de la pendiente = (0,1,1)/√2)

  // Cara superior (la pendiente): T0..T3. Inferior: B0..B3 = top + (0,-o,-o).
  const T0 = [-0.5, 0.5, -0.5];
  const T1 = [0.5, 0.5, -0.5];
  const T2 = [0.5, -0.5, 0.5];
  const T3 = [-0.5, -0.5, 0.5];
  const B0 = [-0.5, 0.5 - o, -0.5 - o];
  const B1 = [0.5, 0.5 - o, -0.5 - o];
  const B2 = [0.5, -0.5 - o, 0.5 - o];
  const B3 = [-0.5, -0.5 - o, 0.5 - o];

  const pos: number[] = [];
  const nrm: number[] = [];
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tri = (p: number[], q: number[], r: number[]) => {
    // normal plana por triángulo (cross product) → caras nítidas
    a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    b.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    v.crossVectors(a, b).normalize();
    pos.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) nrm.push(v.x, v.y, v.z);
  };
  const quad = (p: number[], q: number[], r: number[], s: number[]) => {
    tri(p, q, r);
    tri(p, r, s);
  };

  quad(T0, T3, T2, T1); // pendiente (arriba)
  quad(B0, B1, B2, B3); // inferior
  quad(T0, T1, B1, B0); // borde alto (-Z)
  quad(T2, T3, B3, B2); // borde bajo/alero (+Z)
  quad(T0, B0, B3, T3); // lateral x-
  quad(T1, T2, B2, B1); // lateral x+

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

/**
 * Geometría de ESQUINA de tejado (hip), centrada en la celda. `inner=false` = esquina
 * exterior (alta en la esquina −X,−Z, baja hacia +X y +Z, con cumbrera diagonal);
 * `inner=true` = esquina interior (valle: baja en −X,−Z, alta hacia +X/+Z). Superficie
 * fina (doble cara), coherente con las losas de pendiente. `orientationQuat` la orienta.
 */
export function makeHipGeometry(inner: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const v = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const tri = (p: number[], q: number[], r: number[]) => {
    a.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    b.set(r[0] - p[0], r[1] - p[1], r[2] - p[2]);
    v.crossVectors(a, b).normalize();
    pos.push(...p, ...q, ...r);
    for (let i = 0; i < 3; i++) nrm.push(v.x, v.y, v.z);
  };
  if (!inner) {
    const H = [-0.5, 0.5, -0.5]; // alto: esquina interior de la celda
    const LX = [0.5, -0.5, -0.5];
    const LZ = [-0.5, -0.5, 0.5];
    const LC = [0.5, -0.5, 0.5]; // bajo: esquina exterior
    tri(H, LX, LC);
    tri(H, LC, LZ);
  } else {
    const V = [-0.5, -0.5, -0.5]; // valle
    const HX = [0.5, 0.5, -0.5];
    const HZ = [-0.5, 0.5, 0.5];
    const HC = [0.5, 0.5, 0.5];
    tri(V, HX, HC);
    tri(V, HC, HZ);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.computeBoundingSphere();
  return g;
}

/** Geometría de tejado degradado según su forma (pendiente / esquina hip / interior). */
export function makeRoofGeometry(shape: "slope" | "corner" | "inner" | null): THREE.BufferGeometry {
  if (shape === "corner") return makeHipGeometry(false);
  if (shape === "inner") return makeHipGeometry(true);
  return makeWedgeGeometry();
}
