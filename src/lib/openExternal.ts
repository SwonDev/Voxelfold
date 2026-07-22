import { openUrl } from "@tauri-apps/plugin-opener";

/** Solo permite navegación web explícita; bloquea `file:`, `javascript:`, esquemas internos, etc. */
export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

/** Abre una URL validada en el navegador del sistema, ignorando errores de apertura. */
export const openExternal = (url: string): Promise<void> => {
  if (!isSafeExternalUrl(url)) return Promise.resolve();
  return openUrl(url).then(() => undefined, () => undefined);
};
