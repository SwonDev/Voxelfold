import { useFrame } from "@react-three/fiber";
import { windClock } from "@/lib/sceneAnimation";

/**
 * Avanza el reloj de animación de escena (viento + parpadeo de luces) cada frame.
 * Montar una vez dentro del <Canvas>. No renderiza nada.
 */
export function SceneClock() {
  useFrame((_, dt) => {
    // Acota el delta para que un frame perdido (pestaña en 2.º plano) no dé un salto brusco.
    windClock.value += Math.min(dt, 0.05);
  });
  return null;
}
