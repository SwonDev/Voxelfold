/** Contrato oficial `RotationTuple`: index = roll·16 + pitch·4 + yaw. */
export interface HytaleRotation {
  yaw: number;
  pitch: number;
  roll: number;
}

export type RotationMatrix = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

const ROTATION_COUNT = 64;

export function normalizeRotation(rotation = 0): number {
  return ((Math.trunc(rotation) % ROTATION_COUNT) + ROTATION_COUNT) % ROTATION_COUNT;
}

export function decodeRotation(rotation = 0): HytaleRotation {
  const value = normalizeRotation(rotation);
  return {
    yaw: value % 4,
    pitch: Math.floor(value / 4) % 4,
    roll: Math.floor(value / 16) % 4,
  };
}

export function encodeRotation({ yaw, pitch, roll }: HytaleRotation): number {
  const component = (value: number) => ((Math.trunc(value) % 4) + 4) % 4;
  return component(roll) * 16 + component(pitch) * 4 + component(yaw);
}

const cos90 = (rotation: number) => [1, 0, -1, 0][rotation & 3];
const sin90 = (rotation: number) => [0, 1, 0, -1][rotation & 3];

/** Matriz entera exacta `Ry · Rx · Rz`, equivalente a `RotationTuple.eulerToMatrix`. */
export function rotationMatrix(rotation = 0): RotationMatrix {
  const { yaw, pitch, roll } = decodeRotation(rotation);
  const cy = cos90(yaw), sy = sin90(yaw);
  const cp = cos90(pitch), sp = sin90(pitch);
  const cr = cos90(roll), sr = sin90(roll);
  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr, cp * cr, -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}

function multiply(a: RotationMatrix, b: RotationMatrix): RotationMatrix {
  return [0, 1, 2].map((row) =>
    [0, 1, 2].map(
      (col) => a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col],
    ),
  ) as RotationMatrix;
}

function atan90(sin: number, cos: number): number {
  if (sin === 0 && cos === 1) return 0;
  if (sin === 1 && cos === 0) return 1;
  if (sin === 0 && cos === -1) return 2;
  if (sin === -1 && cos === 0) return 3;
  throw new Error(`Matriz de rotación Hytale no ortogonal: sin=${sin}, cos=${cos}`);
}

/** Canonicaliza una matriz ortogonal de cuartos de vuelta al índice oficial 0..63. */
function matrixRotation(matrix: RotationMatrix): number {
  const sp = -matrix[1][2];
  const pitch = sp === 1 ? 1 : sp === -1 ? 3 : 0;
  const yaw = sp !== 1 && sp !== -1
    ? atan90(matrix[0][2], matrix[2][2])
    : atan90(-matrix[2][0], matrix[0][0]);
  const roll = sp !== 1 && sp !== -1 ? atan90(matrix[1][0], matrix[1][1]) : 0;
  return encodeRotation({ yaw, pitch, roll });
}

/** Compone un giro de 90° en el eje vertical con la orientación existente. */
export function rotateRotationY(rotation: number): number {
  const quarterY: RotationMatrix = [[0, 0, 1], [0, 1, 0], [-1, 0, 0]];
  return matrixRotation(multiply(quarterY, rotationMatrix(rotation)));
}

/** Reflejo espacial alrededor de X, canonicalizado de nuevo como rotación propia. */
export function mirrorRotationX(rotation: number): number {
  const reflectX: RotationMatrix = [[-1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return matrixRotation(multiply(multiply(reflectX, rotationMatrix(rotation)), reflectX));
}

/** Reflejo espacial alrededor de Z, canonicalizado de nuevo como rotación propia. */
export function mirrorRotationZ(rotation: number): number {
  const reflectZ: RotationMatrix = [[1, 0, 0], [0, 1, 0], [0, 0, -1]];
  return matrixRotation(multiply(multiply(reflectZ, rotationMatrix(rotation)), reflectZ));
}

const CARDINAL = ["Norte", "Este", "Sur", "Oeste"];
const QUARTER = ["0°", "90°", "180°", "270°"];

export function rotationLabel(rotation: number): string {
  const { yaw, pitch, roll } = decodeRotation(rotation);
  const tilt = pitch === 0 ? "En pie" : pitch === 1 ? "Inclinado 90°" : pitch === 2 ? "Boca abajo" : "Inclinado 270°";
  return `${tilt} · ${CARDINAL[yaw]}${roll ? ` · alabeo ${QUARTER[roll]}` : ""}`;
}
