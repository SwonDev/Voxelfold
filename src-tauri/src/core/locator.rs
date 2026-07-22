//! Localización de la instalación de Hytale por sistema operativo, con validación.
//! Ruta real en macOS confirmada en el spike:
//! `~/Library/Application Support/Hytale/install/release/package/game/latest/Assets.zip`.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::core::error::{CoreError, Result};

/// Una instalación válida de Hytale. `root` apunta a `.../game/latest`.
#[derive(Debug, Clone, Serialize)]
pub struct HytaleInstall {
    pub root: PathBuf,
}

impl HytaleInstall {
    /// Ruta al `Assets.zip` dentro de la instalación.
    pub fn assets_zip(&self) -> PathBuf {
        self.root.join("Assets.zip")
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Rutas candidatas directas (ruta rápida conocida) según el SO.
pub fn candidate_paths() -> Vec<PathBuf> {
    let suffix = "install/release/package/game/latest";
    hytale_bases().into_iter().map(|b| b.join(suffix)).collect()
}

/// Carpetas base donde Hytale puede estar instalado, según el SO.
fn hytale_bases() -> Vec<PathBuf> {
    let mut bases = Vec::new();

    #[cfg(target_os = "macos")]
    if let Some(home) = home_dir() {
        bases.push(home.join("Library/Application Support/Hytale"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(a) = std::env::var_os("APPDATA") {
            bases.push(PathBuf::from(a).join("Hytale"));
        }
        if let Some(a) = std::env::var_os("LOCALAPPDATA") {
            bases.push(PathBuf::from(a).join("Hytale"));
        }
    }

    #[cfg(target_os = "linux")]
    if let Some(home) = home_dir() {
        bases.push(home.join(".local/share/Hytale"));
        // Flatpak
        bases.push(home.join(".var/app/com.hypixelstudios.Hytale/data/Hytale"));
    }

    bases
}

fn read_dir_names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

/// Escanea `base/install/<canal>/package/game/<versión>/Assets.zip`, probando
/// cualquier canal (release, beta…) y versión, y prefiriendo `latest`.
fn find_in_base(base: &Path) -> Option<PathBuf> {
    let install = base.join("install");
    if !install.is_dir() {
        return None;
    }
    let mut found: Vec<PathBuf> = Vec::new();
    for channel in read_dir_names(&install) {
        let game = install.join(&channel).join("package/game");
        if !game.is_dir() {
            continue;
        }
        for ver in read_dir_names(&game) {
            let root = game.join(&ver);
            if root.join("Assets.zip").is_file() {
                found.push(root);
            }
        }
    }
    found
        .iter()
        .find(|p| p.ends_with("latest"))
        .cloned()
        .or_else(|| found.into_iter().next())
}

/// Valida que una ruta contiene una instalación de Hytale (existe `Assets.zip`).
pub fn validate(path: impl AsRef<Path>) -> Result<HytaleInstall> {
    let root = path.as_ref().to_path_buf();
    if root.join("Assets.zip").is_file() {
        Ok(HytaleInstall { root })
    } else {
        Err(CoreError::HytaleNotFound)
    }
}

/// Localiza automáticamente la instalación: primero la ruta directa conocida y, si
/// no, escaneando los canales/versiones bajo cada carpeta base de Hytale.
pub fn locate() -> Result<HytaleInstall> {
    for candidate in candidate_paths() {
        if let Ok(install) = validate(&candidate) {
            return Ok(install);
        }
    }
    for base in hytale_bases() {
        if let Some(root) = find_in_base(&base) {
            return Ok(HytaleInstall { root });
        }
    }
    Err(CoreError::HytaleNotFound)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_falla_sin_assets_zip() {
        // temp_dir no contiene un Assets.zip
        assert!(validate(std::env::temp_dir()).is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn candidatos_macos_incluye_ruta_application_support() {
        let paths = candidate_paths();
        assert!(paths.iter().any(|p| {
            p.to_string_lossy()
                .contains("Library/Application Support/Hytale")
                && p.ends_with("latest")
        }));
    }

    #[test]
    fn find_in_base_escanea_canales_y_prefiere_latest() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("vf_locator_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        // Crea install/beta/package/game/{1.2.3,latest}/Assets.zip
        let game = base.join("install/beta/package/game");
        for ver in ["1.2.3", "latest"] {
            let dir = game.join(ver);
            fs::create_dir_all(&dir).unwrap();
            fs::write(dir.join("Assets.zip"), b"zip").unwrap();
        }
        let found = find_in_base(&base).expect("debe encontrar una instalación");
        assert!(found.ends_with("latest"), "prefiere la carpeta 'latest'");
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    #[ignore = "requiere instalación real de Hytale"]
    fn locate_encuentra_instalacion_real() {
        let install = locate().expect("Hytale debe estar instalado");
        assert!(install.assets_zip().is_file());
    }
}
