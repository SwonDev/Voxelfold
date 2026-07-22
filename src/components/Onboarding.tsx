import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { HyIcon } from "@/components/HyIcon";
import { errorMessage } from "@/lib/errorMessage";

export function Onboarding({ onSkip }: { onSkip: () => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const refreshReady = () => {
    qc.invalidateQueries({ queryKey: ["hytale_ready"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
  };

  // Autodetección silenciosa al entrar (por si Hytale se instaló tras abrir la app).
  const autoTried = useRef(false);
  useEffect(() => {
    if (autoTried.current) return;
    autoTried.current = true;
    api.retryLocate().then((found) => found && refreshReady()).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = useMutation({
    mutationFn: async () => {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Selecciona la carpeta de Hytale (…/game/latest)",
      });
      if (!dir || typeof dir !== "string") throw new Error("Selección cancelada");
      return api.setInstallPath(dir);
    },
    onSuccess: () => {
      setMsg(null);
      refreshReady();
    },
    onError: (e) => setMsg(errorMessage(e, "No se pudo abrir la carpeta.")),
  });

  const retry = useMutation({
    mutationFn: api.retryLocate,
    onSuccess: (found) => {
      if (found) refreshReady();
      else setMsg("No se encontró Hytale automáticamente. Selecciona la carpeta manualmente.");
    },
    onError: (e) => setMsg(errorMessage(e)),
  });

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="hy-fade-in max-w-lg text-center">
        <img
          src="/brand/voxelfold-icon.png"
          alt=""
          className="mx-auto mb-3 h-16 w-16 rounded-2xl shadow-lg shadow-black/40"
          draggable={false}
        />
        <div className="mb-2 font-display text-4xl text-ink">Voxelfold</div>
        <p className="mb-8 text-muted">
          Para mostrar bloques, texturas y builds con las <strong>visuales reales</strong> de Hytale,
          Voxelfold necesita leer tu instalación local. No copiamos ni distribuimos nada del juego.
        </p>

        <div className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={() => pick.mutate()} disabled={pick.isPending}>
            <HyIcon name="search" size={18} />
            {pick.isPending ? "Abriendo…" : "Seleccionar carpeta de Hytale"}
          </Button>
          <Button variant="secondary" onClick={() => retry.mutate()} disabled={retry.isPending}>
            <HyIcon name="settings" size={16} />
            {retry.isPending ? "Buscando…" : "Detectar automáticamente"}
          </Button>
          <button
            onClick={onSkip}
            className="mt-2 rounded text-sm text-muted underline hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Continuar sin Hytale
          </button>
        </div>

        {msg && <p className="mt-6 text-sm text-danger" role="status">{msg}</p>}

        <details className="mt-10 text-xs text-muted">
          <summary className="cursor-pointer text-accent-hi hover:underline">
            ¿No la encuentras? Ver la ruta típica
          </summary>
          <code className="mt-2 inline-block break-all">
            ~/Library/Application Support/Hytale/install/release/package/game/latest
          </code>
        </details>
      </div>
    </div>
  );
}
