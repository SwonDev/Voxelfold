//! Curación: convierte un prefab en una build construible (modelo voxel con fases,
//! materiales totales y por fase). Fases automáticas por altura (D7: auto + ajuste manual futuro).

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, Connection};

use crate::core::catalog::BlockCatalog;
use crate::core::db::models::{MaterialRow, NewBuild, NewPhase, NewStep};
use crate::core::db::repo;
use crate::core::error::{CoreError, Result};
use crate::core::materials;
use crate::core::multicell;
use crate::core::prefab::VoxelModel;
use crate::core::voxel_store::{self, StoredModel, StoredVoxel, MAX_MODEL_BLOCKS};

/// Pistas de curación derivadas del catálogo. Por ahora solo el conjunto de bloques
/// de detalle/remate (mobiliario, decoración, plantas, luces) que van a la última fase.
/// NO se descarta ningún bloque: el prefab se importa íntegro (con suelo y todo).
#[derive(Default)]
pub struct CurationHints {
    pub detail: HashSet<String>,
    /// Catálogo efectivo para distinguir anclas de las copias filler que serializa Hytale.
    pub catalog: BlockCatalog,
}

/// Tamaño (bounding box) de un conjunto de bloques.
fn bbox_size(blocks: &[StoredVoxel]) -> (u32, u32, u32) {
    if blocks.is_empty() {
        return (0, 0, 0);
    }
    let (mut nx, mut ny, mut nz) = (i32::MAX, i32::MAX, i32::MAX);
    let (mut xx, mut xy, mut xz) = (i32::MIN, i32::MIN, i32::MIN);
    for b in blocks {
        nx = nx.min(b.x);
        ny = ny.min(b.y);
        nz = nz.min(b.z);
        xx = xx.max(b.x);
        xy = xy.max(b.y);
        xz = xz.max(b.z);
    }
    // i64 + clamp: coords absolutas (posibles negativas/extremas) → en i32 desbordaría con un
    // prefab malformado (panic en debug). Con blocks vacío el clamp devuelve 0.
    let span =
        |max: i32, min: i32| ((max as i64 - min as i64 + 1).clamp(0, u32::MAX as i64)) as u32;
    (span(xx, nx), span(xy, ny), span(xz, nz))
}

/// Asigna a cada bloque una fase. Banda 0 = más abajo (cimentación) … banda N-1 = remate.
///
/// - Los bloques cuyo nombre esté en `detail` (mobiliario, decoración, plantas, luces…)
///   van a la **última fase** (detalle/remate), independientemente de su altura.
/// - El resto (estructura) se reparte sobre los **niveles Y realmente poblados** (no
///   el rango bruto), de modo que los huecos no generen fases casi vacías.
///
/// Si `detail` está vacío, se reparte todo por altura en `num_phases` bandas.
pub fn assign_phases(model: &VoxelModel, num_phases: u32, detail: &HashSet<String>) -> StoredModel {
    let n = num_phases.max(1);
    let is_detail = |name: &str| n > 1 && detail.contains(name);
    let has_detail = model.blocks.iter().any(|b| is_detail(&b.name));
    let n_struct = if has_detail { n - 1 } else { n };

    // Niveles Y poblados por bloques estructurales (excluye los de detalle).
    let mut levels: Vec<i32> = model
        .blocks
        .iter()
        .filter(|b| !is_detail(&b.name))
        .map(|b| b.y)
        .collect();
    levels.sort_unstable();
    levels.dedup();
    let level_count = levels.len().max(1) as i64;
    let rank: HashMap<i32, i64> = levels
        .iter()
        .enumerate()
        .map(|(i, &y)| (y, i as i64))
        .collect();

    let blocks: Vec<StoredVoxel> = model
        .blocks
        .iter()
        .map(|b| {
            let phase = if is_detail(&b.name) {
                n - 1
            } else {
                let idx = *rank.get(&b.y).unwrap_or(&0);
                ((idx * n_struct as i64) / level_count).min(n_struct as i64 - 1) as u32
            };
            StoredVoxel {
                x: b.x,
                y: b.y,
                z: b.z,
                name: b.name.clone(),
                rotation: b.rotation,
                phase,
            }
        })
        .collect();

    let size = bbox_size(&blocks);
    StoredModel {
        size,
        origin: model.origin,
        phases: n,
        blocks,
    }
}

/// Nombre descriptivo de una fase según su posición (de cimentación a remate).
fn phase_name(i: u32, n: u32) -> String {
    const NAMES: &[&str] = &[
        "Cimentación",
        "Base y suelo",
        "Paredes",
        "Estructura",
        "Tejado",
        "Detalles y remate",
    ];
    if n <= 1 {
        return "Construcción completa".to_string();
    }
    let idx = ((i as f64 / (n - 1) as f64) * (NAMES.len() - 1) as f64).round() as usize;
    NAMES[idx.min(NAMES.len() - 1)].to_string()
}

/// Materiales (conteo por nombre base) de los bloques de una fase concreta.
fn phase_material_rows(model: &StoredModel, phase: u32) -> Vec<MaterialRow> {
    let mut counts: BTreeMap<&str, i64> = BTreeMap::new();
    for b in model.blocks.iter().filter(|b| b.phase == phase) {
        if crate::core::prefab::is_generation_marker(&b.name) {
            continue;
        }
        *counts
            .entry(crate::core::materials::base_name(&b.name))
            .or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(block_name, qty)| MaterialRow {
            block_name: block_name.to_string(),
            qty,
        })
        .collect()
}

/// Guarda/actualiza el modelo voxel de una build (editor visual): persiste el
/// modelo, crea las fases que falten para cubrir `model.phases` y resincroniza los
/// materiales por fase (según el índice de fase de cada voxel) y el total.
pub fn set_voxel_model(
    conn: &Connection,
    voxel_dir: impl AsRef<Path>,
    build_id: i64,
    model: &StoredModel,
) -> Result<()> {
    // Todo en una transacción: si algo falla, no queda el modelo enlazado con fases/materiales
    // a medias.
    let tx = conn.unchecked_transaction()?;
    let ref_path = voxel_store::save(&voxel_dir, build_id, model)?;
    tx.execute(
        "UPDATE builds SET voxel_model_ref = ?1, block_count = ?2 WHERE id = ?3",
        params![ref_path, model.blocks.len() as i64, build_id],
    )?;

    // Asegurar que existan al menos `model.phases` fases (crear las que falten).
    let mut existing = repo::phases_for_build(&tx, build_id)?.len() as u32;
    while existing < model.phases {
        let name = phase_name(existing, model.phases);
        let phase_id = repo::add_phase(
            &tx,
            &NewPhase {
                build_id,
                order_index: existing as i64,
                name: name.clone(),
                description: String::new(),
            },
        )?;
        repo::add_step(
            &tx,
            &NewStep {
                phase_id,
                order_index: 0,
                title: format!("Coloca los bloques de «{}»", name),
                instruction: String::new(),
                preview_ref: None,
            },
        )?;
        existing += 1;
    }

    // Materiales por POSICIÓN ORDINAL de la fase (0..N), no por su `order_index`: el campo
    // `phase` de cada voxel es el índice 0-based de la pestaña del editor; si las fases tienen
    // huecos en order_index (tras borrar/reordenar), mapear por order_index descuadraría los
    // materiales. Iteramos en orden y usamos enumerate.
    let mut phases = repo::phases_for_build(&tx, build_id)?;
    phases.sort_by_key(|p| p.order_index);
    for (idx, ph) in phases.iter().enumerate() {
        let rows = phase_material_rows(model, idx as u32);
        repo::cache_phase_materials(&tx, ph.id, &rows)?;
    }
    repo::recompute_build_materials(&tx, build_id)?;
    tx.commit()?;
    Ok(())
}

/// Importa un prefab (JSON) como build curada: persiste el modelo voxel, los
/// materiales totales y por fase, y crea las fases con un paso inicial cada una.
/// Devuelve el id de la build creada.
/// Bloques de "clutter" decorativo (telarañas, musgo de pared, hiedra, capullos) que ensucian
/// las casas y se solapan feo en las paredes. Se quitan SOLO en los starters curados (no en los
/// imports del usuario/comunidad) para que las casas-guía queden limpias y nativas.
pub fn is_clutter(name: &str) -> bool {
    let n = name.strip_prefix('*').unwrap_or(name).to_ascii_lowercase();
    n.contains("spiderweb")
        || n.contains("cobweb")
        || n.contains("webbing")
        || n.contains("cocoon")
        || n.contains("ivy")
        || n.starts_with("plant_vine")
        || (n.contains("moss")
            && (n.contains("wall")
                || n.contains("rug")
                || n.contains("cave")
                || n.contains("hanging")))
}

pub fn import_prefab_json(
    conn: &Connection,
    voxel_dir: impl AsRef<Path>,
    prefab_json: &str,
    meta: &NewBuild,
    num_phases: u32,
    hints: &CurationHints,
    strip_clutter: bool,
) -> Result<i64> {
    // Se importa el prefab ÍNTEGRO (sin descartar bloques) para no dejarlo sin suelo. En los
    // starters curados (strip_clutter) se quitan las decoraciones de clutter (telarañas/musgo/hiedra).
    let mut model = VoxelModel::from_json(prefab_json)?;
    if !model.is_version_supported() {
        return Err(CoreError::UnsupportedPrefabVersion(model.version));
    }
    if model.blocks.len() > MAX_MODEL_BLOCKS {
        return Err(CoreError::Other(format!(
            "el prefab supera el límite de {MAX_MODEL_BLOCKS} bloques"
        )));
    }
    if strip_clutter {
        model.blocks.retain(|b| !is_clutter(&b.name));
    }
    // Un prefab v8 repite el ID del bloque en las celdas filler de una pieza multicelda,
    // pero no serializa el offset que identifica la base. Reconstruimos ese contrato con
    // el hitbox oficial antes de asignar fases o contar materiales.
    multicell::collapse_prefab_fillers(&mut model, &hints.catalog);
    let stored = assign_phases(&model, num_phases, &hints.detail);

    // Todo en UNA transacción: si cualquier escritura falla (BD bloqueada, restricción…), se
    // revierte entera y NO queda una build a medias (sin fases o con ref a un modelo inexistente).
    let tx = conn.unchecked_transaction()?;

    // Crear la build (con el conteo real de bloques).
    let mut meta = meta.clone();
    meta.block_count = stored.blocks.len() as i64;
    let build_id = repo::create_build(&tx, &meta)?;

    // Guardar el modelo voxel y enlazarlo.
    let ref_path = voxel_store::save(&voxel_dir, build_id, &stored)?;
    tx.execute(
        "UPDATE builds SET voxel_model_ref = ?1 WHERE id = ?2",
        params![ref_path, build_id],
    )?;

    // Materiales totales (cacheados).
    let totals: Vec<MaterialRow> = materials::totals(&model)
        .into_iter()
        .map(|m| MaterialRow {
            block_name: m.block_name,
            qty: m.qty as i64,
        })
        .collect();
    repo::cache_build_materials(&tx, build_id, &totals)?;

    // Fases + paso inicial + materiales por fase.
    for p in 0..stored.phases {
        let name = phase_name(p, stored.phases);
        let phase_id = repo::add_phase(
            &tx,
            &NewPhase {
                build_id,
                order_index: p as i64,
                name: name.clone(),
                description: String::new(),
            },
        )?;
        repo::add_step(
            &tx,
            &NewStep {
                phase_id,
                order_index: 0,
                title: format!("Coloca los bloques de «{}»", name),
                instruction: String::new(),
                preview_ref: None,
            },
        )?;
        let rows = phase_material_rows(&stored, p);
        repo::cache_phase_materials(&tx, phase_id, &rows)?;
    }

    tx.commit()?;
    Ok(build_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::prefab::{Block, VoxelModel};

    fn model(ys: &[i32]) -> VoxelModel {
        let blocks = ys
            .iter()
            .enumerate()
            .map(|(i, &y)| Block {
                x: i as i32,
                y,
                z: 0,
                name: "Rock_Stone".to_string(),
                rotation: 0,
            })
            .collect();
        VoxelModel {
            version: 8,
            block_id_version: 0,
            origin: (0, 0, 0),
            blocks,
            size: (1, 1, 1),
        }
    }

    #[test]
    fn assign_phases_reparte_sobre_niveles_poblados() {
        // Niveles poblados: 0, 1, 100 (hueco enorme entre 1 y 100). Con 3 fases,
        // cada nivel debe caer en una fase distinta (no todo amontonado por el hueco).
        let m = model(&[0, 1, 100]);
        let stored = assign_phases(&m, 3, &HashSet::new());
        let p0 = stored.blocks.iter().find(|b| b.y == 0).unwrap().phase;
        let p1 = stored.blocks.iter().find(|b| b.y == 1).unwrap().phase;
        let p100 = stored.blocks.iter().find(|b| b.y == 100).unwrap().phase;
        assert_eq!(p0, 0);
        assert_eq!(p1, 1);
        assert_eq!(
            p100, 2,
            "el nivel más alto va a la última fase pese al hueco"
        );
        assert_eq!(stored.phases, 3);
    }

    #[test]
    fn assign_phases_una_fase_mete_todo_en_cero() {
        let m = model(&[0, 5, 9]);
        let stored = assign_phases(&m, 1, &HashSet::new());
        assert!(stored.blocks.iter().all(|b| b.phase == 0));
    }

    #[test]
    fn assign_phases_separa_detalle_a_la_ultima_fase() {
        // 4 bloques estructurales (Rock_Stone) en alturas 0..3 + 1 de detalle (Chair)
        // colocado abajo (y=0). El detalle debe ir a la última fase pese a su altura.
        let mut m = model(&[0, 1, 2, 3]);
        m.blocks.push(Block {
            x: 99,
            y: 0,
            z: 0,
            name: "Chair".to_string(),
            rotation: 0,
        });
        let detail: HashSet<String> = ["Chair".to_string()].into_iter().collect();
        let stored = assign_phases(&m, 4, &detail);
        let chair = stored.blocks.iter().find(|b| b.name == "Chair").unwrap();
        assert_eq!(chair.phase, 3, "el detalle va a la última fase");
        // La estructura se reparte en las 3 primeras fases (0..2), nunca en la 3.
        assert!(stored
            .blocks
            .iter()
            .filter(|b| b.name == "Rock_Stone")
            .all(|b| b.phase < 3));
    }
}
