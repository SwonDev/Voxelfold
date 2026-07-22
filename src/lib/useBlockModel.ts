import { useEffect, useState } from "react";
import { loadBlockModel, type LoadedModel } from "@/lib/blockModel";

/**
 * Carga (con caché) un modelo 3D `.blockymodel` por su ruta. Devuelve null mientras
 * carga, si no hay modelo o si falla. `enabled=false` lo desactiva (cae a cubo).
 */
export function useBlockModel(
  modelPath: string | null,
  texturePath: string | null,
  enabled = true,
): LoadedModel | null {
  const path = enabled ? modelPath : null;
  const key = path ? `${path}|${texturePath ?? ""}` : null;
  const [loaded, setLoaded] = useState<{ key: string; model: LoadedModel | null } | null>(null);
  useEffect(() => {
    if (!path || !key) return;
    let active = true;
    loadBlockModel(path, texturePath).then((m) => {
      if (active) setLoaded({ key, model: m });
    });
    return () => {
      active = false;
    };
  }, [path, texturePath, key]);
  // Al cambiar de bloque no mostramos el modelo anterior mientras carga el nuevo.
  return key && loaded?.key === key ? loaded.model : null;
}
