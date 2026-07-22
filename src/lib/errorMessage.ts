/**
 * Convierte un error (de Tauri/JS) en un mensaje legible para el usuario en español.
 * Limpia ruido técnico y, si el error es demasiado largo/críptico, usa un texto genérico.
 * El detalle completo se vuelca a la consola para depuración.
 */
export function errorMessage(e: unknown, fallback = "Algo salió mal. Inténtalo de nuevo."): string {
  if (e == null) return fallback;
  if (import.meta.env?.DEV) console.error("[voxelfold]", e);
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  const clean = raw
    .replace(/^Error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || clean.length > 180 || /^\[object/.test(clean)) return fallback;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
