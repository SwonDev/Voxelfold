import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type CommunityPrefab, type CommunityRepo } from "@/lib/api";
import { HyIcon } from "@/components/HyIcon";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { openExternal } from "@/lib/openExternal";
import { errorMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function Community() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [showRepoUrl, setShowRepoUrl] = useState(false);
  const [prefabFilter, setPrefabFilter] = useState("");
  const [selected, setSelected] = useState<CommunityRepo | null>(null);
  const [importedPath, setImportedPath] = useState<string | null>(null);

  const search = useMutation({ mutationFn: (query: string) => api.searchCommunityPrefabs(query) });
  const prefabs = useMutation({
    mutationFn: (r: CommunityRepo) =>
      api.listCommunityPrefabs(r.owner, r.full_name.split("/")[1] ?? "", r.default_branch, r.license),
  });
  const importOne = useMutation({
    mutationFn: (p: CommunityPrefab) => api.importCommunityPrefab(p),
    onSuccess: (id, p) => {
      setImportedPath(p.path);
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      // Solo navega si el backend devolvió un id válido (evita una ruta /build/0 rota).
      if (Number.isFinite(id) && id > 0) navigate(`/build/${id}`);
      else toast("Importado, pero no se pudo abrir la build", "error");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const openRepo = (r: CommunityRepo) => {
    setSelected(r);
    setImportedPath(null);
    setPrefabFilter("");
    prefabs.mutate(r);
  };

  const fetchRepo = useMutation({
    mutationFn: (url: string) => api.fetchCommunityRepo(url),
    onSuccess: (r) => openRepo(r),
  });

  const runSearch = () => search.mutate(q);

  const shownPrefabs = (prefabs.data ?? []).filter((p) =>
    prefabFilter.trim()
      ? p.name.toLowerCase().includes(prefabFilter.trim().toLowerCase())
      : true,
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <PageHeader
        title="Comunidad"
        subtitle={
          <>
            Prefabs públicos de Hytale compartidos en GitHub, importables como guías. Todo es local
            y se conserva el <strong>crédito al autor</strong>, su licencia y el enlace de origen.
          </>
        }
      />

      <div className="mb-3 flex max-w-xl items-center gap-2">
        <SearchInput
          className="flex-1"
          label="Buscar prefabs de la comunidad"
          value={q}
          onChange={setQ}
          onEnter={runSearch}
          placeholder="Buscar prefabs (p. ej. castle, house, tavern)…"
        />
        <Button onClick={runSearch} disabled={search.isPending}>
          {search.isPending ? "Buscando…" : "Buscar"}
        </Button>
      </div>

      {/* Divulgación progresiva: abrir un repo concreto por URL (oculto por defecto) */}
      {showRepoUrl ? (
        <div className="mb-6 flex max-w-xl items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-[var(--radius)] border border-line bg-surface px-3 py-2">
            <HyIcon name="community" size={16} />
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label="URL del repositorio público de GitHub"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && repoUrl.trim() && fetchRepo.mutate(repoUrl)}
              placeholder="github.com/usuario/repo"
              className="w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
            />
          </div>
          <Button
            variant="secondary"
            onClick={() => fetchRepo.mutate(repoUrl)}
            disabled={fetchRepo.isPending || !repoUrl.trim()}
          >
            {fetchRepo.isPending ? "Abriendo…" : "Abrir repo"}
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setShowRepoUrl(true)}
          className="mb-6 rounded text-xs text-accent-hi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          …o abre un repositorio público concreto por su URL
        </button>
      )}

      {(search.error || fetchRepo.error) && (
        <p className="mb-4 text-sm text-danger">{errorMessage(search.error ?? fetchRepo.error)}</p>
      )}

      {!search.data && !search.isPending && !selected && (
        <div className="rounded-[var(--radius)] border border-dashed border-line p-8 text-center text-sm text-muted">
          Busca un término o pega la URL de un repositorio para empezar.
        </div>
      )}

      {search.data && search.data.length === 0 && !selected && (
        <p className="text-muted">No se encontraron repositorios. Prueba con otro término.</p>
      )}

      {((search.data && search.data.length > 0) || selected) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr]">
          {/* Repositorios encontrados */}
          <div className="space-y-3">
            {search.data && search.data.length > 0 ? (
              <>
                <h2 className="text-lg font-medium text-ink">Repositorios ({search.data.length})</h2>
                {search.data.map((r) => (
                  <Card
                    key={r.full_name}
                    className={cn(
                      "cursor-pointer transition-colors",
                      selected?.full_name === r.full_name && "ring-1 ring-accent/50",
                    )}
                  >
                    <CardContent>
                      <button onClick={() => openRepo(r)} className="w-full text-left">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <h3 className="truncate text-base text-ink">{r.full_name.split("/")[1]}</h3>
                          <span className="shrink-0 text-xs text-gold">★ {r.stars}</span>
                        </div>
                        {r.description && (
                          <p className="mb-2 line-clamp-2 text-sm text-muted">{r.description}</p>
                        )}
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          onClick={() => openExternal(r.owner_url)}
                          className="rounded text-xs text-accent-hi hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          title="Ver perfil del autor"
                        >
                          por {r.owner}
                        </button>
                        {r.license && <Badge>{r.license}</Badge>}
                        <button
                          onClick={() => openExternal(r.html_url)}
                          className="rounded text-xs text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                          title="Abrir el repositorio"
                        >
                          · ver repo
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </>
            ) : (
              <div className="rounded-[var(--radius)] border border-dashed border-line p-6 text-center text-sm text-muted">
                Repositorio abierto por URL. Busca arriba para ver más packs.
              </div>
            )}
          </div>

          {/* Prefabs del repo seleccionado */}
          <div className="space-y-3">
            {selected ? (
              <>
                <h2 className="text-lg font-medium text-ink">
                  Prefabs de {selected.full_name.split("/")[1]}
                </h2>
                {prefabs.isPending && <p className="text-sm text-muted">Cargando prefabs…</p>}
                {prefabs.error && <p className="text-sm text-danger">{errorMessage(prefabs.error)}</p>}
                {prefabs.data && prefabs.data.length === 0 && (
                  <p className="text-sm text-muted">Este repositorio no contiene .prefab.json.</p>
                )}
                {prefabs.data && prefabs.data.length > 0 && (
                  <>
                    {prefabs.data.length > 8 && (
                      <SearchInput
                        label="Filtrar prefabs"
                        value={prefabFilter}
                        onChange={setPrefabFilter}
                        placeholder={`Filtrar ${prefabs.data.length} prefabs…`}
                      />
                    )}
                    <Card>
                      <CardContent className="max-h-[55vh] space-y-1 overflow-auto">
                        {shownPrefabs.map((p) => (
                          <div
                            key={p.path}
                            className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2/60"
                          >
                            <HyIcon name="build" size={18} className="opacity-70" />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink" title={p.path}>
                              {p.name}
                            </span>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => importOne.mutate(p)}
                              disabled={importOne.isPending}
                            >
                              {importOne.isPending && importedPath === p.path
                                ? "Importando…"
                                : "Importar"}
                            </Button>
                          </div>
                        ))}
                        {shownPrefabs.length === 0 && (
                          <p className="px-2 py-3 text-sm text-muted">Ningún prefab coincide.</p>
                        )}
                      </CardContent>
                    </Card>
                  </>
                )}
                <p className="text-xs text-muted">
                  Al importar se guarda la atribución: autor <span className="text-ink">{selected.owner}</span>
                  {selected.license ? `, licencia ${selected.license}` : ""} y el enlace de origen.
                </p>
                {importOne.error && <p className="text-sm text-danger">{errorMessage(importOne.error)}</p>}
              </>
            ) : (
              <div className="rounded-[var(--radius)] border border-dashed border-line p-8 text-center text-sm text-muted">
                Selecciona un repositorio para ver sus prefabs.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
