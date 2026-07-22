import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type BlockInfo, type MaterialRow } from "@/lib/api";
import { SlotIcon } from "@/components/BlockIcon";
import { HyIcon } from "@/components/HyIcon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { SearchInput } from "@/components/ui/SearchInput";
import { inputCls } from "@/components/ui/inputStyles";
import { errorMessage } from "@/lib/errorMessage";

export function EditMaterialsDialog({
  buildId,
  phaseId,
  phaseName,
  initial,
  onClose,
}: {
  buildId: number;
  phaseId: number;
  phaseName: string;
  initial: MaterialRow[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: catalog } = useQuery({ queryKey: ["catalog"], queryFn: api.getBlockCatalog });
  const [rows, setRows] = useState<MaterialRow[]>(initial.map((m) => ({ ...m })));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byName = useMemo(() => {
    const m = new Map<string, BlockInfo>();
    catalog?.forEach((b) => m.set(b.name, b));
    return m;
  }, [catalog]);

  const present = useMemo(() => new Set(rows.map((r) => r.block_name)), [rows]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !catalog) return [];
    return catalog
      .filter(
        (b) =>
          !present.has(b.name) &&
          ((b.display_name ?? b.name).toLowerCase().includes(needle) ||
            b.name.toLowerCase().includes(needle)),
      )
      .slice(0, 12);
  }, [q, catalog, present]);

  const add = (name: string) => {
    setRows((p) => [...p, { block_name: name, qty: 1 }]);
    setQ("");
  };
  const setQty = (name: string, qty: number) =>
    setRows((p) => p.map((r) => (r.block_name === name ? { ...r, qty: Math.max(1, qty) } : r)));
  const remove = (name: string) => setRows((p) => p.filter((r) => r.block_name !== name));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.setPhaseMaterials(phaseId, rows);
      await qc.invalidateQueries({ queryKey: ["build", buildId] });
      await qc.invalidateQueries({ queryKey: ["build_summaries"] });
      onClose();
    } catch (e) {
      setError(errorMessage(e, "No se pudieron guardar los materiales."));
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Materiales de la fase" className="flex max-h-[85vh] flex-col">
      <h3 className="mb-1 text-xl">Materiales de la fase</h3>
      <p className="mb-4 text-xs text-muted">«{phaseName}» · elige bloques reales de Hytale.</p>

      {/* Buscador del catálogo real */}
      <SearchInput
        className="mb-2"
        label="Buscar bloque para añadir"
        value={q}
        onChange={setQ}
        placeholder="Buscar bloque para añadir…"
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {q.trim() && !catalog && (
          <p className="mb-3 text-sm text-muted">Cargando catálogo…</p>
        )}
        {results.length > 0 && (
          <div className="mb-3 max-h-44 overflow-auto rounded-md border border-line bg-surface/60">
            {results.map((b) => (
              <button
                key={b.name}
                onClick={() => add(b.name)}
                aria-label={`Añadir ${b.display_name ?? b.name}`}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <SlotIcon block={b} size={28} />
                <span className="min-w-0 flex-1 truncate text-ink">{b.display_name ?? b.name}</span>
                <span className="text-xs text-accent-hi">Añadir</span>
              </button>
            ))}
          </div>
        )}

        {/* Materiales actuales */}
        <div className="min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Aún no hay materiales. Busca y añade bloques arriba.
            </p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => {
                const b = byName.get(r.block_name);
                return (
                  <li key={r.block_name} className="flex items-center gap-3">
                    <SlotIcon
                      block={
                        b ?? {
                          icon: null,
                          name: r.block_name,
                          display_name: null,
                          fallback_color: null,
                        }
                      }
                      size={32}
                    />
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-ink"
                      title={b?.display_name ?? r.block_name}
                    >
                      {b?.display_name ?? r.block_name}
                    </span>
                    <input
                      type="number"
                      min={1}
                      aria-label={`Cantidad de ${b?.display_name ?? r.block_name}`}
                      value={r.qty}
                      onChange={(e) => setQty(r.block_name, Number(e.target.value))}
                      className={`${inputCls} w-20`}
                    />
                    <button
                      aria-label={`Quitar ${b?.display_name ?? r.block_name}`}
                      title="Quitar"
                      onClick={() => remove(r.block_name)}
                      className="grid h-7 w-7 place-items-center rounded border border-line text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <HyIcon name="close" size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Guardando…" : "Guardar materiales"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
