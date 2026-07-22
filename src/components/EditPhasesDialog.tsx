import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { inputCls } from "@/components/ui/inputStyles";
import { HyIcon } from "@/components/HyIcon";
import { EditMaterialsDialog } from "@/components/EditMaterialsDialog";
import { errorMessage } from "@/lib/errorMessage";

interface LocalStep {
  id: number;
  title: string;
  instruction: string;
}
interface LocalPhase {
  id: number;
  name: string;
  description: string;
  steps: LocalStep[];
}

/** Botón cuadrado pequeño para acciones (subir/bajar/eliminar). */
function IconBtn({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      className="grid h-7 w-7 place-items-center rounded border border-line text-muted hover:text-ink disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}

export function EditPhasesDialog({
  buildId,
  onClose,
}: {
  buildId: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ["build", buildId],
    queryFn: () => api.getBuildDetail(buildId),
  });
  const serverPhases = data?.phases;

  const [local, setLocal] = useState<LocalPhase[]>([]);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [matsPhase, setMatsPhase] = useState<{ id: number; name: string } | null>(null);

  // Clave estructural: cambia al añadir/eliminar/reordenar, no al teclear texto.
  const idsKey = (serverPhases ?? [])
    .map((p) => `${p.id}:${p.steps.map((s) => s.id).join(",")}`)
    .join("|");

  // Re-sincroniza el buffer editable cuando cambia la estructura.
  useEffect(() => {
    if (!serverPhases) return;
    setLocal(
      serverPhases.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        steps: p.steps.map((s) => ({ id: s.id, title: s.title, instruction: s.instruction })),
      })),
    );
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPhase = (id: number, patch: Partial<LocalPhase>) =>
    setLocal((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const setStep = (pid: number, sid: number, patch: Partial<LocalStep>) =>
    setLocal((prev) =>
      prev.map((p) =>
        p.id === pid
          ? { ...p, steps: p.steps.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }
          : p,
      ),
    );

  /** Persiste todos los textos del buffer (fases y pasos). */
  const flushText = async () => {
    for (const p of local) {
      await api.updatePhase(p.id, p.name, p.description);
      for (const s of p.steps) await api.updateStep(s.id, s.title, s.instruction);
    }
  };

  /** Ejecuta una acción estructural: guarda textos, corre la acción y refresca. */
  const structural = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await flushText();
      await fn();
      await qc.invalidateQueries({ queryKey: ["build", buildId] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addPhase = () => structural(() => api.addPhase(buildId, "Nueva fase", ""));
  const deletePhase = (id: number) => structural(() => api.deletePhase(id));
  const movePhase = (index: number, dir: -1 | 1) =>
    structural(() => {
      const ids = local.map((p) => p.id);
      const j = index + dir;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      return api.reorderPhases(ids);
    });
  const addStep = (phaseId: number) => structural(() => api.addStep(phaseId, "Nuevo paso", ""));
  const deleteStep = (id: number) => structural(() => api.deleteStep(id));
  const moveStep = (phase: LocalPhase, index: number, dir: -1 | 1) =>
    structural(() => {
      const ids = phase.steps.map((s) => s.id);
      const j = index + dir;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      return api.reorderSteps(ids);
    });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await flushText();
      await qc.invalidateQueries({ queryKey: ["build", buildId] });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <>
      <Modal onClose={onClose} label="Editar fases y pasos" maxW="max-w-2xl" className="flex max-h-[85vh] flex-col">
        <h3 className="mb-1 text-xl">Editar fases y pasos</h3>
        <p className="mb-4 text-xs text-muted">
          Renombra, reordena (▲▼), añade o elimina fases y pasos. Los cambios de orden y
          estructura se guardan al instante; los textos, al pulsar «Guardar cambios».
        </p>
        <div className="flex-1 space-y-5 overflow-auto pr-1">
          {isLoading && local.length === 0 && (
            <p className="py-6 text-center text-sm text-muted">Cargando fases…</p>
          )}
          {loadError && local.length === 0 && (
            <p className="py-6 text-center text-sm text-danger">{errorMessage(loadError)}</p>
          )}
          {local.map((p, i) => (
            <div key={p.id} className="rounded-md border border-line bg-surface/50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wide text-accent-hi">Fase {i + 1}</span>
                <div className="flex items-center gap-1">
                  <IconBtn title="Subir fase" onClick={() => movePhase(i, -1)} disabled={busy || i === 0}>
                    ▲
                  </IconBtn>
                  <IconBtn
                    title="Bajar fase"
                    onClick={() => movePhase(i, 1)}
                    disabled={busy || i === local.length - 1}
                  >
                    ▼
                  </IconBtn>
                  <IconBtn title="Eliminar fase" onClick={() => deletePhase(p.id)} disabled={busy}>
                    <HyIcon name="close" size={12} />
                  </IconBtn>
                </div>
              </div>
              <input
                className={`${inputCls} mb-2`}
                aria-label={`Nombre de la fase ${i + 1}`}
                value={p.name}
                onChange={(e) => setPhase(p.id, { name: e.target.value })}
                placeholder="Nombre de la fase"
              />
              <textarea
                className={`${inputCls} mb-2`}
                aria-label={`Descripción de la fase ${i + 1}`}
                rows={2}
                value={p.description}
                onChange={(e) => setPhase(p.id, { description: e.target.value })}
                placeholder="Descripción de la fase (opcional)"
              />
              <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-line bg-surface/40 px-3 py-1.5">
                <span className="text-xs text-muted">
                  Materiales:{" "}
                  <span className="text-ink">
                    {serverPhases?.find((sp) => sp.id === p.id)?.materials.length ?? 0}
                  </span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setMatsPhase({ id: p.id, name: p.name })}
                >
                  <HyIcon name="blocks" size={14} /> Editar materiales
                </Button>
              </div>
              <div className="space-y-2 border-t border-line pt-2">
                {p.steps.map((s, j) => (
                  <div key={s.id}>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-xs text-muted">Paso {j + 1}</span>
                      <div className="flex items-center gap-1">
                        <IconBtn
                          title="Subir paso"
                          onClick={() => moveStep(p, j, -1)}
                          disabled={busy || j === 0}
                        >
                          ▲
                        </IconBtn>
                        <IconBtn
                          title="Bajar paso"
                          onClick={() => moveStep(p, j, 1)}
                          disabled={busy || j === p.steps.length - 1}
                        >
                          ▼
                        </IconBtn>
                        <IconBtn title="Eliminar paso" onClick={() => deleteStep(s.id)} disabled={busy}>
                          <HyIcon name="close" size={12} />
                        </IconBtn>
                      </div>
                    </div>
                    <input
                      className={`${inputCls} mb-1`}
                      aria-label={`Título del paso ${j + 1}`}
                      value={s.title}
                      onChange={(e) => setStep(p.id, s.id, { title: e.target.value })}
                      placeholder="Título del paso"
                    />
                    <textarea
                      className={inputCls}
                      aria-label={`Instrucción del paso ${j + 1}`}
                      rows={2}
                      value={s.instruction}
                      onChange={(e) => setStep(p.id, s.id, { instruction: e.target.value })}
                      placeholder="Instrucción detallada (opcional)"
                    />
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => addStep(p.id)}
                  disabled={busy}
                  className="mt-1"
                >
                  + Añadir paso
                </Button>
              </div>
            </div>
          ))}
          <Button variant="secondary" onClick={addPhase} disabled={busy} className="w-full justify-center">
            + Añadir fase
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2 border-t border-line pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={save} disabled={saving || busy}>
            {saving ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </Modal>
      {matsPhase && (
        <EditMaterialsDialog
          buildId={buildId}
          phaseId={matsPhase.id}
          phaseName={matsPhase.name}
          initial={serverPhases?.find((sp) => sp.id === matsPhase.id)?.materials ?? []}
          onClose={() => setMatsPhase(null)}
        />
      )}
    </>
  );
}
