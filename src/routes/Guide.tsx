import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type MaterialRow, type StoredModel } from "@/lib/api";
import { SlotIcon } from "@/components/BlockIcon";
import { HyIcon } from "@/components/HyIcon";
import { VoxelViewerLazy } from "@/components/VoxelViewerLazy";
import { LayerBlueprint } from "@/components/LayerBlueprint";
import { useCatalogMap } from "@/lib/useCatalog";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/Modal";
import { ResizableSidebar } from "@/components/ui/ResizableSidebar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { cn } from "@/lib/utils";

type GuideView = "assembly" | "upToLayer" | "onlyLayer";

export function Guide() {
  const { id } = useParams();
  const buildId = Number(id);
  const qc = useQueryClient();
  const catalog = useCatalogMap();

  const detail = useQuery({
    queryKey: ["build", buildId],
    queryFn: () => api.getBuildDetail(buildId),
    enabled: Number.isFinite(buildId),
  });
  const voxels = useQuery({
    queryKey: ["voxels", buildId],
    queryFn: () => api.getBuildVoxels(buildId),
    enabled: Number.isFinite(buildId),
  });
  const progress = useQuery({
    queryKey: ["progress", buildId],
    queryFn: () => api.getProgress(buildId),
    enabled: Number.isFinite(buildId),
  });
  const completed = useQuery({
    queryKey: ["completed", buildId],
    queryFn: () => api.getCompletedSteps(buildId),
    enabled: Number.isFinite(buildId),
  });

  const phases = detail.data?.phases ?? [];
  const [phaseIdx, setPhaseIdx] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sideTab, setSideTab] = useState<"build" | "blueprint">("build");
  const [guideView, setGuideView] = useState<GuideView>("assembly");
  const [activeLayerY, setActiveLayerY] = useState<number | null>(null);
  const [focusBlock, setFocusBlock] = useState<string | null>(null);

  // Posiciona la fase actual a partir del progreso guardado (una sola vez al cargar).
  useEffect(() => {
    const cur = progress.data?.current_phase_id;
    if (cur && phases.length > 0) {
      const i = phases.findIndex((p) => p.id === cur);
      if (i >= 0) setPhaseIdx(i);
    }
  }, [progress.data, detail.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPhase = phases[phaseIdx];
  const scope = currentPhase ? `phase:${currentPhase.id}` : "total";

  const checklist = useQuery({
    queryKey: ["checklist", buildId, scope],
    queryFn: () => api.getChecklist(buildId, scope),
    enabled: Boolean(currentPhase),
  });

  const gathered = useMemo(() => {
    const m = new Map<string, number>();
    checklist.data?.forEach((c) => m.set(c.block_name, c.gathered_qty));
    return m;
  }, [checklist.data]);

  const completedSet = useMemo(() => new Set(completed.data ?? []), [completed.data]);

  // Plano por capas de la FASE actual: solo sus bloques (lo que toca montar ahora).
  const phaseModel = useMemo<StoredModel | null>(() => {
    if (!voxels.data) return null;
    const blocks = voxels.data.blocks.filter((b) => b.phase === phaseIdx && b.name !== "Empty");
    if (!blocks.length) return null;
    return { size: [0, 0, 0], origin: [0, 0, 0], phases: 1, blocks };
  }, [voxels.data, phaseIdx]);

  useEffect(() => {
    if (!phaseModel?.blocks.length) {
      setActiveLayerY(null);
      return;
    }
    setActiveLayerY(Math.min(...phaseModel.blocks.map((block) => block.y)));
  }, [phaseModel]);

  const setMaterial = useMutation({
    mutationFn: (v: { block: string; qty: number }) =>
      api.setMaterialGathered(buildId, scope, v.block, Math.max(0, v.qty)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["checklist", buildId, scope] }),
  });

  const toggleStep = useMutation({
    mutationFn: (v: { stepId: number; done: boolean }) =>
      api.setStepCompleted(buildId, v.stepId, v.done),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["completed", buildId] }),
  });

  const saveProgress = useMutation({
    mutationFn: (v: { status: "in_progress" | "completed"; phaseId: number | null }) =>
      api.setProgress(buildId, v.status, v.phaseId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["progress", buildId] }),
  });

  const reset = useMutation({
    mutationFn: () => api.resetProgress(buildId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["progress", buildId] });
      qc.invalidateQueries({ queryKey: ["completed", buildId] });
      qc.invalidateQueries({ queryKey: ["checklist", buildId] });
      setPhaseIdx(0);
    },
  });

  const goToPhase = (i: number) => {
    const clamped = Math.max(0, Math.min(phases.length - 1, i));
    setPhaseIdx(clamped);
    setActiveLayerY(null);
    setFocusBlock(null);
    const ph = phases[clamped];
    if (ph) saveProgress.mutate({ status: "in_progress", phaseId: ph.id });
  };

  // Navegación entre fases con las flechas ←/→ (salvo escribiendo en un campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      goToPhase(phaseIdx + (e.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phaseIdx, phases]); // eslint-disable-line react-hooks/exhaustive-deps

  if (detail.isLoading) return <div className="p-8 text-muted">Cargando guía…</div>;
  if (detail.error || !detail.data || phases.length === 0)
    return (
      <div className="p-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
          <HyIcon name="back" size={16} /> Volver
        </Link>
        <p className="text-muted">Esta build no tiene una guía disponible.</p>
      </div>
    );

  const build = detail.data.build;
  const phaseMaterials: MaterialRow[] = currentPhase?.materials ?? [];
  const isCompleted = progress.data?.status === "completed";
  const isLastPhase = phaseIdx === phases.length - 1;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/build/${buildId}`}
            className="inline-flex items-center gap-1 rounded text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <HyIcon name="back" size={16} /> Ficha
          </Link>
          <span className="text-ink">{build.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted">
            Fase {phaseIdx + 1} de {phases.length}
            {isCompleted && <span className="ml-2 text-accent-hi">· Completada</span>}
          </span>
          <button
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
          >
            Reiniciar progreso
          </button>
        </div>
      </header>

      {/* Barra de progreso por fases: cada segmento es clicable y muestra su estado
          (actual / completada / pendiente) para saltar y ver de un vistazo cuánto queda. */}
      <div className="flex items-center gap-1.5 border-b border-line px-6 py-2">
        {phases.map((p, i) => {
          const complete = p.steps.length > 0 && p.steps.every((s) => completedSet.has(s.id));
          const active = i === phaseIdx;
          return (
            <button
              key={p.id}
              onClick={() => goToPhase(i)}
              aria-label={`Ir a la fase ${i + 1}: ${p.name}`}
              aria-current={active ? "step" : undefined}
              title={`Fase ${i + 1}: ${p.name}`}
              className="group flex-1 rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <span
                className={cn(
                  "block h-1.5 rounded-full transition-colors",
                  active
                    ? "bg-accent"
                    : complete
                      ? "bg-accent/50"
                      : "bg-line group-hover:bg-line/80",
                )}
              />
            </button>
          );
        })}
      </div>

      <ResizableSidebar
        className="flex-1"
        storageKey="vf_guide_side"
        sideWidth={380}
        main={
        /* Visor 3D: construido hasta la fase actual, con la fase actual resaltada */
        <div className="flex h-full min-h-[320px] flex-col bg-bg">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-3 py-2">
            <p className="shrink-0 text-xs font-medium text-ink">Vista 3D</p>
            <SegmentedControl
              value={guideView}
              onChange={setGuideView}
              label="Modo de visualización de la construcción"
              segments={[
                { value: "assembly", label: "Montaje" },
                { value: "upToLayer", label: "Hasta capa" },
                { value: "onlyLayer", label: "Solo capa" },
              ]}
              className="shrink-0"
            />
          </div>
          <div className="min-h-0 flex-1">
          {voxels.data ? (
            <VoxelViewerLazy
              model={voxels.data}
              catalog={catalog}
              visibleUpToPhase={phaseIdx}
              highlightPhase={phaseIdx}
              ghost
              cameraKey={`guide-${buildId}`}
              layerY={activeLayerY}
              layerMode={guideView === "assembly" ? "all" : guideView === "upToLayer" ? "upTo" : "only"}
              focusBlock={focusBlock}
            />
          ) : voxels.isLoading ? (
            <div className="flex h-full items-center justify-center text-muted">
              Cargando modelo 3D…
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-muted">
              <HyIcon name="build" size={40} className="opacity-60" />
              <p className="max-w-xs text-sm">
                Esta guía no tiene modelo 3D. Sigue los pasos y materiales del panel para construirla.
              </p>
            </div>
          )}
          </div>
        </div>
        }
        side={
        /* Panel de la fase */
        <aside className="flex h-full min-h-0 flex-col overflow-auto bg-surface">
          <div className="sticky top-0 z-20 bg-surface shadow-sm">
          <div className="border-b border-line p-5">
            <div className="text-xs uppercase tracking-wide text-accent-hi">
              Fase {phaseIdx + 1} de {phases.length}
            </div>
            <h2 className="text-2xl">{currentPhase?.name}</h2>
            {currentPhase?.description && (
              <p className="mt-1 text-sm text-muted">{currentPhase.description}</p>
            )}
            {currentPhase && (
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                <span>
                  Materiales:{" "}
                  <span className="text-ink">
                    {phaseMaterials.filter((m) => (gathered.get(m.block_name) ?? 0) >= m.qty).length}
                    /{phaseMaterials.length}
                  </span>
                </span>
                <span>
                  Pasos:{" "}
                  <span className="text-ink">
                    {currentPhase.steps.filter((s) => completedSet.has(s.id)).length}/
                    {currentPhase.steps.length}
                  </span>
                </span>
              </div>
            )}
          </div>

          <div className="border-b border-line p-3">
            <SegmentedControl
              fluid
              value={sideTab}
              onChange={setSideTab}
              label="Herramienta de la fase"
              segments={[
                { value: "build", label: "Construir", icon: "build" },
                { value: "blueprint", label: "Plano preciso", icon: "layers" },
              ]}
            />
          </div>
          </div>

          {sideTab === "build" ? (
            <>
            {/* Materiales de esta fase (checklist) */}
            <div className="border-b border-line p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/20 text-[11px] text-accent-hi">1</span>
              Reúne los materiales
            </h3>
            {phaseMaterials.length === 0 ? (
              <p className="text-sm text-muted">Sin materiales en esta fase.</p>
            ) : (
              <ul className="space-y-2">
                {phaseMaterials.map((m) => {
                  const have = gathered.get(m.block_name) ?? 0;
                  const done = have >= m.qty;
                  const block = catalog.get(m.block_name);
                  return (
                    <li key={m.block_name} className="flex items-center gap-3">
                      <SlotIcon
                        block={
                          block ?? {
                            icon: null,
                            name: m.block_name,
                            display_name: null,
                            fallback_color: null,
                          }
                        }
                        size={34}
                      />
                      <span
                        className={`min-w-0 flex-1 truncate text-sm ${done ? "text-muted line-through" : "text-ink"}`}
                        title={block?.display_name ?? m.block_name}
                      >
                        {block?.display_name ?? m.block_name}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          aria-label={`Quitar uno de ${block?.display_name ?? m.block_name}`}
                          className="grid h-9 w-9 place-items-center rounded border border-line text-base leading-none text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          onClick={() => setMaterial.mutate({ block: m.block_name, qty: have - 1 })}
                        >
                          −
                        </button>
                        <span
                          className={`w-14 text-center text-sm ${done ? "text-accent-hi" : "text-ink"}`}
                          aria-label={`${have} de ${m.qty} reunidos`}
                        >
                          {have}/{m.qty}
                        </span>
                        <button
                          aria-label={`Añadir uno de ${block?.display_name ?? m.block_name}`}
                          className="grid h-9 w-9 place-items-center rounded border border-line text-base leading-none text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          onClick={() => setMaterial.mutate({ block: m.block_name, qty: have + 1 })}
                        >
                          +
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            </div>

            {/* Pasos de esta fase (acción principal) */}
            <div className="flex-1 p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
              <span className="grid h-5 w-5 place-items-center rounded-full bg-accent/20 text-[11px] text-accent-hi">2</span>
              Monta paso a paso
            </h3>
            <ul className="space-y-2">
              {currentPhase?.steps.map((s, j) => {
                const done = completedSet.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => toggleStep.mutate({ stepId: s.id, done: !done })}
                      aria-pressed={done}
                      className="flex w-full items-start gap-3 rounded-[var(--radius)] border border-line bg-surface-2 p-3 text-left hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${
                          done ? "border-accent bg-accent" : "border-line"
                        }`}
                      >
                        {done && <HyIcon name="check" size={12} />}
                      </span>
                      <span className={`text-sm ${done ? "text-muted line-through" : "text-ink"}`}>
                        <span className="text-muted">{j + 1}.</span> {s.title}
                        {s.instruction && (
                          <span className="mt-1 block text-xs text-muted">{s.instruction}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            </div>
            </>
          ) : phaseModel ? (
            <div className="flex-1 p-5">
              <div className="mb-4 rounded-md border border-accent/30 bg-accent/10 p-3">
                <p className="text-sm font-medium text-ink">Plano sincronizado con el visor</p>
                <p className="mt-1 text-xs text-muted">
                  Mueve la capa y usa «Hasta capa» o «Solo capa» en la mesa 3D. Pulsa un material para aislarlo.
                </p>
              </div>
              <LayerBlueprint
                model={phaseModel}
                catalog={catalog}
                selectedY={activeLayerY}
                onSelectedYChange={setActiveLayerY}
                focusBlock={focusBlock}
                onFocusBlockChange={setFocusBlock}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <HyIcon name="layers" size={32} className="opacity-60" />
              <p className="text-sm">Esta fase no contiene bloques para generar un plano.</p>
            </div>
          )}

          {/* Build completada */}
          {isCompleted && (
            <div className="flex items-center justify-center gap-2 border-t border-line bg-accent/10 p-4 text-center text-sm text-accent-hi">
              <HyIcon name="check" size={16} />
              ¡Build completada! Has montado «{build.name}» paso a paso.
            </div>
          )}

          {/* Navegación */}
          <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-line bg-surface p-4">
            <Button
              variant="secondary"
              onClick={() => goToPhase(phaseIdx - 1)}
              disabled={phaseIdx === 0}
            >
              <HyIcon name="back" size={16} /> {phaseIdx === 0 ? "Anterior" : `Fase ${phaseIdx}`}
            </Button>
            {isLastPhase ? (
              <Button
                onClick={() => saveProgress.mutate({ status: "completed", phaseId: null })}
                disabled={isCompleted}
              >
                <HyIcon name="check" size={18} /> {isCompleted ? "¡Completada!" : "Completar build"}
              </Button>
            ) : (
              <Button onClick={() => goToPhase(phaseIdx + 1)}>
                Fase {phaseIdx + 2} <HyIcon name="forward" size={16} />
              </Button>
            )}
          </div>
        </aside>
        }
      />

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} label="Reiniciar progreso" role="alertdialog" maxW="max-w-md">
          <h3 className="mb-2 text-xl">¿Reiniciar el progreso?</h3>
          <p className="mb-5 text-sm text-muted">
            Se desmarcarán todos los pasos y materiales reunidos de esta build, y volverás a la
            fase 1. No se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                reset.mutate();
              }}
            >
              Sí, reiniciar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
