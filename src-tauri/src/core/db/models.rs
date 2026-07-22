//! Modelos de datos persistidos. Serializables para exponerlos por comandos Tauri.

use serde::{Deserialize, Serialize};

/// Datos para crear una build (sin id ni timestamps).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewBuild {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub style: String,
    pub difficulty: String,
    pub estimated_time_min: i64,
    pub block_count: i64,
    pub mode: String,
    pub thumbnail_ref: Option<String>,
    pub author_name: Option<String>,
    pub author_url: Option<String>,
    pub source_url: Option<String>,
    pub license_note: Option<String>,
    pub voxel_model_ref: Option<String>,
}

/// Una build persistida.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Build {
    pub id: i64,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub style: String,
    pub difficulty: String,
    pub estimated_time_min: i64,
    pub block_count: i64,
    pub mode: String,
    pub thumbnail_ref: Option<String>,
    pub author_name: Option<String>,
    pub author_url: Option<String>,
    pub source_url: Option<String>,
    pub license_note: Option<String>,
    pub voxel_model_ref: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewPhase {
    pub build_id: i64,
    pub order_index: i64,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Phase {
    pub id: i64,
    pub build_id: i64,
    pub order_index: i64,
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewStep {
    pub phase_id: i64,
    pub order_index: i64,
    pub title: String,
    pub instruction: String,
    pub preview_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Step {
    pub id: i64,
    pub phase_id: i64,
    pub order_index: i64,
    pub title: String,
    pub instruction: String,
    pub preview_ref: Option<String>,
}

/// Estado de progreso de una build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuildStatus {
    NotStarted,
    InProgress,
    Completed,
}

impl BuildStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            BuildStatus::NotStarted => "not_started",
            BuildStatus::InProgress => "in_progress",
            BuildStatus::Completed => "completed",
        }
    }

    pub fn from_db(s: &str) -> BuildStatus {
        match s {
            "in_progress" => BuildStatus::InProgress,
            "completed" => BuildStatus::Completed,
            _ => BuildStatus::NotStarted,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Progress {
    pub build_id: i64,
    pub status: BuildStatus,
    pub current_phase_id: Option<i64>,
}

/// Una entrada del checklist de materiales (lo que el jugador lleva reunido).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub block_name: String,
    pub gathered_qty: i64,
}

/// Una línea de materiales cacheada (total o por fase).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MaterialRow {
    pub block_name: String,
    pub qty: i64,
}
