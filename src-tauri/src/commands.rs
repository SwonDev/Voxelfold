//! Comandos Tauri que consume el frontend. Capa fina sobre el Core.

use std::path::{Path, PathBuf};
use std::{fs::File, io::Read};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::assets::{AssetReader, CatalogDiagnostics, DEFAULT_LOCALE};
use crate::core::catalog::{BlockCatalog, BlockInfo};
use crate::core::curation;
use crate::core::db::models::{
    Build, BuildStatus, ChecklistItem, MaterialRow, NewBuild, NewPhase, NewStep, Phase, Progress,
    Step,
};
use crate::core::db::repo;
use crate::core::locator::{self, HytaleInstall};
use crate::core::multicell;
use crate::core::portable;
use crate::core::prefab::is_generation_marker;
use crate::core::seed;
use crate::core::voxel_store::{self, StoredModel};
use crate::state::{asset_fingerprint, AppState, AssetFingerprint};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const MAX_IMPORT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ARCHIVE_EXPANDED_BYTES: u64 = 128 * 1024 * 1024;
const MAX_PREFABS_PER_ARCHIVE: usize = 500;
const MAX_TEXT_ASSET_BYTES: usize = 16 * 1024 * 1024;

fn read_file_limited(path: &Path, max: u64) -> CmdResult<Vec<u8>> {
    let file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > max {
        return Err(format!(
            "El archivo supera el límite de {} MiB",
            max / 1024 / 1024
        ));
    }
    let mut bytes = Vec::new();
    file.take(max + 1).read_to_end(&mut bytes).map_err(err)?;
    if bytes.len() as u64 > max {
        return Err(format!(
            "El archivo supera el límite de {} MiB",
            max / 1024 / 1024
        ));
    }
    Ok(bytes)
}

fn read_text_file_limited(path: &Path, max: u64) -> CmdResult<String> {
    String::from_utf8(read_file_limited(path, max)?)
        .map_err(|_| "El archivo no contiene texto UTF-8 válido".to_string())
}

fn validate_text(value: &str, label: &str, max: usize, required: bool) -> CmdResult<()> {
    if required && value.trim().is_empty() {
        return Err(format!("{label} no puede estar vacío"));
    }
    if value.len() > max || value.chars().any(|c| c == '\0') {
        return Err(format!("{label} no es válido"));
    }
    Ok(())
}

fn validate_build_meta(meta: &BuildMetaUpdate) -> CmdResult<()> {
    validate_text(&meta.name, "El nombre", 256, true)?;
    validate_text(&meta.description, "La descripción", 100_000, false)?;
    validate_text(&meta.category, "La categoría", 128, false)?;
    validate_text(&meta.style, "El estilo", 128, false)?;
    if !["Fácil", "Media", "Difícil", "Experto"].contains(&meta.difficulty.as_str()) {
        return Err("La dificultad no es válida".into());
    }
    if !["both", "survival", "creative"].contains(&meta.mode.as_str()) {
        return Err("El modo de juego no es válido".into());
    }
    if !(0..=5_256_000).contains(&meta.estimated_time_min) {
        return Err("El tiempo estimado no es válido".into());
    }
    Ok(())
}

fn validate_text_asset_entry(entry: &str) -> CmdResult<()> {
    let valid_root = entry.starts_with("Common/");
    let valid_extension = entry.ends_with(".blockymodel") || entry.ends_with(".json");
    let unsafe_path = entry.contains("..") || entry.contains('\\') || entry.contains('\0');
    if !valid_root || !valid_extension || unsafe_path {
        return Err("La ruta del asset de texto no es válida".to_string());
    }
    Ok(())
}

// ---- Instalación de Hytale ----

/// Detecta automáticamente la instalación de Hytale.
#[tauri::command]
pub fn get_install_status() -> Option<HytaleInstall> {
    locator::locate().ok()
}

/// Lee un asset de texto oficial directamente desde `Assets.zip` mediante IPC nativo.
/// WebKit no resuelve de forma fiable `fetch()` sobre protocolos personalizados para JSON,
/// aunque sí carga sus imágenes; esta ruta garantiza los `.blockymodel` completos en macOS.
#[tauri::command]
pub fn read_text_asset(state: State<AppState>, entry_path: String) -> CmdResult<String> {
    validate_text_asset_entry(&entry_path)?;
    // Una app que permanece abierta puede haber sobrevivido a una actualización completa
    // del juego. Revalida también en esta ruta, no solo al consultar el catálogo.
    let _ = refresh_assets_if_stale(&state);
    let bytes = {
        let mut guard = state.assets.lock().map_err(err)?;
        let reader = guard.as_mut().ok_or("Hytale no está disponible")?;
        reader.read_entry(&entry_path).map_err(err)?
    };
    if bytes.len() > MAX_TEXT_ASSET_BYTES {
        return Err("El asset de texto supera el límite permitido".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "El asset no contiene UTF-8 válido".to_string())
}

/// Fija manualmente la ruta de instalación: valida, reabre el lector de assets y
/// resetea el catálogo cacheado.
#[tauri::command]
pub fn set_install_path(state: State<AppState>, path: String) -> CmdResult<HytaleInstall> {
    let install = locator::validate(&path).map_err(err)?;
    let zip = install.assets_zip();
    let _refresh_guard = state.assets_refresh.lock().map_err(err)?;
    load_assets_transactionally(&state, zip, false, "manual")?;
    Ok(install)
}

/// Resultado completo de la sincronización local. `generation` es la revisión que el
/// frontend incorpora a todas las URL para impedir que WebKit/GPU reutilicen texturas viejas.
#[derive(Debug, Clone, Serialize)]
pub struct HytaleRefresh {
    pub changed: bool,
    pub generation: u64,
    pub reason: String,
    pub path: Option<String>,
    pub catalog: Option<CatalogDiagnostics>,
}

fn unchanged_refresh(state: &AppState, path: Option<&Path>) -> HytaleRefresh {
    HytaleRefresh {
        changed: false,
        generation: state.asset_generation(),
        reason: "unchanged".to_string(),
        path: path.map(|value| value.to_string_lossy().into_owned()),
        catalog: state
            .catalog_diagnostics
            .lock()
            .ok()
            .and_then(|value| value.clone()),
    }
}

/// Abre, valida y construye el catálogo antes de publicar ningún cambio en el estado. Si una
/// actualización está aún descargándose o cambia de schema, la versión anterior sigue activa.
fn load_assets_transactionally(
    state: &AppState,
    path: PathBuf,
    auto_detected: bool,
    reason: &str,
) -> CmdResult<HytaleRefresh> {
    let fingerprint = asset_fingerprint(&path).map_err(err)?;
    let locale = catalog_locale(state)?;
    let mut reader = AssetReader::open(&path).map_err(err)?;
    let (catalog, diagnostics) = reader
        .build_catalog_with_diagnostics(&locale)
        .map_err(err)?;
    let compatibility_failures = diagnostics.parse_failures + diagnostics.read_failures;
    if compatibility_failures > 0 {
        return Err(format!(
            "la revisión nueva contiene {compatibility_failures} definiciones incompatibles; se conserva la versión anterior"
        ));
    }

    // Adquirir todos los locks antes de mutar evita publicar un estado a medias incluso ante
    // un mutex envenenado. El orden es único para este bloque transaccional.
    let mut assets_guard = state.assets.lock().map_err(err)?;
    let mut catalog_guard = state.catalog.lock().map_err(err)?;
    let mut diagnostics_guard = state.catalog_diagnostics.lock().map_err(err)?;
    let mut path_guard = state.assets_path.lock().map_err(err)?;
    let mut fingerprint_guard = state.assets_fingerprint.lock().map_err(err)?;
    let mut auto_guard = state.assets_auto_detected.lock().map_err(err)?;

    *assets_guard = Some(reader);
    *catalog_guard = Some(catalog);
    *diagnostics_guard = Some(diagnostics.clone());
    *path_guard = Some(path.clone());
    *fingerprint_guard = Some(fingerprint);
    *auto_guard = auto_detected;
    let generation = state.advance_asset_generation();

    Ok(HytaleRefresh {
        changed: true,
        generation,
        reason: reason.to_string(),
        path: Some(path.to_string_lossy().into_owned()),
        catalog: Some(diagnostics),
    })
}

/// Reevalúa la instalación (incluido un `latest` o canal nuevo) y compara una huella robusta,
/// no solo el mtime. Integra la actualización únicamente después de validarla por completo.
fn refresh_assets_if_stale(state: &AppState) -> CmdResult<HytaleRefresh> {
    let _refresh_guard = state.assets_refresh.lock().map_err(err)?;
    let stored_path = state.assets_path.lock().map_err(err)?.clone();
    let stored_fingerprint = state.assets_fingerprint.lock().map_err(err)?.clone();
    let stored_auto = *state.assets_auto_detected.lock().map_err(err)?;

    let should_relocate = stored_auto
        || stored_path.is_none()
        || stored_path.as_ref().is_some_and(|path| !path.is_file());
    let located_path = should_relocate
        .then(|| locator::locate().ok().map(|install| install.assets_zip()))
        .flatten();
    let candidate = located_path.clone().or_else(|| stored_path.clone());
    let Some(candidate) = candidate else {
        return Ok(unchanged_refresh(state, None));
    };
    let candidate_fingerprint = asset_fingerprint(&candidate).map_err(err)?;
    if stored_path.as_ref() == Some(&candidate)
        && stored_fingerprint.as_ref() == Some(&candidate_fingerprint)
    {
        return Ok(unchanged_refresh(state, Some(&candidate)));
    }

    let reason = if stored_path.is_none() {
        "connected"
    } else if stored_path.as_ref() != Some(&candidate) {
        "relocated"
    } else {
        "updated"
    };
    let candidate_is_auto = located_path.as_ref() == Some(&candidate) || stored_auto;
    load_assets_transactionally(state, candidate, candidate_is_auto, reason)
}

/// Comprueba si Hytale se ha actualizado (cambió el `Assets.zip`) y, si es así,
/// recarga assets y catálogo. Devuelve la revisión y el diagnóstico resultantes.
#[tauri::command]
pub fn refresh_hytale(state: State<AppState>) -> CmdResult<HytaleRefresh> {
    refresh_assets_if_stale(&state)
}

/// Indica si hay un lector de assets de Hytale activo (refleja también la selección manual).
#[tauri::command]
pub fn hytale_ready(state: State<AppState>) -> CmdResult<bool> {
    Ok(state.assets.lock().map_err(err)?.is_some())
}

/// Reintenta la autodetección de Hytale y, si la encuentra, la carga en el estado.
#[tauri::command]
pub fn retry_locate(state: State<AppState>) -> CmdResult<bool> {
    match locator::locate() {
        Ok(install) => {
            let zip = install.assets_zip();
            let _refresh_guard = state.assets_refresh.lock().map_err(err)?;
            load_assets_transactionally(&state, zip, true, "connected")?;
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

// ---- Catálogo de bloques (con iconos/texturas reales) ----

const CATALOG_LOCALE_SETTING: &str = "catalog_locale";

/// Idioma del catálogo elegido por el usuario (o el predeterminado del juego).
fn catalog_locale(state: &AppState) -> CmdResult<String> {
    let conn = state.db.lock().map_err(err)?;
    Ok(repo::get_setting(&conn, CATALOG_LOCALE_SETTING)
        .map_err(err)?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_LOCALE.to_string()))
}

/// Construye el catálogo si aún no está cacheado (no devuelve nada, solo lo asegura).
fn ensure_catalog(state: &State<AppState>) -> CmdResult<()> {
    {
        let guard = state.catalog.lock().map_err(err)?;
        if guard.is_some() {
            return Ok(());
        }
    }
    let locale = catalog_locale(state)?; // leer antes de bloquear assets (evita deadlock)
    let (cat, diagnostics) = {
        let mut assets_guard = state.assets.lock().map_err(err)?;
        let reader = assets_guard
            .as_mut()
            .ok_or("Hytale no está disponible: selecciona la instalación")?;
        reader
            .build_catalog_with_diagnostics(&locale)
            .map_err(err)?
    };
    *state.catalog_diagnostics.lock().map_err(err)? = Some(diagnostics);
    *state.catalog.lock().map_err(err)? = Some(cat);
    Ok(())
}

/// Idioma del catálogo: idiomas disponibles del juego + el elegido actualmente.
#[derive(Debug, Serialize)]
pub struct CatalogLocaleInfo {
    pub current: String,
    pub available: Vec<String>,
}

/// Devuelve el idioma del catálogo actual y los disponibles en la instalación.
#[tauri::command]
pub fn get_catalog_locale_info(state: State<AppState>) -> CmdResult<CatalogLocaleInfo> {
    let current = catalog_locale(&state)?;
    let available = {
        let guard = state.assets.lock().map_err(err)?;
        guard.as_ref().map(|r| r.list_locales()).unwrap_or_default()
    };
    Ok(CatalogLocaleInfo { current, available })
}

/// Cambia el idioma del catálogo y descarta la caché para reconstruirlo.
#[tauri::command]
pub fn set_catalog_locale(state: State<AppState>, locale: String) -> CmdResult<()> {
    {
        let conn = state.db.lock().map_err(err)?;
        repo::set_setting(&conn, CATALOG_LOCALE_SETTING, locale.trim()).map_err(err)?;
    }
    *state.catalog.lock().map_err(err)? = None; // forzar reconstrucción con el nuevo idioma
    *state.catalog_diagnostics.lock().map_err(err)? = None;
    Ok(())
}

/// Estado del `Assets.zip` activo y compatibilidad del catálogo con su schema.
#[derive(Debug, Serialize)]
pub struct AssetCompatibility {
    pub path: String,
    pub generation: u64,
    pub auto_detected: bool,
    #[serde(flatten)]
    pub fingerprint: AssetFingerprint,
    #[serde(flatten)]
    pub catalog: CatalogDiagnostics,
}

/// Diagnóstico explícito para detectar cambios incompatibles de Hytale. Construye el catálogo
/// si hace falta y nunca expone contenido de los assets, solo contadores y metadatos del archivo.
#[tauri::command]
pub fn get_asset_compatibility(state: State<AppState>) -> CmdResult<AssetCompatibility> {
    let _ = refresh_assets_if_stale(&state);
    ensure_catalog(&state)?;
    let path = state
        .assets_path
        .lock()
        .map_err(err)?
        .clone()
        .ok_or("Hytale no está disponible: selecciona la instalación")?;
    let fingerprint = state
        .assets_fingerprint
        .lock()
        .map_err(err)?
        .clone()
        .ok_or("No se pudo identificar el archivo de assets")?;
    let auto_detected = *state.assets_auto_detected.lock().map_err(err)?;
    let catalog = state
        .catalog_diagnostics
        .lock()
        .map_err(err)?
        .clone()
        .ok_or("No se pudo generar el diagnóstico del catálogo")?;
    Ok(AssetCompatibility {
        path: path.to_string_lossy().into_owned(),
        generation: state.asset_generation(),
        auto_detected,
        fingerprint,
        catalog,
    })
}

/// Clasifica un bloque como "detalle/remate" (mobiliario, decoración, plantas, luces),
/// para separarlo a la última fase de la guía.
fn is_detail_block(b: &BlockInfo) -> bool {
    let Some(first) = b.categories.first() else {
        return false;
    };
    let mut parts = first.split('.');
    let top = parts.next().unwrap_or("");
    let sub = parts.next().unwrap_or("");
    top == "Furniture" || matches!(sub, "Deco" | "Plants" | "Lighting" | "Signs")
}

/// Pistas de curación (bloques de detalle) derivadas del catálogo. Vacías si el
/// catálogo no está disponible (entonces no se separa el detalle a la última fase).
fn curation_hints(state: &State<AppState>) -> crate::core::curation::CurationHints {
    use crate::core::curation::CurationHints;
    if ensure_catalog(state).is_err() {
        return CurationHints::default();
    }
    let guard = match state.catalog.lock() {
        Ok(g) => g,
        Err(_) => return CurationHints::default(),
    };
    let Some(cat) = guard.as_ref() else {
        return CurationHints::default();
    };
    let mut hints = CurationHints::default();
    for b in cat.values() {
        if is_detail_block(b) {
            hints.detail.insert(b.name.clone());
        }
    }
    hints.catalog = cat.clone();
    hints
}

fn catalog_snapshot(state: &State<AppState>) -> Option<BlockCatalog> {
    let _ = refresh_assets_if_stale(state);
    ensure_catalog(state).ok()?;
    state.catalog.lock().ok()?.as_ref().cloned()
}

/// Devuelve el catálogo de bloques de Hytale (construido perezosamente y cacheado).
#[tauri::command]
pub fn get_block_catalog(state: State<AppState>) -> CmdResult<Vec<BlockInfo>> {
    // Si Hytale se actualizó, recarga assets + catálogo automáticamente.
    let _ = refresh_assets_if_stale(&state);
    ensure_catalog(&state)?;
    let cat_guard = state.catalog.lock().map_err(err)?;
    // ok_or en vez de unwrap: ensure_catalog suelta el lock y otro hilo (set_catalog_locale /
    // refresh_assets_if_stale, o el protocolo de assets) podría dejar el catálogo en None entre
    // medias → un unwrap haría PANIC y colgaría el comando.
    let cat = cat_guard
        .as_ref()
        .ok_or_else(|| "El catálogo de Hytale no está disponible".to_string())?;
    let mut list: Vec<BlockInfo> = cat.values().cloned().collect();
    list.sort_by(|a, b| {
        a.display_name
            .as_deref()
            .unwrap_or(&a.name)
            .to_ascii_lowercase()
            .cmp(
                &b.display_name
                    .as_deref()
                    .unwrap_or(&b.name)
                    .to_ascii_lowercase(),
            )
    });
    Ok(list)
}

/// Companion: descripción + cómo se consigue de un bloque, desde la wiki pública
/// hytaleguide.net (con caché local). `display_name` = nombre legible del bloque.
#[tauri::command]
pub fn block_wiki(
    state: State<AppState>,
    display_name: String,
) -> CmdResult<Option<crate::wiki::BlockWiki>> {
    let cache_dir = state
        .voxel_dir
        .parent()
        .unwrap_or(&state.voxel_dir)
        .join("wikicache");
    Ok(crate::wiki::fetch(&cache_dir, &display_name))
}

// ---- Biblioteca de builds ----

#[tauri::command]
pub fn list_builds(state: State<AppState>) -> CmdResult<Vec<Build>> {
    let conn = state.db.lock().map_err(err)?;
    repo::list_builds(&conn).map_err(err)
}

/// Resumen de cada build para la biblioteca: incluye los bloques principales
/// (previsualización), el estado de progreso y si es favorita.
#[derive(Debug, Serialize)]
pub struct BuildSummary {
    #[serde(flatten)]
    pub build: Build,
    pub top_blocks: Vec<String>,
    pub status: String,
    pub is_favorite: bool,
}

#[tauri::command]
pub fn list_build_summaries(state: State<AppState>) -> CmdResult<Vec<BuildSummary>> {
    let conn = state.db.lock().map_err(err)?;
    let mut out = Vec::new();
    for build in repo::list_builds(&conn).map_err(err)? {
        let top_blocks = repo::top_block_names(&conn, build.id, 10)
            .map_err(err)?
            .into_iter()
            .filter(|name| !is_generation_marker(name))
            .take(5)
            .collect();
        let status = repo::get_progress(&conn, build.id)
            .map_err(err)?
            .map(|p| p.status.as_str().to_string())
            .unwrap_or_else(|| "not_started".to_string());
        let is_favorite = repo::is_favorite(&conn, build.id).map_err(err)?;
        out.push(BuildSummary {
            build,
            top_blocks,
            status,
            is_favorite,
        });
    }
    Ok(out)
}

/// Detalle de presentación de una build: build + fases (con pasos y materiales) + favorito.
#[derive(Debug, Serialize)]
pub struct PhaseWithSteps {
    #[serde(flatten)]
    pub phase: Phase,
    pub steps: Vec<Step>,
    pub materials: Vec<MaterialRow>,
}

#[derive(Debug, Serialize)]
pub struct BuildDetail {
    pub build: Build,
    pub phases: Vec<PhaseWithSteps>,
    pub materials: Vec<MaterialRow>,
    pub is_favorite: bool,
}

/// Metadatos editables de una build (curación).
#[derive(Debug, Deserialize)]
pub struct BuildMetaUpdate {
    pub name: String,
    pub description: String,
    pub category: String,
    pub style: String,
    pub difficulty: String,
    pub mode: String,
    pub estimated_time_min: i64,
}

#[tauri::command]
pub fn update_build_meta(
    state: State<AppState>,
    build_id: i64,
    meta: BuildMetaUpdate,
) -> CmdResult<()> {
    validate_build_meta(&meta)?;
    let conn = state.db.lock().map_err(err)?;
    repo::update_build_meta(
        &conn,
        build_id,
        &meta.name,
        &meta.description,
        &meta.category,
        &meta.style,
        &meta.difficulty,
        &meta.mode,
        meta.estimated_time_min,
    )
    .map_err(err)
}

#[tauri::command]
pub fn update_phase(
    state: State<AppState>,
    phase_id: i64,
    name: String,
    description: String,
) -> CmdResult<()> {
    validate_text(&name, "El nombre de la fase", 256, true)?;
    validate_text(&description, "La descripción de la fase", 100_000, false)?;
    let conn = state.db.lock().map_err(err)?;
    repo::update_phase(&conn, phase_id, &name, &description).map_err(err)
}

// ---- Editor de guías (Fase 2: herramientas para creadores) ----

/// Crea una build nueva desde cero (sin prefab) con metadatos del creador.
/// Genera un slug único a partir del nombre.
#[tauri::command]
pub fn create_build(state: State<AppState>, meta: BuildMetaUpdate) -> CmdResult<i64> {
    validate_build_meta(&meta)?;
    let conn = state.db.lock().map_err(err)?;
    let base = {
        let s = slugify(&meta.name);
        if s.is_empty() {
            "build".to_string()
        } else {
            s
        }
    };
    let mut nb = NewBuild {
        slug: String::new(),
        name: meta.name,
        description: meta.description,
        category: meta.category,
        style: meta.style,
        difficulty: meta.difficulty,
        estimated_time_min: meta.estimated_time_min,
        block_count: 0,
        mode: meta.mode,
        thumbnail_ref: None,
        author_name: Some("Tú".to_string()),
        author_url: None,
        source_url: None,
        license_note: None,
        voxel_model_ref: None,
    };
    for n in 0..1000 {
        nb.slug = if n == 0 {
            base.clone()
        } else {
            format!("{base}-{}", n + 1)
        };
        if let Ok(id) = repo::create_build(&conn, &nb) {
            return Ok(id);
        }
    }
    Err("No se pudo generar un identificador único para la build".to_string())
}

/// Borra una build completa (cascade a fases, pasos, materiales, progreso y favoritos).
#[tauri::command]
pub fn delete_build(state: State<AppState>, build_id: i64) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::delete_build(&conn, build_id).map_err(err)
}

/// Añade una fase al final de la build. Devuelve su id.
#[tauri::command]
pub fn add_phase(
    state: State<AppState>,
    build_id: i64,
    name: String,
    description: String,
) -> CmdResult<i64> {
    validate_text(&name, "El nombre de la fase", 256, true)?;
    validate_text(&description, "La descripción de la fase", 100_000, false)?;
    let conn = state.db.lock().map_err(err)?;
    let order_index = repo::phases_for_build(&conn, build_id).map_err(err)?.len() as i64;
    if order_index >= 256 {
        return Err("Una guía no puede superar 256 fases".into());
    }
    repo::add_phase(
        &conn,
        &NewPhase {
            build_id,
            order_index,
            name,
            description,
        },
    )
    .map_err(err)
}

/// Borra una fase (cascade a sus pasos y materiales).
#[tauri::command]
pub fn delete_phase(state: State<AppState>, phase_id: i64) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::delete_phase(&conn, phase_id).map_err(err)
}

/// Reordena las fases según el orden de los ids recibidos.
#[tauri::command]
pub fn reorder_phases(state: State<AppState>, ordered_ids: Vec<i64>) -> CmdResult<()> {
    if ordered_ids.is_empty() || ordered_ids.len() > 256 {
        return Err("La lista de fases no es válida".into());
    }
    let conn = state.db.lock().map_err(err)?;
    let build_id = repo::build_id_of_phase(&conn, ordered_ids[0]).map_err(err)?;
    let expected: std::collections::HashSet<i64> = repo::phases_for_build(&conn, build_id)
        .map_err(err)?
        .into_iter()
        .map(|phase| phase.id)
        .collect();
    let provided: std::collections::HashSet<i64> = ordered_ids.iter().copied().collect();
    if provided.len() != ordered_ids.len() || provided != expected {
        return Err("El orden debe contener exactamente las fases de una misma guía".into());
    }
    repo::reorder_phases(&conn, &ordered_ids).map_err(err)
}

/// Añade un paso al final de una fase. Devuelve su id.
#[tauri::command]
pub fn add_step(
    state: State<AppState>,
    phase_id: i64,
    title: String,
    instruction: String,
) -> CmdResult<i64> {
    validate_text(&title, "El título del paso", 512, true)?;
    validate_text(&instruction, "La instrucción del paso", 100_000, false)?;
    let conn = state.db.lock().map_err(err)?;
    let order_index = repo::steps_for_phase(&conn, phase_id).map_err(err)?.len() as i64;
    if order_index >= 10_000 {
        return Err("Una fase no puede superar 10.000 pasos".into());
    }
    repo::add_step(
        &conn,
        &NewStep {
            phase_id,
            order_index,
            title,
            instruction,
            preview_ref: None,
        },
    )
    .map_err(err)
}

/// Borra un paso.
#[tauri::command]
pub fn delete_step(state: State<AppState>, step_id: i64) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::delete_step(&conn, step_id).map_err(err)
}

/// Reordena los pasos de una fase según el orden de los ids recibidos.
#[tauri::command]
pub fn reorder_steps(state: State<AppState>, ordered_ids: Vec<i64>) -> CmdResult<()> {
    if ordered_ids.is_empty() || ordered_ids.len() > 10_000 {
        return Err("La lista de pasos no es válida".into());
    }
    let conn = state.db.lock().map_err(err)?;
    let phase_id = repo::phase_id_of_step(&conn, ordered_ids[0]).map_err(err)?;
    let expected: std::collections::HashSet<i64> = repo::steps_for_phase(&conn, phase_id)
        .map_err(err)?
        .into_iter()
        .map(|step| step.id)
        .collect();
    let provided: std::collections::HashSet<i64> = ordered_ids.iter().copied().collect();
    if provided.len() != ordered_ids.len() || provided != expected {
        return Err("El orden debe contener exactamente los pasos de una misma fase".into());
    }
    repo::reorder_steps(&conn, &ordered_ids).map_err(err)
}

/// Exporta una build a un archivo `.voxelfold` (JSON portable, sin assets de Hytale).
#[tauri::command]
pub fn export_build(state: State<AppState>, build_id: i64, path: String) -> CmdResult<()> {
    let json = {
        let conn = state.db.lock().map_err(err)?;
        portable::export(&conn, &state.voxel_dir, build_id).map_err(err)?
    };
    std::fs::write(&path, json).map_err(err)
}

/// Importa una build desde un archivo `.voxelfold`. Devuelve el id creado.
#[tauri::command]
pub fn import_build(state: State<AppState>, path: String) -> CmdResult<i64> {
    let json = read_text_file_limited(Path::new(&path), MAX_IMPORT_BYTES)?;
    let build_id = {
        let conn = state.db.lock().map_err(err)?;
        portable::import(&conn, &state.voxel_dir, &json).map_err(err)?
    };
    if let Some(catalog) = catalog_snapshot(&state) {
        if let Ok(mut model) = voxel_store::load(&state.voxel_dir, build_id) {
            if multicell::collapse_stored_fillers(&mut model, &catalog) > 0 {
                let conn = state.db.lock().map_err(err)?;
                curation::set_voxel_model(&conn, &state.voxel_dir, build_id, &model)
                    .map_err(err)?;
            }
        }
    }
    Ok(build_id)
}

/// Fija los materiales de una fase (curación manual) y recalcula el total de la build.
#[tauri::command]
pub fn set_phase_materials(
    state: State<AppState>,
    phase_id: i64,
    materials: Vec<MaterialRow>,
) -> CmdResult<()> {
    if materials.len() > 10_000 {
        return Err("La lista contiene demasiados materiales".into());
    }
    for material in &materials {
        validate_text(&material.block_name, "El nombre del material", 512, true)?;
        if material.qty < 0 {
            return Err("La cantidad de un material no puede ser negativa".into());
        }
    }
    let conn = state.db.lock().map_err(err)?;
    repo::cache_phase_materials(&conn, phase_id, &materials).map_err(err)?;
    let build_id = repo::build_id_of_phase(&conn, phase_id).map_err(err)?;
    repo::recompute_build_materials(&conn, build_id).map_err(err)
}

#[tauri::command]
pub fn update_step(
    state: State<AppState>,
    step_id: i64,
    title: String,
    instruction: String,
) -> CmdResult<()> {
    validate_text(&title, "El título del paso", 512, true)?;
    validate_text(&instruction, "La instrucción del paso", 100_000, false)?;
    let conn = state.db.lock().map_err(err)?;
    repo::update_step(&conn, step_id, &title, &instruction).map_err(err)
}

/// Guarda la miniatura de una build (data URL PNG capturado del visor 3D).
#[tauri::command]
pub fn set_thumbnail(state: State<AppState>, build_id: i64, data_url: String) -> CmdResult<()> {
    const MAX_THUMBNAIL_BYTES: usize = 8 * 1024 * 1024;
    if !data_url.starts_with("data:image/png;base64,") {
        return Err("La miniatura debe ser una imagen PNG generada por Voxelfold".into());
    }
    if data_url.len() > MAX_THUMBNAIL_BYTES {
        return Err("La miniatura supera el límite de 8 MiB".into());
    }
    let conn = state.db.lock().map_err(err)?;
    repo::set_thumbnail(&conn, build_id, &data_url).map_err(err)
}

#[tauri::command]
pub fn get_build_detail(state: State<AppState>, id: i64) -> CmdResult<BuildDetail> {
    let conn = state.db.lock().map_err(err)?;
    let build = repo::get_build(&conn, id).map_err(err)?;
    let mut phases = Vec::new();
    for ph in repo::phases_for_build(&conn, id).map_err(err)? {
        let steps = repo::steps_for_phase(&conn, ph.id).map_err(err)?;
        let materials = repo::phase_materials(&conn, ph.id)
            .map_err(err)?
            .into_iter()
            .filter(|material| !is_generation_marker(&material.block_name))
            .collect();
        phases.push(PhaseWithSteps {
            phase: ph,
            steps,
            materials,
        });
    }
    let materials = repo::build_materials(&conn, id)
        .map_err(err)?
        .into_iter()
        .filter(|material| !is_generation_marker(&material.block_name))
        .collect();
    let is_favorite = repo::is_favorite(&conn, id).map_err(err)?;
    Ok(BuildDetail {
        build,
        phases,
        materials,
        is_favorite,
    })
}

// ---- Favoritos ----

#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, build_id: i64) -> CmdResult<bool> {
    let conn = state.db.lock().map_err(err)?;
    repo::toggle_favorite(&conn, build_id).map_err(err)
}

#[tauri::command]
pub fn list_favorites(state: State<AppState>) -> CmdResult<Vec<i64>> {
    let conn = state.db.lock().map_err(err)?;
    repo::list_favorites(&conn).map_err(err)
}

// ---- Progreso ----

#[tauri::command]
pub fn get_progress(state: State<AppState>, build_id: i64) -> CmdResult<Option<Progress>> {
    let conn = state.db.lock().map_err(err)?;
    repo::get_progress(&conn, build_id).map_err(err)
}

#[tauri::command]
pub fn set_progress(
    state: State<AppState>,
    build_id: i64,
    status: BuildStatus,
    current_phase_id: Option<i64>,
) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::set_progress(&conn, build_id, status, current_phase_id).map_err(err)
}

#[tauri::command]
pub fn set_step_completed(
    state: State<AppState>,
    build_id: i64,
    step_id: i64,
    completed: bool,
) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::set_step_completed(&conn, build_id, step_id, completed).map_err(err)
}

#[tauri::command]
pub fn get_completed_steps(state: State<AppState>, build_id: i64) -> CmdResult<Vec<i64>> {
    let conn = state.db.lock().map_err(err)?;
    repo::completed_steps(&conn, build_id).map_err(err)
}

#[tauri::command]
pub fn reset_progress(state: State<AppState>, build_id: i64) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::reset_progress(&conn, build_id).map_err(err)
}

// ---- Checklist de materiales ----

#[tauri::command]
pub fn set_material_gathered(
    state: State<AppState>,
    build_id: i64,
    scope: String,
    block_name: String,
    gathered_qty: i64,
) -> CmdResult<()> {
    let conn = state.db.lock().map_err(err)?;
    repo::set_material_gathered(&conn, build_id, &scope, &block_name, gathered_qty).map_err(err)
}

#[tauri::command]
pub fn get_checklist(
    state: State<AppState>,
    build_id: i64,
    scope: String,
) -> CmdResult<Vec<ChecklistItem>> {
    let conn = state.db.lock().map_err(err)?;
    repo::get_checklist(&conn, build_id, &scope).map_err(err)
}

// ---- Modelo voxel (para el visor 3D) ----

#[tauri::command]
pub fn get_build_voxels(state: State<AppState>, build_id: i64) -> CmdResult<StoredModel> {
    let mut model = voxel_store::load(&state.voxel_dir, build_id).map_err(err)?;
    if let Some(catalog) = catalog_snapshot(&state) {
        let removed = multicell::collapse_stored_fillers(&mut model, &catalog);
        if removed > 0 {
            let conn = state.db.lock().map_err(err)?;
            curation::set_voxel_model(&conn, &state.voxel_dir, build_id, &model).map_err(err)?;
        }
    }
    Ok(model)
}

/// Guarda el modelo voxel editado (editor visual) y resincroniza fases y materiales.
#[tauri::command]
pub fn set_build_voxels(
    state: State<AppState>,
    build_id: i64,
    mut model: StoredModel,
) -> CmdResult<()> {
    if let Some(catalog) = catalog_snapshot(&state) {
        multicell::collapse_stored_fillers(&mut model, &catalog);
    }
    let conn = state.db.lock().map_err(err)?;
    curation::set_voxel_model(&conn, &state.voxel_dir, build_id, &model).map_err(err)
}

/// Migración conservadora: repara modelos persistidos sin recrear builds ni perder
/// favoritos, progreso, metadatos o miniaturas. Se ejecuta una sola vez al actualizar.
pub(crate) fn repair_multicell_models(state: State<AppState>) -> CmdResult<usize> {
    let Some(catalog) = catalog_snapshot(&state) else {
        return Err("El catálogo de Hytale no está disponible".into());
    };
    let ids: Vec<i64> = {
        let conn = state.db.lock().map_err(err)?;
        repo::list_builds(&conn)
            .map_err(err)?
            .into_iter()
            .filter(|build| build.voxel_model_ref.is_some())
            .map(|build| build.id)
            .collect()
    };
    let mut repaired = 0;
    for build_id in ids {
        let mut model = voxel_store::load(&state.voxel_dir, build_id).map_err(err)?;
        if multicell::collapse_stored_fillers(&mut model, &catalog) == 0 {
            continue;
        }
        let conn = state.db.lock().map_err(err)?;
        curation::set_voxel_model(&conn, &state.voxel_dir, build_id, &model).map_err(err)?;
        repaired += 1;
    }
    Ok(repaired)
}

// ---- Contenido de demostración (importa un prefab real de Hytale, solo local) ----

/// Importa un prefab concreto del Assets.zip como build curada. Lógica común.
fn import_entry(state: &State<AppState>, entry: &str) -> CmdResult<i64> {
    let json = {
        let mut guard = state.assets.lock().map_err(err)?;
        let reader = guard.as_mut().ok_or("Hytale no está disponible")?;
        String::from_utf8_lossy(&reader.read_entry(entry).map_err(err)?).into_owned()
    };
    let name = demo_name_from_entry(entry);
    let hints = curation_hints(state);
    let conn = state.db.lock().map_err(err)?;
    let existing = repo::list_builds(&conn).map_err(err)?.len();
    let meta = NewBuild {
        slug: format!("{}-{}", slugify(&name), existing + 1),
        name,
        description: "Build importada de tu Hytale (solo local).".to_string(),
        category: "Importada".to_string(),
        style: String::new(),
        difficulty: "Media".to_string(),
        estimated_time_min: 0,
        block_count: 0,
        mode: "creative".to_string(),
        thumbnail_ref: None,
        author_name: Some("Hytale (local)".to_string()),
        author_url: None,
        source_url: Some(entry.to_string()),
        license_note: Some("Prefab de Hytale; uso local, no redistribuido.".to_string()),
        voxel_model_ref: None,
    };
    curation::import_prefab_json(&conn, &state.voxel_dir, &json, &meta, 6, &hints, false)
        .map_err(err)
}

#[tauri::command]
pub fn create_demo_build(state: State<AppState>) -> CmdResult<i64> {
    let entry = {
        let guard = state.assets.lock().map_err(err)?;
        let reader = guard
            .as_ref()
            .ok_or("Hytale no está disponible: selecciona la instalación")?;
        pick_demo_prefab(&reader.list_prefabs()).ok_or("No se encontraron prefabs en Hytale")?
    };
    import_entry(&state, &entry)
}

#[tauri::command]
pub fn import_hytale_prefab(state: State<AppState>, entry: String) -> CmdResult<i64> {
    import_entry(&state, &entry)
}

// ---- Prefabs públicos de la comunidad (búsqueda local en GitHub, con atribución) ----

/// Busca repositorios públicos de prefabs de Hytale (sin servidor propio).
#[tauri::command]
pub fn search_community_prefabs(query: String) -> CmdResult<Vec<crate::community::CommunityRepo>> {
    crate::community::search_repos(&query)
}

/// Obtiene un repositorio público a partir de su URL o `owner/repo` (pegar enlace).
#[tauri::command]
pub fn fetch_community_repo(url: String) -> CmdResult<crate::community::CommunityRepo> {
    crate::community::repo_info(&url)
}

/// Lista los prefabs de un repositorio público concreto.
#[tauri::command]
pub fn list_community_prefabs(
    owner: String,
    repo: String,
    branch: String,
    license: Option<String>,
) -> CmdResult<Vec<crate::community::CommunityPrefab>> {
    crate::community::list_prefabs(&owner, &repo, &branch, license.as_deref())
}

/// Descarga e importa un prefab de la comunidad, **acreditando al autor** (owner,
/// licencia y URL de origen quedan guardados en la build).
#[tauri::command]
pub fn import_community_prefab(
    state: State<AppState>,
    prefab: crate::community::CommunityPrefab,
) -> CmdResult<i64> {
    let json = crate::community::download(&prefab.download_url)?;
    let hints = curation_hints(&state);
    let conn = state.db.lock().map_err(err)?;
    let existing = repo::list_builds(&conn).map_err(err)?.len();
    let license_note = match &prefab.license {
        Some(l) => format!(
            "Prefab de la comunidad · Licencia {l} · {}",
            prefab.source_url
        ),
        None => format!("Prefab de la comunidad · {}", prefab.source_url),
    };
    let meta = NewBuild {
        slug: format!("{}-{}", slugify(&prefab.name), existing + 1),
        name: prefab.name.clone(),
        description: format!("Importado de la comunidad ({}).", prefab.repo_full_name),
        category: "Comunidad".to_string(),
        style: String::new(),
        difficulty: "Media".to_string(),
        estimated_time_min: 0,
        block_count: 0,
        mode: "creative".to_string(),
        thumbnail_ref: None,
        author_name: Some(prefab.author.clone()),
        author_url: Some(prefab.author_url.clone()),
        source_url: Some(prefab.source_url.clone()),
        license_note: Some(license_note),
        voxel_model_ref: None,
    };
    curation::import_prefab_json(&conn, &state.voxel_dir, &json, &meta, 6, &hints, false)
        .map_err(err)
}

/// Importa un `.prefab.json` local concreto con metadatos genéricos. Helper común.
fn import_local_prefab(
    state: &State<AppState>,
    conn: &Connection,
    path: &str,
    hints: &crate::core::curation::CurationHints,
) -> CmdResult<i64> {
    let json = read_text_file_limited(Path::new(path), MAX_IMPORT_BYTES)?;
    let name = demo_name_from_entry(path);
    let existing = repo::list_builds(conn).map_err(err)?.len();
    let meta = NewBuild {
        slug: format!("{}-{}", slugify(&name), existing + 1),
        name,
        description: "Prefab importado desde un archivo local.".to_string(),
        category: "Importada".to_string(),
        style: String::new(),
        difficulty: "Media".to_string(),
        estimated_time_min: 0,
        block_count: 0,
        mode: "creative".to_string(),
        thumbnail_ref: None,
        author_name: Some("Importado (local)".to_string()),
        author_url: None,
        source_url: Some(path.to_string()),
        license_note: Some("Prefab local; uso personal, no redistribuido.".to_string()),
        voxel_model_ref: None,
    };
    curation::import_prefab_json(conn, &state.voxel_dir, &json, &meta, 6, hints, false).map_err(err)
}

/// Busca recursivamente archivos `.prefab.json` bajo una carpeta (máx. `limit`).
fn find_prefab_jsons(root: &Path, limit: usize) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if out.len() >= limit {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.to_string_lossy().ends_with(".prefab.json") {
                out.push(p);
                if out.len() >= limit {
                    break;
                }
            }
        }
    }
    out
}

/// Importa un archivo `.prefab.json` suelto del disco (build propia exportada de Hytale).
#[tauri::command]
pub fn import_prefab_file(state: State<AppState>, path: String) -> CmdResult<i64> {
    let hints = curation_hints(&state);
    let conn = state.db.lock().map_err(err)?;
    import_local_prefab(&state, &conn, &path, &hints)
}

/// Importa en lote todos los `.prefab.json` de una carpeta (recursivo). Omite los ya
/// importados (por ruta de origen). Devuelve cuántas builds nuevas se añadieron.
#[tauri::command]
pub fn import_prefab_folder(state: State<AppState>, path: String) -> CmdResult<usize> {
    let mut files = find_prefab_jsons(Path::new(&path), MAX_PREFABS_PER_ARCHIVE + 1);
    if files.len() > MAX_PREFABS_PER_ARCHIVE {
        return Err(format!(
            "La carpeta contiene más de {MAX_PREFABS_PER_ARCHIVE} prefabs; divídela en lotes"
        ));
    }
    files.sort();
    let hints = curation_hints(&state);
    let conn = state.db.lock().map_err(err)?;
    let already: std::collections::HashSet<String> = repo::list_builds(&conn)
        .map_err(err)?
        .into_iter()
        .filter_map(|b| b.source_url)
        .collect();
    let mut count = 0usize;
    for f in &files {
        let fp = f.to_string_lossy().to_string();
        if already.contains(&fp) {
            continue;
        }
        if import_local_prefab(&state, &conn, &fp, &hints).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

/// Lee uno o varios `.prefab.json` de una ruta local. Acepta un `.zip` (descargado
/// de CurseForge/BuiltByBit — extrae TODOS los `.prefab.json` de dentro, p. ej. un
/// pack con varias construcciones) o un `.prefab.json`/`.json` suelto. Devuelve
/// `(json, nombre_sugerido)` por cada prefab encontrado.
fn read_prefabs_from_path(path: &str) -> CmdResult<Vec<(String, String)>> {
    let bytes = read_file_limited(Path::new(path), MAX_IMPORT_BYTES)?;
    let name = Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path);
    read_prefabs_from_bytes(name, bytes)
}

/// Extrae uno o varios `.prefab.json` de un buffer en memoria. Detecta `.zip`
/// (por extensión o por la firma `PK`) y extrae todas las construcciones; si no,
/// trata el buffer como un `.prefab.json` suelto.
fn read_prefabs_from_bytes(file_name: &str, bytes: Vec<u8>) -> CmdResult<Vec<(String, String)>> {
    if bytes.len() as u64 > MAX_IMPORT_BYTES {
        return Err("El archivo supera el límite de 64 MiB".to_string());
    }
    let is_zip = file_name.to_lowercase().ends_with(".zip") || bytes.starts_with(b"PK\x03\x04");
    if is_zip {
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
        let mut out = Vec::new();
        let mut expanded = 0_u64;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(err)?;
            if !entry.is_file() {
                continue;
            }
            if entry.name().to_lowercase().ends_with(".prefab.json") {
                if out.len() >= MAX_PREFABS_PER_ARCHIVE {
                    return Err(format!(
                        "El archivo contiene más de {MAX_PREFABS_PER_ARCHIVE} prefabs"
                    ));
                }
                if entry.size() > MAX_IMPORT_BYTES {
                    return Err(format!("El prefab «{}» supera 64 MiB", entry.name()));
                }
                expanded = expanded.saturating_add(entry.size());
                if expanded > MAX_ARCHIVE_EXPANDED_BYTES {
                    return Err(
                        "El contenido descomprimido supera el límite de 128 MiB".to_string()
                    );
                }
                let name = demo_name_from_entry(entry.name());
                let mut body = Vec::new();
                (&mut entry)
                    .take(MAX_IMPORT_BYTES + 1)
                    .read_to_end(&mut body)
                    .map_err(err)?;
                if body.len() as u64 > MAX_IMPORT_BYTES {
                    return Err(format!("El prefab «{}» supera 64 MiB", entry.name()));
                }
                let s = String::from_utf8(body)
                    .map_err(|_| format!("El prefab «{}» no es UTF-8 válido", entry.name()))?;
                if !s.trim().is_empty() {
                    out.push((s, name));
                }
            }
        }
        if out.is_empty() {
            return Err("El archivo no contiene ningún .prefab.json".into());
        }
        Ok(out)
    } else {
        let json = String::from_utf8(bytes).map_err(|_| "El archivo no es JSON de texto válido")?;
        Ok(vec![(json, demo_name_from_entry(file_name))])
    }
}

/// Atribución para importar prefabs de la comunidad (CurseForge/BuiltByBit/archivo).
#[derive(Default)]
struct Attribution<'a> {
    author: Option<&'a str>,
    author_url: Option<&'a str>,
    source_url: Option<&'a str>,
    summary: Option<&'a str>,
}

/// Primer slug LIBRE a partir del nombre (`base`, `base-2`, `base-3`…). Consulta la BD por
/// existencia en vez de fiarse del nº de builds: así no colisiona con slugs de sesiones
/// anteriores (antes, un slug ya ocupado tiraba el prefab en silencio) ni es O(n²).
fn unique_slug(conn: &Connection, name: &str) -> String {
    use rusqlite::OptionalExtension;
    let base = {
        let s = slugify(name);
        if s.is_empty() {
            "comunidad".to_string()
        } else {
            s
        }
    };
    let mut slug = base.clone();
    let mut n = 1;
    while conn
        .query_row(
            "SELECT 1 FROM builds WHERE slug = ?1",
            rusqlite::params![slug],
            |_| Ok(()),
        )
        .optional()
        .unwrap_or(None)
        .is_some()
    {
        n += 1;
        slug = format!("{base}-{n}");
    }
    slug
}

/// Importa una lista de `(json, nombre)` como builds de comunidad, conservando la
/// atribución al autor. Devuelve los IDs importados (omite los que fallen).
fn import_prefab_list(
    state: &State<AppState>,
    conn: &Connection,
    prefabs: Vec<(String, String)>,
    attr: &Attribution,
    hints: &crate::core::curation::CurationHints,
) -> Vec<i64> {
    let license_note = match (attr.author, attr.source_url) {
        (Some(a), Some(u)) => format!("Prefab de la comunidad · Autor: {a} · {u}"),
        (Some(a), None) => format!("Prefab de la comunidad · Autor: {a}"),
        (None, Some(u)) => format!("Prefab de la comunidad · {u}"),
        (None, None) => "Prefab de la comunidad.".to_string(),
    };
    let mut ids = Vec::new();
    for (json, name) in prefabs {
        let src = attr
            .source_url
            .map(|u| format!("{u}#{name}"))
            .unwrap_or_else(|| format!("comunidad#{name}"));
        let description = attr
            .summary
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .or_else(|| {
                attr.source_url
                    .map(|u| format!("Importado de la comunidad ({u})."))
            })
            .unwrap_or_else(|| "Importado de la comunidad.".to_string());
        let meta = NewBuild {
            slug: unique_slug(conn, &name),
            name: name.clone(),
            description,
            category: "Comunidad".to_string(),
            style: String::new(),
            difficulty: "Media".to_string(),
            estimated_time_min: 0,
            block_count: 0,
            mode: "creative".to_string(),
            thumbnail_ref: None,
            author_name: attr
                .author
                .map(|a| a.to_string())
                .or_else(|| Some("Comunidad".to_string())),
            author_url: attr.author_url.or(attr.source_url).map(|u| u.to_string()),
            source_url: Some(src),
            license_note: Some(license_note.clone()),
            voxel_model_ref: None,
        };
        if let Ok(id) =
            curation::import_prefab_json(conn, &state.voxel_dir, &json, &meta, 6, hints, false)
        {
            ids.push(id);
        }
    }
    ids
}

/// Importa un prefab de la comunidad desde un archivo local: `.zip` (CurseForge /
/// BuiltByBit; importa todas las construcciones que contenga) o `.prefab.json`
/// suelto. **Acredita al autor**. Devuelve los IDs de las builds importadas.
#[tauri::command]
pub fn import_prefab_archive(
    state: State<AppState>,
    path: String,
    author: Option<String>,
    source_url: Option<String>,
) -> CmdResult<Vec<i64>> {
    let prefabs = read_prefabs_from_path(&path)?;
    let hints = curation_hints(&state);
    let conn = state.db.lock().map_err(err)?;
    let attr = Attribution {
        author: author.as_deref(),
        author_url: None,
        source_url: source_url.as_deref(),
        summary: None,
    };
    let ids = import_prefab_list(&state, &conn, prefabs, &attr, &hints);
    if ids.is_empty() {
        return Err("No se pudo importar ningún prefab del archivo".into());
    }
    Ok(ids)
}

// ---- CurseForge (API con clave propia del usuario) ----

const CF_KEY_SETTING: &str = "curseforge_api_key";
const CF_KEYRING_SERVICE: &str = "com.swondev.voxelfold";
const LEGACY_CF_KEYRING_SERVICE: &str = "com.voxelfold.app";
const CF_KEYRING_ACCOUNT: &str = "curseforge-api-key";

fn cf_keyring_entry(service: &str) -> CmdResult<keyring::Entry> {
    keyring::Entry::new(service, CF_KEYRING_ACCOUNT)
        .map_err(|e| format!("No se pudo abrir el llavero del sistema: {e}"))
}

fn delete_keyring_credential(entry: &keyring::Entry) -> CmdResult<()> {
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("No se pudo eliminar la clave del llavero: {e}")),
    }
}

/// Lee la clave desde el llavero. Migra una única vez el valor legado de SQLite y lo elimina
/// inmediatamente de la base de datos para que el secreto no vuelva a quedar en texto plano.
fn load_cf_key(state: &State<AppState>) -> CmdResult<Option<String>> {
    let entry = cf_keyring_entry(CF_KEYRING_SERVICE)?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => {
            let conn = state.db.lock().map_err(err)?;
            repo::delete_setting(&conn, CF_KEY_SETTING).map_err(err)?;
            return Ok(Some(key));
        }
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("No se pudo leer el llavero del sistema: {e}")),
    }

    // El cambio de bundle identifier de 0.2.0 no puede dejar atrás una clave existente.
    // La copia se completa antes de borrar la credencial antigua, por lo que es recuperable.
    let legacy_entry = cf_keyring_entry(LEGACY_CF_KEYRING_SERVICE)?;
    match legacy_entry.get_password() {
        Ok(key) if !key.trim().is_empty() => {
            entry
                .set_password(&key)
                .map_err(|e| format!("No se pudo migrar la clave en el llavero: {e}"))?;
            delete_keyring_credential(&legacy_entry)?;
            let conn = state.db.lock().map_err(err)?;
            repo::delete_setting(&conn, CF_KEY_SETTING).map_err(err)?;
            return Ok(Some(key));
        }
        Ok(_) | Err(keyring::Error::NoEntry) => {}
        Err(e) => return Err(format!("No se pudo leer el llavero anterior: {e}")),
    }

    let legacy = {
        let conn = state.db.lock().map_err(err)?;
        repo::get_setting(&conn, CF_KEY_SETTING).map_err(err)?
    };
    let legacy = legacy.filter(|key| !key.trim().is_empty());
    if let Some(key) = legacy {
        entry
            .set_password(&key)
            .map_err(|e| format!("No se pudo migrar la clave al llavero del sistema: {e}"))?;
        let conn = state.db.lock().map_err(err)?;
        repo::delete_setting(&conn, CF_KEY_SETTING).map_err(err)?;
        Ok(Some(key))
    } else {
        let conn = state.db.lock().map_err(err)?;
        repo::delete_setting(&conn, CF_KEY_SETTING).map_err(err)?;
        Ok(None)
    }
}

/// Indica si hay una clave guardada sin revelar nunca su valor al webview.
#[tauri::command]
pub fn curseforge_key_status(state: State<AppState>) -> CmdResult<bool> {
    Ok(load_cf_key(&state)?.is_some())
}

/// Guarda (o borra, si viene vacía) la clave de CurseForge en el llavero del sistema.
#[tauri::command]
pub fn curseforge_set_key(state: State<AppState>, key: String) -> CmdResult<()> {
    let entry = cf_keyring_entry(CF_KEYRING_SERVICE)?;
    let legacy_entry = cf_keyring_entry(LEGACY_CF_KEYRING_SERVICE)?;
    let key = key.trim();
    if key.is_empty() {
        delete_keyring_credential(&entry)?;
        delete_keyring_credential(&legacy_entry)?;
    } else {
        entry
            .set_password(key)
            .map_err(|e| format!("No se pudo guardar la clave en el llavero: {e}"))?;
        delete_keyring_credential(&legacy_entry)?;
    }
    let conn = state.db.lock().map_err(err)?;
    repo::delete_setting(&conn, CF_KEY_SETTING).map_err(err)
}

fn cf_key(state: &State<AppState>) -> CmdResult<String> {
    match load_cf_key(state)? {
        Some(k) => Ok(k),
        _ => Err("Falta tu clave de la API de CurseForge (configúrala en Ajustes).".into()),
    }
}

/// Busca prefabs de Hytale en CurseForge (requiere clave propia en Ajustes).
#[tauri::command]
pub fn curseforge_search(
    state: State<AppState>,
    query: String,
) -> CmdResult<Vec<crate::curseforge::CfPrefab>> {
    let key = cf_key(&state)?;
    crate::curseforge::search(&key, &query)
}

/// Descarga e importa un prefab concreto de CurseForge, **acreditando al autor**.
/// Si el autor desactivó la descarga por API, devuelve un error con su página.
#[tauri::command]
pub fn curseforge_import(
    state: State<AppState>,
    prefab: crate::curseforge::CfPrefab,
) -> CmdResult<Vec<i64>> {
    let url = prefab.download_url.clone().ok_or_else(|| {
        format!(
            "El autor no permite la descarga automática. Ábrelo en CurseForge y usa «Importar .zip»: {}",
            prefab.website_url
        )
    })?;
    let bytes = crate::curseforge::download_bytes(&url)?;
    let prefabs = read_prefabs_from_bytes(&prefab.file_name, bytes)?;
    let hints = curation_hints(&state);
    let conn = state.db.lock().map_err(err)?;
    let attr = Attribution {
        author: Some(&prefab.author),
        author_url: (!prefab.author_url.is_empty()).then_some(prefab.author_url.as_str()),
        source_url: (!prefab.website_url.is_empty()).then_some(prefab.website_url.as_str()),
        summary: Some(&prefab.summary),
    };
    let ids = import_prefab_list(&state, &conn, prefabs, &attr, &hints);
    if ids.is_empty() {
        return Err("No se pudo importar ningún prefab de CurseForge".into());
    }
    Ok(ids)
}

/// Importa desde la URL de la página de un prefab en CurseForge (resuelve el slug
/// vía API y descarga). Requiere clave propia en Ajustes.
#[tauri::command]
pub fn curseforge_import_url(state: State<AppState>, url: String) -> CmdResult<Vec<i64>> {
    let key = cf_key(&state)?;
    let prefab = crate::curseforge::from_url(&key, &url)?;
    curseforge_import(state, prefab)
}

/// Carga la colección curada de presets: casas REALES de Hytale (aldeas NPC y casas
/// de bioma) resueltas contra el Assets.zip local e importadas con todos los arreglos
/// de render. Antes purga el contenido viejo de generación de mundo (aberrante) y
/// reemplaza la versión anterior de cada preset. Devuelve cuántas builds se importaron.
#[tauri::command]
pub fn seed_curated_library(state: State<AppState>) -> CmdResult<usize> {
    // 1) Listar los prefabs disponibles en el Hytale local.
    let prefabs = {
        let guard = state.assets.lock().map_err(err)?;
        let reader = guard
            .as_ref()
            .ok_or("Hytale no está disponible: selecciona la instalación")?;
        reader.list_prefabs()
    };

    // 2) Purga TODO el contenido de generación de mundo previo (source_url =
    //    Server/Prefabs/...): así no quedan builds viejas aberrantes ni duplicados.
    //    Se conservan los imports de la comunidad (GitHub/CurseForge/archivo).
    {
        let conn = state.db.lock().map_err(err)?;
        let stale: Vec<i64> = repo::list_builds(&conn)
            .map_err(err)?
            .into_iter()
            .filter(|b| {
                b.source_url
                    .as_deref()
                    .is_some_and(|s| s.starts_with("Server/Prefabs/"))
            })
            .map(|b| b.id)
            .collect();
        for id in stale {
            let _ = repo::delete_build(&conn, id);
        }
    }

    // 3) Resolver cada entrada curada contra un prefab real e importarla.
    let mut used: std::collections::HashSet<String> = std::collections::HashSet::new();
    let hints = curation_hints(&state);
    let mut imported = 0usize;
    for cb in seed::CURATED {
        let Some(entry) = seed::resolve(&prefabs, cb.match_fragment, &used).cloned() else {
            continue;
        };
        used.insert(entry.clone());
        let json = {
            let mut guard = state.assets.lock().map_err(err)?;
            let reader = guard.as_mut().ok_or("Hytale no está disponible")?;
            match reader.read_entry(&entry) {
                Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
                Err(_) => continue,
            }
        };
        let conn = state.db.lock().map_err(err)?;
        let existing = repo::list_builds(&conn).map_err(err)?.len();
        let meta = NewBuild {
            slug: format!("{}-{}", slugify(cb.name), existing + 1),
            name: cb.name.to_string(),
            description: cb.description.to_string(),
            category: cb.category.to_string(),
            style: cb.style.to_string(),
            difficulty: cb.difficulty.to_string(),
            estimated_time_min: cb.estimated_time_min,
            block_count: 0,
            mode: "creative".to_string(),
            thumbnail_ref: None,
            author_name: Some("Hytale (local)".to_string()),
            author_url: None,
            source_url: Some(entry.clone()),
            license_note: Some(
                "Prefab real de tu Hytale; uso local, no redistribuido.".to_string(),
            ),
            voxel_model_ref: None,
        };
        if curation::import_prefab_json(
            &conn,
            &state.voxel_dir,
            &json,
            &meta,
            cb.phases,
            &hints,
            true,
        )
        .is_ok()
        {
            imported += 1;
        }
    }
    Ok(imported)
}

/// Vacía la biblioteca por completo (borra TODAS las builds) y vuelve a cargar los
/// starters limpios. Útil para purgar contenido viejo de generación de mundo
/// (aberrante) importado por versiones anteriores. Devuelve cuántos starters quedaron.
#[tauri::command]
pub fn reset_library_to_starters(state: State<AppState>) -> CmdResult<usize> {
    {
        let conn = state.db.lock().map_err(err)?;
        let ids: Vec<i64> = repo::list_builds(&conn)
            .map_err(err)?
            .into_iter()
            .map(|b| b.id)
            .collect();
        for id in ids {
            let _ = repo::delete_build(&conn, id);
        }
    }
    seed_curated_library(state)
}

#[derive(Debug, Serialize)]
pub struct HytalePrefab {
    pub entry: String,
    pub name: String,
}

/// Lista prefabs de Hytale (filtrados por `query`, máx 300) para elegir cuál importar.
#[tauri::command]
pub fn list_hytale_prefabs(state: State<AppState>, query: String) -> CmdResult<Vec<HytalePrefab>> {
    let guard = state.assets.lock().map_err(err)?;
    let reader = guard.as_ref().ok_or("Hytale no está disponible")?;
    let q = query.trim().to_lowercase();
    let mut out: Vec<HytalePrefab> = reader
        .list_prefabs()
        .into_iter()
        .map(|entry| {
            let name = demo_name_from_entry(&entry);
            HytalePrefab { entry, name }
        })
        .filter(|p| q.is_empty() || p.name.to_lowercase().contains(&q))
        .collect();
    out.sort_by_key(|prefab| prefab.name.to_lowercase());
    out.truncate(300);
    Ok(out)
}

fn pick_demo_prefab(prefabs: &[String]) -> Option<String> {
    const KEYWORDS: &[&str] = &[
        "House", "Hut", "Cottage", "Home", "Building", "Cabin", "Shop", "Tavern", "Tower", "Camp",
        "Shrine", "Bridge",
    ];
    for kw in KEYWORDS {
        if let Some(p) = prefabs.iter().find(|p| p.contains(kw)) {
            return Some(p.clone());
        }
    }
    prefabs.first().cloned()
}

fn demo_name_from_entry(entry: &str) -> String {
    let stem = Path::new(entry)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Build")
        .trim_end_matches(".prefab.json");
    stem.replace(['_', '-'], " ")
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        for (name, body) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    const PREFAB: &str = r#"{"version":8,"blockIdVersion":0,"anchorX":0,"anchorY":0,"anchorZ":0,"blocks":[{"x":0,"y":0,"z":0,"name":"Rock_Stone","rotation":0}]}"#;

    #[test]
    fn read_prefabs_de_zip_con_varias_construcciones() {
        let dir = std::env::temp_dir().join("vf_test_pack.zip");
        write_zip(
            &dir,
            &[
                ("Casa_1.prefab.json", PREFAB),
                ("readme.txt", "no soy un prefab"),
                ("sub/Casa_2.prefab.json", PREFAB),
            ],
        );
        let out = read_prefabs_from_path(dir.to_str().unwrap()).unwrap();
        assert_eq!(
            out.len(),
            2,
            "debe extraer los 2 .prefab.json e ignorar el .txt"
        );
        assert!(out.iter().any(|(_, n)| n == "Casa 1"));
        assert!(out.iter().any(|(_, n)| n == "Casa 2"));
        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn read_prefabs_de_json_suelto() {
        let p = std::env::temp_dir().join("vf_test_solo.prefab.json");
        std::fs::write(&p, PREFAB).unwrap();
        let out = read_prefabs_from_path(p.to_str().unwrap()).unwrap();
        assert_eq!(out.len(), 1);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn read_prefabs_zip_sin_prefab_da_error() {
        let dir = std::env::temp_dir().join("vf_test_vacio.zip");
        write_zip(&dir, &[("readme.txt", "nada")]);
        assert!(read_prefabs_from_path(dir.to_str().unwrap()).is_err());
        let _ = std::fs::remove_file(&dir);
    }

    #[test]
    fn valida_metadatos_antes_de_escribir() {
        let valid = BuildMetaUpdate {
            name: "Casa".into(),
            description: String::new(),
            category: "Vivienda".into(),
            style: "Medieval".into(),
            difficulty: "Media".into(),
            mode: "both".into(),
            estimated_time_min: 30,
        };
        assert!(validate_build_meta(&valid).is_ok());
        assert!(validate_build_meta(&BuildMetaUpdate {
            name: String::new(),
            ..valid
        })
        .is_err());
    }

    #[test]
    fn una_revision_incompatible_no_reemplaza_los_assets_activos() {
        let zip_path = std::env::temp_dir().join(format!(
            "vf_incompatible_assets_{}_{}.zip",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("reloj válido")
                .as_nanos()
        ));
        write_zip(
            &zip_path,
            &[("Server/Item/Items/Broken.json", r#"{"BlockType":"#)],
        );
        let state = AppState::new(
            crate::core::db::open_in_memory().expect("base de datos"),
            None,
            None,
            std::env::temp_dir().join("vf_incompatible_voxels"),
        );

        let error = load_assets_transactionally(&state, zip_path.clone(), true, "test")
            .expect_err("debe rechazar la revisión incompatible");
        assert!(error.contains("definiciones incompatibles"));
        assert_eq!(state.asset_generation(), 0);
        assert!(state.assets.lock().expect("assets").is_none());
        assert!(state.catalog.lock().expect("catálogo").is_none());
        let _ = std::fs::remove_file(zip_path);
    }

    #[test]
    fn valida_rutas_de_assets_de_texto() {
        assert!(
            validate_text_asset_entry("Common/Blocks/Structures/Roofs/Slope_Hay.blockymodel")
                .is_ok()
        );
        assert!(validate_text_asset_entry("Common/Items/Wood.json").is_ok());
        assert!(validate_text_asset_entry("Server/Prefabs/Casa.prefab.json").is_err());
        assert!(validate_text_asset_entry("Common/../Server/secreto.json").is_err());
        assert!(validate_text_asset_entry("Common/BlockTextures/Stone.png").is_err());
    }
}
