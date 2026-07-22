//! Reconstrucción de anclas y celdas filler de bloques multicelda.
//!
//! El formato de prefab v8 guarda el mismo bloque en la celda base y en cada filler,
//! pero no serializa el offset `filler` que el mundo mantiene internamente. Si todas
//! esas celdas se interpretan como anclas, Voxelfold dibuja varias copias completas del
//! modelo (puertas, camas, armarios…) y sus superficies se solapan/parpadean.

use std::collections::{HashMap, HashSet};

use crate::core::catalog::{BlockCatalog, BlockHitbox};
use crate::core::prefab::{Block, VoxelModel};
use crate::core::voxel_store::{StoredModel, StoredVoxel};

const EPSILON: f32 = 1e-5;

trait PositionedBlock {
    fn position(&self) -> (i32, i32, i32);
    fn name(&self) -> &str;
    fn rotation(&self) -> i32;
}

impl PositionedBlock for Block {
    fn position(&self) -> (i32, i32, i32) {
        (self.x, self.y, self.z)
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn rotation(&self) -> i32 {
        self.rotation
    }
}

impl PositionedBlock for StoredVoxel {
    fn position(&self) -> (i32, i32, i32) {
        (self.x, self.y, self.z)
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn rotation(&self) -> i32 {
        self.rotation
    }
}

fn split_block_name(name: &str) -> (&str, Option<&str>) {
    const STATE: &str = "_State_Definitions_";
    let raw = name.strip_prefix('*').unwrap_or(name);
    raw.split_once(STATE)
        .map_or((raw, None), |(base, state)| (base, Some(state)))
}

fn effective_hitbox<'a>(catalog: &'a BlockCatalog, name: &str) -> Option<&'a BlockHitbox> {
    let (base, state) = split_block_name(name);
    let block = catalog.get(name).or_else(|| catalog.get(base))?;
    if let Some(state) = state {
        if let Some(definition) = block
            .states
            .iter()
            .find(|candidate| candidate.state == state)
        {
            return definition.hitbox.as_ref().or(block.hitbox.as_ref());
        }
    }
    block.hitbox.as_ref()
}

fn quarter_cos(value: i32) -> f32 {
    [1.0, 0.0, -1.0, 0.0][value.rem_euclid(4) as usize]
}

fn quarter_sin(value: i32) -> f32 {
    [0.0, 1.0, 0.0, -1.0][value.rem_euclid(4) as usize]
}

/// Matriz oficial `Ry · Rx · Rz` para `RotationTuple.index = roll·16 + pitch·4 + yaw`.
fn rotation_matrix(rotation: i32) -> [[f32; 3]; 3] {
    let value = rotation.rem_euclid(64);
    let yaw = value % 4;
    let pitch = (value / 4) % 4;
    let roll = (value / 16) % 4;
    let (cy, sy) = (quarter_cos(yaw), quarter_sin(yaw));
    let (cp, sp) = (quarter_cos(pitch), quarter_sin(pitch));
    let (cr, sr) = (quarter_cos(roll), quarter_sin(roll));
    [
        [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
        [cp * sr, cp * cr, -sp],
        [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
    ]
}

/// Réplica de `FillerBlockUtil.forEachFillerBlock`: gira el hitbox alrededor del centro
/// de la celda y enumera el bounding box entero ocupado por la pieza.
fn footprint(hitbox: &BlockHitbox, rotation: i32) -> Vec<(i32, i32, i32)> {
    if hitbox
        .min
        .iter()
        .chain(hitbox.max.iter())
        .any(|value| !value.is_finite())
    {
        return vec![(0, 0, 0)];
    }

    let matrix = rotation_matrix(rotation);
    let mut min = [f32::INFINITY; 3];
    let mut max = [f32::NEG_INFINITY; 3];
    for x in [hitbox.min[0], hitbox.max[0]] {
        for y in [hitbox.min[1], hitbox.max[1]] {
            for z in [hitbox.min[2], hitbox.max[2]] {
                let source = [x - 0.5, y - 0.5, z - 0.5];
                for axis in 0..3 {
                    let value = matrix[axis][0] * source[0]
                        + matrix[axis][1] * source[1]
                        + matrix[axis][2] * source[2]
                        + 0.5;
                    min[axis] = min[axis].min(value);
                    max[axis] = max[axis].max(value);
                }
            }
        }
    }

    let lo = min.map(|value| (value + EPSILON).floor() as i32);
    let hi = max.map(|value| (value - EPSILON).ceil() as i32);
    let width = (hi[0] - lo[0]).max(1);
    let height = (hi[1] - lo[1]).max(1);
    let depth = (hi[2] - lo[2]).max(1);
    let mut cells = Vec::with_capacity((width * height * depth) as usize);
    for x in 0..width {
        for y in 0..height {
            for z in 0..depth {
                cells.push((lo[0] + x, lo[1] + y, lo[2] + z));
            }
        }
    }
    cells
}

#[derive(Debug)]
struct Candidate {
    anchor: usize,
    cells: Vec<usize>,
    position: (i32, i32, i32),
}

/// Colapsa exclusivamente grupos completos que coinciden con la huella oficial y que
/// repiten exactamente bloque + rotación. Una pieza creada por el editor solo contiene
/// el ancla; al no existir las copias filler, se conserva intacta.
fn collapsed<T: PositionedBlock + Clone>(blocks: &[T], catalog: &BlockCatalog) -> Vec<T> {
    let by_position: HashMap<(i32, i32, i32), usize> = blocks
        .iter()
        .enumerate()
        .map(|(index, block)| (block.position(), index))
        .collect();
    let mut candidates = Vec::new();

    for (anchor, block) in blocks.iter().enumerate() {
        let Some(hitbox) = effective_hitbox(catalog, block.name()) else {
            continue;
        };
        let offsets = footprint(hitbox, block.rotation());
        if offsets.len() <= 1 {
            continue;
        }
        let (x, y, z) = block.position();
        let mut cells = Vec::with_capacity(offsets.len() + 1);
        let mut complete = true;
        for (dx, dy, dz) in offsets {
            let Some(&index) = by_position.get(&(x + dx, y + dy, z + dz)) else {
                complete = false;
                break;
            };
            let filler = &blocks[index];
            if filler.name() != block.name()
                || filler.rotation().rem_euclid(64) != block.rotation().rem_euclid(64)
            {
                complete = false;
                break;
            }
            cells.push(index);
        }
        if !complete {
            continue;
        }
        cells.push(anchor);
        cells.sort_unstable();
        cells.dedup();
        if cells.len() > 1 {
            candidates.push(Candidate {
                anchor,
                cells,
                position: block.position(),
            });
        }
    }

    // Orden espacial estable. Si hay varias piezas idénticas contiguas, empaqueta desde
    // el primer grupo completo y evita que un candidato desplazado mezcle sus fillers.
    candidates.sort_by_key(|candidate| {
        (
            candidate.position.0,
            candidate.position.1,
            candidate.position.2,
            candidate.anchor,
        )
    });
    let mut claimed = HashSet::new();
    let mut remove = HashSet::new();
    for candidate in candidates {
        if candidate.cells.iter().any(|index| claimed.contains(index)) {
            continue;
        }
        for index in candidate.cells {
            claimed.insert(index);
            if index != candidate.anchor {
                remove.insert(index);
            }
        }
    }

    blocks
        .iter()
        .enumerate()
        .filter(|(index, _)| !remove.contains(index))
        .map(|(_, block)| block.clone())
        .collect()
}

/// Repara un prefab recién leído. Devuelve cuántas copias filler se eliminaron.
pub fn collapse_prefab_fillers(model: &mut VoxelModel, catalog: &BlockCatalog) -> usize {
    let before = model.blocks.len();
    model.blocks = collapsed(&model.blocks, catalog);
    model.recompute_size();
    before - model.blocks.len()
}

/// Repara un modelo persistido o recibido del editor. Devuelve cuántas copias filler se
/// eliminaron para poder decidir si hay que resincronizar materiales y recuentos.
pub fn collapse_stored_fillers(model: &mut StoredModel, catalog: &BlockCatalog) -> usize {
    let before = model.blocks.len();
    model.blocks = collapsed(&model.blocks, catalog);
    model.recompute_size();
    before - model.blocks.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::catalog;

    fn catalog_with(name: &str, hitbox: BlockHitbox) -> BlockCatalog {
        let json = r#"{"BlockType":{"DrawType":"Model","CustomModel":"Door.blockymodel","HitboxType":"Test"}}"#;
        let mut info = catalog::parse_block_def(name, json).unwrap();
        info.hitbox = Some(hitbox);
        [(name.to_string(), info)].into_iter().collect()
    }

    fn block(x: i32, y: i32, z: i32, rotation: i32) -> Block {
        Block {
            x,
            y,
            z,
            name: "Furniture_Test".into(),
            rotation,
        }
    }

    fn model(blocks: Vec<Block>) -> VoxelModel {
        VoxelModel {
            version: 8,
            block_id_version: 0,
            origin: (0, 0, 0),
            blocks,
            size: (0, 0, 0),
        }
    }

    #[test]
    fn colapsa_puerta_vertical_repetida_por_el_prefab() {
        let catalog = catalog_with(
            "Furniture_Test",
            BlockHitbox {
                min: [0.0, 0.0, 0.4],
                max: [1.0, 2.0, 0.6],
            },
        );
        let mut model = model(vec![block(0, 4, 0, 2), block(0, 5, 0, 2)]);
        assert_eq!(collapse_prefab_fillers(&mut model, &catalog), 1);
        assert_eq!(model.blocks.len(), 1);
        assert_eq!(model.blocks[0].y, 4);
    }

    #[test]
    fn conserva_una_pieza_que_ya_solo_contiene_el_ancla() {
        let catalog = catalog_with(
            "Furniture_Test",
            BlockHitbox {
                min: [0.0, 0.0, 0.0],
                max: [2.0, 1.0, 1.0],
            },
        );
        let mut model = model(vec![block(8, 1, 3, 0)]);
        assert_eq!(collapse_prefab_fillers(&mut model, &catalog), 0);
        assert_eq!(model.blocks.len(), 1);
    }

    #[test]
    fn separa_dos_piezas_contiguas_sin_cruzar_sus_fillers() {
        let catalog = catalog_with(
            "Furniture_Test",
            BlockHitbox {
                min: [0.0, 0.0, 0.0],
                max: [2.0, 1.0, 1.0],
            },
        );
        let mut model = model(vec![
            block(0, 0, 0, 0),
            block(1, 0, 0, 0),
            block(2, 0, 0, 0),
            block(3, 0, 0, 0),
        ]);
        assert_eq!(collapse_prefab_fillers(&mut model, &catalog), 2);
        assert_eq!(
            model.blocks.iter().map(|block| block.x).collect::<Vec<_>>(),
            vec![0, 2]
        );
    }

    #[test]
    fn respeta_rotacion_y_offsets_negativos_del_hitbox() {
        let catalog = catalog_with(
            "Furniture_Test",
            BlockHitbox {
                min: [0.0, 0.0, 0.0],
                max: [2.0, 1.0, 1.0],
            },
        );
        // Con yaw=90°, la huella X=[0,2] pasa a Z=[-1,1]: ancla en z=1 y filler en z=0.
        let mut model = model(vec![block(0, 0, 0, 1), block(0, 0, 1, 1)]);
        assert_eq!(collapse_prefab_fillers(&mut model, &catalog), 1);
        assert_eq!(model.blocks[0].z, 1);
    }
}
