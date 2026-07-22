//! Operaciones de lectura/escritura sobre la BD. Cada función toma `&Connection`.

use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::core::db::models::{
    Build, BuildStatus, ChecklistItem, MaterialRow, NewBuild, NewPhase, NewStep, Phase, Progress,
    Step,
};
use crate::core::error::Result;

/// Lee un ajuste clave→valor (None si no existe).
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let v = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(v)
}

/// Guarda (o actualiza) un ajuste clave→valor.
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Elimina un ajuste. Se usa, entre otros casos, para retirar secretos heredados de SQLite.
pub fn delete_setting(conn: &Connection, key: &str) -> Result<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
    Ok(())
}

const BUILD_COLS: &str = "id, slug, name, description, category, style, difficulty, \
    estimated_time_min, block_count, mode, thumbnail_ref, author_name, author_url, \
    source_url, license_note, voxel_model_ref, created_at, updated_at";

fn row_to_build(row: &Row) -> rusqlite::Result<Build> {
    Ok(Build {
        id: row.get(0)?,
        slug: row.get(1)?,
        name: row.get(2)?,
        description: row.get(3)?,
        category: row.get(4)?,
        style: row.get(5)?,
        difficulty: row.get(6)?,
        estimated_time_min: row.get(7)?,
        block_count: row.get(8)?,
        mode: row.get(9)?,
        thumbnail_ref: row.get(10)?,
        author_name: row.get(11)?,
        author_url: row.get(12)?,
        source_url: row.get(13)?,
        license_note: row.get(14)?,
        voxel_model_ref: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

// ---- Builds ----

pub fn create_build(conn: &Connection, b: &NewBuild) -> Result<i64> {
    conn.execute(
        "INSERT INTO builds (slug, name, description, category, style, difficulty, \
         estimated_time_min, block_count, mode, thumbnail_ref, author_name, author_url, \
         source_url, license_note, voxel_model_ref) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        params![
            b.slug,
            b.name,
            b.description,
            b.category,
            b.style,
            b.difficulty,
            b.estimated_time_min,
            b.block_count,
            b.mode,
            b.thumbnail_ref,
            b.author_name,
            b.author_url,
            b.source_url,
            b.license_note,
            b.voxel_model_ref,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn get_build(conn: &Connection, id: i64) -> Result<Build> {
    let sql = format!("SELECT {BUILD_COLS} FROM builds WHERE id = ?1");
    Ok(conn.query_row(&sql, params![id], row_to_build)?)
}

pub fn list_builds(conn: &Connection) -> Result<Vec<Build>> {
    let sql = format!("SELECT {BUILD_COLS} FROM builds ORDER BY name COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_build)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Borra una build completa (cascade: fases, pasos, materiales, progreso, favoritos).
pub fn delete_build(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM builds WHERE id = ?1", params![id])?;
    Ok(())
}

/// Nombres de los bloques más usados de una build (para previsualización).
pub fn top_block_names(conn: &Connection, build_id: i64, limit: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT block_name FROM build_materials WHERE build_id = ?1 ORDER BY qty DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![build_id, limit], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Actualiza los metadatos editables de una build (curación).
#[allow(clippy::too_many_arguments)]
pub fn update_build_meta(
    conn: &Connection,
    id: i64,
    name: &str,
    description: &str,
    category: &str,
    style: &str,
    difficulty: &str,
    mode: &str,
    estimated_time_min: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE builds SET name = ?2, description = ?3, category = ?4, style = ?5, \
         difficulty = ?6, mode = ?7, estimated_time_min = ?8, updated_at = datetime('now') \
         WHERE id = ?1",
        params![
            id,
            name,
            description,
            category,
            style,
            difficulty,
            mode,
            estimated_time_min
        ],
    )?;
    Ok(())
}

/// Renombra/actualiza una fase (curación).
pub fn update_phase(conn: &Connection, phase_id: i64, name: &str, description: &str) -> Result<()> {
    conn.execute(
        "UPDATE phases SET name = ?2, description = ?3 WHERE id = ?1",
        params![phase_id, name, description],
    )?;
    Ok(())
}

/// Guarda la miniatura (data URL o ruta) de una build.
pub fn set_thumbnail(conn: &Connection, id: i64, thumbnail_ref: &str) -> Result<()> {
    conn.execute(
        "UPDATE builds SET thumbnail_ref = ?2 WHERE id = ?1",
        params![id, thumbnail_ref],
    )?;
    Ok(())
}

/// Actualiza el título e instrucción de un paso (curación).
pub fn update_step(conn: &Connection, step_id: i64, title: &str, instruction: &str) -> Result<()> {
    conn.execute(
        "UPDATE steps SET title = ?2, instruction = ?3 WHERE id = ?1",
        params![step_id, title, instruction],
    )?;
    Ok(())
}

// ---- Fases y pasos ----

pub fn add_phase(conn: &Connection, p: &NewPhase) -> Result<i64> {
    conn.execute(
        "INSERT INTO phases (build_id, order_index, name, description) VALUES (?1,?2,?3,?4)",
        params![p.build_id, p.order_index, p.name, p.description],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn phases_for_build(conn: &Connection, build_id: i64) -> Result<Vec<Phase>> {
    let mut stmt = conn.prepare(
        "SELECT id, build_id, order_index, name, description FROM phases \
         WHERE build_id = ?1 ORDER BY order_index",
    )?;
    let rows = stmt.query_map(params![build_id], |r| {
        Ok(Phase {
            id: r.get(0)?,
            build_id: r.get(1)?,
            order_index: r.get(2)?,
            name: r.get(3)?,
            description: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn add_step(conn: &Connection, s: &NewStep) -> Result<i64> {
    conn.execute(
        "INSERT INTO steps (phase_id, order_index, title, instruction, preview_ref) \
         VALUES (?1,?2,?3,?4,?5)",
        params![
            s.phase_id,
            s.order_index,
            s.title,
            s.instruction,
            s.preview_ref
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn steps_for_phase(conn: &Connection, phase_id: i64) -> Result<Vec<Step>> {
    let mut stmt = conn.prepare(
        "SELECT id, phase_id, order_index, title, instruction, preview_ref FROM steps \
         WHERE phase_id = ?1 ORDER BY order_index",
    )?;
    let rows = stmt.query_map(params![phase_id], |r| {
        Ok(Step {
            id: r.get(0)?,
            phase_id: r.get(1)?,
            order_index: r.get(2)?,
            title: r.get(3)?,
            instruction: r.get(4)?,
            preview_ref: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Fase propietaria de un paso.
pub fn phase_id_of_step(conn: &Connection, step_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT phase_id FROM steps WHERE id = ?1",
        params![step_id],
        |row| row.get(0),
    )?)
}

/// Borra una fase (cascade: sus pasos, materiales de fase y completados).
pub fn delete_phase(conn: &Connection, phase_id: i64) -> Result<()> {
    conn.execute("DELETE FROM phases WHERE id = ?1", params![phase_id])?;
    Ok(())
}

/// Borra un paso (cascade: sus marcas de completado).
pub fn delete_step(conn: &Connection, step_id: i64) -> Result<()> {
    conn.execute("DELETE FROM steps WHERE id = ?1", params![step_id])?;
    Ok(())
}

/// Reordena fases: `order_index` pasa a ser la posición en `ordered_ids`.
pub fn reorder_phases(conn: &Connection, ordered_ids: &[i64]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE phases SET order_index = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Reordena pasos dentro de una fase: `order_index` = posición en `ordered_ids`.
pub fn reorder_steps(conn: &Connection, ordered_ids: &[i64]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for (i, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE steps SET order_index = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    tx.commit()?;
    Ok(())
}

// ---- Progreso ----

pub fn set_progress(
    conn: &Connection,
    build_id: i64,
    status: BuildStatus,
    current_phase_id: Option<i64>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO user_progress (build_id, status, current_phase_id, updated_at) \
         VALUES (?1, ?2, ?3, datetime('now')) \
         ON CONFLICT(build_id) DO UPDATE SET status = excluded.status, \
         current_phase_id = excluded.current_phase_id, updated_at = datetime('now')",
        params![build_id, status.as_str(), current_phase_id],
    )?;
    Ok(())
}

pub fn get_progress(conn: &Connection, build_id: i64) -> Result<Option<Progress>> {
    let result = conn.query_row(
        "SELECT status, current_phase_id FROM user_progress WHERE build_id = ?1",
        params![build_id],
        |r| {
            let status: String = r.get(0)?;
            let current_phase_id: Option<i64> = r.get(1)?;
            Ok(Progress {
                build_id,
                status: BuildStatus::from_db(&status),
                current_phase_id,
            })
        },
    );
    match result {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ---- Pasos completados ----

pub fn set_step_completed(
    conn: &Connection,
    build_id: i64,
    step_id: i64,
    completed: bool,
) -> Result<()> {
    if completed {
        conn.execute(
            "INSERT INTO completed_steps (build_id, step_id) VALUES (?1, ?2) \
             ON CONFLICT(build_id, step_id) DO NOTHING",
            params![build_id, step_id],
        )?;
    } else {
        conn.execute(
            "DELETE FROM completed_steps WHERE build_id = ?1 AND step_id = ?2",
            params![build_id, step_id],
        )?;
    }
    Ok(())
}

/// Borra todo el progreso de una build (estado, pasos completados y checklist).
pub fn reset_progress(conn: &Connection, build_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM user_progress WHERE build_id = ?1",
        params![build_id],
    )?;
    conn.execute(
        "DELETE FROM completed_steps WHERE build_id = ?1",
        params![build_id],
    )?;
    conn.execute(
        "DELETE FROM material_checklist WHERE build_id = ?1",
        params![build_id],
    )?;
    Ok(())
}

pub fn completed_steps(conn: &Connection, build_id: i64) -> Result<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT step_id FROM completed_steps WHERE build_id = ?1 ORDER BY step_id")?;
    let rows = stmt.query_map(params![build_id], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---- Favoritos ----

pub fn is_favorite(conn: &Connection, build_id: i64) -> Result<bool> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM favorites WHERE build_id = ?1",
        params![build_id],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

/// Alterna el estado de favorito y devuelve el nuevo estado.
pub fn toggle_favorite(conn: &Connection, build_id: i64) -> Result<bool> {
    if is_favorite(conn, build_id)? {
        conn.execute(
            "DELETE FROM favorites WHERE build_id = ?1",
            params![build_id],
        )?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO favorites (build_id) VALUES (?1)",
            params![build_id],
        )?;
        Ok(true)
    }
}

pub fn list_favorites(conn: &Connection) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare("SELECT build_id FROM favorites ORDER BY created_at DESC")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---- Checklist de materiales ----

pub fn set_material_gathered(
    conn: &Connection,
    build_id: i64,
    scope: &str,
    block_name: &str,
    gathered_qty: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO material_checklist (build_id, scope, block_name, gathered_qty) \
         VALUES (?1, ?2, ?3, ?4) \
         ON CONFLICT(build_id, scope, block_name) DO UPDATE SET gathered_qty = excluded.gathered_qty",
        params![build_id, scope, block_name, gathered_qty],
    )?;
    Ok(())
}

pub fn get_checklist(conn: &Connection, build_id: i64, scope: &str) -> Result<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(
        "SELECT block_name, gathered_qty FROM material_checklist \
         WHERE build_id = ?1 AND scope = ?2 ORDER BY block_name",
    )?;
    let rows = stmt.query_map(params![build_id, scope], |r| {
        Ok(ChecklistItem {
            block_name: r.get(0)?,
            gathered_qty: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ---- Materiales cacheados ----

pub fn cache_build_materials(conn: &Connection, build_id: i64, mats: &[MaterialRow]) -> Result<()> {
    conn.execute(
        "DELETE FROM build_materials WHERE build_id = ?1",
        params![build_id],
    )?;
    for m in mats {
        conn.execute(
            "INSERT INTO build_materials (build_id, block_name, qty) VALUES (?1, ?2, ?3)",
            params![build_id, m.block_name, m.qty],
        )?;
    }
    Ok(())
}

pub fn build_materials(conn: &Connection, build_id: i64) -> Result<Vec<MaterialRow>> {
    let mut stmt = conn.prepare(
        "SELECT block_name, qty FROM build_materials WHERE build_id = ?1 ORDER BY block_name",
    )?;
    let rows = stmt.query_map(params![build_id], |r| {
        Ok(MaterialRow {
            block_name: r.get(0)?,
            qty: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn cache_phase_materials(conn: &Connection, phase_id: i64, mats: &[MaterialRow]) -> Result<()> {
    conn.execute(
        "DELETE FROM phase_materials WHERE phase_id = ?1",
        params![phase_id],
    )?;
    for m in mats {
        conn.execute(
            "INSERT INTO phase_materials (phase_id, block_name, qty) VALUES (?1, ?2, ?3)",
            params![phase_id, m.block_name, m.qty],
        )?;
    }
    Ok(())
}

pub fn phase_materials(conn: &Connection, phase_id: i64) -> Result<Vec<MaterialRow>> {
    let mut stmt = conn.prepare(
        "SELECT block_name, qty FROM phase_materials WHERE phase_id = ?1 ORDER BY block_name",
    )?;
    let rows = stmt.query_map(params![phase_id], |r| {
        Ok(MaterialRow {
            block_name: r.get(0)?,
            qty: r.get(1)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// build_id al que pertenece una fase.
pub fn build_id_of_phase(conn: &Connection, phase_id: i64) -> Result<i64> {
    Ok(conn.query_row(
        "SELECT build_id FROM phases WHERE id = ?1",
        params![phase_id],
        |r| r.get(0),
    )?)
}

/// Recalcula el total de materiales de la build sumando los de todas sus fases
/// y actualiza también `block_count` de la build.
pub fn recompute_build_materials(conn: &Connection, build_id: i64) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT pm.block_name, SUM(pm.qty) AS total FROM phase_materials pm \
         JOIN phases p ON p.id = pm.phase_id WHERE p.build_id = ?1 \
         GROUP BY pm.block_name ORDER BY pm.block_name",
    )?;
    let mats: Vec<MaterialRow> = stmt
        .query_map(params![build_id], |r| {
            Ok(MaterialRow {
                block_name: r.get(0)?,
                qty: r.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);
    cache_build_materials(conn, build_id, &mats)?;
    let total: i64 = mats.iter().map(|m| m.qty).sum();
    conn.execute(
        "UPDATE builds SET block_count = ?2 WHERE id = ?1",
        params![build_id, total],
    )?;
    Ok(())
}
