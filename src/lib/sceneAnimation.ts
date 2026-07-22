import * as THREE from "three";

/**
 * Animación de escena estilo Hytale 1:1, vía inyección de shader (GPU, sin coste de CPU
 * por bloque). Un reloj compartido `windClock` lo avanza <SceneClock/> cada frame; los
 * materiales lo leen como uniform.
 *
 *  - applyWindSway: hierba/hojas/follaje se mecen con el viento (la base queda fija, las
 *    puntas oscilan). Funciona con instancing y con mallas de modelo.
 *  - applyFlame: solo la geometría de llama se anima; el cuerpo y la textura del bloque
 *    permanecen estables para no producir parpadeo visual al orbitar la cámara.
 */

/** Reloj de animación en segundos. Lo avanza <SceneClock/>. Compartido por todos los materiales. */
export const windClock = { value: 0 };

const SWAY_TAG = "vf_sway";
const FLAME_TAG = "vf_flame";
const WATER_TAG = "vf_water";
const FEATURES_TAG = "vf_shader_features";

type Taggable = THREE.Material & { userData: Record<string, unknown> };

function registerShaderFeature(material: THREE.Material, feature: string): void {
  const mat = material as Taggable;
  const current = Array.isArray(mat.userData[FEATURES_TAG])
    ? (mat.userData[FEATURES_TAG] as string[])
    : [];
  const features = Array.from(new Set([...current, feature])).sort();
  mat.userData[FEATURES_TAG] = features;
  // La clave representa la COMBINACIÓN completa. Si cada efecto sobrescribe la clave con
  // su propio nombre, Three puede reutilizar para `agua+viento` el shader de solo `agua`.
  const key = `voxelfold:${features.join("+")}`;
  material.customProgramCacheKey = () => key;
}

/**
 * `Material.clone()` no copia los callbacks de shader de Three.js. Este clon conserva
 * explícitamente los efectos GPU y su clave de programa (luz voxel, smooth meshes, etc.).
 */
export function cloneMaterialWithEffects<T extends THREE.Material>(material: T): T {
  const clone = material.clone() as T;
  clone.onBeforeCompile = material.onBeforeCompile;
  clone.customProgramCacheKey = material.customProgramCacheKey;
  clone.needsUpdate = true;
  return clone;
}

/** Hierba/hojas/follaje: vaivén de viento (vértices altos se mecen, base fija). */
export function applyWindSway(m: THREE.Material): void {
  const mat = m as Taggable;
  if (mat.userData[SWAY_TAG]) return;
  mat.userData[SWAY_TAG] = true;
  const prev = m.onBeforeCompile?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uWind = windClock;
    shader.vertexShader =
      "uniform float uWind;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 vfW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          #else
            vec3 vfW = (modelMatrix * vec4(position, 1.0)).xyz;
          #endif
          float vfPhase = vfW.x * 0.6 + vfW.z * 0.6;
          float vfH = clamp(position.y + 0.5, 0.0, 1.6);
          transformed.x += sin(uWind * 1.7 + vfPhase) * 0.045 * vfH;
          transformed.z += cos(uWind * 1.35 + vfPhase * 1.3) * 0.035 * vfH;
        }`
      );
  };
  // Distingue los materiales con sway en la caché de programas (se suma a la clave por defecto,
  // que ya diferencia por instancing/map/alphaTest…).
  registerShaderFeature(m, SWAY_TAG);
  m.needsUpdate = true;
}

/**
 * LLAMA viva de antorcha/vela (geometría `fullbright` del modelo): aletea (los vértices
 * altos bailan) y la emisión titila con fuerza, como una llama real de Hytale. Combina
 * el flutter de vértices + el parpadeo de emisión en un solo material.
 */
export function applyFlame(m: THREE.Material): void {
  const mat = m as Taggable;
  if (mat.userData[FLAME_TAG]) return;
  mat.userData[FLAME_TAG] = true;
  const prev = m.onBeforeCompile?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uWind = windClock;
    shader.vertexShader =
      "uniform float uWind;\nvarying float vVfPhase;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vVfPhase = (instanceMatrix[3].x + instanceMatrix[3].z) * 1.7;
          #else
            vVfPhase = (modelMatrix[3].x + modelMatrix[3].z) * 1.7;
          #endif
          // La llama está anclada en su base; las puntas (y alta) bailan y se estiran.
          float vfH = clamp(position.y + 0.5, 0.0, 1.6);
          transformed.x += sin(uWind * 9.0 + vVfPhase) * 0.05 * vfH;
          transformed.z += cos(uWind * 7.0 + vVfPhase * 1.4) * 0.04 * vfH;
          transformed.y += (sin(uWind * 12.0 + vVfPhase) * 0.5 + 0.5) * 0.08 * vfH;
        }`
      );
    shader.fragmentShader =
      "uniform float uWind;\nvarying float vVfPhase;\n" +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float vfFlame = 0.70 + 0.22 * sin(uWind * 10.0 + vVfPhase) + 0.12 * sin(uWind * 23.0 + vVfPhase * 2.3);
        totalEmissiveRadiance *= vfFlame;`
      );
  };
  registerShaderFeature(m, FLAME_TAG);
  m.needsUpdate = true;
}

/**
 * AGUA/fluido: la superficie superior ondea suavemente (olas cruzadas) como en Hytale. Solo
 * mueve los vértices ALTOS (la cara de arriba del fluido), los del fondo quedan fijos.
 */
export function applyWaterWave(m: THREE.Material): void {
  const mat = m as Taggable;
  if (mat.userData[WATER_TAG]) return;
  mat.userData[WATER_TAG] = true;
  const prev = m.onBeforeCompile?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uWind = windClock;
    shader.vertexShader =
      "uniform float uWind;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            vec3 vfW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
          #else
            vec3 vfW = (modelMatrix * vec4(position, 1.0)).xyz;
          #endif
          float vfTop = smoothstep(0.0, 0.5, position.y + 0.5); // 0 abajo, 1 en la cara de arriba
          transformed.y += (sin(uWind * 1.6 + vfW.x * 1.4) + cos(uWind * 1.9 + vfW.z * 1.6)) * 0.035 * vfTop;
        }`
      );
  };
  registerShaderFeature(m, WATER_TAG);
  m.needsUpdate = true;
}
