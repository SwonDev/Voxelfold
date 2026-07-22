import { useEffect, useMemo, useState } from "react";
import { type BlockInfo, type StoredModel, type StoredVoxel } from "@/lib/api";
import { parseBlockName, isMarkerName } from "@/lib/resolveBlock";
import { BlockIcon } from "@/components/BlockIcon";
import { Tooltip } from "@/components/HyPanel";
import { occupiedVoxelCells } from "@/lib/blockFootprint";
import { cn } from "@/lib/utils";

interface BlueprintCell {
  name: string;
  voxel: StoredVoxel;
  base: boolean;
  overlaps: number;
}

interface Layer {
  y: number;
  grid: (BlueprintCell | null)[];
  w: number;
  d: number;
  conflicts: number;
}

interface Seg {
  text: number;
  left: number;
  top: number;
  anchor: "top" | "bottom" | "left" | "right";
}

/**
 * Calcula las COTAS del contorno exterior de una capa (longitud de cada tramo de
 * pared, como en los tutoriales de construcción: "5", "6", …). Solo el contorno
 * exterior (huecos interiores no se acotan): se hace flood-fill de los huecos
 * alcanzables desde fuera y se marca un borde como exterior si su celda vecina vacía
 * es exterior. Devuelve etiquetas posicionadas en píxeles (pad + celda·n).
 */
function computeSegments(grid: (BlueprintCell | null)[], w: number, d: number, cell: number, pad: number): Seg[] {
  const occ = (c: number, r: number) => c >= 0 && c < w && r >= 0 && r < d && grid[r * w + c] != null;
  const key = (c: number, r: number) => `${c},${r}`;
  const ext = new Set<string>();
  const stack: [number, number][] = [];
  const push = (c: number, r: number) => {
    const k = key(c, r);
    if (!ext.has(k)) {
      ext.add(k);
      stack.push([c, r]);
    }
  };
  // Sembrar el borde del marco con 1 celda de margen (siempre exterior).
  for (let c = -1; c <= w; c++) {
    push(c, -1);
    push(c, d);
  }
  for (let r = -1; r <= d; r++) {
    push(-1, r);
    push(w, r);
  }
  while (stack.length) {
    const [c, r] = stack.pop()!;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = c + dc, nr = r + dr;
      if (nc < -1 || nc > w || nr < -1 || nr > d) continue;
      if (occ(nc, nr)) continue; // no atraviesa bloques
      push(nc, nr);
    }
  }
  const isExt = (c: number, r: number) =>
    c < 0 || c >= w || r < 0 || r >= d ? true : ext.has(key(c, r));

  const segs: Seg[] = [];
  // Horizontales (arriba/abajo): por fila, agrupando columnas consecutivas.
  for (let r = 0; r < d; r++) {
    for (const [side, ext_r, top] of [
      ["top", r - 1, pad + r * cell] as const,
      ["bottom", r + 1, pad + (r + 1) * cell] as const,
    ]) {
      let start = -1;
      for (let c = 0; c <= w; c++) {
        const on = c < w && occ(c, r) && isExt(c, ext_r);
        if (on && start < 0) start = c;
        if (!on && start >= 0) {
          segs.push({ text: c - start, left: pad + ((start + c) / 2) * cell, top, anchor: side });
          start = -1;
        }
      }
    }
  }
  // Verticales (izquierda/derecha): por columna, agrupando filas consecutivas.
  for (let c = 0; c < w; c++) {
    for (const [side, ext_c, left] of [
      ["left", c - 1, pad + c * cell] as const,
      ["right", c + 1, pad + (c + 1) * cell] as const,
    ]) {
      let start = -1;
      for (let r = 0; r <= d; r++) {
        const on = r < d && occ(c, r) && isExt(ext_c, r);
        if (on && start < 0) start = r;
        if (!on && start >= 0) {
          segs.push({ text: r - start, left, top: pad + ((start + r) / 2) * cell, anchor: side });
          start = -1;
        }
      }
    }
  }
  return segs;
}

const ANCHOR: Record<Seg["anchor"], string> = {
  top: "translate(-50%, -135%)",
  bottom: "translate(-50%, 35%)",
  left: "translate(-135%, -50%)",
  right: "translate(35%, -50%)",
};

/**
 * Plano por capas: muestra el build capa a capa (de abajo arriba) en una rejilla
 * cenital X×Z, con el **icono nativo** del juego en cada celda, las **cotas** de cada
 * tramo del contorno y el **recuento de bloques** de la capa. Es lo más útil para
 * construir de verdad y 100% nativo (los iconos son el render 1:1 del propio juego).
 */
export function LayerBlueprint({
  model,
  catalog,
  selectedY,
  onSelectedYChange,
  focusBlock = null,
  onFocusBlockChange,
}: {
  model: StoredModel;
  catalog: Map<string, BlockInfo>;
  /** Altura Y controlada desde el visor 3D. */
  selectedY?: number | null;
  onSelectedYChange?: (y: number) => void;
  /** Tipo de bloque resaltado tanto en el plano como en el visor 3D. */
  focusBlock?: string | null;
  onFocusBlockChange?: (name: string | null) => void;
}) {
  const layers = useMemo<Layer[]>(() => {
    // Excluye marcadores de generación (spawners/barreras/triggers…) y vacíos: no son bloques
    // de construcción. Después expande la HUELLA oficial: una cama, puerta grande o banco
    // ocupa todas sus celdas filler, no solo el ancla que aparece en el prefab.
    const blocks = model.blocks.filter((b) => b.name !== "Empty" && !isMarkerName(b.name));
    if (!blocks.length) return [];
    const occupied = occupiedVoxelCells(blocks, catalog);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const cell of occupied) {
      minX = Math.min(minX, cell.x); maxX = Math.max(maxX, cell.x);
      minY = Math.min(minY, cell.y); maxY = Math.max(maxY, cell.y);
      minZ = Math.min(minZ, cell.z); maxZ = Math.max(maxZ, cell.z);
    }
    const w = maxX - minX + 1;
    const d = maxZ - minZ + 1;
    const byY = new Map<number, (BlueprintCell | null)[]>();
    for (let y = minY; y <= maxY; y++) byY.set(y, new Array(w * d).fill(null));
    for (const cell of occupied) {
      const grid = byY.get(cell.y);
      if (!grid) continue;
      const index = (cell.z - minZ) * w + (cell.x - minX);
      const previous = grid[index];
      const next: BlueprintCell = {
        name: cell.voxel.name,
        voxel: cell.voxel,
        base: cell.base,
        overlaps: (previous?.overlaps ?? 0) + (previous ? 1 : 0),
      };
      // Si una huella pisa el ancla de otra pieza, conserva el ancla para que el conflicto
      // sea accionable y el material que debe colocarse siga visible.
      grid[index] = previous?.base && !cell.base ? { ...previous, overlaps: next.overlaps } : next;
    }
    return Array.from(byY.entries())
      .map(([y, grid]) => ({
        y,
        grid,
        w,
        d,
        conflicts: grid.filter((cell) => (cell?.overlaps ?? 0) > 0).length,
      }))
      .filter((l) => l.grid.some(Boolean));
  }, [model, catalog]);

  const [internalIdx, setInternalIdx] = useState(0);
  const controlledIdx = selectedY == null ? -1 : layers.findIndex((layer) => layer.y === selectedY);
  const idx = Math.max(0, Math.min(controlledIdx >= 0 ? controlledIdx : internalIdx, layers.length - 1));
  const setIdx = (next: number) => {
    const clamped = Math.max(0, Math.min(next, layers.length - 1));
    setInternalIdx(clamped);
    const nextLayer = layers[clamped];
    if (nextLayer) onSelectedYChange?.(nextLayer.y);
  };

  // Al cambiar de fase, sincroniza el visor con la primera capa válida.
  useEffect(() => {
    if (!layers.length) return;
    const next = Math.max(0, Math.min(controlledIdx >= 0 ? controlledIdx : internalIdx, layers.length - 1));
    setInternalIdx(next);
    onSelectedYChange?.(layers[next].y);
  }, [layers, controlledIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  const iconFor = (name: string) => {
    const { base } = parseBlockName(name);
    return catalog.get(name) ?? catalog.get(base);
  };

  const layer = layers[Math.min(idx, layers.length - 1)];
  const cell = layer ? (layer.w > 24 || layer.d > 24 ? 14 : 20) : 20;
  const pad = 22;

  const segs = useMemo(
    () => (layer ? computeSegments(layer.grid, layer.w, layer.d, cell, pad) : []),
    [layer, cell],
  );

  // Materiales que realmente se COLOCAN en esta altura. Las celdas filler se dibujan para
  // medir el espacio físico, pero no se vuelven a contar como piezas/materiales.
  const tally = useMemo(() => {
    if (!layer) return { total: 0, occupied: 0, rows: [] as { name: string; count: number }[] };
    const m = new Map<string, number>();
    let total = 0;
    let occupied = 0;
    for (const cell of layer.grid) {
      if (!cell) continue;
      occupied++;
      if (!cell.base) continue;
      total += 1;
      const base = parseBlockName(cell.name).base;
      m.set(base, (m.get(base) ?? 0) + 1);
    }
    const rows = [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    return { total, occupied, rows };
  }, [layer]);

  if (!layers.length) return <p className="text-sm text-muted">Sin plano disponible.</p>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="shrink-0 text-sm text-ink">
          Capa <span className="font-medium">{idx + 1}</span> / {layers.length}
        </span>
        <input
          type="range"
          min={0}
          max={layers.length - 1}
          value={Math.min(idx, layers.length - 1)}
          aria-label="Capa del plano"
          aria-valuetext={`Capa ${idx + 1} de ${layers.length}`}
          onChange={(e) => setIdx(+e.target.value)}
          className="w-full rounded accent-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <span className="shrink-0 text-xs text-muted">
          Y {layer.y} · {layer.w} × {layer.d} · <span className="text-ink">{tally.total}</span> colocaciones
        </span>
      </div>
      <p className="mb-2 text-xs text-muted">
        Vista cenital con medidas reales. El borde discontinuo marca celdas filler que Hytale
        reserva para piezas multicelda; solo el ancla sólida se coloca y consume material.
      </p>
      {layer.conflicts > 0 && (
        <p role="alert" className="mb-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-2 text-xs text-danger">
          {layer.conflicts} {layer.conflicts === 1 ? "celda está ocupada" : "celdas están ocupadas"} por más de una pieza. Revisa sus anclas antes de construir.
        </p>
      )}
      <div className="max-h-[460px] overflow-auto rounded-[var(--radius)] border border-line bg-surface p-2">
        <div
          className="relative"
          style={{ width: layer.w * cell + pad * 2, height: layer.d * cell + pad * 2 }}
        >
          {/* Rejilla de iconos */}
          <div
            className="absolute grid gap-px"
            style={{
              left: pad,
              top: pad,
              gridTemplateColumns: `repeat(${layer.w}, ${cell}px)`,
              width: "max-content",
            }}
          >
            {layer.grid.map((entry, i) =>
              entry ? (
                <Tooltip
                  key={i}
                  label={`${iconFor(entry.name)?.display_name ?? parseBlockName(entry.name).base}${entry.base ? " · ancla" : ` · huella desde ${entry.voxel.x}, ${entry.voxel.y}, ${entry.voxel.z}`}`}
                  side="top"
                >
                  <div
                    className={cn(
                      "relative",
                      focusBlock && parseBlockName(entry.name).base !== focusBlock && "opacity-25",
                    )}
                    style={{ width: cell, height: cell }}
                  >
                    <BlockIcon
                      block={iconFor(entry.name) ?? { icon: null, name: entry.name, display_name: null, fallback_color: null }}
                      size={cell}
                    />
                    {!entry.base && (
                      <span className="pointer-events-none absolute inset-px border border-dashed border-accent-hi/80 bg-accent/10" />
                    )}
                    {entry.overlaps > 0 && (
                      <span className="pointer-events-none absolute inset-0 border-2 border-danger bg-danger/15" />
                    )}
                  </div>
                </Tooltip>
              ) : (
                <div key={i} style={{ width: cell, height: cell }} className="bg-bg/60" />
              ),
            )}
          </div>
          {/* Cotas del contorno (longitud de cada tramo, estilo tutorial) */}
          {segs.map((s, i) => (
            <span
              key={i}
              className="pointer-events-none absolute select-none text-[11px] font-bold leading-none text-white"
              style={{ left: s.left, top: s.top, transform: ANCHOR[s.anchor], textShadow: "0 0 2px #000, 0 0 3px #000" }}
            >
              {s.text}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted">
        {tally.occupied} celdas físicas ocupadas · {tally.total} piezas se anclan en esta altura
      </p>

      {/* Recuento de colocaciones de la capa: qué piezas anclar y cuántas. */}
      {tally.rows.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs text-muted">Coloca en esta capa</p>
          <div className="flex flex-wrap gap-1.5">
            {tally.rows.map((row) => (
              <Tooltip key={row.name} label={iconFor(row.name)?.display_name ?? row.name} side="top">
                <button
                  type="button"
                  aria-pressed={focusBlock === row.name}
                  onClick={() => onFocusBlockChange?.(focusBlock === row.name ? null : row.name)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    focusBlock === row.name
                      ? "border-accent/60 bg-accent/20"
                      : "border-line bg-surface-2/50 hover:bg-elevated",
                  )}
                >
                  <BlockIcon
                    block={iconFor(row.name) ?? { icon: null, name: row.name, display_name: null, fallback_color: null }}
                    size={20}
                  />
                  <span className="text-xs text-ink">×{row.count}</span>
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
      {tally.rows.length === 0 && tally.occupied > 0 && (
        <p className="mt-3 text-xs text-muted">
          No hay piezas nuevas que anclar: esta altura contiene la huella de elementos colocados en otra capa.
        </p>
      )}
    </div>
  );
}
