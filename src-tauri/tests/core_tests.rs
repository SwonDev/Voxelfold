//! Tests de integración del Core de Voxelfold.
//! Usan fixtures sintéticos que replican el esquema REAL de Hytale
//! (ver docs/spikes/2026-06-13-hytale-formato.md).

use voxelfold_lib::core::catalog;
use voxelfold_lib::core::lang;
use voxelfold_lib::core::materials;
use voxelfold_lib::core::prefab::{VoxelModel, EMPTY_BLOCK};

const PREFAB: &str = include_str!("fixtures/prefab_sintetico.json");
const CATALOG: &str = include_str!("fixtures/catalogo_bloque_sintetico.json");
const LANG: &str = include_str!("fixtures/server_sintetico.lang");

#[test]
fn prefab_parsea_y_excluye_empty() {
    let m = VoxelModel::from_json(PREFAB).expect("debe parsear");
    assert_eq!(m.version, 8, "versión del prefab");
    assert_eq!(m.block_id_version, 11, "blockIdVersion");
    assert_eq!(
        m.blocks.len(),
        7,
        "los bloques Empty deben excluirse (8 totales, 1 Empty)"
    );
    assert_eq!(m.origin, (0, 0, 0), "origin desde anchorX/Y/Z");
    assert_eq!(m.size, (2, 2, 2), "tamaño derivado del bounding box");
    assert!(
        !m.blocks.iter().any(|b| b.name == EMPTY_BLOCK),
        "no debe quedar ningún Empty"
    );
    let stairs = m
        .blocks
        .iter()
        .find(|b| b.name == "Wood_Darkwood_Stairs")
        .expect("debe existir la escalera");
    assert_eq!(stairs.rotation, 2, "rotación preservada");
}

#[test]
fn materiales_conteo_total() {
    let m = VoxelModel::from_json(PREFAB).unwrap();
    let t = materials::totals(&m);
    let qty = |n: &str| t.iter().find(|l| l.block_name == n).map(|l| l.qty);
    assert_eq!(qty("Rock_Stone"), Some(4));
    assert_eq!(qty("Wood_Fir_Trunk"), Some(2));
    assert_eq!(qty("Wood_Darkwood_Stairs"), Some(1));
    assert_eq!(qty("Empty"), None, "Empty nunca cuenta como material");
}

#[test]
fn lang_parsea_y_resuelve_display_name() {
    let map = lang::parse_lang(LANG);
    assert_eq!(
        lang::display_name(&map, "Rock_Stone").as_deref(),
        Some("Stone")
    );
    // También debe resolver claves con prefijo "server."
    let mut m2 = std::collections::HashMap::new();
    m2.insert("server.items.X.name".to_string(), "Equis".to_string());
    assert_eq!(lang::display_name(&m2, "X").as_deref(), Some("Equis"));
}

#[test]
fn catalogo_parsea_definiciones_de_bloque() {
    let defs: serde_json::Value = serde_json::from_str(CATALOG).unwrap();
    let obj = defs.as_object().unwrap();

    let rs = catalog::parse_block_def(
        "Rock_Stone",
        &serde_json::to_string(&obj["Rock_Stone"]).unwrap(),
    )
    .unwrap();
    assert_eq!(
        rs.icon.as_deref(),
        Some("Icons/ItemsGenerated/Rock_Stone.png")
    );
    assert_eq!(rs.draw_type.as_deref(), Some("Cube"));
    assert_eq!(
        rs.translation_key.as_deref(),
        Some("server.items.Rock_Stone.name"),
        "debe conservar la clave i18n de la definición"
    );
    assert!(
        rs.textures
            .iter()
            .any(|t| t.path == "BlockTextures/Rock_Stone.png"),
        "debe leer la textura All"
    );
    let variants: Vec<(u32, u32)> = rs
        .textures
        .iter()
        .map(|texture| (texture.variant, texture.weight))
        .collect();
    assert_eq!(
        variants,
        vec![(0, 2), (1, 1)],
        "conserva grupos y pesos de textura"
    );

    let fir = catalog::parse_block_def(
        "Wood_Fir_Trunk",
        &serde_json::to_string(&obj["Wood_Fir_Trunk"]).unwrap(),
    )
    .unwrap();
    assert!(fir.textures.iter().any(|t| t.face == "Top"), "cara Top");
    assert!(fir.textures.iter().any(|t| t.face == "Side"), "cara Side");

    let st = catalog::parse_block_def(
        "Wood_Darkwood_Stairs",
        &serde_json::to_string(&obj["Wood_Darkwood_Stairs"]).unwrap(),
    )
    .unwrap();
    assert_eq!(st.draw_type.as_deref(), Some("Stairs"));
}
