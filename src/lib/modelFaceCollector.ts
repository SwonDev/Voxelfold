export type ModelFaceBucket = "std" | "em" | "flat" | "reflective";

type Surface = {
  points: number[][];
  uvs: number[][];
  normal: number[];
  bucket: ModelFaceBucket;
  doubleSided: boolean;
  triangulation: "box" | "quad";
};

export type ModelFaceBuffers = Record<
  ModelFaceBucket,
  { positions: number[]; normals: number[]; uvs: number[] }
>;

const BUCKET_PRIORITY: Record<ModelFaceBucket, number> = {
  std: 0,
  flat: 1,
  reflective: 2,
  em: 3,
};

const ROUND = 1e6;

function numberKey(value: number): string {
  const rounded = Math.round(value * ROUND) / ROUND;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function vectorKey(value: number[]): string {
  return value.map(numberKey).join(",");
}

/**
 * Identidad visual de una cara: posición + normal + UV asociada a cada vértice.
 *
 * No depende del orden de triangulación, así detecta tanto formas duplicadas como una misma
 * superficie exportada una vez a `flat` y otra a `fullbright`. La tolerancia de una millonésima
 * conserva los offsets deliberados de los assets (0,001 es habitual) y solo colapsa copias
 * efectivamente indistinguibles para el búfer de profundidad.
 */
function surfaceKey(surface: Surface): string {
  const vertices = surface.points
    .map((point, index) => `${vectorKey(point)}=${vectorKey(surface.uvs[index] ?? [0, 0])}`)
    .sort()
    .join("|");
  return `${vectorKey(surface.normal)}::${vertices}`;
}

function frontOrder(surface: Surface): number[] {
  const preferred = surface.triangulation === "box"
    ? [0, 2, 1, 2, 3, 1]
    : [0, 1, 2, 0, 2, 3];
  const reversed = surface.triangulation === "box"
    ? [0, 1, 2, 2, 1, 3]
    : [0, 2, 1, 0, 3, 2];
  const [a, b, c] = preferred.map((index) => surface.points[index]);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const raw = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const dot = raw[0] * surface.normal[0]
    + raw[1] * surface.normal[1]
    + raw[2] * surface.normal[2];
  return dot >= 0 ? preferred : reversed;
}

/**
 * Acumula caras de un `.blockymodel` y elimina solapes exactos antes de crear geometrías.
 * Cuando la misma cara aparece con varios modos, conserva el de mayor intención visual:
 * fullbright → reflective → flat → standard. `doubleSided` se fusiona, nunca se pierde.
 */
export class ModelFaceCollector {
  private readonly surfaces = new Map<string, Surface>();

  add(surface: Surface): void {
    const key = surfaceKey(surface);
    const previous = this.surfaces.get(key);
    if (!previous) {
      this.surfaces.set(key, surface);
      return;
    }
    const doubleSided = previous.doubleSided || surface.doubleSided;
    if (BUCKET_PRIORITY[surface.bucket] > BUCKET_PRIORITY[previous.bucket]) {
      this.surfaces.set(key, { ...surface, doubleSided });
    } else if (doubleSided !== previous.doubleSided) {
      this.surfaces.set(key, { ...previous, doubleSided });
    }
  }

  build(): ModelFaceBuffers {
    const buffers: ModelFaceBuffers = {
      std: { positions: [], normals: [], uvs: [] },
      em: { positions: [], normals: [], uvs: [] },
      flat: { positions: [], normals: [], uvs: [] },
      reflective: { positions: [], normals: [], uvs: [] },
    };
    for (const surface of this.surfaces.values()) {
      const target = buffers[surface.bucket];
      const front = frontOrder(surface);
      for (const index of front) {
        target.positions.push(...surface.points[index]);
        target.normals.push(...surface.normal);
        target.uvs.push(...surface.uvs[index]);
      }
      if (surface.doubleSided) {
        for (let triangle = 0; triangle < front.length; triangle += 3) {
          for (const index of [front[triangle], front[triangle + 2], front[triangle + 1]]) {
            target.positions.push(...surface.points[index]);
            target.normals.push(-surface.normal[0], -surface.normal[1], -surface.normal[2]);
            target.uvs.push(...surface.uvs[index]);
          }
        }
      }
    }
    return buffers;
  }
}
