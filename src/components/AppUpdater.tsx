import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  APP_UPDATE_CHECK_EVENT,
  appUpdateErrorMessage,
  applyDownloadEvent,
  downloadPercent,
  findAppUpdate,
  getCurrentAppVersion,
  installAppUpdate,
  isTauriRuntime,
  readLastAppUpdateCheck,
  relaunchApp,
  rememberAppUpdateCheck,
  shouldCheckForAppUpdate,
  type UpdateProgress,
} from "@/lib/appUpdater";
import { toast } from "@/lib/toast";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { HyIcon } from "@/components/HyIcon";
import { getEditorSessionSnapshot, subscribeEditorSession } from "@/lib/editorSession";

type UpdatePhase = "available" | "downloading" | "installing" | "error";

const INITIAL_PROGRESS: UpdateProgress = { downloaded: 0, finished: false };

/**
 * Gestor único de actualizaciones. El sondeo automático es silencioso si no hay versión
 * nueva o no existe red; una instalación siempre requiere una acción explícita del usuario.
 */
export function AppUpdater() {
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>("available");
  const [currentVersion, setCurrentVersion] = useState(__APP_VERSION__);
  const [progress, setProgress] = useState<UpdateProgress>(INITIAL_PROGRESS);
  const [failure, setFailure] = useState("");
  const editorSession = useSyncExternalStore(
    subscribeEditorSession,
    getEditorSessionSnapshot,
    getEditorSessionSnapshot,
  );
  const hasUnsavedChanges = editorSession.active && editorSession.dirty;

  const checkNow = useCallback(async (interactive: boolean) => {
    if (checkingRef.current) return;
    if (!isTauriRuntime()) {
      if (interactive) toast("La búsqueda de actualizaciones está disponible en la aplicación instalada.", "info");
      return;
    }
    if (updateRef.current) {
      setOpen(true);
      return;
    }

    checkingRef.current = true;
    if (interactive) toast("Buscando actualizaciones…", "info");
    try {
      const [version, update] = await Promise.all([getCurrentAppVersion(), findAppUpdate()]);
      if (!mountedRef.current) {
        await update?.close();
        return;
      }
      setCurrentVersion(version);
      rememberAppUpdateCheck();
      if (!update) {
        if (interactive) toast(`Voxelfold ${version} está al día.`, "success");
        return;
      }
      updateRef.current = update;
      setFailure("");
      setProgress(INITIAL_PROGRESS);
      setPhase("available");
      setOpen(true);
    } catch (error) {
      if (interactive) {
        toast(appUpdateErrorMessage(error), "error");
      }
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const onManualCheck = () => void checkNow(true);
    window.addEventListener(APP_UPDATE_CHECK_EVENT, onManualCheck);

    const timer = window.setTimeout(() => {
      const lastCheck = readLastAppUpdateCheck();
      if (shouldCheckForAppUpdate(lastCheck)) void checkNow(false);
    }, 4_000);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(timer);
      window.removeEventListener(APP_UPDATE_CHECK_EVENT, onManualCheck);
      void updateRef.current?.close();
      updateRef.current = null;
    };
  }, [checkNow]);

  const install = async () => {
    const update = updateRef.current;
    if (!update || hasUnsavedChanges) return;
    setFailure("");
    setProgress(INITIAL_PROGRESS);
    setPhase("downloading");
    try {
      let nextProgress = INITIAL_PROGRESS;
      await installAppUpdate(update, (event) => {
        nextProgress = applyDownloadEvent(nextProgress, event);
        setProgress(nextProgress);
      });
      setPhase("installing");
      await relaunchApp();
    } catch (error) {
      setFailure(appUpdateErrorMessage(error));
      setPhase("error");
    }
  };

  const update = updateRef.current;
  if (!open || !update) return null;

  const busy = phase === "downloading" || phase === "installing";
  const percent = downloadPercent(progress);
  return (
    <Modal
      onClose={() => setOpen(false)}
      label="Actualización de Voxelfold"
      maxW="max-w-xl"
      dismissible={!busy}
    >
      <div className="p-1 sm:p-2">
        <div className="mb-5 flex items-start gap-4 pr-8">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius)] border border-line bg-surface-2 text-accent-hi">
            <HyIcon name="settings" size={24} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-accent-hi">Actualización verificada</p>
            <h2 className="mt-1 text-2xl text-ink">Voxelfold {update.version}</h2>
            <p className="mt-1 text-sm text-muted">Instalada: {currentVersion}</p>
          </div>
        </div>

        {update.body && (
          <div className="mb-5 max-h-44 overflow-y-auto rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
            <p className="break-words whitespace-pre-wrap text-sm leading-relaxed text-muted">{update.body.slice(0, 4_000)}</p>
          </div>
        )}

        {hasUnsavedChanges && !busy && (
          <p className="mb-4 rounded-[var(--radius)] border border-gold/50 bg-gold/10 px-4 py-3 text-sm text-gold" role="status">
            Guarda o descarta los cambios del editor antes de actualizar; así no perderás tu trabajo.
          </p>
        )}

        {busy && (
          <div className="mb-5" aria-live="polite">
            <div className="mb-2 flex justify-between text-sm text-muted">
              <span>{phase === "installing" ? "Instalando y preparando el reinicio…" : "Descargando paquete firmado…"}</span>
              {percent !== null && <span>{percent}%</span>}
            </div>
            <div
              className="h-2 overflow-hidden rounded-full border border-line bg-bg"
              role="progressbar"
              aria-label="Progreso de la actualización"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
            >
              <div
                className={percent === null ? "h-full w-1/3 animate-pulse rounded-full bg-accent-hi" : "h-full rounded-full bg-accent-hi transition-[width] duration-150"}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {phase === "error" && (
          <p className="mb-4 rounded-[var(--radius)] border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
            {failure}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {!busy && (
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Más tarde
            </Button>
          )}
          <Button onClick={() => void install()} disabled={busy || hasUnsavedChanges}>
            <HyIcon name="settings" size={17} />
            {phase === "error" ? "Reintentar" : busy ? "Actualizando…" : "Actualizar y reiniciar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
