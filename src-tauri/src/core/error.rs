//! Tipos de error del Core de Voxelfold.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("error de E/S: {0}")]
    Io(#[from] std::io::Error),

    #[error("error de JSON: {0}")]
    Json(#[from] serde_json::Error),

    #[error("error de ZIP: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("error de base de datos: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("error de migración: {0}")]
    Migration(String),

    #[error("instalación de Hytale no encontrada")]
    HytaleNotFound,

    #[error("entrada no encontrada en el zip: {0}")]
    EntryNotFound(String),

    #[error("versión de prefab no soportada: {0}")]
    UnsupportedPrefabVersion(i64),

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, CoreError>;
