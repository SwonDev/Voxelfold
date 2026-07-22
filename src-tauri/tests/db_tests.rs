//! Tests de integración de la capa SQLite (BD en memoria).

use voxelfold_lib::core::curation;
use voxelfold_lib::core::db::models::{BuildStatus, MaterialRow, NewBuild, NewPhase, NewStep};
use voxelfold_lib::core::db::{self, repo};
use voxelfold_lib::core::voxel_store::{StoredModel, StoredVoxel};

fn nb(slug: &str) -> NewBuild {
    NewBuild {
        slug: slug.to_string(),
        name: format!("Casa {slug}"),
        description: "Una casa acogedora".to_string(),
        category: "Casas iniciales".to_string(),
        style: "Medieval".to_string(),
        difficulty: "Fácil".to_string(),
        estimated_time_min: 30,
        block_count: 128,
        mode: "both".to_string(),
        thumbnail_ref: None,
        author_name: Some("Yo".to_string()),
        author_url: None,
        source_url: None,
        license_note: None,
        voxel_model_ref: None,
    }
}

#[test]
fn migraciones_crean_todas_las_tablas() {
    let conn = db::open_in_memory().unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN \
             ('settings','builds','tags','build_tags','build_images','phases','steps',\
              'build_materials','phase_materials','user_progress','completed_steps',\
              'material_checklist','favorites')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 13, "deben existir las 13 tablas");

    let fk: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fk, 1, "foreign_keys debe estar activado");
}

#[test]
fn crud_de_build_y_slug_unico() {
    let conn = db::open_in_memory().unwrap();
    let id = repo::create_build(&conn, &nb("casa-1")).unwrap();
    let b = repo::get_build(&conn, id).unwrap();
    assert_eq!(b.slug, "casa-1");
    assert_eq!(b.name, "Casa casa-1");
    assert_eq!(b.block_count, 128);
    assert_eq!(b.mode, "both");
    assert!(!b.created_at.is_empty());

    assert_eq!(repo::list_builds(&conn).unwrap().len(), 1);
    // slug duplicado debe fallar
    assert!(repo::create_build(&conn, &nb("casa-1")).is_err());
}

#[test]
fn fases_pasos_y_cascade() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("casa-2")).unwrap();
    let p1 = repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 0,
            name: "Cimentación".to_string(),
            description: String::new(),
        },
    )
    .unwrap();
    repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 1,
            name: "Paredes".to_string(),
            description: String::new(),
        },
    )
    .unwrap();
    repo::add_step(
        &conn,
        &NewStep {
            phase_id: p1,
            order_index: 0,
            title: "Coloca la base".to_string(),
            instruction: "48 bloques de piedra".to_string(),
            preview_ref: None,
        },
    )
    .unwrap();

    let phases = repo::phases_for_build(&conn, bid).unwrap();
    assert_eq!(phases.len(), 2);
    assert_eq!(phases[0].name, "Cimentación", "ordenadas por order_index");
    assert_eq!(repo::steps_for_phase(&conn, p1).unwrap().len(), 1);

    // ON DELETE CASCADE: borrar la build elimina fases y pasos
    conn.execute("DELETE FROM builds WHERE id = ?1", [bid])
        .unwrap();
    assert!(repo::phases_for_build(&conn, bid).unwrap().is_empty());
    assert!(repo::steps_for_phase(&conn, p1).unwrap().is_empty());
}

#[test]
fn crud_completo_de_fases_y_pasos() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("editor-1")).unwrap();
    let mk_phase = |idx: i64, name: &str| NewPhase {
        build_id: bid,
        order_index: idx,
        name: name.to_string(),
        description: String::new(),
    };
    let p1 = repo::add_phase(&conn, &mk_phase(0, "Uno")).unwrap();
    let p2 = repo::add_phase(&conn, &mk_phase(1, "Dos")).unwrap();
    let p3 = repo::add_phase(&conn, &mk_phase(2, "Tres")).unwrap();

    // Reordenar fases: invertir el orden
    repo::reorder_phases(&conn, &[p3, p2, p1]).unwrap();
    let phases = repo::phases_for_build(&conn, bid).unwrap();
    assert_eq!(
        phases.iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![p3, p2, p1],
        "reorder_phases ordena por la posición en el array"
    );

    // Borrar una fase intermedia (cascade a sus pasos)
    let s = repo::add_step(
        &conn,
        &NewStep {
            phase_id: p2,
            order_index: 0,
            title: "Paso de p2".to_string(),
            instruction: String::new(),
            preview_ref: None,
        },
    )
    .unwrap();
    repo::delete_phase(&conn, p2).unwrap();
    assert_eq!(repo::phases_for_build(&conn, bid).unwrap().len(), 2);
    assert!(
        repo::steps_for_phase(&conn, p2).unwrap().is_empty(),
        "cascade borra los pasos"
    );
    let _ = s;

    // Reordenar pasos dentro de una fase
    let a = repo::add_step(
        &conn,
        &NewStep {
            phase_id: p1,
            order_index: 0,
            title: "A".into(),
            instruction: String::new(),
            preview_ref: None,
        },
    )
    .unwrap();
    let b = repo::add_step(
        &conn,
        &NewStep {
            phase_id: p1,
            order_index: 1,
            title: "B".into(),
            instruction: String::new(),
            preview_ref: None,
        },
    )
    .unwrap();
    repo::reorder_steps(&conn, &[b, a]).unwrap();
    let steps = repo::steps_for_phase(&conn, p1).unwrap();
    assert_eq!(steps.iter().map(|s| s.id).collect::<Vec<_>>(), vec![b, a]);

    // Borrar un paso
    repo::delete_step(&conn, a).unwrap();
    assert_eq!(repo::steps_for_phase(&conn, p1).unwrap().len(), 1);
}

#[test]
fn materiales_por_fase_y_recalculo_total() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("mats")).unwrap();
    let p1 = repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 0,
            name: "1".into(),
            description: String::new(),
        },
    )
    .unwrap();
    let p2 = repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 1,
            name: "2".into(),
            description: String::new(),
        },
    )
    .unwrap();

    repo::cache_phase_materials(
        &conn,
        p1,
        &[
            MaterialRow {
                block_name: "Rock_Stone".into(),
                qty: 10,
            },
            MaterialRow {
                block_name: "Wood_Fir_Trunk".into(),
                qty: 5,
            },
        ],
    )
    .unwrap();
    repo::cache_phase_materials(
        &conn,
        p2,
        &[MaterialRow {
            block_name: "Rock_Stone".into(),
            qty: 7,
        }],
    )
    .unwrap();

    assert_eq!(repo::build_id_of_phase(&conn, p2).unwrap(), bid);

    repo::recompute_build_materials(&conn, bid).unwrap();
    let total = repo::build_materials(&conn, bid).unwrap();
    // Rock_Stone: 10+7=17, Wood_Fir_Trunk: 5
    let rock = total.iter().find(|m| m.block_name == "Rock_Stone").unwrap();
    assert_eq!(rock.qty, 17, "suma de fases");
    assert_eq!(total.len(), 2);
    let b = repo::get_build(&conn, bid).unwrap();
    assert_eq!(b.block_count, 22, "block_count = suma total de materiales");
}

#[test]
fn editor_visual_guarda_modelo_y_sincroniza_fases() {
    let conn = db::open_in_memory().unwrap();
    let dir = std::env::temp_dir().join("voxelfold_editor_test");
    let _ = std::fs::create_dir_all(&dir);
    let bid = repo::create_build(&conn, &nb("editor-voxel")).unwrap();

    let v = |x: i32, y: i32, z: i32, name: &str, phase: u32| StoredVoxel {
        x,
        y,
        z,
        name: name.to_string(),
        rotation: 0,
        phase,
    };
    let model = StoredModel {
        size: (2, 2, 1),
        origin: (0, 0, 0),
        phases: 2,
        blocks: vec![
            v(0, 0, 0, "Rock_Stone", 0),
            v(1, 0, 0, "Rock_Stone", 0),
            v(0, 1, 0, "Wood_Fir_Trunk", 1),
        ],
    };
    curation::set_voxel_model(&conn, &dir, bid, &model).unwrap();

    // Crea 2 fases (no existían).
    let phases = repo::phases_for_build(&conn, bid).unwrap();
    assert_eq!(phases.len(), 2, "set_voxel_model crea las fases necesarias");

    // Materiales por fase según el índice de fase de cada voxel.
    let f0 = repo::phase_materials(&conn, phases[0].id).unwrap();
    assert_eq!(
        f0.iter()
            .find(|m| m.block_name == "Rock_Stone")
            .unwrap()
            .qty,
        2
    );
    let f1 = repo::phase_materials(&conn, phases[1].id).unwrap();
    assert_eq!(
        f1.iter()
            .find(|m| m.block_name == "Wood_Fir_Trunk")
            .unwrap()
            .qty,
        1
    );

    // Total y block_count.
    let b = repo::get_build(&conn, bid).unwrap();
    assert_eq!(b.block_count, 3);
    assert!(b.voxel_model_ref.is_some());
}

#[test]
fn borrar_build_elimina_todo() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("borrame")).unwrap();
    let p = repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 0,
            name: "F".into(),
            description: String::new(),
        },
    )
    .unwrap();
    repo::add_step(
        &conn,
        &NewStep {
            phase_id: p,
            order_index: 0,
            title: "S".into(),
            instruction: String::new(),
            preview_ref: None,
        },
    )
    .unwrap();
    repo::toggle_favorite(&conn, bid).unwrap();

    repo::delete_build(&conn, bid).unwrap();
    assert_eq!(repo::list_builds(&conn).unwrap().len(), 0);
    assert!(repo::phases_for_build(&conn, bid).unwrap().is_empty());
    assert!(repo::list_favorites(&conn).unwrap().is_empty());
}

#[test]
fn progreso_pasos_completados_y_favoritos() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("casa-3")).unwrap();
    let p = repo::add_phase(
        &conn,
        &NewPhase {
            build_id: bid,
            order_index: 0,
            name: "F".to_string(),
            description: String::new(),
        },
    )
    .unwrap();
    let s = repo::add_step(
        &conn,
        &NewStep {
            phase_id: p,
            order_index: 0,
            title: "S".to_string(),
            instruction: String::new(),
            preview_ref: None,
        },
    )
    .unwrap();

    // Progreso (con upsert)
    assert!(repo::get_progress(&conn, bid).unwrap().is_none());
    repo::set_progress(&conn, bid, BuildStatus::InProgress, Some(p)).unwrap();
    let pr = repo::get_progress(&conn, bid).unwrap().unwrap();
    assert_eq!(pr.status, BuildStatus::InProgress);
    assert_eq!(pr.current_phase_id, Some(p));
    repo::set_progress(&conn, bid, BuildStatus::Completed, None).unwrap();
    assert_eq!(
        repo::get_progress(&conn, bid).unwrap().unwrap().status,
        BuildStatus::Completed
    );

    // Pasos completados
    repo::set_step_completed(&conn, bid, s, true).unwrap();
    assert_eq!(repo::completed_steps(&conn, bid).unwrap(), vec![s]);
    repo::set_step_completed(&conn, bid, s, true).unwrap(); // idempotente
    assert_eq!(repo::completed_steps(&conn, bid).unwrap().len(), 1);
    repo::set_step_completed(&conn, bid, s, false).unwrap();
    assert!(repo::completed_steps(&conn, bid).unwrap().is_empty());

    // Favoritos
    assert!(!repo::is_favorite(&conn, bid).unwrap());
    assert!(repo::toggle_favorite(&conn, bid).unwrap());
    assert!(repo::is_favorite(&conn, bid).unwrap());
    assert_eq!(repo::list_favorites(&conn).unwrap(), vec![bid]);
    assert!(!repo::toggle_favorite(&conn, bid).unwrap());
    assert!(!repo::is_favorite(&conn, bid).unwrap());
}

#[test]
fn checklist_y_materiales_cacheados() {
    let conn = db::open_in_memory().unwrap();
    let bid = repo::create_build(&conn, &nb("casa-4")).unwrap();

    // Checklist con upsert
    repo::set_material_gathered(&conn, bid, "total", "Rock_Stone", 10).unwrap();
    repo::set_material_gathered(&conn, bid, "total", "Rock_Stone", 25).unwrap();
    let chk = repo::get_checklist(&conn, bid, "total").unwrap();
    assert_eq!(chk.len(), 1);
    assert_eq!(chk[0].block_name, "Rock_Stone");
    assert_eq!(chk[0].gathered_qty, 25);

    // Materiales cacheados
    repo::cache_build_materials(
        &conn,
        bid,
        &[
            MaterialRow {
                block_name: "Rock_Stone".to_string(),
                qty: 64,
            },
            MaterialRow {
                block_name: "Wood_Fir_Trunk".to_string(),
                qty: 32,
            },
        ],
    )
    .unwrap();
    let mats = repo::build_materials(&conn, bid).unwrap();
    assert_eq!(mats.len(), 2);
    assert_eq!(mats[0].block_name, "Rock_Stone");
    assert_eq!(mats[0].qty, 64);
}
