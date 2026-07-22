pub mod core;

mod asset_protocol;
mod commands;
mod community;
mod curseforge;
mod state;
pub mod wiki;

use std::io;
use std::path::Path;

use tauri::Manager;

use crate::core::assets::AssetReader;
use crate::core::{db, locator};
use crate::state::AppState;

const LEGACY_APP_IDENTIFIER: &str = "com.voxelfold.app";
const DATA_MIGRATION_MARKER: &str = ".migrated_from_com.voxelfold.app";

/// Copia de forma conservadora los datos del identificador antiguo al nuevo.
///
/// El directorio anterior se conserva como respaldo. Cada archivo se publica mediante
/// `rename` desde un temporal para que una interrupción nunca deje una base de datos a
/// medio copiar. El proceso es idempotente y no reemplaza archivos creados por la versión
/// nueva de la aplicación.
fn migrate_legacy_data_dir(legacy_dir: &Path, data_dir: &Path) -> io::Result<bool> {
    if !legacy_dir.is_dir() || data_dir.join(DATA_MIGRATION_MARKER).exists() {
        return Ok(false);
    }

    std::fs::create_dir_all(data_dir)?;
    copy_missing_tree(legacy_dir, data_dir)?;

    let marker_tmp = data_dir.join(format!(
        "{DATA_MIGRATION_MARKER}.tmp-{}",
        std::process::id()
    ));
    std::fs::write(&marker_tmp, LEGACY_APP_IDENTIFIER.as_bytes())?;
    std::fs::rename(marker_tmp, data_dir.join(DATA_MIGRATION_MARKER))?;
    Ok(true)
}

fn copy_missing_tree(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let target = destination.join(entry.file_name());

        if file_type.is_dir() {
            std::fs::create_dir_all(&target)?;
            copy_missing_tree(&entry.path(), &target)?;
        } else if file_type.is_file() && !target.exists() {
            let file_name = entry.file_name();
            let file_name = file_name.to_string_lossy();
            let temporary =
                destination.join(format!(".{file_name}.migration-{}", std::process::id()));
            if temporary.exists() {
                std::fs::remove_file(&temporary)?;
            }
            std::fs::copy(entry.path(), &temporary)?;
            std::fs::rename(temporary, target)?;
        }
        // No se siguen enlaces simbólicos dentro de datos de usuario.
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Custom protocol que sirve iconos/texturas reales del Assets.zip local.
        .register_asynchronous_uri_scheme_protocol("voxelfold-asset", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().trim_start_matches('/').to_string();
            std::thread::spawn(move || {
                let response = asset_protocol::serve(&app, &path);
                responder.respond(response);
            });
        })
        .setup(|app| {
            // BD en el directorio de datos de la app.
            let data_dir = app.path().app_data_dir()?;
            if let Some(application_support) = data_dir.parent() {
                let legacy_dir = application_support.join(LEGACY_APP_IDENTIFIER);
                migrate_legacy_data_dir(&legacy_dir, &data_dir)?;
            }
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open_at(data_dir.join("voxelfold.db"))?;
            // Intentar abrir Hytale automáticamente (si no, el usuario lo selecciona luego).
            let assets_path = locator::locate().ok().map(|install| install.assets_zip());
            let assets = assets_path.as_ref().and_then(|p| AssetReader::open(p).ok());
            let voxel_dir = data_dir.join("voxels");
            app.manage(AppState::new(conn, assets, assets_path, voxel_dir));

            // LIMPIEZA + RE-SIEMBRA única (migración): purga las builds-prefab VIEJAS (contenido
            // aberrante importado por versiones anteriores: marcadores, etc.) y vuelve a importar los
            // starters NATIVOS limpios con el pipeline actual (filtra marcadores, arregla render). Se
            // ejecuta una sola vez por versión (flag en disco). Conserva las builds propias/comunidad.
            let reseed_flag = data_dir.join(".starters_reseeded_v5");
            if !reseed_flag.exists() {
                let state = app.state::<AppState>();
                if commands::seed_curated_library(state).is_ok() {
                    let _ = std::fs::write(&reseed_flag, b"v5");
                }
            }

            // Los prefabs v8 repiten los bloques multicelda en sus posiciones filler. Las
            // versiones anteriores los guardaban como anclas independientes y superponían
            // puertas/camas/muebles completos. Esta reparación conserva builds, progreso,
            // favoritos y metadatos; solo canonicaliza modelos, materiales y recuentos.
            let multicell_flag = data_dir.join(".multicell_fillers_repaired_v1");
            if !multicell_flag.exists() {
                let state = app.state::<AppState>();
                if commands::repair_multicell_models(state).is_ok() {
                    let _ = std::fs::write(&multicell_flag, b"v1");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_install_status,
            commands::read_text_asset,
            commands::set_install_path,
            commands::hytale_ready,
            commands::retry_locate,
            commands::refresh_hytale,
            commands::get_block_catalog,
            commands::get_asset_compatibility,
            commands::block_wiki,
            commands::list_builds,
            commands::list_build_summaries,
            commands::update_build_meta,
            commands::update_phase,
            commands::update_step,
            commands::create_build,
            commands::delete_build,
            commands::add_phase,
            commands::delete_phase,
            commands::reorder_phases,
            commands::add_step,
            commands::delete_step,
            commands::reorder_steps,
            commands::set_phase_materials,
            commands::export_build,
            commands::import_build,
            commands::set_thumbnail,
            commands::get_build_detail,
            commands::toggle_favorite,
            commands::list_favorites,
            commands::get_progress,
            commands::set_progress,
            commands::set_step_completed,
            commands::get_completed_steps,
            commands::reset_progress,
            commands::set_material_gathered,
            commands::get_checklist,
            commands::get_build_voxels,
            commands::set_build_voxels,
            commands::create_demo_build,
            commands::seed_curated_library,
            commands::reset_library_to_starters,
            commands::import_hytale_prefab,
            commands::import_prefab_file,
            commands::import_prefab_folder,
            commands::import_prefab_archive,
            commands::search_community_prefabs,
            commands::fetch_community_repo,
            commands::list_community_prefabs,
            commands::import_community_prefab,
            commands::curseforge_key_status,
            commands::curseforge_set_key,
            commands::curseforge_search,
            commands::curseforge_import,
            commands::curseforge_import_url,
            commands::get_catalog_locale_info,
            commands::set_catalog_locale,
            commands::list_hytale_prefabs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod data_migration_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("reloj válido")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "voxelfold_{label}_{}_{}",
            std::process::id(),
            nonce
        ))
    }

    #[test]
    fn migrates_legacy_database_voxels_and_flags_without_deleting_source() {
        let root = temp_root("migrate_data");
        let legacy = root.join(LEGACY_APP_IDENTIFIER);
        let current = root.join("com.swondev.voxelfold");
        std::fs::create_dir_all(legacy.join("voxels")).unwrap();
        std::fs::write(legacy.join("voxelfold.db"), b"database").unwrap();
        std::fs::write(legacy.join("voxelfold.db-wal"), b"wal").unwrap();
        std::fs::write(legacy.join("voxels/build-1.json"), b"voxels").unwrap();
        std::fs::write(legacy.join(".starters_reseeded_v5"), b"v5").unwrap();

        assert!(migrate_legacy_data_dir(&legacy, &current).unwrap());
        assert_eq!(
            std::fs::read(current.join("voxelfold.db")).unwrap(),
            b"database"
        );
        assert_eq!(
            std::fs::read(current.join("voxelfold.db-wal")).unwrap(),
            b"wal"
        );
        assert_eq!(
            std::fs::read(current.join("voxels/build-1.json")).unwrap(),
            b"voxels"
        );
        assert!(current.join(DATA_MIGRATION_MARKER).is_file());
        assert!(legacy.join("voxelfold.db").is_file());
        assert!(!migrate_legacy_data_dir(&legacy, &current).unwrap());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn migration_never_overwrites_newer_destination_files() {
        let root = temp_root("migrate_preserve");
        let legacy = root.join(LEGACY_APP_IDENTIFIER);
        let current = root.join("com.swondev.voxelfold");
        std::fs::create_dir_all(&legacy).unwrap();
        std::fs::create_dir_all(&current).unwrap();
        std::fs::write(legacy.join("voxelfold.db"), b"old").unwrap();
        std::fs::write(current.join("voxelfold.db"), b"new").unwrap();

        assert!(migrate_legacy_data_dir(&legacy, &current).unwrap());
        assert_eq!(std::fs::read(current.join("voxelfold.db")).unwrap(), b"new");

        std::fs::remove_dir_all(root).unwrap();
    }
}
