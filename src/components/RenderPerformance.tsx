import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * Actualiza los mapas de sombra cuando cambia la escena y unas pocas veces durante la carga
 * asíncrona de modelos. Las sombras no dependen de la cámara y recalcularlas a 30 Hz repetía
 * cientos de draw calls sin cambiar el resultado visual.
 */
export function ShadowScheduler({ revision }: { revision: unknown }) {
  const gl = useThree((state) => state.gl);
  const elapsed = useRef(0);
  const warmupUpdates = useRef(0);
  useEffect(() => {
    const previous = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = previous;
      gl.shadowMap.needsUpdate = true;
    };
  }, [gl]);

  useEffect(() => {
    // Actualización inmediata y cuatro repasos espaciados: cubren modelos/texturas oficiales
    // que terminan de hidratarse después del primer commit sin dejar un coste permanente.
    gl.shadowMap.needsUpdate = true;
    elapsed.current = 0;
    warmupUpdates.current = 4;
  }, [gl, revision]);

  useFrame((_, delta) => {
    if (warmupUpdates.current <= 0) return;
    elapsed.current += Math.min(delta, 0.05);
    if (elapsed.current >= 0.75) {
      elapsed.current %= 0.75;
      gl.shadowMap.needsUpdate = true;
      warmupUpdates.current--;
    }
  });
  return null;
}

export function RenderStats({
  visible,
  bakeMs,
  targetRef,
}: {
  visible: boolean;
  bakeMs?: number;
  targetRef: RefObject<HTMLDivElement | null>;
}) {
  const gl = useThree((state) => state.gl);
  const sample = useRef({ elapsed: 0, frames: 0, calls: 0, triangles: 0 });
  useEffect(() => {
    if (!visible) return;
    const previous = gl.info.autoReset;
    // EffectComposer ejecuta varios pases y reinicia las métricas entre ellos. Al
    // controlarlo aquí contamos el fotograma completo, no solo el último pase.
    gl.info.autoReset = false;
    gl.info.reset();
    return () => {
      gl.info.reset();
      gl.info.autoReset = previous;
      sample.current = { elapsed: 0, frames: 0, calls: 0, triangles: 0 };
    };
  }, [gl, visible]);
  useFrame(({ gl }, delta) => {
    if (!visible) return;
    const calls = gl.info.render.calls;
    const triangles = gl.info.render.triangles;
    gl.info.reset();
    sample.current.elapsed += Math.min(delta, 0.1);
    sample.current.frames++;
    sample.current.calls = calls;
    sample.current.triangles = triangles;
    if (sample.current.elapsed < 0.5) return;
    const target = targetRef.current;
    if (target) {
      const fps = Math.round(sample.current.frames / sample.current.elapsed);
      const trianglesLabel = sample.current.triangles.toLocaleString("es");
      const bakeLabel = bakeMs === undefined ? "" : ` · horneado ${Math.round(bakeMs)} ms fuera del hilo`;
      target.textContent = `${fps} FPS · ${sample.current.calls} draws · ${trianglesLabel} tri · DPR ${gl.getPixelRatio().toFixed(2)}${bakeLabel}`;
    }
    sample.current = { elapsed: 0, frames: 0, calls: 0, triangles: 0 };
  });
  return null;
}
