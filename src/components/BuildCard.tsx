import { Link } from "react-router-dom";
import type { BuildSummary } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { HyIcon } from "@/components/HyIcon";
import { SlotIcon } from "@/components/BlockIcon";
import { Tooltip } from "@/components/HyPanel";
import type { useCatalogMap } from "@/lib/useCatalog";

/** Tarjeta de build compartida por Biblioteca y Favoritos (miniatura, estado, chips). */
export function BuildCard({
  build,
  catalog,
}: {
  build: BuildSummary;
  catalog: ReturnType<typeof useCatalogMap>;
}) {
  const hasThumb = Boolean(build.thumbnail_ref && build.thumbnail_ref.startsWith("data:"));
  return (
    <Link
      to={`/build/${build.id}`}
      className="block h-full rounded-[var(--radius)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {/* Altura uniforme: todas las cards rellenan su celda (h-full) y reparten el
          contenido en columna; la descripción reserva su espacio y los chips se anclan
          abajo → la rejilla queda coherente aunque varíe el contenido. */}
      <Card className="flex h-full flex-col overflow-hidden transition duration-150 hover:-translate-y-0.5 hover:border-line hover:shadow-lg hover:shadow-black/30">
        {hasThumb ? (
          <img
            src={build.thumbnail_ref!}
            alt=""
            className="aspect-video w-full shrink-0 bg-bg/50 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex aspect-video shrink-0 items-center justify-center gap-2.5 bg-gradient-to-b from-surface-2/50 to-bg/60 p-3">
            {build.top_blocks.length > 0 ? (
              build.top_blocks.slice(0, 4).map((name) => {
                const b = catalog.get(name);
                return (
                  <Tooltip key={name} label={b?.display_name ?? name}>
                    {/* Slot de inventario nativo de Hytale → fila de bloques principales pulcra. */}
                    <span className="hy-slot grid place-items-center rounded-[10px] p-1.5">
                      <SlotIcon
                        block={b ?? { icon: null, name, display_name: null, fallback_color: null }}
                        size={40}
                      />
                    </span>
                  </Tooltip>
                );
              })
            ) : (
              <HyIcon name="build" size={40} className="opacity-50" />
            )}
          </div>
        )}
        <CardContent className="flex flex-1 flex-col">
          <div className="mb-1 flex items-center justify-between gap-2">
            <h3 className="truncate text-lg text-ink">{build.name}</h3>
            {build.is_favorite && (
              <span
                className="shrink-0 text-accent-hi"
                aria-label="Guardada en favoritos"
                title="Guardada en favoritos"
              >
                <HyIcon name="favorites" size={16} />
              </span>
            )}
          </div>
          {/* Espacio reservado para 2 líneas aunque no haya descripción → misma altura. */}
          <p className="mb-3 line-clamp-2 min-h-[2.5rem] text-sm text-muted">
            {build.description ?? ""}
          </p>
          <div className="mt-auto flex flex-wrap gap-1.5">
            <StatusBadge status={build.status} />
            {build.category && <Badge>{build.category}</Badge>}
            {build.difficulty && <Badge variant="gold">{build.difficulty}</Badge>}
            {build.block_count > 0 && <Badge variant="accent">{build.block_count} bloques</Badge>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
