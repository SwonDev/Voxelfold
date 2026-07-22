import * as THREE from "three";
import { assetUrl, getAssetGeneration } from "@/lib/api";
import { windClock } from "@/lib/sceneAnimation";
import { configurePixelTexture } from "@/lib/pixelTexture";

/** Sprite sheet NATIVO de llama de Hytale (2×2 = 4 fotogramas, blanco para teñir). */
const FLAME_TEX_PATH = "Common/Particles/Textures/Fire/Fire_Thin.png";

let cachedTex: THREE.Texture | null = null;
let cachedGeneration = -1;

/** Carga (cacheada) la textura nativa de llama del Assets.zip del usuario. */
export function flameTexture(): THREE.Texture {
  const generation = getAssetGeneration();
  if (cachedTex && cachedGeneration === generation) return cachedTex;
  cachedTex?.dispose();
  const t = new THREE.TextureLoader().load(assetUrl(FLAME_TEX_PATH));
  configurePixelTexture(t);
  cachedTex = t;
  cachedGeneration = generation;
  return t;
}

/**
 * Llama NATIVA de antorcha/vela/farol estilo Hytale: billboard con el sprite sheet real
 * del juego (4 fotogramas animados) teñido con el COLOR nativo de cada bloque (la del
 * templo es verde, las velas amarillas, las antorchas naranjas…). Aditivo + brillo > 1
 * para que el Bloom genere el halo. Pensado para un InstancedMesh:
 *  - `instanceMatrix` posiciona y ESCALA cada llama,
 *  - el atributo de instancia `aColor` da su color nativo.
 */
export function flameMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: windClock, uTex: { value: texture } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute vec3 aColor;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vSeed;
      void main() {
        vColor = aColor;
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        vSeed = ip.x * 1.7 + ip.z * 2.3;
        float s = length(vec3(instanceMatrix[0][0], instanceMatrix[0][1], instanceMatrix[0][2]));
        // Sprite sheet 2×2 → ciclo de 4 fotogramas (fila 0 = arriba en la imagen).
        float frame = floor(mod(uTime * 10.0 + vSeed, 4.0));
        float fcol = mod(frame, 2.0);
        float frow = floor(frame * 0.5);
        vUv = vec2((uv.x + fcol) * 0.5, (uv.y + (1.0 - frow)) * 0.5);
        // Billboard: el quad (dimensionado en la geometría) se desplaza en ejes de cámara.
        vec4 mv = modelViewMatrix * vec4(ip, 1.0);
        float wob = sin(uv.y * 6.0 + uTime * 9.0 + vSeed) * 0.05 * uv.y;
        mv.x += position.x * s + wob;
        mv.y += position.y * s;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uTex;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vSeed;
      void main() {
        vec4 t = texture2D(uTex, vUv);
        // La forma está en el alfa o, si no hay alfa, en la luminancia.
        float shape = max(t.a, (t.r + t.g + t.b) * 0.333);
        if (shape < 0.05) discard;
        float flick = 0.8 + 0.2 * sin(uTime * 17.0 + vSeed * 1.7);
        gl_FragColor = vec4(vColor * 1.7 * flick, shape);
      }
    `,
  });
}
