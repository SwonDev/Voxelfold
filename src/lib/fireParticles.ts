import * as THREE from "three";

/**
 * Partículas de fuego NATIVAS para las fuentes con llama (antorchas, velas, hogueras,
 * faroles…): BRASAS (embers) que ascienden con el COLOR nativo de su llama —la antorcha
 * verde del templo suelta brasas verdes— y un HILO DE HUMO gris que se eleva y se disipa.
 *
 * Todo el movimiento (ascenso, deriva lateral, desvanecido, parpadeo) vive en el shader y
 * lo gobierna un único uniform `uTime`: la CPU solo escribe los datos por instancia UNA vez
 * (posición base, color, semilla). Coste por frame ≈ el de actualizar un float. Geometría
 * instanciada (un quad por partícula) orientada a cámara (billboard) en el vertex shader.
 */

const CORNERS = new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]);
const INDEX = [0, 1, 2, 0, 2, 3];

/** Quad instanciado con atributos por partícula: base (vec3), color (vec3), semilla (float). */
function particleGeometry(capacity: number): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("aCorner", new THREE.Float32BufferAttribute(CORNERS, 2));
  g.setIndex(INDEX);
  g.setAttribute("aBase", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  g.setAttribute("aColor", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  g.instanceCount = 0;
  // Esfera amplia: las partículas suben por encima de la base; no las recortes de golpe.
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  return g;
}

export function emberGeometry(capacity: number): THREE.InstancedBufferGeometry {
  return particleGeometry(capacity);
}
export function smokeGeometry(capacity: number): THREE.InstancedBufferGeometry {
  return particleGeometry(capacity);
}

const HASH = /* glsl */ `
  float h11(float n){ return fract(sin(n * 12.9898) * 43758.5453); }
`;

/**
 * BRASAS: puntos brillantes en el color nativo de la llama que ascienden poco, derivan y se
 * apagan. Mezcla aditiva → las recoge el Bloom (chispas que destellan). Pequeñas y vivas.
 */
export function emberMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec3 aBase;
      attribute vec3 aColor;
      attribute float aSeed;
      uniform float uTime;
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;
      ${HASH}
      void main(){
        float speed = 0.22 + 0.18 * h11(aSeed * 1.7);
        float t = fract(uTime * speed + aSeed);              // vida 0..1
        float rise = t * (0.85 + 0.45 * h11(aSeed * 3.1));
        float ang = aSeed * 6.2831 + uTime * 0.6;
        float sway = (0.06 + 0.07 * h11(aSeed * 5.3)) * t;
        vec3 wpos = aBase;
        wpos.y += 0.18 + rise;
        wpos.x += sin(ang) * sway;
        wpos.z += cos(ang) * sway;
        float size = (0.030 + 0.022 * h11(aSeed * 2.2)) * (1.0 - 0.55 * t);
        vec4 mv = modelViewMatrix * vec4(wpos, 1.0);
        mv.xy += aCorner * size;                              // billboard en espacio de cámara
        gl_Position = projectionMatrix * mv;
        // Parpadeo + entra rápido y se apaga al final de su vida.
        float flick = 0.7 + 0.3 * h11(aSeed + floor(uTime * 8.0) * 0.13);
        vAlpha = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.45, 1.0, t)) * flick;
        vColor = aColor;
        vUv = aCorner;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vColor;
      varying float vAlpha;
      varying vec2 vUv;
      void main(){
        float d = length(vUv * 2.0);                         // disco suave
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * vAlpha;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor * 1.6, a);                // sobre-brillo → Bloom
      }
    `,
  });
}

/**
 * HUMO: vellones grises translúcidos que se elevan más alto, se ensanchan y se disipan.
 * Mezcla normal (no aditiva) para que oscurezca como humo real, con alpha bajo (sutil).
 */
export function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 aCorner;
      attribute vec3 aBase;
      attribute vec3 aColor;
      attribute float aSeed;
      uniform float uTime;
      varying float vAlpha;
      varying vec2 vUv;
      ${HASH}
      void main(){
        float speed = 0.10 + 0.06 * h11(aSeed * 1.3);
        float t = fract(uTime * speed + aSeed);
        float rise = t * (1.4 + 0.6 * h11(aSeed * 2.7));
        float ang = aSeed * 6.2831 + uTime * 0.25;
        float sway = (0.10 + 0.10 * h11(aSeed * 4.1)) * t;
        vec3 wpos = aBase;
        wpos.y += 0.5 + rise;
        wpos.x += sin(ang) * sway;
        wpos.z += cos(ang) * sway;
        float size = (0.10 + 0.05 * h11(aSeed * 2.0)) * (0.6 + 1.1 * t);  // se ensancha al subir
        vec4 mv = modelViewMatrix * vec4(wpos, 1.0);
        mv.xy += aCorner * size;
        gl_Position = projectionMatrix * mv;
        vAlpha = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.4, 1.0, t)) * 0.16;
        vUv = aCorner;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      varying vec2 vUv;
      void main(){
        float d = length(vUv * 2.0);
        float a = (1.0 - smoothstep(0.0, 1.0, d)) * vAlpha;
        if (a < 0.005) discard;
        gl_FragColor = vec4(vec3(0.32, 0.34, 0.38), a);      // gris azulado frío (humo)
      }
    `,
  });
}

/** Semilla pseudoaleatoria estable por índice (no usa Math.random → idéntica entre renders). */
export function seedFor(i: number): number {
  const s = Math.sin(i * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}
