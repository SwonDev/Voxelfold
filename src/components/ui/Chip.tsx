import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Chip de filtro/selección unificado (antes duplicado en Library, BlockBrowser y Editor).
 * `active` se refleja en color y en `aria-pressed` para lectores de pantalla.
 */
export function Chip({
  active,
  onClick,
  children,
  className,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
        active
          ? "border-accent/50 bg-accent/20 text-accent-hi"
          : "border-line text-muted hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
