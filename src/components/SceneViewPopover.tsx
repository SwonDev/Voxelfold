import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { HyIcon } from "@/components/HyIcon";
import { cn } from "@/lib/utils";

export interface SceneViewPreset {
  id: string;
  label: string;
  onSelect: () => void;
}

/**
 * Agrupa controles secundarios de una escena 3D sin convertir el lienzo en una barra
 * de ajustes permanente. Es un popover no modal: admite clic exterior, Escape y devuelve
 * el foco al disparador al cerrarse con teclado.
 */
export function SceneViewPopover({
  presets,
  onReset,
  children,
  className,
}: {
  presets: SceneViewPreset[];
  onReset: () => void;
  children?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-h-10 items-center gap-2 rounded-md border border-line bg-surface-2/95 px-3 text-sm text-ink",
          "transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          open && "border-accent/50 bg-elevated",
        )}
      >
        <HyIcon name="settings" size={17} />
        Vista
        <HyIcon
          name="forward"
          size={11}
          className={cn("rotate-90 opacity-70 transition-transform", open && "-rotate-90")}
        />
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Opciones de visualización"
          className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100vh-8rem)] w-72 max-w-[calc(100vw-6rem)] overflow-y-auto rounded-[var(--radius)] border border-line bg-elevated p-3 shadow-md shadow-black/40"
        >
          <section aria-labelledby={`${panelId}-camera`}>
            <h3 id={`${panelId}-camera`} className="mb-2 text-xs font-semibold text-ink">
              Cámara
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    preset.onSelect();
                    setOpen(false);
                  }}
                  className="min-h-10 rounded-md border border-line bg-surface-2 px-2 text-xs text-muted transition-colors hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          {children && <div className="mt-3 border-t border-line pt-3">{children}</div>}

          <button
            type="button"
            onClick={() => {
              onReset();
              setOpen(false);
            }}
            className="mt-3 min-h-10 w-full rounded-md border border-line bg-surface-2 px-3 text-sm text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Reiniciar vista
          </button>
        </div>
      )}
    </div>
  );
}

/** Fila compacta y accesible para opciones binarias del popover de escena. */
export function SceneViewToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-md px-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-ink">
      <span className="min-w-0">
        <span className="block text-ink">{label}</span>
        {description && <span className="block text-[11px] leading-snug text-muted">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      />
    </label>
  );
}
