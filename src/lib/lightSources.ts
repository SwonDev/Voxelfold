import * as THREE from "three";
import type { BlockInfo } from "@/lib/api";
import { isLightName, isMarkerName, parseBlockName } from "@/lib/resolveBlock";

export interface LightVoxel {
  x: number;
  y: number;
  z: number;
  name: string;
}

export interface LightSource {
  pos: [number, number, number];
  /** Color nativo de la llama (rgb 0..1), o null si no hay llama visible. */
  flame: [number, number, number] | null;
  scale: number;
  offsetY: number;
  /** Color de la luz puntual (hex). */
  lightHex: string;
}

function isFlameName(name: string): boolean {
  const n = name.startsWith("*") ? name.slice(1) : name;
  return /(^|_)(torch|candle|campfire|brazier|lantern|fire)(_|$)/i.test(n);
}

function hexToRgb(hex: string): [number, number, number] {
  const color = new THREE.Color(hex);
  return [color.r, color.g, color.b];
}

/**
 * Extrae todas las fuentes de luz y llama nativas. Se mantiene fuera del módulo React
 * para que Fast Refresh no remonte la escena completa al editar sus componentes visuales.
 */
export function lightSources(
  voxels: LightVoxel[],
  catalog: Map<string, BlockInfo>,
): LightSource[] {
  const out: LightSource[] = [];
  const templates = new Map<string, Omit<LightSource, "pos"> | null>();
  for (const voxel of voxels) {
    if (isMarkerName(voxel.name)) continue;
    let template = templates.get(voxel.name);
    if (template === undefined) {
      const block = catalog.get(voxel.name) ?? catalog.get(parseBlockName(voxel.name).base);
      const hasFlame = !!block?.flame_color || isFlameName(voxel.name);
      const emitsLight = (block?.light ?? false) || isLightName(voxel.name) || hasFlame;
      template = emitsLight
        ? {
            flame: hasFlame ? hexToRgb(block?.flame_color ?? "#ff8a2a") : null,
            scale: block?.flame_scale ?? 0.7,
            offsetY: block?.flame_offset_y ?? 0,
            lightHex: block?.light_color ?? "#ffb060",
          }
        : null;
      templates.set(voxel.name, template);
    }
    if (template) out.push({ ...template, pos: [voxel.x, voxel.y, voxel.z] });
  }
  return out;
}
