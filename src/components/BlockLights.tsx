import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { flameMaterial, flameTexture } from "@/lib/flameMaterial";
import type { LightSource } from "@/lib/lightSources";
import {
  emberGeometry,
  emberMaterial,
  smokeGeometry,
  smokeMaterial,
  seedFor,
} from "@/lib/fireParticles";
import { windClock } from "@/lib/sceneAnimation";

/** Campo de llamas nativas (sprite sheet real teñido por instancia). Sin remontar al colocar. */
function FlameField({ sources }: { sources: LightSource[] }) {
  const flames = useMemo(() => sources.filter((s) => s.flame), [sources]);
  // Capacidad en cubos de 64 → solo remonta al cruzar un múltiplo de 64 (raro), no al
  // colocar cada antorcha (evita el tirón).
  const capacity = Math.max(64, Math.ceil(flames.length / 64) * 64);
  const ref = useRef<THREE.InstancedMesh>(null);
  const tex = useMemo(() => flameTexture(), []);
  const geo = useMemo(() => {
    const g = new THREE.PlaneGeometry(0.5, 0.72);
    g.translate(0, 0.36, 0);
    g.setAttribute("aColor", new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
    return g;
  }, [capacity]);
  const mat = useMemo(() => flameMaterial(tex), [tex]);
  useFrame(() => {
    mat.uniforms.uTime.value = windClock.value;
  });
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const colAttr = geo.getAttribute("aColor") as THREE.InstancedBufferAttribute;
    flames.forEach((s, i) => {
      dummy.position.set(s.pos[0], s.pos[1] + 0.45 + s.offsetY, s.pos[2]);
      dummy.scale.setScalar(s.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const c = s.flame!;
      colAttr.setXYZ(i, c[0], c[1], c[2]);
    });
    mesh.count = flames.length;
    mesh.instanceMatrix.needsUpdate = true;
    colAttr.needsUpdate = true;
  }, [flames, geo]);
  useLayoutEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );
  if (!flames.length) return null;
  return (
    <instancedMesh key={capacity} ref={ref} args={[geo, mat, capacity]} frustumCulled={false} />
  );
}

/**
 * Partículas de fuego nativas: BRASAS (con el color de la llama) y un hilo de HUMO por cada
 * fuente con fuego. Dos mallas instanciadas (quad por partícula) animadas íntegramente en el
 * shader vía `uTime` → la CPU solo rellena los búferes al cambiar las fuentes. Capacidad por
 * tramos (×64 fuentes) para no remontar al colocar cada antorcha.
 */
const EMBERS_PER = 5;
const SMOKE_PER = 3;

function FireParticles({ sources }: { sources: LightSource[] }) {
  const flames = useMemo(() => sources.filter((s) => s.flame), [sources]);
  const cap = Math.max(64, Math.ceil(flames.length / 64) * 64); // tramo de fuentes

  const emberGeo = useMemo(() => emberGeometry(cap * EMBERS_PER), [cap]);
  const smokeGeo = useMemo(() => smokeGeometry(cap * SMOKE_PER), [cap]);
  const emberMat = useMemo(() => emberMaterial(), []);
  const smokeMat = useMemo(() => smokeMaterial(), []);

  useFrame(() => {
    emberMat.uniforms.uTime.value = windClock.value;
    smokeMat.uniforms.uTime.value = windClock.value;
  });

  useLayoutEffect(() => {
    const fill = (geo: THREE.InstancedBufferGeometry, per: number) => {
      const base = geo.getAttribute("aBase") as THREE.InstancedBufferAttribute;
      const col = geo.getAttribute("aColor") as THREE.InstancedBufferAttribute;
      const seed = geo.getAttribute("aSeed") as THREE.InstancedBufferAttribute;
      let n = 0;
      flames.forEach((s, fi) => {
        const c = s.flame!;
        const sy = s.pos[1] + 0.45 + s.offsetY;
        for (let k = 0; k < per; k++) {
          base.setXYZ(n, s.pos[0], sy, s.pos[2]);
          col.setXYZ(n, c[0], c[1], c[2]);
          seed.setX(n, seedFor(fi * 17 + k * 7 + 1));
          n++;
        }
      });
      geo.instanceCount = n;
      base.needsUpdate = true;
      col.needsUpdate = true;
      seed.needsUpdate = true;
    };
    fill(emberGeo, EMBERS_PER);
    fill(smokeGeo, SMOKE_PER);
  }, [flames, emberGeo, smokeGeo]);

  useLayoutEffect(
    () => () => {
      emberGeo.dispose();
      smokeGeo.dispose();
      emberMat.dispose();
      smokeMat.dispose();
    },
    [emberGeo, smokeGeo, emberMat, smokeMat],
  );

  if (!flames.length) return null;
  return (
    <>
      <mesh key={`s${cap}`} geometry={smokeGeo} material={smokeMat} frustumCulled={false} renderOrder={2} />
      <mesh key={`e${cap}`} geometry={emberGeo} material={emberMat} frustumCulled={false} renderOrder={3} />
    </>
  );
}

/**
 * Una sola luz puntual, anclada a la antorcha más cercana a la cámara. La iluminación general
 * y su oclusión las da la luz VOXELIZADA horneada (no atraviesa muros). La luz mantiene el
 * charco cálido dinámico sin una sombra cúbica de seis pases, redundante con esa oclusión y muy
 * costosa en construcciones grandes. Cuenta CONSTANTE (= 1) → colocar antorchas no recompila.
 */
function NearestShadowLight({ sources }: { sources: LightSource[] }) {
  const ref = useRef<THREE.PointLight>(null);
  const srcRef = useRef(sources);
  srcRef.current = sources;
  const frame = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    if (frame.current++ % 12 !== 0) return;
    const L = ref.current;
    if (!L) return;
    const src = srcRef.current;
    let best: LightSource | null = null;
    let bestD = Infinity;
    for (const s of src) {
      const d = tmp.set(s.pos[0], s.pos[1], s.pos[2]).distanceToSquared(state.camera.position);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    if (best) {
      L.position.set(best.pos[0], best.pos[1] + 0.5, best.pos[2]);
      L.color.set(best.lightHex);
      L.intensity = 10;
    } else {
      L.intensity = 0;
    }
  });
  return (
    <pointLight
      ref={ref}
      intensity={0}
      distance={9}
      decay={2}
      color="#ffb060"
    />
  );
}

/**
 * Efectos de luz por bloque: LLAMA nativa animada en cada fuente con fuego + luz cálida en la
 * fuente más cercana. La oclusión realista la aporta la luz voxelizada horneada.
 */
export function BlockLights({ sources }: { sources: LightSource[] }) {
  return (
    <>
      <FlameField sources={sources} />
      <FireParticles sources={sources} />
      <NearestShadowLight sources={sources} />
    </>
  );
}
