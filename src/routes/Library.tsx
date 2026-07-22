import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { BuildCard } from "@/components/BuildCard";
import { BuildGridSkeleton } from "@/components/ui/Skeleton";
import { HyIcon } from "@/components/HyIcon";
import { CreateBuildDialog } from "@/components/CreateBuildDialog";
import { useCatalogMap } from "@/lib/useCatalog";
import { errorMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";

function EmptyState() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const seed = useMutation({
    mutationFn: api.seedCuratedLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["build_summaries"] }),
  });
  const importPrefab = useMutation({
    mutationFn: async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: "Prefab de Hytale", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return null;
      return api.importPrefabFile(path);
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      if (id) navigate(`/build/${id}`);
    },
  });

  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius)] border border-dashed border-line py-20 text-center">
      <HyIcon name="build" size={48} className="mb-4 opacity-80" />
      <h3 className="mb-1 text-xl">Aún no hay builds</h3>
      <p className="mb-6 max-w-md text-sm text-muted">
        Carga la colección curada de Voxelfold (construcciones reales de tu Hytale, listas para
        montar paso a paso), crea tu propia guía desde cero o explora el catálogo de bloques.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
          <HyIcon name="recipe" size={18} />
          {seed.isPending ? "Cargando colección…" : "Cargar colección curada"}
        </Button>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <HyIcon name="build" size={18} /> Crear prefab desde cero
        </Button>
        <Button
          variant="secondary"
          onClick={() => importPrefab.mutate()}
          disabled={importPrefab.isPending}
        >
          <HyIcon name="prefab" size={18} />
          {importPrefab.isPending ? "Importando…" : "Importar prefab (.json)"}
        </Button>
      </div>
      <Link to="/blocks" className="mt-4 text-sm text-accent-hi hover:underline">
        …o explora el catálogo de bloques de Hytale
      </Link>
      {(seed.error || importPrefab.error) && (
        <p className="mt-4 text-sm text-danger">{errorMessage(seed.error ?? importPrefab.error)}</p>
      )}
      {creating && <CreateBuildDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

export function Library() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const catalog = useCatalogMap();
  const { data: builds, isLoading } = useQuery({
    queryKey: ["build_summaries"],
    queryFn: api.listBuildSummaries,
  });

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Atajo de escritorio: ⌘/Ctrl+K (o «/») enfoca la búsqueda (salvo escribiendo en un campo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const isCmdK = (e.ctrlKey || e.metaKey) && k === "k";
      const el = document.activeElement;
      const typing = el?.tagName === "INPUT" || el?.tagName === "TEXTAREA";
      const isSlash = k === "/" && !typing && !e.ctrlKey && !e.metaKey;
      if (!isCmdK && !isSlash) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const categories = useMemo(
    () =>
      [...new Set((builds ?? []).map((b) => b.category).filter((c): c is string => Boolean(c)))].sort(
        (a, b) => a.localeCompare(b, "es"),
      ),
    [builds],
  );
  const difficulties = useMemo(
    () =>
      [
        ...new Set((builds ?? []).map((b) => b.difficulty).filter((d): d is string => Boolean(d))),
      ].sort((a, b) => a.localeCompare(b, "es")),
    [builds],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (builds ?? []).filter(
      (b) =>
        (!needle || b.name.toLowerCase().includes(needle) || b.description.toLowerCase().includes(needle)) &&
        (!cat || b.category === cat) &&
        (!diff || b.difficulty === diff),
    );
  }, [builds, q, cat, diff]);

  const inProgress = useMemo(() => filtered.filter((b) => b.status === "in_progress"), [filtered]);
  const showContinue = inProgress.length > 0 && !q && !cat && !diff;
  const mainList = showContinue ? filtered.filter((b) => b.status !== "in_progress") : filtered;

  const importBuild = useMutation({
    mutationFn: async () => {
      const path = await open({
        multiple: false,
        filters: [{ name: "Guía Voxelfold", extensions: ["voxelfold", "json"] }],
      });
      if (!path || typeof path !== "string") return null;
      return api.importBuild(path);
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      if (id) navigate(`/build/${id}`);
      else toast("No se pudo importar la guía", "error");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-8 py-8">
      <PageHeader
        title="Biblioteca de builds"
        subtitle="Elige una construcción y móntala paso a paso, a tu ritmo."
        actions={
          builds && builds.length > 0 ? (
            <>
              <Button onClick={() => setCreating(true)}>
                <HyIcon name="build" size={18} /> Crear prefab
              </Button>
              <Button
                variant="secondary"
                onClick={() => importBuild.mutate()}
                disabled={importBuild.isPending}
              >
                <HyIcon name="prefab" size={18} />
                {importBuild.isPending ? "Importando…" : "Importar"}
              </Button>
            </>
          ) : undefined
        }
      >
        {builds && builds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              <span className="text-ink">{builds.length}</span> builds
            </span>
            <span>
              <span className="text-accent-hi">
                {builds.filter((b) => b.status === "completed").length}
              </span>{" "}
              completadas
            </span>
            <span>
              <span className="text-gold">
                {builds.filter((b) => b.status === "in_progress").length}
              </span>{" "}
              en progreso
            </span>
            <span>
              <span className="text-ink">{builds.filter((b) => b.is_favorite).length}</span>{" "}
              favoritas
            </span>
          </div>
        )}
      </PageHeader>

      {isLoading ? (
        <BuildGridSkeleton />
      ) : !builds || builds.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Búsqueda y filtros */}
          <div className="mb-6 space-y-3">
            <SearchInput
              className="max-w-md"
              label="Buscar builds"
              value={q}
              onChange={setQ}
              placeholder="Buscar builds…  (⌘K)"
              inputRef={searchRef}
            />
            {(categories.length > 0 || difficulties.length > 0) && (
              <div className="flex flex-wrap items-center gap-2">
                <Chip active={!cat && !diff} onClick={() => { setCat(null); setDiff(null); }}>
                  Todas
                </Chip>
                {categories.map((c) => (
                  <Chip key={c} active={cat === c} onClick={() => setCat(cat === c ? null : c)}>
                    {c}
                  </Chip>
                ))}
                {categories.length > 0 && difficulties.length > 0 && (
                  <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                )}
                {difficulties.map((d) => (
                  <Chip key={d} active={diff === d} onClick={() => setDiff(diff === d ? null : d)}>
                    {d}
                  </Chip>
                ))}
              </div>
            )}
          </div>

          {/* Continúa donde lo dejaste */}
          {showContinue && (
            <section className="mb-8">
              <h2 className="mb-3 text-lg font-medium text-ink">Continúa donde lo dejaste</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {inProgress.map((b) => (
                  <BuildCard key={b.id} build={b} catalog={catalog} />
                ))}
              </div>
            </section>
          )}

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-muted">No hay builds que coincidan con el filtro.</p>
          ) : (
            <>
              {showContinue && mainList.length > 0 && (
                <h2 className="mb-3 text-lg font-medium text-ink">Todas las builds</h2>
              )}
              <div className="hy-fade-in grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {mainList.map((b) => (
                  <BuildCard key={b.id} build={b} catalog={catalog} />
                ))}
              </div>
            </>
          )}
        </>
      )}
      {creating && <CreateBuildDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
