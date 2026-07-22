import { useEffect, useMemo, useRef, useState } from "react";
import { isPlaceableBlock, type BlockInfo } from "@/lib/api";
import { SlotIcon } from "@/components/BlockIcon";
import { HyIcon } from "@/components/HyIcon";
import { Chip } from "@/components/ui/Chip";
import { SearchInput } from "@/components/ui/SearchInput";
import { blockCats, blockShape, shapeLabel, subLabel, topLabel } from "@/lib/blockCategories";
import { cn } from "@/lib/utils";

const PAGE = 240;

/**
 * Navegador completo de bloques: búsqueda + filtros por categoría/subcategoría +
 * carga incremental (todos los bloques, sin tope). Reutilizable en la lista de
 * bloques y en el editor 3D. `onPick` se llama al hacer clic en un bloque.
 */
export function BlockBrowser({
  blocks,
  onPick,
  defaultOnlyBlocks = true,
  selectedName,
  slotSize = 56,
  compact = false,
}: {
  blocks: BlockInfo[];
  onPick: (b: BlockInfo) => void;
  defaultOnlyBlocks?: boolean;
  selectedName?: string | null;
  slotSize?: number;
  /** Modo estrecho (sidebar del editor): filtros colapsables, la rejilla manda. */
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [top, setTop] = useState<string | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [shape, setShape] = useState<string | null>(null);
  const [onlyBlocks, setOnlyBlocks] = useState(defaultOnlyBlocks);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  const activeFilters = (top ? 1 : 0) + (sub ? 1 : 0) + (shape ? 1 : 0);

  // Categorías principales con su recuento (respetando el toggle de colocables).
  const tops = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of blocks) {
      if (onlyBlocks && !isPlaceableBlock(b)) continue;
      const t = blockCats(b).top;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [blocks, onlyBlocks]);

  // Subcategorías de la categoría principal seleccionada.
  const subs = useMemo(() => {
    if (!top) return [];
    const counts = new Map<string, number>();
    for (const b of blocks) {
      if (onlyBlocks && !isPlaceableBlock(b)) continue;
      const c = blockCats(b);
      if (c.top !== top || !c.sub) continue;
      counts.set(c.sub, (counts.get(c.sub) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [blocks, top, onlyBlocks]);

  // Bloques que pasan todos los filtros MENOS la forma (para listar formas disponibles).
  const preShape = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return blocks.filter((b) => {
      if (onlyBlocks && !isPlaceableBlock(b)) return false;
      const c = blockCats(b);
      if (top && c.top !== top) return false;
      if (sub && c.sub !== sub) return false;
      if (
        needle &&
        !(b.display_name ?? b.name).toLowerCase().includes(needle) &&
        !b.name.toLowerCase().includes(needle)
      )
        return false;
      return true;
    });
  }, [blocks, q, top, sub, onlyBlocks]);

  // Formas disponibles en el conjunto actual (sin contar "Block" entero a menos que sea único).
  const shapes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const b of preShape) {
      const s = blockShape(b.name);
      if (s === "Block") continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [preShape]);

  const filtered = useMemo(
    () => (shape ? preShape.filter((b) => blockShape(b.name) === shape) : preShape),
    [preShape, shape],
  );

  // Reinicia la paginación al cambiar cualquier filtro.
  useEffect(() => setLimit(PAGE), [q, top, sub, onlyBlocks, shape]);

  // Si la forma elegida deja de existir tras cambiar de categoría, la limpia.
  useEffect(() => {
    if (shape && !shapes.some(([s]) => s === shape)) setShape(null);
  }, [shapes, shape]);

  // Carga incremental al hacer scroll (sin librerías).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) setLimit((l) => l + PAGE);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const shown = filtered.slice(0, limit);

  // Filas de chips de filtro (compartidas por ambos modos).
  const filterChips = (
    <>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={!top} onClick={() => { setTop(null); setSub(null); }}>
          Todas
        </Chip>
        {tops.map(([t, n]) => (
          <Chip key={t} active={top === t} onClick={() => { setTop(top === t ? null : t); setSub(null); }}>
            {topLabel(t)} <span className="opacity-60">{n}</span>
          </Chip>
        ))}
      </div>
      {subs.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip active={!sub} onClick={() => setSub(null)}>
            Todo {topLabel(top!)}
          </Chip>
          {subs.map(([sName, n]) => (
            <Chip key={sName} active={sub === sName} onClick={() => setSub(sub === sName ? null : sName)}>
              {subLabel(sName)} <span className="opacity-60">{n}</span>
            </Chip>
          ))}
        </div>
      )}
      {shapes.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[11px] uppercase tracking-wide text-muted">Forma</span>
          {shapes.map(([sName, n]) => (
            <Chip key={sName} active={shape === sName} onClick={() => setShape(shape === sName ? null : sName)}>
              {shapeLabel(sName)} <span className="opacity-60">{n}</span>
            </Chip>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Buscador */}
      <div className={cn("flex items-center gap-3", compact ? "mb-2" : "mb-3 flex-wrap")}>
        <SearchInput
          className={compact ? "flex-1" : "min-w-[200px] flex-1"}
          label="Buscar bloque"
          value={q}
          onChange={setQ}
          placeholder={compact ? "Buscar bloque…" : "Buscar cualquier bloque…"}
        />
        {!compact && (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={onlyBlocks}
              onChange={(e) => setOnlyBlocks(e.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Solo colocables
          </label>
        )}
      </div>

      {compact ? (
        <>
          {/* Barra compacta: alternar filtros + solo colocables + contador */}
          <div className="mb-2 flex items-center justify-between gap-2">
            <button
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                activeFilters > 0
                  ? "border-accent/50 bg-accent/15 text-accent-hi"
                  : "border-line text-muted hover:text-ink",
              )}
            >
              Filtros{activeFilters > 0 ? ` · ${activeFilters}` : ""}
              <HyIcon name="forward" size={11} className={cn("rotate-90", filtersOpen && "-rotate-90")} />
            </button>
            <label className="flex items-center gap-1.5 text-[11px] text-muted">
              <input
                type="checkbox"
                checked={onlyBlocks}
                onChange={(e) => setOnlyBlocks(e.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Colocables
            </label>
          </div>
          {filtersOpen && (
            <div className="mb-2 max-h-52 overflow-auto rounded-md border border-line bg-surface-2/30 p-2">
              {filterChips}
              {activeFilters > 0 && (
                <button
                  onClick={() => { setTop(null); setSub(null); setShape(null); }}
                  className="mt-2 rounded px-1.5 py-0.5 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="mb-3">{filterChips}</div>
      )}

      <p className="mb-2 text-xs text-muted">
        {filtered.length} bloques{shown.length < filtered.length ? ` · mostrando ${shown.length}` : ""}
      </p>

      {/* Rejilla con carga incremental */}
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${slotSize + 36}px, 1fr))` }}
        >
          {shown.map((b) => (
            <button
              key={b.name}
              onClick={() => onPick(b)}
              title={b.display_name ?? b.name}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-[var(--radius)] p-2 text-center transition-colors hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                selectedName === b.name && "bg-accent/15 ring-1 ring-accent/50",
              )}
            >
              <span className="hy-slot flex items-center justify-center rounded-[var(--radius)] p-1">
                <SlotIcon block={b} size={slotSize} />
              </span>
              <span className="line-clamp-2 text-[11px] leading-tight text-ink">
                {b.display_name ?? b.name}
              </span>
            </button>
          ))}
        </div>
        {shown.length < filtered.length && <div ref={sentinel} className="h-12" />}
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">Ningún bloque coincide.</p>
        )}
      </div>
    </div>
  );
}
