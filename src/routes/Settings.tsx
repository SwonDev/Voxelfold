import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { api, requestHytaleRefresh } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { HyIcon } from "@/components/HyIcon";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { PanelHeader } from "@/components/HyPanel";
import { errorMessage } from "@/lib/errorMessage";
import { toast } from "@/lib/toast";
import { getCurrentAppVersion, requestAppUpdateCheck } from "@/lib/appUpdater";

export function Settings() {
  const qc = useQueryClient();
  const install = useQuery({ queryKey: ["install_status"], queryFn: api.getInstallStatus });
  const ready = useQuery({ queryKey: ["hytale_ready"], queryFn: api.hytaleReady });
  const appVersion = useQuery({ queryKey: ["app_version"], queryFn: getCurrentAppVersion });

  const compatibility = useQuery({
    queryKey: ["asset_compatibility"],
    queryFn: api.getAssetCompatibility,
    enabled: ready.data === true,
  });
  const cfKey = useQuery({ queryKey: ["cf_key_status"], queryFn: api.curseforgeKeyStatus });
  const [cfInput, setCfInput] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const saveCfKey = useMutation({
    mutationFn: () => api.curseforgeSetKey(cfInput),
    onSuccess: () => {
      setCfInput("");
      qc.invalidateQueries({ queryKey: ["cf_key_status"] });
      toast("Clave guardada de forma segura", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  const locales = useQuery({ queryKey: ["catalog_locales"], queryFn: api.getCatalogLocaleInfo });
  const setLocale = useMutation({
    mutationFn: (l: string) => api.setCatalogLocale(l),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalog_locales"] });
      qc.invalidateQueries({ queryKey: ["catalog"] });
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });
  const localeLabel = (l: string) =>
    ({
      "en-US": "Inglés (en-US)",
      "pt-BR": "Portugués (pt-BR)",
      "ru-RU": "Ruso (ru-RU)",
      "uk-UA": "Ucraniano (uk-UA)",
      "zh-CN": "Chino simplificado (zh-CN)",
    })[l] ?? l;

  const refresh = () => {
    requestHytaleRefresh();
    qc.invalidateQueries({ queryKey: ["hytale_ready"] });
    qc.invalidateQueries({ queryKey: ["install_status"] });
    qc.invalidateQueries({ queryKey: ["catalog"] });
    qc.invalidateQueries({ queryKey: ["asset_compatibility"] });
  };

  const pick = useMutation({
    mutationFn: async () => {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Carpeta de Hytale (…/game/latest)",
      });
      if (!dir || typeof dir !== "string") throw new Error("Selección cancelada");
      return api.setInstallPath(dir);
    },
    onSuccess: refresh,
  });
  const redetect = useMutation({ mutationFn: api.retryLocate, onSuccess: refresh });
  const seed = useMutation({
    mutationFn: api.seedCuratedLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["build_summaries"] }),
  });
  const reset = useMutation({
    mutationFn: api.resetLibraryToStarters,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["build_summaries"] });
      setConfirmReset(false);
      toast("Biblioteca recargada con los presets", "success");
    },
    onError: (e) => toast(errorMessage(e), "error"),
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">
      <PageHeader title="Ajustes" subtitle="Conexión con Hytale, biblioteca, comunidad e idioma." />

      <Card className="overflow-hidden">
        <PanelHeader>Instalación de Hytale</PanelHeader>
        <CardContent>
          <p className="mb-3 text-sm">
            {ready.isLoading ? (
              <span className="text-muted">Comprobando…</span>
            ) : ready.data ? (
              <span className="text-muted">
                <span className="text-accent-hi">●</span> Hytale conectado. Los iconos y texturas se
                leen de tu instalación local.
              </span>
            ) : (
              <span className="text-muted">
                <span className="text-gold">●</span> Hytale no detectado. Selecciona la carpeta
                manualmente.
              </span>
            )}
          </p>
          {install.data && (
            <p className="mb-4 break-all text-xs text-muted">
              <code>{install.data.root}</code>
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => pick.mutate()} disabled={pick.isPending}>
              <HyIcon name="search" size={18} /> Cambiar carpeta
            </Button>
            <Button
              variant="secondary"
              onClick={() => redetect.mutate()}
              disabled={redetect.isPending}
            >
              <HyIcon name="settings" size={16} /> Detectar de nuevo
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>Compatibilidad de assets</PanelHeader>
        <CardContent aria-live="polite">
          {!ready.data ? (
            <p className="text-sm text-muted">Conecta Hytale para analizar su catálogo.</p>
          ) : compatibility.isLoading ? (
            <p className="text-sm text-muted">Analizando definiciones y modelos…</p>
          ) : compatibility.error ? (
            <div>
              <p className="text-sm text-danger">{errorMessage(compatibility.error)}</p>
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => compatibility.refetch()}
              >
                Volver a comprobar
              </Button>
            </div>
          ) : compatibility.data ? (
            <>
              <p className="text-sm text-muted">
                <span
                  className={
                    compatibility.data.parse_failures + compatibility.data.read_failures === 0
                      ? "text-accent-hi"
                      : "text-danger"
                  }
                >
                  ●
                </span>{" "}
                {compatibility.data.parse_failures + compatibility.data.read_failures === 0
                  ? "Catálogo compatible con el schema actual."
                  : "Se han detectado definiciones que Voxelfold no pudo procesar."}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  ["Bloques", compatibility.data.block_definitions],
                  ["Modelos", compatibility.data.model_definitions],
                  ["Multicelda", compatibility.data.multi_cell_block_definitions],
                  ["Prefabs", compatibility.data.prefab_definitions],
                  [
                    "Errores",
                    compatibility.data.parse_failures + compatibility.data.read_failures,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[var(--radius)] border border-line bg-surface p-3">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-1 font-mono text-lg text-ink">
                      {Number(value).toLocaleString("es-ES")}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 break-all text-xs text-muted">
                {compatibility.data.item_definitions.toLocaleString("es-ES")} definiciones ·{" "}
                {(compatibility.data.size_bytes / 1024 ** 3).toLocaleString("es-ES", {
                  maximumFractionDigits: 2,
                })}{" "}
                GB
                {compatibility.data.modified_unix_seconds
                  ? ` · actualizado ${new Date(
                      compatibility.data.modified_unix_seconds * 1000,
                    ).toLocaleDateString("es-ES")}`
                  : ""}
                {` · revisión de assets ${compatibility.data.generation}`}
              </p>
              <p className="mt-2 text-xs text-muted">
                {compatibility.data.auto_detected
                  ? "Sincronización automática activa: se reescanean canales y versiones al abrir, cada cinco minutos y al recuperar el foco."
                  : "Ruta manual activa: se detectan automáticamente los reemplazos de su archivo de assets."}
              </p>
              {compatibility.data.issues.length > 0 && (
                <details className="mt-3 rounded-[var(--radius)] border border-danger/40 bg-danger/5 p-3">
                  <summary className="cursor-pointer text-sm text-danger">
                    Ver definiciones incompatibles
                  </summary>
                  <ul className="mt-2 space-y-2 text-xs text-muted">
                    {compatibility.data.issues.map((issue) => (
                      <li key={`${issue.kind}:${issue.path}`}>
                        <code className="break-all text-ink">{issue.path}</code>
                        <span className="block break-all">{issue.error}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => compatibility.refetch()}
                disabled={compatibility.isFetching}
              >
                <HyIcon name="settings" size={16} />
                {compatibility.isFetching ? "Comprobando…" : "Volver a comprobar"}
              </Button>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>Biblioteca</PanelHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Carga la colección de casas reales de tu Hytale, listas para montar paso a paso.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => seed.mutate()} disabled={seed.isPending || reset.isPending}>
              <HyIcon name="library" size={18} />
              {seed.isPending
                ? "Cargando…"
                : seed.isSuccess
                  ? `Añadidas ${seed.data} builds`
                  : "Cargar presets"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmReset(true)}
              disabled={reset.isPending || seed.isPending}
            >
              <HyIcon name="settings" size={16} />
              {reset.isPending
                ? "Vaciando…"
                : reset.isSuccess
                  ? `Biblioteca limpia (${reset.data})`
                  : "Vaciar y recargar"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted">
            ¿Ves builds raras de versiones antiguas? Usa <strong>Vaciar y recargar</strong> para dejar
            solo los presets reales.
          </p>
          {(seed.error || reset.error) && (
            <p className="mt-3 text-sm text-danger">{errorMessage(seed.error ?? reset.error)}</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>CurseForge (prefabs de la comunidad)</PanelHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Para buscar y descargar prefabs de la comunidad dentro de la app, pega tu clave gratuita
            de la API de CurseForge. Se obtiene en{" "}
            <code className="text-accent-hi">console.curseforge.com</code> y se guarda solo en tu
            equipo, protegida por el llavero del sistema. Voxelfold nunca vuelve a mostrarla en la
            interfaz. Sin clave puedes seguir importando el{" "}
            <code className="text-accent-hi">.zip</code> descargado desde la pantalla Importar.
          </p>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveCfKey.mutate();
            }}
          >
            <input
              type="password"
              aria-label="Clave de la API de CurseForge"
              value={cfInput}
              onChange={(e) => setCfInput(e.target.value)}
              placeholder={cfKey.data ? "Nueva clave (deja en blanco para eliminar)" : "Clave de la API de CurseForge"}
              className="min-w-[260px] flex-1 rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            />
            <Button type="submit" disabled={saveCfKey.isPending}>
              <HyIcon name="settings" size={16} />
              {saveCfKey.isPending ? "Guardando…" : "Guardar clave"}
            </Button>
          </form>
          {cfKey.data === true ? (
            <p className="mt-2 text-xs text-accent-hi">
              <span className="text-accent-hi">●</span> Clave configurada · búsqueda integrada activa.
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted">Aún sin clave.</p>
          )}
          {saveCfKey.error && <p className="mt-2 text-sm text-danger">{errorMessage(saveCfKey.error)}</p>}
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>Idioma del catálogo</PanelHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted">
            Idioma de los nombres de bloques (se lee de los textos de tu Hytale). El español no está
            disponible en el juego; por defecto se usa inglés.
          </p>
          {locales.data && locales.data.available.length > 0 ? (
            <select
              aria-label="Idioma del catálogo de bloques"
              value={locales.data.current}
              onChange={(e) => setLocale.mutate(e.target.value)}
              disabled={setLocale.isPending}
              className="rounded-[var(--radius)] border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {locales.data.available.map((l) => (
                <option key={l} value={l}>
                  {localeLabel(l)}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-muted">Conecta tu Hytale para ver los idiomas disponibles.</p>
          )}
          {setLocale.isSuccess && (
            <p className="mt-2 text-xs text-accent-hi">Idioma actualizado.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>Actualizaciones de Voxelfold</PanelHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Versión instalada: <strong className="text-ink">{appVersion.data ?? __APP_VERSION__}</strong>
          </p>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            La aplicación comprueba una vez al día si existe una versión firmada. Nunca instala ni
            reinicia sin tu confirmación y bloquea el reinicio si hay cambios sin guardar.
          </p>
          <Button className="mt-4" variant="secondary" onClick={requestAppUpdateCheck}>
            <HyIcon name="settings" size={16} /> Buscar actualizaciones
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-4 overflow-hidden">
        <PanelHeader>Acerca de</PanelHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Voxelfold · Guías de construcción paso a paso para Hytale.
          </p>
          <p className="mt-3 text-xs text-muted">
            Herramienta no oficial. No afiliada, respaldada ni conectada con Hypixel Studios. Hytale
            y sus marcas pertenecen a Hypixel Studios.
          </p>
        </CardContent>
      </Card>

      {confirmReset && (
        <Modal onClose={() => setConfirmReset(false)} label="Vaciar y recargar la biblioteca" role="alertdialog" maxW="max-w-md">
          <h3 className="mb-2 text-xl">¿Vaciar y recargar?</h3>
          <p className="mb-5 text-sm text-muted">
            Esto borra TODAS las builds de la biblioteca (incluidas las importadas) y deja solo los
            presets reales de Hytale. No se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmReset(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => reset.mutate()} disabled={reset.isPending}>
              {reset.isPending ? "Vaciando…" : "Sí, vaciar y recargar"}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
