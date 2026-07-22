import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// ---- Tipos (espejo de los structs Rust) ----

export interface HytaleInstall {
  root: string;
}

export interface CatalogDiagnostics {
  asset_entries: number;
  item_definitions: number;
  parsed_items: number;
  parse_failures: number;
  read_failures: number;
  duplicate_names: number;
  block_definitions: number;
  model_definitions: number;
  hitbox_definitions: number;
  multi_cell_block_definitions: number;
  prefab_definitions: number;
  issues: Array<{ kind: "read" | "parse"; path: string; error: string }>;
}

export interface AssetCompatibility extends CatalogDiagnostics {
  path: string;
  generation: number;
  auto_detected: boolean;
  size_bytes: number;
  modified_unix_seconds: number | null;
  modified_subsec_nanos: number | null;
  created_unix_seconds: number | null;
  created_subsec_nanos: number | null;
  device_id: number | null;
  file_id: number | null;
}

export interface HytaleRefresh {
  changed: boolean;
  generation: number;
  reason: "unchanged" | "connected" | "relocated" | "updated" | "manual";
  path: string | null;
  catalog: CatalogDiagnostics | null;
}

export interface BlockTexture {
  face: string;
  path: string;
  weight: number;
  /** Agrupa las caras que pertenecen a la misma entrada ponderada de `Textures`. */
  variant: number;
}

export interface BlockInfo {
  name: string;
  is_block: boolean;
  display_name: string | null;
  translation_key: string | null;
  icon: string | null;
  draw_type: string | null;
  group: string | null;
  fallback_color: string | null;
  categories: string[];
  textures: BlockTexture[];
  model: string | null;
  model_texture: string | null;
  /** Escala nativa del modelo (`CustomModelScale`); 1 si Hytale no la declara. */
  model_scale: number;
  /** ID del asset de colisión/colocación (`Full` por defecto). */
  hitbox_type: string;
  /** Unión de las cajas nativas; puede sobresalir de 0..1 y reservar varias celdas. */
  hitbox: { min: [number, number, number]; max: [number, number, number] } | null;
  /** Orientaciones que admite el bloque (`NESW`, `UpDownNESW`, `All`…). */
  variant_rotation: string | null;
  tint: string | null;
  states: BlockState[];
  opacity: string | null;
  light: boolean;
  /** Color de la luz emitida (`#rrggbb`), si lo declara. */
  light_color: string | null;
  /** Color NATIVO de la llama (de la partícula de fuego), si tiene fuego. */
  flame_color: string | null;
  /** Escala nativa de la llama (~0.6-0.8). */
  flame_scale: number | null;
  /** Desplazamiento vertical nativo de la llama. */
  flame_offset_y: number | null;
}

export interface BlockState {
  state: string;
  model: string;
  model_texture: string | null;
  model_scale: number;
  hitbox_type: string;
  hitbox: { min: [number, number, number]; max: [number, number, number] } | null;
  tint: string | null;
  opacity: string | null;
  light: boolean;
  flip: string | null;
}

/** Ficha companion de un bloque desde la wiki pública (hytaleguide.net). */
export interface BlockWiki {
  description: string;
  source_url: string;
  source: string;
}

/**
 * ¿Es un bloque REAL colocable (no una herramienta de desarrollo ni un marcador de
 * generación)? Filtra `[TMP]`/Test/Prototype/Debug, `Filter_*`, `Barrier`, `Empty` y
 * `ExamplePrefabPlacement*`/`Template_*` — que no son bloques que el jugador construya.
 */
export function isPlaceableBlock(b: BlockInfo): boolean {
  if (!b.is_block) return false;
  const n = b.name;
  if (/^(Filter_|ExamplePrefabPlacement|Template_)/.test(n)) return false;
  if (n === "Barrier" || n === "Empty") return false;
  if (/spawner|geyzer|objective_|placeholder|trigger/i.test(n)) return false;
  if (/(^|_)(tmp|prototype|debug)(_|$)/i.test(n) || /^test_|_test$/i.test(n) || n.includes("[TMP]")) {
    return false;
  }
  if (/TMP|Prototype|Debug|^Test_|_Test$/i.test(n)) return false;
  if (b.display_name?.includes("[TMP]")) return false;
  return true;
}

export interface Build {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  style: string;
  difficulty: string;
  estimated_time_min: number;
  block_count: number;
  mode: string;
  thumbnail_ref: string | null;
  author_name: string | null;
  author_url: string | null;
  source_url: string | null;
  license_note: string | null;
  voxel_model_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface MaterialRow {
  block_name: string;
  qty: number;
}

export interface Phase {
  id: number;
  build_id: number;
  order_index: number;
  name: string;
  description: string;
}

export interface Step {
  id: number;
  phase_id: number;
  order_index: number;
  title: string;
  instruction: string;
  preview_ref: string | null;
}

export interface PhaseWithSteps extends Phase {
  steps: Step[];
  materials: MaterialRow[];
}

export interface BuildDetail {
  build: Build;
  phases: PhaseWithSteps[];
  materials: MaterialRow[];
  is_favorite: boolean;
}

export type BuildStatus = "not_started" | "in_progress" | "completed";

export interface BuildSummary extends Build {
  top_blocks: string[];
  status: BuildStatus;
  is_favorite: boolean;
}

export interface BuildMetaUpdate {
  name: string;
  description: string;
  category: string;
  style: string;
  difficulty: string;
  mode: string;
  estimated_time_min: number;
}

export interface Progress {
  build_id: number;
  status: BuildStatus;
  current_phase_id: number | null;
}

export interface ChecklistItem {
  block_name: string;
  gathered_qty: number;
}

export interface StoredVoxel {
  x: number;
  y: number;
  z: number;
  name: string;
  rotation: number;
  phase: number;
}

export interface StoredModel {
  size: [number, number, number];
  origin: [number, number, number];
  phases: number;
  blocks: StoredVoxel[];
}

// ---- Helper de assets reales (custom protocol) ----

/** ¿Estamos dentro de la app Tauri (con el protocolo de assets) o en un navegador? */
const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let assetGeneration = 0;

/** Revisión monotónica publicada por Rust después de validar una actualización completa. */
export function setAssetGeneration(generation: number): void {
  if (Number.isSafeInteger(generation) && generation >= 0) assetGeneration = generation;
}

export function getAssetGeneration(): number {
  return assetGeneration;
}

export const HYTALE_REFRESH_EVENT = "voxelfold:hytale-refresh";

/** Solicita al supervisor global que lea y aplique la revisión publicada por Rust. */
export function requestHytaleRefresh(): void {
  window.dispatchEvent(new Event(HYTALE_REFRESH_EVENT));
}

/**
 * `invoke` real de Tauri en la app; en DESARROLLO sin Tauri (navegador/Playwright) enruta a un
 * mock de backend para poder ver y verificar la UI con datos. El branch del mock vive bajo
 * `import.meta.env.DEV`, que es `false` en producción → el dynamic import se elimina del bundle.
 */
function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (import.meta.env.DEV && !inTauri) {
    return import("./devMock").then((m) => m.mockInvoke<T>(cmd, args));
  }
  return tauriInvoke<T>(cmd, args);
}

/** URL servida por el backend desde el Assets.zip local de Hytale. En navegador
 *  (dev/test) cae a un espejo estático en `/hytale/...` para poder verificar la UI. */
export function assetUrl(entryPath: string): string {
  const base = inTauri
    ? `voxelfold-asset://localhost/${encodeURI(entryPath)}`
    : `/hytale/${encodeURI(entryPath)}`;
  return `${base}?vf_rev=${assetGeneration}`;
}

/** Lee JSON/modelos oficiales como texto. En Tauri usa IPC nativo porque WKWebView puede
 *  rechazar `fetch()` sobre protocolos personalizados aunque las texturas sí se carguen. */
export async function readTextAsset(entryPath: string): Promise<string> {
  if (inTauri) return invoke<string>("read_text_asset", { entryPath });
  const response = await fetch(assetUrl(entryPath));
  if (!response.ok) throw new Error(`No se pudo leer el asset (${response.status})`);
  return response.text();
}

/** URL del icono real de un bloque, o null si no tiene. */
export function blockIconUrl(block: Pick<BlockInfo, "icon">): string | null {
  return block.icon ? assetUrl(`Common/${block.icon}`) : null;
}

/** URL de un asset de la interfaz REAL de Hytale (Common/UI/Custom/Common/...). */
export function uiAsset(path: string): string {
  return assetUrl(`Common/UI/Custom/Common/${path}`);
}

// ---- Comandos ----

/** invoke con caché en localStorage: si la llamada falla (sin conexión), devuelve
 *  el último resultado cacheado para esa clave. Si va bien, refresca la caché. */
async function cachedInvoke<T>(
  cmd: string,
  args: Record<string, unknown>,
  key: string,
): Promise<T> {
  const storeKey = `vf_cache_${key}`;
  try {
    const res = await invoke<T>(cmd, args);
    try {
      localStorage.setItem(storeKey, JSON.stringify(res));
    } catch {
      /* cuota llena: ignorar */
    }
    return res;
  } catch (e) {
    const cached = localStorage.getItem(storeKey);
    if (cached) return JSON.parse(cached) as T;
    throw e;
  }
}

export const api = {
  getInstallStatus: () => invoke<HytaleInstall | null>("get_install_status"),
  setInstallPath: (path: string) => invoke<HytaleInstall>("set_install_path", { path }),
  hytaleReady: () => invoke<boolean>("hytale_ready"),
  retryLocate: () => invoke<boolean>("retry_locate"),
  refreshHytale: () => invoke<HytaleRefresh>("refresh_hytale"),
  getAssetCompatibility: () =>
    invoke<AssetCompatibility>("get_asset_compatibility"),
  getBlockCatalog: () => invoke<BlockInfo[]>("get_block_catalog"),
  blockWiki: (displayName: string) => invoke<BlockWiki | null>("block_wiki", { displayName }),
  getCatalogLocaleInfo: () =>
    invoke<{ current: string; available: string[] }>("get_catalog_locale_info"),
  setCatalogLocale: (locale: string) => invoke<void>("set_catalog_locale", { locale }),
  listBuilds: () => invoke<Build[]>("list_builds"),
  listBuildSummaries: () => invoke<BuildSummary[]>("list_build_summaries"),
  getBuildDetail: (id: number) => invoke<BuildDetail>("get_build_detail", { id }),
  updateBuildMeta: (buildId: number, meta: BuildMetaUpdate) =>
    invoke<void>("update_build_meta", { buildId, meta }),
  updatePhase: (phaseId: number, name: string, description: string) =>
    invoke<void>("update_phase", { phaseId, name, description }),
  updateStep: (stepId: number, title: string, instruction: string) =>
    invoke<void>("update_step", { stepId, title, instruction }),
  setThumbnail: (buildId: number, dataUrl: string) =>
    invoke<void>("set_thumbnail", { buildId, dataUrl }),
  // Editor de guías (Fase 2)
  createBuild: (meta: BuildMetaUpdate) => invoke<number>("create_build", { meta }),
  deleteBuild: (buildId: number) => invoke<void>("delete_build", { buildId }),
  addPhase: (buildId: number, name: string, description: string) =>
    invoke<number>("add_phase", { buildId, name, description }),
  deletePhase: (phaseId: number) => invoke<void>("delete_phase", { phaseId }),
  reorderPhases: (orderedIds: number[]) => invoke<void>("reorder_phases", { orderedIds }),
  addStep: (phaseId: number, title: string, instruction: string) =>
    invoke<number>("add_step", { phaseId, title, instruction }),
  deleteStep: (stepId: number) => invoke<void>("delete_step", { stepId }),
  reorderSteps: (orderedIds: number[]) => invoke<void>("reorder_steps", { orderedIds }),
  setPhaseMaterials: (phaseId: number, materials: MaterialRow[]) =>
    invoke<void>("set_phase_materials", { phaseId, materials }),
  exportBuild: (buildId: number, path: string) =>
    invoke<void>("export_build", { buildId, path }),
  importBuild: (path: string) => invoke<number>("import_build", { path }),
  toggleFavorite: (buildId: number) => invoke<boolean>("toggle_favorite", { buildId }),
  listFavorites: () => invoke<number[]>("list_favorites"),
  getProgress: (buildId: number) => invoke<Progress | null>("get_progress", { buildId }),
  setProgress: (buildId: number, status: BuildStatus, currentPhaseId: number | null) =>
    invoke<void>("set_progress", { buildId, status, currentPhaseId }),
  setStepCompleted: (buildId: number, stepId: number, completed: boolean) =>
    invoke<void>("set_step_completed", { buildId, stepId, completed }),
  getCompletedSteps: (buildId: number) => invoke<number[]>("get_completed_steps", { buildId }),
  resetProgress: (buildId: number) => invoke<void>("reset_progress", { buildId }),
  setMaterialGathered: (
    buildId: number,
    scope: string,
    blockName: string,
    gatheredQty: number,
  ) => invoke<void>("set_material_gathered", { buildId, scope, blockName, gatheredQty }),
  getChecklist: (buildId: number, scope: string) =>
    invoke<ChecklistItem[]>("get_checklist", { buildId, scope }),
  getBuildVoxels: (buildId: number) => invoke<StoredModel>("get_build_voxels", { buildId }),
  setBuildVoxels: (buildId: number, model: StoredModel) =>
    invoke<void>("set_build_voxels", { buildId, model }),
  createDemoBuild: () => invoke<number>("create_demo_build"),
  seedCuratedLibrary: () => invoke<number>("seed_curated_library"),
  resetLibraryToStarters: () => invoke<number>("reset_library_to_starters"),
  listHytalePrefabs: (query: string) =>
    invoke<HytalePrefab[]>("list_hytale_prefabs", { query }),
  importHytalePrefab: (entry: string) => invoke<number>("import_hytale_prefab", { entry }),
  importPrefabFile: (path: string) => invoke<number>("import_prefab_file", { path }),
  importPrefabFolder: (path: string) => invoke<number>("import_prefab_folder", { path }),
  /** Importa un .zip (CurseForge/BuiltByBit; varias construcciones) o .prefab.json
   *  suelto, acreditando al autor. Devuelve los IDs de las builds importadas. */
  importPrefabArchive: (path: string, author?: string, sourceUrl?: string) =>
    invoke<number[]>("import_prefab_archive", {
      path,
      author: author?.trim() || null,
      sourceUrl: sourceUrl?.trim() || null,
    }),
  // Prefabs públicos de la comunidad (búsqueda local en GitHub, con atribución).
  // Caché offline: online busca y cachea; sin conexión devuelve lo último cacheado.
  searchCommunityPrefabs: (query: string) =>
    cachedInvoke<CommunityRepo[]>("search_community_prefabs", { query }, `comm_search_${query}`),
  fetchCommunityRepo: (url: string) => invoke<CommunityRepo>("fetch_community_repo", { url }),
  listCommunityPrefabs: (owner: string, repo: string, branch: string, license: string | null) =>
    cachedInvoke<CommunityPrefab[]>(
      "list_community_prefabs",
      { owner, repo, branch, license },
      `comm_list_${owner}/${repo}@${branch}`,
    ),
  importCommunityPrefab: (prefab: CommunityPrefab) =>
    invoke<number>("import_community_prefab", { prefab }),
  // CurseForge: clave propia del usuario (Ajustes) + búsqueda/descarga con atribución.
  curseforgeKeyStatus: () => invoke<boolean>("curseforge_key_status"),
  curseforgeSetKey: (key: string) => invoke<void>("curseforge_set_key", { key }),
  curseforgeSearch: (query: string) => invoke<CfPrefab[]>("curseforge_search", { query }),
  curseforgeImport: (prefab: CfPrefab) => invoke<number[]>("curseforge_import", { prefab }),
  curseforgeImportUrl: (url: string) => invoke<number[]>("curseforge_import_url", { url }),
};

export interface HytalePrefab {
  entry: string;
  name: string;
}

export interface CommunityRepo {
  full_name: string;
  owner: string;
  owner_url: string;
  html_url: string;
  default_branch: string;
  stars: number;
  license: string | null;
  description: string | null;
}

export interface CommunityPrefab {
  name: string;
  path: string;
  repo_full_name: string;
  author: string;
  author_url: string;
  download_url: string;
  source_url: string;
  license: string | null;
}

export interface CfPrefab {
  mod_id: number;
  file_id: number;
  name: string;
  summary: string;
  author: string;
  author_url: string;
  website_url: string;
  logo_url: string | null;
  /** null si el autor desactivó la descarga por API → abrir website_url. */
  download_url: string | null;
  file_name: string;
  downloads: number;
}
