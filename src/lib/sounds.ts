import { assetUrl, getAssetGeneration } from "@/lib/api";

/**
 * Sonidos REALES de Hytale (servidos en local por voxelfold-asset://) para el editor.
 * Build_1 = colocar, Destruct_1 = borrar — los de la herramienta de construcción.
 */
const SOUNDS = {
  place: "Common/Sounds/Blocks/Building/Build_1.ogg",
  remove: "Common/Sounds/Blocks/Building/Destruct_1.ogg",
} as const;

type SoundName = keyof typeof SOUNDS;

const cache = new Map<SoundName, HTMLAudioElement>();
let cacheGeneration = -1;
let enabled = true;

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

/** Reproduce un sonido del editor (clona el nodo para permitir solapamiento rápido). */
export function playSound(name: SoundName, volume = 0.5) {
  if (!enabled) return;
  try {
    const generation = getAssetGeneration();
    if (cacheGeneration !== generation) {
      cache.clear();
      cacheGeneration = generation;
    }
    let base = cache.get(name);
    if (!base) {
      base = new Audio(assetUrl(SOUNDS[name]));
      base.preload = "auto";
      cache.set(name, base);
    }
    const node = base.cloneNode(true) as HTMLAudioElement;
    node.volume = volume;
    void node.play().catch(() => {});
  } catch {
    /* si Hytale no está disponible o el audio falla, ignorar */
  }
}
