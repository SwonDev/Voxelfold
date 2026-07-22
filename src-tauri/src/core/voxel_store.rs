//! Almacenamiento del modelo voxel curado de cada build (JSON por archivo).
//! No es un archivo de Hytale: es nuestra representación derivada, con fases asignadas.

use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::core::error::{CoreError, Result};
use crate::core::prefab::is_generation_marker;

const MAX_MODEL_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_MODEL_BLOCKS: usize = 500_000;
const MAX_PHASES: u32 = 256;
const MAX_SPAN: u32 = 100_000;

/// Un bloque del modelo curado, con su fase asignada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredVoxel {
    pub x: i32,
    pub y: i32,
    pub z: i32,
    pub name: String,
    #[serde(default)]
    pub rotation: i32,
    pub phase: u32,
}

/// Modelo voxel completo de una build, listo para el visor 3D.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredModel {
    pub size: (u32, u32, u32),
    pub origin: (i32, i32, i32),
    pub phases: u32,
    pub blocks: Vec<StoredVoxel>,
}

impl StoredModel {
    /// Valida modelos procedentes tanto del editor como de archivos compartidos antes de que
    /// lleguen al renderizador, a SQLite o al almacenamiento local.
    pub fn validate(&self) -> Result<()> {
        if self.phases == 0 || self.phases > MAX_PHASES {
            return Err(CoreError::Other(format!(
                "el modelo debe tener entre 1 y {MAX_PHASES} fases"
            )));
        }
        if self.blocks.len() > MAX_MODEL_BLOCKS {
            return Err(CoreError::Other(format!(
                "el modelo supera el límite de {MAX_MODEL_BLOCKS} bloques"
            )));
        }

        let mut positions = HashSet::with_capacity(self.blocks.len());
        let mut bounds: Option<(i32, i32, i32, i32, i32, i32)> = None;
        for block in &self.blocks {
            let name = block.name.trim();
            if name.is_empty() || name.len() > 512 || name.chars().any(char::is_control) {
                return Err(CoreError::Other(
                    "el modelo contiene un nombre de bloque no válido".into(),
                ));
            }
            if block.phase >= self.phases {
                return Err(CoreError::Other(format!(
                    "el bloque {name} apunta a una fase inexistente"
                )));
            }
            // `RotationTuple.index(yaw, pitch, roll)` = roll*16 + pitch*4 + yaw.
            // Cada eje tiene cuatro cuartos de vuelta: el rango oficial completo es 0..63.
            if !(0..=63).contains(&block.rotation) {
                return Err(CoreError::Other(format!(
                    "el bloque {name} tiene una rotación no válida"
                )));
            }
            if !positions.insert((block.x, block.y, block.z)) {
                return Err(CoreError::Other(format!(
                    "hay más de un bloque en ({}, {}, {})",
                    block.x, block.y, block.z
                )));
            }
            bounds = Some(match bounds {
                None => (block.x, block.x, block.y, block.y, block.z, block.z),
                Some((min_x, max_x, min_y, max_y, min_z, max_z)) => (
                    min_x.min(block.x),
                    max_x.max(block.x),
                    min_y.min(block.y),
                    max_y.max(block.y),
                    min_z.min(block.z),
                    max_z.max(block.z),
                ),
            });
        }

        let span = |min: i32, max: i32| (max as i64 - min as i64 + 1) as u64;
        let expected = bounds
            .map(|(min_x, max_x, min_y, max_y, min_z, max_z)| {
                (span(min_x, max_x), span(min_y, max_y), span(min_z, max_z))
            })
            .unwrap_or((0, 0, 0));
        if expected.0 > MAX_SPAN as u64
            || expected.1 > MAX_SPAN as u64
            || expected.2 > MAX_SPAN as u64
        {
            return Err(CoreError::Other(format!(
                "el modelo supera la extensión máxima de {MAX_SPAN} bloques por eje"
            )));
        }
        if self.size != (expected.0 as u32, expected.1 as u32, expected.2 as u32) {
            return Err(CoreError::Other(format!(
                "el tamaño declarado {:?} no coincide con el contenido ({}, {}, {})",
                self.size, expected.0, expected.1, expected.2
            )));
        }
        Ok(())
    }

    /// Recalcula el tamaño declarado tras una migración conservadora del contenido.
    pub fn recompute_size(&mut self) {
        self.size = model_size(&self.blocks);
    }
}

/// Ruta del archivo de modelo de una build dentro del directorio de voxels.
fn model_path(dir: impl AsRef<Path>, build_id: i64) -> PathBuf {
    dir.as_ref().join(format!("{build_id}.json"))
}

/// Guarda el modelo voxel de una build y devuelve la ruta del archivo.
pub fn save(dir: impl AsRef<Path>, build_id: i64, model: &StoredModel) -> Result<String> {
    model.validate()?;
    std::fs::create_dir_all(dir.as_ref())?;
    let path = model_path(&dir, build_id);
    std::fs::write(&path, serde_json::to_vec(model)?)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Carga el modelo voxel de una build.
pub fn load(dir: impl AsRef<Path>, build_id: i64) -> Result<StoredModel> {
    let path = model_path(&dir, build_id);
    let file = File::open(path)?;
    if file.metadata()?.len() > MAX_MODEL_BYTES {
        return Err(CoreError::Other("el modelo guardado supera 256 MiB".into()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_MODEL_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_MODEL_BYTES {
        return Err(CoreError::Other("el modelo guardado supera 256 MiB".into()));
    }
    let mut model: StoredModel = serde_json::from_slice(&bytes)?;
    model.validate()?;
    let old_len = model.blocks.len();
    model
        .blocks
        .retain(|block| !is_generation_marker(&block.name));
    if model.blocks.len() != old_len {
        model.size = model_size(&model.blocks);
    }
    Ok(model)
}

fn model_size(blocks: &[StoredVoxel]) -> (u32, u32, u32) {
    let Some(first) = blocks.first() else {
        return (0, 0, 0);
    };
    let (mut min_x, mut max_x) = (first.x, first.x);
    let (mut min_y, mut max_y) = (first.y, first.y);
    let (mut min_z, mut max_z) = (first.z, first.z);
    for block in &blocks[1..] {
        min_x = min_x.min(block.x);
        max_x = max_x.max(block.x);
        min_y = min_y.min(block.y);
        max_y = max_y.max(block.y);
        min_z = min_z.min(block.z);
        max_z = max_z.max(block.z);
    }
    let span = |min: i32, max: i32| (max as i64 - min as i64 + 1) as u32;
    (span(min_x, max_x), span(min_y, max_y), span(min_z, max_z))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(x: i32, phase: u32) -> StoredVoxel {
        StoredVoxel {
            x,
            y: 0,
            z: 0,
            name: "Rock_Stone".into(),
            rotation: 0,
            phase,
        }
    }

    #[test]
    fn valida_modelo_coherente() {
        let model = StoredModel {
            size: (2, 1, 1),
            origin: (0, 0, 0),
            phases: 2,
            blocks: vec![block(0, 0), block(1, 1)],
        };
        assert!(model.validate().is_ok());
    }

    #[test]
    fn rechaza_posiciones_duplicadas_y_fases_fuera_de_rango() {
        let duplicate = StoredModel {
            size: (1, 1, 1),
            origin: (0, 0, 0),
            phases: 1,
            blocks: vec![block(0, 0), block(0, 0)],
        };
        assert!(duplicate.validate().is_err());
        let invalid_phase = StoredModel {
            blocks: vec![block(0, 1)],
            ..duplicate
        };
        assert!(invalid_phase.validate().is_err());
    }

    #[test]
    fn acepta_el_rango_oficial_completo_de_rotation_tuple() {
        let mut model = StoredModel {
            size: (1, 1, 1),
            origin: (0, 0, 0),
            phases: 1,
            blocks: vec![block(0, 0)],
        };
        model.blocks[0].rotation = 63;
        assert!(model.validate().is_ok());

        model.blocks[0].rotation = 64;
        assert!(model.validate().is_err());
    }

    #[test]
    fn load_elimina_marcadores_heredados_y_recalcula_tamano() {
        let dir = std::env::temp_dir().join("voxelfold_marker_load_test");
        let _ = std::fs::create_dir_all(&dir);
        let model = StoredModel {
            size: (11, 1, 1),
            origin: (0, 0, 0),
            phases: 1,
            blocks: vec![
                block(0, 0),
                StoredVoxel {
                    x: 10,
                    y: 0,
                    z: 0,
                    name: "Block_Spawner_Block".into(),
                    rotation: 0,
                    phase: 0,
                },
            ],
        };
        save(&dir, 991_337, &model).unwrap();
        let loaded = load(&dir, 991_337).unwrap();
        assert_eq!(loaded.blocks.len(), 1);
        assert_eq!(loaded.size, (1, 1, 1));
    }
}
