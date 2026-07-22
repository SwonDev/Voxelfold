//! Parser de `*.prefab.json` de Hytale (formato real v8) a un `VoxelModel` interno.
//!
//! Esquema real confirmado en el spike (docs/spikes/2026-06-13-hytale-formato.md):
//! `{ version, blockIdVersion, anchorX/Y/Z, blocks: [{ x, y, z, name, rotation? }] }`.
//! Coordenadas absolutas (pueden ser negativas), `"Empty"` = hueco, sin `Size` ni `Palette`.

use std::path::Path;

use serde::Deserialize;

use crate::core::error::Result;

/// Nombre de bloque que representa un hueco (se excluye del modelo y de los materiales).
pub const EMPTY_BLOCK: &str = "Empty";

/// ¿Es un marcador de generación de mundo (no un bloque real)?
///
/// Los prefabs de generación llevan marcadores que el motor sustituye al generar el
/// mundo (terreno, árboles, menas…) y que NO deben renderizarse: aparecerían como
/// bloques planos sin textura o como huecos. Confirmado en la auditoría del catálogo:
/// `Empty`, `Barrier`, `Filter_*`, plantillas y spawners/objetivos/geyser/trigger que el
/// motor sustituye o consume como lógica. Estos últimos pueden traer icono, pero no son
/// piezas construibles y no deben contar como material ni aparecer en el editor.
pub fn is_generation_marker(name: &str) -> bool {
    let raw = name.strip_prefix('*').unwrap_or(name);
    let base = raw
        .split_once("_State_Definitions_")
        .map_or(raw, |(base, _)| base);
    let lower = base.to_ascii_lowercase();
    let internal_segment = lower
        .split('_')
        .any(|part| matches!(part, "tmp" | "prototype" | "debug"));

    lower == "empty"
        || lower == "barrier"
        || lower.starts_with("filter_")
        || lower.starts_with("template_")
        || lower.starts_with("exampleprefabplacement")
        || lower.contains("spawner")
        || lower.contains("geyzer")
        || lower.contains("geyser")
        || lower.contains("objective_")
        || lower.contains("placeholder")
        || lower.contains("trigger")
        || lower.starts_with("test_")
        || lower.ends_with("_test")
        || lower.contains("[tmp]")
        || internal_segment
}

/// Versiones del formato de prefab que el parser entiende explícitamente.
pub const SUPPORTED_PREFAB_VERSIONS: &[i64] = &[8];

// ---- Esquema crudo (tal cual en el JSON de Hytale) ----

#[derive(Debug, Deserialize)]
struct RawPrefab {
    #[serde(default)]
    version: i64,
    #[serde(default, rename = "blockIdVersion")]
    block_id_version: i64,
    #[serde(default, rename = "anchorX")]
    anchor_x: i32,
    #[serde(default, rename = "anchorY")]
    anchor_y: i32,
    #[serde(default, rename = "anchorZ")]
    anchor_z: i32,
    #[serde(default)]
    blocks: Vec<RawBlock>,
}

#[derive(Debug, Deserialize)]
struct RawBlock {
    x: i32,
    y: i32,
    z: i32,
    name: String,
    #[serde(default)]
    rotation: i32,
}

// ---- Modelo interno ----

/// Un bloque colocado en coordenadas absolutas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Block {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub name: String,
    pub rotation: i32,
}

/// Representación voxel de una build, derivada de un prefab. No es un archivo de Hytale.
#[derive(Debug, Clone)]
pub struct VoxelModel {
    pub version: i64,
    pub block_id_version: i64,
    /// Origen/ancla (`anchorX/Y/Z`).
    pub origin: (i32, i32, i32),
    /// Bloques reales (sin `Empty`).
    pub blocks: Vec<Block>,
    /// Tamaño derivado del bounding box de los bloques.
    pub size: (u32, u32, u32),
}

impl VoxelModel {
    /// Parsea un prefab desde una cadena JSON.
    pub fn from_json(json: &str) -> Result<Self> {
        let raw: RawPrefab = serde_json::from_str(json)?;
        let blocks: Vec<Block> = raw
            .blocks
            .into_iter()
            .filter(|b| !is_generation_marker(&b.name))
            .map(|b| Block {
                x: b.x,
                y: b.y,
                z: b.z,
                name: b.name,
                rotation: b.rotation,
            })
            .collect();
        let size = compute_size(&blocks);
        Ok(VoxelModel {
            version: raw.version,
            block_id_version: raw.block_id_version,
            origin: (raw.anchor_x, raw.anchor_y, raw.anchor_z),
            blocks,
            size,
        })
    }

    /// Parsea un prefab desde un archivo en disco.
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self> {
        let json = std::fs::read_to_string(path)?;
        Self::from_json(&json)
    }

    /// Indica si la versión del prefab está soportada explícitamente.
    pub fn is_version_supported(&self) -> bool {
        SUPPORTED_PREFAB_VERSIONS.contains(&self.version)
    }

    /// Recalcula el bounding box después de filtrar marcadores o celdas filler.
    pub fn recompute_size(&mut self) {
        self.size = compute_size(&self.blocks);
    }
}

/// Calcula el tamaño (extensión) a partir del bounding box de los bloques.
fn compute_size(blocks: &[Block]) -> (u32, u32, u32) {
    if blocks.is_empty() {
        return (0, 0, 0);
    }
    let (mut min_x, mut min_y, mut min_z) = (i32::MAX, i32::MAX, i32::MAX);
    let (mut max_x, mut max_y, mut max_z) = (i32::MIN, i32::MIN, i32::MIN);
    for b in blocks {
        min_x = min_x.min(b.x);
        min_y = min_y.min(b.y);
        min_z = min_z.min(b.z);
        max_x = max_x.max(b.x);
        max_y = max_y.max(b.y);
        max_z = max_z.max(b.z);
    }
    // En i64 + clamp: las coordenadas son ABSOLUTAS y pueden ser negativas y muy grandes; en
    // i32 un prefab malformado (p. ej. x=MIN y x=MAX) desbordaría (panic en debug, basura en
    // release). Con blocks vacío, max-min sale negativo y el clamp lo deja en 0.
    let span =
        |max: i32, min: i32| ((max as i64 - min as i64 + 1).clamp(0, u32::MAX as i64)) as u32;
    (span(max_x, min_x), span(max_y, min_y), span(max_z, min_z))
}

#[cfg(test)]
mod marker_tests {
    use super::is_generation_marker;

    #[test]
    fn distingue_marcadores_de_bloques_construibles() {
        for name in [
            "Empty",
            "Barrier",
            "Filter_Ores",
            "ExamplePrefabPlacementBlock_Tree",
            "Block_Spawner_Block",
            "Spawner_Rat",
            "Objective_Capture",
            "Template_Base",
            "[TMP]_Extrude_Tool",
        ] {
            assert!(is_generation_marker(name), "{name} debe filtrarse");
        }
        for name in ["Rock_Stone", "Wood_Softwood_Planks", "Crude_Door"] {
            assert!(!is_generation_marker(name), "{name} es construible");
        }
    }
}
