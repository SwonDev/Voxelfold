//! Cálculo de materiales a partir de un `VoxelModel`.
//! Materiales = conteo de bloques por `name` (los `Empty` ya están excluidos del modelo).

use std::collections::BTreeMap;

use serde::Serialize;

use crate::core::prefab::{is_generation_marker, VoxelModel};

/// Una línea de la lista de materiales: un tipo de bloque y su cantidad.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct MaterialLine {
    pub block_name: String,
    pub qty: u32,
}

/// Nombre BASE del bloque para la lista de materiales: sin el prefijo `*` ni el
/// sufijo de estado (`_State_Definitions_<estado>`). Así las variantes de un mismo
/// bloque (escalones, tejados, vallas conectadas…) cuentan como un solo material y
/// resuelven su icono/nombre real (los nombres con estado no están en el catálogo).
pub fn base_name(name: &str) -> &str {
    let n = name.strip_prefix('*').unwrap_or(name);
    match n.find("_State_Definitions_") {
        Some(i) => &n[..i],
        None => n,
    }
}

/// Cuenta los materiales totales de la build, agregados por nombre base. Orden
/// estable (alfabético).
pub fn totals(model: &VoxelModel) -> Vec<MaterialLine> {
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for b in &model.blocks {
        if is_generation_marker(&b.name) {
            continue;
        }
        *counts.entry(base_name(&b.name)).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .map(|(name, qty)| MaterialLine {
            block_name: name.to_string(),
            qty,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::prefab::{Block, VoxelModel};

    #[test]
    fn base_name_quita_prefijo_y_estado() {
        assert_eq!(base_name("Rock_Stone"), "Rock_Stone");
        assert_eq!(base_name("*Wood_Deadwood_Roof"), "Wood_Deadwood_Roof");
        assert_eq!(
            base_name("*Wood_Deadwood_Roof_State_Definitions_Corner_Right"),
            "Wood_Deadwood_Roof"
        );
    }

    #[test]
    fn totals_agrega_variantes_en_un_solo_material() {
        let names = [
            "Wood_Deadwood_Roof",
            "*Wood_Deadwood_Roof_State_Definitions_Corner_Right",
            "*Wood_Deadwood_Roof_State_Definitions_Corner_Left",
            "Rock_Stone",
            "Block_Spawner_Block",
        ];
        let blocks = names
            .iter()
            .enumerate()
            .map(|(i, n)| Block {
                x: i as i32,
                y: 0,
                z: 0,
                name: n.to_string(),
                rotation: 0,
            })
            .collect();
        let model = VoxelModel {
            version: 8,
            block_id_version: 0,
            origin: (0, 0, 0),
            blocks,
            size: (5, 1, 1),
        };
        let totals = totals(&model);
        // 3 variantes de tejado → 1 sola línea "Wood_Deadwood_Roof" ×3, + Rock_Stone ×1.
        assert_eq!(totals.len(), 2);
        assert!(
            totals.iter().all(|m| m.block_name != "Block_Spawner_Block"),
            "los marcadores no son materiales"
        );
        let roof = totals
            .iter()
            .find(|m| m.block_name == "Wood_Deadwood_Roof")
            .unwrap();
        assert_eq!(roof.qty, 3);
    }
}
