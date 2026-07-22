//! Exportación/importación de guías en formato portable `.voxelfold`.
//!
//! El archivo contiene solo metadatos, fases, pasos, materiales (nombres de bloque)
//! y, opcionalmente, el modelo voxel. NO incrusta assets de Hytale: el equipo que
//! lo importe resuelve los bloques contra su propio catálogo local. Así se pueden
//! compartir guías construibles sin redistribuir contenido del juego.

use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::core::db::models::{MaterialRow, NewBuild, NewPhase, NewStep};
use crate::core::db::repo;
use crate::core::error::{CoreError, Result};
use crate::core::voxel_store::{self, StoredModel};

const FORMAT: &str = "voxelfold";
const VERSION: u32 = 1;
const MAX_PHASES: usize = 256;
const MAX_STEPS: usize = 50_000;
const MAX_MATERIAL_ROWS: usize = 100_000;

fn validate_text(value: &str, label: &str, max: usize, required: bool) -> Result<()> {
    if required && value.trim().is_empty() {
        return Err(CoreError::Other(format!("{label} no puede estar vacío")));
    }
    if value.len() > max || value.chars().any(|c| c == '\0') {
        return Err(CoreError::Other(format!("{label} no es válido")));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortableStep {
    pub title: String,
    pub instruction: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortablePhase {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub materials: Vec<MaterialRow>,
    #[serde(default)]
    pub steps: Vec<PortableStep>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortableBuild {
    pub format: String,
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub difficulty: String,
    #[serde(default)]
    pub estimated_time_min: i64,
    #[serde(default)]
    pub mode: String,
    #[serde(default)]
    pub author_name: Option<String>,
    #[serde(default)]
    pub phases: Vec<PortablePhase>,
    #[serde(default)]
    pub voxel_model: Option<StoredModel>,
}

/// Serializa una build a JSON portable `.voxelfold`.
pub fn export(conn: &Connection, voxel_dir: impl AsRef<Path>, build_id: i64) -> Result<String> {
    let b = repo::get_build(conn, build_id)?;
    let mut phases = Vec::new();
    for ph in repo::phases_for_build(conn, build_id)? {
        let steps = repo::steps_for_phase(conn, ph.id)?
            .into_iter()
            .map(|s| PortableStep {
                title: s.title,
                instruction: s.instruction,
            })
            .collect();
        let materials = repo::phase_materials(conn, ph.id)?;
        phases.push(PortablePhase {
            name: ph.name,
            description: ph.description,
            materials,
            steps,
        });
    }
    let voxel_model = if b.voxel_model_ref.is_some() {
        voxel_store::load(&voxel_dir, build_id).ok()
    } else {
        None
    };
    let portable = PortableBuild {
        format: FORMAT.to_string(),
        version: VERSION,
        name: b.name,
        description: b.description,
        category: b.category,
        style: b.style,
        difficulty: b.difficulty,
        estimated_time_min: b.estimated_time_min,
        mode: b.mode,
        author_name: b.author_name,
        phases,
        voxel_model,
    };
    Ok(serde_json::to_string_pretty(&portable)?)
}

/// Importa una build desde JSON portable. Genera un slug único y, si trae modelo
/// voxel, lo guarda y enlaza. Devuelve el id de la build creada.
pub fn import(conn: &Connection, voxel_dir: impl AsRef<Path>, json: &str) -> Result<i64> {
    let p: PortableBuild = serde_json::from_str(json)?;
    if p.format != FORMAT {
        return Err(CoreError::Other(format!(
            "formato no reconocido: «{}» (se esperaba «{FORMAT}»)",
            p.format
        )));
    }
    if p.version > VERSION {
        return Err(CoreError::Other(format!(
            "versión {} no soportada (máx. {VERSION}); actualiza Voxelfold",
            p.version
        )));
    }
    if p.name.trim().is_empty() {
        return Err(CoreError::Other("la guía no tiene nombre".to_string()));
    }
    validate_text(&p.name, "el nombre de la guía", 256, true)?;
    validate_text(&p.description, "la descripción", 100_000, false)?;
    if p.estimated_time_min < 0 || p.estimated_time_min > 5_256_000 {
        return Err(CoreError::Other("el tiempo estimado no es válido".into()));
    }
    if p.phases.len() > MAX_PHASES {
        return Err(CoreError::Other(format!(
            "la guía supera el límite de {MAX_PHASES} fases"
        )));
    }
    let step_count: usize = p.phases.iter().map(|phase| phase.steps.len()).sum();
    let material_count: usize = p.phases.iter().map(|phase| phase.materials.len()).sum();
    if step_count > MAX_STEPS || material_count > MAX_MATERIAL_ROWS {
        return Err(CoreError::Other(
            "la guía contiene demasiados pasos o materiales".into(),
        ));
    }
    for phase in &p.phases {
        validate_text(&phase.name, "el nombre de una fase", 256, true)?;
        validate_text(
            &phase.description,
            "la descripción de una fase",
            100_000,
            false,
        )?;
        for step in &phase.steps {
            validate_text(&step.title, "el título de un paso", 512, true)?;
            validate_text(
                &step.instruction,
                "la instrucción de un paso",
                100_000,
                false,
            )?;
        }
        for material in &phase.materials {
            validate_text(&material.block_name, "el nombre de un material", 512, true)?;
            if material.qty < 0 {
                return Err(CoreError::Other(
                    "una cantidad de material es negativa".into(),
                ));
            }
        }
    }
    if let Some(model) = &p.voxel_model {
        model.validate()?;
        if model.phases as usize != p.phases.len() {
            return Err(CoreError::Other(
                "las fases del modelo no coinciden con las fases de la guía".into(),
            ));
        }
    }

    let base = {
        let s = slugify(&p.name);
        if s.is_empty() {
            "build".to_string()
        } else {
            s
        }
    };
    let block_count = p
        .voxel_model
        .as_ref()
        .map(|m| m.blocks.len() as i64)
        .unwrap_or(0);
    let mut meta = NewBuild {
        slug: String::new(),
        name: p.name.clone(),
        description: p.description,
        category: p.category,
        style: p.style,
        difficulty: p.difficulty,
        estimated_time_min: p.estimated_time_min,
        block_count,
        mode: if p.mode.is_empty() {
            "both".to_string()
        } else {
            p.mode
        },
        thumbnail_ref: None,
        author_name: p.author_name,
        author_url: None,
        source_url: None,
        license_note: Some("Guía importada (.voxelfold).".to_string()),
        voxel_model_ref: None,
    };
    // Toda la importación en una transacción: si algo falla, no queda una build a medias
    // (slug creado pero sin fases, o con ref a un modelo que no se enlazó). El bucle de slug
    // único sigue funcionando dentro de la tx: SQLite valida UNIQUE por sentencia.
    let tx = conn.unchecked_transaction()?;
    let mut build_id = None;
    for n in 0..1000 {
        meta.slug = if n == 0 {
            base.clone()
        } else {
            format!("{base}-{}", n + 1)
        };
        if let Ok(id) = repo::create_build(&tx, &meta) {
            build_id = Some(id);
            break;
        }
    }
    let build_id = build_id.ok_or_else(|| CoreError::Other("no se pudo crear la build".into()))?;

    // Modelo voxel opcional.
    if let Some(model) = &p.voxel_model {
        let ref_path = voxel_store::save(&voxel_dir, build_id, model)?;
        tx.execute(
            "UPDATE builds SET voxel_model_ref = ?1 WHERE id = ?2",
            params![ref_path, build_id],
        )?;
    }

    // Fases, pasos y materiales.
    for (i, ph) in p.phases.iter().enumerate() {
        let phase_id = repo::add_phase(
            &tx,
            &NewPhase {
                build_id,
                order_index: i as i64,
                name: ph.name.clone(),
                description: ph.description.clone(),
            },
        )?;
        for (j, st) in ph.steps.iter().enumerate() {
            repo::add_step(
                &tx,
                &NewStep {
                    phase_id,
                    order_index: j as i64,
                    title: st.title.clone(),
                    instruction: st.instruction.clone(),
                    preview_ref: None,
                },
            )?;
        }
        if !ph.materials.is_empty() {
            repo::cache_phase_materials(&tx, phase_id, &ph.materials)?;
        }
    }
    repo::recompute_build_materials(&tx, build_id)?;
    tx.commit()?;

    Ok(build_id)
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::db;

    #[test]
    fn export_import_roundtrip() {
        let conn = db::open_in_memory().unwrap();
        let dir = std::env::temp_dir().join("voxelfold_portable_test");
        let _ = std::fs::create_dir_all(&dir);

        // Build origen con 2 fases, pasos y materiales.
        let nb = NewBuild {
            slug: "origen".into(),
            name: "Casa de prueba".into(),
            description: "desc".into(),
            category: "Vivienda".into(),
            style: "Rústico".into(),
            difficulty: "Fácil".into(),
            estimated_time_min: 20,
            block_count: 0,
            mode: "both".into(),
            thumbnail_ref: None,
            author_name: Some("Yo".into()),
            author_url: None,
            source_url: None,
            license_note: None,
            voxel_model_ref: None,
        };
        let bid = repo::create_build(&conn, &nb).unwrap();
        let p1 = repo::add_phase(
            &conn,
            &NewPhase {
                build_id: bid,
                order_index: 0,
                name: "Base".into(),
                description: String::new(),
            },
        )
        .unwrap();
        repo::add_step(
            &conn,
            &NewStep {
                phase_id: p1,
                order_index: 0,
                title: "Suelo".into(),
                instruction: "pon piedra".into(),
                preview_ref: None,
            },
        )
        .unwrap();
        repo::cache_phase_materials(
            &conn,
            p1,
            &[MaterialRow {
                block_name: "Rock_Stone".into(),
                qty: 12,
            }],
        )
        .unwrap();

        let json = export(&conn, &dir, bid).unwrap();
        assert!(json.contains("\"format\""));
        assert!(json.contains("Casa de prueba"));

        // Importar en la misma BD: debe crear una segunda build con slug único.
        let new_id = import(&conn, &dir, &json).unwrap();
        assert_ne!(new_id, bid);
        let imported = repo::get_build(&conn, new_id).unwrap();
        assert_eq!(imported.name, "Casa de prueba");
        assert_ne!(imported.slug, "origen", "slug debe ser único");
        let phases = repo::phases_for_build(&conn, new_id).unwrap();
        assert_eq!(phases.len(), 1);
        assert_eq!(repo::steps_for_phase(&conn, phases[0].id).unwrap().len(), 1);
        let mats = repo::build_materials(&conn, new_id).unwrap();
        assert_eq!(
            mats.iter()
                .find(|m| m.block_name == "Rock_Stone")
                .unwrap()
                .qty,
            12
        );
    }

    #[test]
    fn import_rechaza_formato_invalido() {
        let conn = db::open_in_memory().unwrap();
        let dir = std::env::temp_dir();
        let bad = r#"{"format":"otro","version":1,"name":"x"}"#;
        assert!(import(&conn, &dir, bad).is_err());
    }
}
