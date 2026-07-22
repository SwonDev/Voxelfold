import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Cabecera de panel con el asset real de Hytale (ContainerHeader, runas en los extremos). */
export function PanelHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("hy-header", className)}>
      <span className="hy-header-title">{children}</span>
    </div>
  );
}

/** Separador de sección con la cenefa real de Hytale. */
export function HySeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("hy-separator", className)} />;
}

/** Tooltip con el fondo redondeado real de Hytale (TooltipDefaultBackground). */
export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** Clases extra para el envoltorio (p. ej. `w-full` cuando el hijo es full-width). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pos = {
    top: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-1.5 -translate-x-1/2",
    left: "right-full top-1/2 mr-1.5 -translate-y-1/2",
    right: "left-full top-1/2 ml-1.5 -translate-y-1/2",
  }[side];
  return (
    <span
      className={cn("relative inline-flex", className)}
      aria-describedby={open && label ? id : undefined}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && label && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "hy-tooltip pointer-events-none absolute z-50 whitespace-nowrap text-xs font-medium",
            pos,
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
