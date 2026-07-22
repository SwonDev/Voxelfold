import { useEffect, useState } from "react";
import { subscribeToasts, dismiss, type Toast } from "@/lib/toast";
import { HyIcon } from "@/components/HyIcon";
import { cn } from "@/lib/utils";

/** Contenedor de toasts (montar una vez en la raíz). Escucha el store de `lib/toast`. */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  if (items.length === 0) return null;
  return (
    <div
      aria-label="Notificaciones"
      className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2"
    >
      {items.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          // Los errores se anuncian como «alert» (asertivo) y el resto como «status» (educado).
          role={t.kind === "error" ? "alert" : "status"}
          aria-label={`Descartar notificación: ${t.message}`}
          className={cn(
            // Piel NATIVA de Hytale: el cartel redondeado real (.hy-tooltip, nine-patch). El
            // fondo redondeado de respaldo mantiene la forma cuando el asset no está (dev/web).
            "hy-tooltip hy-fade-in pointer-events-auto flex items-center gap-2 rounded-[12px] bg-surface-2/95 text-sm font-medium shadow-xl shadow-black/40",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
            t.kind === "error"
              ? "text-danger-text"
              : t.kind === "success"
                ? "text-accent-hi"
                : "text-ink",
          )}
        >
          {t.kind === "success" && <HyIcon name="check" size={16} aria-hidden />}
          {t.message}
        </button>
      ))}
    </div>
  );
}
