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
    <header className={cn("mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row", className)}>
      <div className="min-w-0">
        <h1 className="text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>}
    </header>
  );
}
