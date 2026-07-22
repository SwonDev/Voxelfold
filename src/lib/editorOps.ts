/**
 * Operaciones de forma del editor (puras, sin three): dadas celdas de inicio/fin en el
 * plano de construcción, devuelven las celdas a colocar/borrar. Todo en rejilla entera.
 */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/** Línea recta (Bresenham 2D en X-Z, a la altura y de `a`). Para muros: usar altura. */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let x0 = a.x, z0 = a.z;
  const x1 = b.x, z1 = b.z, y = a.y;
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  // tope de seguridad por si los puntos son absurdos
  for (let guard = 0; guard < 4096; guard++) {
    cells.push({ x: x0, y, z: z0 });
    if (x0 === x1 && z0 === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
  return cells;
}

/** Caja entre dos esquinas, extruida `height` capas. `filled`=maciza; si no, solo las paredes
 *  (contorno); con `closed`=true se añaden suelo y techo → caja HUECA/cáscara (como `//hollow`). */
export function rectCells(
  a: Cell,
  b: Cell,
  filled: boolean,
  height: number,
  closed = false,
  limit = Number.POSITIVE_INFINITY,
): Cell[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  const y0 = a.y;
  const h = Math.max(1, Math.floor(height));
  const cells: Cell[] = [];
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || z === z0 || z === z1;
        const cap = closed && (y === y0 || y === y0 + h - 1);
        if (filled || edge || cap) {
          cells.push({ x, y, z });
          if (cells.length >= limit) return cells;
        }
      }
  return cells;
}

/**
 * Relleno por inundación en el plano (X-Z a la altura de `start`): rellena las celdas
 * vacías contiguas, limitado por las celdas ocupadas y por una caja `bounds` (para no
 * desbordar en un plano abierto). Ideal para rellenar un suelo dentro de unos muros.
 */
export function fillCells(
  start: Cell,
  occupied: (x: number, z: number) => boolean,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  limit = 4096,
): Cell[] {
  if (
    start.x < bounds.minX || start.x > bounds.maxX ||
    start.z < bounds.minZ || start.z > bounds.maxZ
  ) return [];
  if (occupied(start.x, start.z)) return [];
  const y = start.y;
  const out: Cell[] = [];
  const seen = new Set<string>([`${start.x},${start.z}`]);
  const stack: [number, number][] = [[start.x, start.z]];
  while (stack.length && out.length < limit) {
    const [x, z] = stack.pop()!;
    if (occupied(x, z)) continue;
    out.push({ x, y, z });
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < bounds.minX || nx > bounds.maxX || nz < bounds.minZ || nz > bounds.maxZ) continue;
      const k = `${nx},${nz}`;
      if (!seen.has(k)) {
        seen.add(k);
        stack.push([nx, nz]);
      }
    }
  }
  return out;
}

/** Brocha: cubo, esfera o cilindro de diámetro `size` centrada en `center`. `hollow`=solo la
 *  cáscara (grosor 1), como el Shape Brush de Hytale con grosor de pared. El cilindro es un
 *  círculo en X-Z extruido toda la altura (size) en Y. */
export function brushCells(
  center: Cell,
  shape: "cube" | "sphere" | "cylinder",
  size: number,
  hollow = false,
): Cell[] {
  // Una brocha centrada en una celda solo puede tener diámetro impar. Los valores pares
  // se redondean hacia arriba (2→3, 4→5) en vez de producir una brocha menor a la indicada.
  const requested = Math.max(1, Math.floor(size));
  const diameter = requested % 2 === 0 ? requested + 1 : requested;
  const r = (diameter - 1) / 2;
  const cells: Cell[] = [];
  const rr = (r + 0.5) * (r + 0.5);
  const ir = (r - 0.5) * (r - 0.5); // radio² interior (para el hueco)
  for (let dx = -r; dx <= r; dx++)
    for (let dy = -r; dy <= r; dy++)
      for (let dz = -r; dz <= r; dz++) {
        let inside: boolean;
        let shell: boolean;
        if (shape === "sphere") {
          const d = dx * dx + dy * dy + dz * dz;
          inside = d <= rr;
          shell = d > ir;
        } else if (shape === "cylinder") {
          const d = dx * dx + dz * dz; // círculo en X-Z, altura completa en Y
          inside = d <= rr;
          shell = d > ir || Math.abs(dy) === r; // pared del anillo + tapas arriba/abajo
        } else {
          inside = true;
          shell = Math.abs(dx) === r || Math.abs(dy) === r || Math.abs(dz) === r;
        }
        if (!inside || (hollow && !shell)) continue;
        cells.push({ x: center.x + dx, y: center.y + dy, z: center.z + dz });
      }
  return cells;
}
