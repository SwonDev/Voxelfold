import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HyIcon, type HyIconName } from "@/components/HyIcon";

/**
 * Menú desplegable ligero (sin librerías) para agrupar acciones secundarias y
 * evitar filas de botones saturadas. Se cierra al hacer clic fuera o con Esc.
 */
export function Menu({
  label,
  icon,
  align = "end",
  children,
}: {
  label: string;
  icon?: HyIconName;
  align?: "start" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Foco al primer ítem del menú al abrir.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const trigger = ref.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]') ?? null;
    const items = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
      );
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Navegación de teclado del patrón «menu» de WAI-ARIA (flechas + Inicio/Fin).
      if (e.key === "Escape") {
        setOpen(false);
        trigger?.focus(); // devuelve el foco al disparador
        return;
      }
      const list = items();
      if (list.length === 0) return;
      const idx = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(idx + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(idx - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (e.key === "Tab") {
        setOpen(false); // Tab sale del menú y lo cierra (no deja foco huérfano dentro)
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {icon && <HyIcon name={icon} size={16} />}
        {label}
        <HyIcon name="forward" size={12} className={cn("rotate-90 opacity-70 transition-transform", open && "-rotate-90")} />
      </Button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className={cn(
            "absolute top-full z-50 mt-1.5 min-w-[190px] rounded-[var(--radius)] border border-line bg-elevated p-1 shadow-xl shadow-black/40",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon,
  onClick,
  danger,
  disabled,
  children,
}: {
  icon?: HyIconName;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[8px] px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60",
        danger ? "text-danger-text hover:bg-danger/15" : "text-ink hover:bg-surface-2",
      )}
    >
      {icon && <HyIcon name={icon} size={16} />}
      {children}
    </button>
  );
}
