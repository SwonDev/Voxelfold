import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { api, type CfPrefab } from "@/lib/api";
import { HyIcon } from "@/components/HyIcon";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { errorMessage } from "@/lib/errorMessage";

type ImportSource = "hytale" | "disk" | "community";

export function Import() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [source, setSource] = useState<ImportSource>("hytale");
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [cfAuthor, setCfAuthor] = useState("");
  const [cfUrl, setCfUrl] = useState("");

  // Antirrebote: una sola consulta a Tauri tras dejar de teclear (no una por tecla).
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const prefabs = useQuery({
    queryKey: ["hytale_prefabs", qDebounced],
    queryFn: () => api.listHytalePrefabs(qDebounced),
  });

  const imp = useMutation({
    mutationFn: (entry: string) => api.importHytalePrefab(entry),
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      if (Number.isFinite(id) && id > 0) navigate(`/build/${id}`);
    },
  });

  const impFile = useMutation({
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

  const impFolder = useMutation({
    mutationFn: async () => {
      const dir = await open({ directory: true, multiple: false, title: "Carpeta con .prefab.json" });
      if (!dir || typeof dir !== "string") return null;
      return api.importPrefabFolder(dir);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["build_summaries"] }),
  });

  // Comunidad (CurseForge / BuiltByBit): .zip descargado o .prefab.json, con crédito al autor.
  const impArchive = useMutation({
    mutationFn: async () => {
      const path = await open({
        multiple: false,
        title: "Prefab de la comunidad (.zip o .prefab.json)",
        filters: [{ name: "Prefab de la comunidad", extensions: ["zip", "json"] }],
      });
      if (!path || typeof path !== "string") return null;
      return api.importPrefabArchive(path, cfAuthor, cfUrl);
    },
    onSuccess: (ids) => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      if (ids && ids.length === 1) navigate(`/build/${ids[0]}`);
    },
  });

  // CurseForge vía API (requiere clave propia en Ajustes): búsqueda + descarga + URL.
  const cfKeyQ = useQuery({ queryKey: ["cf_key_status"], queryFn: api.curseforgeKeyStatus });
  const hasCfKey = cfKeyQ.data === true;
  const [cfSearch, setCfSearch] = useState("");
  const [cfSearchDebounced, setCfSearchDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setCfSearchDebounced(cfSearch), 350);
    return () => clearTimeout(t);
  }, [cfSearch]);
  const cfResults = useQuery({
    queryKey: ["cf_search", cfSearchDebounced],
    queryFn: () => api.curseforgeSearch(cfSearchDebounced),
    enabled: hasCfKey && cfSearchDebounced.trim().length > 0,
  });
  const onImportIds = (ids: number[] | null) => {
    qc.invalidateQueries({ queryKey: ["build_summaries"] });
    if (ids && ids.length === 1) navigate(`/build/${ids[0]}`);
  };
  const cfImport = useMutation({
    mutationFn: (p: CfPrefab) => api.curseforgeImport(p),
    onSuccess: onImportIds,
  });
  const [cfUrlInput, setCfUrlInput] = useState("");
  const cfUrlImport = useMutation({
    mutationFn: () => api.curseforgeImportUrl(cfUrlInput),
    onSuccess: onImportIds,
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <PageHeader
        title="Importar de Hytale"
        subtitle="Convierte cualquier prefab en una guía construible por fases. Elige la fuente:"
      />

      <SegmentedControl
        className="mb-6"
        label="Fuente de importación"
        value={source}
        onChange={setSource}
        segments={[
          { value: "hytale", label: "Tu instalación", icon: "home" },
          { value: "disk", label: "Desde el disco", icon: "build" },
          { value: "community", label: "Comunidad", icon: "community" },
        ]}
      />

      {/* ── Tu instalación de Hytale ── */}
      {source === "hytale" && (
        <section>
          <p className="mb-4 max-w-2xl text-sm text-muted">
            Busca entre los prefabs que ya trae tu Hytale y conviértelos en una guía con un clic.
          </p>
          <SearchInput
            className="mb-5 max-w-md"
            label="Buscar prefab en tu instalación de Hytale"
            value={q}
            onChange={setQ}
            placeholder="Buscar prefab… (p. ej. House, Tower, Tavern)"
          />

          {imp.isPending && <p className="mb-3 text-sm text-accent-hi">Importando prefab…</p>}
          {imp.error && <p className="mb-3 text-sm text-danger">{errorMessage(imp.error)}</p>}

          {prefabs.isLoading ? (
            <p className="text-muted">Leyendo prefabs de tu Hytale…</p>
          ) : prefabs.error ? (
            <p className="text-danger">{errorMessage(prefabs.error)}</p>
          ) : (prefabs.data?.length ?? 0) === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              {qDebounced.trim()
                ? "No se encontraron prefabs en tu instalación de Hytale con esa búsqueda."
                : "Tu instalación de Hytale no tiene prefabs disponibles. Comprueba que el juego está instalado."}
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">
                {prefabs.data?.length ?? 0} prefabs
                {(prefabs.data?.length ?? 0) >= 300 ? " (afina la búsqueda para ver más)" : ""}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {prefabs.data?.map((p) => (
                  <button
                    key={p.entry}
                    onClick={() => imp.mutate(p.entry)}
                    disabled={imp.isPending}
                    title={p.entry}
                    className="flex items-center justify-between gap-2 rounded-[var(--radius)] border border-line bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{p.name}</span>
                    <HyIcon name="build" size={16} />
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── Desde el disco (archivo suelto o carpeta entera) ── */}
      {source === "disk" && (
        <section className="max-w-2xl">
          <p className="mb-4 text-sm text-muted">
            Importa un <code>.prefab.json</code> propio o toda una carpeta de prefabs (recursivo,
            hasta 500).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => impFile.mutate()} disabled={impFile.isPending}>
              <HyIcon name="build" size={16} />
              {impFile.isPending ? "Importando…" : "Importar archivo .prefab.json"}
            </Button>
            <Button variant="secondary" onClick={() => impFolder.mutate()} disabled={impFolder.isPending}>
              <HyIcon name="library" size={16} />
              {impFolder.isPending ? "Importando carpeta…" : "Importar carpeta de prefabs"}
            </Button>
            {impFolder.isSuccess && impFolder.data !== null && (
              <span className="text-sm text-accent-hi">Añadidas {impFolder.data} builds</span>
            )}
          </div>
          {(impFile.error || impFolder.error) && (
            <p className="mt-2 text-sm text-danger">{errorMessage(impFile.error ?? impFolder.error)}</p>
          )}
        </section>
      )}

      {/* ── Comunidad (CurseForge / BuiltByBit) ── */}
      {source === "community" && (
        <section className="max-w-2xl">
          <p className="mb-4 text-sm text-muted">
            Prefabs de <span className="text-accent-hi">curseforge.com/hytale</span> o BuiltByBit. Un{" "}
            <code>.zip</code> con varias construcciones las importa todas. Siempre se acredita al autor.
          </p>

          {hasCfKey ? (
            <>
              {/* Buscador integrado (vía API, clave en Ajustes) */}
              <SearchInput
                className="mb-3"
                label="Buscar en CurseForge"
                value={cfSearch}
                onChange={setCfSearch}
                placeholder="Buscar en CurseForge… (p. ej. tavern, wizard tower)"
              />
              {cfResults.isFetching && <p className="mb-2 text-sm text-accent-hi">Buscando…</p>}
              {cfResults.error && <p className="mb-2 text-sm text-danger">{errorMessage(cfResults.error)}</p>}
              {cfImport.error && <p className="mb-2 text-sm text-danger">{errorMessage(cfImport.error)}</p>}
              {cfResults.data && cfResults.data.length > 0 && (
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {cfResults.data.map((p) => (
                    <div
                      key={p.mod_id}
                      className="flex items-center gap-3 rounded-[var(--radius)] border border-line bg-surface-2 p-2"
                    >
                      {p.logo_url && (
                        <img src={p.logo_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{p.name}</p>
                        <p className="truncate text-xs text-muted">
                          por {p.author} · {p.downloads.toLocaleString()} descargas
                        </p>
                      </div>
                      {p.download_url ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => cfImport.mutate(p)}
                          disabled={cfImport.isPending}
                        >
                          <HyIcon name="build" size={14} /> Importar
                        </Button>
                      ) : (
                        <a
                          href={p.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-xs text-accent-hi underline"
                        >
                          Abrir en CurseForge
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Pegar URL del prefab */}
              <div className="mb-2 flex flex-wrap gap-2">
                <input
                  aria-label="URL del prefab en CurseForge"
                  value={cfUrlInput}
                  onChange={(e) => setCfUrlInput(e.target.value)}
                  placeholder="…o pega la URL del prefab en CurseForge"
                  className="min-w-[220px] flex-1 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                />
                <Button
                  variant="secondary"
                  onClick={() => cfUrlImport.mutate()}
                  disabled={cfUrlImport.isPending || !cfUrlInput.trim()}
                >
                  <HyIcon name="build" size={14} />
                  {cfUrlImport.isPending ? "Importando…" : "Importar de URL"}
                </Button>
              </div>
              {cfUrlImport.error && <p className="mb-2 text-sm text-danger">{errorMessage(cfUrlImport.error)}</p>}
            </>
          ) : (
            <p className="mb-4 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-xs text-muted">
              Añade tu clave gratuita de CurseForge en{" "}
              <span className="text-accent-hi">Ajustes</span> para buscar y descargar prefabs dentro
              de la app. Mientras tanto, importa abajo un <code>.zip</code> ya descargado.
            </p>
          )}

          <details open={!hasCfKey} className="group mt-4 border-t border-line pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm text-accent-hi marker:content-none">
              …o importa un <code>.zip</code> que ya tengas descargado
              <HyIcon name="forward" size={11} className="rotate-90 opacity-70 transition-transform group-open:-rotate-90" />
            </summary>
            <p className="mb-3 mt-2 text-xs text-muted">
              Indica el autor y la URL para conservar el crédito (opcional pero recomendado).
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                aria-label="Autor del prefab (para dar crédito)"
                value={cfAuthor}
                onChange={(e) => setCfAuthor(e.target.value)}
                placeholder="Autor (p. ej. HytinyBuilds)"
                className="min-w-[180px] flex-1 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
              <input
                aria-label="URL del prefab (para dar crédito)"
                value={cfUrl}
                onChange={(e) => setCfUrl(e.target.value)}
                placeholder="URL del prefab (para dar crédito)"
                className="min-w-[180px] flex-[2] rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => impArchive.mutate()} disabled={impArchive.isPending}>
                <HyIcon name="library" size={16} />
                {impArchive.isPending ? "Importando…" : "Importar .zip o .prefab.json"}
              </Button>
              {impArchive.isSuccess && impArchive.data && impArchive.data.length > 1 && (
                <span className="text-sm text-accent-hi">Añadidas {impArchive.data.length} construcciones</span>
              )}
            </div>
            {impArchive.error && <p className="mt-2 text-sm text-danger">{errorMessage(impArchive.error)}</p>}
          </details>
        </section>
      )}
    </div>
  );
}
