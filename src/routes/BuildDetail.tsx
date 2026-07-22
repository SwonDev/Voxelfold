import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { api, type BlockInfo, type MaterialRow } from "@/lib/api";
import { parseBlockName } from "@/lib/resolveBlock";
import { SlotIcon } from "@/components/BlockIcon";
import { LayerBlueprint } from "@/components/LayerBlueprint";
import { HyIcon } from "@/components/HyIcon";
import { EditBuildDialog } from "@/components/EditBuildDialog";
import { EditPhasesDialog } from "@/components/EditPhasesDialog";
import { PanelHeader, Tooltip } from "@/components/HyPanel";
import { VoxelViewerLazy } from "@/components/VoxelViewerLazy";
import { useCatalogMap } from "@/lib/useCatalog";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Menu, MenuItem } from "@/components/ui/Menu";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { openExternal } from "@/lib/openExternal";
import { errorMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";

interface AggMaterial {
  base: string;
  block: BlockInfo | undefined;
  label: string;
  qty: number;
}

/**
 * Agrega los materiales por nombre BASE de bloque (quita el prefijo `*` y el sufijo
 * `_State_Definitions_<estado>`): así un mismo bloque no sale duplicado y se resuelve
 * su icono/nombre real (los nombres con estado no están en el catálogo tal cual).
 */
function aggregateMaterials(
  materials: MaterialRow[],
  catalog: Map<string, BlockInfo>,
): AggMaterial[] {
  const map = new Map<string, AggMaterial>();
  for (const m of materials) {
    const { base } = parseBlockName(m.block_name);
    const ex = map.get(base);
    if (ex) {
      ex.qty += m.qty;
    } else {
      const block = catalog.get(base) ?? catalog.get(m.block_name);
      map.set(base, { base, block, label: block?.display_name ?? base, qty: m.qty });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
}

function MaterialList({
  materials,
  catalog,
}: {
  materials: MaterialRow[];
  catalog: Map<string, BlockInfo>;
}) {
  if (materials.length === 0) {
    return <p className="text-sm text-muted">Sin materiales registrados.</p>;
  }
  const rows = aggregateMaterials(materials, catalog);
  return (
    <ul className="space-y-2">
      {rows.map((m) => (
        <li key={m.base} className="flex items-center gap-3 text-sm">
          <Tooltip label={m.label} side="top">
            <SlotIcon
              block={
                m.block ?? { icon: null, name: m.base, display_name: null, fallback_color: null }
              }
              size={34}
            />
          </Tooltip>
          <span className="min-w-0 flex-1 truncate text-ink" title={m.label}>
            {m.label}
          </span>
          <span className="shrink-0 font-medium text-muted">×{m.qty}</span>
        </li>
      ))}
    </ul>
  );
}

/** Reescala el canvas del visor a una miniatura PNG (máx. 640px de ancho). */
function canvasToThumbnail(source: HTMLCanvasElement, maxW = 640): string {
  const scale = Math.min(1, maxW / source.width);
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return source.toDataURL("image/png");
  ctx.drawImage(source, 0, 0, w, h);
  return out.toDataURL("image/png");
}

/** Copia la lista de materiales al portapapeles como texto plano (para una nota/segunda pantalla). */
function CopyMaterialsButton({
  materials,
  catalog,
}: {
  materials: MaterialRow[];
  catalog: Map<string, BlockInfo>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = aggregateMaterials(materials, catalog)
      .map((m) => `- ${m.label} ×${m.qty}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      toast("No se pudo copiar al portapapeles", "error");
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={copy} className="mt-4 w-full justify-center">
      <HyIcon name={copied ? "check" : "bench"} size={14} />
      {copied ? "Copiada" : "Copiar lista"}
    </Button>
  );
}

/** Plano por capas (vista cenital con iconos nativos), reusa los voxels ya cargados. */
function BlueprintSection({ buildId, catalog }: { buildId: number; catalog: Map<string, BlockInfo> }) {
  const { data: model } = useQuery({
    queryKey: ["voxels", buildId],
    queryFn: () => api.getBuildVoxels(buildId),
  });
  if (!model) return null;
  return (
    <Card className="overflow-hidden">
      <PanelHeader>Plano por capas</PanelHeader>
      <CardContent>
        <LayerBlueprint model={model} catalog={catalog} />
      </CardContent>
    </Card>
  );
}

function Viewer3D({ buildId, catalog }: { buildId: number; catalog: Map<string, BlockInfo> }) {
  const qc = useQueryClient();
  const { data: model, isLoading, error } = useQuery({
    queryKey: ["voxels", buildId],
    queryFn: () => api.getBuildVoxels(buildId),
  });
  const [phase, setPhase] = useState(0);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (model) setPhase(model.phases - 1);
  }, [model]);

  const capture = useMutation({
    mutationFn: async () => {
      const canvas = viewerRef.current?.querySelector("canvas");
      if (!canvas) throw new Error("El visor aún no está listo");
      const dataUrl = canvasToThumbnail(canvas);
      await api.setThumbnail(buildId, dataUrl);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["build", buildId] });
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      toast("Miniatura guardada", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (isLoading) return <Skeleton className="h-[clamp(300px,46vh,560px)] w-full rounded-[var(--radius)]" />;
  if (error)
    return (
      <Card className="overflow-hidden">
        <CardContent>
          <p className="text-sm text-danger">No se pudo cargar el modelo 3D: {errorMessage(error)}</p>
        </CardContent>
      </Card>
    );
  if (!model) return null;

  return (
    <Card className="overflow-hidden">
      <div ref={viewerRef} className="h-[clamp(300px,46vh,560px)] w-full">
        <VoxelViewerLazy
          model={model}
          catalog={catalog}
          visibleUpToPhase={phase}
          cameraKey={`build-${buildId}`}
        />
      </div>
      <CardContent className="border-t border-line">
        <div className="mb-2 flex items-center justify-between gap-2 text-sm text-ink">
          <span className="flex items-center gap-2">
            <HyIcon name="roofs" size={18} />
            Mostrando hasta la fase {phase + 1} de {model.phases}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => capture.mutate()}
            disabled={capture.isPending}
            title="Captura la vista actual como miniatura de la build"
          >
            <HyIcon name="favorites" size={14} />
            {capture.isPending ? "Guardando…" : capture.isSuccess ? "Miniatura guardada" : "Usar como miniatura"}
          </Button>
        </div>
        <input
          type="range"
          min={0}
          max={model.phases - 1}
          value={phase}
          aria-label="Fase visible en el visor 3D"
          aria-valuetext={`Fase ${phase + 1} de ${model.phases}`}
          onChange={(e) => setPhase(Number(e.target.value))}
          className="w-full accent-[var(--color-accent)] rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        />
        <p className="mt-2 text-xs text-muted">
          Arrastra para ver cómo se construye fase a fase. Gira con el ratón.
        </p>
      </CardContent>
    </Card>
  );
}

export function BuildDetail() {
  const { id } = useParams();
  const buildId = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const catalog = useCatalogMap();

  const { data, isLoading, error } = useQuery({
    queryKey: ["build", buildId],
    queryFn: () => api.getBuildDetail(buildId),
    enabled: Number.isFinite(buildId),
  });

  const fav = useMutation({
    mutationFn: () => api.toggleFavorite(buildId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["build", buildId] });
      // La página Favoritos lee build_summaries y filtra is_favorite → hay que invalidarla
      // para que el cambio se refleje allí (antes invalidaba una clave que nadie consultaba).
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const [editing, setEditing] = useState(false);
  const [editingPhases, setEditingPhases] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const del = useMutation({
    mutationFn: () => api.deleteBuild(buildId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      navigate("/");
    },
  });
  const exportBuild = useMutation({
    mutationFn: async () => {
      const path = await save({
        defaultPath: `${data?.build.slug ?? "build"}.voxelfold`,
        filters: [{ name: "Guía Voxelfold", extensions: ["voxelfold", "json"] }],
      });
      if (!path) return false;
      await api.exportBuild(buildId, path);
      return true;
    },
    onSuccess: (ok) => {
      if (ok) toast("Build exportada", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  if (isLoading)
    return (
      <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
        <Skeleton className="mb-4 h-4 w-24" />
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
          <Skeleton className="h-11 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-[clamp(300px,46vh,560px)] w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  if (error || !data)
    return (
      <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-2 text-sm text-muted hover:text-ink">
          <HyIcon name="back" size={16} /> Volver
        </Link>
        <p className="text-muted">No se encontró esta build.</p>
      </div>
    );

  const { build, phases, materials, is_favorite } = data;
  const hasVoxels = Boolean(build.voxel_model_ref);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-8 py-8">
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-2 rounded text-sm text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <HyIcon name="back" size={16} /> Biblioteca
      </Link>

      <PageHeader
        title={<span className="break-words">{build.name}</span>}
        subtitle={build.description ? <span className="break-words">{build.description}</span> : undefined}
        actions={
          <>
            {phases.length > 0 && (
              <ButtonLink to={`/build/${buildId}/guide`} variant="primary" size="lg">
                <HyIcon name="build" size={20} />
                Empezar guía
              </ButtonLink>
            )}
            <ButtonLink
              to={`/build/${buildId}/editor`}
              variant="secondary"
              title="Editor visual de voxels (construye o modifica el modelo 3D)"
            >
              <HyIcon name="blocks" size={18} />
              Editor 3D
            </ButtonLink>
            <Button
              variant={is_favorite ? "primary" : "secondary"}
              onClick={() => fav.mutate()}
              disabled={fav.isPending}
              title={is_favorite ? "Quitar de favoritos" : "Guardar en favoritos"}
            >
              <HyIcon name="favorites" size={18} />
              {is_favorite ? "Guardada" : "Guardar"}
            </Button>
            <Menu label="Más" icon="settings">
              <MenuItem icon="settings" onClick={() => setEditing(true)}>
                Editar datos
              </MenuItem>
              <MenuItem
                icon="bench"
                onClick={() => exportBuild.mutate()}
                disabled={exportBuild.isPending}
              >
                {exportBuild.isPending ? "Exportando…" : "Exportar .voxelfold"}
              </MenuItem>
              <MenuItem icon="close" danger onClick={() => setConfirmDelete(true)}>
                Borrar build
              </MenuItem>
            </Menu>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap gap-1.5">
          {build.difficulty && <Badge variant="gold">{build.difficulty}</Badge>}
          {build.estimated_time_min > 0 && (
            <Badge variant="accent">{build.estimated_time_min} min</Badge>
          )}
          {build.block_count > 0 && <Badge>{build.block_count} bloques</Badge>}
        </div>
        {(build.category || build.style) && (
          <p className="mt-1.5 text-xs text-muted">
            {[build.category, build.style].filter(Boolean).join(" · ")}
          </p>
        )}
        {build.author_name && (
          <p className="mt-2 text-xs text-muted">
            Por{" "}
            {build.author_url ? (
              <button
                onClick={() => openExternal(build.author_url!)}
                className="rounded text-accent-hi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                {build.author_name}
              </button>
            ) : (
              <span className="text-ink">{build.author_name}</span>
            )}
            {build.source_url && build.source_url.startsWith("http") && (
              <>
                {" · "}
                <button
                  onClick={() => openExternal(build.source_url!)}
                  className="rounded text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                >
                  fuente original
                </button>
              </>
            )}
            {build.license_note && build.license_note.includes("Licencia") && (
              <span className="text-muted">
                {" · "}
                {build.license_note.split("·").find((s) => s.includes("Licencia"))?.trim()}
              </span>
            )}
          </p>
        )}
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {hasVoxels && <Viewer3D buildId={buildId} catalog={catalog} />}
          {hasVoxels && <BlueprintSection buildId={buildId} catalog={catalog} />}

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-ink">Fases ({phases.length})</h2>
              {phases.length > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setEditingPhases(true)}>
                  <HyIcon name="settings" size={14} /> Editar fases
                </Button>
              )}
            </div>
            {phases.length === 0 && (
              <div className="rounded-[var(--radius)] border border-dashed border-line py-10 text-center">
                <HyIcon name="build" size={36} className="mx-auto mb-3 opacity-80" />
                <p className="mb-4 text-sm text-muted">
                  Esta build aún no tiene fases definidas. Añádelas para montar una guía paso a paso.
                </p>
                <Button variant="secondary" size="sm" onClick={() => setEditingPhases(true)}>
                  <HyIcon name="settings" size={14} /> Añadir fases
                </Button>
              </div>
            )}
            {phases.map((ph, i) => (
              <Card key={ph.id}>
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base text-ink">
                      {ph.name.startsWith("Fase ") ? `Fase ${i + 1}` : `Fase ${i + 1} · ${ph.name}`}
                    </h3>
                    {ph.description && <p className="mt-0.5 text-sm text-muted">{ph.description}</p>}
                  </div>
                  <Badge className="shrink-0">
                    {ph.steps.length} {ph.steps.length === 1 ? "paso" : "pasos"}
                  </Badge>
                </CardContent>
              </Card>
            ))}
            {phases.length > 0 && (
              <p className="text-xs text-muted">
                Pulsa <span className="text-ink">Empezar guía</span> para construirla paso a paso.
              </p>
            )}
          </div>
        </div>

        <aside>
          <Card className="overflow-hidden">
            <PanelHeader>Materiales totales</PanelHeader>
            <CardContent>
              <MaterialList materials={materials} catalog={catalog} />
              {materials.length > 0 && (
                <CopyMaterialsButton materials={materials} catalog={catalog} />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {editing && <EditBuildDialog build={build} onClose={() => setEditing(false)} />}
      {editingPhases && (
        <EditPhasesDialog buildId={buildId} onClose={() => setEditingPhases(false)} />
      )}
      {confirmDelete && (
        <Modal
          onClose={() => setConfirmDelete(false)}
          label="Confirmar borrado"
          role="alertdialog"
          maxW="max-w-md"
        >
          <h3 className="mb-2 text-xl">¿Borrar esta build?</h3>
          <p className="mb-5 text-sm text-muted">
            Se eliminará «{build.name}» con todas sus fases, pasos, materiales y progreso. Esta
            acción no se puede deshacer.
          </p>
          {del.error && <p className="mb-3 text-sm text-danger">{errorMessage(del.error)}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => del.mutate()} disabled={del.isPending}>
              {del.isPending ? "Borrando…" : "Sí, borrar"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
