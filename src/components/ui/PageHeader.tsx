import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabecera de página consistente en todas las secciones: título + subtítulo
 * opcional + acciones a la derecha. Mantiene la misma jerarquía y espaciado en
 * Biblioteca, Bloques, Comunidad, Importar, etc. para que nada se vea desalineado.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <header className={cn("mb-6 flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}
