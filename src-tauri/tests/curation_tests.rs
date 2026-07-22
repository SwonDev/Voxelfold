//! Tests de la curación: import de prefab → build con fases y materiales.

use voxelfold_lib::core::db::models::NewBuild;
use voxelfold_lib::core::db::{self, repo};
use voxelfold_lib::core::{curation, voxel_store};

const PREFAB: &str = include_str!("fixtures/prefab_sintetico.json");

fn meta() -> NewBuild {
    NewBuild {
        slug: "demo".into(),
        name: "Build de demo".into(),
        description: String::new(),
        category: "Casas iniciales".into(),
        style: "Medieval".into(),
        difficulty: "Fácil".into(),
        estimated_time_min: 15,
        block_count: 0,
        mode: "both".into(),
        thumbnail_ref: None,
        author_name: None,
        author_url: None,
        source_url: None,
        license_note: None,
        voxel_model_ref: None,
    }
}

#[test]
fn import_crea_build_con_fases_materiales_y_voxels() {
    let conn = db::open_in_memory().unwrap();
    let dir = std::env::temp_dir().join("voxelfold_curation_test");
    let _ = std::fs::remove_dir_all(&dir);

    let hints = curation::CurationHints::default();
    let id = curation::import_prefab_json(&conn, &dir, PREFAB, &meta(), 2, &hints, false).unwrap();

    // Build con el conteo real (7 bloques, sin Empty).
    let build = repo::get_build(&conn, id).unwrap();
    assert_eq!(build.block_count, 7);
    assert!(build.voxel_model_ref.is_some());

    // Dos fases creadas, cada una con un paso.
    let phases = repo::phases_for_build(&conn, id).unwrap();
    assert_eq!(phases.len(), 2);
    assert_eq!(repo::steps_for_phase(&conn, phases[0].id).unwrap().len(), 1);

    // Materiales totales cacheados.
    let mats = repo::build_materials(&conn, id).unwrap();
    let qty = |n: &str| mats.iter().find(|m| m.block_name == n).map(|m| m.qty);
    assert_eq!(qty("Rock_Stone"), Some(4));
    assert_eq!(qty("Wood_Fir_Trunk"), Some(2));

    // Fase 0 (y=0) = los 4 Rock_Stone; fase 1 (y=1) = madera.
    let f0 = repo::phase_materials(&conn, phases[0].id).unwrap();
    assert_eq!(
        f0.iter()
            .find(|m| m.block_name == "Rock_Stone")
            .map(|m| m.qty),
        Some(4)
    );

    // Modelo voxel persistido y recuperable.
    let stored = voxel_store::load(&dir, id).unwrap();
    assert_eq!(stored.blocks.len(), 7);
    assert_eq!(stored.phases, 2);
    assert!(stored.blocks.iter().all(|b| b.phase < 2));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn import_rechaza_version_de_prefab_desconocida() {
    let conn = db::open_in_memory().unwrap();
    let dir = std::env::temp_dir().join("voxelfold_curation_version_test");
    let unsupported = PREFAB.replace("\"version\": 8", "\"version\": 99");
    let error = curation::import_prefab_json(
        &conn,
        &dir,
        &unsupported,
        &meta(),
        2,
        &curation::CurationHints::default(),
        false,
    )
    .unwrap_err();
    assert!(error.to_string().contains("versión de prefab no soportada"));
    assert!(repo::list_builds(&conn).unwrap().is_empty());
}
