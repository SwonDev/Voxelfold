import { useMemo } from "react";
import * as THREE from "three";

/**
 * Domo de cielo con DEGRADADO (cénit → horizonte → suelo) y un resplandor de sol suave en
 * la dirección de la luz. Da atmósfera de "mundo" en lugar del vacío plano, manteniendo la
 * paleta azul de Hytale. Esfera enorme centrada en el origen (la cámara siempre queda dentro);
 * no escribe profundidad → la escena se dibuja por delante.
 */
export function SkyDome({ sun = [0.5, 0.7, 0.45] }: { sun?: [number, number, number] }) {
  const geo = useMemo(() => new THREE.SphereGeometry(1, 24, 16), []);
  const mat = useMemo(() => {
    const sd = new THREE.Vector3(sun[0], sun[1], sun[2]).normalize();
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uSun: { value: sd } },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uSun;
        void main() {
          float h = vDir.y; // -1 (abajo) .. 1 (arriba)
          vec3 zenith = vec3(0.055, 0.094, 0.150);  // azul profundo
          vec3 horizon = vec3(0.165, 0.225, 0.305);  // azul-gris del horizonte
          vec3 nadir = vec3(0.040, 0.065, 0.095);     // bajo el horizonte
          vec3 col = h > 0.0 ? mix(horizon, zenith, pow(h, 0.65)) : mix(horizon, nadir, pow(-h, 0.6));
          float s = max(dot(vDir, uSun), 0.0);
          col += vec3(1.0, 0.72, 0.42) * pow(s, 6.0) * 0.35;   // halo cálido del sol
          col += vec3(1.0, 0.88, 0.66) * pow(s, 160.0) * 1.4;  // disco suave del sol
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }, [sun[0], sun[1], sun[2]]);
  return <mesh geometry={geo} material={mat} scale={900} frustumCulled={false} renderOrder={-1} />;
}
