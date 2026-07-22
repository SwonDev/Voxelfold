//! Estado compartido de la aplicación Tauri.

use std::fs::{File, Metadata};
use std::io::BufReader;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::Serialize;

use crate::core::assets::{AssetReader, CatalogDiagnostics};
use crate::core::catalog::BlockCatalog;

/// Identidad robusta de un `Assets.zip`. La marca de modificación por sí sola no basta:
/// algunos actualizadores sustituyen el archivo atómicamente conservando su fecha.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AssetFingerprint {
    pub size_bytes: u64,
    pub modified_unix_seconds: Option<u64>,
    pub modified_subsec_nanos: Option<u32>,
    pub created_unix_seconds: Option<u64>,
    pub created_subsec_nanos: Option<u32>,
    pub device_id: Option<u64>,
    pub file_id: Option<u64>,
}

fn timestamp_parts(value: std::io::Result<SystemTime>) -> (Option<u64>, Option<u32>) {
    value
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or((None, None), |duration| {
            (Some(duration.as_secs()), Some(duration.subsec_nanos()))
        })
}

fn fingerprint_from_metadata(metadata: &Metadata) -> AssetFingerprint {
    let (modified_unix_seconds, modified_subsec_nanos) = timestamp_parts(metadata.modified());
    let (created_unix_seconds, created_subsec_nanos) = timestamp_parts(metadata.created());

    #[cfg(unix)]
    let (device_id, file_id) = {
        use std::os::unix::fs::MetadataExt;
        (Some(metadata.dev()), Some(metadata.ino()))
    };
    #[cfg(not(unix))]
    let (device_id, file_id) = (None, None);

    AssetFingerprint {
        size_bytes: metadata.len(),
        modified_unix_seconds,
        modified_subsec_nanos,
        created_unix_seconds,
        created_subsec_nanos,
        device_id,
        file_id,
    }
}

pub fn asset_fingerprint(path: &PathBuf) -> std::io::Result<AssetFingerprint> {
    std::fs::metadata(path).map(|metadata| fingerprint_from_metadata(&metadata))
}

/// Estado global gestionado por Tauri (`app.manage`).
pub struct AppState {
    /// Conexión a la BD (SQLite). `Connection` no es `Sync` → `Mutex`.
    pub db: Mutex<Connection>,
    /// Lector del `Assets.zip` de Hytale, si hay instalación disponible.
    pub assets: Mutex<Option<AssetReader<BufReader<File>>>>,
    /// Catálogo de bloques cacheado (se construye perezosamente).
    pub catalog: Mutex<Option<BlockCatalog>>,
    /// Métricas de la última construcción del catálogo (misma vida útil que la caché).
    pub catalog_diagnostics: Mutex<Option<CatalogDiagnostics>>,
    /// Ruta del `Assets.zip` actualmente abierto (para detectar actualizaciones de Hytale).
    pub assets_path: Mutex<Option<PathBuf>>,
    /// Huella del `Assets.zip` abierto (detecta reemplazos aunque conserven el mtime).
    pub assets_fingerprint: Mutex<Option<AssetFingerprint>>,
    /// `true` si la ruta procede del localizador y debe reevaluarse al aparecer otro canal/latest.
    pub assets_auto_detected: Mutex<bool>,
    /// Revisión monotónica que invalida URLs, materiales, modelos y texturas del frontend.
    pub assets_generation: AtomicU64,
    /// Serializa detecciones/cambios para impedir que dos comandos publiquen la misma revisión.
    pub assets_refresh: Mutex<()>,
    /// Directorio donde se guardan los modelos voxel de las builds.
    pub voxel_dir: PathBuf,
}

impl AppState {
    pub fn new(
        db: Connection,
        assets: Option<AssetReader<BufReader<File>>>,
        assets_path: Option<PathBuf>,
        voxel_dir: PathBuf,
    ) -> Self {
        let has_assets = assets.is_some();
        let assets_fingerprint = has_assets
            .then(|| {
                assets_path
                    .as_ref()
                    .and_then(|path| asset_fingerprint(path).ok())
            })
            .flatten();
        let generation = u64::from(has_assets);
        let auto_detected = assets_path.is_some();
        Self {
            db: Mutex::new(db),
            assets: Mutex::new(assets),
            catalog: Mutex::new(None),
            catalog_diagnostics: Mutex::new(None),
            assets_path: Mutex::new(assets_path),
            assets_fingerprint: Mutex::new(assets_fingerprint),
            assets_auto_detected: Mutex::new(auto_detected),
            assets_generation: AtomicU64::new(generation),
            assets_refresh: Mutex::new(()),
            voxel_dir,
        }
    }

    pub fn asset_generation(&self) -> u64 {
        self.assets_generation.load(Ordering::Acquire)
    }

    pub fn advance_asset_generation(&self) -> u64 {
        self.assets_generation.fetch_add(1, Ordering::AcqRel) + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn huella_detecta_reemplazo_del_archivo() {
        let path = std::env::temp_dir().join(format!(
            "voxelfold_asset_fingerprint_{}_{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("reloj válido")
                .as_nanos()
        ));
        std::fs::write(&path, b"uno").expect("crear archivo");
        let before = asset_fingerprint(&path).expect("primera huella");
        std::fs::write(&path, b"contenido actualizado").expect("actualizar archivo");
        let after = asset_fingerprint(&path).expect("segunda huella");
        assert_ne!(before, after);
        let _ = std::fs::remove_file(path);
    }
}
