import { cn } from "@/lib/utils";

/** Bloque de carga con shimmer (respeta prefers-reduced-motion vía index.css). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("hy-skeleton rounded-md", className)} />;
}

/** Esqueleto de una tarjeta de build (misma silueta que BuildCard). */
export function BuildCardSkeleton() {
  return (
    <div className="hy-panel overflow-hidden">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-1.5 pt-1">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-12" />
        </div>
      </div>
    </div>
  );
}

/** Rejilla de esqueletos de tarjetas (para estados de carga de listas de builds). */
export function BuildGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <BuildCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Rejilla de esqueletos de celdas de bloque (catálogo). */
export function BlockGridSkeleton({ count = 48, slot = 92 }: { count?: number; slot?: number }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slot}px, 1fr))` }}
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 p-2">
          <Skeleton className="h-14 w-14" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
