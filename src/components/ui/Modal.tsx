import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { HyIcon } from "@/components/HyIcon";

/**
 * Modal accesible unificado: overlay + panel nativo Hytale (.hy-panel) con cierre por
 * clic-fuera/Escape, trampa de foco y foco inicial. Reemplaza los overlays a mano.
 */
export function Modal({
  onClose,
  label,
  children,
  className,
  role = "dialog",
  maxW = "max-w-lg",
  dismissible = true,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  role?: "dialog" | "alertdialog";
  maxW?: string;
  /** Impide Escape, clic fuera y cierre durante una operación no cancelable. */
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, dismissible ? onClose : undefined);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={cn("hy-panel relative w-full focus:outline-none", maxW, className)}
        onClick={(e) => e.stopPropagation()}
      >
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute right-2.5 top-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2/70 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <HyIcon name="close" size={16} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
