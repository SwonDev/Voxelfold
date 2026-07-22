import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type BlockInfo } from "@/lib/api";
import { SlotIcon } from "@/components/BlockIcon";
import { BlockBrowser } from "@/components/BlockBrowser";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { BlockGridSkeleton } from "@/components/ui/Skeleton";
import { VoxelViewerLazy } from "@/components/VoxelViewerLazy";
import { blockCats, subLabel, topLabel } from "@/lib/blockCategories";
import { blockGuide } from "@/lib/blockGuide";
import { errorMessage } from "@/lib/errorMessage";

/** Trae (bajo demanda, con caché en backend) la ficha real de la wiki pública. */
function WikiPanel({ block }: { block: BlockInfo }) {
  const name = block.display_name ?? block.name;
  const { data, isLoading } = useQuery({
    queryKey: ["blockwiki", name],
    queryFn: () => api.blockWiki(name),
    enabled: Boolean(name),
    staleTime: Infinity,
    retry: false,
  });
  if (isLoading)
    return <p className="text-xs text-muted">Buscando en la wiki…</p>;
  if (!data)
    return (
      <p className="text-xs text-muted">No hay ficha en la wiki para este bloque todavía.</p>
    );
  return (
    <div className="rounded-md border border-line bg-surface-2/40 p-2.5">
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-accent-hi">Ficha de la wiki</p>
      <p className="text-sm text-ink">{data.description}</p>
      <p className="mt-1 text-[11px] text-muted">Fuente: {data.source}</p>
    </div>
  );
}

export function Blocks() {
  const [selected, setSelected] = useState<BlockInfo | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["catalog"],
    queryFn: api.getBlockCatalog,
  });
  const catalog = useMemo(
    () => new Map((data ?? []).map((block) => [block.name, block])),
    [data],
  );
  const previewModel = useMemo(() => {
    if (!selected) return null;
    const hitbox = selected.hitbox;
    const size = hitbox
      ? hitbox.max.map((value, index) =>
        Math.max(1, Math.ceil(value - hitbox.min[index])),
      ) as [number, number, number]
      : [1, 1, 1] as [number, number, number];
    return {
      size,
      origin: [0, 0, 0] as [number, number, number],
      phases: 1,
      blocks: [{ x: 0, y: 0, z: 0, name: selected.name, rotation: 0, phase: 1 }],
    };
  }, [selected]);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1600px] flex-col px-8 py-8">
      <PageHeader
        title="Bloques de Hytale"
        subtitle={
          <>
            Catálogo <strong>completo</strong> con los iconos y nombres reales de tu instalación,
            organizado por categoría y por forma.
          </>
        }
      />

      {isLoading && (
        <div className="min-h-0 flex-1">
          <BlockGridSkeleton />
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 p-4 text-sm text-danger-text"
        >
          No se pudo leer el catálogo: {errorMessage(error)}. Comprueba que Hytale está instalado.
        </div>
      )}

      {data && (
        <div className="min-h-0 flex-1">
          <BlockBrowser blocks={data} onPick={setSelected} defaultOnlyBlocks={true} slotSize={60} />
        </div>
      )}

      {selected && (
        <Modal
          onClose={() => setSelected(null)}
          label={selected.display_name ?? selected.name}
          maxW="max-w-3xl"
        >
          <div className="flex items-start gap-4">
              <SlotIcon block={selected} size={88} />
              <div className="min-w-0 flex-1">
                <h3 className="text-xl">{selected.display_name ?? selected.name}</h3>
                <p className="mb-2 break-all text-xs text-muted">{selected.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(() => {
                    const c = blockCats(selected);
                    return (
                      <>
                        <Badge variant="accent">{topLabel(c.top)}</Badge>
                        {c.sub && <Badge>{subLabel(c.sub)}</Badge>}
                      </>
                    );
                  })()}
                  {selected.draw_type && <Badge>{selected.draw_type}</Badge>}
                  {!selected.is_block && <Badge variant="gold">No colocable</Badge>}
                </div>
              </div>
            </div>
            {previewModel && (
              <div className="mt-4">
                <p className="mb-1.5 text-[10px] uppercase tracking-wide text-accent-hi">
                  Modelo 3D oficial
                </p>
                <div className="h-80 overflow-hidden rounded-[var(--radius)] border border-line bg-bg shadow-inner">
                  <VoxelViewerLazy
                    model={previewModel}
                    catalog={catalog}
                    visibleUpToPhase={1}
                    presentation="object"
                  />
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  Arrastra para orbitar · rueda para acercar · usa las vistas rápidas del visor.
                </p>
              </div>
            )}
            {(() => {
              const g = blockGuide(selected);
              return (
                <div className="mt-4 space-y-3 text-sm">
                  <div>
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-accent-hi">Descripción</p>
                    <p className="text-ink">{g.description}</p>
                  </div>
                  <div>
                    <p className="mb-0.5 text-[10px] uppercase tracking-wide text-accent-hi">Cómo se consigue</p>
                    <p className="text-ink">{g.obtain}</p>
                  </div>
                  <WikiPanel block={selected} />
                  <div className="space-y-1 text-muted">
                    {selected.categories.length > 0 && (
                      <div>
                        Categorías: <span className="text-ink">{selected.categories.join(", ")}</span>
                      </div>
                    )}
                    <div>
                      Texturas: <span className="text-ink">{selected.textures.length}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
        </Modal>
      )}
    </div>
  );
}
