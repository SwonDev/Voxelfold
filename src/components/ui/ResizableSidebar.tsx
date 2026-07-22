import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { HyIcon } from "@/components/HyIcon";

/**
 * Layout con panel lateral REDIMENSIONABLE (divisor arrastrable). El contenido principal
 * ocupa el resto (flex-1). La anchura del panel se persiste y se acota a [min, max].
 * Responsive: en ventanas estrechas el `max` efectivo se reduce para no comerse el lienzo.
 * Opcional `collapsible`: un botón en el borde COLAPSA el panel a un rail estrecho (gana
 * lienzo) y lo reabre con un clic; el estado se persiste en `collapseStorageKey`.
 */
export function ResizableSidebar({
  main,
  side,
  sideWidth = 320,
  min = 260,
  max = 560,
  storageKey,
  className,
  collapsible = false,
  collapseStorageKey,
  collapseLabel = "panel",
}: {
  main: ReactNode;
  side: ReactNode;
  sideWidth?: number;
  min?: number;
  max?: number;
  storageKey?: string;
  className?: string;
  collapsible?: boolean;
  collapseStorageKey?: string;
  collapseLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= min && saved <= max) return saved;
    }
    return sideWidth;
  });
  const [collapsed, setCollapsed] = useState(
    () => !!collapseStorageKey && localStorage.getItem(collapseStorageKey) === "true",
  );
  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      if (collapseStorageKey) {
        try {
          localStorage.setItem(collapseStorageKey, String(next));
        } catch {
          /* cuota llena: ignorar */
        }
      }
      return next;
    });
  }, [collapseStorageKey]);
  const dragging = useRef(false);

  // Acota la anchura para que el lienzo conserve al menos ~320px (responsive).
  const clampWidth = useCallback(
    (w: number) => {
      const cw = containerRef.current?.clientWidth ?? window.innerWidth;
      const effMax = Math.min(max, Math.max(min, cw - 320));
      return Math.max(min, Math.min(effMax, w));
    },
    [min, max],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setWidth(clampWidth(rect.right - e.clientX));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (storageKey) localStorage.setItem(storageKey, String(width));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [clampWidth, storageKey, width]);

  // Reacota al cambiar el tamaño de la ventana (responsive).
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clampWidth]);

  const startDrag = () => {
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  // Redimensionado por TECLADO (el divisor es focusable): flechas ±24px, Inicio/Fin al límite.
  const onKey = (e: React.KeyboardEvent) => {
    let next: number | null = null;
    if (e.key === "ArrowLeft") next = width - 24; // ←: panel más ancho (crece hacia la izquierda)
    else if (e.key === "ArrowRight") next = width + 24;
    else if (e.key === "Home") next = max;
    else if (e.key === "End") next = min;
    else return;
    e.preventDefault();
    const w = clampWidth(next);
    setWidth(w);
    if (storageKey) localStorage.setItem(storageKey, String(w));
  };

  return (
    <div ref={containerRef} className={cn("relative flex min-h-0", className)}>
      <div className="min-w-0 flex-1">{main}</div>

      {!collapsed && (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar panel"
            aria-valuenow={Math.round(width)}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onPointerDown={startDrag}
            onDoubleClick={() => setWidth(sideWidth)}
            onKeyDown={onKey}
            title="Arrastra para redimensionar · doble clic para restablecer · flechas con el foco puesto"
            className="group relative w-1.5 shrink-0 cursor-col-resize bg-line/60 transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            {/* Zona de agarre más ancha que la línea visible. */}
            <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
          </div>
          <div style={{ width }} className="min-h-0 shrink-0">
            {side}
          </div>
        </>
      )}

      {/* Rail estrecho cuando está colapsado: conserva el borde y deja sitio al botón de reabrir. */}
      {collapsed && <div className="w-10 shrink-0 border-l border-line/60 bg-surface/30" />}

      {/* Botón flotante de colapsar/expandir, anclado sobre el borde del panel. */}
      {collapsible && (
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? `Mostrar el ${collapseLabel}` : `Ocultar el ${collapseLabel}`}
          aria-expanded={!collapsed}
          title={collapsed ? `Mostrar el ${collapseLabel}` : `Ocultar el ${collapseLabel}`}
          style={{ right: collapsed ? 40 : width }}
          className="absolute top-3 z-20 flex h-7 w-7 translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated text-muted shadow-md shadow-black/40 transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <HyIcon name={collapsed ? "back" : "forward"} size={14} />
        </button>
      )}
    </div>
  );
}
