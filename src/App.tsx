import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { api, HYTALE_REFRESH_EVENT, setAssetGeneration } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { AppUpdater } from "@/components/AppUpdater";
import { Toaster } from "@/components/ui/Toaster";
import { toast } from "@/lib/toast";
import { installHyChrome } from "@/lib/hyChrome";
import { errorMessage } from "@/lib/errorMessage";
import { getEditorSessionSnapshot, subscribeEditorSession } from "@/lib/editorSession";

const Library = lazy(() => import("@/routes/Library").then((module) => ({ default: module.Library })));
const Blocks = lazy(() => import("@/routes/Blocks").then((module) => ({ default: module.Blocks })));
const Favorites = lazy(() => import("@/routes/Favorites").then((module) => ({ default: module.Favorites })));
const BuildDetail = lazy(() => import("@/routes/BuildDetail").then((module) => ({ default: module.BuildDetail })));
const Guide = lazy(() => import("@/routes/Guide").then((module) => ({ default: module.Guide })));
const Editor = lazy(() => import("@/routes/Editor").then((module) => ({ default: module.Editor })));
const Community = lazy(() => import("@/routes/Community").then((module) => ({ default: module.Community })));
const Settings = lazy(() => import("@/routes/Settings").then((module) => ({ default: module.Settings })));
const Import = lazy(() => import("@/routes/Import").then((module) => ({ default: module.Import })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

/** Al recuperar el foco, comprueba si Hytale se actualizó y refresca el catálogo. */
function HytaleAutoRefresh({ onGeneration }: { onGeneration: (generation: number) => void }) {
  const qc = useQueryClient();
  const pendingResult = useRef<Awaited<ReturnType<typeof api.refreshHytale>> | null>(null);
  const deferredCheck = useRef(false);
  const deferredNoticeShown = useRef(false);

  const publish = useCallback(async (result: Awaited<ReturnType<typeof api.refreshHytale>>) => {
    setAssetGeneration(result.generation);
    onGeneration(result.generation);
    if (!result.changed) return;

    await Promise.all([
      qc.invalidateQueries({ queryKey: ["catalog"] }),
      qc.invalidateQueries({ queryKey: ["hytale_ready"] }),
      qc.invalidateQueries({ queryKey: ["asset_compatibility"] }),
      qc.invalidateQueries({ queryKey: ["install_status"] }),
    ]);
    const failures = (result.catalog?.parse_failures ?? 0) + (result.catalog?.read_failures ?? 0);
    const reason = result.reason === "relocated"
      ? "Se detectó una versión o canal nuevo de Hytale"
      : result.reason === "connected"
        ? "Se detectó la instalación de Hytale"
        : "Hytale se actualizó";
    toast(
      failures > 0
        ? `${reason}: assets integrados con ${failures} avisos de compatibilidad`
        : `${reason}: catálogo, modelos y texturas sincronizados`,
      failures > 0 ? "info" : "success",
    );
  }, [onGeneration, qc]);

  useEffect(() => {
    let inFlight = false;
    let cancelled = false;
    let lastError = "";

    const check = async () => {
      if (inFlight) {
        deferredCheck.current = true;
        return;
      }
      if (getEditorSessionSnapshot().dirty) {
        deferredCheck.current = true;
        return;
      }

      inFlight = true;
      deferredCheck.current = false;
      try {
        const waiting = pendingResult.current;
        if (waiting) {
          pendingResult.current = null;
          deferredNoticeShown.current = false;
          await publish(waiting);
          return;
        }

        const result = await api.refreshHytale();
        lastError = "";
        if (getEditorSessionSnapshot().dirty) {
          pendingResult.current = result;
          if (result.changed && !deferredNoticeShown.current) {
            deferredNoticeShown.current = true;
            toast("Hytale se actualizó; la nueva revisión se aplicará al guardar o salir del editor.", "info");
          }
          return;
        }
        await publish(result);
      } catch (error) {
        // Puede coincidir con la sustitución atómica del zip. Se conserva la revisión anterior
        // y el siguiente sondeo reintenta sin romper el editor abierto.
        const detail = errorMessage(error);
        if (detail !== lastError) {
          lastError = detail;
          toast(`No se pudo integrar la nueva revisión de Hytale; se mantiene la anterior. ${detail}`, "error");
        }
      } finally {
        inFlight = false;
        if (!cancelled && deferredCheck.current && !getEditorSessionSnapshot().dirty) {
          window.queueMicrotask(() => void check());
        }
      }
    };
    const unsubscribeEditor = subscribeEditorSession(() => {
      if (!getEditorSessionSnapshot().dirty && (deferredCheck.current || pendingResult.current)) {
        void check();
      }
    });
    window.addEventListener("focus", check);
    window.addEventListener(HYTALE_REFRESH_EVENT, check);
    void check();
    // Además, sondeo periódico por si el juego se actualiza con la app abierta y en foco.
    const iv = window.setInterval(check, 5 * 60_000);
    return () => {
      cancelled = true;
      unsubscribeEditor();
      window.removeEventListener("focus", check);
      window.removeEventListener(HYTALE_REFRESH_EVENT, check);
      window.clearInterval(iv);
    };
  }, [publish]);
  return null;
}

function RouteBoundary({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted" role="status">
          Cargando vista…
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

// Data router: necesario para bloquear de forma fiable atrás/adelante y enlaces cuando el
// editor contiene cambios sin guardar. Se mantiene hash routing para el bundle de escritorio.
const router = createHashRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <RouteBoundary><Library /></RouteBoundary> },
      { path: "/blocks", element: <RouteBoundary><Blocks /></RouteBoundary> },
      { path: "/community", element: <RouteBoundary><Community /></RouteBoundary> },
      { path: "/favorites", element: <RouteBoundary><Favorites /></RouteBoundary> },
      { path: "/build/:id", element: <RouteBoundary><BuildDetail /></RouteBoundary> },
      { path: "/build/:id/guide", element: <RouteBoundary><Guide /></RouteBoundary> },
      { path: "/build/:id/editor", element: <RouteBoundary><Editor /></RouteBoundary> },
      { path: "/settings", element: <RouteBoundary><Settings /></RouteBoundary> },
      { path: "/import", element: <RouteBoundary><Import /></RouteBoundary> },
    ],
  },
]);

export default function App() {
  const [assetGeneration, setAssetGenerationState] = useState(0);
  const applyGeneration = useCallback((generation: number) => {
    setAssetGenerationState((current) => current === generation ? current : generation);
  }, []);

  useEffect(() => {
    // Las variables CSS también contienen URL: hay que reescribirlas con `vf_rev` nuevo.
    installHyChrome(true);
  }, [assetGeneration]);

  return (
    <QueryClientProvider client={queryClient}>
      <HytaleAutoRefresh onGeneration={applyGeneration} />
      <Toaster />
      <AppUpdater />
      <RouterProvider router={router} key={assetGeneration} />
    </QueryClientProvider>
  );
}
