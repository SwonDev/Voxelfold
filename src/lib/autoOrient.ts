/**
 * Colocación inteligente: orienta automáticamente los bloques DIRECCIONALES (escaleras,
 * puertas, ventanas, muebles, verjas…) para que su FRENTE mire hacia la cámara —el gesto
 * nativo de Hytale/Minecraft al colocar—, en vez de dejarlos siempre con la rotación manual.
 *
 * Convención NESW del proyecto (ver orientationQuat + resolveBlock): el frente del modelo en
 * rotación 0 mira a −Z (Norte). yaw = rotación % 4: 0=N(−Z), 1=E(+X), 2=S(+Z), 3=O(−X).
 * Solo afecta al YAW; conserva pitch y roll del `RotationTuple` que el usuario tenga puesto.
 * Los cubos y la inmensa mayoría de bloques NO son direccionales → se dejan tal cual.
 */

// Tipos con orientación NESW clara (su frente importa). Excluye losas/troncos/pilares, cuya
// `rotation` codifica eje/altura (no un frente), para no estropearlos.
// OJO: los TEJADOS NO van aquí. La auto-orientación fijaba su yaw hacia la cámara e impedía
// rotarlos a mano con R (el usuario lo necesita). Los tejados se rotan manualmente.
const ORIENTABLE = /stair|door|window|trapdoor|furniture|gate|ladder|sign|banner|chair|stool|bench|desk|counter|shelf|lectern|loom|anvil|forge|oven|stove|fireplace/i;

/** ¿El bloque es direccional (su frente mira a un lado)? */
export function isOrientableName(name: string): boolean {
  const n = name.startsWith("*") ? name.slice(1) : name;
  return ORIENTABLE.test(n);
}

/** Yaw NESW (0..3) para que el FRENTE del bloque (en `bx,bz`) mire hacia la cámara. */
export function yawFacingCamera(camX: number, camZ: number, bx: number, bz: number): number {
  const dx = camX - bx;
  const dz = camZ - bz;
  // Eje dominante: la cámara está más a los lados (X) o delante/detrás (Z).
  if (Math.abs(dx) >= Math.abs(dz)) return dx >= 0 ? 1 : 3; // +X=Este, −X=Oeste
  return dz >= 0 ? 2 : 0; // +Z=Sur, −Z=Norte
}

/**
 * Rotación oficial 0-63 sugerida al colocar `name` en `(bx,bz)` con la cámara en
 * `(camX,camZ)`. No direccional → devuelve `current` sin tocar. Direccional → conserva
 * pitch/roll y fija el yaw mirando a la cámara.
 */
export function suggestRotation(
  name: string,
  camX: number,
  camZ: number,
  bx: number,
  bz: number,
  current: number,
): number {
  if (!isOrientableName(name)) return current;
  const value = ((Math.trunc(current) % 64) + 64) % 64;
  const pitch = Math.floor(value / 4) % 4;
  const roll = Math.floor(value / 16) % 4;
  return roll * 16 + pitch * 4 + yawFacingCamera(camX, camZ, bx, bz);
}
