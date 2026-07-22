import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import { errorMessage } from "./errorMessage.ts";

export const APP_UPDATE_CHECK_EVENT = "voxelfold:check-app-update";
export const APP_UPDATE_LAST_CHECK_KEY = "voxelfold.app-update.last-check.v1";
export const APP_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateProgress {
  downloaded: number;
  total?: number;
  finished: boolean;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function requestAppUpdateCheck(): void {
  window.dispatchEvent(new CustomEvent(APP_UPDATE_CHECK_EVENT));
}

export function shouldCheckForAppUpdate(
  lastCheck: string | null,
  now = Date.now(),
  interval = APP_UPDATE_CHECK_INTERVAL_MS,
): boolean {
  if (!lastCheck) return true;
  const parsed = Number(lastCheck);
  return !Number.isFinite(parsed) || parsed <= 0 || now - parsed >= interval;
}

export function readLastAppUpdateCheck(): string | null {
  try {
    return localStorage.getItem(APP_UPDATE_LAST_CHECK_KEY);
  } catch {
    return null;
  }
}

export function rememberAppUpdateCheck(now = Date.now()): void {
  try {
    localStorage.setItem(APP_UPDATE_LAST_CHECK_KEY, String(now));
  } catch {
    // El actualizador sigue siendo funcional aunque el almacenamiento esté deshabilitado.
  }
}

export function applyDownloadEvent(
  progress: UpdateProgress,
  event: DownloadEvent,
): UpdateProgress {
  switch (event.event) {
    case "Started":
      return { downloaded: 0, total: event.data.contentLength, finished: false };
    case "Progress":
      return {
        ...progress,
        downloaded: progress.downloaded + event.data.chunkLength,
      };
    case "Finished":
      return {
        ...progress,
        downloaded: progress.total ?? progress.downloaded,
        finished: true,
      };
  }
}

export function downloadPercent(progress: UpdateProgress): number | null {
  if (!progress.total || progress.total <= 0) return progress.finished ? 100 : null;
  return Math.min(100, Math.max(0, Math.round((progress.downloaded / progress.total) * 100)));
}

export function appUpdateErrorMessage(error: unknown): string {
  const detail = errorMessage(error, "No se pudo completar la actualización.");
  if (/valid release json|failed to fetch|network|dns|timed? ?out|connection/i.test(detail)) {
    return "No se pudo contactar con el canal de actualizaciones. Comprueba tu conexión e inténtalo de nuevo.";
  }
  if (/signature|public key|minisign/i.test(detail)) {
    return "La actualización fue rechazada porque su firma no es válida. No se ha instalado nada.";
  }
  if (/permission|access denied|operation not permitted/i.test(detail)) {
    return "macOS no permitió instalar la actualización. Comprueba que Voxelfold esté en Aplicaciones.";
  }
  return detail;
}

export async function getCurrentAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return __APP_VERSION__;
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export async function findAppUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: 20_000 });
}

export async function installAppUpdate(
  update: Update,
  onProgress: (event: DownloadEvent) => void,
): Promise<void> {
  await update.downloadAndInstall(onProgress, { timeout: 120_000 });
}

export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
